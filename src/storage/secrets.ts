import {
  decryptLocalString,
  encryptLocalString,
  isLocalEncryptedRecord,
  type LocalEncryptedRecord,
} from './localCrypto'
import { AppDataWriteConflictError } from './appDataWriteConflict'
import { abortIndexedDbTransactionOrReject } from './indexedDbAbortFailure'
import { openIndexedDb } from './indexedDbOpen'
import { rt } from '../i18n'
import type { AppData } from '../types'
import {
  WindowsSecretBridgeError,
  isValidWindowsSecretName,
  isWindowsWebViewOrigin,
  mutateWindowsSecrets,
  probeWindowsSecretBridge,
  readWindowsSecrets,
  type WindowsSecretChange,
  type WindowsSecretEntry,
  type WindowsSecretMigrationState,
  type WindowsSecretProbeResult,
  type WindowsSecretReadResult,
} from '../platform/windowsBridge'

const SECRET_PREFIX = 'zerochat:secret:'
const SYNC_PASSPHRASE_KEY = `${SECRET_PREFIX}sync-passphrase`
const PENDING_PROVIDER_SECRET_CLEANUP_KEY =
  `${SECRET_PREFIX}pending-provider-secret-cleanup`
const SECRET_DB_NAME = 'zerochat-secrets'
const SECRET_DB_VERSION = 1
const SECRET_STORE = 'records'
const SECRET_STORE_REVISION_KEY = 'meta:revision'
const PROVIDER_APP_DATA_TRANSITION_KEY =
  'meta:pending-provider-app-data-transition'
const PROVIDER_APP_DATA_TRANSITION_KIND =
  'zerochat.providerAppDataTransition'
const PROVIDER_APP_DATA_TRANSITION_NAMESPACE =
  'provider-app-data-transition'
const ZEROCHAT_APP_DATA_TRANSITION_KEY =
  'meta:pending-zerochat-app-data-transition'
const ZEROCHAT_APP_DATA_TRANSITION_KIND =
  'zerochat.zeroChatAppDataTransition'
const ZEROCHAT_APP_DATA_TRANSITION_NAMESPACE =
  'zerochat-app-data-transition'
const SECRET_APP_DATA_TRANSITION_LOCK =
  'zerochat:secret-app-data-transition'
const APP_DATA_DB_NAME = 'zerochat'
const APP_DATA_DB_VERSION = 1
const APP_DATA_STORE = 'documents'
const APP_DATA_KEY = 'app'
const APP_DATA_NAMESPACE = 'app-data'
const SECRET_DELETED_KIND = 'zerochat.secretDeleted'
let secretMutationTail: Promise<void> = Promise.resolve()
let windowsSecretMigrationTail: Promise<void> = Promise.resolve()
let loadedSecretStoreRevision: string | null | undefined
let secretRevisionFactory: IDBFactory | null = null
let loadedWindowsSecretRevision: string | null | undefined
let windowsSecretRevisionGeneration = 0
let windowsSecretBridgeIdentity: unknown
let windowsSecretInitialization: Promise<void> | undefined

export interface StoredSecrets {
  providerKeys: Record<string, string>
  githubToken: string
}

export interface ZeroChatSecretSnapshot extends StoredSecrets {
  syncPassphrase: string
}

interface SecretDeletedRecord {
  kind: typeof SECRET_DELETED_KIND
  version: 1
}

interface ProviderAppDataTransitionPayload {
  nextProviderKeys: Record<string, string>
  previousProviderKeys: Record<string, string>
  targetAppData: string
}

interface ProviderAppDataTransitionRecord {
  kind: typeof PROVIDER_APP_DATA_TRANSITION_KIND
  payload: LocalEncryptedRecord
  revision: string
  version: 1
}

interface ProviderAppDataTransitionState {
  record: ProviderAppDataTransitionRecord | null
  revision: string | null
}

interface ZeroChatAppDataTransitionPayload {
  nextSecrets: ZeroChatSecretSnapshot
  previousSecrets: ZeroChatSecretSnapshot
  targetAppData: string
}

interface ZeroChatAppDataTransitionRecord {
  kind: typeof ZEROCHAT_APP_DATA_TRANSITION_KIND
  payload: LocalEncryptedRecord
  revision: string
  version: 1
}

interface ZeroChatAppDataTransitionState {
  record: ZeroChatAppDataTransitionRecord | null
  revision: string | null
}

type StoredSecretRecord = LocalEncryptedRecord | SecretDeletedRecord

const secretDeletedRecord: SecretDeletedRecord = {
  kind: SECRET_DELETED_KIND,
  version: 1,
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

function proxyKeyName(providerId: string): string {
  return `proxy:${providerId}`
}

function isProviderSecretName(name: string): boolean {
  return name.startsWith('provider:') || name.startsWith('proxy:')
}

function isStoredSecretName(name: string): boolean {
  return name === 'github-token' || isProviderSecretName(name)
}

function isSecretDeletedRecord(value: unknown): value is SecretDeletedRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as SecretDeletedRecord).kind === SECRET_DELETED_KIND &&
    (value as SecretDeletedRecord).version === 1
  )
}

function isProviderAppDataTransitionRecord(
  value: unknown,
): value is ProviderAppDataTransitionRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as ProviderAppDataTransitionRecord
  return (
    record.kind === PROVIDER_APP_DATA_TRANSITION_KIND &&
    record.version === 1 &&
    typeof record.revision === 'string' &&
    record.revision.length > 0 &&
    isLocalEncryptedRecord(record.payload)
  )
}

function isZeroChatAppDataTransitionRecord(
  value: unknown,
): value is ZeroChatAppDataTransitionRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as ZeroChatAppDataTransitionRecord
  return (
    record.kind === ZEROCHAT_APP_DATA_TRANSITION_KIND &&
    record.version === 1 &&
    typeof record.revision === 'string' &&
    record.revision.length > 0 &&
    isLocalEncryptedRecord(record.payload)
  )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  )
}

function isZeroChatSecretSnapshot(
  value: unknown,
): value is ZeroChatSecretSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as ZeroChatSecretSnapshot
  return (
    isStringRecord(candidate.providerKeys) &&
    typeof candidate.githubToken === 'string' &&
    typeof candidate.syncPassphrase === 'string'
  )
}

function parseProviderAppDataTransitionPayload(
  value: string,
): ProviderAppDataTransitionPayload {
  const payload = JSON.parse(value) as unknown

  if (typeof payload !== 'object' || payload === null) {
    throw new Error(rt('error.localSecretFormat'))
  }

  const candidate = payload as ProviderAppDataTransitionPayload
  if (
    typeof candidate.targetAppData !== 'string' ||
    typeof candidate.previousProviderKeys !== 'object' ||
    candidate.previousProviderKeys === null ||
    Array.isArray(candidate.previousProviderKeys) ||
    typeof candidate.nextProviderKeys !== 'object' ||
    candidate.nextProviderKeys === null ||
    Array.isArray(candidate.nextProviderKeys) ||
    Object.values(candidate.previousProviderKeys).some(
      (item) => typeof item !== 'string',
    ) ||
    Object.values(candidate.nextProviderKeys).some(
      (item) => typeof item !== 'string',
    )
  ) {
    throw new Error(rt('error.localSecretFormat'))
  }

  return candidate
}

function parseZeroChatAppDataTransitionPayload(
  value: string,
): ZeroChatAppDataTransitionPayload {
  const payload = JSON.parse(value) as unknown

  if (typeof payload !== 'object' || payload === null) {
    throw new Error(rt('error.localSecretFormat'))
  }

  const candidate = payload as ZeroChatAppDataTransitionPayload
  if (
    typeof candidate.targetAppData !== 'string' ||
    !isZeroChatSecretSnapshot(candidate.previousSecrets) ||
    !isZeroChatSecretSnapshot(candidate.nextSecrets)
  ) {
    throw new Error(rt('error.localSecretFormat'))
  }

  return candidate
}

function normalizeProviderIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [...new Set(
    value.filter((item): item is string =>
      typeof item === 'string' && item.length > 0,
    ),
  )]
}

function parsePendingProviderSecretCleanupIds(raw: string): string[] {
  const value = JSON.parse(raw)

  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new Error(rt('error.pendingProviderSecretCleanupFormat'))
  }

  return [...new Set(value)]
}

