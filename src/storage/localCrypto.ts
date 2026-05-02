const LOCAL_CRYPTO_DB_NAME = 'zerochat-local-crypto'
const LOCAL_CRYPTO_DB_VERSION = 1
const LOCAL_CRYPTO_STORE = 'keys'
const LOCAL_CRYPTO_KEY = 'local-aes-gcm-v1'
const LOCAL_RECORD_KIND = 'zerochat.localEncrypted'
const IV_BYTES = 12

const encoder = new TextEncoder()
const decoder = new TextDecoder()
let localKeyPromise: Promise<CryptoKey> | null = null

export interface LocalEncryptedRecord {
  kind: typeof LOCAL_RECORD_KIND
  version: 1
  iv: string
  aad: string
  payload: string
}

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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function aadFor(namespace: string): Uint8Array {
  return encoder.encode(`zerochat:local:v1:${namespace}`)
}

function openLocalCryptoDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_CRYPTO_DB_NAME, LOCAL_CRYPTO_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(LOCAL_CRYPTO_STORE)) {
        db.createObjectStore(LOCAL_CRYPTO_STORE)
      }
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function keyTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openLocalCryptoDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_CRYPTO_STORE, mode)
        const store = tx.objectStore(LOCAL_CRYPTO_STORE)
        const request = run(store)

        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        tx.oncomplete = () => db.close()
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }),
  )
}

async function loadLocalKey(): Promise<CryptoKey> {
  const stored = await keyTransaction<CryptoKey | undefined>('readonly', (store) =>
    store.get(LOCAL_CRYPTO_KEY),
  )

  if (stored) {
    return stored
  }

  const key = await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )

  await keyTransaction('readwrite', (store) => store.put(key, LOCAL_CRYPTO_KEY))
  return key
}

function getLocalKey(): Promise<CryptoKey> {
  localKeyPromise ??= loadLocalKey().catch((error: unknown) => {
    localKeyPromise = null
    throw error
  })

  return localKeyPromise
}

export function isLocalEncryptedRecord(
  value: unknown,
): value is LocalEncryptedRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as LocalEncryptedRecord).kind === LOCAL_RECORD_KIND &&
    (value as LocalEncryptedRecord).version === 1 &&
    typeof (value as LocalEncryptedRecord).iv === 'string' &&
    typeof (value as LocalEncryptedRecord).aad === 'string' &&
    typeof (value as LocalEncryptedRecord).payload === 'string'
  )
}

export async function encryptLocalString(
  namespace: string,
  value: string,
): Promise<LocalEncryptedRecord> {
  const key = await getLocalKey()
  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)

  const aad = aadFor(namespace)
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
      tagLength: 128,
    },
    key,
    toArrayBuffer(encoder.encode(value)),
  )

  return {
    kind: LOCAL_RECORD_KIND,
    version: 1,
    iv: bytesToBase64(iv),
    aad: bytesToBase64(aad),
    payload: bytesToBase64(new Uint8Array(encrypted)),
  }
}

export async function decryptLocalString(
  namespace: string,
  record: LocalEncryptedRecord,
): Promise<string> {
  const expectedAad = aadFor(namespace)
  const actualAad = base64ToBytes(record.aad)

  if (bytesToBase64(expectedAad) !== bytesToBase64(actualAad)) {
    throw new Error('本机加密数据的认证信息不匹配')
  }

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(base64ToBytes(record.iv)),
      additionalData: toArrayBuffer(expectedAad),
      tagLength: 128,
    },
    await getLocalKey(),
    toArrayBuffer(base64ToBytes(record.payload)),
  )

  return decoder.decode(decrypted)
}
