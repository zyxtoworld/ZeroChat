import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

import type { AppData } from '../types'

export const LOCAL_SAVE_DEBOUNCE_MS = 250

type LocalSaveTimer = ReturnType<typeof setTimeout>

export interface LocalSaveScheduler {
  setTimeout: (callback: () => void, delayMs: number) => LocalSaveTimer
  clearTimeout: (timer: LocalSaveTimer) => void
}

export interface LocalSaveQueue {
  commitPublishedLocalSnapshot: (
    snapshot: AppData,
    precondition?: LocalSaveCommitPrecondition,
  ) => Promise<void>
  discardPendingLocalSaves: () => Promise<void>
  dispose: () => void
  flushLocalSaveQueue: () => Promise<void>
  markPersistedSnapshot: (snapshot: AppData) => void
  persistLocalSnapshot: (snapshot: AppData) => Promise<AppData>
  queueLocalSave: (snapshot: AppData, delayMs?: number) => void
  updateHandlers: (
    onError: (error: unknown) => void,
    save: (snapshot: AppData) => Promise<void>,
    recoverSaveConflict?: LocalSaveConflictRecovery,
    onSnapshotRebased?: (snapshot: AppData) => void,
    readCurrentSnapshot?: () => AppData | null,
  ) => void
}

export interface LocalSaveRecoveryResult {
  commitPreconditionSatisfied?: boolean
  persistedSnapshot: AppData
  rebaseSnapshot: (snapshot: AppData) => AppData
}

export interface LocalSaveCommitPrecondition {
  isSatisfied: (snapshot: AppData | null) => boolean
  onOutcome?: (snapshot: AppData | null) => void
}

export type LocalSaveConflictRecovery = (
  error: unknown,
  base: AppData | null,
  local: AppData,
  precondition?: LocalSaveCommitPrecondition['isSatisfied'],
) => Promise<LocalSaveRecoveryResult>

interface LocalSaveQueueOptions {
  onError: (error: unknown) => void
  onSnapshotRebased?: (snapshot: AppData) => void
  readCurrentSnapshot?: () => AppData | null
  recoverSaveConflict?: LocalSaveConflictRecovery
  save: (snapshot: AppData) => Promise<void>
  scheduler?: LocalSaveScheduler
}

interface LocalSaveQueueControllerOptions extends LocalSaveQueueOptions {
  data: AppData | null
  dataRef: RefObject<AppData | null>
}

interface LocalSaveEntry {
  precondition?: LocalSaveCommitPrecondition['isSatisfied']
  sequence: number
  snapshot: AppData
}

const defaultScheduler: LocalSaveScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
}

let activeLocalSaveQueue: LocalSaveQueue | null = null

export function persistPublishedLocalSnapshot(
  snapshot: AppData,
): Promise<AppData> {
  if (!activeLocalSaveQueue) {
    return Promise.reject(
      new Error('Local save queue is not ready for a durable commit.'),
    )
  }

  return activeLocalSaveQueue.persistLocalSnapshot(snapshot)
}

export function reportLocalSaveQueueFailure(
  error: unknown,
  onError: (error: unknown) => void,
): void {
  try {
    onError(error)
  } catch {
    // There is no second UI channel for a failed error reporter. Keep the queue alive.
  }
}

export function runLocalSaveQueueFlush(
  flushLocalSaveQueue: () => Promise<void>,
  onError: (error: unknown) => void,
): void {
  try {
    void flushLocalSaveQueue().catch((error: unknown) => {
      reportLocalSaveQueueFailure(error, onError)
    })
  } catch (error: unknown) {
    reportLocalSaveQueueFailure(error, onError)
  }
}