export function getPendingProviderSecretCleanupIds(): string[] {
  const raw = localStorage.getItem(PENDING_PROVIDER_SECRET_CLEANUP_KEY)

  if (!raw) {
    return []
  }

  try {
    return parsePendingProviderSecretCleanupIds(raw)
  } catch {
    throw new Error(rt('error.pendingProviderSecretCleanupFormat'))
  }
}

function writePendingProviderSecretCleanupIds(providerIds: string[]): void {
  const normalized = normalizeProviderIdList(providerIds)

  if (normalized.length === 0) {
    localStorage.removeItem(PENDING_PROVIDER_SECRET_CLEANUP_KEY)
    return
  }

  localStorage.setItem(
    PENDING_PROVIDER_SECRET_CLEANUP_KEY,
    JSON.stringify(normalized),
  )
}

export function queueProviderSecretCleanupById(providerIds: string[]): void {
  writePendingProviderSecretCleanupIds([
    ...getPendingProviderSecretCleanupIds(),
    ...providerIds,
  ])
}

export function clearPendingProviderSecretCleanupById(
  providerIds: string[],
): void {
  const ids = new Set(providerIds)

  if (ids.size === 0) {
    return
  }

  writePendingProviderSecretCleanupIds(
    getPendingProviderSecretCleanupIds().filter((providerId) =>
      !ids.has(providerId),
    ),
  )
}

function openSecretDatabase(): Promise<IDBDatabase> {
  return openIndexedDb(
    SECRET_DB_NAME,
    SECRET_DB_VERSION,
    (database) => {
      if (!database.objectStoreNames.contains(SECRET_STORE)) {
        database.createObjectStore(SECRET_STORE)
      }
    },
  )
}

function secretTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openSecretDatabase().then(
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
          tx = db.transaction(SECRET_STORE, mode)
          const store = tx.objectStore(SECRET_STORE)
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

function secretBatchTransaction(
  mode: IDBTransactionMode,
  run: (
    store: IDBObjectStore,
    abortWith: (error: unknown) => void,
  ) => void,
  afterComplete?: () => void | PromiseLike<void>,
): Promise<void> {
  return openSecretDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        let completed = false
        let operationError: unknown
        let tx: IDBTransaction | undefined

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
          tx = db.transaction(SECRET_STORE, mode)
          tx.oncomplete = () => {
            if (completed) {
              return
            }

            if (!afterComplete) {
              completed = true
              db.close()
              resolve()
              return
            }

            void Promise.resolve()
              .then(() => afterComplete())
              .then(
                () => {
                  if (completed) {
                    return
                  }

                  completed = true
                  db.close()
                  resolve()
                },
                (error: unknown) => rejectOnce(error),
              )
          }
          tx.onerror = () => rejectOnce(operationError ?? tx?.error)
          tx.onabort = () => rejectOnce(operationError ?? tx?.error)
          run(tx.objectStore(SECRET_STORE), abortWith)
        } catch (error: unknown) {
          abortWith(error)
        }
      }),
  )
}

function resetSecretRevisionForCurrentFactory(): void {
  if (secretRevisionFactory === indexedDB) {
    return
  }

  secretRevisionFactory = indexedDB
  loadedSecretStoreRevision = undefined
}

function normalizeSecretStoreRevision(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(rt('error.localSecretFormat'))
  }

  return value
}

async function readSecretStoreRevision(): Promise<string | null> {
  resetSecretRevisionForCurrentFactory()
  return normalizeSecretStoreRevision(
    await secretTransaction<unknown | undefined>('readonly', (store) =>
      store.get(SECRET_STORE_REVISION_KEY),
    ),
  )
}

async function mutateSecretStore(
  run: (
    store: IDBObjectStore,
    nextRevision: string,
    abortWith: (error: unknown) => void,
  ) => void,
  expectedRevision?: string | null,
): Promise<string> {
  resetSecretRevisionForCurrentFactory()
  const expected = expectedRevision === undefined
    ? loadedSecretStoreRevision
    : expectedRevision
  const nextRevision = crypto.randomUUID()

  await secretBatchTransaction('readwrite', (store, abortWith) => {
    const revisionRequest = store.get(SECRET_STORE_REVISION_KEY)

    revisionRequest.onerror = () => {
      abortWith(revisionRequest.error)
    }
    revisionRequest.onsuccess = () => {
      try {
        const currentRevision = normalizeSecretStoreRevision(
          revisionRequest.result,
        )

        if (expected !== undefined && currentRevision !== expected) {
          abortWith(new AppDataWriteConflictError())
          return
        }

        run(store, nextRevision, abortWith)
      } catch (error: unknown) {
        abortWith(error)
      }
    }
  })

  loadedSecretStoreRevision = nextRevision
  return nextRevision
}

async function readAppDataTransitionState<RecordType>(
  transitionKey: string,
  isTransitionRecord: (value: unknown) => value is RecordType,
): Promise<{ record: RecordType | null; revision: string | null }> {
  resetSecretRevisionForCurrentFactory()
  const db = await openSecretDatabase()

  return new Promise((resolve, reject) => {
    let completed = false
    let revisionValue: unknown
    let transitionValue: unknown
    let tx: IDBTransaction | undefined
    let revisionRequest: IDBRequest<unknown> | undefined
    let transitionRequest: IDBRequest<unknown> | undefined

    const rejectOnce = (error: unknown) => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      reject(error)
    }

    try {
      tx = db.transaction(SECRET_STORE, 'readonly')
      const store = tx.objectStore(SECRET_STORE)
      revisionRequest = store.get(SECRET_STORE_REVISION_KEY)
      transitionRequest = store.get(transitionKey)
      revisionRequest.onerror = () => {
        rejectOnce(revisionRequest?.error ?? tx?.error)
      }
      transitionRequest.onerror = () => {
        rejectOnce(transitionRequest?.error ?? tx?.error)
      }
      revisionRequest.onsuccess = () => {
        revisionValue = revisionRequest?.result
      }
      transitionRequest.onsuccess = () => {
        transitionValue = transitionRequest?.result
      }
      tx.oncomplete = () => {
        if (completed) {
          return
        }

        try {
          const revision = normalizeSecretStoreRevision(revisionValue)
          const record = transitionValue === undefined
            ? null
            : isTransitionRecord(transitionValue)
              ? transitionValue
              : null

          if (transitionValue !== undefined && !record) {
            throw new Error(rt('error.localSecretFormat'))
          }

          loadedSecretStoreRevision = revision
          completed = true
          db.close()
          resolve({ record, revision })
        } catch (error: unknown) {
          rejectOnce(error)
        }
      }
      tx.onerror = () => {
        rejectOnce(tx?.error ?? transitionRequest?.error ?? revisionRequest?.error)
      }
      tx.onabort = () => {
        rejectOnce(tx?.error ?? transitionRequest?.error ?? revisionRequest?.error)
      }
    } catch (error: unknown) {
      rejectOnce(error)
    }
  })
}

function readProviderAppDataTransitionState(): Promise<
  ProviderAppDataTransitionState
> {
  return readAppDataTransitionState(
    PROVIDER_APP_DATA_TRANSITION_KEY,
    isProviderAppDataTransitionRecord,
  )
}

function readZeroChatAppDataTransitionState(): Promise<
  ZeroChatAppDataTransitionState
> {
  return readAppDataTransitionState(
    ZEROCHAT_APP_DATA_TRANSITION_KEY,
    isZeroChatAppDataTransitionRecord,
  )
}

async function readPersistedAppDataJson(): Promise<string | null> {
  const db = await openIndexedDb(
    APP_DATA_DB_NAME,
    APP_DATA_DB_VERSION,
    () => undefined,
  )

  const stored = await new Promise<unknown | null>((resolve, reject) => {
    let completed = false
    let result: unknown | null = null
    let tx: IDBTransaction | undefined
    let request: IDBRequest<unknown> | undefined

    const rejectOnce = (error: unknown) => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      reject(error)
    }

    try {
      tx = db.transaction(APP_DATA_STORE, 'readonly')
      request = tx.objectStore(APP_DATA_STORE).get(APP_DATA_KEY)
      request.onerror = () => rejectOnce(request?.error ?? tx?.error)
      request.onsuccess = () => {
        result = request?.result ?? null
      }
      tx.oncomplete = () => {
        if (completed) {
          return
        }

        completed = true
        db.close()
        resolve(result)
      }
      tx.onerror = () => rejectOnce(tx?.error ?? request?.error)
      tx.onabort = () => rejectOnce(tx?.error ?? request?.error)
    } catch (error: unknown) {
      rejectOnce(error)
    }
  })

  if (stored === null) {
    return null
  }

  if (isLocalEncryptedRecord(stored)) {
    return decryptLocalString(APP_DATA_NAMESPACE, stored)
  }

  return JSON.stringify(stored)
}

