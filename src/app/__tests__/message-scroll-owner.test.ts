import { afterEach, describe, expect, it, vi } from 'vitest'

type TestConversation = {
  id: string
  title: string
  providerId: string
  model: string
  createdAt: number
  updatedAt: number
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    createdAt: number
    status: 'done'
  }>
}

type EffectRecord = () => void | (() => void)

const reactHarness = vi.hoisted(() => {
  const refs: Array<{ current: unknown }> = []
  const effects: EffectRecord[] = []
  const stateSetters: Array<(value: unknown) => void> = []

  return {
    refs,
    effects,
    stateSetters,
    reset() {
      refs.length = 0
      effects.length = 0
      stateSetters.length = 0
    },
  }
})

const storeHarness = vi.hoisted(() => ({
  state: {
    data: { preferences: { language: 'en-US' } },
    sending: false,
    conversationMutationPending: false,
    speakingMessageId: null,
    speakMessage: vi.fn(),
  },
}))

const contextMenuHarness = vi.hoisted(() => ({
  messageContextMenu: null as {
    message: { id: string; content: string }
    messageId: string
    x: number
    y: number
  } | null,
  closeMessageContextMenu: vi.fn(),
}))

vi.mock('react', () => ({
  memo: (component: unknown) => component,
  useCallback: (callback: unknown) => callback,
  useEffect: (callback: EffectRecord) => {
    reactHarness.effects.push(callback)
  },
  useLayoutEffect: (callback: EffectRecord) => {
    reactHarness.effects.push(callback)
  },
  useRef: (initial: unknown) => {
    const ref = { current: initial }
    reactHarness.refs.push(ref)
    return ref
  },
  useState: (initial: unknown) => {
    const value = typeof initial === 'function' ? (initial as () => unknown)() : initial
    let current = value
    const setValue = vi.fn((next: unknown) => {
      current =
        typeof next === 'function'
          ? (next as (value: unknown) => unknown)(current)
          : next
      void current
    })
    reactHarness.stateSetters.push(setValue)
    return [value, setValue]
  },
}))

vi.mock('lucide-react', () => {
  const icons = [
    'Check',
    'ChevronDown',
    'Copy',
    'Download',
    'Pencil',
    'RefreshCw',
    'Send',
    'Trash2',
    'X',
  ]
  return Object.fromEntries(icons.map((name) => [name, () => null]))
})

vi.mock('../store', () => ({
  appT: () => 'label',
  useAppStore: Object.assign(
    (selector: (state: typeof storeHarness.state) => unknown) =>
      selector(storeHarness.state),
    { getState: () => storeHarness.state },
  ),
}))

vi.mock('../i18n', () => ({
  createMarkdownLabels: () => ({}),
  formatTime: () => 'time',
  resolveAppLocale: () => 'en-US',
}))

vi.mock('../../services/composerLayout', () => ({
  isMessageListNearBottom: () => true,
}))

vi.mock('../../services/imageAttachments', () => ({
  downloadImageAttachment: () => true,
  imageAttachmentSrc: () => '',
}))

vi.mock('../../services/interactionFocus', () => ({
  restoreInteractionFocusTarget: () => null,
  scheduleInteractionFocus: () => undefined,
  scrollInteractionElementTo: (target: { scrollTo: (options: unknown) => void } | null, options: unknown) => {
    target?.scrollTo(options)
    return true
  },
}))

vi.mock('../../services/messageContextMenuController', () => ({
  useMessageContextMenuController: () => ({
    messageContextMenu: contextMenuHarness.messageContextMenu,
    messageLongPressMessageId: null,
    cancelMessageLongPress: vi.fn(),
    closeMessageContextMenu: contextMenuHarness.closeMessageContextMenu,
  }),
}))

vi.mock('../../services/messageRendering', () => ({
  messageCopyText: () => '',
}))

