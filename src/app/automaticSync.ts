import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from 'react'

import type { AppData } from '../types'
import {
  hasPendingGenerationMessage,
  hasStreamingMessage,
} from '../services/appData'
import {
  canPullRemoteSync,
  hasUnsyncedLocalChanges,
  type RunSyncOptions,
  type SyncCredentialState,
} from '../services/syncFlow'

export const AUTO_SYNC_DEBOUNCE_MS = 1200
export const REMOTE_PULL_INTERVAL_MS = 20_000
export const REMOTE_PULL_STARTUP_DELAY_MS = 600
const REMOTE_PULL_WINDOW_EVENTS = ['focus', 'online'] as const

export interface AutoSyncScheduler {
  clearTimeout: (timer: number) => void
  setTimeout: (callback: () => void, delayMs: number) => number
}

export interface AutoSyncQueue {
  clearScheduledSync: () => void
  dispose: () => void
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
}

export type AutoSyncFailureReporter = (error: unknown) => void

type AutomaticRemotePullCleanup = () => void

export interface AutomaticRemotePullRuntime {
  documentTarget: Pick<
    Document,
    'addEventListener' | 'removeEventListener' | 'visibilityState'
  >
  windowTarget: Pick<
    Window,
    | 'addEventListener'
    | 'clearInterval'
    | 'clearTimeout'
    | 'removeEventListener'
    | 'setInterval'
    | 'setTimeout'
  >
}

interface AutomaticRemotePullOptions {
  dataRef: RefObject<AppData | null>
  getSyncCredentials: () => SyncCredentialState
  onDetachedSyncError: AutoSyncFailureReporter
  runSync: (snapshot: AppData, options: RunSyncOptions) => void | Promise<void>
  runtime: AutomaticRemotePullRuntime
  scheduleAutoSync: (snapshot: AppData) => void
}

interface AutoSyncQueueOptions {
  dataRef: RefObject<AppData | null>
  isOnline: () => boolean
  isSyncing?: () => boolean
  onDetachedSyncError: AutoSyncFailureReporter
  runSync: (snapshot: AppData, options: RunSyncOptions) => void | Promise<void>
  scheduler?: AutoSyncScheduler
  warnSyncConfigLocalSaved: (snapshot: AppData) => boolean
}

interface AutoSyncTimerOwner {
  generation: number
  immediate: boolean
  handle?: number
}

interface AutomaticSyncOptions {
  data: AppData | null
  dataRef: RefObject<AppData | null>
  getSyncCredentials: () => SyncCredentialState
  githubTokenValue: string
  isOnlineRef: RefObject<boolean>
  isSyncing: () => boolean
  onDetachedSyncError: AutoSyncFailureReporter
  runSync: (snapshot: AppData, options: RunSyncOptions) => void | Promise<void>
  syncing: boolean
  syncPassphraseValue: string
  warnSyncConfigLocalSaved: (snapshot: AppData) => boolean
}

const defaultScheduler: AutoSyncScheduler = {
  clearTimeout: (timer) => window.clearTimeout(timer),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
}

export function runDetachedAutoSync(
  runSync: (snapshot: AppData, options: RunSyncOptions) => void | Promise<void>,
  snapshot: AppData,
  options: RunSyncOptions,
  onDetachedSyncError: AutoSyncFailureReporter,
): void {
  try {
    void Promise.resolve(runSync(snapshot, options)).catch((error: unknown) => {
      reportDetachedAutoSyncFailure(error, onDetachedSyncError)
    })
  } catch (error: unknown) {
    reportDetachedAutoSyncFailure(error, onDetachedSyncError)
  }
}

export function reportDetachedAutoSyncFailure(
  error: unknown,
  onDetachedSyncError: AutoSyncFailureReporter,
): void {
  try {
    onDetachedSyncError(error)
  } catch {
    // The detached boundary has no fallback UI channel. Keep the scheduler alive.
  }
}

export function canRunAutomaticRemotePull(
  sync: AppData['sync'],
  credentials: SyncCredentialState,
): boolean {
  return sync.autoSync && canPullRemoteSync(sync, credentials)
}

export function installAutomaticRemotePullListeners(
  windowTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  documentTarget: Pick<Document, 'addEventListener' | 'removeEventListener'>,
  pullLatest: () => void,
  pullWhenVisible: () => void,
): AutomaticRemotePullCleanup {
  const removers: Array<() => void> = []

  const cleanup = () => {
    for (const remove of removers.splice(0).reverse()) {
      try {
        remove()
      } catch {
        // Listener cleanup is best-effort during page or WebView teardown.
      }
    }
  }

  const register = (
    target:
      | Pick<Window, 'addEventListener' | 'removeEventListener'>
      | Pick<Document, 'addEventListener' | 'removeEventListener'>,
    event: string,
    listener: () => void,
  ) => {
    target.addEventListener(event, listener)
    removers.push(() => target.removeEventListener(event, listener))
  }

  try {
    for (const event of REMOTE_PULL_WINDOW_EVENTS) {
      register(windowTarget, event, pullLatest)
    }
    register(documentTarget, 'visibilitychange', pullWhenVisible)
  } catch {
    cleanup()
  }

  return cleanup
}