async function getSecret(
  name: string,
  persistLegacyMode: 'queued' | 'owned' = 'queued',
): Promise<string> {
  const record = await secretTransaction<StoredSecretRecord | undefined>(
    'readonly',
    (store) => store.get(secretRecordKey(name)),
  )

  if (record) {
    if (isSecretDeletedRecord(record)) {
      return ''
    }

    if (!isLocalEncryptedRecord(record)) {
      throw new Error(rt('error.localSecretFormat'))
    }

    return decryptLocalString(name, record)
  }

  const legacy = localStorage.getItem(legacyRecordKey(name))

  if (!legacy) {
    return ''
  }

  await (persistLegacyMode === 'queued'
    ? setSecret(name, legacy)
    : setSecretNow(name, legacy))
  return legacy
}

function secretMutationLockManager(): LockManager | null {
  if (typeof navigator === 'undefined') {
    return null
  }

  const lockManager = navigator.locks
  return typeof lockManager?.request === 'function' ? lockManager : null
}

async function withSecretMutationLock<T>(
  mutation: () => Promise<T>,
): Promise<T> {
  const lockManager = secretMutationLockManager()

  if (!lockManager) {
    return mutation()
  }

  return lockManager.request(
    SECRET_APP_DATA_TRANSITION_LOCK,
    { mode: 'exclusive' },
    mutation,
  )
}

function runSecretMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = secretMutationTail
    .then(() => windowsSecretMigrationTail)
    .then(() => withSecretMutationLock(mutation))
  secretMutationTail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function setSecretNow(name: string, value: string): Promise<void> {
  const key = secretRecordKey(name)
  const trimmed = value.trim()
  const record = trimmed
    ? await encryptLocalString(name, trimmed)
    : secretDeletedRecord

  await mutateSecretStore((store, nextRevision) => {
    store.put(record, key)
    store.put(nextRevision, SECRET_STORE_REVISION_KEY)
  })
  clearLegacySecretNamesBestEffort([name])
}

function setSecret(name: string, value: string): Promise<void> {
  return runSecretMutation(() => setSecretNow(name, value))
}

function legacySecretNamesMatching(
  predicate: (name: string) => boolean,
): string[] {
  const names: string[] = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)

    if (!key?.startsWith(SECRET_PREFIX)) {
      continue
    }

    const name = key.slice(SECRET_PREFIX.length)

    if (predicate(name)) {
      names.push(name)
    }
  }

  return [...new Set(names)]
}

function clearLegacySecretNamesBestEffort(names: string[]): void {
  for (const name of names) {
    try {
      localStorage.removeItem(legacyRecordKey(name))
    } catch {
      // Canonical IndexedDB records and deletion tombstones remain authoritative.
    }
  }
}

function clearStorageItemBestEffort(storage: Storage, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    // The canonical replacement has already committed; stale cleanup can retry later.
  }
}

async function tombstoneSecretsMatchingNow(
  predicate: (name: string) => boolean,
  legacyNames: string[],
): Promise<void> {
  await mutateSecretStore((store, nextRevision, abortWith) => {
    const keysRequest = store.getAllKeys()

    keysRequest.onerror = () => {
      abortWith(keysRequest.error)
    }
    keysRequest.onsuccess = () => {
      try {
        const names = new Set(legacyNames)

        for (const key of keysRequest.result) {
          if (
            typeof key === 'string' &&
            key.startsWith('secret:') &&
            predicate(key.slice('secret:'.length))
          ) {
            names.add(key.slice('secret:'.length))
          }
        }

        for (const name of names) {
          store.put(secretDeletedRecord, secretRecordKey(name))
        }
        store.put(nextRevision, SECRET_STORE_REVISION_KEY)
      } catch (error: unknown) {
        abortWith(error)
      }
    }
  })
}

async function loadBrowserZeroChatSecrets(
  providerIds: string[],
): Promise<StoredSecrets> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const initialRevision = await readSecretStoreRevision()
    loadedSecretStoreRevision = initialRevision
    const providerKeys = Object.fromEntries(
      await Promise.all(
        providerIds.map(async (providerId) => {
          const value = await getSecret(providerKeyName(providerId))
          return [providerId, value] as const
        }),
      ),
    )
    const githubToken = await getSecret('github-token')
    const finalRevision = await readSecretStoreRevision()

    if (finalRevision === initialRevision) {
      loadedSecretStoreRevision = finalRevision
      return {
        providerKeys,
        githubToken,
      }
    }

    loadedSecretStoreRevision = finalRevision
  }

  throw new AppDataWriteConflictError()
}

function setBrowserProviderKey(
  providerId: string,
  value: string,
): Promise<void> {
  return setSecret(providerKeyName(providerId), value)
}

function replaceBrowserProviderSecretSnapshot(
  providerKeys: Record<string, string>,
): Promise<void> {
  return runSecretMutation(async () => {
    const legacyNames = legacySecretNamesMatching(isProviderSecretName)
    const encryptedEntries = await Promise.all(
      Object.entries(providerKeys).flatMap(([providerId, value]) => {
        const name = providerKeyName(providerId)
        const trimmed = value.trim()

        return trimmed
          ? [encryptLocalString(name, trimmed).then((record) => ({ name, record }))]
          : []
      }),
    )

    await mutateSecretStore((store, nextRevision, abortWith) => {
      const keysRequest = store.getAllKeys()

      keysRequest.onerror = () => {
        abortWith(keysRequest.error)
      }
      keysRequest.onsuccess = () => {
        try {
          const nextNames = new Set(encryptedEntries.map(({ name }) => name))
          const deletedNames = new Set(
            legacyNames.filter((name) => !nextNames.has(name)),
          )

          for (const key of keysRequest.result) {
            if (
              typeof key !== 'string' ||
              !key.startsWith('secret:')
            ) {
              continue
            }

            const name = key.slice('secret:'.length)

            if (isProviderSecretName(name) && !nextNames.has(name)) {
              deletedNames.add(name)
            }
          }

          for (const name of deletedNames) {
            store.put(secretDeletedRecord, secretRecordKey(name))
          }

          for (const { name, record } of encryptedEntries) {
            store.put(record, secretRecordKey(name))
          }
          store.put(nextRevision, SECRET_STORE_REVISION_KEY)
        } catch (error: unknown) {
          abortWith(error)
        }
      }
    })

    clearLegacySecretNamesBestEffort(legacyNames)
  })
}

async function encryptedProviderSecretEntries(
  providerKeys: Record<string, string>,
): Promise<Array<{ name: string; record: LocalEncryptedRecord }>> {
  return Promise.all(
    Object.entries(providerKeys).flatMap(([providerId, value]) => {
      const name = providerKeyName(providerId)
      const trimmed = value.trim()

      return trimmed
        ? [
            encryptLocalString(name, trimmed).then((record) => ({
              name,
              record,
            })),
          ]
        : []
    }),
  )
}

async function encryptedZeroChatSecretEntries(
  snapshot: ZeroChatSecretSnapshot,
): Promise<Array<{ name: string; record: StoredSecretRecord }>> {
  return Promise.all(
    [
      ...Object.entries(snapshot.providerKeys).map(([providerId, value]) => ({
        name: providerKeyName(providerId),
        value,
      })),
      { name: 'github-token', value: snapshot.githubToken },
    ].map(async ({ name, value }) => {
      const trimmed = value.trim()

      return {
        name,
        record: trimmed
          ? await encryptLocalString(name, trimmed)
          : secretDeletedRecord,
      }
    }),
  )
}

