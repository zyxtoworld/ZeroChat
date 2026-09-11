import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

import { expect, it } from 'vitest'

const serviceWorkerSource = await readFile(
  'scripts/service-worker-source.js',
  'utf8',
)

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createCacheStorage() {
  const cachesByName = new Map()
  const writesAfterDeletion = []

  function ensureCache(name) {
    const existing = cachesByName.get(name)
    if (existing) {
      return existing
    }

    const cache = {
      deleted: false,
      entries: new Map(),
      async addAll() {},
      async delete(request) {
        this.entries.delete(request.url)
        return true
      },
      async keys() {
        return [...this.entries.keys()].map((url) => ({ url }))
      },
      async match(request) {
        return this.entries.get(request.url)
      },
      async put(request, response) {
        if (this.deleted) {
          writesAfterDeletion.push(name)
          this.deleted = false
          cachesByName.set(name, this)
        }
        this.entries.set(request.url, response)
      },
    }
    cachesByName.set(name, cache)
    return cache
  }

  return {
    api: {
      async delete(name) {
        const cache = cachesByName.get(name)
        if (!cache) {
          return false
        }
        cache.deleted = true
        cachesByName.delete(name)
        return true
      },
      async keys() {
        return [...cachesByName.keys()]
      },
      async open(name) {
        return ensureCache(name)
      },
    },
    ensureCache,
    writesAfterDeletion,
  }
}

function evaluateWorker(version, { caches, fetch = async () => undefined } = {}) {
  const handlers = new Map()
  const context = {
    URL,
    addEventListener(type, handler) {
      handlers.set(type, handler)
    },
    caches,
    clients: { claim: async () => undefined },
    console: { warn: () => undefined },
    fetch,
    location: { origin: 'https://zerochat.test' },
    self: { registration: { scope: 'https://zerochat.test/' } },
    skipWaiting: () => undefined,
  }

  runInNewContext(
    serviceWorkerSource.replaceAll('__ZEROCHAT_CACHE_VERSION__', version),
    context,
  )
  return handlers
}

it('does not let an old registration rewrite a cache after activation removes it', async () => {
  const cacheStorage = createCacheStorage()
  const oldCacheName = 'zerochat-shell-v1'
  const newerCacheName = 'zerochat-shell-v2'
  const currentCacheName = 'zerochat-shell-v3'
  cacheStorage.ensureCache(oldCacheName)
  cacheStorage.ensureCache(newerCacheName)
  cacheStorage.ensureCache(currentCacheName)

  const fetchStarted = deferred()
  const network = deferred()
  const response = {
    ok: true,
    clone() {
      return { ...this }
    },
  }
  const oldHandlers = evaluateWorker('v1', {
    caches: cacheStorage.api,
    fetch: () => {
      fetchStarted.resolve()
      return network.promise
    },
  })

  const fetchWaits = []
  let oldResponse
  oldHandlers.get('fetch')({
    request: {
      destination: 'script',
      method: 'GET',
      mode: 'cors',
      url: 'https://zerochat.test/assets/runtime.js',
    },
    respondWith(promise) {
      oldResponse = promise
    },
    waitUntil(promise) {
      fetchWaits.push(promise)
    },
  })
  await fetchStarted.promise

  const currentHandlers = evaluateWorker('v3', { caches: cacheStorage.api })
  const activateWaits = []
  currentHandlers.get('activate')({
    waitUntil(promise) {
      activateWaits.push(promise)
    },
  })
  await Promise.all(activateWaits)
  expect(await cacheStorage.api.keys()).not.toContain(oldCacheName)

  network.resolve(response)
  await expect(oldResponse).resolves.toBe(response)
  await Promise.all(fetchWaits)

  expect(cacheStorage.writesAfterDeletion).toEqual([])
  expect(await cacheStorage.api.keys()).not.toContain(oldCacheName)
})
