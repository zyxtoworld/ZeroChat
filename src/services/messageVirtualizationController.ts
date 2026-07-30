import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RefObject } from 'react'
import { useStore } from 'zustand'

import { appUiStore } from '../state/store'
import type {
  ChatMessage,
  Conversation,
} from '../types'
import { isMessageListNearBottom } from './composerLayout'
import {
  MESSAGE_VIRTUALIZATION_THRESHOLD,
  calculateMessageVirtualRange,
  deriveResolvedMessageVirtualRange,
  emptyMessageVirtualRange,
  type MessageVirtualRange,
} from './messageVirtualization'
import {
  scheduleInteractionFocus,
  scrollInteractionElementTo,
} from './interactionFocus'
import { prefersReducedMotion } from './uiRuntime'

const EMPTY_CHAT_MESSAGES: ChatMessage[] = []
const EMPTY_MESSAGE_VIRTUAL_HEIGHTS = new Map<string, number>()

interface MessageVirtualHeightsState {
  conversationId: string
  heights: Map<string, number>
}

interface MessageVirtualResizeObserver {
  disconnect: () => void
  observe: (target: Element, options?: ResizeObserverOptions) => void
}

const MESSAGE_VIRTUAL_RESIZE_OBSERVER_OPTIONS = {
  box: 'border-box',
} satisfies ResizeObserverOptions

type MessageVirtualResizeObserverFactory = (
  onResize: () => void,
) => MessageVirtualResizeObserver | null

interface UseMessageVirtualizationControllerOptions {
  activeConversation: Conversation | null
}

interface UseMessageVirtualizationControllerResult {
  handleMessageListScroll: () => void
  jumpToLatestMessages: () => void
  messageListRef: RefObject<HTMLElement | null>
  messageVirtualizationEnabled: boolean
  renderedMessages: ChatMessage[]
  resolvedMessageVirtualRange: MessageVirtualRange
  showNewMessagesButton: boolean
}

export function scrollMessagesElementToLatest(
  messageList: HTMLElement | null,
  behavior: ScrollBehavior,
): boolean {
  return scrollInteractionElementTo(messageList, {
    top: messageList?.scrollHeight ?? 0,
    behavior,
  })
}

function createBrowserMessageVirtualResizeObserver(
  onResize: () => void,
): MessageVirtualResizeObserver | null {
  if (typeof globalThis.ResizeObserver !== 'function') {
    return null
  }

  return new globalThis.ResizeObserver(() => onResize())
}

export function installMessageVirtualResizeObserver(
  messageList: HTMLElement | null,
  onResize: () => void,
  createObserver: MessageVirtualResizeObserverFactory =
    createBrowserMessageVirtualResizeObserver,
): () => void {
  if (!messageList) {
    return () => undefined
  }

  let observer: MessageVirtualResizeObserver | null

  try {
    observer = createObserver(onResize)
  } catch {
    return () => undefined
  }

  if (!observer) {
    return () => undefined
  }

  try {
    observer.observe(messageList, MESSAGE_VIRTUAL_RESIZE_OBSERVER_OPTIONS)
    messageList
      .querySelectorAll<HTMLElement>('[data-message-id]')
      .forEach((message) =>
        observer?.observe(message, MESSAGE_VIRTUAL_RESIZE_OBSERVER_OPTIONS),
      )
  } catch {
    try {
      observer.disconnect()
    } catch {
      // Resize observation is an enhancement; the existing frame measurement remains available.
    }

    return () => undefined
  }

  return () => {
    try {
      observer?.disconnect()
    } catch {
      // Keep React cleanup contained if an embedded runtime rejects observer teardown.
    }
  }
}

