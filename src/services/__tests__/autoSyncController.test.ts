import { describe, expect, it, vi } from 'vitest'

import type { AppData } from '../../types'
import {
  REMOTE_PULL_INTERVAL_MS,
  REMOTE_PULL_STARTUP_DELAY_MS,
  canRunAutomaticRemotePull,
  createAutoSyncQueue,
  installAutomaticRemotePull,
  installAutomaticRemotePullListeners,
  type AutomaticRemotePullRuntime,
  type AutoSyncScheduler,
} from '../autoSyncController'

function snapshot(
  id: string,
  patch: Partial<AppData> = {},
  syncPatch: Partial<AppData['sync']> = {},
): AppData {
  return {
    version: 1,
    providers: [],
    conversations: [],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    sync: {
      autoSync: true,
      encryptionEnabled: true,
      lastSyncAt: 1,
      mode: 'cloudflare',
      workerEndpoint: 'https://zerochat.example.workers.dev',
      ...syncPatch,
    },
    preferences: {
      activeConversationId: id,
      compactMode: false,
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    updatedAt: 2,
    ...patch,
  } as AppData & { id: string }
}

function createManualScheduler(): {
  activeTimerCount: () => number
  runNextTimer: () => void
  scheduler: AutoSyncScheduler
} {
  let nextTimerId = 1
  const timers = new Map<number, () => void>()
  const scheduler: AutoSyncScheduler = {
    clearTimeout: (timer) => {
      timers.delete(timer)
    },
    setTimeout: (callback) => {
      const id = nextTimerId
      nextTimerId += 1
      timers.set(id, callback)
      return id
    },
  }

  return {
    activeTimerCount: () => timers.size,
    runNextTimer: () => {
      const [id, callback] = timers.entries().next().value ?? []

      if (id === undefined || !callback) {
        return
      }

      timers.delete(id)
      callback()
    },
    scheduler,
  }
}

function createAutomaticRemotePullRuntime(): {
  clearInterval: ReturnType<typeof vi.fn>
  clearTimeout: ReturnType<typeof vi.fn>
  emitWindow: (type: 'focus' | 'online') => void
  runInterval: () => void
  runStartup: () => void
  runtime: AutomaticRemotePullRuntime
  setVisibility: (state: DocumentVisibilityState) => void
} {
  const windowListeners = new Map<string, () => void>()
  const documentListeners = new Map<string, () => void>()
  let intervalCallback: (() => void) | undefined
  let startupCallback: (() => void) | undefined
  let visibilityState: DocumentVisibilityState = 'visible'
  const clearInterval = vi.fn()
  const clearTimeout = vi.fn()
  const windowTarget = {
    addEventListener: vi.fn((type: string, listener: () => void) => {
      windowListeners.set(type, listener)
    }),
    clearInterval,
    clearTimeout,
    removeEventListener: vi.fn((type: string) => {
      windowListeners.delete(type)
    }),
    setInterval: vi.fn((callback: () => void) => {
      intervalCallback = callback
      return 52
    }),
    setTimeout: vi.fn((callback: () => void) => {
      startupCallback = callback
      return 51
    }),
  } as unknown as AutomaticRemotePullRuntime['windowTarget']
  const documentTarget = {
    addEventListener: vi.fn((type: string, listener: () => void) => {
      documentListeners.set(type, listener)
    }),
    get visibilityState() {
      return visibilityState
    },
    removeEventListener: vi.fn((type: string) => {
      documentListeners.delete(type)
    }),
  } as unknown as AutomaticRemotePullRuntime['documentTarget']

  return {
    clearInterval,
    clearTimeout,
    emitWindow: (type) => windowListeners.get(type)?.(),
    runInterval: () => intervalCallback?.(),
    runStartup: () => startupCallback?.(),
    runtime: { documentTarget, windowTarget },
    setVisibility: (state) => {
      visibilityState = state
      documentListeners.get('visibilitychange')?.()
    },
  }
}

describe('createAutoSyncQueue', () => {
  it('keeps an immediate cloud sync stronger than a later debounced request', () => {
    const manualScheduler = createManualScheduler()
    const immediate = snapshot('immediate')
    const latest = snapshot('latest', { updatedAt: 3 })
    const dataRef = { current: immediate }
    const runSync = vi.fn()
    const queue = createAutoSyncQueue({
      dataRef,
      isOnline: () => true,
      onDetachedSyncError: vi.fn(),
      runSync,
      scheduler: manualScheduler.scheduler,
      warnSyncConfigLocalSaved: () => false,
    })

    queue.scheduleAutoSync(immediate, 0)
    dataRef.current = latest
    queue.scheduleAutoSync(latest)

    expect(manualScheduler.activeTimerCount()).toBe(1)

    manualScheduler.runNextTimer()

    expect(runSync).toHaveBeenCalledTimes(1)
    expect(runSync).toHaveBeenCalledWith(latest, { silent: true })
  })

  it('lets an immediate request replace a pending debounce', () => {
    const manualScheduler = createManualScheduler()
    const debounced = snapshot('debounced')
    const immediate = snapshot('immediate', { updatedAt: 4 })
    const dataRef = { current: debounced }
    const runSync = vi.fn()
    const queue = createAutoSyncQueue({
      dataRef,
      isOnline: () => true,
      onDetachedSyncError: vi.fn(),
      runSync,
      scheduler: manualScheduler.scheduler,
      warnSyncConfigLocalSaved: () => false,
    })

    queue.scheduleAutoSync(debounced)
    dataRef.current = immediate
    queue.scheduleAutoSync(immediate, 0)

    expect(manualScheduler.activeTimerCount()).toBe(1)

    manualScheduler.runNextTimer()

    expect(runSync).toHaveBeenCalledTimes(1)
    expect(runSync).toHaveBeenCalledWith(immediate, { silent: true })
  })

  it('does not schedule local, offline, unchanged, invalid, or pending-generation snapshots', () => {
    const manualScheduler = createManualScheduler()
    const runSync = vi.fn()
    const warnSyncConfigLocalSaved = vi.fn((value: AppData) =>
      value.sync.mode === 'gist',
    )
    const dataRef = { current: snapshot('current') }
    const queue = createAutoSyncQueue({
      dataRef,
      isOnline: () => true,
      onDetachedSyncError: vi.fn(),
      runSync,
      scheduler: manualScheduler.scheduler,
      warnSyncConfigLocalSaved,
    })

    queue.scheduleAutoSync(snapshot('local', {}, { mode: 'local' }))
    queue.scheduleAutoSync(snapshot('manual-only', {}, { autoSync: false }))
    queue.scheduleAutoSync(snapshot('unchanged', { updatedAt: 1 }))
    queue.scheduleAutoSync(snapshot('missing-config', {}, { mode: 'gist' }))
    queue.scheduleAutoSync(
      snapshot('queued', {
        conversations: [
          {
            createdAt: 1,
            id: 'conversation-queued',
            messages: [
              {
                content: '',
                createdAt: 1,
                id: 'assistant-queued',
                role: 'assistant',
                status: 'queued',
              },
            ],
            model: 'gpt-5',
            providerId: 'provider',
            title: 'Queued',
            updatedAt: 1,
          },
        ],
      }),
    )

    expect(manualScheduler.activeTimerCount()).toBe(0)
    expect(runSync).not.toHaveBeenCalled()
    expect(warnSyncConfigLocalSaved).toHaveBeenCalledTimes(3)
  })

  it('respects the autoSync toggle for automatic uploads and foreground pulls', () => {
    const manualScheduler = createManualScheduler()
    const runSync = vi.fn()
    const dataRef = { current: snapshot('manual-only') }
    const queue = createAutoSyncQueue({
      dataRef,
      isOnline: () => true,
      onDetachedSyncError: vi.fn(),
      runSync,
      scheduler: manualScheduler.scheduler,
      warnSyncConfigLocalSaved: () => false,
    })
    const credentials = {
      githubTokenValue: 'token',
      syncPassphraseValue: 'passphrase',
    }

    queue.scheduleAutoSync(snapshot('manual-only', {}, { autoSync: false }), 0)

    expect(manualScheduler.activeTimerCount()).toBe(0)
    expect(runSync).not.toHaveBeenCalled()
    expect(
      canRunAutomaticRemotePull(
        snapshot('manual-only', {}, { autoSync: false }).sync,
        credentials,
      ),
    ).toBe(false)
    expect(
      canRunAutomaticRemotePull(snapshot('cloud-auto').sync, credentials),
    ).toBe(true)
    expect(
      canRunAutomaticRemotePull(
        snapshot('gist-without-id', {}, { mode: 'gist' }).sync,
        credentials,
      ),
    ).toBe(false)
    expect(
      canRunAutomaticRemotePull(
        snapshot('gist-with-id', {}, { gistId: 'gist-1', mode: 'gist' }).sync,
        credentials,
      ),
    ).toBe(true)
  })

  it('reports synchronous automatic sync runner failures without leaking the timer', () => {
    const manualScheduler = createManualScheduler()
    const failure = new Error('sync exploded')
    const onDetachedSyncError = vi.fn()
    const runSync = vi.fn(() => {
      throw failure
    })
    const queue = createAutoSyncQueue({
      dataRef: { current: snapshot('current') },
      isOnline: () => true,
      onDetachedSyncError,
      runSync,
      scheduler: manualScheduler.scheduler,
      warnSyncConfigLocalSaved: () => false,
    })

    queue.scheduleAutoSync(snapshot('current'), 0)

    expect(() => manualScheduler.runNextTimer()).not.toThrow()
    expect(runSync).toHaveBeenCalledTimes(1)
    expect(onDetachedSyncError).toHaveBeenCalledWith(failure)
  })

  it('reports rejected automatic sync runner promises without leaking the timer', async () => {
    const manualScheduler = createManualScheduler()
    const failure = new Error('sync rejected')
    const onDetachedSyncError = vi.fn()
    const runSync = vi.fn(() => Promise.reject(failure))
    const queue = createAutoSyncQueue({
      dataRef: { current: snapshot('current') },
      isOnline: () => true,
      onDetachedSyncError,
      runSync,
      scheduler: manualScheduler.scheduler,
      warnSyncConfigLocalSaved: () => false,
    })

    queue.scheduleAutoSync(snapshot('current'), 0)
    manualScheduler.runNextTimer()
    await Promise.resolve()

    expect(runSync).toHaveBeenCalledTimes(1)
    expect(onDetachedSyncError).toHaveBeenCalledWith(failure)
  })

  it('clears a pending timer on dispose without syncing stale data', () => {
    const manualScheduler = createManualScheduler()
    const queue = createAutoSyncQueue({
      dataRef: { current: snapshot('pending') },
      isOnline: () => true,
      onDetachedSyncError: vi.fn(),
      runSync: vi.fn(),
      scheduler: manualScheduler.scheduler,
      warnSyncConfigLocalSaved: () => false,
    })

    queue.scheduleAutoSync(snapshot('pending'))
    expect(manualScheduler.activeTimerCount()).toBe(1)

    queue.dispose()
    manualScheduler.runNextTimer()

    expect(manualScheduler.activeTimerCount()).toBe(0)
  })
})

describe('installAutomaticRemotePullListeners', () => {
  it('contains foreground pull listener installation failures', () => {
    const failure = new Error('listener blocked')
    const pullLatest = vi.fn()
    const pullWhenVisible = vi.fn()
    const windowTarget = {
      addEventListener: vi.fn((type: string) => {
        if (type === 'online') {
          throw failure
        }
      }),
      removeEventListener: vi.fn(),
    }
    const documentTarget = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    const cleanup = installAutomaticRemotePullListeners(
      windowTarget,
      documentTarget,
      pullLatest,
      pullWhenVisible,
    )

    expect(cleanup).toEqual(expect.any(Function))
    expect(() => cleanup()).not.toThrow()
    expect(windowTarget.removeEventListener).toHaveBeenCalledWith(
      'focus',
      pullLatest,
    )
    expect(documentTarget.addEventListener).not.toHaveBeenCalled()
  })

  it('contains listener removal failures during cleanup', () => {
    const windowTarget = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(() => {
        throw new Error('window listener removal blocked')
      }),
    }
    const documentTarget = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(() => {
        throw new Error('document listener removal blocked')
      }),
    }
    const cleanup = installAutomaticRemotePullListeners(
      windowTarget,
      documentTarget,
      vi.fn(),
      vi.fn(),
    )

    expect(() => cleanup()).not.toThrow()
    expect(windowTarget.removeEventListener).toHaveBeenCalledTimes(2)
    expect(documentTarget.removeEventListener).toHaveBeenCalledTimes(1)
  })
})