function replaceSecretsInStore(
  store: IDBObjectStore,
  entries: Array<{ name: string; record: StoredSecretRecord }>,
  legacyNames: string[],
  isTargetSecretName: (name: string) => boolean,
  nextRevision: string,
  abortWith: (error: unknown) => void,
  onReady?: () => void,
): void {
  const keysRequest = store.getAllKeys()

  keysRequest.onerror = () => {
    abortWith(keysRequest.error)
  }
  keysRequest.onsuccess = () => {
    try {
      const nextNames = new Set(entries.map(({ name }) => name))
      const deletedNames = new Set(
        legacyNames.filter((name) => !nextNames.has(name)),
      )

      for (const key of keysRequest.result) {
        if (typeof key !== 'string' || !key.startsWith('secret:')) {
          continue
        }

        const name = key.slice('secret:'.length)
        if (isTargetSecretName(name) && !nextNames.has(name)) {
          deletedNames.add(name)
        }
      }

      for (const name of deletedNames) {
        store.put(secretDeletedRecord, secretRecordKey(name))
      }
      for (const { name, record } of entries) {
        store.put(record, secretRecordKey(name))
      }

      onReady?.()
      store.put(nextRevision, SECRET_STORE_REVISION_KEY)
    } catch (error: unknown) {
      abortWith(error)
    }
  }
}

function runWithoutPendingAppDataTransition(
  store: IDBObjectStore,
  abortWith: (error: unknown) => void,
  onReady: () => void,
): void {
  const requests = [
    store.get(PROVIDER_APP_DATA_TRANSITION_KEY),
    store.get(ZEROCHAT_APP_DATA_TRANSITION_KEY),
  ]
  let completed = 0
  let settled = false

  const fail = (error: unknown) => {
    if (settled) {
      return
    }

    settled = true
    abortWith(error)
  }

  for (const request of requests) {
    request.onerror = () => fail(request.error)
    request.onsuccess = () => {
      if (settled) {
        return
      }

      if (request.result !== undefined) {
        fail(new AppDataWriteConflictError())
        return
      }

      completed += 1
      if (completed === requests.length) {
        settled = true
        onReady()
      }
    }
  }
}

async function stageBrowserProviderAppDataTransition(
  payload: ProviderAppDataTransitionPayload,
  encryptedPayload: LocalEncryptedRecord,
): Promise<ProviderAppDataTransitionRecord> {
  const legacyNames = legacySecretNamesMatching(isProviderSecretName)
  const entries = await encryptedProviderSecretEntries(payload.nextProviderKeys)
  let transition: ProviderAppDataTransitionRecord | null = null

  await mutateSecretStore((store, nextRevision, abortWith) => {
    transition = {
      kind: PROVIDER_APP_DATA_TRANSITION_KIND,
      payload: encryptedPayload,
      revision: nextRevision,
      version: 1,
    }
    runWithoutPendingAppDataTransition(store, abortWith, () => {
      replaceSecretsInStore(
        store,
        entries,
        legacyNames,
        isProviderSecretName,
        nextRevision,
        abortWith,
        () => store.put(transition, PROVIDER_APP_DATA_TRANSITION_KEY),
      )
    })
  })

  clearLegacySecretNamesBestEffort(legacyNames)
  if (!transition) {
    throw new Error(rt('error.localSecretFormat'))
  }
  return transition
}

async function stageWindowsProviderAppDataTransition(
  payload: ProviderAppDataTransitionPayload,
  encryptedPayload: LocalEncryptedRecord,
): Promise<ProviderAppDataTransitionRecord> {
  let transition: ProviderAppDataTransitionRecord | null = null

  await mutateSecretStore((store, nextRevision, abortWith) => {
    transition = {
      kind: PROVIDER_APP_DATA_TRANSITION_KIND,
      payload: encryptedPayload,
      revision: nextRevision,
      version: 1,
    }
    runWithoutPendingAppDataTransition(store, abortWith, () => {
      store.put(transition, PROVIDER_APP_DATA_TRANSITION_KEY)
      store.put(nextRevision, SECRET_STORE_REVISION_KEY)
    })
  })

  if (!transition) {
    throw new Error(rt('error.localSecretFormat'))
  }
  const stagedTransition = transition

  try {
    await mutateWindowsSecretStore(
      Object.entries(payload.nextProviderKeys)
        .map(([providerId, value]) =>
          secretChange(providerKeyName(providerId), value, true),
        )
        .filter(({ value }) => value !== null),
      'provider',
    )
  } catch (error: unknown) {
    await rethrowAfterCredentialCompensation(error, () =>
      rollbackWindowsProviderAppDataTransition(stagedTransition, payload),
    )
  }
  return stagedTransition
}

async function stageBrowserZeroChatAppDataTransition(
  payload: ZeroChatAppDataTransitionPayload,
  encryptedPayload: LocalEncryptedRecord,
): Promise<ZeroChatAppDataTransitionRecord> {
  const legacyNames = legacySecretNamesMatching(isStoredSecretName)
  const entries = await encryptedZeroChatSecretEntries(payload.nextSecrets)
  const previousSyncPassphrase = getBrowserSyncPassphrase()
  let transition: ZeroChatAppDataTransitionRecord | null = null

  try {
    setBrowserSyncPassphrase(payload.nextSecrets.syncPassphrase)
    await mutateSecretStore((store, nextRevision, abortWith) => {
      transition = {
        kind: ZEROCHAT_APP_DATA_TRANSITION_KIND,
        payload: encryptedPayload,
        revision: nextRevision,
        version: 1,
      }
      runWithoutPendingAppDataTransition(store, abortWith, () => {
        replaceSecretsInStore(
          store,
          entries,
          legacyNames,
          isStoredSecretName,
          nextRevision,
          abortWith,
          () => store.put(transition, ZEROCHAT_APP_DATA_TRANSITION_KEY),
        )
      })
    })
  } catch (error: unknown) {
    rethrowAfterBrowserSyncPassphraseRestore(previousSyncPassphrase, error)
  }

  clearLegacySecretNamesBestEffort(legacyNames)
  if (!transition) {
    throw new Error(rt('error.localSecretFormat'))
  }
  return transition
}

async function stageWindowsZeroChatAppDataTransition(
  payload: ZeroChatAppDataTransitionPayload,
  encryptedPayload: LocalEncryptedRecord,
): Promise<ZeroChatAppDataTransitionRecord> {
  let transition: ZeroChatAppDataTransitionRecord | null = null

  await mutateSecretStore((store, nextRevision, abortWith) => {
    transition = {
      kind: ZEROCHAT_APP_DATA_TRANSITION_KIND,
      payload: encryptedPayload,
      revision: nextRevision,
      version: 1,
    }
    runWithoutPendingAppDataTransition(store, abortWith, () => {
      store.put(transition, ZEROCHAT_APP_DATA_TRANSITION_KEY)
      store.put(nextRevision, SECRET_STORE_REVISION_KEY)
    })
  })

  if (!transition) {
    throw new Error(rt('error.localSecretFormat'))
  }
  const stagedTransition = transition

  try {
    await mutateWindowsSecretStore(snapshotChanges(payload.nextSecrets), 'all')
  } catch (error: unknown) {
    await rethrowAfterCredentialCompensation(error, () =>
      rollbackWindowsZeroChatAppDataTransition(stagedTransition, payload),
    )
  }
  return stagedTransition
}

async function clearProviderAppDataTransition(
  expectedRevision: string | null,
): Promise<void> {
  await mutateSecretStore((store, nextRevision) => {
    store.delete(PROVIDER_APP_DATA_TRANSITION_KEY)
    store.put(nextRevision, SECRET_STORE_REVISION_KEY)
  }, expectedRevision)
}

async function clearZeroChatAppDataTransition(
  expectedRevision: string | null,
): Promise<void> {
  await mutateSecretStore((store, nextRevision) => {
    store.delete(ZEROCHAT_APP_DATA_TRANSITION_KEY)
    store.put(nextRevision, SECRET_STORE_REVISION_KEY)
  }, expectedRevision)
}

async function decodeProviderAppDataTransition(
  record: ProviderAppDataTransitionRecord,
): Promise<ProviderAppDataTransitionPayload> {
  return parseProviderAppDataTransitionPayload(
    await decryptLocalString(
      PROVIDER_APP_DATA_TRANSITION_NAMESPACE,
      record.payload,
    ),
  )
}

async function decodeZeroChatAppDataTransition(
  record: ZeroChatAppDataTransitionRecord,
): Promise<ZeroChatAppDataTransitionPayload> {
  return parseZeroChatAppDataTransitionPayload(
    await decryptLocalString(
      ZEROCHAT_APP_DATA_TRANSITION_NAMESPACE,
      record.payload,
    ),
  )
}

