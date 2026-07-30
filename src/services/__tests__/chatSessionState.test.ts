import { describe, expect, it } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  Conversation,
  ProviderConfig,
} from '../../types'
import { deriveChatSessionState } from '../chatSessionState'

const t: Translator = (key) => {
  const translations: Record<string, string> = {
    'conversation.newTitle': '新对话',
  }

  return translations[key] ?? key
}

function provider(
  id: string,
  patch: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    baseUrl: `https://${id}.example.com/v1`,
    createdAt: 1,
    enabled: true,
    id,
    kind: 'openai-compatible',
    model: `${id}-chat`,
    models: [`${id}-chat`, `${id}-image`],
    name: id,
    needsApiKey: true,
    updatedAt: 1,
    ...patch,
  }
}

function conversation(
  id: string,
  providerId: string,
  patch: Partial<Conversation> = {},
): Conversation {
  return {
    createdAt: 1,
    id,
    messages: [],
    model: '',
    providerId,
    title: `Chat ${id}`,
    updatedAt: 1,
    ...patch,
  }
}

function appData(
  providers: ProviderConfig[],
  conversations: Conversation[],
  activeConversationId = conversations[0]?.id ?? '',
): AppData {
  return {
    conversations,
    preferences: {
      activeConversationId,
      compactMode: false,
      firstRunDone: true,
      language: 'zh-CN',
      theme: 'system',
    },
    providers,
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt: 1,
    version: 1,
  }
}

describe('chat session state derivation', () => {
  it('selects the active conversation and enabled conversation provider', () => {
    const openai = provider('openai')
    const local = provider('local')
    const data = appData(
      [local, openai],
      [
        conversation('first', 'local'),
        conversation('second', 'openai', { model: 'openai-chat' }),
      ],
      'second',
    )
    const state = deriveChatSessionState({
      conversationSearch: '',
      data,
      selectedProviderId: 'local',
      t,
    })

    expect(state.activeConversation?.id).toBe('second')
    expect(state.activeConversationTitle).toBe('Chat second')
    expect(state.activeProvider?.id).toBe('openai')
    expect(state.activeModel).toBe('openai-chat')
    expect(state.activeImageModel).toBe('openai-image')
    expect(state.selectedProvider?.id).toBe('local')
  })

  it('falls back to the first enabled provider before a disabled conversation provider', () => {
    const disabled = provider('disabled', { enabled: false })
    const enabled = provider('enabled')
    const data = appData(
      [disabled, enabled],
      [conversation('chat', 'disabled')],
    )

    expect(
      deriveChatSessionState({
        conversationSearch: '',
        data,
        selectedProviderId: '',
        t,
      }).activeProvider?.id,
    ).toBe('enabled')
  })

  it('keeps disabled providers visible after enabled providers', () => {
    const disabled = provider('disabled', { enabled: false })
    const enabled = provider('enabled')
    const state = deriveChatSessionState({
      conversationSearch: '',
      data: appData([disabled, enabled], [conversation('chat', 'enabled')]),
      selectedProviderId: '',
      t,
    })

    expect(state.visibleProviders.map((item) => item.id)).toEqual([
      'enabled',
      'disabled',
    ])
    expect(state.chatModelProviders.map((item) => item.id)).toEqual(['enabled'])
  })

  it('filters conversations by localized title, model, and message text', () => {
    const openai = provider('openai')
    const data = appData(
      [openai],
      [
        conversation('welcome', 'openai', {
          title: '新建对话',
        }),
        conversation('model', 'openai', {
          model: 'reasoning-model',
        }),
        conversation('message', 'openai', {
          messages: [
            {
              content: 'Look for deployment notes',
              createdAt: 1,
              id: 'message-1',
              role: 'user',
            },
          ],
        }),
      ],
    )

    expect(
      deriveChatSessionState({
        conversationSearch: '新对话',
        data,
        selectedProviderId: '',
        t,
      }).filteredConversations.map((item) => item.id),
    ).toEqual(['welcome'])
    expect(
      deriveChatSessionState({
        conversationSearch: 'reasoning',
        data,
        selectedProviderId: '',
        t,
      }).filteredConversations.map((item) => item.id),
    ).toEqual(['model'])
    expect(
      deriveChatSessionState({
        conversationSearch: 'DEPLOYMENT',
        data,
        selectedProviderId: '',
        t,
      }).filteredConversations.map((item) => item.id),
    ).toEqual(['message'])
  })

  it('returns empty state when app data is not loaded yet', () => {
    const state = deriveChatSessionState({
      conversationSearch: 'anything',
      data: null,
      selectedProviderId: '',
      t,
    })

    expect(state.activeConversation).toBeNull()
    expect(state.activeProvider).toBeNull()
    expect(state.selectedProvider).toBeNull()
    expect(state.filteredConversations).toEqual([])
    expect(state.conversationSearchActive).toBe(true)
  })
})
