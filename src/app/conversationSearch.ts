import type { Conversation } from '../types'
import { normalizeConversationSearchValue } from '../services/conversations'

export function filterConversations(
  conversations: readonly Conversation[],
  query: string,
): Conversation[] {
  const normalizedQuery = normalizeConversationSearchValue(query.trim())
  if (!normalizedQuery) return [...conversations]

  return conversations.filter((conversation) =>
    [
      conversation.title,
      conversation.model,
      ...conversation.messages.map(({ content }) => content),
    ].some(
      (value) =>
        normalizeConversationSearchValue(value).includes(normalizedQuery),
    ),
  )
}
