import type {
  EncryptedObjectEnvelope,
  EncryptedSnapshotEnvelope,
  SyncVault,
} from '../types'
import { rt } from '../i18n'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const VAULT_KDF = 'PBKDF2-SHA256'
export const VAULT_CIPHER = 'AES-256-GCM'
export const VAULT_KDF_ITERATIONS = 600_000
export const MAX_DECOMPRESSED_SYNC_JSON_BYTES = 32_000_000

const SALT_BYTES = 16
const IV_BYTES = 12

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function aadFor(updatedAt: number): Uint8Array {
  return encoder.encode(`zerochat:vault:v1:${updatedAt}`)
}

function objectAadFor(objectType: string, updatedAt: number): Uint8Array {
  return encoder.encode(`zerochat:object:v1:${objectType}:${updatedAt}`)
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }

  let diff = 0

  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index] ^ right[index]
  }

  return diff === 0
}

function assertSafeTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(rt('error.crypto.invalidField', { field }))
  }
}

function decodeFixedBase64(
  value: string,
  size: number,
  field: string,
): Uint8Array {
  let bytes: Uint8Array

  try {
    bytes = base64ToBytes(value)
  } catch {
    throw new Error(rt('error.crypto.badBase64', { field }))
  }

  if (bytes.byteLength !== size) {
    throw new Error(rt('error.crypto.invalidField', { field }))
  }

  return bytes
}

function decodeBase64(value: string, field: string): Uint8Array {
  try {
    return base64ToBytes(value)
  } catch {
    throw new Error(rt('error.crypto.badBase64', { field }))
  }
}

function assertEnvelopeCrypto(envelope: EncryptedSnapshotEnvelope): {
  salt: Uint8Array
  iv: Uint8Array
  aad: Uint8Array
  payload: Uint8Array
} {
  assertSafeTimestamp(envelope.encryptedAt, 'encryptedAt')
  assertSafeTimestamp(envelope.updatedAt, 'updatedAt')

  if (envelope.crypto.cipher !== VAULT_CIPHER || envelope.crypto.kdf !== VAULT_KDF) {
    throw new Error(rt('error.crypto.unsupportedSnapshot'))
  }

  if (
    !Number.isSafeInteger(envelope.crypto.iterations) ||
    envelope.crypto.iterations !== VAULT_KDF_ITERATIONS
  ) {
    throw new Error(rt('error.crypto.badKdf'))
  }

  const salt = decodeFixedBase64(envelope.crypto.salt, SALT_BYTES, 'salt')
  const iv = decodeFixedBase64(envelope.crypto.iv, IV_BYTES, 'iv')
  const aad = decodeBase64(envelope.crypto.aad, 'aad')
  const expectedAad = aadFor(envelope.updatedAt)

  if (!bytesEqual(aad, expectedAad)) {
    throw new Error(rt('error.crypto.aadMismatch'))
  }

  const payload = decodeBase64(envelope.payload, 'payload')

  if (payload.byteLength <= 16) {
    throw new Error(rt('error.crypto.emptyPayload'))
  }

  return {
    salt,
    iv,
    aad: expectedAad,
    payload,
  }
}

function assertObjectEnvelopeCrypto(
  envelope: EncryptedObjectEnvelope,
  expectedObjectType: string,
): {
  salt: Uint8Array
  iv: Uint8Array
  aad: Uint8Array
  payload: Uint8Array
} {
  assertSafeTimestamp(envelope.encryptedAt, 'encryptedAt')
  assertSafeTimestamp(envelope.updatedAt, 'updatedAt')

  if (envelope.objectType !== expectedObjectType) {
    throw new Error(rt('error.crypto.badObjectType'))
  }

  if (envelope.crypto.cipher !== VAULT_CIPHER || envelope.crypto.kdf !== VAULT_KDF) {
    throw new Error(rt('error.crypto.unsupportedObject'))
  }

  if (
    !Number.isSafeInteger(envelope.crypto.iterations) ||
    envelope.crypto.iterations !== VAULT_KDF_ITERATIONS
  ) {
    throw new Error(rt('error.crypto.badObjectKdf'))
  }

  if (
    envelope.crypto.compression !== 'gzip' &&
    envelope.crypto.compression !== 'none'
  ) {
    throw new Error(rt('error.crypto.badObjectCompression'))
  }

  const salt = decodeFixedBase64(envelope.crypto.salt, SALT_BYTES, 'salt')
  const iv = decodeFixedBase64(envelope.crypto.iv, IV_BYTES, 'iv')
  const aad = decodeBase64(envelope.crypto.aad, 'aad')
  const expectedAad = objectAadFor(envelope.objectType, envelope.updatedAt)

  if (!bytesEqual(aad, expectedAad)) {
    throw new Error(rt('error.crypto.badObjectAad'))
  }

  const payload = decodeBase64(envelope.payload, 'payload')

  if (payload.byteLength <= 16) {
    throw new Error(rt('error.crypto.emptyObjectPayload'))
  }

  return {
    salt,
    iv,
    aad: expectedAad,
    payload,
  }
}

