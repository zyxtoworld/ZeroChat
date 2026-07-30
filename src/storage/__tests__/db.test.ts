import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

vi.mock('../localCrypto', () => ({
  decryptLocalString: vi.fn(),
  encryptLocalString: vi.fn(async () => ({
    kind: 'zerochat.localEncrypted',
    version: 1,
    iv: 'iv',
    aad: 'aad',
    payload: 'payload',
  })),
  isLocalEncryptedRecord: vi.fn(() => false),
}))

import {
  decryptLocalString,
  encryptLocalString,
  isLocalEncryptedRecord,
  type LocalEncryptedRecord,
} from '../localCrypto'
import {
  clearAppData,
  clearSkillChunkContents,
  createDefaultData,
  deleteSkillContentRefs,
  deleteSkillContents,
  loadAppData,
  loadSkillChunkContent,
  loadSkillContents,
  materializeAppDataSkillContents,
  persistAppDataSkillContents,
  persistExternalAppDataSkillContents,
  persistSkillContents,
  persistSkillsContents,
  replaceLocalDataDocuments,
  saveAppData,
  skillContentRefs,
  subscribeLegacyAppDataMigrationFailures,
  subscribeLegacySkillContentMigrationFailures,
} from '../db'
import type { UserSkill } from '../../types'
import { APP_DATA_WRITE_CONFLICT_MESSAGE } from '../appDataWriteConflict'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

function encryptedRecord(iv: string): LocalEncryptedRecord {
  return {
    kind: 'zerochat.localEncrypted',
    version: 1,
    iv,
    aad: 'aad',
    payload: `payload-${iv}`,
  }
}

function createIndexedDbMockWithThrowingDelete(error: Error): {
  close: ReturnType<typeof vi.fn>
  indexedDB: IDBFactory
} {
  const close = vi.fn()
  const transaction = {
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: vi.fn(() => ({
      delete: vi.fn(() => {
        throw error
      }),
    })),
  }
  const request = {
    error: null,
    result: {
      close,
      objectStoreNames: {
        contains: vi.fn(() => true),
      },
      transaction: vi.fn(() => transaction),
    },
  } as unknown as IDBOpenDBRequest

  return {
    close,
    indexedDB: {
      open: vi.fn(() => {
        queueMicrotask(() => {
          request.onsuccess?.(new Event('success'))
        })
        return request
      }),
    } as unknown as IDBFactory,
  }
}

function createIndexedDbMockWithThrowingTransaction(error: Error): {
  close: ReturnType<typeof vi.fn>
  indexedDB: IDBFactory
} {
  const close = vi.fn()
  const request = {
    error: null,
    result: {
      close,
      objectStoreNames: {
        contains: vi.fn(() => true),
      },
      transaction: vi.fn(() => {
        throw error
      }),
    },
  } as unknown as IDBOpenDBRequest

  return {
    close,
    indexedDB: {
      open: vi.fn(() => {
        queueMicrotask(() => {
          request.onsuccess?.(new Event('success'))
        })
        return request
      }),
    } as unknown as IDBFactory,
  }
}

function createRequest<T>(
  result: T,
  tx: {
    oncomplete: ((event: Event) => void) | null
  },
): IDBRequest<T> {
  const request = {
    error: null,
    result,
  } as unknown as IDBRequest<T>

  queueMicrotask(() => {
    request.onsuccess?.(new Event('success'))
    queueMicrotask(() => {
      tx.oncomplete?.(new Event('complete'))
    })
  })

  return request
}

function createIndexedDbMockForLegacyMigrationFailure(
  legacyData: unknown,
  migrationError: Error,
): {
  close: ReturnType<typeof vi.fn>
  indexedDB: IDBFactory
} {
  const close = vi.fn()
  let transactionIndex = 0

  const request = {
    error: null,
    result: {
      close,
      objectStoreNames: {
        contains: vi.fn(() => true),
      },
      transaction: vi.fn(() => {
        const index = transactionIndex
        transactionIndex += 1
        const tx = {
          abort: vi.fn(() => {
            queueMicrotask(() => tx.onabort?.(new Event('abort')))
          }),
          error: null,
          onabort: null,
          oncomplete: null,
          onerror: null,
          objectStore: vi.fn(() => ({
            get: vi.fn(() => createRequest(legacyData, tx)),
            put: vi.fn(() => {
              if (index === 1) {
                throw migrationError
              }

              return createRequest(undefined, tx)
            }),
          })),
        } as unknown as IDBTransaction

        return tx
      }),
    },
  } as unknown as IDBOpenDBRequest

  return {
    close,
    indexedDB: {
      open: vi.fn(() => {
        queueMicrotask(() => {
          request.onsuccess?.(new Event('success'))
        })
        return request
      }),
    } as unknown as IDBFactory,
  }
}