export function createLocalSaveQueue({
  onError: initialOnError,
  onSnapshotRebased: initialOnSnapshotRebased,
  readCurrentSnapshot: initialReadCurrentSnapshot,
  recoverSaveConflict: initialRecoverSaveConflict,
  save: initialSave,
  scheduler = defaultScheduler,
}: LocalSaveQueueOptions): LocalSaveQueue {
  let onError = initialOnError
  let onSnapshotRebased = initialOnSnapshotRebased
  let readCurrentSnapshot = initialReadCurrentSnapshot
  let recoverSaveConflict = initialRecoverSaveConflict
  let save = initialSave
  let localSaveTimer: LocalSaveTimer | null = null
  let activeLocalSave: Promise<void> | null = null
  let activeLocalSaveEntry: LocalSaveEntry | null = null
  let persistedLocalSaveSnapshot: AppData | null = null
  let persistedLocalSaveSequence = 0
  let nextLocalSaveSequence = 0
  let queuedLocalSave: LocalSaveEntry | null | undefined = null
  let queuedWhileSaveInFlight = false

  function clearLocalSaveTimer(): void {
    if (localSaveTimer === null) {
      return
    }

    scheduler.clearTimeout(localSaveTimer)
    localSaveTimer = null
  }

  async function saveWithConflictRecovery(
    snapshot: AppData,
    base: AppData | null,
    precondition?: LocalSaveCommitPrecondition['isSatisfied'],
  ): Promise<LocalSaveRecoveryResult | null> {
    try {
      await save(snapshot)
      return null
    } catch (error: unknown) {
      if (!recoverSaveConflict) {
        throw error
      }

      return precondition
        ? recoverSaveConflict(error, base, snapshot, precondition)
        : recoverSaveConflict(error, base, snapshot)
    }
  }

  function applyRecoveredSnapshot(
    entry: LocalSaveEntry,
    recovery: LocalSaveRecoveryResult,
  ): void {
    const currentSnapshot = readCurrentSnapshot?.()
    const queuedSnapshot = queuedLocalSave?.snapshot
    const pendingSnapshot =
      currentSnapshot && currentSnapshot !== entry.snapshot
        ? currentSnapshot
        : queuedSnapshot && queuedSnapshot !== entry.snapshot
          ? queuedSnapshot
          : null
    let publishedSnapshot = recovery.persistedSnapshot

    if (pendingSnapshot && queuedLocalSave !== undefined) {
      publishedSnapshot = recovery.rebaseSnapshot(pendingSnapshot)
      queuedLocalSave = {
        sequence: queuedLocalSave?.sequence ?? ++nextLocalSaveSequence,
        snapshot: publishedSnapshot,
      }
      queuedWhileSaveInFlight = true
    }

    onSnapshotRebased?.(publishedSnapshot)
  }

  async function performLocalSave(entry: LocalSaveEntry): Promise<void> {
    let saveFailed = false

    try {
      const recovery = await saveWithConflictRecovery(
        entry.snapshot,
        persistedLocalSaveSnapshot,
        entry.precondition,
      )
      persistedLocalSaveSnapshot =
        recovery?.persistedSnapshot ?? entry.snapshot
      persistedLocalSaveSequence = entry.sequence
      if (recovery) {
        applyRecoveredSnapshot(entry, recovery)
      }
    } catch (error: unknown) {
      saveFailed = true
      if (
        queuedLocalSave !== undefined &&
        !queuedWhileSaveInFlight
      ) {
        queuedLocalSave = entry
      }
      throw error
    } finally {
      activeLocalSave = null
      activeLocalSaveEntry = null

      if (
        queuedLocalSave &&
        (!saveFailed || queuedWhileSaveInFlight)
      ) {
        clearLocalSaveTimer()
        runLocalSaveQueueFlush(flushLocalSaveQueue, onError)
      }
    }
  }

  function flushLocalSaveQueue(): Promise<void> {
    if (activeLocalSave) {
      return activeLocalSave
    }

    const entry = queuedLocalSave

    if (!entry) {
      return Promise.resolve()
    }

    queuedLocalSave = null
    queuedWhileSaveInFlight = false
    activeLocalSaveEntry = entry
    activeLocalSave = performLocalSave(entry)
    return activeLocalSave
  }

  function discardQueuedLocalSaves(discarding = false): void {
    clearLocalSaveTimer()
    queuedLocalSave = discarding ? undefined : null
    queuedWhileSaveInFlight = false
  }

  async function discardPendingLocalSaves(): Promise<void> {
    discardQueuedLocalSaves(true)
    try {
      await activeLocalSave
    } finally {
      discardQueuedLocalSaves()
    }
  }

  async function persistLocalSnapshot(snapshot: AppData): Promise<AppData> {
    discardQueuedLocalSaves(true)

    try {
      try {
        await activeLocalSave
      } catch {
        // The detached save path already reported the stale write failure.
      }

      if (snapshot === persistedLocalSaveSnapshot) {
        return snapshot
      }

      const outcome: { recovery: LocalSaveRecoveryResult | null } = {
        recovery: null,
      }
      activeLocalSave = Promise.resolve().then(async () => {
        outcome.recovery = await saveWithConflictRecovery(
          snapshot,
          persistedLocalSaveSnapshot,
        )
      })
      activeLocalSaveEntry = {
        sequence: persistedLocalSaveSequence,
        snapshot,
      }
      await activeLocalSave
      const recovery = outcome.recovery
      const persistedSnapshot = recovery?.persistedSnapshot ?? snapshot
      persistedLocalSaveSnapshot = persistedSnapshot
      if (recovery) {
        onSnapshotRebased?.(persistedSnapshot)
      }
      return persistedSnapshot
    } finally {
      activeLocalSave = null
      activeLocalSaveEntry = null
      discardQueuedLocalSaves()
    }
  }

  function enqueueLocalSave(
    snapshot: AppData,
    delayMs: number,
    detached: boolean,
    precondition?: LocalSaveCommitPrecondition['isSatisfied'],
  ): number | null {
    if (queuedLocalSave === undefined) {
      return null
    }

    if (snapshot === activeLocalSaveEntry?.snapshot) {
      activeLocalSaveEntry.precondition ??= precondition
      return activeLocalSaveEntry.sequence
    }

    if (snapshot === queuedLocalSave?.snapshot) {
      queuedLocalSave.precondition ??= precondition
      const sequence = queuedLocalSave.sequence
      clearLocalSaveTimer()

      if (detached && delayMs <= 0 && !activeLocalSave) {
        runLocalSaveQueueFlush(flushLocalSaveQueue, onError)
      }
      return sequence
    }

    if (!activeLocalSave && snapshot === persistedLocalSaveSnapshot) {
      discardQueuedLocalSaves()
      return persistedLocalSaveSequence
    }

    const entry = {
      precondition,
      sequence: ++nextLocalSaveSequence,
      snapshot,
    }
    queuedLocalSave = entry
    if (activeLocalSave) {
      queuedWhileSaveInFlight = true
    }
    clearLocalSaveTimer()

    if (delayMs > 0) {
      localSaveTimer = scheduler.setTimeout(() => {
        localSaveTimer = null
        runLocalSaveQueueFlush(flushLocalSaveQueue, onError)
      }, delayMs)
      return entry.sequence
    }

    if (detached) {
      runLocalSaveQueueFlush(flushLocalSaveQueue, onError)
    }

    return entry.sequence
  }

  async function commitPublishedLocalSnapshot(
    snapshot: AppData,
    precondition?: LocalSaveCommitPrecondition,
  ): Promise<void> {
    if (precondition && !precondition.isSatisfied(snapshot)) {
      precondition.onOutcome?.(null)
      return
    }

    const targetSequence = enqueueLocalSave(
      snapshot,
      0,
      false,
      precondition?.isSatisfied,
    )

    if (targetSequence === null) {
      throw new Error('Local snapshot replacement is already in progress.')
    }

    while (
      snapshot !== persistedLocalSaveSnapshot &&
      persistedLocalSaveSequence < targetSequence
    ) {
      const entry = activeLocalSaveEntry ?? queuedLocalSave

      if (!entry) {
        throw new Error(
          'Published local snapshot left the save queue before persistence.',
        )
      }

      const localSave = activeLocalSave ?? flushLocalSaveQueue()

      try {
        await localSave
      } catch (error: unknown) {
        if (entry.sequence >= targetSequence) {
          throw error
        }
      }
    }

    if (precondition) {
      precondition.onOutcome?.(
        precondition.isSatisfied(persistedLocalSaveSnapshot)
          ? persistedLocalSaveSnapshot
          : null,
      )
    }
  }

  function queueLocalSave(
    snapshot: AppData,
    delayMs = LOCAL_SAVE_DEBOUNCE_MS,
  ): void {
    enqueueLocalSave(snapshot, delayMs, true)
  }

  function markPersistedSnapshot(snapshot: AppData): void {
    if (activeLocalSave || queuedLocalSave) {
      return
    }

    persistedLocalSaveSnapshot = snapshot
  }

  function updateHandlers(
    nextOnError: (error: unknown) => void,
    nextSave: (snapshot: AppData) => Promise<void>,
    nextRecoverSaveConflict?: LocalSaveConflictRecovery,
    nextOnSnapshotRebased?: (snapshot: AppData) => void,
    nextReadCurrentSnapshot?: () => AppData | null,
  ): void {
    onError = nextOnError
    save = nextSave
    recoverSaveConflict = nextRecoverSaveConflict
    onSnapshotRebased = nextOnSnapshotRebased
    readCurrentSnapshot = nextReadCurrentSnapshot
  }

  return {
    commitPublishedLocalSnapshot,
    discardPendingLocalSaves,
    dispose: discardQueuedLocalSaves,
    flushLocalSaveQueue,
    markPersistedSnapshot,
    persistLocalSnapshot,
    queueLocalSave,
    updateHandlers,
  }
}

