import { providerFromPreset, providerPresets } from '../data/presets'
import { rt } from '../i18n'
import {
  DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  defaultSkillSettings,
  normalizeAppData,
} from '../services/appData'
import type { AppData, Conversation, UserSkill, UserSkillChunk } from '../types'
import {
  decryptLocalString,
  encryptLocalString,
  isLocalEncryptedRecord,
  type LocalEncryptedRecord,
} from './localCrypto'
import { AppDataWriteConflictError } from './appDataWriteConflict'
import { abortIndexedDbTransactionOrReject } from './indexedDbAbortFailure'

const DB_NAME = 'zerochat'
const DB_VERSION = 1
const STORE_NAME = 'documents'
const APP_KEY = 'app'
const APP_DATA_NAMESPACE = 'app-data'
const LEGACY_APP_DATA_REVISION = 'legacy'
const SKILL_CHUNK_KEY_PREFIX = 'skill-chunk:'
const LOCAL_SKILL_CHUNK_KEY_PREFIX = `${SKILL_CHUNK_KEY_PREFIX}local:`
const EXTERNAL_SKILL_CHUNK_KEY_PREFIX = `${SKILL_CHUNK_KEY_PREFIX}external:`
const SKILL_CHUNK_PREVIEW_CHARS = 180
const LOCAL_CRYPTO_CONCURRENCY = 4

type AppDataRevision = string | null

let loadedAppDataRevision: AppDataRevision | undefined

export interface LegacySkillContentMigrationFailure {
  error: unknown
  records: Array<{ key: string; namespace: string }>
}

export interface LegacyAppDataMigrationFailure {
  error: unknown
}

type LegacySkillContentMigrationFailureListener = (
  failure: LegacySkillContentMigrationFailure,
) => void

type LegacyAppDataMigrationFailureListener = (
  failure: LegacyAppDataMigrationFailure,
) => void

const legacySkillContentMigrationFailureListeners =
  new Set<LegacySkillContentMigrationFailureListener>()

const legacyAppDataMigrationFailureListeners =
  new Set<LegacyAppDataMigrationFailureListener>()

export function subscribeLegacyAppDataMigrationFailures(
  listener: LegacyAppDataMigrationFailureListener,
): () => void {
  legacyAppDataMigrationFailureListeners.add(listener)

  return () => {
    legacyAppDataMigrationFailureListeners.delete(listener)
  }
}

export function subscribeLegacySkillContentMigrationFailures(
  listener: LegacySkillContentMigrationFailureListener,
): () => void {
  legacySkillContentMigrationFailureListeners.add(listener)

  return () => {
    legacySkillContentMigrationFailureListeners.delete(listener)
  }
}

function reportLegacyAppDataMigrationFailure(error: unknown): void {
  for (const listener of legacyAppDataMigrationFailureListeners) {
    try {
      listener({ error })
    } catch {
      // A bad UI subscriber must not turn best-effort encryption migration into an unhandled rejection.
    }
  }
}