async function rollbackBrowserProviderAppDataTransition(
  record: ProviderAppDataTransitionRecord,
  payload: ProviderAppDataTransitionPayload,
): Promise<void> {
  const state = await readProviderAppDataTransitionState()

  if (!state.record) {
    return
  }

  if (state.record.revision !== record.revision) {
    return
  }

  if (state.revision !== record.revision) {
    await clearProviderAppDataTransition(state.revision)
    return
  }

  const legacyNames = legacySecretNamesMatching(isProviderSecretName)
  const entries = await encryptedProviderSecretEntries(
    payload.previousProviderKeys,
  )

  await mutateSecretStore((store, nextRevision, abortWith) => {
    replaceSecretsInStore(
      store,
      entries,
      legacyNames,
      isProviderSecretName,
      nextRevision,
      abortWith,
      () => store.delete(PROVIDER_APP_DATA_TRANSITION_KEY),
    )
  }, record.revision)
  clearLegacySecretNamesBestEffort(legacyNames)
}

async function rollbackWindowsProviderAppDataTransition(
  record: ProviderAppDataTransitionRecord,
  payload: ProviderAppDataTransitionPayload,
): Promise<void> {
  const state = await readProviderAppDataTransitionState()

  if (!state.record) {
    return
  }

  if (state.record.revision !== record.revision) {
    return
  }

  if (state.revision !== record.revision) {
    await clearProviderAppDataTransition(state.revision)
    return
  }

  await mutateWindowsSecretStore(
    Object.entries(payload.previousProviderKeys)
      .map(([providerId, value]) =>
        secretChange(providerKeyName(providerId), value, true),
      )
      .filter(({ value }) => value !== null),
    'provider',
  )
  await clearProviderAppDataTransition(record.revision)
}

async function rollbackBrowserZeroChatAppDataTransition(
  record: ZeroChatAppDataTransitionRecord,
  payload: ZeroChatAppDataTransitionPayload,
): Promise<void> {
  const state = await readZeroChatAppDataTransitionState()

  if (!state.record || state.record.revision !== record.revision) {
    return
  }

  if (state.revision !== record.revision) {
    await clearZeroChatAppDataTransition(state.revision)
    return
  }

  await replaceZeroChatSecretSnapshotNow(
    payload.previousSecrets,
    record.revision,
  )
}

async function rollbackWindowsZeroChatAppDataTransition(
  record: ZeroChatAppDataTransitionRecord,
  payload: ZeroChatAppDataTransitionPayload,
): Promise<void> {
  const state = await readZeroChatAppDataTransitionState()

  if (!state.record || state.record.revision !== record.revision) {
    return
  }

  if (state.revision !== record.revision) {
    await clearZeroChatAppDataTransition(state.revision)
    return
  }

  await mutateWindowsSecretStore(
    snapshotChanges(payload.previousSecrets),
    'all',
  )
  await clearZeroChatAppDataTransition(record.revision)
}

async function completeProviderAppDataTransitionBestEffort(
  record: ProviderAppDataTransitionRecord,
): Promise<void> {
  try {
    const state = await readProviderAppDataTransitionState()

    if (!state.record) {
      return
    }

    if (state.record.revision !== record.revision) {
      return
    }

    await clearProviderAppDataTransition(
      state.revision === record.revision ? record.revision : state.revision,
    )
  } catch {
    // AppData and secrets already agree. Startup recovery retries stale journal cleanup.
  }
}

async function completeZeroChatAppDataTransitionBestEffort(
  record: ZeroChatAppDataTransitionRecord,
): Promise<void> {
  try {
    const state = await readZeroChatAppDataTransitionState()

    if (!state.record || state.record.revision !== record.revision) {
      return
    }

    await clearZeroChatAppDataTransition(
      state.revision === record.revision ? record.revision : state.revision,
    )
    clearStorageItemBestEffort(
      localStorage,
      PENDING_PROVIDER_SECRET_CLEANUP_KEY,
    )
  } catch {
    // AppData and secrets already agree. Startup recovery retries stale journal cleanup.
  }
}

function setBrowserGithubToken(value: string): Promise<void> {
  return setSecret('github-token', value)
}

function getBrowserSyncPassphrase(): string {
  const current = sessionStorage.getItem(SYNC_PASSPHRASE_KEY)

  if (current !== null) {
    return current
  }

  const legacy = localStorage.getItem(SYNC_PASSPHRASE_KEY)

  if (legacy) {
    sessionStorage.setItem(SYNC_PASSPHRASE_KEY, legacy)
    clearStorageItemBestEffort(localStorage, SYNC_PASSPHRASE_KEY)
    return legacy
  }

  return ''
}

function setBrowserSyncPassphrase(value: string): void {
  localStorage.setItem(SYNC_PASSPHRASE_KEY, '')
  sessionStorage.setItem(SYNC_PASSPHRASE_KEY, value)
}

function throwCredentialTransitionFailure(
  errors: unknown[],
  messageKey:
    | 'error.localCredentialRollbackFailed'
    | 'error.localCredentialCommitStateUnknown',
  cause: unknown,
): never {
  throw new AggregateError(
    errors,
    rt(messageKey),
    { cause },
  )
}

async function rethrowAfterCredentialCompensation(
  primaryError: unknown,
  compensate: () => Promise<void>,
): Promise<never> {
  try {
    await compensate()
  } catch (compensationError: unknown) {
    throwCredentialTransitionFailure(
      [primaryError, compensationError],
      'error.localCredentialRollbackFailed',
      compensationError,
    )
  }

  throw primaryError
}

function rethrowAfterBrowserSyncPassphraseRestore(
  previousSyncPassphrase: string,
  primaryError: unknown,
): never {
  try {
    setBrowserSyncPassphrase(previousSyncPassphrase)
  } catch (restoreError: unknown) {
    const errors = [primaryError, restoreError]

    try {
      sessionStorage.removeItem(SYNC_PASSPHRASE_KEY)
    } catch (clearError: unknown) {
      errors.push(clearError)
      try {
        sessionStorage.setItem(SYNC_PASSPHRASE_KEY, '')
      } catch (overwriteError: unknown) {
        errors.push(overwriteError)
      }
    }

    throwCredentialTransitionFailure(
      errors,
      'error.localCredentialRollbackFailed',
      restoreError,
    )
  }

  throw primaryError
}

async function replaceZeroChatSecretSnapshotNow(
  snapshot: ZeroChatSecretSnapshot,
  expectedRevision?: string,
): Promise<string> {
  const legacyNames = legacySecretNamesMatching(isStoredSecretName)
  const entries = await Promise.all(
    [
      ...Object.entries(snapshot.providerKeys).map(([providerId, value]) => ({
        name: providerKeyName(providerId),
        value,
      })),
      { name: 'github-token', value: snapshot.githubToken },
    ].map(async ({ name, value }) => {
      const trimmed = value.trim()

      return {
        name,
        record: trimmed
          ? await encryptLocalString(name, trimmed)
          : secretDeletedRecord,
      }
    }),
  )
  const nextNames = new Set(entries.map(({ name }) => name))
  const previousSyncPassphrase = getBrowserSyncPassphrase()

  try {
    setBrowserSyncPassphrase(snapshot.syncPassphrase)
    const revision = await mutateSecretStore((store, nextRevision, abortWith) => {
      const keysRequest = store.getAllKeys()

      keysRequest.onerror = () => {
        abortWith(keysRequest.error)
      }
      keysRequest.onsuccess = () => {
        try {
          const deletedNames = new Set(
            legacyNames.filter((name) => !nextNames.has(name)),
          )

          for (const key of keysRequest.result) {
            if (
              typeof key !== 'string' ||
              !key.startsWith('secret:')
            ) {
              continue
            }

            const name = key.slice('secret:'.length)

            if (isStoredSecretName(name) && !nextNames.has(name)) {
              deletedNames.add(name)
            }
          }

          store.clear()

          for (const name of deletedNames) {
            store.put(secretDeletedRecord, secretRecordKey(name))
          }

          for (const { name, record } of entries) {
            store.put(record, secretRecordKey(name))
          }
          store.put(nextRevision, SECRET_STORE_REVISION_KEY)
        } catch (error: unknown) {
          abortWith(error)
        }
      }
    }, expectedRevision)

    clearLegacySecretNamesBestEffort(legacyNames)
    clearStorageItemBestEffort(localStorage, SYNC_PASSPHRASE_KEY)
    return revision
  } catch (error: unknown) {
    rethrowAfterBrowserSyncPassphraseRestore(previousSyncPassphrase, error)
  }
}

