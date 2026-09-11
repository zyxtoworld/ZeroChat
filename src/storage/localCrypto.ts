import { rt } from '../i18n'
import { abortIndexedDbTransactionOrReject } from './indexedDbAbortFailure'
import { openIndexedDb } from './indexedDbOpen'

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
  return openIndexedDb(
    LOCAL_CRYPTO_DB_NAME,
    LOCAL_CRYPTO_DB_VERSION,
    (database) => {
      if (!database.objectStoreNames.contains(LOCAL_CRYPTO_STORE)) {
        database.createObjectStore(LOCAL_CRYPTO_STORE)
      }
    },
  )
}

function keyTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openLocalCryptoDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        let completed = false
        let tx: IDBTransaction
        let requestResult: T | undefined
        let request: IDBRequest<T>

        const rejectOnce = (error: unknown) => {
          if (completed) {
            return
          }

          completed = true
          db.close()
          reject(error)
        }

        try {
          tx = db.transaction(LOCAL_CRYPTO_STORE, mode)
          const store = tx.objectStore(LOCAL_CRYPTO_STORE)
          request = run(store)
        } catch (error: unknown) {
          rejectOnce(error)
          return
        }

        request.onerror = () => rejectOnce(request.error ?? tx.error)
        request.onsuccess = () => {
          requestResult = request.result
        }
        tx.oncomplete = () => {
          if (completed) {
            return
          }

          completed = true
          db.close()
          resolve(requestResult as T)
        }
        tx.onerror = () => {
          rejectOnce(tx.error ?? request.error)
        }
        tx.onabort = () => {
          rejectOnce(tx.error ?? request.error)
        }
      }),
  )
}

function installLocalKeyIfMissing(candidate: CryptoKey): Promise<CryptoKey> {
  return openLocalCryptoDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        let completed = false
        let operationError: unknown
        let selectedKey: CryptoKey | undefined
        let tx: IDBTransaction | undefined
        let getRequest: IDBRequest<CryptoKey | undefined> | undefined

        const rejectOnce = (error: unknown) => {
          if (completed) {
            return
          }

          completed = true
          db.close()
          reject(error)
        }

        const abortWith = (error: unknown) => {
          operationError = error
          abortIndexedDbTransactionOrReject(tx, error, rejectOnce)
        }

        try {
          tx = db.transaction(LOCAL_CRYPTO_STORE, 'readwrite')
          tx.oncomplete = () => {
            if (completed) {
              return
            }

            if (!selectedKey) {
              rejectOnce(
                new Error('Local encryption key transaction completed without a key.'),
              )
              return
            }

            completed = true
            db.close()
            resolve(selectedKey)
          }
          tx.onerror = () =>
            rejectOnce(operationError ?? tx?.error ?? getRequest?.error)
          tx.onabort = () =>
            rejectOnce(operationError ?? tx?.error ?? getRequest?.error)

          const store = tx.objectStore(LOCAL_CRYPTO_STORE)
          getRequest = store.get(LOCAL_CRYPTO_KEY)
          getRequest.onerror = () => rejectOnce(getRequest?.error ?? tx?.error)
          getRequest.onsuccess = () => {
            if (getRequest?.result) {
              selectedKey = getRequest.result
              return
            }

            selectedKey = candidate

            try {
              const addRequest = store.add(candidate, LOCAL_CRYPTO_KEY)
              addRequest.onerror = () => {
                rejectOnce(addRequest.error ?? tx?.error)
              }
            } catch (error: unknown) {
              abortWith(error)
            }
          }
        } catch (error: unknown) {
          abortWith(error)
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

  return installLocalKeyIfMissing(key)
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
    throw new Error(rt('error.localDataBadAuth'))
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
