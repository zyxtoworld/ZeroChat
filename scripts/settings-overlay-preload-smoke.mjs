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
    if (await executableExists(candidate)) {
      return candidate
    }
  }

  throw new Error(
    'Chrome or Chromium was not found. Set CHROME_PATH to run Settings overlay preload smoke.',
  )
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
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

function settingsChunkRequests(events) {
  return events
    .filter((event) => event.method === 'Network.requestWillBeSent')
    .map((event) => event.params?.request?.url ?? '')
    .filter((url) => /\/assets\/SettingsOverlayHost-[^/]+\.js(?:\?|$)/.test(url))
}

function firstRunGuideChunkRequests(events) {
  return events
    .filter((event) => event.method === 'Network.requestWillBeSent')
    .map((event) => event.params?.request?.url ?? '')
    .filter((url) => /\/assets\/FirstRunGuide-[^/]+\.js(?:\?|$)/.test(url))
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
  throw new Error('dist/index.html is missing. Run the production build before Settings overlay preload smoke.')
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
  { stdio: 'ignore' },
)

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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(Navigator.prototype, 'connection', {
          configurable: true,
          get() {
            return {
              saveData: true,
              effectiveType: '2g',
              downlink: 0.1,
              rtt: 1800,
            }
          },
        })
        Object.defineProperty(Navigator.prototype, 'onLine', {
          configurable: true,
          get() {
            return true
          },
        })
      `,
    })
    await cdp.send('Page.navigate', { url: appUrl })
    await waitForLoad(cdp)

    const startupState = await evaluate(
      cdp,
      `new Promise(async (resolve) => {
        const textOf = (element) =>
          (element?.textContent || element?.getAttribute?.('aria-label') || '').replace(/\\s+/g, ' ').trim()
        const findControl = (names) =>
          Array.from(document.querySelectorAll('button, [role="button"], label, a')).find((control) =>
            names.some((name) => textOf(control).includes(name) || control.getAttribute?.('aria-label')?.includes(name))
          )

        for (let attempt = 0; attempt < 100; attempt += 1) {
          const rootChildren = document.getElementById('root')?.children.length ?? 0
          const skip = findControl([
            '跳过，先本地使用',
            'Skip, use locally',
            'Ignorer, utiliser en local',
            'Omitir, usar localmente',
          ])

          if (rootChildren > 0 && skip) {
            resolve({
              rootChildren,
              saveData: navigator.connection?.saveData === true,
              effectiveType: navigator.connection?.effectiveType ?? '',
              online: navigator.onLine,
              skipVisible: true,
            })
            return
          }

          await new Promise((waitResolve) => setTimeout(waitResolve, 50))
        }

        resolve({
          rootChildren: document.getElementById('root')?.children.length ?? 0,
          saveData: navigator.connection?.saveData === true,
          effectiveType: navigator.connection?.effectiveType ?? '',
          online: navigator.onLine,
          skipVisible: false,
          body: document.body.innerText.slice(0, 400),
        })
      })`,
      true,
    )

    assert.equal(
      startupState.saveData,
      true,
      `Save-Data shim must be active before the app schedules idle preload: ${JSON.stringify(startupState)}`,
    )
    assert.equal(
      startupState.effectiveType,
      '2g',
      `2g network shim must be active before the app schedules idle preload: ${JSON.stringify(startupState)}`,
    )
    assert.equal(
      startupState.skipVisible,
      true,
      `First-run guide must render before idle-preload assertion: ${JSON.stringify(startupState)}`,
    )

    await sleep(2800)

    const beforeOpenSettingsRequests = settingsChunkRequests(cdp.events)
    assert.equal(
      beforeOpenSettingsRequests.length,
      0,
      `Settings overlay chunk must not be idle-preloaded on save-data/2g: ${JSON.stringify(
        beforeOpenSettingsRequests,
      )}`,
    )

    const activeOpenState = await evaluate(
      cdp,
      `new Promise(async (resolve, reject) => {
        const textOf = (element) =>
          (element?.textContent || element?.getAttribute?.('aria-label') || '').replace(/\\s+/g, ' ').trim()
        const clickControl = (names) => {
          const control = Array.from(document.querySelectorAll('button, [role="button"], label, a')).find((item) =>
            names.some((name) => textOf(item).includes(name) || item.getAttribute?.('aria-label')?.includes(name))
          )

          if (!control) {
            return false
          }

          control.click()
          return true
        }

        if (!clickControl([
          '跳过，先本地使用',
          'Skip, use locally',
          'Ignorer, utiliser en local',
          'Omitir, usar localmente',
        ])) {
          reject(new Error('Missing first-run skip-local control'))
          return
        }

        for (let attempt = 0; attempt < 100; attempt += 1) {
          const opener = document.querySelector('[data-settings-opener="true"]')

          if (opener) {
            opener.click()
            break
          }

          await new Promise((waitResolve) => setTimeout(waitResolve, 50))
        }

        for (let attempt = 0; attempt < 120; attempt += 1) {
          const modal = document.querySelector('.settings-modal')
          const title = document.querySelector('#settings-title')?.textContent?.trim() ?? ''

          if (modal && title) {
            resolve({
              settingsVisible: true,
              title,
              body: document.body.innerText.slice(0, 400),
            })
            return
          }

          await new Promise((waitResolve) => setTimeout(waitResolve, 50))
        }

        resolve({
          settingsVisible: false,
          title: document.querySelector('#settings-title')?.textContent?.trim() ?? '',
          body: document.body.innerText.slice(0, 400),
        })
      })`,
      true,
    )

    assert.equal(
      activeOpenState.settingsVisible,
      true,
      `Settings must still open on direct user action under save-data/2g: ${JSON.stringify(activeOpenState)}`,
    )

    const afterOpenSettingsRequests = settingsChunkRequests(cdp.events)
    assert.ok(
      afterOpenSettingsRequests.length >= 1,
      `Settings overlay chunk must load after direct user action: ${JSON.stringify({
        activeOpenState,
        requests: afterOpenSettingsRequests,
      })}`,
    )

    console.log(
      `Settings overlay preload smoke passed: no idle Settings chunk on save-data/2g, active open loaded ${afterOpenSettingsRequests[0]}`,
    )

    const recoveryTarget = await readJson(
      `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
      { method: 'PUT' },
    )
    const recoveryCdp = await connect(recoveryTarget.webSocketDebuggerUrl)

    try {
      await recoveryCdp.send('Page.enable')
      await recoveryCdp.send('Runtime.enable')
      await recoveryCdp.send('Network.enable')
      await recoveryCdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await recoveryCdp.send('Network.setBypassServiceWorker', { bypass: true })
      await recoveryCdp.send('Network.setBlockedURLs', {
        urls: ['*FirstRunGuide-*.js*'],
      })
      await recoveryCdp.send('Storage.clearDataForOrigin', {
        origin: new URL(appUrl).origin,
        storageTypes: 'all',
      })
      await recoveryCdp.send('Emulation.setDeviceMetricsOverride', {
        deviceScaleFactor: 1,
        height: 735,
        mobile: false,
        width: 1280,
      })
      await recoveryCdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          window.__zeroChatUnhandledRejections = []
          window.addEventListener('unhandledrejection', (event) => {
            window.__zeroChatUnhandledRejections.push(String(event.reason))
          })
        `,
      })
      await recoveryCdp.send('Page.navigate', {
        url: `${appUrl}${appUrl.includes('?') ? '&' : '?'}lazy-overlay-recovery=1`,
      })
      await waitForLoad(recoveryCdp)

      const recoveryState = await evaluate(
        recoveryCdp,
        `new Promise(async (resolve) => {
          for (let attempt = 0; attempt < 160; attempt += 1) {
            const dialog = document.querySelector('.lazy-overlay-modal')
            const alert = dialog?.querySelector('[role="alert"]')
            const reload = dialog?.querySelector('.primary-button')

            if (dialog && alert && reload) {
              resolve({
                alertLive: alert.getAttribute('aria-live'),
                appShellVisible: Boolean(document.querySelector('.app-shell')),
                busy: dialog.getAttribute('aria-busy'),
                closeButtonCount: dialog.querySelectorAll('.icon-button').length,
                description: alert.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
                reloadFocused: document.activeElement === reload,
                reloadLabel: reload.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
                rootChildren: document.getElementById('root')?.children.length ?? 0,
                unhandledRejections: window.__zeroChatUnhandledRejections,
              })
              return
            }

            await new Promise((waitResolve) => setTimeout(waitResolve, 50))
          }

          resolve({
            alertLive: '',
            appShellVisible: Boolean(document.querySelector('.app-shell')),
            busy: '',
            closeButtonCount: -1,
            description: '',
            reloadFocused: false,
            reloadLabel: '',
            rootChildren: document.getElementById('root')?.children.length ?? 0,
            unhandledRejections: window.__zeroChatUnhandledRejections,
            body: document.body.innerText.slice(0, 500),
          })
        })`,
        true,
      )

      assert.equal(
        recoveryState.appShellVisible,
        true,
        `The app shell must survive a blocked first-run chunk: ${JSON.stringify(recoveryState)}`,
      )
      assert.equal(
        recoveryState.busy,
        'false',
        `The blocked chunk must resolve to a non-busy failure dialog: ${JSON.stringify(recoveryState)}`,
      )
      assert.equal(
        recoveryState.alertLive,
        'assertive',
        `The blocked chunk must expose an assertive failure alert: ${JSON.stringify(recoveryState)}`,
      )
      assert.ok(
        recoveryState.description.length > 0 && recoveryState.reloadLabel.length > 0,
        `The blocked chunk must expose localized failure and reload copy: ${JSON.stringify(recoveryState)}`,
      )
      assert.equal(
        recoveryState.reloadFocused,
        true,
        `The reload recovery action must receive focus: ${JSON.stringify(recoveryState)}`,
      )
      assert.equal(
        recoveryState.closeButtonCount,
        0,
        `Mandatory first-run recovery must not expose a dismiss button: ${JSON.stringify(recoveryState)}`,
      )
      assert.deepEqual(
        recoveryState.unhandledRejections,
        [],
        `The blocked chunk must not escape as an unhandled rejection: ${JSON.stringify(recoveryState)}`,
      )

      const firstRunRequests = firstRunGuideChunkRequests(recoveryCdp.events)
      assert.ok(
        firstRunRequests.length >= 1,
        `The recovery scenario must actually request the blocked first-run chunk: ${JSON.stringify(firstRunRequests)}`,
      )

      const screenshot = await recoveryCdp.send('Page.captureScreenshot', {
        captureBeyondViewport: false,
        format: 'png',
      })
      const screenshotBytes = Buffer.from(screenshot.data, 'base64')
      assert.ok(
        screenshotBytes.length >= 10_000,
        `Lazy overlay recovery screenshot is unexpectedly small: ${screenshotBytes.length} bytes`,
      )
      await mkdir('.manual-qa', { recursive: true })
      await writeFile(
        '.manual-qa/web-lazy-overlay-recovery-current.png',
        screenshotBytes,
      )

      await recoveryCdp.send('Emulation.setDeviceMetricsOverride', {
        deviceScaleFactor: 1,
        height: 844,
        mobile: true,
        width: 390,
      })
      await sleep(150)

      const mobileLayout = await evaluate(
        recoveryCdp,
        `(() => {
          const dialog = document.querySelector('.lazy-overlay-modal')
          const description = dialog?.querySelector('[role="alert"]')
          const reload = dialog?.querySelector('.primary-button')
          const dialogRect = dialog?.getBoundingClientRect()
          const descriptionRect = description?.getBoundingClientRect()
          const reloadRect = reload?.getBoundingClientRect()

          return {
            descriptionInside:
              Boolean(dialogRect && descriptionRect) &&
              descriptionRect.left >= dialogRect.left &&
              descriptionRect.right <= dialogRect.right,
            dialogInside:
              Boolean(dialogRect) && dialogRect.left >= 0 && dialogRect.right <= innerWidth,
            reloadInside:
              Boolean(dialogRect && reloadRect) &&
              reloadRect.left >= dialogRect.left &&
              reloadRect.right <= dialogRect.right,
            scrollWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
          }
        })()`,
      )
      assert.equal(
        mobileLayout.dialogInside,
        true,
        `Lazy overlay recovery dialog must fit the mobile viewport: ${JSON.stringify(mobileLayout)}`,
      )
      assert.equal(
        mobileLayout.descriptionInside,
        true,
        `Lazy overlay recovery copy must stay inside the mobile dialog: ${JSON.stringify(mobileLayout)}`,
      )
      assert.equal(
        mobileLayout.reloadInside,
        true,
        `Lazy overlay recovery action must stay inside the mobile dialog: ${JSON.stringify(mobileLayout)}`,
      )
      assert.ok(
        mobileLayout.scrollWidth <= mobileLayout.viewportWidth,
        `Lazy overlay recovery must not create horizontal mobile overflow: ${JSON.stringify(mobileLayout)}`,
      )

      const mobileScreenshot = await recoveryCdp.send('Page.captureScreenshot', {
        captureBeyondViewport: false,
        format: 'png',
      })
      const mobileScreenshotBytes = Buffer.from(mobileScreenshot.data, 'base64')
      assert.ok(
        mobileScreenshotBytes.length >= 10_000,
        `Mobile lazy overlay recovery screenshot is unexpectedly small: ${mobileScreenshotBytes.length} bytes`,
      )
      await writeFile(
        '.manual-qa/web-lazy-overlay-recovery-mobile-current.png',
        mobileScreenshotBytes,
      )

      console.log(
        `Critical lazy overlay recovery smoke passed: blocked ${firstRunRequests[0]}, desktop screenshot ${screenshotBytes.length} bytes, mobile screenshot ${mobileScreenshotBytes.length} bytes`,
      )
    } finally {
      recoveryCdp.close()
    }

    const runtimeFailureTarget = await readJson(
      `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
      { method: 'PUT' },
    )
    const runtimeFailureCdp = await connect(runtimeFailureTarget.webSocketDebuggerUrl)

    try {
      await runtimeFailureCdp.send('Page.enable')
      await runtimeFailureCdp.send('Runtime.enable')
      await runtimeFailureCdp.send('Network.enable')
      await runtimeFailureCdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await runtimeFailureCdp.send('Network.setBypassServiceWorker', { bypass: true })
      await runtimeFailureCdp.send('Emulation.setDeviceMetricsOverride', {
        deviceScaleFactor: 1,
        height: 735,
        mobile: false,
        width: 1280,
      })
      await runtimeFailureCdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          window.__zeroChatRuntimeFailureWindowErrors = []
          window.__zeroChatRuntimeFailureUnhandledRejections = []
          window.addEventListener('error', (event) => {
            window.__zeroChatRuntimeFailureWindowErrors.push(
              event.error?.stack || event.message || 'window error'
            )
          })
          window.addEventListener('unhandledrejection', (event) => {
            window.__zeroChatRuntimeFailureUnhandledRejections.push(
              event.reason?.stack || event.reason?.message || String(event.reason)
            )
          })
        `,
      })
      const runtimeFailureUrl = new URL(appUrl)
      runtimeFailureUrl.searchParams.set('zerochat-runtime-failure-smoke', '1')
      await runtimeFailureCdp.send('Page.navigate', {
        url: runtimeFailureUrl.href,
      })
      await waitForLoad(runtimeFailureCdp)

      const runtimeFailureState = await evaluate(
        runtimeFailureCdp,
        `new Promise(async (resolve) => {
          for (let attempt = 0; attempt < 160; attempt += 1) {
            const failure = document.querySelector('.runtime-failure-state')
            const title = failure?.querySelector('h1')
            const description = failure?.querySelector('p')
            const reload = failure?.querySelector('button')

            if (failure && title && description && reload) {
              const reloadRect = reload.getBoundingClientRect()
              resolve({
                alertLive: failure.getAttribute('aria-live'),
                alertRole: failure.getAttribute('role'),
                appShellVisible: Boolean(document.querySelector('.app-shell')),
                description: description.textContent?.replace(/\s+/g, ' ').trim() ?? '',
                hasReloadIcon: Boolean(reload.querySelector('svg')),
                rawErrorVisible: document.body.innerText.includes('Intentional local runtime failure smoke probe.'),
                reloadFocused: document.activeElement === reload,
                reloadInsideViewport:
                  reloadRect.left >= 0 &&
                  reloadRect.right <= innerWidth &&
                  reloadRect.top >= 0 &&
                  reloadRect.bottom <= innerHeight,
                reloadLabel: reload.textContent?.replace(/\s+/g, ' ').trim() ?? '',
                reloadType: reload.getAttribute('type'),
                rootChildren: document.getElementById('root')?.children.length ?? 0,
                scrollWidth: document.documentElement.scrollWidth,
                title: title.textContent?.replace(/\s+/g, ' ').trim() ?? '',
                unhandledRejections: window.__zeroChatRuntimeFailureUnhandledRejections,
                viewportWidth: innerWidth,
                windowErrors: window.__zeroChatRuntimeFailureWindowErrors,
              })
              return
            }

            await new Promise((waitResolve) => setTimeout(waitResolve, 50))
          }

          resolve({
            alertLive: '',
            alertRole: '',
            appShellVisible: Boolean(document.querySelector('.app-shell')),
            body: document.body.innerText.slice(0, 500),
            description: '',
            hasReloadIcon: false,
            rawErrorVisible: false,
            reloadFocused: false,
            reloadInsideViewport: false,
            reloadLabel: '',
            reloadType: '',
            rootChildren: document.getElementById('root')?.children.length ?? 0,
            scrollWidth: document.documentElement.scrollWidth,
            title: '',
            unhandledRejections: window.__zeroChatRuntimeFailureUnhandledRejections,
            viewportWidth: innerWidth,
            windowErrors: window.__zeroChatRuntimeFailureWindowErrors,
          })
        })`,
        true,
      )

      assert.equal(
        runtimeFailureState.alertRole === 'alert' &&
          runtimeFailureState.alertLive === 'assertive',
        true,
        `Root runtime failure must render an assertive alert: ${JSON.stringify(runtimeFailureState)}`,
      )
      assert.equal(
        runtimeFailureState.appShellVisible,
        false,
        `The failed child tree must be replaced instead of remaining partially interactive: ${JSON.stringify(runtimeFailureState)}`,
      )
      assert.equal(
        runtimeFailureState.rootChildren,
        1,
        `Root runtime recovery must leave one coherent fallback surface: ${JSON.stringify(runtimeFailureState)}`,
      )
      assert.ok(
        runtimeFailureState.title.length > 0 &&
          runtimeFailureState.description.length > 0 &&
          runtimeFailureState.reloadLabel.length > 0,
        `Root runtime recovery must expose localized failure and reload copy: ${JSON.stringify(runtimeFailureState)}`,
      )
      assert.equal(
        runtimeFailureState.reloadType === 'button' &&
          runtimeFailureState.hasReloadIcon &&
          runtimeFailureState.reloadFocused &&
          runtimeFailureState.reloadInsideViewport,
        true,
        `Root runtime recovery must expose a focused in-viewport reload command: ${JSON.stringify(runtimeFailureState)}`,
      )
      assert.equal(
        runtimeFailureState.rawErrorVisible,
        false,
        `Root runtime recovery must not expose raw render errors: ${JSON.stringify(runtimeFailureState)}`,
      )
      assert.deepEqual(
        runtimeFailureState.windowErrors,
        [],
        `The caught render failure must not escape to window.error: ${JSON.stringify(runtimeFailureState)}`,
      )
      assert.deepEqual(
        runtimeFailureState.unhandledRejections,
        [],
        `The caught render failure must not escape as an unhandled rejection: ${JSON.stringify(runtimeFailureState)}`,
      )
      assert.ok(
        runtimeFailureState.scrollWidth <= runtimeFailureState.viewportWidth,
        `Root runtime recovery must not create horizontal overflow: ${JSON.stringify(runtimeFailureState)}`,
      )

      const runtimeFailureScreenshot = await runtimeFailureCdp.send(
        'Page.captureScreenshot',
        {
          captureBeyondViewport: false,
          format: 'png',
        },
      )
      const runtimeFailureScreenshotBytes = Buffer.from(
        runtimeFailureScreenshot.data,
        'base64',
      )
      assert.ok(
        runtimeFailureScreenshotBytes.length >= 5_000,
        `Root runtime recovery screenshot is unexpectedly small: ${runtimeFailureScreenshotBytes.length} bytes`,
      )
      await writeFile(
        '.manual-qa/web-runtime-failure-recovery-current.png',
        runtimeFailureScreenshotBytes,
      )

      await runtimeFailureCdp.send('Emulation.setDeviceMetricsOverride', {
        deviceScaleFactor: 1,
        height: 844,
        mobile: true,
        width: 390,
      })
      await sleep(150)

      const runtimeFailureMobileState = await evaluate(
        runtimeFailureCdp,
        `(() => {
          const failure = document.querySelector('.runtime-failure-state')
          const title = failure?.querySelector('h1')
          const description = failure?.querySelector('p')
          const reload = failure?.querySelector('button')
          const failureRect = failure?.getBoundingClientRect()
          const titleRect = title?.getBoundingClientRect()
          const descriptionRect = description?.getBoundingClientRect()
          const reloadRect = reload?.getBoundingClientRect()
          const inside = (rect) =>
            Boolean(rect) && rect.left >= 0 && rect.right <= innerWidth

          return {
            descriptionInside: inside(descriptionRect),
            failureInside: inside(failureRect),
            reloadInside: inside(reloadRect),
            scrollWidth: document.documentElement.scrollWidth,
            titleInside: inside(titleRect),
            viewportWidth: innerWidth,
          }
        })()`,
      )
      assert.equal(
        runtimeFailureMobileState.failureInside &&
          runtimeFailureMobileState.titleInside &&
          runtimeFailureMobileState.descriptionInside &&
          runtimeFailureMobileState.reloadInside,
        true,
        `Root runtime recovery content must fit the mobile viewport: ${JSON.stringify(runtimeFailureMobileState)}`,
      )
      assert.ok(
        runtimeFailureMobileState.scrollWidth <=
          runtimeFailureMobileState.viewportWidth,
        `Root runtime recovery must not create horizontal mobile overflow: ${JSON.stringify(runtimeFailureMobileState)}`,
      )

      const runtimeFailureMobileScreenshot = await runtimeFailureCdp.send(
        'Page.captureScreenshot',
        {
          captureBeyondViewport: false,
          format: 'png',
        },
      )
      const runtimeFailureMobileScreenshotBytes = Buffer.from(
        runtimeFailureMobileScreenshot.data,
        'base64',
      )
      assert.ok(
        runtimeFailureMobileScreenshotBytes.length >= 5_000,
        `Mobile root runtime recovery screenshot is unexpectedly small: ${runtimeFailureMobileScreenshotBytes.length} bytes`,
      )
      await writeFile(
        '.manual-qa/web-runtime-failure-recovery-mobile-current.png',
        runtimeFailureMobileScreenshotBytes,
      )

      console.log(
        `Root runtime failure recovery smoke passed: desktop screenshot ${runtimeFailureScreenshotBytes.length} bytes, mobile screenshot ${runtimeFailureMobileScreenshotBytes.length} bytes`,
      )

      await runtimeFailureCdp.send('Emulation.setDeviceMetricsOverride', {
        deviceScaleFactor: 1,
        height: 735,
        mobile: false,
        width: 1280,
      })
      const startupFailureUrl = new URL(appUrl)
      startupFailureUrl.searchParams.set('zerochat-startup-failure-smoke', '1')
      await runtimeFailureCdp.send('Page.navigate', {
        url: startupFailureUrl.href,
      })
      await waitForLoad(runtimeFailureCdp)

      const startupFailureState = await evaluate(
        runtimeFailureCdp,
        `new Promise(async (resolve) => {
          for (let attempt = 0; attempt < 160; attempt += 1) {
            const failure = document.querySelector(
              '.startup-failure-state:not(.runtime-failure-state)'
            )
            const title = failure?.querySelector('h1')
            const description = failure?.querySelector('p')
            const reload = failure?.querySelector('button')

            if (failure && title && description && reload) {
              const reloadRect = reload.getBoundingClientRect()
              resolve({
                alertLive: failure.getAttribute('aria-live'),
                alertRole: failure.getAttribute('role'),
                appShellVisible: Boolean(document.querySelector('.app-shell')),
                description: description.textContent?.replace(/\s+/g, ' ').trim() ?? '',
                rawErrorVisible: document.body.innerText.includes('Intentional local startup failure smoke probe.'),
                reloadFocused: document.activeElement === reload,
                reloadInsideViewport:
                  reloadRect.left >= 0 &&
                  reloadRect.right <= innerWidth &&
                  reloadRect.top >= 0 &&
                  reloadRect.bottom <= innerHeight,
                reloadLabel: reload.textContent?.replace(/\s+/g, ' ').trim() ?? '',
                reloadType: reload.getAttribute('type'),
                rootChildren: document.getElementById('root')?.children.length ?? 0,
                runtimeFallbackVisible: Boolean(document.querySelector('.runtime-failure-state')),
                scrollWidth: document.documentElement.scrollWidth,
                title: title.textContent?.replace(/\s+/g, ' ').trim() ?? '',
                unhandledRejections: window.__zeroChatRuntimeFailureUnhandledRejections,
                viewportWidth: innerWidth,
                windowErrors: window.__zeroChatRuntimeFailureWindowErrors,
              })
              return
            }

            await new Promise((waitResolve) => setTimeout(waitResolve, 50))
          }

          resolve({
            alertLive: '',
            alertRole: '',
            appShellVisible: Boolean(document.querySelector('.app-shell')),
            body: document.body.innerText.slice(0, 500),
            description: '',
            rawErrorVisible: false,
            reloadFocused: false,
            reloadInsideViewport: false,
            reloadLabel: '',
            reloadType: '',
            rootChildren: document.getElementById('root')?.children.length ?? 0,
            runtimeFallbackVisible: Boolean(document.querySelector('.runtime-failure-state')),
            scrollWidth: document.documentElement.scrollWidth,
            title: '',
            unhandledRejections: window.__zeroChatRuntimeFailureUnhandledRejections,
            viewportWidth: innerWidth,
            windowErrors: window.__zeroChatRuntimeFailureWindowErrors,
          })
        })`,
        true,
      )

      assert.equal(
        startupFailureState.alertRole === 'alert' &&
          startupFailureState.alertLive === 'assertive',
        true,
        `Pre-React startup failure must render an assertive alert: ${JSON.stringify(startupFailureState)}`,
      )
      assert.equal(
        !startupFailureState.appShellVisible &&
          !startupFailureState.runtimeFallbackVisible &&
          startupFailureState.rootChildren === 1,
        true,
        `Pre-React startup recovery must own one coherent fallback surface: ${JSON.stringify(startupFailureState)}`,
      )
      assert.deepEqual(
        {
          description: startupFailureState.description,
          reloadLabel: startupFailureState.reloadLabel,
          title: startupFailureState.title,
        },
        {
          description: runtimeFailureState.description,
          reloadLabel: runtimeFailureState.reloadLabel,
          title: runtimeFailureState.title,
        },
        `Pre-React and React recovery surfaces must share the same localized copy: ${JSON.stringify({ runtimeFailureState, startupFailureState })}`,
      )
      assert.equal(
        startupFailureState.reloadType === 'button' &&
          startupFailureState.reloadFocused &&
          startupFailureState.reloadInsideViewport,
        true,
        `Pre-React startup recovery must expose a focused in-viewport reload command: ${JSON.stringify(startupFailureState)}`,
      )
      assert.equal(
        startupFailureState.rawErrorVisible,
        false,
        `Pre-React startup recovery must not expose raw startup errors: ${JSON.stringify(startupFailureState)}`,
      )
      assert.deepEqual(
        startupFailureState.windowErrors,
        [],
        `The caught startup failure must not escape to window.error: ${JSON.stringify(startupFailureState)}`,
      )
      assert.deepEqual(
        startupFailureState.unhandledRejections,
        [],
        `The caught startup failure must not escape as an unhandled rejection: ${JSON.stringify(startupFailureState)}`,
      )
      assert.ok(
        startupFailureState.scrollWidth <= startupFailureState.viewportWidth,
        `Pre-React startup recovery must not create horizontal overflow: ${JSON.stringify(startupFailureState)}`,
      )

      const startupFailureScreenshot = await runtimeFailureCdp.send(
        'Page.captureScreenshot',
        {
          captureBeyondViewport: false,
          format: 'png',
        },
      )
      const startupFailureScreenshotBytes = Buffer.from(
        startupFailureScreenshot.data,
        'base64',
      )
      assert.ok(
        startupFailureScreenshotBytes.length >= 5_000,
        `Pre-React startup recovery screenshot is unexpectedly small: ${startupFailureScreenshotBytes.length} bytes`,
      )
      await writeFile(
        '.manual-qa/web-startup-failure-recovery-current.png',
        startupFailureScreenshotBytes,
      )

      await runtimeFailureCdp.send('Emulation.setDeviceMetricsOverride', {
        deviceScaleFactor: 1,
        height: 844,
        mobile: true,
        width: 390,
      })
      await sleep(150)

      const startupFailureMobileState = await evaluate(
        runtimeFailureCdp,
        `(() => {
          const failure = document.querySelector(
            '.startup-failure-state:not(.runtime-failure-state)'
          )
          const title = failure?.querySelector('h1')
          const description = failure?.querySelector('p')
          const reload = failure?.querySelector('button')
          const failureRect = failure?.getBoundingClientRect()
          const titleRect = title?.getBoundingClientRect()
          const descriptionRect = description?.getBoundingClientRect()
          const reloadRect = reload?.getBoundingClientRect()
          const inside = (rect) =>
            Boolean(rect) && rect.left >= 0 && rect.right <= innerWidth

          return {
            descriptionInside: inside(descriptionRect),
            failureInside: inside(failureRect),
            reloadInside: inside(reloadRect),
            scrollWidth: document.documentElement.scrollWidth,
            titleInside: inside(titleRect),
            viewportWidth: innerWidth,
          }
        })()`,
      )
      assert.equal(
        startupFailureMobileState.failureInside &&
          startupFailureMobileState.titleInside &&
          startupFailureMobileState.descriptionInside &&
          startupFailureMobileState.reloadInside,
        true,
        `Pre-React startup recovery content must fit the mobile viewport: ${JSON.stringify(startupFailureMobileState)}`,
      )
      assert.ok(
        startupFailureMobileState.scrollWidth <=
          startupFailureMobileState.viewportWidth,
        `Pre-React startup recovery must not create horizontal mobile overflow: ${JSON.stringify(startupFailureMobileState)}`,
      )

      const startupFailureMobileScreenshot = await runtimeFailureCdp.send(
        'Page.captureScreenshot',
        {
          captureBeyondViewport: false,
          format: 'png',
        },
      )
      const startupFailureMobileScreenshotBytes = Buffer.from(
        startupFailureMobileScreenshot.data,
        'base64',
      )
      assert.ok(
        startupFailureMobileScreenshotBytes.length >= 5_000,
        `Mobile pre-React startup recovery screenshot is unexpectedly small: ${startupFailureMobileScreenshotBytes.length} bytes`,
      )
      await writeFile(
        '.manual-qa/web-startup-failure-recovery-mobile-current.png',
        startupFailureMobileScreenshotBytes,
      )

      console.log(
        `Pre-React startup failure recovery smoke passed: desktop screenshot ${startupFailureScreenshotBytes.length} bytes, mobile screenshot ${startupFailureMobileScreenshotBytes.length} bytes`,
      )
    } finally {
      runtimeFailureCdp.close()
    }
  } finally {
    cdp.close()
  }
}

try {
  await main()
} finally {
  await stopChildProcessTree(chrome)
  await previewServer?.close()
  if (!(await removeBrowserProfileWithRetry(profileDir))) {
    throw new Error(`Unable to remove temporary browser profile: ${profileDir}`)
  }
}
