import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { Conversation } from '../../types'
import {
  AppMainView,
  type AppMainViewProps,
} from '../AppMainView'
import { Sidebar } from '../Sidebar'

const t = ((key: string) => key) as Translator

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

function findByType(
  node: unknown,
  type: unknown,
): { props: Record<string, unknown> } {
  if (node && typeof node === 'object') {
    const element = node as { type?: unknown; props?: Record<string, unknown> }
    if (element.type === type && element.props) {
      return { props: element.props }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findByTypeOptional(child, type)
    if (found) return found
  }

  throw new Error('Missing element type')
}

function findByTypeOptional(
  node: unknown,
  type: unknown,
): { props: Record<string, unknown> } | null {
  try {
    return findByType(node, type)
  } catch {
    return null
  }
}

function renderAppMainView(
  overrides: Partial<AppMainViewProps> = {},
): ReactElement {
  const activeConversation = conversation()

  return AppMainView({
    activeConversation,
    closeSidebar: vi.fn(),
    conversationSearch: '',
    conversationSearchActive: false,
    createNewConversation: vi.fn(),
    currentNotice: {
      anchorId: '',
      target: 'sidebar',
      text: '',
      tone: 'success',
    },
    deleteConversation: vi.fn(async () => null),
    filteredConversations: [activeConversation],
    newConversationShortcut: 'Ctrl+N',
    newConversationTitle: 'button.newChat',
    openSettings: vi.fn(),
    setActiveConversation: vi.fn(),
    setConversationSearch: vi.fn(),
    setNotice: vi.fn(),
    sidebarCloseButtonRef: { current: null },
    sidebarHiddenFromAssistiveTech: false,
    sidebarOpen: true,
    sidebarOpenedByPointer: false,
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
    systemDateLocales: ['en-US'],
    t,
    ...overrides,
  } as unknown as AppMainViewProps) as ReactElement
}

describe('AppMainView', () => {
  it('reports rejected sidebar delete actions instead of leaking the promise', async () => {
    const deleteConversation = vi.fn(() =>
      Promise.reject(new Error('dialog failed')),
    )
    const setNotice = vi.fn()
    const tree = renderAppMainView({
      deleteConversation,
      setNotice,
    })
    const sidebar = findByType(tree, Sidebar)

    ;(sidebar.props.onDeleteConversation as (conversationId: string) => void)(
      'conversation-1',
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(deleteConversation).toHaveBeenCalledWith('conversation-1')
    expect(setNotice).toHaveBeenCalledWith(
      'notice.conversationSaveUnavailable',
      'error',
      'sidebar',
    )
  })

  it('contains sidebar delete failure reporter failures', async () => {
    const deleteConversation = vi.fn(() =>
      Promise.reject(new Error('dialog failed')),
    )
    const setNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })
    const tree = renderAppMainView({
      deleteConversation,
      setNotice,
    })
    const sidebar = findByType(tree, Sidebar)

    ;(sidebar.props.onDeleteConversation as (conversationId: string) => void)(
      'conversation-1',
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(deleteConversation).toHaveBeenCalledWith('conversation-1')
    expect(setNotice).toHaveBeenCalledWith(
      'notice.conversationSaveUnavailable',
      'error',
      'sidebar',
    )
  })
})
