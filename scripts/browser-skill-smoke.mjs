import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import { resolveFetchSafeLoopbackPort } from './fetch-safe-loopback-port.mjs'
import { startViteDevLoopbackServer } from './vite-loopback-server.mjs'
import {
  connectCdp,
  findMainFrameLoadCompletionEvent,
  markdownWorkerTargetUrls,
  waitForCdpPageTarget,
  waitForChrome as waitForCdpChrome,
} from './browser-cdp.mjs'
import {
  removeBrowserProfileWithRetry,
  settleBrowserRuntimeCleanup,
  stopChildProcessTree,
} from './browser-runtime-cleanup.mjs'
import {
  createBoundedPageEvaluator,
  maintainLatestVirtualMessageScrollIntent,
} from './browser-evaluate.mjs'
import { createIndexedDbCleanupScript } from './browser-indexeddb-cleanup.mjs'
import {
  renderedButtonContentIsCentered,
  renderedPlaceholderFits,
} from './visual-geometry-contract.mjs'

const rawArgs = process.argv.slice(2)
const browserSmokeTimeoutMs = Number(process.env.ZEROCHAT_BROWSER_SMOKE_TIMEOUT_MS ?? 240_000)
const reportPath = path.resolve(
  process.env.ZEROCHAT_ICON_SYNC_DOM_REPORT ?? '.manual-qa/browser-skill-smoke-icon-sync-dom.json',
)
const screenshotPath = path.resolve('.manual-qa/browser-skill-smoke.png')
let lastCdpOperation = 'startup'
const streamingSmokeFrames = Object.freeze([
  'data: {"choices":[{"delta":{"content":"browser"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":" smoke"}}]}\n\n',
  'data: [DONE]\n\n',
])
const remoteMarkdownImageUrl = 'https://remote.invalid/should-not-load.png'

function optionValue(name) {
  const prefix = `${name}=`
  const inline = rawArgs.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = rawArgs.indexOf(name)
  return index >= 0 ? rawArgs[index + 1] : undefined
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run browser smoke.')
}

function withTestParam(value) {
  const url = new URL(value)
  url.searchParams.set('app-test', '1')
  return url.href
}

