import { rt } from '../i18n'
import type { ProviderConfig } from '../types'
import { providerUsesProxy } from './providerRequestMode'

export type ProviderRequestErrorCode =
  | 'network'
  | 'auth'
  | 'quota'
  | 'rate-limit'
  | 'endpoint'
  | 'timeout'
  | 'server'
  | 'request'

export const MAX_PROVIDER_ERROR_RESPONSE_BYTES = 16_384
export const MAX_PROVIDER_TEXT_RESPONSE_BYTES = 8_000_000
export const MAX_PROVIDER_IMAGE_RESPONSE_BYTES = 32_000_000
export const MAX_PROVIDER_AUDIO_RESPONSE_BYTES = 32_000_000
export const MAX_PROVIDER_STREAM_RESPONSE_BYTES = 8_000_000

export class ProviderRequestError extends Error {
  code: ProviderRequestErrorCode
  retryable: boolean
  status?: number

  constructor(
    code: ProviderRequestErrorCode,
    message: string,
    options: { retryable: boolean; status?: number },
  ) {
    super(message)
    this.name = 'ProviderRequestError'
    this.code = code
    this.retryable = options.retryable
    this.status = options.status
  }
}

export function providerConnectionError(
  provider: ProviderConfig,
  target: string,
): ProviderRequestError {
  if (providerUsesProxy(provider)) {
    return new ProviderRequestError(
      'network',
      rt('error.providerConnectProxy', { target }),
      { retryable: true },
    )
  }

  return new ProviderRequestError(
    'network',
    rt('error.providerConnectDirect', { target }),
    { retryable: true },
  )
}

export function providerTimeoutError(): ProviderRequestError {
  return new ProviderRequestError(
    'timeout',
    rt('error.networkRequestFailed'),
    { retryable: true },
  )
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function providerResponseAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function cancelProviderResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    // Provider response cleanup is best-effort; cancellation owns the result.
    void reader.cancel().catch(() => undefined)
  } catch {
    // A non-compliant reader must not replace the cancellation result.
  }
}

function throwIfProviderResponseAborted(
  signal?: AbortSignal,
  reader?: ReadableStreamDefaultReader<Uint8Array>,
): void {
  if (!signal?.aborted) {
    return
  }

  if (reader) {
    cancelProviderResponseReader(reader)
  }
  throw providerResponseAbortError()
}

function readProviderResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  throwIfProviderResponseAborted(signal, reader)

  if (!signal) {
    return reader.read()
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      cancelProviderResponseReader(reader)
      reject(providerResponseAbortError())
    }
    const settle = (
      action: () => void,
    ) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      action()
    }

    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }

    let read: Promise<ReadableStreamReadResult<Uint8Array>>
    try {
      read = reader.read()
    } catch (error: unknown) {
      settle(() => reject(error))
      return
    }

    read.then(
      (result) => {
        if (signal.aborted) {
          abort()
          return
        }
        settle(() => resolve(result))
      },
      (error: unknown) => settle(() => reject(error)),
    )
  })
}

type ProviderResponseText = {
  text: string
  readable: boolean
}

function providerResponseReadError(status?: number): ProviderRequestError {
  return new ProviderRequestError('request', rt('error.apiRequestFailed'), {
    retryable: false,
    status,
  })
}

export function accumulateProviderResponseBytes(
  currentBytes: number,
  nextBytes: number,
  maxBytes: number,
  status?: number,
): number {
  if (
    !Number.isSafeInteger(currentBytes) ||
    currentBytes < 0 ||
    !Number.isSafeInteger(nextBytes) ||
    nextBytes < 0 ||
    currentBytes > maxBytes - nextBytes
  ) {
    throw providerResponseReadError(status)
  }

  return currentBytes + nextBytes
}

export async function assertProviderResponseContentLength(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfProviderResponseAborted(signal)
  const declaredLength = Number(response.headers.get('content-length'))

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  ) {
    try {
      void response.body?.cancel().catch(() => undefined)
    } catch {
      // Declared-size rejection must not wait for provider cleanup.
    }
    throwIfProviderResponseAborted(signal)
    throw providerResponseReadError(response.status)
  }
}

export async function readProviderResponseBytes(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  await assertProviderResponseContentLength(response, maxBytes, signal)
  const body = response.body

  if (!body) {
    throwIfProviderResponseAborted(signal)
    return new Uint8Array()
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await readProviderResponseChunk(reader, signal)
      throwIfProviderResponseAborted(signal, reader)

      if (done) {
        break
      }

      if (!value?.byteLength) {
        continue
      }

      totalBytes = accumulateProviderResponseBytes(
        totalBytes,
        value.byteLength,
        maxBytes,
        response.status,
      )
      chunks.push(value)
    }
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw providerResponseAbortError()
    }

    cancelProviderResponseReader(reader)

    if (isAbortError(error) || error instanceof ProviderRequestError) {
      throw error
    }

    throw providerResponseReadError(response.status)
  }

  throwIfProviderResponseAborted(signal, reader)

  const bytes = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

export async function readProviderResponseText(
  response: Response,
  maxBytes = MAX_PROVIDER_TEXT_RESPONSE_BYTES,
  signal?: AbortSignal,
): Promise<ProviderResponseText> {
  try {
    return {
      text: new TextDecoder().decode(
        await readProviderResponseBytes(response, maxBytes, signal),
      ),
      readable: true,
    }
  } catch (error: unknown) {
    if (signal?.aborted || isAbortError(error)) {
      throw providerResponseAbortError()
    }

    return {
      text: '',
      readable: false,
    }
  }
}

