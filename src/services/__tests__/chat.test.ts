import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { loadLocale, setRuntimeLocale } from '../../i18n'
import type { ProviderConfig } from '../../types'
import {
  cancelProviderStreamReader,
  editImage,
  generateImage,
  listProviderModels,
  PROVIDER_MODEL_LIST_TIMEOUT_MS,
  PROVIDER_STREAM_IDLE_TIMEOUT_MS,
  streamChat,
} from '../chat'
import { MAX_PROVIDER_STREAM_RESPONSE_BYTES } from '../providerErrors'

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider One',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-1',
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function hangingFetch(): typeof fetch {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal

    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'))

      if (signal?.aborted) {
        abort()
        return
      }

      signal?.addEventListener('abort', abort, { once: true })
    })
  }) as unknown as typeof fetch
}

function streamingFetch(
  chunks: Array<string | Uint8Array>,
  options: {
    cancel?: () => void | Promise<void>
    contentLength?: number
    pull?: () => void
  } = {},
): typeof fetch {
  return vi.fn(() => {
    const encoder = new TextEncoder()

    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>(
          {
            start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(
                  typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
                )
              }
            },
            cancel: options.cancel,
            pull: options.pull,
          },
          { highWaterMark: 0 },
        ),
        {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            ...(options.contentLength === undefined
              ? {}
              : { 'content-length': String(options.contentLength) }),
          },
        },
      ),
    )
  }) as unknown as typeof fetch
}

function completedStreamingFetch(
  chunks: Array<string | Uint8Array>,
): typeof fetch {
  return vi.fn(() => {
    const encoder = new TextEncoder()
    let index = 0

    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            const chunk = chunks[index++]

            if (chunk === undefined) {
              controller.close()
              return
            }

            controller.enqueue(
              typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
            )
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    )
  }) as unknown as typeof fetch
}

function abortingJsonBodyFetch(
  controller: AbortController,
  value: unknown,
) {
  const bodyRead = vi.fn()
  const encoder = new TextEncoder()
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(streamController) {
              bodyRead()
              controller.abort()
              streamController.enqueue(
                encoder.encode(JSON.stringify(value)),
              )
              streamController.close()
            },
          },
          { highWaterMark: 0 },
        ),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ),
  ) as unknown as typeof fetch

  return { bodyRead, fetchMock }
}

function stalledJsonBodyFetch() {
  const bodyRead = vi.fn()
  const cancel = vi.fn(() => Promise.resolve(undefined))
  const reader = {
    cancel,
    read: vi.fn(() => {
      bodyRead()
      return new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)
    }),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>
  const response = {
    body: { getReader: () => reader },
    headers: new Headers({ 'content-type': 'application/json' }),
    ok: true,
    status: 200,
  } as unknown as Response
  const fetchMock = vi.fn(() => Promise.resolve(response)) as unknown as typeof fetch

  return { bodyRead, cancel, fetchMock }
}

