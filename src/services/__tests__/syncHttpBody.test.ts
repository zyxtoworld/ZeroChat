import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SYNC_REQUEST_TIMEOUT_MS,
  assertSyncTextSize,
  fetchSync,
  readSyncError,
  readSyncResponseJson,
  readSyncResponseText,
} from '../syncHttpBody'

function responseWithReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: {
    bodyCancel?: (reason?: unknown) => Promise<void>
    headers?: HeadersInit
    status?: number
  } = {},
): Response {
  const status = options.status ?? 200
  const body = {
    cancel: options.bodyCancel ?? (async () => undefined),
    getReader: () => reader,
  } as unknown as ReadableStream<Uint8Array>

  return {
    body,
    bodyUsed: true,
    headers: new Headers(options.headers),
    ok: status >= 200 && status < 300,
    status,
  } as Response
}

function stalledReader(
  cancel: (reason?: unknown) => Promise<void> = async () => undefined,
  releaseLock: () => void = () => undefined,
): ReadableStreamDefaultReader<Uint8Array> {
  return {
    cancel,
    read: () => new Promise(() => undefined),
    releaseLock,
  } as unknown as ReadableStreamDefaultReader<Uint8Array>
}

describe('sync HTTP body limits', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('counts UTF-8 bytes instead of JavaScript characters', () => {
    expect(() => assertSyncTextSize('你好', 6, 'payload')).not.toThrow()
    expect(() => assertSyncTextSize('你好', 5, 'payload')).toThrow(
      'payload exceeded the 5-byte safety limit.',
    )
  })

  it('rejects automatic redirects for sync fetches', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null))

    await expect(
      fetchSync(
        'https://sync.example.test/snapshot',
        {
          headers: { authorization: 'Bearer sync-secret' },
          redirect: 'follow',
        },
        async () => 'ok',
      ),
    ).resolves.toBe('ok')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example.test/snapshot',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('rejects an oversized declared response without awaiting cleanup', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
        return new Promise(() => undefined)
      },
    })
    const response = new Response(body, {
      headers: { 'content-length': '100' },
    })

    await expect(readSyncResponseText(response, 10, 'payload')).rejects.toThrow(
      'payload exceeded the 10-byte safety limit.',
    )
    expect(cancelled).toBe(true)
  })

  it('cancels a chunked response as soon as streamed bytes cross the limit', async () => {
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('1234'))
          controller.enqueue(new TextEncoder().encode('5678'))
        },
        cancel() {
          cancelled = true
          return new Promise(() => undefined)
        },
      }),
    )

    await expect(readSyncResponseText(response, 7, 'payload')).rejects.toThrow(
      'payload exceeded the 7-byte safety limit.',
    )
    expect(cancelled).toBe(true)
  })

  it('reads empty and zero-byte response bodies without changing the result', async () => {
    const empty = await readSyncResponseText(new Response(null), 8, 'payload')
    const zeroByte = await readSyncResponseText(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array())
            controller.enqueue(new TextEncoder().encode('ok'))
            controller.close()
          },
        }),
      ),
      8,
      'payload',
    )

    expect(empty).toBe('')
    expect(zeroByte).toBe('ok')
  })

  it('parses JSON only after the bounded stream completes', async () => {
    const value = await readSyncResponseJson<{ ok: boolean }>(
      new Response('{"ok":true}'),
      32,
      'payload',
    )

    expect(value).toEqual({ ok: true })
  })

  it('does not surface or retain an oversized remote error body', async () => {
    const response = new Response('x'.repeat(20_000), { status: 502 })

    await expect(readSyncError(response)).resolves.toBe('HTTP 502')
  })

  it.each(['AbortError', 'TimeoutError'])(
    'preserves %s failures while reading a remote error body',
    async (name) => {
      const failure = new DOMException('interrupted', name)
      const reader = {
        cancel: async () => undefined,
        read: async () => {
          throw failure
        },
        releaseLock: () => undefined,
      } as unknown as ReadableStreamDefaultReader<Uint8Array>

      await expect(
        readSyncError(responseWithReader(reader, { status: 502 })),
      ).rejects.toBe(failure)
    },
  )

  it('keeps the original read failure when reader cleanup throws', async () => {
    const failure = new Error('read failed')
    const reader = {
      cancel: () => {
        throw new Error('cancel failed')
      },
      read: () => {
        throw failure
      },
      releaseLock: () => {
        throw new Error('release failed')
      },
    } as unknown as ReadableStreamDefaultReader<Uint8Array>

    await expect(
      readSyncResponseText(responseWithReader(reader), 32, 'payload'),
    ).rejects.toBe(failure)
  })

  it('rejects a response body immediately when its signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      readSyncResponseText(new Response('late'), 32, 'payload', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('applies one 60-second timeout signal to sync fetches', async () => {
    vi.useFakeTimers()
    const readerCancel = vi.fn(() => new Promise<void>(() => undefined))
    const readerRelease = vi.fn(() => {
      throw new Error('pending read')
    })
    const response = responseWithReader(
      stalledReader(readerCancel, readerRelease),
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)

    const request = fetchSync(
      'https://sync.example.test/snapshot',
      {},
      (received, signal) => readSyncResponseText(received, 32, 'payload', signal),
    )
    const rejection = expect(request).rejects.toThrow(
      'Cloud sync timed out. Check the connection and try again.',
    )
    await vi.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS)

    await rejection
    expect(readerCancel).toHaveBeenCalled()
    expect(readerRelease).toHaveBeenCalled()
  })

  it('times out while waiting for response headers', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        )
      }),
    )

    const request = fetchSync(
      'https://sync.example.test/snapshot',
      {},
      async () => undefined,
    )
    const rejection = expect(request).rejects.toThrow(
      'Cloud sync timed out. Check the connection and try again.',
    )
    await vi.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS)

    await rejection
  })

  it('maps response-stream timeout failures to an actionable sync error', async () => {
    vi.useFakeTimers()
    const failure = new DOMException('timed out', 'TimeoutError')
    const reader = {
      cancel: async () => undefined,
      read: async () => {
        throw failure
      },
      releaseLock: () => undefined,
    } as unknown as ReadableStreamDefaultReader<Uint8Array>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(responseWithReader(reader))

    await expect(
      fetchSync(
        'https://sync.example.test/snapshot',
        {},
        (response, signal) =>
          readSyncResponseText(response, 32, 'payload', signal),
      ),
    ).rejects.toThrow('Cloud sync timed out. Check the connection and try again.')
  })

  it('preserves caller cancellation instead of reporting a timeout', async () => {
    vi.useFakeTimers()
    const source = new AbortController()
    const readerCancel = vi.fn(async () => undefined)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      responseWithReader(stalledReader(readerCancel)),
    )

    const request = fetchSync(
      'https://sync.example.test/snapshot',
      { signal: source.signal },
      (response, signal) =>
        readSyncResponseText(response, 32, 'payload', signal),
    )
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    source.abort()

    await rejection
    expect(readerCancel).toHaveBeenCalled()
  })

  it('does not start fetch when the caller is already cancelled', async () => {
    const source = new AbortController()
    source.abort()
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      fetchSync(
        'https://sync.example.test/snapshot',
        { signal: source.signal },
        async () => 'unreachable',
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a late consumer result after caller cancellation', async () => {
    vi.useFakeTimers()
    const source = new AbortController()
    let resolveConsumer: (value: string) => void = () => undefined
    const consumer = new Promise<string>((resolve) => {
      resolveConsumer = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null))

    const request = fetchSync(
      'https://sync.example.test/snapshot',
      { signal: source.signal },
      async () => consumer,
    )
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    source.abort()
    resolveConsumer('late')

    await rejection
  })

  it('contains unconsumed response-body cleanup failures', async () => {
    const response = {
      body: {
        cancel: () => {
          throw new Error('cleanup failed')
        },
      },
      bodyUsed: false,
      headers: new Headers(),
      ok: true,
      status: 200,
    } as unknown as Response
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)

    await expect(
      fetchSync(
        'https://sync.example.test/snapshot',
        {},
        async () => 'ok',
      ),
    ).resolves.toBe('ok')
  })
})
