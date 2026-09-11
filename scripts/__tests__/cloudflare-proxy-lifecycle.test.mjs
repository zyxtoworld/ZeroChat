import { afterEach, describe, expect, it, vi } from 'vitest'

import worker from '../../cloudflare/sync-worker.js'

const environment = {
  ZEROCHAT_ACCESS_KEY: 'worker-access-key',
}

function proxyRequest(signal) {
  return new Request('https://zerochat.test/proxy', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer provider-key',
      'x-zerochat-access-key': 'worker-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1',
      'x-zerochat-proxy-action': 'chat',
    },
    body: JSON.stringify({ messages: [] }),
  })
}

function streamingProxyRequest(body) {
  return {
    url: 'https://zerochat.test/proxy',
    method: 'POST',
    headers: new Headers({
      'content-type': 'application/json',
      authorization: 'Bearer provider-key',
      'x-zerochat-access-key': 'worker-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1',
      'x-zerochat-proxy-action': 'chat',
    }),
    signal: new AbortController().signal,
    body,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Cloudflare Worker proxy lifecycle', () => {
  it('propagates a client abort to the upstream request signal', async () => {
    const clientController = new AbortController()
    let capturedSignal
    let upstreamAborted = false
    let resolveUpstream
    let markUpstreamEntered
    const upstreamEntered = new Promise((resolve) => {
      markUpstreamEntered = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) => {
        capturedSignal = init.signal
        init.signal?.addEventListener(
          'abort',
          () => {
            upstreamAborted = true
          },
          { once: true },
        )
        markUpstreamEntered()
        return new Promise((resolveResponse, rejectResponse) => {
          resolveUpstream = resolveResponse
          init.signal?.addEventListener(
            'abort',
            () => rejectResponse(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        })
      }),
    )

    const responsePromise = worker.fetch(
      proxyRequest(clientController.signal),
      environment,
    )

    await upstreamEntered
    clientController.abort()
    if (!upstreamAborted) {
      resolveUpstream(new Response('upstream response', { status: 200 }))
    }

    const response = await responsePromise
    expect(capturedSignal?.aborted).toBe(true)
    expect(upstreamAborted).toBe(true)
    expect(response.status).toBe(502)
  })

  it('cancels the upstream response body when the downstream closes it', async () => {
    let upstreamBodyCancelled = false
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('streamed response'))
      },
      cancel() {
        upstreamBodyCancelled = true
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(upstreamBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const response = await worker.fetch(proxyRequest(), environment)
    await response.body.cancel('downstream closed')

    expect(upstreamBodyCancelled).toBe(true)
  })

  it('stops reading an over-limit request body without a content length', async () => {
    const chunks = [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
      new Uint8Array([9, 10, 11, 12]),
    ]
    let bytesPulled = 0
    let cancelled = false
    let thirdPullStarted = false
    let markSecondPullStarted
    let releaseSecondPull
    const secondPullStarted = new Promise((resolve) => {
      markSecondPullStarted = resolve
    })
    const body = new ReadableStream({
      async pull(controller) {
        const chunk = chunks.shift()
        if (!chunk) {
          controller.close()
          return
        }
        if (bytesPulled === 4) {
          markSecondPullStarted()
          await new Promise((resolve) => {
            releaseSecondPull = resolve
          })
        } else if (bytesPulled >= 8) {
          thirdPullStarted = true
        }
        bytesPulled += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const responsePromise = worker.fetch(
      streamingProxyRequest(body),
      { ...environment, MAX_PROXY_BYTES: '4' },
    )
    await secondPullStarted
    releaseSecondPull()
    const response = await responsePromise

    expect(response.status).toBe(413)
    expect(bytesPulled).toBe(8)
    expect(thirdPullStarted).toBe(false)
    expect(cancelled).toBe(true)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
})