vi.mock('../../services/messageVirtualization', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../services/messageVirtualization')
  >()

  return {
    ...actual,
    MESSAGE_VIRTUALIZATION_THRESHOLD: 50,
    calculateMessageVirtualRange: () => ({
      conversationId: 'conversation-a',
      messageCount: 1,
      start: 0,
      end: 1,
      topSpacer: 0,
      bottomSpacer: 0,
    }),
    deriveResolvedMessageVirtualRange: ({ conversationId, messages }: { conversationId: string; messages: unknown[] }) => ({
      conversationId,
      messageCount: messages.length,
      start: 0,
      end: messages.length,
      topSpacer: 0,
      bottomSpacer: 0,
    }),
    emptyMessageVirtualRange: (conversationId = '', messageCount = 0) => ({
      conversationId,
      messageCount,
      start: 0,
      end: messageCount,
      topSpacer: 0,
      bottomSpacer: 0,
    }),
    scrollMessagesElementToLatest: (target: { scrollTo: () => void } | null) => {
      target?.scrollTo()
      return true
    },
    virtualizedLatestAssistantAnnouncement: () => '',
  }
})

vi.mock('../../services/prefersReducedMotion', () => ({
  prefersReducedMotion: () => true,
}))

vi.mock('../messageActionFeedback', () => ({
  copyMessageText: vi.fn(async () => true),
  invalidateMessageCopyFeedback: vi.fn(),
  notifyContained: vi.fn(),
  runMessageCopyFeedbackAction: vi.fn(async () => true),
}))

vi.mock('../messageEditSubmission', () => ({
  commitMessageEdit: vi.fn(),
  reportMessageEditFailure: vi.fn(),
}))

vi.mock('../components/Markdown', () => ({ Markdown: () => null }))
vi.mock('../components/MessageContextMenu', () => ({ MessageContextMenu: () => null }))

const { MessageList } = await import('../components/MessageList')

function conversation(id: string) {
  return {
    id,
    title: id,
    providerId: 'provider-a',
    model: 'model-a',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        id: `${id}-message`,
        role: 'assistant',
        content: `${id} content`,
        createdAt: 1,
        status: 'done',
      },
    ],
  } as unknown as TestConversation
}