export function installAutomaticRemotePull({
  dataRef,
  getSyncCredentials,
  onDetachedSyncError,
  runSync,
  runtime: { documentTarget, windowTarget },
  scheduleAutoSync,
}: AutomaticRemotePullOptions): AutomaticRemotePullCleanup {
  const current = dataRef.current

  if (
    !current ||
    !canRunAutomaticRemotePull(current.sync, getSyncCredentials())
  ) {
    return () => undefined
  }

  let disposed = false
  const scheduleDirtySnapshot = (snapshot: AppData): void => {
    try {
      scheduleAutoSync(snapshot)
    } catch (error: unknown) {
      reportDetachedAutoSyncFailure(error, onDetachedSyncError)
    }
  }
  const pullLatest = (): void => {
    if (disposed) {
      return
    }

    const snapshot = dataRef.current

    if (
      !snapshot ||
      !canRunAutomaticRemotePull(snapshot.sync, getSyncCredentials())
    ) {
      return
    }

    if (hasUnsyncedLocalChanges(snapshot)) {
      scheduleDirtySnapshot(snapshot)
      return
    }

    runDetachedAutoSync(
      runSync,
      snapshot,
      {
        pullOnly: true,
        silent: true,
      },
      onDetachedSyncError,
    )
  }
  const pullWhenVisible = (): void => {
    if (documentTarget.visibilityState === 'visible') {
      pullLatest()
    }
  }
  const cleanupRemotePullListeners = installAutomaticRemotePullListeners(
    windowTarget,
    documentTarget,
    pullLatest,
    pullWhenVisible,
  )
  let startupHandle: number | null = null
  let intervalHandle: number | null = null
  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    if (startupHandle !== null) {
      try {
        windowTarget.clearTimeout(startupHandle)
      } catch {
        // Timer cleanup may fail during browser teardown.
      }
      startupHandle = null
    }
    if (intervalHandle !== null) {
      try {
        windowTarget.clearInterval(intervalHandle)
      } catch {
        // Timer cleanup may fail during browser teardown.
      }
      intervalHandle = null
    }
    cleanupRemotePullListeners()
  }

  try {
    startupHandle = windowTarget.setTimeout(
      pullLatest,
      REMOTE_PULL_STARTUP_DELAY_MS,
    )
    intervalHandle = windowTarget.setInterval(
      pullWhenVisible,
      REMOTE_PULL_INTERVAL_MS,
    )
  } catch (error) {
    cleanup()
    throw error
  }

  return cleanup
}

export function createAutoSyncQueue({
  dataRef,
  isOnline,
  isSyncing = () => false,
  onDetachedSyncError,
  runSync,
  scheduler = defaultScheduler,
  warnSyncConfigLocalSaved,
}: AutoSyncQueueOptions): AutoSyncQueue {
  let syncTimer: AutoSyncTimerOwner | null = null
  let disposed = false
  let scheduleGeneration = 0

  function clearScheduledSync(): void {
    const owner = syncTimer
    if (owner === null) {
      return
    }

    syncTimer = null
    scheduleGeneration += 1
    if (owner.handle === undefined) {
      return
    }

    try {
      scheduler.clearTimeout(owner.handle)
    } catch (error: unknown) {
      reportDetachedAutoSyncFailure(error, onDetachedSyncError)
    }
  }

  function shouldSchedule(snapshot: AppData): boolean {
    if (
      snapshot.sync.mode === 'local' ||
      !snapshot.sync.autoSync ||
      !isOnline()
    ) {
      return false
    }

    let configWarning: boolean
    try {
      configWarning = warnSyncConfigLocalSaved(snapshot)
    } catch {
      try {
        console.error('[app] automatic sync configuration warning failed')
      } catch {
        // A broken diagnostic channel must not turn a scheduler guard into a throw.
      }
      return false
    }

    if (
      configWarning ||
      !hasUnsyncedLocalChanges(snapshot)
    ) {
      return false
    }

    return !hasPendingGenerationMessage(snapshot)
  }

  function scheduleAutoSync(
    snapshot: AppData,
    delayMs = AUTO_SYNC_DEBOUNCE_MS,
  ): void {
    if (disposed) {
      return
    }

    if (isSyncing()) {
      clearScheduledSync()
      return
    }
    if (!shouldSchedule(snapshot)) {
      return
    }

    const immediate = delayMs <= 0

    if (syncTimer !== null) {
      if (syncTimer.immediate && !immediate) {
        return
      }

      clearScheduledSync()
    }

    const owner: AutoSyncTimerOwner = {
      generation: ++scheduleGeneration,
      immediate,
    }
    syncTimer = owner

    try {
      const handle = scheduler.setTimeout(() => {
        if (
          disposed ||
          syncTimer !== owner ||
          owner.generation !== scheduleGeneration
        ) {
          return
        }

        syncTimer = null

        if (isSyncing()) {
          return
        }

        const latest = dataRef.current
        if (!latest) {
          return
        }

        if (!shouldSchedule(latest)) {
          return
        }

        runDetachedAutoSync(runSync, latest, { silent: true }, onDetachedSyncError)
      }, delayMs)

      if (syncTimer !== owner) {
        try {
          scheduler.clearTimeout(handle)
        } catch (error: unknown) {
          reportDetachedAutoSyncFailure(error, onDetachedSyncError)
        }
        return
      }

      owner.handle = handle
    } catch (error: unknown) {
      if (syncTimer === owner) {
        syncTimer = null
      }
      reportDetachedAutoSyncFailure(error, onDetachedSyncError)
    }
  }

  function dispose(): void {
    if (disposed) {
      return
    }

    disposed = true
    scheduleGeneration += 1
    clearScheduledSync()
  }

  return {
    clearScheduledSync,
    dispose,
    scheduleAutoSync,
  }
}