function lateAbortStreamingFetch(
  controller: AbortController,
  chunk: string,
) {
  const cancel = vi.fn(() => Promise.resolve(undefined))
  const encoded = new TextEncoder().encode(chunk)
  const reader = {
    cancel,
    read: vi.fn(() => ({
      then(
        resolve: (result: ReadableStreamReadResult<Uint8Array>) => void,
      ) {
        resolve({ done: false, value: encoded })
        controller.abort()
        return Promise.resolve()
      },
    }) as unknown as Promise<ReadableStreamReadResult<Uint8Array>>),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>
  const body = {
    cancel: vi.fn(() => Promise.resolve(undefined)),
    getReader: () => reader,
  } as unknown as ReadableStream<Uint8Array>
  const response = {
    body,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    ok: true,
    status: 200,
  } as Response
  const fetchMock = vi.fn(() => Promise.resolve(response)) as unknown as typeof fetch

  return { cancel, fetchMock }
}

function textMessage(content = 'Hello') {
  return {
    id: 'user-1',
    role: 'user' as const,
    content,
    createdAt: 1,
    status: 'done' as const,
  }
}

describe('provider chat service runtime', () => {
  beforeAll(async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('turns a hung provider request into a retryable timeout error', async () => {
    vi.useFakeTimers()
    const fetchMock = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)

    const request = listProviderModels({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
    })
    const assertion = expect(request).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
      message: 'Network connection failed. Check your connection and try again.',
    })

    await vi.advanceTimersByTimeAsync(PROVIDER_MODEL_LIST_TIMEOUT_MS)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects automatic redirects for credential-bearing provider requests', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      return Promise.resolve(Response.json({ data: [{ id: 'model-1' }] }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listProviderModels({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
      }),
    ).resolves.toEqual(['model-1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps user-cancelled provider requests as AbortError', async () => {
    const fetchMock = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const request = listProviderModels({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      signal: controller.signal,
    })
    const assertion = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    })

    controller.abort()

    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels an unread streaming response when cancellation wins before handoff', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const fetchMock = vi.fn(() => {
      const response = new Response(
        new ReadableStream<Uint8Array>({ cancel }),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      )

      queueMicrotask(() => controller.abort())
      return Promise.resolve(response)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      streamChat({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: controller.signal,
        onToken: vi.fn(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts image source FileReader when edit cancellation wins during fallback preparation', async () => {
    const controller = new AbortController()
    const readerAbort = vi.fn()

    class DeferredFileReader {
      static latest: DeferredFileReader | undefined
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null
      onabort: ((event: ProgressEvent<FileReader>) => void) | null = null
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null
      error = new DOMException('The file read was aborted.', 'AbortError')
      result: string | ArrayBuffer | null = null

      constructor() {
        DeferredFileReader.latest = this
      }

      readAsDataURL(): void {}

      abort(): void {
        readerAbort()
      }
    }

    const fetchMock = vi.fn(() => Promise.reject(new TypeError('network down')))
    vi.stubGlobal('FileReader', DeferredFileReader)
    vi.stubGlobal('fetch', fetchMock)

    const request = editImage({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'gpt-image-2',
      prompt: 'Edit this image',
      signal: controller.signal,
      image: new File(['image'], 'source.png', { type: 'image/png' }),
    })

    await vi.waitFor(() =>
      expect(DeferredFileReader.latest).toBeInstanceOf(DeferredFileReader),
    )
    controller.abort()
    DeferredFileReader.latest?.onabort?.(
      new Event('abort') as ProgressEvent<FileReader>,
    )

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(readerAbort).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects a model-list body that resolves after source cancellation', async () => {
    const controller = new AbortController()
    const { bodyRead, fetchMock } = abortingJsonBodyFetch(controller, {
      data: [{ id: 'late-model' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listProviderModels({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(bodyRead).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the model-list timeout active through response body parsing', async () => {
    vi.useFakeTimers()
    const { bodyRead, cancel, fetchMock } = stalledJsonBodyFetch()
    vi.stubGlobal('fetch', fetchMock)

    const request = listProviderModels({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
    })
    const assertion = expect(request).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(bodyRead).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(PROVIDER_MODEL_LIST_TIMEOUT_MS)
    await assertion
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('wraps model-list network failures with localized connection targets', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('fetch failed')))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listProviderModels({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
      }),
    ).rejects.toMatchObject({
      code: 'network',
      message: expect.stringContaining('Cannot connect to model list API'),
      retryable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('turns provider HTML model-list responses into setup guidance', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response('<html><body>proxy login</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listProviderModels({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
      }),
    ).rejects.toMatchObject({
      code: 'server',
      retryable: true,
      status: 200,
      message:
        'The provider or relay returned a web page instead of API JSON. Check the Base URL path or AI proxy route.',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      label: 'model listing',
      run: () =>
        listProviderModels({
          provider: provider(),
          apiKey: '',
          proxyToken: '',
        }),
    },
    {
      label: 'chat streaming',
      run: () =>
        streamChat({
          provider: provider(),
          apiKey: '',
          proxyToken: '',
          model: 'model-1',
          messages: [textMessage()],
          contextMessageLimit: 6,
          signal: new AbortController().signal,
          onToken: vi.fn(),
        }),
    },
    {
      label: 'image generation',
      run: () =>
        generateImage({
          provider: provider(),
          apiKey: '',
          proxyToken: '',
          model: 'gpt-image-2',
          prompt: 'Draw safely',
          signal: new AbortController().signal,
        }),
    },
    {
      label: 'image editing',
      run: () =>
        editImage({
          provider: provider(),
          apiKey: '',
          proxyToken: '',
          model: 'gpt-image-2',
          prompt: 'Edit safely',
          signal: new AbortController().signal,
          image: new File(['image'], 'source.png', { type: 'image/png' }),
        }),
    },
  ])('rejects $label before fetch when the browser provider key is missing', async ({ run }) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(run()).rejects.toThrow(
      'Enter this provider key in Settings first',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'model listing',
      run: () =>
        listProviderModels({
          provider: provider({
            needsApiKey: false,
            proxyUrl: 'https://sync.example.workers.dev',
          }),
          apiKey: '',
          proxyToken: '',
        }),
    },
    {
      label: 'chat streaming',
      run: () =>
        streamChat({
          provider: provider({
            needsApiKey: false,
            proxyUrl: 'https://sync.example.workers.dev',
          }),
          apiKey: '',
          proxyToken: '',
          model: 'model-1',
          messages: [textMessage()],
          contextMessageLimit: 6,
          signal: new AbortController().signal,
          onToken: vi.fn(),
        }),
    },
    {
      label: 'image generation',
      run: () =>
        generateImage({
          provider: provider({
            needsApiKey: false,
            proxyUrl: 'https://sync.example.workers.dev',
          }),
          apiKey: '',
          proxyToken: '',
          model: 'gpt-image-2',
          prompt: 'Draw safely',
          signal: new AbortController().signal,
        }),
    },
    {
      label: 'image editing',
      run: () =>
        editImage({
          provider: provider({
            needsApiKey: false,
            proxyUrl: 'https://sync.example.workers.dev',
          }),
          apiKey: '',
          proxyToken: '',
          model: 'gpt-image-2',
          prompt: 'Edit safely',
          signal: new AbortController().signal,
          image: new File(['image'], 'source.png', { type: 'image/png' }),
        }),
    },
  ])('rejects $label before fetch when the proxy token is missing', async ({ run }) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(run()).rejects.toThrow(
      'Enter the data encryption password in Data first',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      expected: 'Select an image model first',
      label: 'image generation without a model',
      run: () =>
        generateImage({
          provider: provider(),
          apiKey: 'sk-test',
          proxyToken: '',
          model: ' ',
          prompt: 'Draw safely',
          signal: new AbortController().signal,
        }),
    },
    {
      expected: 'Select an image model first',
      label: 'image editing without a model',
      run: () =>
        editImage({
          provider: provider(),
          apiKey: 'sk-test',
          proxyToken: '',
          model: ' ',
          prompt: 'Edit safely',
          signal: new AbortController().signal,
          image: new File(['image'], 'source.png', { type: 'image/png' }),
        }),
    },
    {
      expected: 'Enter a model name first',
      label: 'chat streaming without a model',
      run: () =>
        streamChat({
          provider: provider(),
          apiKey: 'sk-test',
          proxyToken: '',
          model: ' ',
          messages: [textMessage()],
          contextMessageLimit: 6,
          signal: new AbortController().signal,
          onToken: vi.fn(),
        }),
    },
    {
      expected: 'Message content cannot be empty',
      label: 'image generation without a prompt',
      run: () =>
        generateImage({
          provider: provider(),
          apiKey: 'sk-test',
          proxyToken: '',
          model: 'gpt-image-2',
          prompt: ' ',
          signal: new AbortController().signal,
        }),
    },
    {
      expected: 'Message content cannot be empty',
      label: 'image editing without a prompt',
      run: () =>
        editImage({
          provider: provider(),
          apiKey: 'sk-test',
          proxyToken: '',
          model: 'gpt-image-2',
          prompt: ' ',
          signal: new AbortController().signal,
          image: new File(['image'], 'source.png', { type: 'image/png' }),
        }),
    },
    {
      expected: 'This provider type does not support image generation',
      label: 'Anthropic image generation',
      run: () =>
        generateImage({
          provider: provider({ kind: 'anthropic' }),
          apiKey: 'sk-test',
          proxyToken: '',
          model: 'gpt-image-2',
          prompt: 'Draw safely',
          signal: new AbortController().signal,
        }),
    },
    {
      expected: 'This provider type does not support image generation',
      label: 'Anthropic image editing',
      run: () =>
        editImage({
          provider: provider({ kind: 'anthropic' }),
          apiKey: 'sk-test',
          proxyToken: '',
          model: 'gpt-image-2',
          prompt: 'Edit safely',
          signal: new AbortController().signal,
          image: new File(['image'], 'source.png', { type: 'image/png' }),
        }),
    },
  ])('rejects $label before fetch', async ({ expected, run }) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(run()).rejects.toThrow(expected)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an empty model list instead of publishing a connected state', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ data: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listProviderModels({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
      }),
    ).rejects.toThrow('No models were recognized from the provider response')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads ordered text blocks from an OpenAI-compatible JSON response', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: 'Hello ' },
                  { type: 'image_url', image_url: { url: 'ignored' } },
                  { type: 'text', text: 'world' },
                ],
              },
            },
          ],
        }),
      ),
    )
    const tokens: string[] = []
    vi.stubGlobal('fetch', fetchMock)

    await streamChat({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })

    expect(tokens).toEqual(['Hello world'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads trimmed text blocks from an OpenAI Responses JSON response', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: ' first block ' },
                { type: 'output_text', output_text: ' second block ' },
              ],
            },
          ],
        }),
      ),
    )
    const tokens: string[] = []
    vi.stubGlobal('fetch', fetchMock)

    await streamChat({
      provider: provider({ kind: 'openai-responses' }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })

    expect(tokens).toEqual(['first block\nsecond block'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads text blocks from an Anthropic JSON response', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'thinking' },
            { type: 'text', text: 'world' },
          ],
        }),
      ),
    )
    const tokens: string[] = []
    vi.stubGlobal('fetch', fetchMock)

    await streamChat({
      provider: provider({ kind: 'anthropic' }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'claude-3-7-sonnet',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })

    expect(tokens).toEqual(['Hello world'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not start an Anthropic context window with an orphan assistant turn', async () => {
    const fetchMock = completedStreamingFetch([
      'data: {"delta":{"text":"ok"}}\n\n',
    ])
    vi.stubGlobal('fetch', fetchMock)

    await streamChat({
      provider: provider({ kind: 'anthropic' }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'claude-3-7-sonnet',
      messages: [
        textMessage('first prompt'),
        { ...textMessage('first answer'), id: 'assistant-1', role: 'assistant' },
        { ...textMessage('second prompt'), id: 'user-2' },
        { ...textMessage('second answer'), id: 'assistant-2', role: 'assistant' },
        { ...textMessage('latest prompt'), id: 'user-3' },
      ],
      contextMessageLimit: 4,
      signal: new AbortController().signal,
      onToken: vi.fn(),
    })

    const fetchCalls = (
      fetchMock as typeof fetch & {
        mock: { calls: Array<[RequestInfo | URL, RequestInit?]> }
      }
    ).mock.calls
    const body = JSON.parse(String(fetchCalls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(body.messages[0]?.role).toBe('user')
    expect(body.messages.map((message) => message.content)).toEqual([
      'second prompt',
      'second answer',
      'latest prompt',
    ])
  })

  it('ignores null items while reading OpenAI Responses content blocks', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          output: [
            null,
            {
              content: [
                null,
                { text: ' first block ' },
                { output_text: ' second block ' },
              ],
            },
          ],
        }),
      ),
    )
    const tokens: string[] = []
    vi.stubGlobal('fetch', fetchMock)

    await streamChat({
      provider: provider({ kind: 'openai-responses' }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })

    expect(tokens).toEqual(['first block\nsecond block'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the top-level output_text field from an OpenAI Responses response', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ output_text: ' plain response ' })),
    )
    const tokens: string[] = []
    vi.stubGlobal('fetch', fetchMock)

    await streamChat({
      provider: provider({ kind: 'openai-responses' }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })

    expect(tokens).toEqual(['plain response'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-object OpenAI Responses JSON body as empty', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(null)))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      streamChat({
        provider: provider({ kind: 'openai-responses' }),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: new AbortController().signal,
        onToken: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: 'server',
      retryable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an OpenAI Responses object without output as empty', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ status: 'ok' })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      streamChat({
        provider: provider({ kind: 'openai-responses' }),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: new AbortController().signal,
        onToken: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: 'server',
      retryable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      kind: 'openai-compatible' as const,
      chunk: 'data: keep-alive\n\ndata: {"choices":[{"delta":{"content":"tail"}}]}\n\n',
      label: 'OpenAI-compatible',
    },
    {
      kind: 'openai-responses' as const,
      chunk: 'data: keep-alive\n\ndata: {"type":"response.output_text.delta","delta":"tail"}\n\n',
      label: 'OpenAI Responses',
    },
  ])('ignores non-JSON $label SSE frames', async ({ chunk, kind }) => {
    const fetchMock = completedStreamingFetch([chunk])
    const tokens: string[] = []
    vi.stubGlobal('fetch', fetchMock)

    await streamChat({
      provider: provider({ kind }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })

    expect(tokens).toEqual(['tail'])
  })

  it('preserves an AbortError thrown directly by the provider fetch', async () => {
    const fetchMock = vi.fn(() =>
      Promise.reject(new DOMException('Aborted', 'AbortError')),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      listProviderModels({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      chunk: 'data: {"choices":[{"delta":{"content":"tail"}}]}',
      kind: 'openai-compatible' as const,
      label: 'OpenAI-compatible',
    },
    {
      chunk: 'data: {"delta":{"text":"tail"}}',
      kind: 'anthropic' as const,
      label: 'Anthropic',
    },
    {
      chunk: 'data: {"type":"response.output_text.delta","delta":"tail"}',
      kind: 'openai-responses' as const,
      label: 'OpenAI Responses',
    },
  ])(
    'flushes the final $label SSE event when the provider closes without a delimiter',
    async ({ chunk, kind }) => {
      const fetchMock = completedStreamingFetch([chunk])
      const tokens: string[] = []
      vi.stubGlobal('fetch', fetchMock)

      await streamChat({
        provider: provider({ kind }),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: new AbortController().signal,
        onToken: (token) => tokens.push(token),
      })

      expect(tokens).toEqual(['tail'])
    },
  )

  it('reads ordered text blocks from an OpenAI-compatible SSE delta', async () => {
    const fetchMock = completedStreamingFetch([
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Hello "},{"type":"image_url"},{"type":"text","text":"world"}]}}]}\n\n',
    ])
    const tokens: string[] = []
    vi.stubGlobal('fetch', fetchMock)

    await streamChat({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })

    expect(tokens).toEqual(['Hello world'])
  })

  it.each([
    { kind: 'openai-compatible' as const, label: 'OpenAI-compatible' },
    { kind: 'anthropic' as const, label: 'Anthropic' },
    { kind: 'openai-responses' as const, label: 'OpenAI Responses' },
  ])(
    'rejects a successful empty $label stream as a retryable provider failure',
    async ({ kind }) => {
      vi.stubGlobal('fetch', completedStreamingFetch([]))

      await expect(
        streamChat({
          provider: provider({ kind }),
          apiKey: 'sk-test',
          proxyToken: '',
          model: 'model-1',
          messages: [textMessage()],
          contextMessageLimit: 6,
          signal: new AbortController().signal,
          onToken: vi.fn(),
        }),
      ).rejects.toMatchObject({
        code: 'server',
        retryable: true,
      })
    },
  )

  it.each([
    {
      kind: 'openai-compatible' as const,
      done: 'data: [DONE]\n\n',
      token: 'data: {"choices":[{"delta":{"content":"tail"}}]}\n\n',
      label: 'OpenAI-compatible',
    },
    {
      kind: 'openai-responses' as const,
      done: 'data: [DONE]\n\n',
      token: 'data: {"type":"response.output_text.delta","delta":"tail"}\n\n',
      label: 'OpenAI Responses',
    },
  ])(
    'cancels and releases the $label reader after the provider sends DONE',
    async ({ done, kind, token }) => {
      const encoder = new TextEncoder()
      const cancel = vi.fn(() => Promise.resolve(undefined))
      const releaseLock = vi.fn()
      const reader = {
        cancel,
        read: vi.fn(() =>
          Promise.resolve({
            done: false,
            value: encoder.encode(token + done),
          }),
        ),
        releaseLock,
      } as unknown as ReadableStreamDefaultReader<Uint8Array>
      const response = {
        body: { getReader: () => reader },
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        ok: true,
        status: 200,
      } as unknown as Response
      const fetchMock = vi.fn(() => Promise.resolve(response)) as unknown as typeof fetch
      const tokens: string[] = []
      vi.stubGlobal('fetch', fetchMock)

      await streamChat({
        provider: provider({ kind }),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: new AbortController().signal,
        onToken: (value) => tokens.push(value),
      })

      expect(tokens).toEqual(['tail'])
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(releaseLock).toHaveBeenCalledTimes(1)
    },
  )

  it('turns a stalled streaming response into a retryable timeout after partial tokens', async () => {
    vi.useFakeTimers()
    const fetchMock = streamingFetch([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    ])
    vi.stubGlobal('fetch', fetchMock)
    const tokens: string[] = []

    const request = streamChat({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })
    await vi.advanceTimersByTimeAsync(0)
    const assertion = expect(request).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    })

    expect(tokens).toEqual(['Hel'])

    await vi.advanceTimersByTimeAsync(PROVIDER_STREAM_IDLE_TIMEOUT_MS)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('contains a synchronously fired stream timeout before the timer handle exists', async () => {
    let timerCalls = 0
    const setTimeout = vi.fn((callback: () => void) => {
      timerCalls += 1
      const handle = timerCalls
      if (timerCalls === 2) {
        callback()
      }
      return handle
    })
    const clearTimeout = vi.fn()
    const cancel = vi.fn(() => Promise.resolve())
    const controller = new AbortController()
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeEventListener = vi.spyOn(
      controller.signal,
      'removeEventListener',
    )
    vi.stubGlobal('setTimeout', setTimeout)
    vi.stubGlobal('clearTimeout', clearTimeout)
    vi.stubGlobal('fetch', streamingFetch([], { cancel }))

    const request = streamChat({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: controller.signal,
      onToken: vi.fn(),
    })

    await expect(request).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(clearTimeout).toHaveBeenCalledWith(2)
    expect(addEventListener).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledOnce()
  })

  it('contains provider stream reader cancel failures during idle timeouts', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')))
    const fetchMock = streamingFetch([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    ], { cancel })
    vi.stubGlobal('fetch', fetchMock)
    const tokens: string[] = []

    const request = streamChat({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: new AbortController().signal,
      onToken: (token) => tokens.push(token),
    })
    await vi.advanceTimersByTimeAsync(0)
    const assertion = expect(request).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    })

    expect(tokens).toEqual(['Hel'])

    await vi.advanceTimersByTimeAsync(PROVIDER_STREAM_IDLE_TIMEOUT_MS)
    await assertion
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('keeps user-cancelled stream reads as AbortError', async () => {
    const readStarted = vi.fn()
    const fetchMock = streamingFetch([], { pull: readStarted })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const request = streamChat({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: controller.signal,
      onToken: vi.fn(),
    })
    await vi.waitFor(() => expect(readStarted).toHaveBeenCalledTimes(1))
    const assertion = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    })

    controller.abort()

    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      body: { choices: [{ message: { content: 'late openai text' } }] },
      kind: 'openai-compatible' as const,
      label: 'OpenAI-compatible',
    },
    {
      body: { content: [{ type: 'text', text: 'late anthropic text' }] },
      kind: 'anthropic' as const,
      label: 'Anthropic',
    },
    {
      body: { output_text: 'late responses text' },
      kind: 'openai-responses' as const,
      label: 'OpenAI Responses',
    },
  ])(
    'does not publish a late $label JSON chat body after cancellation',
    async ({ body, kind }) => {
      const controller = new AbortController()
      const { bodyRead, fetchMock } = abortingJsonBodyFetch(controller, body)
      const onToken = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        streamChat({
          provider: provider({ kind }),
          apiKey: 'sk-test',
          proxyToken: '',
          model: 'model-1',
          messages: [textMessage()],
          contextMessageLimit: 6,
          signal: controller.signal,
          onToken,
        }),
      ).rejects.toMatchObject({
        name: 'AbortError',
      })
      expect(bodyRead).toHaveBeenCalledTimes(1)
      expect(onToken).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      chunk: 'data: {"choices":[{"delta":{"content":"late"}}]}\n\n',
      kind: 'openai-compatible' as const,
      label: 'OpenAI-compatible',
    },
    {
      chunk: 'data: {"delta":{"text":"late"}}\n\n',
      kind: 'anthropic' as const,
      label: 'Anthropic',
    },
    {
      chunk: 'data: {"type":"response.output_text.delta","delta":"late"}\n\n',
      kind: 'openai-responses' as const,
      label: 'OpenAI Responses',
    },
  ])(
    'does not publish a late $label stream chunk after cancellation',
    async ({ chunk, kind }) => {
      const controller = new AbortController()
      const { cancel, fetchMock } = lateAbortStreamingFetch(controller, chunk)
      const onToken = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        streamChat({
          provider: provider({ kind }),
          apiKey: 'sk-test',
          proxyToken: '',
          model: 'model-1',
          messages: [textMessage()],
          contextMessageLimit: 6,
          signal: controller.signal,
          onToken,
        }),
      ).rejects.toMatchObject({
        name: 'AbortError',
      })
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(onToken).not.toHaveBeenCalled()
    },
  )

  it('contains provider stream reader cancel failures during user abort', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')))
    const readStarted = vi.fn()
    const fetchMock = streamingFetch([], { cancel, pull: readStarted })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const request = streamChat({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'model-1',
      messages: [textMessage()],
      contextMessageLimit: 6,
      signal: controller.signal,
      onToken: vi.fn(),
    })
    await vi.waitFor(() => expect(readStarted).toHaveBeenCalledTimes(1))
    const assertion = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    })

    controller.abort()

    await assertion
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('contains direct provider stream reader cancel failures', async () => {
    const reader = {
      cancel: vi.fn(() => Promise.reject(new Error('cancel failed'))),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>

    await expect(cancelProviderStreamReader(reader)).resolves.toBe(false)
    expect(reader.cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects and cancels provider streams that exceed the total byte budget', async () => {
    const cancel = vi.fn()
    const fetchMock = streamingFetch(
      [new Uint8Array(MAX_PROVIDER_STREAM_RESPONSE_BYTES + 1)],
      { cancel },
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      streamChat({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: new AbortController().signal,
        onToken: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: 'request',
      retryable: false,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects declared oversized provider streams before reading', async () => {
    const cancel = vi.fn()
    const fetchMock = streamingFetch([], {
      cancel,
      contentLength: MAX_PROVIDER_STREAM_RESPONSE_BYTES + 1,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      streamChat({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: new AbortController().signal,
        onToken: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: 'request',
      retryable: false,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('wraps chat network failures with localized connection targets', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('fetch failed')))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      streamChat({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: new AbortController().signal,
        onToken: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: 'network',
      message: expect.stringContaining('Cannot connect to AI chat API'),
      retryable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects image JSON that resolves after source cancellation', async () => {
    const controller = new AbortController()
    const { bodyRead, fetchMock } = abortingJsonBodyFetch(controller, {
      data: [{ b64_json: 'TEFURQ==' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateImage({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'gpt-image-2',
        prompt: 'Draw late',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(bodyRead).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: 'server error', status: 502, message: 'bad gateway' },
    { label: 'rate limit', status: 429, message: 'rate limit' },
  ])(
    'falls back to the Responses image tool when the Image API route returns $label',
    async ({ status, message }) => {
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          void init
          const url = typeof input === 'string' ? input : input.toString()

          if (url.endsWith('/images/generations')) {
            return Promise.resolve(
              new Response(JSON.stringify({ error: { message } }), {
                status,
                headers: { 'content-type': 'application/json' },
              }),
            )
          }

          if (url.endsWith('/responses')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  output: [
                    {
                      type: 'image_generation_call',
                      result: 'BBB=',
                      output_format: 'png',
                    },
                  ],
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              ),
            )
          }

          return Promise.reject(new Error(`Unexpected URL ${url}`))
        },
      )
      vi.stubGlobal('fetch', fetchMock)

      const image = await generateImage({
        provider: provider({ model: 'provider-default-model' }),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'gpt-image-2',
        responsesModel: 'gpt-5.5',
        prompt: 'Draw OK',
        signal: new AbortController().signal,
      })

      expect(image).toMatchObject({
        dataUrl: 'data:image/png;base64,BBB=',
        mimeType: 'image/png',
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)

      const firstBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
      const secondBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string)

      expect(firstBody.model).toBe('gpt-image-2')
      expect(secondBody).toMatchObject({
        model: 'gpt-5.5',
        input: 'Draw OK',
        store: false,
        tools: [
          {
            type: 'image_generation',
            action: 'generate',
            size: '1024x1024',
          },
        ],
      })
    },
  )

  it('falls back to the Responses image tool when the Image API route connection closes', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        void init
        const url = typeof input === 'string' ? input : input.toString()

        if (url.endsWith('/images/generations')) {
          return Promise.reject(new TypeError('fetch failed'))
        }

        if (url.endsWith('/responses')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                output: [
                  {
                    type: 'image_generation_call',
                    result: 'BBB=',
                    output_format: 'png',
                  },
                ],
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              },
            ),
          )
        }

        return Promise.reject(new Error(`Unexpected URL ${url}`))
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const image = await generateImage({
      provider: provider({ model: 'provider-default-model' }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'gpt-image-2',
      responsesModel: 'gpt-5.5',
      prompt: 'Draw OK',
      signal: new AbortController().signal,
    })

    expect(image).toMatchObject({
      dataUrl: 'data:image/png;base64,BBB=',
      mimeType: 'image/png',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string)

    expect(secondBody).toMatchObject({
      model: 'gpt-5.5',
      input: 'Draw OK',
      store: false,
      tools: [
        {
          type: 'image_generation',
          action: 'generate',
          size: '1024x1024',
        },
      ],
    })
  })

  it('falls back to the Responses image tool when the Image API route returns an HTML page', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        void init
        const url = typeof input === 'string' ? input : input.toString()

        if (url.endsWith('/images/generations')) {
          return Promise.resolve(
            new Response('<html><body>not api json</body></html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
          )
        }

        if (url.endsWith('/responses')) {
          return Promise.resolve(
            Response.json({
              output: [
                {
                  type: 'image_generation_call',
                  result: 'BBB=',
                  output_format: 'png',
                },
              ],
            }),
          )
        }

        return Promise.reject(new Error(`Unexpected URL ${url}`))
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const image = await generateImage({
      provider: provider({ model: 'provider-default-model' }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'gpt-image-2',
      responsesModel: 'gpt-5.5',
      prompt: 'Draw OK',
      signal: new AbortController().signal,
    })

    expect(image).toMatchObject({
      dataUrl: 'data:image/png;base64,BBB=',
      mimeType: 'image/png',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the Responses image tool for image editing without a mask', async () => {
    class FakeFileReader {
      error: DOMException | null = null
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      result: string | ArrayBuffer | null = null

      readAsDataURL(file: Blob): void {
        void file
        this.result = 'data:image/png;base64,SOURCE='
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader)
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        void _init
        const url = typeof input === 'string' ? input : input.toString()

        if (url.endsWith('/images/edits')) {
          return Promise.resolve(
            Response.json(
              { error: { message: 'image edit route unavailable' } },
              { status: 502 },
            ),
          )
        }

        if (url.endsWith('/responses')) {
          return Promise.resolve(
            Response.json({
              output: [
                {
                  type: 'image_generation_call',
                  result: 'EEE=',
                  output_format: 'png',
                },
              ],
            }),
          )
        }

        return Promise.reject(new Error(`Unexpected URL ${url}`))
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const image = await editImage({
      provider: provider({ model: 'provider-default-model' }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'gpt-image-2',
      responsesModel: 'gpt-5.5',
      prompt: 'Edit this image',
      signal: new AbortController().signal,
      image: new File(['image'], 'source.png', { type: 'image/png' }),
    })

    expect(image).toMatchObject({
      dataUrl: 'data:image/png;base64,EEE=',
      mimeType: 'image/png',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tries the selected image model when the Responses image tool returns text only for the chat model', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.toString()
        const body = init?.body ? JSON.parse(init.body as string) : {}

        if (url.endsWith('/images/generations')) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { message: 'bad gateway' } }), {
              status: 502,
              headers: { 'content-type': 'application/json' },
            }),
          )
        }

        if (url.endsWith('/responses') && body.model === 'gpt-5.5') {
          return Promise.resolve(
            Response.json({
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: 'I cannot draw that.' }],
                },
              ],
            }),
          )
        }

        if (url.endsWith('/responses') && body.model === 'gpt-image-2') {
          return Promise.resolve(
            Response.json({
              output: [
                {
                  type: 'image_generation_call',
                  result: 'CCC=',
                  output_format: 'webp',
                },
              ],
            }),
          )
        }

        return Promise.reject(new Error(`Unexpected URL ${url}`))
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const image = await generateImage({
      provider: provider({ model: 'provider-default-model' }),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'gpt-image-2',
      responsesModel: 'gpt-5.5',
      prompt: 'Draw OK',
      signal: new AbortController().signal,
    })

    expect(image).toMatchObject({
      dataUrl: 'data:image/webp;base64,CCC=',
      mimeType: 'image/webp',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).model).toBe(
      'gpt-5.5',
    )
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string).model).toBe(
      'gpt-image-2',
    )
  })

  it.each([
    { code: 'auth', message: 'invalid api key', status: 401 },
    { code: 'quota', message: 'insufficient quota', status: 402 },
    { code: 'rate-limit', message: 'rate limit', status: 429 },
    { code: 'endpoint', message: 'method not allowed', status: 405 },
    { code: 'server', message: 'provider unavailable', status: 502 },
  ])(
    'stops Responses image model fallback after a $code failure',
    async ({ code, message, status }) => {
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
          void _init
          const url = typeof input === 'string' ? input : input.toString()

          if (url.endsWith('/images/generations')) {
            return Promise.resolve(
              Response.json(
                { error: { message: 'image route unavailable' } },
                { status: 502 },
              ),
            )
          }

          if (url.endsWith('/responses')) {
            return Promise.resolve(
              Response.json({ error: { message } }, { status }),
            )
          }

          return Promise.reject(new Error(`Unexpected URL ${url}`))
        },
      )
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        generateImage({
          provider: provider({ model: 'provider-default-model' }),
          apiKey: 'sk-test',
          proxyToken: '',
          model: 'gpt-image-2',
          responsesModel: 'gpt-5.5',
          prompt: 'Draw once',
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).model).toBe(
        'gpt-5.5',
      )
    },
  )

  it.each([400, 422])(
    'tries the next Responses image model after a model-level %s response',
    async (status) => {
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url = typeof input === 'string' ? input : input.toString()
          const body = init?.body ? JSON.parse(init.body as string) : {}

          if (url.endsWith('/images/generations')) {
            return Promise.resolve(
              Response.json(
                { error: { message: 'image route unavailable' } },
                { status: 502 },
              ),
            )
          }

          if (url.endsWith('/responses') && body.model === 'gpt-5.5') {
            return Promise.resolve(
              Response.json(
                { error: { message: 'model cannot use image tool' } },
                { status },
              ),
            )
          }

          if (url.endsWith('/responses') && body.model === 'gpt-image-2') {
            return Promise.resolve(
              Response.json({
                output: [
                  {
                    type: 'image_generation_call',
                    result: 'DDD=',
                    output_format: 'png',
                  },
                ],
              }),
            )
          }

          return Promise.reject(new Error(`Unexpected URL ${url}`))
        },
      )
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        generateImage({
          provider: provider({ model: 'provider-default-model' }),
          apiKey: 'sk-test',
          proxyToken: '',
          model: 'gpt-image-2',
          responsesModel: 'gpt-5.5',
          prompt: 'Draw with fallback',
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({
        dataUrl: 'data:image/png;base64,DDD=',
        mimeType: 'image/png',
      })

      expect(fetchMock).toHaveBeenCalledTimes(3)
    },
  )

  it('surfaces structured Responses stream errors', async () => {
    vi.stubGlobal(
      'fetch',
      completedStreamingFetch([
        'data: {"error":{"message":"Responses provider failed"}}\n\n',
      ]),
    )

    await expect(
      streamChat({
        provider: provider({ kind: 'openai-responses' }),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: new AbortController().signal,
        onToken: vi.fn(),
      }),
    ).rejects.toThrow('Responses provider failed')
  })

  it('cancels a provider reader when stream consumption starts already aborted', async () => {
    const controller = new AbortController()
    const cancel = vi.fn(() => Promise.resolve(undefined))
    const reader = {
      cancel,
      read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
      releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>
    const response = {
      get body() {
        controller.abort()
        return { getReader: () => reader }
      },
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      ok: true,
      status: 200,
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response)))

    await expect(
      streamChat({
        provider: provider(),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'model-1',
        messages: [textMessage()],
        contextMessageLimit: 6,
        signal: controller.signal,
        onToken: vi.fn(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('materializes URL-only generated images without forwarding provider headers', async () => {
    const signedUrl =
      'https://cdn.example.test/generated.png?token=temporary-secret&expires=1'
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ])
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        void _init
        const url = typeof input === 'string' ? input : input.toString()

        if (url.endsWith('/images/generations')) {
          return Promise.resolve(
            Response.json({ data: [{ url: signedUrl }] }),
          )
        }

        if (url === signedUrl) {
          return Promise.resolve(
            new Response(pngBytes, {
              status: 200,
              headers: { 'content-type': 'image/png' },
            }),
          )
        }

        return Promise.reject(new Error(`Unexpected URL ${url}`))
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const image = await generateImage({
      provider: provider(),
      apiKey: 'sk-test',
      proxyToken: '',
      model: 'gpt-image-2',
      prompt: 'Draw a durable image',
      signal: new AbortController().signal,
    })

    expect(image).toEqual({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoA',
      mimeType: 'image/png',
      revisedPrompt: undefined,
    })
    expect(JSON.stringify(image)).not.toContain('temporary-secret')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }),
    )
    expect(fetchMock.mock.calls[1][1]?.headers).toBeUndefined()
  })

  it('wraps image generation network failures with localized connection targets', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('fetch failed')))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateImage({
        provider: provider({ model: 'provider-default-model' }),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'gpt-image-2',
        responsesModel: 'gpt-5.5',
        prompt: 'Draw OK',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'network',
      message: expect.stringContaining('Cannot connect to image generation API'),
      retryable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('wraps image edit network failures with localized connection targets', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('fetch failed')))
    vi.stubGlobal('fetch', fetchMock)
    const image = new File(['image'], 'source.png', { type: 'image/png' })
    const mask = new File(['mask'], 'mask.png', { type: 'image/png' })

    await expect(
      editImage({
        provider: provider({ model: 'provider-default-model' }),
        apiKey: 'sk-test',
        proxyToken: '',
        model: 'gpt-image-2',
        responsesModel: 'gpt-5.5',
        prompt: 'Edit OK',
        signal: new AbortController().signal,
        image,
        mask,
      }),
    ).rejects.toMatchObject({
      code: 'network',
      message: expect.stringContaining('Cannot connect to image edit API'),
      retryable: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
