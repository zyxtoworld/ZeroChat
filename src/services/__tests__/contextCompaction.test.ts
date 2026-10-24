import { describe, expect, it } from 'vitest'

import type { ChatMessage, ProviderConfig } from '../../types'
import { prepareConversationContext } from '../contextCompaction'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'OpenAI-compatible relay',
    kind: 'openai-compatible',
    baseUrl: 'https://relay.example.com/v1',
    model: 'model-1',
    models: ['model-1'],
    enabled: true,
    needsApiKey: true,
    custom: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function messages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index} ${'long context '.repeat(400)}`,
    createdAt: index + 1,
    status: 'done' as const,
  }))
}

describe('context compaction', () => {
  it('uses remote Responses compaction output when the official endpoint is eligible', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      Response.json({ output: [{ type: 'compaction', encrypted_content: 'opaque' }] })
    ) as typeof fetch

    try {
      const result = await prepareConversationContext({
        apiKey: 'key',
        maxInputTokens: 1_024,
        messages: messages(8),
        model: 'gpt-5',
        provider: provider({
          name: 'OpenAI',
          kind: 'openai-responses',
          baseUrl: 'https://api.openai.com/v1',
          custom: false,
        }),
        proxyToken: '',
        signal: new AbortController().signal,
      })

      expect(result.compaction?.source).toBe('remote-compaction')
      expect(result.compactionItems).toEqual([
        { type: 'compaction', encrypted_content: 'opaque' },
      ])
      expect(result.messages).toEqual([])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('falls back to a local provider summary and keeps the newest turn', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages?: unknown[] }
      expect(body.messages).toBeDefined()
      return Response.json({ choices: [{ message: { content: 'handoff summary' } }] })
    }) as typeof fetch

    try {
      const all = messages(8)
      const result = await prepareConversationContext({
        apiKey: 'key',
        maxInputTokens: 1_024,
        messages: all,
        model: 'model-1',
        provider: provider(),
        proxyToken: '',
        signal: new AbortController().signal,
      })

      expect(result.compaction?.source).toBe('local-summary')
      expect(result.messages.at(-1)?.id).toBe(all.at(-1)?.id)
      expect(result.messages.some((message) => message.content.includes('handoff summary'))).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('replays a stored checkpoint only through its boundary and keeps visible history untouched', async () => {
    const all = messages(4)
    const result = await prepareConversationContext({
      apiKey: 'key',
      existingCompaction: {
        source: 'remote-compaction',
        items: [{ type: 'compaction', encrypted_content: 'opaque' }],
        compactedThroughMessageId: all[1].id,
        model: 'model-1',
        createdAt: 10,
      },
      maxInputTokens: 12_000,
      messages: all,
      model: 'model-1',
      provider: provider(),
      proxyToken: '',
      signal: new AbortController().signal,
    })

    expect(result.compactionItems).toEqual([
      { type: 'compaction', encrypted_content: 'opaque' },
    ])
    expect(result.messages.map((message) => message.id)).toEqual(['message-2', 'message-3'])
  })
})
