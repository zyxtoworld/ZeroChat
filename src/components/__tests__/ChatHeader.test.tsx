import { createRef, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { SyncChromeState } from '../../services/syncChrome'
import type { ProviderConfig } from '../../types'
import { ChatHeader } from '../ChatHeader'
import { ChatHeaderTitle } from '../ChatHeaderTitle'

const t = ((key: string) => key) as Translator

function provider(): ProviderConfig {
  return {
    id: 'openai',
    baseUrl: 'https://api.example.test/v1',
    capabilities: ['chat'],
    createdAt: 1,
    enabled: true,
    kind: 'openai-compatible',
    model: 'gpt-5-5',
    name: 'OpenAI',
    needsApiKey: true,
    updatedAt: 1,
  }
}

const syncChrome: SyncChromeState = {
  mode: 'local',
  modeLabel: 'mode.local',
  pillLabel: 'setting.sync: mode.local',
  pillText: 'mode.local',
  requirement: '',
  statusText: 'sync.status.localMode',
}

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findByAriaLabel(
  node: unknown,
  ariaLabel: string,
): { props: Record<string, unknown> } {
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props

    if (props?.['aria-label'] === ariaLabel) {
      return { props }
    }
  }

  for (const child of nodeChildren(node)) {
    try {
      return findByAriaLabel(child, ariaLabel)
    } catch {
      // Keep walking sibling branches.
    }
  }

  throw new Error(`Missing aria-label: ${ariaLabel}`)
}

function renderHeader(
  overrides: Partial<Parameters<typeof ChatHeader>[0]> = {},
): ReactElement {
  const activeProvider = provider()

  return ChatHeader({
    activeConversationTitle: 'General',
    activeImageModel: '',
    activeModel: activeProvider.model,
    activeModelLabel: activeProvider.model,
    activeProvider,
    activeProviderLabel: activeProvider.name,
    chatModelMenuOpen: false,
    chatModelMenuRef: createRef<HTMLDivElement>(),
    chatModelProviders: [activeProvider],
    chatModelTriggerRef: createRef<HTMLButtonElement>(),
    composerMode: 'chat',
    imageTaskMode: 'generate',
    sidebarOpenButtonRef: createRef<HTMLButtonElement>(),
    conversationTitleButtonRef: createRef<HTMLButtonElement>(),
    conversationTitleDraft: 'General',
    conversationTitleInputRef: createRef<HTMLInputElement>(),
    editingConversationTitle: false,
    expandedChatProviderId: activeProvider.id,
    isOnline: true,
    providerModelHint: null,
    syncChrome,
    syncing: false,
    t,
    onConversationTitleBlur: vi.fn(),
    onConversationTitleDraftChange: vi.fn(),
    onConversationTitleKeyDown: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenSidebar: vi.fn(),
    onSelectAudioTranscriptionModel: vi.fn(),
    onSelectChatModel: vi.fn(),
    onSelectImageModel: vi.fn(),
    onStartConversationTitleEdit: vi.fn(),
    onToggleModelMenu: vi.fn(),
    onToggleProviderExpanded: vi.fn(),
    ...overrides,
  }) as ReactElement
}

describe('ChatHeader', () => {
  it('keeps mobile chrome icon buttons on the app tooltip contract', () => {
    const tree = renderHeader()

    for (const label of ['button.openSidebar', 'button.openSettings']) {
      const button = findByAriaLabel(tree, label)

      expect(button.props.title).toBeUndefined()
      expect(button.props['data-tooltip']).toBe(label)
    }
  })

  it('keeps conversation rename controls on the custom tooltip contract', () => {
    for (const editingConversationTitle of [false, true]) {
      const tree = ChatHeaderTitle({
        activeConversationTitle: 'General',
        conversationTitleButtonRef: createRef<HTMLButtonElement>(),
        conversationTitleDraft: 'General',
        conversationTitleInputRef: createRef<HTMLInputElement>(),
        editingConversationTitle,
        t,
        onConversationTitleBlur: vi.fn(),
        onConversationTitleDraftChange: vi.fn(),
        onConversationTitleKeyDown: vi.fn(),
        onStartConversationTitleEdit: vi.fn(),
      })
      const renameControl = findByAriaLabel(tree, 'conversation.renameLabel')

      expect(renameControl.props.title).toBeUndefined()
      expect(renameControl.props['data-tooltip']).toBe('conversation.renameHint')
    }
  })
})
