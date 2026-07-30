import { describe, expect, it, vi } from 'vitest'

import {
  reportDetachedFormattedFailure,
  reportDetachedNotice,
} from '../detachedFailureReporting'

describe('detached failure reporting', () => {
  it('preserves minimal notice argument arity through anchored calls', () => {
    const setNotice = vi.fn()

    expect(reportDetachedNotice(setNotice, () => 'clear')).toBe('clear')
    expect(reportDetachedNotice(setNotice, () => 'toned', 'warning')).toBe(
      'toned',
    )
    expect(
      reportDetachedNotice(setNotice, () => 'targeted', undefined, 'chat'),
    ).toBe('targeted')
    expect(reportDetachedNotice(
      setNotice,
      () => 'anchored',
      'error',
      'message',
      'assistant-1',
    )).toBe('anchored')

    expect(setNotice).toHaveBeenNthCalledWith(1, 'clear')
    expect(setNotice).toHaveBeenNthCalledWith(2, 'toned', 'warning')
    expect(setNotice).toHaveBeenNthCalledWith(3, 'targeted', undefined, 'chat')
    expect(setNotice).toHaveBeenNthCalledWith(
      4,
      'anchored',
      'error',
      'message',
      'assistant-1',
    )
  })

  it('contains message resolution and notice channel failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })

    expect(
      reportDetachedNotice(setNotice, () => {
        throw new Error('message unavailable')
      }),
    ).toBeNull()
    expect(setNotice).not.toHaveBeenCalled()

    expect(
      reportDetachedNotice(setNotice, () => 'visible failure', 'error', 'chat'),
    ).toBe('visible failure')
    expect(setNotice).toHaveBeenCalledTimes(1)
  })

  it('formats scoped failures through the shared containment boundary', () => {
    const setNotice = vi.fn()
    const formatErrorMessage = vi.fn(() => 'Disk unavailable')
    const error = new Error('disk')

    reportDetachedFormattedFailure(
      { formatErrorMessage, setNotice },
      error,
      'data',
    )

    expect(formatErrorMessage).toHaveBeenCalledWith(error)
    expect(setNotice).toHaveBeenCalledWith('Disk unavailable', 'error', 'data')
  })
})
