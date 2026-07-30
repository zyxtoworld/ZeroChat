import { describe, expect, it } from 'vitest'

import {
  isEncryptedObject,
  isEncryptedSnapshot,
} from '../crypto'

const cryptoConfig = {
  aad: 'aad',
  cipher: 'AES-256-GCM',
  iterations: 600_000,
  iv: 'iv',
  kdf: 'PBKDF2-SHA256',
  salt: 'salt',
} as const

describe('encrypted envelope shape guards', () => {
  it('requires complete encrypted snapshot envelope fields', () => {
    const valid = {
      kind: 'zerochat.encryptedSnapshot',
      version: 1,
      encryptedAt: 1,
      updatedAt: 1,
      crypto: cryptoConfig,
      payload: 'payload',
    }

    expect(isEncryptedSnapshot(valid)).toBe(true)
    expect(isEncryptedSnapshot({ kind: valid.kind, version: 1 })).toBe(false)
    expect(isEncryptedSnapshot({ ...valid, crypto: null })).toBe(false)
    expect(isEncryptedSnapshot({ ...valid, payload: 42 })).toBe(false)
  })

  it('requires complete encrypted object envelope fields and compression', () => {
    const valid = {
      kind: 'zerochat.encryptedObject',
      version: 1,
      objectType: 'manifest',
      encryptedAt: 1,
      updatedAt: 1,
      crypto: {
        ...cryptoConfig,
        compression: 'gzip',
      },
      payload: 'payload',
    }

    expect(isEncryptedObject(valid)).toBe(true)
    expect(isEncryptedObject({ ...valid, objectType: 42 })).toBe(false)
    expect(isEncryptedObject({
      ...valid,
      crypto: { ...cryptoConfig, compression: 'brotli' },
    })).toBe(false)
    expect(isEncryptedObject({ ...valid, updatedAt: '1' })).toBe(false)
  })
})