async function transformBytes(
  bytes: Uint8Array,
  format: 'gzip',
  mode: 'compress' | 'decompress',
  maxOutputBytes = Number.MAX_SAFE_INTEGER,
): Promise<Uint8Array> {
  const stream =
    mode === 'compress'
      ? new Blob([toArrayBuffer(bytes)])
          .stream()
          .pipeThrough(new CompressionStream(format))
      : new Blob([toArrayBuffer(bytes)])
          .stream()
          .pipeThrough(new DecompressionStream(format))

  return readBoundedByteStream(
    stream,
    maxOutputBytes,
    mode === 'decompress' ? 'Encrypted sync data' : 'Compressed sync data',
  )
}

export async function readBoundedByteStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  assertByteStreamLimit(maxBytes)

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      if (value.byteLength > maxBytes - totalBytes) {
        const error = new Error(
          `${label} exceeded the ${maxBytes}-byte safety limit.`,
        )

        await reader.cancel(error).catch(() => undefined)
        throw error
      }

      chunks.push(value)
      totalBytes += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }

  return output
}

function assertByteStreamLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('Byte stream limit must be a non-negative safe integer.')
  }
}

async function compressJsonPayload(bytes: Uint8Array): Promise<{
  compression: 'gzip' | 'none'
  bytes: Uint8Array
}> {
  if (
    typeof CompressionStream === 'undefined' ||
    typeof DecompressionStream === 'undefined'
  ) {
    return {
      compression: 'none',
      bytes,
    }
  }

  try {
    const compressed = await transformBytes(bytes, 'gzip', 'compress')

    if (compressed.byteLength >= bytes.byteLength) {
      return {
        compression: 'none',
        bytes,
      }
    }

    return {
      compression: 'gzip',
      bytes: compressed,
    }
  } catch {
    return {
      compression: 'none',
      bytes,
    }
  }
}

export async function decompressJsonPayload(
  bytes: Uint8Array,
  compression: 'gzip' | 'none',
  maxBytes = MAX_DECOMPRESSED_SYNC_JSON_BYTES,
): Promise<Uint8Array> {
  assertByteStreamLimit(maxBytes)

  if (compression === 'none') {
    if (bytes.byteLength > maxBytes) {
      throw new Error(
        `Encrypted sync data exceeded the ${maxBytes}-byte safety limit.`,
      )
    }

    return bytes
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new Error(rt('error.crypto.unsupportedDecompression'))
  }

  return transformBytes(bytes, 'gzip', 'decompress', maxBytes)
}

async function deriveVaultKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    material,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

function isEncryptedCryptoShape(
  value: unknown,
): value is EncryptedSnapshotEnvelope['crypto'] {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const cryptoConfig = value as Record<string, unknown>

  return (
    typeof cryptoConfig.cipher === 'string' &&
    typeof cryptoConfig.kdf === 'string' &&
    typeof cryptoConfig.iterations === 'number' &&
    typeof cryptoConfig.salt === 'string' &&
    typeof cryptoConfig.iv === 'string' &&
    typeof cryptoConfig.aad === 'string'
  )
}

function isEncryptedEnvelopeShape(
  value: unknown,
): value is Pick<
  EncryptedSnapshotEnvelope,
  'encryptedAt' | 'updatedAt' | 'crypto' | 'payload'
> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const envelope = value as Partial<EncryptedSnapshotEnvelope>

  return (
    typeof envelope.encryptedAt === 'number' &&
    typeof envelope.updatedAt === 'number' &&
    isEncryptedCryptoShape(envelope.crypto) &&
    typeof envelope.payload === 'string'
  )
}