export function useMessageVirtualizationController({
  activeConversation,
}: UseMessageVirtualizationControllerOptions): UseMessageVirtualizationControllerResult {
  const showNewMessagesButton = useStore(
    appUiStore,
    (state) => state.showNewMessagesButton,
  )
  const hideNewMessagesButtonState = useStore(
    appUiStore,
    (state) => state.hideNewMessagesButtonState,
  )
  const showNewMessagesButtonState = useStore(
    appUiStore,
    (state) => state.showNewMessagesButtonState,
  )
  const [messageVirtualRange, setMessageVirtualRange] =
    useState<MessageVirtualRange>(() => emptyMessageVirtualRange())
  const [messageVirtualHeightsState, setMessageVirtualHeightsState] =
    useState<MessageVirtualHeightsState>(() => ({
      conversationId: '',
      heights: EMPTY_MESSAGE_VIRTUAL_HEIGHTS,
    }))
  const messageListRef = useRef<HTMLElement | null>(null)
  const messageVirtualFrameRef = useRef<number | null>(null)
  const messageVirtualMeasureFrameRef = useRef<number | null>(null)
  const messageListPinnedToBottomRef = useRef(true)
  const previousMessageConversationIdRef = useRef('')
  const previousMessageScrollKeyRef = useRef('')
  const activeConversationId = activeConversation?.id ?? ''
  const activeMessages = activeConversation?.messages ?? EMPTY_CHAT_MESSAGES
  const messageVirtualHeights =
    messageVirtualHeightsState.conversationId === activeConversationId
      ? messageVirtualHeightsState.heights
      : EMPTY_MESSAGE_VIRTUAL_HEIGHTS
  const messageVirtualizationEnabled =
    activeMessages.length > MESSAGE_VIRTUALIZATION_THRESHOLD
  const resolvedMessageVirtualRange = useMemo(
    () =>
      deriveResolvedMessageVirtualRange({
        conversationId: activeConversationId,
        currentRange: messageVirtualRange,
        enabled: messageVirtualizationEnabled,
        heights: messageVirtualHeights,
        messages: activeMessages,
      }),
    [
      activeConversationId,
      activeMessages,
      messageVirtualHeights,
      messageVirtualRange,
      messageVirtualizationEnabled,
    ],
  )
  const renderedMessages = messageVirtualizationEnabled
    ? activeMessages.slice(
        resolvedMessageVirtualRange.start,
        resolvedMessageVirtualRange.end,
      )
    : activeMessages
  const renderedMessageNodeIdsKey = renderedMessages
    .map((message) => message.id)
    .join('|')
  const latestMessage = activeMessages.at(-1)
  const messageScrollKey = activeConversation
    ? [
        activeConversationId,
        activeConversation.messages.length,
        latestMessage?.id ?? '',
        latestMessage?.status ?? '',
        latestMessage?.content.length ?? 0,
        latestMessage?.attachments?.length ?? 0,
      ].join(':')
    : ''

  const recomputeMessageVirtualRange = useCallback(() => {
    const messageList = messageListRef.current

    if (!messageList || !activeConversation) {
      setMessageVirtualRange(emptyMessageVirtualRange())
      return
    }

    if (activeConversation.messages.length <= MESSAGE_VIRTUALIZATION_THRESHOLD) {
      setMessageVirtualRange((current) =>
        current.conversationId === activeConversation.id &&
        current.messageCount === activeConversation.messages.length &&
        current.start === 0 &&
        current.end === activeConversation.messages.length &&
        current.topSpacer === 0 &&
        current.bottomSpacer === 0
          ? current
          : emptyMessageVirtualRange(
              activeConversation.id,
              activeConversation.messages.length,
            ),
      )
      return
    }

    const next = calculateMessageVirtualRange(
      activeConversation.id,
      activeConversation.messages,
      messageList.scrollTop,
      messageList.clientHeight,
      messageVirtualHeights,
    )

    setMessageVirtualRange((current) =>
      current.conversationId === next.conversationId &&
      current.messageCount === next.messageCount &&
      current.start === next.start &&
      current.end === next.end &&
      Math.abs(current.topSpacer - next.topSpacer) < 1 &&
      Math.abs(current.bottomSpacer - next.bottomSpacer) < 1
        ? current
        : next,
    )
  }, [activeConversation, messageVirtualHeights])

  const scheduleMessageVirtualRangeUpdate = useCallback(() => {
    if (messageVirtualFrameRef.current !== null) {
      return
    }

    messageVirtualFrameRef.current = window.requestAnimationFrame(() => {
      messageVirtualFrameRef.current = null
      recomputeMessageVirtualRange()
    })
  }, [recomputeMessageVirtualRange])

  const measureRenderedMessageHeights = useCallback(() => {
    const messageList = messageListRef.current

    if (!messageList || !messageVirtualizationEnabled) {
      return
    }

    let changed = false

    let nextHeights = messageVirtualHeights

    messageList
      .querySelectorAll<HTMLElement>('[data-message-id]')
      .forEach((node) => {
        const messageId = node.dataset.messageId

        if (!messageId) {
          return
        }

        const style = window.getComputedStyle(node)
        const blockMargins =
          Number.parseFloat(style.marginTop) + Number.parseFloat(style.marginBottom)
        const height = Math.max(1, node.getBoundingClientRect().height + blockMargins)
        const previous = nextHeights.get(messageId)

        if (previous === undefined || Math.abs(previous - height) > 1) {
          if (nextHeights === messageVirtualHeights) {
            nextHeights = new Map(messageVirtualHeights)
          }

          nextHeights.set(messageId, height)
          changed = true
        }
      })

    if (changed) {
      setMessageVirtualHeightsState({
        conversationId: activeConversationId,
        heights: nextHeights,
      })
      scheduleMessageVirtualRangeUpdate()
    }
  }, [
    activeConversationId,
    messageVirtualHeights,
    messageVirtualizationEnabled,
    scheduleMessageVirtualRangeUpdate,
  ])

  const scheduleRenderedMessageHeightMeasurement = useCallback(() => {
    if (messageVirtualMeasureFrameRef.current !== null) {
      return
    }

    messageVirtualMeasureFrameRef.current = window.requestAnimationFrame(() => {
      messageVirtualMeasureFrameRef.current = null
      measureRenderedMessageHeights()
    })
  }, [measureRenderedMessageHeights])

  const scrollMessagesToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const messageList = messageListRef.current

    if (!messageList) {
      hideNewMessagesButtonState()
      return
    }

    if (scrollMessagesElementToLatest(messageList, behavior)) {
      messageListPinnedToBottomRef.current = true
      hideNewMessagesButtonState()
    }

    scheduleMessageVirtualRangeUpdate()
  }, [hideNewMessagesButtonState, scheduleMessageVirtualRangeUpdate])

  const handleMessageListScroll = useCallback(() => {
    const messageList = messageListRef.current

    if (!messageList) {
      return
    }

    const nearBottom = isMessageListNearBottom(messageList)
    messageListPinnedToBottomRef.current = nearBottom

    if (nearBottom) {
      hideNewMessagesButtonState()
    }

    scheduleMessageVirtualRangeUpdate()
  }, [hideNewMessagesButtonState, scheduleMessageVirtualRangeUpdate])

  const jumpToLatestMessages = useCallback(() => {
    const shouldRestoreTranscriptFocus =
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.classList.contains('new-messages-button')
    scrollMessagesToLatest(prefersReducedMotion() ? 'auto' : 'smooth')

    if (shouldRestoreTranscriptFocus) {
      scheduleInteractionFocus(() => messageListRef.current)
    }
  }, [scrollMessagesToLatest])

  useEffect(() => {
    if (!messageScrollKey) {
      hideNewMessagesButtonState()
      return
    }

    const messageList = messageListRef.current

    if (!messageList) {
      hideNewMessagesButtonState()
      return
    }

    if (previousMessageScrollKeyRef.current === messageScrollKey) {
      return
    }

    previousMessageScrollKeyRef.current = messageScrollKey

    const conversationChanged =
      previousMessageConversationIdRef.current !== activeConversationId
    previousMessageConversationIdRef.current = activeConversationId

    const shouldAutoScroll =
      conversationChanged ||
      messageListPinnedToBottomRef.current ||
      isMessageListNearBottom(messageList)

    if (!shouldAutoScroll) {
      showNewMessagesButtonState()
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      scrollMessagesToLatest('auto')
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [
    activeConversationId,
    hideNewMessagesButtonState,
    messageScrollKey,
    scrollMessagesToLatest,
    showNewMessagesButtonState,
  ])

  useLayoutEffect(() => {
    if (!messageVirtualizationEnabled) {
      return
    }

    scheduleMessageVirtualRangeUpdate()
    scheduleRenderedMessageHeightMeasurement()
    const disconnectResizeObserver = installMessageVirtualResizeObserver(
      messageListRef.current,
      () => {
        scheduleRenderedMessageHeightMeasurement()
        scheduleMessageVirtualRangeUpdate()
      },
    )

    return () => {
      disconnectResizeObserver()

      if (messageVirtualMeasureFrameRef.current !== null) {
        window.cancelAnimationFrame(messageVirtualMeasureFrameRef.current)
        messageVirtualMeasureFrameRef.current = null
      }
    }
  }, [
    messageVirtualizationEnabled,
    renderedMessageNodeIdsKey,
    scheduleRenderedMessageHeightMeasurement,
    scheduleMessageVirtualRangeUpdate,
  ])

  useEffect(
    () => () => {
      if (messageVirtualFrameRef.current !== null) {
        window.cancelAnimationFrame(messageVirtualFrameRef.current)
      }

      if (messageVirtualMeasureFrameRef.current !== null) {
        window.cancelAnimationFrame(messageVirtualMeasureFrameRef.current)
      }
    },
    [],
  )

  return {
    handleMessageListScroll,
    jumpToLatestMessages,
    messageListRef,
    messageVirtualizationEnabled,
    renderedMessages,
    resolvedMessageVirtualRange,
    showNewMessagesButton,
  }
}