function replaceBrowserZeroChatSecretSnapshot(
  snapshot: ZeroChatSecretSnapshot,
): Promise<void> {
  return runSecretMutation(async () => {
    await replaceZeroChatSecretSnapshotNow(snapshot)
  })
}

function restoreBrowserZeroChatSecretSnapshot(
  snapshot: ZeroChatSecretSnapshot,
  expectedRevision: string,
): Promise<void> {
  return runSecretMutation(async () => {
    await replaceZeroChatSecretSnapshotNow(snapshot, expectedRevision)
  })
}

async function clearBrowserProviderSecrets(): Promise<void> {
  await runSecretMutation(async () => {
    const legacyNames = legacySecretNamesMatching(isProviderSecretName)
    await tombstoneSecretsMatchingNow(isProviderSecretName, legacyNames)
    clearLegacySecretNamesBestEffort(legacyNames)
    clearStorageItemBestEffort(
      localStorage,
      PENDING_PROVIDER_SECRET_CLEANUP_KEY,
    )
  })
}

async function clearBrowserProviderSecretsById(
  providerIds: string[],
): Promise<void> {
  const ids = new Set(providerIds)

  if (ids.size === 0) {
    return
  }

  const isTargetProviderSecret = (name: string) => {
    if (name.startsWith('provider:')) {
      return ids.has(name.slice('provider:'.length))
    }

    return name.startsWith('proxy:') && ids.has(name.slice('proxy:'.length))
  }

  await runSecretMutation(async () => {
    const legacyNames = legacySecretNamesMatching(isTargetProviderSecret)
    await tombstoneSecretsMatchingNow(isTargetProviderSecret, legacyNames)
    clearLegacySecretNamesBestEffort(legacyNames)
  })
}

async function clearBrowserZeroChatSecrets(): Promise<string> {
  let committedRevision = ''

  await runSecretMutation(async () => {
    committedRevision = await replaceZeroChatSecretSnapshotNow({
      providerKeys: {},
      githubToken: '',
      syncPassphrase: '',
    })
    clearStorageItemBestEffort(
      localStorage,
      PENDING_PROVIDER_SECRET_CLEANUP_KEY,
    )
  })

  return committedRevision
}

function currentWindowsSecretBridgeIdentity(): unknown {
  if (typeof window === 'undefined') {
    return undefined
  }

  return (
    window as Window & {
      chrome?: { webview?: unknown }
    }
  ).chrome?.webview
}

function resetWindowsSecretStateForCurrentBridge(): void {
  const identity = currentWindowsSecretBridgeIdentity()

  if (identity === windowsSecretBridgeIdentity) {
    return
  }

  windowsSecretBridgeIdentity = identity
  loadedWindowsSecretRevision = undefined
  windowsSecretRevisionGeneration += 1
  windowsSecretInitialization = undefined
}

function assertWindowsSecretMigrationOwner(identity: unknown): void {
  if (identity !== currentWindowsSecretBridgeIdentity()) {
    throw new WindowsSecretBridgeError('bridge-unavailable')
  }
}

function translateWindowsSecretError(error: unknown): never {
  if (
    error instanceof WindowsSecretBridgeError &&
    error.code === 'conflict'
  ) {
    throw new AppDataWriteConflictError()
  }

  throw error
}

async function readBrowserMigrationEntries(): Promise<WindowsSecretEntry[]> {
  const keys = await secretTransaction<IDBValidKey[]>('readonly', (store) =>
    store.getAllKeys(),
  )
  const names = new Set(
    legacySecretNamesMatching(isValidWindowsSecretName),
  )

  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith('secret:')) {
      continue
    }

    const name = key.slice('secret:'.length)
    if (isValidWindowsSecretName(name)) {
      names.add(name)
    }
  }

  names.delete('sync-passphrase')
  const entries = (
    await Promise.all(
      [...names].map(async (name) => ({
        name,
        value: await getSecret(name, 'owned'),
      })),
    )
  ).filter(({ value }) => value.length > 0)
  const syncPassphrase = getBrowserSyncPassphrase()

  if (syncPassphrase) {
    entries.push({
      name: 'sync-passphrase',
      value: syncPassphrase,
    })
  }

  return entries
}

interface BrowserSecretRecordSnapshot {
  key: IDBValidKey
  value: unknown
}

async function readBrowserSecretRecordSnapshot(): Promise<
  BrowserSecretRecordSnapshot[]
> {
  const keys = (
    await secretTransaction<IDBValidKey[]>('readonly', (store) =>
      store.getAllKeys(),
    )
  ).filter(
    (key): key is string =>
      typeof key === 'string' && key.startsWith('secret:'),
  )
  const values = await Promise.all(
    keys.map((key) =>
      secretTransaction<unknown>('readonly', (store) => store.get(key)),
    ),
  )

  return keys.map((key, index) => ({
    key,
    value: values[index],
  }))
}

async function restoreMissingBrowserSecretSnapshotRecords(
  snapshot: BrowserSecretRecordSnapshot[],
  bridgeIdentity: unknown,
): Promise<void> {
  if (snapshot.length === 0) {
    return
  }

  await secretBatchTransaction('readwrite', (store, abortWith) => {
    for (const record of snapshot) {
      const request = store.get(record.key)
      request.onerror = () => abortWith(request.error)
      request.onsuccess = () => {
        if (request.result !== undefined) {
          return
        }

        try {
          assertWindowsSecretMigrationOwner(bridgeIdentity)
          const put = store.put(record.value, record.key)
          put.onerror = () => abortWith(put.error)
        } catch (error: unknown) {
          abortWith(error)
        }
      }
    }
  })
}

async function clearBrowserSecretsAfterWindowsMigration(
  migrationBridgeIdentity: unknown,
): Promise<void> {
  const snapshot = await readBrowserSecretRecordSnapshot()

  await secretBatchTransaction(
    'readwrite',
    (store, abortWith) => {
      const keysRequest = store.getAllKeys()
      keysRequest.onerror = () => abortWith(keysRequest.error)
      keysRequest.onsuccess = () => {
        const secretKeys = keysRequest.result.filter(
          (key): key is string =>
            typeof key === 'string' && key.startsWith('secret:'),
        )

        for (const key of secretKeys) {
          try {
            assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
            const request = store.delete(key)
            request.onerror = () => abortWith(request.error)
          } catch (error: unknown) {
            abortWith(error)
          }
        }
      }
    },
    async () => {
      try {
        assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
      } catch (error: unknown) {
        try {
          await restoreMissingBrowserSecretSnapshotRecords(
            snapshot,
            currentWindowsSecretBridgeIdentity(),
          )
        } catch (restoreError: unknown) {
          throw new AggregateError(
            [error, restoreError],
            'Windows browser secret cleanup could not be compensated.',
            { cause: restoreError },
          )
        }
        throw error
      }
    },
  )

  assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
  const legacyKeys: string[] = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(SECRET_PREFIX)) {
      continue
    }

    const name = key.slice(SECRET_PREFIX.length)
    if (isValidWindowsSecretName(name)) {
      legacyKeys.push(key)
    }
  }

  for (const key of legacyKeys) {
    localStorage.removeItem(key)
  }

  assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
  sessionStorage.removeItem(SYNC_PASSPHRASE_KEY)
  loadedSecretStoreRevision = undefined
}

function entryMap(entries: WindowsSecretEntry[]): Map<string, string> {
  return new Map(entries.map(({ name, value }) => [name, value]))
}

async function readWindowsSecretSnapshot(
  names: string[],
): Promise<WindowsSecretReadResult> {
  const revisionGeneration = windowsSecretRevisionGeneration

  try {
    const result = await readWindowsSecrets(names)
    if (revisionGeneration === windowsSecretRevisionGeneration) {
      loadedWindowsSecretRevision = result.revision
    }
    return result
  } catch (error: unknown) {
    translateWindowsSecretError(error)
  }
}

