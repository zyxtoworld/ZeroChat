import { describe, expect, it } from 'vitest'

import {
  MAX_DECOMPRESSED_SYNC_JSON_BYTES,
  decompressJsonPayload,
  readBoundedByteStream,
} from '../crypto'

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const stream = new Blob([buffer])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))

  return readBoundedByteStream(
    stream,
    Number.MAX_SAFE_INTEGER,
    'Test gzip data',
  )
}

describe('encrypted sync decompression limits', () => {
  it('keeps the cross-platform decompressed JSON budget', () => {
    expect(MAX_DECOMPRESSED_SYNC_JSON_BYTES).toBe(32_000_000)
  })

  it('accepts the gzip boundary and rejects one decompressed byte over it', async () => {
    const payload = new TextEncoder().encode('12345')
    const compressed = await gzip(payload)

    await expect(
      decompressJsonPayload(compressed, 'gzip', payload.byteLength),
    ).resolves.toEqual(payload)
    await expect(
      decompressJsonPayload(compressed, 'gzip', payload.byteLength - 1),
    ).rejects.toThrow('Encrypted sync data exceeded the 4-byte safety limit.')
  })

  it('does not wait for a stalled source cancellation after the byte limit is exceeded', async () => {
    let releaseCancel: () => void = () => undefined
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve
    })
    let cancelStarted = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
      },
      cancel() {
        cancelStarted = true
        return cancelGate
      },
    })

    let settled = false
    const rejection = readBoundedByteStream(stream, 1, 'Test data').catch(
      (error: unknown) => {
        settled = true
        throw error
      },
    )

    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(cancelStarted).toBe(true)
      expect(settled).toBe(true)
    } finally {
      releaseCancel()
      await rejection.catch(() => undefined)
    }

    await expect(rejection).rejects.toThrow(
      'Test data exceeded the 1-byte safety limit.',
    )
  })

  it('keeps the byte-limit error when reader cancellation throws synchronously', async () => {
    const stream = {
      getReader: () => ({
        read: async () => ({
          done: false,
          value: new Uint8Array([1, 2]),
        }),
        cancel: () => {
          throw new Error('reader cancel failed')
        },
        releaseLock: () => undefined,
      }),
    } as unknown as ReadableStream<Uint8Array>

    await expect(
      readBoundedByteStream(stream, 1, 'Test data'),
    ).rejects.toThrow('Test data exceeded the 1-byte safety limit.')
  })

  it('applies the same budget to uncompressed authenticated objects', async () => {
    const payload = new TextEncoder().encode('12345')

    await expect(
      decompressJsonPayload(payload, 'none', payload.byteLength),
    ).resolves.toBe(payload)
    await expect(
      decompressJsonPayload(payload, 'none', payload.byteLength - 1),
    ).rejects.toThrow('Encrypted sync data exceeded the 4-byte safety limit.')
  })
})
