import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveFetchSafeLoopbackPort } from './fetch-safe-loopback-port.mjs'
import { startVitePreviewLoopbackServer } from './vite-loopback-server.mjs'
import {
  connectCdp,
  readJson as readCdpJson,
  waitForChrome as waitForCdpChrome,
} from './browser-cdp.mjs'
import {
  removeBrowserProfileWithRetry,
  settleBrowserRuntimeCleanup,
  stopChildProcessTree,
} from './browser-runtime-cleanup.mjs'
import { collectStaticAssetPaths } from './service-worker-finalize.mjs'

async function executableExists(value) {
  if (!value.includes('\\') && !value.includes('/')) {
    return spawnSync(process.platform === 'win32' ? 'where' : 'which', [value], {
      stdio: 'ignore',
    }).status === 0
  }

  try {
    await access(value)
    return true
  } catch {
    return false
  }
}

async function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : undefined,
    process.platform === 'win32'
      ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
      : undefined,
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined,
    process.platform === 'linux' ? 'google-chrome' : undefined,
    process.platform === 'linux' ? 'google-chrome-stable' : undefined,
    process.platform === 'linux' ? 'chromium-browser' : undefined,
    process.platform === 'linux' ? 'chromium' : undefined,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await executableExists(candidate)) {
      return candidate
    }
  }

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run PWA offline smoke.')
}

async function restoreOnlineNetworkConditions(cdp) {
  try {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
    return true
  } catch {
    return false
  }
}

async function readJson(url, init) {
  return readCdpJson(url, init)
}

function connect(wsUrl) {
  return connectCdp(wsUrl)
}

async function waitForChrome(port) {
  return waitForCdpChrome(port)
}

