import { describe, expect, it, vi } from 'vitest'

import {
  createManagedProxyHostController,
  managedProxyHostScheduleState,
  runManagedProxyHostReplacement,
  type ManagedProxyHostScheduler,
} from '../managedProxyHostController'
import type { ManagedProxyHostGroup } from '../providerConfig'
import type { AppData } from '../../types'

function group(
  token: string,
  baseUrls = ['https://relay.example/v1'],
  endpoint = 'https://sync.example.workers.dev',
): ManagedProxyHostGroup {
  return {
    baseUrls,
    endpoint,
    token,
  }
}

function snapshot(id: string): AppData {
  return { id } as unknown as AppData
}

function managedSnapshot(): AppData {
  return {
    providers: [
      {
        baseUrl: 'https://relay.example/v1',
        clientRequestMode: false,
        enabled: true,
        proxyUrl: 'https://sync.example.workers.dev',
      },
    ],
    sync: {
      mode: 'cloudflare',
      workerEndpoint: 'https://sync.example.workers.dev',
    },
  } as AppData
}

function createManualScheduler(): {
  activeTimerCount: () => number
  runNextTimer: () => void
  scheduler: ManagedProxyHostScheduler
} {
  let nextTimerId = 1
  const timers = new Map<number, () => void>()
  const scheduler: ManagedProxyHostScheduler = {
    clearTimeout: (timer) => {
      timers.delete(Number(timer))
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

describe('managed proxy host scheduling state', () => {
  it('derives host presence without storing the active passphrase or access key', () => {
    expect(managedProxyHostScheduleState(managedSnapshot(), false)).toEqual({
      hasCurrentGroups: false,
      signature: '[]',
    })
    expect(managedProxyHostScheduleState(managedSnapshot(), true)).toEqual({
      hasCurrentGroups: true,
      signature:
        '[["https://sync.example.workers.dev","token",["https://relay.example/v1"]]]',
    })
  })
})

describe('createManagedProxyHostController', () => {
  it('skips scheduling when no managed hosts exist locally or remotely', () => {
    const manualScheduler = createManualScheduler()
    const replaceHosts = vi.fn()
    const controller = createManagedProxyHostController({
      getAccessKey: () => Promise.resolve('access-key'),
      getSnapshot: () => null,
      replaceHosts,
      scheduler: manualScheduler.scheduler,
    })

    controller.scheduleManagedProxyHostSync(false)

    expect(manualScheduler.activeTimerCount()).toBe(0)
    expect(replaceHosts).not.toHaveBeenCalled()
  })

  it('debounces host replacement to the latest snapshot and access key', async () => {
    const manualScheduler = createManualScheduler()
    const replaceHosts = vi.fn<() => Promise<void>>(() => Promise.resolve())
    let currentSnapshot = snapshot('first')
    let currentAccessKey = 'old-key'
    const controller = createManagedProxyHostController({
      deriveGroups: (value, accessKey) =>
        value
          ? [
              group(accessKey, [
                `https://${(value as unknown as { id: string }).id}.example/v1`,
              ]),
            ]
          : [],
      getAccessKey: () => Promise.resolve(currentAccessKey),
      getSnapshot: () => currentSnapshot,
      replaceHosts,
      scheduler: manualScheduler.scheduler,
    })

    controller.scheduleManagedProxyHostSync(true)
    currentSnapshot = snapshot('latest')
    currentAccessKey = 'new-key'
    controller.scheduleManagedProxyHostSync(true)

    expect(manualScheduler.activeTimerCount()).toBe(1)

    manualScheduler.runNextTimer()
    await vi.waitFor(() => expect(replaceHosts).toHaveBeenCalledTimes(1))

    expect(replaceHosts).toHaveBeenCalledWith(
      [group('new-key', ['https://latest.example/v1'])],
      [],
    )
  })

  it('clears previously managed hosts when the latest snapshot no longer needs them', async () => {
    const manualScheduler = createManualScheduler()
    const replaceHosts = vi.fn<() => Promise<void>>(() => Promise.resolve())
    let currentSnapshot: AppData | null = snapshot('first')
    const controller = createManagedProxyHostController({
      deriveGroups: (value, accessKey) => (value ? [group(accessKey)] : []),
      getAccessKey: () => Promise.resolve('access-key'),
      getSnapshot: () => currentSnapshot,
      replaceHosts,
      scheduler: manualScheduler.scheduler,
    })

    controller.scheduleManagedProxyHostSync(true)
    manualScheduler.runNextTimer()
    await vi.waitFor(() => expect(replaceHosts).toHaveBeenCalledTimes(1))

    currentSnapshot = null
    controller.scheduleManagedProxyHostSync(false)
    manualScheduler.runNextTimer()
    await vi.waitFor(() => expect(replaceHosts).toHaveBeenCalledTimes(2))

    expect(replaceHosts).toHaveBeenLastCalledWith([], [group('access-key')])
  })

  it('preserves remembered remote hosts across recreated controllers', async () => {
    const manualScheduler = createManualScheduler()
    const replaceHosts = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const previousGroupsRef = { current: [] as ManagedProxyHostGroup[] }
    let currentSnapshot: AppData | null = snapshot('first')
    const createController = () =>
      createManagedProxyHostController({
        deriveGroups: (value, accessKey) => (value ? [group(accessKey)] : []),
        getAccessKey: () => Promise.resolve('access-key'),
        getSnapshot: () => currentSnapshot,
        previousGroupsRef,
        replaceHosts,
        scheduler: manualScheduler.scheduler,
      })

    const firstController = createController()
    firstController.scheduleManagedProxyHostSync(true)
    manualScheduler.runNextTimer()
    await vi.waitFor(() => expect(replaceHosts).toHaveBeenCalledTimes(1))
    expect(previousGroupsRef.current).toEqual([group('access-key')])

    firstController.dispose()
    currentSnapshot = null
    const recreatedController = createController()
    recreatedController.scheduleManagedProxyHostSync(false)
    manualScheduler.runNextTimer()
    await vi.waitFor(() => expect(replaceHosts).toHaveBeenCalledTimes(2))

    expect(replaceHosts).toHaveBeenLastCalledWith([], [group('access-key')])
    expect(previousGroupsRef.current).toEqual([])
  })

  it('keeps token rotation eligible for the same managed host list', async () => {
    const manualScheduler = createManualScheduler()
    const replaceHosts = vi.fn<() => Promise<void>>(() => Promise.resolve())
    let currentAccessKey = 'old-key'
    const controller = createManagedProxyHostController({
      deriveGroups: (_value, accessKey) => [group(accessKey)],
      getAccessKey: () => Promise.resolve(currentAccessKey),
      getSnapshot: () => snapshot('same-hosts'),
      replaceHosts,
      scheduler: manualScheduler.scheduler,
    })

    controller.scheduleManagedProxyHostSync(true)
    manualScheduler.runNextTimer()
    await vi.waitFor(() => expect(replaceHosts).toHaveBeenCalledTimes(1))

    currentAccessKey = 'new-key'
    controller.scheduleManagedProxyHostSync(true)
    manualScheduler.runNextTimer()
    await vi.waitFor(() => expect(replaceHosts).toHaveBeenCalledTimes(2))

    expect(replaceHosts).toHaveBeenLastCalledWith(
      [group('new-key')],
      [group('old-key')],
    )
  })

  it('reports host replacement failures without advancing the remembered remote state', async () => {
    const manualScheduler = createManualScheduler()
    const onError = vi.fn()
    const replaceHosts = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('worker offline'))
      .mockResolvedValueOnce(undefined)
    const controller = createManagedProxyHostController({
      deriveGroups: () => [group('access-key')],
      getAccessKey: () => Promise.resolve('access-key'),
      getSnapshot: () => snapshot('failed-first'),
      onError,
      replaceHosts,
      scheduler: manualScheduler.scheduler,
    })

    controller.scheduleManagedProxyHostSync(true)
    manualScheduler.runNextTimer()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))

    controller.scheduleManagedProxyHostSync(true)
    manualScheduler.runNextTimer()
    await vi.waitFor(() => expect(replaceHosts).toHaveBeenCalledTimes(2))

    expect(replaceHosts).toHaveBeenNthCalledWith(1, [group('access-key')], [])
    expect(replaceHosts).toHaveBeenNthCalledWith(2, [group('access-key')], [])
  })

  it('contains managed proxy host failure reporter failures', async () => {
    const onError = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })
    const replaceHosts = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('worker offline'))
    const rememberedGroupsRef = { current: [] as ManagedProxyHostGroup[] }

    await expect(
      runManagedProxyHostReplacement({
        deriveGroups: () => [group('access-key')],
        getAccessKey: () => Promise.resolve('access-key'),
        getSnapshot: () => snapshot('failed-first'),
        onError,
        rememberedGroupsRef,
        replaceHosts,
      }),
    ).resolves.toBeUndefined()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(rememberedGroupsRef.current).toEqual([])
  })

  it('disposes pending host replacement timers', () => {
    const manualScheduler = createManualScheduler()
    const replaceHosts = vi.fn()
    const controller = createManagedProxyHostController({
      getAccessKey: () => Promise.resolve('access-key'),
      getSnapshot: () => snapshot('pending'),
      replaceHosts,
      scheduler: manualScheduler.scheduler,
    })

    controller.scheduleManagedProxyHostSync(true)
    expect(manualScheduler.activeTimerCount()).toBe(1)

    controller.dispose()
    manualScheduler.runNextTimer()

    expect(manualScheduler.activeTimerCount()).toBe(0)
    expect(replaceHosts).not.toHaveBeenCalled()
  })
})