export function useLocalSaveQueueController({
  data,
  dataRef,
  onError,
  onSnapshotRebased,
  recoverSaveConflict,
  save,
  scheduler,
}: LocalSaveQueueControllerOptions): Omit<
  LocalSaveQueue,
  'updateHandlers'
> {
  const [localSaveQueue] = useState(() =>
    createLocalSaveQueue({
      onError,
      onSnapshotRebased,
      recoverSaveConflict,
      save,
      scheduler,
    }),
  )
  const initialSnapshotMarkedRef = useRef(false)

  useEffect(() => {
    localSaveQueue.updateHandlers(
      onError,
      save,
      recoverSaveConflict,
      onSnapshotRebased,
      () => dataRef.current,
    )
  }, [
    dataRef,
    localSaveQueue,
    onError,
    onSnapshotRebased,
    recoverSaveConflict,
    save,
  ])

  const flushLocalSaveQueue = useCallback(() => {
    return localSaveQueue.flushLocalSaveQueue()
  }, [localSaveQueue])

  const discardPendingLocalSaves = useCallback(() => {
    return localSaveQueue.discardPendingLocalSaves()
  }, [localSaveQueue])

  const commitPublishedLocalSnapshot = useCallback(
    (snapshot: AppData, precondition?: LocalSaveCommitPrecondition) =>
      localSaveQueue.commitPublishedLocalSnapshot(snapshot, precondition),
    [localSaveQueue],
  )

  const persistLocalSnapshot = useCallback(
    (snapshot: AppData) => localSaveQueue.persistLocalSnapshot(snapshot),
    [localSaveQueue],
  )

  const queueLocalSave = useCallback(
    (snapshot: AppData, delayMs?: number) => {
      localSaveQueue.queueLocalSave(snapshot, delayMs)
    },
    [localSaveQueue],
  )

  useEffect(() => () => localSaveQueue.dispose(), [localSaveQueue])

  useEffect(() => {
    activeLocalSaveQueue = localSaveQueue

    return () => {
      if (activeLocalSaveQueue === localSaveQueue) {
        activeLocalSaveQueue = null
      }
    }
  }, [localSaveQueue])

  useEffect(() => {
    if (data) {
      if (!initialSnapshotMarkedRef.current) {
        initialSnapshotMarkedRef.current = true
        localSaveQueue.markPersistedSnapshot(data)
        return
      }

      queueLocalSave(data)
    }
  }, [data, localSaveQueue, queueLocalSave])

  useEffect(() => {
    const flushBeforeBackground = (): void => {
      const snapshot = dataRef.current

      if (snapshot) {
        queueLocalSave(snapshot, 0)
      }
    }
    const flushWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') {
        flushBeforeBackground()
      }
    }

    window.addEventListener('pagehide', flushBeforeBackground)
    document.addEventListener('visibilitychange', flushWhenHidden)

    return () => {
      window.removeEventListener('pagehide', flushBeforeBackground)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [dataRef, queueLocalSave])

  return {
    commitPublishedLocalSnapshot,
    discardPendingLocalSaves,
    dispose: localSaveQueue.dispose,
    flushLocalSaveQueue,
    markPersistedSnapshot: localSaveQueue.markPersistedSnapshot,
    persistLocalSnapshot,
    queueLocalSave,
  }
}