async function waitForLoad(cdp) {
  await cdp.send('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      const done = () => resolve(document.readyState)
      if (document.readyState === 'complete') done()
      else window.addEventListener('load', done, { once: true })
    })`,
    awaitPromise: true,
    returnByValue: true,
  })
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  })

  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'Browser evaluation failed',
    )
  }

  return result.result.value
}

const chromePath = await resolveChromePath()
const cdpPort = await resolveFetchSafeLoopbackPort(
  process.env.ZEROCHAT_PWA_CDP_PORT,
  'PWA offline Chrome remote debugging',
)
const providedAppUrl = process.env.ZEROCHAT_PWA_URL
let appUrl = providedAppUrl ?? ''
const profileDir = path.join(os.tmpdir(), `zerochat-pwa-offline-${Date.now()}`)
const distDir = path.resolve('dist')

await access(path.join(distDir, 'index.html')).catch(() => {
  throw new Error('dist/index.html is missing. Run the production build before PWA offline smoke.')
})
function requiredStaticAsset(pattern, label) {
  const matches = staticAssetPaths.filter((assetPath) => pattern.test(assetPath))
  assert.equal(
    matches.length,
    1,
    `Expected one ${label} build asset, received ${JSON.stringify(matches)}.`,
  )
  return new URL(matches[0], appUrl).href
}

await mkdir(profileDir, { recursive: true })

let previewServer = null
if (!providedAppUrl) {
  previewServer = await startVitePreviewLoopbackServer({
    configuredPort: process.env.ZEROCHAT_PWA_PREVIEW_PORT,
    serverLabel: 'PWA offline preview server',
  })
  appUrl = previewServer.url
}
const staticAssetPaths = await collectStaticAssetPaths(distDir)
const expectedStaticAssetUrls = staticAssetPaths.map(
  (assetPath) => new URL(assetPath, appUrl).href,
)
const offlineModuleUrls = {
  locale: requiredStaticAsset(/^assets\/fr-FR-[^/]+\.js$/, 'French locale'),
  markdown: requiredStaticAsset(
    /^assets\/markdownWorkerClient-[^/]+\.js$/,
    'Markdown worker client',
  ),
  settings: requiredStaticAsset(
    /^assets\/index-[^/]+\.js$/,
    'app shell (Settings view export)',
  ),
}

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { detached: process.platform !== 'win32', stdio: 'ignore' },
)
chrome.zerochatProcessGroupLeader = process.platform !== 'win32'

async function main() {
  await waitForChrome(cdpPort)
  const target = await readJson(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(appUrl)}`,
    { method: 'PUT' },
  )
  const cdp = await connect(target.webSocketDebuggerUrl)
  const errors = []

  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Network.enable')
    await cdp.send('Page.navigate', { url: appUrl })
    await waitForLoad(cdp)
    await evaluate(
      cdp,
      `navigator.serviceWorker.ready.then(() => Boolean(navigator.serviceWorker.controller))`,
      true,
    )
    await cdp.send('Page.reload', { ignoreCache: false })
    await waitForLoad(cdp)
    const onlineState = await evaluate(
      cdp,
      `({
        controlled: Boolean(navigator.serviceWorker.controller),
        rootChildren: document.getElementById('root')?.children.length ?? 0,
        text: document.body.innerText,
      })`,
    )

    assert.equal(onlineState.controlled, true, 'Service worker must control the PWA before offline reload.')
    assert.ok(onlineState.rootChildren > 0, 'PWA root must render before offline reload.')

    const precacheState = await evaluate(
      cdp,
      `navigator.serviceWorker.ready.then(async () => {
        const cacheNames = (await caches.keys()).filter((name) =>
          name.startsWith('zerochat-shell-'),
        )
        const currentCacheName = cacheNames.at(-1)

        if (!currentCacheName) {
          throw new Error('Missing versioned ZeroChat cache')
        }

        const cache = await caches.open(currentCacheName)
        const cachedUrls = (await cache.keys()).map((request) => request.url)
        const expectedUrls = ${JSON.stringify(expectedStaticAssetUrls)}

        return {
          cacheNames,
          currentCacheName,
          count: cachedUrls.length,
          missingUrls: expectedUrls.filter((url) => !cachedUrls.includes(url)),
          hasDuplicateScopeKey: cachedUrls.includes(${JSON.stringify(appUrl)}),
        }
      })`,
      true,
    )

    assert.equal(
      precacheState.cacheNames.length,
      1,
      `Fresh PWA profile should activate one versioned cache: ${JSON.stringify(precacheState)}`,
    )
    assert.match(
      precacheState.currentCacheName,
      /^zerochat-shell-[a-f0-9]{16}$/,
      `PWA cache name must bind to the current static build: ${JSON.stringify(precacheState)}`,
    )
    assert.deepEqual(
      precacheState.missingUrls,
      [],
      `PWA install must atomically pre-cache every static build asset: ${JSON.stringify(precacheState)}`,
    )
    assert.equal(
      precacheState.count,
      staticAssetPaths.length,
      `Fresh versioned cache should contain only the complete static build: ${JSON.stringify(precacheState)}`,
    )
    assert.equal(
      precacheState.hasDuplicateScopeKey,
      false,
      `PWA cache must not duplicate the canonical index with a scope URL key: ${JSON.stringify(precacheState)}`,
    )

    const cachePruneState = await evaluate(
      cdp,
      `navigator.serviceWorker.ready.then(async () => {
        const cache = await caches.open(${JSON.stringify(precacheState.currentCacheName)})

        for (let index = 0; index < 90; index += 1) {
          await cache.put(
            new Request('/assets/zerochat-stale-cache-' + index + '.js'),
            new Response('stale', {
              headers: { 'content-type': 'application/javascript' },
            }),
          )
        }

        const stylesheet = document.querySelector('link[rel="stylesheet"]')?.href

        if (!stylesheet) {
          throw new Error('Missing stylesheet for cache prune smoke')
        }

        await new Promise((resolve, reject) => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href =
            stylesheet +
            (stylesheet.includes('?') ? '&' : '?') +
            'cache-prune=' +
            Date.now()
          link.onload = resolve
          link.onerror = () => reject(new Error('Cache prune stylesheet failed'))
          document.head.append(link)
        })

        for (let attempt = 0; attempt < 50; attempt += 1) {
          const keys = await cache.keys()

          if (keys.length <= 64) {
            break
          }

          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        const keys = await cache.keys()

        return {
          count: keys.length,
          stylesheet,
          stylesheetMatches: keys
            .map((request) => request.url)
            .filter((url) => url.includes(stylesheet.split('/').pop())),
          staleCount: keys.filter((request) =>
            request.url.includes('zerochat-stale-cache'),
          ).length,
          hasIndex: Boolean(await cache.match('/index.html')),
          hasShell: Boolean(await cache.match('/')),
          hasStylesheet: keys.some((request) => request.url === stylesheet),
        }
      })`,
      true,
    )

    assert.ok(
      cachePruneState.count <= 64,
      `PWA runtime cache should be pruned to 64 entries or fewer: ${JSON.stringify(cachePruneState)}`,
    )
    assert.ok(
      cachePruneState.staleCount < 90,
      `PWA runtime cache should remove stale same-origin assets: ${JSON.stringify(cachePruneState)}`,
    )
    assert.equal(
      cachePruneState.hasIndex,
      true,
      `PWA cache pruning must preserve cached index.html: ${JSON.stringify(cachePruneState)}`,
    )
    assert.equal(
      cachePruneState.hasShell,
      false,
      `PWA cache pruning must not retain a duplicate cached shell URL: ${JSON.stringify(cachePruneState)}`,
    )
    assert.equal(
      cachePruneState.hasStylesheet,
      true,
      `PWA cache pruning must preserve the current stylesheet: ${JSON.stringify(cachePruneState)}`,
    )

    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    })
    await evaluate(cdp, `window.dispatchEvent(new Event('offline'))`)
    await cdp.send('Page.reload', { ignoreCache: false })
    await waitForLoad(cdp)
    await evaluate(cdp, `window.dispatchEvent(new Event('offline'))`)

    const offlineState = await evaluate(
      cdp,
      `fetch('/__zerochat-offline-probe__?t=' + Date.now(), { cache: 'no-store' })
        .then(() => false)
        .catch(() => true)
        .then(async (offlineProbeFailed) => {
          let state = {
            controlled: Boolean(navigator.serviceWorker.controller),
            offlineProbeFailed,
            rootChildren: document.getElementById('root')?.children.length ?? 0,
            text: document.body.innerText,
          }

          for (let attempt = 0; attempt < 100; attempt += 1) {
            window.dispatchEvent(new Event('offline'))
            state = {
              controlled: Boolean(navigator.serviceWorker.controller),
              offlineProbeFailed,
              rootChildren: document.getElementById('root')?.children.length ?? 0,
              text: document.body.innerText,
            }

            if (
              /当前离线，消息将在联网后发送|You're offline\\. Messages will send when you're back online\\./.test(
                state.text,
              )
            ) {
              break
            }

            await new Promise((resolve) => setTimeout(resolve, 100))
          }

          return state
        })`,
      true,
    )

    assert.equal(offlineState.controlled, true, 'Service worker must still control after offline reload.')
    assert.equal(offlineState.offlineProbeFailed, true, 'Browser should be offline during the offline reload check.')
    assert.ok(offlineState.rootChildren > 0, 'PWA root must render after offline reload.')
    assert.match(offlineState.text, /ZeroChat|新建对话|首次配置|New chat/)
    assert.match(
      offlineState.text,
      /当前离线，消息将在联网后发送|You're offline\. Messages will send when you're back online\./,
      'PWA should show the PRD offline banner after an offline reload.',
    )

    const offlineLazyState = await evaluate(
      cdp,
      `(async () => {
        const urls = ${JSON.stringify(offlineModuleUrls)}
        const [localeModule, settingsModule, markdownModule] = await Promise.all([
          import(urls.locale),
          import(urls.settings),
          import(urls.markdown),
        ])
        const markdownHtml = await markdownModule.renderMarkdown(
          '**offline-worker**',
          {
            copy: 'Copy',
            copied: 'Copied',
            copyCode: 'Copy code',
            copyFailed: 'Copy failed',
            plainText: 'text',
          },
        )

        return {
          frenchLocaleLoaded:
            typeof localeModule.default === 'object' &&
            localeModule.default !== null,
          // Current app shell chunk boots the whole UI; a loaded module proves
          // the settings view shipped inside the offline-cached shell.
          settingsLoaded:
            typeof settingsModule === 'object' && settingsModule !== null,
          markdownWorkerRenderedRichText:
            markdownHtml.includes('<strong>offline-worker</strong>'),
        }
      })()`,
      true,
    )

    assert.deepEqual(
      offlineLazyState,
      {
        frenchLocaleLoaded: true,
        settingsLoaded: true,
        markdownWorkerRenderedRichText: true,
      },
      `Offline PWA must load lazy locale, Settings, and Markdown Worker assets from the complete versioned cache: ${JSON.stringify(offlineLazyState)}`,
    )

    let expectedProbeFailures = offlineState.offlineProbeFailed ? 1 : 0

    for (const event of cdp.events) {
      if (event.method === 'Runtime.exceptionThrown') {
        errors.push(event.params.exceptionDetails.text)
      }
      if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
        if (
          expectedProbeFailures > 0 &&
          event.params.entry.text.includes('net::ERR_INTERNET_DISCONNECTED')
        ) {
          expectedProbeFailures -= 1
          continue
        }

        errors.push(event.params.entry.text)
      }
    }

    assert.deepEqual(errors, [], 'PWA offline smoke browser console should not report runtime errors.')
    console.log('PWA offline smoke passed')
  } finally {
    const networkRestored = await restoreOnlineNetworkConditions(cdp)
    if (!networkRestored) {
      console.error('Warning: PWA offline smoke network-condition cleanup was deferred.')
    }
    cdp.close()
  }
}

try {
  await main()
} finally {
  const profileCleanup = {
    removeProfile: async () => await removeBrowserProfileWithRetry(profileDir, 120),
  }
  const { profileRemoved } = await settleBrowserRuntimeCleanup({
    child: chrome,
    profilePath: profileDir,
    stopProcessTree: async () => await stopChildProcessTree(chrome),
    removeProfile: async () => {
      const profileRemoved = await profileCleanup.removeProfile()
      return {
        profileRemoved,
        exactProfileProcessesGone: profileRemoved,
        profilePath: profileDir,
      }
    },
    additionalCleanup: [() => previewServer?.close()],
  })
  assert.ok(profileRemoved, `PWA offline smoke browser profile cleanup failed: ${profileDir}`)
}
