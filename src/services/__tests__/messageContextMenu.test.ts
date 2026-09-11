import { describe, expect, it } from 'vitest'

import {
  boundedMessageContextMenuPosition,
  messageContextMenuInvocationPosition,
  messageContextMenuNavigationIndex,
  messageLongPressMovedTooFar,
  MessageContextMenuFocusOwnership,
  normalizedMessageContextMenuIndex,
  runMessageContextMenuAsyncAction,
  shouldStartMessageLongPress,
} from '../messageContextMenu'
import { installMessageContextMenuListeners } from '../messageContextMenuController'

function createMessageContextMenuListenerTarget(failOnAddCall?: number) {
  const listeners = new Map<string, EventListener>()
  const removed: string[] = []
  let addCallCount = 0
  const target = {
    addEventListener: (type: string, listener: EventListener) => {
      addCallCount += 1
      if (addCallCount === failOnAddCall) {
        throw new Error('message context listener unavailable')
      }
      listeners.set(type, listener)
    },
    removeEventListener: (type: string, listener: EventListener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
      removed.push(type)
    },
    dispatch: (type: string) => listeners.get(type)?.(new Event(type)),
    listenerCount: () => listeners.size,
    removed,
  }
  return target
}

function messageContextMenuListeners() {
  const noop = (event: Event): void => {
    void event
  }
  return {
    onPointerDown: noop,
    onKeyDown: noop,
    onResize: noop,
    onScroll: noop,
  }
}

describe('message context menu behavior', () => {
  it('rolls back global listeners when a later registration fails', () => {
    const target = createMessageContextMenuListenerTarget(4)

    expect(() =>
      installMessageContextMenuListeners({
        documentTarget: target,
        windowTarget: target,
        ...messageContextMenuListeners(),
      }),
    ).not.toThrow()

    expect(target.listenerCount()).toBe(0)
    expect(target.removed).toEqual(['resize', 'keydown', 'mousedown'])
  })

  it('routes outside-pointer and viewport events to the current close callbacks', () => {
    const documentTarget = createMessageContextMenuListenerTarget()
    const windowTarget = createMessageContextMenuListenerTarget()
    const events: string[] = []
    const cleanup = installMessageContextMenuListeners({
      documentTarget,
      windowTarget,
      onPointerDown: () => events.push('outside'),
      onKeyDown: () => events.push('key'),
      onResize: () => events.push('resize'),
      onScroll: () => events.push('scroll'),
    })

    documentTarget.dispatch('mousedown')
    windowTarget.dispatch('resize')
    expect(events).toEqual(['outside', 'resize'])

    cleanup()
    documentTarget.dispatch('mousedown')
    windowTarget.dispatch('resize')
    expect(events).toEqual(['outside', 'resize'])
  })

  it('keeps the menu inside the viewport with a stable margin', () => {
    expect(boundedMessageContextMenuPosition(-20, -30, 390, 780)).toEqual({
      x: 8,
      y: 8,
    })
    expect(boundedMessageContextMenuPosition(380, 760, 390, 780)).toEqual({
      x: 170,
      y: 520,
    })
  })

  it('anchors keyboard-invoked menus to the invoking control', () => {
    const anchor = { left: 144, bottom: 216 }

    expect(
      messageContextMenuInvocationPosition(0, 0, anchor, 390, 780),
    ).toEqual({
      x: 144,
      y: 216,
    })
    expect(
      messageContextMenuInvocationPosition(248, 320, anchor, 390, 780),
    ).toEqual({
      x: 170,
      y: 320,
    })
  })

  it('starts long press only for primary touch or pen gestures on message chrome', () => {
    expect(shouldStartMessageLongPress('touch', 0, false)).toBe(true)
    expect(shouldStartMessageLongPress('pen', 0, false)).toBe(true)
    expect(shouldStartMessageLongPress('mouse', 0, false)).toBe(false)
    expect(shouldStartMessageLongPress('touch', 1, false)).toBe(false)
    expect(shouldStartMessageLongPress('touch', 0, true)).toBe(false)
  })

  it('cancels long press when touch movement exceeds the tolerance', () => {
    expect(messageLongPressMovedTooFar(10, 10, 18, 18)).toBe(false)
    expect(messageLongPressMovedTooFar(10, 10, 23, 10)).toBe(true)
  })

  it('wraps keyboard focus and supports Home/End targets', () => {
    expect(normalizedMessageContextMenuIndex(-1, 4)).toBe(3)
    expect(normalizedMessageContextMenuIndex(4, 4)).toBe(0)
    expect(normalizedMessageContextMenuIndex(0, 0)).toBeNull()
    expect(messageContextMenuNavigationIndex('ArrowDown', 3, 4)).toBe(0)
    expect(messageContextMenuNavigationIndex('ArrowUp', 0, 4)).toBe(3)
    expect(messageContextMenuNavigationIndex('Home', 2, 4)).toBe(0)
    expect(messageContextMenuNavigationIndex('End', 2, 4)).toBe(3)
    expect(messageContextMenuNavigationIndex('Enter', 2, 4)).toBeNull()
  })

  it('restores menu focus only after an asynchronous action settles', async () => {
    const events: string[] = []
    let rejectAction: ((error: Error) => void) | undefined
    const action = new Promise<void>((_resolve, reject) => {
      rejectAction = reject
    })
    const running = runMessageContextMenuAsyncAction(
      async () => action,
      () => events.push('restore'),
    )

    await Promise.resolve()
    expect(events).toEqual([])
    rejectAction?.(new Error('clipboard failure sentinel'))
    await expect(running).rejects.toThrow('clipboard failure sentinel')
    expect(events).toEqual(['restore'])
  })

  it('restores menu focus after a canceled asynchronous action', async () => {
    const events: string[] = []

    const accepted = await runMessageContextMenuAsyncAction(
      async () => {
        events.push('action')
        return false
      },
      () => events.push('restore'),
    )

    expect(accepted).toBe(false)
    expect(events).toEqual(['action', 'restore'])
  })

  it('keeps a reopened same-target menu owner after an older action settles', () => {
    const ownership = new MessageContextMenuFocusOwnership()
    const target = {} as HTMLElement

    ownership.open(target)
    const restoreA = ownership.beginAsyncAction()
    ownership.open(target)

    expect(restoreA()).toBeNull()
    expect(ownership.takeTargetForImmediateRestore()).toBe(target)
  })

  it('invalidates an older async owner when a different target opens', () => {
    const ownership = new MessageContextMenuFocusOwnership()
    const firstTarget = {} as HTMLElement
    const secondTarget = {} as HTMLElement

    ownership.open(firstTarget)
    const restoreA = ownership.beginAsyncAction()
    ownership.open(secondTarget)

    expect(restoreA()).toBeNull()
    expect(ownership.takeTargetForImmediateRestore()).toBe(secondTarget)
  })
})