function createIndexedDbMockWithRecords(
  records: Map<string, unknown>,
  options: { failPuts?: boolean } = {},
): {
  close: ReturnType<typeof vi.fn>
  deleteRecord: ReturnType<typeof vi.fn>
  getAllKeys: ReturnType<typeof vi.fn>
  indexedDB: IDBFactory
  put: ReturnType<typeof vi.fn>
} {
  const close = vi.fn()
  const deleteRecord = vi.fn((key: string) => {
    records.delete(key)
    return createRequest(undefined, tx)
  })
  const getAllKeys = vi.fn(() =>
    createRequest([...records.keys()] as IDBValidKey[], tx),
  )
  const put = vi.fn((value: unknown, key: string) => {
    if (options.failPuts) {
      throw new Error('legacy migration write failed')
    }

    records.set(key, value)
    return createRequest(undefined, tx)
  })
  const tx = {
    abort: vi.fn(() => {
      queueMicrotask(() => tx.onabort?.(new Event('abort')))
    }),
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: vi.fn(() => ({
      delete: deleteRecord,
      get: vi.fn((key: string) => createRequest(records.get(key), tx)),
      getAllKeys,
      put,
    })),
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
    close,
    deleteRecord,
    getAllKeys,
    indexedDB: {
      open: vi.fn(() => {
        queueMicrotask(() => {
          request.onsuccess?.(new Event('success'))
        })
        return request
      }),
    } as unknown as IDBFactory,
    put,
  }
}

function createIndexedDbMockWithAtomicReplacement(
  putError?: Error,
  abortError?: Error,
): {
  abort: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  indexedDB: IDBFactory
  put: ReturnType<typeof vi.fn>
  transaction: ReturnType<typeof vi.fn>
} {
  const abort = vi.fn(() => {
    if (abortError) {
      throw abortError
    }

    queueMicrotask(() => tx.onabort?.(new Event('abort')))
  })
  const clear = vi.fn(() => ({ error: null }) as IDBRequest<undefined>)
  const get = vi.fn(() => {
    const request = {
      error: null,
      result: null,
    } as unknown as IDBRequest<unknown>

    queueMicrotask(() => request.onsuccess?.(new Event('success')))
    return request
  })
  const put = vi.fn(() => {
    if (putError) {
      throw putError
    }

    queueMicrotask(() => tx.oncomplete?.(new Event('complete')))
    return ({ error: null }) as IDBRequest<IDBValidKey>
  })
  const tx = {
    abort,
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: vi.fn(() => ({ clear, get, put })),
  } as unknown as IDBTransaction
  const transaction = vi.fn(() => tx)
  const request = {
    error: null,
    result: {
      close: vi.fn(),
      objectStoreNames: {
        contains: vi.fn(() => true),
      },
      transaction,
    },
  } as unknown as IDBOpenDBRequest

  return {
    abort,
    clear,
    indexedDB: {
      open: vi.fn(() => {
        queueMicrotask(() => request.onsuccess?.(new Event('success')))
        return request
      }),
    } as unknown as IDBFactory,
    put,
    transaction,
  }
}

