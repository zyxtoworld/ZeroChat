import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveFetchSafeLoopbackPort } from './fetch-safe-loopback-port.mjs'
import { startViteDevLoopbackServer } from './vite-loopback-server.mjs'
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

const MESSAGE_COUNT = 72
const MAX_RENDERED_MESSAGES = 50

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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run message virtualization smoke checks.')
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
  return connectCdp(wsUrl)
}

function createFixture() {
  const timestamp = Date.now()
  const conversationId = 'message-virtualization-smoke-conversation'
  const provider = {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    imageModel: 'gpt-image-2',
    models: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-image-2'],
    capabilities: [
      'chat',
      'vision',
      'tools',
      'image-generation',
      'image-editing',
      'model-list',
    ],
    enabled: true,
    needsApiKey: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const messages = Array.from({ length: MESSAGE_COUNT }, (_, index) => {
    const number = index + 1
    const role = index % 2 === 0 ? 'user' : 'assistant'
    const extra =
      index % 9 === 0
        ? '\n\nExtra paragraph to prove measured rows can vary without breaking the virtual spacer.'
        : ''

    return {
      id: `virtual-message-${String(number).padStart(2, '0')}`,
      role,
      content: `Virtualized message ${String(number).padStart(2, '0')} from ${role}.${extra}`,
      status: 'done',
      createdAt: timestamp + index,
    }
  })

  return {
    version: 1,
    providers: [provider],
    conversations: [
      {
        id: conversationId,
        title: 'Message virtualization smoke',
        providerId: provider.id,
        model: provider.model,
        messages,
        createdAt: timestamp,
        updatedAt: timestamp + MESSAGE_COUNT,
      },
    ],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
      gistFile: 'zerochat-sync.json',
      lastSyncAt: timestamp,
      lastSyncStatus: 'Message virtualization smoke baseline',
    },
    preferences: {
      firstRunDone: true,
      theme: 'light',
      language: 'zh-CN',
      compactMode: false,
      activeConversationId: conversationId,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
    },
    updatedAt: timestamp + MESSAGE_COUNT,
  }
}

const chromePath = await resolveChromePath()
const cdpPort = await resolveFetchSafeLoopbackPort(
  process.env.ZEROCHAT_VIRTUALIZATION_CDP_PORT,
  'Message virtualization Chrome remote debugging',
)
const providedAppUrl =
  process.env.ZEROCHAT_MESSAGE_VIRTUALIZATION_URL ?? process.env.ZEROCHAT_SMOKE_URL
let appUrl = providedAppUrl ?? ''
const profileDir = path.join(os.tmpdir(), `zerochat-message-virtualization-${Date.now()}`)
let devServer = null
let chrome = null
let cdp = null

await mkdir(profileDir, { recursive: true })

