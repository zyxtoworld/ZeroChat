export interface MessageContextMenuState {
  messageId: string
  x: number
  y: number
}

export interface MessageLongPressState {
  pointerId: number
  startX: number
  startY: number
  timer: number
  opened: boolean
}

export interface MessageContextMenuAnchorBounds {
  left: number
  bottom: number
}

export const MESSAGE_CONTEXT_MENU_WIDTH = 220
export const MESSAGE_CONTEXT_MENU_HEIGHT = 260
export const MESSAGE_CONTEXT_MENU_MARGIN = 8
export const MESSAGE_LONG_PRESS_DELAY_MS = 520
export const MESSAGE_LONG_PRESS_MOVE_TOLERANCE_PX = 12
export const MESSAGE_INTERACTIVE_TARGET_SELECTOR =
  'button, a, input, textarea, select, label, [role="button"], [role="menuitem"]'

export function boundedMessageContextMenuPosition(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): Pick<MessageContextMenuState, 'x' | 'y'> {
  return {
    x: Math.min(
      Math.max(MESSAGE_CONTEXT_MENU_MARGIN, clientX),
      Math.max(
        MESSAGE_CONTEXT_MENU_MARGIN,
        viewportWidth - MESSAGE_CONTEXT_MENU_WIDTH,
      ),
    ),
    y: Math.min(
      Math.max(MESSAGE_CONTEXT_MENU_MARGIN, clientY),
      Math.max(
        MESSAGE_CONTEXT_MENU_MARGIN,
        viewportHeight - MESSAGE_CONTEXT_MENU_HEIGHT,
      ),
    ),
  }
}

export function messageContextMenuInvocationPosition(
  clientX: number,
  clientY: number,
  anchor: MessageContextMenuAnchorBounds,
  viewportWidth: number,
  viewportHeight: number,
): Pick<MessageContextMenuState, 'x' | 'y'> {
  const hasPointerCoordinates = clientX !== 0 || clientY !== 0

  return boundedMessageContextMenuPosition(
    hasPointerCoordinates ? clientX : anchor.left,
    hasPointerCoordinates ? clientY : anchor.bottom,
    viewportWidth,
    viewportHeight,
  )
}

export function shouldStartMessageLongPress(
  pointerType: string,
  button: number,
  interactiveTarget: boolean,
): boolean {
  return (
    (pointerType === 'touch' || pointerType === 'pen') &&
    button === 0 &&
    !interactiveTarget
  )
}

export function messageLongPressMovedTooFar(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
): boolean {
  return (
    Math.hypot(clientX - startX, clientY - startY) >
    MESSAGE_LONG_PRESS_MOVE_TOLERANCE_PX
  )
}

export function normalizedMessageContextMenuIndex(
  index: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) {
    return null
  }

  return (index + itemCount) % itemCount
}

export function messageContextMenuNavigationIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) {
    return null
  }

  if (key === 'Home') {
    return 0
  }

  if (key === 'End') {
    return itemCount - 1
  }

  if (key === 'ArrowDown' || key === 'ArrowRight') {
    return (currentIndex + 1 + itemCount) % itemCount
  }

  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    return (currentIndex - 1 + itemCount) % itemCount
  }

  return null
}
