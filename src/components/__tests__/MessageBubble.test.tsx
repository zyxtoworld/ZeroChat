import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { ChatMessage, MessageAttachment } from '../../types'
import { MessageBubble } from '../MessageBubble'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    role: 'user',
    content: 'Hello',
    createdAt: 1,
    status: 'done',
    ...patch,
  }
}

function imageAttachment(
  patch: Partial<MessageAttachment> = {},
): MessageAttachment {
  return {
    id: 'attachment-1',
    kind: 'image',
    purpose: 'generated',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,AA==',
    alt: 'Release chart',
    createdAt: 1,
    ...patch,
  }
}

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findAllByType(
  node: unknown,
  typeName: string,
): { props: Record<string, unknown> }[] {
  const matches: { props: Record<string, unknown> }[] = []

  if (node && typeof node === 'object') {
    const element = node as { type?: unknown; props?: Record<string, unknown> }
    if (element.type === typeName && element.props) {
      matches.push({ props: element.props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByType(child, typeName))
  }

  return matches
}

function buttonLabels(tree: ReactElement): string[] {
  return findAllByType(tree, 'button')
    .map((button) => button.props['aria-label'])
    .filter((label): label is string => typeof label === 'string')
}

function findButtonByLabel(
  tree: ReactElement,
  label: string,
): { props: Record<string, unknown> } {
  const button = findAllByType(tree, 'button').find(
    (candidate) => candidate.props['aria-label'] === label,
  )

  if (!button) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}

function clickButton(tree: ReactElement, label: string): void {
  const onClick = findButtonByLabel(tree, label).props.onClick

  if (typeof onClick !== 'function') {
    throw new Error(`Button has no click handler: ${label}`)
  }

  onClick()
}

function renderBubble(
  selectedMessage: ChatMessage,
  overrides: Partial<Parameters<typeof MessageBubble>[0]> = {},
): ReactElement {
  return MessageBubble({
    editingContent: '',
    formatMessageTime: (timestamp) => `time:${timestamp}`,
    isEditing: false,
    message: selectedMessage,
    renderMessageNotice: () => null,
    sending: false,
    speakingMessageId: '',
    t,
    onCancelEditingMessage: vi.fn(),
    onDeleteMessage: vi.fn(),
    onDownloadAttachment: vi.fn(),
    onEditContentChange: vi.fn(),
    onFinishLongPress: vi.fn(),
    onMessageContextMenu: vi.fn(),
    onMessageLongPressCancel: vi.fn(),
    onMessageLongPressMove: vi.fn(),
    onMessageLongPressStart: vi.fn(),
    onRegenerateAssistantMessage: vi.fn(),
    onSpeakMessage: vi.fn(),
    onStartEditingMessage: vi.fn(),
    onStopSpeakingMessage: vi.fn(),
    onSubmitEditedUserMessage: vi.fn(),
    ...overrides,
  }) as ReactElement
}

describe('MessageBubble', () => {
  it('allows context-menu dismissal to restore focus without adding a tab stop', () => {
    const tree = renderBubble(message())
    const props = tree.props as Record<string, unknown>

    expect(tree.type).toBe('article')
    expect(props.tabIndex).toBe(-1)
  })

  it('names repeated user message actions with the message context', () => {
    const firstLabels = buttonLabels(
      renderBubble(message({ id: 'message-1', createdAt: 101 })),
    )
    const secondLabels = buttonLabels(
      renderBubble(message({ id: 'message-2', createdAt: 202 })),
    )

    expect(firstLabels).toContain(
      'button.editMessage: message.role.user, time:101',
    )
    expect(firstLabels).toContain(
      'button.deleteMessage: message.role.user, time:101',
    )
    expect(secondLabels).toContain(
      'button.editMessage: message.role.user, time:202',
    )
    expect(secondLabels).toContain(
      'button.deleteMessage: message.role.user, time:202',
    )
    expect(firstLabels).not.toContain('button.editMessage')
    expect(firstLabels).not.toContain('button.deleteMessage')
  })

  it('names assistant message actions and image downloads with context', () => {
    const tree = renderBubble(
      message({
        id: 'assistant-message',
        role: 'assistant',
        content: 'Here is the chart',
        createdAt: 303,
        attachments: [imageAttachment()],
      }),
    )
    const labels = buttonLabels(tree)
    const tooltipButtons = findAllByType(tree, 'button').filter(
      (button) => typeof button.props['data-tooltip'] === 'string',
    )

    expect(labels).toContain(
      'button.speakMessage: message.role.assistant, time:303',
    )
    expect(labels).toContain(
      'button.regenerate: message.role.assistant, time:303',
    )
    expect(labels).toContain(
      'button.deleteMessage: message.role.assistant, time:303',
    )
    expect(
      labels.filter(
        (label) =>
          label ===
          'button.downloadImage: Release chart, message.role.assistant, time:303',
      ),
    ).toHaveLength(2)
    expect(labels).not.toContain('button.downloadImage')
    expect(tooltipButtons.length).toBeGreaterThan(0)
    expect(tooltipButtons.every((button) => button.props.title === undefined)).toBe(
      true,
    )
    expect(
      tooltipButtons.every(
        (button) => button.props['data-tooltip'] === button.props['aria-label'],
      ),
    ).toBe(true)
  })

  it('renders only safe imported image attachment sources without referrers', () => {
    const tree = renderBubble(
      message({
        role: 'assistant',
        attachments: [
          imageAttachment({
            id: 'active-data',
            dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
            url: 'intent://open/image',
          }),
          imageAttachment({
            id: 'private-network',
            dataUrl: undefined,
            url: 'https://127.0.0.1/image.png',
          }),
          imageAttachment({
            id: 'safe-remote',
            dataUrl: undefined,
            url: 'https://cdn.example.test/image.png',
          }),
        ],
      }),
    )
    const images = findAllByType(tree, 'img')

    expect(images).toHaveLength(1)
    expect(images[0]?.props.src).toBe('https://cdn.example.test/image.png')
    expect(images[0]?.props.referrerPolicy).toBe('no-referrer')
  })

  it('contains synchronous message action failures at the leaf action boundary', () => {
    const onDeleteMessage = vi.fn((messageId: string) => {
      throw new Error(`delete failed: ${messageId}`)
    })
    const tree = renderBubble(message({ createdAt: 404 }), {
      onDeleteMessage,
    })

    expect(() =>
      clickButton(tree, 'button.deleteMessage: message.role.user, time:404'),
    ).not.toThrow()
    expect(onDeleteMessage).toHaveBeenCalledWith('message-1')
  })

  it('contains rejected message actions without leaking the promise', async () => {
    const onRegenerateAssistantMessage = vi.fn((messageId: string) =>
      Promise.reject(new Error(`regenerate failed: ${messageId}`)),
    )
    const tree = renderBubble(
      message({
        role: 'assistant',
        createdAt: 505,
      }),
      { onRegenerateAssistantMessage },
    )

    clickButton(tree, 'button.regenerate: message.role.assistant, time:505')
    await Promise.resolve()

    expect(onRegenerateAssistantMessage).toHaveBeenCalledWith('message-1')
  })
})
