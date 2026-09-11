import { describe, expect, it } from 'vitest'

import type { Translator } from '../../i18n'
import type { Conversation } from '../../types'
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  CONVERSATION_PLACEHOLDER_TITLE,
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

  it('maps only the canonical placeholder key to the active locale', () => {
    expect(displayConversationTitle('新建对话', t)).toBe('新建对话')
    expect(displayConversationTitle('Nouveau chat', t)).toBe('Nouveau chat')
    expect(displayConversationTitle('conversation.newTitle', t)).toBe(
      'Localized new chat',
    )
    expect(displayConversationTitle('Roadmap', t)).toBe('Roadmap')
  })

  it('does not translate a user title that matches a localized placeholder', () => {
    expect(displayConversationTitle('New chat', t)).toBe('New chat')
  })

  it('normalizes edited titles to the guarded maximum length', () => {
    const draft = normalizeConversationTitleDraft(
      `  ${'Title '.repeat(30)}  `,
    )

    expect(draft).toHaveLength(CONVERSATION_TITLE_MAX_LENGTH)
    expect(normalizeConversationTitleDraft('   ')).toBe(
      CONVERSATION_PLACEHOLDER_TITLE,
    )
  })

  it('keeps surrogate pairs, ZWJ, and combining graphemes intact at title limits', () => {
    const family = '👩‍💻'
    const generated = `${'a'.repeat(27)}${family}z`
    const edited = `${'a'.repeat(79)}${family}`
    const combining = `${'a'.repeat(79)}e\u0301`

    expect(cleanConversationTitle(generated, t)).toBe(
      `${'a'.repeat(27)}${family}...`,
    )
    expect(normalizeConversationTitleDraft(edited)).toBe(edited)
    expect(normalizeConversationTitleDraft(combining)).toBe(combining)
  })

  it('turns embedded control characters into title whitespace', () => {
    const value = 'alpha\u0000beta\u007Fgamma'

    expect(cleanConversationTitle(value, t)).toBe('alpha beta gamma')
    expect(normalizeConversationTitleDraft(value)).toBe(
      'alpha beta gamma',
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
        normalizeConversationSearchValue('new chat'),
        t,
      ),
    ).toBe(true)
  })
})