function waitForSmokeRun(run, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Browser skill smoke timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    run.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

async function main() {
  const chromePath = await resolveChromePath()
  const cdpPort = await resolveFetchSafeLoopbackPort(
    process.env.ZEROCHAT_SMOKE_CDP_PORT,
    'Browser smoke Chrome remote debugging',
  )
  const providedAppUrl = optionValue('--url') ?? process.env.ZEROCHAT_SMOKE_URL ?? ''
  const profileDir = path.join(os.tmpdir(), `zerochat-browser-smoke-${Date.now()}`)
  let appUrl = providedAppUrl
  let devServer = null
  let chrome = null
  let cdp = null
  await mkdir(profileDir, { recursive: true })
  try {
    if (!appUrl) {
      devServer = await startViteDevLoopbackServer({
        configuredPort: process.env.ZEROCHAT_SMOKE_APP_PORT,
        serverLabel: 'Browser smoke app server',
      })
      appUrl = devServer.url
    }

    const testUrl = withTestParam(appUrl)
    chrome = spawn(
      chromePath,
      [
        '--headless=new',
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        '--lang=zh-CN',
        '--accept-lang=zh-CN',
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true },
    )
    chrome.zerochatProcessGroupLeader = process.platform !== 'win32'
    await waitForCdpChrome(cdpPort, { childProcess: chrome, timeoutMs: 30_000 })

    const target = await waitForCdpPageTarget(cdpPort, { timeoutMs: 30_000 })
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    const rawCdp = cdp
    const trackedCdp = {
      send(method, params = {}, sendOptions = {}) {
        lastCdpOperation = method
        return rawCdp.send(method, params, sendOptions)
      },
      on: rawCdp.on.bind(rawCdp),
      close: rawCdp.close.bind(rawCdp),
      get events() {
        return rawCdp.events
      },
    }
    cdp = trackedCdp
    const runtimeErrors = []
    const consoleErrors = []
    const runtimeExceptionPayloads = []
    const consoleApiPayloads = []
    const logEntryPayloads = []
    const networkRequestUrls = []
    const networkResponseUrls = []

    cdp.on('Runtime.exceptionThrown', (params) => {
      runtimeExceptionPayloads.push(JSON.stringify(params ?? {}))
      runtimeErrors.push(
        params.exceptionDetails?.exception?.description ??
          params.exceptionDetails?.text ??
          'Runtime exception',
      )
    })
    cdp.on('Runtime.consoleAPICalled', (params) => {
      consoleApiPayloads.push(JSON.stringify(params ?? {}))
      if (params.type === 'error') {
        consoleErrors.push(
          (params.args ?? []).map((item) => item.value ?? item.description ?? '').join(' '),
        )
      }
    })
    cdp.on('Log.entryAdded', (params) => {
      logEntryPayloads.push(JSON.stringify(params ?? {}))
      if (params.entry?.level === 'error') {
        consoleErrors.push(params.entry.text ?? '')
      }
    })
    cdp.on('Network.requestWillBeSent', (params) => {
      if (typeof params.request?.url === 'string') {
        networkRequestUrls.push(params.request.url)
      }
    })
    cdp.on('Network.responseReceived', (params) => {
      if (typeof params.response?.url === 'string') {
        networkResponseUrls.push(params.response.url)
      }
    })

    await cdp.send('Page.enable')
    const pageFrameTree = await cdp.send('Page.getFrameTree')
    assert.ok(
      pageFrameTree.frameTree?.frame?.id,
      'Browser smoke could not resolve the main CDP frame',
    )
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Network.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })

    const evaluate = createBoundedPageEvaluator(
      (method, params) => cdp.send(method, params),
      'browser-skill-smoke-evaluation',
    )

    const waitFor = async (expression, label, timeout = 12_000) => {
      const started = Date.now()
      while (Date.now() - started < timeout) {
        if (await evaluate(expression)) return
        await sleep(50)
      }
      throw new Error(`Timed out waiting for ${label}`)
    }
    const waitForPendingProviderConnectivityRequest = () =>
      waitFor(
        `window.__zerochatProviderRetryFixture?.mode === 'connectivity' && window.__zerochatProviderRetryFixture?.modelRequests === 1 && window.__zerochatProviderRetryFixture?.chatRequests === 1 && typeof window.__zerochatProviderRetryFixture?.releaseConnectivityChat === 'function'`,
        'Provider model-list plus chat connectivity requests',
      )

    const assertVisibleEmptyPlaceholdersFit = async (label) => {
      const failures = await evaluate(`(() => {
        const visible = (element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
            style.visibility !== 'hidden' && style.opacity !== '0' &&
            !element.closest('[aria-hidden="true"]')
        }
        const placeholderFits = ${renderedPlaceholderFits.toString()}
        return [...document.querySelectorAll([
          'input[placeholder]:not([type="file"]):not([type="checkbox"]):not([type="radio"])',
          'textarea[placeholder]',
        ].join(','))]
          .filter(visible)
          .filter((element) => !placeholderFits(element))
          .map((element) =>
            element.tagName.toLowerCase() + '[placeholder="' +
            element.getAttribute('placeholder') + '"]')
      })()`)
      assert.deepEqual(
        failures,
        [],
        `${label} empty input placeholders must fit their fields: ${failures.join(', ')}`,
      )
    }

    const assertVisibleCenteredButtonContent = async (label) => {
      const failures = await evaluate(`(() => {
        const visible = (element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
            style.visibility !== 'hidden' && style.opacity !== '0' &&
            !element.closest('[aria-hidden="true"]')
        }
        const buttonContentIsCentered = ${renderedButtonContentIsCentered.toString()}
        return [...document.querySelectorAll('button')]
          .filter(visible)
          .filter((element) => {
            const style = getComputedStyle(element)
            return style.textAlign === 'center' ||
              style.justifyContent === 'center' ||
              style.justifyItems === 'center'
          })
          .filter((element) => !buttonContentIsCentered(element))
          .map((element) =>
            (element.textContent || element.getAttribute('aria-label') || element.className || 'button')
              .replace(/\\s+/g, ' ')
              .trim()
              .slice(0, 80))
      })()`)
      assert.deepEqual(
        failures,
        [],
        `${label} centered button content must stay centered: ${failures.join(', ')}`,
      )
    }

    const horizontalSafeAreaState = () =>
      evaluate(`(() => {
        const sidebar = document.querySelector('.zc-sidebar')
        const main = document.querySelector('.zc-main')
        if (!sidebar || !main) throw new Error('Missing production shell for safe-area check')
        const sidebarStyle = getComputedStyle(sidebar)
        const mainStyle = getComputedStyle(main)
        return {
          sidebarLeft: sidebarStyle.paddingLeft,
          mainLeft: mainStyle.paddingLeft,
          mainRight: mainStyle.paddingRight,
          viewportWidth: window.innerWidth,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })()`)

    const waitForCloudSyncQuiet = async (label, expectedHeadPutCount = 1, timeout = 20_000) => {
      const stateExpression = `(() => {
        const state = window.__zerochatBrowserStreamFixture?.cloudSyncRequestState?.()
        return Boolean(state) &&
          state.headPutCount === ${expectedHeadPutCount} &&
          state.objectPutCount > 0
      })()`
      try {
        await waitFor(stateExpression, `${label} Cloudflare publish`, timeout)
      } catch (error) {
        const state = await evaluate(
          'window.__zerochatBrowserStreamFixture?.cloudSyncRequestState?.() ?? null',
        )
        const detail = state
          ? JSON.stringify({
              count: state.count,
              headPutCount: state.headPutCount,
              objectPutCount: state.objectPutCount,
              putCount: state.putCount,
              requests: (state.syncRequests ?? []).map((request, index) => `${index}:${request.method} ${request.path}`),
            })
          : 'fixture state unavailable'
        throw new Error(`${error.message}; ${label} state=${detail}`)
      }
      const firstState = await evaluate(
        'window.__zerochatBrowserStreamFixture.cloudSyncRequestState()',
      )
      await sleep(200)
      const settledState = await evaluate(
        'window.__zerochatBrowserStreamFixture.cloudSyncRequestState()',
      )
      assert.equal(
        settledState.headPutCount,
        expectedHeadPutCount,
        `${label} must publish exactly ${expectedHeadPutCount} head PUT request(s): ${JSON.stringify(settledState)}`,
      )
      assert.equal(
        settledState.objectPutCount,
        firstState.objectPutCount,
        `${label} object PUT count must be stable: ${JSON.stringify({ firstState, settledState })}`,
      )
      assert.equal(
        settledState.putCount,
        firstState.putCount,
        `${label} PUT count must be stable: ${JSON.stringify({ firstState, settledState })}`,
      )
      return settledState
    }

    const prepareHeldCurrentLocalSaveReset = async () => {
      const compactEnabled = await evaluate(
        'document.querySelector(\'[data-zc-compact-toggle="true"]\')?.getAttribute("aria-checked") === "true"',
      )
      if (compactEnabled) {
        await clickSelector('[data-zc-compact-toggle="true"]')
        await evaluate(
          'window.__zerochatAppTest?.flushLocalSaves()',
          true,
        )
      }

      await evaluate(`(() => {
        const subtle = crypto.subtle
        const ownDescriptor = Object.getOwnPropertyDescriptor(subtle, 'encrypt')
        const originalEncrypt = subtle.encrypt.bind(subtle)
        const decoder = new TextDecoder()
        const bytes = (value) => value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        const fixture = {
          held: false,
          released: false,
          resetError: '',
          resetSettled: false,
          restore() {
            if (ownDescriptor) Object.defineProperty(subtle, 'encrypt', ownDescriptor)
            else delete subtle.encrypt
          },
        }
        const replacement = (algorithm, key, data) => {
          const aad = decoder.decode(bytes(algorithm.additionalData))
          const plaintext = decoder.decode(bytes(data))
          if (
            !fixture.held &&
            aad === 'zerochat:local:v1:app-data' &&
            plaintext.includes('"compactMode":true')
          ) {
            fixture.held = true
            return new Promise((resolve, reject) => {
              fixture.releaseHeldSave = () => {
                if (fixture.released) return
                fixture.released = true
                originalEncrypt(algorithm, key, data).then(resolve, reject)
              }
            })
          }
          return originalEncrypt(algorithm, key, data)
        }
        Object.defineProperty(subtle, 'encrypt', {
          configurable: true,
          value: replacement,
        })
        window.__zerochatHeldLocalSaveFixture = fixture
      })()`)

      await clickSelector('[data-zc-compact-toggle="true"]')
      await waitFor(
        'window.__zerochatHeldLocalSaveFixture?.held === true',
        'current AppData encryption hold',
      )
      await clickSelector('#settings-tab-data')
      await waitFor(
        'Boolean(document.querySelector("[data-zc-reset-local=\\"true\\"]"))',
        'current reset Data tab',
      )
      await evaluate(`(() => {
        const fixture = window.__zerochatHeldLocalSaveFixture
        const button = document.querySelector('[data-zc-reset-local="true"]')
        if (!fixture || !(button instanceof HTMLButtonElement)) {
          throw new Error('Current local reset action is missing')
        }
        fixture.originalConfirm = window.confirm
        window.confirm = () => true
        fixture.resetObserver = new MutationObserver(() => {
          if (document.querySelector('.zc-settings')) return
          fixture.resetSettled = true
          fixture.resetObserver.disconnect()
          window.confirm = fixture.originalConfirm
        })
        fixture.resetObserver.observe(document.body, { childList: true, subtree: true })
        button.focus()
        button.click()
      })()`)
    }

    const assertReducedMotion = async () => {
      const readMotionState = () => evaluate(`(() => {
        const spinner = document.querySelector('[data-zc-sync-now="true"] .zc-sync-spinner')
        const transitionSample = document.querySelector('.zc-switch')
        if (!(spinner instanceof SVGElement) || !(transitionSample instanceof HTMLElement)) {
          throw new Error('Current Sync reduced-motion targets are missing')
        }
        const durationMs = (value) => Math.max(...value.split(',').map((part) => {
          const duration = part.trim()
          const numeric = Number.parseFloat(duration)
          return Number.isFinite(numeric) ? numeric * (duration.endsWith('ms') ? 1 : 1000) : 0
        }))
        const spinnerStyle = getComputedStyle(spinner)
        const transitionStyle = getComputedStyle(transitionSample)
        return {
          mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
          spinnerAnimationDurationMs: durationMs(spinnerStyle.animationDuration),
          spinnerAnimationIterationCount: spinnerStyle.animationIterationCount,
          spinnerAnimationName: spinnerStyle.animationName,
          transitionDurationMs: durationMs(transitionStyle.transitionDuration),
        }
      })()`)

      await evaluate(`(() => {
        const bridge = window.__zerochatAppTest
        if (!bridge) throw new Error('Current app test bridge is missing')
        bridge.setSyncingFixture(true)
      })()`)
      await waitFor(
        'Boolean(document.querySelector(\'[data-zc-sync-now="true"] .zc-sync-spinner\'))',
        'current Sync spinner',
      )
      try {
        await cdp.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
        })
        await sleep(50)
        const normalState = await readMotionState()
        assert.equal(normalState.mediaMatches, false, 'Normal motion mode must not match reduced-motion')
        assert.equal(
          normalState.spinnerAnimationName,
          'zc-spin',
          `Current Sync spinner must rotate while synchronization is active: ${JSON.stringify(normalState)}`,
        )
        assert.equal(
          normalState.spinnerAnimationIterationCount,
          'infinite',
          `Current Sync spinner must keep rotating until synchronization settles: ${JSON.stringify(normalState)}`,
        )
        assert.ok(
          normalState.spinnerAnimationDurationMs >= 100,
          `Current Sync spinner must exercise a real animation before reduction: ${JSON.stringify(normalState)}`,
        )
        assert.ok(
          normalState.transitionDurationMs >= 100,
          `Current Sync controls must exercise a real transition before reduction: ${JSON.stringify(normalState)}`,
        )

        await cdp.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        })
        await sleep(50)
        const reducedState = await readMotionState()
        assert.equal(
          reducedState.mediaMatches,
          true,
          `prefers-reduced-motion should match when emulated: ${JSON.stringify(reducedState)}`,
        )
        assert.equal(
          reducedState.spinnerAnimationName,
          'none',
          `reduced-motion should stop sync spinner rotation: ${JSON.stringify(reducedState)}`,
        )
        assert.ok(
          reducedState.transitionDurationMs <= 0.01,
          `reduced-motion should make current Sync transitions effectively instant: ${JSON.stringify(reducedState)}`,
        )
      } finally {
        await cdp.send('Emulation.setEmulatedMedia', { features: [] })
        await evaluate('window.__zerochatAppTest?.setSyncingFixture(false)')
      }
    }

    const installConcurrentSecretWinner = () => evaluate(`new Promise((resolve, reject) => {
      const input = document.querySelector('[data-provider-key-input="true"]')
      const providerId = input?.closest('[data-provider-id]')?.dataset.providerId || ''
      if (!providerId) {
        reject(new Error('Current Provider row is missing its durable identity'))
        return
      }
      const openRequest = indexedDB.open('zerochat-secrets')
      openRequest.onerror = () => reject(openRequest.error)
      openRequest.onsuccess = () => {
        const db = openRequest.result
        const tx = db.transaction('records', 'readwrite')
        const store = tx.objectStore('records')
        const targetKey = 'secret:provider:' + providerId
        const revisionRequest = store.get('meta:revision')
        const recordRequest = store.get(targetKey)
        const winnerRevision = 'browser-secret-winner-' + crypto.randomUUID()
        const winnerRecord = {
          kind: 'zerochat.browserSecretWinner',
          marker: winnerRevision,
          version: 1,
        }
        let pendingReads = 2
        let originalRevision
        let originalRecord
        const install = () => {
          pendingReads -= 1
          if (pendingReads !== 0) return
          window.__zerochatConcurrentSecretFixture = {
            originalRecord,
            originalRevision,
            providerId,
            targetKey,
            winnerRevision,
          }
          store.put(winnerRecord, targetKey)
          store.put(winnerRevision, 'meta:revision')
        }
        revisionRequest.onsuccess = () => {
          originalRevision = revisionRequest.result
          install()
        }
        revisionRequest.onerror = () => reject(revisionRequest.error || tx.error)
        recordRequest.onsuccess = () => {
          originalRecord = recordRequest.result
          install()
        }
        recordRequest.onerror = () => reject(recordRequest.error || tx.error)
        tx.oncomplete = () => {
          db.close()
          resolve({ originalRevision: originalRevision ?? null, providerId, winnerRevision })
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
        tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      }
    })`, true)

    const readConcurrentSecretState = () => evaluate(`new Promise((resolve, reject) => {
      const fixture = window.__zerochatConcurrentSecretFixture
      if (!fixture) {
        reject(new Error('Concurrent secret fixture is missing'))
        return
      }
      const openRequest = indexedDB.open('zerochat-secrets')
      openRequest.onerror = () => reject(openRequest.error)
      openRequest.onsuccess = () => {
        const db = openRequest.result
        const tx = db.transaction('records', 'readonly')
        const store = tx.objectStore('records')
        const revisionRequest = store.get('meta:revision')
        const recordRequest = store.get(fixture.targetKey)
        let pendingReads = 2
        let revision
        let record
        const finish = () => {
          pendingReads -= 1
          if (pendingReads !== 0) return
          db.close()
          resolve({
            recordKind: record?.kind || '',
            recordMarker: record?.marker || '',
            revision: revision ?? null,
          })
        }
        revisionRequest.onsuccess = () => {
          revision = revisionRequest.result
          finish()
        }
        revisionRequest.onerror = () => reject(revisionRequest.error || tx.error)
        recordRequest.onsuccess = () => {
          record = recordRequest.result
          finish()
        }
        recordRequest.onerror = () => reject(recordRequest.error || tx.error)
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
        tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      }
    })`, true)

    const restoreConcurrentSecretExpectedRevision = () => evaluate(`new Promise((resolve, reject) => {
      const fixture = window.__zerochatConcurrentSecretFixture
      if (!fixture) {
        reject(new Error('Concurrent secret fixture is missing'))
        return
      }
      const openRequest = indexedDB.open('zerochat-secrets')
      openRequest.onerror = () => reject(openRequest.error)
      openRequest.onsuccess = () => {
        const db = openRequest.result
        const tx = db.transaction('records', 'readwrite')
        const store = tx.objectStore('records')
        if (fixture.originalRecord === undefined) store.delete(fixture.targetKey)
        else store.put(fixture.originalRecord, fixture.targetKey)
        if (fixture.originalRevision === undefined) store.delete('meta:revision')
        else store.put(fixture.originalRevision, 'meta:revision')
        tx.oncomplete = () => {
          db.close()
          resolve(true)
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
        tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      }
    })`, true)

    const installConcurrentAppDataRevision = () => evaluate(`(async () => {
      const bridge = window.__zerochatAppTest
      if (!bridge) throw new Error('Current app test bridge is missing')
      await bridge.flushLocalSaves()

      const readRecord = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('zerochat')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('documents', 'readonly')
          const getRequest = tx.objectStore('documents').get('app')
          getRequest.onsuccess = () => resolve(getRequest.result ?? null)
          getRequest.onerror = () => reject(getRequest.error || tx.error)
          tx.oncomplete = () => db.close()
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
      const writeRecord = (record) => new Promise((resolve, reject) => {
        const request = indexedDB.open('zerochat')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('documents', 'readwrite')
          tx.objectStore('documents').put(record, 'app')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
      const readKey = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('zerochat-local-crypto')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('keys', 'readonly')
          const getRequest = tx.objectStore('keys').get('local-aes-gcm-v1')
          getRequest.onsuccess = () => resolve(getRequest.result)
          getRequest.onerror = () => reject(getRequest.error || tx.error)
          tx.oncomplete = () => db.close()
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
      const base64ToBytes = (value) => {
        const binary = atob(value)
        return Uint8Array.from(binary, (character) => character.charCodeAt(0))
      }
      const bytesToBase64 = (value) => {
        let binary = ''
        for (const byte of value) binary += String.fromCharCode(byte)
        return btoa(binary)
      }
      const decryptRecord = async (record, key) => {
        const decrypted = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: base64ToBytes(record.iv),
            additionalData: base64ToBytes(record.aad),
            tagLength: 128,
          },
          key,
          base64ToBytes(record.payload),
        )
        return JSON.parse(new TextDecoder().decode(decrypted))
      }

      const original = await readRecord()
      const key = await readKey()
      if (original?.kind !== 'zerochat.localEncrypted' || !key) {
        throw new Error('Current encrypted AppData fixture is unavailable')
      }
      const competingData = await decryptRecord(original, key)
      const marker = 'reset-sync-passphrase'
      competingData.preferences = {
        ...competingData.preferences,
        dismissedDangerWarnings: [
          ...new Set([...(competingData.preferences?.dismissedDangerWarnings || []), marker]),
        ],
      }
      competingData.updatedAt = Math.max(Date.now(), Number(competingData.updatedAt || 0) + 1)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: base64ToBytes(original.aad),
          tagLength: 128,
        },
        key,
        new TextEncoder().encode(JSON.stringify(competingData)),
      )
      const competing = {
        ...original,
        iv: bytesToBase64(iv),
        payload: bytesToBase64(new Uint8Array(encrypted)),
      }
      const fixture = {
        competingIv: competing.iv,
        localTheme: competingData.preferences?.theme === 'dark' ? 'light' : 'dark',
        marker,
        originalIv: original.iv,
        async readState() {
          const record = await readRecord()
          if (record?.kind !== 'zerochat.localEncrypted') return null
          const data = await decryptRecord(record, key)
          return {
            currentIv: record.iv,
            markerPresent: data.preferences?.dismissedDangerWarnings?.includes(marker) === true,
            theme: data.preferences?.theme || '',
          }
        },
      }
      window.__zerochatConcurrentAppDataFixture = fixture
      await writeRecord(competing)
      return {
        competingIv: fixture.competingIv,
        localTheme: fixture.localTheme,
        marker: fixture.marker,
        originalIv: fixture.originalIv,
      }
    })()`, true)

    const waitForConcurrentAppDataState = (theme, previousIv = '') => evaluate(`new Promise((resolve, reject) => {
      const fixture = window.__zerochatConcurrentAppDataFixture
      if (!fixture) {
        reject(new Error('Concurrent AppData fixture is missing'))
        return
      }
      const started = Date.now()
      const inspect = async () => {
        try {
          const state = await fixture.readState()
          if (
            state?.theme === ${JSON.stringify(theme)} &&
            state.markerPresent === true &&
            state.currentIv !== fixture.competingIv &&
            state.currentIv !== ${JSON.stringify(previousIv)}
          ) {
            resolve(state)
            return
          }
          if (Date.now() - started > 12000) {
            reject(new Error('Concurrent AppData state did not become durable'))
            return
          }
          setTimeout(inspect, 80)
        } catch (error) {
          reject(error)
        }
      }
      inspect()
    })`, true)

    const mainFrameId = pageFrameTree.frameTree.frame.id
    const waitForPageLoadCompletion = async (startIndex, timeoutMs = 30_000) => {
      const started = Date.now()
      while (Date.now() - started <= timeoutMs) {
        const event = findMainFrameLoadCompletionEvent(cdp.events, startIndex, mainFrameId)
        if (event) {
          lastCdpOperation = event.method
          return event
        }
        await sleep(50)
      }

      const observedPageEvents = [
        ...new Set(
          cdp.events
            .slice(startIndex)
            .map((event) => event.method)
            .filter((method) => method?.startsWith('Page.')),
        ),
      ]
      throw new Error(
        `Timed out waiting for main-frame page load completion; observed Page events: ${observedPageEvents.join(', ') || 'none'}`,
      )
    }

    const streamProbe = await evaluate(`(async () => {
      const delayedEventStreamResponse = (frames) => {
        const stream = new ReadableStream({
          start(controller) {
            let index = 0
            const push = () => {
              if (index >= frames.length) {
                controller.close()
                return
              }
              controller.enqueue(new TextEncoder().encode(frames[index++]))
              setTimeout(push, 5)
            }
            push()
          },
        })
        return new Response(stream)
      }
      const responsePromise = () => {
        return Promise.resolve(delayedEventStreamResponse(${JSON.stringify(streamingSmokeFrames)}))
      }
      const response = await responsePromise()
      return response.text()
    })()`, true)
    assert.equal(
      streamProbe,
      streamingSmokeFrames.join(''),
      'Browser smoke must consume delayed in-page stream frames without a local SSE server',
    )

    const clickText = async (names, root = 'document') =>
      evaluate(`(() => {
        const values = ${JSON.stringify(names)}
        const scope = ${root === 'document' ? 'document' : `document.querySelector(${JSON.stringify(root)})`}
        if (!scope) throw new Error('Missing production control scope')
        const visible = (element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        }
        const controls = [...scope.querySelectorAll('button, [role="button"], label')]
        const element = controls.find((candidate) => {
          if (!visible(candidate)) return false
          const text = (candidate.textContent || candidate.getAttribute('aria-label') || candidate.title || '').trim()
          return values.some((value) => text.includes(value))
        })
        if (!element) throw new Error('Missing production control: ' + values.join(' / '))
        element.click()
        return true
      })()`)

    const clickSelector = async (selector) =>
      evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)})
        if (!element) throw new Error('Missing production selector: ' + ${JSON.stringify(selector)})
        element.click()
        return true
      })()`)

    const setSelect = async (value) =>
      evaluate(`(() => {
        const element = [...document.querySelectorAll('select')]
          .find((candidate) => [...candidate.options].some((option) => option.value === ${JSON.stringify(value)}))
        if (!element) throw new Error('Missing select option: ' + ${JSON.stringify(value)})
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
        setter?.call(element, ${JSON.stringify(value)})
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        return element.value
      })()`)

    const setComposerValue = async (value) => {
      await evaluate(`(() => {
        const textarea = document.querySelector('.zc-composer textarea')
        if (!textarea) throw new Error('Missing production composer')
        textarea.focus()
        textarea.select()
        return document.activeElement === textarea
      })()`)
      await cdp.send('Input.insertText', { text: value })
      await waitFor(
        `document.querySelector('.zc-composer textarea')?.value === ${JSON.stringify(value)}`,
        'composer input value',
      )
      return evaluate(`({
        value: document.querySelector('.zc-composer textarea')?.value || '',
        sendDisabled: Boolean(document.querySelector('.zc-send-btn')?.disabled),
      })`)
    }

    const setFieldValue = async (selector, value) => {
      await evaluate(`(() => {
        const field = document.querySelector(${JSON.stringify(selector)})
        if (!field) throw new Error('Missing production field: ' + ${JSON.stringify(selector)})
        field.focus()
        field.select?.()
        return document.activeElement === field
      })()`)
      await cdp.send('Input.insertText', { text: value })
      await waitFor(
        `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,
        `field value ${selector}`,
      )
    }

    const setFileInputFiles = async (selector, files) => {
      const documentRoot = await cdp.send('DOM.getDocument', {
        depth: -1,
        pierce: true,
      })
      const match = await cdp.send('DOM.querySelector', {
        nodeId: documentRoot.root.nodeId,
        selector,
      })
      assert.ok(match.nodeId, `Missing production file input: ${selector}`)
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: match.nodeId,
        files,
      })
    }

    const pressTab = async (shift = false) => {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Tab',
        code: 'Tab',
        modifiers: shift ? 8 : 0,
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      })
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Tab',
        code: 'Tab',
        modifiers: shift ? 8 : 0,
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      })
    }

    const assertFocusCyclesWithin = async (selector, label) => {
      const focusRoot = async () => evaluate(`(() => {
        const root = document.querySelector(${JSON.stringify(selector)})
        if (!(root instanceof HTMLElement)) return false
        root.focus()
        return document.activeElement === root
      })()`)
      const focusEdge = async (edge) => evaluate(`(() => {
        const root = document.querySelector(${JSON.stringify(selector)})
        if (!(root instanceof HTMLElement)) return false
        const focusable = [...root.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )].filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0)
        const target = focusable[${JSON.stringify(edge)} === 'first' ? 0 : focusable.length - 1]
        if (!(target instanceof HTMLElement)) return false
        target.focus()
        return document.activeElement === target
      })()`)
      const activeAtEdge = async (edge) => evaluate(`(() => {
        const root = document.querySelector(${JSON.stringify(selector)})
        if (!(root instanceof HTMLElement)) return false
        const focusable = [...root.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )].filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0)
        const target = focusable[${JSON.stringify(edge)} === 'first' ? 0 : focusable.length - 1]
        return target instanceof HTMLElement && document.activeElement === target
      })()`)

      assert.equal(await focusRoot(), true, `${label} root must accept programmatic focus`)
      await pressTab(true)
      assert.equal(await activeAtEdge('last'), true, `Shift+Tab from the dialog root should wrap to the last control in ${label}`)
      assert.equal(await focusRoot(), true, `${label} root must accept repeat programmatic focus`)
      await pressTab()
      assert.equal(await activeAtEdge('first'), true, `Tab from the dialog root should wrap to the first control in ${label}`)
      assert.equal(await focusEdge('first'), true, `${label} must expose a first focus target`)
      await pressTab(true)
      assert.equal(await activeAtEdge('last'), true, `Shift+Tab should wrap to the last control in ${label}`)
      assert.equal(await focusEdge('last'), true, `${label} must expose a last focus target`)
      await pressTab()
      assert.equal(await activeAtEdge('first'), true, `Tab should wrap to the first control in ${label}`)
    }

    const loadStart = cdp.events.length
    await cdp.send('Page.navigate', { url: testUrl })
    await waitForPageLoadCompletion(loadStart)
    await waitFor('document.readyState === "complete"', 'page load')
    await waitFor('Boolean(document.querySelector(".zc-app"))', 'app shell')
    await waitFor('Boolean(document.querySelector(".zc-empty-card"))', 'onboarding card')

    const pageDocumentUrl = new URL(testUrl)
    const isPageDocumentUrl = (value) => {
      try {
        const parsed = new URL(value)
        return parsed.origin === pageDocumentUrl.origin && parsed.pathname === pageDocumentUrl.pathname
      } catch {
        return false
      }
    }
    assert.ok(
      networkRequestUrls.some(isPageDocumentUrl),
      'Browser smoke must capture a real CDP Network request event for the page document',
    )
    assert.ok(
      networkResponseUrls.some(isPageDocumentUrl),
      'Browser smoke must capture a real CDP Network response event for the page document',
    )

    const indexedDbCleanupName = `zerochat-browser-contract-${Date.now()}`
    assert.equal(
      await evaluate(createIndexedDbCleanupScript(indexedDbCleanupName), true),
      true,
      'Browser smoke IndexedDB cleanup contract must pass',
    )

    const shell = await evaluate(`(() => ({
      root: Boolean(document.querySelector('#root')?.children.length),
      app: Boolean(document.querySelector('.zc-app')),
      sidebar: Boolean(document.querySelector('.zc-sidebar')),
      main: Boolean(document.querySelector('.zc-main')),
      guide: Boolean(document.querySelector('.zc-empty-card')),
      language: document.documentElement.lang,
      direction: document.documentElement.dir || 'ltr',
    }))()`)
    assert.equal(shell.root, true, 'Production app must mount into #root')
    assert.equal(shell.app, true, `Production app shell is missing: ${JSON.stringify(shell)}`)
    assert.equal(shell.sidebar, true, 'Production sidebar is missing')
    assert.equal(shell.main, true, 'Production main surface is missing')
    assert.equal(shell.guide, true, 'Production onboarding card is missing')

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844,
      height: 390,
      deviceScaleFactor: 1,
      mobile: true,
    })
    await evaluate(`(() => {
      document.documentElement.style.setProperty('--safe-area-left', '32px')
      document.documentElement.style.setProperty('--safe-area-right', '44px')
      return true
    })()`)
    const horizontalSafeArea = await horizontalSafeAreaState()
    assert.deepEqual(
      horizontalSafeArea,
      {
        sidebarLeft: '32px',
        mainLeft: '32px',
        mainRight: '44px',
        viewportWidth: 844,
        horizontalOverflow: false,
      },
      `landscape mobile shell should consume both horizontal safe-area insets: ${JSON.stringify(horizontalSafeArea)}`,
    )
    await evaluate(`(() => {
      document.documentElement.style.removeProperty('--safe-area-left')
      document.documentElement.style.removeProperty('--safe-area-right')
      return true
    })()`)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await waitFor(
      "document.querySelector('.zc-app-surface')?.getAttribute('aria-hidden') !== 'true' && !document.querySelector('.zc-app-surface')?.hasAttribute('inert')",
      'desktop app surface focus availability',
    )

    const conversationSearchBaseline = await evaluate(`(() => ({
      input: Boolean(document.querySelector('.zc-sidebar-search input[type="search"]')),
      conversations: document.querySelectorAll('.zc-conv-item[role="button"]').length,
    }))()`)
    assert.equal(conversationSearchBaseline.input, true, 'Current Sidebar must expose conversation search')
    assert.ok(conversationSearchBaseline.conversations > 0, 'Conversation search smoke requires a visible baseline chat')
    await evaluate(`(() => {
      const input = document.querySelector('.zc-sidebar-search input[type="search"]')
      if (!(input instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) return false
      setter.call(input, 'browser-smoke-no-conversation-match')
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      return true
    })()`, true)
    await waitFor(
      'Boolean(document.querySelector(\'[data-conversation-search-empty="true"]\'))',
      'current conversation search no-results state',
    )
    const conversationSearchEmptyState = await evaluate(`(() => {
      const empty = document.querySelector('[data-conversation-search-empty="true"]')
      return {
        role: empty?.getAttribute('role') || '',
        text: empty?.textContent?.trim() || '',
        conversations: document.querySelectorAll('.zc-conv-item[role="button"]').length,
        clearAction: Boolean(empty?.querySelector('[data-conversation-search-clear="true"]')),
      }
    })()`)
    assert.equal(conversationSearchEmptyState.role, 'status', 'Conversation search no-results guidance must be announced')
    assert.ok(conversationSearchEmptyState.text, 'Conversation search no-results guidance must be visible')
    assert.equal(conversationSearchEmptyState.conversations, 0, 'A non-matching conversation search must hide every chat')
    assert.equal(conversationSearchEmptyState.clearAction, true, 'Conversation search no-results guidance must offer a clear action')
    await clickSelector('[data-conversation-search-clear="true"]')
    await waitFor(
      `document.querySelector('.zc-sidebar-search input[type="search"]')?.value === '' && document.querySelectorAll('.zc-conv-item[role="button"]').length === ${conversationSearchBaseline.conversations}`,
      'current conversation search clear restores chats',
    )

    const settingsOpenerCaptured = await evaluate(`(() => {
      const opener = document.querySelector('[data-zc-provider-settings-entry="true"]')
      window.__zerochatSettingsOpener = opener || null
      if (!(opener instanceof HTMLButtonElement)) return false
      opener.focus()
      const focusedBeforeOpen = document.activeElement === opener
      opener.click()
      return focusedBeforeOpen
    })()`)
    assert.equal(settingsOpenerCaptured, true, 'Settings focus smoke must capture its real opener')
    await waitFor('Boolean(document.querySelector(".zc-settings-overlay"))', 'settings overlay')
    const dialogA11yIssues = await evaluate(`(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      }
      const referencedText = (element, attribute) =>
        (element.getAttribute(attribute) || '')
          .split(/\\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent?.trim().replace(/\\s+/g, ' ') || '')
          .filter(Boolean)
          .join(' ')

      return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
        .filter(visible)
        .flatMap((element) => {
          const role = element.getAttribute('role') || 'dialog'
          const issues = []
          if (element.getAttribute('aria-modal') !== 'true') {
            issues.push(role + ' missing aria-modal=true')
          }
          if (!referencedText(element, 'aria-labelledby')) {
            issues.push(role + ' missing labelled title')
          }
          if (!referencedText(element, 'aria-describedby')) {
            issues.push(role + ' missing described body')
          }
          return issues
        })
    })()`)
    assert.deepEqual(
      dialogA11yIssues,
      [],
      'Visible Settings dialog should expose title and description semantics',
    )
    await waitFor(
      'document.querySelector(".settings-modal")?.contains(document.activeElement)',
      'Settings initial focus ownership',
    )
    await assertFocusCyclesWithin('.settings-modal', 'the settings modal')
    await waitFor(
      'Boolean(document.querySelector(\'[data-feature-hint="providers"]\'))',
      'current Settings providers feature hint',
    )
    const settingsFeatureHintState = await evaluate(`(() => {
      const hint = document.querySelector('[data-feature-hint="providers"]')
      return {
        role: hint?.getAttribute('role') || '',
        live: hint?.getAttribute('aria-live') || '',
        atomic: hint?.getAttribute('aria-atomic') || '',
        dismissButton: Boolean(hint?.querySelector('button[type="button"]')),
      }
    })()`)
    assert.deepEqual(
      settingsFeatureHintState,
      { role: 'status', live: 'polite', atomic: 'true', dismissButton: true },
      `Current Settings feature hint must expose polite atomic status semantics: ${JSON.stringify(settingsFeatureHintState)}`,
    )
    await evaluate(`(() => {
      const subtle = crypto.subtle
      const ownDescriptor = Object.getOwnPropertyDescriptor(subtle, 'encrypt')
      const originalEncrypt = subtle.encrypt.bind(subtle)
      const decoder = new TextDecoder()
      const bytes = (value) => value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      const fixture = {
        held: false,
        released: false,
        restore() {
          if (ownDescriptor) Object.defineProperty(subtle, 'encrypt', ownDescriptor)
          else delete subtle.encrypt
        },
      }
      const replacement = (algorithm, key, data) => {
        const aad = decoder.decode(bytes(algorithm.additionalData))
        const plaintext = decoder.decode(bytes(data))
        if (
          !fixture.held &&
          aad === 'zerochat:local:v1:app-data' &&
          plaintext.includes('"dismissedFeatureHints"') &&
          plaintext.includes('"providers"')
        ) {
          fixture.held = true
          return new Promise((resolve, reject) => {
            fixture.release = () => {
              if (fixture.released) return
              fixture.released = true
              fixture.restore()
              originalEncrypt(algorithm, key, data).then(resolve, reject)
            }
          })
        }
        return originalEncrypt(algorithm, key, data)
      }
      Object.defineProperty(subtle, 'encrypt', {
        configurable: true,
        value: replacement,
      })
      window.__zerochatFeatureHintSaveFixture = fixture
    })()`)
    await clickSelector('[data-feature-hint="providers"] button[type="button"]')
    await waitFor(
      'window.__zerochatFeatureHintSaveFixture?.held === true',
      'current Settings providers feature hint durable hold',
    )
    await clickSelector('#settings-tab-models')
    await waitFor(
      'Boolean(document.querySelector(\'[data-feature-hint="models"]\'))',
      'current Settings models feature hint',
    )
    assert.equal(
      await evaluate('document.querySelector(\'[data-feature-hint="models"] button[type="button"]\')?.disabled === false'),
      true,
      'A new Settings feature hint must not inherit another hint dismissal owner',
    )
    await evaluate(`(() => {
      const fixture = window.__zerochatFeatureHintSaveFixture
      if (!fixture?.release) throw new Error('Current feature hint save fixture is incomplete')
      fixture.release()
    })()`)
    await waitFor(
      'document.querySelector(\'[data-feature-hint="models"] button[type="button"]\')?.disabled === false',
      'current Settings models feature hint remains independently interactive',
    )
    await clickSelector('[data-feature-hint="models"] button[type="button"]')
    await waitFor(
      '!document.querySelector(\'[data-feature-hint="models"]\')',
      'current Settings models feature hint dismissal',
    )
    await waitFor(
      'document.activeElement === document.querySelector("#settings-tab-models")',
      'current Settings feature hint focus restoration',
    )
    await clickSelector('#settings-tab-providers')
    await waitFor(
      '!document.querySelector(\'[data-feature-hint="providers"]\')',
      'dismissed current Settings feature hint does not repeat',
    )
    assert.equal(
      await evaluate('Boolean(document.querySelector(\'[data-feature-hint="providers"]\'))'),
      false,
      'Dismissed current Settings feature hint must not repeat after tab navigation',
    )
    const providerDeleteFocusSetup = await evaluate(`(() => {
      const select = document.querySelector('.zc-settings-scroll select')
      const addButton = select?.parentElement?.querySelector('button.zc-btn.primary')
      if (!(addButton instanceof HTMLButtonElement)) return null
      window.__zerochatProviderCardsBeforeAdd = new Set(
        document.querySelectorAll('.zc-provider-card'),
      )
      window.__zerochatProviderAddButton = addButton
      addButton.focus()
      const focused = document.activeElement === addButton
      addButton.click()
      return { count: window.__zerochatProviderCardsBeforeAdd.size, focused }
    })()`)
    assert.ok(
      providerDeleteFocusSetup,
      'Provider deletion focus smoke must find the current add action',
    )
    assert.equal(
      providerDeleteFocusSetup.focused,
      true,
      'Current Provider add action must accept keyboard focus',
    )
    await waitFor(
      `document.querySelectorAll('.zc-provider-card').length === ${providerDeleteFocusSetup.count + 1}`,
      'temporary Provider durable add',
    )
    await waitFor(
      'document.activeElement === window.__zerochatProviderAddButton',
      'Provider add action focus restoration',
    )
    const providerMoveStarted = await evaluate(`(() => {
      const baseline = window.__zerochatProviderCardsBeforeAdd
      const card = [...document.querySelectorAll('.zc-provider-card')].find(
        (candidate) => !baseline?.has(candidate),
      )
      const moveUp = card?.querySelector('.zc-provider-order-actions button:first-child')
      const previousIndex = [...document.querySelectorAll('.zc-provider-card')].indexOf(card)
      if (
        !(card instanceof HTMLElement) ||
        !(moveUp instanceof HTMLButtonElement) ||
        previousIndex < 1 ||
        moveUp.disabled
      ) {
        return null
      }
      window.__zerochatTemporaryProviderCard = card
      window.__zerochatProviderMoveFocusTarget = moveUp
      moveUp.focus()
      const focused = document.activeElement === moveUp
      moveUp.click()
      return { focused, previousIndex }
    })()`)
    assert.equal(
      providerMoveStarted?.focused,
      true,
      `Current Provider move action must accept keyboard focus: ${JSON.stringify(providerMoveStarted)}`,
    )
    await waitFor(
      `[...document.querySelectorAll('.zc-provider-card')].indexOf(window.__zerochatTemporaryProviderCard) < ${providerMoveStarted?.previousIndex}`,
      'temporary Provider durable move',
    )
    await waitFor(
      `document.activeElement === (
        window.__zerochatProviderMoveFocusTarget?.disabled
          ? window.__zerochatTemporaryProviderCard?.querySelector('.zc-provider-order-actions button:not(:disabled)')
          : window.__zerochatProviderMoveFocusTarget
      )`,
      'Provider move focus restoration',
    )
    const providerEnabledToggleStarted = await evaluate(`(() => {
      const baseline = window.__zerochatProviderCardsBeforeAdd
      const card = [...document.querySelectorAll('.zc-provider-card')].find(
        (candidate) => !baseline?.has(candidate),
      )
      const toggle = card?.querySelector('[role="switch"]')
      if (!(toggle instanceof HTMLButtonElement)) return null
      window.__zerochatProviderEnabledFocusTarget = toggle
      const checked = toggle.getAttribute('aria-checked')
      toggle.focus()
      const focused = document.activeElement === toggle
      toggle.click()
      return { checked, focused }
    })()`)
    assert.equal(
      providerEnabledToggleStarted?.focused,
      true,
      `Temporary Provider enabled toggle must accept keyboard focus: ${JSON.stringify(providerEnabledToggleStarted)}`,
    )
    await waitFor(
      `window.__zerochatProviderEnabledFocusTarget?.getAttribute('aria-checked') !== ${JSON.stringify(providerEnabledToggleStarted?.checked)}`,
      'temporary Provider enabled durable toggle',
    )
    await waitFor(
      'document.activeElement === window.__zerochatProviderEnabledFocusTarget',
      'Provider enabled toggle focus restoration',
    )
    const providerDeleteStarted = await evaluate(`(() => {
      const baseline = window.__zerochatProviderCardsBeforeAdd
      const card = [...document.querySelectorAll('.zc-provider-card')].find(
        (candidate) => !baseline?.has(candidate),
      )
      const button = card?.querySelector('.zc-btn.danger')
      if (!(card instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
        return false
      }
      const originalConfirm = window.confirm
      try {
        window.confirm = () => true
        window.__zerochatDeletedProviderCard = card
        button.focus()
        button.click()
        return document.activeElement === button
      } finally {
        window.confirm = originalConfirm
      }
    })()`)
    assert.equal(
      providerDeleteStarted,
      true,
      'Provider deletion focus smoke must start from the real delete action',
    )
    await waitFor(
      `document.querySelectorAll('.zc-provider-card').length === ${providerDeleteFocusSetup.count}`,
      'temporary Provider durable delete',
    )
    await waitFor(
      'document.activeElement === window.__zerochatProviderAddButton',
      'Provider delete add-action focus restoration',
    )
    await clickSelector('#settings-tab-sync')
    await waitFor(
      'document.querySelector("#settings-tab-sync")?.classList.contains("active") && Boolean(document.querySelector(".zc-segmented"))',
      'current first-run optional Sync settings remain independently reachable',
    )
    await clickSelector('#settings-tab-providers')
    await waitFor(
      'document.querySelector("#settings-tab-providers")?.classList.contains("active") && Boolean(document.querySelector(".zc-provider-card"))',
      'current first-run Provider settings remain the default task owner',
    )
    const providerSecretState = await evaluate(`(() => {
      const row = document.querySelector('.zc-provider-card .zc-credential-row')
      const input = row?.querySelector('input')
      const toggle = row?.querySelector('button[aria-pressed]')
      return {
        inputType: input instanceof HTMLInputElement ? input.type : '',
        toggleLabel: toggle?.getAttribute('aria-label') || '',
        togglePressed: toggle?.getAttribute('aria-pressed') || '',
      }
    })()`)
    assert.equal(providerSecretState.inputType, 'password', 'Current Provider credential input must start masked')
    assert.ok(providerSecretState.toggleLabel, 'Current Provider credential reveal control must have an accessible name')
    assert.equal(providerSecretState.togglePressed, 'false', 'Current Provider credential reveal control must expose its collapsed state')
    await clickSelector('.zc-provider-card .zc-credential-row button[aria-pressed="false"]')
    await waitFor(
      'document.querySelector(\'.zc-provider-card .zc-credential-row input\')?.type === "text"',
      'current Provider credential reveal',
    )
    await clickSelector('.zc-provider-card .zc-credential-row button[aria-pressed="true"]')
    await waitFor(
      'document.querySelector(\'.zc-provider-card .zc-credential-row input\')?.type === "password"',
      'current Provider credential re-mask',
    )
    const concurrentSecretFixtureState = await installConcurrentSecretWinner()
    assert.notEqual(
      concurrentSecretFixtureState.winnerRevision,
      concurrentSecretFixtureState.originalRevision,
      `concurrent secret smoke must install a distinct winner revision: ${JSON.stringify(concurrentSecretFixtureState)}`,
    )
    const expectedSecretConflictMessage = await evaluate(
      'window.__zerochatAppTest?.currentLocalDataWriteConflictMessage() || ""',
    )
    assert.ok(
      expectedSecretConflictMessage,
      'Current app test bridge must expose the localized secret revision conflict copy',
    )
    const staleSecretDraft = 'zerochat-stale-browser-secret'
    await evaluate(`(() => {
      const input = document.querySelector('[data-provider-key-input="true"]')
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('Current Provider key input is missing for stale secret smoke')
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, ${JSON.stringify(staleSecretDraft)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await waitFor(
      '!document.querySelector(\'[data-provider-key-save="true"]\')?.disabled',
      'current Provider stale secret save action',
    )
    await clickSelector('[data-provider-key-save="true"]')
    await waitFor(
      `[...document.querySelectorAll('.zc-toast')].some((toast) => toast.textContent?.includes(${JSON.stringify(expectedSecretConflictMessage)})) && document.querySelector('[data-provider-key-input="true"]')?.value === ${JSON.stringify(staleSecretDraft)}`,
      'current Provider stale secret conflict',
    )
    const concurrentSecretConflictState = await readConcurrentSecretState()
    assert.equal(
      concurrentSecretConflictState.revision === concurrentSecretFixtureState.winnerRevision &&
        concurrentSecretConflictState.recordKind === 'zerochat.browserSecretWinner' &&
        concurrentSecretConflictState.recordMarker === concurrentSecretFixtureState.winnerRevision,
      true,
      `stale Provider secret writes must surface a localized conflict without replacing the IndexedDB winner: ${JSON.stringify(concurrentSecretConflictState)}`,
    )

    await restoreConcurrentSecretExpectedRevision()
    const providerKeySaveFocusStarted = await evaluate(`(() => {
      const button = document.querySelector('[data-provider-key-save="true"]')
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false
      button.focus()
      const focused = document.activeElement === button
      button.click()
      return focused
    })()`)
    assert.equal(
      providerKeySaveFocusStarted,
      true,
      'Current Provider key save must start from its keyboard-focusable action',
    )
    await waitFor(
      'document.querySelector(\'[data-provider-key-input="true"]\')?.value === ""',
      'current Provider secret mutation recovery',
    )
    await waitFor(
      'document.activeElement === document.querySelector(\'[data-provider-key-input="true"]\')',
      'current Provider key save focus restoration',
    )
    const concurrentSecretRecoveryState = await readConcurrentSecretState()
    assert.equal(
      concurrentSecretRecoveryState.revision !== concurrentSecretFixtureState.winnerRevision &&
        concurrentSecretRecoveryState.recordKind === 'zerochat.localEncrypted',
      true,
      `Provider secret mutation queue should recover after the expected revision is restored: ${JSON.stringify(concurrentSecretRecoveryState)}`,
    )
    await waitFor(
      'Boolean(document.querySelector(\'[data-provider-key-clear="true"]\'))',
      'current Provider key clear action',
    )
    await clickSelector('[data-provider-key-clear="true"]')
    await waitFor(
      '!document.querySelector(\'[data-provider-key-clear="true"]\') && document.activeElement === document.querySelector(\'[data-provider-key-input="true"]\')',
      'current Provider key durable clear',
    )
    const clearedProviderSecretState = await readConcurrentSecretState()
    assert.equal(
      clearedProviderSecretState.recordKind,
      'zerochat.secretDeleted',
      `Provider key clear must durably replace the encrypted record with a deletion tombstone: ${JSON.stringify(clearedProviderSecretState)}`,
    )
    await assertVisibleEmptyPlaceholdersFit('current Provider settings')
    await assertVisibleCenteredButtonContent('current Provider settings')
    const longProviderName =
      'Browser smoke Provider with a deliberately long accessible display name'
    await evaluate(`(() => {
      const input = document.querySelector('.zc-provider-card .zc-field input')
      if (!(input instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) return false
      setter.call(input, ${JSON.stringify(longProviderName)})
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      return true
    })()`, true)
    await waitFor(
      `document.querySelector('.zc-provider-head strong')?.textContent === ${JSON.stringify(longProviderName)}`,
      'long Provider name render',
    )
    const providerNameState = await evaluate(`(() => {
      const target = document.querySelector('.zc-provider-head strong')
      if (!(target instanceof HTMLElement)) return { exists: false }
      const rect = target.getBoundingClientRect()
      return {
        exists: true,
        accessibleName: target.getAttribute('aria-label') || target.textContent || '',
        appTooltip: target.getAttribute('data-tooltip') || '',
        nativeTitle: target.getAttribute('title'),
        clipped: target.scrollWidth > target.clientWidth,
        focusable: target.tabIndex === 0,
        visible: rect.width > 0 && rect.height > 0,
      }
    })()`)
    assert.deepEqual(
      providerNameState,
      {
        exists: true,
        accessibleName: longProviderName,
        appTooltip: longProviderName,
        nativeTitle: null,
        clipped: true,
        focusable: true,
        visible: true,
      },
      `Truncated current Provider names must expose an accessible app tooltip: ${JSON.stringify(providerNameState)}`,
    )
    await evaluate(`(() => {
      const target = document.querySelector('.zc-provider-head strong')
      if (!(target instanceof HTMLElement)) return false
      target.blur()
      return document.activeElement !== target
    })()`, true)
    await evaluate(`(() => {
      const target = document.querySelector('.zc-provider-head strong')
      if (!(target instanceof HTMLElement)) return false
      target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      return true
    })()`, true)
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === ${JSON.stringify(longProviderName)}`,
      'Provider name hover app tooltip',
    )
    await evaluate(`(() => {
      const target = document.querySelector('.zc-provider-head strong')
      if (!(target instanceof HTMLElement)) return false
      target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))
      return true
    })()`, true)
    await waitFor(
      '!document.querySelector(\'[role="tooltip"]\')',
      'Provider name hover app tooltip close',
    )
    await evaluate(`(() => {
      const target = document.querySelector('.zc-provider-head strong')
      if (!(target instanceof HTMLElement)) return false
      target.focus()
      target.dispatchEvent(new FocusEvent('focus', { bubbles: false }))
      return document.activeElement === target
    })()`, true)
    await evaluate('new Promise((resolve) => setTimeout(resolve, 100))', true)
    const providerKeyboardTooltipState = await evaluate(`(() => {
      const target = document.querySelector('.zc-provider-head strong')
      const tooltip = document.querySelector('[role="tooltip"]')
      return {
        activeElement: document.activeElement?.tagName || '',
        activeIsTarget: document.activeElement === target,
        targetConnected: Boolean(target?.isConnected),
        targetTooltip: target?.getAttribute('data-tooltip') || '',
        tooltipText: tooltip?.textContent || '',
        tooltipVisibility: tooltip instanceof HTMLElement ? getComputedStyle(tooltip).visibility : '',
      }
    })()`)
    assert.equal(
      providerKeyboardTooltipState.activeIsTarget,
      true,
      `Provider name focus must remain on the tooltip target: ${JSON.stringify(providerKeyboardTooltipState)}`,
    )
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === ${JSON.stringify(longProviderName)}`,
      `Provider name keyboard app tooltip: ${JSON.stringify(providerKeyboardTooltipState)}`,
    )
    await evaluate(`(() => {
      const target = document.createElement('button')
      target.type = 'button'
      target.dataset.tooltip = 'Detached delegated tooltip target'
      target.textContent = 'Detached tooltip target'
      document.body.append(target)
      target.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
      }))
      window.__zerochatDetachedTooltipTarget = target
    })()`)
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === 'Detached delegated tooltip target'`,
      'detached delegated tooltip setup',
    )
    await evaluate(`(() => {
      window.__zerochatDetachedTooltipTarget?.remove()
      window.dispatchEvent(new Event('scroll'))
    })()`)
    await waitFor(
      `!document.querySelector('[role="tooltip"]')`,
      'detached delegated tooltip cleanup',
    )
    const providerRetryId = await evaluate(`(async () => {
      const bridge = window.__zerochatAppTest
      if (!bridge) throw new Error('Production Provider retry test bridge is missing')
      return bridge.setProviderRetryFixtureEnabled(true)
    })()`, true)
    await waitFor(
      `document.querySelectorAll('[data-provider-model-drag]').length === 2`,
      'Provider model reorder fixture',
    )
    const providerModelDragState = await evaluate(`(() => {
      const target = document.querySelector('[data-provider-model-drag]')
      if (!(target instanceof HTMLElement)) return null
      target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      return {
        label: target.getAttribute('aria-label') || '',
        model: target.getAttribute('data-provider-model-drag') || '',
        tooltip: target.getAttribute('data-tooltip') || '',
      }
    })()`)
    assert.ok(
      providerModelDragState?.label,
      `Provider model drag handle must expose a contextual accessible name: ${JSON.stringify(providerModelDragState)}`,
    )
    assert.equal(
      providerModelDragState.tooltip,
      providerModelDragState.label,
      `Provider model drag handle must reuse its contextual name as the tooltip: ${JSON.stringify(providerModelDragState)}`,
    )
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === ${JSON.stringify(providerModelDragState.label)}`,
      'Provider model drag handle must expose its contextual tooltip',
    )
    await evaluate(`(() => {
      const target = document.querySelector('[data-provider-model-drag]')
      if (!(target instanceof HTMLElement)) return false
      target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))
      return true
    })()`, true)
    await waitFor(
      '!document.querySelector(\'[role="tooltip"]\')',
      'Provider model drag handle tooltip close',
    )
    assert.ok(
      providerModelDragState?.model,
      `Provider model rename smoke requires a concrete current model: ${JSON.stringify(providerModelDragState)}`,
    )
    const providerModelOriginal = providerModelDragState.model
    const providerModelRenamed = `${providerModelOriginal}-renamed`
    const providerModelRenameTooltip = await evaluate(`(() => {
      const action = [...document.querySelectorAll('[data-provider-model-rename-action]')]
        .find((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify(providerModelOriginal)})
      if (!(action instanceof HTMLButtonElement)) throw new Error('Missing current Provider model rename action')
      action.focus()
      action.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      return action.getAttribute('data-tooltip') || ''
    })()`)
    assert.ok(
      providerModelRenameTooltip,
      'Provider model rename action must expose a tooltip before replacement',
    )
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === ${JSON.stringify(providerModelRenameTooltip)}`,
      'Provider model rename action tooltip before replacement',
    )
    await evaluate(`(() => {
      const action = [...document.querySelectorAll('[data-provider-model-rename-action]')]
        .find((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify(providerModelOriginal)})
      if (!(action instanceof HTMLButtonElement)) throw new Error('Missing current Provider model rename action')
      action.click()
      return true
    })()`)
    await waitFor(
      `[...document.querySelectorAll('[data-provider-model-rename]')].some((candidate) => candidate.getAttribute('data-provider-model-rename') === ${JSON.stringify(providerModelOriginal)})`,
      'Current Provider model rename input',
    )
    await waitFor(
      '!document.querySelector(\'[role="tooltip"]\')',
      'Removed Provider model rename action tooltip close',
    )
    await evaluate(`(() => {
      const input = [...document.querySelectorAll('[data-provider-model-rename]')]
        .find((candidate) => candidate.getAttribute('data-provider-model-rename') === ${JSON.stringify(providerModelOriginal)})
      if (!(input instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, ${JSON.stringify(providerModelRenamed)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`, true)
    await waitFor(
      `[...document.querySelectorAll('[data-provider-model-rename]')].some((candidate) => candidate instanceof HTMLInputElement && candidate.value === ${JSON.stringify(providerModelRenamed)})`,
      'Current Provider model rename controlled value',
    )
    await evaluate(`(() => {
      const input = [...document.querySelectorAll('[data-provider-model-rename]')]
        .find((candidate) => candidate.getAttribute('data-provider-model-rename') === ${JSON.stringify(providerModelOriginal)})
      if (!(input instanceof HTMLInputElement)) return false
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return true
    })()`, true)
    await waitFor(
      `[...document.querySelectorAll('[data-provider-model-rename-action]')].some((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify(providerModelRenamed)}) && ![...document.querySelectorAll('[data-provider-model-rename-action]')].some((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify(providerModelOriginal)})`,
      'Current Provider model rename commit',
    )
    await waitFor(
      `document.activeElement?.getAttribute('data-provider-model-rename-action') === ${JSON.stringify(providerModelRenamed)}`,
      'Current Provider model rename focus restoration',
    )
    const providerModelDeleteAddStarted = await evaluate(`(() => {
      const renamedAction = [...document.querySelectorAll('[data-provider-model-rename-action]')]
        .find((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify(providerModelRenamed)})
      const card = renamedAction?.closest('.zc-provider-card')
      const input = card?.querySelector('.zc-provider-model-entry input')
      const addButton = card?.querySelector('[data-provider-model-add-action="true"]')
      if (!(input instanceof HTMLInputElement) || !(addButton instanceof HTMLButtonElement)) {
        return false
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, ${JSON.stringify('browser-smoke-focus-delete-model')})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      window.__zerochatProviderModelAddFocusTarget = input
      window.__zerochatProviderModelAddButton = addButton
      return true
    })()`)
    assert.equal(
      providerModelDeleteAddStarted,
      true,
      'Provider model delete focus smoke must add a temporary current model',
    )
    await waitFor(
      'window.__zerochatProviderModelAddButton?.disabled === false',
      'temporary Provider model add action release',
    )
    const providerModelAddFocusStarted = await evaluate(`(() => {
      const button = window.__zerochatProviderModelAddButton
      if (!(button instanceof HTMLButtonElement)) return false
      button.focus()
      const focused = document.activeElement === button
      button.click()
      return focused
    })()`)
    assert.equal(
      providerModelAddFocusStarted,
      true,
      'Current Provider model add must start from its keyboard-focusable action',
    )
    await waitFor(
      `[...document.querySelectorAll('[data-provider-model-rename-action]')].some((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')})`,
      'temporary Provider model durable add',
    )
    await waitFor(
      'document.activeElement === window.__zerochatProviderModelAddFocusTarget',
      'Provider model add input focus restoration',
    )
    const providerModelMoveStarted = await evaluate(`(() => {
      const renameAction = [...document.querySelectorAll('[data-provider-model-rename-action]')]
        .find((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')})
      const chip = renameAction?.closest('.zc-model-chip')
      const card = chip?.closest('.zc-provider-card')
      const models = [...(card?.querySelectorAll('[data-provider-model-rename-action]') || [])]
        .map((candidate) => candidate.getAttribute('data-provider-model-rename-action'))
      const previousIndex = models.indexOf(${JSON.stringify('browser-smoke-focus-delete-model')})
      const moveUp = chip?.querySelectorAll('.zc-model-order-actions button')[1]
      if (!(moveUp instanceof HTMLButtonElement) || previousIndex < 1 || moveUp.disabled) {
        return null
      }
      window.__zerochatProviderModelMoveFocusTarget = moveUp
      moveUp.focus()
      const focused = document.activeElement === moveUp
      moveUp.click()
      return { focused, previousIndex }
    })()`)
    assert.equal(
      providerModelMoveStarted?.focused,
      true,
      `Current Provider model move action must accept keyboard focus: ${JSON.stringify(providerModelMoveStarted)}`,
    )
    await waitFor(
      `(() => {
        const action = [...document.querySelectorAll('[data-provider-model-rename-action]')]
          .find((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')})
        const card = action?.closest('.zc-provider-card')
        return [...(card?.querySelectorAll('[data-provider-model-rename-action]') || [])]
          .findIndex((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')}) === ${providerModelMoveStarted?.previousIndex - 1}
      })()`,
      'temporary Provider model durable move',
    )
    await waitFor(
      'document.activeElement === window.__zerochatProviderModelMoveFocusTarget',
      'Provider model move focus restoration',
    )
    for (;;) {
      const providerModelBoundaryMove = await evaluate(`(() => {
        const renameAction = [...document.querySelectorAll('[data-provider-model-rename-action]')]
          .find((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')})
        const chip = renameAction?.closest('.zc-model-chip')
        const card = chip?.closest('.zc-provider-card')
        const models = [...(card?.querySelectorAll('[data-provider-model-rename-action]') || [])]
          .map((candidate) => candidate.getAttribute('data-provider-model-rename-action'))
        const previousIndex = models.indexOf(${JSON.stringify('browser-smoke-focus-delete-model')})
        if (previousIndex === 0) return { atBoundary: true, previousIndex }
        const moveUp = chip?.querySelectorAll('.zc-model-order-actions button')[1]
        if (!(moveUp instanceof HTMLButtonElement) || previousIndex < 1 || moveUp.disabled) {
          return null
        }
        window.__zerochatProviderModelMoveFocusTarget = moveUp
        moveUp.focus()
        const focused = document.activeElement === moveUp
        moveUp.click()
        return { atBoundary: false, focused, previousIndex }
      })()`)
      assert.equal(
        providerModelBoundaryMove?.focused ?? providerModelBoundaryMove?.atBoundary,
        true,
        `Current Provider model boundary move must start from its keyboard-focusable action: ${JSON.stringify(providerModelBoundaryMove)}`,
      )
      if (providerModelBoundaryMove?.atBoundary) break
      await waitFor(
        `(() => {
          const action = [...document.querySelectorAll('[data-provider-model-rename-action]')]
            .find((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')})
          const card = action?.closest('.zc-provider-card')
          return [...(card?.querySelectorAll('[data-provider-model-rename-action]') || [])]
            .findIndex((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')}) === ${providerModelBoundaryMove.previousIndex - 1}
        })()`,
        'temporary Provider model durable boundary move',
      )
      if (providerModelBoundaryMove.previousIndex === 1) {
        await waitFor(
          `(() => {
            const action = [...document.querySelectorAll('[data-provider-model-rename-action]')]
              .find((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')})
            const buttons = action?.closest('.zc-model-chip')?.querySelectorAll('.zc-model-order-actions button')
            const moveUp = buttons?.[1]
            const moveDown = buttons?.[2]
            return moveUp instanceof HTMLButtonElement && moveUp.disabled
              && moveDown instanceof HTMLButtonElement && !moveDown.disabled
              && document.activeElement === moveDown
          })()`,
          'Provider model boundary move focus restoration',
        )
      } else {
        await waitFor(
          'document.activeElement === window.__zerochatProviderModelMoveFocusTarget',
          'Provider model intermediate move focus restoration',
        )
      }
    }
    const providerModelDeleteStarted = await evaluate(`(() => {
      const renameAction = [...document.querySelectorAll('[data-provider-model-rename-action]')]
        .find((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')})
      const chip = renameAction?.closest('.zc-model-chip')
      const deleteButton = chip?.querySelector(':scope > button:last-child')
      const input = chip?.closest('.zc-provider-card')?.querySelector('.zc-provider-model-entry input')
      if (!(deleteButton instanceof HTMLButtonElement) || !(input instanceof HTMLInputElement)) {
        return false
      }
      const originalConfirm = window.confirm
      try {
        window.confirm = () => true
        window.__zerochatProviderModelDeleteFocusTarget = input
        deleteButton.focus()
        deleteButton.click()
        return document.activeElement === deleteButton
      } finally {
        window.confirm = originalConfirm
      }
    })()`)
    assert.equal(
      providerModelDeleteStarted,
      true,
      'Current Provider model must start its confirmed durable delete from the delete action',
    )
    await waitFor(
      `![...document.querySelectorAll('[data-provider-model-rename-action]')].some((candidate) => candidate.getAttribute('data-provider-model-rename-action') === ${JSON.stringify('browser-smoke-focus-delete-model')})`,
      'temporary Provider model durable delete',
    )
    await waitFor(
      'document.activeElement === window.__zerochatProviderModelDeleteFocusTarget',
      'Provider model delete input focus restoration',
    )
    const providerModelAddState = await evaluate(`(() => {
      const action = document.querySelector('[data-provider-model-add-action="true"]')
      const target = action?.parentElement
      if (!(action instanceof HTMLButtonElement) || !(target instanceof HTMLElement)) {
        return null
      }
      target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      return {
        actionLabel: action.getAttribute('aria-label') || '',
        disabled: action.disabled,
        tabIndex: target.tabIndex,
        tooltip: target.getAttribute('data-tooltip') || '',
        wrapperLabel: target.getAttribute('aria-label') || '',
      }
    })()`)
    assert.deepEqual(
      {
        disabled: providerModelAddState?.disabled,
        tabIndex: providerModelAddState?.tabIndex,
        tooltipMatchesWrapper: providerModelAddState?.tooltip === providerModelAddState?.wrapperLabel,
      },
      { disabled: true, tabIndex: 0, tooltipMatchesWrapper: true },
      `Disabled Add model action must expose its localized reason through the wrapper: ${JSON.stringify(providerModelAddState)}`,
    )
    assert.notEqual(
      providerModelAddState.tooltip,
      providerModelAddState.actionLabel,
      `Disabled Add model tooltip must explain the blocker instead of repeating the action: ${JSON.stringify(providerModelAddState)}`,
    )
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === ${JSON.stringify(providerModelAddState.tooltip)}`,
      'Disabled Add model action must expose its localized tooltip',
    )
    await evaluate(`(() => {
      const target = document.querySelector('[data-provider-model-add-action="true"]')?.parentElement
      if (!(target instanceof HTMLElement)) return false
      target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))
      return true
    })()`, true)
    await waitFor(
      '!document.querySelector(\'[role="tooltip"]\')',
      'Disabled Add model action tooltip close',
    )
    await evaluate(`(() => {
      const originalFetch = window.fetch.bind(window)
      const fixture = {
        calls: 0,
        chatRequests: 0,
        hold: true,
        mode: 'failure',
        modelRequests: 0,
        originalFetch,
        release: null,
        releaseConnectivityChat: null,
      }
      window.__zerochatProviderRetryFixture = fixture
      window.fetch = async (input, init = {}) => {
        const request = new Request(input, init)
        if (request.url.startsWith('https://api.openai.com/')) {
          fixture.calls += 1
          if (fixture.mode === 'success') {
            const pathname = new URL(request.url).pathname
            if (pathname.endsWith('/embeddings')) {
              return Response.json({ data: [{ embedding: [0.25] }] })
            }
            if (pathname.endsWith('/moderations')) {
              return Response.json({ results: [{ flagged: false }] })
            }
            throw new Error('Unexpected successful Provider capability path: ' + pathname)
          }
          if (fixture.mode === 'connectivity') {
            const pathname = new URL(request.url).pathname
            if (pathname.endsWith('/models')) {
              fixture.modelRequests += 1
              return Response.json({ data: [{ id: 'browser-connectivity-model' }] })
            }
            if (
              pathname.endsWith('/responses') ||
              pathname.endsWith('/chat/completions') ||
              pathname.endsWith('/messages')
            ) {
              fixture.chatRequests += 1
              await new Promise((resolve) => {
                fixture.releaseConnectivityChat = resolve
              })
              return new Response(
                'data: {"type":"response.output_text.delta","delta":"connected"}\\n\\ndata: [DONE]\\n\\n',
                { headers: { 'content-type': 'text/event-stream' } },
              )
            }
            throw new Error('Unexpected Provider connectivity path: ' + pathname)
          }
          if (fixture.hold) {
            await new Promise((resolve) => {
              fixture.release = resolve
            })
          }
          return new Response(JSON.stringify({ error: { message: 'fixture unavailable' } }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        return originalFetch(input, init)
      }
      return true
    })()`, true)
    const providerModelFetchIdleLabel = await evaluate(
      `document.querySelector('[data-provider-model-fetch-action="true"]')?.getAttribute('aria-label') || ''`,
    )
    const providerModelFetchStartCalls = await evaluate(
      'window.__zerochatProviderRetryFixture?.calls || 0',
    )
    const providerModelFetchFocusStarted = await evaluate(`(() => {
      const action = document.querySelector('[data-provider-model-fetch-action="true"]')
      if (!(action instanceof HTMLButtonElement) || action.disabled) return false
      window.__zerochatProviderModelFetchFocusTarget = action
      action.focus()
      const focused = document.activeElement === action
      action.click()
      return focused
    })()`)
    assert.equal(
      providerModelFetchFocusStarted,
      true,
      'Current Provider model fetch must start from its keyboard-focusable action',
    )
    await waitFor(
      `(window.__zerochatProviderRetryFixture?.calls || 0) > ${providerModelFetchStartCalls}`,
      'Provider model fetch request starts',
    )
    const providerModelFetchBusyState = await evaluate(`(() => {
      const action = document.querySelector('[data-provider-model-fetch-action="true"]')
      const target = action?.parentElement
      if (!(action instanceof HTMLButtonElement) || !(target instanceof HTMLElement)) {
        return null
      }
      target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      return {
        disabled: action.disabled,
        label: action.getAttribute('aria-label') || '',
        tabIndex: target.tabIndex,
        tooltip: target.getAttribute('data-tooltip') || '',
      }
    })()`)
    assert.deepEqual(
      {
        disabled: providerModelFetchBusyState?.disabled,
        tabIndex: providerModelFetchBusyState?.tabIndex,
        tooltipMatchesLabel:
          providerModelFetchBusyState?.tooltip === providerModelFetchBusyState?.label,
      },
      { disabled: true, tabIndex: 0, tooltipMatchesLabel: true },
      `Pending Fetch models action must expose its scoped busy tooltip: ${JSON.stringify(providerModelFetchBusyState)}`,
    )
    assert.notEqual(
      providerModelFetchBusyState.label,
      providerModelFetchIdleLabel,
      `Pending Fetch models action must not retain its idle label: ${JSON.stringify(providerModelFetchBusyState)}`,
    )
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === ${JSON.stringify(providerModelFetchBusyState.tooltip)}`,
      'Pending Fetch models action must expose its scoped busy tooltip through the wrapper',
    )
    await evaluate(`(() => {
      const target = document.querySelector('[data-provider-model-fetch-action="true"]')?.parentElement
      if (target instanceof HTMLElement) {
        target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))
      }
      const fixture = window.__zerochatProviderRetryFixture
      if (!fixture) return false
      fixture.hold = false
      fixture.release?.()
      fixture.release = null
      return true
    })()`, true)
    await waitFor(
      `document.querySelector('[data-provider-model-fetch-action="true"]') instanceof HTMLButtonElement && !document.querySelector('[data-provider-model-fetch-action="true"]').disabled`,
      'Provider model fetch action recovers after the local failure',
    )
    await waitFor(
      'document.activeElement === window.__zerochatProviderModelFetchFocusTarget',
      'Provider model fetch action focus restoration',
    )
    await evaluate(`(() => {
      const fixture = window.__zerochatProviderRetryFixture
      if (!fixture) return false
      fixture.hold = true
      fixture.release = null
      return true
    })()`, true)
    await waitFor(
      `document.querySelector('[data-provider-capability-action="moderation"]') instanceof HTMLButtonElement`,
      'Provider single-capability check rendered for retry fixture',
    )
    const providerCapabilityFixtureState = await evaluate(`(() => ({
      actions: [...document.querySelectorAll('[data-provider-capability-action]')].map((node) => ({
        capability: node.getAttribute('data-provider-capability-action') || '',
        disabled: node instanceof HTMLButtonElement && node.disabled,
        label: node.getAttribute('aria-label') || '',
      })),
      fullDisabled: document.querySelector('[data-provider-full-capability-check="true"]')?.disabled ?? null,
      readiness: document.querySelector('[data-provider-capability-readiness]')?.getAttribute('data-provider-capability-readiness') || '',
    }))()`)
    assert.equal(
      providerCapabilityFixtureState.actions.find(({ capability }) => capability === 'moderation')?.disabled,
      false,
      `Provider single-capability check must enable for the ready local fixture: ${JSON.stringify(providerCapabilityFixtureState)}`,
    )
    const providerCapabilityLabels = await evaluate(`(() => ({
      moderation: document.querySelector('[data-provider-capability-action="moderation"]')?.getAttribute('aria-label') || '',
      embeddings: document.querySelector('[data-provider-capability-action="embeddings"]')?.getAttribute('aria-label') || '',
    }))()`)
    assert.ok(
      providerCapabilityLabels.moderation,
      `Provider moderation capability must have a localized action label: ${JSON.stringify(providerCapabilityLabels)}`,
    )
    assert.ok(
      providerCapabilityLabels.embeddings,
      `Provider embeddings capability must have a localized action label: ${JSON.stringify(providerCapabilityLabels)}`,
    )
    const providerCapabilityStartCalls = await evaluate(
      'window.__zerochatProviderRetryFixture?.calls || 0',
    )
    await clickSelector('[data-provider-capability-action="moderation"]')
    await waitFor(
      `(window.__zerochatProviderRetryFixture?.calls || 0) > ${providerCapabilityStartCalls}`,
      'Provider single-capability request starts',
    )
    const providerCapabilityBusyState = await evaluate(`(() => {
      const active = document.querySelector('[data-provider-capability-action="moderation"]')
      const idle = document.querySelector('[data-provider-capability-action="embeddings"]')
      return {
        activeDisabled: active instanceof HTMLButtonElement && active.disabled,
        activeLabel: active?.getAttribute('aria-label') || '',
        idleDisabled: idle instanceof HTMLButtonElement && idle.disabled,
        idleLabel: idle?.getAttribute('aria-label') || '',
        idleTooltip: idle?.parentElement?.getAttribute('data-tooltip') || '',
      }
    })()`)
    assert.notEqual(
      providerCapabilityBusyState.activeLabel.split(': ')[0],
      providerCapabilityLabels.moderation.split(': ')[0],
      `Active Provider capability check must expose its scoped busy label: ${JSON.stringify(providerCapabilityBusyState)}`,
    )
    assert.equal(
      providerCapabilityBusyState.activeLabel.split(': ').slice(1).join(': '),
      providerCapabilityLabels.moderation.split(': ').slice(1).join(': '),
      `Active Provider capability check must preserve its localized capability name: ${JSON.stringify(providerCapabilityBusyState)}`,
    )
    assert.equal(
      providerCapabilityBusyState.activeDisabled,
      true,
      `Active Provider capability check must remain disabled while its request is pending: ${JSON.stringify(providerCapabilityBusyState)}`,
    )
    assert.equal(
      providerCapabilityBusyState.idleLabel,
      providerCapabilityLabels.embeddings,
      `Idle Provider capability check must preserve its contextual label while globally disabled: ${JSON.stringify(providerCapabilityBusyState)}`,
    )
    assert.equal(
      providerCapabilityBusyState.idleDisabled,
      true,
      `Idle Provider capability check must be disabled while another capability owns the operation: ${JSON.stringify(providerCapabilityBusyState)}`,
    )
    assert.equal(
      providerCapabilityBusyState.idleTooltip,
      providerCapabilityBusyState.idleLabel,
      `Disabled Provider capability check wrapper must retain its contextual tooltip: ${JSON.stringify(providerCapabilityBusyState)}`,
    )
    await evaluate(`(() => {
      const target = document.querySelector('[data-provider-capability-action="embeddings"]')?.parentElement
      if (!(target instanceof HTMLElement)) return false
      target.focus()
      target.dispatchEvent(new FocusEvent('focus', { bubbles: false }))
      return document.activeElement === target
    })()`, true)
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === ${JSON.stringify(providerCapabilityLabels.embeddings)}`,
      'Disabled Provider capability check must expose its contextual tooltip through the wrapper',
    )
    await evaluate(`(() => {
      const fixture = window.__zerochatProviderRetryFixture
      if (!fixture) return false
      fixture.hold = false
      fixture.release?.()
      fixture.release = null
      return true
    })()`, true)
    await waitFor(
      `document.querySelector('[data-provider-full-capability-check="true"]') instanceof HTMLButtonElement && !document.querySelector('[data-provider-full-capability-check="true"]').disabled`,
      'Provider full-capability check enabled for retry fixture',
    )
    const providerFullCapabilityFocusStarted = await evaluate(`(() => {
      const action = document.querySelector('[data-provider-full-capability-check="true"]')
      if (!(action instanceof HTMLButtonElement) || action.disabled) return false
      window.__zerochatProviderFullCapabilityFocusTarget = action
      action.focus()
      const focused = document.activeElement === action
      action.click()
      return focused
    })()`)
    assert.equal(
      providerFullCapabilityFocusStarted,
      true,
      'Current Provider full-capability check must start from its keyboard-focusable action',
    )
    await waitFor(
      'Boolean(document.querySelector(\'[data-provider-connectivity-retry-action="fullCapabilities"]\'))',
      'retryable Provider failure action',
    )
    await waitFor(
      'document.activeElement === window.__zerochatProviderFullCapabilityFocusTarget',
      'Provider full-capability action focus restoration',
    )
    const firstProviderRetryState = await evaluate(`(() => ({
      calls: window.__zerochatProviderRetryFixture?.calls || 0,
      retryActions: document.querySelectorAll('[data-provider-connectivity-retry-action="fullCapabilities"]').length,
      retryAction: document.querySelector('[data-provider-connectivity-retry-action]')?.getAttribute('data-provider-connectivity-retry-action') || '',
    }))()`)
    assert.equal(firstProviderRetryState.retryActions, 1, 'Retryable Provider failure must expose one real retry action')
    assert.equal(firstProviderRetryState.retryAction, 'fullCapabilities', 'Provider retry action must retain its current-store operation identity')
    assert.ok(firstProviderRetryState.calls > 0, 'Initial Provider capability failure must execute the local fetch fixture')
    await clickSelector('[data-provider-connectivity-retry-action="fullCapabilities"]')
    await waitFor(
      `(window.__zerochatProviderRetryFixture?.calls || 0) > ${firstProviderRetryState.calls}`,
      'Provider retry request',
    )
    await waitFor(
      'Boolean(document.querySelector(\'[data-provider-connectivity-retry-action="fullCapabilities"]\'))',
      'Provider retry failure remains actionable',
    )
    const secondProviderRetryState = await evaluate(`(() => ({
      calls: window.__zerochatProviderRetryFixture?.calls || 0,
      retryActions: document.querySelectorAll('[data-provider-connectivity-retry-action="fullCapabilities"]').length,
    }))()`)
    assert.ok(
      secondProviderRetryState.calls > firstProviderRetryState.calls,
      `Provider retry must execute another capability request: ${JSON.stringify(secondProviderRetryState)}`,
    )
    assert.equal(secondProviderRetryState.retryActions, 1, 'A repeated retryable Provider failure must remain actionable')
    const successfulProviderRetryStarted = await evaluate(`(() => {
      const fixture = window.__zerochatProviderRetryFixture
      const action = document.querySelector('[data-provider-connectivity-retry-action="fullCapabilities"]')
      if (!fixture || !(action instanceof HTMLButtonElement)) return false
      fixture.mode = 'success'
      action.focus()
      const focused = document.activeElement === action
      action.click()
      return focused
    })()`)
    assert.equal(
      successfulProviderRetryStarted,
      true,
      'Successful Provider retry must start from its keyboard-focusable action',
    )
    await waitFor(
      '!document.querySelector(\'[data-provider-connectivity-retry-action="fullCapabilities"]\') && document.querySelector(\'[data-provider-full-capability-check="true"]\') instanceof HTMLButtonElement && !document.querySelector(\'[data-provider-full-capability-check="true"]\').disabled',
      'successful Provider retry completion',
    )
    await waitFor(
      'document.activeElement === document.querySelector(\'[data-provider-full-capability-check="true"]\')',
      'successful Provider retry focus handoff',
    )
    await evaluate(`(() => {
      const fixture = window.__zerochatProviderRetryFixture
      if (!fixture) return false
      fixture.chatRequests = 0
      fixture.hold = false
      fixture.mode = 'connectivity'
      fixture.modelRequests = 0
      fixture.release = null
      fixture.releaseConnectivityChat = null
      return true
    })()`, true)
    const providerConnectivityFocusStarted = await evaluate(`(() => {
      const action = document.querySelector('[data-provider-connectivity-check="true"]')
      if (!(action instanceof HTMLButtonElement) || action.disabled) return false
      window.__zerochatProviderConnectivityFocusTarget = action
      action.focus()
      const focused = document.activeElement === action
      action.click()
      return focused
    })()`)
    assert.equal(
      providerConnectivityFocusStarted,
      true,
      'Current Provider connectivity check must start from its keyboard-focusable action',
    )
    await waitForPendingProviderConnectivityRequest()
    const pendingProviderConnectivityState = await evaluate(`(() => {
      const action = document.querySelector('[data-provider-connectivity-check="true"]')
      const fixture = window.__zerochatProviderRetryFixture
      return {
        chatRequests: fixture?.chatRequests ?? -1,
        disabled: action instanceof HTMLButtonElement && action.disabled,
        label: action?.textContent?.trim() || '',
        modelRequests: fixture?.modelRequests ?? -1,
      }
    })()`)
    assert.deepEqual(
      {
        chatRequests: pendingProviderConnectivityState.chatRequests,
        disabled: pendingProviderConnectivityState.disabled,
        modelRequests: pendingProviderConnectivityState.modelRequests,
      },
      { chatRequests: 1, disabled: true, modelRequests: 1 },
      `Provider connectivity action must stay busy until its chat probe settles: ${JSON.stringify(pendingProviderConnectivityState)}`,
    )
    await evaluate(`(() => {
      const fixture = window.__zerochatProviderRetryFixture
      if (typeof fixture?.releaseConnectivityChat !== 'function') return false
      const release = fixture.releaseConnectivityChat
      fixture.releaseConnectivityChat = null
      release()
      return true
    })()`, true)
    await waitFor(
      `document.querySelector('[data-provider-connectivity-check="true"]') instanceof HTMLButtonElement && !document.querySelector('[data-provider-connectivity-check="true"]').disabled && Boolean(document.querySelector('[data-provider-capability-notice="true"]')?.textContent?.trim())`,
      'Provider connectivity action success',
    )
    await waitFor(
      'document.activeElement === window.__zerochatProviderConnectivityFocusTarget',
      'Provider connectivity action focus restoration',
    )
    const completedProviderConnectivityState = await evaluate(`(() => ({
      chatRequests: window.__zerochatProviderRetryFixture?.chatRequests ?? -1,
      modelRequests: window.__zerochatProviderRetryFixture?.modelRequests ?? -1,
      notice: document.querySelector('[data-provider-capability-notice="true"]')?.textContent?.trim() || '',
    }))()`)
    assert.deepEqual(
      {
        chatRequests: completedProviderConnectivityState.chatRequests,
        modelRequests: completedProviderConnectivityState.modelRequests,
      },
      { chatRequests: 1, modelRequests: 1 },
      `Provider connectivity check must issue one model-list request and one chat probe: ${JSON.stringify(completedProviderConnectivityState)}`,
    )
    assert.ok(
      completedProviderConnectivityState.notice,
      'Provider connectivity check must publish its localized success result',
    )
    await evaluate(`(async () => {
      const fixture = window.__zerochatProviderRetryFixture
      if (fixture?.originalFetch) window.fetch = fixture.originalFetch
      delete window.__zerochatProviderRetryFixture
      const bridge = window.__zerochatAppTest
      if (!bridge) throw new Error('Production Provider retry test bridge is missing during cleanup')
      await bridge.setProviderRetryFixtureEnabled(false)
      return ${JSON.stringify(providerRetryId)}
    })()`, true)
    const tabSelectors = {
      models: '.zc-model-grid',
      skills: '.zc-skill-editor',
      sync: '.zc-segmented',
      general: '.zc-settings select',
      data: '.zc-settings-scroll input[type=password]',
    }
    for (const [tab, selector] of Object.entries(tabSelectors)) {
      await clickSelector(`#settings-tab-${tab}`)
      await waitFor(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        `settings ${tab} panel`,
      )
      const tabState = await evaluate(`({
        active: document.querySelector(${JSON.stringify(`#settings-tab-${tab}`)})?.classList.contains('active'),
        content: Boolean(document.querySelector(${JSON.stringify(selector)})),
      })`)
      assert.equal(tabState.active, true, `Settings ${tab} tab must be active`)
      assert.equal(tabState.content, true, `Settings ${tab} panel must render`)
      if (tab === 'sync') {
        const manualSyncState = await evaluate(`(() => {
          const button = document.querySelector('[data-zc-sync-now="true"]')
          if (!(button instanceof HTMLButtonElement)) {
            return { exists: false, visible: false, label: '' }
          }
          const rect = button.getBoundingClientRect()
          const style = getComputedStyle(button)
          return {
            exists: true,
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden',
            label: button.textContent?.trim() || '',
          }
        })()`)
        assert.deepEqual(
          manualSyncState,
          {
            exists: true,
            visible: true,
            label: manualSyncState.label,
          },
          'Settings Sync tab must show a manual Sync now button.',
        )
        assert.ok(
          ['立即同步', 'Sync now', '今すぐ同期'].includes(manualSyncState.label),
          `Manual sync action must use localized current copy: ${JSON.stringify(manualSyncState)}`,
        )
        const syncModeChangeStarted = await evaluate(`(() => {
          const buttons = [...document.querySelectorAll('.zc-segmented button')]
          const originalIndex = buttons.findIndex(
            (button) => button.getAttribute('aria-pressed') === 'true',
          )
          const targetIndex = buttons.findIndex(
            (button) => button.getAttribute('aria-pressed') !== 'true' && !button.disabled,
          )
          const target = buttons[targetIndex]
          if (!(target instanceof HTMLButtonElement) || originalIndex < 0) return null
          window.__zerochatSyncModeFocusTarget = target
          target.focus()
          const focused = document.activeElement === target
          target.click()
          return { focused, originalIndex, targetIndex }
        })()`)
        assert.equal(
          syncModeChangeStarted?.focused,
          true,
          `Current sync mode change must start from its keyboard-focusable action: ${JSON.stringify(syncModeChangeStarted)}`,
        )
        await waitFor(
          `document.querySelectorAll('.zc-segmented button')[${syncModeChangeStarted?.targetIndex}]?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-zc-sync-settings="true"]')?.getAttribute('aria-busy') === 'false'`,
          'temporary sync mode durable change',
        )
        await waitFor(
          'document.activeElement === window.__zerochatSyncModeFocusTarget',
          'sync mode durable change focus restoration',
        )
        const syncModeRestoreStarted = await evaluate(`(() => {
          const button = document.querySelectorAll('.zc-segmented button')[${syncModeChangeStarted?.originalIndex}]
          if (!(button instanceof HTMLButtonElement) || button.disabled) return false
          window.__zerochatSyncModeFocusTarget = button
          button.focus()
          const focused = document.activeElement === button
          button.click()
          return focused
        })()`)
        assert.equal(
          syncModeRestoreStarted,
          true,
          'Current sync mode fixture restore must start from its keyboard-focusable action',
        )
        await waitFor(
          `document.querySelectorAll('.zc-segmented button')[${syncModeChangeStarted?.originalIndex}]?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-zc-sync-settings="true"]')?.getAttribute('aria-busy') === 'false'`,
          'current sync mode fixture durable restore',
        )
        await waitFor(
          'document.activeElement === window.__zerochatSyncModeFocusTarget',
          'sync mode fixture restore focus restoration',
        )
        const gistModeSetup = await evaluate(`(() => {
          const buttons = [...document.querySelectorAll('.zc-segmented button')]
          const originalIndex = buttons.findIndex(
            (button) => button.getAttribute('aria-pressed') === 'true',
          )
          const gistIndex = 1
          const gistButton = buttons[gistIndex]
          if (!(gistButton instanceof HTMLButtonElement) || originalIndex < 0) return null
          if (originalIndex !== gistIndex) {
            window.__zerochatSyncModeFocusTarget = gistButton
            gistButton.focus()
            gistButton.click()
          }
          return { changed: originalIndex !== gistIndex, gistIndex, originalIndex }
        })()`)
        assert.ok(gistModeSetup, 'GitHub token focus smoke must find the Gist sync mode')
        await waitFor(
          `document.querySelectorAll('.zc-segmented button')[${gistModeSetup?.gistIndex}]?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-zc-sync-settings="true"]')?.getAttribute('aria-busy') === 'false'`,
          'temporary Gist mode durable change',
        )
        if (gistModeSetup?.changed) {
          await waitFor(
            'document.activeElement === window.__zerochatSyncModeFocusTarget',
            'temporary Gist mode focus restoration',
          )
        }
        const githubTokenDraftSetup = await evaluate(`(() => {
          const input = document.querySelector('.zc-sync-settings .zc-credential-row input[type="password"]')
          const button = input?.closest('.zc-credential-row')?.querySelector('button.zc-btn')
          if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
            return false
          }
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          if (!setter) return false
          setter.call(input, 'browser-smoke-github-token')
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
          window.__zerochatGithubTokenInput = input
          window.__zerochatGithubTokenSave = button
          return true
        })()`)
        assert.equal(
          githubTokenDraftSetup,
          true,
          'Current GitHub token draft must reach the production input',
        )
        await waitFor(
          'window.__zerochatGithubTokenSave?.disabled === false',
          'current GitHub token save enablement',
        )
        const githubTokenSaveStarted = await evaluate(`(() => {
          const button = window.__zerochatGithubTokenSave
          if (!(button instanceof HTMLButtonElement)) return false
          button.focus()
          const focused = document.activeElement === button
          button.click()
          return focused
        })()`)
        assert.equal(
          githubTokenSaveStarted,
          true,
          'Current GitHub token save must start from its keyboard-focusable action',
        )
        await waitFor(
          `window.__zerochatGithubTokenInput?.value === '' && window.__zerochatGithubTokenSave?.disabled === true`,
          'current GitHub token durable save',
        )
        await waitFor(
          'document.activeElement === window.__zerochatGithubTokenInput',
          'current GitHub token focus restoration',
        )
        if (gistModeSetup?.changed) {
          const gistModeRestoreStarted = await evaluate(`(() => {
            const button = document.querySelectorAll('.zc-segmented button')[${gistModeSetup?.originalIndex}]
            if (!(button instanceof HTMLButtonElement) || button.disabled) return false
            window.__zerochatSyncModeFocusTarget = button
            button.focus()
            const focused = document.activeElement === button
            button.click()
            return focused
          })()`)
          assert.equal(
            gistModeRestoreStarted,
            true,
            'GitHub token focus fixture must restore the original sync mode',
          )
          await waitFor(
            `document.querySelectorAll('.zc-segmented button')[${gistModeSetup.originalIndex}]?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-zc-sync-settings="true"]')?.getAttribute('aria-busy') === 'false'`,
            'GitHub token focus fixture durable restore',
          )
        }
        await assertReducedMotion()
      }
      if (tab === 'general') {
        const contextWindowState = await evaluate(`(() => {
          const field = document.querySelector('[data-chat-context-setting="true"] input[type="number"]')
          return field instanceof HTMLInputElement
            ? {
                exists: true,
                min: field.min,
                max: field.max,
                describedBy: field.getAttribute('aria-describedby') || '',
              }
            : { exists: false, min: '', max: '', describedBy: '' }
        })()`)
        assert.deepEqual(
          contextWindowState,
          {
            exists: true,
            min: '4',
            max: '200',
            describedBy: 'settings-chat-context-help',
          },
          `Settings General must expose the bounded chat context window: ${JSON.stringify(contextWindowState)}`,
        )
      }
      if (tab === 'data') {
        const initialPassphraseDraftSetup = await evaluate(`(() => {
          const input = document.querySelector('[data-zc-sync-passphrase="true"]')
          const button = input?.closest('.zc-credential-row')?.querySelector('button.zc-btn')
          if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
            return false
          }
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          if (!setter) return false
          setter.call(input, 'browser-smoke-initial-passphrase')
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
          return true
        })()`)
        assert.equal(
          initialPassphraseDraftSetup,
          true,
          'Initial current encryption passphrase draft must reach the production input',
        )
        await waitFor(
          `document.querySelector('[data-zc-sync-passphrase="true"]')?.closest('.zc-credential-row')?.querySelector('button.zc-btn')?.disabled === false`,
          'initial current encryption passphrase save enablement',
        )
        const initialPassphraseCommitSetup = await evaluate(`(() => {
          const input = document.querySelector('[data-zc-sync-passphrase="true"]')
          const button = input?.closest('.zc-credential-row')?.querySelector('button.zc-btn')
          if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
            return { found: false, confirmCalls: -1 }
          }
          const originalConfirm = window.confirm
          let confirmCalls = 0
          try {
            window.confirm = () => {
              confirmCalls += 1
              return false
            }
            button.focus()
            const focused = document.activeElement === button
            button.click()
            return {
              found: true,
              confirmCalls,
              focused,
            }
          } finally {
            window.confirm = originalConfirm
          }
        })()`)
        assert.deepEqual(
          initialPassphraseCommitSetup,
          { found: true, confirmCalls: 0, focused: true },
          `Initial current encryption passphrase save must not ask for rotation confirmation: ${JSON.stringify(initialPassphraseCommitSetup)}`,
        )
        await waitFor(
          `document.querySelector('[data-zc-sync-passphrase="true"]')?.value === '' && document.querySelector('[data-zc-sync-passphrase="true"]')?.closest('.zc-credential-row')?.querySelector('button.zc-btn')?.disabled === true`,
          'initial current encryption passphrase durable commit',
        )
        await waitFor(
          'document.activeElement === document.querySelector(\'[data-zc-sync-passphrase="true"]\')',
          'initial current encryption passphrase focus restoration',
        )

        const rotatedPassphraseDraftSetup = await evaluate(`(() => {
          const input = document.querySelector('[data-zc-sync-passphrase="true"]')
          const button = input?.closest('.zc-credential-row')?.querySelector('button.zc-btn')
          if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
            return false
          }
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          if (!setter) return false
          setter.call(input, 'browser-smoke-rotated-passphrase')
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
          return true
        })()`)
        assert.equal(
          rotatedPassphraseDraftSetup,
          true,
          'Changed current encryption passphrase draft must reach the production input',
        )
        await waitFor(
          `document.querySelector('[data-zc-sync-passphrase="true"]')?.closest('.zc-credential-row')?.querySelector('button.zc-btn')?.disabled === false`,
          'changed current encryption passphrase save enablement',
        )
        const cancelledPassphraseRotationState = await evaluate(`(async () => {
          const input = document.querySelector('[data-zc-sync-passphrase="true"]')
          const button = input?.closest('.zc-credential-row')?.querySelector('button.zc-btn')
          if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
            return { found: false, confirmCalls: -1, draftCleared: false, focused: false, saveDisabled: false, localizedNotice: false }
          }
          const originalConfirm = window.confirm
          let confirmCalls = 0
          try {
            window.confirm = () => {
              confirmCalls += 1
              return false
            }
            button.focus()
            button.click()
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            const notices = [...document.querySelectorAll('.zc-toast')].map((toast) => toast.textContent?.trim() || '')
            return {
              found: true,
              confirmCalls,
              draftCleared: input.value === '',
              focused: document.activeElement === input,
              saveDisabled: button.disabled,
              localizedNotice: notices.some((notice) => [
                '已取消数据加密密码修改。',
                'Encryption passphrase change cancelled.',
                '暗号化パスフレーズの変更をキャンセルしました。',
              ].includes(notice)),
            }
          } finally {
            window.confirm = originalConfirm
          }
        })()`, true)
        assert.deepEqual(
          cancelledPassphraseRotationState,
          {
            found: true,
            confirmCalls: 1,
            draftCleared: true,
            focused: true,
            saveDisabled: true,
            localizedNotice: true,
          },
          `Cancelled current encryption passphrase rotation must restore the committed state and editable input focus: ${JSON.stringify(cancelledPassphraseRotationState)}`,
        )

        const cancelledResetFocusState = await evaluate(`(async () => {
          const button = Array.from(document.querySelectorAll('.zc-settings-scroll button')).find(
            (candidate) => ['清除全部本地数据', 'Erase all local data', 'すべてのローカルデータを消去'].includes(
              candidate.textContent?.trim() || '',
            ),
          )
          if (!(button instanceof HTMLButtonElement)) {
            return { found: false, confirmCalls: 0, focused: false }
          }
          const originalConfirm = window.confirm
          let confirmCalls = 0
          try {
            window.confirm = () => {
              confirmCalls += 1
              return false
            }
            button.focus()
            button.click()
            await Promise.resolve()
            return {
              found: true,
              confirmCalls,
              focused: document.activeElement === button,
            }
          } finally {
            window.confirm = originalConfirm
          }
        })()`, true)
        assert.deepEqual(
          cancelledResetFocusState,
          { found: true, confirmCalls: 1, focused: true },
          'Cancelled current local-data reset must keep focus on its trigger',
        )
      }
    }

    await clickSelector('#settings-tab-sync')
    await waitFor(
      'Boolean(document.querySelector(\'[data-zc-sync-settings="true"]\'))',
      'Cloudflare access-key copy focus settings',
    )
    const cloudflareCopyModeSetup = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.zc-segmented button')]
      const originalIndex = buttons.findIndex(
        (button) => button.getAttribute('aria-pressed') === 'true',
      )
      const cloudflareIndex = 2
      const target = buttons[cloudflareIndex]
      if (!(target instanceof HTMLButtonElement) || originalIndex < 0) return null
      if (originalIndex !== cloudflareIndex) target.click()
      return { cloudflareIndex, originalIndex }
    })()`)
    assert.ok(
      cloudflareCopyModeSetup,
      'Cloudflare access-key copy focus smoke must find the Cloudflare sync mode',
    )
    await waitFor(
      `document.querySelectorAll('.zc-segmented button')[${cloudflareCopyModeSetup?.cloudflareIndex}]?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-zc-sync-settings="true"]')?.getAttribute('aria-busy') === 'false'`,
      'Cloudflare access-key copy focus mode',
    )
    const cloudflareCopyFallbackSetup = await evaluate(`(() => {
      const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
      const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')
      const install = (target, property, value) => {
        try {
          Object.defineProperty(target, property, {
            configurable: true,
            writable: true,
            value,
          })
          return true
        } catch {
          return false
        }
      }
      window.__zerochatSyncAccessKeyCopy = {
        execCalls: 0,
        restore() {
          if (clipboardDescriptor) {
            Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
          } else {
            delete navigator.clipboard
          }
          if (execCommandDescriptor) {
            Object.defineProperty(document, 'execCommand', execCommandDescriptor)
          } else {
            delete document.execCommand
          }
        },
      }
      const clipboardInstalled = install(navigator, 'clipboard', {
        writeText: () => new Promise((_, reject) => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            reject(new Error('sync access-key clipboard unavailable'))
          }))
        }),
      })
      const execCommandInstalled = install(document, 'execCommand', (command) => {
        if (command === 'copy') window.__zerochatSyncAccessKeyCopy.execCalls += 1
        return command === 'copy'
      })
      return { clipboardInstalled, execCommandInstalled }
    })()`)
    assert.deepEqual(
      cloudflareCopyFallbackSetup,
      { clipboardInstalled: true, execCommandInstalled: true },
      `Cloudflare access-key copy focus smoke must install a contained fallback: ${JSON.stringify(cloudflareCopyFallbackSetup)}`,
    )
    const cloudflareCopyStarted = await evaluate(`(() => {
      const button = document.querySelector('[data-zc-cloudflare-access-key="true"] button')
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false
      window.__zerochatSyncAccessKeyCopyButton = button
      button.focus()
      const focused = document.activeElement === button
      button.click()
      return focused
    })()`)
    assert.equal(
      cloudflareCopyStarted,
      true,
      'Cloudflare access-key copy must start from its keyboard-focusable action',
    )
    await waitFor(
      'window.__zerochatSyncAccessKeyCopy?.execCalls === 1 && !document.querySelector("body > textarea")',
      'Cloudflare access-key clipboard fallback completion',
    )
    await waitFor(
      'document.activeElement === window.__zerochatSyncAccessKeyCopyButton',
      'Cloudflare access-key copy focus restoration',
    )
    await evaluate(`(() => {
      window.__zerochatSyncAccessKeyCopy?.restore()
      delete window.__zerochatSyncAccessKeyCopy
      delete window.__zerochatSyncAccessKeyCopyButton
      return true
    })()`)
    if (cloudflareCopyModeSetup?.originalIndex !== cloudflareCopyModeSetup?.cloudflareIndex) {
      await evaluate(`(() => {
        const button = document.querySelectorAll('.zc-segmented button')[${cloudflareCopyModeSetup?.originalIndex}]
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false
        button.click()
        return true
      })()`)
      await waitFor(
        `document.querySelectorAll('.zc-segmented button')[${cloudflareCopyModeSetup?.originalIndex}]?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-zc-sync-settings="true"]')?.getAttribute('aria-busy') === 'false'`,
        'Cloudflare access-key copy focus mode restore',
      )
    }

    await clickSelector('#settings-tab-skills')
    await waitFor('Boolean(document.querySelector(".zc-skill-editor"))', 'skills editor for reveal smoke')
    const skillRevealSetup = await evaluate(`(() => {
      const state = { calls: 0, options: null }
      const original = Element.prototype.scrollIntoView
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value(options) {
          state.calls += 1
          state.options = options || null
          return original?.call(this, options)
        },
      })
      window.__zerochatSkillReveal = state
      return true
    })()`)
    assert.equal(skillRevealSetup, true, 'Skill reveal smoke must install the scroll observer')
    await setFieldValue('.zc-skill-editor input', 'browser smoke skill')
    await setFieldValue('.zc-skill-editor textarea', '# Browser smoke skill\n\ncontent')
    await clickSelector('.zc-skill-editor button[type="submit"]')
    await waitFor(
      'Boolean(document.querySelector(".zc-skill-item"))',
      'committed Skill row',
      20_000,
    )
    await waitFor(
      'window.__zerochatSkillReveal?.calls === 1',
      'committed Skill row reveal',
    )
    const skillRevealState = await evaluate(`(() => {
      const row = document.querySelector('.zc-skill-item')
      const state = window.__zerochatSkillReveal || { calls: 0, options: null }
      return {
        calls: state.calls,
        options: state.options,
        hasSkillName: row?.textContent?.includes('browser smoke skill') || false,
      }
    })()`)
    assert.equal(
      skillRevealState.calls,
      1,
      `Committed Skill row must reveal exactly once after render: ${JSON.stringify(skillRevealState)}`,
    )
    assert.deepEqual(
      skillRevealState.options,
      { block: 'nearest', inline: 'nearest', behavior: 'auto' },
      `Committed Skill row reveal must use bounded nearest scrolling: ${JSON.stringify(skillRevealState)}`,
    )
    assert.equal(
      skillRevealState.hasSkillName,
      true,
      `Committed Skill row must be the submitted current skill: ${JSON.stringify(skillRevealState)}`,
    )
    await waitFor(
      'document.activeElement === document.querySelector(".zc-skill-editor input")',
      'Skill add editor focus restoration',
    )

    const currentSkillEditOpened = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.zc-skill-item')].find((candidate) =>
        candidate.textContent?.includes('browser smoke skill'),
      )
      const edit = row?.querySelector('.zc-icon-btn:not(.danger)')
      if (!(edit instanceof HTMLButtonElement)) return false
      edit.focus()
      const focused = document.activeElement === edit
      edit.click()
      return focused
    })()`)
    assert.equal(currentSkillEditOpened, true, 'Current Skill row must expose its edit action')
    await waitFor(
      'document.querySelector(".zc-skill-editor input")?.value === "browser smoke skill"',
      'current Skill edit draft',
    )
    await waitFor(
      'document.activeElement === document.querySelector(".zc-skill-editor input")',
      'current Skill edit load focus restoration',
    )
    const currentSkillEditCancelStarted = await evaluate(`(() => {
      const cancel = document.querySelector('.zc-skill-editor .zc-icon-btn')
      if (!(cancel instanceof HTMLButtonElement)) return false
      cancel.focus()
      const focused = document.activeElement === cancel
      cancel.click()
      return focused
    })()`)
    assert.equal(
      currentSkillEditCancelStarted,
      true,
      'Current Skill edit cancel must start from its keyboard-focusable action',
    )
    await waitFor(
      'document.querySelector(".zc-skill-editor input")?.value === "" && !document.querySelector(".zc-skill-editor .zc-icon-btn")',
      'current Skill edit cancel reset',
    )
    await waitFor(
      'document.activeElement === document.querySelector(".zc-skill-editor input")',
      'current Skill edit cancel focus restoration',
    )
    const currentSkillEditReopened = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.zc-skill-item')].find((candidate) =>
        candidate.textContent?.includes('browser smoke skill'),
      )
      const edit = row?.querySelector('.zc-icon-btn:not(.danger)')
      if (!(edit instanceof HTMLButtonElement)) return false
      edit.focus()
      edit.click()
      return true
    })()`)
    assert.equal(currentSkillEditReopened, true, 'Current Skill row must reopen after cancel')
    await waitFor(
      'document.querySelector(".zc-skill-editor input")?.value === "browser smoke skill"',
      'current Skill edit reopened draft',
    )
    await waitFor(
      'document.activeElement === document.querySelector(".zc-skill-editor input")',
      'current Skill edit reopen focus restoration',
    )
    await setFieldValue('.zc-skill-editor input', 'browser smoke skill edited')
    await setFieldValue(
      '.zc-skill-editor textarea',
      '# Browser smoke skill\n\nedited content',
    )
    await clickSelector('.zc-skill-editor button[type="submit"]')
    await waitFor(
      '[...document.querySelectorAll(".zc-skill-item")].some((row) => row.textContent?.includes("browser smoke skill edited"))',
      'saved current Skill edit',
      20_000,
    )
    await waitFor(
      'document.activeElement === document.querySelector(".zc-skill-editor input")',
      'Skill edit editor focus restoration',
    )
    const localizedSkillSavedFeedback = await evaluate(`(() => {
      const expectedByLocale = {
        'en-US': 'Skill saved',
        'ja-JP': 'スキルを保存しました',
        'zh-CN': '技能已保存',
      }
      const expected = expectedByLocale[document.documentElement.lang] || expectedByLocale['zh-CN']
      return [...document.querySelectorAll('.zc-toast')].some(
        (toast) => toast.textContent?.includes(expected),
      )
    })()`)
    assert.equal(
      localizedSkillSavedFeedback,
      true,
      'Current Skill edit must report localized saved feedback',
    )
    const globalSkillToggleStarted = await evaluate(`(() => {
      const toggle = document.querySelector('.zc-skill-settings [role="switch"]')
      if (!(toggle instanceof HTMLButtonElement)) return null
      window.__zerochatGlobalSkillToggleFocusTarget = toggle
      const checked = toggle.getAttribute('aria-checked')
      toggle.focus()
      const focused = document.activeElement === toggle
      toggle.click()
      return { checked, focused }
    })()`)
    assert.equal(
      globalSkillToggleStarted?.focused,
      true,
      `Global Skill auto-match toggle must accept keyboard focus: ${JSON.stringify(globalSkillToggleStarted)}`,
    )
    await waitFor(
      `window.__zerochatGlobalSkillToggleFocusTarget?.getAttribute('aria-checked') !== ${JSON.stringify(globalSkillToggleStarted?.checked)}`,
      'global Skill auto-match durable toggle',
    )
    await waitFor(
      'document.activeElement === window.__zerochatGlobalSkillToggleFocusTarget',
      'global Skill auto-match toggle focus restoration',
    )
    const skillToggleStarted = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.zc-skill-item')].find((candidate) =>
        candidate.textContent?.includes('browser smoke skill edited'),
      )
      const toggle = row?.querySelector('[role="switch"]')
      if (!(toggle instanceof HTMLButtonElement)) return null
      window.__zerochatSkillToggleFocusTarget = toggle
      const checked = toggle.getAttribute('aria-checked')
      toggle.focus()
      const focused = document.activeElement === toggle
      toggle.click()
      return { checked, focused }
    })()`)
    assert.equal(
      skillToggleStarted?.focused,
      true,
      `Current Skill enabled toggle must accept keyboard focus: ${JSON.stringify(skillToggleStarted)}`,
    )
    await waitFor(
      `window.__zerochatSkillToggleFocusTarget?.getAttribute('aria-checked') !== ${JSON.stringify(skillToggleStarted?.checked)}`,
      'Skill enabled durable toggle',
    )
    await waitFor(
      'document.activeElement === window.__zerochatSkillToggleFocusTarget',
      'Skill enabled toggle focus restoration',
    )

    await evaluate(`(() => {
      const state = window.__zerochatSkillReveal
      if (!state) throw new Error('Missing Skill reveal observer')
      state.calls = 0
      state.options = null
      return true
    })()`)
    const importedSkillPath = path.join(profileDir, 'browser-smoke-imported-skill.md')
    await writeFile(
      importedSkillPath,
      '# Browser smoke imported skill\n\nimported content',
      'utf8',
    )
    await setFileInputFiles('input[type="file"][accept*=".md"]', [importedSkillPath])
    await waitFor(
      '[...document.querySelectorAll(".zc-skill-item")].some((row) => row.textContent?.includes("browser smoke imported skill"))',
      'imported Skill row',
      20_000,
    )
    await waitFor(
      'window.__zerochatSkillReveal?.calls === 1',
      'imported Skill row reveal',
    )
    const importedSkillRevealState = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.zc-skill-item')].find((candidate) =>
        candidate.textContent?.includes('browser smoke imported skill'),
      )
      const state = window.__zerochatSkillReveal || { calls: 0, options: null }
      return {
        calls: state.calls,
        options: state.options,
        hasSkillName: Boolean(row),
      }
    })()`)
    assert.equal(
      importedSkillRevealState.calls,
      1,
      `Committed imported Skill row must reveal exactly once after render: ${JSON.stringify(importedSkillRevealState)}`,
    )
    assert.deepEqual(
      importedSkillRevealState.options,
      { block: 'nearest', inline: 'nearest', behavior: 'auto' },
      `Committed imported Skill row reveal must use bounded nearest scrolling: ${JSON.stringify(importedSkillRevealState)}`,
    )
    assert.equal(
      importedSkillRevealState.hasSkillName,
      true,
      `Committed imported Skill row must be the imported target: ${JSON.stringify(importedSkillRevealState)}`,
    )

    const skillDeleteFocusStarted = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.zc-skill-item')].find((candidate) =>
        candidate.textContent?.includes('browser smoke imported skill'),
      )
      const deleteButton = row?.querySelector('.zc-icon-btn.danger')
      const nameInput = document.querySelector('.zc-skill-editor input')
      if (
        !(row instanceof HTMLElement) ||
        !(deleteButton instanceof HTMLButtonElement) ||
        !(nameInput instanceof HTMLInputElement)
      ) {
        return false
      }
      const originalConfirm = window.confirm
      try {
        window.confirm = () => true
        window.__zerochatSkillDeleteFocusTarget = nameInput
        deleteButton.focus()
        deleteButton.click()
        return document.activeElement === deleteButton
      } finally {
        window.confirm = originalConfirm
      }
    })()`)
    assert.equal(
      skillDeleteFocusStarted,
      true,
      'Current imported Skill row must start its confirmed durable delete from the delete action',
    )
    await waitFor(
      '![...document.querySelectorAll(".zc-skill-item")].some((row) => row.textContent?.includes("browser smoke imported skill"))',
      'temporary imported Skill durable delete',
      20_000,
    )
    await waitFor(
      'document.activeElement === window.__zerochatSkillDeleteFocusTarget',
      'Skill delete editor focus restoration',
    )

    await clickSelector('.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings-overlay")', 'settings close')
    await waitFor(
      'document.activeElement === window.__zerochatSettingsOpener',
      'Settings opener focus restoration',
    )
    assert.equal(
      await evaluate('document.activeElement === window.__zerochatSettingsOpener'),
      true,
      'settings modal should restore focus to the button that opened it',
    )
    await clickText(['开始使用', 'Start chatting'])
    await waitFor('Boolean(document.querySelector(".zc-composer textarea"))', 'chat composer')
    await waitFor(
      'document.activeElement === document.querySelector(".zc-composer textarea")',
      'onboarding start Composer focus restoration',
    )
    await waitFor('Boolean(document.querySelector(".zc-chat-header"))', 'chat header')
    await waitFor(
      'Boolean(document.querySelector(\'[data-feature-hint="chat"]\'))',
      'current chat feature hint',
    )
    const chatFeatureHintState = await evaluate(`(() => {
      const hint = document.querySelector('[data-feature-hint="chat"]')
      return {
        role: hint?.getAttribute('role') || '',
        live: hint?.getAttribute('aria-live') || '',
        atomic: hint?.getAttribute('aria-atomic') || '',
      }
    })()`)
    assert.deepEqual(
      chatFeatureHintState,
      { role: 'status', live: 'polite', atomic: 'true' },
      `Current chat feature hint must expose polite atomic status semantics: ${JSON.stringify(chatFeatureHintState)}`,
    )
    await clickSelector('[data-feature-hint="chat"] button[type="button"]')
    await waitFor(
      '!document.querySelector(\'[data-feature-hint="chat"]\')',
      'current chat feature hint dismissal',
    )
    await waitFor(
      'document.activeElement === document.querySelector(".zc-composer textarea")',
      'current chat feature hint Composer focus restoration',
    )

    const composerAttachmentStarted = await evaluate(`(async () => {
      const input = document.querySelector('.zc-composer-row input[type="file"]')
      const attach = input?.nextElementSibling
      if (!(input instanceof HTMLInputElement) || !(attach instanceof HTMLButtonElement)) {
        return false
      }
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
      const context = canvas.getContext('2d')
      if (!context) return false
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 16, 16)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!(blob instanceof Blob)) return false
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob], 'browser-composer-focus.png', { type: 'image/png' }))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      window.__zerochatComposerAttachFocusTarget = attach
      return true
    })()`, true)
    assert.equal(
      composerAttachmentStarted,
      true,
      'Current Composer image attachment must reach the production file input',
    )
    await waitFor(
      'document.querySelector(".zc-composer-images .zc-thumb button") instanceof HTMLButtonElement',
      'current Composer image attachment render',
    )
    const composerImageRemovalStarted = await evaluate(`(() => {
      const remove = document.querySelector('.zc-composer-images .zc-thumb button')
      if (!(remove instanceof HTMLButtonElement)) return false
      remove.focus()
      const focused = document.activeElement === remove
      remove.click()
      return focused
    })()`)
    assert.equal(
      composerImageRemovalStarted,
      true,
      'Current Composer image removal must start from its keyboard-focusable action',
    )
    await waitFor(
      '!document.querySelector(".zc-composer-images .zc-thumb")',
      'current Composer image removal',
    )
    await waitFor(
      'document.activeElement === window.__zerochatComposerAttachFocusTarget',
      'current Composer image removal focus restoration',
    )

    const conversationStarterNetworkCount = networkRequestUrls.length
    const conversationStarterState = await evaluate(`(() => {
      const group = document.querySelector('[data-conversation-starters="true"]')
      const actions = [...(group?.querySelectorAll('[data-conversation-starter]') ?? [])]
      return {
        actionCount: actions.length,
        label: group?.getAttribute('aria-label') || '',
        messageCount: document.querySelectorAll('.zc-msg').length,
        role: group?.getAttribute('role') || '',
      }
    })()`)
    assert.deepEqual(
      {
        actionCount: conversationStarterState.actionCount,
        messageCount: conversationStarterState.messageCount,
        role: conversationStarterState.role,
      },
      {
        actionCount: 4,
        messageCount: 0,
        role: 'group',
      },
      `Conversation starters must expose four current actions: ${JSON.stringify(conversationStarterState)}`,
    )
    assert.ok(
      conversationStarterState.label.trim().length > 0,
      `Conversation starters must expose a localized group name: ${JSON.stringify(conversationStarterState)}`,
    )
    await clickSelector('[data-conversation-starter="brainstorm"]')
    await waitFor(
      `document.activeElement === document.querySelector('.zc-composer textarea') && Boolean(document.querySelector('.zc-composer textarea')?.value.trim())`,
      'conversation starter Composer focus',
    )
    await sleep(100)
    const conversationStarterSelectionState = await evaluate(`(() => {
      const textarea = document.querySelector('.zc-composer textarea')
      return {
        focused: document.activeElement === textarea,
        messageCount: document.querySelectorAll('.zc-msg').length,
        sendEnabled: textarea?.closest('.zc-composer-row')?.querySelector('.zc-send-btn')?.disabled === false,
        value: textarea?.value || '',
      }
    })()`)
    assert.equal(
      conversationStarterSelectionState.focused,
      true,
      'Conversation starter must focus the current Composer',
    )
    assert.ok(
      conversationStarterSelectionState.value.trim().length > 0,
      'Conversation starter must fill the current Composer draft',
    )
    assert.equal(
      conversationStarterSelectionState.sendEnabled,
      true,
      'Conversation starter draft must remain ready for explicit user submission',
    )
    assert.equal(
      conversationStarterSelectionState.messageCount,
      0,
      'Conversation starter must fill and focus the Composer without sending',
    )
    assert.equal(
      networkRequestUrls.length,
      conversationStarterNetworkCount,
      'Conversation starter must not issue a network request before explicit submission',
    )
    await setComposerValue('')

    const headerProviderModelPillState = await evaluate(`(() => {
      const select = document.querySelector('.zc-chat-header .zc-model-select')
      if (!(select instanceof HTMLSelectElement)) return null
      const style = getComputedStyle(select)
      const minimumRadius = select.getBoundingClientRect().height / 2
      const radii = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ].map((value) => Number.parseFloat(value))
      return {
        labelled: (select.getAttribute('aria-label')?.trim().length ?? 0) > 0,
        pill: radii.every((radius) => Number.isFinite(radius) && radius >= minimumRadius),
      }
    })()`)
    assert.equal(
      headerProviderModelPillState?.labelled && headerProviderModelPillState?.pill,
      true,
      'provider/model header selector should render as a labelled pill',
    )

    const nativeModelSelectFocused = await evaluate(`(() => {
      const select = document.querySelector('.zc-chat-header .zc-model-select')
      if (!(select instanceof HTMLSelectElement)) return false
      select.focus()
      return document.activeElement === select
    })()`)
    assert.equal(nativeModelSelectFocused, true, 'Native provider/model select must accept keyboard focus')
    const nativeModelSelection = await evaluate(`(() => {
      const select = document.querySelector('.zc-chat-header .zc-model-select')
      if (!(select instanceof HTMLSelectElement)) return null
      const originalValue = select.value
      const nextOption = [...select.options].find((option) => option.value !== select.value)
      if (!(nextOption instanceof HTMLOptionElement)) return null
      select.focus()
      select.value = nextOption.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return { nextValue: nextOption.value, originalValue }
    })()`)
    assert.equal(
      typeof nativeModelSelection?.nextValue,
      'string',
      'Native provider/model fixture must offer another model',
    )
    await waitFor(
      `document.querySelector('.zc-chat-header .zc-model-select')?.value === ${JSON.stringify(nativeModelSelection?.nextValue)}`,
      'native provider/model selection durable value',
    )
    await waitFor(
      "document.activeElement === document.querySelector('.zc-chat-header .zc-model-select')",
      'native provider/model selection focus restoration',
    )
    const nativeModelSelectionFocusState = await evaluate(`(() => {
      const select = document.querySelector('.zc-chat-header .zc-model-select')
      return {
        activeClass: document.activeElement?.className || '',
        activeTag: document.activeElement?.tagName || '',
        disabled: select instanceof HTMLSelectElement ? select.disabled : null,
        focused: document.activeElement === select,
      }
    })()`)
    assert.equal(
      nativeModelSelectionFocusState.focused,
      true,
      `Native provider/model selection must restore focus after durable commit: ${JSON.stringify(nativeModelSelectionFocusState)}`,
    )
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    assert.equal(
      await evaluate(`document.activeElement === document.querySelector('.zc-chat-header .zc-model-select')`),
      true,
      'Native provider/model Escape must preserve focus',
    )
    await evaluate(`(() => {
      const select = document.querySelector('.zc-chat-header .zc-model-select')
      if (!(select instanceof HTMLSelectElement)) return false
      select.value = ${JSON.stringify(nativeModelSelection?.originalValue)}
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    await waitFor(
      `document.activeElement === document.querySelector('.zc-chat-header .zc-model-select') && document.querySelector('.zc-chat-header .zc-model-select')?.value === ${JSON.stringify(nativeModelSelection?.originalValue)}`,
      'native provider/model fixture restore',
    )
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    })
    await waitFor(
      `document.activeElement === document.querySelector('.zc-chat-header .zc-icon-btn:last-of-type')`,
      'native provider/model select forward Tab order',
    )
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      modifiers: 8,
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      modifiers: 8,
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    })
    await waitFor(
      `document.activeElement === document.querySelector('.zc-chat-header .zc-model-select')`,
      'native provider/model select reverse Shift+Tab order',
    )

    await clickText(['图片', 'Image'], '.zc-composer-mode')
    await waitFor('Boolean(document.querySelector(".zc-image-task-modes"))', 'image task modes')
    await waitFor('Boolean(document.querySelector(".image-compose-panel"))', 'image composer panel')
    await waitFor(
      'Boolean(document.querySelector(\'[data-feature-hint="image"]\'))',
      'current image feature hint',
    )
    assert.equal(
      await evaluate('Boolean(document.querySelector(\'[data-feature-hint="chat"]\'))'),
      false,
      'Current chat and image feature hints must remain independently dismissible',
    )
    await clickSelector('[data-feature-hint="image"] button[type="button"]')
    await waitFor(
      '!document.querySelector(\'[data-feature-hint="image"]\')',
      'current image feature hint dismissal',
    )
    await clickText(['编辑', 'Edit'], '.zc-image-task-modes')
    await waitFor('Boolean(document.querySelector(".image-source-panel input[type=file]"))', 'image edit source input')
    const previewOwnershipSetup = await evaluate(`(() => {
      const originalCreateObjectURL = URL.createObjectURL.bind(URL)
      const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL)
      const state = {
        created: [],
        revoked: [],
        restore() {
          URL.createObjectURL = originalCreateObjectURL
          URL.revokeObjectURL = originalRevokeObjectURL
        },
      }
      URL.createObjectURL = (blob) => {
        const url = originalCreateObjectURL(blob)
        state.created.push(url)
        return url
      }
      URL.revokeObjectURL = (url) => {
        state.revoked.push(url)
        return originalRevokeObjectURL(url)
      }
      window.__zerochatImagePreviewOwnership = state
      return true
    })()`)
    assert.equal(previewOwnershipSetup, true, 'Image preview ownership observer must install')
    const selectPreviewImage = async (name) =>
      evaluate(`(async () => {
        const input = document.querySelector('.image-source-panel input[type=file]')
        if (!(input instanceof HTMLInputElement)) return false
        const fixture = document.createElement('canvas')
        fixture.width = 128
        fixture.height = 128
        const context = fixture.getContext('2d')
        if (!context) return false
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, fixture.width, fixture.height)
        const blob = await new Promise((resolve) => fixture.toBlob(resolve, 'image/png'))
        if (!(blob instanceof Blob)) return false
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob], ${JSON.stringify(name)}, { type: 'image/png' }))
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`, true)
    assert.equal(await selectPreviewImage('browser-preview-first.png'), true, 'First image preview fixture must reach the current input')
    await waitFor(
      'window.__zerochatImagePreviewOwnership?.created.length === 1 && document.querySelector(".image-source-preview")?.complete === true',
      'first current image preview',
    )
    const compactImageSourceName =
      'zerochat-smoke-source-with-a-deliberately-long-file-name-for-compact-layout-regression-check.png'
    assert.equal(await selectPreviewImage(compactImageSourceName), true, 'Replacement image preview fixture must reach the current input')
    await waitFor(
      'window.__zerochatImagePreviewOwnership?.created.length === 2 && window.__zerochatImagePreviewOwnership?.revoked.length >= 1 && document.querySelector(".image-source-preview")?.complete === true',
      'replacement current image preview',
    )
    const previewOwnershipState = await evaluate(`(() => {
      const state = window.__zerochatImagePreviewOwnership
      const preview = document.querySelector('.image-source-preview')
      const created = state?.created || []
      const revoked = state?.revoked || []
      return {
        created: created.length,
        revokeCounts: created.map((url) => revoked.filter((entry) => entry === url).length),
        retained: preview instanceof HTMLImageElement && preview.src === created[1],
      }
    })()`)
    assert.deepEqual(
      previewOwnershipState,
      { created: 2, revokeCounts: [1, 0], retained: true },
      'Current image replacement must revoke only the previous preview URL',
    )
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 640,
      deviceScaleFactor: 1,
      mobile: true,
    })
    if (await evaluate("Boolean(document.querySelector('.zc-sidebar-backdrop'))")) {
      await clickSelector('.zc-sidebar-backdrop')
      await waitFor(
        "document.querySelector('.zc-app-surface')?.getAttribute('aria-hidden') !== 'true'",
        'compact image fixture closes current Sidebar overlay',
      )
    }
    await waitFor(
      `document.querySelector('.image-source-name')?.textContent === ${JSON.stringify(compactImageSourceName)}`,
      'compact image long filename render',
    )
    const compactImageComposerState = await evaluate(`(() => {
      const panel = document.querySelector('.image-compose-panel')
      const sourcePanel = document.querySelector('.image-source-panel')
      const sourceName = document.querySelector('.image-source-name')
      const composer = document.querySelector('.zc-composer')
      const header = document.querySelector('.zc-chat-header')
      if (!(panel instanceof HTMLElement) || !(sourcePanel instanceof HTMLElement) ||
          !(sourceName instanceof HTMLElement) || !(composer instanceof HTMLElement) ||
          !(header instanceof HTMLElement)) {
        return { exists: false }
      }
      const panelRect = panel.getBoundingClientRect()
      const sourcePanelRect = sourcePanel.getBoundingClientRect()
      const sourceNameRect = sourceName.getBoundingClientRect()
      const composerRect = composer.getBoundingClientRect()
      const headerRect = header.getBoundingClientRect()
      const actionRects = [...sourcePanel.querySelectorAll('button, label.file-button')]
        .map((element) => element.getBoundingClientRect())
      return {
        actionsInsidePanel: actionRects.every((rect) =>
          rect.left >= sourcePanelRect.left - 1 && rect.right <= sourcePanelRect.right + 1),
        composerInsideViewport: composerRect.left >= -1 && composerRect.right <= innerWidth + 1 &&
          composerRect.bottom <= innerHeight + 1,
        exists: true,
        filenameClipped: sourceName.scrollWidth > sourceName.clientWidth &&
          getComputedStyle(sourceName).textOverflow === 'ellipsis',
        filenameInsidePanel: sourceNameRect.left >= sourcePanelRect.left - 1 &&
          sourceNameRect.right <= sourcePanelRect.right + 1,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        panelBelowHeader: panelRect.top >= headerRect.bottom - 1,
        panelInsideComposer: panelRect.left >= composerRect.left - 1 &&
          panelRect.right <= composerRect.right + 1 && panelRect.bottom <= composerRect.bottom + 1,
      }
    })()`)
    assert.deepEqual(
      compactImageComposerState,
      {
        actionsInsidePanel: true,
        composerInsideViewport: true,
        exists: true,
        filenameClipped: true,
        filenameInsidePanel: true,
        horizontalOverflow: false,
        panelBelowHeader: true,
        panelInsideComposer: true,
      },
      `Compact image composer must contain a long source filename without overlap: ${JSON.stringify(compactImageComposerState)}`,
    )
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    const clearImageSourceFocused = await evaluate(`(() => {
      const action = document.querySelector('.image-source-actions .ghost-button')
      if (!(action instanceof HTMLButtonElement)) return false
      action.focus()
      action.click()
      return true
    })()`)
    assert.equal(clearImageSourceFocused, true, 'Current image source clear action must accept focus')
    await waitFor(
      '!document.querySelector(".image-source-preview") && !document.querySelector(".image-source-actions .ghost-button")',
      'current image source clear',
    )
    await waitFor(
      'document.activeElement === document.querySelector(\'[data-zc-image-source-select="true"]\')',
      'current image source clear focus restoration',
    )
    const clearedImageSourceFocusState = await evaluate(`(() => {
      const select = document.querySelector('[data-zc-image-source-select="true"]')
      return {
        focused: document.activeElement === select,
        selectIsButton: select instanceof HTMLButtonElement,
      }
    })()`)
    assert.deepEqual(
      clearedImageSourceFocusState,
      { focused: true, selectIsButton: true },
      `Clearing the current image source must restore focus to its stable select action: ${JSON.stringify(clearedImageSourceFocusState)}`,
    )
    assert.equal(
      await selectPreviewImage('browser-preview-inpaint.png'),
      true,
      'Inpaint image preview fixture must reach the current input after clear',
    )
    await waitFor(
      'window.__zerochatImagePreviewOwnership?.created.length === 3 && document.querySelector(".image-source-preview")?.complete === true',
      'current inpaint image preview after clear',
    )
    await evaluate(`(() => {
      window.__zerochatImagePreviewOwnership?.restore()
      delete window.__zerochatImagePreviewOwnership
      return true
    })()`)
    await clickText(['局部重绘', 'Inpaint'], '.zc-image-task-modes')
    await waitFor(
      'document.querySelector(".mask-canvas")?.width > 0 && document.querySelector(".mask-canvas")?.height > 0',
      'current inpaint mask canvas',
    )
    const inpaintDisabledTooltipState = await evaluate(`(() => {
      const action = document.querySelector('[data-mask-action="undo"]')
      const target = action?.closest('.mask-action-tooltip-target')
      if (!(action instanceof HTMLButtonElement) || !(target instanceof HTMLElement)) return null
      const rect = action.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      hit?.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
      }))
      return {
        disabled: action.disabled,
        wrapperOwnsHit: hit === target,
        tooltip: target.getAttribute('data-tooltip') || '',
      }
    })()`)
    assert.equal(inpaintDisabledTooltipState?.disabled, true, 'An untouched inpaint mask must keep Undo disabled')
    assert.equal(
      inpaintDisabledTooltipState?.wrapperOwnsHit,
      true,
      `Disabled current inpaint action must expose its tooltip through the wrapper: ${JSON.stringify(inpaintDisabledTooltipState)}`,
    )
    assert.ok(inpaintDisabledTooltipState?.tooltip, 'Disabled current inpaint wrapper must have localized tooltip copy')
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === ${JSON.stringify(inpaintDisabledTooltipState?.tooltip)}`,
      'disabled current inpaint wrapper tooltip',
    )
    await evaluate(`(() => {
      const target = document.querySelector('[data-mask-action="undo"]')?.closest('.mask-action-tooltip-target')
      target?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))
      return true
    })()`)
    await waitFor('!document.querySelector(\'[role="tooltip"]\')', 'disabled inpaint tooltip close')
    const { secondaryButtonState, nonPrimaryPointerState } = await evaluate(`(() => {
      const canvas = document.querySelector('.mask-canvas')
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing current mask canvas')
      const countMaskPixels = () => {
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
        if (!data) return -1
        let pixels = 0
        for (let index = 3; index < data.length; index += 4) {
          if (data[index] > 0) pixels += 1
        }
        return pixels
      }
      const dispatch = (type, pointerId, button, isPrimary, ratio) => {
        const rect = canvas.getBoundingClientRect()
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          pointerId,
          pointerType: 'pen',
          button,
          buttons: type === 'pointerup' ? 0 : button === 0 ? 1 : 2,
          isPrimary,
          clientX: rect.left + rect.width * ratio,
          clientY: rect.top + rect.height * ratio,
        }))
      }
      dispatch('pointerdown', 41, 2, true, 0.25)
      dispatch('pointerup', 41, 2, true, 0.25)
      const secondaryButtonState = { pixels: countMaskPixels() }
      dispatch('pointerdown', 42, 0, false, 0.25)
      dispatch('pointerup', 42, 0, false, 0.25)
      const nonPrimaryPointerState = { pixels: countMaskPixels() }
      return { secondaryButtonState, nonPrimaryPointerState }
    })()`)
    assert.equal(secondaryButtonState.pixels, 0, 'Secondary-button pointers must not paint the current inpaint mask')
    assert.equal(nonPrimaryPointerState.pixels, 0, 'Non-primary pointers must not paint the current inpaint mask')

    const dispatchMaskStroke = async (pointerId, ratio, boundaryExit = false) =>
      evaluate(`(() => {
        const canvas = document.querySelector('.mask-canvas')
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing current mask canvas')
        const rect = canvas.getBoundingClientRect()
        const init = {
          bubbles: true,
          pointerId: ${pointerId},
          pointerType: 'pen',
          button: 0,
          buttons: 1,
          isPrimary: true,
          clientX: rect.left + rect.width * ${ratio},
          clientY: rect.top + rect.height * ${ratio},
        }
        canvas.dispatchEvent(new PointerEvent('pointerdown', init))
        canvas.dispatchEvent(new PointerEvent(${boundaryExit ? "'pointerout'" : "'pointerup'"}, {
          ...init,
          buttons: 0,
          relatedTarget: ${boundaryExit ? 'document.body' : 'null'},
        }))
        return true
      })()`)
    const maskPixelCount = () =>
      evaluate(`(() => {
        const canvas = document.querySelector('.mask-canvas')
        if (!(canvas instanceof HTMLCanvasElement)) return -1
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
        if (!data) return -1
        let pixels = 0
        for (let index = 3; index < data.length; index += 4) {
          if (data[index] > 0) pixels += 1
        }
        return pixels
      })()`)

    await dispatchMaskStroke(51, 0.25)
    await waitFor(
      '!document.querySelector(\'[data-mask-action="undo"]\')?.disabled',
      'inpaint stroke undo action',
    )
    await clickSelector('[data-mask-action="undo"]')
    await waitFor(
      `(() => {
        const canvas = document.querySelector('.mask-canvas')
        const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
        return data ? !Array.from(data).some((value, index) => index % 4 === 3 && value > 0) : false
      })()`,
      'inpaint stroke undo pixels',
    )
    await waitFor(
      'document.activeElement === document.querySelector(".mask-canvas")',
      'inpaint undo focus restoration',
    )
    const afterUndoPixels = await maskPixelCount()

    await dispatchMaskStroke(52, 0.25)
    await waitFor(
      '!document.querySelector(\'[data-mask-action="clear"]\')?.disabled',
      'inpaint clear action',
    )
    const afterSecondPaintPixels = await maskPixelCount()
    await clickSelector('[data-mask-action="clear"]')
    await waitFor(
      'document.querySelector(\'[data-mask-action="clear"]\')?.disabled === true',
      'cleared inpaint mask',
    )
    await waitFor(
      'document.activeElement === document.querySelector(\'[data-mask-action="undo"]\')',
      'cleared inpaint mask focus restoration',
    )
    await clickSelector('[data-mask-action="undo"]')
    await waitFor(
      `(() => {
        const canvas = document.querySelector('.mask-canvas')
        const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
        if (!data) return false
        let pixels = 0
        for (let index = 3; index < data.length; index += 4) if (data[index] > 0) pixels += 1
        return pixels === ${afterSecondPaintPixels}
      })()`,
      'inpaint clear undo pixels',
    )
    const afterClearUndoPixels = await maskPixelCount()

    await clickSelector('[data-mask-action="clear"]')
    await waitFor(
      'document.querySelector(\'[data-mask-action="clear"]\')?.disabled === true',
      'capture recovery blank mask',
    )
    await dispatchMaskStroke(61, 0.25, true)
    const captureFailureBoundaryPixels = await maskPixelCount()
    await dispatchMaskStroke(62, 0.75)
    const captureFailureRecoveryPixels = await maskPixelCount()
    await waitFor(
      '!document.querySelector(\'[data-mask-action="undo"]\')?.disabled',
      'capture recovery undo action',
    )
    await clickSelector('[data-mask-action="undo"]')
    const captureFailureRecoveryUndoPixels = await maskPixelCount()
    const maskUndoState = {
      afterUndoPixels,
      afterSecondPaintPixels,
      afterClearUndoPixels,
      captureFailureBoundaryPixels,
      captureFailureRecoveryPixels,
      captureFailureRecoveryUndoPixels,
    }
    assert.equal(maskUndoState.afterUndoPixels, 0, 'A current inpaint stroke must be undoable')
    assert.equal(
      maskUndoState.afterClearUndoPixels,
      maskUndoState.afterSecondPaintPixels,
      'Clearing and undoing must restore the current inpaint pixels',
    )
    assert.ok(
      maskUndoState.captureFailureRecoveryPixels > maskUndoState.captureFailureBoundaryPixels,
      `A new pointer must paint after capture failure: ${JSON.stringify(maskUndoState)}`,
    )
    assert.equal(
      maskUndoState.captureFailureRecoveryUndoPixels,
      maskUndoState.captureFailureBoundaryPixels,
      'Capture failure recovery undo must restore the previous pointer boundary',
    )
    await clickText(['聊天', 'Chat'], '.zc-composer-mode')
    await waitFor('!document.querySelector(".zc-image-task-modes")', 'chat composer mode')
    assert.equal(
      await evaluate('Boolean(document.querySelector(\'[data-feature-hint="chat"]\'))'),
      false,
      'Dismissed current chat feature hint must not repeat after mode navigation',
    )

    const composerState = await setComposerValue('browser smoke missing credential')
    assert.equal(composerState.value, 'browser smoke missing credential', 'Composer input must receive browser text')
    assert.equal(composerState.sendDisabled, false, 'Composer send action must enable for non-empty input')
    await clickSelector('.zc-send-btn')
    await waitFor('Boolean(document.querySelector(".zc-settings-overlay, .zc-toast"))', 'provider error path')
    await clickSelector('.zc-settings-back').catch(() => undefined)
    await evaluate('window.__zerochatAppTest?.closeSettings?.()')
    await waitFor('!document.querySelector(".zc-settings-overlay")', 'provider error recovery')

    const audioModeBeforeSelection = await evaluate(`(() => ({
      exists: Boolean(document.querySelector('[data-zc-composer-mode="audio"]')),
      panelVisible: Boolean(document.querySelector('[data-zc-audio-composer="true"]')),
    }))()`)
    assert.deepEqual(
      audioModeBeforeSelection,
      { exists: true, panelVisible: false },
      `Current composer must expose a dedicated audio mode: ${JSON.stringify(audioModeBeforeSelection)}`,
    )
    await clickSelector('[data-zc-composer-mode="audio"]')
    await waitFor(
      'Boolean(document.querySelector(\'[data-zc-audio-composer="true"]\'))',
      'current audio composer panel',
    )
    const audioComposerState = await evaluate(`(() => {
      const panel = document.querySelector('[data-zc-audio-composer="true"]')
      const input = panel?.querySelector('input[type="file"]')
      const transcribe = panel?.querySelector('[data-zc-audio-transcribe="true"]')
      return {
        inputAccept: input?.getAttribute('accept') || '',
        transcribeDisabled:
          transcribe instanceof HTMLButtonElement ? transcribe.disabled : null,
        visible: panel instanceof HTMLElement && panel.getBoundingClientRect().height > 0,
      }
    })()`)
    assert.equal(audioComposerState.visible, true, JSON.stringify(audioComposerState))
    assert.match(audioComposerState.inputAccept, /audio\//u)
    assert.equal(
      audioComposerState.transcribeDisabled,
      true,
      `Audio transcription must stay disabled before a file is selected: ${JSON.stringify(audioComposerState)}`,
    )
    const audioFileSelectionState = await evaluate(`(() => {
      const panel = document.querySelector('[data-zc-audio-composer="true"]')
      const input = panel?.querySelector('input[type="file"]')
      if (!(input instanceof HTMLInputElement)) return { selected: false }
      const transfer = new DataTransfer()
      transfer.items.add(new File(
        [new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69])],
        'browser-smoke-audio-source-with-a-deliberately-long-filename-for-compact-layout.wav',
        { type: 'audio/wav' },
      ))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return { selected: true }
    })()`)
    assert.equal(
      audioFileSelectionState.selected,
      true,
      `Audio fixture must reach the current file input: ${JSON.stringify(audioFileSelectionState)}`,
    )
    await waitFor(
      `(() => {
        const panel = document.querySelector('[data-zc-audio-composer="true"]')
        const transcribe = panel?.querySelector('[data-zc-audio-transcribe="true"]')
        return transcribe instanceof HTMLButtonElement &&
          !transcribe.disabled &&
          (panel?.textContent || '').includes('browser-smoke-audio-source-with-a-deliberately-long-filename-for-compact-layout.wav')
      })()`,
      'selected audio source enables transcription',
    )
    const rejectedAudioSelection = await evaluate(`(() => {
      const panel = document.querySelector('[data-zc-audio-composer="true"]')
      const input = panel?.querySelector('input[type="file"]')
      if (!(input instanceof HTMLInputElement)) return false
      const transfer = new DataTransfer()
      transfer.items.add(new File(
        [new TextEncoder().encode('not audio')],
        'browser-smoke-unsupported-sentinel.txt',
        { type: 'text/plain' },
      ))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    assert.equal(rejectedAudioSelection, true, 'Unsupported audio fixture must reach the current file input')
    await waitFor(
      `(() => {
        const panel = document.querySelector('[data-zc-audio-composer="true"]')
        const transcribe = panel?.querySelector('[data-zc-audio-transcribe="true"]')
        const panelText = panel?.textContent || ''
        const toastText = document.querySelector('.zc-toast')?.textContent || ''
        return transcribe instanceof HTMLButtonElement &&
          !transcribe.disabled &&
          panelText.includes('browser-smoke-audio-source-with-a-deliberately-long-filename-for-compact-layout.wav') &&
          !panelText.includes('browser-smoke-unsupported-sentinel.txt') &&
          Boolean(toastText) &&
          !toastText.includes('browser-smoke-unsupported-sentinel.txt')
      })()`,
      'rejected audio source preserves the accepted selection',
    )
    const audioSourceRemovalStarted = await evaluate(`(() => {
      const panel = document.querySelector('[data-zc-audio-composer="true"]')
      const remove = panel?.querySelector('[data-zc-audio-remove="true"]')
      if (!(remove instanceof HTMLButtonElement)) return false
      remove.focus()
      const focused = document.activeElement === remove
      remove.click()
      return focused
    })()`)
    assert.equal(
      audioSourceRemovalStarted,
      true,
      'Current audio source removal must start from its keyboard-focusable action',
    )
    await waitFor(
      `(() => {
        const panel = document.querySelector('[data-zc-audio-composer="true"]')
        const select = panel?.querySelector('[data-zc-audio-select="true"]')
        const transcribe = panel?.querySelector('[data-zc-audio-transcribe="true"]')
        return select instanceof HTMLButtonElement && !select.disabled
          && document.activeElement === select
          && transcribe instanceof HTMLButtonElement && transcribe.disabled
          && !(panel?.textContent || '').includes('browser-smoke-audio-source-with-a-deliberately-long-filename-for-compact-layout.wav')
      })()`,
      'current audio source removal focus restoration',
    )
    await clickSelector('[data-zc-composer-mode="chat"]')
    await waitFor(
      '!document.querySelector(\'[data-zc-audio-composer="true"]\')',
      'audio composer close after returning to chat',
    )

    await mkdir(path.dirname(screenshotPath), { recursive: true })
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'))

    const syncDiagnostics = await evaluate(`(async () => {
      const bridge = window.__zerochatAppTest
      if (!bridge) throw new Error('Production streaming test bridge is missing')
      return bridge.prepareStreamingFixture(${JSON.stringify(new URL('/', testUrl).href)}, { deferAutoSync: true })
    })()`, true)
    const syncDiagnosticLine = [
      `dataPasswordLength=${syncDiagnostics?.dataPasswordLength ?? -1}`,
      `savedPassphrasePresent=${Boolean(syncDiagnostics?.savedPassphrasePresent)}`,
      `savedPassphraseLength=${syncDiagnostics?.savedPassphraseLength ?? -1}`,
    ].join('; ')
    assert.equal(syncDiagnostics?.dataPasswordLength, 0, `Sync diagnostics must remain password-minimal: ${syncDiagnosticLine}`)
    assert.equal(syncDiagnostics?.savedPassphrasePresent, true, `Sync diagnostics must record passphrase presence without its value: ${syncDiagnosticLine}`)
    assert.ok(Number.isInteger(syncDiagnostics?.savedPassphraseLength), `Sync diagnostics must record passphrase length without its value: ${syncDiagnosticLine}`)
    const streamingLoadStart = cdp.events.length
    await cdp.send('Page.navigate', { url: testUrl })
    await waitForPageLoadCompletion(streamingLoadStart)
    await waitFor('document.readyState === "complete"', 'streaming fixture page load')
    await waitFor('Boolean(document.querySelector(".zc-composer textarea"))', 'streaming fixture composer')
    await evaluate(`(() => {
      const frames = [
        'data: {"type":"response.output_text.delta","delta":"Browser "}\\n\\n',
        'data: {"type":"response.output_text.delta","delta":"stream"}\\n\\n',
        'data: [DONE]\\n\\n',
      ]
      const generation = '00000000-0000-4000-8000-000000000001'
      const originalFetch = window.fetch.bind(window)
      const syncState = {
        generation,
        head: null,
        objects: Object.create(null),
      }
      const fixture = {
        requests: [],
        syncRequests: [],
        framesPushed: 0,
        holdAfterFirstFrame: false,
        pendingFrameRelease: null,
        syncBase: null,
        releaseStream() {
          this.holdAfterFirstFrame = false
          const release = this.pendingFrameRelease
          this.pendingFrameRelease = null
          if (!release) return false
          release()
          return true
        },
        installCloudSyncFixture(syncEndpoint) {
          const parsed = new URL(syncEndpoint)
          if (!parsed.pathname.endsWith('/sync')) {
            throw new Error('Cloud sync fixture requires the current /sync endpoint')
          }
          this.syncBase = parsed
          this.syncRequests.length = 0
          syncState.head = null
          syncState.objects = Object.create(null)
          return this.cloudSyncRequestState()
        },
        async handleSyncRequest(request, requestUrl) {
          const body = request.method === 'GET' ? '' : await request.text()
          this.syncRequests.push({
            url: request.url,
            path: requestUrl.pathname,
            method: request.method,
            hasAuthorization: Boolean(request.headers.get('authorization')),
            bodyBytes: body.length,
            containsProviderKey: body.includes('browser-smoke-key'),
            containsSyncPassphrase: body.includes('browser-smoke-passphrase'),
          })
          const headers = {
            'content-type': 'application/json',
            'x-zerochat-sync-generation': syncState.generation,
          }
          if (requestUrl.pathname === '/sync/head' && request.method === 'GET') {
            return syncState.head === null
              ? new Response('', { status: 404, headers })
              : new Response(JSON.stringify(syncState.head), { status: 200, headers })
          }
          if (requestUrl.pathname === '/sync/head' && request.method === 'PUT') {
            syncState.head = JSON.parse(body)
            return new Response(null, { status: 204, headers })
          }
          if (requestUrl.pathname === '/sync/head' && request.method === 'DELETE') {
            syncState.head = null
            return new Response(null, { status: 204, headers })
          }
          if (requestUrl.pathname.startsWith('/sync/object/')) {
            const key = decodeURIComponent(requestUrl.pathname.slice('/sync/object/'.length))
            if (request.method === 'GET') {
              const objectBody = syncState.objects[key]
              return objectBody === undefined
                ? new Response(JSON.stringify({ error: 'missing fixture object' }), { status: 404, headers })
                : new Response(objectBody, { status: 200, headers })
            }
            if (request.method === 'PUT') {
              syncState.objects[key] = body
              return new Response(null, { status: 204, headers })
            }
            if (request.method === 'DELETE') {
              delete syncState.objects[key]
              return new Response(null, { status: 204, headers })
            }
          }
          if (requestUrl.pathname === '/sync/snapshot' && request.method === 'DELETE') {
            return new Response(null, { status: 204, headers })
          }
          if (requestUrl.pathname === '/snapshot' && request.method === 'GET') {
            return new Response('', { status: 404, headers })
          }
          if (requestUrl.pathname === '/snapshot' && request.method === 'DELETE') {
            return new Response(null, { status: 204, headers })
          }
          return new Response('sync fixture route not found', { status: 404, headers })
        },
        cloudSyncRequestState() {
          const syncRequests = this.syncRequests
          return {
            generation,
            syncRequests,
            count: syncRequests.length,
            headWritten: Boolean(syncState.head),
            headPutCount: syncRequests.filter(
              (request) => request.method === 'PUT' && request.path === '/sync/head',
            ).length,
            objectPutCount: syncRequests.filter(
              (request) => request.method === 'PUT' && request.path.startsWith('/sync/object/'),
            ).length,
            putCount: syncRequests.filter((request) => request.method === 'PUT').length,
          }
        },
      }
      window.__zerochatBrowserStreamFixture = fixture
      window.fetch = async (input, init = {}) => {
        const request = new Request(input, init)
        const requestUrl = new URL(request.url)
        const syncPathPrefix = fixture.syncBase
          ? fixture.syncBase.pathname.replace(/\\/$/u, '') + '/'
          : ''
        if (
          fixture.syncBase &&
          requestUrl.origin === fixture.syncBase.origin &&
          (requestUrl.pathname.startsWith(syncPathPrefix) || requestUrl.pathname === '/snapshot')
        ) {
          return fixture.handleSyncRequest(request, requestUrl)
        }
        const authorization = request.headers.get('authorization') || ''
        if (!authorization.includes('browser-smoke-key')) {
          return originalFetch(input, init)
        }
        const body = request.method === 'GET' ? '' : await request.text()
        const requestPayload = body ? JSON.parse(body) : null
        fixture.requests.push({
          url: request.url,
          method: request.method,
          hasAuthorization: Boolean(authorization),
          authorizationLength: authorization.length,
          bodyBytes: body.length,
          model: typeof requestPayload?.model === 'string' ? requestPayload.model : '',
          containsProviderKey: body.includes('browser-smoke-key'),
          containsSyncPassphrase: body.includes('browser-smoke-passphrase'),
        })
        fixture.framesPushed = 0
        let cancelled = false
        let releaseRemainingFrames = null
        const stream = new ReadableStream({
          start(controller) {
            let index = 0
            const pushRemaining = () => {
              if (cancelled) return
              while (index < frames.length) {
                controller.enqueue(new TextEncoder().encode(frames[index]))
                index += 1
                fixture.framesPushed = index
              }
              controller.close()
            }
            controller.enqueue(new TextEncoder().encode(frames[index]))
            index += 1
            fixture.framesPushed = index
            releaseRemainingFrames = pushRemaining
            if (fixture.holdAfterFirstFrame) {
              fixture.pendingFrameRelease = pushRemaining
            } else {
              pushRemaining()
            }
          },
          cancel() {
            cancelled = true
            if (fixture.pendingFrameRelease === releaseRemainingFrames) {
              fixture.pendingFrameRelease = null
            }
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      return true
    })()`)
    await evaluate(
      `window.__zerochatBrowserStreamFixture.installCloudSyncFixture(${JSON.stringify(new URL('/sync', testUrl).href)})`,
    )

    await clickSelector('.zc-chat-header .zc-icon-btn:last-of-type')
    await waitFor('Boolean(document.querySelector(".zc-settings-overlay"))', 'manual Sync focus Settings')
    await waitFor('Boolean(document.querySelector("#settings-tab-sync"))', 'manual Sync focus tab')
    await clickSelector('#settings-tab-sync')
    await waitFor(
      'Boolean(document.querySelector(\'[data-zc-sync-now="true"]\'))',
      'manual Sync focus action',
    )
    await evaluate(
      `window.__zerochatBrowserStreamFixture.installCloudSyncFixture(${JSON.stringify(new URL('/sync', testUrl).href)})`,
    )
    await evaluate(
      `(async () => {
        const bridge = window.__zerochatAppTest
        if (!bridge) throw new Error('Production streaming test bridge is missing before Cloudflare fixture activation')
        return bridge.prepareStreamingFixture(${JSON.stringify(new URL('/', testUrl).href)})
      })()`,
      true,
    )
    await waitFor(
      'document.querySelector("[data-zc-sync-now=\\"true\\"]") instanceof HTMLButtonElement && !document.querySelector("[data-zc-sync-now=\\"true\\"]").disabled',
      'manual Sync focus action ready',
    )
    const manualSyncFocusStarted = await evaluate(`(() => {
      const action = document.querySelector('[data-zc-sync-now="true"]')
      const state = {
        started: false,
        focused: false,
      }
      if (!(action instanceof HTMLButtonElement) || action.disabled) return state
      window.__zerochatManualSyncFocusTarget = action
      action.focus()
      state.focused = document.activeElement === action
      action.click()
      state.started = state.focused
      return state
    })()`)
    assert.equal(
      manualSyncFocusStarted?.started,
      true,
      `Manual Sync must start from its keyboard-focusable action: ${JSON.stringify(manualSyncFocusStarted)}`,
    )
    await waitFor(
      'window.__zerochatManualSyncFocusTarget?.disabled === true',
      'manual Sync focus pending state',
    )
    await waitFor(
      'window.__zerochatBrowserStreamFixture.cloudSyncRequestState().count > 0 && window.__zerochatManualSyncFocusTarget?.disabled === false',
      'manual Sync focus completion',
      20_000,
    )
    await waitFor(
      'document.activeElement === window.__zerochatManualSyncFocusTarget',
      'manual Sync focus restoration',
    )
    await evaluate(`(() => {
      const trace = []
      const describe = (element) => element instanceof HTMLElement
        ? {
            connected: element.isConnected,
            disabled: element instanceof HTMLButtonElement ? element.disabled : null,
            className: element.className,
            text: element.textContent?.trim().slice(0, 80),
          }
        : null
      const snapshot = () => {
        const target = window.__zerochatClearRemoteSyncFocusTarget
        const current = document.querySelector('.zc-sync-settings button.danger')
        const active = document.activeElement
        const syncSurface = document.querySelector('[data-zc-sync-settings="true"]')
        return {
          active: describe(active),
          target: describe(target),
          targetIsCurrent: target instanceof HTMLElement && target === current,
          current: describe(current),
          ariaBusy: syncSurface?.getAttribute('aria-busy') ?? null,
          clearRequests: window.__zerochatBrowserStreamFixture?.syncRequests
            ?.filter((request) => request.method === 'DELETE')
            .map((request) => request.method + ' ' + request.path) ?? [],
        }
      }
      const record = (kind, detail = '') => {
        trace.push({ kind, detail, at: performance.now(), ...snapshot() })
        if (trace.length > 80) trace.shift()
      }
      const focusIn = (event) => record('focusin', event.target?.className ?? '')
      const focusOut = (event) => record('focusout', event.target?.className ?? '')
      const surface = document.querySelector('[data-zc-sync-settings="true"]')
      const observer = surface instanceof HTMLElement
        ? new MutationObserver((records) => {
            if (records.some((mutation) => mutation.type === 'childList' || mutation.attributeName === 'disabled' || mutation.attributeName === 'aria-busy')) {
              record('mutation', records.map((mutation) => mutation.type + ':' + (mutation.attributeName ?? '')).join(','))
            }
          })
        : null
      document.addEventListener('focusin', focusIn, true)
      document.addEventListener('focusout', focusOut, true)
      observer?.observe(surface, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-busy'] })
      window.__zerochatClearRemoteSyncFocusTrace = {
        snapshot,
        trace,
        dispose: () => {
          observer?.disconnect()
          document.removeEventListener('focusin', focusIn, true)
          document.removeEventListener('focusout', focusOut, true)
        },
      }
      record('armed')
      return true
    })()`)
    const clearRemoteSyncFocusStarted = await evaluate(`(() => {
      const action = document.querySelector('.zc-sync-settings button.danger')
      if (!(action instanceof HTMLButtonElement) || action.disabled) return false
      const originalConfirm = window.confirm
      try {
        window.confirm = () => true
        window.__zerochatClearRemoteSyncFocusTarget = action
        action.focus()
        const focused = document.activeElement === action
        action.click()
        return focused
      } finally {
        window.confirm = originalConfirm
      }
    })()`)
    assert.equal(
      clearRemoteSyncFocusStarted,
      true,
      'Clear remote Sync must start from its keyboard-focusable action',
    )
    await waitFor(
      'window.__zerochatBrowserStreamFixture.syncRequests.some((request) => request.method === "DELETE") && window.__zerochatClearRemoteSyncFocusTarget?.disabled === false',
      'clear remote Sync completion',
      20_000,
    )
    const clearRemoteFocusState = () => evaluate(`(() => {
      const target = window.__zerochatClearRemoteSyncFocusTarget
      const active = document.activeElement
      const syncSurface = document.querySelector('[data-zc-sync-settings="true"]')
      return {
        active: active instanceof HTMLElement
          ? { tag: active.tagName, className: active.className, text: active.textContent?.trim().slice(0, 80) }
          : null,
        target: target instanceof HTMLElement
          ? { connected: target.isConnected, disabled: target.disabled, className: target.className, text: target.textContent?.trim().slice(0, 80) }
          : null,
        same: active === target,
        ariaBusy: syncSurface?.getAttribute('aria-busy'),
        clearRequests: window.__zerochatBrowserStreamFixture.syncRequests.filter((request) => request.method === 'DELETE').length,
        clearRequestPaths: window.__zerochatBrowserStreamFixture.syncRequests
          .filter((request) => request.method === 'DELETE')
          .map((request) => request.method + ' ' + request.path),
        targetIsCurrent: target === document.querySelector('.zc-sync-settings button.danger'),
        trace: window.__zerochatClearRemoteSyncFocusTrace?.trace.slice(-40) ?? [],
      }
    })()`)
    const clearFocusStartedAt = Date.now()
    let clearFocusRestored = false
    while (Date.now() - clearFocusStartedAt < 12_000) {
      const state = await clearRemoteFocusState()
      if (state.same) {
        clearFocusRestored = true
        break
      }
      await sleep(50)
    }
    if (!clearFocusRestored) {
      throw new Error(
        `Timed out waiting for clear remote Sync focus restoration: ${JSON.stringify(await clearRemoteFocusState())}`,
      )
    }
    await evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      true,
    )
    const clearFocusStableState = await clearRemoteFocusState()
    assert.equal(
      clearFocusStableState.same,
      true,
      `Clear remote Sync focus must remain restored after two stable frames: ${JSON.stringify(clearFocusStableState)}`,
    )
    await evaluate('window.__zerochatClearRemoteSyncFocusTrace?.dispose()')

    await evaluate(
      `window.__zerochatBrowserStreamFixture.installCloudSyncFixture(${JSON.stringify(new URL('/sync', testUrl).href)})`,
    )
    await evaluate('window.__zerochatAppTest?.setSyncConflictFixture(true)')
    await waitFor(
      'Boolean(document.querySelector(".zc-sync-conflict"))',
      'sync conflict resolution fixture',
    )
    const conflictResolutionStarted = await evaluate(`(() => {
      const action = document.querySelector('.zc-sync-conflict .zc-btn')
      if (!(action instanceof HTMLButtonElement) || action.disabled) return false
      action.focus()
      const focused = document.activeElement === action
      action.click()
      action.click()
      return focused
    })()`)
    assert.equal(
      conflictResolutionStarted,
      true,
      'Sync conflict resolution must start from its keyboard-focusable action',
    )
    await waitFor(
      '!document.querySelector(".zc-sync-conflict") && document.querySelector("[data-zc-sync-now=\\"true\\"]")?.disabled === false',
      'sync conflict resolution completion',
      20_000,
    )
    await waitFor(
      'document.activeElement === document.querySelector("[data-zc-sync-now=\\"true\\"]")',
      'sync conflict resolution focus restoration',
    )
    await evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      true,
    )
    const conflictResolutionState = await evaluate(`(() => {
      const fixture = window.__zerochatBrowserStreamFixture
      const target = document.querySelector('[data-zc-sync-now="true"]')
      const syncState = fixture?.cloudSyncRequestState?.() || {
        headPutCount: 0,
        objectPutCount: 0,
        syncRequests: [],
      }
      return {
        headPutCount: syncState.headPutCount,
        objectPutCount: syncState.objectPutCount,
        activeIsSyncNow: document.activeElement === target,
        activeTag: document.activeElement?.tagName || '',
      }
    })()`)
    assert.equal(
      conflictResolutionState.headPutCount,
      1,
      `One sync conflict choice must publish exactly once: ${JSON.stringify(conflictResolutionState)}`,
    )
    assert.ok(
      conflictResolutionState.objectPutCount > 0,
      `Sync conflict resolution must publish encrypted objects: ${JSON.stringify(conflictResolutionState)}`,
    )
    assert.equal(
      conflictResolutionState.activeIsSyncNow,
      true,
      `Sync conflict resolution must leave focus on the stable Sync action: ${JSON.stringify(conflictResolutionState)}`,
    )

    await evaluate(
      `window.__zerochatBrowserStreamFixture.installCloudSyncFixture(${JSON.stringify(new URL('/sync', testUrl).href)})`,
    )
    await evaluate('window.__zerochatAppTest?.setSyncConflictFixture(true)')
    await waitFor(
      'Boolean(document.querySelector(".zc-sync-conflict"))',
      'second sync conflict resolution fixture',
    )
    const conflictUserFocusState = await evaluate(`(() => {
      const action = document.querySelector('.zc-sync-conflict .zc-btn')
      const generalTab = document.querySelector('#settings-tab-general')
      if (!(action instanceof HTMLButtonElement) || action.disabled) return null
      if (!(generalTab instanceof HTMLButtonElement) || generalTab.disabled) return null
      action.focus()
      const startedWithFocus = document.activeElement === action
      action.click()
      action.click()
      generalTab.focus()
      return {
        startedWithFocus,
        movedByUser: document.activeElement === generalTab,
      }
    })()`)
    assert.deepEqual(
      conflictUserFocusState,
      { startedWithFocus: true, movedByUser: true },
      `A user focus move during the second Sync action must be observable: ${JSON.stringify(conflictUserFocusState)}`,
    )
    await waitFor(
      '!document.querySelector(".zc-sync-conflict") && document.querySelector("[data-zc-sync-now=\\"true\\"]")?.disabled === false',
      'second sync conflict resolution completion',
      20_000,
    )
    await evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      true,
    )
    const conflictUserFocusResult = await evaluate(`(() => {
      const fixture = window.__zerochatBrowserStreamFixture
      const generalTab = document.querySelector('#settings-tab-general')
      const target = document.querySelector('[data-zc-sync-now="true"]')
      const syncState = fixture?.cloudSyncRequestState?.() || {
        headPutCount: 0,
        objectPutCount: 0,
      }
      return {
        headPutCount: syncState.headPutCount,
        objectPutCount: syncState.objectPutCount,
        activeIsGeneral: document.activeElement === generalTab,
        activeIsSyncNow: document.activeElement === target,
      }
    })()`)
    assert.equal(
      conflictUserFocusResult.headPutCount,
      1,
      `A second Sync conflict choice must publish exactly once: ${JSON.stringify(conflictUserFocusResult)}`,
    )
    assert.ok(
      conflictUserFocusResult.objectPutCount > 0,
      `A second Sync conflict choice must publish encrypted objects: ${JSON.stringify(conflictUserFocusResult)}`,
    )
    assert.equal(
      conflictUserFocusResult.activeIsGeneral,
      true,
      `A user focus move during Sync conflict resolution must not be stolen back: ${JSON.stringify(conflictUserFocusResult)}`,
    )
    assert.equal(
      conflictUserFocusResult.activeIsSyncNow,
      false,
      `A user focus move during Sync conflict resolution must not focus Sync now: ${JSON.stringify(conflictUserFocusResult)}`,
    )
    await clickSelector('.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings-overlay")', 'manual Sync focus Settings close')
    await evaluate(
      `window.__zerochatBrowserStreamFixture.installCloudSyncFixture(${JSON.stringify(new URL('/sync', testUrl).href)})`,
    )

    await setComposerValue('browser smoke keyboard shortcut')
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    const plainEnterState = await evaluate(`(() => {
      const fixture = window.__zerochatBrowserStreamFixture || { requests: [] }
      const textarea = document.querySelector('.zc-composer textarea')
      return {
        value: textarea?.value || '',
        providerRequests: fixture.requests.length,
      }
    })()`)
    assert.equal(
      plainEnterState.providerRequests,
      0,
      `Plain Enter must not submit the composer: ${JSON.stringify(plainEnterState)}`,
    )
    assert.equal(
      plainEnterState.value,
      'browser smoke keyboard shortcut',
      `Plain Enter must preserve the composer draft: ${JSON.stringify(plainEnterState)}`,
    )

    await setComposerValue('browser smoke keyboard shortcut')
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      modifiers: 2,
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      modifiers: 2,
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    await waitFor(
      'window.__zerochatBrowserStreamFixture.requests.length === 1',
      'keyboard shortcut provider request',
    )
    await waitFor(
      'document.querySelector(".zc-composer textarea")?.disabled === false',
      'keyboard shortcut composer idle state',
    )
    const keyboardShortcutState = await evaluate(`(() => {
      const fixture = window.__zerochatBrowserStreamFixture || { requests: [] }
      return {
        assistantText: [...document.querySelectorAll('.zc-msg.assistant .zc-bubble')]
          .map((node) => node.textContent || '').join(' '),
        providerRequests: fixture.requests.length,
        requestMethod: fixture.requests[0]?.method || '',
        requestModel: fixture.requests[0]?.model || '',
      }
    })()`)
    assert.equal(
      keyboardShortcutState.providerRequests,
      1,
      `Keyboard shortcut must submit exactly once: ${JSON.stringify(keyboardShortcutState)}`,
    )
    assert.equal(
      keyboardShortcutState.requestMethod,
      'POST',
      `Keyboard shortcut must use the Provider POST path: ${JSON.stringify(keyboardShortcutState)}`,
    )
    assert.equal(
      keyboardShortcutState.requestModel,
      'gpt-5.5',
      `Keyboard shortcut must exercise the current default chat model: ${JSON.stringify(keyboardShortcutState)}`,
    )
    assert.match(
      keyboardShortcutState.assistantText,
      /Browser stream/u,
      `Keyboard shortcut smoke must render the assistant response: ${JSON.stringify(keyboardShortcutState)}`,
    )
    await waitForCloudSyncQuiet('Keyboard shortcut terminal')
    await evaluate(`(() => {
      const fixture = window.__zerochatBrowserStreamFixture
      fixture.requests.length = 0
      fixture.syncRequests.length = 0
      fixture.holdAfterFirstFrame = true
      return true
    })()`)

    await setComposerValue('browser smoke streaming request')
    await clickSelector('.zc-send-btn')
    await waitFor(
      `window.__zerochatBrowserStreamFixture.requests.length === 1 && [...document.querySelectorAll('.zc-msg.assistant.streaming .zc-bubble')].some((node) => node.textContent?.includes('Browser'))`,
      'first token from the current streamed assistant request',
    )
    const streamingPartialState = await evaluate(`(() => {
      const fixture = window.__zerochatBrowserStreamFixture
      const syncState = fixture?.cloudSyncRequestState?.() || {
        syncRequests: [],
        putCount: 0,
        headPutCount: 0,
        objectPutCount: 0,
      }
      return {
        syncState,
        framesPushed: fixture?.framesPushed || 0,
        assistantText: [...document.querySelectorAll('.zc-msg.assistant .zc-bubble')]
          .map((node) => node.textContent || '')
          .join(' '),
        streamingRows: document.querySelectorAll('.zc-msg.assistant.streaming').length,
        composerDisabled: Boolean(document.querySelector('.zc-composer textarea')?.disabled),
        modeButtonsDisabled: [...document.querySelectorAll('[data-zc-composer-mode]')]
          .every((button) => button instanceof HTMLButtonElement && button.disabled),
      }
    })()`)
    assert.equal(
      streamingPartialState.syncState.putCount,
      0,
      `Auto-sync must not publish while the assistant stream is partial: ${JSON.stringify(streamingPartialState)}`,
    )
    assert.equal(
      streamingPartialState.syncState.headPutCount,
      0,
      `Auto-sync must not publish a head while the assistant stream is partial: ${JSON.stringify(streamingPartialState)}`,
    )
    assert.equal(
      streamingPartialState.syncState.objectPutCount,
      0,
      `Auto-sync must not upload objects while the assistant stream is partial: ${JSON.stringify(streamingPartialState)}`,
    )
    assert.equal(streamingPartialState.framesPushed, 1, `The partial UI must render before the remaining SSE frames: ${JSON.stringify(streamingPartialState)}`)
    assert.match(streamingPartialState.assistantText, /Browser/u, `Assistant text must be observable outside the send action while SSE remains open: ${JSON.stringify(streamingPartialState)}`)
    assert.equal(streamingPartialState.streamingRows, 1, `The partial assistant row must remain in streaming state before DONE: ${JSON.stringify(streamingPartialState)}`)
    assert.equal(
      streamingPartialState.composerDisabled,
      true,
      `The current composer must remain locked while streaming is partial: ${JSON.stringify(streamingPartialState)}`,
    )
    assert.equal(
      streamingPartialState.modeButtonsDisabled,
      true,
      `Composer mode controls must expose disabled semantics while streaming is partial: ${JSON.stringify(streamingPartialState)}`,
    )
    const lockedComposerModeTooltipState = await evaluate(`(() => {
      const action = document.querySelector('[data-zc-composer-mode="image"]')
      const target = action?.closest('.composer-mode-tooltip-target')
      if (!(action instanceof HTMLButtonElement) || !(target instanceof HTMLElement)) return null
      const rect = action.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      hit?.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
      }))
      return {
        disabled: action.disabled,
        wrapperOwnsHit: hit === target,
        tooltip: target.getAttribute('data-tooltip') || '',
        nativeTitle: action.getAttribute('title'),
      }
    })()`)
    assert.deepEqual(
      lockedComposerModeTooltipState && {
        disabled: lockedComposerModeTooltipState.disabled,
        wrapperOwnsHit: lockedComposerModeTooltipState.wrapperOwnsHit,
        hasTooltip: Boolean(lockedComposerModeTooltipState.tooltip),
        nativeTitle: lockedComposerModeTooltipState.nativeTitle,
      },
      { disabled: true, wrapperOwnsHit: true, hasTooltip: true, nativeTitle: null },
      `Locked current composer mode must expose the busy reason through a real tooltip wrapper: ${JSON.stringify(lockedComposerModeTooltipState)}`,
    )
    await waitFor(
      `document.querySelector('[role="tooltip"]')?.textContent === ${JSON.stringify(lockedComposerModeTooltipState?.tooltip)}`,
      'locked current composer mode tooltip',
    )
    assert.equal(
      await evaluate('window.__zerochatBrowserStreamFixture?.releaseStream() === true'),
      true,
      'Delayed SSE fixture must release the remaining frames after partial-state assertions',
    )
    await waitFor(
      'document.querySelector(".zc-composer textarea")?.disabled === false',
      'streaming composer idle state',
    )
    const streamingState = await evaluate(`(() => {
      const assistantText = [...document.querySelectorAll('.zc-msg.assistant .zc-bubble')]
        .map((node) => node.textContent || '')
        .join(' ')
      const fixture = window.__zerochatBrowserStreamFixture || { requests: [] }
      return {
        assistantText,
        requests: fixture.requests,
        syncRequests: fixture.syncRequests,
        composerDisabled: Boolean(document.querySelector('.zc-composer textarea')?.disabled),
        modeButtonsEnabled: [...document.querySelectorAll('[data-zc-composer-mode]')]
          .every((button) => button instanceof HTMLButtonElement && !button.disabled),
        streamingRows: document.querySelectorAll('.zc-msg.assistant.streaming').length,
        streamingCursorCount: document.querySelectorAll('.zc-msg.assistant .zc-cursor').length,
        rawKeyInDom: document.body.innerText.includes('browser-smoke-key'),
        rawPassphraseInDom: document.body.innerText.includes('browser-smoke-passphrase'),
      }
    })()`)
    assert.equal(streamingState.requests.length, 1, `Streaming fixture must issue one provider request: ${JSON.stringify(streamingState)}`)
    assert.equal(streamingState.requests[0].method, 'POST', `Streaming fixture must use POST: ${JSON.stringify(streamingState)}`)
    assert.equal(streamingState.requests[0].hasAuthorization, true, `Streaming fixture must attach a provider key without exposing it: ${JSON.stringify(streamingState)}`)
    assert.equal(
      streamingState.requests.some((request) => request.containsProviderKey || request.containsSyncPassphrase),
      false,
      `Provider requests must not put credential sentinels in the request body: ${JSON.stringify(streamingState)}`,
    )
    assert.equal(streamingState.rawKeyInDom, false, 'Provider key sentinel must never enter the user DOM')
    assert.equal(streamingState.rawPassphraseInDom, false, 'Sync passphrase sentinel must never enter the user DOM')
    assert.equal(streamingState.composerDisabled, false, `Streaming fixture must return the composer to idle: ${JSON.stringify(streamingState)}`)
    assert.equal(streamingState.modeButtonsEnabled, true, `Composer mode controls must return to enabled after streaming: ${JSON.stringify(streamingState)}`)
    assert.equal(streamingState.streamingRows, 0, `Streaming assistant rows must be terminal after the response: ${JSON.stringify(streamingState)}`)
    assert.equal(streamingState.streamingCursorCount, 0, `Streaming cursor must be released after the response: ${JSON.stringify(streamingState)}`)
    const streamingSyncState = await waitForCloudSyncQuiet('Terminal streaming turn')
    assert.equal(
      streamingSyncState.headPutCount,
      1,
      `Cloudflare auto-sync must publish exactly one terminal head after the terminal assistant turn: ${JSON.stringify(streamingSyncState)}`,
    )
    assert.ok(
      streamingSyncState.objectPutCount > 0,
      `Cloudflare auto-sync must upload encrypted terminal objects after the terminal assistant turn: ${JSON.stringify(streamingSyncState)}`,
    )
    assert.equal(
      streamingSyncState.syncRequests.some((request) => request.containsProviderKey || request.containsSyncPassphrase),
      false,
      `Cloudflare sync requests must not put credential sentinels in the request body: ${JSON.stringify(streamingSyncState)}`,
    )
    assert.match(streamingState.assistantText, /Browser stream/u)

    await evaluate(`(() => {
      const fixture = window.__zerochatBrowserStreamFixture
      if (!fixture) throw new Error('Streaming fixture state is missing for offline queue smoke')
      fixture.requests.length = 0
      fixture.syncRequests.length = 0
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      })
      window.dispatchEvent(new Event('offline'))
      return true
    })()`)
    await setComposerValue('browser smoke offline queue')
    await clickSelector('.zc-send-btn')
    await waitFor(
      'document.querySelectorAll(\'.zc-msg.assistant.queued\').length === 1',
      'offline queued assistant message',
    )
    const offlineQueuedState = await evaluate(`(() => {
      const fixture = window.__zerochatBrowserStreamFixture || { requests: [], syncRequests: [] }
      return {
        queuedMessages: document.querySelectorAll('.zc-msg.assistant.queued').length,
        userMessages: [...document.querySelectorAll('.zc-msg.user .zc-bubble')]
          .filter((node) => node.textContent?.includes('browser smoke offline queue')).length,
        providerRequests: fixture.requests.length,
        syncRequests: fixture.syncRequests.length,
        draft: document.querySelector('.zc-composer textarea')?.value || '',
      }
    })()`)
    assert.equal(
      offlineQueuedState.queuedMessages,
      1,
      `Offline send must render one queued assistant turn: ${JSON.stringify(offlineQueuedState)}`,
    )
    assert.equal(
      offlineQueuedState.userMessages,
      1,
      `Offline send must persist the submitted user turn: ${JSON.stringify(offlineQueuedState)}`,
    )
    assert.equal(
      offlineQueuedState.providerRequests,
      0,
      `Offline send must not call the Provider: ${JSON.stringify(offlineQueuedState)}`,
    )
    assert.equal(
      offlineQueuedState.syncRequests,
      0,
      `Offline send must not publish a partial sync turn: ${JSON.stringify(offlineQueuedState)}`,
    )
    assert.equal(
      offlineQueuedState.draft,
      '',
      `Offline send must clear the submitted composer draft: ${JSON.stringify(offlineQueuedState)}`,
    )

    await evaluate(`(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => true,
      })
      window.dispatchEvent(new Event('online'))
      return true
    })()`)
    await waitFor(
      'document.querySelectorAll(\'.zc-msg.assistant.queued\').length === 0 && document.querySelector(\'.zc-composer textarea\')?.disabled === false',
      'offline queue replay completion',
      20_000,
    )
    const offlineReplayState = await evaluate(`(() => {
      const fixture = window.__zerochatBrowserStreamFixture || { requests: [], syncRequests: [] }
      return {
        queuedMessages: document.querySelectorAll('.zc-msg.assistant.queued').length,
        assistantText: [...document.querySelectorAll('.zc-msg.assistant .zc-bubble')]
          .map((node) => node.textContent || '').join(' '),
        providerRequests: fixture.requests.length,
        syncRequests: fixture.syncRequests.length,
        composerDisabled: Boolean(document.querySelector('.zc-composer textarea')?.disabled),
      }
    })()`)
    assert.equal(
      offlineReplayState.queuedMessages,
      0,
      `Online replay must clear the queued assistant state: ${JSON.stringify(offlineReplayState)}`,
    )
    assert.equal(
      offlineReplayState.providerRequests,
      1,
      `Online replay must issue exactly one Provider request: ${JSON.stringify(offlineReplayState)}`,
    )
    assert.match(offlineReplayState.assistantText, /Browser stream/u)
    assert.equal(
      offlineReplayState.composerDisabled,
      false,
      `Online replay must return the composer to idle: ${JSON.stringify(offlineReplayState)}`,
    )
    const offlineReplaySyncState = await waitForCloudSyncQuiet('Online replay')
    assert.equal(
      offlineReplaySyncState.headPutCount,
      1,
      `Cloudflare auto-sync must publish exactly one terminal head during online replay: ${JSON.stringify(offlineReplaySyncState)}`,
    )
    assert.ok(
      offlineReplaySyncState.objectPutCount > 0,
      `Cloudflare auto-sync must upload encrypted terminal objects during online replay: ${JSON.stringify(offlineReplaySyncState)}`,
    )
    assert.equal(
      offlineReplaySyncState.syncRequests.some((request) => request.containsProviderKey || request.containsSyncPassphrase),
      false,
      `Cloudflare replay requests must not put credential sentinels in the request body: ${JSON.stringify(offlineReplaySyncState)}`,
    )
    const newConversationShortcutBaseline = await evaluate(`(() => ({
      conversations: document.querySelectorAll('.zc-conv-item[role="button"]').length,
      activeTitle: document.querySelector('.zc-conv-item[aria-current="page"] .zc-conv-title')?.textContent?.trim() || '',
    }))()`)
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'n',
      code: 'KeyN',
      modifiers: 2,
      windowsVirtualKeyCode: 78,
      nativeVirtualKeyCode: 78,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'n',
      code: 'KeyN',
      modifiers: 2,
      windowsVirtualKeyCode: 78,
      nativeVirtualKeyCode: 78,
    })
    await waitFor(
      `document.querySelectorAll('.zc-conv-item[role="button"]').length === ${newConversationShortcutBaseline.conversations + 1}`,
      'Ctrl+N creates exactly one current conversation',
    )
    await waitFor(
      `document.querySelector('.zc-conv-item[aria-current="page"] .zc-conv-title')?.textContent?.trim() !== ${JSON.stringify(newConversationShortcutBaseline.activeTitle)}`,
      'Ctrl+N activates the new conversation',
    )
    await waitFor(
      "document.querySelector('.zc-composer textarea')?.value === '' && document.querySelector('.zc-composer textarea')?.disabled === false",
      'Ctrl+N renders a ready-to-type conversation',
    )
    await waitFor(
      "document.activeElement === document.querySelector('.zc-composer textarea')",
      'Ctrl+N Composer focus restoration',
    )
    const newConversationFocusState = await evaluate(`(() => {
      const textarea = document.querySelector('.zc-composer textarea')
      return {
        activeClass: document.activeElement?.className || '',
        activeTag: document.activeElement?.tagName || '',
        focused: document.activeElement === textarea,
        textareaConnected: Boolean(textarea?.isConnected),
        textareaDisabled: textarea instanceof HTMLTextAreaElement ? textarea.disabled : null,
      }
    })()`)
    assert.equal(
      newConversationFocusState.focused,
      true,
      `Ctrl+N must focus the ready-to-type conversation: ${JSON.stringify(newConversationFocusState)}`,
    )
    if (
      await evaluate(
        "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') === true",
      )
    ) {
      await clickSelector('.zc-chat-header > button.zc-icon-btn')
      await waitFor(
        "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') === false && document.querySelector('.zc-sidebar')?.getAttribute('aria-hidden') !== 'true'",
        'Sidebar new-conversation visible surface',
      )
    }
    const sidebarNewConversationBaseline = await evaluate(
      "document.querySelectorAll('.zc-conv-item[role=\"button\"]').length",
    )
    await clickSelector('.zc-new-chat')
    await waitFor(
      `document.querySelectorAll('.zc-conv-item[role="button"]').length === ${sidebarNewConversationBaseline + 1}`,
      'Sidebar button creates exactly one current conversation',
    )
    await waitFor(
      "document.querySelector('.zc-composer textarea')?.value === '' && document.querySelector('.zc-composer textarea')?.disabled === false",
      'Sidebar button renders a ready-to-type conversation',
    )
    await waitFor(
      "document.activeElement === document.querySelector('.zc-composer textarea')",
      'Sidebar button Composer focus restoration',
    )
    assert.equal(
      await evaluate("document.activeElement === document.querySelector('.zc-composer textarea')"),
      true,
      'Sidebar new-conversation action must focus the ready-to-type Composer',
    )

    await evaluate(`(async () => {
      const bridge = window.__zerochatAppTest
      if (!bridge) throw new Error('Production test bridge is missing')
      await bridge.seedPerformanceConversation()
      return true
    })()`, true)
    const performanceLoadStart = cdp.events.length
    await cdp.send('Page.navigate', { url: testUrl })
    await waitForPageLoadCompletion(performanceLoadStart)
    await waitFor('document.readyState === "complete"', 'performance page load')
    await waitFor('Boolean(document.querySelector(".zc-chat-title"))', 'performance active conversation')
    const originalConversationTitle = await evaluate(
      "document.querySelector('.zc-chat-title')?.textContent?.trim() || ''",
    )
    await clickSelector('.zc-chat-title')
    await waitFor(
      'document.querySelector(".zc-chat-title-edit input") === document.activeElement',
      'conversation title editor focus',
    )
    await evaluate(`(() => {
      const input = document.querySelector('.zc-chat-title-edit input')
      if (!(input instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) return false
      setter.call(input, 'Browser smoke canceled title')
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      return true
    })()`, true)
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await waitFor(
      `document.querySelector('.zc-chat-title')?.textContent?.trim() === ${JSON.stringify(originalConversationTitle)}`,
      'conversation title Escape cancellation',
    )
    await waitFor(
      "document.querySelector('.zc-chat-title') === document.activeElement",
      'conversation title Escape focus restoration',
    )
    assert.equal(
      await evaluate("document.querySelector('.zc-chat-title') === document.activeElement"),
      true,
      'Conversation title Escape cancellation must restore focus to its trigger',
    )
    const renamedConversationTitle = 'Browser smoke renamed conversation'
    await clickSelector('.zc-chat-title')
    await waitFor(
      'Boolean(document.querySelector(".zc-chat-title-edit input"))',
      'conversation title editor reopen',
    )
    await waitFor(
      'document.querySelector(".zc-chat-title-edit input") === document.activeElement',
      'conversation title editor autofocus after reopen',
    )
    await evaluate(`(() => {
      const input = document.querySelector('.zc-chat-title-edit input')
      if (!(input instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) return false
      setter.call(input, ${JSON.stringify('Browser smoke renamed conversation')})
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      return true
    })()`, true)
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    await waitFor(
      `document.querySelector('.zc-chat-title')?.textContent?.trim() === ${JSON.stringify('Browser smoke renamed conversation')}`,
      'conversation title rename header persistence',
    )
    await waitFor(
      `document.querySelector('.zc-conv-item[aria-current="page"] .zc-conv-title')?.textContent?.trim() === ${JSON.stringify('Browser smoke renamed conversation')}`,
      'conversation title rename Sidebar persistence',
    )
    assert.equal(
      await evaluate("document.querySelector('.zc-chat-title')?.textContent?.trim()"),
      renamedConversationTitle,
      'Conversation title rename must persist into the current header',
    )
    const sidebarRenamedConversationTitle = 'Browser smoke Sidebar rename'
    if (
      await evaluate(
        "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') === true",
      )
    ) {
      await clickSelector('.zc-chat-header > button.zc-icon-btn')
      await waitFor(
        "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') === false && document.querySelector('.zc-sidebar')?.getAttribute('aria-hidden') !== 'true'",
        'Sidebar conversation rename visible surface',
      )
    }
    await waitFor(
      "document.querySelector('.zc-conv-item[aria-current=\"page\"] .zc-conv-actions button:first-child')?.disabled === false",
      'Sidebar conversation rename action release',
    )
    const sidebarRenameSelector =
      '.zc-conv-item[aria-current="page"] .zc-conv-actions button:first-child'
    const sidebarRenameSetup = await evaluate(`(() => {
      const item = document.querySelector('.zc-conv-item[aria-current="page"]')
      const button = document.querySelector(${JSON.stringify('.zc-conv-item[aria-current="page"] .zc-conv-actions button:first-child')})
      if (!(item instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) return false
      item.focus()
      const rect = button.getBoundingClientRect()
      return document.activeElement === item && !button.disabled && rect.width > 0 && rect.height > 0
    })()`)
    assert.equal(
      sidebarRenameSetup,
      true,
      'Active Sidebar conversation must expose its rename action',
    )
    await clickSelector(sidebarRenameSelector)
    await waitFor(
      'Boolean(document.querySelector(".zc-conversation-list .zc-conv-item input"))',
      'Sidebar conversation title editor open',
    )
    await waitFor(
      'document.querySelector(".zc-conversation-list .zc-conv-item input") === document.activeElement',
      'Sidebar conversation title editor focus',
    )
    assert.equal(
      await evaluate(
        'document.querySelector(".zc-conversation-list .zc-conv-item input") === document.activeElement',
      ),
      true,
      'Opening the Sidebar conversation title editor must focus its input',
    )
    await evaluate(`(() => {
      const input = document.querySelector('.zc-conversation-list .zc-conv-item input')
      if (!(input instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) return false
      setter.call(input, ${JSON.stringify('Browser smoke Sidebar rename')})
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      return true
    })()`, true)
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    })
    await waitFor(
      `document.querySelector('.zc-chat-title')?.textContent?.trim() === ${JSON.stringify('Browser smoke Sidebar rename')}`,
      'Sidebar conversation title rename persistence',
    )
    await waitFor(
      "document.querySelector('.zc-conv-item[aria-current=\"page\"] .zc-conv-actions button:first-child') === document.activeElement",
      'Sidebar conversation title rename focus restoration',
    )
    assert.equal(
      await evaluate("document.querySelector('.zc-conv-item[aria-current=\"page\"] .zc-conv-actions button:first-child') === document.activeElement"),
      true,
      `Successful Sidebar title rename must restore focus to its trigger: ${JSON.stringify(sidebarRenamedConversationTitle)}`,
    )
    const sidebarConversationDeleteSetup = await evaluate(`(() => {
      const activeItem = document.querySelector('.zc-conv-item[aria-current="page"]')
      if (!(activeItem instanceof HTMLElement)) return null
      window.__zerochatConversationDeleteFocusTarget = activeItem
      return { count: document.querySelectorAll('.zc-conv-item').length }
    })()`)
    assert.ok(
      sidebarConversationDeleteSetup?.count > 0,
      `Sidebar conversation delete focus smoke requires an active current row: ${JSON.stringify(sidebarConversationDeleteSetup)}`,
    )
    await clickSelector('.zc-new-chat')
    await waitFor(
      `document.querySelectorAll('.zc-conv-item').length === ${sidebarConversationDeleteSetup.count + 1}`,
      'temporary Sidebar conversation durable create',
    )
    await waitFor(
      'document.querySelector(\'.zc-conv-item[aria-current="page"]\') !== window.__zerochatConversationDeleteFocusTarget',
      'temporary Sidebar conversation activation',
    )
    if (
      await evaluate(
        "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') === true",
      )
    ) {
      await clickSelector('.zc-chat-header > button.zc-icon-btn')
      await waitFor(
        "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') === false && document.querySelector('.zc-sidebar')?.getAttribute('aria-hidden') !== 'true'",
        'Sidebar conversation delete visible surface',
      )
    }
    await waitFor(
      'document.querySelector(\'.zc-conv-item[aria-current="page"] .zc-conv-actions button:last-child\')?.disabled === false',
      'Sidebar conversation delete action release',
    )
    const sidebarConversationDeleteStarted = await evaluate(`(() => {
      const activeItem = document.querySelector('.zc-conv-item[aria-current="page"]')
      const deleteButton = activeItem?.querySelector('.zc-conv-actions button:last-child')
      if (!(activeItem instanceof HTMLElement) || !(deleteButton instanceof HTMLButtonElement)) {
        return false
      }
      activeItem.focus()
      const originalConfirm = window.confirm
      try {
        window.confirm = () => true
        deleteButton.focus()
        const focused = document.activeElement === deleteButton
        deleteButton.click()
        return focused
      } finally {
        window.confirm = originalConfirm
      }
    })()`)
    assert.equal(
      sidebarConversationDeleteStarted,
      true,
      'Current Sidebar conversation must start its confirmed durable delete from the delete action',
    )
    await waitFor(
      `document.querySelectorAll('.zc-conv-item').length === ${sidebarConversationDeleteSetup.count}`,
      'temporary Sidebar conversation durable delete',
    )
    await waitFor(
      'document.activeElement === window.__zerochatConversationDeleteFocusTarget && window.__zerochatConversationDeleteFocusTarget?.getAttribute("aria-current") === "page"',
      'Sidebar conversation delete replacement focus restoration',
    )
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 640,
      deviceScaleFactor: 1,
      mobile: true,
    })
    if (await evaluate("Boolean(document.querySelector('.zc-sidebar-backdrop'))")) {
      await clickSelector('.zc-sidebar-backdrop')
      await waitFor(
        "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') && document.querySelector('.zc-app-surface')?.getAttribute('aria-hidden') !== 'true'",
        'compact resize closes current Sidebar overlay before title editing',
      )
    }
    await clickSelector('.zc-chat-title')
    await waitFor(
      'document.querySelector(".zc-chat-title-edit input") === document.activeElement',
      'compact conversation title editor focus',
    )
    const compactConversationTitleState = await evaluate(`(() => {
      const header = document.querySelector('.zc-chat-header')
      const editor = document.querySelector('.zc-chat-title-edit')
      const input = editor?.querySelector('input')
      const buttons = [...(editor?.querySelectorAll('button') || [])]
      if (!(header instanceof HTMLElement) || !(editor instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
        return { exists: false }
      }
      const headerRect = header.getBoundingClientRect()
      const editorRect = editor.getBoundingClientRect()
      const inputRect = input.getBoundingClientRect()
      const buttonRects = buttons.map((button) => button.getBoundingClientRect())
      return {
        exists: true,
        inputWidth: inputRect.width,
        editorInsideHeader: editorRect.left >= headerRect.left && editorRect.right <= headerRect.right + 1,
        controlsInsideViewport: [inputRect, ...buttonRects].every((rect) => rect.left >= 0 && rect.right <= innerWidth + 1),
        buttonCount: buttonRects.length,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      }
    })()`)
    assert.equal(compactConversationTitleState.exists, true, 'Compact conversation title editor must render')
    assert.ok(compactConversationTitleState.inputWidth >= 40, `Compact conversation title input must remain usable: ${JSON.stringify(compactConversationTitleState)}`)
    assert.equal(compactConversationTitleState.buttonCount, 2, 'Compact conversation title editor must retain save and cancel actions')
    assert.equal(compactConversationTitleState.editorInsideHeader, true, `Compact conversation title editor must stay inside the header: ${JSON.stringify(compactConversationTitleState)}`)
    assert.equal(compactConversationTitleState.controlsInsideViewport, true, `Compact conversation title controls must stay inside the viewport: ${JSON.stringify(compactConversationTitleState)}`)
    assert.equal(compactConversationTitleState.horizontalOverflow, false, `Compact conversation title editor must not create horizontal overflow: ${JSON.stringify(compactConversationTitleState)}`)
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await waitFor(
      "document.querySelector('.zc-chat-title') === document.activeElement",
      'compact conversation title Escape focus restoration',
    )
    const compactComposerActionState = await evaluate(`(() => {
      const row = document.querySelector('.zc-composer-row')
      const textarea = row?.querySelector('textarea')
      const send = row?.querySelector('.zc-send-btn')
      if (!(row instanceof HTMLElement) || !(textarea instanceof HTMLTextAreaElement) || !(send instanceof HTMLButtonElement)) {
        return { exists: false }
      }
      const rowRect = row.getBoundingClientRect()
      const textareaRect = textarea.getBoundingClientRect()
      const sendRect = send.getBoundingClientRect()
      return {
        exists: true,
        rowWidth: rowRect.width,
        textareaWidth: textareaRect.width,
        sendWidth: sendRect.width,
        sendConsumesRow: sendRect.width > rowRect.width * 0.5,
        controlsInsideRow:
          textareaRect.left >= rowRect.left &&
          textareaRect.right <= rowRect.right + 1 &&
          sendRect.left >= rowRect.left &&
          sendRect.right <= rowRect.right + 1,
      }
    })()`)
    assert.equal(
      compactComposerActionState.exists,
      true,
      'Compact composer action geometry must render',
    )
    assert.equal(
      compactComposerActionState.sendConsumesRow,
      false,
      `Compact Send must not consume the composer row: ${JSON.stringify(compactComposerActionState)}`,
    )
    assert.ok(
      compactComposerActionState.textareaWidth > compactComposerActionState.sendWidth,
      `Compact composer must leave more room for text than Send: ${JSON.stringify(compactComposerActionState)}`,
    )
    assert.equal(
      compactComposerActionState.controlsInsideRow,
      true,
      `Compact composer controls must remain inside their row: ${JSON.stringify(compactComposerActionState)}`,
    )
    await assertVisibleEmptyPlaceholdersFit('compact current chat 320px')
    await assertVisibleCenteredButtonContent('compact current chat 320px')
    const compactSidebarOpenState = await evaluate(`(() => {
      const sidebar = document.querySelector('.zc-sidebar')
      const toggle = document.querySelector('.zc-chat-header button[aria-label]')
      if (!(sidebar instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) {
        return { found: false, clicked: false }
      }
      const clicked = sidebar.classList.contains('collapsed')
      if (clicked) toggle.click()
      return { found: true, clicked }
    })()`)
    assert.equal(compactSidebarOpenState.found, true, 'Current compact Sidebar toggle must exist')
    await waitFor(
      "Boolean(document.querySelector('.zc-sidebar:not(.collapsed)')) && Boolean(document.querySelector('.zc-sidebar-backdrop'))",
      'current compact Sidebar overlay open',
    )
    const compactConversationSwitchSetup = await evaluate(`(() => {
      const current = document.querySelector('.zc-conv-item[aria-current="page"]')
      const target = [...document.querySelectorAll('.zc-conv-item[role="button"]')]
        .find((item) => item !== current)
      if (!(current instanceof HTMLElement) || !(target instanceof HTMLElement)) {
        return { found: false, originalTitle: '', targetTitle: '' }
      }
      const originalTitle = current.querySelector('.zc-conv-title')?.textContent?.trim() || ''
      const targetTitle = target.querySelector('.zc-conv-title')?.textContent?.trim() || ''
      target.scrollIntoView({ block: 'nearest' })
      target.focus()
      target.click()
      return { found: true, originalTitle, targetTitle }
    })()`)
    assert.equal(
      compactConversationSwitchSetup.found,
      true,
      `Compact Sidebar conversation switching requires a second conversation: ${JSON.stringify(compactConversationSwitchSetup)}`,
    )
    await waitFor(
      `document.querySelector('.zc-conv-item[aria-current="page"] .zc-conv-title')?.textContent?.trim() === ${JSON.stringify(compactConversationSwitchSetup.targetTitle)}`,
      'compact Sidebar conversation activation',
    )
    await waitFor(
      "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') === true && !document.querySelector('.zc-sidebar-backdrop')",
      'compact Sidebar conversation selection closes overlay',
    )
    await waitFor(
      "document.activeElement === document.querySelector('.zc-composer textarea')",
      'compact Sidebar conversation selection Composer focus',
    )
    await clickSelector('.zc-chat-header > button.zc-icon-btn')
    await waitFor(
      "Boolean(document.querySelector('.zc-sidebar:not(.collapsed)')) && Boolean(document.querySelector('.zc-sidebar-backdrop'))",
      'compact Sidebar original conversation restore surface',
    )
    const compactConversationRestored = await evaluate(`(() => {
      const title = ${JSON.stringify(compactConversationSwitchSetup.originalTitle)}
      const target = [...document.querySelectorAll('.zc-conv-item[role="button"]')]
        .find((item) => item.querySelector('.zc-conv-title')?.textContent?.trim() === title)
      if (!(target instanceof HTMLElement)) return false
      target.scrollIntoView({ block: 'nearest' })
      target.focus()
      target.click()
      return true
    })()`)
    assert.equal(
      compactConversationRestored,
      true,
      'Compact Sidebar smoke must restore the original performance conversation',
    )
    await waitFor(
      `document.querySelector('.zc-conv-item[aria-current="page"] .zc-conv-title')?.textContent?.trim() === ${JSON.stringify(compactConversationSwitchSetup.originalTitle)}`,
      'compact Sidebar original conversation restoration',
    )
    await waitFor(
      "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') === true && !document.querySelector('.zc-sidebar-backdrop') && document.activeElement === document.querySelector('.zc-composer textarea')",
      'compact Sidebar original conversation focus restoration',
    )
    await clickSelector('.zc-chat-header > button.zc-icon-btn')
    await waitFor(
      "Boolean(document.querySelector('.zc-sidebar:not(.collapsed)')) && Boolean(document.querySelector('.zc-sidebar-backdrop'))",
      'current compact Sidebar backdrop close surface',
    )
    await clickSelector('.zc-sidebar-backdrop')
    await waitFor(
      "document.querySelector('.zc-sidebar')?.classList.contains('collapsed') && !document.querySelector('.zc-sidebar-backdrop')",
      'current compact Sidebar backdrop close',
    )
    const closedSidebarState = await evaluate(`(() => {
      const sidebar = document.querySelector('.zc-sidebar')
      const control = sidebar?.querySelector('button, input, [tabindex]')
      if (!(sidebar instanceof HTMLElement) || !(control instanceof HTMLElement)) {
        return { found: false, ariaHidden: '', inert: false, focusBlocked: false }
      }
      control.focus()
      return {
        found: true,
        ariaHidden: sidebar.getAttribute('aria-hidden') || '',
        inert: sidebar.inert,
        focusBlocked: document.activeElement !== control,
      }
    })()`)
    assert.deepEqual(
      closedSidebarState,
      { found: true, ariaHidden: 'true', inert: true, focusBlocked: true },
      'Closed current Sidebar must remain inert and outside the focus order',
    )
    assert.equal(
      await evaluate("!document.querySelector('.zc-sidebar-backdrop')"),
      true,
      'Current compact Sidebar backdrop must close the production overlay',
    )
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await waitFor('Boolean(document.querySelector(".message-list"))', 'virtualized message list')
    await waitFor(
      `(${maintainLatestVirtualMessageScrollIntent.toString()})(document, window, 'perf-299')`,
      'rich Markdown render surface',
    )
    await waitFor(
      'Boolean(document.querySelector(".code-copy-button"))',
      'Markdown worker-rendered code block',
    )
    const markdownWorkerTargets = await cdp.send('Target.getTargets')
    const markdownWorkerUrls = markdownWorkerTargetUrls(markdownWorkerTargets)
    const markdownWorkerResourceLoaded =
      networkRequestUrls.some((url) => /markdown\.worker/u.test(url)) ||
      markdownWorkerUrls.length > 0
    assert.equal(
      markdownWorkerResourceLoaded,
      true,
      `Markdown rendering must load the production Web Worker resource: ${JSON.stringify(
        {
          pageNetworkUrls: networkRequestUrls.filter((url) => /markdown/u.test(url)),
          workerTargetUrls: markdownWorkerUrls,
        },
      )}`,
    )
    const richMarkdownState = await evaluate(`(() => {
      const body = [...document.querySelectorAll('[data-message-content="true"]')].find((node) =>
        node.textContent?.includes('Markdown 安全边界'),
      )
      const link = body?.querySelector('a[href^="https://example.com/guide"]')
      const codeBlock = body?.querySelector('.markdown-code-block')
      const code = codeBlock?.querySelector('code')
      return {
        heading: body?.querySelector('h1')?.textContent?.trim() || '',
        bullet: body?.querySelector('ul li')?.textContent?.trim() || '',
        tableCell: [...(body?.querySelectorAll('td') || [])]
          .map((cell) => cell.textContent?.trim() || '')
          .find((text) => text === 'table-ok') || '',
        linkTarget: link?.getAttribute('target') || '',
        linkRel: link?.getAttribute('rel') || '',
        scriptElementCount: body?.querySelectorAll('script').length || 0,
        rawHtmlTextVisible: body?.textContent?.includes(
          '<script>window.__markdownRawHtmlExecuted = true</script>',
        ) || false,
        rawHtmlExecuted: window.__markdownRawHtmlExecuted === true,
        codeLanguage: codeBlock?.getAttribute('data-language') || '',
        codeText: code?.textContent || '',
        copyControls: body?.querySelectorAll('.code-copy-button').length || 0,
      }
    })()`)
    assert.deepEqual(
      {
        heading: richMarkdownState.heading,
        bullet: richMarkdownState.bullet,
        tableCell: richMarkdownState.tableCell,
        linkTarget: richMarkdownState.linkTarget,
        scriptElementCount: richMarkdownState.scriptElementCount,
        rawHtmlTextVisible: richMarkdownState.rawHtmlTextVisible,
        rawHtmlExecuted: richMarkdownState.rawHtmlExecuted,
        codeLanguage: richMarkdownState.codeLanguage,
        copyControls: richMarkdownState.copyControls,
      },
      {
        heading: 'Markdown 安全边界',
        bullet: 'Browser list item',
        tableCell: 'table-ok',
        linkTarget: '_blank',
        scriptElementCount: 0,
        rawHtmlTextVisible: true,
        rawHtmlExecuted: false,
        codeLanguage: 'typescript',
        copyControls: 1,
      },
      `Current rich Markdown DOM contract must render through the real worker: ${JSON.stringify(richMarkdownState)}`,
    )
    assert.equal(
      richMarkdownState.linkRel.includes('noopener') &&
        richMarkdownState.linkRel.includes('noreferrer'),
      true,
      `Markdown external links must be opener-safe: ${JSON.stringify(richMarkdownState)}`,
    )
    assert.equal(
      richMarkdownState.codeText.includes('<Button>{value}</Button>'),
      true,
      `TSX JSX-like text must remain visible in the code block: ${JSON.stringify(richMarkdownState)}`,
    )
    const markdownCopyFailureSetup = await evaluate(`(() => {
      const install = (target, property, value) => {
        try {
          Object.defineProperty(target, property, {
            configurable: true,
            writable: true,
            value,
          })
          return true
        } catch {
          try {
            target[property] = value
            return target[property] === value
          } catch {
            return false
          }
        }
      }
      const clipboard = {
        writeText: async () => {
          throw new Error('browser-smoke-copy-rejection')
        },
      }
      const clipboardInstalled = install(navigator, 'clipboard', clipboard)
      const execCommand = () => false
      const execCommandInstalled =
        install(document, 'execCommand', execCommand) ||
        install(Object.getPrototypeOf(document), 'execCommand', execCommand)
      const button = document.querySelector('.code-copy-button')
      return {
        clipboardInstalled,
        execCommandInstalled,
        copyFailedLabel: button?.getAttribute('data-copy-failed-label') || '',
      }
    })()`)
    assert.equal(
      markdownCopyFailureSetup.clipboardInstalled,
      true,
      `Markdown copy failure smoke could not install a rejecting clipboard: ${JSON.stringify(markdownCopyFailureSetup)}`,
    )
    assert.equal(
      markdownCopyFailureSetup.execCommandInstalled,
      true,
      `Markdown copy failure smoke could not disable the fallback clipboard path: ${JSON.stringify(markdownCopyFailureSetup)}`,
    )
    assert.ok(
      markdownCopyFailureSetup.copyFailedLabel,
      'Markdown code-copy buttons must expose a localized failure label',
    )
    await clickSelector('.code-copy-button')
    await waitFor(
      'document.querySelector(".code-copy-button")?.dataset.copyFailed === "true"',
      'Markdown code-copy failure feedback',
    )
    const markdownCopyFailureState = await evaluate(`(() => {
      const button = document.querySelector('.code-copy-button')
      const failedLabel = button?.getAttribute('data-copy-failed-label') || ''
      return {
        failed: button?.dataset.copyFailed === 'true',
        copied: button?.dataset.copied === 'true',
        text: button?.textContent?.trim() || '',
        ariaLabel: button?.getAttribute('aria-label') || '',
        failedLabel,
        leakedError: document.body.innerText.includes('browser-smoke-copy-rejection'),
      }
    })()`)
    assert.equal(
      markdownCopyFailureState.failed,
      true,
      `Markdown code-copy rejection must expose failed feedback: ${JSON.stringify(markdownCopyFailureState)}`,
    )
    assert.equal(
      markdownCopyFailureState.copied,
      false,
      `Markdown code-copy rejection must not report success: ${JSON.stringify(markdownCopyFailureState)}`,
    )
    assert.equal(
      markdownCopyFailureState.text,
      markdownCopyFailureState.failedLabel,
      `Markdown code-copy rejection must show the localized failure label: ${JSON.stringify(markdownCopyFailureState)}`,
    )
    assert.equal(
      markdownCopyFailureState.ariaLabel,
      markdownCopyFailureState.failedLabel,
      `Markdown code-copy rejection must update the accessible label: ${JSON.stringify(markdownCopyFailureState)}`,
    )
    assert.equal(
      markdownCopyFailureState.leakedError,
      false,
      `Markdown code-copy rejection must not leak the raw clipboard error: ${JSON.stringify(markdownCopyFailureState)}`,
    )
    const markdownSecurityDomState = await evaluate(`(() => ({
      customSchemeAnchors: document.querySelectorAll('.zc-md a[href^="intent:"]').length,
      remoteImages: [...document.querySelectorAll('.zc-md img')].filter((image) =>
        image.src.includes(${JSON.stringify(remoteMarkdownImageUrl)}),
      ).length,
      rawCustomSchemeText: [...document.querySelectorAll('.zc-md')].some((node) =>
        node.textContent?.includes('intent://open/settings'),
      ),
      remoteImageRequests: performance.getEntriesByName(
        ${JSON.stringify(remoteMarkdownImageUrl)},
      ).length,
    }))()`)
    const markdownSecurityState = {
      ...markdownSecurityDomState,
      remoteRequestEvents: networkRequestUrls.filter((url) => url === remoteMarkdownImageUrl),
      remoteResponseEvents: networkResponseUrls.filter((url) => url === remoteMarkdownImageUrl),
    }
    assert.equal(
      markdownSecurityState.customSchemeAnchors,
      0,
      `Markdown must not create custom-scheme links: ${JSON.stringify(markdownSecurityState)}`,
    )
    assert.equal(
      markdownSecurityState.remoteImages,
      0,
      `Markdown must not create remote images: ${JSON.stringify(markdownSecurityState)}`,
    )
    assert.equal(
      markdownSecurityState.rawCustomSchemeText,
      true,
      `Markdown must retain blocked link text as inert text: ${JSON.stringify(markdownSecurityState)}`,
    )
    assert.equal(
      markdownSecurityState.remoteRequestEvents.length,
      0,
      `Markdown must not emit a remote image request event: ${JSON.stringify(markdownSecurityState)}`,
    )
    assert.equal(
      markdownSecurityState.remoteResponseEvents.length,
      0,
      `Markdown must not emit a remote image response event: ${JSON.stringify(markdownSecurityState)}`,
    )
    assert.equal(
      markdownSecurityState.remoteImageRequests,
      0,
      `Performance API must corroborate the absent remote image request: ${JSON.stringify(markdownSecurityState)}`,
    )
    try {
      await waitFor('document.querySelectorAll("[data-message-id]").length > 0', 'virtualized message rows')
    } catch (error) {
      const snapshot = await evaluate(`new Promise((resolve) => {
        const request = indexedDB.open('zerochat')
        request.onerror = () => resolve({ dbError: String(request.error) })
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('documents', 'readonly')
          const get = tx.objectStore('documents').get('app')
          get.onsuccess = () => {
            const value = get.result
            db.close()
            resolve({
              activeTitle: document.querySelector('.zc-chat-title')?.textContent?.trim() || '',
              hasGuide: Boolean(document.querySelector('.zc-empty-card')),
              listRows: document.querySelectorAll('[data-message-id]').length,
              listScrollHeight: document.querySelector('.message-list')?.scrollHeight || 0,
              storedRecord: Boolean(value),
              storedRecordKeys: value && typeof value === 'object' ? Object.keys(value).sort() : [],
            })
          }
          get.onerror = () => {
            db.close()
            resolve({ dbError: String(get.error) })
          }
        }
      })()`, true)
      throw new Error(`${error.message}; performance snapshot: ${JSON.stringify(snapshot)}`)
    }
    await evaluate(`(() => {
      const list = document.querySelector('.message-list')
      list?.scrollTo({ top: 0, behavior: 'auto' })
      list?.dispatchEvent(new Event('scroll', { bubbles: true }))
      return true
    })()`)
    await sleep(250)
    const performanceState = await evaluate(`(() => {
      const list = document.querySelector('.message-list')
      const rendered = document.querySelectorAll('[data-message-id]').length
      const topSpacer = document.querySelector('[data-message-virtual-spacer="top"]')
      const bottomSpacer = document.querySelector('[data-message-virtual-spacer="bottom"]')
      return {
        rendered,
        scrollHeight: list?.scrollHeight ?? 0,
        clientHeight: list?.clientHeight ?? 0,
        topSpacer: Number(topSpacer?.getBoundingClientRect().height ?? 0),
        bottomSpacer: Number(bottomSpacer?.getBoundingClientRect().height ?? 0),
      }
    })()`)
    assert.ok(performanceState.rendered <= 60, `Virtualized message DOM is too large: ${JSON.stringify(performanceState)}`)
    assert.ok(performanceState.scrollHeight > performanceState.clientHeight, 'Virtualized transcript must be scrollable')
    assert.ok(performanceState.bottomSpacer > 0, 'Virtualized transcript must expose a bottom spacer')

    const newMessagesReaderBefore = await evaluate(`(() => {
      const list = document.querySelector('.message-list')
      return {
        scrollTop: list?.scrollTop ?? -1,
        maxScrollTop: list ? list.scrollHeight - list.clientHeight : -1,
      }
    })()`)
    await evaluate(`(() => {
      const bridge = window.__zerochatAppTest
      if (!bridge || typeof bridge.appendPerformanceMessage !== 'function') {
        throw new Error('Production performance-message test bridge is missing')
      }
      bridge.appendPerformanceMessage()
      return true
    })()`)
    await waitFor(
      'Boolean(document.querySelector(".new-messages-button"))',
      'new messages button for a scrolled-up reader',
    )
    const newMessagesReaderState = await evaluate(`(() => {
      const list = document.querySelector('.message-list')
      const button = document.querySelector('.new-messages-button')
      return {
        scrollTop: list?.scrollTop ?? -1,
        maxScrollTop: list ? list.scrollHeight - list.clientHeight : -1,
        buttonVisible: button instanceof HTMLButtonElement && button.getClientRects().length > 0,
      }
    })()`)
    assert.equal(
      newMessagesReaderState.buttonVisible,
      true,
      `A scrolled-up reader must receive the New messages action: ${JSON.stringify(newMessagesReaderState)}`,
    )
    assert.ok(
      Math.abs(newMessagesReaderState.scrollTop - newMessagesReaderBefore.scrollTop) <= 2,
      `An incoming turn must preserve the scrolled-up reader position: ${JSON.stringify({ newMessagesReaderBefore, newMessagesReaderState })}`,
    )
    assert.ok(
      newMessagesReaderState.scrollTop < newMessagesReaderState.maxScrollTop - 2,
      `An incoming turn must not force the reader to the bottom: ${JSON.stringify(newMessagesReaderState)}`,
    )

    const messageEditCancelStarted = await evaluate(`(() => {
      const row = document.querySelector('.zc-msg.user')
      const action = [...(row?.querySelectorAll('.zc-msg-actions button') ?? [])]
        .find((button) => /^(Edit|编辑)$/u.test(button.getAttribute('aria-label') || ''))
      if (!(action instanceof HTMLButtonElement)) return false
      action.focus()
      const focused = document.activeElement === action
      action.click()
      return focused
    })()`)
    assert.equal(
      messageEditCancelStarted,
      true,
      'Message edit cancellation must start from its keyboard-focusable edit action',
    )
    await waitFor(
      'Boolean(document.querySelector(".zc-msg.user textarea"))',
      'message edit cancellation textarea render',
    )
    await waitFor(
      'document.activeElement === document.querySelector(".zc-msg.user textarea")',
      'message edit cancellation textarea focus',
    )
    const messageEditTextareaFocusState = await evaluate(`(() => {
      const textarea = document.querySelector('.zc-msg.user textarea')
      return {
        activeClass: document.activeElement?.className || '',
        activeTag: document.activeElement?.tagName || '',
        focused: document.activeElement === textarea,
      }
    })()`)
    assert.equal(
      messageEditTextareaFocusState.focused,
      true,
      `Message edit must focus its rendered textarea: ${JSON.stringify(messageEditTextareaFocusState)}`,
    )
    const messageEditCancelClicked = await evaluate(`(() => {
      const row = document.activeElement?.closest('.zc-msg.user')
      const action = [...(row?.querySelectorAll('.zc-msg-actions button') ?? [])]
        .find((button) => /^(Cancel|取消)$/u.test(button.getAttribute('aria-label') || ''))
      if (!(action instanceof HTMLButtonElement)) return false
      action.focus()
      const focused = document.activeElement === action
      action.click()
      return focused
    })()`)
    assert.equal(
      messageEditCancelClicked,
      true,
      'Message edit cancel action must accept keyboard focus',
    )
    await waitFor(
      `(() => {
        const row = document.querySelector('.zc-msg.user')
        const action = [...(row?.querySelectorAll('.zc-msg-actions button') ?? [])]
          .find((button) => /^(Edit|编辑)$/u.test(button.getAttribute('aria-label') || ''))
        return action instanceof HTMLButtonElement && document.activeElement === action
      })()`,
      'message edit cancel focus restoration',
    )

    const messageContextMenuSetup = await evaluate(`(() => {
      const row = document.querySelector('.zc-msg.user')
      const trigger = [...(row?.querySelectorAll('button') || [])].find((button) =>
        /^(Edit|编辑)$/u.test(button.getAttribute('aria-label') || ''),
      )
      if (!trigger) return false
      trigger.focus()
      window.__zerochatContextTrigger = trigger
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 0,
        }),
      )
      return document.activeElement === trigger
    })()`)
    assert.equal(
      messageContextMenuSetup,
      true,
      'Message context menu smoke must focus the current keyboard invocation control',
    )
    await waitFor(
      'Boolean(document.querySelector("[data-zc-message-context-menu]"))',
      'message context menu',
    )
    await waitFor(
      'document.activeElement?.getAttribute("role") === "menuitem"',
      'message context menu initial focus',
    )
    const messageContextMenuState = await evaluate(`(() => {
      const menu = document.querySelector('[data-zc-message-context-menu]')
      const trigger = window.__zerochatContextTrigger
      return {
        menuLabel: menu?.getAttribute('aria-label') || '',
        menuItems: menu?.querySelectorAll('[role="menuitem"]').length || 0,
        triggerLabel: trigger?.getAttribute('aria-label') || '',
        focusedRole: document.activeElement?.getAttribute('role') || '',
      }
    })()`)
    assert.ok(
      messageContextMenuState.menuLabel,
      `Message context menu must expose the target message label: ${JSON.stringify(messageContextMenuState)}`,
    )
    assert.ok(
      messageContextMenuState.menuItems > 0,
      `Message context menu must expose actionable menu items: ${JSON.stringify(messageContextMenuState)}`,
    )
    assert.equal(
      messageContextMenuState.focusedRole,
      'menuitem',
      `Message context menu must focus its first action: ${JSON.stringify(messageContextMenuState)}`,
    )
    const messageContextDeleteCancelSetup = await evaluate(`(() => {
      window.__zerochatOriginalConfirm = window.confirm
      window.__zerochatDeleteConfirmCalls = 0
      window.__zerochatContextMessageRow = window.__zerochatContextTrigger?.closest('.zc-msg')
      window.confirm = () => {
        window.__zerochatDeleteConfirmCalls += 1
        return false
      }
      return {
        messageCount: document.querySelectorAll('.zc-msg').length,
        rowConnected: Boolean(window.__zerochatContextMessageRow?.isConnected),
      }
    })()`)
    assert.equal(
      messageContextDeleteCancelSetup.rowConnected,
      true,
      `Message context delete cancellation requires a connected target row: ${JSON.stringify(messageContextDeleteCancelSetup)}`,
    )
    await clickSelector('[data-zc-message-context-delete]')
    await waitFor(
      '!document.querySelector("[data-zc-message-context-menu]")',
      'message context menu canceled delete close',
    )
    await waitFor(
      'window.__zerochatContextTrigger === document.activeElement',
      'message context menu canceled delete focus restoration',
    )
    const messageContextDeleteCancelState = await evaluate(`(() => {
      const state = {
        confirmCalls: window.__zerochatDeleteConfirmCalls || 0,
        messageCount: document.querySelectorAll('.zc-msg').length,
        rowConnected: Boolean(window.__zerochatContextMessageRow?.isConnected),
        restored: window.__zerochatContextTrigger === document.activeElement,
      }
      window.confirm = window.__zerochatOriginalConfirm
      delete window.__zerochatOriginalConfirm
      return state
    })()`)
    assert.equal(
      messageContextDeleteCancelState.confirmCalls,
      1,
      `Message context delete cancellation must prompt exactly once: ${JSON.stringify(messageContextDeleteCancelState)}`,
    )
    assert.equal(
      messageContextDeleteCancelState.messageCount,
      messageContextDeleteCancelSetup.messageCount,
      `Canceling message deletion must preserve the message list: ${JSON.stringify({ messageContextDeleteCancelSetup, messageContextDeleteCancelState })}`,
    )
    assert.equal(
      messageContextDeleteCancelState.rowConnected,
      true,
      `Canceling message deletion must preserve the target row: ${JSON.stringify(messageContextDeleteCancelState)}`,
    )
    assert.equal(
      messageContextDeleteCancelState.restored,
      true,
      `Canceling message deletion must restore the invoking control: ${JSON.stringify(messageContextDeleteCancelState)}`,
    )
    await evaluate(`(() => {
      const trigger = window.__zerochatContextTrigger
      if (!trigger?.isConnected) throw new Error('Context menu trigger is detached')
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 0,
        }),
      )
      return true
    })()`)
    await waitFor(
      'Boolean(document.querySelector("[data-zc-message-context-menu]"))',
      'message context menu copy setup reopen',
    )
    await waitFor(
      'document.activeElement?.getAttribute("role") === "menuitem"',
      'message context menu copy setup focus',
    )
    const messageContextCopyFallbackSetup = await evaluate(`(() => {
      const install = (target, property, value) => {
        try {
          Object.defineProperty(target, property, {
            configurable: true,
            writable: true,
            value,
          })
          return true
        } catch {
          try {
            target[property] = value
            return target[property] === value
          } catch {
            return false
          }
        }
      }
      window.__zerochatContextCopyFallback = { calls: 0, value: '' }
      window.__zerochatContextCopyDeferredCalls = 0
      const clipboardInstalled = install(navigator, 'clipboard', {
        writeText: () => new Promise((_, reject) => {
          const call = ++window.__zerochatContextCopyDeferredCalls
          window.__zerochatContextCopyDeferred = {
            reject: () => reject(new Error('browser-smoke-context-copy-rejection')),
          }
          if (call > 1) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                window.__zerochatContextCopyDeferred?.reject()
              })
            })
          }
        }),
      })
      const execCommand = (command) => {
        if (command === 'copy') {
          const textareas = [...document.querySelectorAll('textarea')]
          const textarea = textareas[textareas.length - 1]
          window.__zerochatContextCopyFallback.calls += 1
          window.__zerochatContextCopyFallback.value = textarea?.value || ''
        }
        return command === 'copy'
      }
      const execCommandInstalled =
        install(document, 'execCommand', execCommand) ||
        install(Object.getPrototypeOf(document), 'execCommand', execCommand)
      return { clipboardInstalled, execCommandInstalled }
    })()`)
    assert.equal(
      messageContextCopyFallbackSetup.clipboardInstalled,
      true,
      `Message context copy smoke could not install a rejecting clipboard: ${JSON.stringify(messageContextCopyFallbackSetup)}`,
    )
    assert.equal(
      messageContextCopyFallbackSetup.execCommandInstalled,
      true,
      `Message context copy smoke could not install a working fallback: ${JSON.stringify(messageContextCopyFallbackSetup)}`,
    )
    await clickSelector('[data-zc-message-context-copy]')
    await waitFor(
      'window.__zerochatContextCopyDeferredCalls === 1',
      'message context menu first deferred copy request',
    )
    await waitFor(
      '!document.querySelector("[data-zc-message-context-menu]")',
      'message context menu first copy close',
    )
    await evaluate(`(() => {
      const trigger = window.__zerochatContextTrigger
      if (!trigger?.isConnected) throw new Error('Context menu trigger is detached')
      trigger.focus()
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 0,
        }),
      )
      return true
    })()`)
    await waitFor(
      'Boolean(document.querySelector("[data-zc-message-context-menu]"))',
      'message context menu same-target reopen',
    )
    await waitFor(
      'document.activeElement?.getAttribute("role") === "menuitem"',
      'message context menu same-target reopen focus',
    )
    await evaluate(`(() => {
      window.__zerochatContextCopyDeferred?.reject()
      return true
    })()`)
    await waitFor(
      'window.__zerochatContextCopyFallback?.calls === 1',
      'message context menu first fallback completion',
    )
    const messageContextCopyFallbackState = await evaluate(`(() => ({
      calls: window.__zerochatContextCopyFallback?.calls || 0,
      value: window.__zerochatContextCopyFallback?.value || '',
      menuStillOpen: Boolean(document.querySelector('[data-zc-message-context-menu]')),
      focusedRole: document.activeElement?.getAttribute('role') || '',
      leakedError: document.body.innerText.includes('browser-smoke-context-copy-rejection'),
    }))()`)
    assert.equal(
      messageContextCopyFallbackState.calls,
      1,
      `Message context copy must use the fallback after Clipboard API rejection: ${JSON.stringify(messageContextCopyFallbackState)}`,
    )
    assert.equal(
      messageContextCopyFallbackState.menuStillOpen,
      true,
      `An older async copy must not close a same-target reopened menu: ${JSON.stringify(messageContextCopyFallbackState)}`,
    )
    assert.equal(
      messageContextCopyFallbackState.focusedRole,
      'menuitem',
      `An older async copy must not steal focus from a reopened menu: ${JSON.stringify(messageContextCopyFallbackState)}`,
    )
    assert.ok(
      messageContextCopyFallbackState.value,
      `Message context copy fallback must receive the message text: ${JSON.stringify(messageContextCopyFallbackState)}`,
    )
    assert.equal(
      messageContextCopyFallbackState.leakedError,
      false,
      `Message context copy fallback must not leak the raw clipboard error: ${JSON.stringify(messageContextCopyFallbackState)}`,
    )
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await waitFor(
      '!document.querySelector("[data-zc-message-context-menu]")',
      'message context menu same-target reopen Escape close',
    )
    await waitFor(
      'window.__zerochatContextTrigger === document.activeElement',
      'message context menu same-target reopen Escape focus restoration',
    )
    await evaluate(`(() => {
      const install = (target, property, value) => {
        try {
          Object.defineProperty(target, property, {
            configurable: true,
            writable: true,
            value,
          })
          return true
        } catch {
          try {
            target[property] = value
            return target[property] === value
          } catch {
            return false
          }
        }
      }
      const execCommand = () => false
      return install(document, 'execCommand', execCommand) ||
        install(Object.getPrototypeOf(document), 'execCommand', execCommand)
    })()`)
    await evaluate(`(() => {
      const trigger = window.__zerochatContextTrigger
      if (!trigger?.isConnected) throw new Error('Context menu trigger is detached')
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 0,
        }),
      )
      return true
    })()`)
    await waitFor(
      'Boolean(document.querySelector("[data-zc-message-context-menu]"))',
      'message context menu copy failure reopen',
    )
    const copyFailureToastCount = await evaluate(`(() =>
      [...document.querySelectorAll('.zc-toast.error')].filter((toast) =>
        /Copy failed|复制失败|コピーに失敗/u.test(toast.textContent || ''),
      ).length
    )()`)
    await clickSelector('[data-zc-message-context-copy]')
    await waitFor(
      `(() => [...document.querySelectorAll('.zc-toast.error')].filter((toast) =>
        /Copy failed|复制失败|コピーに失敗/u.test(toast.textContent || ''),
      ).length > ${copyFailureToastCount})()`,
      'message context menu localized copy failure',
    )
    await waitFor(
      'window.__zerochatContextTrigger === document.activeElement',
      'message context menu copy failure focus restoration',
    )
    const messageContextCopyFailureState = await evaluate(`(() => {
      const toast = [...document.querySelectorAll('.zc-toast.error')]
        .reverse()
        .find((candidate) =>
          /Copy failed|复制失败|コピーに失敗/u.test(candidate.textContent || ''),
        )
      return {
        text: toast?.textContent?.trim() || '',
        leakedError: document.body.innerText.includes('browser-smoke-context-copy-rejection'),
      }
    })()`)
    assert.match(
      messageContextCopyFailureState.text,
      /Copy failed|复制失败|コピーに失敗/u,
      `Message context copy failure must use a localized notice: ${JSON.stringify(messageContextCopyFailureState)}`,
    )
    assert.equal(
      messageContextCopyFailureState.leakedError,
      false,
      `Message context copy failure must not leak the raw clipboard error: ${JSON.stringify(messageContextCopyFailureState)}`,
    )
    assert.equal(
      runtimeErrors.some((error) => error.includes('browser-smoke-context-copy-rejection')),
      false,
      `Message context copy failure must not create an unhandled rejection: ${JSON.stringify(runtimeErrors)}`,
    )
    await evaluate(`(() => {
      const trigger = window.__zerochatContextTrigger
      if (!trigger?.isConnected) throw new Error('Context menu trigger is detached')
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 0,
        }),
      )
      return true
    })()`)
    await waitFor(
      'Boolean(document.querySelector("[data-zc-message-context-menu]"))',
      'message context menu Escape reopen',
    )
    await waitFor(
      'document.activeElement?.getAttribute("role") === "menuitem"',
      'message context menu Escape initial focus',
    )
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    })
    await waitFor(
      '!document.querySelector("[data-zc-message-context-menu]")',
      'message context menu Escape close',
    )
    await waitFor(
      'window.__zerochatContextTrigger === document.activeElement',
      'message context menu focus restoration',
    )
    const messageContextMenuFocusState = await evaluate(`(() => ({
      restored: window.__zerochatContextTrigger === document.activeElement,
      activeLabel: document.activeElement?.getAttribute('aria-label') || '',
    }))()`)
    assert.equal(
      messageContextMenuFocusState.restored,
      true,
      `Message context menu Escape must restore the invoking control: ${JSON.stringify(messageContextMenuFocusState)}`,
    )
    assert.equal(
      messageContextMenuFocusState.activeLabel,
      messageContextMenuState.triggerLabel,
      `Message context menu Escape must restore the exact invoking control: ${JSON.stringify(messageContextMenuFocusState)}`,
    )
    const directMessageDeleteStarted = await evaluate(`(() => {
      const row = window.__zerochatContextTrigger?.closest('.zc-msg')
      const action = [...(row?.querySelectorAll('.zc-msg-actions button') ?? [])]
        .find((button) => /^(Delete|删除)$/u.test(button.getAttribute('aria-label') || ''))
      if (!(row instanceof HTMLElement) || !(action instanceof HTMLButtonElement)) {
        return false
      }
      const originalConfirm = window.confirm
      try {
        window.confirm = () => true
        window.__zerochatDirectDeleteRow = row
        action.focus()
        const focused = document.activeElement === action
        action.click()
        return focused
      } finally {
        window.confirm = originalConfirm
      }
    })()`)
    assert.equal(
      directMessageDeleteStarted,
      true,
      'Direct message delete must start from its keyboard-focusable action',
    )
    await waitFor(
      'window.__zerochatDirectDeleteRow?.isConnected === false',
      'direct message durable delete',
      20_000,
    )
    await waitFor(
      'document.activeElement === document.querySelector(".message-list")',
      'direct message delete transcript focus restoration',
    )

    const concurrentAppDataFixtureState = await installConcurrentAppDataRevision()
    assert.notEqual(
      concurrentAppDataFixtureState.competingIv,
      concurrentAppDataFixtureState.originalIv,
      `Current browser smoke must install a distinct encrypted competing AppData revision: ${JSON.stringify(concurrentAppDataFixtureState)}`,
    )
    await clickSelector('.zc-sidebar-footer .zc-icon-btn')
    await waitFor('Boolean(document.querySelector(".zc-settings"))', 'concurrent AppData Settings entry')
    await clickSelector('#settings-tab-general')
    await waitFor(
      'document.querySelector("#settings-tab-general")?.classList.contains("active")',
      'concurrent AppData General tab',
    )
    await setSelect(concurrentAppDataFixtureState.localTheme)
    const concurrentAppDataMergeState = await waitForConcurrentAppDataState(
      concurrentAppDataFixtureState.localTheme,
      concurrentAppDataFixtureState.originalIv,
    )
    const conflictMessage = await evaluate(
      'window.__zerochatAppTest?.currentLocalDataWriteConflictMessage() || ""',
    )
    const conflictVisible = await evaluate(
      `[...document.querySelectorAll('.zc-toast')].some((toast) => toast.textContent?.includes(${JSON.stringify(conflictMessage)}))`,
    )
    assert.equal(
      concurrentAppDataMergeState.markerPresent === true &&
        concurrentAppDataMergeState.theme === concurrentAppDataFixtureState.localTheme &&
        conflictVisible === false,
      true,
      `Current browser smoke must merge valid concurrent AppData revisions without a stale-conflict notice: ${JSON.stringify(concurrentAppDataMergeState)}`,
    )
    await setSelect('system')
    const concurrentAppDataRecoveryState = await waitForConcurrentAppDataState(
      'system',
      concurrentAppDataMergeState.currentIv,
    )
    assert.equal(
      concurrentAppDataRecoveryState.markerPresent === true &&
        concurrentAppDataRecoveryState.theme === 'system',
      true,
      `Current browser smoke must keep the local save queue writable after automatic AppData conflict recovery: ${JSON.stringify(concurrentAppDataRecoveryState)}`,
    )
    await clickSelector('.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")', 'concurrent AppData Settings close')

    await evaluate(`(async () => {
      const bridge = window.__zerochatAppTest
      if (!bridge) throw new Error('Production test bridge is missing')
      await bridge.seedOnboardingSnapshot()
      return true
    })()`, true)
    const onboardingSkipLoadStart = cdp.events.length
    await cdp.send('Page.navigate', { url: testUrl })
    await waitForPageLoadCompletion(onboardingSkipLoadStart)
    await waitFor('document.readyState === "complete"', 'onboarding skip page load')
    await waitFor('Boolean(document.querySelector(".zc-empty-card"))', 'onboarding skip state')
    await clickText(['稍后设置', 'Set up later', 'Skip for now'])
    await waitFor('Boolean(document.querySelector(".zc-composer textarea"))', 'onboarding skip chat')
    await waitFor(
      'document.activeElement === document.querySelector(".zc-composer textarea")',
      'onboarding skip Composer focus handoff',
    )

    await evaluate(`(async () => {
      const bridge = window.__zerochatAppTest
      if (!bridge) throw new Error('Production test bridge is missing')
      await bridge.seedProviderlessSnapshot()
      return true
    })()`, true)
    const providerlessLoadStart = cdp.events.length
    await cdp.send('Page.navigate', { url: testUrl })
    await waitForPageLoadCompletion(providerlessLoadStart)
    await waitFor('document.readyState === "complete"', 'providerless page load')
    await waitFor('Boolean(document.querySelector(".zc-empty-card"))', 'providerless empty state')
    const providerlessState = await evaluate(`(() => {
      const card = document.querySelector('.zc-empty-card')
      const buttons = [...(card?.querySelectorAll('button') ?? [])]
      const textOf = (button) => (button.textContent || button.getAttribute('aria-label') || '').trim()
      return {
        heading: card?.querySelector('h1')?.textContent?.trim() || '',
        hasAddProvider: buttons.some((button) => /添加提供商|Add provider/u.test(textOf(button))),
        hasStartChatting: buttons.some((button) => /开始使用|Start chatting/u.test(textOf(button))),
        hasSkip: buttons.some((button) => /稍后设置|Set up later|Skip for now/u.test(textOf(button))),
        sendButtonCount: document.querySelectorAll('.zc-send-btn').length,
      }
    })()`)
    assert.match(
      providerlessState.heading,
      /没有会话|No chats/u,
      `Providerless snapshot must render the first-provider empty state: ${JSON.stringify(providerlessState)}`,
    )
    assert.equal(
      providerlessState.hasAddProvider,
      true,
      `Providerless snapshot must expose the add-provider recovery action: ${JSON.stringify(providerlessState)}`,
    )
    assert.equal(
      providerlessState.hasStartChatting,
      false,
      `Providerless snapshot must not offer chat before a Provider exists: ${JSON.stringify(providerlessState)}`,
    )
    assert.equal(
      providerlessState.hasSkip,
      false,
      `A completed providerless snapshot must not regress to onboarding skip UI: ${JSON.stringify(providerlessState)}`,
    )
    assert.equal(
      providerlessState.sendButtonCount,
      0,
      `Providerless snapshot must not render a composer without a conversation: ${JSON.stringify(providerlessState)}`,
    )

    const currentShellSyncState = await evaluate(`(() => {
      const visible = (element) => {
        if (!element) return false
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && style.pointerEvents !== 'none'
      }
      const controls = [...document.querySelectorAll('button, [role="button"]')]
        .filter(visible)
      const settingsEntry = document.querySelector('.zc-sidebar-footer .zc-icon-btn')
      return {
        settingsEntryActionable: settingsEntry instanceof HTMLButtonElement &&
          !settingsEntry.disabled && settingsEntry.tabIndex >= 0 && visible(settingsEntry),
        visibleDeprecatedSyncAriaCount: controls.filter((control) =>
          control.getAttribute('aria-label')?.trim() === '云同步: 本地 · 开启云同步 · 云同步关闭').length,
        visibleDeprecatedSyncControlCount: controls.filter((control) =>
          control.textContent?.trim() === '本地 · 开启云同步').length,
      }
    })()`)
    assert.deepEqual(
      currentShellSyncState,
      {
        settingsEntryActionable: true,
        visibleDeprecatedSyncAriaCount: 0,
        visibleDeprecatedSyncControlCount: 0,
      },
      `Current shell must expose Settings without retired sync controls: ${JSON.stringify(currentShellSyncState)}`,
    )
    await clickSelector('.zc-sidebar-footer .zc-icon-btn')
    await waitFor('Boolean(document.querySelector(".zc-settings"))', 'current Settings entry opens')
    await clickSelector('#settings-tab-sync')
    await waitFor(
      'document.querySelector("#settings-tab-sync")?.classList.contains("active")',
      'current Settings entry reaches Sync tab',
    )
    const syncSettingsOpenProof = await evaluate(`(() => ({
      activeTabId: document.querySelector('.zc-settings-nav button.active')?.id || '',
      opened: Boolean(document.querySelector('.zc-settings[role="dialog"] #settings-tab-sync.active')),
    }))()`)
    assert.deepEqual(
      syncSettingsOpenProof,
      { activeTabId: 'settings-tab-sync', opened: true },
      `Current Settings entry must open the Sync tab: ${JSON.stringify(syncSettingsOpenProof)}`,
    )
    await clickSelector('.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")', 'current Settings evidence closes')

    const iconShellDom = await evaluate(`(() => {
      const visible = (element) => {
        if (!element) return false
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      }
      const faviconLinks = [...document.querySelectorAll('link[rel~="icon"]')].map((link) => ({
        href: link.getAttribute('href') || '',
        type: link.getAttribute('type'),
        sizes: link.getAttribute('sizes'),
      }))
      const appLogos = [...document.querySelectorAll('.app-logo')].map((logo) => ({
        src: logo.getAttribute('src') || '',
        resolvedSrc: logo.src || '',
        visible: visible(logo),
        complete: Boolean(logo.complete),
        naturalWidth: Number(logo.naturalWidth || 0),
        naturalHeight: Number(logo.naturalHeight || 0),
      }))
      const hasFaviconLink = faviconLinks.length > 0
      const visibleFaviconLogoCount = appLogos.filter((logo) =>
        logo.visible && logo.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0 &&
        logo.resolvedSrc.endsWith('favicon.svg'),
      ).length
      return {
        kind: 'zerochat.webIconSyncDom',
        version: 1,
        url: location.href,
        documentLanguage: document.documentElement.lang,
        documentDirection: document.documentElement.dir || 'ltr',
        faviconLinks,
        hasFaviconLink,
        appLogos,
        visibleFaviconLogoCount,
        passed: Boolean(document.querySelector('.zc-app')) &&
          document.documentElement.lang === 'zh-CN' &&
          (document.documentElement.dir || 'ltr') === 'ltr' &&
          hasFaviconLink && visibleFaviconLogoCount > 0,
      }
    })()`)
    const iconSyncDom = {
      ...iconShellDom,
      ...currentShellSyncState,
      syncSettingsOpenProof,
      passed:
        iconShellDom.passed &&
        currentShellSyncState.settingsEntryActionable &&
        currentShellSyncState.visibleDeprecatedSyncAriaCount === 0 &&
        currentShellSyncState.visibleDeprecatedSyncControlCount === 0 &&
        syncSettingsOpenProof.opened,
    }
    await writeFile(reportPath, `${JSON.stringify({ ...iconSyncDom, generatedAt: new Date().toISOString() }, null, 2)}\n`)

    await clickSelector('.zc-sidebar-footer .zc-icon-btn')
    await waitFor('Boolean(document.querySelector(".zc-settings"))', 'current reset Settings entry')
    await clickSelector('#settings-tab-general')
    await waitFor(
      'document.querySelector("#settings-tab-general")?.classList.contains("active")',
      'current reset General tab',
    )
    const invalidBackupPath = path.join(profileDir, 'browser-smoke-invalid-backup.json')
    await writeFile(invalidBackupPath, '{"kind":"not-an-encrypted-backup"}\n', 'utf8')
    await clickSelector('#settings-tab-data')
    await waitFor(
      'Boolean(document.querySelector("[data-zc-import-backup=\\"true\\"]"))',
      'current invalid backup import action',
    )
    const invalidBackupImportStarted = await evaluate(`(() => {
      const button = document.querySelector('[data-zc-import-backup="true"]')
      if (!(button instanceof HTMLButtonElement)) return false
      window.__zerochatInvalidBackupOriginalConfirm = window.confirm
      window.confirm = () => true
      button.focus()
      button.click()
      return document.activeElement === button
    })()`)
    assert.equal(
      invalidBackupImportStarted,
      true,
      'Current backup import must start from its stable button focus owner',
    )
    const invalidBackupToastCount = await evaluate(
      "document.querySelectorAll('.zc-toast').length",
    )
    await setFileInputFiles('.zc-data-settings input[type="file"]', [invalidBackupPath])
    await waitFor(
      `document.querySelectorAll('.zc-toast').length > ${invalidBackupToastCount}`,
      'current invalid backup localized failure',
    )
    await waitFor(
      "!document.querySelector('[data-zc-settings-data-pending=\"true\"]') && document.activeElement === document.querySelector('[data-zc-import-backup=\"true\"]')",
      'current invalid backup import focus restoration',
    )
    const invalidBackupImportState = await evaluate(`(() => {
      const input = document.querySelector('.zc-data-settings input[type="file"]')
      const originalConfirm = window.__zerochatInvalidBackupOriginalConfirm
      if (typeof originalConfirm === 'function') window.confirm = originalConfirm
      delete window.__zerochatInvalidBackupOriginalConfirm
      return {
        fileValue: input instanceof HTMLInputElement ? input.value : null,
        focused: document.activeElement === document.querySelector('[data-zc-import-backup="true"]'),
        settingsOpen: Boolean(document.querySelector('.zc-settings')),
      }
    })()`)
    assert.deepEqual(
      invalidBackupImportState,
      { fileValue: '', focused: true, settingsOpen: true },
      `Invalid backup import must keep Settings open and restore its stable action focus: ${JSON.stringify(invalidBackupImportState)}`,
    )
    await clickSelector('#settings-tab-general')
    await waitFor(
      'document.querySelector("#settings-tab-general")?.classList.contains("active")',
      'current reset General tab after invalid import',
    )
    await prepareHeldCurrentLocalSaveReset()
    await sleep(150)
    const heldResetState = await evaluate(`(() => {
      const fixture = window.__zerochatHeldLocalSaveFixture
      const pending = document.querySelector('[data-zc-settings-data-pending="true"]')
      const navigation = document.querySelector('.zc-settings-nav')
      const content = document.querySelector('.zc-settings-scroll')
      const reset = document.querySelector('[data-zc-reset-local="true"]')
      return {
        compact: document.querySelector('.zc-app')?.classList.contains('zc-compact') === true,
        contentInert: content?.inert === true,
        focusOnStatus: document.activeElement === pending,
        navigationInert: navigation?.inert === true,
        pendingBusy: pending?.getAttribute('aria-busy') === 'true',
        resetDisabled: reset instanceof HTMLButtonElement && reset.disabled,
        resetSettled: fixture?.resetSettled === true,
        resetSuccessVisible: [...document.querySelectorAll('.zc-toast')].some((toast) =>
          toast.classList.contains('success')),
        settingsOpen: Boolean(document.querySelector('.zc-settings')),
      }
    })()`)
    assert.deepEqual(
      heldResetState,
      {
        compact: true,
        contentInert: true,
        focusOnStatus: true,
        navigationInert: true,
        pendingBusy: true,
        resetDisabled: true,
        resetSettled: false,
        resetSuccessVisible: false,
        settingsOpen: true,
      },
      `current local reset must stay pending without early success while an older AppData save is held: ${JSON.stringify(heldResetState)}`,
    )
    const resetCompletionState = await evaluate(`(async () => {
      const fixture = window.__zerochatHeldLocalSaveFixture
      if (!fixture?.releaseHeldSave) {
        throw new Error('Current held local reset fixture is incomplete')
      }
      fixture.releaseHeldSave()
      const started = Date.now()
      while (!fixture.resetSettled && Date.now() - started < 12000) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (!fixture.resetSettled) throw new Error('Current local reset did not settle')
      fixture.restore()
      return {
        compact: document.querySelector('.zc-app')?.classList.contains('zc-compact') === true,
        resetError: fixture.resetError,
        resetSettled: fixture.resetSettled,
        settingsOpen: Boolean(document.querySelector('.zc-settings')),
      }
    })()`, true)
    assert.deepEqual(
      resetCompletionState,
      {
        compact: false,
        resetError: '',
        resetSettled: true,
        settingsOpen: false,
      },
      `Current local reset must adopt the atomically persisted fresh snapshot: ${JSON.stringify(resetCompletionState)}`,
    )

    const resetReloadStart = cdp.events.length
    await cdp.send('Page.navigate', { url: testUrl })
    await waitForPageLoadCompletion(resetReloadStart)
    await waitFor('document.readyState === "complete"', 'current local reset reload')
    await waitFor('Boolean(document.querySelector(".zc-app"))', 'current local reset app shell')
    const resetReloadState = await evaluate(`(() => ({
      compact: document.querySelector('.zc-app')?.classList.contains('zc-compact') === true,
      onboardingVisible: Boolean(document.querySelector('.zc-onboarding')),
    }))()`)
    assert.deepEqual(
      resetReloadState,
      { compact: false, onboardingVisible: false },
      `current local reset must persist the fresh first-run snapshot instead of resurrecting the held compact snapshot: ${JSON.stringify(resetReloadState)}`,
    )

    const copySentinel = 'browser-smoke-context-copy-rejection'
    const copyLeakState = await evaluate(`(() => {
      const sentinel = ${JSON.stringify(copySentinel)}
      const toastText = [...document.querySelectorAll('.zc-toast')]
        .map((toast) => toast.textContent || '')
        .join(' ')
      const bodyText = document.body?.innerText || ''
      return {
        body: bodyText.includes(sentinel),
        toast: toastText.includes(sentinel),
      }
    })()`)
    const serializedCopyLeaks = [
      ...runtimeExceptionPayloads,
      ...consoleApiPayloads,
      ...logEntryPayloads,
      ...runtimeErrors,
    ].filter((entry) => entry.includes(copySentinel))
    const consoleCopyLeaks = consoleErrors.filter((line) => line.includes(copySentinel))
    const expectedSafeDiagnostics = consoleErrors.filter(
      (line) => line === '[app] message copy failed',
    )
    const invalidBackupLeakSentinels = [
      invalidBackupPath,
      'not-an-encrypted-backup',
    ]
    const serializedInvalidBackupLeaks = [
      ...runtimeExceptionPayloads,
      ...consoleApiPayloads,
      ...logEntryPayloads,
      ...runtimeErrors,
      ...consoleErrors,
    ].filter((entry) =>
      invalidBackupLeakSentinels.some((sentinel) => entry.includes(sentinel)),
    )
    const expectedImportDiagnostics = consoleErrors.filter(
      (line) => line === '[app] import failed',
    )
    const fatalConsole = consoleErrors.filter(
      (line) =>
        !line.includes('favicon') &&
        !line.includes('Failed to load resource') &&
        line !== '[app] message copy failed' &&
        line !== '[app] import failed',
    )
    assert.deepEqual(runtimeErrors, [], `Browser runtime errors: ${runtimeErrors.join(' | ')}`)
    assert.deepEqual(
      serializedCopyLeaks,
      [],
      `Raw clipboard failure must not reach serialized CDP/runtime evidence: ${serializedCopyLeaks.join(' | ')}`,
    )
    assert.deepEqual(
      consoleCopyLeaks,
      [],
      `Raw clipboard failure must not reach extracted console arguments: ${consoleCopyLeaks.join(' | ')}`,
    )
    assert.deepEqual(
      copyLeakState,
      { body: false, toast: false },
      `Raw clipboard failure must not reach the DOM or toast output: ${JSON.stringify(copyLeakState)}`,
    )
    assert.deepEqual(
      serializedInvalidBackupLeaks,
      [],
      `Invalid backup paths and payloads must not reach console/runtime evidence: ${serializedInvalidBackupLeaks.join(' | ')}`,
    )
    assert.deepEqual(fatalConsole, [], `Browser console errors: ${fatalConsole.join(' | ')}`)
    assert.ok(
      expectedSafeDiagnostics.length >= 1,
      `Expected a fixed copy diagnostic without raw error data: ${JSON.stringify(expectedSafeDiagnostics)}`,
    )
    assert.equal(
      expectedImportDiagnostics.length,
      1,
      `Expected exactly one fixed import diagnostic without raw backup data: ${JSON.stringify(expectedImportDiagnostics)}`,
    )
    assert.equal(iconSyncDom.passed, true, `Icon and shell evidence failed: ${JSON.stringify(iconSyncDom)}`)
    console.log(`Browser skill smoke passed: ${JSON.stringify({ screenshotPath, performanceState })}`)
  } finally {
    cdp?.close()
    const profileCleanup = {
      removeProfile: async () => await removeBrowserProfileWithRetry(profileDir, 120),
    }
    let cleanup
    try {
      cleanup = await settleBrowserRuntimeCleanup({
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
      })
    } finally {
      await devServer?.close()
    }
    assert.equal(
      cleanup.profileRemoved,
      true,
      `Browser skill smoke profile cleanup failed: ${profileDir}`,
    )
  }
}

const smokeRun = main()
smokeRun.catch(() => undefined)

try {
  await waitForSmokeRun(smokeRun, browserSmokeTimeoutMs)
} catch (error) {
  console.error(`Browser skill smoke failure context: last CDP operation ${lastCdpOperation}`)
  throw error
}