function reportLegacySkillContentMigrationFailure(
  error: unknown,
  records: Array<{ key: string; namespace: string }>,
): void {
  for (const listener of legacySkillContentMigrationFailureListeners) {
    try {
      listener({ error, records })
    } catch {
      // A bad UI subscriber must not turn best-effort encryption migration into an unhandled rejection.
    }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function appDataRevision(stored: unknown | null): AppDataRevision {
  if (stored === null || stored === undefined) {
    return null
  }

  return isLocalEncryptedRecord(stored)
    ? `encrypted:${stored.iv}`
    : LEGACY_APP_DATA_REVISION
}

async function writeAppDataIfRevisionMatches(
  encrypted: LocalEncryptedRecord,
  expectedRevision: AppDataRevision,
): Promise<void> {
  const db = await openDatabase()

  await new Promise<void>((resolve, reject) => {
    let completed = false
    let conflictError: AppDataWriteConflictError | null = null
    let operationError: unknown
    let tx: IDBTransaction | undefined
    let getRequest: IDBRequest<unknown> | undefined
    let putRequest: IDBRequest<IDBValidKey> | undefined

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
      tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => {
        if (completed) {
          return
        }

        completed = true
        db.close()
        resolve()
      }
      tx.onerror = () => {
        rejectOnce(
          conflictError ??
            operationError ??
            tx?.error ??
            putRequest?.error ??
            getRequest?.error,
        )
      }
      tx.onabort = () => {
        rejectOnce(
          conflictError ??
            operationError ??
            tx?.error ??
            putRequest?.error ??
            getRequest?.error,
        )
      }

      const store = tx.objectStore(STORE_NAME)
      getRequest = store.get(APP_KEY)
      getRequest.onerror = () => {
        rejectOnce(getRequest?.error ?? tx?.error)
      }
      getRequest.onsuccess = () => {
        if (appDataRevision(getRequest?.result) !== expectedRevision) {
          conflictError = new AppDataWriteConflictError()
          abortWith(conflictError)
          return
        }

        try {
          putRequest = store.put(encrypted, APP_KEY)
          putRequest.onerror = () => {
            rejectOnce(putRequest?.error ?? tx?.error)
          }
        } catch (error: unknown) {
          abortWith(error)
        }
      }
    } catch (error: unknown) {
      abortWith(error)
    }
  })
}

async function replaceDocumentsWithAppData(
  encrypted: LocalEncryptedRecord,
  expectedRevision: AppDataRevision,
): Promise<void> {
  const db = await openDatabase()

  await new Promise<void>((resolve, reject) => {
    let completed = false
    let conflictError: AppDataWriteConflictError | null = null
    let operationError: unknown
    let tx: IDBTransaction | undefined
    let getRequest: IDBRequest<unknown> | undefined
    let clearRequest: IDBRequest<undefined> | undefined
    let putRequest: IDBRequest<IDBValidKey> | undefined

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
      tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => {
        if (completed) {
          return
        }

        completed = true
        db.close()
        resolve()
      }
      tx.onerror = () => {
        rejectOnce(
          conflictError ??
            operationError ??
            tx?.error ??
            putRequest?.error ??
            clearRequest?.error ??
            getRequest?.error,
        )
      }
      tx.onabort = () => {
        rejectOnce(
          conflictError ??
            operationError ??
            tx?.error ??
            putRequest?.error ??
            clearRequest?.error ??
            getRequest?.error,
        )
      }

      const store = tx.objectStore(STORE_NAME)
      getRequest = store.get(APP_KEY)
      getRequest.onerror = () => {
        abortWith(getRequest?.error ?? tx?.error)
      }
      getRequest.onsuccess = () => {
        if (appDataRevision(getRequest?.result) !== expectedRevision) {
          conflictError = new AppDataWriteConflictError()
          abortWith(conflictError)
          return
        }

        try {
          clearRequest = store.clear()
          clearRequest.onerror = () => {
            abortWith(clearRequest?.error ?? tx?.error)
          }
          putRequest = store.put(encrypted, APP_KEY)
          putRequest.onerror = () => {
            abortWith(putRequest?.error ?? tx?.error)
          }
        } catch (error: unknown) {
          abortWith(error)
        }
      }
    } catch (error: unknown) {
      abortWith(error)
    }
  })
}

function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        let completed = false
        let tx: IDBTransaction
        let request: IDBRequest<T>
        let result = undefined as T

        const rejectOnce = (error: unknown) => {
          if (completed) {
            return
          }

          completed = true
          db.close()
          reject(error)
        }

        try {
          tx = db.transaction(STORE_NAME, mode)
          const store = tx.objectStore(STORE_NAME)
          request = run(store)
        } catch (error: unknown) {
          rejectOnce(error)
          return
        }

        request.onerror = () => rejectOnce(request.error ?? tx.error)
        request.onsuccess = () => {
          result = request.result
        }
        tx.oncomplete = () => {
          if (completed) {
            return
          }

          completed = true
          db.close()
          resolve(result)
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

async function batchPutDocuments(
  records: Array<{ key: string; value: unknown }>,
): Promise<void> {
  if (records.length === 0) {
    return
  }

  const db = await openDatabase()

  await new Promise<void>((resolve, reject) => {
    let completed = false
    let tx: IDBTransaction

    const rejectOnce = (error: unknown) => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      reject(error)
    }

    try {
      tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      for (const record of records) {
        store.put(record.value, record.key)
      }
    } catch (error: unknown) {
      rejectOnce(error)
      return
    }

    tx.oncomplete = () => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      resolve()
    }
    tx.onerror = () => {
      rejectOnce(tx.error)
    }
    tx.onabort = () => {
      rejectOnce(tx.error)
    }
  })
}