export function isEncryptedSnapshot(value: unknown): value is EncryptedSnapshotEnvelope {
  const envelope = value as Partial<EncryptedSnapshotEnvelope> | null

  return (
    envelope?.kind === 'zerochat.encryptedSnapshot' &&
    envelope.version === 1 &&
    isEncryptedEnvelopeShape(value)
  )
}

export function isEncryptedObject(value: unknown): value is EncryptedObjectEnvelope {
  const envelope = value as Partial<EncryptedObjectEnvelope> | null

  return (
    envelope?.kind === 'zerochat.encryptedObject' &&
    envelope.version === 1 &&
    typeof envelope.objectType === 'string' &&
    isEncryptedEnvelopeShape(value) &&
    (envelope.crypto?.compression === 'gzip' ||
      envelope.crypto?.compression === 'none')
  )
}

export function assertUsablePassphrase(passphrase: string): void {
  void passphrase
}

export async function encryptVault(
  vault: SyncVault,
  passphrase: string,
): Promise<EncryptedSnapshotEnvelope> {
  assertUsablePassphrase(passphrase)

  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const updatedAt = vault.data.updatedAt
  const aad = aadFor(updatedAt)
  const key = await deriveVaultKey(passphrase, salt, VAULT_KDF_ITERATIONS)
  const payload = encoder.encode(JSON.stringify(vault))
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
      tagLength: 128,
    },
    key,
    toArrayBuffer(payload),
  )

  return {
    kind: 'zerochat.encryptedSnapshot',
    version: 1,
    encryptedAt: Date.now(),
    updatedAt,
    crypto: {
      cipher: VAULT_CIPHER,
      kdf: VAULT_KDF,
      iterations: VAULT_KDF_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      aad: bytesToBase64(aad),
    },
    payload: bytesToBase64(new Uint8Array(encrypted)),
  }
}

export async function encryptObject<T>(
  value: T,
  passphrase: string,
  objectType: string,
  updatedAt: number,
): Promise<EncryptedObjectEnvelope> {
  assertUsablePassphrase(passphrase)
  assertSafeTimestamp(updatedAt, 'updatedAt')

  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const aad = objectAadFor(objectType, updatedAt)
  const key = await deriveVaultKey(passphrase, salt, VAULT_KDF_ITERATIONS)
  const encoded = encoder.encode(JSON.stringify(value))
  const payload = await compressJsonPayload(encoded)
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
      tagLength: 128,
    },
    key,
    toArrayBuffer(payload.bytes),
  )

  return {
    kind: 'zerochat.encryptedObject',
    version: 1,
    objectType,
    encryptedAt: Date.now(),
    updatedAt,
    crypto: {
      cipher: VAULT_CIPHER,
      kdf: VAULT_KDF,
      iterations: VAULT_KDF_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      aad: bytesToBase64(aad),
      compression: payload.compression,
    },
    payload: bytesToBase64(new Uint8Array(encrypted)),
  }
}

export async function decryptVault(
  envelope: EncryptedSnapshotEnvelope,
  passphrase: string,
): Promise<SyncVault> {
  assertUsablePassphrase(passphrase)
  const { salt, iv, aad, payload } = assertEnvelopeCrypto(envelope)
  const key = await deriveVaultKey(
    passphrase,
    salt,
    envelope.crypto.iterations,
  )

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aad),
        tagLength: 128,
      },
      key,
      toArrayBuffer(payload),
    )

    const vault = JSON.parse(decoder.decode(decrypted)) as SyncVault

    if (vault.data?.updatedAt !== envelope.updatedAt) {
      throw new Error(rt('error.crypto.badTimestamp'))
    }

    return vault
  } catch {
    throw new Error(rt('error.crypto.badDecryption'))
  }
}

export async function decryptObject<T>(
  envelope: EncryptedObjectEnvelope,
  passphrase: string,
  expectedObjectType: string,
): Promise<T> {
  assertUsablePassphrase(passphrase)
  const { salt, iv, aad, payload } = assertObjectEnvelopeCrypto(
    envelope,
    expectedObjectType,
  )
  const key = await deriveVaultKey(
    passphrase,
    salt,
    envelope.crypto.iterations,
  )

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aad),
        tagLength: 128,
      },
      key,
      toArrayBuffer(payload),
    )
    const decompressed = await decompressJsonPayload(
      new Uint8Array(decrypted),
      envelope.crypto.compression,
    )

    return JSON.parse(decoder.decode(decompressed)) as T
  } catch {
    throw new Error(rt('error.crypto.badIncrementalDecryption'))
  }
}
