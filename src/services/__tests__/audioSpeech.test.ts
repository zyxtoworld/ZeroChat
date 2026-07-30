import { describe, expect, it, vi } from 'vitest'

import { loadLocale, setRuntimeLocale } from '../../i18n'
import type { ProviderConfig } from '../../types'
import { synthesizeSpeechAudio } from '../audioSpeech'
import { ProviderRequestError } from '../providerErrors'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider One',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1/chat/completions',
    model: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2',
    audioSpeechModel: 'gpt-4o-mini-tts',
    models: ['gpt-5.4-mini', 'gpt-4o-mini-tts'],
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('audio speech provider service', () => {
  it('posts text to the provider speech endpoint', async () => {
    const fetcherMock = vi.fn<typeof fetch>(async (input, init) => {
      void input
      void init
      return new Response(
        new Blob(
          [Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])],
          { type: 'audio/mpeg' },
        ),
      )
    })

    const result = await synthesizeSpeechAudio({
      apiKey: 'provider-key',
      fetcher: fetcherMock as typeof fetch,
      provider: provider(),
      proxyToken: '',
      text: ' Read this aloud. ',
    })

    expect(result.model).toBe('gpt-4o-mini-tts')
    expect(result.blob.size).toBeGreaterThan(0)
    expect(fetcherMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetcherMock.mock.calls[0]
    expect(endpoint).toBe('https://api.example.test/v1/audio/speech')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      authorization: 'Bearer provider-key',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'Read this aloud.',
      voice: 'alloy',
      response_format: 'mp3',
    })
  })

  it('surfaces preflight blockers before calling fetch', async () => {
    const fetcherMock = vi.fn()

    await expect(
      synthesizeSpeechAudio({
        apiKey: 'provider-key',
        fetcher: fetcherMock as typeof fetch,
        provider: provider(),
        proxyToken: '',
        text: '   ',
      }),
    ).rejects.toThrow()
    expect(fetcherMock).not.toHaveBeenCalled()
  })

  it('preserves provider HTTP and empty-audio failures', async () => {
    await expect(
      synthesizeSpeechAudio({
        apiKey: 'provider-key',
        fetcher: vi.fn(
          async () =>
            Response.json(
              { error: { message: 'invalid api key' } },
              { status: 401 },
            ),
        ) as typeof fetch,
        provider: provider(),
        proxyToken: '',
        text: 'hello',
      }),
    ).rejects.toBeInstanceOf(ProviderRequestError)

    await expect(
      synthesizeSpeechAudio({
        apiKey: 'provider-key',
        fetcher: vi.fn(async () => new Response(new Blob([]))) as typeof fetch,
        provider: provider(),
        proxyToken: '',
        text: 'hello',
      }),
    ).rejects.toThrow()
  })

  it('rejects successful non-audio error bodies before playback', async () => {
    for (const response of [
      Response.json({ error: { message: 'upstream route failed' } }),
      new Response('<!doctype html><html><body>proxy error</body></html>', {
        headers: { 'content-type': 'text/html' },
      }),
    ]) {
      await expect(
        synthesizeSpeechAudio({
          apiKey: 'provider-key',
          fetcher: vi.fn(async () => response) as typeof fetch,
          provider: provider(),
          proxyToken: '',
          text: 'hello',
        }),
      ).rejects.toThrow('error.capabilityResponseInvalid')
    }
  })

  it('rejects textual error bodies even when the relay mislabels their media type', async () => {
    for (const response of [
      new Response(JSON.stringify({ error: { message: 'upstream route failed' } }), {
        headers: { 'content-type': 'audio/mpeg' },
      }),
      new Response('<!doctype html><html><body>proxy error</body></html>', {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    ]) {
      await expect(
        synthesizeSpeechAudio({
          apiKey: 'provider-key',
          fetcher: vi.fn(async () => response) as typeof fetch,
          provider: provider(),
          proxyToken: '',
          text: 'hello',
        }),
      ).rejects.toThrow('error.capabilityResponseInvalid')
    }
  })

  it('wraps network failures with localized speech targets', async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')

    await expect(
      synthesizeSpeechAudio({
        apiKey: 'provider-key',
        fetcher: vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }) as typeof fetch,
        provider: provider(),
        proxyToken: '',
        text: 'hello',
      }),
    ).rejects.toMatchObject({
      code: 'network',
      message: expect.stringContaining('Cannot connect to Text to speech'),
      retryable: true,
    })
  })

  it('turns stalled speech requests into retryable timeout errors', async () => {
    vi.useFakeTimers()

    try {
      const request = synthesizeSpeechAudio({
        apiKey: 'provider-key',
        fetcher: vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          }),
        ) as typeof fetch,
        provider: provider(),
        proxyToken: '',
        text: 'hello',
        timeoutMs: 25,
      })
      const rejection = expect(request).rejects.toMatchObject({
        code: 'timeout',
        retryable: true,
      })

      await vi.advanceTimersByTimeAsync(25)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out a stalled speech body reader that ignores fetch abort', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => Promise.resolve(undefined))
    const read = vi.fn(
      () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
    )
    const response = {
      body: {
        getReader: () => ({ cancel, read }),
      },
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
      ok: true,
      status: 200,
    } as unknown as Response

    try {
      const request = synthesizeSpeechAudio({
        apiKey: 'provider-key',
        fetcher: vi.fn(async () => response) as typeof fetch,
        provider: provider(),
        proxyToken: '',
        text: 'hello',
        timeoutMs: 25,
      })
      const rejection = expect(request).rejects.toMatchObject({
        code: 'timeout',
        retryable: true,
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(25)
      await rejection
      expect(cancel).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects late speech bytes after source cancellation', async () => {
    const controller = new AbortController()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(streamController) {
          controller.abort()
          streamController.enqueue(new TextEncoder().encode('late audio'))
          streamController.close()
        },
      }),
      {
        headers: { 'content-type': 'audio/mpeg' },
      },
    )

    await expect(
      synthesizeSpeechAudio({
        apiKey: 'provider-key',
        fetcher: vi.fn(async () => response) as typeof fetch,
        provider: provider(),
        proxyToken: '',
        signal: controller.signal,
        text: 'hello',
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