async function batchMigrateLegacyPlaintextDocuments(
  records: Array<{ key: string; plaintext: string; value: unknown }>,
): Promise<void> {
  if (records.length === 0) {
    return
  }

  const db = await openDatabase()

  await new Promise<void>((resolve, reject) => {
    let completed = false
    let tx: IDBTransaction

    const rejectOnce = (error: unknown) => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      reject(error)
    }

    try {
      tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      for (const record of records) {
        const request = store.get(record.key)

        request.onerror = () => rejectOnce(request.error ?? tx.error)
        request.onsuccess = () => {
          if (request.result !== record.plaintext) {
            return
          }

          try {
            store.put(record.value, record.key)
          } catch (error: unknown) {
            rejectOnce(error)
          }
        }
      }
    } catch (error: unknown) {
      rejectOnce(error)
      return
    }

    tx.oncomplete = () => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      resolve()
    }
    tx.onerror = () => {
      rejectOnce(tx.error)
    }
    tx.onabort = () => {
      rejectOnce(tx.error)
    }
  })
}

async function getDocuments(keys: string[]): Promise<Map<string, unknown | null>> {
  if (keys.length === 0) {
    return new Map()
  }

  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const results = new Map<string, unknown | null>()
    let completed = false
    let tx: IDBTransaction

    const rejectOnce = (error: unknown) => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      reject(error)
    }

    try {
      tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)

      for (const key of keys) {
        const request = store.get(key)

        request.onerror = () => rejectOnce(request.error ?? tx.error)
        request.onsuccess = () => {
          results.set(key, request.result ?? null)
        }
      }
    } catch (error: unknown) {
      rejectOnce(error)
      return
    }

    tx.oncomplete = () => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      resolve(results)
    }
    tx.onerror = () => {
      rejectOnce(tx.error)
    }
    tx.onabort = () => {
      rejectOnce(tx.error)
    }
  })
}

async function deleteDocuments(keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return
  }

  const db = await openDatabase()

  await new Promise<void>((resolve, reject) => {
    let completed = false
    let tx: IDBTransaction

    const rejectOnce = (error: unknown) => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      reject(error)
    }

    try {
      tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      for (const key of keys) {
        store.delete(key)
      }
    } catch (error: unknown) {
      rejectOnce(error)
      return
    }

    tx.oncomplete = () => {
      if (completed) {
        return
      }

      completed = true
      db.close()
      resolve()
    }
    tx.onerror = () => {
      rejectOnce(tx.error)
    }
    tx.onabort = () => {
      rejectOnce(tx.error)
    }
  })
}

function skillChunkKey(skillId: string, chunkId: string): string {
  return `${SKILL_CHUNK_KEY_PREFIX}${skillId}:${chunkId}`
}

export function skillContentRefs(skill: UserSkill): string[] {
  return skill.chunks.map((chunk) => chunk.contentRef ?? skillChunkKey(skill.id, chunk.id))
}

function skillChunkNamespace(ref: string): string {
  return ref
}

function previewContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, SKILL_CHUNK_PREVIEW_CHARS)
}

function localSkillChunkKey(
  writeId: string,
  skillIndex: number,
  chunkIndex: number,
): string {
  return `${LOCAL_SKILL_CHUNK_KEY_PREFIX}${writeId}:${skillIndex}:${chunkIndex}`
}

async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )

  return results
}

