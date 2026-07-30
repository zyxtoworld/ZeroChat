import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { loadLocale, rt, setRuntimeLocale } from '../../i18n'
import { AppDataWriteConflictError } from '../appDataWriteConflict'
import {
  WINDOWS_SECRET_REQUEST_KIND,
  WINDOWS_SECRET_RESPONSE_KIND,
  WINDOWS_WEBVIEW_ORIGIN,
} from '../../platform/windowsBridge'
import {
  clearPendingProviderSecretCleanupById,
  clearProviderSecrets,
  clearProviderSecretsById,
  clearZeroChatSecrets,
  commitProviderSecretSnapshotWithAppData,
  commitZeroChatSecretSnapshotWithAppData,
  getPendingProviderSecretCleanupIds,
  getSyncPassphrase,
  loadZeroChatSecrets,
  queueProviderSecretCleanupById,
  recoverPendingProviderSecretAppDataTransition,
  recoverPendingZeroChatSecretAppDataTransition,
  replaceProviderSecretSnapshot,
  replaceZeroChatSecretSnapshot,
  restoreZeroChatSecretSnapshot,
  setGithubToken,
  setProviderKey,
  setSyncPassphrase,
} from '../secrets'
import {
  decryptLocalString,
  encryptLocalString,
  isLocalEncryptedRecord,
} from '../localCrypto'
import type { AppData } from '../../types'

const pendingProviderSecretCleanupKey =
  'zerochat:secret:pending-provider-secret-cleanup'
const syncPassphraseKey = 'zerochat:secret:sync-passphrase'

function transitionAppData(updatedAt: number): AppData {
  return {
    conversations: [],
    preferences: {
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt,
    version: 1,
  }
}

function deferred<T>(): {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
} {
  let reject!: (error: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject
    resolve = promiseResolve
  })

  return { promise, reject, resolve }
}

