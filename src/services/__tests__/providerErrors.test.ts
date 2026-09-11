import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { loadLocale, setRuntimeLocale } from '../../i18n'
import type { ProviderConfig } from '../../types'
import {
  accumulateProviderResponseBytes,
  assertProviderResponseOk,
  classifyProviderHttpError,
  MAX_PROVIDER_ERROR_RESPONSE_BYTES,
  MAX_PROVIDER_TEXT_RESPONSE_BYTES,
  providerConnectionError,
  providerErrorDetailFromBody,
  ProviderRequestError,
  readProviderJsonResponse,
  readProviderResponseBytes,
} from '../providerErrors'

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

afterEach(() => {
  vi.restoreAllMocks()
})

function unreadableResponse(status: number): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('body stream locked'))
      },
    }),
    { status },
  )
}

function stalledProviderResponse(status: number) {
  const cancel = vi.fn(() => Promise.resolve(undefined))
  const releaseLock = vi.fn()
  const read = vi.fn(
    () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
  )
  const reader = {
    cancel,
    read,
    releaseLock,
  } as unknown as ReadableStreamDefaultReader<Uint8Array>
  const response = {
    body: { getReader: () => reader },
    headers: new Headers({ 'content-type': 'application/json' }),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response

  return { cancel, read, releaseLock, response }
}

describe('provider error handling', () => {
  beforeAll(async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')
  })

  it('extracts provider error details from JSON and plain text bodies', () => {
    expect(providerErrorDetailFromBody('')).toBe('')
    expect(providerErrorDetailFromBody('  quota exhausted  ')).toBe('quota exhausted')
    expect(providerErrorDetailFromBody('{"error":"invalid api key"}')).toBe(
      'invalid api key',
    )
    expect(
      providerErrorDetailFromBody(
        '{"error":{"message":"No balance","code":"insufficient_quota"}}',
      ),
    ).toBe('No balance insufficient_quota')
    expect(providerErrorDetailFromBody('{"message":"Too many requests"}')).toBe(
      'Too many requests',
    )
    expect(providerErrorDetailFromBody('{"detail":"gateway timeout"}')).toBe(
      'gateway timeout',
    )
  })

  it('classifies HTTP failures into stable user-facing categories', () => {
    const auth = classifyProviderHttpError(401, 'unauthorized')
    const quota = classifyProviderHttpError(402, 'billing quota exhausted')
    const timeout = classifyProviderHttpError(504, 'gateway time-out')
    const rateLimit = classifyProviderHttpError(429, 'too many requests')
    const endpoint = classifyProviderHttpError(404, 'route not found')
    const missingModel = classifyProviderHttpError(
      404,
      'model "gpt-example" is not supported model_not_found',
    )
    const methodBlockedEndpoint = classifyProviderHttpError(
      405,
      'Cannot POST /v1/audio/speech',
    )
    const notImplementedEndpoint = classifyProviderHttpError(
      501,
      'realtime not implemented',
    )
    const unsupportedRouteEndpoint = classifyProviderHttpError(
      400,
      'unsupported route /v1/moderations',
    )
    const unsupportedPathEndpoint = classifyProviderHttpError(
      400,
      'endpoint is not supported for path /v1/audio/transcriptions',
    )
    const noHandlerEndpoint = classifyProviderHttpError(
      500,
      'no handler for /v1/realtime/client_secrets',
    )
    const server = classifyProviderHttpError(503, 'provider overloaded')
    const request = classifyProviderHttpError(400, 'bad prompt')

    expect(auth).toMatchObject({
      code: 'auth',
      retryable: false,
      status: 401,
      message: 'API key is invalid. Check that it was copied completely.',
    })
    expect(quota).toMatchObject({
      code: 'quota',
      retryable: false,
      status: 402,
      message: 'API balance is insufficient. Add credit and try again.',
    })
    expect(timeout).toMatchObject({
      code: 'timeout',
      retryable: true,
      status: 504,
      message: 'Network connection failed. Check your connection and try again.',
    })
    expect(rateLimit).toMatchObject({
      code: 'rate-limit',
      retryable: true,
      status: 429,
      message: 'Too many requests. Wait a moment and retry.',
    })
    expect(endpoint).toMatchObject({
      code: 'endpoint',
      retryable: false,
      status: 404,
      message:
        'This provider or relay does not expose that endpoint. Check the capability, Base URL, or AI proxy path.',
    })
    expect(missingModel).toMatchObject({
      code: 'request',
      retryable: false,
      status: 404,
      message: 'The provider could not complete the request. Try again later.',
    })
    expect(methodBlockedEndpoint).toMatchObject({
      code: 'endpoint',
      retryable: false,
      status: 405,
      message:
        'This provider or relay does not expose that endpoint. Check the capability, Base URL, or AI proxy path.',
    })
    expect(notImplementedEndpoint).toMatchObject({
      code: 'endpoint',
      retryable: false,
      status: 501,
      message:
        'This provider or relay does not expose that endpoint. Check the capability, Base URL, or AI proxy path.',
    })
    expect(unsupportedRouteEndpoint).toMatchObject({
      code: 'endpoint',
      retryable: false,
      status: 400,
      message:
        'This provider or relay does not expose that endpoint. Check the capability, Base URL, or AI proxy path.',
    })
    expect(unsupportedPathEndpoint).toMatchObject({
      code: 'endpoint',
      retryable: false,
      status: 400,
      message:
        'This provider or relay does not expose that endpoint. Check the capability, Base URL, or AI proxy path.',
    })
    expect(noHandlerEndpoint).toMatchObject({
      code: 'endpoint',
      retryable: false,
      status: 500,
      message:
        'This provider or relay does not expose that endpoint. Check the capability, Base URL, or AI proxy path.',
    })
    expect(server).toMatchObject({
      code: 'server',
      retryable: true,
      status: 503,
      message: 'The provider is temporarily unavailable. Try again later.',
    })
    expect(request).toMatchObject({
      code: 'request',
      retryable: false,
      status: 400,
      message: 'The provider could not complete the request. Try again later.',
    })
  })

  it('wraps direct and proxied connection failures with retryable setup guidance', () => {
    const direct = providerConnectionError(provider(), 'Chat API')
    const proxied = providerConnectionError(
      provider({ proxyUrl: 'https://relay.example.workers.dev' }),
      'Model list API',
    )

    expect(direct).toBeInstanceOf(ProviderRequestError)
    expect(direct).toMatchObject({
      code: 'network',
      retryable: true,
    })
    expect(direct.message).toContain('Cannot connect to Chat API')
    expect(direct.message).toContain('browser path is blocked by CORS/preflight')
    expect(direct.message).toContain('Cloudflare Worker URL')

    expect(proxied).toMatchObject({
      code: 'network',
      retryable: true,
    })
    expect(proxied.message).toContain('Cannot connect to Model list API')
    expect(proxied.message).toContain('Cloudflare access key')
  })

  it('passes successful responses and classifies failed provider responses', async () => {
    await expect(
      assertProviderResponseOk(new Response('ok', { status: 200 })),
    ).resolves.toBeUndefined()

    await expect(
      assertProviderResponseOk(
        new Response('{"error":{"message":"invalid api key"}}', {
          status: 500,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'auth',
      retryable: false,
      status: 500,
      message: 'API key is invalid. Check that it was copied completely.',
    })

    await expect(
      assertProviderResponseOk(unreadableResponse(500)),
    ).rejects.toMatchObject({
      code: 'server',
      retryable: true,
      status: 500,
      message: 'The provider is temporarily unavailable. Try again later.',
    })
  })

  it('reads provider JSON while turning HTML or malformed bodies into stable errors', async () => {
    await expect(
      readProviderJsonResponse(
        Response.json({ data: [{ id: 'model-1' }] }, { status: 200 }),
      ),
    ).resolves.toEqual({ data: [{ id: 'model-1' }] })

    await expect(
      readProviderJsonResponse(
        new Response('<!doctype html><html><body>Login</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'server',
      retryable: true,
      status: 200,
      message:
        'The provider or relay returned a web page instead of API JSON. Check the Base URL path or AI proxy route.',
    })

    await expect(
      readProviderJsonResponse(
        new Response('{not json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'request',
      retryable: false,
      status: 200,
      message: 'The provider could not complete the request. Try again later.',
    })

    await expect(
      readProviderJsonResponse(unreadableResponse(200)),
    ).rejects.toMatchObject({
      code: 'request',
      retryable: false,
      status: 200,
      message: 'The provider could not complete the request. Try again later.',
    })
  })

  it('bounds declared and streamed Provider response bodies before allocation', async () => {
    expect(MAX_PROVIDER_ERROR_RESPONSE_BYTES).toBe(16_384)
    expect(MAX_PROVIDER_TEXT_RESPONSE_BYTES).toBe(8_000_000)
    expect(accumulateProviderResponseBytes(2, 3, 5)).toBe(5)
    expect(() => accumulateProviderResponseBytes(3, 3, 5)).toThrow(
      ProviderRequestError,
    )

    let declaredCancelled = false
    const declaredBody = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('declared length should fail before body reads')
      },
      cancel() {
        declaredCancelled = true
      },
    })
    const declaredResponse = new Response(declaredBody, {
      status: 200,
      headers: { 'content-length': '5' },
    })

    await expect(readProviderResponseBytes(declaredResponse, 4)).rejects.toMatchObject({
      code: 'request',
      retryable: false,
      status: 200,
    })
    expect(declaredCancelled).toBe(true)

    let streamedCancelled = false
    let streamedPulls = 0
    const streamedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        streamedPulls += 1
        controller.enqueue(new Uint8Array([streamedPulls, streamedPulls]))
      },
      cancel() {
        streamedCancelled = true
      },
    })

    await expect(
      readProviderResponseBytes(new Response(streamedBody, { status: 200 }), 3),
    ).rejects.toMatchObject({
      code: 'request',
      retryable: false,
      status: 200,
    })
    expect(streamedCancelled).toBe(true)
  })

  it('releases bounded Provider body readers after success and streamed rejection', async () => {
    const releaseLock = vi.spyOn(
      ReadableStreamDefaultReader.prototype,
      'releaseLock',
    )

    await expect(
      readProviderResponseBytes(new Response(new Uint8Array([1, 2])), 2),
    ).resolves.toEqual(new Uint8Array([1, 2]))
    expect(releaseLock).toHaveBeenCalledTimes(1)

    let pullCount = 0
    const oversizedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1
        controller.enqueue(new Uint8Array([pullCount, pullCount]))
      },
    })

    await expect(
      readProviderResponseBytes(new Response(oversizedBody), 3),
    ).rejects.toBeInstanceOf(ProviderRequestError)
    expect(releaseLock).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      label: 'bounded byte',
      read: (response: Response, signal: AbortSignal) =>
        readProviderResponseBytes(response, MAX_PROVIDER_TEXT_RESPONSE_BYTES, signal),
      status: 200,
    },
    {
      label: 'HTTP error',
      read: (response: Response, signal: AbortSignal) =>
        assertProviderResponseOk(response, signal),
      status: 500,
    },
    {
      label: 'JSON',
      read: (response: Response, signal: AbortSignal) =>
        readProviderJsonResponse(response, MAX_PROVIDER_TEXT_RESPONSE_BYTES, signal),
      status: 200,
    },
  ])(
    'aborts a stalled $label Provider body reader without waiting for completion',
    async ({ read: readBody, status }) => {
      const controller = new AbortController()
      const stalled = stalledProviderResponse(status)
      const request = readBody(stalled.response, controller.signal)
      const rejection = expect(request).rejects.toMatchObject({
        name: 'AbortError',
      })

      await vi.waitFor(() => expect(stalled.read).toHaveBeenCalledTimes(1))
      controller.abort()
      await rejection
      expect(stalled.cancel).toHaveBeenCalledTimes(1)
      expect(stalled.releaseLock).toHaveBeenCalledTimes(1)
    },
  )

  it('settles a cancelled Provider body when abort-listener cleanup throws', async () => {
    const stalled = stalledProviderResponse(200)
    let abortListener: (() => void) | undefined
    const signalState = {
      aborted: false,
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        abortListener = listener as unknown as () => void
      }),
      removeEventListener: vi.fn(() => {
        throw new Error('embedded listener teardown failed')
      }),
    }
    const signal = signalState as unknown as AbortSignal

    const request = readProviderResponseBytes(stalled.response, 8, signal)
    let rejection: unknown
    void request.catch((error: unknown) => {
      rejection = error
    })

    await vi.waitFor(() => expect(stalled.read).toHaveBeenCalledTimes(1))
    signalState.aborted = true
    abortListener?.()
    await vi.waitFor(
      () => expect(rejection).toMatchObject({ name: 'AbortError' }),
      { timeout: 100, interval: 0 },
    )

    expect(stalled.cancel).toHaveBeenCalledTimes(1)
    expect(stalled.releaseLock).toHaveBeenCalledTimes(1)
  })
})
