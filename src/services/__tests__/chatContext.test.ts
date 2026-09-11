import { describe, expect, it } from 'vitest'

import { selectContextMessages } from '../chat'
import type { ChatMessage } from '../../types'

function message(
  id: string,
  role: ChatMessage['role'],
  content = id,
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: Number(id.replace(/\D/g, '')) || 1,
    status: 'done',
  }
}

describe('chat context window selection', () => {
  it('keeps all system prompts while trimming user and assistant turns', () => {
    const messages: ChatMessage[] = [
      message('system-base', 'system', 'Base system prompt'),
      ...Array.from({ length: 10 }, (_, index) =>
        message(
          `chat-${index + 1}`,
          index % 2 === 0 ? 'user' : 'assistant',
          `Chat turn ${index + 1}`,
        ),
      ),
      message('system-skill', 'system', 'Injected Skill prompt'),
    ]

    const selected = selectContextMessages(messages, 4)

    expect(selected.map((item) => item.id)).toEqual([
      'system-base',
      'system-skill',
      'chat-7',
      'chat-8',
      'chat-9',
      'chat-10',
    ])
  })

  it('normalizes unsafe limits before slicing the chat history', () => {
    const messages = Array.from({ length: 12 }, (_, index) =>
      message(`chat-${index + 1}`, 'user'),
    )

    expect(selectContextMessages(messages, 0)).toHaveLength(4)
    expect(selectContextMessages(messages, Number.NaN)).toHaveLength(12)
  })

  it('drops an orphan assistant at the context boundary without exceeding the limit', () => {
    const messages: ChatMessage[] = [
      message('turn-25', 'user'),
      message('turn-26', 'assistant'),
      message('turn-27', 'user'),
      message('turn-28', 'assistant'),
      message('turn-29', 'user'),
      message('turn-30', 'assistant'),
      message('prompt', 'user'),
    ]

    expect(selectContextMessages(messages, 6).map((item) => item.id)).toEqual([
      'turn-27',
      'turn-28',
      'turn-29',
      'turn-30',
      'prompt',
    ])
  })
})
