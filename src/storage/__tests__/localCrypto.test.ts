import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

interface LocalCryptoIndexedDbMock {
  abort: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  createObjectStore: ReturnType<typeof vi.fn>
  indexedDB: IDBFactory
  transactionModes: IDBTransactionMode[]
}

interface LocalCryptoIndexedDbOptions {
  addError?: Error
  addRequestError?: Error
  abortError?: Error
  completeGetWithoutResultAt?: number
  getRequestErrorAt?: number
  transactionError?: Error
  transactionThrowAt?: number
  upgradeNeeded?: boolean
}

function createLocalCryptoIndexedDbMock(
  transactionKeys: Array<CryptoKey | undefined>,
  options: LocalCryptoIndexedDbOptions = {},
): LocalCryptoIndexedDbMock {
  const abort = vi.fn()
  const add = vi.fn()
  const close = vi.fn()
  const createObjectStore = vi.fn()
  const transactionModes: IDBTransactionMode[] = []
  let transactionIndex = 0

  function createTransaction(
    storedKey: CryptoKey | undefined,
    currentTransactionIndex: number,
  ): IDBTransaction {
    let completionScheduled = false
    let pendingRequests = 0
    const tx = {
      error: null,
      onabort: null,
      oncomplete: null,
      onerror: null,
      objectStore: vi.fn(),
    } as unknown as IDBTransaction
    const abortTransaction = vi.fn(() => {
      abort()
      if (options.abortError) {
        throw options.abortError
      }

      queueMicrotask(() => tx.onabort?.(new Event('abort')))
    })
    tx.abort = abortTransaction

    const scheduleCompletion = () => {
      if (pendingRequests !== 0 || completionScheduled) {
        return
      }

      completionScheduled = true
      queueMicrotask(() => {
        tx.oncomplete?.(new Event('complete'))
      })
    }

    const createRequest = <T>(result: T): IDBRequest<T> => {
      const request = {
        error: null,
        result,
      } as unknown as IDBRequest<T>

      pendingRequests += 1
      queueMicrotask(() => {
        request.onsuccess?.(new Event('success'))
        pendingRequests -= 1
        scheduleCompletion()
      })

      return request
    }

    const createErrorRequest = <T>(error: Error): IDBRequest<T> => {
      const request = {
        error,
        result: undefined,
      } as unknown as IDBRequest<T>

      queueMicrotask(() => request.onerror?.(new Event('error')))
      return request
    }

    const createRequestWithoutSuccess = <T>(): IDBRequest<T> => {
      const request = {
        error: null,
        result: undefined,
      } as unknown as IDBRequest<T>

      pendingRequests += 1
      queueMicrotask(() => {
        pendingRequests -= 1
        scheduleCompletion()
      })
      return request
    }

    const store = {
      add: vi.fn((value: CryptoKey, key: IDBValidKey) => {
        if (options.addError) {
          throw options.addError
        }

        add(value, key)
        return options.addRequestError
          ? createErrorRequest<IDBValidKey>(options.addRequestError)
          : createRequest(key)
      }),
      get: vi.fn(() =>
        options.completeGetWithoutResultAt === currentTransactionIndex
          ? createRequestWithoutSuccess<CryptoKey | undefined>()
          : options.getRequestErrorAt === currentTransactionIndex
          ? createErrorRequest<CryptoKey | undefined>(
              options.transactionError ?? new Error('key request failed'),
            )
          : createRequest(storedKey)),
    } as unknown as IDBObjectStore

    vi.mocked(tx.objectStore).mockReturnValue(store)
    return tx
  }

  const indexedDB = {
    open: vi.fn(() => {
      const request = {
        error: null,
        result: {
          close,
          createObjectStore,
          objectStoreNames: {
            contains: vi.fn(() => !options.upgradeNeeded),
          },
          transaction: vi.fn(
            (_storeName: string, mode: IDBTransactionMode) => {
              transactionModes.push(mode)
              const currentTransactionIndex = transactionIndex
              const storedKey = transactionKeys[currentTransactionIndex]
              transactionIndex += 1

              if (options.transactionThrowAt === currentTransactionIndex) {
                throw options.transactionError ?? new Error(
                  'key transaction failed',
                )
              }

              return createTransaction(storedKey, currentTransactionIndex)
            },
          ),
        },
      } as unknown as IDBOpenDBRequest

      queueMicrotask(() => {
        if (options.upgradeNeeded) {
          request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
        }
        request.onsuccess?.(new Event('success'))
      })

      return request
    }),
  } as unknown as IDBFactory

  return {
    abort,
    add,
    close,
    createObjectStore,
    indexedDB,
    transactionModes,
  }
}

