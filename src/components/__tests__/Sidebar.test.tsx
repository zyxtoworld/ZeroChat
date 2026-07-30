import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { Conversation } from '../../types'
import { Sidebar } from '../Sidebar'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function conversation(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    createdAt: 1,
    messages: [],
    model: 'gpt-test',
    providerId: 'provider-1',
    title: 'Roadmap',
    updatedAt: 2,
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

function findAllByClassNameIncludes(
  node: unknown,
  classNamePart: string,
): { props: Record<string, unknown> }[] {
  const matches: { props: Record<string, unknown> }[] = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (
      typeof props?.className === 'string' &&
      props.className.includes(classNamePart)
    ) {
      matches.push({ props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByClassNameIncludes(child, classNamePart))
  }

  return matches
}

function renderSidebar(conversations: Conversation[]): ReactElement {
  return Sidebar({
    activeConversationId: 'conversation-2',
    closeButtonRef: { current: null },
    conversationSearch: '',
    conversationSearchActive: false,
    conversations,
    hiddenFromAssistiveTech: false,
    isOpen: true,
    newConversationShortcut: 'Ctrl+N',
    newConversationTitle: 'button.newChat',
    notice: null,
    openedByPointer: false,
    sidebarTabIndex: undefined,
    syncChrome: {
      mode: 'local',
      modeLabel: 'mode.local',
      pillLabel: 'setting.sync',
      pillText: 'mode.local',
      requirement: '',
      statusText: 'status.localSaved',
    },
    syncing: false,
    t,
    timeLabel: (timestamp) => `time:${timestamp}`,
    onCloseSidebar: vi.fn(),
    onConversationSearchChange: vi.fn(),
    onCreateConversation: vi.fn(),
    onDeleteConversation: vi.fn(),
    onOpenSettings: vi.fn(),
    onSelectConversation: vi.fn(),
  }) as ReactElement
}

describe('Sidebar', () => {
  it('exposes the active conversation and names delete actions by conversation', () => {
    const tree = renderSidebar([
      conversation(),
      conversation({
        id: 'conversation-2',
        title: 'New chat',
        updatedAt: 3,
      }),
    ])
    const conversationButtons = findAllByClassNameIncludes(
      tree,
      'conversation-select',
    )
    const deleteButtons = findAllByClassNameIncludes(
      tree,
      'conversation-delete',
    )

    expect(conversationButtons).toHaveLength(2)
    expect(conversationButtons[0].props['aria-current']).toBeUndefined()
    expect(conversationButtons[1].props['aria-current']).toBe('page')
    expect(deleteButtons).toHaveLength(2)
    expect(deleteButtons[0].props['aria-label']).toBe(
      'button.deleteConversation: Roadmap',
    )
    expect(deleteButtons[1].props['aria-label']).toBe(
      'button.deleteConversation: conversation.newTitle',
    )
    expect(deleteButtons[1].props.title).toBeUndefined()
  })
})
