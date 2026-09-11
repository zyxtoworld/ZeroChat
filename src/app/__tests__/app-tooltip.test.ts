import { describe, expect, it, vi } from 'vitest'

import { installAppTooltipListeners } from '../appTooltipSubscriptions'
import { tooltipPositionFromDom } from '../tooltipPosition'

type Listener = EventListener

function createEventTarget(failOnAddCall?: number) {
  const listeners = new Map<string, Set<Listener>>()
  let addCallCount = 0

  const target = {
    addEventListener: vi.fn((type: string, listener: Listener) => {
      addCallCount += 1
      if (addCallCount === failOnAddCall) {
        throw new Error('listener registration failed')
      }
      const bucket = listeners.get(type) ?? new Set<Listener>()
      bucket.add(listener)
      listeners.set(type, bucket)
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener)
    }),
    listenerCount: () =>
      [...listeners.values()].reduce((count, bucket) => count + bucket.size, 0),
  }

  return target
}

function handlers() {
  return {
    onPointerOver: vi.fn() as Listener,
    onPointerOut: vi.fn() as Listener,
    onFocusIn: vi.fn() as Listener,
    onFocusOut: vi.fn() as Listener,
    onKeyDown: vi.fn() as Listener,
    reposition: vi.fn() as Listener,
  }
}

describe('AppTooltip listener lifecycle', () => {
  it('installs every global listener and cleans them up idempotently', () => {
    const documentTarget = createEventTarget()
    const windowTarget = createEventTarget()

    const cleanup = installAppTooltipListeners({
      documentTarget,
      windowTarget,
      ...handlers(),
    })

    expect(documentTarget.listenerCount()).toBe(5)
    expect(windowTarget.listenerCount()).toBe(2)

    cleanup()
    cleanup()

    expect(documentTarget.listenerCount()).toBe(0)
    expect(windowTarget.listenerCount()).toBe(0)
    expect(documentTarget.removeEventListener).toHaveBeenCalledTimes(5)
    expect(windowTarget.removeEventListener).toHaveBeenCalledTimes(2)
  })

  it('removes earlier global listeners when a later registration fails', () => {
    const documentTarget = createEventTarget()
    const windowTarget = createEventTarget(1)

    const cleanup = installAppTooltipListeners({
      documentTarget,
      windowTarget,
      ...handlers(),
    })

    expect(documentTarget.listenerCount()).toBe(0)
    expect(windowTarget.listenerCount()).toBe(0)
    cleanup()
    expect(documentTarget.removeEventListener).toHaveBeenCalledTimes(5)
  })
})

describe('AppTooltip layout boundary', () => {
  it('skips the decorative tooltip when DOM measurement fails', () => {
    expect(
      tooltipPositionFromDom(() => {
        throw new Error('layout measurement unavailable')
      }),
    ).toBeNull()
  })

  it('keeps the current bounded position calculation for valid measurements', () => {
    expect(
      tooltipPositionFromDom(() => ({
        targetRect: {
          left: 100,
          top: 40,
          bottom: 64,
          width: 40,
          height: 24,
        },
        tooltipRect: {
          left: 0,
          top: 0,
          bottom: 20,
          width: 80,
          height: 20,
        },
        viewportWidth: 320,
        viewportHeight: 200,
      })),
    ).toEqual({ left: 80, ready: true, top: 72 })
  })
})