function virtualizedConversation(id: string) {
  return {
    ...conversation(id),
    messages: Array.from({ length: 60 }, (_, index) => ({
      id: `${id}-message-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `${id} content ${index}`,
      createdAt: index + 1,
      status: 'done',
    })),
  } as unknown as TestConversation
}

afterEach(() => {
  reactHarness.reset()
  contextMenuHarness.messageContextMenu = null
  contextMenuHarness.closeMessageContextMenu.mockReset()
  vi.restoreAllMocks()
  delete (globalThis as { window?: unknown }).window
})

describe('MessageList scroll ownership', () => {
  function renderWithFrame() {
    const frames = new Map<number, FrameRequestCallback>()
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = frames.size + 1
      frames.set(id, callback)
      return id
    })
    const cancelAnimationFrame = vi.fn()
    ;(globalThis as { window?: unknown }).window = {
      requestAnimationFrame,
      cancelAnimationFrame,
    }

    MessageList({
      conversation: conversation('conversation-a'),
      streaming: false,
      onRegenerate: vi.fn(),
      onRetry: vi.fn(),
      onDelete: vi.fn(async () => true),
      onEdit: vi.fn(async () => true),
    })

    const scrollRef = reactHarness.refs[0]
    const scroll = { scrollTo: vi.fn() }
    scrollRef.current = scroll
    const cleanups = reactHarness.effects
      .map((effect) => effect())
      .filter((cleanup): cleanup is () => void => typeof cleanup === 'function')
    return { cancelAnimationFrame, cleanups, frames, scroll, scrollRef }
  }

  it('runs the current auto-scroll frame once', () => {
    const { frames, scroll } = renderWithFrame()

    frames.get(1)?.(0)

    expect(scroll.scrollTo).toHaveBeenCalledOnce()
  })

  it('does not let an already queued old auto-scroll frame move the replacement conversation', () => {
    const { cancelAnimationFrame, cleanups, frames, scrollRef, scroll: oldScroll } =
      renderWithFrame()
    const replacementScroll = { scrollTo: vi.fn() }
    const frame = frames.get(1)
    expect(frame).toBeDefined()
    expect(cleanups.length).toBeGreaterThan(0)

    cleanups.at(-1)?.()
    scrollRef.current = replacementScroll
    frame?.(0)

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(oldScroll.scrollTo).not.toHaveBeenCalled()
    expect(replacementScroll.scrollTo).not.toHaveBeenCalled()
    expect(reactHarness.stateSetters[2]).not.toHaveBeenCalled()
  })

  it('closes a menu when the same message id is replaced by a new message generation', () => {
    const frames = new Map<number, FrameRequestCallback>()
    ;(globalThis as { window?: unknown }).window = {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        const id = frames.size + 1
        frames.set(id, callback)
        return id
      }),
      cancelAnimationFrame: vi.fn(),
    }
    const oldMessage = {
      id: 'shared-message',
      role: 'assistant',
      content: 'old generation',
      createdAt: 1,
      status: 'done',
    }
    const replacementMessage = { ...oldMessage, content: 'replacement generation' }
    contextMenuHarness.messageContextMenu = {
      message: oldMessage,
      messageId: oldMessage.id,
      x: 10,
      y: 12,
    }

    const render = (message: typeof oldMessage) => {
      MessageList({
        conversation: {
          ...conversation('conversation-a'),
          messages: [message],
        } as never,
        streaming: false,
        onRegenerate: vi.fn(),
        onRetry: vi.fn(),
        onDelete: vi.fn(async () => true),
        onEdit: vi.fn(async () => true),
      })

      const scrollRef = reactHarness.refs.at(-8)
      const rowElsRef = reactHarness.refs.at(-7)
      scrollRef!.current = { contains: () => true }
      rowElsRef!.current = new Map([
        [
          'shared-message',
          { isConnected: true } as HTMLDivElement,
        ],
      ])

      const pendingEffects = reactHarness.effects.splice(0)
      for (const effect of pendingEffects) effect()
    }

    render(oldMessage)
    render(replacementMessage)

    expect(contextMenuHarness.closeMessageContextMenu).toHaveBeenCalledOnce()
  })

  it('ignores a resize RAF that runs after the virtualized MessageList cleanup', () => {
    const frames = new Map<number, FrameRequestCallback>()
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = frames.size + 1
      frames.set(id, callback)
      return id
    })
    const cancelAnimationFrame = vi.fn()
    ;(globalThis as { window?: unknown }).window = {
      requestAnimationFrame,
      cancelAnimationFrame,
    }

    let resizeCallback: (() => void) | undefined
    class FakeResizeObserver {
      constructor(callback: () => void) {
        resizeCallback = callback
      }

      observe = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)

    MessageList({
      conversation: virtualizedConversation('conversation-a'),
      streaming: false,
      onRegenerate: vi.fn(),
      onRetry: vi.fn(),
      onDelete: vi.fn(async () => true),
      onEdit: vi.fn(async () => true),
    })

    const scrollRef = reactHarness.refs[0]
    scrollRef.current = {
      clientHeight: 600,
      querySelectorAll: vi.fn(() => []),
      scrollHeight: 8_000,
      scrollTop: 0,
    }

    const cleanups = reactHarness.effects
      .map((effect) => effect())
      .filter((cleanup): cleanup is () => void => typeof cleanup === 'function')
    const rangeSetter = reactHarness.stateSetters[2] as unknown as ReturnType<
      typeof vi.fn
    >
    const setterCallsBeforeLateFrame = rangeSetter.mock.calls.length

    resizeCallback?.()
    const lateFrame = frames.get(Math.max(...frames.keys()))
    expect(lateFrame).toBeDefined()

    cleanups.forEach((cleanup) => cleanup())
    lateFrame?.(0)

    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(rangeSetter).toHaveBeenCalledTimes(setterCallsBeforeLateFrame)
  })
})
