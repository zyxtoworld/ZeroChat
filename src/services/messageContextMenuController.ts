import type {
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ChatMessage } from '../types'
import {
  MESSAGE_INTERACTIVE_TARGET_SELECTOR,
  MESSAGE_LONG_PRESS_DELAY_MS,
  messageContextMenuInvocationPosition,
  messageContextMenuNavigationIndex,
  messageLongPressMovedTooFar,
  shouldStartMessageLongPress,
  type MessageContextMenuState,
  type MessageLongPressState,
} from './messageContextMenu'
import {
  focusInteractionElement,
  scheduleInteractionFocus,
} from './interactionFocus'

interface MessageContextMenuController {
  messageContextMenu: MessageContextMenuState | null
  messageContextMenuRef: RefObject<HTMLDivElement | null>
  cancelMessageLongPress: () => void
  closeMessageContextMenu: () => void
  finishMessageLongPress: (event: ReactPointerEvent<HTMLElement>) => void
  handleMessageContextMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  moveMessageLongPress: (event: ReactPointerEvent<HTMLElement>) => void
  openMessageContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    message: ChatMessage,
  ) => void
  startMessageLongPress: (
    event: ReactPointerEvent<HTMLElement>,
    message: ChatMessage,
  ) => void
}

export function useMessageContextMenuController(): MessageContextMenuController {
  const [messageContextMenu, setMessageContextMenu] =
    useState<MessageContextMenuState | null>(null)
  const messageContextMenuRef = useRef<HTMLDivElement | null>(null)
  const messageContextMenuReturnTargetRef = useRef<HTMLElement | null>(null)
  const messageLongPressRef = useRef<MessageLongPressState | null>(null)

  const closeMessageContextMenu = useCallback((): void => {
    messageContextMenuReturnTargetRef.current = null
    setMessageContextMenu(null)
  }, [])

  const closeMessageContextMenuAndRestoreFocus = useCallback((): void => {
    const returnTarget = messageContextMenuReturnTargetRef.current
    messageContextMenuReturnTargetRef.current = null
    setMessageContextMenu(null)
    scheduleInteractionFocus(() => returnTarget)
  }, [])

  const openMessageContextMenuAt = useCallback(
    (
      message: ChatMessage,
      clientX: number,
      clientY: number,
      returnTarget: HTMLElement,
    ): void => {
      const anchor =
        clientX === 0 && clientY === 0
          ? returnTarget.getBoundingClientRect()
          : { left: clientX, bottom: clientY }
      const position = messageContextMenuInvocationPosition(
        clientX,
        clientY,
        anchor,
        window.innerWidth,
        window.innerHeight,
      )

      messageContextMenuReturnTargetRef.current = returnTarget
      setMessageContextMenu({
        messageId: message.id,
        ...position,
      })
    },
    [],
  )

  const cancelMessageLongPress = useCallback((): void => {
    const longPress = messageLongPressRef.current

    if (!longPress) {
      return
    }

    window.clearTimeout(longPress.timer)
    messageLongPressRef.current = null
  }, [])

  const isMessageInteractiveTarget = useCallback(
    (target: EventTarget | null): boolean =>
      target instanceof Element &&
      Boolean(target.closest(MESSAGE_INTERACTIVE_TARGET_SELECTOR)),
    [],
  )

  const openMessageContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, message: ChatMessage): void => {
      event.preventDefault()
      cancelMessageLongPress()
      const activeElement = document.activeElement
      const returnTarget =
        activeElement instanceof HTMLElement &&
        event.currentTarget.contains(activeElement)
          ? activeElement
          : event.currentTarget
      openMessageContextMenuAt(
        message,
        event.clientX,
        event.clientY,
        returnTarget,
      )
    },
    [cancelMessageLongPress, openMessageContextMenuAt],
  )

  const startMessageLongPress = useCallback(
    (event: ReactPointerEvent<HTMLElement>, message: ChatMessage): void => {
      if (
        !shouldStartMessageLongPress(
          event.pointerType,
          event.button,
          isMessageInteractiveTarget(event.target),
        )
      ) {
        return
      }

      cancelMessageLongPress()

      const { clientX, clientY, pointerId } = event
      const element = event.currentTarget
      const timer = window.setTimeout(() => {
        const longPress = messageLongPressRef.current

        if (!longPress || longPress.pointerId !== pointerId) {
          return
        }

        longPress.opened = true
        openMessageContextMenuAt(message, clientX, clientY, element)
      }, MESSAGE_LONG_PRESS_DELAY_MS)

      messageLongPressRef.current = {
        pointerId,
        startX: clientX,
        startY: clientY,
        timer,
        opened: false,
      }

      try {
        element.setPointerCapture(pointerId)
      } catch {
        // Some embedded WebViews reject pointer capture for synthetic touch events.
      }
    },
    [
      cancelMessageLongPress,
      isMessageInteractiveTarget,
      openMessageContextMenuAt,
    ],
  )

  const moveMessageLongPress = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const longPress = messageLongPressRef.current

      if (!longPress || longPress.pointerId !== event.pointerId) {
        return
      }

      if (
        messageLongPressMovedTooFar(
          longPress.startX,
          longPress.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        cancelMessageLongPress()
      }
    },
    [cancelMessageLongPress],
  )

  const finishMessageLongPress = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const longPress = messageLongPressRef.current

      if (!longPress || longPress.pointerId !== event.pointerId) {
        return
      }

      if (longPress.opened) {
        event.preventDefault()
      }

      cancelMessageLongPress()

      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer capture may already be released after a synthetic or canceled touch.
      }
    },
    [cancelMessageLongPress],
  )

  const messageContextMenuItems = useCallback((): HTMLButtonElement[] => {
    return Array.from(
      messageContextMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role=menuitem]:not(:disabled)',
      ) ?? [],
    )
  }, [])

  const handleMessageContextMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const items = messageContextMenuItems()

      if (event.key === 'Escape') {
        event.preventDefault()
        closeMessageContextMenuAndRestoreFocus()
        return
      }

      if (event.key === 'Tab') {
        closeMessageContextMenu()
        return
      }

      const activeIndex = items.indexOf(
        document.activeElement as HTMLButtonElement,
      )
      const currentIndex = activeIndex >= 0 ? activeIndex : 0
      const nextIndex = messageContextMenuNavigationIndex(
        event.key,
        currentIndex,
        items.length,
      )

      if (nextIndex !== null) {
        event.preventDefault()
        focusInteractionElement(items[nextIndex])
      }
    },
    [
      closeMessageContextMenu,
      closeMessageContextMenuAndRestoreFocus,
      messageContextMenuItems,
    ],
  )

  useEffect(() => {
    if (!messageContextMenu) {
      return
    }

    focusInteractionElement(messageContextMenuItems()[0])

    const handlePointerDown = (event: globalThis.MouseEvent): void => {
      const target = event.target

      if (
        target instanceof Node &&
        messageContextMenuRef.current?.contains(target)
      ) {
        return
      }

      closeMessageContextMenu()
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        closeMessageContextMenuAndRestoreFocus()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', closeMessageContextMenu)
    window.addEventListener('scroll', closeMessageContextMenu, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', closeMessageContextMenu)
      window.removeEventListener('scroll', closeMessageContextMenu, true)
    }
  }, [
    closeMessageContextMenu,
    closeMessageContextMenuAndRestoreFocus,
    messageContextMenu,
    messageContextMenuItems,
  ])

  useEffect(() => cancelMessageLongPress, [cancelMessageLongPress])

  return {
    messageContextMenu,
    messageContextMenuRef,
    cancelMessageLongPress,
    closeMessageContextMenu,
    finishMessageLongPress,
    handleMessageContextMenuKeyDown,
    moveMessageLongPress,
    openMessageContextMenu,
    startMessageLongPress,
  }
}
