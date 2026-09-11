import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { loadLocale, rt, setRuntimeLocale } from '../../i18n'
import type {
  AppData,
  EncryptedObjectEnvelope,
  IncrementalSyncHead,
  SyncVault,
} from '../../types'
import { accessKeyFromPassword } from '../accessKey'
import { defaultSkillSettings } from '../appData'
import { encryptVault } from '../crypto'
import {
  clearWithCloudflare,
  pullWithCloudflare,
  syncWithCloudflare,
} from '../syncCloudflare'
import {
  isSyncRemoteWriteDeferredError,
  serializeVault,
  type SyncContext,
} from '../syncShared'

const endpoint = 'https://sync.example.dev'
const passphrase = 'cloudflare test passphrase'
const initialSyncGeneration = '00000000-0000-4000-8000-000000000001'

beforeAll(async () => {
  await loadLocale('en-US')
  setRuntimeLocale('en-US')
})

let restoreFetch: (() => void) | null = null

afterEach(() => {
  restoreFetch?.()
  restoreFetch = null
})

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

function textResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
    },
  })
}

function snapshotEtag(content: string): string {
  let hash = 0x811c9dc5

  for (const character of content) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return `"snapshot-sha256-${hash.toString(16).padStart(8, '0').repeat(8)}"`
}

function createCloudflareWorkerStore(expectedToken: string) {
  let head: IncrementalSyncHead | null = null
  let generationCounter = 1
  let syncGeneration = initialSyncGeneration
  let snapshot: string | undefined
  let currentSnapshotEtag: string | undefined
  let incrementalUnsupported = false
  let bulkClearUnsupported = false
  let bulkClearGenerationHeaderEnabled = true
  let snapshotMissResponse: Response | null = null
  let blockedPutPath: string | null = null
  let rejectNextHeadPutAsConflict = false
  let rejectNextSnapshotPutAsConflict = false
  let rotateBeforePutPath: string | null = null
  let rotateAfterGetPath: string | null = null
  let markBlockedPutStarted = (): void => undefined
  const putFailures = new Map<string, string>()
  const deleteFailures = new Map<string, string>()
  const objects = new Map<string, EncryptedObjectEnvelope>()
  const calls: string[] = []

  const routeFailure = (
    failures: Map<string, string>,
    pathname: string,
  ): string | undefined =>
    failures.get(pathname) ??
    (pathname.startsWith('/sync/object/')
      ? failures.get('/sync/object/*')
      : undefined)

  const rotateSyncGeneration = (): string => {
    generationCounter += 1
    syncGeneration = `00000000-0000-4000-8000-${String(generationCounter).padStart(12, '0')}`
    return syncGeneration
  }

  return {
    calls: () => [...calls],
    clearCalls: () => {
      calls.length = 0
    },
    head: () => head,
    generation: () => syncGeneration,
    objectCount: () => objects.size,
    objectKeys: () => [...objects.keys()].sort(),
    setIncrementalUnsupported: (value: boolean) => {
      incrementalUnsupported = value
    },
    setBulkClearUnsupported: (value: boolean) => {
      bulkClearUnsupported = value
    },
    setBulkClearGenerationHeaderEnabled: (value: boolean) => {
      bulkClearGenerationHeaderEnabled = value
    },
    failPut: (path: string, message: string) => {
      putFailures.set(path, message)
    },
    conflictNextHeadPut: () => {
      rejectNextHeadPutAsConflict = true
    },
    conflictNextSnapshotPut: () => {
      rejectNextSnapshotPutAsConflict = true
    },
    rotateGenerationBeforeNextPut: (path: string) => {
      rotateBeforePutPath = path
    },
    rotateGenerationAfterNextGet: (path: string) => {
      rotateAfterGetPath = path
    },
    blockPutUntilAbort: (path: string): Promise<void> => {
      blockedPutPath = path
      return new Promise<void>((resolve) => {
        markBlockedPutStarted = resolve
      })
    },
    failDelete: (path: string, message: string) => {
      deleteFailures.set(path, message)
    },
    seedSnapshot: (content: string) => {
      snapshot = content
      currentSnapshotEtag = snapshotEtag(content)
    },
    setSnapshotEtag: (etag: string) => {
      currentSnapshotEtag = etag
    },
    snapshotMissBodyReads: () => Number(snapshotMissResponse?.bodyUsed ?? false),
    snapshot: () => snapshot,
    async handle(request: Request): Promise<Response | null> {
      const url = new URL(request.url)

      if (url.origin !== endpoint) {
        return null
      }

      const method = request.method.toUpperCase()
      calls.push(`${method} ${url.pathname}`)

      if (method === 'PUT' && rotateBeforePutPath === url.pathname) {
        rotateSyncGeneration()
        rotateBeforePutPath = null
      }

      if (request.headers.get('authorization') !== `Bearer ${expectedToken}`) {
        return textResponse('Unauthorized', 401)
      }

      if (url.pathname === '/sync/head') {
        if (method === 'GET') {
          if (incrementalUnsupported) {
            return textResponse('R2 binding zerochat_r2 is required', 501)
          }

          return head
            ? jsonResponse(head, 200, {
                'x-zerochat-sync-generation': syncGeneration,
              })
            : textResponse('', 404, {
                'x-zerochat-sync-generation': syncGeneration,
              })
        }

        if (method === 'PUT') {
          if (
            request.headers.get('x-zerochat-sync-generation') !== syncGeneration
          ) {
            return textResponse('Sync generation changed', 412)
          }
          if (blockedPutPath === url.pathname) {
            markBlockedPutStarted()
            return new Promise<Response>((_resolve, reject) => {
              const abort = () =>
                reject(new DOMException('Aborted', 'AbortError'))

              if (request.signal.aborted) {
                abort()
                return
              }

              request.signal.addEventListener('abort', abort, { once: true })
            })
          }

          const failure = routeFailure(putFailures, url.pathname)

          if (failure) {
            return textResponse(failure, 500)
          }

          if (rejectNextHeadPutAsConflict) {
            rejectNextHeadPutAsConflict = false
            return textResponse('Incremental head changed', 409)
          }

          const ifMatch = request.headers.get('if-match')
          const ifNoneMatch = request.headers.get('if-none-match')
          if (
            (head === null && ifNoneMatch !== '*') ||
            (head !== null && ifMatch !== `"${head.manifestKey}"`)
          ) {
            return textResponse('Incremental head changed', 409)
          }

          head = (await request.json()) as IncrementalSyncHead
          return jsonResponse(head)
        }

        if (method === 'DELETE') {
          if (
            request.headers.get('x-zerochat-sync-generation') !== syncGeneration
          ) {
            return textResponse('Sync generation changed', 412)
          }
          head = null
          return textResponse('OK')
        }
      }

      const objectMatch = url.pathname.match(/^\/sync\/object\/([^/]+)$/)

      if (objectMatch) {
        const key = decodeURIComponent(objectMatch[1])

        if (method === 'GET') {
          const object = objects.get(key)
          const response = object
            ? jsonResponse(object)
            : textResponse('Not found', 404)
          if (rotateAfterGetPath === '/sync/object/*') {
            rotateSyncGeneration()
            rotateAfterGetPath = null
          }
          return response
        }

        if (method === 'PUT') {
          if (
            request.headers.get('x-zerochat-sync-generation') !== syncGeneration
          ) {
            return textResponse('Sync generation changed', 412)
          }
          const failure = routeFailure(putFailures, url.pathname)

          if (failure) {
            return textResponse(failure, 500)
          }

          objects.set(key, (await request.json()) as EncryptedObjectEnvelope)
          return textResponse('OK')
        }

        if (method === 'DELETE') {
          if (
            request.headers.get('x-zerochat-sync-generation') !== syncGeneration
          ) {
            return textResponse('Sync generation changed', 412)
          }
          const failure = routeFailure(deleteFailures, url.pathname)

          if (failure) {
            return textResponse(failure, 500)
          }

          objects.delete(key)
          return textResponse('OK')
        }
      }

      if (url.pathname === '/snapshot') {
        if (method === 'GET') {
          if (snapshot) {
            const response = textResponse(snapshot, 200, {
              etag: currentSnapshotEtag ?? snapshotEtag(snapshot),
              'x-zerochat-sync-generation': syncGeneration,
            })
            if (rotateAfterGetPath === url.pathname) {
              rotateSyncGeneration()
              rotateAfterGetPath = null
            }
            return response
          }

          snapshotMissResponse = textResponse('', 404, {
            'x-zerochat-sync-generation': syncGeneration,
          })
          return snapshotMissResponse
        }

        if (method === 'PUT') {
          if (
            request.headers.get('x-zerochat-sync-generation') !== syncGeneration
          ) {
            return textResponse('Sync generation changed', 412)
          }
          const failure = routeFailure(putFailures, url.pathname)

          if (failure) {
            return textResponse(failure, 500)
          }

          if (rejectNextSnapshotPutAsConflict) {
            rejectNextSnapshotPutAsConflict = false
            return textResponse('Snapshot changed', 409)
          }

          const ifMatch = request.headers.get('if-match')
          const ifNoneMatch = request.headers.get('if-none-match')
          if (
            (snapshot === undefined && ifNoneMatch !== '*') ||
            (snapshot !== undefined && ifMatch !== currentSnapshotEtag)
          ) {
            return textResponse('Snapshot changed', 409)
          }

          snapshot = await request.text()
          currentSnapshotEtag = snapshotEtag(snapshot)
          return textResponse('OK', 200, { etag: currentSnapshotEtag })
        }

        if (method === 'DELETE') {
          if (
            request.headers.get('x-zerochat-sync-generation') !== syncGeneration
          ) {
            return textResponse('Sync generation changed', 412)
          }
          const failure = routeFailure(deleteFailures, url.pathname)

          if (failure) {
            return textResponse(failure, 500)
          }

          snapshot = undefined
          currentSnapshotEtag = undefined
          return textResponse('OK')
        }
      }

      if (url.pathname === '/sync/clear' && method === 'DELETE') {
        if (bulkClearUnsupported) {
          return textResponse('', 404)
        }

        head = null
        snapshot = undefined
        currentSnapshotEtag = undefined
        objects.clear()
        rotateSyncGeneration()
        return textResponse(
          'OK',
          200,
          bulkClearGenerationHeaderEnabled
            ? { 'x-zerochat-sync-generation': syncGeneration }
            : {},
        )
      }

      return textResponse('Unhandled route', 404)
    },
  }
}