function createExclusiveLockHarness(): {
  locks: LockManager
  requests: string[]
} {
  const requests: string[] = []
  let tail: Promise<void> = Promise.resolve()
  const request = vi.fn(
    <T>(
      name: string,
      _options: unknown,
      callback: (lock: Lock) => T | PromiseLike<T>,
    ): Promise<T> => {
      requests.push(name)
      const result = tail.then(() => callback({
        mode: 'exclusive',
        name,
      } as Lock))
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
  )

  return {
    locks: { request } as unknown as LockManager,
    requests,
  }
}

function createStorageMock(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
}

interface WindowsSecretBridgeHarness {
  entries: Map<string, string>
  migrationState: 'pending' | 'locker-written' | 'complete'
  releaseNextRead: () => void
  requests: Array<Record<string, unknown>>
  revision: string | null
  window: Window
}

function createWindowsSecretBridgeHarness(options: {
  entries?: Map<string, string>
  deferReads?: boolean
  failMigrationVerification?: boolean
  failMutationNumbers?: number[]
  migrationState?: 'pending' | 'locker-written' | 'complete'
  revision?: string | null
} = {}): WindowsSecretBridgeHarness {
  const listeners = new Set<(event: { data: unknown }) => void>()
  const pendingReadResponses: Array<() => void> = []
  const requests: Array<Record<string, unknown>> = []
  const state = {
    entries: options.entries ?? new Map<string, string>(),
    migrationState: options.migrationState ?? 'pending',
    mutationCount: 0,
    revision: options.revision ?? null,
    revisionCounter: 0,
  }
  const emit = (payload: unknown) => {
    queueMicrotask(() => {
      for (const listener of listeners) {
        listener({ data: payload })
      }
    })
  }
  const webview = {
    addEventListener: vi.fn(
      (_type: 'message', listener: (event: { data: unknown }) => void) => {
        listeners.add(listener)
      },
    ),
    removeEventListener: vi.fn(
      (_type: 'message', listener: (event: { data: unknown }) => void) => {
        listeners.delete(listener)
      },
    ),
    postMessage: vi.fn((value: unknown) => {
      const request = value as Record<string, unknown>
      requests.push(request)

      const metadata = () => ({
        kind: WINDOWS_SECRET_RESPONSE_KIND,
        id: request.id,
        ok: true,
        op: request.op,
        revision: state.revision,
        migrationState: state.migrationState,
      })

      if (request.kind !== WINDOWS_SECRET_REQUEST_KIND) {
        emit({
          kind: WINDOWS_SECRET_RESPONSE_KIND,
          id: request.id,
          ok: false,
          code: 'invalid-request',
        })
        return
      }

      if (request.op === 'probe') {
        emit(metadata())
        return
      }

      if (request.op === 'read') {
        const names = request.names as string[]
        const response = {
          ...metadata(),
          entries: names.flatMap((name) => {
            const entry = state.entries.get(name)
            return entry === undefined ? [] : [{ name, value: entry }]
          }),
        }

        if (options.deferReads) {
          pendingReadResponses.push(() => emit(response))
        } else {
          emit(response)
        }
        return
      }

      if (request.op !== 'mutate') {
        emit({
          kind: WINDOWS_SECRET_RESPONSE_KIND,
          id: request.id,
          ok: false,
          code: 'invalid-request',
        })
        return
      }

      state.mutationCount += 1
      if (options.failMutationNumbers?.includes(state.mutationCount)) {
        emit({
          kind: WINDOWS_SECRET_RESPONSE_KIND,
          id: request.id,
          ok: false,
          code: 'storage-failure',
        })
        return
      }

      if (request.expectedRevision !== state.revision) {
        emit({
          kind: WINDOWS_SECRET_RESPONSE_KIND,
          id: request.id,
          ok: false,
          code: 'conflict',
        })
        return
      }

      if (
        options.failMigrationVerification &&
        request.migrationState === 'pending'
      ) {
        emit({
          kind: WINDOWS_SECRET_RESPONSE_KIND,
          id: request.id,
          ok: false,
          code: 'storage-failure',
        })
        return
      }

      const clearScope = request.clearScope
      if (clearScope === 'all') {
        state.entries.clear()
      } else if (clearScope === 'provider') {
        for (const name of [...state.entries.keys()]) {
          if (name.startsWith('provider:') || name.startsWith('proxy:')) {
            state.entries.delete(name)
          }
        }
      }

      for (const change of request.changes as Array<{
        name: string
        value: string | null
      }>) {
        if (
          options.failMigrationVerification &&
          request.migrationState === 'locker-written'
        ) {
          continue
        }

        if (change.value === null) {
          state.entries.delete(change.name)
        } else {
          state.entries.set(change.name, change.value)
        }
      }

      if (request.migrationState !== null) {
        state.migrationState = request.migrationState as typeof state.migrationState
      }
      state.revisionCounter += 1
      state.revision = `revision-${state.revisionCounter}`
      emit(metadata())
    }),
  }
  const runtimeWindow = {
    chrome: { webview },
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: { origin: WINDOWS_WEBVIEW_ORIGIN },
    setTimeout: globalThis.setTimeout.bind(globalThis),
  } as unknown as Window

  return {
    get entries() {
      return state.entries
    },
    get migrationState() {
      return state.migrationState
    },
    releaseNextRead: () => pendingReadResponses.shift()?.(),
    requests,
    get revision() {
      return state.revision
    },
    window: runtimeWindow,
  }
}

interface IndexedDbMockOptions {
  allKeys?: IDBValidKey[]
  appRecord?: unknown
  onSecretGet?: (
    key: string,
    records: Map<string, unknown>,
  ) => void
  secretRecords?: Map<string, unknown>
  transactionError?: Error
  transactionErrorDatabaseName?: string
}

interface MockTransaction {
  abort: () => void
  error: Error | null
  onabort: ((event: Event) => void) | null
  oncomplete: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  objectStore: () => IDBObjectStore
}

function createRequest<T>(
  result: T,
  tx: MockTransaction,
): IDBRequest<T> {
  const request = {
    error: null,
    result,
  } as unknown as IDBRequest<T>

  queueMicrotask(() => {
    request.onsuccess?.(new Event('success'))
    queueMicrotask(() => {
      if (tx.error) {
        tx.onerror?.(new Event('error'))
        return
      }

      tx.oncomplete?.(new Event('complete'))
    })
  })

  return request
}

function createOpenRequest(databaseName: string, options: IndexedDbMockOptions) {
  const request = {
    error: null,
    result: {
      close: vi.fn(),
      objectStoreNames: {
        contains: vi.fn(() => true),
      },
      transaction: vi.fn(() => {
        const shouldFailTransaction =
          options.transactionError &&
          options.transactionErrorDatabaseName === databaseName
        const tx: MockTransaction = {
          abort: vi.fn(() => {
            tx.error = new Error('transaction aborted')
            queueMicrotask(() => tx.onabort?.(new Event('abort')))
          }),
          error: shouldFailTransaction ? options.transactionError ?? null : null,
          onabort: null,
          oncomplete: null,
          onerror: null,
          objectStore: () => store,
        }
        const canMutateSecretRecords =
          databaseName === 'zerochat-secrets' && !shouldFailTransaction
        const store = {
          add: vi.fn(() => createRequest('saved-key', tx)),
          clear: vi.fn(() => {
            if (canMutateSecretRecords) {
              options.secretRecords?.clear()
            }
            return createRequest(undefined, tx)
          }),
          delete: vi.fn((key: IDBValidKey) => {
            if (canMutateSecretRecords) {
              options.secretRecords?.delete(String(key))
            }
            return createRequest(undefined, tx)
          }),
          get: vi.fn((key: IDBValidKey) => {
            const normalizedKey = String(key)

            if (databaseName === 'zerochat-secrets' && options.secretRecords) {
              options.onSecretGet?.(normalizedKey, options.secretRecords)
            }

            return createRequest(
              databaseName === 'zerochat-secrets'
                ? options.secretRecords?.get(normalizedKey)
                : databaseName === 'zerochat' && normalizedKey === 'app'
                  ? options.appRecord
                  : undefined,
              tx,
            )
          }),
          getAllKeys: vi.fn(() =>
            createRequest(
              [
                ...new Set([
                  ...(options.allKeys ?? []),
                  ...(options.secretRecords?.keys() ?? []),
                ]),
              ],
              tx,
            ),
          ),
          put: vi.fn((value: unknown, key: IDBValidKey) => {
            if (canMutateSecretRecords) {
              options.secretRecords?.set(String(key), value)
            }
            return createRequest('saved-key', tx)
          }),
        } as unknown as IDBObjectStore

        return tx
      }),
    },
  } as unknown as IDBOpenDBRequest

  queueMicrotask(() => {
    request.onsuccess?.(new Event('success'))
  })
  return request
}

function createIndexedDbMock(options: IndexedDbMockOptions = {}): IDBFactory {
  const secretRecords = options.secretRecords ?? new Map<string, unknown>()

  return {
    open: vi.fn((databaseName: string) =>
      createOpenRequest(databaseName, {
        ...options,
        secretRecords,
      }),
    ),
  } as unknown as IDBFactory
}

function createSecretIndexedDbMockWithAbortFailure(
  operationError: Error,
  abortError: Error,
): {
  abort: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  indexedDB: IDBFactory
} {
  const abort = vi.fn(() => {
    throw abortError
  })
  const close = vi.fn()
  const successfulRequest = <T>(result: T): IDBRequest<T> => {
    const request = {
      error: null,
      result,
    } as unknown as IDBRequest<T>

    queueMicrotask(() => request.onsuccess?.(new Event('success')))
    return request
  }

  const store = {
    clear: vi.fn(() => {
      throw operationError
    }),
    get: vi.fn(() => successfulRequest(undefined)),
    getAllKeys: vi.fn(() => successfulRequest([])),
    put: vi.fn(() => successfulRequest('saved-key')),
  } as unknown as IDBObjectStore

  const tx = {
    abort,
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: vi.fn(() => store),
  } as unknown as IDBTransaction

  const request = {
    error: null,
    result: {
      close,
      objectStoreNames: {
        contains: vi.fn(() => true),
      },
      transaction: vi.fn(() => tx),
    },
  } as unknown as IDBOpenDBRequest

  return {
    abort,
    close,
    indexedDB: {
      open: vi.fn(() => {
        queueMicrotask(() => request.onsuccess?.(new Event('success')))
        return request
      }),
    } as unknown as IDBFactory,
  }
}

function createIndexedDbMockWithThrowingTransaction(
  databaseName: string,
  error: Error,
): {
  close: ReturnType<typeof vi.fn>
  indexedDB: IDBFactory
} {
  const close = vi.fn()

  return {
    close,
    indexedDB: {
      open: vi.fn((openedDatabaseName: string) => {
        const request = {
          error: null,
          result: {
            close,
            objectStoreNames: {
              contains: vi.fn(() => true),
            },
            transaction: vi.fn(() => {
              if (openedDatabaseName === databaseName) {
                throw error
              }

              return {
                abort: vi.fn(),
                error: null,
                onabort: null,
                oncomplete: null,
                onerror: null,
                objectStore: vi.fn(() => ({
                  get: vi.fn(() => createRequest(undefined, {
                    abort: vi.fn(),
                    error: null,
                    onabort: null,
                    oncomplete: null,
                    onerror: null,
                    objectStore: vi.fn(),
                  })),
                })),
              }
            }),
          },
        } as unknown as IDBOpenDBRequest

        queueMicrotask(() => {
          request.onsuccess?.(new Event('success'))
        })
        return request
      }),
    } as unknown as IDBFactory,
  }
}

function createControlledIndexedDbMock(): {
  indexedDB: IDBFactory
  releaseTransaction: (index: number, error?: Error) => void
  transactionCount: () => number
} {
  const transactions: MockTransaction[] = []
  const pendingRevisions = new Map<MockTransaction, string>()
  let committedRevision: string | undefined
  const database = {
    close: vi.fn(),
    objectStoreNames: {
      contains: vi.fn(() => true),
    },
    transaction: vi.fn(() => {
      const tx: MockTransaction = {
        abort: vi.fn(() => {
          tx.error = new Error('transaction aborted')
          queueMicrotask(() => tx.onabort?.(new Event('abort')))
        }),
        error: null,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore: () => store,
      }
      const pendingRequest = <T>(result: T): IDBRequest<T> => {
        const request = {
          error: null,
          result,
        } as unknown as IDBRequest<T>

        queueMicrotask(() => request.onsuccess?.(new Event('success')))
        return request
      }
      const store = {
        add: vi.fn(() => pendingRequest('saved-key')),
        clear: vi.fn(() => pendingRequest(undefined)),
        delete: vi.fn(() => pendingRequest(undefined)),
        get: vi.fn((key: IDBValidKey) =>
          pendingRequest(
            key === 'meta:revision' ? committedRevision : undefined,
          )),
        getAllKeys: vi.fn(() => pendingRequest([])),
        put: vi.fn((value: unknown, key: IDBValidKey) => {
          if (key === 'meta:revision' && typeof value === 'string') {
            pendingRevisions.set(tx, value)
          }
          return pendingRequest('saved-key')
        }),
      } as unknown as IDBObjectStore

      transactions.push(tx)
      return tx
    }),
  }
  const indexedDB = {
    open: vi.fn(() => {
      const request = {
        error: null,
        result: database,
      } as unknown as IDBOpenDBRequest

      queueMicrotask(() => request.onsuccess?.(new Event('success')))
      return request
    }),
  } as unknown as IDBFactory

  return {
    indexedDB,
    releaseTransaction: (index, error) => {
      const tx = transactions[index]

      if (!tx) {
        throw new Error(`Missing controlled transaction ${index}.`)
      }

      tx.error = error ?? null
      queueMicrotask(() => {
        if (error) {
          tx.onerror?.(new Event('error'))
          return
        }

        committedRevision = pendingRevisions.get(tx) ?? committedRevision
        tx.oncomplete?.(new Event('complete'))
      })
    },
    transactionCount: () => transactions.length,
  }
}

describe('local secret storage', () => {
  beforeAll(async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')
  })

  beforeEach(() => {
    vi.stubGlobal('indexedDB', createIndexedDbMock())
    vi.stubGlobal('localStorage', createStorageMock())
    vi.stubGlobal('sessionStorage', createStorageMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps recovery behind the active provider transition owner', async () => {
    const records = new Map<string, unknown>()
    const oldData = transitionAppData(1)
    const targetData = transitionAppData(2)
    const databaseOptions: IndexedDbMockOptions = {
      appRecord: oldData,
      secretRecords: records,
    }
    const lockHarness = createExclusiveLockHarness()
    vi.stubGlobal('indexedDB', createIndexedDbMock(databaseOptions))
    await setProviderKey('provider-a', 'old-key')
    vi.stubGlobal('navigator', { locks: lockHarness.locks })
    const enteredPersist = deferred<void>()
    const releasePersist = deferred<void>()
    const committing = commitProviderSecretSnapshotWithAppData(
      { 'provider-a': 'old-key' },
      { 'provider-a': 'new-key' },
      targetData,
      async (snapshot) => {
        enteredPersist.resolve(undefined)
        await releasePersist.promise
        databaseOptions.appRecord = snapshot
        return snapshot
      },
    )

    await enteredPersist.promise
    const recovering = recoverPendingProviderSecretAppDataTransition()
    let recoverySettled = false
    void recovering.then(
      () => {
        recoverySettled = true
      },
      () => {
        recoverySettled = true
      },
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(recoverySettled).toBe(false)
    expect(lockHarness.requests).toEqual([
      'zerochat:secret-app-data-transition',
      'zerochat:secret-app-data-transition',
    ])
    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(true)
    const staged = records.get('secret:provider:provider-a')
    expect(isLocalEncryptedRecord(staged)).toBe(true)
    await expect(
      decryptLocalString(
        'provider:provider-a',
        staged as Parameters<typeof decryptLocalString>[1],
      ),
    ).resolves.toBe('new-key')

    releasePersist.resolve(undefined)
    await expect(committing).resolves.toBe(targetData)
    await expect(recovering).resolves.toBeUndefined()

    const committed = records.get('secret:provider:provider-a')
    expect(isLocalEncryptedRecord(committed)).toBe(true)
    await expect(
      decryptLocalString(
        'provider:provider-a',
        committed as Parameters<typeof decryptLocalString>[1],
      ),
    ).resolves.toBe('new-key')
    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(false)
  })

  it('restores previous provider secrets after an interrupted AppData transition', async () => {
    const records = new Map<string, unknown>()
    const oldData = transitionAppData(1)
    const targetData = transitionAppData(2)
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ appRecord: oldData, secretRecords: records }),
    )
    await setProviderKey('provider-a', 'old-key')
    const enteredPersist = deferred<void>()
    const pendingPersist = deferred<AppData>()
    const committing = commitProviderSecretSnapshotWithAppData(
      { 'provider-a': 'old-key' },
      { 'provider-a': 'new-key' },
      targetData,
      () => {
        enteredPersist.resolve(undefined)
        return pendingPersist.promise
      },
    )

    await enteredPersist.promise
    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(true)

    await recoverPendingProviderSecretAppDataTransition()

    const restored = records.get('secret:provider:provider-a')
    expect(isLocalEncryptedRecord(restored)).toBe(true)
    await expect(
      decryptLocalString(
        'provider:provider-a',
        restored as Parameters<typeof decryptLocalString>[1],
      ),
    ).resolves.toBe('old-key')
    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(false)

    pendingPersist.reject(new Error('simulated process exit'))
    await expect(committing).rejects.toThrow('simulated process exit')
  })

  it('keeps staged provider secrets when recovery finds the target AppData committed', async () => {
    const records = new Map<string, unknown>()
    const targetData = transitionAppData(2)
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ appRecord: targetData, secretRecords: records }),
    )
    await setProviderKey('provider-a', 'old-key')
    const enteredPersist = deferred<void>()
    const pendingPersist = deferred<AppData>()
    const committing = commitProviderSecretSnapshotWithAppData(
      { 'provider-a': 'old-key' },
      { 'provider-a': 'new-key' },
      targetData,
      () => {
        enteredPersist.resolve(undefined)
        return pendingPersist.promise
      },
    )

    await enteredPersist.promise
    await recoverPendingProviderSecretAppDataTransition()

    const committed = records.get('secret:provider:provider-a')
    expect(isLocalEncryptedRecord(committed)).toBe(true)
    await expect(
      decryptLocalString(
        'provider:provider-a',
        committed as Parameters<typeof decryptLocalString>[1],
      ),
    ).resolves.toBe('new-key')
    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(false)

    pendingPersist.resolve(targetData)
    await expect(committing).resolves.toBe(targetData)
  })

  it('restores every secret after an interrupted full AppData transition', async () => {
    const records = new Map<string, unknown>()
    const oldData = transitionAppData(1)
    const targetData = transitionAppData(2)
    const previousSecrets = {
      providerKeys: { 'provider-a': 'old-key' },
      githubToken: 'old-token',
      syncPassphrase: 'old-passphrase',
    }
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ appRecord: oldData, secretRecords: records }),
    )
    await replaceZeroChatSecretSnapshot(previousSecrets)
    queueProviderSecretCleanupById(['deleted-provider'])
    const enteredPersist = deferred<void>()
    const pendingPersist = deferred<AppData>()
    const committing = commitZeroChatSecretSnapshotWithAppData(
      previousSecrets,
      { providerKeys: {}, githubToken: '', syncPassphrase: '' },
      targetData,
      () => {
        enteredPersist.resolve(undefined)
        return pendingPersist.promise
      },
    )

    await enteredPersist.promise
    expect(
      records.has('meta:pending-zerochat-app-data-transition'),
    ).toBe(true)

    await recoverPendingZeroChatSecretAppDataTransition()

    pendingPersist.reject(new Error('simulated process exit'))
    await expect(committing).rejects.toThrow('simulated process exit')

    await expect(loadZeroChatSecrets(['provider-a'])).resolves.toEqual({
      providerKeys: { 'provider-a': 'old-key' },
      githubToken: 'old-token',
    })
    await expect(getSyncPassphrase()).resolves.toBe('old-passphrase')
    expect(getPendingProviderSecretCleanupIds()).toEqual(['deleted-provider'])
    expect(
      records.has('meta:pending-zerochat-app-data-transition'),
    ).toBe(false)
  })

  it('keeps the full secret reset when recovery finds target AppData committed', async () => {
    const records = new Map<string, unknown>()
    const targetData = transitionAppData(2)
    const previousSecrets = {
      providerKeys: { 'provider-a': 'old-key' },
      githubToken: 'old-token',
      syncPassphrase: 'old-passphrase',
    }
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ appRecord: targetData, secretRecords: records }),
    )
    await replaceZeroChatSecretSnapshot(previousSecrets)
    queueProviderSecretCleanupById(['deleted-provider'])
    const enteredPersist = deferred<void>()
    const pendingPersist = deferred<AppData>()
    const committing = commitZeroChatSecretSnapshotWithAppData(
      previousSecrets,
      { providerKeys: {}, githubToken: '', syncPassphrase: '' },
      targetData,
      () => {
        enteredPersist.resolve(undefined)
        return pendingPersist.promise
      },
    )

    await enteredPersist.promise
    await recoverPendingZeroChatSecretAppDataTransition()

    pendingPersist.resolve(targetData)
    await expect(committing).resolves.toBe(targetData)

    await expect(loadZeroChatSecrets(['provider-a'])).resolves.toEqual({
      providerKeys: { 'provider-a': '' },
      githubToken: '',
    })
    await expect(getSyncPassphrase()).resolves.toBe('')
    expect(getPendingProviderSecretCleanupIds()).toEqual([])
    expect(
      records.has('meta:pending-zerochat-app-data-transition'),
    ).toBe(false)
  })

  it('keeps next secrets when AppData committed before persistence reported failure', async () => {
    const records = new Map<string, unknown>()
    const oldData = transitionAppData(1)
    const targetData = transitionAppData(2)
    const previousSecrets = {
      providerKeys: { 'provider-a': 'old-key' },
      githubToken: 'old-token',
      syncPassphrase: 'old-passphrase',
    }
    const databaseOptions: IndexedDbMockOptions = {
      appRecord: oldData,
      secretRecords: records,
    }
    vi.stubGlobal('indexedDB', createIndexedDbMock(databaseOptions))
    await replaceZeroChatSecretSnapshot(previousSecrets)

    await expect(
      commitZeroChatSecretSnapshotWithAppData(
        previousSecrets,
        { providerKeys: {}, githubToken: '', syncPassphrase: '' },
        targetData,
        async () => {
          databaseOptions.appRecord = targetData
          throw new Error('completion signal lost')
        },
      ),
    ).rejects.toThrow('completion signal lost')

    expect(
      records.has('meta:pending-zerochat-app-data-transition'),
    ).toBe(false)
    await expect(loadZeroChatSecrets(['provider-a'])).resolves.toEqual({
      providerKeys: { 'provider-a': '' },
      githubToken: '',
    })
    await expect(getSyncPassphrase()).resolves.toBe('')
  })

  it('rolls back provider secrets when persistence returns a different AppData snapshot', async () => {
    const records = new Map<string, unknown>()
    const oldData = transitionAppData(1)
    const targetData = transitionAppData(2)
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ appRecord: oldData, secretRecords: records }),
    )
    await setProviderKey('provider-a', 'old-key')

    await expect(
      commitProviderSecretSnapshotWithAppData(
        { 'provider-a': 'old-key' },
        { 'provider-a': 'new-key' },
        targetData,
        async () => transitionAppData(3),
      ),
    ).rejects.toBeInstanceOf(AppDataWriteConflictError)

    await expect(loadZeroChatSecrets(['provider-a'])).resolves.toEqual({
      providerKeys: { 'provider-a': 'old-key' },
      githubToken: '',
    })
    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(false)
  })

  it('preserves AppData write and durable-read failures with the recovery journal', async () => {
    const records = new Map<string, unknown>()
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        appRecord: transitionAppData(1),
        secretRecords: records,
        transactionError: new Error('app data read failed'),
        transactionErrorDatabaseName: 'zerochat',
      }),
    )
    await setProviderKey('provider-a', 'old-key')

    await expect(
      commitProviderSecretSnapshotWithAppData(
        { 'provider-a': 'old-key' },
        { 'provider-a': 'new-key' },
        transitionAppData(2),
        async () => {
          throw new Error('app data write failed')
        },
      ),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      message: rt('error.localCredentialCommitStateUnknown'),
      cause: expect.objectContaining({ message: 'app data read failed' }),
      errors: [
        expect.objectContaining({ message: 'app data write failed' }),
        expect.objectContaining({ message: 'app data read failed' }),
      ],
    })

    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(true)
    const staged = records.get('secret:provider:provider-a')
    expect(isLocalEncryptedRecord(staged)).toBe(true)
    await expect(
      decryptLocalString(
        'provider:provider-a',
        staged as Parameters<typeof decryptLocalString>[1],
      ),
    ).resolves.toBe('new-key')
  })

  it('fails closed on malformed provider and full secret transition journals', async () => {
    const fullSnapshot = {
      providerKeys: {},
      githubToken: '',
      syncPassphrase: '',
    }
    const cases = [
      {
        key: 'meta:pending-provider-app-data-transition',
        record: 'corrupted-provider-record',
        recover: recoverPendingProviderSecretAppDataTransition,
      },
      {
        key: 'meta:pending-provider-app-data-transition',
        record: {
          kind: 'zerochat.providerAppDataTransition',
          payload: await encryptLocalString(
            'provider-app-data-transition',
            'null',
          ),
          revision: 'revision-1',
          version: 1,
        },
        recover: recoverPendingProviderSecretAppDataTransition,
      },
      {
        key: 'meta:pending-provider-app-data-transition',
        record: {
          kind: 'zerochat.providerAppDataTransition',
          payload: await encryptLocalString(
            'provider-app-data-transition',
            JSON.stringify({
              nextProviderKeys: {},
              previousProviderKeys: [],
              targetAppData: '{}',
            }),
          ),
          revision: 'revision-1',
          version: 1,
        },
        recover: recoverPendingProviderSecretAppDataTransition,
      },
      {
        key: 'meta:pending-zerochat-app-data-transition',
        record: 'corrupted-full-record',
        recover: recoverPendingZeroChatSecretAppDataTransition,
      },
      {
        key: 'meta:pending-zerochat-app-data-transition',
        record: {
          kind: 'zerochat.zeroChatAppDataTransition',
          payload: await encryptLocalString(
            'zerochat-app-data-transition',
            'null',
          ),
          revision: 'revision-1',
          version: 1,
        },
        recover: recoverPendingZeroChatSecretAppDataTransition,
      },
      {
        key: 'meta:pending-zerochat-app-data-transition',
        record: {
          kind: 'zerochat.zeroChatAppDataTransition',
          payload: await encryptLocalString(
            'zerochat-app-data-transition',
            JSON.stringify({
              nextSecrets: fullSnapshot,
              previousSecrets: null,
              targetAppData: '{}',
            }),
          ),
          revision: 'revision-1',
          version: 1,
        },
        recover: recoverPendingZeroChatSecretAppDataTransition,
      },
    ]

    for (const testCase of cases) {
      const records = new Map<string, unknown>([
        ['meta:revision', 'revision-1'],
        [testCase.key, testCase.record],
      ])
      vi.stubGlobal(
        'indexedDB',
        createIndexedDbMock({ secretRecords: records }),
      )

      await expect(testCase.recover()).rejects.toThrow(
        rt('error.localSecretFormat'),
      )
      expect(records.has(testCase.key)).toBe(true)
    }
  })

  it('clears pending provider deletion tombstones during full secret wipe', async () => {
    queueProviderSecretCleanupById(['deleted-provider'])

    expect(getPendingProviderSecretCleanupIds()).toEqual(['deleted-provider'])

    await clearZeroChatSecrets()

    expect(getPendingProviderSecretCleanupIds()).toEqual([])
  })

  it('removes selected pending provider cleanup ids without disturbing others', () => {
    queueProviderSecretCleanupById([
      'provider-a',
      'provider-b',
      'provider-a',
      '',
    ])

    expect(getPendingProviderSecretCleanupIds()).toEqual([
      'provider-a',
      'provider-b',
    ])

    clearPendingProviderSecretCleanupById([])
    clearPendingProviderSecretCleanupById(['provider-a', 'missing-provider'])
    expect(getPendingProviderSecretCleanupIds()).toEqual(['provider-b'])

    clearPendingProviderSecretCleanupById(['provider-b'])
    expect(getPendingProviderSecretCleanupIds()).toEqual([])
    expect(localStorage.getItem(pendingProviderSecretCleanupKey)).toBeNull()
  })

  it('clears every provider secret while preserving sync credentials', async () => {
    const records = new Map<string, unknown>()
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ secretRecords: records }),
    )
    localStorage.setItem(
      'zerochat:secret:provider:provider-a',
      'legacy-provider-key',
    )
    localStorage.setItem(
      'zerochat:secret:proxy:provider-a',
      'legacy-proxy-key',
    )
    await setGithubToken('  github-token  ')
    await setSyncPassphrase('sync-passphrase')
    queueProviderSecretCleanupById(['provider-a'])

    await clearProviderSecrets()

    await expect(loadZeroChatSecrets(['provider-a'])).resolves.toEqual({
      providerKeys: { 'provider-a': '' },
      githubToken: 'github-token',
    })
    await expect(getSyncPassphrase()).resolves.toBe('sync-passphrase')
    expect(getPendingProviderSecretCleanupIds()).toEqual([])
    expect(
      records.get('secret:provider:provider-a'),
    ).toEqual({ kind: 'zerochat.secretDeleted', version: 1 })
    expect(
      records.get('secret:proxy:provider-a'),
    ).toEqual({ kind: 'zerochat.secretDeleted', version: 1 })
  })

  it('clears the complete secret store with one atomic transaction', async () => {
    const indexedDb = createIndexedDbMock()
    vi.stubGlobal('indexedDB', indexedDb)

    await clearZeroChatSecrets()

    const openMock = vi.mocked(indexedDb.open).mock
    const secretDatabaseOpenIndex = openMock.calls.findIndex(
      ([databaseName]) => databaseName === 'zerochat-secrets',
    )
    const openRequest = openMock.results[secretDatabaseOpenIndex]
      ?.value as IDBOpenDBRequest
    const transaction = vi.mocked(openRequest.result.transaction)
    const tx = transaction.mock.results[0]?.value as IDBTransaction
    const store = tx.objectStore('records')

    expect(transaction).toHaveBeenCalledWith('records', 'readwrite')
    expect(store.clear).toHaveBeenCalledTimes(1)
    expect(store.getAllKeys).toHaveBeenCalledTimes(1)
    expect(store.delete).not.toHaveBeenCalled()
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:github-token',
    )
  })

  it('preserves secret operation and abort failures when the transaction state is unknown', async () => {
    const operationError = new Error('secret clear failed')
    const abortError = new Error('secret abort failed')
    const mock = createSecretIndexedDbMockWithAbortFailure(
      operationError,
      abortError,
    )
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(
      replaceZeroChatSecretSnapshot({
        providerKeys: {},
        githubToken: '',
        syncPassphrase: '',
      }),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      cause: abortError,
      errors: [operationError, abortError],
    })

    expect(mock.abort).toHaveBeenCalledTimes(1)
    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('keeps a full secret wipe committed when legacy cleanup fails', async () => {
    const indexedDb = createIndexedDbMock()
    const storage = createStorageMock()
    storage.setItem(
      'zerochat:secret:provider:legacy-provider',
      'legacy-secret',
    )
    storage.removeItem = vi.fn(() => {
      throw new Error('legacy storage blocked')
    })
    vi.stubGlobal('indexedDB', indexedDb)
    vi.stubGlobal('localStorage', storage)

    await expect(clearZeroChatSecrets()).resolves.toEqual(expect.any(String))

    const openRequest = vi.mocked(indexedDb.open).mock.results[0]
      ?.value as IDBOpenDBRequest
    const transaction = vi.mocked(openRequest.result.transaction)
    const tx = transaction.mock.results[0]?.value as IDBTransaction
    const store = tx.objectStore('records')

    expect(store.clear).toHaveBeenCalledTimes(1)
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:provider:legacy-provider',
    )
    await expect(getSyncPassphrase()).resolves.toBe('')
  })

  it('replaces the complete provider secret snapshot in one atomic transaction', async () => {
    const indexedDb = createIndexedDbMock({
      allKeys: [
        'secret:provider:old-provider',
        'secret:proxy:old-provider',
        'secret:github-token',
      ],
    })
    vi.stubGlobal('indexedDB', indexedDb)

    await replaceProviderSecretSnapshot({
      'provider-a': '  new-secret  ',
      'provider-empty': '  ',
    })

    const openMock = vi.mocked(indexedDb.open).mock
    const secretDatabaseOpenIndex = openMock.calls.findIndex(
      ([databaseName]) => databaseName === 'zerochat-secrets',
    )
    const openRequest = openMock.results[secretDatabaseOpenIndex]
      ?.value as IDBOpenDBRequest
    const transaction = vi.mocked(openRequest.result.transaction)
    const tx = transaction.mock.results[0]?.value as IDBTransaction
    const store = tx.objectStore('records')

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction).toHaveBeenCalledWith('records', 'readwrite')
    expect(store.getAllKeys).toHaveBeenCalledTimes(1)
    expect(store.delete).not.toHaveBeenCalled()
    expect(store.put).toHaveBeenCalledTimes(4)
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:provider:old-provider',
    )
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:proxy:old-provider',
    )
    expect(store.put).toHaveBeenCalledWith(
      expect.any(Object),
      'secret:provider:provider-a',
    )
    expect(store.put).toHaveBeenCalledWith(
      expect.any(String),
      'meta:revision',
    )
  })

  it('keeps committed provider writes successful when legacy cleanup fails', async () => {
    const storage = createStorageMock()
    storage.setItem(
      'zerochat:secret:provider:provider-a',
      'legacy-secret',
    )
    storage.removeItem = vi.fn(() => {
      throw new Error('legacy storage blocked')
    })
    vi.stubGlobal('localStorage', storage)

    await expect(
      setProviderKey('provider-a', 'canonical-secret'),
    ).resolves.toBeUndefined()
  })

  it('writes a canonical deletion tombstone instead of exposing legacy fallback', async () => {
    const indexedDb = createIndexedDbMock()
    vi.stubGlobal('indexedDB', indexedDb)

    await setProviderKey('provider-a', '')

    const openMock = vi.mocked(indexedDb.open).mock
    const secretDatabaseOpenIndex = openMock.calls.findIndex(
      ([databaseName]) => databaseName === 'zerochat-secrets',
    )
    const openRequest = openMock.results[secretDatabaseOpenIndex]
      ?.value as IDBOpenDBRequest
    const transaction = vi.mocked(openRequest.result.transaction)
    const tx = transaction.mock.results[0]?.value as IDBTransaction
    const store = tx.objectStore('records')

    expect(store.delete).not.toHaveBeenCalled()
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:provider:provider-a',
    )
  })

  it('keeps canonical deletion tombstones authoritative over stale legacy values', async () => {
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        secretRecords: new Map([
          [
            'secret:provider:provider-a',
            {
              kind: 'zerochat.secretDeleted',
              version: 1,
            },
          ],
        ]),
      }),
    )
    localStorage.setItem(
      'zerochat:secret:provider:provider-a',
      'stale-legacy-secret',
    )

    const secrets = await loadZeroChatSecrets(['provider-a'])

    expect(secrets.providerKeys['provider-a']).toBe('')
    expect(localStorage.getItem(
      'zerochat:secret:provider:provider-a',
    )).toBe('stale-legacy-secret')
  })

  it('keeps provider snapshot replacement committed when legacy cleanup fails', async () => {
    const storage = createStorageMock()
    storage.setItem(
      'zerochat:secret:provider:legacy-provider',
      'legacy-secret',
    )
    storage.removeItem = vi.fn(() => {
      throw new Error('legacy storage blocked')
    })
    vi.stubGlobal('localStorage', storage)

    await expect(
      replaceProviderSecretSnapshot({
        'provider-a': 'canonical-secret',
      }),
    ).resolves.toBeUndefined()
  })

  it('replaces the complete ZeroChat secret snapshot in one atomic transaction', async () => {
    const indexedDb = createIndexedDbMock({
      allKeys: [
        'secret:provider:old-provider',
        'secret:proxy:old-provider',
        'secret:github-token',
      ],
    })
    vi.stubGlobal('indexedDB', indexedDb)
    await setSyncPassphrase('old-passphrase')

    await replaceZeroChatSecretSnapshot({
      providerKeys: {
        'provider-a': '  provider-secret  ',
        'provider-empty': '  ',
      },
      githubToken: '  github-secret  ',
      syncPassphrase: 'new-passphrase',
    })

    const openMock = vi.mocked(indexedDb.open).mock
    const secretDatabaseOpenIndex = openMock.calls.findIndex(
      ([databaseName]) => databaseName === 'zerochat-secrets',
    )
    const openRequest = openMock.results[secretDatabaseOpenIndex]
      ?.value as IDBOpenDBRequest
    const transaction = vi.mocked(openRequest.result.transaction)
    const tx = transaction.mock.results[0]?.value as IDBTransaction
    const store = tx.objectStore('records')

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(store.getAllKeys).toHaveBeenCalledTimes(1)
    expect(store.clear).toHaveBeenCalledTimes(1)
    expect(store.delete).not.toHaveBeenCalled()
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:provider:old-provider',
    )
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:proxy:old-provider',
    )
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:provider:provider-empty',
    )
    expect(store.put).toHaveBeenCalledWith(
      expect.any(Object),
      'secret:provider:provider-a',
    )
    expect(store.put).toHaveBeenCalledWith(
      expect.any(Object),
      'secret:github-token',
    )
    expect(store.put).toHaveBeenCalledWith(
      expect.any(String),
      'meta:revision',
    )
    await expect(getSyncPassphrase()).resolves.toBe('new-passphrase')
  })

  it('rejects a stale provider write without replacing the cross-tab winner', async () => {
    const records = new Map<string, unknown>([
      ['meta:revision', 'revision-a'],
    ])
    vi.stubGlobal('indexedDB', createIndexedDbMock({ secretRecords: records }))

    await loadZeroChatSecrets([])
    records.set('meta:revision', 'revision-b')

    await expect(
      setProviderKey('provider-a', 'stale-secret'),
    ).rejects.toBeInstanceOf(AppDataWriteConflictError)

    expect(records.get('meta:revision')).toBe('revision-b')
    expect(records.has('secret:provider:provider-a')).toBe(false)
  })

  it('rejects a stale complete snapshot without clearing the cross-tab winner', async () => {
    const winnerRecord = { winner: true }
    const records = new Map<string, unknown>([
      ['meta:revision', 'revision-a'],
    ])
    vi.stubGlobal('indexedDB', createIndexedDbMock({ secretRecords: records }))
    await setSyncPassphrase('winner-passphrase')

    await loadZeroChatSecrets([])
    records.set('meta:revision', 'revision-b')
    records.set('secret:github-token', winnerRecord)

    await expect(
      replaceZeroChatSecretSnapshot({
        providerKeys: { 'provider-a': 'stale-provider-secret' },
        githubToken: 'stale-github-secret',
        syncPassphrase: 'stale-passphrase',
      }),
    ).rejects.toBeInstanceOf(AppDataWriteConflictError)

    expect(records.get('meta:revision')).toBe('revision-b')
    expect(records.get('secret:github-token')).toBe(winnerRecord)
    expect(records.has('secret:provider:provider-a')).toBe(false)
    await expect(getSyncPassphrase()).resolves.toBe('winner-passphrase')
  })

  it('refuses reset compensation after a newer secret mutation wins', async () => {
    const records = new Map<string, unknown>()
    vi.stubGlobal('indexedDB', createIndexedDbMock({ secretRecords: records }))

    const wipeRevision = await clearZeroChatSecrets()
    await setProviderKey('winner-provider', 'winner-secret')
    await setSyncPassphrase('winner-passphrase')
    const winnerRevision = records.get('meta:revision')
    const winnerRecord = records.get('secret:provider:winner-provider')

    await expect(
      restoreZeroChatSecretSnapshot(
        {
          providerKeys: { 'stale-provider': 'stale-secret' },
          githubToken: 'stale-github-secret',
          syncPassphrase: 'stale-passphrase',
        },
        wipeRevision,
      ),
    ).rejects.toBeInstanceOf(AppDataWriteConflictError)

    expect(records.get('meta:revision')).toBe(winnerRevision)
    expect(records.get('secret:provider:winner-provider')).toBe(winnerRecord)
    expect(records.has('secret:provider:stale-provider')).toBe(false)
    await expect(getSyncPassphrase()).resolves.toBe('winner-passphrase')
  })

  it('retries hydration when the secret-store revision changes mid-read', async () => {
    const records = new Map<string, unknown>([
      ['meta:revision', 'revision-a'],
    ])
    let revisionReadCount = 0
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        onSecretGet: (key, currentRecords) => {
          if (key !== 'meta:revision') {
            return
          }

          revisionReadCount += 1
          if (revisionReadCount === 4) {
            currentRecords.set('meta:revision', 'revision-b')
          }
        },
        secretRecords: records,
      }),
    )

    await expect(loadZeroChatSecrets([])).resolves.toEqual({
      providerKeys: {},
      githubToken: '',
    })
    expect(revisionReadCount).toBe(6)
  })

  it('fails closed when the canonical secret-store revision is corrupted', async () => {
    const records = new Map<string, unknown>([
      ['meta:revision', { corrupted: true }],
    ])
    vi.stubGlobal('indexedDB', createIndexedDbMock({ secretRecords: records }))

    await expect(loadZeroChatSecrets([])).rejects.toThrow(
      rt('error.localSecretFormat'),
    )
  })

  it('restores the previous passphrase when complete secret replacement fails', async () => {
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        transactionError: new Error('snapshot transaction failed'),
        transactionErrorDatabaseName: 'zerochat-secrets',
      }),
    )
    await setSyncPassphrase('old-passphrase')

    await expect(
      replaceZeroChatSecretSnapshot({
        providerKeys: { 'provider-a': 'provider-secret' },
        githubToken: 'github-secret',
        syncPassphrase: 'new-passphrase',
      }),
    ).rejects.toThrow('snapshot transaction failed')

    await expect(getSyncPassphrase()).resolves.toBe('old-passphrase')
  })

  it('fails closed when complete secret replacement cannot restore the previous passphrase', async () => {
    await setSyncPassphrase('old-passphrase')
    const setItem = sessionStorage.setItem.bind(sessionStorage)
    sessionStorage.setItem = vi.fn((key: string, value: string) => {
      if (key === syncPassphraseKey && value === 'old-passphrase') {
        throw new Error('passphrase restore blocked')
      }
      setItem(key, value)
    })
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        transactionError: new Error('snapshot transaction failed'),
        transactionErrorDatabaseName: 'zerochat-secrets',
      }),
    )

    await expect(
      replaceZeroChatSecretSnapshot({
        providerKeys: { 'provider-a': 'provider-secret' },
        githubToken: 'github-secret',
        syncPassphrase: 'new-passphrase',
      }),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      message: rt('error.localCredentialRollbackFailed'),
      cause: expect.objectContaining({ message: 'passphrase restore blocked' }),
      errors: [
        expect.objectContaining({ message: 'snapshot transaction failed' }),
        expect.objectContaining({ message: 'passphrase restore blocked' }),
      ],
    })

    expect(sessionStorage.getItem(syncPassphraseKey)).toBeNull()
    expect(localStorage.getItem(syncPassphraseKey)).toBe('')
  })

  it('overwrites the uncommitted passphrase when session removal fails during compensation', async () => {
    await setSyncPassphrase('old-passphrase')
    const setItem = sessionStorage.setItem.bind(sessionStorage)
    const removeItem = sessionStorage.removeItem.bind(sessionStorage)
    sessionStorage.setItem = vi.fn((key: string, value: string) => {
      if (key === syncPassphraseKey && value === 'old-passphrase') {
        throw new Error('passphrase restore blocked')
      }
      setItem(key, value)
    })
    sessionStorage.removeItem = vi.fn((key: string) => {
      if (key === syncPassphraseKey) {
        throw new Error('passphrase removal blocked')
      }
      removeItem(key)
    })
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        transactionError: new Error('snapshot transaction failed'),
        transactionErrorDatabaseName: 'zerochat-secrets',
      }),
    )

    await expect(
      replaceZeroChatSecretSnapshot({
        providerKeys: { 'provider-a': 'provider-secret' },
        githubToken: 'github-secret',
        syncPassphrase: 'new-passphrase',
      }),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      message: rt('error.localCredentialRollbackFailed'),
      cause: expect.objectContaining({ message: 'passphrase restore blocked' }),
      errors: [
        expect.objectContaining({ message: 'snapshot transaction failed' }),
        expect.objectContaining({ message: 'passphrase restore blocked' }),
        expect.objectContaining({ message: 'passphrase removal blocked' }),
      ],
    })

    expect(sessionStorage.getItem(syncPassphraseKey)).toBe('')
    expect(localStorage.getItem(syncPassphraseKey)).toBe('')
  })

  it('preserves every cause when the uncommitted session passphrase cannot be cleared', async () => {
    await setSyncPassphrase('old-passphrase')
    const setItem = sessionStorage.setItem.bind(sessionStorage)
    sessionStorage.setItem = vi.fn((key: string, value: string) => {
      if (
        key === syncPassphraseKey &&
        (value === 'old-passphrase' || value === '')
      ) {
        throw new Error(
          value === '' ? 'passphrase overwrite blocked' : 'passphrase restore blocked',
        )
      }
      setItem(key, value)
    })
    sessionStorage.removeItem = vi.fn((key: string) => {
      if (key === syncPassphraseKey) {
        throw new Error('passphrase removal blocked')
      }
    })
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        transactionError: new Error('snapshot transaction failed'),
        transactionErrorDatabaseName: 'zerochat-secrets',
      }),
    )

    await expect(
      replaceZeroChatSecretSnapshot({
        providerKeys: { 'provider-a': 'provider-secret' },
        githubToken: 'github-secret',
        syncPassphrase: 'new-passphrase',
      }),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      message: expect.stringContaining('Close this ZeroChat tab or window'),
      cause: expect.objectContaining({ message: 'passphrase restore blocked' }),
      errors: [
        expect.objectContaining({ message: 'snapshot transaction failed' }),
        expect.objectContaining({ message: 'passphrase restore blocked' }),
        expect.objectContaining({ message: 'passphrase removal blocked' }),
        expect.objectContaining({ message: 'passphrase overwrite blocked' }),
      ],
    })

    expect(sessionStorage.getItem(syncPassphraseKey)).toBe('new-passphrase')
    expect(localStorage.getItem(syncPassphraseKey)).toBe('')
  })

  it('fails closed when AppData transition staging cannot restore the previous passphrase', async () => {
    await setSyncPassphrase('old-passphrase')
    const setItem = sessionStorage.setItem.bind(sessionStorage)
    sessionStorage.setItem = vi.fn((key: string, value: string) => {
      if (key === syncPassphraseKey && value === 'old-passphrase') {
        throw new Error('transition passphrase restore blocked')
      }
      setItem(key, value)
    })
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        appRecord: transitionAppData(1),
        transactionError: new Error('transition staging failed'),
        transactionErrorDatabaseName: 'zerochat-secrets',
      }),
    )
    const persistAppData = vi.fn(async (snapshot: AppData) => snapshot)

    await expect(
      commitZeroChatSecretSnapshotWithAppData(
        {
          providerKeys: { 'provider-a': 'old-key' },
          githubToken: 'old-token',
          syncPassphrase: 'old-passphrase',
        },
        {
          providerKeys: { 'provider-a': 'new-key' },
          githubToken: 'new-token',
          syncPassphrase: 'new-passphrase',
        },
        transitionAppData(2),
        persistAppData,
      ),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      message: rt('error.localCredentialRollbackFailed'),
      cause: expect.objectContaining({
        message: 'transition passphrase restore blocked',
      }),
      errors: [
        expect.objectContaining({ message: 'transition staging failed' }),
        expect.objectContaining({
          message: 'transition passphrase restore blocked',
        }),
      ],
    })

    expect(persistAppData).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(syncPassphraseKey)).toBeNull()
    expect(localStorage.getItem(syncPassphraseKey)).toBe('')
  })

  it('keeps complete secret replacement committed when legacy cleanup fails', async () => {
    const storage = createStorageMock()
    storage.setItem(
      'zerochat:secret:provider:legacy-provider',
      'legacy-secret',
    )
    storage.removeItem = vi.fn(() => {
      throw new Error('legacy storage blocked')
    })
    vi.stubGlobal('localStorage', storage)

    await expect(
      replaceZeroChatSecretSnapshot({
        providerKeys: { 'provider-a': 'provider-secret' },
        githubToken: 'github-secret',
        syncPassphrase: 'sync-passphrase',
      }),
    ).resolves.toBeUndefined()

    await expect(getSyncPassphrase()).resolves.toBe('sync-passphrase')
  })

  it('uses an empty session value as an authoritative passphrase tombstone', async () => {
    localStorage.setItem(
      'zerochat:secret:sync-passphrase',
      'stale-legacy-passphrase',
    )

    await setSyncPassphrase('')

    await expect(getSyncPassphrase()).resolves.toBe('')
    expect(sessionStorage.getItem(
      'zerochat:secret:sync-passphrase',
    )).toBe('')
    expect(localStorage.getItem(
      'zerochat:secret:sync-passphrase',
    )).toBe('')
  })

  it('loads reserved provider ids as own secret-map properties', async () => {
    localStorage.setItem(
      'zerochat:secret:provider:__proto__',
      'reserved-provider-key',
    )

    const secrets = await loadZeroChatSecrets(['__proto__'])

    expect(Object.hasOwn(secrets.providerKeys, '__proto__')).toBe(true)
    expect(secrets.providerKeys['__proto__']).toBe('reserved-provider-key')
  })

  it('clears provider and proxy secrets for ids containing colons', async () => {
    const providerSecretKey =
      'zerochat:secret:provider:custom:provider'
    const proxySecretKey = 'zerochat:secret:proxy:custom:provider'
    localStorage.setItem(providerSecretKey, 'provider-key')
    localStorage.setItem(proxySecretKey, 'proxy-key')

    await clearProviderSecretsById(['custom:provider'])

    expect(localStorage.getItem(providerSecretKey)).toBeNull()
    expect(localStorage.getItem(proxySecretKey)).toBeNull()
  })

  it('clears scoped provider secrets in one atomic transaction', async () => {
    const indexedDb = createIndexedDbMock({
      allKeys: [
        'secret:provider:target',
        'secret:proxy:target',
        'secret:provider:other',
      ],
    })
    vi.stubGlobal('indexedDB', indexedDb)

    await clearProviderSecretsById(['target'])

    const openRequest = vi.mocked(indexedDb.open).mock.results[0]
      ?.value as IDBOpenDBRequest
    const transaction = vi.mocked(openRequest.result.transaction)
    const tx = transaction.mock.results[0]?.value as IDBTransaction
    const store = tx.objectStore('records')

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction).toHaveBeenCalledWith('records', 'readwrite')
    expect(store.getAllKeys).toHaveBeenCalledTimes(1)
    expect(store.delete).not.toHaveBeenCalled()
    expect(store.put).toHaveBeenCalledTimes(3)
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:provider:target',
    )
    expect(store.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.secretDeleted',
        version: 1,
      },
      'secret:proxy:target',
    )
    expect(store.put).toHaveBeenCalledWith(
      expect.any(String),
      'meta:revision',
    )
    expect(store.put).not.toHaveBeenCalledWith(
      expect.anything(),
      'secret:provider:other',
    )
  })

  it('rejects corrupted pending provider deletion tombstones instead of dropping cleanup', () => {
    const corruptedQueues = [
      '{bad-json',
      '{}',
      '42',
      '[""]',
      '[null,"deleted-provider"]',
    ]

    for (const corruptedQueue of corruptedQueues) {
      localStorage.setItem(pendingProviderSecretCleanupKey, corruptedQueue)

      expect(() => getPendingProviderSecretCleanupIds()).toThrow(
        rt('error.pendingProviderSecretCleanupFormat'),
      )
      expect(() => queueProviderSecretCleanupById(['next-provider'])).toThrow(
        rt('error.pendingProviderSecretCleanupFormat'),
      )
      expect(localStorage.getItem(pendingProviderSecretCleanupKey)).toBe(
        corruptedQueue,
      )
    }
  })

  it('waits for secret IndexedDB transaction completion before reporting success', async () => {
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        transactionError: new Error('transaction commit failed'),
        transactionErrorDatabaseName: 'zerochat-secrets',
      }),
    )

    await expect(setProviderKey('provider-a', 'secret')).rejects.toThrow(
      'transaction commit failed',
    )
  })

  it('serializes provider secret writes before starting a newer mutation', async () => {
    const controlled = createControlledIndexedDbMock()
    vi.stubGlobal('indexedDB', controlled.indexedDB)

    const first = setProviderKey('provider-a', 'older-secret')
    await vi.waitFor(() => expect(controlled.transactionCount()).toBe(1))

    const second = setProviderKey('provider-a', 'newer-secret')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controlled.transactionCount()).toBe(1)

    controlled.releaseTransaction(0)
    await first
    await vi.waitFor(() => expect(controlled.transactionCount()).toBe(2))

    controlled.releaseTransaction(1)
    await second
  })

  it('serializes provider cleanup behind pending secret writes', async () => {
    const controlled = createControlledIndexedDbMock()
    vi.stubGlobal('indexedDB', controlled.indexedDB)

    const write = setProviderKey('provider-a', 'secret')
    await vi.waitFor(() => expect(controlled.transactionCount()).toBe(1))

    const cleanup = clearProviderSecretsById(['provider-a'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controlled.transactionCount()).toBe(1)

    controlled.releaseTransaction(0)
    await write
    await vi.waitFor(() => expect(controlled.transactionCount()).toBe(2))

    controlled.releaseTransaction(1)
    await cleanup
  })

  it('continues serialized secret mutations after an earlier failure', async () => {
    const controlled = createControlledIndexedDbMock()
    vi.stubGlobal('indexedDB', controlled.indexedDB)

    const failed = setProviderKey('provider-a', 'failed-secret')
    await vi.waitFor(() => expect(controlled.transactionCount()).toBe(1))
    const recovered = setProviderKey('provider-a', 'recovered-secret')

    controlled.releaseTransaction(0, new Error('first write failed'))
    await expect(failed).rejects.toThrow('first write failed')
    await vi.waitFor(() => expect(controlled.transactionCount()).toBe(2))

    controlled.releaseTransaction(1)
    await recovered
  })

  it('closes the secret database when transaction construction throws', async () => {
    const mock = createIndexedDbMockWithThrowingTransaction(
      'zerochat-secrets',
      new Error('secret transaction failed'),
    )
    vi.stubGlobal('indexedDB', mock.indexedDB)
    await setSyncPassphrase('keep-me')

    await expect(clearZeroChatSecrets()).rejects.toThrow(
      'secret transaction failed',
    )
    expect(mock.close).toHaveBeenCalledTimes(1)
    await expect(getSyncPassphrase()).resolves.toBe('keep-me')
  })

  it('fails closed on the Windows origin when the native bridge is absent', async () => {
    localStorage.setItem(
      'zerochat:secret:provider:provider-a',
      'browser-only-value',
    )
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      location: { origin: WINDOWS_WEBVIEW_ORIGIN },
      setTimeout: globalThis.setTimeout.bind(globalThis),
    })

    await expect(loadZeroChatSecrets(['provider-a'])).rejects.toMatchObject({
      code: 'bridge-unavailable',
    })
    expect(localStorage.getItem(
      'zerochat:secret:provider:provider-a',
    )).toBe('browser-only-value')
  })

  it('writes, replaces, and revision-restores complete Windows Locker snapshots', async () => {
    const bridge = createWindowsSecretBridgeHarness({
      migrationState: 'complete',
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)
    await loadZeroChatSecrets([])

    await setProviderKey('provider-a', '  provider-key  ')
    await setGithubToken('  github-token  ')
    await setSyncPassphrase('  sync passphrase  ')

    expect(bridge.entries).toEqual(new Map([
      ['provider:provider-a', 'provider-key'],
      ['github-token', 'github-token'],
      ['sync-passphrase', '  sync passphrase  '],
    ]))
    await expect(getSyncPassphrase()).resolves.toBe('  sync passphrase  ')

    await replaceProviderSecretSnapshot({
      'provider-b': '  replacement-key  ',
      'provider-empty': '  ',
    })
    expect(bridge.entries).toEqual(new Map([
      ['github-token', 'github-token'],
      ['sync-passphrase', '  sync passphrase  '],
      ['provider:provider-b', 'replacement-key'],
    ]))

    await replaceZeroChatSecretSnapshot({
      providerKeys: { 'provider-c': 'current-key' },
      githubToken: 'current-token',
      syncPassphrase: 'current-passphrase',
    })
    const currentRevision = bridge.revision
    expect(currentRevision).toEqual(expect.any(String))

    await restoreZeroChatSecretSnapshot({
      providerKeys: { 'provider-restored': 'restored-key' },
      githubToken: 'restored-token',
      syncPassphrase: 'restored-passphrase',
    }, currentRevision as string)

    expect(bridge.entries).toEqual(new Map([
      ['provider:provider-restored', 'restored-key'],
      ['github-token', 'restored-token'],
      ['sync-passphrase', 'restored-passphrase'],
    ]))
  })

  it('keeps non-provider Windows Locker credentials across scoped cleanup', async () => {
    const bridge = createWindowsSecretBridgeHarness({
      entries: new Map([
        ['provider:provider-a', 'provider-a-key'],
        ['proxy:provider-a', 'provider-a-proxy'],
        ['provider:provider-b', 'provider-b-key'],
        ['github-token', 'github-token'],
        ['sync-passphrase', 'sync-passphrase'],
      ]),
      migrationState: 'complete',
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)
    await loadZeroChatSecrets(['provider-a', 'provider-b'])
    queueProviderSecretCleanupById(['provider-b'])

    const mutationCount = () => bridge.requests.filter(
      ({ op }) => op === 'mutate',
    ).length
    const beforeEmptyCleanup = mutationCount()
    await clearProviderSecretsById([])
    expect(mutationCount()).toBe(beforeEmptyCleanup)

    await clearProviderSecretsById(['provider-a'])
    expect(bridge.entries).toEqual(new Map([
      ['provider:provider-b', 'provider-b-key'],
      ['github-token', 'github-token'],
      ['sync-passphrase', 'sync-passphrase'],
    ]))

    await clearProviderSecrets()
    expect(bridge.entries).toEqual(new Map([
      ['github-token', 'github-token'],
      ['sync-passphrase', 'sync-passphrase'],
    ]))
    expect(getPendingProviderSecretCleanupIds()).toEqual([])

    await expect(clearZeroChatSecrets()).resolves.toEqual(expect.any(String))
    expect(bridge.entries.size).toBe(0)
  })

  it('restores Windows Locker provider keys after an interrupted AppData transition', async () => {
    const records = new Map<string, unknown>()
    const oldData = transitionAppData(1)
    const targetData = transitionAppData(2)
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ appRecord: oldData, secretRecords: records }),
    )
    const bridge = createWindowsSecretBridgeHarness({
      entries: new Map([
        ['provider:provider-a', 'old-key'],
        ['github-token', 'github-token'],
        ['sync-passphrase', 'sync-passphrase'],
      ]),
      migrationState: 'complete',
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)
    await loadZeroChatSecrets(['provider-a'])
    const enteredPersist = deferred<void>()
    const pendingPersist = deferred<AppData>()
    const committing = commitProviderSecretSnapshotWithAppData(
      { 'provider-a': 'old-key' },
      { 'provider-a': 'new-key' },
      targetData,
      () => {
        enteredPersist.resolve(undefined)
        return pendingPersist.promise
      },
    )

    await enteredPersist.promise
    expect(bridge.entries.get('provider:provider-a')).toBe('new-key')
    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(true)

    await recoverPendingProviderSecretAppDataTransition()

    expect(bridge.entries).toEqual(new Map([
      ['github-token', 'github-token'],
      ['sync-passphrase', 'sync-passphrase'],
      ['provider:provider-a', 'old-key'],
    ]))
    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(false)

    pendingPersist.reject(new Error('simulated WebView process exit'))
    await expect(committing).rejects.toThrow('simulated WebView process exit')
  })

  it('restores Windows Locker secrets when full reset AppData is not committed', async () => {
    const records = new Map<string, unknown>()
    const oldData = transitionAppData(1)
    const targetData = transitionAppData(2)
    const previousSecrets = {
      providerKeys: { 'provider-a': 'old-key' },
      githubToken: 'old-token',
      syncPassphrase: 'old-passphrase',
    }
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ appRecord: oldData, secretRecords: records }),
    )
    const bridge = createWindowsSecretBridgeHarness({
      entries: new Map([
        ['provider:provider-a', 'old-key'],
        ['github-token', 'old-token'],
        ['sync-passphrase', 'old-passphrase'],
      ]),
      migrationState: 'complete',
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)
    await loadZeroChatSecrets(['provider-a'])
    const enteredPersist = deferred<void>()
    const pendingPersist = deferred<AppData>()
    const committing = commitZeroChatSecretSnapshotWithAppData(
      previousSecrets,
      { providerKeys: {}, githubToken: '', syncPassphrase: '' },
      targetData,
      () => {
        enteredPersist.resolve(undefined)
        return pendingPersist.promise
      },
    )

    await enteredPersist.promise
    expect(bridge.entries.size).toBe(0)
    await recoverPendingZeroChatSecretAppDataTransition()
    expect(bridge.entries).toEqual(new Map([
      ['provider:provider-a', 'old-key'],
      ['github-token', 'old-token'],
      ['sync-passphrase', 'old-passphrase'],
    ]))
    expect(
      records.has('meta:pending-zerochat-app-data-transition'),
    ).toBe(false)

    pendingPersist.reject(new Error('simulated WebView process exit'))
    await expect(committing).rejects.toThrow('simulated WebView process exit')
  })

  it('preserves Windows staging and rollback failures with the recovery journal', async () => {
    const records = new Map<string, unknown>()
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({
        appRecord: transitionAppData(1),
        secretRecords: records,
      }),
    )
    const bridge = createWindowsSecretBridgeHarness({
      entries: new Map([['provider:provider-a', 'old-key']]),
      failMutationNumbers: [1, 2],
      migrationState: 'complete',
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)

    await expect(
      commitProviderSecretSnapshotWithAppData(
        { 'provider-a': 'old-key' },
        { 'provider-a': 'new-key' },
        transitionAppData(2),
        async (snapshot) => snapshot,
      ),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      message: rt('error.localCredentialRollbackFailed'),
      cause: expect.objectContaining({ code: 'storage-failure' }),
      errors: [
        expect.objectContaining({ code: 'storage-failure' }),
        expect.objectContaining({ code: 'storage-failure' }),
      ],
    })

    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(true)
    expect(bridge.entries.get('provider:provider-a')).toBe('old-key')
  })

  it('preserves AppData and Windows rollback failures with the recovery journal', async () => {
    const records = new Map<string, unknown>()
    const oldData = transitionAppData(1)
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ appRecord: oldData, secretRecords: records }),
    )
    const bridge = createWindowsSecretBridgeHarness({
      entries: new Map([['provider:provider-a', 'old-key']]),
      failMutationNumbers: [2],
      migrationState: 'complete',
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)

    await expect(
      commitProviderSecretSnapshotWithAppData(
        { 'provider-a': 'old-key' },
        { 'provider-a': 'new-key' },
        transitionAppData(2),
        async () => {
          throw new Error('app data write failed')
        },
      ),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      message: rt('error.localCredentialRollbackFailed'),
      cause: expect.objectContaining({ code: 'storage-failure' }),
      errors: [
        expect.objectContaining({ message: 'app data write failed' }),
        expect.objectContaining({ code: 'storage-failure' }),
      ],
    })

    expect(
      records.has('meta:pending-provider-app-data-transition'),
    ).toBe(true)
    expect(bridge.entries.get('provider:provider-a')).toBe('new-key')
  })

  it('keeps Windows Locker cleared when full reset AppData is committed', async () => {
    const records = new Map<string, unknown>()
    const targetData = transitionAppData(2)
    const previousSecrets = {
      providerKeys: { 'provider-a': 'old-key' },
      githubToken: 'old-token',
      syncPassphrase: 'old-passphrase',
    }
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ appRecord: targetData, secretRecords: records }),
    )
    const bridge = createWindowsSecretBridgeHarness({
      entries: new Map([
        ['provider:provider-a', 'old-key'],
        ['github-token', 'old-token'],
        ['sync-passphrase', 'old-passphrase'],
      ]),
      migrationState: 'complete',
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)
    await loadZeroChatSecrets(['provider-a'])
    const enteredPersist = deferred<void>()
    const pendingPersist = deferred<AppData>()
    const committing = commitZeroChatSecretSnapshotWithAppData(
      previousSecrets,
      { providerKeys: {}, githubToken: '', syncPassphrase: '' },
      targetData,
      () => {
        enteredPersist.resolve(undefined)
        return pendingPersist.promise
      },
    )

    await enteredPersist.promise
    await recoverPendingZeroChatSecretAppDataTransition()
    expect(bridge.entries.size).toBe(0)
    expect(
      records.has('meta:pending-zerochat-app-data-transition'),
    ).toBe(false)

    pendingPersist.resolve(targetData)
    await expect(committing).resolves.toBe(targetData)
  })

  it('migrates only missing browser secrets into Locker and keeps Locker authoritative', async () => {
    const browserRecords = new Map<string, unknown>()
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ secretRecords: browserRecords }),
    )
    localStorage.setItem(
      'zerochat:secret:provider:existing',
      'stale-browser-value',
    )
    localStorage.setItem(
      'zerochat:secret:provider:imported',
      'browser-import-value',
    )
    localStorage.setItem(
      'zerochat:secret:github-token',
      'browser-github-value',
    )
    sessionStorage.setItem(
      'zerochat:secret:sync-passphrase',
      'browser-sync-value',
    )
    const bridge = createWindowsSecretBridgeHarness({
      entries: new Map([
        ['provider:existing', 'locker-value'],
      ]),
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)

    await expect(
      loadZeroChatSecrets(['existing', 'imported']),
    ).resolves.toEqual({
      providerKeys: {
        existing: 'locker-value',
        imported: 'browser-import-value',
      },
      githubToken: 'browser-github-value',
    })
    await expect(getSyncPassphrase()).resolves.toBe('browser-sync-value')

    expect(bridge.entries).toEqual(new Map([
      ['provider:existing', 'locker-value'],
      ['provider:imported', 'browser-import-value'],
      ['github-token', 'browser-github-value'],
      ['sync-passphrase', 'browser-sync-value'],
    ]))
    expect(bridge.migrationState).toBe('complete')
    expect(
      bridge.requests.filter(({ op }) => op === 'mutate').map((request) => ({
        changes: request.changes,
        migrationState: request.migrationState,
      })),
    ).toEqual([
      {
        changes: [
          { name: 'provider:imported', value: 'browser-import-value' },
          { name: 'github-token', value: 'browser-github-value' },
          { name: 'sync-passphrase', value: 'browser-sync-value' },
        ],
        migrationState: 'locker-written',
      },
      {
        changes: [],
        migrationState: 'complete',
      },
    ])
    expect(browserRecords.size).toBe(0)
    expect(localStorage.getItem(
      'zerochat:secret:provider:existing',
    )).toBeNull()
    expect(localStorage.getItem(
      'zerochat:secret:provider:imported',
    )).toBeNull()
    expect(sessionStorage.getItem(
      'zerochat:secret:sync-passphrase',
    )).toBeNull()

    await expect(clearZeroChatSecrets()).resolves.toMatch(/^revision-/u)
    expect(bridge.entries.size).toBe(0)
    expect(bridge.migrationState).toBe('complete')
  })

  it('retries Windows migration cleanup from locker-written state', async () => {
    sessionStorage.setItem(
      'zerochat:secret:sync-passphrase',
      'retryable-sync-value',
    )
    const removeItem = sessionStorage.removeItem.bind(sessionStorage)
    sessionStorage.removeItem = vi.fn(() => {
      throw new Error('session cleanup blocked')
    })
    const bridge = createWindowsSecretBridgeHarness()
    vi.stubGlobal('window', bridge.window)

    await expect(loadZeroChatSecrets([])).rejects.toThrow(
      'session cleanup blocked',
    )
    expect(bridge.entries.get('sync-passphrase')).toBe(
      'retryable-sync-value',
    )
    expect(bridge.migrationState).toBe('locker-written')

    sessionStorage.removeItem = vi.fn(removeItem)

    await expect(getSyncPassphrase()).resolves.toBe('retryable-sync-value')
    expect(bridge.migrationState).toBe('complete')
    expect(sessionStorage.getItem(
      'zerochat:secret:sync-passphrase',
    )).toBeNull()
  })

  it('keeps browser secrets when Windows migration verification and rollback fail', async () => {
    const browserRecords = new Map<string, unknown>()
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMock({ secretRecords: browserRecords }),
    )
    localStorage.setItem(
      'zerochat:secret:provider:provider-a',
      'browser-provider-key',
    )
    sessionStorage.setItem(
      'zerochat:secret:sync-passphrase',
      'browser-sync-passphrase',
    )
    const bridge = createWindowsSecretBridgeHarness({
      failMigrationVerification: true,
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)

    await expect(
      loadZeroChatSecrets(['provider-a']),
    ).rejects.toMatchObject({ code: 'storage-failure' })

    expect(bridge.entries.size).toBe(0)
    expect(bridge.migrationState).toBe('locker-written')
    expect(isLocalEncryptedRecord(
      browserRecords.get('secret:provider:provider-a'),
    )).toBe(true)
    expect(sessionStorage.getItem(
      'zerochat:secret:sync-passphrase',
    )).toBe('browser-sync-passphrase')
  })

  it('keeps the committed Windows revision after a deferred stale read returns', async () => {
    const bridge = createWindowsSecretBridgeHarness({
      deferReads: true,
      migrationState: 'complete',
      revision: 'revision-0',
    })
    vi.stubGlobal('window', bridge.window)

    const staleRead = loadZeroChatSecrets(['provider-a'])
    await vi.waitFor(() => {
      expect(bridge.requests.filter(({ op }) => op === 'read')).toHaveLength(1)
    })

    await expect(setProviderKey('provider-a', 'new-value')).resolves.toBeUndefined()
    expect(
      bridge.requests.find(({ op }) => op === 'mutate')?.expectedRevision,
    ).toBe('revision-0')

    bridge.releaseNextRead()
    await staleRead

    await expect(setProviderKey('provider-b', 'next-value')).resolves.toBeUndefined()
    const mutations = bridge.requests.filter(({ op }) => op === 'mutate')
    expect(mutations).toHaveLength(2)
    expect(mutations[1]?.expectedRevision).toBe('revision-1')
  })
})
