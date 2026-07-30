import { describe, expect, it } from 'vitest'

import type { Translator } from '../../i18n'
import type { Conversation } from '../../types'
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  cleanConversationTitle,
  conversationMatchesSearch,
  displayConversationTitle,
  normalizeConversationSearchValue,
  normalizeConversationTitleDraft,
} from '../conversations'

const t: Translator = (key) =>
  key === 'conversation.newTitle' ? 'Localized new chat' : key

function conversation(
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: 'conversation-1',
    title: 'Project notes',
    providerId: 'openai',
    model: 'gpt-5.4-mini',
    messages: [
      {
        id: 'message-1',
        role: 'assistant',
        content: 'Resume the café planning thread.',
        createdAt: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('conversation helpers', () => {
  it('cleans generated titles without losing the localized fallback', () => {
    expect(cleanConversationTitle('   ', t)).toBe('Localized new chat')
    expect(cleanConversationTitle('  one   two  ', t)).toBe('one two')
    expect(cleanConversationTitle('x'.repeat(40), t)).toBe(
      `${'x'.repeat(28)}...`,
    )
  })

  it('maps legacy default titles to the active locale', () => {
    expect(displayConversationTitle('新建对话', t)).toBe('Localized new chat')
    expect(displayConversationTitle('Nouveau chat', t)).toBe(
      'Localized new chat',
    )
    expect(displayConversationTitle('Roadmap', t)).toBe('Roadmap')
  })

  it('normalizes edited titles to the guarded maximum length', () => {
    const draft = normalizeConversationTitleDraft(
      `  ${'Title '.repeat(30)}  `,
      t,
    )

    expect(draft).toHaveLength(CONVERSATION_TITLE_MAX_LENGTH)
    expect(normalizeConversationTitleDraft('   ', t)).toBe(
      'Localized new chat',
    )
  })

  it('matches search across title, model, and normalized message text', () => {
    const item = conversation()
    const query = normalizeConversationSearchValue('CAFE')

    expect(conversationMatchesSearch(item, query, t)).toBe(true)
    expect(
      conversationMatchesSearch(
        item,
        normalizeConversationSearchValue('gpt-5.4'),
        t,
      ),
    ).toBe(true)
    expect(
      conversationMatchesSearch(
        conversation({ title: 'New chat' }),
        normalizeConversationSearchValue('localized'),
        t,
      ),
    ).toBe(true)
  })
})
