import { describe, expect, it, vi } from 'vitest'
import {
  MESSAGE_ESTIMATED_ROW_HEIGHT,
  MESSAGE_INITIAL_RENDER_WINDOW,
  MESSAGE_LIST_GAP_PX,
  MESSAGE_VIRTUALIZATION_OVERSCAN,
  MESSAGE_VIRTUALIZATION_THRESHOLD,
  calculateMessageVirtualRange,
  deriveResolvedMessageVirtualRange,
  emptyMessageVirtualRange,
  sumMessageVirtualHeights,
  virtualizedLatestAssistantAnnouncement,
} from '../messageVirtualization'
import {
  installMessageVirtualResizeObserver,
  scrollMessagesElementToLatest,
} from '../messageVirtualizationController'
import type { ChatMessage } from '../../types'

function message(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: id,
    createdAt: 1,
  }
}

function messages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => message(`message-${index}`))
}

describe('message virtualization', () => {
  it('returns a full range before the virtualization threshold', () => {
    const range = calculateMessageVirtualRange(
      'conversation-1',
      messages(MESSAGE_VIRTUALIZATION_THRESHOLD),
      240,
      600,
      new Map(),
    )

    expect(range).toEqual({
      conversationId: 'conversation-1',
      messageCount: MESSAGE_VIRTUALIZATION_THRESHOLD,
      start: 0,
      end: MESSAGE_VIRTUALIZATION_THRESHOLD,
      topSpacer: 0,
      bottomSpacer: 0,
    })
  })

  it('sums measured rows with one gap between adjacent rendered rows', () => {
    const items = messages(4)
    const heights = new Map([
      ['message-1', 30],
      ['message-2', 40],
    ])

    expect(sumMessageVirtualHeights(items, heights, 1, 3)).toBe(
      30 + 40 + MESSAGE_LIST_GAP_PX,
    )
  })

  it('falls back to the estimated row height when a measured height is missing', () => {
    expect(sumMessageVirtualHeights(messages(2), new Map(), 0, 2)).toBe(
      MESSAGE_ESTIMATED_ROW_HEIGHT * 2 + MESSAGE_LIST_GAP_PX,
    )
  })

  it('keeps visible rows plus overscan and preserves spacer height', () => {
    const items = messages(60)
    const heights = new Map(items.map((item) => [item.id, 20]))
    const rowAdvance = 20 + MESSAGE_LIST_GAP_PX
    const range = calculateMessageVirtualRange(
      'conversation-2',
      items,
      rowAdvance * 20,
      rowAdvance * 2,
      heights,
    )

    expect(range.conversationId).toBe('conversation-2')
    expect(range.messageCount).toBe(60)
    expect(range.start).toBe(19 - MESSAGE_VIRTUALIZATION_OVERSCAN)
    expect(range.end).toBe(23 + MESSAGE_VIRTUALIZATION_OVERSCAN)
    expect(range.topSpacer).toBe(20 * 14 + MESSAGE_LIST_GAP_PX * 13)
    expect(range.bottomSpacer).toBe(20 * 32 + MESSAGE_LIST_GAP_PX * 31)
  })

  it('creates an empty range for initial app state', () => {
    expect(emptyMessageVirtualRange()).toEqual({
      conversationId: '',
      messageCount: 0,
      start: 0,
      end: 0,
      topSpacer: 0,
      bottomSpacer: 0,
    })
  })

  it('starts virtualized conversations at the newest bounded render window', () => {
    const items = messages(90)
    const heights = new Map(items.map((item) => [item.id, 24]))
    const range = deriveResolvedMessageVirtualRange({
      conversationId: 'conversation-3',
      currentRange: emptyMessageVirtualRange(),
      enabled: true,
      heights,
      messages: items,
    })

    expect(range).toMatchObject({
      conversationId: 'conversation-3',
      messageCount: 90,
      start: 90 - MESSAGE_INITIAL_RENDER_WINDOW,
      end: 90,
      bottomSpacer: 0,
    })
    expect(range.topSpacer).toBe(
      24 * (90 - MESSAGE_INITIAL_RENDER_WINDOW) +
        MESSAGE_LIST_GAP_PX * (90 - MESSAGE_INITIAL_RENDER_WINDOW - 1),
    )
  })

  it('keeps a measured current virtual range when it still matches the conversation', () => {
    const currentRange = {
      conversationId: 'conversation-4',
      messageCount: 80,
      start: 10,
      end: 30,
      topSpacer: 100,
      bottomSpacer: 200,
    }

    expect(
      deriveResolvedMessageVirtualRange({
        conversationId: 'conversation-4',
        currentRange,
        enabled: true,
        heights: new Map(),
        messages: messages(80),
      }),
    ).toBe(currentRange)
  })

  it('scrolls virtualized message lists to the latest message', () => {
    const messageList = {
      scrollHeight: 1200,
      scrollTo: vi.fn(),
    } as unknown as HTMLElement

    expect(scrollMessagesElementToLatest(messageList, 'smooth')).toBe(true)
    expect(messageList.scrollTo).toHaveBeenCalledWith({
      top: 1200,
      behavior: 'smooth',
    })
  })

  it('contains virtualized latest-message scroll failures', () => {
    const messageList = {
      scrollHeight: 1200,
      scrollTo: vi.fn(() => {
        throw new Error('scroll blocked')
      }),
    } as unknown as HTMLElement

    expect(scrollMessagesElementToLatest(messageList, 'auto')).toBe(false)
  })

  it('observes the virtual viewport and every rendered message until cleanup', () => {
    const firstMessage = {} as HTMLElement
    const secondMessage = {} as HTMLElement
    const messageList = {
      querySelectorAll: vi.fn(() => [firstMessage, secondMessage]),
    } as unknown as HTMLElement
    const observe = vi.fn()
    const disconnect = vi.fn()
    const onResize = vi.fn()
    let notifyResize = (): void => undefined

    const cleanup = installMessageVirtualResizeObserver(
      messageList,
      onResize,
      (callback) => {
        notifyResize = callback
        return { disconnect, observe }
      },
    )

    expect(observe.mock.calls).toEqual([
      [messageList, { box: 'border-box' }],
      [firstMessage, { box: 'border-box' }],
      [secondMessage, { box: 'border-box' }],
    ])

    notifyResize()
    expect(onResize).toHaveBeenCalledOnce()

    cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('keeps virtualization usable when resize observation is unavailable', () => {
    const messageList = {
      querySelectorAll: vi.fn(),
    } as unknown as HTMLElement
    const onResize = vi.fn()

    const cleanup = installMessageVirtualResizeObserver(
      messageList,
      onResize,
      () => null,
    )

    expect(() => cleanup()).not.toThrow()
    expect(messageList.querySelectorAll).not.toHaveBeenCalled()
    expect(onResize).not.toHaveBeenCalled()
  })

  it('contains resize observer setup and teardown failures', () => {
    const messageList = {
      querySelectorAll: vi.fn(() => [{} as HTMLElement]),
    } as unknown as HTMLElement

    expect(() =>
      installMessageVirtualResizeObserver(messageList, vi.fn(), () => {
        throw new Error('observer construction failed')
      })(),
    ).not.toThrow()

    const disconnectAfterObserveFailure = vi.fn(() => {
      throw new Error('disconnect after observe failed')
    })
    const cleanupAfterObserveFailure = installMessageVirtualResizeObserver(
      messageList,
      vi.fn(),
      () => ({
        disconnect: disconnectAfterObserveFailure,
        observe: vi.fn(() => {
          throw new Error('observe failed')
        }),
      }),
    )

    expect(disconnectAfterObserveFailure).toHaveBeenCalledOnce()
    expect(() => cleanupAfterObserveFailure()).not.toThrow()

    const cleanup = installMessageVirtualResizeObserver(
      messageList,
      vi.fn(),
      () => ({
        disconnect: vi.fn(() => {
          throw new Error('disconnect failed')
        }),
        observe: vi.fn(),
      }),
    )

    expect(() => cleanup()).not.toThrow()
  })

  it('announces only the latest terminal assistant outside a virtualized log', () => {
    const items = [
      message('old-assistant'),
      {
        ...message('latest-assistant'),
        content: '  Latest answer  ',
        status: 'done' as const,
      },
    ]

    expect(virtualizedLatestAssistantAnnouncement(items, true)).toBe('Latest answer')
    expect(
      virtualizedLatestAssistantAnnouncement(
        [{ ...items[1], status: 'streaming' }],
        true,
      ),
    ).toBe('')
    expect(
      virtualizedLatestAssistantAnnouncement(
        [{ ...items[1], role: 'user' }],
        true,
      ),
    ).toBe('')
    expect(virtualizedLatestAssistantAnnouncement(items, false)).toBe('')
  })
})