async function mutateWindowsSecretStore(
  changes: WindowsSecretChange[],
  clearScope: 'none' | 'provider' | 'all',
  migrationState: WindowsSecretMigrationState | null = null,
  expectedRevision = loadedWindowsSecretRevision ?? null,
): Promise<WindowsSecretProbeResult> {
  const bridgeIdentity = currentWindowsSecretBridgeIdentity()
  const revisionGeneration = windowsSecretRevisionGeneration

  try {
    const result = await mutateWindowsSecrets({
      changes,
      clearScope,
      expectedRevision,
      migrationState,
    })
    if (
      bridgeIdentity === currentWindowsSecretBridgeIdentity() &&
      revisionGeneration === windowsSecretRevisionGeneration
    ) {
      windowsSecretRevisionGeneration += 1
      loadedWindowsSecretRevision = result.revision
    }
    return result
  } catch (error: unknown) {
    translateWindowsSecretError(error)
  }
}

async function runWindowsSecretMigration(): Promise<void> {
  const migrationBridgeIdentity = currentWindowsSecretBridgeIdentity()
  let current: WindowsSecretProbeResult

  try {
    current = await probeWindowsSecretBridge()
  } catch (error: unknown) {
    translateWindowsSecretError(error)
  }
  assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
  loadedWindowsSecretRevision = current.revision

  if (current.migrationState === 'complete') {
    await clearBrowserSecretsAfterWindowsMigration(migrationBridgeIdentity)
    assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
    return
  }

  const browserEntries = await readBrowserMigrationEntries()
  assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
  const names = browserEntries.map(({ name }) => name)
  let locker = await readWindowsSecretSnapshot(names)
  assertWindowsSecretMigrationOwner(migrationBridgeIdentity)

  if (locker.migrationState === 'complete') {
    await clearBrowserSecretsAfterWindowsMigration(migrationBridgeIdentity)
    assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
    return
  }

  const lockerValues = entryMap(locker.entries)
  const missingEntries = browserEntries.filter(
    ({ name }) => !lockerValues.has(name),
  )

  if (
    locker.migrationState !== 'locker-written' ||
    missingEntries.length > 0
  ) {
    assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
    await mutateWindowsSecretStore(
      missingEntries,
      'none',
      'locker-written',
      locker.revision,
    )
    locker = await readWindowsSecretSnapshot(names)
    assertWindowsSecretMigrationOwner(migrationBridgeIdentity)

    const verified = entryMap(locker.entries)
    const migrationVerified =
      locker.migrationState === 'locker-written' &&
      missingEntries.every(
        ({ name, value }) => verified.get(name) === value,
      )

    if (!migrationVerified) {
      try {
        assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
        await mutateWindowsSecretStore(
          missingEntries.map(({ name }) => ({ name, value: null })),
          'none',
          'pending',
          locker.revision,
        )
      } catch {
        // The persisted locker-written state makes the next startup retryable.
      }
      throw new WindowsSecretBridgeError('storage-failure')
    }
  }

  assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
  await mutateWindowsSecretStore(
    [],
    'none',
    'complete',
    loadedWindowsSecretRevision ?? null,
  )
  assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
  await clearBrowserSecretsAfterWindowsMigration(migrationBridgeIdentity)
  assertWindowsSecretMigrationOwner(migrationBridgeIdentity)
}

function ensureWindowsSecretStoreInitialized(): Promise<void> {
  resetWindowsSecretStateForCurrentBridge()

  if (windowsSecretInitialization) {
    return windowsSecretInitialization
  }

  const initialization = windowsSecretMigrationTail.then(() =>
    withSecretMutationLock(runWindowsSecretMigration),
  )
  windowsSecretMigrationTail = initialization.then(
    () => undefined,
    () => undefined,
  )
  windowsSecretInitialization = initialization
  void initialization.catch(() => {
    if (windowsSecretInitialization === initialization) {
      windowsSecretInitialization = undefined
    }
  })
  return initialization
}

function secretChange(name: string, value: string, trim: boolean): WindowsSecretChange {
  const normalized = trim ? value.trim() : value

  return {
    name,
    value: normalized ? normalized : null,
  }
}

function snapshotChanges(snapshot: ZeroChatSecretSnapshot): WindowsSecretChange[] {
  return [
    ...Object.entries(snapshot.providerKeys).map(([providerId, value]) =>
      secretChange(providerKeyName(providerId), value, true),
    ),
    secretChange('github-token', snapshot.githubToken, true),
    secretChange('sync-passphrase', snapshot.syncPassphrase, false),
  ].filter(({ value }) => value !== null)
}

async function loadWindowsZeroChatSecrets(
  providerIds: string[],
): Promise<StoredSecrets> {
  await ensureWindowsSecretStoreInitialized()
  const names = [
    ...providerIds.map(providerKeyName),
    'github-token',
    'sync-passphrase',
  ]
  const snapshot = await readWindowsSecretSnapshot(names)
  const values = entryMap(snapshot.entries)

  return {
    providerKeys: Object.fromEntries(
      providerIds.map((providerId) => [
        providerId,
        values.get(providerKeyName(providerId)) ?? '',
      ]),
    ),
    githubToken: values.get('github-token') ?? '',
  }
}

async function recoverPendingProviderSecretAppDataTransitionNow(): Promise<void> {
  const state = await readProviderAppDataTransitionState()

  if (!state.record) {
    return
  }

  const payload = await decodeProviderAppDataTransition(state.record)
  const persistedAppData = await readPersistedAppDataJson()

  if (persistedAppData === payload.targetAppData) {
    await completeProviderAppDataTransitionBestEffort(state.record)
    return
  }

  if (isWindowsWebViewOrigin()) {
    await rollbackWindowsProviderAppDataTransition(state.record, payload)
    return
  }

  await rollbackBrowserProviderAppDataTransition(state.record, payload)
}

export function recoverPendingProviderSecretAppDataTransition(): Promise<void> {
  return (async () => {
    if (isWindowsWebViewOrigin()) {
      await ensureWindowsSecretStoreInitialized()
    }
    await withSecretMutationLock(recoverPendingProviderSecretAppDataTransitionNow)
  })()
}

async function recoverPendingZeroChatSecretAppDataTransitionNow(): Promise<void> {
  const state = await readZeroChatAppDataTransitionState()

  if (!state.record) {
    return
  }

  const payload = await decodeZeroChatAppDataTransition(state.record)
  const persistedAppData = await readPersistedAppDataJson()

  if (persistedAppData === payload.targetAppData) {
    await completeZeroChatAppDataTransitionBestEffort(state.record)
    return
  }

  if (isWindowsWebViewOrigin()) {
    await rollbackWindowsZeroChatAppDataTransition(state.record, payload)
    return
  }

  await rollbackBrowserZeroChatAppDataTransition(state.record, payload)
}

export function recoverPendingZeroChatSecretAppDataTransition(): Promise<void> {
  return (async () => {
    if (isWindowsWebViewOrigin()) {
      await ensureWindowsSecretStoreInitialized()
    }
    await withSecretMutationLock(recoverPendingZeroChatSecretAppDataTransitionNow)
  })()
}

async function commitAppDataWithSecretTransition<RecordType>(
  targetAppData: AppData,
  targetAppDataJson: string,
  persistAppData: (snapshot: AppData) => Promise<AppData>,
  stage: () => Promise<RecordType>,
  rollback: (record: RecordType) => Promise<void>,
  complete: (record: RecordType) => Promise<void>,
): Promise<AppData> {
  return runSecretMutation(async () => {
    const transition = await stage()
    let persisted: AppData

    try {
      persisted = await persistAppData(targetAppData)
      if (JSON.stringify(persisted) !== targetAppDataJson) {
        throw new AppDataWriteConflictError()
      }
    } catch (error: unknown) {
      let persistedAppData: string

      try {
        persistedAppData = await readPersistedAppDataJson() ?? ''
      } catch (resolutionError: unknown) {
        // The durable side is unknown. Keep the journal for startup recovery.
        throwCredentialTransitionFailure(
          [error, resolutionError],
          'error.localCredentialCommitStateUnknown',
          resolutionError,
        )
      }

      await rethrowAfterCredentialCompensation(
        error,
        () => persistedAppData === targetAppDataJson
          ? complete(transition)
          : rollback(transition),
      )
      throw error
    }

    await complete(transition)
    return persisted
  })
}