describe('installAutomaticRemotePull', () => {
  it('routes clean, dirty, invisible, disabled, and disposed pulls', () => {
    const remoteRuntime = createAutomaticRemotePullRuntime()
    const clean = snapshot('clean', { updatedAt: 1 })
    const dataRef: { current: AppData | null } = { current: clean }
    let credentials = {
      githubTokenValue: 'token',
      syncPassphraseValue: 'passphrase',
    }
    const onDetachedSyncError = vi.fn()
    const runSync = vi.fn()
    const scheduleAutoSync = vi.fn()
    const cleanup = installAutomaticRemotePull({
      dataRef,
      getSyncCredentials: () => credentials,
      onDetachedSyncError,
      runSync,
      runtime: remoteRuntime.runtime,
      scheduleAutoSync,
    })
    const { windowTarget } = remoteRuntime.runtime

    expect(windowTarget.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      REMOTE_PULL_STARTUP_DELAY_MS,
    )
    expect(windowTarget.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      REMOTE_PULL_INTERVAL_MS,
    )

    remoteRuntime.runStartup()
    expect(runSync).toHaveBeenCalledWith(clean, {
      pullOnly: true,
      silent: true,
    })

    const dirty = snapshot('dirty', { updatedAt: 3 })
    dataRef.current = dirty
    remoteRuntime.emitWindow('focus')
    expect(scheduleAutoSync).toHaveBeenCalledWith(dirty)
    expect(runSync).toHaveBeenCalledTimes(1)

    dataRef.current = snapshot('disabled', { updatedAt: 1 }, {
      autoSync: false,
    })
    remoteRuntime.emitWindow('online')
    expect(runSync).toHaveBeenCalledTimes(1)

    dataRef.current = clean
    credentials = {
      githubTokenValue: '',
      syncPassphraseValue: '',
    }
    remoteRuntime.emitWindow('online')
    expect(runSync).toHaveBeenCalledTimes(1)

    credentials = {
      githubTokenValue: 'token',
      syncPassphraseValue: 'passphrase',
    }
    remoteRuntime.setVisibility('hidden')
    remoteRuntime.runInterval()
    expect(runSync).toHaveBeenCalledTimes(1)

    remoteRuntime.setVisibility('visible')
    expect(runSync).toHaveBeenCalledTimes(2)

    cleanup()
    expect(remoteRuntime.clearTimeout).toHaveBeenCalledWith(51)
    expect(remoteRuntime.clearInterval).toHaveBeenCalledWith(52)
    remoteRuntime.runStartup()
    remoteRuntime.runInterval()
    expect(runSync).toHaveBeenCalledTimes(2)
    expect(onDetachedSyncError).not.toHaveBeenCalled()
  })

  it('does not install pull work without an eligible initial snapshot', () => {
    const noDataRuntime = createAutomaticRemotePullRuntime()
    const cleanupNoData = installAutomaticRemotePull({
      dataRef: { current: null },
      getSyncCredentials: () => ({
        githubTokenValue: 'token',
        syncPassphraseValue: 'passphrase',
      }),
      onDetachedSyncError: vi.fn(),
      runSync: vi.fn(),
      runtime: noDataRuntime.runtime,
      scheduleAutoSync: vi.fn(),
    })
    const disabledRuntime = createAutomaticRemotePullRuntime()
    const cleanupDisabled = installAutomaticRemotePull({
      dataRef: {
        current: snapshot('disabled', {}, { autoSync: false }),
      },
      getSyncCredentials: () => ({
        githubTokenValue: 'token',
        syncPassphraseValue: 'passphrase',
      }),
      onDetachedSyncError: vi.fn(),
      runSync: vi.fn(),
      runtime: disabledRuntime.runtime,
      scheduleAutoSync: vi.fn(),
    })

    expect(() => cleanupNoData()).not.toThrow()
    expect(() => cleanupDisabled()).not.toThrow()
    expect(noDataRuntime.runtime.windowTarget.setTimeout).not.toHaveBeenCalled()
    expect(disabledRuntime.runtime.windowTarget.setTimeout).not.toHaveBeenCalled()
  })
})
