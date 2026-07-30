import type { Translator } from '../i18n'
import type { Conversation } from '../types'

export const CONVERSATION_TITLE_MAX_LENGTH = 80

const defaultConversationTitles = new Set([
  '新建对话',
  'New chat',
  'Nuevo chat',
  'नई चैट',
  'محادثة جديدة',
  'Nova conversa',
  'Новый чат',
  '新しいチャット',
  '새 대화',
  'Nouveau chat',
])

export function cleanConversationTitle(text: string, t: Translator): string {
  const title = text.replace(/\s+/g, ' ').trim()
  return title.length > 28
    ? `${title.slice(0, 28)}...`
    : title || t('conversation.newTitle')
}

export function displayConversationTitle(title: string, t: Translator): string {
  return defaultConversationTitles.has(title)
    ? t('conversation.newTitle')
    : title
}

export function normalizeConversationTitleDraft(
  value: string,
  t: Translator,
): string {
  return (
    value
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CONVERSATION_TITLE_MAX_LENGTH) || t('conversation.newTitle')
  )
}

export function normalizeConversationSearchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}

export function conversationMatchesSearch(
  conversation: Conversation,
  normalizedQuery: string,
  t: Translator,
): boolean {
  const haystack = [
    displayConversationTitle(conversation.title, t),
    conversation.model,
    ...conversation.messages.map((message) => message.content),
  ].join('\n')

  return normalizeConversationSearchValue(haystack).includes(normalizedQuery)
}
