import type { ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { ChatMessage, MessageAttachment } from '../../types'
import { MessageContextMenu } from '../MessageContextMenu'

vi.mock('react-dom', () => ({
  flushSync: vi.fn((callback: () => void) => callback()),
}))

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

function renderMenu(
  selectedMessage: ChatMessage,
  overrides: Partial<Parameters<typeof MessageContextMenu>[0]> = {},
): ReactElement {
  return MessageContextMenu({
    formatMessageTime: (timestamp) => `time:${timestamp}`,
    menu: { messageId: selectedMessage.id, x: 8, y: 16 },
    menuRef: { current: null },
    message: selectedMessage,
    sending: false,
    speakingMessageId: '',
    t,
    onClose: vi.fn(),
    onCopyMessage: vi.fn(),
    onDeleteMessage: vi.fn(),
    onDownloadAttachment: vi.fn(),
    onKeyDown: vi.fn(),
    onRegenerateAssistantMessage: vi.fn(),
    onSpeakMessage: vi.fn(),
    onStartEditingMessage: vi.fn(),
    onStopSpeakingMessage: vi.fn(),
    ...overrides,
  }) as ReactElement
}

describe('MessageContextMenu', () => {
  it('names the menu and user message actions with the message context', () => {
    const tree = renderMenu(message({ id: 'message-1', createdAt: 101 }))
    const labels = buttonLabels(tree)
    const props = tree.props as Record<string, unknown>

    expect(props['aria-label']).toBe('message.role.user, time:101')
    expect(labels).toContain('button.copy: message.role.user, time:101')
    expect(labels).toContain(
      'button.editMessage: message.role.user, time:101',
    )
    expect(labels).toContain(
      'button.deleteMessage: message.role.user, time:101',
    )
    expect(labels).not.toContain('button.copy')
    expect(labels).not.toContain('button.deleteMessage')
  })

  it('names assistant actions and image download with context', () => {
    const labels = buttonLabels(
      renderMenu(
        message({
          id: 'assistant-message',
          role: 'assistant',
          content: 'Here is the chart',
          createdAt: 303,
          attachments: [imageAttachment()],
        }),
      ),
    )

    expect(labels).toContain(
      'button.copy: message.role.assistant, time:303',
    )
    expect(labels).toContain(
      'button.speakMessage: message.role.assistant, time:303',
    )
    expect(labels).toContain(
      'button.downloadImage: Release chart, message.role.assistant, time:303',
    )
    expect(labels).toContain(
      'button.regenerate: message.role.assistant, time:303',
    )
    expect(labels).toContain(
      'button.deleteMessage: message.role.assistant, time:303',
    )
    expect(labels).not.toContain('button.downloadImage')
  })

  it('contains synchronous context message action failures at the leaf action boundary', () => {
    const actionOrder: string[] = []
    const onClose = vi.fn()
    const onCopyMessage = vi.fn((targetMessage: ChatMessage) => {
      actionOrder.push('copy')
      throw new Error(`copy failed: ${targetMessage.id}`)
    })
    onClose.mockImplementation(() => {
      actionOrder.push('close')
    })
    vi.mocked(flushSync).mockClear()
    const tree = renderMenu(message({ createdAt: 404 }), {
      onClose,
      onCopyMessage,
    })

    expect(() =>
      clickButton(tree, 'button.copy: message.role.user, time:404'),
    ).not.toThrow()
    expect(onClose).toHaveBeenCalledOnce()
    expect(onCopyMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'message-1' }),
    )
    expect(flushSync).toHaveBeenCalledWith(onClose)
    expect(actionOrder).toEqual(['close', 'copy'])
  })

  it('contains rejected context message actions without leaking the promise', async () => {
    const onRegenerateAssistantMessage = vi.fn((messageId: string) =>
      Promise.reject(new Error(`regenerate failed: ${messageId}`)),
    )
    const tree = renderMenu(
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
