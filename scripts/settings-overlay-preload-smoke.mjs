import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
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
    if (await executableExists(candidate)) return candidate
  }

  throw new Error(
    'Chrome or Chromium was not found. Set CHROME_PATH to run Settings preload smoke.',
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readJson(url, init) {
  return readCdpJson(url, init)
}

function connect(wsUrl) {
  return connectCdp(wsUrl, { commandTimeoutMs: 60_000 })
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

async function verifyFailureRecovery({
  appUrl,
  cdpPort,
  failureParam,
  kind,
  desktopPath,
  mobilePath,
}) {
  const target = await readJson(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' },
  )
  const cdp = await connect(target.webSocketDebuggerUrl)
  const selector = kind === 'runtime' ? '.runtime-failure-state' : '.startup-failure-state'
  const sentinel = `${kind}-failure-smoke-sentinel`
  const url = new URL(appUrl)
  url.searchParams.set('app-test', '1')
  url.searchParams.set(failureParam, '1')

  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: 735,
      mobile: false,
      width: 1280,
    })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__zerochatRecoveryWindowErrors = []
        window.__zerochatRecoveryUnhandledRejections = []
        window.addEventListener('error', (event) => {
          window.__zerochatRecoveryWindowErrors.push(String(event.message || 'window error'))
        })
        window.addEventListener('unhandledrejection', (event) => {
          window.__zerochatRecoveryUnhandledRejections.push(String(event.reason))
        })
      `,
    })
    await cdp.send('Page.navigate', { url: url.href })
    await waitForLoad(cdp)

    const recoveryState = await evaluate(
      cdp,
      `new Promise(async (resolve) => {
        for (let attempt = 0; attempt < 160; attempt += 1) {
          const shell = document.querySelector(${JSON.stringify(selector)})
          const reload = shell?.querySelector('button')
          if (shell && reload) {
            resolve({
              role: shell.getAttribute('role'),
              live: shell.getAttribute('aria-live'),
              title: shell.querySelector('h1')?.textContent || '',
              description: shell.querySelector('p')?.textContent || '',
              reloadFocused: document.activeElement === reload,
              rawErrorVisible: document.body.innerText.includes(${JSON.stringify(sentinel)}),
              runtimeFailureVisible: Boolean(document.querySelector('.runtime-failure-state')),
              scrollWidth: document.documentElement.scrollWidth,
              viewportWidth: innerWidth,
              windowErrors: window.__zerochatRecoveryWindowErrors,
              unhandledRejections: window.__zerochatRecoveryUnhandledRejections,
            })
            return
          }
          await new Promise((waitResolve) => setTimeout(waitResolve, 50))
        }
        resolve({ missing: true })
      })`,
      true,
    )
    assert.equal(recoveryState.role, 'alert', JSON.stringify(recoveryState))
    assert.equal(recoveryState.live, 'assertive', JSON.stringify(recoveryState))
    assert.equal(recoveryState.reloadFocused, true, JSON.stringify(recoveryState))
    assert.equal(recoveryState.rawErrorVisible, false, JSON.stringify(recoveryState))
    if (kind === 'startup') {
      assert.equal(recoveryState.runtimeFailureVisible, false, JSON.stringify(recoveryState))
    }
    assert.equal(recoveryState.scrollWidth <= recoveryState.viewportWidth, true, JSON.stringify(recoveryState))
    assert.deepEqual(recoveryState.windowErrors, [], JSON.stringify(recoveryState))
    assert.deepEqual(recoveryState.unhandledRejections, [], JSON.stringify(recoveryState))

    const desktopScreenshot = await cdp.send('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'png',
    })
    const desktopBytes = Buffer.from(desktopScreenshot.data, 'base64')
    await mkdir(path.dirname(desktopPath), { recursive: true })
    await writeFile(desktopPath, desktopBytes)
    assert.ok(desktopBytes.length >= 5_000, `${kind} desktop screenshot too small`)

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: 844,
      mobile: true,
      width: 390,
    })
    await sleep(150)
    const mobileState = await evaluate(
      cdp,
      `(() => {
        const shell = document.querySelector(${JSON.stringify(selector)})
        const box = shell?.getBoundingClientRect()
        return {
          inside: Boolean(box) && box.left >= -1 && box.right <= innerWidth + 1,
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
        }
      })()`,
    )
    assert.equal(
      mobileState.inside && mobileState.scrollWidth <= mobileState.viewportWidth,
      true,
      JSON.stringify(mobileState),
    )
    const mobileScreenshot = await cdp.send('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'png',
    })
    const mobileBytes = Buffer.from(mobileScreenshot.data, 'base64')
    await writeFile(mobilePath, mobileBytes)
    assert.ok(mobileBytes.length >= 5_000, `${kind} mobile screenshot too small`)

    return {
      description: recoveryState.description,
      desktopBytes: desktopBytes.length,
      mobileBytes: mobileBytes.length,
      title: recoveryState.title,
    }
  } finally {
    cdp.close()
  }
}

function settingsAssetRequests(events) {
  return events
    .filter((event) => event.method === 'Network.requestWillBeSent')
    .map((event) => event.params?.request?.url ?? '')
    .filter((url) => /\/assets\/SettingsView-[^/]+\.js(?:\?|$)/u.test(url))
}

const chromePath = await resolveChromePath()
const cdpPort = await resolveFetchSafeLoopbackPort(
  process.env.ZEROCHAT_SETTINGS_PRELOAD_CDP_PORT,
  'Settings preload Chrome remote debugging',
)
const providedAppUrl = process.env.ZEROCHAT_SETTINGS_PRELOAD_URL
let appUrl = providedAppUrl ?? ''
const profileDir = path.join(os.tmpdir(), `zerochat-settings-preload-${Date.now()}`)

await access(path.resolve('dist', 'index.html')).catch(() => {
  throw new Error('dist/index.html is missing. Run the production build before Settings preload smoke.')
})
await mkdir(profileDir, { recursive: true })

let previewServer = null
if (!providedAppUrl) {
  previewServer = await startVitePreviewLoopbackServer({
    configuredPort: process.env.ZEROCHAT_SETTINGS_PRELOAD_PORT,
    serverLabel: 'Settings preload preview server',
  })
  appUrl = previewServer.url
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
  { detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true },
)
chrome.zerochatProcessGroupLeader = process.platform !== 'win32'

async function main() {
  await waitForChrome(cdpPort)
  const target = await readJson(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' },
  )
  const cdp = await connect(target.webSocketDebuggerUrl)

  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(Navigator.prototype, 'connection', {
          configurable: true,
          get() {
            return { saveData: true, effectiveType: '2g', downlink: 0.1, rtt: 1800 }
          },
        })
        Object.defineProperty(Navigator.prototype, 'onLine', {
          configurable: true,
          get() { return true },
        })
        window.__zerochatPreloadErrors = []
        window.addEventListener('unhandledrejection', (event) => {
          window.__zerochatPreloadErrors.push(String(event.reason))
        })
      `,
    })
    await cdp.send('Page.navigate', { url: appUrl })
    await waitForLoad(cdp)

    const startupState = await evaluate(
      cdp,
      `new Promise(async (resolve) => {
        for (let attempt = 0; attempt < 160; attempt += 1) {
          const shell = document.querySelector('.zc-app')
          const guide = document.querySelector('.zc-empty-card.guide-modal')
          if (shell && guide) {
            resolve({
              guideVisible: true,
              rootChildren: document.getElementById('root')?.children.length ?? 0,
              saveData: navigator.connection?.saveData === true,
              effectiveType: navigator.connection?.effectiveType ?? '',
              online: navigator.onLine,
            })
            return
          }
          await new Promise((waitResolve) => setTimeout(waitResolve, 50))
        }
        resolve({
          guideVisible: false,
          rootChildren: document.getElementById('root')?.children.length ?? 0,
          saveData: navigator.connection?.saveData === true,
          effectiveType: navigator.connection?.effectiveType ?? '',
          online: navigator.onLine,
          body: document.body.innerText.slice(0, 400),
        })
      })`,
      true,
    )

    assert.equal(startupState.saveData, true, JSON.stringify(startupState))
    assert.equal(startupState.effectiveType, '2g', JSON.stringify(startupState))
    assert.equal(startupState.online, true, JSON.stringify(startupState))
    assert.equal(startupState.guideVisible, true, JSON.stringify(startupState))

    await sleep(2800)
    const beforeOpenSettingsRequests = settingsAssetRequests(cdp.events)
    assert.equal(
      beforeOpenSettingsRequests.length,
      0,
      `Settings code must not be fetched as an idle chunk: ${JSON.stringify(beforeOpenSettingsRequests)}`,
    )

    const opened = await evaluate(
      cdp,
      `(() => {
        const control = document.querySelector('[data-zc-provider-settings-entry="true"]')
        if (!(control instanceof HTMLButtonElement) || control.disabled) return false
        control.click()
        return true
      })()`,
    )
    assert.equal(opened, true, 'Settings must open through a visible control.')

    const settingsState = await evaluate(
      cdp,
      `new Promise(async (resolve) => {
        for (let attempt = 0; attempt < 160; attempt += 1) {
          const overlay = document.querySelector('.zc-settings-overlay')
          const dialog = overlay?.querySelector('.zc-settings[role="dialog"]')
          const general = document.querySelector('#settings-tab-general')
          if (overlay && dialog && general) {
            resolve({
              dialog: dialog.getAttribute('role'),
              label: dialog.getAttribute('aria-label') ?? '',
              general: true,
              noLoading: !document.querySelector('[data-initial-loading]'),
            })
            return
          }
          await new Promise((waitResolve) => setTimeout(waitResolve, 50))
        }
        resolve({ dialog: '', label: '', general: false, noLoading: false })
      })`,
      true,
    )
    assert.equal(settingsState.dialog, 'dialog', JSON.stringify(settingsState))
    assert.equal(settingsState.general, true, JSON.stringify(settingsState))
    assert.equal(settingsState.noLoading, true, JSON.stringify(settingsState))

    const afterOpenSettingsRequests = settingsAssetRequests(cdp.events)
    assert.equal(
      afterOpenSettingsRequests.length,
      1,
      `Current Settings must fetch exactly one production lazy chunk after the visible entry is activated: ${JSON.stringify(afterOpenSettingsRequests)}`,
    )

    console.log('Settings preload smoke passed: no idle Settings chunk and one on-demand production request.')

    const runtimeFailureEvidence = await verifyFailureRecovery({
      appUrl,
      cdpPort,
      failureParam: 'zerochat-runtime-failure-smoke',
      kind: 'runtime',
      desktopPath: '.manual-qa/web-runtime-failure-recovery-current.png',
      mobilePath: '.manual-qa/web-runtime-failure-recovery-mobile-current.png',
    })
    const startupFailureEvidence = await verifyFailureRecovery({
      appUrl,
      cdpPort,
      failureParam: 'zerochat-startup-failure-smoke',
      kind: 'startup',
      desktopPath: '.manual-qa/web-startup-failure-recovery-current.png',
      mobilePath: '.manual-qa/web-startup-failure-recovery-mobile-current.png',
    })
    assert.equal(
      startupFailureEvidence.title,
      runtimeFailureEvidence.title,
      JSON.stringify({ runtimeFailureEvidence, startupFailureEvidence }),
    )
    assert.equal(
      startupFailureEvidence.description,
      runtimeFailureEvidence.description,
      JSON.stringify({ runtimeFailureEvidence, startupFailureEvidence }),
    )
    console.log(
      `Runtime/startup recovery smoke passed: ${JSON.stringify({ runtimeFailureEvidence, startupFailureEvidence })}`,
    )
  } finally {
    cdp.close()
  }
}

try {
  await main()
} finally {
  await settleBrowserRuntimeCleanup({
    child: chrome,
    profilePath: profileDir,
    stopProcessTree: async () => await stopChildProcessTree(chrome),
    removeProfile: async () => {
      const profileRemoved = await removeBrowserProfileWithRetry(profileDir)
      return {
        profileRemoved,
        exactProfileProcessesGone: profileRemoved,
        profilePath: profileDir,
      }
    },
    additionalCleanup: [() => previewServer?.close()],
  })
}
