import { providerTimeoutSignal as syncTimeoutSignal } from './providerTimeoutSignal'

export const MAX_SYNC_SNAPSHOT_BYTES = 900_000
export const MAX_SYNC_INCREMENTAL_OBJECT_BYTES = 5_000_000
export const MAX_SYNC_INCREMENTAL_HEAD_BYTES = 16_384
export const MAX_SYNC_ERROR_BODY_BYTES = 16_384
export const MAX_SYNC_GIST_RESPONSE_BYTES = 5_000_000
export const SYNC_REQUEST_TIMEOUT_MS = 60_000

const utf8Encoder = new TextEncoder()
const syncTimeoutMessage = 'Cloud sync timed out. Check the connection and try again.'

function isSyncTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

function syncTimeoutError(): Error {
  return new Error(syncTimeoutMessage)
}

function syncAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function isSyncAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function cancelSyncResponseBody(
  body: ReadableStream<Uint8Array> | null,
  reason?: unknown,
): void {
  try {
    void body?.cancel(reason).catch(() => undefined)
  } catch {
    // Response cleanup is best-effort and must not replace the request result.
  }
}

function cancelSyncResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): void {
  try {
    void reader.cancel(reason).catch(() => undefined)
  } catch {
    // Non-compliant readers must not block timeout, abort, or size rejection.
  }
}

function releaseSyncResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    reader.releaseLock()
  } catch {
    // A reader that ignores cancellation may still have a pending read.
  }
}

function throwIfSyncResponseAborted(
  signal?: AbortSignal,
  reader?: ReadableStreamDefaultReader<Uint8Array>,
): void {
  if (!signal?.aborted) {
    return
  }

  if (reader) {
    cancelSyncResponseReader(reader)
  }
  throw syncAbortError()
}

function readSyncResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  throwIfSyncResponseAborted(signal, reader)

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
      cancelSyncResponseReader(reader)
      reject(syncAbortError())
    }
    const settle = (action: () => void) => {
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

export async function fetchSync<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  consumeResponse: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutSignal = syncTimeoutSignal(init?.signal, SYNC_REQUEST_TIMEOUT_MS)
  let response: Response | undefined

  try {
    response = await fetch(input, {
      ...init,
      redirect: 'error',
      signal: timeoutSignal.signal,
    })
    const result = await consumeResponse(response, timeoutSignal.signal)
    timeoutSignal.signal.throwIfAborted()
    return result
  } catch (error: unknown) {
    if (timeoutSignal.timedOut()) {
      throw syncTimeoutError()
    }

    if (timeoutSignal.sourceAborted()) {
      throw syncAbortError()
    }

    if (isSyncTimeoutError(error)) {
      throw syncTimeoutError()
    }

    throw error
  } finally {
    if (response && !response.bodyUsed) {
      cancelSyncResponseBody(response.body)
    }
    timeoutSignal.dispose()
  }
}

function responseTooLargeMessage(label: string, maxBytes: number): string {
  return `${label} exceeded the ${maxBytes}-byte safety limit.`
}

export function assertSyncTextSize(
  text: string,
  maxBytes: number,
  label: string,
): void {
  if (utf8Encoder.encode(text).byteLength > maxBytes) {
    throw new Error(responseTooLargeMessage(label, maxBytes))
  }
}

export async function readSyncResponseText(
  response: Response,
  maxBytes: number,
  label: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfSyncResponseAborted(signal)
  const body = response.body
  const tooLarge = responseTooLargeMessage(label, maxBytes)
  const declaredLength = Number(response.headers.get('content-length'))
  if (declaredLength > maxBytes) {
    cancelSyncResponseBody(body, tooLarge)
    throwIfSyncResponseAborted(signal)
    throw new Error(tooLarge)
  }

  if (!body) {
    throwIfSyncResponseAborted(signal)
    return ''
  }

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const parts: string[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await readSyncResponseChunk(reader, signal)
      throwIfSyncResponseAborted(signal, reader)
      if (done) {
        break
      }

      if (!value?.byteLength) {
        continue
      }

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        cancelSyncResponseReader(reader, tooLarge)
        throw new Error(tooLarge)
      }

      parts.push(decoder.decode(value, { stream: true }))
    }

    throwIfSyncResponseAborted(signal, reader)
    parts.push(decoder.decode())
    throwIfSyncResponseAborted(signal, reader)
    return parts.join('')
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw syncAbortError()
    }

    cancelSyncResponseReader(reader)
    throw error
  } finally {
    releaseSyncResponseReader(reader)
  }
}

export async function readSyncResponseJson<T>(
  response: Response,
  maxBytes: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  return JSON.parse(
    await readSyncResponseText(response, maxBytes, label, signal),
  ) as T
}

export async function readSyncError(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  const fallback = `HTTP ${response.status}`
  try {
    const text = await readSyncResponseText(
      response,
      MAX_SYNC_ERROR_BODY_BYTES,
      'Cloud sync error response',
      signal,
    )
    return text || fallback
  } catch (error: unknown) {
    if (signal?.aborted || isSyncAbortError(error) || isSyncTimeoutError(error)) {
      throw error
    }

    return fallback
  }
}
