import { describe, expect, it, vi } from 'vitest'

import type { Conversation } from '../../types'
import { filterConversations } from '../conversationSearch'

function conversation(
  id: string,
  title: string,
  messageContent: string,
): Conversation {
  return {
    id,
    title,
    providerId: 'provider',
    model: 'model',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        id: `${id}-message`,
        role: 'user',
        content: messageContent,
        createdAt: 1,
        status: 'done',
      },
    ],
  }
}

describe('conversation search', () => {
  const conversations = [
    conversation('one', 'Résumé review', 'quarterly planning'),
    conversation('two', '旅行', '京都 itinerary'),
  ]

  it('matches normalized titles and message content', () => {
    expect(filterConversations(conversations, 'resume').map(({ id }) => id)).toEqual([
      'one',
    ])
    expect(filterConversations(conversations, 'ITINERARY').map(({ id }) => id)).toEqual([
      'two',
    ])
    expect(filterConversations(conversations, 'MODEL').map(({ id }) => id)).toEqual([
      'one',
      'two',
    ])
  })

  it('returns the complete list for an empty query and no rows for a miss', () => {
    expect(filterConversations(conversations, '   ')).toEqual(conversations)
    expect(filterConversations(conversations, 'not-present')).toEqual([])
  })

  it('uses locale-independent casing for the real sidebar search caller', () => {
    const original = String.prototype.toLocaleLowerCase
    const spy = vi
      .spyOn(String.prototype, 'toLocaleLowerCase')
      .mockImplementation(function (this: string, locales) {
        const lowered = original.call(this, locales)
        return this.includes('I') ? lowered.replace(/^i/u, 'ı') : lowered
      })

    try {
      expect(
        filterConversations(
          [conversation('istanbul', 'Istanbul notes', 'city')],
          'istan',
        ).map(({ id }) => id),
      ).toEqual(['istanbul'])
    } finally {
      spy.mockRestore()
    }
  })
})
