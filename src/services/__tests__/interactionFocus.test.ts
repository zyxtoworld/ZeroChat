import { describe, expect, it, vi } from 'vitest'

import {
  focusInteractionElement,
  restoreInteractionFocusTarget,
  scheduleInteractionFocus,
  scheduleInteractionFocusRetry,
  scrollInteractionElementIntoView,
  scrollInteractionElementTo,
} from '../interactionFocus'

describe('interaction focus helpers', () => {
  it('focuses interaction targets without scrolling', () => {
    const target = {
      focus: vi.fn(),
    } as unknown as HTMLElement

    expect(
      focusInteractionElement(target, {
        contains: () => true,
      }),
    ).toBe(true)

    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('skips detached interaction focus targets', () => {
    const target = {
      focus: vi.fn(),
    } as unknown as HTMLElement

    expect(
      focusInteractionElement(target, {
        contains: () => false,
      }),
    ).toBe(false)

    expect(target.focus).not.toHaveBeenCalled()
  })

  it('contains interaction focus failures', () => {
    const target = {
      focus: vi.fn(() => {
        throw new Error('focus blocked')
      }),
    } as unknown as HTMLElement

    expect(
      focusInteractionElement(target, {
        contains: () => true,
      }),
    ).toBe(false)
  })

  it('does not focus hidden or inert interaction targets', () => {
    const hiddenTarget = {
      hidden: true,
      focus: vi.fn(),
    } as unknown as HTMLElement
    expect(
      focusInteractionElement(hiddenTarget, { contains: () => true }),
    ).toBe(false)
    expect(hiddenTarget.focus).not.toHaveBeenCalled()

    const inertTarget = {
      focus: vi.fn(),
      closest: (selector: string) =>
        selector === '[inert]' ? ({} as Element) : null,
    } as unknown as HTMLElement
    expect(
      focusInteractionElement(inertTarget, { contains: () => true }),
    ).toBe(false)
    expect(inertTarget.focus).not.toHaveBeenCalled()
  })

  it('schedules interaction focus through the shared helper', () => {
    const target = {
      focus: vi.fn(),
    } as unknown as HTMLElement
    const requestFrame = vi.fn((callback: FrameRequestCallback): number => {
      callback(0)
      return 1
    })

    scheduleInteractionFocus(
      () => target,
      requestFrame,
      { contains: () => true },
    )

    expect(requestFrame).toHaveBeenCalledOnce()
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('contains a synchronous frame scheduler failure as an unsuccessful focus', async () => {
    const target = {
      focus: vi.fn(),
    } as unknown as HTMLElement

    await expect(
      scheduleInteractionFocus(
        () => target,
        () => {
          throw new Error('frame scheduler unavailable')
        },
        { contains: () => true },
      ),
    ).resolves.toBe(false)

    expect(target.focus).not.toHaveBeenCalled()
  })

  it('contains a frame callback target failure as an unsuccessful focus', async () => {
    const result = scheduleInteractionFocus(
      () => {
        throw new Error('target unavailable')
      },
      (callback) => {
        callback(0)
        return 1
      },
      { contains: () => true },
    )

    await expect(result).resolves.toBe(false)
  })

  it('contains a retry frame scheduler failure', () => {
    expect(() =>
      scheduleInteractionFocusRetry(
        () => null,
        () => {
          throw new Error('retry frame scheduler unavailable')
        },
      ),
    ).not.toThrow()
  })

  it('contains a retry target resolver failure in the frame callback', () => {
    expect(() =>
      scheduleInteractionFocusRetry(
        () => {
          throw new Error('retry target unavailable')
        },
        (callback) => {
          callback(0)
          return 1
        },
      ),
    ).not.toThrow()
  })

  it('retries async focus when the target becomes available on a later frame', () => {
    const target = {
      focus: vi.fn(),
    } as unknown as HTMLElement
    const callbacks: FrameRequestCallback[] = []
    const requestFrame = vi.fn((callback: FrameRequestCallback): number => {
      callbacks.push(callback)
      return callbacks.length
    })
    const resolveTarget = vi
      .fn<() => HTMLElement | null>()
      .mockReturnValueOnce(null)
      .mockReturnValue(target)

    scheduleInteractionFocusRetry(
      resolveTarget,
      requestFrame,
      { contains: () => true },
    )

    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.(0)
    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.(0)

    expect(resolveTarget).toHaveBeenCalledTimes(2)
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('keeps retrying after focus silently fails to move active focus', () => {
    const target = {} as HTMLElement
    let activeElement: HTMLElement | null = null
    let allowFocus = false
    const focus = vi.fn(() => {
      if (allowFocus) activeElement = target
    })
    Object.assign(target, { focus })
    const callbacks: FrameRequestCallback[] = []
    const requestFrame = (callback: FrameRequestCallback): number => {
      callbacks.push(callback)
      return callbacks.length
    }
    const services = {
      contains: () => true,
      isActiveElement: (candidate: HTMLElement) => activeElement === candidate,
    }

    scheduleInteractionFocusRetry(() => target, requestFrame, services)
    callbacks.shift()?.(0)

    expect(activeElement).toBeNull()
    expect(callbacks).toHaveLength(1)

    allowFocus = true
    callbacks.shift()?.(0)

    expect(activeElement).toBe(target)
    expect(callbacks).toHaveLength(0)
    expect(focus).toHaveBeenCalledTimes(2)
  })

  it('stops after the first actual focus and respects the retry budget', () => {
    const focusedTarget = {} as HTMLElement
    let activeElement: HTMLElement | null = null
    const focus = vi.fn(() => {
      activeElement = focusedTarget
    })
    Object.assign(focusedTarget, { focus })
    const focusedCallbacks: FrameRequestCallback[] = []
    scheduleInteractionFocusRetry(
      () => focusedTarget,
      (callback) => {
        focusedCallbacks.push(callback)
        return focusedCallbacks.length
      },
      {
        contains: () => true,
        isActiveElement: (candidate: HTMLElement) => activeElement === candidate,
      },
    )
    focusedCallbacks.shift()?.(0)
    expect(focusedCallbacks).toHaveLength(0)
    expect(focus).toHaveBeenCalledOnce()

    const neverFocusedTarget = {} as HTMLElement
    const neverFocused = vi.fn()
    Object.assign(neverFocusedTarget, { focus: neverFocused })
    const retryCallbacks: FrameRequestCallback[] = []
    scheduleInteractionFocusRetry(
      () => neverFocusedTarget,
      (callback) => {
        retryCallbacks.push(callback)
        return retryCallbacks.length
      },
      {
        contains: () => true,
        isActiveElement: () => false,
      },
    )
    while (retryCallbacks.length > 0) retryCallbacks.shift()?.(0)

    expect(neverFocused).toHaveBeenCalledTimes(4)
  })

  it('restores async action focus only while the original surface still owns it', () => {
    const body = {} as HTMLElement
    const target = {
      disabled: false,
      isConnected: true,
    } as HTMLButtonElement
    const fallbackTarget = {
      disabled: false,
      isConnected: true,
    } as HTMLButtonElement
    const otherControl = {} as HTMLElement

    expect(
      restoreInteractionFocusTarget({
        activeElement: target,
        blocked: false,
        body,
        target,
      }),
    ).toBe(target)
    expect(
      restoreInteractionFocusTarget({
        activeElement: body,
        blocked: false,
        body,
        target,
      }),
    ).toBe(target)
    expect(
      restoreInteractionFocusTarget({
        activeElement: target,
        blocked: true,
        body,
        target,
      }),
    ).toBeNull()
    expect(
      restoreInteractionFocusTarget({
        activeElement: otherControl,
        blocked: false,
        body,
        target,
      }),
    ).toBeNull()
    expect(
      restoreInteractionFocusTarget({
        activeElement: target,
        blocked: false,
        body,
        owner: target,
        target: fallbackTarget,
      }),
    ).toBe(fallbackTarget)
    expect(
      restoreInteractionFocusTarget({
        activeElement: otherControl,
        blocked: false,
        body,
        owner: target,
        target: fallbackTarget,
      }),
    ).toBeNull()
    expect(
      restoreInteractionFocusTarget({
        activeElement: body,
        blocked: false,
        body,
        target: { ...target, isConnected: false } as HTMLButtonElement,
      }),
    ).toBeNull()
    expect(
      restoreInteractionFocusTarget({
        activeElement: body,
        blocked: false,
        body,
        target: { ...target, disabled: true } as HTMLButtonElement,
      }),
    ).toBeNull()
  })

  it('contains interaction scroll failures', () => {
    const target = {
      scrollIntoView: vi.fn(() => {
        throw new Error('scroll blocked')
      }),
    } as unknown as HTMLElement

    expect(
      scrollInteractionElementIntoView(
        target,
        { block: 'nearest', inline: 'center' },
        { contains: () => true },
      ),
    ).toBe(false)
  })

  it('scrolls interaction targets with scrollTo', () => {
    const target = {
      scrollTo: vi.fn(),
    } as unknown as HTMLElement

    expect(
      scrollInteractionElementTo(
        target,
        { top: 42, left: 8, behavior: 'auto' },
        { contains: () => true },
      ),
    ).toBe(true)

    expect(target.scrollTo).toHaveBeenCalledWith({
      top: 42,
      left: 8,
      behavior: 'auto',
    })
  })

  it('falls back to scrollTop when scrollTo is unavailable', () => {
    const target = {
      scrollLeft: 0,
      scrollTop: 0,
    } as HTMLElement

    expect(
      scrollInteractionElementTo(
        target,
        { top: 96, behavior: 'auto' },
        { contains: () => true },
      ),
    ).toBe(true)

    expect(target.scrollTop).toBe(96)
  })

  it('contains interaction scrollTo failures', () => {
    const target = {
      scrollTo: vi.fn(() => {
        throw new Error('scrollTo blocked')
      }),
    } as unknown as HTMLElement

    expect(
      scrollInteractionElementTo(
        target,
        { top: 42, behavior: 'auto' },
        { contains: () => true },
      ),
    ).toBe(false)
  })

  it('contains interaction scrollTop fallback assignment failures', () => {
    const target = {} as HTMLElement

    Object.defineProperty(target, 'scrollTop', {
      set: () => {
        throw new Error('scrollTop blocked')
      },
    })

    expect(
      scrollInteractionElementTo(
        target,
        { top: 120, behavior: 'auto' },
        { contains: () => true },
      ),
    ).toBe(false)
  })
})
