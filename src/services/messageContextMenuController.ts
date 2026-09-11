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
  MessageContextMenuFocusOwnership,
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
  messageLongPressMessageId: string | null
  cancelMessageLongPress: () => void
  closeMessageContextMenu: () => void
  closeMessageContextMenuAndRestoreFocus: () => void
  closeMessageContextMenuForAsyncAction: () => () => void
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

interface MessageContextMenuListenerTarget {
  addEventListener: (
    type: string,
    listener: EventListener,
    options?: boolean,
  ) => void
  removeEventListener: (
    type: string,
    listener: EventListener,
    options?: boolean,
  ) => void
}

interface MessageContextMenuListenerOptions {
  documentTarget: MessageContextMenuListenerTarget
  windowTarget: MessageContextMenuListenerTarget
  onPointerDown: EventListener
  onKeyDown: EventListener
  onResize: EventListener
  onScroll: EventListener
}

export function installMessageContextMenuListeners({
  documentTarget,
  windowTarget,
  onPointerDown,
  onKeyDown,
  onResize,
  onScroll,
}: MessageContextMenuListenerOptions): () => void {
  const removers: Array<() => void> = []

  const cleanup = (): void => {
    for (const remove of removers.splice(0).reverse()) {
      try {
        remove()
      } catch {
        // Browser teardown may make listener removal unavailable.
      }
    }
  }

  const register = (
    target: MessageContextMenuListenerTarget,
    type: string,
    listener: EventListener,
    options?: boolean,
  ): void => {
    target.addEventListener(type, listener, options)
    removers.push(() => target.removeEventListener(type, listener, options))
  }

  try {
    register(documentTarget, 'mousedown', onPointerDown)
    register(documentTarget, 'keydown', onKeyDown)
    register(windowTarget, 'resize', onResize)
    register(windowTarget, 'scroll', onScroll, true)
  } catch {
    cleanup()
  }

  return cleanup
}

export function useMessageContextMenuController(): MessageContextMenuController {
  const [messageContextMenu, setMessageContextMenu] =
    useState<MessageContextMenuState | null>(null)
  const messageContextMenuRef = useRef<HTMLDivElement | null>(null)
  const messageContextMenuFocusOwnershipRef = useRef(
    new MessageContextMenuFocusOwnership(),
  )
  const messageLongPressRef = useRef<MessageLongPressState | null>(null)
  const [messageLongPressMessageId, setMessageLongPressMessageId] =
    useState<string | null>(null)

  const clearMessageLongPressTimer = useCallback((): void => {
    const longPress = messageLongPressRef.current

    if (!longPress) {
      return
    }

    window.clearTimeout(longPress.timer)
    messageLongPressRef.current = null
  }, [])

  const closeMessageContextMenu = useCallback((): void => {
    messageContextMenuFocusOwnershipRef.current.close()
    setMessageContextMenu(null)
  }, [])

  const closeMessageContextMenuAndRestoreFocus = useCallback((): void => {
    const returnTarget =
      messageContextMenuFocusOwnershipRef.current.takeTargetForImmediateRestore()
    setMessageContextMenu(null)
    scheduleInteractionFocus(() => returnTarget)
  }, [])

  const closeMessageContextMenuForAsyncAction = useCallback((): (() => void) => {
    const takeTargetAfterAction =
      messageContextMenuFocusOwnershipRef.current.beginAsyncAction()
    setMessageContextMenu(null)

    return () => {
      const returnTarget = takeTargetAfterAction()
      if (returnTarget) scheduleInteractionFocus(() => returnTarget)
    }
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

      messageContextMenuFocusOwnershipRef.current.open(returnTarget)
      setMessageContextMenu({
        message,
        messageId: message.id,
        ...position,
      })
    },
    [],
  )

  const cancelMessageLongPress = useCallback((): void => {
    clearMessageLongPressTimer()
    setMessageLongPressMessageId(null)
  }, [clearMessageLongPressTimer])

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
        messageId: message.id,
        pointerId,
        startX: clientX,
        startY: clientY,
        timer,
        opened: false,
      }
      setMessageLongPressMessageId(message.id)

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

    const handlePointerDown: EventListener = (event): void => {
      const target = (event as globalThis.MouseEvent).target

      if (
        target instanceof Node &&
        messageContextMenuRef.current?.contains(target)
      ) {
        return
      }

      closeMessageContextMenu()
    }

    const handleKeyDown: EventListener = (event): void => {
      const keyboardEvent = event as globalThis.KeyboardEvent
      if (keyboardEvent.key === 'Escape' && !keyboardEvent.defaultPrevented) {
        keyboardEvent.preventDefault()
        closeMessageContextMenuAndRestoreFocus()
      }
    }

    return installMessageContextMenuListeners({
      documentTarget: document,
      windowTarget: window,
      onPointerDown: handlePointerDown,
      onKeyDown: handleKeyDown,
      onResize: closeMessageContextMenu,
      onScroll: closeMessageContextMenu,
    })
  }, [
    closeMessageContextMenu,
    closeMessageContextMenuAndRestoreFocus,
    messageContextMenu,
    messageContextMenuItems,
  ])

  useEffect(
    () => () => {
      clearMessageLongPressTimer()
      messageContextMenuFocusOwnershipRef.current.close()
    },
    [clearMessageLongPressTimer],
  )

  return {
    messageContextMenu,
    messageContextMenuRef,
    messageLongPressMessageId,
    cancelMessageLongPress,
    closeMessageContextMenu,
    closeMessageContextMenuAndRestoreFocus,
    closeMessageContextMenuForAsyncAction,
    finishMessageLongPress,
    handleMessageContextMenuKeyDown,
    moveMessageLongPress,
    openMessageContextMenu,
    startMessageLongPress,
  }
}
