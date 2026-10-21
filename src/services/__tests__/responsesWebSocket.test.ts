import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage, ProviderConfig } from '../../types'
import { streamChat } from '../chat'
import { buildResponsesWebSocketEndpoint } from '../responsesWebSocket'

const message: ChatMessage = {
  id: 'message-1',
  role: 'user',
  content: 'hello',
  createdAt: 1,
}

function provider(): ProviderConfig {
  return {
    id: 'responses-provider',
    name: 'Responses provider',
    kind: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    proxyUrl: 'https://sync.example.test',
    model: 'gpt-5',
    models: ['gpt-5'],
    enabled: true,
    needsApiKey: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function createSocketClass(mode: 'fail' | 'success') {
  return class FakeWebSocket extends EventTarget {
    static readonly OPEN = 1
    readonly url: string
    readyState = 0
    sent: string[] = []

    constructor(url: string) {
      super()
      this.url = url
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN
        this.dispatchEvent(new Event('open'))
        if (mode === 'fail') {
          queueMicrotask(() => this.dispatchEvent(new Event('error')))
        }
      })
    }

    send(value: string) {
      this.sent.push(value)
      if (mode !== 'success') return

      const message = JSON.parse(value) as { type?: string }
      if (message.type === 'zerochat.proxy.authorize') {
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ type: 'zerochat.proxy.ready' }),
          }),
        )
        return
      }

      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'response.output_text.delta',
            delta: 'WS OK',
          }),
        }),
      )
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'response.completed' }),
        }),
      )
    }

    close() {
      this.readyState = 3
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Responses WebSocket transport', () => {
  it('builds a secure Worker WebSocket endpoint for proxied Responses providers', () => {
    expect(buildResponsesWebSocketEndpoint(provider())).toBe(
      'wss://sync.example.test/proxy/ws',
    )
  })

  it('uses WebSocket first and streams Responses events without HTTP', async () => {
    const Socket = createSocketClass('success')
    const fetchMock = vi.fn()
    vi.stubGlobal('WebSocket', Socket)
    vi.stubGlobal('fetch', fetchMock)

    const tokens: string[] = []
    await streamChat({
      provider: provider(),
      apiKey: '',
      proxyToken: 'derived-access-key',
      model: 'gpt-5',
      messages: [message],
      contextMessageLimit: 20,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })

    expect(tokens).toEqual(['WS OK'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to HTTP SSE when WebSocket setup fails before streaming', async () => {
    const Socket = createSocketClass('fail')
    const fetchMock = vi.fn(
      (...args: Parameters<typeof fetch>) => {
        void args
        return Promise.resolve(
          new Response(
            'data: {"type":"response.output_text.delta","delta":"HTTP OK"}\n\ndata: [DONE]\n\n',
            {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            },
          ),
        )
      },
    )
    vi.stubGlobal('WebSocket', Socket)
    vi.stubGlobal('fetch', fetchMock)

    const tokens: string[] = []
    await streamChat({
      provider: provider(),
      apiKey: '',
      proxyToken: 'derived-access-key',
      model: 'gpt-5',
      messages: [message],
      contextMessageLimit: 20,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })

    expect(tokens).toEqual(['HTTP OK'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://sync.example.test/proxy')
  })
})
