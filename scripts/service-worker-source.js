const CACHE_PREFIX = 'zerochat-shell-'
const CACHE_NAME = `${CACHE_PREFIX}__ZEROCHAT_CACHE_VERSION__`
const MAX_CACHE_ENTRIES = 64
const scopeUrl = self.registration.scope
const shellUrl = (path) => new URL(path, scopeUrl).href
const indexUrl = shellUrl('index.html')
const staticAssetPaths = JSON.parse('__ZEROCHAT_STATIC_ASSET_PATHS__')
const staticAssetUrls = staticAssetPaths.map(shellUrl)
const staticAssetUrlSet = new Set(staticAssetUrls)
const cacheableDestinations =
  /^(document|font|image|manifest|script|style|worker)$/
const sameOrigin = (url) => new URL(url).origin === location.origin

function reportServiceWorkerCacheFailure(operation) {
  try {
    console.warn('ZeroChat cache failed.', operation)
  } catch (loggerError) {
    void loggerError
  }
}

async function zeroChatCacheNames() {
  return (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX))
}

async function matchVersionedAsset(request) {
  const cacheNames = await zeroChatCacheNames()
  const orderedNames = [
    CACHE_NAME,
    ...cacheNames.filter((name) => name !== CACHE_NAME).reverse(),
  ]

  for (const cacheName of orderedNames) {
    const response = await (await caches.open(cacheName)).match(request)

    if (response) {
      return response
    }
  }

  return undefined
}

async function pruneRuntimeCache(cache) {
  const keys = await cache.keys()
  let overflow = keys.length - MAX_CACHE_ENTRIES

  if (overflow <= 0) {
    return
  }

  const preservedUrls = new Set(staticAssetUrls)

  for (const request of keys) {
    if (overflow <= 0) {
      break
    }

    if (!preservedUrls.has(request.url)) {
      await cache.delete(request)
      overflow -= 1
    }
  }
}

async function cacheRuntimeResponse(cache, request, response) {
  if (!response.ok || !sameOrigin(request.url)) {
    return
  }

  try {
    await cache.put(request, response.clone())
    await pruneRuntimeCache(cache)
  } catch {
    reportServiceWorkerCacheFailure('runtime-cache')
  }
}

function staleWhileRevalidate(event, request) {
  const networkResponse = caches.open(CACHE_NAME).then(async (cache) => {
    const response = await fetch(request)
    await cacheRuntimeResponse(cache, request, response)
    return response
  })

  event.waitUntil(networkResponse.then(() => undefined, () => undefined))
  return matchVersionedAsset(request).then(
    (cachedResponse) => cachedResponse ?? networkResponse,
  )
}

addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(staticAssetUrls))
      .catch((error) => {
        reportServiceWorkerCacheFailure('install-static')
        throw error
      }),
  )
  skipWaiting()
})

addEventListener('activate', (event) => {
  event.waitUntil(
    zeroChatCacheNames().then(async (cacheNames) => {
      const previousCacheName = cacheNames
        .filter((name) => name !== CACHE_NAME)
        .at(-1)
      const retainedNames = new Set(
        [CACHE_NAME, previousCacheName].filter(Boolean),
      )

      await Promise.all(
        cacheNames
          .filter((name) => !retainedNames.has(name))
          .map((name) => caches.delete(name)),
      )
      await clients.claim()
    }),
  )
})

addEventListener('fetch', (event) => {
  const request = event.request

  if (
    request.method !== 'GET' ||
    !cacheableDestinations.test(request.destination)
  ) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      matchVersionedAsset(indexUrl).then(
        (cachedResponse) => cachedResponse ?? fetch(request),
      ),
    )
    return
  }

  if (
    staticAssetUrlSet.has(request.url) &&
    !new URL(request.url).pathname.includes('/assets/')
  ) {
    event.respondWith(
      matchVersionedAsset(request).then(
        (cachedResponse) => cachedResponse ?? fetch(request),
      ),
    )
    return
  }

  event.respondWith(staleWhileRevalidate(event, request))
})
