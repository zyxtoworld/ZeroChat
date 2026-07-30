import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { loadLocale, rt, setRuntimeLocale } from '../../i18n'
import type {
  AppData,
  ChatMessage,
  Conversation,
  ProviderConfig,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import { clearWithGist, pullWithGist, syncWithGist } from '../syncGist'
import {
  gistOperationIdFromFileName,
  parseGistOperation,
} from '../syncGistProtocol'
import {
  DEFAULT_GIST_FILE,
  isSyncRemoteWriteDeferredError,
  serializeVault,
  type SyncContext,
} from '../syncShared'

const githubToken = 'gist-test-token'
const passphrase = 'gist test passphrase'

beforeAll(async () => {
  await loadLocale('en-US')
  setRuntimeLocale('en-US')
})

let restoreFetch: (() => void) | null = null

afterEach(() => {
  restoreFetch?.()
  restoreFetch = null
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function createGistStore() {
  const gists = new Map<
    string,
    {
      description: string
      files: Map<string, string>
      id: string
      public: boolean
    }
  >()
  const calls: string[] = []
  let nextId = 1
  let failPatchAfterApply = false
  let patchGate:
    | {
        arrived: Promise<void>
        markArrived: () => void
        release: Promise<void>
        releasePatches: () => void
        remaining: number
      }
    | undefined

  function publicGist(gist: NonNullable<ReturnType<typeof gists.get>>) {
    return {
      description: gist.description,
      files: Object.fromEntries(
        Array.from(gist.files.entries()).map(([name, content]) => [
          name,
          {
            content,
            filename: name,
            size: content.length,
          },
        ]),
      ),
      id: gist.id,
      public: gist.public,
    }
  }

  function applyFiles(
    gist: NonNullable<ReturnType<typeof gists.get>>,
    files: Record<string, { content?: unknown } | null> = {},
  ): void {
    for (const [name, value] of Object.entries(files)) {
      if (value === null) {
        gist.files.delete(name)
        continue
      }

      gist.files.set(name, String(value?.content ?? ''))
    }
  }

  return {
    calls: () => [...calls],
    failNextPatchAfterApply: () => {
      failPatchAfterApply = true
    },
    file: (gistId: string, fileName: string) =>
      gists.get(gistId)?.files.get(fileName),
    files: (gistId: string) =>
      new Map(gists.get(gistId)?.files ?? []),
    holdNextPatches(count: number) {
      let markArrived = (): void => undefined
      let releasePatches = (): void => undefined
      const arrived = new Promise<void>((resolve) => {
        markArrived = resolve
      })
      const release = new Promise<void>((resolve) => {
        releasePatches = resolve
      })
      patchGate = {
        arrived,
        markArrived,
        release,
        releasePatches,
        remaining: count,
      }

      return { arrived, release: releasePatches }
    },
    async handle(request: Request): Promise<Response | null> {
      const url = new URL(request.url)

      if (url.origin !== 'https://api.github.com') {
        return null
      }

      const method = request.method.toUpperCase()
      calls.push(`${method} ${url.pathname}`)

      if (request.headers.get('authorization') !== `Bearer ${githubToken}`) {
        return jsonResponse({ message: 'Bad credentials' }, 401)
      }

      if (url.pathname === '/gists' && method === 'POST') {
        const body = await request.json()
        const id = `gist-${nextId}`
        nextId += 1
        const gist = {
          description: String(body.description ?? ''),
          files: new Map<string, string>(),
          id,
          public: Boolean(body.public),
        }

        applyFiles(gist, body.files)
        gists.set(id, gist)

        return jsonResponse(publicGist(gist), 201)
      }

      const match = url.pathname.match(/^\/gists\/([^/]+)$/)

      if (!match) {
        return jsonResponse({ message: 'Unhandled route' }, 404)
      }

      const gist = gists.get(match[1])

      if (!gist) {
        return jsonResponse({ message: 'Not Found' }, 404)
      }

      if (method === 'GET') {
        return jsonResponse(publicGist(gist))
      }

      if (method === 'PATCH') {
        const body = await request.json()

        if (patchGate && patchGate.remaining > 0) {
          const gate = patchGate
          gate.remaining -= 1
          if (gate.remaining === 0) {
            gate.markArrived()
          }
          await gate.release
          if (gate.remaining === 0) {
            patchGate = undefined
          }
        }

        applyFiles(gist, body.files)

        if (failPatchAfterApply) {
          failPatchAfterApply = false
          throw new TypeError('Simulated lost PATCH response')
        }

        return jsonResponse(publicGist(gist))
      }

      return jsonResponse({ message: 'Unhandled method' }, 405)
    },
    seed: (gistId: string, fileName: string, content: string) => {
      gists.set(gistId, {
        description: 'Seeded encrypted vault',
        files: new Map([[fileName, content]]),
        id: gistId,
        public: false,
      })
    },
  }
}

function installGistFetch(store: ReturnType<typeof createGistStore>): void {
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

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider',
    kind: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    model: 'model-1',
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function message(id: string, createdAt: number): ChatMessage {
  return {
    id,
    role: 'user',
    content: id,
    createdAt,
    status: 'done',
  }
}

function conversation(
  messages: ChatMessage[] = [],
  patch: Partial<Conversation> = {},
): Conversation {
  return {
    id: 'conversation-1',
    title: 'Conversation',
    providerId: 'provider-1',
    model: 'model-1',
    messages,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function appData(patch: Partial<AppData> = {}): AppData {
  const sync = patch.sync ?? {
    autoSync: true,
    encryptionEnabled: true,
    mode: 'gist' as const,
  }

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
    sync,
    updatedAt: 10,
    version: 1,
    ...patch,
  }
}

function chatData(messages: ChatMessage[] = []): AppData {
  return appData({
    providers: [provider()],
    conversations: [conversation(messages)],
  })
}

function syncContext(patch: Partial<SyncContext> = {}): SyncContext {
  return {
    encryptionPassphrase: passphrase,
    githubToken,
    providerKeys: {},
    ...patch,
  }
}

function operationFiles(store: ReturnType<typeof createGistStore>, gistId: string) {
  return [...store.files(gistId)].filter(
    ([name]) => gistOperationIdFromFileName(DEFAULT_GIST_FILE, name) !== null,
  )
}

describe('Gist sync transport', () => {
  it('forwards runtime cancellation to the active Gist request', async () => {
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

    const operation = syncWithGist(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-1',
          mode: 'gist',
        },
      }),
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

  it('creates a private Gist with one immutable encrypted operation', async () => {
    const store = createGistStore()
    installGistFetch(store)

    const result = await syncWithGist(appData(), syncContext())
    const files = operationFiles(store, 'gist-1')
    const operationId = gistOperationIdFromFileName(DEFAULT_GIST_FILE, files[0]![0])
    const stored = await parseGistOperation(
      files[0]![1],
      passphrase,
      operationId!,
    )

    expect(result.remoteAccepted).toBe(false)
    expect(result.data.sync.gistId).toBe('gist-1')
    expect(result.data.sync.gistFile).toBe(DEFAULT_GIST_FILE)
    expect(files).toHaveLength(1)
    expect(store.file('gist-1', DEFAULT_GIST_FILE)).toBeUndefined()
    expect(stored.operation).toBe('state')
    expect(store.calls()).toEqual(['POST /gists'])
  }, 20_000)

  it('rejects a successful Gist create response without an id', async () => {
    const originalFetch = globalThis.fetch
    const requests: Request[] = []
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      return jsonResponse({}, 201)
    }
    restoreFetch = () => {
      globalThis.fetch = originalFetch
    }

    await expect(syncWithGist(appData(), syncContext())).rejects.toThrow(
      rt('error.syncGistIdMissing'),
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.url).toBe('https://api.github.com/gists')
  })

  it('adds encrypted state to an existing Gist without deleting user files', async () => {
    const store = createGistStore()
    installGistFetch(store)
    store.seed('gist-existing', 'notes.txt', 'keep this file')

    const result = await syncWithGist(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-existing',
          mode: 'gist',
        },
      }),
      syncContext(),
    )

    expect(result.remoteAccepted).toBe(false)
    expect(store.file('gist-existing', 'notes.txt')).toBe('keep this file')
    expect(operationFiles(store, 'gist-existing')).toHaveLength(1)
    expect(store.calls()).toEqual([
      'GET /gists/gist-existing',
      'PATCH /gists/gist-existing',
    ])
  }, 20_000)

  it('rejects a truncated Gist file raw URL outside GitHub Gist before fetching it', async () => {
    const originalFetch = globalThis.fetch
    const requestedUrls: string[] = []
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      requestedUrls.push(request.url)
      if (request.url !== 'https://api.github.com/gists/gist-host-validation') {
        throw new Error('Unexpected raw file request')
      }
      return jsonResponse({
        id: 'gist-host-validation',
        files: {
          [DEFAULT_GIST_FILE]: {
            raw_url: 'https://attacker.example/zerochat-sync.json',
            truncated: true,
          },
        },
      })
    }
    restoreFetch = () => {
      globalThis.fetch = originalFetch
    }

    await expect(
      pullWithGist(
        appData({
          sync: {
            autoSync: true,
            encryptionEnabled: true,
            gistId: 'gist-host-validation',
            mode: 'gist',
          },
        }),
        syncContext(),
      ),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
    expect(requestedUrls).toEqual([
      'https://api.github.com/gists/gist-host-validation',
    ])
  })

  it('loads a truncated encrypted vault only from the exact GitHub Gist raw host', async () => {
    const originalFetch = globalThis.fetch
    const remote = appData({ updatedAt: 30 })
    const serialized = await serializeVault(
      remote,
      { providerKeys: { providerRemote: 'remote-key' } },
      passphrase,
    )
    const rawUrl =
      'https://gist.githubusercontent.com/zerochat/revision/raw/zerochat-sync.json'
    const requests: Array<{ authorization: string | null; url: string }> = []

    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      requests.push({
        authorization: request.headers.get('authorization'),
        url: request.url,
      })

      if (request.url === 'https://api.github.com/gists/gist-truncated') {
        return jsonResponse({
          files: {
            [DEFAULT_GIST_FILE]: {
              raw_url: rawUrl,
              truncated: true,
            },
          },
          id: 'gist-truncated',
        })
      }
      if (request.url === rawUrl) {
        return new Response(serialized, { status: 200 })
      }

      throw new Error(`Unexpected request: ${request.url}`)
    }
    restoreFetch = () => {
      globalThis.fetch = originalFetch
    }

    const result = await pullWithGist(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-truncated',
          lastSyncAt: 5,
          mode: 'gist',
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
    expect(requests).toEqual([
      {
        authorization: `Bearer ${githubToken}`,
        url: 'https://api.github.com/gists/gist-truncated',
      },
      {
        authorization: `Bearer ${githubToken}`,
        url: rawUrl,
      },
    ])
  })

  it('compacts observed immutable history after serial state writes', async () => {
    const store = createGistStore()
    installGistFetch(store)
    const created = await syncWithGist(chatData(), syncContext())
    const firstEdit = await syncWithGist(
      {
        ...created.data,
        conversations: [
          conversation([message('first-edit', 20)], { updatedAt: 20 }),
        ],
        updatedAt: 20,
      },
      syncContext(),
    )

    await syncWithGist(
      {
        ...firstEdit.data,
        conversations: [
          conversation([message('second-edit', 30)], { updatedAt: 30 }),
        ],
        updatedAt: 30,
      },
      syncContext(),
    )

    expect(operationFiles(store, 'gist-1')).toHaveLength(1)
  }, 30_000)

  it('defers new Gist uploads before any remote write when generation is pending', async () => {
    const store = createGistStore()
    let caught: unknown
    let deferChecks = 0
    installGistFetch(store)

    try {
      await syncWithGist(
        appData(),
        syncContext({
          shouldDeferRemoteWrite: () => {
            deferChecks += 1
            return deferChecks > 1
          },
        }),
      )
    } catch (error: unknown) {
      caught = error
    }

    expect(isSyncRemoteWriteDeferredError(caught)).toBe(true)
    expect(deferChecks).toBe(2)
    expect(store.calls()).toEqual([])
  })

  it('pulls and accepts a newer encrypted legacy Gist vault with provider secrets', async () => {
    const store = createGistStore()
    const remote = appData({
      sync: {
        autoSync: true,
        encryptionEnabled: true,
        gistId: 'gist-remote',
        mode: 'gist',
      },
      updatedAt: 30,
    })
    installGistFetch(store)
    store.seed(
      'gist-remote',
      DEFAULT_GIST_FILE,
      await serializeVault(
        remote,
        { providerKeys: { providerRemote: 'remote-key' } },
        passphrase,
      ),
    )

    const result = await pullWithGist(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-remote',
          lastSyncAt: 5,
          mode: 'gist',
        },
        updatedAt: 10,
      }),
      syncContext(),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(result.data.updatedAt).toBe(30)
    expect(result.data.sync.gistId).toBe('gist-remote')
    expect(result.secrets?.providerKeys).toEqual({
      providerRemote: 'remote-key',
    })
    expect(store.calls()).toEqual(['GET /gists/gist-remote'])
  })

  it('merges local and remote messages when first sync explicitly chooses merge', async () => {
    const store = createGistStore()
    installGistFetch(store)
    store.seed(
      'gist-first-merge',
      DEFAULT_GIST_FILE,
      await serializeVault(
        {
          ...chatData(),
          conversations: [
            conversation([message('remote-message', 10)], {
              id: 'conversation-remote',
              title: 'Remote conversation',
              updatedAt: 10,
            }),
          ],
          updatedAt: 10,
        },
        { providerKeys: { providerRemote: 'remote-key' } },
        passphrase,
      ),
    )

    const result = await syncWithGist(
      {
        ...chatData(),
        conversations: [
          conversation([message('local-message', 20)], { updatedAt: 20 }),
        ],
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-first-merge',
          mode: 'gist',
        },
        updatedAt: 20,
      },
      syncContext({
        firstSyncStrategy: 'merge',
        providerKeys: { providerLocal: 'local-key' },
      }),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(
      result.data.conversations
        .flatMap((item) => item.messages.map((message) => message.id))
        .sort(),
    ).toEqual(['local-message', 'remote-message'])
    expect(result.secrets?.providerKeys).toEqual({
      providerLocal: 'local-key',
      providerRemote: 'remote-key',
    })
    expect(store.calls()).toEqual([
      'GET /gists/gist-first-merge',
      'PATCH /gists/gist-first-merge',
    ])
  }, 30_000)

  it('publishes only local data when first sync explicitly chooses local', async () => {
    const store = createGistStore()
    installGistFetch(store)
    store.seed(
      'gist-first-local',
      DEFAULT_GIST_FILE,
      await serializeVault(
        {
          ...chatData([message('remote-message', 10)]),
          updatedAt: 10,
        },
        { providerKeys: { providerRemote: 'remote-key' } },
        passphrase,
      ),
    )

    const result = await syncWithGist(
      {
        ...chatData([message('local-message', 20)]),
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-first-local',
          mode: 'gist',
        },
        updatedAt: 20,
      },
      syncContext({
        firstSyncStrategy: 'use-local',
        providerKeys: { providerLocal: 'local-key' },
      }),
    )
    const files = operationFiles(store, 'gist-first-local')
    const operationId = gistOperationIdFromFileName(DEFAULT_GIST_FILE, files[0]![0])
    const stored = await parseGistOperation(
      files[0]![1],
      passphrase,
      operationId!,
    )

    expect(result.remoteAccepted).toBe(false)
    expect(result.data.conversations[0]?.messages.map((item) => item.id)).toEqual([
      'local-message',
    ])
    expect(result.secrets?.providerKeys).toEqual({
      providerLocal: 'local-key',
    })
    expect(stored.operation).toBe('state')
    if (stored.operation !== 'state') {
      throw new Error('Expected a state operation')
    }
    expect(stored.vault.data.conversations[0]?.messages.map((item) => item.id)).toEqual([
      'local-message',
    ])
    expect(store.file('gist-first-local', DEFAULT_GIST_FILE)).toBeUndefined()
  }, 30_000)

  it('migrates a legacy mutable snapshot in one PATCH without rewriting it', async () => {
    const store = createGistStore()
    installGistFetch(store)
    store.seed(
      'gist-legacy',
      DEFAULT_GIST_FILE,
      await serializeVault(appData({ updatedAt: 5 }), { providerKeys: {} }, passphrase),
    )

    const result = await syncWithGist(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-legacy',
          mode: 'gist',
        },
        updatedAt: 10,
      }),
      syncContext({ firstSyncStrategy: 'use-local' }),
    )

    expect(result.remoteAccepted).toBe(true)
    expect(store.file('gist-legacy', DEFAULT_GIST_FILE)).toBeUndefined()
    expect(operationFiles(store, 'gist-legacy')).toHaveLength(1)
    expect(store.calls()).toEqual([
      'GET /gists/gist-legacy',
      'PATCH /gists/gist-legacy',
    ])
  }, 20_000)

  it('creates a new encryption domain when rotating the sync passphrase', async () => {
    const store = createGistStore()
    installGistFetch(store)
    const created = await syncWithGist(chatData(), syncContext())
    const previousFiles = operationFiles(store, 'gist-1')
    const replacementPassphrase = 'replacement gist passphrase'

    const result = await syncWithGist(
      {
        ...created.data,
        updatedAt: 20,
      },
      syncContext({
        allowPassphraseRotation: true,
        encryptionPassphrase: replacementPassphrase,
      }),
    )
    const replacementFiles = operationFiles(store, 'gist-2')
    const replacementId = gistOperationIdFromFileName(
      DEFAULT_GIST_FILE,
      replacementFiles[0]![0],
    )
    const replacement = await parseGistOperation(
      replacementFiles[0]![1],
      replacementPassphrase,
      replacementId!,
    )

    expect(result.remoteAccepted).toBe(false)
    expect(result.data.sync.gistId).toBe('gist-2')
    expect(replacementFiles).toHaveLength(1)
    expect(operationFiles(store, 'gist-1')).toEqual(previousFiles)
    expect(replacement.operation).toBe('state')
    expect(replacement.parents).toEqual([])
    expect(store.calls()).toEqual([
      'POST /gists',
      'GET /gists/gist-1',
      'POST /gists',
    ])
  }, 30_000)

  it('keeps pull-only passphrase failures read-only when rotation is allowed', async () => {
    const store = createGistStore()
    installGistFetch(store)
    const created = await syncWithGist(chatData(), syncContext())
    const previousFiles = operationFiles(store, 'gist-1')

    await expect(
      pullWithGist(
        created.data,
        syncContext({
          allowPassphraseRotation: true,
          encryptionPassphrase: 'unreadable replacement passphrase',
        }),
      ),
    ).rejects.toThrow()

    expect(operationFiles(store, 'gist-1')).toEqual(previousFiles)
    expect(operationFiles(store, 'gist-2')).toEqual([])
    expect(store.calls()).toEqual([
      'POST /gists',
      'GET /gists/gist-1',
    ])
  }, 30_000)

  it('preserves both messages when two clients PATCH from the same parent', async () => {
    const store = createGistStore()
    installGistFetch(store)
    const base = await syncWithGist(chatData(), syncContext())
    const gate = store.holdNextPatches(2)
    const left = {
      ...base.data,
      conversations: [
        conversation([message('left-message', 20)], { updatedAt: 20 }),
      ],
      updatedAt: 20,
    }
    const right = {
      ...base.data,
      conversations: [
        conversation([message('right-message', 30)], { updatedAt: 30 }),
      ],
      updatedAt: 30,
    }
    const leftSync = syncWithGist(left, syncContext())
    const rightSync = syncWithGist(right, syncContext())

    await gate.arrived
    gate.release()
    await Promise.all([leftSync, rightSync])

    const pulled = await pullWithGist(
      appData({
        ...chatData(),
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-1',
          mode: 'gist',
        },
      }),
      syncContext({ firstSyncStrategy: 'use-remote' }),
    )

    expect(operationFiles(store, 'gist-1')).toHaveLength(2)
    expect(
      pulled.data.conversations[0]?.messages.map((item) => item.id),
    ).toEqual(['left-message', 'right-message'])
  }, 30_000)

  it('keeps a message tombstone while preserving a concurrent new message', async () => {
    const store = createGistStore()
    installGistFetch(store)
    const original = message('original-message', 10)
    const base = await syncWithGist(chatData([original]), syncContext())
    const gate = store.holdNextPatches(2)
    const deletion = syncWithGist(
      {
        ...base.data,
        conversations: [conversation([], { updatedAt: 20 })],
        updatedAt: 20,
      },
      syncContext(),
    )
    const append = syncWithGist(
      {
        ...base.data,
        conversations: [
          conversation([original, message('new-message', 30)], { updatedAt: 30 }),
        ],
        updatedAt: 30,
      },
      syncContext(),
    )

    await gate.arrived
    gate.release()
    await Promise.all([deletion, append])

    const pulled = await pullWithGist(
      appData({
        ...chatData(),
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-1',
          mode: 'gist',
        },
      }),
      syncContext({ firstSyncStrategy: 'use-remote' }),
    )

    expect(
      pulled.data.conversations[0]?.messages.map((item) => item.id),
    ).toEqual(['new-message'])
  }, 30_000)

  it('deduplicates a retry after the first PATCH committed but its response was lost', async () => {
    const store = createGistStore()
    installGistFetch(store)
    const base = await syncWithGist(chatData(), syncContext())
    const edited = {
      ...base.data,
      conversations: [
        conversation([message('retry-message', 20)], { updatedAt: 20 }),
      ],
      updatedAt: 20,
    }
    store.failNextPatchAfterApply()

    await expect(syncWithGist(edited, syncContext())).rejects.toThrow(
      'Simulated lost PATCH response',
    )
    const retry = await syncWithGist(edited, syncContext())

    expect(retry.remoteAccepted).toBe(false)
    expect(operationFiles(store, 'gist-1')).toHaveLength(1)
    expect(
      store.calls().filter((call) => call === 'PATCH /gists/gist-1'),
    ).toHaveLength(1)
  }, 30_000)

  it('clears observed protocol files with a durable clear operation', async () => {
    const store = createGistStore()
    installGistFetch(store)
    const created = await syncWithGist(chatData(), syncContext())
    const cleared = await clearWithGist(created.data, syncContext())
    const files = operationFiles(store, 'gist-1')
    const operationId = gistOperationIdFromFileName(DEFAULT_GIST_FILE, files[0]![0])
    const operation = await parseGistOperation(
      files[0]![1],
      passphrase,
      operationId!,
    )

    expect(cleared.message).toBe(rt('sync.status.remoteCleared'))
    expect(files).toHaveLength(1)
    expect(operation.operation).toBe('clear')
  }, 20_000)

  it('does not erase a state operation committed concurrently with clear', async () => {
    const store = createGistStore()
    installGistFetch(store)
    const created = await syncWithGist(chatData(), syncContext())
    const gate = store.holdNextPatches(2)
    const clear = clearWithGist(created.data, syncContext())
    const concurrent = syncWithGist(
      {
        ...created.data,
        conversations: [
          conversation([message('concurrent-message', 20)], { updatedAt: 20 }),
        ],
        updatedAt: 20,
      },
      syncContext(),
    )

    await gate.arrived
    gate.release()
    await Promise.all([clear, concurrent])

    const pulled = await pullWithGist(
      appData({
        ...chatData(),
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-1',
          mode: 'gist',
        },
      }),
      syncContext({ firstSyncStrategy: 'use-remote' }),
    )

    expect(
      pulled.data.conversations[0]?.messages.map((item) => item.id),
    ).toEqual(['concurrent-message'])
  }, 30_000)

  it('can recover remote cleanup when the managed Gist payload is corrupted', async () => {
    const store = createGistStore()
    installGistFetch(store)
    store.seed('gist-corrupt', DEFAULT_GIST_FILE, '{not-json')
    const unmanagedFile = `${DEFAULT_GIST_FILE}.zerochat-op-not-an-id.json`
    store.seed('gist-corrupt', unmanagedFile, 'user-owned')

    const result = await clearWithGist(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-corrupt',
          mode: 'gist',
        },
      }),
      syncContext(),
    )

    expect(result.message).toBe(rt('sync.status.remoteCleared'))
    expect(store.file('gist-corrupt', DEFAULT_GIST_FILE)).toBeUndefined()
    expect(store.file('gist-corrupt', unmanagedFile)).toBe('user-owned')
    expect(operationFiles(store, 'gist-corrupt')).toHaveLength(1)
  }, 20_000)

  it('preserves cancellation while clear reads a truncated managed file', async () => {
    const originalFetch = globalThis.fetch
    const source = new AbortController()
    const rawUrl =
      'https://gist.githubusercontent.com/zerochat/revision/raw/zerochat-sync.json'
    const requestedUrls: string[] = []
    let markRawReadStarted = (): void => undefined
    const rawReadStarted = new Promise<void>((resolve) => {
      markRawReadStarted = resolve
    })

    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      requestedUrls.push(request.url)

      if (request.url === 'https://api.github.com/gists/gist-clear-cancel') {
        return jsonResponse({
          files: {
            [DEFAULT_GIST_FILE]: {
              raw_url: rawUrl,
              truncated: true,
            },
          },
          id: 'gist-clear-cancel',
        })
      }
      if (request.url === rawUrl) {
        markRawReadStarted()
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'))

          if (request.signal.aborted) {
            abort()
            return
          }
          request.signal.addEventListener('abort', abort, { once: true })
        })
      }

      throw new Error(`Unexpected request: ${request.url}`)
    }
    restoreFetch = () => {
      globalThis.fetch = originalFetch
    }

    const operation = clearWithGist(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'gist-clear-cancel',
          mode: 'gist',
        },
      }),
      syncContext({ signal: source.signal }),
    )
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    })

    await rawReadStarted
    source.abort()
    await rejection
    expect(requestedUrls).toEqual([
      'https://api.github.com/gists/gist-clear-cancel',
      rawUrl,
    ])
  })

  it('clears stale local Gist ids when the remote Gist is already gone', async () => {
    const store = createGistStore()
    installGistFetch(store)

    const result = await clearWithGist(
      appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          gistId: 'missing-gist',
          mode: 'gist',
        },
      }),
      syncContext(),
    )

    expect(result.remoteAccepted).toBe(false)
    expect(result.data.sync.gistId).toBeUndefined()
    expect(result.message).toBe(rt('sync.status.remoteAlreadyEmpty'))
    expect(store.calls()).toEqual(['GET /gists/missing-gist'])
  })

  it('blocks Gist sync before network access when the GitHub token is missing', async () => {
    const store = createGistStore()
    installGistFetch(store)

    await expect(
      syncWithGist(appData(), syncContext({ githubToken: '   ' })),
    ).rejects.toThrow(rt('error.syncGithubTokenRequired'))
    expect(store.calls()).toEqual([])
  })
})