function installCryptoMock(candidateKey: CryptoKey): {
  decrypt: ReturnType<typeof vi.fn>
  encrypt: ReturnType<typeof vi.fn>
  generateKey: ReturnType<typeof vi.fn>
} {
  const decrypt = vi.fn(async () =>
    new TextEncoder().encode('decrypted-value').buffer)
  const encrypt = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
  const generateKey = vi.fn(async () => candidateKey)

  vi.stubGlobal('crypto', {
    getRandomValues: vi.fn((value: Uint8Array) => {
      value.fill(7)
      return value
    }),
    subtle: {
      decrypt,
      encrypt,
      generateKey,
    },
  } as unknown as Crypto)

  return {
    decrypt,
    encrypt,
    generateKey,
  }
}

describe('local crypto key installation', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses a key installed by another context after the readonly fast path', async () => {
    const candidateKey = { id: 'candidate' } as unknown as CryptoKey
    const competingKey = { id: 'winner' } as unknown as CryptoKey
    const indexedDbMock = createLocalCryptoIndexedDbMock([
      undefined,
      competingKey,
    ])
    const cryptoMock = installCryptoMock(candidateKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')
    await encryptLocalString('app-data', 'value')

    expect(indexedDbMock.transactionModes).toEqual(['readonly', 'readwrite'])
    expect(cryptoMock.generateKey).toHaveBeenCalledTimes(1)
    expect(indexedDbMock.add).not.toHaveBeenCalled()
    expect(cryptoMock.encrypt.mock.calls[0]?.[1]).toBe(competingKey)
  })

  it('installs the generated key only when the readwrite transaction is still empty', async () => {
    const candidateKey = { id: 'candidate' } as unknown as CryptoKey
    const indexedDbMock = createLocalCryptoIndexedDbMock([
      undefined,
      undefined,
    ])
    const cryptoMock = installCryptoMock(candidateKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')
    await encryptLocalString('provider:test', 'secret')

    expect(indexedDbMock.add).toHaveBeenCalledWith(
      candidateKey,
      'local-aes-gcm-v1',
    )
    expect(cryptoMock.encrypt.mock.calls[0]?.[1]).toBe(candidateKey)
  })

  it('uses the stored key for namespace-bound encryption and decryption', async () => {
    const storedKey = { id: 'stored' } as unknown as CryptoKey
    const indexedDbMock = createLocalCryptoIndexedDbMock([storedKey])
    const cryptoMock = installCryptoMock(storedKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const {
      decryptLocalString,
      encryptLocalString,
      isLocalEncryptedRecord,
    } = await import('../localCrypto')
    const record = await encryptLocalString('provider:test', 'secret')

    expect(isLocalEncryptedRecord(record)).toBe(true)
    await expect(
      decryptLocalString('provider:test', record),
    ).resolves.toBe('decrypted-value')
    await expect(
      decryptLocalString('provider:other', record),
    ).rejects.toThrow()

    expect(indexedDbMock.transactionModes).toEqual(['readonly'])
    expect(cryptoMock.generateKey).not.toHaveBeenCalled()
    expect(cryptoMock.encrypt.mock.calls[0]?.[1]).toBe(storedKey)
    expect(cryptoMock.decrypt.mock.calls[0]?.[1]).toBe(storedKey)
    expect(cryptoMock.decrypt).toHaveBeenCalledTimes(1)
  })

  it('rejects every malformed local encrypted record field', async () => {
    const { isLocalEncryptedRecord } = await import('../localCrypto')
    const valid = {
      aad: 'aad',
      iv: 'iv',
      kind: 'zerochat.localEncrypted',
      payload: 'payload',
      version: 1,
    }

    expect(isLocalEncryptedRecord(null)).toBe(false)
    expect(isLocalEncryptedRecord({ ...valid, kind: 'other' })).toBe(false)
    expect(isLocalEncryptedRecord({ ...valid, version: 2 })).toBe(false)
    expect(isLocalEncryptedRecord({ ...valid, iv: 1 })).toBe(false)
    expect(isLocalEncryptedRecord({ ...valid, aad: 1 })).toBe(false)
    expect(isLocalEncryptedRecord({ ...valid, payload: 1 })).toBe(false)
    expect(isLocalEncryptedRecord(valid)).toBe(true)
  })

  it('retries key loading after generation fails', async () => {
    const candidateKey = { id: 'candidate' } as unknown as CryptoKey
    const indexedDbMock = createLocalCryptoIndexedDbMock([
      undefined,
      undefined,
      undefined,
    ])
    const cryptoMock = installCryptoMock(candidateKey)
    cryptoMock.generateKey.mockRejectedValueOnce(
      new Error('key generation failed'),
    )
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')

    await expect(
      encryptLocalString('app-data', 'first'),
    ).rejects.toThrow('key generation failed')
    await expect(
      encryptLocalString('app-data', 'second'),
    ).resolves.toMatchObject({ kind: 'zerochat.localEncrypted', version: 1 })

    expect(cryptoMock.generateKey).toHaveBeenCalledTimes(2)
    expect(indexedDbMock.transactionModes).toEqual([
      'readonly',
      'readonly',
      'readwrite',
    ])
  })

  it('creates the key store during the first database upgrade', async () => {
    const storedKey = { id: 'stored' } as unknown as CryptoKey
    const indexedDbMock = createLocalCryptoIndexedDbMock(
      [storedKey],
      { upgradeNeeded: true },
    )
    installCryptoMock(storedKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')
    await encryptLocalString('app-data', 'value')

    expect(indexedDbMock.createObjectStore).toHaveBeenCalledWith('keys')
  })

  it('closes the database when the key read request fails', async () => {
    const candidateKey = { id: 'candidate' } as unknown as CryptoKey
    const requestError = new Error('key request failed')
    const indexedDbMock = createLocalCryptoIndexedDbMock(
      [undefined],
      { getRequestErrorAt: 0, transactionError: requestError },
    )
    const cryptoMock = installCryptoMock(candidateKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')

    await expect(
      encryptLocalString('app-data', 'value'),
    ).rejects.toBe(requestError)
    expect(indexedDbMock.close).toHaveBeenCalledTimes(1)
    expect(cryptoMock.generateKey).not.toHaveBeenCalled()
  })

  it('aborts key installation when IndexedDB add throws synchronously', async () => {
    const candidateKey = { id: 'candidate' } as unknown as CryptoKey
    const addError = new Error('key add failed')
    const indexedDbMock = createLocalCryptoIndexedDbMock(
      [undefined, undefined],
      { addError },
    )
    installCryptoMock(candidateKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')

    await expect(
      encryptLocalString('app-data', 'value'),
    ).rejects.toBe(addError)
    expect(indexedDbMock.abort).toHaveBeenCalledTimes(1)
    expect(indexedDbMock.close).toHaveBeenCalledTimes(2)
  })

  it('preserves key installation and abort failures when the transaction state is unknown', async () => {
    const candidateKey = { id: 'candidate' } as unknown as CryptoKey
    const operationError = new Error('key add failed')
    const abortError = new Error('key abort failed')
    const indexedDbMock = createLocalCryptoIndexedDbMock(
      [undefined, undefined],
      { addError: operationError, abortError },
    )
    installCryptoMock(candidateKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')

    await expect(
      encryptLocalString('app-data', 'value'),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      cause: abortError,
      errors: [operationError, abortError],
    })

    expect(indexedDbMock.abort).toHaveBeenCalledTimes(1)
  })

  it('closes the database when key installation cannot start a transaction', async () => {
    const candidateKey = { id: 'candidate' } as unknown as CryptoKey
    const transactionError = new Error('key transaction failed')
    const indexedDbMock = createLocalCryptoIndexedDbMock(
      [undefined, undefined],
      { transactionError, transactionThrowAt: 1 },
    )
    installCryptoMock(candidateKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')

    await expect(
      encryptLocalString('app-data', 'value'),
    ).rejects.toBe(transactionError)
    expect(indexedDbMock.abort).not.toHaveBeenCalled()
    expect(indexedDbMock.close).toHaveBeenCalledTimes(2)
  })

  it('rejects when the asynchronous key add request fails', async () => {
    const candidateKey = { id: 'candidate' } as unknown as CryptoKey
    const addRequestError = new Error('key add request failed')
    const indexedDbMock = createLocalCryptoIndexedDbMock(
      [undefined, undefined],
      { addRequestError },
    )
    installCryptoMock(candidateKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')

    await expect(
      encryptLocalString('app-data', 'value'),
    ).rejects.toBe(addRequestError)
    expect(indexedDbMock.abort).not.toHaveBeenCalled()
    expect(indexedDbMock.close).toHaveBeenCalledTimes(2)
  })

  it('rejects a completed key transaction that selected no key', async () => {
    const candidateKey = { id: 'candidate' } as unknown as CryptoKey
    const indexedDbMock = createLocalCryptoIndexedDbMock(
      [undefined, undefined],
      { completeGetWithoutResultAt: 1 },
    )
    installCryptoMock(candidateKey)
    vi.stubGlobal('indexedDB', indexedDbMock.indexedDB)

    const { encryptLocalString } = await import('../localCrypto')

    await expect(
      encryptLocalString('app-data', 'value'),
    ).rejects.toThrow(
      'Local encryption key transaction completed without a key.',
    )
    expect(indexedDbMock.add).not.toHaveBeenCalled()
    expect(indexedDbMock.close).toHaveBeenCalledTimes(2)
  })
})
