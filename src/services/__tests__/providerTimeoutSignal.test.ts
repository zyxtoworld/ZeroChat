import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerTimeoutSignal } from '../providerTimeoutSignal'

describe('provider timeout signal', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not leave a source listener behind when timer installation fails', () => {
    const listeners = new Set<() => void>()
    const source = {
      aborted: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.add(listener)
      }),
      removeEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.delete(listener)
      }),
    } as unknown as AbortSignal
    const timerError = new Error('timer installation failed')
    vi.stubGlobal(
      'setTimeout',
      vi.fn(() => {
        throw timerError
      }),
    )

    let timeout: ReturnType<typeof providerTimeoutSignal> | undefined
    try {
      timeout = providerTimeoutSignal(source, 1000)
    } finally {
      vi.unstubAllGlobals()
    }

    expect(timeout).toBeDefined()
    expect(timeout?.signal.aborted).toBe(true)
    expect(timeout?.timedOut()).toBe(true)
    expect(source.removeEventListener).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
  })

  it('contains cleanup failures and makes dispose idempotent', () => {
    const source = new AbortController()
    const removeError = new Error('listener removal failed')
    const clearError = new Error('timer clear failed')
    vi.spyOn(source.signal, 'removeEventListener').mockImplementation(() => {
      throw removeError
    })
    vi.stubGlobal('setTimeout', vi.fn(() => 42))
    const clearTimeout = vi.fn(() => {
      throw clearError
    })
    vi.stubGlobal('clearTimeout', clearTimeout)

    const timeout = providerTimeoutSignal(source.signal, 1000)

    let firstDisposeError: unknown
    try {
      timeout.dispose()
    } catch (error: unknown) {
      firstDisposeError = error
    } finally {
      vi.unstubAllGlobals()
    }
    expect(firstDisposeError).toBeUndefined()
    expect(() => timeout.dispose()).not.toThrow()
    expect(clearTimeout).toHaveBeenCalledOnce()
    expect(source.signal.removeEventListener).toHaveBeenCalledOnce()
  })

  it('ignores a late timer callback after disposal when clearing throws', () => {
    let callback: (() => void) | undefined
    const clearError = new Error('timer clear failed')
    const clearTimeout = vi.fn(() => {
      throw clearError
    })
    vi.stubGlobal(
      'setTimeout',
      vi.fn((next: () => void) => {
        callback = next
        return 42
      }),
    )
    vi.stubGlobal('clearTimeout', clearTimeout)

    const timeout = providerTimeoutSignal(undefined, 1000)
    timeout.dispose()
    vi.unstubAllGlobals()

    callback?.()

    expect(timeout.signal.aborted).toBe(false)
    expect(timeout.timedOut()).toBe(false)
    expect(clearTimeout).toHaveBeenCalledOnce()
  })

  it('classifies and forwards source aborts', () => {
    vi.useFakeTimers()
    const source = new AbortController()
    const timeout = providerTimeoutSignal(source.signal, 1000)

    source.abort()

    expect(timeout.signal.aborted).toBe(true)
    expect(timeout.sourceAborted()).toBe(true)
    expect(timeout.timedOut()).toBe(false)
    timeout.dispose()
  })

  it('classifies timeout aborts separately from source cancellation', () => {
    vi.useFakeTimers()
    const timeout = providerTimeoutSignal(undefined, 1000)

    vi.advanceTimersByTime(1000)

    expect(timeout.signal.aborted).toBe(true)
    expect(timeout.timedOut()).toBe(true)
    expect(timeout.sourceAborted()).toBe(false)
    timeout.dispose()
  })

  it('keeps source cancellation as the cause after the timeout deadline passes', () => {
    vi.useFakeTimers()
    const source = new AbortController()
    const timeout = providerTimeoutSignal(source.signal, 1000)

    source.abort()
    vi.advanceTimersByTime(1000)

    expect(timeout.signal.aborted).toBe(true)
    expect(timeout.sourceAborted()).toBe(true)
    expect(timeout.timedOut()).toBe(false)
    timeout.dispose()
  })

  it('keeps timeout as the cause when source cancellation arrives later', () => {
    vi.useFakeTimers()
    const source = new AbortController()
    const timeout = providerTimeoutSignal(source.signal, 1000)

    vi.advanceTimersByTime(1000)
    source.abort()

    expect(timeout.signal.aborted).toBe(true)
    expect(timeout.timedOut()).toBe(true)
    expect(timeout.sourceAborted()).toBe(false)
    timeout.dispose()
  })

  it('disposes source listeners and timeout work', () => {
    vi.useFakeTimers()
    const source = new AbortController()
    const timeout = providerTimeoutSignal(source.signal, 1000)

    timeout.dispose()
    source.abort()
    vi.advanceTimersByTime(1000)

    expect(timeout.signal.aborted).toBe(false)
    expect(timeout.sourceAborted()).toBe(false)
    expect(timeout.timedOut()).toBe(false)
  })
})
