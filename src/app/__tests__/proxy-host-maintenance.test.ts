import { describe, expect, it, vi } from 'vitest'

import {
  createProxyHostMaintenanceQueue,
  maintainProxyHosts,
  type ProxyHostMaintenanceScheduler,
} from '../../services/proxyHostMaintenanceQueue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function schedulerHarness() {
  let callback: (() => void | Promise<void>) | null = null
  const scheduler: ProxyHostMaintenanceScheduler = {
    clearTimeout: vi.fn(() => {
      callback = null
    }),
    setTimeout: vi.fn((next) => {
      callback = next
      return 1
    }),
  }
  return {
    scheduler,
    run: async () => {
      const next = callback
      callback = null
      await next?.()
    },
  }
}

describe('proxy host maintenance', () => {
  it('contains clearTimeout failures and rearms the latest timer owner', async () => {
    const callbacks = new Map<number, () => void | Promise<void>>()
    let nextHandle = 1
    let input = 'latest'
    const clearError = new Error('clear failed')
    const onError = vi.fn(() => {
      throw new Error('notice channel failed')
    })
    const maintain = vi.fn(async (value: string) => [value])
    const scheduler: ProxyHostMaintenanceScheduler = {
      clearTimeout: vi.fn(() => {
        throw clearError
      }),
      setTimeout: vi.fn((callback) => {
        const handle = nextHandle
        nextHandle += 1
        callbacks.set(handle, callback)
        return handle
      }),
    }
    const queue = createProxyHostMaintenanceQueue<string>({
      getInput: () => input,
      maintain,
      onError,
      scheduler,
    })

    queue.schedule()
    expect(() => queue.schedule()).not.toThrow()
    expect(onError).toHaveBeenCalledWith(clearError)
    expect(scheduler.setTimeout).toHaveBeenCalledTimes(2)

    await callbacks.get(1)?.()
    expect(maintain).not.toHaveBeenCalled()
    await callbacks.get(2)?.()

    expect(maintain).toHaveBeenCalledOnce()
    expect(maintain).toHaveBeenCalledWith('latest', [], expect.any(AbortSignal))

    input = 'disposed'
    expect(() => queue.dispose()).not.toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('contains setTimeout failures without leaving a requested run stranded', () => {
    const setError = new Error('set failed')
    const onError = vi.fn(() => {
      throw new Error('notice channel failed')
    })
    const scheduler: ProxyHostMaintenanceScheduler = {
      clearTimeout: vi.fn(),
      setTimeout: vi.fn(() => {
        throw setError
      }),
    }
    const queue = createProxyHostMaintenanceQueue<string>({
      getInput: () => 'value',
      maintain: vi.fn(async () => ['value']),
      onError,
      scheduler,
    })

    expect(() => queue.schedule()).not.toThrow()
    expect(() => queue.schedule()).not.toThrow()
    expect(onError).toHaveBeenCalledWith(setError)
    expect(onError).toHaveBeenCalledTimes(2)
    expect(scheduler.setTimeout).toHaveBeenCalledTimes(2)
    expect(() => queue.dispose()).not.toThrow()
  })

  it('clears a timer handle returned after a synchronous callback', async () => {
    const release = deferred()
    const clearTimeout = vi.fn()
    const setTimeout = vi.fn((callback: () => void | Promise<void>) => {
      void callback()
      return 42
    })
    const maintain = vi.fn(async () => {
      await release.promise
      return ['value']
    })
    const queue = createProxyHostMaintenanceQueue<string>({
      getInput: () => 'value',
      maintain,
      onError: vi.fn(),
      scheduler: { clearTimeout, setTimeout },
    })

    queue.schedule()
    expect(maintain).toHaveBeenCalledOnce()
    expect(clearTimeout).toHaveBeenCalledWith(42)

    release.resolve()
    await Promise.resolve()
    await Promise.resolve()
    queue.dispose()
  })

  it('debounces to the latest input and publishes remembered groups only after success', async () => {
    const timers = schedulerHarness()
    let input = 'first'
    const calls: Array<{ input: string; previous: string[] }> = []
    const queue = createProxyHostMaintenanceQueue<string>({
      getInput: () => input,
      maintain: async (value, previous) => {
        calls.push({ input: value, previous })
        return [value]
      },
      onError: vi.fn(),
      scheduler: timers.scheduler,
    })

    queue.schedule()
    input = 'latest'
    queue.schedule()
    await timers.run()

    expect(calls).toEqual([{ input: 'latest', previous: [] }])

    input = 'next'
    queue.schedule()
    await timers.run()
    expect(calls[1]).toEqual({ input: 'next', previous: ['latest'] })
  })

  it('retains the last successful groups after failure and contains reporter failures', async () => {
    const timers = schedulerHarness()
    let input = 'good'
    const previousValues: string[][] = []
    const queue = createProxyHostMaintenanceQueue<string>({
      getInput: () => input,
      maintain: vi.fn(async (value, previous) => {
        previousValues.push(previous)
        if (value === 'bad') throw new Error('secret-shaped failure')
        return [value]
      }),
      onError: () => {
        throw new Error('notice channel failed')
      },
      scheduler: timers.scheduler,
    })

    queue.schedule()
    await timers.run()
    input = 'bad'
    queue.schedule()
    await expect(timers.run()).resolves.toBeUndefined()
    input = 'recovered'
    queue.schedule()
    await timers.run()

    expect(previousValues).toEqual([[], ['good'], ['good']])
  })

  it('keeps remembered groups across queue recreation through one stable owner ref', async () => {
    const previousGroupsRef = { current: [] as string[] }
    const firstTimers = schedulerHarness()
    const firstQueue = createProxyHostMaintenanceQueue<string>({
      getInput: () => 'first',
      maintain: async (value) => [value],
      onError: vi.fn(),
      previousGroupsRef,
      scheduler: firstTimers.scheduler,
    })
    firstQueue.schedule()
    await firstTimers.run()
    firstQueue.dispose()

    const secondTimers = schedulerHarness()
    const maintain = vi.fn(async (value: string) => [value])
    const secondQueue = createProxyHostMaintenanceQueue<string>({
      getInput: () => 'second',
      maintain,
      onError: vi.fn(),
      previousGroupsRef,
      scheduler: secondTimers.scheduler,
    })
    secondQueue.schedule()
    await secondTimers.run()

    expect(maintain).toHaveBeenCalledWith(
      'second',
      ['first'],
      expect.any(AbortSignal),
    )
  })

  it('serializes an in-flight replacement and drains the latest queued input', async () => {
    const timers = schedulerHarness()
    const first = deferred()
    let input = 'first'
    let active = 0
    let maxActive = 0
    const calls: string[] = []
    const queue = createProxyHostMaintenanceQueue<string>({
      getInput: () => input,
      maintain: async (value) => {
        calls.push(value)
        active += 1
        maxActive = Math.max(maxActive, active)
        if (value === 'first') await first.promise
        active -= 1
        return [value]
      },
      onError: vi.fn(),
      scheduler: timers.scheduler,
    })

    queue.schedule()
    const running = timers.run()
    await vi.waitFor(() => expect(calls).toEqual(['first']))
    input = 'second'
    queue.schedule()
    input = 'latest'
    queue.schedule()
    first.resolve()
    await running

    expect(calls).toEqual(['first', 'latest'])
    expect(maxActive).toBe(1)
  })

  it('aborts in-flight work when a newer maintenance input is scheduled', async () => {
    const timers = schedulerHarness()
    const first = deferred()
    let input = 'first'
    const calls: Array<{
      input: string
      previous: string[]
      signal: AbortSignal
    }> = []
    const queue = createProxyHostMaintenanceQueue<string>({
      getInput: () => input,
      maintain: async (value, previous, signal) => {
        calls.push({ input: value, previous, signal })
        if (value === 'first') await first.promise
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
        return [value]
      },
      onError: vi.fn(),
      scheduler: timers.scheduler,
    })

    queue.schedule()
    const running = timers.run()
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    input = 'latest'
    queue.schedule()

    expect(calls[0]?.signal.aborted).toBe(true)
    first.resolve()
    await running

    expect(calls.map((call) => call.input)).toEqual(['first', 'latest'])
    expect(calls[1]?.previous).toEqual([])
  })

  it('carries a remotely completed cancelled replacement into the latest cleanup', async () => {
    const timers = schedulerHarness()
    let input = 'first'
    const remoteGroups = new Set<string>()

    const queue = createProxyHostMaintenanceQueue<string>({
      getInput: () => input,
      maintain: async (value, previous, signal) => {
        for (const previousValue of previous) {
          remoteGroups.delete(previousValue)
        }
        remoteGroups.add(value)

        if (value === 'first') {
          input = 'latest'
          queue.schedule()
          await Promise.resolve()
          expect(signal.aborted).toBe(true)
        }

        return [value]
      },
      onError: vi.fn(),
      scheduler: timers.scheduler,
    })

    queue.schedule()
    await timers.run()

    expect([...remoteGroups]).toEqual(['latest'])
  })

  it('cancels scheduled and in-flight work on disposal', async () => {
    const timers = schedulerHarness()
    let aborted = false
    const previousGroupsRef = { current: [] as string[] }
    const queue = createProxyHostMaintenanceQueue<string>({
      getInput: () => 'value',
      maintain: async (_value, _previous, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              resolve()
            },
            { once: true },
          )
        })
        return ['value']
      },
      onError: vi.fn(),
      previousGroupsRef,
      scheduler: timers.scheduler,
    })

    queue.schedule()
    const running = timers.run()
    queue.dispose()
    await running

    expect(aborted).toBe(true)
    expect(previousGroupsRef.current).toEqual([])
  })

  it('clears remembered remote groups when the sync passphrase is removed', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await maintainProxyHosts(
      { data: null, passphrase: '' },
      [
        {
          endpoint: 'https://sync.example.workers.dev/zerochat',
          token: 'previous-access-key',
          baseUrls: ['https://relay.example/v1'],
        },
      ],
      new AbortController().signal,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example.workers.dev/zerochat/proxy/hosts',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'x-zerochat-access-key': 'previous-access-key',
        }),
        body: JSON.stringify({ baseUrls: [] }),
      }),
    )
  })
})