export function reconcileAutoSync(
  queue: Pick<AutoSyncQueue, 'clearScheduledSync' | 'scheduleAutoSync'>,
  data: AppData | null,
  syncing: boolean,
): void {
  if (!data || syncing || hasStreamingMessage(data)) {
    queue.clearScheduledSync()
    return
  }

  queue.scheduleAutoSync(data)
}

export function useAutomaticSync({
  data,
  dataRef,
  getSyncCredentials,
  githubTokenValue,
  isOnlineRef,
  isSyncing,
  onDetachedSyncError,
  runSync,
  syncing,
  syncPassphraseValue,
  warnSyncConfigLocalSaved,
}: AutomaticSyncOptions): Pick<
  AutoSyncQueue,
  'clearScheduledSync' | 'scheduleAutoSync'
> {
  const getSyncCredentialsRef = useRef(getSyncCredentials)
  const isSyncingRef = useRef(isSyncing)
  const onDetachedSyncErrorRef = useRef(onDetachedSyncError)
  const runSyncRef = useRef(runSync)
  const warnSyncConfigLocalSavedRef = useRef(warnSyncConfigLocalSaved)
  const autoSyncQueueRef = useRef<AutoSyncQueue | null>(null)

  useEffect(() => {
    getSyncCredentialsRef.current = getSyncCredentials
    isSyncingRef.current = isSyncing
    onDetachedSyncErrorRef.current = onDetachedSyncError
    runSyncRef.current = runSync
    warnSyncConfigLocalSavedRef.current = warnSyncConfigLocalSaved
  }, [
    getSyncCredentials,
    isSyncing,
    onDetachedSyncError,
    runSync,
    warnSyncConfigLocalSaved,
  ])

  useEffect(() => {
    const autoSyncQueue = createAutoSyncQueue({
      dataRef,
      isOnline: () => isOnlineRef.current,
      isSyncing: () => isSyncingRef.current(),
      onDetachedSyncError: (error) => onDetachedSyncErrorRef.current(error),
      runSync: (snapshot, options) => runSyncRef.current(snapshot, options),
      warnSyncConfigLocalSaved: (snapshot) =>
        warnSyncConfigLocalSavedRef.current(snapshot),
    })

    autoSyncQueueRef.current = autoSyncQueue

    return () => {
      autoSyncQueue.dispose()

      if (autoSyncQueueRef.current === autoSyncQueue) {
        autoSyncQueueRef.current = null
      }
    }
  }, [dataRef, isOnlineRef])

  const clearScheduledSync = useCallback(() => {
    autoSyncQueueRef.current?.clearScheduledSync()
  }, [])

  const scheduleAutoSync = useCallback(
    (snapshot: AppData, delayMs?: number) => {
      autoSyncQueueRef.current?.scheduleAutoSync(snapshot, delayMs)
    },
    [],
  )

  useEffect(() => {
    reconcileAutoSync(
      {
        clearScheduledSync,
        scheduleAutoSync,
      },
      data,
      syncing,
    )
  }, [
    clearScheduledSync,
    data,
    githubTokenValue,
    scheduleAutoSync,
    syncPassphraseValue,
    syncing,
  ])

  useEffect(() => {
    return installAutomaticRemotePull({
      dataRef,
      getSyncCredentials: () => getSyncCredentialsRef.current(),
      onDetachedSyncError: (error) => onDetachedSyncErrorRef.current(error),
      runSync: (snapshot, options) => runSyncRef.current(snapshot, options),
      runtime: {
        documentTarget: document,
        windowTarget: window,
      },
      scheduleAutoSync,
    })
  }, [
    data?.sync.autoSync,
    data?.sync.gistId,
    data?.sync.mode,
    data?.sync.workerEndpoint,
    dataRef,
    githubTokenValue,
    scheduleAutoSync,
    syncPassphraseValue,
  ])

  return {
    clearScheduledSync,
    scheduleAutoSync,
  }
}
