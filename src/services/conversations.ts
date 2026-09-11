import type { Translator } from '../i18n'
import type { Conversation } from '../types'

export const CONVERSATION_TITLE_MAX_LENGTH = 80
export const AUTO_CONVERSATION_TITLE_MAX_LENGTH = 28
export const CONVERSATION_PLACEHOLDER_TITLE = 'conversation.newTitle'

const defaultConversationTitles = new Set([
  CONVERSATION_PLACEHOLDER_TITLE,
])

function splitConversationGraphemes(value: string): string[] {
  if (
    typeof Intl !== 'undefined' &&
    typeof Intl.Segmenter === 'function'
  ) {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value),
      ({ segment }) => segment,
    )
  }

  return Array.from(value)
}

export function truncateConversationGraphemes(
  value: string,
  maxLength: number,
): string {
  return splitConversationGraphemes(value).slice(0, maxLength).join('')
}

export function normalizeConversationTitleText(text: string): string {
  return text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanConversationTitle(text: string, t: Translator): string {
  const title = normalizeConversationTitleText(text)
  const truncated = truncateConversationGraphemes(
    title,
    AUTO_CONVERSATION_TITLE_MAX_LENGTH,
  )
  return truncated !== title
    ? `${truncated}...`
    : title || t('conversation.newTitle')
}

export function displayConversationTitle(title: string, t: Translator): string {
  return defaultConversationTitles.has(title)
    ? t('conversation.newTitle')
    : title
}

export function normalizeConversationTitleDraft(
  value: string,
): string {
  return (
    truncateConversationGraphemes(
      normalizeConversationTitleText(value),
      CONVERSATION_TITLE_MAX_LENGTH,
    ) || CONVERSATION_PLACEHOLDER_TITLE
  )
}

export function normalizeConversationSearchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
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
