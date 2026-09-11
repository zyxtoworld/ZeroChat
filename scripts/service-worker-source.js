const CACHE_PREFIX = 'zerochat-shell-'
const CACHE_NAME = `${CACHE_PREFIX}__ZEROCHAT_CACHE_VERSION__`
const MAX_CACHE_ENTRIES = 64
const shellUrl = (path) => new URL(path, self.registration.scope).href
const indexUrl = shellUrl('index.html')
const staticAssetPaths = ['__ZEROCHAT_STATIC_ASSET_PATHS__']
const staticAssetUrls = staticAssetPaths.map(shellUrl)
const staticAssetUrlSet = new Set(staticAssetUrls)
const cacheableDestinations =
  /^(document|font|image|manifest|script|style|worker)/

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

  for (const request of keys) {
    if (overflow <= 0) {
      break
    }

    if (!staticAssetUrlSet.has(request.url)) {
      await cache.delete(request)
      overflow -= 1
    }
  }
}

function staleWhileRevalidate(event, request) {
  const networkResponse = caches.open(CACHE_NAME).then(async (cache) => {
    const response = await fetch(request)
    if (response.ok && new URL(request.url).origin === location.origin) {
      try {
        const cacheNames = await zeroChatCacheNames()
        if (!cacheNames.includes(CACHE_NAME)) {
          return response
        }
        await cache.put(request, response.clone())
        await pruneRuntimeCache(cache)
      } catch {
        reportServiceWorkerCacheFailure('runtime-cache')
      }
    }
    return response
  })

  event.waitUntil(networkResponse.catch(() => undefined))
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
        reportServiceWorkerCacheFailure('install-shell')
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
    request.method === 'GET' &&
    cacheableDestinations.test(request.destination)
  ) {
    const cacheRequest =
      request.mode === 'navigate'
        ? indexUrl
        : staticAssetUrlSet.has(request.url) &&
            !request.url.includes('/assets/')
          ? request
          : undefined

    event.respondWith(
      cacheRequest
        ? matchVersionedAsset(cacheRequest).then(
            (cachedResponse) => cachedResponse ?? fetch(request),
          )
        : staleWhileRevalidate(event, request),
    )
  }
})