export async function commitProviderSecretSnapshotWithAppData(
  previousProviderKeys: Record<string, string>,
  nextProviderKeys: Record<string, string>,
  targetAppData: AppData,
  persistAppData: (snapshot: AppData) => Promise<AppData>,
): Promise<AppData> {
  const payload: ProviderAppDataTransitionPayload = {
    nextProviderKeys: { ...nextProviderKeys },
    previousProviderKeys: { ...previousProviderKeys },
    targetAppData: JSON.stringify(targetAppData),
  }
  const encryptedPayload = await encryptLocalString(
    PROVIDER_APP_DATA_TRANSITION_NAMESPACE,
    JSON.stringify(payload),
  )
  const windows = isWindowsWebViewOrigin()

  if (windows) {
    await ensureWindowsSecretStoreInitialized()
  }

  return commitAppDataWithSecretTransition(
    targetAppData,
    payload.targetAppData,
    persistAppData,
    () => windows
      ? stageWindowsProviderAppDataTransition(payload, encryptedPayload)
      : stageBrowserProviderAppDataTransition(payload, encryptedPayload),
    (transition) => windows
      ? rollbackWindowsProviderAppDataTransition(transition, payload)
      : rollbackBrowserProviderAppDataTransition(transition, payload),
    completeProviderAppDataTransitionBestEffort,
  )
}

export async function commitZeroChatSecretSnapshotWithAppData(
  previousSecrets: ZeroChatSecretSnapshot,
  nextSecrets: ZeroChatSecretSnapshot,
  targetAppData: AppData,
  persistAppData: (snapshot: AppData) => Promise<AppData>,
): Promise<AppData> {
  const payload: ZeroChatAppDataTransitionPayload = {
    nextSecrets: {
      providerKeys: { ...nextSecrets.providerKeys },
      githubToken: nextSecrets.githubToken,
      syncPassphrase: nextSecrets.syncPassphrase,
    },
    previousSecrets: {
      providerKeys: { ...previousSecrets.providerKeys },
      githubToken: previousSecrets.githubToken,
      syncPassphrase: previousSecrets.syncPassphrase,
    },
    targetAppData: JSON.stringify(targetAppData),
  }
  const encryptedPayload = await encryptLocalString(
    ZEROCHAT_APP_DATA_TRANSITION_NAMESPACE,
    JSON.stringify(payload),
  )
  const windows = isWindowsWebViewOrigin()

  if (windows) {
    await ensureWindowsSecretStoreInitialized()
  }

  return commitAppDataWithSecretTransition(
    targetAppData,
    payload.targetAppData,
    persistAppData,
    () => windows
      ? stageWindowsZeroChatAppDataTransition(payload, encryptedPayload)
      : stageBrowserZeroChatAppDataTransition(payload, encryptedPayload),
    (transition) => windows
      ? rollbackWindowsZeroChatAppDataTransition(transition, payload)
      : rollbackBrowserZeroChatAppDataTransition(transition, payload),
    completeZeroChatAppDataTransitionBestEffort,
  )
}

export async function loadZeroChatSecrets(
  providerIds: string[],
): Promise<StoredSecrets> {
  if (isWindowsWebViewOrigin()) {
    await ensureWindowsSecretStoreInitialized()
  }

  await runSecretMutation(async () => {
    await recoverPendingZeroChatSecretAppDataTransitionNow()
    await recoverPendingProviderSecretAppDataTransitionNow()
  })

  return isWindowsWebViewOrigin()
    ? loadWindowsZeroChatSecrets(providerIds)
    : loadBrowserZeroChatSecrets(providerIds)
}

export async function setProviderKey(
  providerId: string,
  value: string,
): Promise<void> {
  if (!isWindowsWebViewOrigin()) {
    return setBrowserProviderKey(providerId, value)
  }

  await ensureWindowsSecretStoreInitialized()
  await runSecretMutation(async () => {
    await mutateWindowsSecretStore([
      secretChange(providerKeyName(providerId), value, true),
    ], 'none')
  })
}

export async function replaceProviderSecretSnapshot(
  providerKeys: Record<string, string>,
): Promise<void> {
  if (!isWindowsWebViewOrigin()) {
    return replaceBrowserProviderSecretSnapshot(providerKeys)
  }

  await ensureWindowsSecretStoreInitialized()
  await runSecretMutation(async () => {
    await mutateWindowsSecretStore(
      Object.entries(providerKeys)
        .map(([providerId, value]) =>
          secretChange(providerKeyName(providerId), value, true),
        )
        .filter(({ value }) => value !== null),
      'provider',
    )
  })
}

export async function setGithubToken(value: string): Promise<void> {
  if (!isWindowsWebViewOrigin()) {
    return setBrowserGithubToken(value)
  }

  await ensureWindowsSecretStoreInitialized()
  await runSecretMutation(async () => {
    await mutateWindowsSecretStore([
      secretChange('github-token', value, true),
    ], 'none')
  })
}

export async function getSyncPassphrase(): Promise<string> {
  if (!isWindowsWebViewOrigin()) {
    return getBrowserSyncPassphrase()
  }

  await ensureWindowsSecretStoreInitialized()
  const snapshot = await readWindowsSecretSnapshot(['sync-passphrase'])
  return entryMap(snapshot.entries).get('sync-passphrase') ?? ''
}

export async function setSyncPassphrase(value: string): Promise<void> {
  if (!isWindowsWebViewOrigin()) {
    setBrowserSyncPassphrase(value)
    return
  }

  await ensureWindowsSecretStoreInitialized()
  await runSecretMutation(async () => {
    await mutateWindowsSecretStore([
      secretChange('sync-passphrase', value, false),
    ], 'none')
  })
}

export async function replaceZeroChatSecretSnapshot(
  snapshot: ZeroChatSecretSnapshot,
): Promise<void> {
  if (!isWindowsWebViewOrigin()) {
    return replaceBrowserZeroChatSecretSnapshot(snapshot)
  }

  await ensureWindowsSecretStoreInitialized()
  await runSecretMutation(async () => {
    await mutateWindowsSecretStore(snapshotChanges(snapshot), 'all')
  })
}

export async function restoreZeroChatSecretSnapshot(
  snapshot: ZeroChatSecretSnapshot,
  expectedRevision: string,
): Promise<void> {
  if (!isWindowsWebViewOrigin()) {
    return restoreBrowserZeroChatSecretSnapshot(snapshot, expectedRevision)
  }

  await ensureWindowsSecretStoreInitialized()
  await runSecretMutation(async () => {
    await mutateWindowsSecretStore(
      snapshotChanges(snapshot),
      'all',
      null,
      expectedRevision,
    )
  })
}

export async function clearProviderSecrets(): Promise<void> {
  if (!isWindowsWebViewOrigin()) {
    return clearBrowserProviderSecrets()
  }

  await ensureWindowsSecretStoreInitialized()
  await runSecretMutation(async () => {
    await mutateWindowsSecretStore([], 'provider')
    clearStorageItemBestEffort(
      localStorage,
      PENDING_PROVIDER_SECRET_CLEANUP_KEY,
    )
  })
}

export async function clearProviderSecretsById(
  providerIds: string[],
): Promise<void> {
  if (!isWindowsWebViewOrigin()) {
    return clearBrowserProviderSecretsById(providerIds)
  }

  if (providerIds.length === 0) {
    return
  }

  await ensureWindowsSecretStoreInitialized()
  await runSecretMutation(async () => {
    await mutateWindowsSecretStore(
      providerIds.flatMap((providerId) => [
        { name: providerKeyName(providerId), value: null },
        { name: proxyKeyName(providerId), value: null },
      ]),
      'none',
    )
  })
}

export async function clearZeroChatSecrets(): Promise<string> {
  if (!isWindowsWebViewOrigin()) {
    return clearBrowserZeroChatSecrets()
  }

  await ensureWindowsSecretStoreInitialized()
  let revision: string | null = null

  await runSecretMutation(async () => {
    const result = await mutateWindowsSecretStore([], 'all')
    revision = result.revision
    clearStorageItemBestEffort(
      localStorage,
      PENDING_PROVIDER_SECRET_CLEANUP_KEY,
    )
  })

  if (!revision) {
    throw new WindowsSecretBridgeError('invalid-response')
  }

  return revision
}