function stripChunkContent(
  skillId: string,
  chunk: UserSkillChunk,
): UserSkillChunk {
  const content = chunk.content?.trim()
  const contentRef = chunk.contentRef ?? skillChunkKey(skillId, chunk.id)
  const contentPreview =
    chunk.contentPreview?.trim() || (content ? previewContent(content) : undefined)

  return {
    id: chunk.id,
    heading: chunk.heading,
    contentRef,
    ...(contentPreview ? { contentPreview } : {}),
    keywords: chunk.keywords,
    tokenEstimate: chunk.tokenEstimate,
  }
}

async function putEncryptedStrings(
  records: Array<{ key: string; namespace: string; content: string }>,
): Promise<void> {
  const encrypted = await mapWithConcurrency(
    records,
    LOCAL_CRYPTO_CONCURRENCY,
    async (record) => ({
      key: record.key,
      value: await encryptLocalString(record.namespace, record.content),
    }),
  )

  await batchPutDocuments(encrypted)
}

function migrateLegacyPlaintextStrings(
  records: Array<{ key: string; namespace: string; content: string }>,
): void {
  if (records.length === 0) {
    return
  }

  const migratedRecords = records.map((record) => ({
    key: record.key,
    namespace: record.namespace,
  }))

  void mapWithConcurrency(
    records,
    LOCAL_CRYPTO_CONCURRENCY,
    async (record) => ({
      key: record.key,
      plaintext: record.content,
      value: await encryptLocalString(record.namespace, record.content),
    }),
  )
    .then(batchMigrateLegacyPlaintextDocuments)
    .catch((error: unknown) => {
      reportLegacySkillContentMigrationFailure(error, migratedRecords)
    })
}

async function getEncryptedString(
  key: string,
  namespace: string,
): Promise<string | null> {
  const stored =
    (await transaction<unknown | undefined>('readonly', (store) =>
      store.get(key),
    )) ?? null

  if (!stored) {
    return null
  }

  if (isLocalEncryptedRecord(stored)) {
    return decryptLocalString(namespace, stored)
  }

  if (typeof stored !== 'string') {
    return null
  }

  migrateLegacyPlaintextStrings([{ key, namespace, content: stored }])
  return stored
}

async function getEncryptedStrings(
  records: Array<{ key: string; namespace: string }>,
): Promise<Map<string, string | null>> {
  const stored = await getDocuments(records.map((record) => record.key))
  const legacyPlaintextRecords: Array<{
    key: string
    namespace: string
    content: string
  }> = []
  const decryptedEntries = await mapWithConcurrency(
    records,
    LOCAL_CRYPTO_CONCURRENCY,
    async (record) => {
      const value = stored.get(record.key) ?? null

      if (!value) {
        return [record.key, null] as const
      }

      if (isLocalEncryptedRecord(value)) {
        return [
          record.key,
          await decryptLocalString(record.namespace, value),
        ] as const
      }

      if (typeof value !== 'string') {
        return [record.key, null] as const
      }

      legacyPlaintextRecords.push({
        key: record.key,
        namespace: record.namespace,
        content: value,
      })
      return [record.key, value] as const
    },
  )

  migrateLegacyPlaintextStrings(legacyPlaintextRecords)
  return new Map(decryptedEntries)
}

export async function persistSkillContents(skill: UserSkill): Promise<UserSkill> {
  const [persisted] = await persistSkillsContents([skill])
  return persisted
}

function preparePersistedSkillContents(
  skill: UserSkill,
  writeId: string,
  skillIndex: number,
): {
  changed: boolean
  skill: UserSkill
  writes: Array<{ key: string; namespace: string; content: string }>
} {
  const chunks: UserSkillChunk[] = []
  const writes: Array<{ key: string; namespace: string; content: string }> = []
  let changed = false

  for (const [chunkIndex, chunk] of skill.chunks.entries()) {
    const content = chunk.content?.trim()
    const contentRef = content
      ? localSkillChunkKey(writeId, skillIndex, chunkIndex)
      : chunk.contentRef ?? skillChunkKey(skill.id, chunk.id)

    if (content) {
      writes.push({
        key: contentRef,
        namespace: skillChunkNamespace(contentRef),
        content,
      })
      changed = true
    }

    const stripped = stripChunkContent(skill.id, {
      ...chunk,
      contentRef,
    })
    chunks.push(stripped)

    if (
      chunk.content ||
      chunk.contentRef !== stripped.contentRef ||
      chunk.contentPreview !== stripped.contentPreview
    ) {
      changed = true
    }
  }

  return {
    changed,
    skill: changed ? { ...skill, chunks } : skill,
    writes,
  }
}

