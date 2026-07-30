import { describe, expect, it } from 'vitest'

import { ZeroChatSyncCoordinator } from '../../cloudflare/sync-worker.js'

const syncGeneration = '00000000-0000-4000-8000-000000000001'

class MemoryStorage {
  constructor() {
    this.records = new Map()
    this.transactionTail = Promise.resolve()
  }

  async get(key) {
    return this.records.get(key)
  }

  async put(key, value) {
    this.records.set(key, structuredClone(value))
  }

  async delete(key) {
    this.records.delete(key)
  }

  transaction(callback) {
    const operation = this.transactionTail.then(() => callback(this))
    this.transactionTail = operation.catch(() => undefined)
    return operation
  }
}

function fixture(legacyHead = null, legacySnapshot = null) {
  const storage = new MemoryStorage()
  storage.records.set('sync-generation-v1', syncGeneration)
  const objects = new Map()
  const legacy = new Map([
    ...(legacyHead ? [['incremental-head', JSON.stringify(legacyHead)]] : []),
    ...(legacySnapshot ? [['snapshot', legacySnapshot]] : []),
  ])
  const state = {
    storage,
    blockConcurrencyWhile(callback) {
      this.initialization = callback()
    },
  }
  const env = {
    zerochat_kv: {
      async get(key) {
        return legacy.get(key) ?? null
      },
      async delete(key) {
        legacy.delete(key)
      },
    },
    zerochat_r2: {
      async put(key, body) {
        objects.set(key, body)
      },
      async delete(key) {
        objects.delete(key)
      },
      async list(options = {}) {
        const offset = Number(options.cursor ?? 0)
        const limit = options.limit ?? 1000
        const keys = Array.from(objects.keys()).sort()
        const page = keys.slice(offset, offset + limit)
        const nextOffset = offset + page.length
        return {
          cursor: String(nextOffset),
          objects: page.map((key) => ({ key })),
          truncated: nextOffset < keys.length,
        }
      },
    },
  }
  return {
    coordinator: new ZeroChatSyncCoordinator(state, env),
    legacy,
    objects,
    storage,
  }
}

function head(manifestKey, updatedAt) {
  return {
    kind: 'zerochat.incrementalHead',
    version: 1,
    manifestKey,
    updatedAt,
  }
}

const manifestKeys = {
  base: 'manifest-00000000-0000-4000-8000-000000000001.json',
  left: 'manifest-00000000-0000-4000-8000-000000000002.json',
  right: 'manifest-00000000-0000-4000-8000-000000000003.json',
  next: 'manifest-00000000-0000-4000-8000-000000000004.json',
  unconditional: 'manifest-00000000-0000-4000-8000-000000000005.json',
}

function putRequest(next, headers) {
  return new Request('https://coordinator.invalid/sync/head', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-zerochat-sync-generation': syncGeneration,
      ...headers,
    },
    body: JSON.stringify(next),
  })
}

function snapshot(updatedAt, fill) {
  const bytes = (length, value) =>
    btoa(String.fromCharCode(...new Uint8Array(length).fill(value)))
  const aad = new TextEncoder().encode(`zerochat:vault:v1:${updatedAt}`)
  return JSON.stringify({
    kind: 'zerochat.encryptedSnapshot',
    version: 1,
    encryptedAt: updatedAt + 1,
    updatedAt,
    crypto: {
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: 600000,
      salt: bytes(16, fill),
      iv: bytes(12, fill),
      aad: btoa(String.fromCharCode(...aad)),
    },
    payload: bytes(17, fill),
  })
}

function putSnapshotRequest(body, headers) {
  return new Request('https://coordinator.invalid/snapshot', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-zerochat-sync-generation': syncGeneration,
      ...headers,
    },
    body,
  })
}

function objectEnvelope(objectType, updatedAt, fill = 1) {
  const bytes = (length, value) =>
    btoa(String.fromCharCode(...new Uint8Array(length).fill(value)))
  const aad = new TextEncoder().encode(
    `zerochat:object:v1:${objectType}:${updatedAt}`,
  )
  return {
    kind: 'zerochat.encryptedObject',
    version: 1,
    objectType,
    encryptedAt: updatedAt + 1,
    updatedAt,
    crypto: {
      cipher: 'AES-256-GCM',
      compression: 'none',
      kdf: 'PBKDF2-SHA256',
      iterations: 600000,
      salt: bytes(16, fill),
      iv: bytes(12, fill),
      aad: btoa(String.fromCharCode(...aad)),
    },
    payload: bytes(17, fill),
  }
}

