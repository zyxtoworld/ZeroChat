import {
  decryptLocalString,
  encryptLocalString,
  isLocalEncryptedRecord,
  type LocalEncryptedRecord,
} from './localCrypto'

const SECRET_PREFIX = 'zerochat:secret:'
const SYNC_PASSPHRASE_KEY = `${SECRET_PREFIX}sync-passphrase`
const SECRET_DB_NAME = 'zerochat-secrets'
const SECRET_DB_VERSION = 1
const SECRET_STORE = 'records'

export interface StoredSecrets {
  providerKeys: Record<string, string>
  providerProxyTokens: Record<string, string>
  githubToken: string
  workerToken: string
}

function secretRecordKey(name: string): string {
  return `secret:${name}`
}

function legacyRecordKey(name: string): string {
  return `${SECRET_PREFIX}${name}`
}

function providerKeyName(providerId: string): string {
  return `provider:${providerId}`
}

function providerProxyTokenName(providerId: string): string {
  return `proxy:${providerId}`
}

function openSecretDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SECRET_DB_NAME, SECRET_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(SECRET_STORE)) {
        db.createObjectStore(SECRET_STORE)
      }
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function secretTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openSecretDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SECRET_STORE, mode)
        const store = tx.objectStore(SECRET_STORE)
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

async function getSecret(name: string): Promise<string> {
  const record = await secretTransaction<LocalEncryptedRecord | undefined>(
    'readonly',
    (store) => store.get(secretRecordKey(name)),
  )

  if (record) {
    if (!isLocalEncryptedRecord(record)) {
      throw new Error('本机密钥存储格式不正确')
    }

    return decryptLocalString(name, record)
  }

  const legacy = localStorage.getItem(legacyRecordKey(name))

  if (!legacy) {
    return ''
  }

  await setSecret(name, legacy)
  localStorage.removeItem(legacyRecordKey(name))
  return legacy
}

async function setSecret(name: string, value: string): Promise<void> {
  const key = secretRecordKey(name)
  const trimmed = value.trim()

  if (!trimmed) {
    await secretTransaction('readwrite', (store) => store.delete(key))
    localStorage.removeItem(legacyRecordKey(name))
    return
  }

  const encrypted = await encryptLocalString(name, trimmed)
  await secretTransaction('readwrite', (store) => store.put(encrypted, key))
  localStorage.removeItem(legacyRecordKey(name))
}

async function deleteSecretsMatching(
  predicate: (name: string) => boolean,
): Promise<void> {
  const keys = await secretTransaction<IDBValidKey[]>('readonly', (store) =>
    store.getAllKeys(),
  )

  await Promise.all(
    keys
      .filter((key): key is string => typeof key === 'string')
      .filter((key) => {
        if (!key.startsWith('secret:')) {
          return false
        }

        return predicate(key.slice('secret:'.length))
      })
      .map((key) =>
        secretTransaction('readwrite', (store) => store.delete(key)),
      ),
  )
}

function clearLegacySecretsMatching(predicate: (name: string) => boolean): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)

    if (!key?.startsWith(SECRET_PREFIX)) {
      continue
    }

    const name = key.slice(SECRET_PREFIX.length)

    if (predicate(name)) {
      localStorage.removeItem(key)
    }
  }
}

export async function loadZeroChatSecrets(
  providerIds: string[],
): Promise<StoredSecrets> {
  const providerKeys: Record<string, string> = {}
  const providerProxyTokens: Record<string, string> = {}

  await Promise.all(
    providerIds.map(async (providerId) => {
      const [apiKey, proxyToken] = await Promise.all([
        getSecret(providerKeyName(providerId)),
        getSecret(providerProxyTokenName(providerId)),
      ])

      providerKeys[providerId] = apiKey
      providerProxyTokens[providerId] = proxyToken
    }),
  )

  const [githubToken, workerToken] = await Promise.all([
    getSecret('github-token'),
    getSecret('worker-token'),
  ])

  return {
    providerKeys,
    providerProxyTokens,
    githubToken,
    workerToken,
  }
}

export function setProviderKey(
  providerId: string,
  value: string,
): Promise<void> {
  return setSecret(providerKeyName(providerId), value)
}

export function setProviderProxyToken(
  providerId: string,
  value: string,
): Promise<void> {
  return setSecret(providerProxyTokenName(providerId), value)
}

export function setGithubToken(value: string): Promise<void> {
  return setSecret('github-token', value)
}

export function setWorkerToken(value: string): Promise<void> {
  return setSecret('worker-token', value)
}

export function getSyncPassphrase(): string {
  const legacy = localStorage.getItem(SYNC_PASSPHRASE_KEY)

  if (legacy) {
    sessionStorage.setItem(SYNC_PASSPHRASE_KEY, legacy)
    localStorage.removeItem(SYNC_PASSPHRASE_KEY)
    return legacy
  }

  return sessionStorage.getItem(SYNC_PASSPHRASE_KEY) ?? ''
}

export function setSyncPassphrase(value: string): void {
  if (value) {
    sessionStorage.setItem(SYNC_PASSPHRASE_KEY, value)
    localStorage.removeItem(SYNC_PASSPHRASE_KEY)
    return
  }

  sessionStorage.removeItem(SYNC_PASSPHRASE_KEY)
  localStorage.removeItem(SYNC_PASSPHRASE_KEY)
}

export async function clearProviderSecrets(): Promise<void> {
  const isProviderSecret = (name: string) =>
    name.startsWith('provider:') || name.startsWith('proxy:')

  await deleteSecretsMatching(isProviderSecret)
  clearLegacySecretsMatching(isProviderSecret)
}

export async function clearZeroChatSecrets(): Promise<void> {
  await deleteSecretsMatching(() => true)
  clearLegacySecretsMatching(() => true)
  sessionStorage.removeItem(SYNC_PASSPHRASE_KEY)
}
