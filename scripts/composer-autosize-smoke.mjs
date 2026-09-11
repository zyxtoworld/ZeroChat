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

const LONG_PROMPT_LINES = 8

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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run composer autosize smoke checks.')
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
  const provider = {
    id: 'autosize-provider',
    name: 'Autosize Provider',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'autosize-model',
    imageModel: 'autosize-image-model',
    models: ['autosize-model', 'autosize-image-model'],
    capabilities: ['chat', 'image-generation', 'model-list'],
    enabled: true,
    needsApiKey: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const conversationId = 'composer-autosize-smoke-conversation'

  return {
    version: 1,
    providers: [provider],
    conversations: [
      {
        id: conversationId,
        title: 'Composer autosize smoke',
        providerId: provider.id,
        model: provider.model,
        messages: [
          {
            id: 'autosize-welcome',
            role: 'assistant',
            content: 'Composer autosize smoke fixture',
            status: 'done',
            createdAt: timestamp,
          },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
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
    },
    preferences: {
      firstRunDone: true,
      theme: 'light',
      language: 'zh-CN',
      compactMode: false,
      chatContextMessageLimit: 24,
      activeConversationId: conversationId,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
    },
    updatedAt: timestamp,
  }
}

const chromePath = await resolveChromePath()
const cdpPort = await resolveFetchSafeLoopbackPort(
  process.env.ZEROCHAT_COMPOSER_AUTOSIZE_CDP_PORT,
  'Composer autosize Chrome remote debugging',
)
const providedAppUrl =
  process.env.ZEROCHAT_COMPOSER_AUTOSIZE_URL ?? process.env.ZEROCHAT_SMOKE_URL
let appUrl = providedAppUrl ?? ''
const profileDir = path.join(os.tmpdir(), `zerochat-composer-autosize-${Date.now()}`)
let previewServer = null
let chrome = null
let cdp = null

await mkdir(profileDir, { recursive: true })

try {
  if (!providedAppUrl) {
    // Serve the production dist/ build from the single HTML entry so this smoke
    // runs against the same bundle QA ships.
    await access(path.resolve('dist', 'index.html')).catch(() => {
      throw new Error(
        'dist/index.html is missing. Run node scripts/web-production-build.mjs before composer autosize smoke.',
      )
    })
    previewServer = await startVitePreviewLoopbackServer({
      configuredPort: process.env.ZEROCHAT_COMPOSER_AUTOSIZE_APP_PORT,
      serverLabel: 'Composer autosize app server',
    })
    appUrl = previewServer.url
  }

  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      '--window-size=390,780',
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 780,
    deviceScaleFactor: 1,
    mobile: true,
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

  async function waitForCondition(expression, label, diagnosticExpression) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await evaluate(expression)) {
        return
      }
      await sleep(50)
    }

    const diagnostic = diagnosticExpression
      ? await evaluate(diagnosticExpression)
      : undefined
    throw new Error(
      `Timed out waiting for ${label}${diagnostic ? `: ${JSON.stringify(diagnostic)}` : ''}`,
    )
  }

  async function setComposerValue(value) {
    await evaluate(
      `(() => {
        const textarea = document.querySelector('[data-composer-autosize="true"]')
        if (!textarea) throw new Error('Missing composer autosize textarea')
        textarea.focus()
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
          .set.call(textarea, ${JSON.stringify(value)})
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`,
    )
  }

  async function waitForComposerValue(value, label) {
    const lineCount = value.split('\n').length
    await waitForCondition(
      `(() => {
        const el = document.querySelector('[data-composer-autosize="true"]')
        if (!el || el.value !== ${JSON.stringify(value)}) return false
        // The composer resizes in a React effect after the controlled value commit.
        // Wait until the height has
        // settled to this value's expected size before sampling metrics.
        const styles = getComputedStyle(el)
        const lineHeight = parseFloat(styles.lineHeight)
        const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
          .map((key) => parseFloat(styles[key]) || 0)
          .reduce((sum, n) => sum + n, 0)
        const minHeightPx = parseFloat(styles.minHeight)
        const maxHeightPx = parseFloat(styles.maxHeight)
        const cap = Number.isFinite(maxHeightPx) ? maxHeightPx : lineHeight * 5 + chrome
        const contentHeight = lineHeight * ${lineCount} + chrome
        const expected = Math.min(
          Math.max(contentHeight, Number.isFinite(minHeightPx) ? minHeightPx : 0),
          cap,
        )
        return Math.abs(el.getBoundingClientRect().height - expected) <= 1.5
      })()`,
      label,
      `(() => {
        const el = document.querySelector('[data-composer-autosize="true"]')
        return {
          exists: Boolean(el),
          value: el?.value ?? null,
          disabled: el?.disabled ?? null,
          readOnly: el?.readOnly ?? null,
          activeElementIsComposer: document.activeElement === el,
          dataStatus: document.querySelector('[data-app-status]')?.getAttribute('data-app-status') ?? null,
        }
      })()`,
    )
  }

  async function composerMetrics() {
    return evaluate(
      `(() => {
        const textarea = document.querySelector('[data-composer-autosize="true"]')
        if (!textarea) throw new Error('Missing composer autosize textarea')
        const rect = textarea.getBoundingClientRect()
        const styles = getComputedStyle(textarea)
        const lineHeight = parseFloat(styles.lineHeight)
        const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
          .map((key) => parseFloat(styles[key]) || 0)
          .reduce((sum, value) => sum + value, 0)
        // The composer uses the CSS max-height contract in src/app/app.css
        // (.zc-composer textarea, ~180px), so accept heights within that bound.
        const maxHeightPx = parseFloat(styles.maxHeight)
        return {
          value: textarea.value,
          height: rect.height,
          clientHeight: textarea.clientHeight,
          scrollHeight: textarea.scrollHeight,
          overflowY: styles.overflowY,
          lineHeight,
          chrome,
          maxFiveRowHeight: Math.ceil(lineHeight * 5 + chrome),
          capHeight: Number.isFinite(maxHeightPx)
            ? Math.max(Math.ceil(lineHeight * 5 + chrome), Math.ceil(maxHeightPx))
            : Math.ceil(lineHeight * 5 + chrome),
        }
      })()`,
    )
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

      return deleteDatabase('zerochat-secrets')
        .then(() => writeSnapshot(snapshot))
        .then(() => {
          localStorage.setItem('zerochat:secret:provider:autosize-provider', 'zerochat-autosize-key')
          return true
        })
    })()`,
    true,
  )

  await cdp.send('Page.navigate', { url: appUrl })
  await waitForLoad()
  await waitForCondition(
    `document.querySelector('[data-composer-autosize="true"]') !== null`,
    'composer autosize textarea',
  )

  await setComposerValue('Short prompt')
  await waitForComposerValue('Short prompt', 'single-line composer value')
  const singleLine = await composerMetrics()

  const threePrompt = ['Line 1', 'Line 2', 'Line 3'].join('\n')
  await setComposerValue(threePrompt)
  await waitForComposerValue(threePrompt, 'three-line composer value')
  const threeLine = await composerMetrics()

  const longPrompt = Array.from(
    { length: LONG_PROMPT_LINES },
    (_, index) => `Long composer line ${index + 1}`,
  ).join('\n')
  await setComposerValue(longPrompt)
  await waitForComposerValue(longPrompt, 'long composer value')
  const longLine = await composerMetrics()

  assert.ok(
    threeLine.height > singleLine.height + threeLine.lineHeight * 1.4,
    `composer should grow from one to three rows: ${JSON.stringify({ singleLine, threeLine })}`,
  )
  assert.equal(
    singleLine.overflowY,
    'hidden',
    `single-line composer should not expose an internal scrollbar: ${JSON.stringify(singleLine)}`,
  )
  assert.equal(
    threeLine.overflowY,
    'hidden',
    `composer should not expose an internal scrollbar before the row cap: ${JSON.stringify(threeLine)}`,
  )
  assert.ok(
    longLine.height <= longLine.maxFiveRowHeight + 2,
    `composer should cap at five rows: ${JSON.stringify(longLine)}`,
  )
  assert.ok(
    longLine.scrollHeight > longLine.clientHeight + 1 && longLine.overflowY === 'auto',
    `composer should scroll internally past the row cap: ${JSON.stringify(longLine)}`,
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
  const screenshotPath = path.resolve('.manual-qa', 'composer-autosize-smoke.png')
  await mkdir(path.dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))

  console.log(
    `Composer autosize smoke passed: ${JSON.stringify({
      singleLineHeight: singleLine.height,
      threeLineHeight: threeLine.height,
      longLineHeight: longLine.height,
      maxFiveRowHeight: longLine.maxFiveRowHeight,
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
    additionalCleanup: [() => previewServer?.close()],
  })
}