function putObjectRequest(key, generation = syncGeneration) {
  return new Request(`https://coordinator.invalid/sync/object/${key}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-zerochat-sync-generation': generation,
    },
    body: JSON.stringify(objectEnvelope('manifest', 20)),
  })
}

describe('Cloudflare incremental head Durable Object', () => {
  it('migrates the legacy KV head once and serves a strong ETag', async () => {
    const legacyHead = head(manifestKeys.base, 10)
    const { coordinator } = fixture(legacyHead)

    const response = await coordinator.fetch(
      new Request('https://coordinator.invalid/sync/head'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(legacyHead)
    expect(response.headers.get('etag')).toBe(`"${manifestKeys.base}"`)
  })

  it('allows only one concurrent first-head publication', async () => {
    const { coordinator } = fixture()
    const [left, right] = await Promise.all([
      coordinator.fetch(
        putRequest(head(manifestKeys.left, 20), { 'if-none-match': '*' }),
      ),
      coordinator.fetch(
        putRequest(head(manifestKeys.right, 30), { 'if-none-match': '*' }),
      ),
    ])

    expect([left.status, right.status].sort()).toEqual([200, 409])
    const current = await coordinator.fetch(
      new Request('https://coordinator.invalid/sync/head'),
    )
    expect((await current.json()).manifestKey).toBe(manifestKeys.left)
  })

  it('allows only one writer for the same expected previous head', async () => {
    const { coordinator } = fixture(head(manifestKeys.base, 10))
    const expected = { 'if-match': `"${manifestKeys.base}"` }
    const [left, right] = await Promise.all([
      coordinator.fetch(putRequest(head(manifestKeys.left, 20), expected)),
      coordinator.fetch(putRequest(head(manifestKeys.right, 30), expected)),
    ])

    expect([left.status, right.status].sort()).toEqual([200, 409])
    const current = await coordinator.fetch(
      new Request('https://coordinator.invalid/sync/head'),
    )
    expect((await current.json()).manifestKey).toBe(manifestKeys.left)
  })

  it('accepts an exact retry after an uncertain successful response', async () => {
    const { coordinator } = fixture(head(manifestKeys.base, 10))
    const next = head(manifestKeys.next, 20)
    const request = () =>
      putRequest(next, { 'if-match': `"${manifestKeys.base}"` })

    expect((await coordinator.fetch(request())).status).toBe(200)
    const retry = await coordinator.fetch(request())

    expect(retry.status).toBe(200)
    expect(retry.headers.get('x-zerochat-idempotent')).toBe('true')
  })

  it('rejects unconditional writes before touching the head', async () => {
    const { coordinator } = fixture()
    const response = await coordinator.fetch(
      putRequest(head(manifestKeys.unconditional, 10), {}),
    )

    expect(response.status).toBe(428)
    expect(
      (
        await coordinator.fetch(
          new Request('https://coordinator.invalid/sync/head'),
        )
      ).status,
    ).toBe(404)
  })

  it('migrates a legacy encrypted snapshot and exposes its strong ETag', async () => {
    const body = snapshot(10, 1)
    const { coordinator } = fixture(null, body)

    const response = await coordinator.fetch(
      new Request('https://coordinator.invalid/snapshot'),
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe(body)
    expect(response.headers.get('etag')).toMatch(
      /^"snapshot-sha256-[0-9a-f]{64}"$/u,
    )
  })

  it('allows only one concurrent first-snapshot publication', async () => {
    const { coordinator } = fixture()
    const [left, right] = await Promise.all([
      coordinator.fetch(putSnapshotRequest(snapshot(20, 2), { 'if-none-match': '*' })),
      coordinator.fetch(putSnapshotRequest(snapshot(30, 3), { 'if-none-match': '*' })),
    ])

    expect([left.status, right.status].sort()).toEqual([200, 409])
  })

  it('requires the exact snapshot ETag and rejects backward replacement', async () => {
    const { coordinator } = fixture()
    const first = await coordinator.fetch(
      putSnapshotRequest(snapshot(20, 2), { 'if-none-match': '*' }),
    )
    const etag = first.headers.get('etag')

    expect(
      (
        await coordinator.fetch(
          putSnapshotRequest(snapshot(30, 3), { 'if-match': '"wrong"' }),
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await coordinator.fetch(
          putSnapshotRequest(snapshot(10, 1), { 'if-match': etag }),
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await coordinator.fetch(
          putSnapshotRequest(snapshot(30, 3), { 'if-match': etag }),
        )
      ).status,
    ).toBe(200)
  })

  it('rotates the generation on clear and rejects every stale publication', async () => {
    const { coordinator, objects } = fixture()
    const key = manifestKeys.left

    expect((await coordinator.fetch(putObjectRequest(key))).status).toBe(200)
    expect(objects.has(key)).toBe(true)

    const cleared = await coordinator.fetch(
      new Request('https://coordinator.invalid/sync/clear', {
        method: 'DELETE',
      }),
    )
    const nextGeneration = cleared.headers.get('x-zerochat-sync-generation')

    expect(cleared.status).toBe(200)
    expect(nextGeneration).not.toBe(syncGeneration)
    expect(objects.size).toBe(0)
    expect(
      (
        await coordinator.fetch(
          putRequest(head(key, 20), { 'if-none-match': '*' }),
        )
      ).status,
    ).toBe(412)
    expect((await coordinator.fetch(putObjectRequest(key))).status).toBe(412)
    expect(
      (
        await coordinator.fetch(
          putSnapshotRequest(snapshot(20, 2), { 'if-none-match': '*' }),
        )
      ).status,
    ).toBe(412)
  })

  it('clears every safe R2 object across offset-based pages', async () => {
    const { coordinator, objects } = fixture()
    for (let index = 0; index < 1005; index += 1) {
      const suffix = index.toString(16).padStart(12, '0')
      objects.set(`chunk-00000000-0000-4000-8000-${suffix}.json`, '{}')
    }

    const response = await coordinator.fetch(
      new Request('https://coordinator.invalid/sync/clear', {
        method: 'DELETE',
      }),
    )

    expect(response.status).toBe(200)
    expect((await response.json()).deletedObjects).toBe(1005)
    expect(objects.size).toBe(0)
  })
})
