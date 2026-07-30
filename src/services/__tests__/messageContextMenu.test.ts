import { describe, expect, it } from 'vitest'

import {
  boundedMessageContextMenuPosition,
  messageContextMenuInvocationPosition,
  messageContextMenuNavigationIndex,
  messageLongPressMovedTooFar,
  normalizedMessageContextMenuIndex,
  shouldStartMessageLongPress,
} from '../messageContextMenu'

describe('message context menu behavior', () => {
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
})
