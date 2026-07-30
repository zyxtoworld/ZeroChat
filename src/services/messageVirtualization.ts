import type { ChatMessage } from '../types'

export interface MessageVirtualRange {
  conversationId: string
  messageCount: number
  start: number
  end: number
  topSpacer: number
  bottomSpacer: number
}

export function virtualizedLatestAssistantAnnouncement(
  messages: ChatMessage[],
  enabled: boolean,
): string {
  if (!enabled) {
    return ''
  }

  const latest = messages.at(-1)
  if (
    latest?.role !== 'assistant' ||
    latest.status === 'queued' ||
    latest.status === 'streaming'
  ) {
    return ''
  }

  return latest.content.trim()
}

export const MESSAGE_VIRTUALIZATION_THRESHOLD = 50
export const MESSAGE_VIRTUALIZATION_OVERSCAN = 5
export const MESSAGE_LIST_GAP_PX = 18
export const MESSAGE_ESTIMATED_ROW_HEIGHT = 132
export const MESSAGE_INITIAL_RENDER_WINDOW = 24

interface MessageVirtualRangeDerivationOptions {
  conversationId: string
  currentRange: MessageVirtualRange
  enabled: boolean
  heights: Map<string, number>
  messages: ChatMessage[]
}

export function emptyMessageVirtualRange(
  conversationId = '',
  messageCount = 0,
): MessageVirtualRange {
  return {
    conversationId,
    messageCount,
    start: 0,
    end: messageCount,
    topSpacer: 0,
    bottomSpacer: 0,
  }
}

export function sumMessageVirtualHeights(
  messages: ChatMessage[],
  heights: Map<string, number>,
  start: number,
  end: number,
  rowGap = MESSAGE_LIST_GAP_PX,
): number {
  let total = 0

  for (let index = start; index < end; index += 1) {
    total += heights.get(messages[index]?.id ?? '') ?? MESSAGE_ESTIMATED_ROW_HEIGHT
  }

  total += Math.max(0, end - start - 1) * rowGap

  return total
}

export function calculateMessageVirtualRange(
  conversationId: string,
  messages: ChatMessage[],
  scrollTop: number,
  viewportHeight: number,
  heights: Map<string, number>,
): MessageVirtualRange {
  if (messages.length <= MESSAGE_VIRTUALIZATION_THRESHOLD) {
    return emptyMessageVirtualRange(conversationId, messages.length)
  }

  const viewportBottom = scrollTop + viewportHeight
  let offset = 0
  let firstVisible = 0

  while (firstVisible < messages.length) {
    const nextOffset =
      offset +
      (heights.get(messages[firstVisible].id) ?? MESSAGE_ESTIMATED_ROW_HEIGHT) +
      (firstVisible < messages.length - 1 ? MESSAGE_LIST_GAP_PX : 0)

    if (nextOffset >= scrollTop) {
      break
    }

    offset = nextOffset
    firstVisible += 1
  }

  let lastVisible = firstVisible
  let endOffset = offset

  while (lastVisible < messages.length && endOffset <= viewportBottom) {
    endOffset +=
      (heights.get(messages[lastVisible].id) ?? MESSAGE_ESTIMATED_ROW_HEIGHT) +
      (lastVisible < messages.length - 1 ? MESSAGE_LIST_GAP_PX : 0)
    lastVisible += 1
  }

  const start = Math.max(0, firstVisible - MESSAGE_VIRTUALIZATION_OVERSCAN)
  const end = Math.min(
    messages.length,
    lastVisible + MESSAGE_VIRTUALIZATION_OVERSCAN,
  )

  return {
    conversationId,
    messageCount: messages.length,
    start,
    end,
    topSpacer: sumMessageVirtualHeights(messages, heights, 0, start),
    bottomSpacer: sumMessageVirtualHeights(messages, heights, end, messages.length),
  }
}

export function deriveResolvedMessageVirtualRange({
  conversationId,
  currentRange,
  enabled,
  heights,
  messages,
}: MessageVirtualRangeDerivationOptions): MessageVirtualRange {
  if (!enabled) {
    return emptyMessageVirtualRange(conversationId, messages.length)
  }

  if (
    currentRange.conversationId === conversationId &&
    currentRange.messageCount === messages.length &&
    currentRange.end > currentRange.start
  ) {
    return currentRange
  }

  const end = messages.length
  const start = Math.max(0, end - MESSAGE_INITIAL_RENDER_WINDOW)

  return {
    conversationId,
    messageCount: messages.length,
    start,
    end,
    topSpacer: sumMessageVirtualHeights(messages, heights, 0, start),
    bottomSpacer: 0,
  }
}
