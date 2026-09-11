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

const CONTEXT_LIMIT = 6
const CHAT_HISTORY_COUNT = 30
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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run chat context window smoke checks.')
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
    id: 'context-provider',
    name: 'Context Provider',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'context-model',
    imageModel: 'context-image-model',
    models: ['context-model', 'context-image-model'],
    capabilities: ['chat', 'image-generation', 'model-list'],
    enabled: true,
    needsApiKey: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const conversationId = 'chat-context-window-smoke-conversation'
  const chatMessages = Array.from({ length: CHAT_HISTORY_COUNT }, (_, index) => {
    const number = index + 1
    return {
      id: `context-turn-${number}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Context turn ${number}`,
      status: 'done',
      createdAt: timestamp + index + 2,
    }
  })

  return {
    version: 1,
    providers: [provider],
    conversations: [
      {
        id: conversationId,
        title: 'Chat context window smoke',
        providerId: provider.id,
        model: provider.model,
        messages: [
          {
            id: 'base-system',
            role: 'system',
            content: 'Base system prompt must stay',
            createdAt: timestamp,
          },
          {
            id: 'skill-system',
            role: 'system',
            content: 'Injected Skill prompt must stay',
            createdAt: timestamp + 1,
          },
          ...chatMessages,
        ],
        createdAt: timestamp,
        updatedAt: timestamp + CHAT_HISTORY_COUNT,
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
      chatContextMessageLimit: CONTEXT_LIMIT,
      activeConversationId: conversationId,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
    },
    updatedAt: timestamp + CHAT_HISTORY_COUNT,
  }
}

const chromePath = await resolveChromePath()
const cdpPort = await resolveFetchSafeLoopbackPort(
  process.env.ZEROCHAT_CONTEXT_CDP_PORT,
  'Chat context Chrome remote debugging',
)
const providedAppUrl =
  process.env.ZEROCHAT_CHAT_CONTEXT_URL ?? process.env.ZEROCHAT_SMOKE_URL
let appUrl = providedAppUrl ?? ''
const profileDir = path.join(os.tmpdir(), `zerochat-chat-context-${Date.now()}`)
let devServer = null
let chrome = null
let cdp = null

await mkdir(profileDir, { recursive: true })

