import { describe, expect, it, vi } from 'vitest'

import { loadLocale, setRuntimeLocale } from '../../i18n'
import type { ProviderConfig } from '../../types'
import { transcribeAudioFile } from '../audioTranscription'
import { ProviderRequestError } from '../providerErrors'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider One',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1/chat/completions',
    model: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2',
    models: ['gpt-5.4-mini', 'gpt-4o-transcribe'],
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('audio transcription provider service', () => {
  it('posts audio files to the provider transcription endpoint', async () => {
    const sourceFile = new File(['audio-bytes'], ' voice.wav ', { type: '' })
    const fetcherMock = vi.fn<typeof fetch>(async (input, init) => {
      void input
      void init
      return new Response(JSON.stringify({ text: ' hello from audio ' }))
    })

    const result = await transcribeAudioFile({
      apiKey: 'provider-key',
      fetcher: fetcherMock as typeof fetch,
      file: sourceFile,
      prompt: ' ZeroChat names ',
      provider: provider(),
      proxyToken: '',
    })

    expect(result).toEqual({
      model: 'gpt-4o-transcribe',
      text: 'hello from audio',
    })
    expect(fetcherMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetcherMock.mock.calls[0]
    expect(endpoint).toBe('https://api.example.test/v1/audio/transcriptions')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ authorization: 'Bearer provider-key' })
    const body = init?.body as FormData
    expect(body.get('model')).toBe('gpt-4o-transcribe')
    expect((body.get('file') as File).type).toBe('audio/wav')
    expect(body.get('prompt')).toBe('ZeroChat names')
  })

  it('surfaces preflight blockers before calling fetch', async () => {
    const fetcherMock = vi.fn()

    await expect(
      transcribeAudioFile({
        apiKey: 'provider-key',
        fetcher: fetcherMock as typeof fetch,
        file: null,
        provider: provider(),
        proxyToken: '',
      }),
    ).rejects.toThrow()
    expect(fetcherMock).not.toHaveBeenCalled()
  })

  it('rejects invalid local audio before building a network request', async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')
    const fetcherMock = vi.fn()

    await expect(
      transcribeAudioFile({
        apiKey: 'provider-key',
        fetcher: fetcherMock as typeof fetch,
        file: new File(['midi'], 'song.mid', { type: 'audio/midi' }),
        provider: provider(),
        proxyToken: '',
      }),
    ).rejects.toThrow('Use MP3, MP4, MPEG/MPGA, M4A, WAV, or WebM.')

    await expect(
      transcribeAudioFile({
        apiKey: 'provider-key',
        fetcher: fetcherMock as typeof fetch,
        file: {
          name: 'meeting.webm',
          size: 25_000_001,
          type: 'audio/webm',
        } as File,
        provider: provider(),
        proxyToken: '',
      }),
    ).rejects.toThrow('File exceeds the 25 MB limit.')
    expect(fetcherMock).not.toHaveBeenCalled()
  })

  it('preserves provider HTTP and malformed-response failures', async () => {
    await expect(
      transcribeAudioFile({
        apiKey: 'provider-key',
        fetcher: vi.fn(
          async () =>
            Response.json(
              { error: { message: 'invalid api key' } },
              { status: 401 },
            ),
        ) as typeof fetch,
        file: new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
        provider: provider(),
        proxyToken: '',
      }),
    ).rejects.toBeInstanceOf(ProviderRequestError)

    await expect(
      transcribeAudioFile({
        apiKey: 'provider-key',
        fetcher: vi.fn(async () => Response.json({ data: [] })) as typeof fetch,
        file: new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
        provider: provider(),
        proxyToken: '',
      }),
    ).rejects.toThrow()
  })

  it('wraps network failures with localized transcription targets', async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')

    await expect(
      transcribeAudioFile({
        apiKey: 'provider-key',
        fetcher: vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }) as typeof fetch,
        file: new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
        provider: provider(),
        proxyToken: '',
      }),
    ).rejects.toMatchObject({
      code: 'network',
      message: expect.stringContaining('Cannot connect to Audio transcription'),
      retryable: true,
    })
  })

  it('turns stalled transcription requests into retryable timeout errors', async () => {
    vi.useFakeTimers()

    try {
      const request = transcribeAudioFile({
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
        file: new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
        provider: provider(),
        proxyToken: '',
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

  it('times out a stalled transcription body reader that ignores fetch abort', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => Promise.resolve(undefined))
    const read = vi.fn(
      () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
    )
    const response = {
      body: {
        getReader: () => ({ cancel, read }),
      },
      headers: new Headers({ 'content-type': 'application/json' }),
      ok: true,
      status: 200,
    } as unknown as Response

    try {
      const request = transcribeAudioFile({
        apiKey: 'provider-key',
        fetcher: vi.fn(async () => response) as typeof fetch,
        file: new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
        provider: provider(),
        proxyToken: '',
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

  it('keeps user-cancelled transcription requests as AbortError', async () => {
    const controller = new AbortController()
    const request = transcribeAudioFile({
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
      file: new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
      provider: provider(),
      proxyToken: '',
      signal: controller.signal,
    })
    const rejection = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    })

    controller.abort()
    await rejection
  })

  it('rejects a late transcription body after source cancellation', async () => {
    const controller = new AbortController()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(streamController) {
          controller.abort()
          streamController.enqueue(
            new TextEncoder().encode(JSON.stringify({ text: 'late transcript' })),
          )
          streamController.close()
        },
      }),
    )

    await expect(
      transcribeAudioFile({
        apiKey: 'provider-key',
        fetcher: vi.fn(async () => response) as typeof fetch,
        file: new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
        provider: provider(),
        proxyToken: '',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