function installCloudflareFetch(
  store: ReturnType<typeof createCloudflareWorkerStore>,
): void {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await store.handle(request)

    return response ?? originalFetch(request)
  }

  restoreFetch = () => {
    globalThis.fetch = originalFetch
  }
}

function appData(patch: Partial<AppData> = {}): AppData {
  return {
    conversations: [],
    preferences: {
      compactMode: false,
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [],
    skillSettings: defaultSkillSettings(),
    skills: [],
    sync: {
      autoSync: true,
      encryptionEnabled: true,
      mode: 'cloudflare',
      workerEndpoint: endpoint,
    },
    updatedAt: 10,
    version: 1,
    ...patch,
  }
}

function provider(id: string): AppData['providers'][number] {
  return {
    baseUrl: 'https://api.example.dev/v1',
    clientRequestMode: true,
    createdAt: 1,
    enabled: true,
    id,
    imageModel: 'gpt-image-1',
    kind: 'openai-compatible',
    model: 'gpt-5',
    models: ['gpt-5'],
    needsApiKey: true,
    name: id,
    updatedAt: 2,
  }
}

function syncContext(patch: Partial<SyncContext> = {}): SyncContext {
  return {
    encryptionPassphrase: passphrase,
    githubToken: '',
    providerKeys: {},
    ...patch,
  }
}

async function createInstalledStore() {
  const store = createCloudflareWorkerStore(
    await accessKeyFromPassword(passphrase),
  )
  installCloudflareFetch(store)

  return store
}

describe('Cloudflare sync transport', () => {
  it('rejects unsafe HTTPS Worker endpoints before remote sync starts', async () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = async () => {
      fetchCalls += 1
      throw new Error('remote fetch must not start')
    }
    restoreFetch = () => {
      globalThis.fetch = originalFetch
    }

    await expect(
      syncWithCloudflare(
        appData({
          sync: {
            autoSync: true,
            encryptionEnabled: true,
            mode: 'cloudflare',
            workerEndpoint: 'https://127.0.0.1:8443',
          },
        }),
        syncContext(),
      ),
    ).rejects.toThrow(
      rt('error.urlLocalNetwork', { label: rt('field.workerEndpoint') }),
    )
    expect(fetchCalls).toBe(0)
  })

  it('forwards runtime cancellation to the active Cloudflare request', async () => {
    const originalFetch = globalThis.fetch
    const source = new AbortController()
    let requestSignal: AbortSignal | null | undefined
    let markRequestStarted = (): void => undefined
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve
    })
    globalThis.fetch = async (_input, init) => {
      requestSignal = init?.signal
      markRequestStarted()
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    }
    restoreFetch = () => {
      globalThis.fetch = originalFetch
    }

    const operation = syncWithCloudflare(
      appData(),
      syncContext({ signal: source.signal }),
    )
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    })
    await requestStarted
    source.abort()

    await rejection
    expect(requestSignal?.aborted).toBe(true)
  })

  it('skips incremental upload rollback and preserves AbortError after head publish cancellation', async () => {
    const store = await createInstalledStore()
    const source = new AbortController()
    const headPublishStarted = store.blockPutUntilAbort('/sync/head')
    const operation = syncWithCloudflare(
      appData(),
      syncContext({ signal: source.signal }),
    )
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    })

    await headPublishStarted
    source.abort()
    await rejection

    expect(store.head()).toBeNull()
    expect(store.objectCount()).toBe(1)
    expect(store.calls()).toContain('PUT /sync/head')
    expect(
      store
        .calls()
        .some((call) => call.startsWith('DELETE /sync/object/')),
    ).toBe(false)
  })

  it('waits for all parallel chunk writes before rolling back a failed upload', async () => {
    const store = await createInstalledStore()
    const workerFetch = globalThis.fetch
    let firstObjectPut = true
    let secondObjectPut = true
    let markBlockedPutStarted = (): void => undefined
    const blockedPutStarted = new Promise<void>((resolve) => {
      markBlockedPutStarted = resolve
    })
    let blockedPutAborted = false
    let blockedPutSettled = false
    let releaseBlockedPut: (() => Promise<void>) | undefined

    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)

      if (
        request.method === 'PUT' &&
        url.pathname.startsWith('/sync/object/')
      ) {
        if (firstObjectPut) {
          firstObjectPut = false
          await workerFetch(request)
          markBlockedPutStarted()

          return new Promise<Response>((_resolve, reject) => {
            const abort = (): void => {
              blockedPutAborted = true
              request.signal.removeEventListener('abort', abort)
            }

            releaseBlockedPut = async () => {
              if (blockedPutSettled) return
              blockedPutSettled = true
              request.signal.removeEventListener('abort', abort)
              reject(new DOMException('Aborted', 'AbortError'))
            }

            if (request.signal.aborted) {
              abort()
              return
            }
            request.signal.addEventListener('abort', abort, { once: true })
          })
        }

        if (secondObjectPut) {
          secondObjectPut = false
          return textResponse('chunk upload failed', 500)
        }
      }

      return workerFetch(request)
    }

    const operation = syncWithCloudflare(
      appData({
        conversations: [
          {
            createdAt: 1,
            id: 'conversation-1',
            messages: [
              {
                content: 'first chunk',
                createdAt: 1,
                id: 'message-1',
                role: 'user',
                status: 'done',
              },
            ],
            model: 'gpt-5',
            providerId: 'provider-1',
            title: 'First',
            updatedAt: 1,
          },
          {
            createdAt: 2,
            id: 'conversation-2',
            messages: [
              {
                content: 'second chunk',
                createdAt: 2,
                id: 'message-2',
                role: 'user',
                status: 'done',
              },
            ],
            model: 'gpt-5',
            providerId: 'provider-1',
            title: 'Second',
            updatedAt: 2,
          },
        ],
      }),
      syncContext(),
    )
    let operationSettled = false
    const operationOutcome = operation.then(
      () => {
        operationSettled = true
        return { kind: 'resolved' as const }
      },
      (error: unknown) => {
        operationSettled = true
        return { error, kind: 'rejected' as const }
      },
    )

    await blockedPutStarted
    await vi.waitFor(() => expect(blockedPutAborted).toBe(true))
    expect(operationSettled).toBe(false)
    expect(store.objectCount()).toBe(1)
    expect(
      store
        .calls()
        .some((call) => call.startsWith('DELETE /sync/object/')),
    ).toBe(false)

    await releaseBlockedPut?.()

    const outcome = await operationOutcome
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') {
      expect(outcome.error).toMatchObject({ message: 'chunk upload failed' })
    }

    expect(store.objectCount()).toBe(0)
  })

  it('drains delayed chunk writes after external cancellation before preserving AbortError', async () => {
    const store = await createInstalledStore()
    const workerFetch = globalThis.fetch
    const source = new AbortController()
    let firstObjectPut = true
    let objectPutCount = 0
    let markBlockedPutStarted = (): void => undefined
    const blockedPutStarted = new Promise<void>((resolve) => {
      markBlockedPutStarted = resolve
    })
    let blockedPutAborted = false
    let siblingPutAborted = false
    let releaseBlockedPut: (() => void) | undefined

    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)

      if (
        request.method === 'PUT' &&
        url.pathname.startsWith('/sync/object/')
      ) {
        objectPutCount += 1
        if (firstObjectPut) {
          firstObjectPut = false
          await workerFetch(request)
          markBlockedPutStarted()

          return new Promise<Response>((_resolve, reject) => {
            const abort = (): void => {
              blockedPutAborted = true
              request.signal.removeEventListener('abort', abort)
            }

            releaseBlockedPut = () => {
              request.signal.removeEventListener('abort', abort)
              reject(new DOMException('Aborted', 'AbortError'))
            }

            if (request.signal.aborted) {
              abort()
              return
            }
            request.signal.addEventListener('abort', abort, { once: true })
          })
        }

        return new Promise<Response>((_resolve, reject) => {
          const abort = (): void => {
            siblingPutAborted = true
            request.signal.removeEventListener('abort', abort)
            reject(new DOMException('Aborted', 'AbortError'))
          }

          if (request.signal.aborted) {
            abort()
            return
          }
          request.signal.addEventListener('abort', abort, { once: true })
        })
      }

      return workerFetch(request)
    }

    const operation = syncWithCloudflare(
      appData({
        conversations: [
          {
            createdAt: 1,
            id: 'conversation-1',
            messages: [
              {
                content: 'first chunk',
                createdAt: 1,
                id: 'message-1',
                role: 'user',
                status: 'done',
              },
            ],
            model: 'gpt-5',
            providerId: 'provider-1',
            title: 'First',
            updatedAt: 1,
          },
          {
            createdAt: 2,
            id: 'conversation-2',
            messages: [
              {
                content: 'second chunk',
                createdAt: 2,
                id: 'message-2',
                role: 'user',
                status: 'done',
              },
            ],
            model: 'gpt-5',
            providerId: 'provider-1',
            title: 'Second',
            updatedAt: 2,
          },
        ],
      }),
      syncContext({ signal: source.signal }),
    )
    let operationSettled = false
    const operationOutcome = operation.then(
      () => {
        operationSettled = true
        return { kind: 'resolved' as const }
      },
      (error: unknown) => {
        operationSettled = true
        return { error, kind: 'rejected' as const }
      },
    )

    await blockedPutStarted
    expect(objectPutCount).toBe(2)
    source.abort()
    await vi.waitFor(() => expect(blockedPutAborted).toBe(true))
    expect(siblingPutAborted).toBe(true)
    expect(operationSettled).toBe(false)
    expect(store.objectCount()).toBe(1)
    expect(
      store
        .calls()
        .some((call) => call.startsWith('DELETE /sync/object/')),
    ).toBe(false)

    releaseBlockedPut?.()

    const outcome = await operationOutcome
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') {
      expect(outcome.error).toMatchObject({ name: 'AbortError' })
    }
    expect(store.objectCount()).toBe(1)
    expect(
      store
        .calls()
        .some((call) => call.startsWith('DELETE /sync/object/')),
    ).toBe(false)
  })

  it('drains empty legacy snapshot 404 bodies before first incremental upload', async () => {
    const store = await createInstalledStore()

    const result = await syncWithCloudflare(appData(), syncContext())

    expect(result.remoteAccepted).toBe(false)
    expect(result.message).toBe(rt('sync.status.incrementalComplete'))
    expect(store.snapshotMissBodyReads()).toBe(1)
    expect(store.calls()[0]).toBe('GET /sync/head')
    expect(store.calls()[1]).toBe('GET /snapshot')
    expect(store.calls()[2]).toMatch(/^PUT \/sync\/object\/manifest-/)
    expect(store.calls()).toContain('PUT /sync/head')
  })

  it('defers incremental uploads before any remote write when generation is pending', async () => {
    const store = await createInstalledStore()
    let caught: unknown

    try {
      await syncWithCloudflare(
        appData(),
        syncContext({
          shouldDeferRemoteWrite: () => true,
        }),
      )
    } catch (error: unknown) {
      caught = error
    }

    expect(isSyncRemoteWriteDeferredError(caught)).toBe(true)
    expect(store.calls()).toEqual(['GET /sync/head', 'GET /snapshot'])
    expect(store.head()).toBeNull()
    expect(store.objectCount()).toBe(0)
  })

  it('defers an incremental upload if its owner changes after the initial guard', async () => {
    const store = await createInstalledStore()
    let firstGuard = true

    await expect(
      syncWithCloudflare(
        appData(),
        syncContext({
          shouldDeferRemoteWrite: () => {
            if (firstGuard) {
              firstGuard = false
              return false
            }

            return true
          },
        }),
      ),
    ).rejects.toSatisfy((error: unknown) =>
      isSyncRemoteWriteDeferredError(error),
    )

    expect(store.calls()).toEqual(['GET /sync/head', 'GET /snapshot'])
    expect(store.head()).toBeNull()
    expect(store.objectCount()).toBe(0)
  })

  it('defers a legacy snapshot upload if its owner changes after the initial guard', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.seedSnapshot(
      await serializeVault(
        appData({ updatedAt: 5 }),
        { providerKeys: {} },
        passphrase,
      ),
    )
    let firstGuard = true

    await expect(
      syncWithCloudflare(
        appData({
          preferences: {
            compactMode: false,
            firstRunDone: true,
            language: 'system',
            theme: 'dark',
          },
        }),
        syncContext({
          firstSyncStrategy: 'use-local',
          shouldDeferRemoteWrite: () => {
            if (firstGuard) {
              firstGuard = false
              return false
            }

            return true
          },
        }),
      ),
    ).rejects.toSatisfy((error: unknown) =>
      isSyncRemoteWriteDeferredError(error),
    )

    expect(store.calls()).toEqual(['GET /sync/head', 'GET /snapshot'])
    expect(store.snapshot()).toBeDefined()
  })

  it('uploads encrypted incremental manifests and clears legacy snapshots', async () => {
    const store = await createInstalledStore()
    store.seedSnapshot(
      await serializeVault(
        appData({
          updatedAt: 5,
        }),
        {
          providerKeys: {},
        },
        passphrase,
      ),
    )

    const result = await syncWithCloudflare(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          lastSyncAt: 1,
          mode: 'cloudflare',
          workerEndpoint: endpoint,
        },
      }),
      syncContext(),
    )

    expect(result.remoteAccepted).toBe(false)
    expect(result.message).toBe(rt('sync.status.incrementalComplete'))
    expect(store.head()?.kind).toBe('zerochat.incrementalHead')
    expect(store.objectCount()).toBe(1)
    expect(store.snapshot()).toBeUndefined()
    expect(store.calls()[0]).toBe('GET /sync/head')
    expect(store.calls()[1]).toBe('GET /snapshot')
    expect(store.calls()[2]).toMatch(/^PUT \/sync\/object\/manifest-/)
    expect(store.calls()).toContain('PUT /sync/head')
    expect(store.calls()).toContain('DELETE /snapshot')
  })

  it('fails incremental sync when legacy snapshot cleanup fails after publish', async () => {
    const store = await createInstalledStore()
    store.seedSnapshot(
      await serializeVault(
        appData({
          updatedAt: 5,
        }),
        {
          providerKeys: {},
        },
        passphrase,
      ),
    )
    store.failDelete('/snapshot', 'Legacy snapshot cleanup failed')

    await expect(
      syncWithCloudflare(
        appData({
          sync: {
            autoSync: true,
            encryptionEnabled: true,
            lastSyncAt: 1,
            mode: 'cloudflare',
            workerEndpoint: endpoint,
          },
        }),
        syncContext(),
      ),
    ).rejects.toThrow(
      rt('error.syncCloudflareCleanupFailed', {
        message: 'Legacy snapshot cleanup failed',
      }),
    )

    expect(store.head()?.kind).toBe('zerochat.incrementalHead')
    expect(store.objectCount()).toBe(1)
    expect(store.snapshot()).toBeDefined()
    expect(store.calls()).toContain('PUT /sync/head')
    expect(store.calls()).toContain('DELETE /snapshot')
  })

  it('deletes every stale incremental object after publishing a replacement head', async () => {
    const store = await createInstalledStore()
    const firstData = appData({
      conversations: [
        {
          createdAt: 10,
          id: 'conversation-stale',
          messages: [
            {
              attachments: [
                {
                  createdAt: 10,
                  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
                  id: 'attachment-stale',
                  kind: 'image',
                  mimeType: 'image/png',
                  purpose: 'generated',
                },
              ],
              content: '',
              createdAt: 10,
              id: 'message-stale',
              role: 'assistant',
              status: 'done',
            },
          ],
          model: 'gpt-5',
          providerId: 'provider-1',
          title: 'Stale conversation',
          updatedAt: 10,
        },
      ],
      skills: [
        {
          autoMatch: true,
          chunks: [
            {
              content: 'stale skill content',
              heading: 'Stale chunk',
              id: 'skill-chunk-stale',
              keywords: ['stale'],
              tokenEstimate: 4,
            },
          ],
          contentHash: 'stale-content-hash',
          contentType: 'markdown',
          createdAt: 10,
          description: 'Stale skill',
          enabled: true,
          fixed: false,
          id: 'skill-stale',
          keywords: ['stale'],
          name: 'Stale skill',
          sourceSize: 19,
          updatedAt: 10,
        },
      ],
    })

    await syncWithCloudflare(firstData, syncContext())
    const staleKeys = store.objectKeys()

    expect(staleKeys.some((key) => key.startsWith('manifest-'))).toBe(true)
    expect(staleKeys.some((key) => key.startsWith('chunk-'))).toBe(true)
    expect(staleKeys.some((key) => key.startsWith('skill-'))).toBe(true)
    expect(staleKeys.some((key) => key.startsWith('attachment-'))).toBe(true)

    store.clearCalls()
    const result = await syncWithCloudflare(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          lastSyncAt: 10,
          mode: 'cloudflare',
          workerEndpoint: endpoint,
        },
        updatedAt: 20,
      }),
      syncContext(),
    )
    const replacementManifestKey = store.head()?.manifestKey

    expect(result.remoteAccepted).toBe(false)
    expect(replacementManifestKey).toBeDefined()
    expect(store.objectKeys()).toEqual([replacementManifestKey])
    expect(
      store
        .calls()
        .filter((call) => call.startsWith('DELETE /sync/object/'))
        .sort(),
    ).toEqual(
      staleKeys.map((key) => `DELETE /sync/object/${key}`).sort(),
    )
  })

  it('keeps immutable upload objects when head publish outcome is ambiguous', async () => {
    const store = await createInstalledStore()
    store.failPut('/sync/head', 'Head publish failed')

    await expect(syncWithCloudflare(appData(), syncContext())).rejects.toThrow(
      'Head publish failed',
    )

    expect(store.head()).toBeNull()
    expect(store.objectCount()).toBe(1)
    expect(store.calls()).toContain('PUT /sync/head')
    expect(
      store
        .calls()
        .some((call) => call.startsWith('DELETE /sync/object/manifest-')),
    ).toBe(false)
  })

  it('does not issue stale cleanup after the sync generation changes', async () => {
    const store = await createInstalledStore()
    store.rotateGenerationBeforeNextPut('/sync/head')

    await expect(syncWithCloudflare(appData(), syncContext())).rejects.toThrow(
      rt('error.remoteUpdated'),
    )

    expect(store.objectCount()).toBe(1)
    expect(store.calls()).toContain('PUT /sync/head')
    expect(
      store.calls().some((call) => call.startsWith('DELETE /sync/object/')),
    ).toBe(false)
  })

  it('rolls back unpublished objects after a definitive head conflict', async () => {
    const store = await createInstalledStore()
    store.conflictNextHeadPut()

    await expect(syncWithCloudflare(appData(), syncContext())).rejects.toThrow(
      rt('error.remoteUpdated'),
    )

    expect(store.head()).toBeNull()
    expect(store.objectCount()).toBe(0)
    expect(
      store
        .calls()
        .some((call) => call.startsWith('DELETE /sync/object/manifest-')),
    ).toBe(true)
  })

  it('reports rollback cleanup failures after a definitive head conflict', async () => {
    const store = await createInstalledStore()
    store.conflictNextHeadPut()
    store.failDelete('/sync/object/*', 'Rollback delete failed')

    await expect(syncWithCloudflare(appData(), syncContext())).rejects.toThrow(
      rt('error.syncCloudflareCleanupFailed', {
        message: 'Rollback delete failed',
      }),
    )

    expect(store.head()).toBeNull()
    expect(store.objectCount()).toBe(1)
    expect(store.calls()).toContain('PUT /sync/head')
    expect(
      store
        .calls()
        .some((call) => call.startsWith('DELETE /sync/object/manifest-')),
    ).toBe(true)
  })

  it('pulls and accepts a newer encrypted incremental vault with provider secrets', async () => {
    const store = await createInstalledStore()
    const remote = appData({
      sync: {
        autoSync: true,
        encryptionEnabled: true,
        lastSyncAt: 20,
        mode: 'cloudflare',
        workerEndpoint: endpoint,
      },
      updatedAt: 30,
    })

    await syncWithCloudflare(
      remote,
      syncContext({
        providerKeys: {
          providerRemote: 'remote-key',
        },
      }),
    )
    store.clearCalls()

    const result = await pullWithCloudflare(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          lastSyncAt: 5,
          mode: 'cloudflare',
          workerEndpoint: endpoint,
        },
        updatedAt: 10,
      }),
      syncContext(),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(result.data.updatedAt).toBe(30)
    expect(result.secrets?.providerKeys).toEqual({
      providerRemote: 'remote-key',
    })
    expect(store.calls()[0]).toBe('GET /sync/head')
    expect(store.calls()[1]).toMatch(/^GET \/sync\/object\/manifest-/)
  })

  it('rejects an incremental pull when clear rotates generation during readback', async () => {
    const store = await createInstalledStore()
    await syncWithCloudflare(
      appData({ updatedAt: 30 }),
      syncContext({ providerKeys: { providerRemote: 'remote-key' } }),
    )
    store.clearCalls()
    store.rotateGenerationAfterNextGet('/sync/object/*')

    await expect(
      pullWithCloudflare(
        appData({ updatedAt: 10 }),
        syncContext(),
      ),
    ).rejects.toThrow(rt('error.remoteUpdated'))

    expect(store.calls().filter((call) => call === 'GET /sync/head')).toHaveLength(2)
  }, 15_000)

  it('clears Cloudflare data through the Worker bulk clear endpoint', async () => {
    const store = await createInstalledStore()
    await syncWithCloudflare(appData(), syncContext())
    store.clearCalls()

    const result = await clearWithCloudflare(appData(), syncContext())

    expect(result.remoteAccepted).toBe(false)
    expect(result.message).toBe(rt('sync.status.remoteCleared'))
    expect(store.head()).toBeNull()
    expect(store.objectCount()).toBe(0)
    expect(store.snapshot()).toBeUndefined()
    expect(store.calls()).toEqual(['DELETE /sync/clear'])
  })

  it('defers Cloudflare bulk clear before the destructive request', async () => {
    const store = await createInstalledStore()
    let caught: unknown

    try {
      await clearWithCloudflare(
        appData(),
        syncContext({ shouldDeferRemoteWrite: () => true }),
      )
    } catch (error: unknown) {
      caught = error
    }

    expect(isSyncRemoteWriteDeferredError(caught)).toBe(true)
    expect(store.calls()).toEqual([])
  })

  it('defers passphrase-rotation cleanup when the sync owner is stale', async () => {
    const store = await createInstalledStore()
    let caught: unknown

    try {
      await syncWithCloudflare(
        appData(),
        syncContext({
          allowPassphraseRotation: true,
          shouldDeferRemoteWrite: () => true,
        }),
      )
    } catch (error: unknown) {
      caught = error
    }

    expect(isSyncRemoteWriteDeferredError(caught)).toBe(true)
    expect(store.calls()).toEqual([])
  })

  it('does not run incremental cleanup after the sync owner changes', async () => {
    const store = await createInstalledStore()
    const firstData = appData({
      conversations: [
        {
          createdAt: 1,
          id: 'cleanup-conversation',
          messages: [
            {
              attachments: [],
              content: 'old remote content',
              createdAt: 1,
              id: 'cleanup-message',
              role: 'user',
              status: 'done',
            },
          ],
          model: 'gpt-5',
          providerId: 'provider-1',
          title: 'Cleanup conversation',
          updatedAt: 1,
        },
      ],
      sync: {
        ...appData().sync,
        lastSyncAt: 1,
      },
      updatedAt: 10,
    })

    await syncWithCloudflare(firstData, syncContext())
    store.clearCalls()

    let guardCalls = 0
    const secondData = appData({
      sync: {
        ...appData().sync,
        lastSyncAt: 2,
      },
      updatedAt: 20,
    })

    let caught: unknown
    try {
      await syncWithCloudflare(
        secondData,
        syncContext({
          shouldDeferRemoteWrite: () => ++guardCalls > 3,
        }),
      )
    } catch (error: unknown) {
      caught = error
    }

    expect(caught).toBeDefined()
    expect(guardCalls).toBeGreaterThan(3)
    expect(
      store.calls().some((call) => call.startsWith('DELETE ')),
    ).toBe(false)
  })

  it('rejects a successful bulk clear response without a valid rotated generation', async () => {
    const store = await createInstalledStore()
    store.setBulkClearGenerationHeaderEnabled(false)

    await expect(clearWithCloudflare(appData(), syncContext())).rejects.toThrow(
      rt('error.remoteUpdated'),
    )
  })

  it('rotates Cloudflare generation on every bulk clear', async () => {
    const store = await createInstalledStore()
    const initialGeneration = store.generation()

    await clearWithCloudflare(appData(), syncContext())
    const firstClearedGeneration = store.generation()
    await clearWithCloudflare(appData(), syncContext())
    const secondClearedGeneration = store.generation()

    expect(firstClearedGeneration).not.toBe(initialGeneration)
    expect(secondClearedGeneration).not.toBe(firstClearedGeneration)
    expect(store.calls()).toEqual([
      'DELETE /sync/clear',
      'DELETE /sync/clear',
    ])
  })

  it('fails closed without mutating remote data when bulk clear is unsupported', async () => {
    const store = await createInstalledStore()
    await syncWithCloudflare(appData(), syncContext())
    const originalHead = store.head()
    const originalObjectCount = store.objectCount()
    const legacySnapshot = await serializeVault(
      appData({
        updatedAt: 3,
      }),
      {
        providerKeys: {},
      },
      passphrase,
    )
    store.seedSnapshot(legacySnapshot)
    store.setBulkClearUnsupported(true)
    store.clearCalls()

    await expect(clearWithCloudflare(appData(), syncContext())).rejects.toThrow(
      rt('error.clearCloudUpdateWorker'),
    )

    expect(store.head()).toEqual(originalHead)
    expect(store.objectCount()).toBe(originalObjectCount)
    expect(store.snapshot()).toBe(legacySnapshot)
    expect(store.calls()).toEqual(['DELETE /sync/clear'])
  })

  it('falls back to encrypted snapshot sync when incremental Worker APIs are unsupported', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.seedSnapshot(
      await serializeVault(
        appData({
          sync: {
            autoSync: true,
            encryptionEnabled: true,
            lastSyncAt: 20,
            mode: 'cloudflare',
            workerEndpoint: endpoint,
          },
          updatedAt: 30,
        }),
        {
          providerKeys: {
            providerRemote: 'snapshot-key',
          },
        },
        passphrase,
      ),
    )

    const result = await pullWithCloudflare(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          lastSyncAt: 5,
          mode: 'cloudflare',
          workerEndpoint: endpoint,
        },
        updatedAt: 10,
      }),
      syncContext(),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(result.data.updatedAt).toBe(30)
    expect(result.secrets?.providerKeys).toEqual({
      providerRemote: 'snapshot-key',
    })
    expect(store.calls()).toEqual([
      'GET /sync/head',
      'GET /snapshot',
      'GET /snapshot',
    ])
  })

  it('rejects a fallback snapshot without a strong content-bound ETag', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.seedSnapshot(
      await serializeVault(
        appData({ updatedAt: 30 }),
        { providerKeys: {} },
        passphrase,
      ),
    )
    store.setSnapshotEtag('W/"weak-snapshot"')

    await expect(
      pullWithCloudflare(appData({ updatedAt: 10 }), syncContext()),
    ).rejects.toThrow(rt('error.remoteUpdated'))

    expect(store.calls()).toEqual(['GET /sync/head', 'GET /snapshot'])
  })

  it('rejects a malformed encrypted fallback snapshot', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.seedSnapshot(JSON.stringify(await encryptVault(
      {
        data: { updatedAt: 10 },
        secrets: { providerKeys: {} },
      } as unknown as SyncVault,
      passphrase,
    )))

    await expect(
      pullWithCloudflare(appData({ updatedAt: 10 }), syncContext()),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))

    expect(store.calls()).toEqual(['GET /sync/head', 'GET /snapshot'])
  })

  it('revalidates an older fallback snapshot before reporting up to date', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.seedSnapshot(
      await serializeVault(
        appData({ updatedAt: 5 }),
        { providerKeys: { remote: 'older-key' } },
        passphrase,
      ),
    )

    const result = await pullWithCloudflare(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          lastSyncAt: 8,
          mode: 'cloudflare',
          workerEndpoint: endpoint,
        },
        updatedAt: 10,
      }),
      syncContext({ providerKeys: { local: 'newer-key' } }),
    )

    expect(result.remoteAccepted).toBe(false)
    expect(result.message).toBe(rt('sync.status.upToDate'))
    expect(result.secrets).toEqual({ providerKeys: { local: 'newer-key' } })
    expect(store.calls()).toEqual([
      'GET /sync/head',
      'GET /snapshot',
      'GET /snapshot',
    ])
  })

  it('revalidates and accepts a requested remote fallback snapshot without writing', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.seedSnapshot(
      await serializeVault(
        appData({ updatedAt: 30 }),
        { providerKeys: { remote: 'remote-key' } },
        passphrase,
      ),
    )

    const result = await syncWithCloudflare(
      appData({ updatedAt: 10 }),
      syncContext({ firstSyncStrategy: 'use-remote' }),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(result.data.updatedAt).toBe(30)
    expect(result.secrets).toEqual({ providerKeys: { remote: 'remote-key' } })
    expect(store.calls()).toEqual([
      'GET /sync/head',
      'GET /snapshot',
      'GET /snapshot',
    ])
  })

  it('rejects a snapshot pull when clear rotates generation after the read', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.seedSnapshot(
      await serializeVault(
        appData({ updatedAt: 30 }),
        { providerKeys: { providerRemote: 'snapshot-key' } },
        passphrase,
      ),
    )
    store.rotateGenerationAfterNextGet('/snapshot')

    await expect(
      pullWithCloudflare(appData({ updatedAt: 10 }), syncContext()),
    ).rejects.toThrow(rt('error.remoteUpdated'))

    expect(store.calls()).toEqual([
      'GET /sync/head',
      'GET /snapshot',
      'GET /snapshot',
    ])
  })

  it('creates the first fallback snapshot with an exclusive precondition', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)

    const result = await syncWithCloudflare(appData(), syncContext())

    expect(result.remoteAccepted).toBe(false)
    expect(store.snapshot()).toBeDefined()
    expect(store.calls()).toEqual([
      'GET /sync/head',
      'GET /snapshot',
      'PUT /snapshot',
    ])
  })

  it('rejects a fallback snapshot replacement when the read ETag became stale', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.seedSnapshot(
      await serializeVault(
        appData({ updatedAt: 5 }),
        { providerKeys: {} },
        passphrase,
      ),
    )
    store.conflictNextSnapshotPut()

    await expect(
      syncWithCloudflare(
        appData({
          sync: {
            autoSync: true,
            encryptionEnabled: true,
            lastSyncAt: 1,
            mode: 'cloudflare',
            workerEndpoint: endpoint,
          },
        }),
        syncContext(),
      ),
    ).rejects.toThrow(rt('error.remoteUpdated'))

    expect(store.calls()).toEqual([
      'GET /sync/head',
      'GET /snapshot',
      'PUT /snapshot',
    ])
  })

  it('merges local content into a legacy snapshot during first sync', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.seedSnapshot(
      await serializeVault(
        appData({
          providers: [provider('remote-provider')],
          updatedAt: 30,
          sync: {
            autoSync: true,
            encryptionEnabled: true,
            lastSyncAt: 20,
            mode: 'cloudflare',
            workerEndpoint: endpoint,
          },
        }),
        { providerKeys: { remote: 'remote-key' } },
        passphrase,
      ),
    )

    const local = appData({
      conversations: [
        {
          createdAt: 1,
          id: 'local-conversation',
          messages: [],
          model: 'gpt-5',
          providerId: 'local-provider',
          title: 'Local content',
          updatedAt: 10,
        },
      ],
      providers: [provider('local-provider')],
      updatedAt: 10,
    })
    const result = await syncWithCloudflare(
      local,
      syncContext({
        firstSyncStrategy: 'merge',
        providerKeys: { local: 'local-key' },
      }),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(result.data.providers.map(({ id }) => id).sort()).toEqual([
      'local-provider',
      'remote-provider',
    ])
    expect(result.secrets).toEqual({
      providerKeys: { local: 'local-key', remote: 'remote-key' },
    })
    expect(store.snapshot()).toBeDefined()
  })

  it('merges local content into an incremental remote vault during first sync', async () => {
    const store = await createInstalledStore()
    await syncWithCloudflare(
      appData({
        providers: [provider('remote-provider')],
        updatedAt: 30,
      }),
      syncContext({ providerKeys: { remote: 'remote-key' } }),
    )
    store.clearCalls()

    const local = appData({
      conversations: [
        {
          createdAt: 1,
          id: 'local-conversation',
          messages: [],
          model: 'gpt-5',
          providerId: 'local-provider',
          title: 'Local content',
          updatedAt: 10,
        },
      ],
      providers: [provider('local-provider')],
      updatedAt: 10,
    })
    const result = await syncWithCloudflare(
      local,
      syncContext({
        firstSyncStrategy: 'merge',
        providerKeys: { local: 'local-key' },
      }),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(result.data.providers.map(({ id }) => id).sort()).toEqual([
      'local-provider',
      'remote-provider',
    ])
    expect(result.message).toBe(rt('sync.status.merged'))
    expect(store.calls()).toContain('PUT /sync/head')
  })

  it('accepts a newer incremental remote vault without publishing local data', async () => {
    const store = await createInstalledStore()
    await syncWithCloudflare(
      appData({ updatedAt: 30 }),
      syncContext({ providerKeys: { remote: 'remote-key' } }),
    )
    store.clearCalls()

    const result = await syncWithCloudflare(
      appData({
        updatedAt: 10,
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          lastSyncAt: 5,
          mode: 'cloudflare',
          workerEndpoint: endpoint,
        },
      }),
      syncContext({ firstSyncStrategy: 'use-remote' }),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(result.data.updatedAt).toBe(30)
    expect(result.secrets).toEqual({ providerKeys: { remote: 'remote-key' } })
    expect(store.calls().some((call) => call.startsWith('PUT '))).toBe(false)
  })

  it('migrates a legacy snapshot into incremental storage while merging first-sync content', async () => {
    const store = await createInstalledStore()
    store.seedSnapshot(
      await serializeVault(
        appData({
          providers: [provider('remote-provider')],
          updatedAt: 30,
          sync: {
            autoSync: true,
            encryptionEnabled: true,
            lastSyncAt: 20,
            mode: 'cloudflare',
            workerEndpoint: endpoint,
          },
        }),
        { providerKeys: { remote: 'remote-key' } },
        passphrase,
      ),
    )

    const local = appData({
      conversations: [
        {
          createdAt: 1,
          id: 'local-conversation',
          messages: [],
          model: 'gpt-5',
          providerId: 'local-provider',
          title: 'Local content',
          updatedAt: 10,
        },
      ],
      providers: [provider('local-provider')],
      updatedAt: 10,
    })
    const result = await syncWithCloudflare(
      local,
      syncContext({
        firstSyncStrategy: 'merge',
        providerKeys: { local: 'local-key' },
      }),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(store.head()?.kind).toBe('zerochat.incrementalHead')
    expect(store.snapshot()).toBeUndefined()
    expect(store.calls()).toContain('DELETE /snapshot')
  })

  it('accepts a newer legacy snapshot during incremental migration without writing', async () => {
    const store = await createInstalledStore()
    store.seedSnapshot(
      await serializeVault(
        appData({
          updatedAt: 30,
          sync: {
            autoSync: true,
            encryptionEnabled: true,
            lastSyncAt: 20,
            mode: 'cloudflare',
            workerEndpoint: endpoint,
          },
        }),
        { providerKeys: { remote: 'remote-key' } },
        passphrase,
      ),
    )

    const result = await syncWithCloudflare(
      appData({
        updatedAt: 10,
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          lastSyncAt: 5,
          mode: 'cloudflare',
          workerEndpoint: endpoint,
        },
      }),
      syncContext({ firstSyncStrategy: 'use-remote' }),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(result.data.updatedAt).toBe(30)
    expect(store.calls()).toEqual(['GET /sync/head', 'GET /snapshot', 'GET /snapshot'])
  })

  it('merges a first-sync incremental pull and preserves the remote state', async () => {
    const store = await createInstalledStore()
    await syncWithCloudflare(
      appData({
        providers: [provider('remote-provider')],
        updatedAt: 30,
      }),
      syncContext({ providerKeys: { remote: 'remote-key' } }),
    )
    store.clearCalls()

    const result = await pullWithCloudflare(
      appData({
        conversations: [
          {
            createdAt: 1,
            id: 'local-conversation',
            messages: [],
            model: 'gpt-5',
            providerId: 'local-provider',
            title: 'Local content',
            updatedAt: 10,
          },
        ],
        providers: [provider('local-provider')],
        updatedAt: 10,
      }),
      syncContext({
        firstSyncStrategy: 'merge',
        providerKeys: { local: 'local-key' },
      }),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(result.data.providers.map(({ id }) => id).sort()).toEqual([
      'local-provider',
      'remote-provider',
    ])
    expect(result.message).toBe(rt('sync.status.merged'))
    expect(store.calls()).toContain('PUT /sync/head')
  })

  it('keeps a newer local vault when pulling an older incremental remote', async () => {
    const store = await createInstalledStore()
    await syncWithCloudflare(appData({ updatedAt: 5 }), syncContext())
    store.clearCalls()

    const result = await pullWithCloudflare(
      appData({
        updatedAt: 10,
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          lastSyncAt: 8,
          mode: 'cloudflare',
          workerEndpoint: endpoint,
        },
      }),
      syncContext(),
    )

    expect(result.remoteAccepted).toBe(false)
    expect(result.message).toBe(rt('sync.status.upToDate'))
    expect(result.data.updatedAt).toBe(10)
    expect(store.calls()).toEqual([
      'GET /sync/head',
      expect.stringMatching(/^GET \/sync\/object\/manifest-/),
      'GET /sync/head',
    ])
  })

  it('falls back to the snapshot pull path when an incremental head is empty', async () => {
    const store = await createInstalledStore()

    const result = await pullWithCloudflare(appData(), syncContext())

    expect(result.remoteAccepted).toBe(false)
    expect(result.message).toBe(rt('sync.status.upToDate'))
    expect(store.calls()).toEqual([
      'GET /sync/head',
      'GET /snapshot',
      'GET /snapshot',
    ])
  })

  it('fails closed for empty sync passphrases before making a request', async () => {
    const store = await createInstalledStore()

    await expect(
      syncWithCloudflare(appData(), syncContext({ encryptionPassphrase: '' })),
    ).rejects.toThrow(rt('error.syncPassphraseRequired'))
    await expect(
      pullWithCloudflare(appData(), syncContext({ encryptionPassphrase: '' })),
    ).rejects.toThrow(rt('error.syncPassphraseRequired'))

    expect(store.calls()).toEqual([])
  })

  it('reports snapshot write failures without treating them as remote conflicts', async () => {
    const store = await createInstalledStore()
    store.setIncrementalUnsupported(true)
    store.failPut('/snapshot', 'Snapshot write failed')

    await expect(syncWithCloudflare(appData(), syncContext())).rejects.toThrow(
      'Snapshot write failed',
    )

    expect(store.calls()).toEqual([
      'GET /sync/head',
      'GET /snapshot',
      'PUT /snapshot',
    ])
  })
})