try {
  if (!providedAppUrl) {
    devServer = await startViteDevLoopbackServer({
      configuredPort: process.env.ZEROCHAT_CONTEXT_APP_PORT,
      serverLabel: 'Chat context app server',
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      {
        const originalFetch = window.fetch.bind(window)
        window.__zeroChatContextPayloads = []
        window.__zeroChatRuntimeErrors = []
        window.addEventListener('error', (event) => {
          window.__zeroChatRuntimeErrors.push(event.error?.stack || event.message || 'window error')
        })
        window.addEventListener('unhandledrejection', (event) => {
          window.__zeroChatRuntimeErrors.push(event.reason?.stack || event.reason?.message || String(event.reason))
        })
        window.fetch = (input, init = {}) => {
          const url = typeof input === 'string' ? input : input?.url ?? ''
          const body = typeof init?.body === 'string' ? init.body : ''
          const headers = new Headers(init?.headers ?? input?.headers ?? {})
          const action = headers.get('x-zerochat-proxy-action') ?? ''
          const isChatRequest =
            /\\/(chat\\/completions|responses|messages)(?:$|[?#])/.test(url) ||
            action === 'chat'
          const isModelsRequest =
            /\\/models(?:$|[?#])/.test(url) ||
            action === 'models'

          if (isModelsRequest) {
            return Promise.resolve(new Response(
              JSON.stringify({ data: [{ id: 'context-model' }, { id: 'context-image-model' }] }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ))
          }

          if (isChatRequest) {
            try {
              window.__zeroChatContextPayloads.push(JSON.parse(body))
            } catch {
              window.__zeroChatContextPayloads.push(null)
            }
            return Promise.resolve(new Response(
              'data: {"choices":[{"delta":{"content":"Context smoke reply"}}]}\\n\\n' +
                'data: {"type":"response.output_text.delta","delta":"Context smoke reply"}\\n\\n' +
                'data: [DONE]\\n\\n',
              { status: 200, headers: { 'content-type': 'text/event-stream' } },
            ))
          }

          return originalFetch(input, init)
        }
      }
    `,
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

      return deleteDatabase('zerochat-secrets')
        .then(() => writeSnapshot(snapshot))
        .then(() => {
          localStorage.setItem('zerochat:secret:provider:context-provider', 'zerochat-context-smoke-key')
          return true
        })
    })()`,
    true,
  )

  await cdp.send('Page.navigate', { url: appUrl })
  await waitForLoad()
  await waitForCondition(
    `Array.from(document.querySelectorAll('[data-message-id]'))
      .some((message) => (message.textContent || '').includes('Context turn 30'))`,
    'seeded chat context fixture',
  )

  await evaluate(
    `(() => {
      const textarea = document.querySelector('.composer textarea')
      const button = document.querySelector('.send-button[type="submit"]')
      if (!textarea || !button) throw new Error('Missing composer controls')
      textarea.focus()
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        .set.call(textarea, 'Context window final prompt')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
  )
  await waitForCondition(
    `document.querySelector('.send-button[type="submit"]')?.disabled === false`,
    'enabled chat send button',
  )
  await evaluate(`document.querySelector('.send-button[type="submit"]')?.click()`)
  await waitForCondition(
    `window.__zeroChatContextPayloads?.length === 1`,
    'captured chat context payload',
  )

  const payloadState = await evaluate(
    `(() => {
      const payload = window.__zeroChatContextPayloads[0]
      const messages = payload?.messages ?? payload?.input ?? []
      return {
        count: messages.length,
        roles: messages.map((message) => message.role),
        contents: messages.map((message) => message.content),
      }
    })()`,
  )

  // System and skill prompts are always preserved; the configured context
  // window applies only to the paired non-system history.
  const expectedContents = [
    'Base system prompt must stay',
    'Injected Skill prompt must stay',
    'Context turn 27',
    'Context turn 28',
    'Context turn 29',
    'Context turn 30',
    'Context window final prompt',
  ]

  assert.equal(payloadState.count, expectedContents.length, JSON.stringify(payloadState))
  assert.deepEqual(payloadState.contents, expectedContents, JSON.stringify(payloadState))
  assert.ok(
    !payloadState.contents.includes('Context turn 26'),
    JSON.stringify(payloadState),
  )

  await evaluate(
    `(() => {
      const opener =
        document.querySelector('button[aria-label="设置"]') ??
        document.querySelector('button[aria-label="Settings"]')
      opener?.click()
      return true
    })()`,
  )
  await waitForCondition(
    `document.querySelector('.zc-settings-overlay #settings-tab-general') !== null`,
    'settings modal',
  )

  await evaluate(`document.querySelector('#settings-tab-general')?.click()`)
  await waitForCondition(
    `document.querySelector('.zc-settings-scroll select option[value="zh-CN"]') !== null`,
    'settings general tab',
  )
  const settingsState = await evaluate(`(() => {
    const field = document.querySelector(
      '[data-chat-context-setting="true"] input[type="number"]',
    )
    if (!(field instanceof HTMLInputElement)) {
      return { exists: false }
    }
    const descriptionId = field.getAttribute('aria-describedby') || ''
    return {
      exists: true,
      fieldValue: Number(field.value),
      min: Number(field.min),
      max: Number(field.max),
      description: document.getElementById(descriptionId)?.textContent?.trim() || '',
    }
  })()`)
  assert.equal(settingsState.exists, true, JSON.stringify(settingsState))
  assert.equal(settingsState.fieldValue, CONTEXT_LIMIT, JSON.stringify(settingsState))
  assert.equal(settingsState.min, 4, JSON.stringify(settingsState))
  assert.equal(settingsState.max, 200, JSON.stringify(settingsState))
  assert.notEqual(settingsState.description, '', JSON.stringify(settingsState))

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
  const screenshotPath = path.resolve('.manual-qa', 'chat-context-window-smoke.png')
  await mkdir(path.dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))

  console.log(
    `Chat context window smoke passed: ${JSON.stringify({
      payloadMessages: payloadState.count,
      fieldValue: settingsState.fieldValue,
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