export async function persistSkillsContents(
  skills: UserSkill[],
): Promise<UserSkill[]> {
  const writeId = globalThis.crypto.randomUUID()
  const prepared = skills.map((skill, skillIndex) =>
    preparePersistedSkillContents(skill, writeId, skillIndex),
  )

  await putEncryptedStrings(prepared.flatMap((item) => item.writes))

  return prepared.map((item) => item.skill)
}

export async function persistAppDataSkillContents(data: AppData): Promise<AppData> {
  const skills = await persistSkillsContents(data.skills)
  const changed = skills.some((skill, index) => skill !== data.skills[index])

  return changed ? { ...data, skills } : data
}

export async function persistExternalAppDataSkillContents(
  data: AppData,
): Promise<AppData> {
  const writeId = globalThis.crypto.randomUUID()
  const writes: Array<{ key: string; namespace: string; content: string }> = []
  const skills = data.skills.flatMap((skill, skillIndex) => {
    const chunks = skill.chunks.flatMap((chunk, chunkIndex) => {
      const content = chunk.content?.trim()

      if (!content) {
        return []
      }

      const contentRef =
        `${EXTERNAL_SKILL_CHUNK_KEY_PREFIX}${writeId}:${skillIndex}:${chunkIndex}`
      writes.push({
        key: contentRef,
        namespace: skillChunkNamespace(contentRef),
        content,
      })
      return [stripChunkContent(skill.id, { ...chunk, contentRef })]
    })

    return chunks.length > 0 ? [{ ...skill, chunks }] : []
  })

  await putEncryptedStrings(writes)

  return data.skills.length > 0 ? { ...data, skills } : data
}

export async function loadSkillChunkContent(
  skill: UserSkill,
  chunk: UserSkillChunk,
): Promise<string> {
  if (chunk.content?.trim()) {
    return chunk.content.trim()
  }

  const contentRef = chunk.contentRef ?? skillChunkKey(skill.id, chunk.id)
  const content = await getEncryptedString(
    contentRef,
    skillChunkNamespace(contentRef),
  )

  if (!content?.trim()) {
    throw new Error(rt('error.skillContentMissing'))
  }

  return content.trim()
}

export async function loadSkillContents(
  skill: UserSkill,
): Promise<Array<{ chunk: UserSkillChunk; content: string }>> {
  const storedChunkRefs = skill.chunks
    .filter((chunk) => !chunk.content?.trim())
    .map((chunk) => {
      const contentRef = chunk.contentRef ?? skillChunkKey(skill.id, chunk.id)

      return {
        key: contentRef,
        namespace: skillChunkNamespace(contentRef),
      }
    })
  const storedContents = await getEncryptedStrings(storedChunkRefs)

  return skill.chunks.map((chunk) => {
    const contentRef = chunk.contentRef ?? skillChunkKey(skill.id, chunk.id)
    const content = chunk.content?.trim() || storedContents.get(contentRef)?.trim() || ''

    if (!content) {
      throw new Error(rt('error.skillContentMissing'))
    }

    return {
      chunk,
      content,
    }
  })
}

export async function materializeAppDataSkillContents(
  data: AppData,
): Promise<AppData> {
  const storedChunkRefs = data.skills.flatMap((skill) =>
    skill.chunks
      .filter((chunk) => !chunk.content?.trim())
      .map((chunk) => {
        const contentRef = chunk.contentRef ?? skillChunkKey(skill.id, chunk.id)

        return {
          key: contentRef,
          namespace: skillChunkNamespace(contentRef),
        }
      }),
  )
  const storedContents = await getEncryptedStrings(storedChunkRefs)
  const skills = data.skills.map((skill) => ({
    ...skill,
    chunks: skill.chunks.map((chunk) => {
      const contentRef = chunk.contentRef ?? skillChunkKey(skill.id, chunk.id)
      const inlineContent = chunk.content?.trim()
      const content =
        inlineContent || storedContents.get(contentRef)?.trim() || ''

      if (!content) {
        throw new Error(rt('error.skillContentMissing'))
      }

      return {
        id: chunk.id,
        heading: chunk.heading,
        content,
        keywords: chunk.keywords,
        tokenEstimate: chunk.tokenEstimate,
      }
    }),
  }))

  return {
    ...data,
    skills,
  }
}

