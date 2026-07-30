import { describe, expect, it, vi } from 'vitest'

import {
  focusInteractionElement,
  scheduleInteractionFocus,
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