try {
  if (!providedAppUrl) {
    devServer = await startViteDevLoopbackServer({
      configuredPort: process.env.ZEROCHAT_VIRTUALIZATION_APP_PORT,
      serverLabel: 'Message virtualization app server',
    })
    appUrl = devServer.url
  }

  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      '--window-size=1280,820',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  chrome.zerochatProcessGroupLeader = process.platform !== 'win32'

  await waitForCdpChrome(cdpPort, { childProcess: chrome })

  const target = await readJson(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' },
  )
  cdp = await connect(target.webSocketDebuggerUrl)
  const runtimeErrors = []

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const NativeResizeObserver = globalThis.ResizeObserver
      if (typeof NativeResizeObserver !== 'function') return
      const stats = {
        callbacks: 0,
        constructed: 0,
        disconnected: 0,
        observed: 0,
        observedBorderBoxes: 0,
        observedMessageLists: 0,
        observedMessageRows: 0,
      }
      globalThis.__zeroChatVirtualResizeObserverStats = stats
      globalThis.ResizeObserver = class ZeroChatQaResizeObserver extends NativeResizeObserver {
        constructor(callback) {
          stats.constructed += 1
          super((entries, observer) => {
            stats.callbacks += 1
            callback(entries, observer)
          })
        }

        disconnect() {
          stats.disconnected += 1
          return super.disconnect()
        }

        observe(target, options) {
          stats.observed += 1
          if (options?.box === 'border-box') stats.observedBorderBoxes += 1
          if (target.classList?.contains('message-list')) stats.observedMessageLists += 1
          if (target.matches?.('[data-message-id]')) stats.observedMessageRows += 1
          return super.observe(target, options)
        }
      }
    })()`,
  })
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  })

  async function evaluate(expression, awaitPromise = false) {
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

  async function waitForLoad() {
    await evaluate(
      `new Promise((resolve) => {
        const done = () => resolve(document.readyState)
        if (document.readyState === 'complete') done()
        else window.addEventListener('load', done, { once: true })
      })`,
      true,
    )
  }

  async function waitForCondition(expression, label) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await evaluate(expression)) {
        return
      }
      await sleep(50)
    }

    const diagnostics = await evaluate(
      `(() => new Promise((resolve) => {
        const readSnapshot = () => new Promise((readResolve) => {
          const request = indexedDB.open('zerochat')
          request.onerror = () => readResolve({ error: String(request.error) })
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('documents', 'readonly')
            const get = tx.objectStore('documents').get('app')
            get.onsuccess = () => {
              const value = get.result
              db.close()
              readResolve({
                encrypted: Boolean(value && typeof value === 'object' && value.ciphertext),
                conversations: Array.isArray(value?.conversations) ? value.conversations.length : null,
                messages: Array.isArray(value?.conversations?.[0]?.messages)
                  ? value.conversations[0].messages.length
                  : null,
                activeConversationId: value?.preferences?.activeConversationId ?? null,
              })
            }
            get.onerror = () => {
              db.close()
              readResolve({ error: String(get.error) })
            }
          }
        })
        readSnapshot().then((snapshot) => resolve(JSON.stringify({
          url: location.href,
          readyState: document.readyState,
          bodyText: document.body?.innerText?.slice(0, 1000) ?? '',
          renderedMessages: document.querySelectorAll('[data-message-id]').length,
          snapshot,
        })))
      }))()`,
      true,
    )

    throw new Error(`Timed out waiting for ${label}: ${diagnostics}`)
  }

  const seedUrl = new URL('/manifest.webmanifest', appUrl).toString()
  await cdp.send('Page.navigate', { url: seedUrl })
  await waitForLoad()

  const fixture = createFixture()
  await evaluate(
    `(() => {
      const snapshot = ${JSON.stringify(fixture)}
      const deleteDatabase = (name) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name)
          request.onerror = () => reject(request.error)
          request.onblocked = () => reject(new Error('IndexedDB deletion blocked: ' + name))
          request.onsuccess = () => resolve(true)
        })
      const writeSnapshot = (value) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('zerochat')
          request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains('documents')) {
              db.createObjectStore('documents')
            }
          }
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('documents', 'readwrite')
            tx.objectStore('documents').put(value, 'app')
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
        })

      return Promise.all([
        deleteDatabase('zerochat-secrets'),
      ])
        .then(() => writeSnapshot(snapshot))
        .then(() => {
          localStorage.setItem('zerochat:secret:provider:openai', 'zerochat-virtualization-smoke-key')
          return true
        })
    })()`,
    true,
  )

  await cdp.send('Page.navigate', { url: appUrl })
  await waitForLoad()
  await waitForCondition(
    `document.querySelectorAll('[data-message-id]').length > 0`,
    'seeded virtualized messages',
  )
  await waitForCondition(
    `Array.from(document.querySelectorAll('[data-message-id]'))
      .some((message) => (message.textContent || '').includes('Virtualized message 72'))`,
    'latest virtualized message',
  )

  const stateExpression = `(() => {
    const list = document.querySelector('.message-list')
    const messages = Array.from(document.querySelectorAll('[data-message-id]'))
    const topSpacer = document.querySelector('[data-message-virtual-spacer="top"]')
    const bottomSpacer = document.querySelector('[data-message-virtual-spacer="bottom"]')
    const text = (message) => (message?.textContent || '').replace(/\\s+/g, ' ').trim()

    return {
      clientHeight: list?.clientHeight ?? 0,
      scrollHeight: list?.scrollHeight ?? 0,
      scrollTop: list?.scrollTop ?? 0,
      canScroll: list ? list.scrollHeight > list.clientHeight + 1 : false,
      renderedCount: messages.length,
      firstText: text(messages[0]),
      lastText: text(messages[messages.length - 1]),
      topSpacerHeight: topSpacer ? topSpacer.getBoundingClientRect().height : 0,
      bottomSpacerHeight: bottomSpacer ? bottomSpacer.getBoundingClientRect().height : 0,
      spacerCount: document.querySelectorAll('[data-message-virtual-spacer]').length,
      visibleMessageIds: messages.map((message) => message.getAttribute('data-message-id')),
    }
  })()`

  async function waitForVirtualStateStability(label) {
    let previousKey = ''
    let stableSamples = 0

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const state = await evaluate(stateExpression)
      const key = JSON.stringify({
        bottomSpacerHeight: state.bottomSpacerHeight,
        scrollHeight: state.scrollHeight,
        topSpacerHeight: state.topSpacerHeight,
        visibleMessageIds: state.visibleMessageIds,
      })

      if (key === previousKey) {
        stableSamples += 1
        if (stableSamples >= 2) {
          return state
        }
      } else {
        previousKey = key
        stableSamples = 0
      }

      await sleep(120)
    }

    throw new Error(
      `Timed out waiting for stable ${label}: ${JSON.stringify(await evaluate(stateExpression))}`,
    )
  }

  async function scrollToVirtualWindowStart(targetMessageId, label) {
    const targetNumber = Number.parseInt(targetMessageId.slice(-2), 10)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await evaluate(stateExpression)
      const firstMessageId = state.visibleMessageIds[0] ?? ''
      const firstNumber = Number.parseInt(firstMessageId.slice(-2), 10)

      if (firstMessageId === targetMessageId) {
        const stableState = await waitForVirtualStateStability(label)
        if (stableState.visibleMessageIds[0] === targetMessageId) {
          return stableState
        }

        continue
      }

      assert.ok(
        Number.isFinite(firstNumber) && Number.isFinite(targetNumber),
        `virtual window ids must remain numeric: ${JSON.stringify({ state, targetMessageId })}`,
      )

      const averageRowAdvance = Math.max(1, state.scrollHeight / MESSAGE_COUNT)
      const nextScrollTop = Math.max(
        0,
        state.scrollTop + (targetNumber - firstNumber) * averageRowAdvance,
      )
      await evaluate(`(() => {
        const list = document.querySelector('.message-list')
        list.scrollTo({ top: ${JSON.stringify(nextScrollTop)}, behavior: 'auto' })
        list.dispatchEvent(new Event('scroll', { bubbles: true }))
        return true
      })()`)
      await sleep(120)
    }

    throw new Error(
      `Timed out aligning ${label} to ${targetMessageId}: ${JSON.stringify(await evaluate(stateExpression))}`,
    )
  }

  const bottomState = await evaluate(stateExpression)
  assert.ok(
    bottomState.renderedCount < MESSAGE_COUNT &&
      bottomState.renderedCount <= MAX_RENDERED_MESSAGES,
    `bottom render should be virtualized: ${JSON.stringify(bottomState)}`,
  )
  assert.ok(
    bottomState.topSpacerHeight > 0 && bottomState.lastText.includes('Virtualized message 72'),
    `bottom render should keep the latest messages with a top spacer: ${JSON.stringify(bottomState)}`,
  )
  assert.ok(bottomState.canScroll, `virtualized list should remain scrollable: ${JSON.stringify(bottomState)}`)

  await evaluate(`(() => {
    const list = document.querySelector('.message-list')
    list.scrollTo({ top: 0, behavior: 'auto' })
    list.dispatchEvent(new Event('scroll', { bubbles: true }))
    return true
  })()`)
  await waitForCondition(
    `Array.from(document.querySelectorAll('[data-message-id]'))
      .some((message) => (message.textContent || '').includes('Virtualized message 01'))`,
    'first virtualized message after scrolling to top',
  )
  const topState = await waitForVirtualStateStability('top virtual window')
  assert.ok(
    topState.renderedCount < MESSAGE_COUNT &&
      topState.renderedCount <= MAX_RENDERED_MESSAGES,
    `top render should stay virtualized: ${JSON.stringify(topState)}`,
  )
  assert.ok(
    topState.firstText.includes('Virtualized message 01') &&
      topState.bottomSpacerHeight > 0,
    `top render should keep the first messages with a bottom spacer: ${JSON.stringify(topState)}`,
  )

  let measuredBottomState = null
  let previousMeasurementSignature = ''
  let measurementConvergenceCycles = 0

  for (let cycle = 1; cycle <= 10; cycle += 1) {
    await evaluate(`(() => {
      const list = document.querySelector('.message-list')
      list.scrollTo({ top: list.scrollHeight, behavior: 'auto' })
      list.dispatchEvent(new Event('scroll', { bubbles: true }))
      return true
    })()`)
    await waitForCondition(
      `Array.from(document.querySelectorAll('[data-message-id]'))
        .some((message) => (message.textContent || '').includes('Virtualized message 72'))`,
      `latest message during geometry convergence cycle ${cycle}`,
    )
    const bottomCandidate = await waitForVirtualStateStability(
      `bottom geometry convergence cycle ${cycle}`,
    )

    await evaluate(`(() => {
      const list = document.querySelector('.message-list')
      list.scrollTo({ top: 0, behavior: 'auto' })
      list.dispatchEvent(new Event('scroll', { bubbles: true }))
      return true
    })()`)
    await waitForCondition(
      `Boolean(document.querySelector('[data-message-id="virtual-message-01"]'))`,
      `first message during geometry convergence cycle ${cycle}`,
    )
    const topCandidate = await waitForVirtualStateStability(
      `top geometry convergence cycle ${cycle}`,
    )
    const measurementSignature = JSON.stringify({
      bottomTopSpacerHeight: bottomCandidate.topSpacerHeight,
      bottomVisibleMessageIds: bottomCandidate.visibleMessageIds,
      topBottomSpacerHeight: topCandidate.bottomSpacerHeight,
      topVisibleMessageIds: topCandidate.visibleMessageIds,
    })

    if (measurementSignature === previousMeasurementSignature) {
      measuredBottomState = bottomCandidate
      measurementConvergenceCycles = cycle
      break
    }

    previousMeasurementSignature = measurementSignature
  }

  assert.ok(
    measuredBottomState,
    `virtual measurement windows should converge before dynamic resize: ${JSON.stringify({
      previousMeasurementSignature,
    })}`,
  )
  const resizeObserverStatsBefore = await evaluate(
    `({ ...globalThis.__zeroChatVirtualResizeObserverStats })`,
  )
  const resizedMessageHeight = await evaluate(`(() => {
    const message = document.querySelector('[data-message-id="virtual-message-01"]')
    const before = message.getBoundingClientRect().height
    message.style.paddingBottom = '240px'
    return { before, after: message.getBoundingClientRect().height }
  })()`)
  assert.ok(
    resizedMessageHeight.after > resizedMessageHeight.before + 200,
    `dynamic message row should grow before observer measurement: ${JSON.stringify(resizedMessageHeight)}`,
  )
  await waitForCondition(
    `(() => {
      const stats = globalThis.__zeroChatVirtualResizeObserverStats
      return stats.callbacks > ${JSON.stringify(resizeObserverStatsBefore.callbacks)}
    })()`,
    'virtual row measurement after dynamic row resize',
  )
  await waitForVirtualStateStability('resized top virtual window')

  await evaluate(`(() => {
    const list = document.querySelector('.message-list')
    list.scrollTo({ top: list.scrollHeight, behavior: 'auto' })
    list.dispatchEvent(new Event('scroll', { bubbles: true }))
    return true
  })()`)
  await waitForCondition(
    `Array.from(document.querySelectorAll('[data-message-id]'))
      .some((message) => (message.textContent || '').includes('Virtualized message 72'))`,
    'latest message after dynamic row resize',
  )
  await waitForVirtualStateStability('resized bottom virtual window')
  const resizedBottomState = await scrollToVirtualWindowStart(
    measuredBottomState.visibleMessageIds[0],
    'dynamic resize comparison window',
  )
  const dynamicSpacerDelta =
    resizedBottomState.topSpacerHeight - measuredBottomState.topSpacerHeight
  const dynamicRowHeightDelta =
    resizedMessageHeight.after - resizedMessageHeight.before
  const resizeObserverStatsAfter = await evaluate(
    `({ ...globalThis.__zeroChatVirtualResizeObserverStats })`,
  )
  assert.ok(
    resizeObserverStatsAfter.callbacks > resizeObserverStatsBefore.callbacks &&
      resizeObserverStatsAfter.constructed > 0 &&
      resizeObserverStatsAfter.observedMessageLists > 0 &&
      resizeObserverStatsAfter.observedMessageRows > 0 &&
      resizeObserverStatsAfter.observedBorderBoxes === resizeObserverStatsAfter.observed,
    `dynamic message resize should reach the installed observer: ${JSON.stringify({
      resizeObserverStatsBefore,
      resizeObserverStatsAfter,
    })}`,
  )
  assert.ok(
    Math.abs(dynamicSpacerDelta - dynamicRowHeightDelta) < 2,
    `dynamic message resize should update the top spacer by the measured row delta: ${JSON.stringify({
      dynamicSpacerDelta,
      dynamicRowHeightDelta,
      measuredBottomState,
      resizedBottomState,
    })}`,
  )

  await evaluate(`(() => {
    const list = document.querySelector('.message-list')
    list.scrollTo({ top: Math.round((list.scrollHeight - list.clientHeight) / 2), behavior: 'auto' })
    list.dispatchEvent(new Event('scroll', { bubbles: true }))
    return true
  })()`)
  await sleep(250)
  const middleState = await evaluate(stateExpression)
  assert.ok(
    middleState.renderedCount < MESSAGE_COUNT &&
      middleState.renderedCount <= MAX_RENDERED_MESSAGES &&
      middleState.topSpacerHeight > 0 &&
      middleState.bottomSpacerHeight > 0,
    `middle render should use both spacers and keep a bounded DOM: ${JSON.stringify(middleState)}`,
  )

  for (const event of cdp.events) {
    if (event.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(event.params?.exceptionDetails?.text ?? 'runtime exception')
    }
    if (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error') {
      runtimeErrors.push(event.params.entry.text)
    }
  }

  assert.deepEqual(runtimeErrors, [], `runtime errors: ${runtimeErrors.join('\n')}`)

  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  const screenshotPath = path.resolve('.manual-qa', 'message-virtualization-smoke.png')
  await mkdir(path.dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))

  console.log(
    `Message virtualization smoke passed: ${JSON.stringify({
      bottomRendered: bottomState.renderedCount,
      dynamicSpacerDelta,
      measurementConvergenceCycles,
      resizeObserverCallbacks:
        resizeObserverStatsAfter.callbacks - resizeObserverStatsBefore.callbacks,
      topRendered: topState.renderedCount,
      middleRendered: middleState.renderedCount,
      screenshot: screenshotPath,
    })}`,
  )
} finally {
  cdp?.close()
  const profileCleanup = {
    removeProfile: async () => await removeBrowserProfileWithRetry(profileDir),
  }
  await settleBrowserRuntimeCleanup({
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
    additionalCleanup: [() => devServer?.close()],
  })
}
