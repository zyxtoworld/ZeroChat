import assert from 'node:assert/strict'
import test from 'node:test'

import worker from '../../cloudflare/sync-worker.js'

class FakeResponse {
  constructor(body = null, init = {}) {
    this.body = body
    this.status = init.status ?? 200
    this.headers = new Headers(init.headers)
    this.webSocket = init.webSocket
  }
}

class FakeSocket extends EventTarget {
  static OPEN = 1

  constructor(peer = null, upstream = false) {
    super()
    this.peer = peer
    this.upstream = upstream
    this.readyState = FakeSocket.OPEN
    this.sent = []
  }

  accept() {}

  send(data) {
    this.sent.push(data)
    if (this.upstream) {
      const parsed = JSON.parse(data)
      if (parsed.type === 'response.create') {
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              type: 'response.output_text.delta',
              delta: 'proxied',
            }),
          }),
        )
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ type: 'response.completed' }),
          }),
        )
      }
      return
    }

    this.peer?.dispatchEvent(new MessageEvent('message', { data }))
  }

  close(code = 1000, reason = '') {
    this.readyState = 3
    this.closeCode = code
    this.closeReason = reason
  }
}

class FakeWebSocketPair {
  constructor() {
    const client = new FakeSocket()
    const server = new FakeSocket(client)
    client.peer = server
    FakeWebSocketPair.last = { client, server }
    this[0] = client
    this[1] = server
  }
}

const originalResponse = globalThis.Response
const originalWebSocketPair = globalThis.WebSocketPair
const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.Response = originalResponse
  globalThis.WebSocketPair = originalWebSocketPair
  globalThis.fetch = originalFetch
})

test('Worker Responses WebSocket route authenticates, proxies, and forwards streaming events', async () => {
  const upstream = new FakeSocket(null, true)
  globalThis.Response = FakeResponse
  globalThis.WebSocketPair = FakeWebSocketPair
  globalThis.fetch = async () => ({ status: 101, webSocket: upstream })

  const response = await worker.fetch(
    new Request('https://worker.example/proxy/ws', {
      method: 'GET',
      headers: { upgrade: 'websocket' },
    }),
    {
      ZEROCHAT_ACCESS_KEY: 'derived-access-key',
    },
  )

  assert.equal(response.status, 101)
  const { client, server } = FakeWebSocketPair.last
  const browserMessages = []
  client.addEventListener('message', (event) => browserMessages.push(event.data))
  client.send(
    JSON.stringify({
      type: 'zerochat.proxy.authorize',
      accessKey: 'derived-access-key',
      providerKind: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    }),
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(browserMessages[0], /zerochat\.proxy\.ready/u)

  client.send(JSON.stringify({ type: 'response.create', model: 'gpt-5', input: 'hello' }))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(upstream.sent.length, 1)
  assert.match(browserMessages.join('\n'), /response\.output_text\.delta/u)
  assert.match(browserMessages.join('\n'), /proxied/u)
  assert.match(browserMessages.join('\n'), /response\.completed/u)
})