export async function deleteSkillContents(skill: UserSkill): Promise<void> {
  await deleteDocuments(skillContentRefs(skill))
}

export async function deleteSkillContentRefs(refs: string[]): Promise<void> {
  await deleteDocuments(
    [...new Set(refs)].filter((ref) => ref.startsWith(SKILL_CHUNK_KEY_PREFIX)),
  )
}

export async function clearSkillChunkContents(): Promise<void> {
  const keys = await transaction<IDBValidKey[]>('readonly', (store) =>
    store.getAllKeys(),
  )
  const skillKeys = keys.filter(
    (key): key is string =>
      typeof key === 'string' && key.startsWith(SKILL_CHUNK_KEY_PREFIX),
  )

  await deleteDocuments(skillKeys)
}

export async function replaceLocalDataDocuments(data: AppData): Promise<void> {
  const expectedRevision = loadedAppDataRevision

  if (expectedRevision === undefined) {
    throw new Error('Local AppData must be loaded before it can be replaced.')
  }

  const encrypted = await encryptLocalString(
    APP_DATA_NAMESPACE,
    JSON.stringify(data),
  )

  await replaceDocumentsWithAppData(encrypted, expectedRevision)
  loadedAppDataRevision = appDataRevision(encrypted)
}

export async function loadAppData(): Promise<AppData | null> {
  const stored =
    (await transaction<unknown | undefined>('readonly', (store) =>
      store.get(APP_KEY),
    )) ?? null

  if (!stored) {
    loadedAppDataRevision = null
    return null
  }

  if (isLocalEncryptedRecord(stored)) {
    const data = normalizeAppData(
      JSON.parse(await decryptLocalString(APP_DATA_NAMESPACE, stored)) as AppData,
    )

    loadedAppDataRevision = appDataRevision(stored)
    return data
  }

  const data = normalizeAppData(stored as AppData)
  loadedAppDataRevision = LEGACY_APP_DATA_REVISION

  try {
    await saveAppData(data)
  } catch (error: unknown) {
    if (error instanceof AppDataWriteConflictError) {
      return loadAppData()
    }

    reportLegacyAppDataMigrationFailure(error)
  }

  return data
}

export async function saveAppData(data: AppData): Promise<void> {
  const expectedRevision = loadedAppDataRevision

  if (expectedRevision === undefined) {
    throw new Error('Local AppData must be loaded before it can be saved.')
  }

  const encrypted = await encryptLocalString(
    APP_DATA_NAMESPACE,
    JSON.stringify(data),
  )

  await writeAppDataIfRevisionMatches(encrypted, expectedRevision)
  loadedAppDataRevision = appDataRevision(encrypted)
}

export async function clearAppData(): Promise<void> {
  await transaction('readwrite', (store) => store.delete(APP_KEY))
  loadedAppDataRevision = null
}

export function createConversation(
  providerId: string,
  model: string,
  title = rt('conversation.newTitle'),
): Conversation {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    title,
    providerId,
    model,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createDefaultData(): AppData {
  const defaultProvider = providerFromPreset(providerPresets[0])
  const now = Date.now()
  const firstConversation = createConversation(
    defaultProvider.id,
    defaultProvider.model,
  )

  return {
    version: 1,
    providers: [defaultProvider],
    conversations: [firstConversation],
    skills: [],
    skillSettings: defaultSkillSettings(),
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
      gistFile: 'zerochat-sync.json',
    },
    preferences: {
      firstRunDone: false,
      theme: 'system',
      language: 'system',
      compactMode: false,
      chatContextMessageLimit: DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
      activeConversationId: firstConversation.id,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
    },
    updatedAt: now,
  }
}
