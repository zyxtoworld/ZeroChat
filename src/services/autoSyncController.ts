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
} from './appData'
import {
  canPullRemoteSync,
  hasUnsyncedLocalChanges,
  type RunSyncOptions,
  type SyncCredentialState,
} from './syncFlow'

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
  onDetachedSyncError: AutoSyncFailureReporter
  runSync: (snapshot: AppData, options: RunSyncOptions) => void | Promise<void>
  scheduler?: AutoSyncScheduler
  warnSyncConfigLocalSaved: (snapshot: AppData) => boolean
}

interface AutoSyncControllerOptions {
  activeSyncPassphraseRevision: number
  data: AppData | null
  dataRef: RefObject<AppData | null>
  getSyncCredentials: () => SyncCredentialState
  githubTokenValue: string
  isOnlineRef: RefObject<boolean>
  onDetachedSyncError: AutoSyncFailureReporter
  runSync: (snapshot: AppData, options: RunSyncOptions) => void | Promise<void>
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
  try {
    for (const event of REMOTE_PULL_WINDOW_EVENTS) {
      windowTarget.addEventListener(event, pullLatest)
    }
    documentTarget.addEventListener('visibilitychange', pullWhenVisible)
  } catch {
    // Foreground pull listeners are optional; startup and interval pulls still run.
  }

  return () => {
    for (const event of REMOTE_PULL_WINDOW_EVENTS) {
      try {
        windowTarget.removeEventListener(event, pullLatest)
      } catch {
        // Listener cleanup is best-effort during page or WebView teardown.
      }
    }

    try {
      documentTarget.removeEventListener('visibilitychange', pullWhenVisible)
    } catch {
      // Listener cleanup is best-effort during page or WebView teardown.
    }
  }
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
      scheduleAutoSync(snapshot)
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
  const startupHandle = windowTarget.setTimeout(
    pullLatest,
    REMOTE_PULL_STARTUP_DELAY_MS,
  )
  const intervalHandle = windowTarget.setInterval(
    pullWhenVisible,
    REMOTE_PULL_INTERVAL_MS,
  )

  return () => {
    disposed = true
    windowTarget.clearTimeout(startupHandle)
    windowTarget.clearInterval(intervalHandle)
    cleanupRemotePullListeners()
  }
}

export function createAutoSyncQueue({
  dataRef,
  isOnline,
  onDetachedSyncError,
  runSync,
  scheduler = defaultScheduler,
  warnSyncConfigLocalSaved,
}: AutoSyncQueueOptions): AutoSyncQueue {
  let syncTimer: number | null = null
  let syncTimerImmediate = false

  function clearScheduledSync(): void {
    if (syncTimer === null) {
      return
    }

    scheduler.clearTimeout(syncTimer)
    syncTimer = null
    syncTimerImmediate = false
  }

  function shouldSchedule(snapshot: AppData): boolean {
    if (
      snapshot.sync.mode === 'local' ||
      !snapshot.sync.autoSync ||
      !isOnline() ||
      warnSyncConfigLocalSaved(snapshot) ||
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
    if (!shouldSchedule(snapshot)) {
      return
    }

    const immediate = delayMs <= 0

    if (syncTimer !== null) {
      if (syncTimerImmediate && !immediate) {
        return
      }

      scheduler.clearTimeout(syncTimer)
      syncTimer = null
      syncTimerImmediate = false
    }

    syncTimerImmediate = immediate
    syncTimer = scheduler.setTimeout(() => {
      syncTimer = null
      syncTimerImmediate = false

      const latest = dataRef.current ?? snapshot

      if (!shouldSchedule(latest)) {
        return
      }

      runDetachedAutoSync(runSync, latest, { silent: true }, onDetachedSyncError)
    }, delayMs)
  }

  return {
    clearScheduledSync,
    dispose: clearScheduledSync,
    scheduleAutoSync,
  }
}

export function useAutoSyncController({
  activeSyncPassphraseRevision,
  data,
  dataRef,
  getSyncCredentials,
  githubTokenValue,
  isOnlineRef,
  onDetachedSyncError,
  runSync,
  warnSyncConfigLocalSaved,
}: AutoSyncControllerOptions): Pick<
  AutoSyncQueue,
  'clearScheduledSync' | 'scheduleAutoSync'
> {
  const getSyncCredentialsRef = useRef(getSyncCredentials)
  const onDetachedSyncErrorRef = useRef(onDetachedSyncError)
  const runSyncRef = useRef(runSync)
  const warnSyncConfigLocalSavedRef = useRef(warnSyncConfigLocalSaved)
  const autoSyncQueueRef = useRef<AutoSyncQueue | null>(null)

  useEffect(() => {
    getSyncCredentialsRef.current = getSyncCredentials
    onDetachedSyncErrorRef.current = onDetachedSyncError
    runSyncRef.current = runSync
    warnSyncConfigLocalSavedRef.current = warnSyncConfigLocalSaved
  }, [getSyncCredentials, onDetachedSyncError, runSync, warnSyncConfigLocalSaved])

  useEffect(() => {
    const autoSyncQueue = createAutoSyncQueue({
      dataRef,
      isOnline: () => isOnlineRef.current,
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
    if (!data) {
      return
    }

    if (hasStreamingMessage(data)) {
      clearScheduledSync()
      return
    }

    scheduleAutoSync(data)
  }, [
    clearScheduledSync,
    data,
    githubTokenValue,
    scheduleAutoSync,
    activeSyncPassphraseRevision,
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
    activeSyncPassphraseRevision,
  ])

  return {
    clearScheduledSync,
    scheduleAutoSync,
  }
}
