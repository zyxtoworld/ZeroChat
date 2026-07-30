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