export async function assertProviderResponseOk(
  response: Response,
  signal?: AbortSignal,
): Promise<void> {
  throwIfProviderResponseAborted(signal)
  if (response.ok) {
    return
  }

  const body = await readProviderResponseText(
    response,
    MAX_PROVIDER_ERROR_RESPONSE_BYTES,
    signal,
  )
  throwIfProviderResponseAborted(signal)
  const detail = providerErrorDetailFromBody(body.text)
  throw classifyProviderHttpError(response.status, detail)
}

function providerResponseBodyLooksLikeHtml(text: string): boolean {
  const lower = text.trimStart().slice(0, 256).toLowerCase()

  return (
    lower.startsWith('<!doctype html') ||
    lower.startsWith('<html') ||
    lower.includes('<head') ||
    lower.includes('<body') ||
    lower.includes('<title')
  )
}

export async function readProviderJsonResponse(
  response: Response,
  maxBytes = MAX_PROVIDER_TEXT_RESPONSE_BYTES,
  signal?: AbortSignal,
): Promise<unknown> {
  const body = await readProviderResponseText(response, maxBytes, signal)
  throwIfProviderResponseAborted(signal)
  if (!body.readable) {
    throw new ProviderRequestError('request', rt('error.apiRequestFailed'), {
      retryable: false,
      status: response.status,
    })
  }

  const text = body.text
  const trimmed = text.trim()

  if (!trimmed) {
    throw new ProviderRequestError('request', rt('error.apiRequestFailed'), {
      retryable: false,
      status: response.status,
    })
  }

  if (providerResponseBodyLooksLikeHtml(trimmed)) {
    throw new ProviderRequestError('server', rt('error.providerReturnedHtml'), {
      retryable: true,
      status: response.status,
    })
  }

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    throw new ProviderRequestError('request', rt('error.apiRequestFailed'), {
      retryable: false,
      status: response.status,
    })
  }
}

export function providerErrorDetailFromBody(text: string): string {
  const trimmed = text.trim()

  if (!trimmed) {
    return ''
  }

  if (providerResponseBodyLooksLikeHtml(trimmed)) {
    return 'html-error-page'
  }

  try {
    const json = JSON.parse(trimmed) as {
      error?: unknown
      message?: unknown
      detail?: unknown
    }
    const error = json.error

    if (typeof error === 'string') {
      return error
    }

    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown; code?: unknown }).message
      const code = (error as { message?: unknown; code?: unknown }).code

      return [message, code]
        .filter((item): item is string => typeof item === 'string')
        .join(' ')
    }

    if (typeof json.message === 'string') {
      return json.message
    }

    if (typeof json.detail === 'string') {
      return json.detail
    }
  } catch {
    // Plain-text provider errors are still classified without showing them raw.
  }

  return trimmed
}

export function classifyProviderHttpError(
  status: number,
  detail: string,
): ProviderRequestError {
  const lower = detail.toLowerCase()
  const mentionsMissingEndpoint =
    lower.includes('cannot post') ||
    lower.includes('cannot get') ||
    lower.includes('endpoint not found') ||
    lower.includes('endpoint is not supported') ||
    lower.includes('invalid endpoint') ||
    lower.includes('method not allowed') ||
    lower.includes('no handler') ||
    lower.includes('not found endpoint') ||
    lower.includes('not implemented') ||
    lower.includes('path not found') ||
    lower.includes('no route') ||
    lower.includes('route not found') ||
    lower.includes('route is not supported') ||
    lower.includes('route-missing') ||
    lower.includes('unknown route') ||
    lower.includes('unsupported api') ||
    lower.includes('unknown endpoint') ||
    lower.includes('unsupported endpoint') ||
    lower.includes('unsupported path') ||
    lower.includes('unsupported route')
  const mentionsAuth =
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('permission')
  const mentionsQuota =
    lower.includes('insufficient_quota') ||
    lower.includes('quota') ||
    lower.includes('billing') ||
    lower.includes('credit') ||
    lower.includes('balance')
  const mentionsTimeout =
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('gateway time-out')
  const mentionsRateLimit =
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  const mentionsMissingModel =
    lower.includes('model_not_found') ||
    lower.includes('model not found') ||
    lower.includes('unknown model') ||
    lower.includes('unsupported model') ||
    /\bmodel\b.{0,160}\b(?:does not exist|is not supported|is unavailable)\b/u.test(
      lower,
    )

  if (status === 401 || status === 403 || mentionsAuth) {
    return new ProviderRequestError('auth', rt('error.apiKeyInvalid'), {
      retryable: false,
      status,
    })
  }

  if (status === 402 || mentionsQuota) {
    return new ProviderRequestError('quota', rt('error.apiBalanceInsufficient'), {
      retryable: false,
      status,
    })
  }

  if (status === 408 || status === 504 || mentionsTimeout) {
    return new ProviderRequestError('timeout', rt('error.networkRequestFailed'), {
      retryable: true,
      status,
    })
  }

  if (status === 429 || mentionsRateLimit) {
    return new ProviderRequestError('rate-limit', rt('error.apiRateLimited'), {
      retryable: true,
      status,
    })
  }

  if (mentionsMissingModel) {
    return new ProviderRequestError('request', rt('error.apiRequestFailed'), {
      retryable: false,
      status,
    })
  }

  if (
    status === 404 ||
    status === 405 ||
    status === 501 ||
    mentionsMissingEndpoint
  ) {
    return new ProviderRequestError(
      'endpoint',
      rt('error.providerEndpointMissing'),
      {
        retryable: false,
        status,
      },
    )
  }

  if (status >= 500) {
    return new ProviderRequestError('server', rt('error.apiUnavailable'), {
      retryable: true,
      status,
    })
  }

  return new ProviderRequestError('request', rt('error.apiRequestFailed'), {
    retryable: false,
    status,
  })
}
