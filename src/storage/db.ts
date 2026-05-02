import { providerFromPreset, providerPresets } from '../data/presets'
import type { AppData, Conversation } from '../types'
import {
  decryptLocalString,
  encryptLocalString,
  isLocalEncryptedRecord,
} from './localCrypto'

const DB_NAME = 'zerochat'
const DB_VERSION = 1
const STORE_NAME = 'documents'
const APP_KEY = 'app'
const APP_DATA_NAMESPACE = 'app-data'

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

function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const store = tx.objectStore(STORE_NAME)
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

export async function loadAppData(): Promise<AppData | null> {
  const stored =
    (await transaction<unknown | undefined>('readonly', (store) =>
      store.get(APP_KEY),
    )) ?? null

  if (!stored) {
    return null
  }

  if (isLocalEncryptedRecord(stored)) {
    return JSON.parse(await decryptLocalString(APP_DATA_NAMESPACE, stored)) as AppData
  }

  const data = stored as AppData
  await saveAppData(data)
  return data
}

export async function saveAppData(data: AppData): Promise<void> {
  const encrypted = await encryptLocalString(
    APP_DATA_NAMESPACE,
    JSON.stringify(data),
  )

  await transaction('readwrite', (store) => store.put(encrypted, APP_KEY))
}

export async function clearAppData(): Promise<void> {
  await transaction('readwrite', (store) => store.delete(APP_KEY))
}

export function createConversation(providerId: string, model: string): Conversation {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    title: '新对话',
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
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
      gistFile: 'zerochat-sync.json',
    },
    preferences: {
      firstRunDone: false,
      theme: 'system',
      compactMode: false,
      activeConversationId: firstConversation.id,
      dismissedDangerWarnings: [],
    },
    updatedAt: now,
  }
}
