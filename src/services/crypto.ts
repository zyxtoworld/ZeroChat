import type { EncryptedSnapshotEnvelope, SyncVault } from '../types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const VAULT_KDF = 'PBKDF2-SHA256'
export const VAULT_CIPHER = 'AES-256-GCM'
export const VAULT_KDF_ITERATIONS = 600_000

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

export function isEncryptedSnapshot(value: unknown): value is EncryptedSnapshotEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EncryptedSnapshotEnvelope).kind === 'zerochat.encryptedSnapshot' &&
    (value as EncryptedSnapshotEnvelope).version === 1
  )
}

export function assertUsablePassphrase(passphrase: string): void {
  if (passphrase.trim().length < 12) {
    throw new Error('同步加密密码至少需要 12 个字符')
  }
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

export async function decryptVault(
  envelope: EncryptedSnapshotEnvelope,
  passphrase: string,
): Promise<SyncVault> {
  assertUsablePassphrase(passphrase)

  if (envelope.crypto.cipher !== VAULT_CIPHER || envelope.crypto.kdf !== VAULT_KDF) {
    throw new Error('不支持的加密快照格式')
  }

  const salt = base64ToBytes(envelope.crypto.salt)
  const iv = base64ToBytes(envelope.crypto.iv)
  const aad = base64ToBytes(envelope.crypto.aad)
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
      toArrayBuffer(base64ToBytes(envelope.payload)),
    )

    return JSON.parse(decoder.decode(decrypted)) as SyncVault
  } catch {
    throw new Error('解密失败：同步加密密码不正确，或远端数据已损坏')
  }
}
