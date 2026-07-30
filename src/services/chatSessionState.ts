import type { Translator } from '../i18n'
import type {
  AppData,
  Conversation,
  ProviderConfig,
} from '../types'
import {
  conversationMatchesSearch,
  displayConversationTitle,
  normalizeConversationSearchValue,
} from './conversations'
import { imageModelForProvider } from './providerModels'
import {
  modelForConversation,
  orderedProviders,
} from './providerConfig'

export interface ChatSessionState {
  activeConversation: Conversation | null
  activeConversationTitle: string
  activeImageModel: string
  activeModel: string
  activeProvider: ProviderConfig | null
  chatModelProviders: ProviderConfig[]
  conversationSearchActive: boolean
  enabledChatProviders: ProviderConfig[]
  filteredConversations: Conversation[]
  selectedProvider: ProviderConfig | null
  visibleProviders: ProviderConfig[]
}

interface ChatSessionStateOptions {
  conversationSearch: string
  data: AppData | null
  selectedProviderId: string
  t: Translator
}

export function deriveChatSessionState({
  conversationSearch,
  data,
  selectedProviderId,
  t,
}: ChatSessionStateOptions): ChatSessionState {
  const activeConversation =
    data?.conversations.find(
      (conversation) =>
        conversation.id === data.preferences.activeConversationId,
    ) ??
    data?.conversations[0] ??
    null
  const visibleProviders = orderedProviders(data?.providers ?? [])
  const enabledChatProviders = visibleProviders.filter(
    (provider) => provider.enabled,
  )
  const activeProvider = data && activeConversation
    ? activeProviderForConversation(data, activeConversation, enabledChatProviders)
    : null
  const searchQuery = conversationSearch.trim()
  const normalizedSearchQuery = normalizeConversationSearchValue(searchQuery)
  const filteredConversations =
    data && normalizedSearchQuery
      ? data.conversations.filter((conversation) =>
          conversationMatchesSearch(conversation, normalizedSearchQuery, t),
        )
      : data?.conversations ?? []
  const selectedProvider =
    data?.providers.find((provider) => provider.id === selectedProviderId) ??
    data?.providers[0] ??
    null

  return {
    activeConversation,
    activeConversationTitle: activeConversation
      ? displayConversationTitle(activeConversation.title, t)
      : '',
    activeImageModel: imageModelForProvider(activeProvider),
    activeModel: modelForConversation(activeConversation, activeProvider),
    activeProvider,
    chatModelProviders: enabledChatProviders,
    conversationSearchActive: searchQuery.length > 0,
    enabledChatProviders,
    filteredConversations,
    selectedProvider,
    visibleProviders,
  }
}

function activeProviderForConversation(
  data: AppData,
  activeConversation: Conversation,
  enabledChatProviders: ProviderConfig[],
): ProviderConfig | null {
  const conversationProvider = data.providers.find(
    (provider) => provider.id === activeConversation.providerId,
  )

  return (
    (conversationProvider?.enabled ? conversationProvider : undefined) ??
    enabledChatProviders[0] ??
    conversationProvider ??
    data.providers[0] ??
    null
  )
}