function createIndexedDbMockWithMutableAppRecord(initialRecord: unknown): {
  abort: ReturnType<typeof vi.fn>
  currentRecord: () => unknown
  indexedDB: IDBFactory
  put: ReturnType<typeof vi.fn>
  setRecord: (value: unknown) => void
} {
  let appRecord = initialRecord
  const abort = vi.fn()
  const put = vi.fn()
  const database = {
    close: vi.fn(),
    objectStoreNames: {
      contains: vi.fn(() => true),
    },
    transaction: vi.fn(() => {
      let aborted = false
      const tx = {
        abort: vi.fn(() => {
          if (aborted) {
            return
          }

          aborted = true
          abort()
          queueMicrotask(() => tx.onabort?.(new Event('abort')))
        }),
        error: null,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore: vi.fn(() => ({
          get: vi.fn((key: string) => {
            const request = {
              error: null,
              result: key === 'app' ? appRecord : undefined,
            } as unknown as IDBRequest<unknown>

            queueMicrotask(() => {
              if (aborted) {
                return
              }

              request.onsuccess?.(new Event('success'))
              queueMicrotask(() => {
                if (!aborted) {
                  tx.oncomplete?.(new Event('complete'))
                }
              })
            })
            return request
          }),
          put: vi.fn((value: unknown, key: string) => {
            put(value, key)
            const request = {
              error: null,
              result: key,
            } as unknown as IDBRequest<IDBValidKey>

            queueMicrotask(() => {
              if (aborted) {
                return
              }

              if (key === 'app') {
                appRecord = value
              }
              request.onsuccess?.(new Event('success'))
            })
            return request
          }),
        })),
      } as unknown as IDBTransaction

      return tx
    }),
  } as unknown as IDBDatabase

  return {
    abort,
    currentRecord: () => appRecord,
    indexedDB: {
      open: vi.fn(() => {
        const request = {
          error: null,
          result: database,
        } as unknown as IDBOpenDBRequest

        queueMicrotask(() => request.onsuccess?.(new Event('success')))
        return request
      }),
    } as unknown as IDBFactory,
    put,
    setRecord: (value) => {
      appRecord = value
    },
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function skillWithStoredChunk(contentRef = 'skill-chunk:skill-a:chunk-a'): UserSkill {
  return {
    id: 'skill-a',
    name: 'Skill A',
    description: '',
    autoMatch: true,
    enabled: true,
    fixed: false,
    contentHash: 'hash',
    contentType: 'text',
    keywords: [],
    sourceSize: 14,
    chunks: [
      {
        id: 'chunk-a',
        heading: 'Chunk A',
        contentRef,
        keywords: [],
        tokenEstimate: 4,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('app data IndexedDB storage', () => {
  beforeEach(() => {
    vi.mocked(decryptLocalString).mockReset()
    vi.mocked(encryptLocalString).mockClear()
    vi.mocked(encryptLocalString).mockImplementation(async () => ({
      kind: 'zerochat.localEncrypted',
      version: 1,
      iv: 'iv',
      aad: 'aad',
      payload: 'payload',
    }))
    vi.mocked(isLocalEncryptedRecord).mockReset()
    vi.mocked(isLocalEncryptedRecord).mockReturnValue(false)
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    })
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('closes the database when single-request storage construction throws', async () => {
    const error = new Error('delete failed')
    const mock = createIndexedDbMockWithThrowingDelete(error)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(clearAppData()).rejects.toThrow('delete failed')

    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('replaces AppData and clears Skill chunks in one documents-store transaction', async () => {
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMockWithRecords(new Map()).indexedDB,
    )
    await expect(loadAppData()).resolves.toBeNull()

    const mock = createIndexedDbMockWithAtomicReplacement()
    const fresh = createDefaultData()
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await replaceLocalDataDocuments(fresh)

    expect(mock.transaction).toHaveBeenCalledWith('documents', 'readwrite')
    expect(mock.clear).toHaveBeenCalledTimes(1)
    expect(mock.put).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'zerochat.localEncrypted' }),
      'app',
    )
    expect(mock.clear.mock.invocationCallOrder[0]).toBeLessThan(
      mock.put.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('aborts atomic local replacement when the fresh AppData write cannot start', async () => {
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMockWithRecords(new Map()).indexedDB,
    )
    await expect(loadAppData()).resolves.toBeNull()

    const error = new Error('put failed')
    const mock = createIndexedDbMockWithAtomicReplacement(error)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(
      replaceLocalDataDocuments(createDefaultData()),
    ).rejects.toBe(error)

    expect(mock.clear).toHaveBeenCalledTimes(1)
    expect(mock.abort).toHaveBeenCalledTimes(1)
  })

  it('preserves AppData operation and abort failures when atomic replacement cannot stop', async () => {
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMockWithRecords(new Map()).indexedDB,
    )
    await expect(loadAppData()).resolves.toBeNull()

    const operationError = new Error('AppData put failed')
    const abortError = new Error('AppData abort failed')
    const mock = createIndexedDbMockWithAtomicReplacement(
      operationError,
      abortError,
    )
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(
      replaceLocalDataDocuments(createDefaultData()),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      cause: abortError,
      errors: [operationError, abortError],
    })

    expect(mock.abort).toHaveBeenCalledTimes(1)
  })

  it('rejects atomic local replacement when transaction construction fails', async () => {
    vi.stubGlobal(
      'indexedDB',
      createIndexedDbMockWithRecords(new Map()).indexedDB,
    )
    await expect(loadAppData()).resolves.toBeNull()

    const error = new Error('transaction failed')
    const mock = createIndexedDbMockWithThrowingTransaction(error)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(
      replaceLocalDataDocuments(createDefaultData()),
    ).rejects.toBe(error)

    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('rejects stale atomic replacement without clearing a concurrent winner', async () => {
    const initial = createDefaultData()
    const fresh = { ...initial, updatedAt: initial.updatedAt + 1 }
    const initialRecord = encryptedRecord('initial')
    const winnerRecord = encryptedRecord('winner')
    const mock = createIndexedDbMockWithMutableAppRecord(initialRecord)

    vi.mocked(isLocalEncryptedRecord).mockImplementation(
      (value): value is LocalEncryptedRecord =>
        typeof value === 'object' &&
        value !== null &&
        (value as LocalEncryptedRecord).kind === 'zerochat.localEncrypted',
    )
    vi.mocked(decryptLocalString).mockResolvedValue(JSON.stringify(initial))
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(loadAppData()).resolves.toEqual(initial)
    mock.setRecord(winnerRecord)

    await expect(replaceLocalDataDocuments(fresh)).rejects.toMatchObject({
      message: APP_DATA_WRITE_CONFLICT_MESSAGE,
      name: 'AppDataWriteConflictError',
    })

    expect(mock.currentRecord()).toEqual(winnerRecord)
    expect(mock.put).not.toHaveBeenCalled()
    expect(mock.abort).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale concurrent AppData write without overwriting the winner', async () => {
    const initial = createDefaultData()
    const winnerData = { ...initial, updatedAt: initial.updatedAt + 1 }
    const staleData = { ...initial, updatedAt: initial.updatedAt + 2 }
    const initialRecord = encryptedRecord('initial')
    const winnerRecord = encryptedRecord('winner')
    const staleRecord = encryptedRecord('stale')
    const winnerEncryption = deferred<LocalEncryptedRecord>()
    const staleEncryption = deferred<LocalEncryptedRecord>()
    const mock = createIndexedDbMockWithMutableAppRecord(initialRecord)

    vi.mocked(isLocalEncryptedRecord).mockImplementation(
      (value): value is LocalEncryptedRecord =>
        typeof value === 'object' &&
        value !== null &&
        (value as LocalEncryptedRecord).kind === 'zerochat.localEncrypted',
    )
    vi.mocked(decryptLocalString).mockResolvedValue(JSON.stringify(initial))
    vi.mocked(encryptLocalString)
      .mockImplementationOnce(() => winnerEncryption.promise)
      .mockImplementationOnce(() => staleEncryption.promise)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(loadAppData()).resolves.toEqual(initial)

    const winner = saveAppData(winnerData)
    const stale = saveAppData(staleData)

    winnerEncryption.resolve(winnerRecord)
    await expect(winner).resolves.toBeUndefined()
    staleEncryption.resolve(staleRecord)
    await expect(stale).rejects.toMatchObject({
      message: APP_DATA_WRITE_CONFLICT_MESSAGE,
      name: 'AppDataWriteConflictError',
    })

    expect(mock.currentRecord()).toEqual(winnerRecord)
    expect(mock.put).toHaveBeenCalledTimes(1)
    expect(mock.put).toHaveBeenCalledWith(winnerRecord, 'app')
    expect(mock.abort).toHaveBeenCalledTimes(1)
  })

  it('reloads the winning AppData after a legacy migration loses its revision race', async () => {
    const legacy = createDefaultData()
    const winnerData = { ...legacy, updatedAt: legacy.updatedAt + 1 }
    const winnerRecord = encryptedRecord('winner')
    const losingMigrationRecord = encryptedRecord('losing-migration')
    const migrationEncryption = deferred<LocalEncryptedRecord>()
    const mock = createIndexedDbMockWithMutableAppRecord(legacy)

    vi.mocked(isLocalEncryptedRecord).mockImplementation(
      (value): value is LocalEncryptedRecord =>
        typeof value === 'object' &&
        value !== null &&
        (value as LocalEncryptedRecord).kind === 'zerochat.localEncrypted',
    )
    vi.mocked(decryptLocalString).mockResolvedValue(JSON.stringify(winnerData))
    vi.mocked(encryptLocalString).mockImplementationOnce(
      () => migrationEncryption.promise,
    )
    vi.stubGlobal('indexedDB', mock.indexedDB)

    const loading = loadAppData()
    await vi.waitFor(() => expect(encryptLocalString).toHaveBeenCalledTimes(1))
    mock.setRecord(winnerRecord)
    migrationEncryption.resolve(losingMigrationRecord)

    await expect(loading).resolves.toEqual(winnerData)
    expect(mock.currentRecord()).toEqual(winnerRecord)
    expect(mock.put).not.toHaveBeenCalled()
    expect(mock.abort).toHaveBeenCalledTimes(1)
    expect(decryptLocalString).toHaveBeenCalledWith('app-data', winnerRecord)
  })

  it('isolates external Skill content from snapshot-provided document keys', async () => {
    const records = new Map<string, unknown>([['app', 'current-app-data']])
    const mock = createIndexedDbMockWithRecords(records)
    vi.stubGlobal('indexedDB', mock.indexedDB)
    const data = createDefaultData()
    const external = {
      ...data,
      skills: [
        {
          ...skillWithStoredChunk('app'),
          chunks: [
            {
              ...skillWithStoredChunk('app').chunks[0],
              content: 'Imported content',
              contentRef: 'app',
            },
          ],
        },
        skillWithStoredChunk('app'),
      ],
    }

    const persisted = await persistExternalAppDataSkillContents(external)

    expect(records.get('app')).toBe('current-app-data')
    expect(persisted.skills).toHaveLength(1)
    expect(persisted.skills[0].chunks[0]).toMatchObject({
      contentRef: expect.stringMatching(/^skill-chunk:external:/u),
      contentPreview: 'Imported content',
    })
    expect(persisted.skills[0].chunks[0].content).toBeUndefined()
    expect(mock.put).toHaveBeenCalledTimes(1)
    expect(mock.put.mock.calls[0][1]).not.toBe('app')
  })

  it('encrypts inline Skill chunks and returns metadata-only AppData', async () => {
    const records = new Map<string, unknown>()
    const mock = createIndexedDbMockWithRecords(records)
    const data = createDefaultData()
    const inlineSkill: UserSkill = {
      ...skillWithStoredChunk(),
      chunks: [
        {
          ...skillWithStoredChunk().chunks[0],
          content: '  First line\n\nSecond line  ',
          contentRef: undefined,
        },
      ],
    }
    vi.stubGlobal('indexedDB', mock.indexedDB)

    const persistedSkill = await persistSkillContents(inlineSkill)
    const persistedData = await persistAppDataSkillContents({
      ...data,
      skills: [inlineSkill],
    })
    const unchanged = skillWithStoredChunk()
    const unchangedBatch = await persistSkillsContents([unchanged])

    expect(persistedSkill).not.toBe(inlineSkill)
    expect(persistedSkill.chunks[0]).toEqual({
      id: 'chunk-a',
      heading: 'Chunk A',
      contentRef: expect.stringMatching(/^skill-chunk:local:/u),
      contentPreview: 'First line Second line',
      keywords: [],
      tokenEstimate: 4,
    })
    expect(skillContentRefs(persistedSkill)).toEqual([
      persistedSkill.chunks[0].contentRef,
    ])
    expect(persistedData.skills[0].chunks[0].content).toBeUndefined()
    expect(unchangedBatch[0]).toBe(unchanged)
    expect(encryptLocalString).toHaveBeenCalledWith(
      expect.stringMatching(/^skill-chunk:local:/u),
      'First line\n\nSecond line',
    )
    expect(mock.put).toHaveBeenCalledTimes(2)
    expect(records.get(persistedSkill.chunks[0].contentRef!)).toEqual(
      expect.objectContaining({ kind: 'zerochat.localEncrypted' }),
    )
  })

  it('does not overwrite an existing Skill content ref before metadata can commit', async () => {
    const contentRef = 'skill-chunk:skill-a:chunk-a'
    const oldRecord = encryptedRecord('old-content')
    const records = new Map<string, unknown>([[contentRef, oldRecord]])
    const mock = createIndexedDbMockWithRecords(records)
    const skill = {
      ...skillWithStoredChunk(contentRef),
      chunks: [
        {
          ...skillWithStoredChunk(contentRef).chunks[0],
          content: 'New content that must be isolated',
        },
      ],
    }
    vi.stubGlobal('indexedDB', mock.indexedDB)

    const persisted = await persistSkillContents(skill)
    const nextRef = persisted.chunks[0].contentRef

    expect(nextRef).toMatch(/^skill-chunk:local:/u)
    expect(nextRef).not.toBe(contentRef)
    expect(records.get(contentRef)).toBe(oldRecord)
    expect(records.get(nextRef!)).toEqual(
      expect.objectContaining({ kind: 'zerochat.localEncrypted' }),
    )
  })

  it('loads and materializes mixed inline and encrypted Skill chunks', async () => {
    const contentRef = 'skill-chunk:skill-a:stored'
    const encrypted = encryptedRecord('stored')
    const records = new Map<string, unknown>([[contentRef, encrypted]])
    const mock = createIndexedDbMockWithRecords(records)
    const skill: UserSkill = {
      ...skillWithStoredChunk(),
      chunks: [
        {
          ...skillWithStoredChunk().chunks[0],
          id: 'inline',
          content: '  Inline content  ',
          contentRef: undefined,
        },
        {
          ...skillWithStoredChunk(contentRef).chunks[0],
          id: 'stored',
          contentRef,
        },
      ],
    }
    vi.mocked(isLocalEncryptedRecord).mockImplementation(
      (value): value is LocalEncryptedRecord => value === encrypted,
    )
    vi.mocked(decryptLocalString).mockResolvedValue('  Stored content  ')
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(loadSkillContents(skill)).resolves.toEqual([
      { chunk: skill.chunks[0], content: 'Inline content' },
      { chunk: skill.chunks[1], content: 'Stored content' },
    ])

    const data = { ...createDefaultData(), skills: [skill] }
    const materialized = await materializeAppDataSkillContents(data)

    expect(materialized.skills[0].chunks).toEqual([
      expect.objectContaining({ id: 'inline', content: 'Inline content' }),
      expect.objectContaining({ id: 'stored', content: 'Stored content' }),
    ])
    expect(materialized.skills[0].chunks[0].contentRef).toBeUndefined()
    expect(decryptLocalString).toHaveBeenCalledWith(contentRef, encrypted)
  })

  it('rejects missing Skill chunks and only clears Skill document keys', async () => {
    const contentRef = 'skill-chunk:skill-a:chunk-a'
    const externalRef = 'skill-chunk:external:write:0:0'
    const records = new Map<string, unknown>([
      ['app', 'app-data'],
      [contentRef, 'content'],
      [externalRef, 'external'],
      ['other', 'keep'],
    ])
    const mock = createIndexedDbMockWithRecords(records)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await clearSkillChunkContents()

    expect([...records.entries()]).toEqual([
      ['app', 'app-data'],
      ['other', 'keep'],
    ])
    expect(mock.getAllKeys).toHaveBeenCalledTimes(1)
    expect(mock.deleteRecord).toHaveBeenCalledTimes(2)

    records.set(contentRef, 'content')
    await deleteSkillContents(skillWithStoredChunk(contentRef))
    expect(records.has(contentRef)).toBe(false)

    await expect(
      loadSkillContents(skillWithStoredChunk('skill-chunk:missing')),
    ).rejects.toThrow('error.skillContentMissing')
  })

  it('closes the database when batched delete construction throws', async () => {
    const error = new Error('batch delete failed')
    const mock = createIndexedDbMockWithThrowingDelete(error)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(
      deleteSkillContentRefs(['skill-chunk:skill-a:chunk-a']),
    ).rejects.toThrow('batch delete failed')

    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('closes the database when single-request transaction construction throws', async () => {
    const error = new Error('transaction failed')
    const mock = createIndexedDbMockWithThrowingTransaction(error)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(clearAppData()).rejects.toThrow('transaction failed')

    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('closes the database when batched delete transaction construction throws', async () => {
    const error = new Error('batch transaction failed')
    const mock = createIndexedDbMockWithThrowingTransaction(error)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(
      deleteSkillContentRefs(['skill-chunk:skill-a:chunk-a']),
    ).rejects.toThrow('batch transaction failed')

    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('keeps valid legacy AppData usable when encrypted migration save fails', async () => {
    const legacyData = createDefaultData()
    const migrationError = new Error('migration write failed')
    const mock = createIndexedDbMockForLegacyMigrationFailure(
      legacyData,
      migrationError,
    )
    const listener = vi.fn()
    const unsubscribe = subscribeLegacyAppDataMigrationFailures(listener)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    try {
      await expect(loadAppData()).resolves.toEqual(legacyData)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({ error: migrationError })
      expect(mock.close).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
    }
  })

  it('migrates legacy plaintext Skill chunks after returning readable content', async () => {
    const contentRef = 'skill-chunk:skill-a:chunk-a'
    const records = new Map<string, unknown>([[contentRef, 'Legacy content']])
    const mock = createIndexedDbMockWithRecords(records)
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(
      loadSkillChunkContent(skillWithStoredChunk(contentRef), {
        ...skillWithStoredChunk(contentRef).chunks[0],
      }),
    ).resolves.toBe('Legacy content')
    await flushAsyncWork()

    expect(encryptLocalString).toHaveBeenCalledWith(contentRef, 'Legacy content')
    expect(mock.put).toHaveBeenCalledWith(
      {
        kind: 'zerochat.localEncrypted',
        version: 1,
        iv: 'iv',
        aad: 'aad',
        payload: 'payload',
      },
      contentRef,
    )
  })

  it('keeps legacy plaintext Skill chunks readable when migration write fails', async () => {
    const contentRef = 'skill-chunk:skill-a:chunk-a'
    const mock = createIndexedDbMockWithRecords(
      new Map<string, unknown>([[contentRef, 'Legacy content']]),
      { failPuts: true },
    )
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(
      loadSkillChunkContent(skillWithStoredChunk(contentRef), {
        ...skillWithStoredChunk(contentRef).chunks[0],
      }),
    ).resolves.toBe('Legacy content')
    await flushAsyncWork()

    expect(encryptLocalString).toHaveBeenCalledWith(contentRef, 'Legacy content')
    expect(mock.put).toHaveBeenCalledTimes(1)
  })

  it('reports legacy plaintext Skill chunk migration failures without blocking content', async () => {
    const contentRef = 'skill-chunk:skill-a:chunk-a'
    const mock = createIndexedDbMockWithRecords(
      new Map<string, unknown>([[contentRef, 'Legacy content']]),
      { failPuts: true },
    )
    const listener = vi.fn()
    const unsubscribe = subscribeLegacySkillContentMigrationFailures(listener)

    vi.stubGlobal('indexedDB', mock.indexedDB)

    try {
      await expect(
        loadSkillChunkContent(skillWithStoredChunk(contentRef), {
          ...skillWithStoredChunk(contentRef).chunks[0],
        }),
      ).resolves.toBe('Legacy content')
      await flushAsyncWork()

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0]?.[0].records).toEqual([
        {
          key: contentRef,
          namespace: contentRef,
        },
      ])
      expect(listener.mock.calls[0]?.[0].error).toEqual(
        expect.objectContaining({
          message: 'legacy migration write failed',
        }),
      )
    } finally {
      unsubscribe()
    }
  })

  it('does not resurrect legacy plaintext Skill chunks deleted before migration writes back', async () => {
    const contentRef = 'skill-chunk:skill-a:chunk-a'
    const records = new Map<string, unknown>([[contentRef, 'Legacy content']])
    const mock = createIndexedDbMockWithRecords(records)
    let releaseMigration = (): void => {
      throw new Error('migration promise was not created')
    }
    vi.mocked(encryptLocalString).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseMigration = () =>
            resolve({
              kind: 'zerochat.localEncrypted',
              version: 1,
              iv: 'iv',
              aad: 'aad',
              payload: 'payload',
            })
        }),
    )
    vi.stubGlobal('indexedDB', mock.indexedDB)

    await expect(
      loadSkillChunkContent(skillWithStoredChunk(contentRef), {
        ...skillWithStoredChunk(contentRef).chunks[0],
      }),
    ).resolves.toBe('Legacy content')
    records.delete(contentRef)
    releaseMigration()
    await flushAsyncWork()

    expect(encryptLocalString).toHaveBeenCalledWith(contentRef, 'Legacy content')
    expect(mock.put).not.toHaveBeenCalled()
    expect(records.has(contentRef)).toBe(false)
  })
})
