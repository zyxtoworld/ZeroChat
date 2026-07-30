import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerTimeoutSignal } from '../providerTimeoutSignal'

describe('provider timeout signal', () => {
  afterEach(() => {
    vi.useRealTimers()
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
