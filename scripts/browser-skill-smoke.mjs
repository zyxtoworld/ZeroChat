import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  findFetchSafeLoopbackPort,
  resolveFetchSafeLoopbackPort,
} from './fetch-safe-loopback-port.mjs'
import { startViteDevLoopbackServer } from './vite-loopback-server.mjs'
import {
  connectCdp,
  findMainFrameLoadCompletionEvent,
  readJson as readCdpJson,
  waitForChrome as waitForCdpChrome,
} from './browser-cdp.mjs'
import {
  removeBrowserProfileWithRetry,
  stopChildProcessTree,
} from './browser-runtime-cleanup.mjs'

const configuredBrowserSmokeTimeoutMs = Number(process.env.ZEROCHAT_BROWSER_SMOKE_TIMEOUT_MS)
const browserSmokeTimeoutMs =
  Number.isInteger(configuredBrowserSmokeTimeoutMs) && configuredBrowserSmokeTimeoutMs > 0
    ? configuredBrowserSmokeTimeoutMs
    : 240_000

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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run browser smoke checks.')
}

function extractSupportedLocales(source) {
  const match = source.match(/const supportedLocales:\s*Locale\[\]\s*=\s*\[([\s\S]*?)\]/)

  if (!match) {
    throw new Error('Unable to find supportedLocales in src/i18n.ts.')
  }

  const locales = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])

  if (locales.length === 0) {
    throw new Error('src/i18n.ts supportedLocales is empty.')
  }

  return locales
}

function localeDirection(locale) {
  return locale === 'ar-SA' ? 'rtl' : 'ltr'
}

const smokeLanguageLocales = extractSupportedLocales(
  await readFile('src/i18n.ts', 'utf8'),
).map((locale) => [locale, localeDirection(locale)])
const chromePath = await resolveChromePath()
const port =
  await resolveFetchSafeLoopbackPort(
    process.env.ZEROCHAT_SMOKE_CDP_PORT,
    'Browser smoke Chrome remote debugging',
  )
const providedAppUrl = process.env.ZEROCHAT_SMOKE_URL
let appUrl = providedAppUrl ?? ''
const streamingSmokePort = await findFetchSafeLoopbackPort('Browser smoke streaming server')
const profileDir = path.join(os.tmpdir(), `zerochat-skill-smoke-${Date.now()}`)
let lastCdpOperation = 'starting Browser smoke'
const iconSyncDomReportPath = process.env.ZEROCHAT_ICON_SYNC_DOM_REPORT
  ? path.resolve(process.env.ZEROCHAT_ICON_SYNC_DOM_REPORT)
  : undefined
const streamingSmokeFrames = [
  {
    delayMs: 500,
    chunk:
      `: ${' '.repeat(4096)}\n` +
      'data: {"choices":[{"delta":{"content":"Streaming token smoke: first "}}]}\n' +
      'data: {"type":"response.output_text.delta","delta":"Streaming token smoke: first "}\n\n',
  },
  {
    delayMs: 3500,
    chunk:
      'data: {"choices":[{"delta":{"content":"second"}}]}\n' +
      'data: {"type":"response.output_text.delta","delta":"second"}\n\n',
  },
  {
    delayMs: 6500,
    chunk: 'data: [DONE]\n\n',
  },
]

await mkdir(profileDir, { recursive: true })

function iconSyncDomProbeSource() {
  return `(async () => {
    const visible = (element) => {
      if (!element) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const normalizeText = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitFor = async (predicate, timeout = 2500) => {
      const started = Date.now()
      while (Date.now() - started < timeout) {
        const value = predicate()
        if (value) return value
        await sleep(50)
      }
      return predicate()
    }
    const actionable = (control) => {
      const style = getComputedStyle(control)
      const disabled = Boolean(control.disabled) || control.getAttribute('aria-disabled') === 'true'
      return (
        visible(control) &&
        !disabled &&
        style.pointerEvents !== 'none' &&
        control.tabIndex >= 0 &&
        control.matches('button, a, [role="button"]')
      )
    }

    const collect = () => {
      const faviconLinks = [...document.querySelectorAll('link[rel~="icon"]')].map((link) => ({
        href: link.getAttribute('href') || '',
        type: link.getAttribute('type'),
        sizes: link.getAttribute('sizes'),
      }))
      const appLogos = [...document.querySelectorAll('.app-logo')].map((logo) => ({
        src: logo.getAttribute('src') || '',
        resolvedSrc: logo.src || '',
        className: logo.className || '',
        visible: visible(logo),
        complete: Boolean(logo.complete),
        naturalWidth: Number(logo.naturalWidth || 0),
        naturalHeight: Number(logo.naturalHeight || 0),
      }))
      const controls = [...document.querySelectorAll('button, a, [role="button"]')].map((control) => ({
        tag: control.tagName.toLowerCase(),
        role: control.getAttribute('role') || '',
        type: control.getAttribute('type') || '',
        text: normalizeText(control.textContent),
        ariaLabel: control.getAttribute('aria-label') || '',
        ariaDisabled: control.getAttribute('aria-disabled') || '',
        title: control.getAttribute('title') || '',
        visible: visible(control),
        disabled: Boolean(control.disabled),
        pointerEvents: getComputedStyle(control).pointerEvents,
        tabIndex: control.tabIndex,
        actionable: actionable(control),
        className: String(control.className || ''),
      }))
      const exactSyncControls = controls.filter((control) => control.text === '本地 · 开启云同步')
      const exactSyncAriaControls = controls.filter(
        (control) => control.ariaLabel === '云同步: 本地 · 开启云同步 · 云同步关闭',
      )
      const visibleFaviconLogoCount = appLogos.filter(
        (logo) =>
          logo.visible &&
          logo.complete &&
          logo.naturalWidth > 0 &&
          logo.naturalHeight > 0 &&
          (logo.src.endsWith('/favicon.svg') || logo.src.endsWith('favicon.svg')),
      ).length
      const hasFaviconLink = faviconLinks.some(
        (link) =>
          link.href === './favicon.svg' ||
          link.href === 'favicon.svg' ||
          link.href.endsWith('/favicon.svg'),
      )
      const visibleExactSyncControlCount = exactSyncControls.filter((control) => control.visible).length
      const visibleExactSyncAriaCount = exactSyncAriaControls.filter((control) => control.visible).length
      const clickableExactSyncControls = exactSyncControls.filter((control) => control.actionable)
      const clickableExactSyncAriaControls = exactSyncAriaControls.filter((control) => control.actionable)
      const clickableExactSyncControlCount = clickableExactSyncControls.length
      const clickableExactSyncAriaCount = clickableExactSyncAriaControls.length
      const passed =
        document.documentElement.lang === 'zh-CN' &&
        (document.documentElement.dir || 'ltr') === 'ltr' &&
        hasFaviconLink &&
        visibleFaviconLogoCount >= 1 &&
        visibleExactSyncControlCount >= 2 &&
        visibleExactSyncAriaCount >= 2 &&
        clickableExactSyncControlCount >= 2 &&
        clickableExactSyncAriaCount >= 2 &&
        ['sync-pill', 'chat-sync-strip'].every((className) =>
          clickableExactSyncControls.some((control) => control.className.includes(className)) &&
          clickableExactSyncAriaControls.some((control) => control.className.includes(className)),
        )

      return {
        url: location.href,
        documentLanguage: document.documentElement.lang,
        documentDirection: document.documentElement.dir || 'ltr',
        faviconLinks,
        hasFaviconLink,
        appLogos,
        visibleFaviconLogoCount,
        exactSyncControls,
        exactSyncAriaControls,
        visibleExactSyncControlCount,
        visibleExactSyncAriaCount,
        clickableExactSyncControlCount,
        clickableExactSyncAriaCount,
        passed,
      }
    }

    const closeSettings = async () => {
      const closeButton = document.querySelector(
        'button[aria-label="关闭设置"], button[aria-label="Close settings"]',
      )
      if (closeButton) {
        closeButton.click()
      }
      await waitFor(() => !document.querySelector('.settings-modal'))
    }

    const syncSettingsOpenState = () => {
      const selectedSyncTab = document.querySelector('#settings-tab-sync[aria-selected="true"]')
      const syncPanel = document.querySelector('.sync-settings[role="tabpanel"]')
      const settingsModal = document.querySelector('.settings-modal')
      return {
        modalVisible: visible(settingsModal),
        selectedSyncTab: Boolean(selectedSyncTab),
        syncPanelVisible: visible(syncPanel),
        settingsTitle: normalizeText(document.querySelector('#settings-title')?.textContent),
        syncHeading: normalizeText(syncPanel?.querySelector('h3')?.textContent),
      }
    }

    const clickSyncControlOpensSyncSettings = async (className) => {
      await closeSettings()
      const control = [...document.querySelectorAll('.' + className)].find(
        (candidate) =>
          normalizeText(candidate.textContent) === '本地 · 开启云同步' &&
          candidate.getAttribute('aria-label') === '云同步: 本地 · 开启云同步 · 云同步关闭',
      )
      const before = control
        ? {
            text: normalizeText(control.textContent),
            ariaLabel: control.getAttribute('aria-label') || '',
            actionable: actionable(control),
            className: String(control.className || ''),
          }
        : null

      if (control && before.actionable) {
        control.click()
      }

      const state = await waitFor(() => {
        const current = syncSettingsOpenState()
        return current.modalVisible && current.selectedSyncTab && current.syncPanelVisible
          ? current
          : null
      })

      await closeSettings()
      const afterCloseState = syncSettingsOpenState()

      return {
        className,
        controlFound: Boolean(control),
        clicked: Boolean(control && before?.actionable),
        before,
        openedState: state ?? syncSettingsOpenState(),
        afterCloseModalVisible: afterCloseState.modalVisible,
        openedSyncSettings: Boolean(
          state?.modalVisible &&
            state?.selectedSyncTab &&
            state?.syncPanelVisible &&
            state?.syncHeading === '云同步',
        ),
      }
    }

    const collectSyncSettingsOpenProofs = async () => {
      const proofs = []
      for (const className of ['sync-pill', 'chat-sync-strip']) {
        proofs.push(await clickSyncControlOpensSyncSettings(className))
      }
      return proofs
    }

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const report = collect()
      if (report.passed) {
        const syncSettingsOpenProofs = await collectSyncSettingsOpenProofs()
        const syncSettingsOpenProofCount = syncSettingsOpenProofs.filter(
          (proof) => proof.openedSyncSettings,
        ).length
        return {
          ...collect(),
          syncSettingsOpenProofs,
          syncSettingsOpenProofCount,
          passed: syncSettingsOpenProofCount === 2 && collect().passed,
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const syncSettingsOpenProofs = await collectSyncSettingsOpenProofs()
    const syncSettingsOpenProofCount = syncSettingsOpenProofs.filter(
      (proof) => proof.openedSyncSettings,
    ).length
    return {
      ...collect(),
      syncSettingsOpenProofs,
      syncSettingsOpenProofCount,
      passed: syncSettingsOpenProofCount === 2 && collect().passed,
    }
  })()`
}

let devServer = null
if (!providedAppUrl) {
  devServer = await startViteDevLoopbackServer({
    configuredPort: process.env.ZEROCHAT_SMOKE_APP_PORT,
    serverLabel: 'Browser smoke app server',
  })
  appUrl = devServer.url
}

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  {
    stdio: 'ignore',
  },
)

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function waitForSmokeRun(run, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      reject(new Error(`Browser skill smoke timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    run.then(
      (value) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

async function readJson(url, init) {
  return readCdpJson(url, init)
}

async function waitForChrome() {
  return waitForCdpChrome(port)
}

function connect(wsUrl) {
  return connectCdp(wsUrl)
}

async function main() {
  let cdp
  let cdpOperationIndex = 0

  try {
    lastCdpOperation = 'waiting for Chrome remote debugging'
    await waitForChrome()
    lastCdpOperation = 'creating a Chrome DevTools target'
    const target = await readJson(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(appUrl)}`,
      { method: 'PUT' },
    )
    lastCdpOperation = 'opening the Chrome DevTools socket'
    const rawCdp = await connect(target.webSocketDebuggerUrl)
    cdp = {
      ...rawCdp,
      send(method, params = {}, sendOptions = {}) {
        cdpOperationIndex += 1
        lastCdpOperation = `#${cdpOperationIndex} ${method}`
        return rawCdp.send(method, params, sendOptions)
      },
    }
    const errors = []

    await cdp.send('Page.enable')
    const pageFrameTree = await cdp.send('Page.getFrameTree')
    const mainFrameId = pageFrameTree.frameTree?.frame?.id
    assert.ok(mainFrameId, 'Browser smoke could not resolve the main CDP frame')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Network.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(navigator, 'languages', {
          configurable: true,
          get: () => ['fr-FR', 'en-US'],
        })
        Object.defineProperty(navigator, 'language', {
          configurable: true,
          get: () => 'fr-FR',
        })
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value) => {
              window.__zeroChatCopiedText = String(value)
            },
          },
        })
        localStorage.setItem(
          'zerochat:secret:provider:openai',
          'zerochat-sync-smoke-provider-key',
        )
        {
          const originalFetch = window.fetch.bind(window)
          window.__zeroChatCopiedText = ''
          window.__zeroChatImageRequestStarted = false
          window.__zeroChatImageRequestUrl = ''
          window.__zeroChatChatRequestCount = 0
          window.__zeroChatModelCheckRequestCount = 0
          window.__zeroChatModelsRequestCount = 0
          window.__zeroChatResolveProviderLoadingModels = null
          window.__zeroChatResolveModelCheck = null
          window.__zeroChatStreamingSmokeRequestCount = 0
          window.__zeroChatManualRetrySmokeRequestCount = 0
          window.__zeroChatCloudSyncRequests = []
          window.__zeroChatCloudSyncStore = {
            generation: '00000000-0000-4000-8000-000000000001',
            head: null,
            objects: {},
          }
          window.__zeroChatRuntimeErrors = []
          window.addEventListener('error', (event) => {
            window.__zeroChatRuntimeErrors.push(
              event.error?.stack || event.message || 'window error',
            )
          })
          window.addEventListener('unhandledrejection', (event) => {
            window.__zeroChatRuntimeErrors.push(
              event.reason?.stack || event.reason?.message || String(event.reason),
            )
          })
          window.fetch = (input, init = {}) => {
            const url = typeof input === 'string' ? input : input?.url ?? ''
            const headers = new Headers(init?.headers ?? input?.headers ?? {})
            const action = headers.get('x-zerochat-proxy-action') ?? ''
            const requestBody = typeof init?.body === 'string' ? init.body : ''
            const requestPayload = (() => {
              try {
                return requestBody ? JSON.parse(requestBody) : null
              } catch {
                return null
              }
            })()
            const requestMessages = Array.isArray(requestPayload?.messages)
              ? requestPayload.messages
              : Array.isArray(requestPayload?.input)
                ? requestPayload.input
                : []
            const latestUserContent = [...requestMessages]
              .reverse()
              .find((item) => item?.role === 'user')?.content
            const hasResponsesImageGenerationTool =
              Array.isArray(requestPayload?.tools) &&
              requestPayload.tools.some((tool) => tool?.type === 'image_generation')
            const isImageRequest =
              /\\/images\\/(generations|edits)(?:$|[?#])/.test(url) ||
              (/\\/responses(?:$|[?#])/.test(url) && hasResponsesImageGenerationTool) ||
              action === 'image-generations' ||
              action === 'image-edits' ||
              action === 'image-responses'
            const isChatRequest =
              /\\/(chat\\/completions|responses|messages)(?:$|[?#])/.test(url) ||
              action === 'chat'
            const isModelsRequest =
              /\\/models(?:$|[?#])/.test(url) ||
              action === 'models'
            const eventStreamForText = (content) =>
              'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\\n\\n' +
                'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: content }) + '\\n\\n' +
                'data: [DONE]\\n\\n'
            const delayedEventStreamResponse = (frames) => {
              const encoder = new TextEncoder()
              const timers = new Set()
              const stream = new ReadableStream({
                start(controller) {
                  frames.forEach(({ chunk, delayMs }, index) => {
                    const timer = setTimeout(() => {
                      timers.delete(timer)
                      controller.enqueue(encoder.encode(chunk))
                      if (index === frames.length - 1) {
                        controller.close()
                      }
                    }, delayMs)
                    timers.add(timer)
                  })
                },
                cancel() {
                  for (const timer of timers) {
                    clearTimeout(timer)
                  }
                  timers.clear()
                },
              })

              return new Response(stream, {
                status: 200,
                headers: {
                  'cache-control': 'no-cache, no-transform',
                  'content-type': 'text/event-stream; charset=utf-8',
                },
              })
            }
            const syncSmokeUrl = (() => {
              try {
                const parsed = new URL(url, window.location.href)
                return parsed.origin === ${JSON.stringify(`http://127.0.0.1:${streamingSmokePort}`)} &&
                  (parsed.pathname === '/sync/head' ||
                    parsed.pathname.startsWith('/sync/object/') ||
                    parsed.pathname === '/snapshot' ||
                    parsed.pathname === '/sync/clear')
                  ? parsed
                  : null
              } catch {
                return null
              }
            })()

            if (syncSmokeUrl) {
              const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase()
              const body = typeof init?.body === 'string' ? init.body : ''
              const requestRecord = {
                bodyLength: body.length,
                hasAuthorization: headers.has('authorization'),
                method,
                path: syncSmokeUrl.pathname,
                time: Date.now(),
              }
              window.__zeroChatCloudSyncRequests.push(requestRecord)

              if (syncSmokeUrl.pathname === '/sync/head') {
                if (method === 'GET') {
                  const generation = window.__zeroChatCloudSyncStore.generation
                  return Promise.resolve(
                    window.__zeroChatCloudSyncStore.head
                      ? new Response(JSON.stringify(window.__zeroChatCloudSyncStore.head), {
                          status: 200,
                          headers: {
                            'content-type': 'application/json',
                            'x-zerochat-sync-generation': generation,
                          },
                        })
                      : new Response('', {
                          status: 404,
                          headers: { 'x-zerochat-sync-generation': generation },
                        }),
                  )
                }

                if (method === 'PUT') {
                  try {
                    window.__zeroChatCloudSyncStore.head = body ? JSON.parse(body) : null
                  } catch {
                    window.__zeroChatCloudSyncStore.head = null
                  }
                  return Promise.resolve(new Response('ok', { status: 200 }))
                }

                if (method === 'DELETE') {
                  window.__zeroChatCloudSyncStore.head = null
                  return Promise.resolve(new Response('ok', { status: 200 }))
                }
              }

              if (syncSmokeUrl.pathname.startsWith('/sync/object/')) {
                const key = decodeURIComponent(syncSmokeUrl.pathname.replace('/sync/object/', ''))

                if (method === 'GET') {
                  const stored = window.__zeroChatCloudSyncStore.objects[key]
                  return Promise.resolve(
                    stored
                      ? new Response(JSON.stringify(stored), {
                          status: 200,
                          headers: { 'content-type': 'application/json' },
                        })
                      : new Response('', { status: 404 }),
                  )
                }

                if (method === 'PUT') {
                  try {
                    window.__zeroChatCloudSyncStore.objects[key] = body ? JSON.parse(body) : {}
                  } catch {
                    window.__zeroChatCloudSyncStore.objects[key] = {}
                  }
                  return Promise.resolve(new Response('ok', { status: 200 }))
                }

                if (method === 'DELETE') {
                  delete window.__zeroChatCloudSyncStore.objects[key]
                  return Promise.resolve(new Response('ok', { status: 200 }))
                }
              }

              if (syncSmokeUrl.pathname === '/snapshot') {
                return Promise.resolve(new Response('', {
                  status: 404,
                  headers: {
                    'x-zerochat-sync-generation': window.__zeroChatCloudSyncStore.generation,
                  },
                }))
              }

              if (syncSmokeUrl.pathname === '/sync/clear') {
                const rotatedGeneration = '00000000-0000-4000-8000-000000000002'
                window.__zeroChatCloudSyncStore = {
                  generation: rotatedGeneration,
                  head: null,
                  objects: {},
                }
                return Promise.resolve(new Response('ok', {
                  status: 200,
                  headers: { 'x-zerochat-sync-generation': rotatedGeneration },
                }))
              }

              return Promise.resolve(new Response('', { status: 404 }))
            }

            if (isImageRequest) {
              window.__zeroChatImageRequestStarted = true
              window.__zeroChatImageRequestUrl = url

              return new Promise((resolve, reject) => {
                const signal = init?.signal ?? input?.signal
                const abort = () => reject(new DOMException('Aborted', 'AbortError'))

                if (signal?.aborted) {
                  abort()
                  return
                }

                signal?.addEventListener('abort', abort, { once: true })
              })
            }

            if (isModelsRequest) {
              window.__zeroChatModelsRequestCount += 1

              if ((headers.get('authorization') || '').includes('zerochat-guide-invalid')) {
                return Promise.resolve(new Response(
                  JSON.stringify({ error: { message: 'invalid api key' } }),
                  {
                    status: 401,
                    headers: { 'content-type': 'application/json' },
                  },
                ))
              }

              if ((headers.get('authorization') || '').includes('zerochat-provider-connectivity-fail')) {
                return Promise.resolve(new Response(
                  JSON.stringify({ error: { message: 'smoke provider connectivity failed' } }),
                  {
                    status: 503,
                    headers: { 'content-type': 'application/json' },
                  },
                ))
              }

              if ((headers.get('authorization') || '').includes('zerochat-provider-loading')) {
                return new Promise((resolve) => {
                  window.__zeroChatResolveProviderLoadingModels = () => {
                    window.__zeroChatResolveProviderLoadingModels = null
                    resolve(new Response(
                      JSON.stringify({
                        data: [
                          { id: 'gpt-5.5' },
                          { id: 'gpt-5.5-mini' },
                          { id: 'gpt-image-2' },
                        ],
                      }),
                      {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                      },
                    ))
                  }
                })
              }

              return Promise.resolve(new Response(
                JSON.stringify({
                  data: [
                    { id: 'gpt-5.5' },
                    { id: 'gpt-5.5-mini' },
                    { id: 'gpt-image-2' },
                  ],
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              ))
            }

            if (isChatRequest) {
              window.__zeroChatChatRequestCount += 1

              if ((headers.get('authorization') || '').includes('zerochat-provider-connectivity-fail')) {
                return Promise.resolve(new Response(
                  JSON.stringify({ error: { message: 'smoke provider chat probe failed' } }),
                  {
                    status: 503,
                    headers: { 'content-type': 'application/json' },
                  },
                ))
              }

              if (requestBody.includes('Reply with OK only.')) {
                window.__zeroChatModelCheckRequestCount += 1
                return new Promise((resolve, reject) => {
                  const signal = init?.signal ?? input?.signal
                  const abort = () => {
                    window.__zeroChatResolveModelCheck = null
                    reject(new DOMException('Aborted', 'AbortError'))
                  }
                  const finish = () => {
                    signal?.removeEventListener('abort', abort)
                    window.__zeroChatResolveModelCheck = null
                    resolve(new Response(
                      eventStreamForText('OK'),
                      {
                        status: 200,
                        headers: { 'content-type': 'text/event-stream' },
                      },
                    ))
                  }

                  if (signal?.aborted) {
                    abort()
                    return
                  }

                  signal?.addEventListener('abort', abort, { once: true })
                  window.__zeroChatResolveModelCheck = finish
                })
              }

              if (
                typeof latestUserContent === 'string' &&
                latestUserContent.includes('Reset generation ownership smoke')
              ) {
                window.__zeroChatResetGenerationRequestCount =
                  (window.__zeroChatResetGenerationRequestCount ?? 0) + 1
                return new Promise((resolve, reject) => {
                  const signal = init?.signal ?? input?.signal
                  const abort = () => {
                    window.__zeroChatResetGenerationAborted = true
                    window.__zeroChatReleaseResetGeneration = () => {
                      window.__zeroChatReleaseResetGeneration = null
                      reject(new DOMException('Aborted', 'AbortError'))
                    }
                  }

                  if (signal?.aborted) {
                    abort()
                    return
                  }

                  signal?.addEventListener('abort', abort, { once: true })
                })
              }

              if (
                typeof latestUserContent === 'string' &&
                latestUserContent.includes('Streaming token smoke')
              ) {
                window.__zeroChatStreamingSmokeRequestCount += 1
                return Promise.resolve(delayedEventStreamResponse(${JSON.stringify(streamingSmokeFrames)}))
              }

              if (
                typeof latestUserContent === 'string' &&
                latestUserContent.includes('Manual retry smoke')
              ) {
                window.__zeroChatManualRetrySmokeRequestCount += 1

                if (window.__zeroChatManualRetrySmokeRequestCount <= 4) {
                  return Promise.resolve(new Response(
                    JSON.stringify({
                      error: {
                        message: 'upstream overloaded with status 503',
                      },
                    }),
                    {
                      status: 503,
                      headers: { 'content-type': 'application/json' },
                    },
                  ))
                }

                return Promise.resolve(new Response(
                  eventStreamForText('Manual retry smoke recovered'),
                  {
                    status: 200,
                    headers: { 'content-type': 'text/event-stream' },
                  },
                ))
              }

              if (
                typeof latestUserContent === 'string' &&
                latestUserContent.includes('Markdown render smoke')
              ) {
                return Promise.resolve(new Response(
                  eventStreamForText(
                    '# Markdown smoke\\n\\n- Rendered list item\\n\\n' +
                      '| Feature | Status |\\n| --- | --- |\\n| Tables | Rendered |\\n\\n' +
                      '[Secure link](https://example.com/zerochat)\\n\\n' +
                      '[Blocked custom link](intent://open/settings)\\n\\n' +
                      '![Blocked remote image](https://tracker.example/zerochat-pixel.png)\\n\\n' +
                      '<script>alert("xss")</script>\\n\\n' +
                      '\`\`\`tsx\\nconst value: number = 42\\nreturn <Button>{value}</Button>\\n\`\`\`',
                  ),
                  {
                    status: 200,
                    headers: { 'content-type': 'text/event-stream' },
                  },
                ))
              }

              if (
                typeof latestUserContent === 'string' &&
                latestUserContent.includes('Keyboard shortcut smoke')
              ) {
                return Promise.resolve(new Response(
                  eventStreamForText('Keyboard shortcut smoke sent by shortcut'),
                  {
                    status: 200,
                    headers: { 'content-type': 'text/event-stream' },
                  },
                ))
              }

              return Promise.resolve(new Response(
                'data: {"choices":[{"delta":{"content":"Queued offline reply"}}]}\\n\\n' +
                  'data: {"type":"response.output_text.delta","delta":"Queued offline reply"}\\n\\n' +
                  'data: [DONE]\\n\\n',
                {
                  status: 200,
                  headers: { 'content-type': 'text/event-stream' },
                },
              ))
            }

            return originalFetch(input, init)
          }
        }
      `,
    })
    await cdp.send('Page.navigate', { url: appUrl })

    let pendingEvaluationId = 0
    const evaluate = async (expression, awaitPromise = false) => {
      if (awaitPromise) {
        pendingEvaluationId += 1
        const objectGroup = `zerochat-browser-smoke-await-${pendingEvaluationId}`
        const pendingResult = await cdp.send('Runtime.evaluate', {
          expression: `Promise.resolve().then(() => (${expression}))`,
          awaitPromise: false,
          returnByValue: false,
          objectGroup,
        })

        if (pendingResult.exceptionDetails) {
          await cdp.send('Runtime.releaseObjectGroup', { objectGroup })
          throw new Error(
            pendingResult.exceptionDetails.exception?.description ??
              pendingResult.exceptionDetails.text ??
              'Browser evaluation failed before promise creation',
          )
        }

        const promiseObjectId = pendingResult.result.objectId
        assert.ok(promiseObjectId, 'Browser evaluation did not return a Promise handle')

        try {
          const result = await cdp.send('Runtime.awaitPromise', {
            promiseObjectId,
            returnByValue: true,
          })

          if (result.exceptionDetails) {
            throw new Error(
              result.exceptionDetails.exception?.description ??
                result.exceptionDetails.text ??
                'Browser promise evaluation failed',
            )
          }

          return result.result.value
        } finally {
          await cdp.send('Runtime.releaseObjectGroup', { objectGroup })
        }
      }

      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: false,
        returnByValue: true,
      })

      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            result.exceptionDetails.exception?.description ??
            'Browser evaluation failed',
        )
      }

      return result.result.value
    }

    await evaluate(
      `new Promise((resolve) => {
        const done = () => resolve(document.readyState)
        if (document.readyState === 'complete') done()
        else window.addEventListener('load', done, { once: true })
      })`,
      true,
    )

    await evaluate(`
      window.__zeroChatSmoke = {
        errors: [],
        textOf(element) {
          const text = (element.textContent || '').trim()
          return text || element.getAttribute('aria-label') || ''
        },
        match(element, names) {
          const text = this.textOf(element)
          return names.some((name) => text.includes(name))
        },
        appChromeState() {
          const brandLogo = document.querySelector('.brand-lockup .app-logo')
          const syncPill = document.querySelector('.sync-pill')
          const logoRect = brandLogo?.getBoundingClientRect()
          const syncPillRect = syncPill?.getBoundingClientRect()
          const syncPillText = syncPill?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
          const syncPillAria = syncPill?.getAttribute('aria-label') ?? ''
          const brandLogoRendered = Boolean(
            brandLogo &&
              brandLogo.complete &&
              brandLogo.naturalWidth > 0 &&
              brandLogo.naturalHeight > 0 &&
              logoRect?.width >= 24 &&
              logoRect?.height >= 24,
          )
          const syncPillStartCloudSync =
            syncPillText.includes('本地 · 开启云同步') ||
            syncPillText.includes('Local · Start cloud sync')
          const syncPillAriaCloudOff =
            syncPillAria.includes('云同步关闭') || syncPillAria.includes('Cloud off')

          return {
            brandLogoComplete: brandLogo?.complete ?? false,
            brandLogoHeight: Math.round(logoRect?.height ?? 0),
            brandLogoNaturalHeight: brandLogo?.naturalHeight ?? 0,
            brandLogoNaturalWidth: brandLogo?.naturalWidth ?? 0,
            brandLogoRendered,
            brandLogoSrc: brandLogo?.getAttribute('src') ?? '',
            brandLogoWidth: Math.round(logoRect?.width ?? 0),
            syncPillAria,
            syncPillAriaCloudOff,
            syncPillStartCloudSync,
            syncPillHeight: Math.round(syncPillRect?.height ?? 0),
            syncPillText,
            syncPillVisible: Boolean(
              syncPill && syncPillRect?.width >= 120 && syncPillRect?.height >= 32,
            ),
            syncPillWidth: Math.round(syncPillRect?.width ?? 0),
          }
        },
        async waitForAppChromeState() {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.appChromeState()
            if (
              state.brandLogoRendered &&
              state.syncPillVisible &&
              state.syncPillStartCloudSync &&
              state.syncPillAriaCloudOff
            ) {
              return state
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'App chrome did not expose the branded icon and cloud-off sync state: ' +
              JSON.stringify(this.appChromeState()),
          )
        },
        click(names) {
          const controls = Array.from(document.querySelectorAll('button, [role="button"], label'))
          const element = controls
            .find((item) => this.match(item, names))
          if (!element) {
            throw new Error(
              'Missing control: ' +
                names.join(' / ') +
                '; available: ' +
                controls.map((item) => this.textOf(item)).filter(Boolean).slice(0, 30).join(' | ') +
                '; body: ' +
                (document.body.textContent || '').trim().slice(0, 300)
            )
          }
          element.click()
          return this.textOf(element)
        },
        clickSyncMode(names) {
          const controls = Array.from(document.querySelectorAll('.sync-compare-card, .mode-grid button'))
          const element = controls.find((item) => this.match(item, names))
          if (!element) throw new Error('Missing sync mode: ' + names.join(' / '))
          element.click()
          return this.textOf(element)
        },
        async clickGuideSyncMode(names) {
          const describe = (button) => this.textOf(button).replace(/\s+/g, ' ').trim()
          const findState = () => {
            const modal = document.querySelector('.guide-modal')
            const buttons = Array.from(modal?.querySelectorAll('.mode-grid button') ?? [])
            return {
              buttons,
              element: buttons.find((item) => this.match(item, names)),
            }
          }

          const initial = findState()
          if (!initial.element) {
            throw new Error(
              'Missing first-run guide sync mode: ' +
                names.join(' / ') +
                '; available: ' +
                initial.buttons.map((item) => describe(item)).filter(Boolean).join(' | '),
            )
          }

          initial.element.click()

          for (let attempt = 0; attempt < 40; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50))
            const state = findState()
            const active = state.buttons.find(
              (item) =>
                this.match(item, names) &&
                (item.classList.contains('active') ||
                  item.getAttribute('aria-pressed') === 'true'),
            )

            if (active) {
              return {
                active: true,
                label: describe(active),
                labels: state.buttons.map((item) => describe(item)).filter(Boolean),
              }
            }
          }

          const latest = findState()
          throw new Error(
            'First-run guide sync mode did not become active: ' +
              JSON.stringify({
                names,
                labels: latest.buttons.map((item) => describe(item)).filter(Boolean),
                activeLabels: latest.buttons
                  .filter(
                    (item) =>
                      item.classList.contains('active') ||
                      item.getAttribute('aria-pressed') === 'true',
                  )
                  .map((item) => describe(item)),
              }),
          )
        },
        label(names) {
          const element = Array.from(document.querySelectorAll('label'))
            .find((item) => this.match(item, names))
          if (!element) throw new Error('Missing label: ' + names.join(' / '))
          return element
        },
        setField(labelNames, value) {
          const field = this.label(labelNames).querySelector('input, textarea')
          if (!field) throw new Error('Missing field: ' + labelNames.join(' / '))
          const prototype = field.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
          field.focus()
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value)
          field.dispatchEvent(new Event('input', { bubbles: true }))
          field.dispatchEvent(new Event('change', { bubbles: true }))
          field.blur()
          return true
        },
        providerConnectivityState() {
          const status = document.querySelector('[data-provider-connectivity-status="true"]')
          const keyField = document.querySelector('[data-provider-api-key-field="true"] input')
          const keyShell = document.querySelector('[data-provider-api-key-field="true"] .input-icon')
          const retry = document.querySelector('[data-provider-connectivity-retry="true"]')
          const checkButton = document.querySelector('[data-provider-connectivity-check="true"]')
          const checkTarget = checkButton?.closest('.provider-connectivity-tooltip-target')
          const retryTarget = retry?.closest('.provider-connectivity-tooltip-target')
          const checkRect = checkButton?.getBoundingClientRect()
          const checkHit = checkRect
            ? document.elementFromPoint(
                Math.floor(checkRect.left + checkRect.width / 2),
                Math.floor(checkRect.top + checkRect.height / 2),
              )
            : null
          const activeRow = document.querySelector('.provider-list-row.active')
          const listStatus = activeRow?.querySelector('[data-provider-list-status="true"]')
          const providerAvatar = activeRow?.querySelector('[data-provider-accent]')
          const providerName = activeRow?.querySelector('.provider-list-summary span')
          const providerMeta = activeRow?.querySelector('.provider-list-summary small')
          const keyStyle = keyShell ? getComputedStyle(keyShell) : null
          const checkStyle = checkButton ? getComputedStyle(checkButton) : null

          return {
            checkDescribedBy: checkButton?.getAttribute('aria-describedby') ?? '',
            checkDisabled: checkButton?.disabled ?? null,
            checkHitClass: checkHit?.className ?? '',
            checkHitTag: checkHit?.tagName ?? '',
            checkPointerEvents: checkStyle?.pointerEvents ?? '',
            checkText: checkButton?.textContent?.trim() ?? '',
            checkButtonVisible: Boolean(checkButton),
            checkTitle: checkButton?.getAttribute('title') ?? '',
            checkTooltip: checkButton?.getAttribute('data-tooltip') ?? '',
            checkTargetTitle: checkTarget?.getAttribute('title') ?? '',
            checkTargetTooltip: checkTarget?.getAttribute('data-tooltip') ?? '',
            field: status?.getAttribute('data-provider-connectivity-field') ?? '',
            keyBorderColor: keyStyle?.borderColor ?? '',
            keyInvalid: keyField?.getAttribute('aria-invalid') === 'true',
            keyPresent: Boolean(keyField?.value.trim()),
            listStatusText: listStatus?.textContent?.trim() ?? '',
            listStatusTone: listStatus?.getAttribute('data-provider-list-status-tone') ?? '',
            providerAccent: providerAvatar?.getAttribute('data-provider-accent') ?? '',
            providerBadgeText: providerAvatar?.textContent?.trim() ?? '',
            providerNameText: providerName?.textContent?.trim() ?? '',
            providerMetaText: providerMeta?.textContent?.trim() ?? '',
            providerRowDraggable: activeRow?.draggable ?? false,
            providerRowTitle: activeRow?.getAttribute('title') ?? '',
            providerRowTooltip:
              activeRow?.getAttribute('data-tooltip') ??
              activeRow?.getAttribute('aria-label') ??
              '',
            retryDescribedBy: retry?.getAttribute('aria-describedby') ?? '',
            retryAction: retry?.getAttribute('data-provider-connectivity-retry-action') ?? '',
            retryTitle: retry?.getAttribute('title') ?? '',
            retryTooltip: retry?.getAttribute('data-tooltip') ?? '',
            retryTargetTitle: retryTarget?.getAttribute('title') ?? '',
            retryTargetTooltip: retryTarget?.getAttribute('data-tooltip') ?? '',
            retryVisible: Boolean(retry),
            modelRequestCount: window.__zeroChatModelsRequestCount ?? 0,
            statusText: status?.textContent?.trim() ?? '',
            tone: status?.classList.contains('error')
              ? 'error'
              : status?.classList.contains('success')
                ? 'success'
                : '',
          }
        },
        async waitForProviderConnectivityState(predicateSource) {
          const predicate = new Function('state', 'return (' + predicateSource + ')(state)')
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.providerConnectivityState()
            if (predicate(state)) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Provider connectivity state did not settle: ' +
              JSON.stringify(this.providerConnectivityState()),
          )
        },
        async waitForPendingModelCheckRequest() {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (typeof window.__zeroChatResolveModelCheck === 'function') {
              return {
                modelCheckRequests: window.__zeroChatModelCheckRequestCount ?? 0,
                modelRequests: window.__zeroChatModelsRequestCount ?? 0,
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Model check request did not start: ' +
              JSON.stringify({
                modelCheckRequests: window.__zeroChatModelCheckRequestCount ?? 0,
                modelRequests: window.__zeroChatModelsRequestCount ?? 0,
              }),
          )
        },
        guideProviderPickerState() {
          const modal = document.querySelector('.guide-modal')
          const expectedIds = ['openai', 'anthropic', 'gemini', 'deepseek', 'xai', 'openrouter']
          const cards = Array.from(modal?.querySelectorAll('.guide-provider-card') ?? [])
          const customRelayShortcutStripPresent =
            modal?.querySelector('.guide-custom-relays') !== null
          const providerSelect = modal?.querySelector('.guide-provider-select-row select') ?? null
          const selectValues = Array.from(modal?.querySelectorAll('select option') ?? [])
            .map((option) => option.value)
          const isRendered = (element) => {
            if (!element) return false
            const box = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return (
              box.width > 0 &&
              box.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            )
          }
          const cardStates = Object.fromEntries(cards.map((button) => {
            const id = button.getAttribute('data-guide-provider-card') ?? ''
            const avatar = button.querySelector('[data-provider-accent]')
            const meta = button.querySelector('.guide-provider-copy small')
            const box = button.getBoundingClientRect()

            return [id, {
              accent: avatar?.getAttribute('data-provider-accent') ?? '',
              ariaLabel: button.getAttribute('aria-label') ?? '',
              avatarText: avatar?.textContent?.trim() ?? '',
              dataTooltip: button.getAttribute('data-tooltip') ?? '',
              metaText: meta?.textContent?.trim() ?? '',
              title: button.getAttribute('title') ?? '',
              visible: box.width > 0 && box.height > 0,
            }]
          }))
          const activeIds = Array.from(
            modal?.querySelectorAll('[data-guide-provider-card][aria-pressed="true"]') ?? [],
          ).map((button) => button.getAttribute('data-guide-provider-card') ?? '')
          const customFieldsVisible = Array.from(modal?.querySelectorAll('input') ?? [])
            .some((input) => input.placeholder === 'https://api.example.com/v1')

          return {
            visible: Boolean(modal),
            cardCount: cards.length,
            customRelayShortcutStripPresent,
            activeIds,
            missingExpected: expectedIds.filter((id) => !cardStates[id]),
            hiddenExpected: expectedIds.filter((id) => cardStates[id] && !cardStates[id].visible),
            openaiAccent: cardStates.openai?.accent ?? '',
            geminiAriaLabel: cardStates.gemini?.ariaLabel ?? '',
            geminiTooltip: cardStates.gemini?.dataTooltip ?? '',
            geminiTitle: cardStates.gemini?.title ?? '',
            openaiAvatarText: cardStates.openai?.avatarText ?? '',
            openaiMetaText: cardStates.openai?.metaText ?? '',
            customFieldsVisible,
            selectedProviderId: providerSelect?.value ?? '',
            providerSelectOptionCount: selectValues.length,
            providerSelectVisible: isRendered(providerSelect),
            completeSelectHasFeatured: expectedIds.every((id) => selectValues.includes(id)),
            completeSelectHasCustomRelay: selectValues.includes('custom-openai-relay'),
          }
        },
        guideProviderKeyHelpState() {
          const modal = document.querySelector('.guide-modal')
          const help = modal?.querySelector('.guide-key-help') ?? null
          const link = help?.querySelector('a') ?? null
          const note = help?.querySelector('.guide-key-local-note') ?? null
          const heading = modal?.querySelector('.guide-key-heading') ?? null
          const status = modal?.querySelector('[data-provider-connectivity-status="true"]') ?? null
          const notice = modal?.querySelector('.modal-notice') ?? null
          const keyField = modal?.querySelector('[data-provider-api-key-field="true"] input')
          const requirement = modal?.querySelector('#guide-requirement') ?? null
          const doneButton = Array.from(modal?.querySelectorAll('button') ?? [])
            .find(
              (button) =>
                button.classList.contains('primary-button') ||
                this.match(button, [
                  'Terminé',
                  'Done',
                  '完成',
                  'Connecté',
                  'Connected',
                  '连接成功',
                  'Conectado',
                  'Conectado',
                  'Подключено',
                  '接続済み',
                  '연결됨',
                  'जुड़ गया',
                  'تم الاتصال',
                ]),
            )
          const doneTooltipTarget = doneButton?.closest('.guide-done-tooltip-target')
          const doneRect = doneButton?.getBoundingClientRect()
          const doneHit = doneRect
            ? document.elementFromPoint(
                doneRect.left + doneRect.width / 2,
                doneRect.top + doneRect.height / 2,
              )
            : null
          const linkBox = link?.getBoundingClientRect()
          const noteBox = note?.getBoundingClientRect()

          return {
            visible: Boolean(
              help &&
                linkBox &&
                linkBox.width > 0 &&
                linkBox.height > 0 &&
                noteBox &&
                noteBox.width > 0 &&
                noteBox.height > 0,
            ),
            href: link?.href ?? '',
            keyInvalid: keyField?.getAttribute('aria-invalid') === 'true',
            rel: link?.getAttribute('rel') ?? '',
            requestCount: window.__zeroChatModelsRequestCount ?? 0,
            noticeText: notice?.textContent?.trim() ?? '',
            noticeTone: notice?.classList.contains('error')
              ? 'error'
              : notice?.classList.contains('success')
                ? 'success'
                : notice?.classList.contains('warning')
                  ? 'warning'
                  : '',
            statusField: status?.getAttribute('data-provider-connectivity-field') ?? '',
            statusText: status?.textContent?.trim() ?? '',
            statusTone: status?.classList.contains('error')
              ? 'error'
              : status?.classList.contains('success')
                ? 'success'
                : '',
            target: link?.getAttribute('target') ?? '',
            titleText: heading?.textContent?.trim() ?? '',
            doneDisabled: Boolean(doneButton?.disabled),
            donePointerEvents: doneButton ? getComputedStyle(doneButton).pointerEvents : '',
            doneDescribedBy: doneButton?.getAttribute('aria-describedby') ?? '',
            doneTitle: doneButton?.getAttribute('title') ?? '',
            doneTooltip: doneButton?.getAttribute('data-tooltip') ?? '',
            doneTargetTitle: doneTooltipTarget?.getAttribute('title') ?? '',
            doneTargetTooltip: doneTooltipTarget?.getAttribute('data-tooltip') ?? '',
            doneHitTag: doneHit?.tagName ?? '',
            doneHitClass: doneHit?.className ?? '',
            doneText: doneButton ? this.textOf(doneButton) : '',
            requirementText: requirement?.textContent?.trim() ?? '',
            linkText: link?.textContent?.trim() ?? '',
            noteText: note?.textContent?.trim() ?? '',
          }
        },
        guideWorkerHostedRelayState() {
          const modal = document.querySelector('.guide-modal')
          const doneButton = Array.from(modal?.querySelectorAll('button') ?? [])
            .find(
              (button) =>
                button.classList.contains('primary-button') ||
                this.match(button, ['Terminé', 'Done', '完成']),
            )
          const providerKeyInput = modal?.querySelector(
            '[data-provider-api-key-field="true"] input',
          )
          const proxyInput = modal?.querySelector(
            'input[aria-describedby*="guide-proxy-url-hint-"]',
          )
          const modelInput = modal?.querySelector('.model-picker input')
          const clientRequestModeInput = modal?.querySelector(
            'input[aria-describedby*="guide-client-request-mode-hint-"]',
          )
          const workerHostedKeyInput = modal?.querySelector(
            'input[aria-describedby*="guide-worker-hosted-key-hint-"]',
          )
          const requirement = modal?.querySelector('#guide-requirement')

          return {
            clientRequestModeChecked: Boolean(clientRequestModeInput?.checked),
            doneDisabled: Boolean(doneButton?.disabled),
            modelValue: modelInput?.value ?? '',
            providerKeyValueLength: providerKeyInput?.value?.length ?? -1,
            proxyValue: proxyInput?.value ?? '',
            requirementText: requirement?.textContent?.trim() ?? '',
            workerHostedKeyChecked: Boolean(workerHostedKeyInput?.checked),
            workerHostedKeyVisible: Boolean(workerHostedKeyInput),
          }
        },
        async enableGuideWorkerHostedKeyRelay(model = 'gpt-5.5') {
          const modal = document.querySelector('.guide-modal')
          const proxyInput = modal?.querySelector(
            'input[aria-describedby*="guide-proxy-url-hint-"]',
          )
          const modelInput = modal?.querySelector('.model-picker input')

          if (!proxyInput) {
            throw new Error('Missing first-run custom relay proxy URL input')
          }

          if (!modelInput) {
            throw new Error('Missing first-run default model input')
          }

          const setInputValue = (input, value) => {
            input.focus()
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
              .set.call(input, value)
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new Event('change', { bubbles: true }))
            input.blur()
          }

          setInputValue(proxyInput, 'https://worker.example.com')

          let workerHostedKeyInput = null

          for (let attempt = 0; attempt < 80; attempt += 1) {
            workerHostedKeyInput = modal.querySelector(
              'input[aria-describedby*="guide-worker-hosted-key-hint-"]',
            )

            if (workerHostedKeyInput) break

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          if (!workerHostedKeyInput) {
            throw new Error(
              'First-run custom relay did not reveal Worker-hosted-key control: ' +
                JSON.stringify(this.guideWorkerHostedRelayState()),
            )
          }

          if (!workerHostedKeyInput.checked) {
            workerHostedKeyInput.click()
          }

          setInputValue(modelInput, model)

          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.guideWorkerHostedRelayState()

            if (
              state.workerHostedKeyChecked &&
              state.modelValue === model &&
              state.proxyValue === 'https://worker.example.com' &&
              !state.doneDisabled
            ) {
              return state
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'First-run custom relay Worker-hosted-key state did not settle: ' +
              JSON.stringify(this.guideWorkerHostedRelayState()),
          )
        },
        async waitForGuideProviderKeyHelpState(predicateSource) {
          const predicate = new Function('state', 'return (' + predicateSource + ')(state)')

          for (let attempt = 0; attempt < 100; attempt += 1) {
            const state = this.guideProviderKeyHelpState()
            if (predicate(state)) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Guide key help state did not settle: ' +
              JSON.stringify(this.guideProviderKeyHelpState()),
          )
        },
        async clickGuideProviderCard(presetId) {
          const selector =
            '.guide-modal [data-guide-provider-card="' + CSS.escape(presetId) + '"]'
          const button = document.querySelector(selector)

          if (!button) {
            throw new Error('Missing guide provider card: ' + presetId)
          }

          button.click()

          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.guideProviderPickerState()
            if (state.activeIds.includes(presetId) && !state.customFieldsVisible) {
              return state
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Guide provider card did not settle: ' +
              presetId +
              '; state: ' +
            JSON.stringify(this.guideProviderPickerState()),
          )
        },
        async selectGuideProviderPreset(presetId) {
          const select = document.querySelector('.guide-modal .guide-provider-select-row select')

          if (!select) {
            throw new Error('Missing first-run Provider menu')
          }

          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
            .set.call(select, presetId)
          select.dispatchEvent(new Event('change', { bubbles: true }))

          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.guideProviderPickerState()
            if (
              state.selectedProviderId === presetId &&
              (state.activeIds.includes(presetId) || state.customFieldsVisible)
            ) {
              return state
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'First-run Provider menu selection did not settle: ' +
              presetId +
              '; state: ' +
              JSON.stringify(this.guideProviderPickerState()),
          )
        },
        clickSelector(selector) {
          const element = document.querySelector(selector)
          if (!element) throw new Error('Missing selector: ' + selector)
          element.click()
          return true
        },
        exists(selector) {
          return document.querySelector(selector) !== null
        },
        async waitForElement(selector) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (this.exists(selector)) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Element did not appear: ' + selector)
        },
        featureHintState(id) {
          const hint = document.querySelector('[data-feature-hint="' + id + '"]')
          const dismiss = hint?.querySelector('.feature-hint-dismiss') ?? null
          const dismissDescriptionId = dismiss?.getAttribute('aria-describedby') ?? ''
          const menu = hint?.closest('[role="menu"]') ?? null
          const firstMenuItem = menu?.querySelector('[role^="menuitem"]:not(:disabled)') ?? null
          const activeElement = document.activeElement
          const rect = hint?.getBoundingClientRect()
          const style = hint ? window.getComputedStyle(hint) : null
          const visible = Boolean(
            hint &&
              rect &&
              rect.width > 0 &&
              rect.height > 0 &&
              style?.display !== 'none' &&
              style?.visibility !== 'hidden',
          )

          return {
            id,
            visible,
            text: hint?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
            dismissVisible: Boolean(dismiss),
            dismissRole: dismiss?.getAttribute('role') ?? '',
            dismissFocused: dismiss === document.activeElement,
            dismissDescriptionLinked: Boolean(
              dismissDescriptionId && document.getElementById(dismissDescriptionId),
            ),
            firstMenuItemClass: firstMenuItem?.getAttribute('class') ?? '',
            firstMenuItemIsDismiss: firstMenuItem === dismiss,
            activeElementClass: activeElement?.getAttribute('class') ?? '',
            activeElementRole: activeElement?.getAttribute('role') ?? '',
            activeElementTag: activeElement?.tagName ?? '',
            role: hint?.getAttribute('role') ?? '',
            live: hint?.getAttribute('aria-live') ?? '',
            atomic: hint?.getAttribute('aria-atomic') ?? '',
            placement: hint
              ? ['chat', 'menu', 'settings'].find((name) =>
                  hint.classList.contains('feature-hint-' + name),
                ) ?? ''
              : '',
            width: rect?.width ?? 0,
            height: rect?.height ?? 0,
          }
        },
        async waitForFeatureHint(id, visible = true) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.featureHintState(id)
            if (state.visible === visible) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Feature hint ' + id + ' did not become ' + (visible ? 'visible' : 'hidden') + '; ' +
              JSON.stringify(this.featureHintState(id)),
          )
        },
        async waitForFeatureHintDismissFocus(id) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.featureHintState(id)
            if (state.visible && state.dismissFocused) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Feature hint dismiss did not receive focus: ' +
              id +
              '; ' +
              JSON.stringify(this.featureHintState(id)),
          )
        },
        async dismissFeatureHint(id) {
          const before = await this.waitForFeatureHint(id, true)
          const button = document.querySelector('[data-feature-hint="' + id + '"] .feature-hint-dismiss')
          if (!button) throw new Error('Missing feature hint dismiss button: ' + id)
          button.click()
          const after = await this.waitForFeatureHint(id, false)
          return { before, after }
        },
        focusWithin(selector) {
          const container = document.querySelector(selector)
          return Boolean(container && document.activeElement && container.contains(document.activeElement))
        },
        async waitForFocusWithin(selector) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (this.focusWithin(selector)) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Focus did not move inside: ' + selector)
        },
        isSidebarOpen() {
          return document.querySelector('.sidebar.open') !== null
        },
        conversationSearchState() {
          const input = document.querySelector('.conversation-search input')
          const clearButton = document.querySelector('.conversation-search-clear')
          const empty = document.querySelector('.conversation-empty')
          const rows = Array.from(document.querySelectorAll('.conversation-row'))

          return {
            inputValue: input?.value ?? null,
            placeholder: input?.getAttribute('placeholder') ?? null,
            ariaLabel: input?.getAttribute('aria-label') ?? null,
            clearVisible: Boolean(clearButton),
            rowCount: rows.length,
            rowTitles: rows.map((row) =>
              row.querySelector('.conversation-select span')?.textContent?.trim() ?? '',
            ),
            noResultsVisible: Boolean(empty),
            noResultsText: empty?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
            focused: document.activeElement === input,
          }
        },
        async setConversationSearch(value) {
          const input = document.querySelector('.conversation-search input')
          if (!input) throw new Error('Missing conversation search input')
          input.focus()
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
            .set.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          await new Promise((resolve) => setTimeout(resolve, 120))
          return this.conversationSearchState()
        },
        async clearConversationSearch() {
          const clearButton = document.querySelector('.conversation-search-clear')
          if (!clearButton) throw new Error('Missing conversation search clear button')
          clearButton.click()
          await new Promise((resolve) => setTimeout(resolve, 120))
          return this.conversationSearchState()
        },
        providerModelTriggerState() {
          const trigger = document.querySelector('.provider-model-trigger')
          const rect = trigger?.getBoundingClientRect()
          const styles = trigger ? getComputedStyle(trigger) : null
          const radius = styles
            ? Math.min(
                parseFloat(styles.borderTopLeftRadius),
                parseFloat(styles.borderTopRightRadius),
                parseFloat(styles.borderBottomRightRadius),
                parseFloat(styles.borderBottomLeftRadius),
              )
            : 0

          return {
            visible: Boolean(trigger),
            ariaLabel: trigger?.getAttribute('aria-label') ?? '',
            radius,
            height: rect?.height ?? 0,
            width: rect?.width ?? 0,
            text: trigger?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
          }
        },
        conversationTitleState() {
          const button = document.querySelector('.conversation-title-button')
          const input = document.querySelector('.conversation-title-input')
          const activeRow = document.querySelector('.conversation-row.active .conversation-select span')
          const measured = input ?? button
          const rect = measured?.getBoundingClientRect()

          return {
            buttonVisible: Boolean(button),
            inputVisible: Boolean(input),
            titleText: button?.textContent?.trim() ?? '',
            inputValue: input?.value ?? '',
            ariaLabel: (input ?? button)?.getAttribute('aria-label') ?? '',
            placeholder: input?.getAttribute('placeholder') ?? '',
            hint: (input ?? button)?.getAttribute('data-tooltip') ?? '',
            nativeTitle: (input ?? button)?.getAttribute('title') ?? '',
            tooltip: (input ?? button)?.getAttribute('data-tooltip') ?? '',
            activeRowTitle: activeRow?.textContent?.trim() ?? '',
            focusedInput: document.activeElement === input,
            focusedButton: document.activeElement === button,
            width: rect?.width ?? 0,
            height: rect?.height ?? 0,
          }
        },
        async beginConversationTitleEdit() {
          const button = document.querySelector('.conversation-title-button')
          if (!button) throw new Error('Missing conversation title button')
          button.click()
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const input = document.querySelector('.conversation-title-input')
            if (input && document.activeElement === input) {
              return this.conversationTitleState()
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Conversation title input did not receive focus')
        },
        async setConversationTitleDraft(value) {
          const input = document.querySelector('.conversation-title-input')
          if (!input) throw new Error('Missing conversation title input')
          input.focus()
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
            .set.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          await new Promise((resolve) => setTimeout(resolve, 120))
          return this.conversationTitleState()
        },
        async pressConversationTitleKey(key) {
          const input = document.querySelector('.conversation-title-input')
          if (!input) throw new Error('Missing conversation title input')
          input.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key,
          }))
          await new Promise((resolve) => setTimeout(resolve, 160))
          return this.conversationTitleState()
        },
        openSidebarByPointer() {
          const button = Array.from(document.querySelectorAll('button'))
            .find((item) => this.match(item, ['打开边栏', 'Open sidebar']))
          if (!button) throw new Error('Missing open-sidebar button')
          button.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            detail: 1,
            view: window,
          }))
          return true
        },
        openSettingsFromSidebar() {
          const sidebar = document.querySelector('.sidebar.open')
          const button = Array.from(sidebar?.querySelectorAll('button') ?? [])
            .find((item) => this.match(item, [
              '设置',
              'Settings',
              'Paramètres',
            ]))
          if (!button) throw new Error('Missing settings button in open sidebar')
          button.click()
          return true
        },
        sidebarA11yState() {
          const sidebar = document.querySelector('.sidebar')
          const buttons = Array.from(sidebar?.querySelectorAll('button') ?? [])
          const openSidebarButton = Array.from(document.querySelectorAll('button'))
            .find((item) => this.match(item, ['打开边栏', 'Open sidebar']))
          const activeBefore = document.activeElement
          const firstButton = buttons[0]
          firstButton?.focus()
          const canFocusFirstButton = document.activeElement === firstButton
          if (activeBefore instanceof HTMLElement) {
            activeBefore.focus()
          }
          return {
            activeLabel: document.activeElement?.getAttribute('aria-label') ??
              document.activeElement?.textContent?.trim().replace(/\s+/g, ' ') ??
              document.activeElement?.tagName,
            ariaHidden: sidebar?.getAttribute('aria-hidden') ?? null,
            inert: sidebar?.hasAttribute('inert') ?? false,
            canFocusFirstButton,
            openButtonFocused: document.activeElement === openSidebarButton,
            openButtonFocusVisible: openSidebarButton?.matches(':focus-visible') ?? false,
            tabbableButtons: buttons.filter((button) => button.tabIndex >= 0 && !button.disabled)
              .length,
          }
        },
        modalBackgroundA11yState() {
          const main = document.querySelector('.chat-pane')
          const sidebar = document.querySelector('.sidebar')
          const visibleModal = Array.from(
            document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
          ).some((element) => {
            const box = element.getBoundingClientRect()
            const style = window.getComputedStyle(element)
            return (
              box.width > 0 &&
              box.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            )
          })

          return {
            visibleModal,
            mainAriaHidden: main?.getAttribute('aria-hidden') ?? null,
            mainInert: main?.hasAttribute('inert') ?? false,
            sidebarAriaHidden: sidebar?.getAttribute('aria-hidden') ?? null,
            sidebarInert: sidebar?.hasAttribute('inert') ?? false,
          }
        },
        sidebarCloseFocusState() {
          const sidebar = document.querySelector('.sidebar')
          const closeButton = sidebar?.querySelector('.brand-row .icon-button.mobile-only')
          const style = closeButton ? getComputedStyle(closeButton) : null
          return {
            activeLabel: this.activeControlLabel(),
            pointerOpen: sidebar?.getAttribute('data-pointer-open') ?? null,
            closeButtonFocused: document.activeElement === closeButton,
            closeButtonFocusVisible: closeButton?.matches(':focus-visible') ?? false,
            closeButtonBoxShadow: style?.boxShadow ?? null,
          }
        },
        activeControlLabel() {
          return document.activeElement?.getAttribute('aria-label') ??
            document.activeElement?.textContent?.trim().replace(/\s+/g, ' ') ??
            document.activeElement?.tagName ??
            null
        },
        activeControlMatches(names) {
          const label = this.activeControlLabel()
          return Boolean(label && names.some((name) => label.includes(name)))
        },
        async waitForActiveControl(names) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (this.activeControlMatches(names)) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Active control did not match ' +
              names.join(' / ') +
              '; active=' +
              this.activeControlLabel(),
          )
        },
        blurActiveControl() {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
          }
          return this.activeControlLabel()
        },
        focusFileButton(names) {
          const labels = Array.from(document.querySelectorAll('label.file-button'))
          const label = labels.find((item) => this.match(item, names))
          if (!label) {
            throw new Error(
              'Missing file button: ' +
                names.join(' / ') +
                '; available: ' +
                labels.map((item) => this.textOf(item)).filter(Boolean).join(' | '),
            )
          }

          const input = label.querySelector('input[type="file"]')
          if (!input) throw new Error('Missing file input inside: ' + this.textOf(label))
          input.focus()

          const style = getComputedStyle(label)
          return {
            label: this.textOf(label),
            activeTag: document.activeElement?.tagName ?? null,
            activeType: document.activeElement?.getAttribute('type') ?? null,
            focusWithin: label.matches(':focus-within'),
            borderColor: style.borderColor,
            boxShadow: style.boxShadow,
          }
        },
        focusActionButton(names) {
          const buttons = Array.from(document.querySelectorAll('button'))
          const button = buttons.find((item) => this.match(item, names))
          if (!button) {
            throw new Error(
              'Missing action button: ' +
                names.join(' / ') +
                '; available: ' +
                buttons.map((item) => this.textOf(item)).filter(Boolean).slice(0, 30).join(' | '),
            )
          }

          button.focus()
          const style = getComputedStyle(button)
          return {
            label: this.textOf(button),
            active: document.activeElement === button,
            focusVisible: button.matches(':focus-visible'),
            borderColor: style.borderColor,
            boxShadow: style.boxShadow,
          }
        },
        closeSettings() {
          const element = document.querySelector('.settings-modal .modal-header .icon-button')
          if (!element) throw new Error('Missing settings close button')
          element.click()
          return true
        },
        async closeSettingsByPointer() {
          const element = document.querySelector('.settings-modal .modal-header .icon-button')
          if (!element) throw new Error('Missing settings close button')
          element.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            detail: 1,
            view: window,
          }))

          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (!document.querySelector('.settings-modal')) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          const opener = Array.from(document.querySelectorAll('button'))
            .find((item) => this.match(item, ['打开设置', 'Open settings', 'Ouvrir les paramètres']))
          const style = opener ? getComputedStyle(opener) : null

          return {
            activeLabel: this.activeControlLabel(),
            modalOpen: Boolean(document.querySelector('.settings-modal')),
            openerFocused: document.activeElement === opener,
            openerFocusVisible: opener?.matches(':focus-visible') ?? false,
            openerBoxShadow: style?.boxShadow ?? null,
          }
        },
        setSelectValue(value) {
          const select = Array.from(document.querySelectorAll('select'))
            .find((item) => Array.from(item.options).some((option) => option.value === value))
          if (!select) throw new Error('Missing select option: ' + value)
          select.value = value
          select.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        },
        setThemeValue(value) {
          const select = Array.from(document.querySelectorAll('select'))
            .find((item) => {
              const values = Array.from(item.options).map((option) => option.value)
              return values.includes('system') && values.includes('light') && values.includes('dark')
            })
          if (!select) throw new Error('Missing theme select')
          select.value = value
          select.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        },
        setCheckboxLabel(names, checked) {
          const label = Array.from(document.querySelectorAll('label'))
            .find((item) => this.match(item, names))
          if (!label) throw new Error('Missing checkbox label: ' + names.join(' / '))
          const input = label.querySelector('input[type="checkbox"]')
          if (!input) throw new Error('Missing checkbox input: ' + names.join(' / '))
          if (input.checked !== checked) input.click()
          return input.checked
        },
        async waitForCompact(value) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (document.documentElement.dataset.compact === value) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Compact mode did not settle: ' + document.documentElement.dataset.compact)
        },
        async waitForThemeColor(value) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const meta = document.querySelector('meta[name="theme-color"]')
            if (meta?.getAttribute('content') === value) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Theme color did not settle: ' + document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))
        },
        setSkillDraft(name, content) {
          const panel = document.querySelector('.skill-settings')
          if (!panel) throw new Error('Missing skill settings panel')
          const nameInput = Array.from(panel.querySelectorAll('input'))
            .find((item) => !['checkbox', 'number', 'file'].includes(item.type))
          const textarea = panel.querySelector('textarea.skill-draft')
          if (!nameInput || !textarea) throw new Error('Missing skill draft fields')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(nameInput, name)
          nameInput.dispatchEvent(new Event('input', { bubbles: true }))
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, content)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        },
        addModelTag(model) {
          const input = document.querySelector('.model-chip-input')
          if (!input) throw new Error('Missing model chip input')
          input.focus()
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
            .set.call(input, model + ' ')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          input.blur()
          return true
        },
        modelChipTooltipState() {
          const chips = Array.from(document.querySelectorAll('.model-chip'))

          return {
            count: chips.length,
            draggable: chips.map((chip) => chip.draggable),
            labels: chips.map((chip) =>
              chip.querySelector('.model-chip-edit')?.value ??
              chip.textContent?.trim() ??
              '',
            ),
            titles: chips.map((chip) => chip.getAttribute('title') ?? ''),
            tooltips: chips.map(
              (chip) =>
                chip.getAttribute('data-tooltip') ??
                chip.getAttribute('aria-label') ??
                '',
            ),
          }
        },
        modelAddButtonState() {
          const button = Array.from(document.querySelectorAll('button'))
            .find((item) => this.match(item, ['添加模型', 'Add model']))
          const tooltipTarget = button?.closest('.model-add-tooltip-target')
          const note = tooltipTarget
            ?.closest('.form-stack')
            ?.querySelector('[id^="model-list-hint-"]')
          const rect = button?.getBoundingClientRect()
          const hit = rect
            ? document.elementFromPoint(
                Math.floor(rect.left + rect.width / 2),
                Math.floor(rect.top + rect.height / 2),
              )
            : null
          const style = button ? getComputedStyle(button) : null

          return {
            describedBy: button?.getAttribute('aria-describedby') ?? '',
            disabled: button?.disabled ?? null,
            hitClass: hit?.className ?? '',
            hitTag: hit?.tagName ?? '',
            noteText: note?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
            pointerEvents: style?.pointerEvents ?? '',
            title: button?.getAttribute('title') ?? '',
            tooltip: button?.getAttribute('data-tooltip') ?? '',
            targetTitle: tooltipTarget?.getAttribute('title') ?? '',
            targetTooltip: tooltipTarget?.getAttribute('data-tooltip') ?? '',
            text: button?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
            visible: Boolean(rect && rect.width > 0 && rect.height > 0),
          }
        },
        clickModelFetchButton(scope = 'settings') {
          const button = document.querySelector('[data-model-fetch-button="' + scope + '"]')
          if (!button) throw new Error('Missing model fetch button: ' + scope)
          button.closest('.model-fetch-tooltip-target')
            ?.scrollIntoView({ block: 'center', inline: 'nearest' })
          button.click()
          return true
        },
        modelFetchButtonState(scope = 'settings') {
          const button = document.querySelector('[data-model-fetch-button="' + scope + '"]')
          const tooltipTarget = button?.closest('.model-fetch-tooltip-target')
          const describedBy = button?.getAttribute('aria-describedby') ?? ''
          const note = describedBy ? document.getElementById(describedBy) : null
          const rect = button?.getBoundingClientRect()
          const hit = rect
            ? document.elementFromPoint(
                Math.floor(rect.left + rect.width / 2),
                Math.floor(rect.top + rect.height / 2),
              )
            : null
          const style = button ? getComputedStyle(button) : null

          return {
            describedBy,
            disabled: button?.disabled ?? null,
            hitClass: hit?.className ?? '',
            hitTag: hit?.tagName ?? '',
            modelRequestCount: window.__zeroChatModelsRequestCount ?? 0,
            noteText: note?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
            pointerEvents: style?.pointerEvents ?? '',
            scope: button?.getAttribute('data-model-fetch-button') ?? '',
            targetTitle: tooltipTarget?.getAttribute('title') ?? '',
            targetTooltip: tooltipTarget?.getAttribute('data-tooltip') ?? '',
            text: button?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
            title: button?.getAttribute('title') ?? '',
            tooltip: button?.getAttribute('data-tooltip') ?? '',
            visible: Boolean(rect && rect.width > 0 && rect.height > 0),
          }
        },
        async waitForModelFetchButtonState(scope, predicateSource) {
          const predicate = new Function('state', 'return (' + predicateSource + ')(state)')

          for (let attempt = 0; attempt < 100; attempt += 1) {
            const state = this.modelFetchButtonState(scope)
            if (predicate(state)) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Model fetch button state did not settle: ' +
              JSON.stringify(this.modelFetchButtonState(scope)),
          )
        },
        clickModelCheckButton(kind = 'chat') {
          const button = document.querySelector('[data-model-check-kind="' + kind + '"]')
          if (!button) throw new Error('Missing model check button: ' + kind)
          button.closest('.model-check-tooltip-target')
            ?.scrollIntoView({ block: 'center', inline: 'nearest' })
          button.click()
          return true
        },
        modelCheckButtonStates() {
          const collect = (kind) => {
            const button = document.querySelector('[data-model-check-kind="' + kind + '"]')
            const tooltipTarget = button?.closest('.model-check-tooltip-target')
            const describedBy = button?.getAttribute('aria-describedby') ?? ''
            const note = describedBy ? document.getElementById(describedBy) : null
            const rect = button?.getBoundingClientRect()
            const hit = rect
              ? document.elementFromPoint(
                  Math.floor(rect.left + rect.width / 2),
                  Math.floor(rect.top + rect.height / 2),
                )
              : null
            const style = button ? getComputedStyle(button) : null

            return {
              describedBy,
              disabled: button?.disabled ?? null,
              hitClass: hit?.className ?? '',
              hitTag: hit?.tagName ?? '',
              kind: button?.getAttribute('data-model-check-kind') ?? '',
              noteText: note?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
              pointerEvents: style?.pointerEvents ?? '',
              targetTitle: tooltipTarget?.getAttribute('title') ?? '',
              targetTooltip: tooltipTarget?.getAttribute('data-tooltip') ?? '',
              text: button?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
              title: button?.getAttribute('title') ?? '',
              tooltip: button?.getAttribute('data-tooltip') ?? '',
              visible: Boolean(rect && rect.width > 0 && rect.height > 0),
            }
          }

          return {
            chat: collect('chat'),
            image: collect('image'),
            modelCheckRequests: window.__zeroChatModelCheckRequestCount ?? 0,
          }
        },
        async waitForModelCheckButtonStates(predicateSource) {
          const predicate = new Function('state', 'return (' + predicateSource + ')(state)')

          for (let attempt = 0; attempt < 100; attempt += 1) {
            const state = this.modelCheckButtonStates()
            if (predicate(state)) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Model check button state did not settle: ' +
              JSON.stringify(this.modelCheckButtonStates()),
          )
        },
        setComposerDraft(value) {
          const textarea = document.querySelector('.composer textarea')
          if (!textarea) throw new Error('Missing composer textarea')
          textarea.focus()
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
            .set.call(textarea, value)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
          textarea.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        },
        welcomeQuickPromptState() {
          const textarea = document.querySelector('.composer textarea')
          const sendButton = document.querySelector('.send-button')
          const cards = Array.from(document.querySelectorAll('[data-welcome-prompt]'))

          return {
            count: cards.length,
            ids: cards.map((card) => card.getAttribute('data-welcome-prompt')),
            labels: cards.map((card) => this.textOf(card)),
            tooltips: cards.map((card) => card.getAttribute('data-tooltip') ?? ''),
            titles: cards.map((card) => card.getAttribute('title') ?? ''),
            ariaLabels: cards.map((card) => card.getAttribute('aria-label') ?? ''),
            draft: textarea?.value ?? '',
            focused: document.activeElement === textarea,
            sendButtonDisabled: sendButton?.disabled ?? null,
            messageCount: document.querySelectorAll('.message').length,
          }
        },
        async clickWelcomePrompt(id = 'code') {
          const card = document.querySelector('[data-welcome-prompt="' + id + '"]')
          if (!card) throw new Error('Missing welcome quick prompt ' + id)
          card.click()
          await new Promise((resolve) => setTimeout(resolve, 120))
          return this.welcomeQuickPromptState()
        },
        composerShortcutState() {
          const textarea = document.querySelector('.composer textarea')
          const button = document.querySelector('.send-button')
          const tooltipTarget = document.querySelector('.send-button-tooltip-target')

          return {
            draft: textarea?.value ?? '',
            messageCount: document.querySelectorAll('.message').length,
            chatRequests: window.__zeroChatChatRequestCount ?? 0,
            sendButtonTooltip: button?.getAttribute('data-tooltip') ?? '',
            sendButtonTooltipTarget: tooltipTarget?.getAttribute('data-tooltip') ?? '',
            sendButtonTitle: button?.getAttribute('title') ?? '',
            sendButtonTargetTitle: tooltipTarget?.getAttribute('title') ?? '',
            sendButtonAria: button?.getAttribute('aria-label') ?? '',
            sendButtonDisabled: button?.disabled ?? null,
          }
        },
        newChatShortcutState() {
          const textarea = document.querySelector('.composer textarea')
          const activeRow = document.querySelector('.conversation-row.active .conversation-select span')
          const button = document.querySelector('[aria-keyshortcuts="Control+N"], [aria-keyshortcuts="Meta+N"]')
          const rows = Array.from(document.querySelectorAll('.conversation-row'))

          return {
            conversationCount: rows.length,
            activeTitle: activeRow?.textContent?.trim() ?? '',
            messageCount: document.querySelectorAll('.message').length,
            draft: textarea?.value ?? '',
            composerFocused: document.activeElement === textarea,
            newChatAria: button?.getAttribute('aria-label') ?? '',
            newChatTitle: button?.getAttribute('title') ?? '',
            newChatShortcut: button?.getAttribute('aria-keyshortcuts') ?? '',
          }
        },
        async dispatchNewChatShortcut(options = {}) {
          const before = this.newChatShortcutState()
          const platform = (navigator.platform || '') + ' ' + (navigator.userAgent || '')
          const apple = /Mac|iPhone|iPad|iPod/i.test(platform)
          const event = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'n',
            code: 'KeyN',
            ctrlKey:
              'ctrlKey' in options ? Boolean(options.ctrlKey) : !apple,
            metaKey:
              'metaKey' in options ? Boolean(options.metaKey) : apple,
            shiftKey: Boolean(options.shiftKey),
            altKey: Boolean(options.altKey),
          })
          const notCancelled = document.dispatchEvent(event)
          await new Promise((resolve) => setTimeout(resolve, options.waitMs ?? 160))

          return {
            before,
            after: this.newChatShortcutState(),
            defaultPrevented: event.defaultPrevented,
            notCancelled,
            options,
          }
        },
        async dispatchComposerEnter(options = {}) {
          const textarea = document.querySelector('.composer textarea')
          if (!textarea) throw new Error('Missing composer textarea')
          textarea.focus()

          const before = this.composerShortcutState()
          const event = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            ctrlKey: Boolean(options.ctrlKey),
            metaKey: Boolean(options.metaKey),
            shiftKey: Boolean(options.shiftKey),
          })
          const notCancelled = textarea.dispatchEvent(event)
          await new Promise((resolve) => setTimeout(resolve, options.waitMs ?? 160))

          return {
            before,
            after: this.composerShortcutState(),
            defaultPrevented: event.defaultPrevented,
            notCancelled,
            options,
          }
        },
        startImagePreviewObjectUrlTracking() {
          if (this.imagePreviewObjectUrlTracking) {
            throw new Error('Image preview object URL tracking is already active')
          }

          const originalCreateObjectURL = URL.createObjectURL
          const originalRevokeObjectURL = URL.revokeObjectURL
          const tracking = {
            created: [],
            originalCreateObjectURL,
            originalRevokeObjectURL,
            revoked: [],
          }
          this.imagePreviewObjectUrlTracking = tracking

          URL.createObjectURL = function (value) {
            const url = originalCreateObjectURL.call(URL, value)
            tracking.created.push(url)
            return url
          }
          URL.revokeObjectURL = function (url) {
            tracking.revoked.push(url)
            return originalRevokeObjectURL.call(URL, url)
          }
        },
        stopImagePreviewObjectUrlTracking() {
          const tracking = this.imagePreviewObjectUrlTracking
          if (!tracking) {
            throw new Error('Image preview object URL tracking is not active')
          }

          URL.createObjectURL = tracking.originalCreateObjectURL
          URL.revokeObjectURL = tracking.originalRevokeObjectURL
          this.imagePreviewObjectUrlTracking = null
          const preview = document.querySelector('.image-source-preview')
          const previewUrl = preview?.currentSrc || preview?.src || ''

          return {
            createdCount: tracking.created.length,
            currentPreviewIndex: tracking.created.indexOf(previewUrl),
            revokeCounts: tracking.created.map(
              (url) => tracking.revoked.filter((revoked) => revoked === url).length,
            ),
          }
        },
        attachTinyImage(fileName = 'zerochat-smoke-source.png') {
          const input = document.querySelector('.image-source-actions input[type="file"]')
          if (!input) throw new Error('Missing image source file input')
          const bytes = Uint8Array.from(
            atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='),
            (char) => char.charCodeAt(0),
          )
          const data = new DataTransfer()
          data.items.add(new File([bytes], fileName, { type: 'image/png' }))
          input.files = data.files
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return input.files?.[0]?.name ?? ''
        },
        async dropTinyImage(fileName = 'zerochat-smoke-dropped-source.png') {
          const panel = document.querySelector('.image-source-panel')
          if (!panel) throw new Error('Missing image source drop panel')
          const bytes = Uint8Array.from(
            atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='),
            (char) => char.charCodeAt(0),
          )
          const data = new DataTransfer()
          data.items.add(new File([bytes], fileName, { type: 'image/png' }))
          const dispatch = (type) => {
            panel.dispatchEvent(
              new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: data,
              }),
            )
          }

          dispatch('dragenter')
          dispatch('dragover')
          let activeBeforeDrop = panel.getAttribute('data-drag-active')

          for (let attempt = 0; attempt < 40; attempt += 1) {
            if (activeBeforeDrop !== null) break
            await new Promise((resolve) => setTimeout(resolve, 25))
            activeBeforeDrop = panel.getAttribute('data-drag-active')
          }

          dispatch('drop')
          let sourceText = ''
          let hasPreview = false

          for (let attempt = 0; attempt < 80; attempt += 1) {
            sourceText = document.querySelector('.image-source-name')?.textContent?.trim() ?? ''
            hasPreview = Boolean(document.querySelector('.image-source-preview'))

            if (sourceText.includes(fileName) && hasPreview) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          return {
            activeBeforeDrop,
            activeAfterDrop: panel.getAttribute('data-drag-active'),
            sourceText,
            hasPreview,
          }
        },
        async dropUnsupportedImageSource(fileName = 'zerochat-smoke-source.txt') {
          const panel = document.querySelector('.image-source-panel')
          if (!panel) throw new Error('Missing image source drop panel')
          const beforeSourceText =
            document.querySelector('.image-source-name')?.textContent?.trim() ?? ''
          const data = new DataTransfer()
          data.items.add(new File(['not an image'], fileName, { type: 'text/plain' }))
          const dispatch = (type) => {
            panel.dispatchEvent(
              new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: data,
              }),
            )
          }

          dispatch('dragenter')
          dispatch('dragover')
          let rejectedBeforeDrop = panel.getAttribute('data-drag-rejected')

          for (let attempt = 0; attempt < 40; attempt += 1) {
            if (rejectedBeforeDrop !== null) break
            await new Promise((resolve) => setTimeout(resolve, 25))
            rejectedBeforeDrop = panel.getAttribute('data-drag-rejected')
          }

          dispatch('drop')
          let noticeText = ''

          for (let attempt = 0; attempt < 80; attempt += 1) {
            noticeText = document.querySelector('.notice.warning')?.textContent?.trim() ?? ''

            if (/PNG|JPEG|WebP/i.test(noticeText)) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          return {
            activeAfterDrop: panel.getAttribute('data-drag-active'),
            beforeSourceText,
            noticeText,
            rejectedAfterDrop: panel.getAttribute('data-drag-rejected'),
            rejectedBeforeDrop,
            sourceText: document.querySelector('.image-source-name')?.textContent?.trim() ?? '',
          }
        },
        async pasteTinyImage(fileName = 'zerochat-smoke-pasted-source.png') {
          const panel = document.querySelector('.image-source-panel')
          if (!panel) throw new Error('Missing image source paste panel')
          const bytes = Uint8Array.from(
            atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='),
            (char) => char.charCodeAt(0),
          )
          const data = new DataTransfer()
          data.items.add(new File([bytes], fileName, { type: 'image/png' }))
          const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          })

          if (event.clipboardData !== data) {
            Object.defineProperty(event, 'clipboardData', {
              configurable: true,
              value: data,
            })
          }

          panel.focus()
          const notCancelled = panel.dispatchEvent(event)
          let sourceText = ''
          let hasPreview = false

          for (let attempt = 0; attempt < 80; attempt += 1) {
            sourceText = document.querySelector('.image-source-name')?.textContent?.trim() ?? ''
            hasPreview = Boolean(document.querySelector('.image-source-preview'))

            if (sourceText.includes(fileName) && hasPreview) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          return {
            activeElementClass: document.activeElement?.className ?? '',
            defaultPrevented: event.defaultPrevented,
            hasPreview,
            notCancelled,
            sourceText,
            tooltip: panel.getAttribute('data-tooltip') ?? '',
          }
        },
        async pasteUnsupportedImageSource(fileName = 'zerochat-smoke-source.pdf') {
          const panel = document.querySelector('.image-source-panel')
          if (!panel) throw new Error('Missing image source paste panel')
          const beforeSourceText =
            document.querySelector('.image-source-name')?.textContent?.trim() ?? ''
          const data = new DataTransfer()
          data.items.add(new File(['%PDF-1.7'], fileName, { type: 'application/pdf' }))
          const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          })

          if (event.clipboardData !== data) {
            Object.defineProperty(event, 'clipboardData', {
              configurable: true,
              value: data,
            })
          }

          panel.focus()
          const notCancelled = panel.dispatchEvent(event)
          let noticeText = ''

          for (let attempt = 0; attempt < 80; attempt += 1) {
            noticeText = document.querySelector('.notice.warning')?.textContent?.trim() ?? ''

            if (/PNG|JPEG|WebP/i.test(noticeText)) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          return {
            beforeSourceText,
            defaultPrevented: event.defaultPrevented,
            notCancelled,
            noticeText,
            sourceText: document.querySelector('.image-source-name')?.textContent?.trim() ?? '',
          }
        },
        pastePlainTextOnSourcePanel() {
          const panel = document.querySelector('.image-source-panel')
          if (!panel) throw new Error('Missing image source paste panel')
          const beforeSourceText =
            document.querySelector('.image-source-name')?.textContent?.trim() ?? ''
          const data = new DataTransfer()
          data.setData('text/plain', 'plain clipboard text should stay available')
          const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          })

          if (event.clipboardData !== data) {
            Object.defineProperty(event, 'clipboardData', {
              configurable: true,
              value: data,
            })
          }

          panel.focus()
          const notCancelled = panel.dispatchEvent(event)

          return {
            beforeSourceText,
            defaultPrevented: event.defaultPrevented,
            notCancelled,
            sourceText: document.querySelector('.image-source-name')?.textContent?.trim() ?? '',
          }
        },
        tinyAudioFile(fileName = 'zerochat-smoke-audio.wav') {
          const bytes = Uint8Array.from(
            atob('UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='),
            (char) => char.charCodeAt(0),
          )
          return new File([bytes], fileName, { type: 'audio/wav' })
        },
        async attachTinyAudio(fileName = 'zerochat-smoke-audio.wav') {
          const input = document.querySelector('.audio-source-actions input[type="file"]')
          if (!input) throw new Error('Missing audio source file input')
          const data = new DataTransfer()
          data.items.add(this.tinyAudioFile(fileName))
          input.files = data.files
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))

          for (let attempt = 0; attempt < 80; attempt += 1) {
            const sourceText = document.querySelector('.audio-source-name')?.textContent?.trim() ?? ''

            if (sourceText.includes(fileName)) {
              return {
                accept: input.getAttribute('accept') ?? '',
                fileName: input.files?.[0]?.name ?? '',
                sourceText,
              }
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          return {
            accept: input.getAttribute('accept') ?? '',
            fileName: input.files?.[0]?.name ?? '',
            sourceText: document.querySelector('.audio-source-name')?.textContent?.trim() ?? '',
          }
        },
        async dropTinyAudio(fileName = 'zerochat-smoke-dropped-audio.wav') {
          const panel = document.querySelector('.audio-source-panel')
          if (!panel) throw new Error('Missing audio source drop panel')
          const data = new DataTransfer()
          data.items.add(this.tinyAudioFile(fileName))
          const dispatch = (type) => {
            panel.dispatchEvent(
              new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: data,
              }),
            )
          }

          dispatch('dragenter')
          dispatch('dragover')
          let activeBeforeDrop = panel.getAttribute('data-drag-active')

          for (let attempt = 0; attempt < 40; attempt += 1) {
            if (activeBeforeDrop !== null) break
            await new Promise((resolve) => setTimeout(resolve, 25))
            activeBeforeDrop = panel.getAttribute('data-drag-active')
          }

          dispatch('drop')
          let sourceText = ''

          for (let attempt = 0; attempt < 80; attempt += 1) {
            sourceText = document.querySelector('.audio-source-name')?.textContent?.trim() ?? ''

            if (sourceText.includes(fileName)) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          return {
            activeAfterDrop: panel.getAttribute('data-drag-active'),
            activeBeforeDrop,
            sourceText,
          }
        },
        async dropUnsupportedAudioSource(fileName = 'zerochat-smoke-audio-source.txt') {
          const panel = document.querySelector('.audio-source-panel')
          if (!panel) throw new Error('Missing audio source drop panel')
          const beforeSourceText =
            document.querySelector('.audio-source-name')?.textContent?.trim() ?? ''
          const data = new DataTransfer()
          data.items.add(new File(['not audio'], fileName, { type: 'text/plain' }))
          const dispatch = (type) => {
            panel.dispatchEvent(
              new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: data,
              }),
            )
          }

          dispatch('dragenter')
          dispatch('dragover')
          let rejectedBeforeDrop = panel.getAttribute('data-drag-rejected')

          for (let attempt = 0; attempt < 40; attempt += 1) {
            if (rejectedBeforeDrop !== null) break
            await new Promise((resolve) => setTimeout(resolve, 25))
            rejectedBeforeDrop = panel.getAttribute('data-drag-rejected')
          }

          dispatch('drop')
          let noticeText = ''

          for (let attempt = 0; attempt < 80; attempt += 1) {
            noticeText = document.querySelector('.notice.warning')?.textContent?.trim() ?? ''

            if (/audio|MP4|WebM|音频|视频/i.test(noticeText)) break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          return {
            activeAfterDrop: panel.getAttribute('data-drag-active'),
            beforeSourceText,
            noticeText,
            rejectedAfterDrop: panel.getAttribute('data-drag-rejected'),
            rejectedBeforeDrop,
            sourceText: document.querySelector('.audio-source-name')?.textContent?.trim() ?? '',
          }
        },
        audioComposerState() {
          const panel = document.querySelector('.audio-source-panel')
          const input = document.querySelector('.audio-source-actions input[type="file"]')
          const chooseLabel = document.querySelector('.audio-source-actions label.file-button')
          const clearButton = document.querySelector('.audio-source-actions button')
          const textarea = document.querySelector('.composer textarea')
          const sendButton = document.querySelector('.send-button')
          const tooltipTarget = document.querySelector('.send-button-tooltip-target')
          const panelBox = panel?.getBoundingClientRect()
          const composerBox = document.querySelector('.composer')?.getBoundingClientRect()

          return {
            accept: input?.getAttribute('accept') ?? '',
            clearButtonVisible: Boolean(clearButton),
            chooseAriaDisabled: chooseLabel?.getAttribute('aria-disabled') ?? null,
            chooseClassDisabled: chooseLabel?.classList.contains('disabled') ?? null,
            chooseInputDisabled: input?.disabled ?? null,
            composerBottom: composerBox?.bottom ?? null,
            composerTop: composerBox?.top ?? null,
            modeActive: document
              .querySelector('[data-compose-mode="audio"]')
              ?.classList.contains('active') ?? false,
            noteText: document.querySelector('.audio-source-note')?.textContent?.trim() ?? '',
            panelBottom: panelBox?.bottom ?? null,
            panelTop: panelBox?.top ?? null,
            panelVisible: Boolean(panelBox && panelBox.width > 0 && panelBox.height > 0),
            placeholder: textarea?.getAttribute('placeholder') ?? '',
            rootScrollWidth: document.documentElement.scrollWidth,
            sendButtonAria: sendButton?.getAttribute('aria-label') ?? '',
            sendButtonDisabled: sendButton?.disabled ?? null,
            sendButtonText: sendButton?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            sendButtonTitle: sendButton?.getAttribute('title') ?? '',
            sendButtonTooltip: sendButton?.getAttribute('data-tooltip') ?? '',
            sendButtonTargetTitle: tooltipTarget?.getAttribute('title') ?? '',
            sendButtonTooltipTarget: tooltipTarget?.getAttribute('data-tooltip') ?? '',
            sourceText: document.querySelector('.audio-source-name')?.textContent?.trim() ?? '',
            viewportWidth: window.innerWidth,
          }
        },
        async exerciseMaskUndo() {
          const helper = this
          const findButton = (names) =>
            Array.from(document.querySelectorAll('button'))
              .find((button) => names.some((name) => helper.textOf(button).includes(name)))
          const waitFor = async (predicate, label) => {
            for (let attempt = 0; attempt < 80; attempt += 1) {
              const value = predicate()
              if (value) return value
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            throw new Error('Timed out waiting for ' + label)
          }
          const canvas = await waitFor(
            () => {
              const element = document.querySelector('.mask-canvas')
              return element?.width > 0 && element?.height > 0 ? element : null
            },
            'mask canvas',
          )
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Missing mask canvas context')
          const paintedPixels = () => {
            const data = context.getImageData(0, 0, canvas.width, canvas.height).data
            let count = 0
            for (let index = 3; index < data.length; index += 4) {
              if (data[index] > 0) count += 1
            }
            return count
          }
          const paintStroke = async () => {
            const rect = canvas.getBoundingClientRect()
            const x = rect.left + rect.width / 2
            const y = rect.top + rect.height / 2
            const eventOptions = {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              pointerId: 31,
              pointerType: 'mouse',
              isPrimary: true,
              button: 0,
              buttons: 1,
            }
            canvas.dispatchEvent(new PointerEvent('pointerdown', eventOptions))
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                ...eventOptions,
                clientX: x + Math.max(1, rect.width / 6),
                clientY: y,
              }),
            )
            canvas.dispatchEvent(
              new PointerEvent('pointerup', {
                ...eventOptions,
                buttons: 0,
              }),
            )
            return waitFor(() => paintedPixels() > 0, 'painted mask pixels')
          }
          const undoButton = await waitFor(
            () => findButton(['撤销上一笔', 'Undo stroke']),
            'mask undo button',
          )
          const clearButton = await waitFor(
            () => findButton(['清除涂抹', 'Clear mask']),
            'mask clear button',
          )

          const initialPixels = paintedPixels()
          const dispatchRejectedStroke = async ({ button, isPrimary, pointerId }) => {
            const rect = canvas.getBoundingClientRect()
            const eventOptions = {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width / 3,
              clientY: rect.top + rect.height / 3,
              pointerId,
              pointerType: 'mouse',
              isPrimary,
              button,
              buttons: button === 0 ? 1 : 2,
            }
            canvas.dispatchEvent(new PointerEvent('pointerdown', eventOptions))
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                ...eventOptions,
                clientX: eventOptions.clientX + Math.max(1, rect.width / 5),
              }),
            )
            canvas.dispatchEvent(
              new PointerEvent('pointerup', {
                ...eventOptions,
                buttons: 0,
              }),
            )
            await new Promise((resolve) => setTimeout(resolve, 80))
            return {
              clearEnabled: !clearButton.disabled,
              pixels: paintedPixels(),
              undoEnabled: !undoButton.disabled,
            }
          }
          const secondaryButtonState = await dispatchRejectedStroke({
            button: 2,
            isPrimary: true,
            pointerId: 32,
          })
          const nonPrimaryPointerState = await dispatchRejectedStroke({
            button: 0,
            isPrimary: false,
            pointerId: 33,
          })
          await paintStroke()
          const afterPaintPixels = paintedPixels()
          const undoEnabledAfterPaint = !undoButton.disabled
          const clearEnabledAfterPaint = !clearButton.disabled

          undoButton.click()
          await waitFor(
            () => paintedPixels() === initialPixels && clearButton.disabled,
            'undo restored blank mask',
          )
          const afterUndoPixels = paintedPixels()
          const undoEnabledAfterUndo = !undoButton.disabled
          const clearEnabledAfterUndo = !clearButton.disabled

          await paintStroke()
          const afterSecondPaintPixels = paintedPixels()
          clearButton.click()
          await waitFor(
            () => paintedPixels() === 0 && clearButton.disabled && !undoButton.disabled,
            'clear mask kept undo available',
          )
          const afterClearPixels = paintedPixels()
          const undoEnabledAfterClear = !undoButton.disabled

          undoButton.click()
          await waitFor(
            () => paintedPixels() === afterSecondPaintPixels && !clearButton.disabled,
            'undo restored cleared mask',
          )
          const afterClearUndoPixels = paintedPixels()

          clearButton.click()
          await waitFor(
            () => paintedPixels() === 0 && clearButton.disabled && !undoButton.disabled,
            'keyboard paint started from a blank mask',
          )
          canvas.focus()
          const keyboardMove = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowRight',
          })
          canvas.dispatchEvent(keyboardMove)
          await waitFor(
            () => {
              const cursor = document.querySelector('.mask-keyboard-cursor')
              return cursor && cursor.style.left !== '50%' ? cursor : null
            },
            'keyboard cursor moved',
          )
          const keyboardPaint = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: ' ',
          })
          canvas.dispatchEvent(keyboardPaint)
          await waitFor(
            () => paintedPixels() > 0 && !clearButton.disabled && !undoButton.disabled,
            'keyboard-painted mask pixels',
          )
          const keyboardPaintPixels = paintedPixels()
          const keyboardCursor = document.querySelector('.mask-keyboard-cursor')
          const keyboardHelp = document.getElementById('mask-keyboard-help')
          clearButton.click()
          await waitFor(
            () => paintedPixels() === 0 && clearButton.disabled,
            'capture-loss recovery started from a blank mask',
          )

          const rect = canvas.getBoundingClientRect()
          const captureFailurePointer = {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 3,
            clientY: rect.top + rect.height / 3,
            pointerId: 34,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 1,
          }
          const ownCaptureDescriptor = Object.getOwnPropertyDescriptor(
            canvas,
            'setPointerCapture',
          )
          Object.defineProperty(canvas, 'setPointerCapture', {
            configurable: true,
            value() {
              throw new Error('capture unavailable')
            },
          })
          try {
            canvas.dispatchEvent(
              new PointerEvent('pointerdown', captureFailurePointer),
            )
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                ...captureFailurePointer,
                clientX: captureFailurePointer.clientX + Math.max(1, rect.width / 8),
              }),
            )
            await waitFor(
              () => paintedPixels() > 0,
              'capture-failed pointer painted inside the mask',
            )
            canvas.dispatchEvent(
              new PointerEvent('pointerout', {
                ...captureFailurePointer,
                relatedTarget: document.body,
              }),
            )
          } finally {
            if (ownCaptureDescriptor) {
              Object.defineProperty(
                canvas,
                'setPointerCapture',
                ownCaptureDescriptor,
              )
            } else {
              delete canvas.setPointerCapture
            }
          }
          const captureFailurePaintPixels = paintedPixels()
          const recoveredPointer = {
            ...captureFailurePointer,
            clientX: rect.left + (rect.width * 2) / 3,
            clientY: rect.top + (rect.height * 2) / 3,
            pointerId: 35,
          }
          canvas.dispatchEvent(new PointerEvent('pointerdown', recoveredPointer))
          canvas.dispatchEvent(
            new PointerEvent('pointermove', {
              ...recoveredPointer,
              clientX: recoveredPointer.clientX + Math.max(1, rect.width / 8),
            }),
          )
          canvas.dispatchEvent(
            new PointerEvent('pointerup', {
              ...recoveredPointer,
              buttons: 0,
            }),
          )
          await new Promise((resolve) => setTimeout(resolve, 80))
          undoButton.click()
          await new Promise((resolve) => setTimeout(resolve, 80))
          const captureFailureRecoveryUndoPixels = paintedPixels()

          return {
            afterClearPixels,
            afterClearUndoPixels,
            afterPaintPixels,
            afterSecondPaintPixels,
            afterUndoPixels,
            clearEnabledAfterPaint,
            clearEnabledAfterUndo,
            captureFailurePaintPixels,
            captureFailureRecoveryUndoPixels,
            initialPixels,
            keyboardCursorLeft: keyboardCursor?.style.left ?? '',
            keyboardCursorVisible:
              keyboardCursor ? getComputedStyle(keyboardCursor).opacity !== '0' : false,
            keyboardHelpText: keyboardHelp?.textContent?.trim() ?? '',
            keyboardMovePrevented: keyboardMove.defaultPrevented,
            keyboardPaintPixels,
            keyboardPaintPrevented: keyboardPaint.defaultPrevented,
            nonPrimaryPointerState,
            secondaryButtonState,
            undoEnabledAfterClear,
            undoEnabledAfterPaint,
            undoEnabledAfterUndo,
          }
        },
        async waitForImageRequestStarted() {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            if (window.__zeroChatImageRequestStarted) {
              return window.__zeroChatImageRequestUrl
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Image request did not start')
        },
        async waitForImageComposerUnlocked() {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const tabs = Array.from(document.querySelectorAll('[data-image-task-mode]'))
            const sendButton = document.querySelector('.send-button')
            const unlocked =
              tabs.length > 0 &&
              tabs.every((button) => !button.disabled) &&
              sendButton &&
              !this.match(sendButton, ['停止', 'Stop'])

            if (unlocked) {
              return true
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Image composer did not unlock after stopping the pending request')
        },
        imageTaskModeState() {
          const tabs = Array.from(document.querySelectorAll('[data-image-task-mode]'))

          return {
            count: tabs.length,
            tabs: tabs.map((button) => {
              const tooltipTarget = button.closest('.composer-mode-tooltip-target')

              return {
                mode: button.getAttribute('data-image-task-mode') ?? '',
                ariaLabel: button.getAttribute('aria-label') ?? '',
                dataTooltip: button.getAttribute('data-tooltip') ?? '',
                title: button.getAttribute('title') ?? '',
                pressed: button.getAttribute('aria-pressed') ?? '',
                targetTitle: tooltipTarget?.getAttribute('title') ?? '',
                targetTooltip: tooltipTarget?.getAttribute('data-tooltip') ?? '',
                text: button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
              }
            }),
          }
        },
        maskActionButtonStates() {
          const collect = (action) => {
            const button = document.querySelector('[data-mask-action="' + action + '"]')
            const tooltipTarget = button?.closest('.mask-action-tooltip-target')
            const describedBy = button?.getAttribute('aria-describedby') ?? ''
            const note = describedBy ? document.getElementById(describedBy) : null
            const rect = button?.getBoundingClientRect()
            const hit = rect
              ? document.elementFromPoint(
                  Math.floor(rect.left + rect.width / 2),
                  Math.floor(rect.top + rect.height / 2),
                )
              : null
            const style = button ? getComputedStyle(button) : null

            return {
              action: button?.getAttribute('data-mask-action') ?? '',
              describedBy,
              disabled: button?.disabled ?? null,
              hitClass: hit?.className ?? '',
              hitTag: hit?.tagName ?? '',
              noteText: note?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
              pointerEvents: style?.pointerEvents ?? '',
              targetTitle: tooltipTarget?.getAttribute('title') ?? '',
              targetTooltip: tooltipTarget?.getAttribute('data-tooltip') ?? '',
              text: button?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
              title: button?.getAttribute('title') ?? '',
              tooltip: button?.getAttribute('data-tooltip') ?? '',
              visible: Boolean(rect && rect.width > 0 && rect.height > 0),
            }
          }

          return {
            clear: collect('clear'),
            undo: collect('undo'),
          }
        },
        imageBusyLockState() {
          const helper = this
          const collectModeButton = (selector) => {
            const button = document.querySelector(selector)
            const tooltipTarget = button?.closest('.composer-mode-tooltip-target')
            const rect = button?.getBoundingClientRect()
            const targetRect = tooltipTarget?.getBoundingClientRect()
            const hit = rect
              ? document.elementFromPoint(
                  Math.floor(rect.left + rect.width / 2),
                  Math.floor(rect.top + rect.height / 2),
                )
              : null
            const targetHit = targetRect
              ? document.elementFromPoint(
                  Math.floor(targetRect.left + targetRect.width / 2),
                  Math.floor(targetRect.top + targetRect.height / 2),
                )
              : null
            const style = button ? getComputedStyle(button) : null

            return {
              ariaLabel: button?.getAttribute('aria-label') ?? '',
              disabled: button?.disabled ?? null,
              hitClass: hit?.className ?? '',
              hitTag: hit?.tagName ?? '',
              pointerEvents: style?.pointerEvents ?? '',
              targetHeight: targetRect?.height ?? null,
              targetHitClass: targetHit?.className ?? '',
              targetHitTag: targetHit?.tagName ?? '',
              targetLeft: targetRect?.left ?? null,
              targetTop: targetRect?.top ?? null,
              targetTitle: tooltipTarget?.getAttribute('title') ?? '',
              targetTooltip: tooltipTarget?.getAttribute('data-tooltip') ?? '',
              targetWidth: targetRect?.width ?? null,
              text: button?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
              title: button?.getAttribute('title') ?? '',
              tooltip: button?.getAttribute('data-tooltip') ?? '',
              visible: Boolean(rect && rect.width > 0 && rect.height > 0),
            }
          }
          const chooseLabel = document.querySelector('.image-source-actions label.file-button')
          const chooseInput = chooseLabel?.querySelector('input[type="file"]') ?? null
          const sendButton = document.querySelector('.send-button')
          const imageTabs = Array.from(document.querySelectorAll('[data-image-task-mode]'))
            .map((button) => ({
              ...collectModeButton('[data-image-task-mode="' + button.getAttribute('data-image-task-mode') + '"]'),
              mode: button.getAttribute('data-image-task-mode'),
            }))
          const chatMode = collectModeButton('[data-compose-mode="chat"]')
          const imageMode = collectModeButton('[data-compose-mode="image"]')

          return {
            requestStarted: window.__zeroChatImageRequestStarted === true,
            requestUrl: window.__zeroChatImageRequestUrl,
            chatMode,
            chatModeDisabled: chatMode.disabled,
            imageMode,
            imageModeDisabled: imageMode.disabled,
            imageTabs,
            chooseAriaDisabled: chooseLabel?.getAttribute('aria-disabled') ?? null,
            chooseClassDisabled: chooseLabel?.classList.contains('disabled') ?? null,
            chooseInputDisabled: chooseInput?.disabled ?? null,
            sendButtonIsStop: sendButton ? helper.match(sendButton, ['停止', 'Stop']) : false,
          }
        },
        exerciseInlineImageDownload() {
          const button = document.querySelector('[data-attachment-download="true"]')
          const frame = button?.closest('.attachment-frame')
          const image = frame?.querySelector('img')

          if (!button || !frame || !image) {
            throw new Error('Missing inline image download action')
          }

          const originalClick = HTMLAnchorElement.prototype.click
          window.__zeroChatLastImageDownload = null
          HTMLAnchorElement.prototype.click = function click() {
            window.__zeroChatLastImageDownload = {
              download: this.download,
              href: this.href,
              rel: this.rel,
            }
          }

          try {
            button.click()
          } finally {
            HTMLAnchorElement.prototype.click = originalClick
          }

          const rect = button.getBoundingClientRect()
          const frameRect = frame.getBoundingClientRect()

          return {
            buttonDisabled: button.disabled,
            buttonHeight: rect.height,
            buttonWidth: rect.width,
            download: window.__zeroChatLastImageDownload,
            frameClass: frame.className,
            imageAlt: image.getAttribute('alt') ?? '',
            insideFrame:
              rect.left >= frameRect.left &&
              rect.top >= frameRect.top &&
              rect.right <= frameRect.right + 1 &&
              rect.bottom <= frameRect.bottom + 1,
            dataTooltip: button.getAttribute('data-tooltip') ?? '',
            title: button.getAttribute('title') ?? '',
            ariaLabel: button.getAttribute('aria-label') ?? '',
          }
        },
        reducedMotionState() {
          const durationToMs = (value) => Math.max(
            ...String(value || '0s')
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
              .map((item) => {
                const numeric = Number.parseFloat(item)
                if (!Number.isFinite(numeric)) return 0
                return item.endsWith('ms') ? numeric : numeric * 1000
              }),
            0,
          )
          const sample = document.createElement('span')
          sample.style.position = 'fixed'
          sample.style.left = '-9999px'
          sample.style.transition = 'opacity 200ms ease'
          sample.style.animation = 'spin 850ms linear infinite'
          sample.textContent = 'motion sample'
          document.body.append(sample)

          const spinSample = document.createElement('span')
          spinSample.className = 'spin'
          spinSample.style.position = 'fixed'
          spinSample.style.left = '-9999px'
          spinSample.textContent = 'spin sample'
          document.body.append(spinSample)

          const modeButton = document.querySelector('.mode-grid button')
          const sidebar = document.querySelector('.sidebar')
          const sampleStyle = getComputedStyle(sample)
          const spinStyle = getComputedStyle(spinSample)
          const modeButtonStyle = modeButton ? getComputedStyle(modeButton) : null
          const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null
          const state = {
            mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            sampleTransitionMs: durationToMs(sampleStyle.transitionDuration),
            sampleAnimationMs: durationToMs(sampleStyle.animationDuration),
            sampleAnimationIterationCount: sampleStyle.animationIterationCount,
            spinAnimationName: spinStyle.animationName,
            spinAnimationMs: durationToMs(spinStyle.animationDuration),
            modeButtonTransitionMs: durationToMs(modeButtonStyle?.transitionDuration),
            sidebarTransitionMs: durationToMs(sidebarStyle?.transitionDuration),
          }

          sample.remove()
          spinSample.remove()
          return state
        },
        async waitForDocumentLanguage(lang, dir) {
          const settingsTitles = {
            'zh-CN': '设置',
            'en-US': 'Settings',
            'es-ES': 'Ajustes',
            'hi-IN': 'सेटिंग',
            'ar-SA': 'الإعدادات',
            'pt-BR': 'Configurações',
            'ru-RU': 'Настройки',
            'ja-JP': '設定',
            'ko-KR': '설정',
            'fr-FR': 'Réglages',
          }
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const langMatches = !lang || document.documentElement.lang === lang
            const dirMatches = !dir || document.documentElement.dir === dir
            const expectedTitle = settingsTitles[lang]
            const settingsTitle = document.querySelector('#settings-title')?.textContent
            const textMatches =
              !expectedTitle || settingsTitle === undefined || settingsTitle === expectedTitle
            if (langMatches && dirMatches && textMatches) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Document language did not settle: ' +
              document.documentElement.lang +
              '/' +
              document.documentElement.dir +
              ' title=' +
              (document.querySelector('#settings-title')?.textContent ?? ''),
          )
        },
        async waitForControl() {
          for (let attempt = 0; attempt < 100; attempt += 1) {
            if (document.querySelector('button, [role="button"], label')) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('No controls rendered; body: ' + (document.body.textContent || '').trim().slice(0, 300))
        },
        async waitForText(names) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (Array.from(document.querySelectorAll('body *')).some((item) => this.match(item, names))) {
              return true
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Missing text: ' +
              names.join(' / ') +
              '; danger=' +
              Boolean(document.querySelector('.danger-modal')) +
              '; syncActive=' +
              (document.querySelector('.sync-compare-card.active')?.textContent || '').trim() +
              '; dataPasswordLength=' +
              (Array.from(document.querySelectorAll('label'))
                .find((item) => this.match(item, ['数据加密密码', 'Data encryption password']))
                ?.querySelector('input')
                ?.value.length ?? 0) +
              '; savedPassphrasePresent=' +
              Boolean(sessionStorage.getItem('zerochat:secret:sync-passphrase')) +
              '; savedPassphraseLength=' +
              (sessionStorage.getItem('zerochat:secret:sync-passphrase') || '').length +
              '; body=' +
              (document.body.textContent || '').trim().slice(0, 500),
          )
        },
        messageScrollState() {
          const list = document.querySelector('.message-list')
          const button = document.querySelector('.new-messages-button')
          const buttonBox = button?.getBoundingClientRect()
          const buttonStyle = button ? getComputedStyle(button) : null
          const buttonVisible = Boolean(
            button &&
              buttonBox &&
              buttonBox.width > 0 &&
              buttonBox.height > 0 &&
              buttonStyle?.visibility !== 'hidden' &&
              buttonStyle?.display !== 'none',
          )
          const distanceFromBottom = list
            ? Math.max(0, list.scrollHeight - list.clientHeight - list.scrollTop)
            : -1

          return {
            exists: Boolean(list),
            scrollTop: list?.scrollTop ?? -1,
            scrollHeight: list?.scrollHeight ?? 0,
            clientHeight: list?.clientHeight ?? 0,
            canScroll: list ? list.scrollHeight > list.clientHeight + 1 : false,
            distanceFromBottom,
            nearBottom: distanceFromBottom <= 24,
            newMessagesButtonVisible: buttonVisible,
            newMessagesButtonLabel: button ? this.textOf(button) : '',
            transcriptFocused: document.activeElement === list,
            activeElementTag: document.activeElement?.tagName ?? '',
            activeElementClass:
              document.activeElement instanceof HTMLElement
                ? document.activeElement.className
                : '',
          }
        },
        horizontalSafeAreaState() {
          const root = document.documentElement
          root.style.setProperty('--safe-area-left', '32px')
          root.style.setProperty('--safe-area-right', '44px')
          const sidebar = document.querySelector('.sidebar')
          const chatPane = document.querySelector('.chat-pane')
          const state = {
            mobileLayout: matchMedia('(max-width: 860px)').matches,
            sidebarPaddingLeft: sidebar
              ? Number.parseFloat(getComputedStyle(sidebar).paddingLeft)
              : -1,
            chatPanePaddingLeft: chatPane
              ? Number.parseFloat(getComputedStyle(chatPane).paddingLeft)
              : -1,
            chatPanePaddingRight: chatPane
              ? Number.parseFloat(getComputedStyle(chatPane).paddingRight)
              : -1,
          }
          root.style.removeProperty('--safe-area-left')
          root.style.removeProperty('--safe-area-right')
          return state
        },
        async waitForMessageListScrollable() {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const state = this.messageScrollState()
            if (state.canScroll) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Message list did not become scrollable for the new messages button smoke: ' +
              JSON.stringify(this.messageScrollState()),
          )
        },
        scrollMessageListAwayFromBottom() {
          const list = document.querySelector('.message-list')
          if (!list) throw new Error('Missing message list')
          list.scrollTo({ top: 0, behavior: 'auto' })
          list.dispatchEvent(new Event('scroll', { bubbles: true }))
          return this.messageScrollState()
        },
        async waitForMessageListAwayFromBottom(minDistance = 100) {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const state = this.messageScrollState()
            if (state.distanceFromBottom > minDistance) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Message list did not stay away from the bottom: ' +
              JSON.stringify(this.messageScrollState()),
          )
        },
        async waitForNewMessagesButtonVisible() {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const state = this.messageScrollState()
            if (state.newMessagesButtonVisible) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'New messages button did not appear while the reader was scrolled up: ' +
              JSON.stringify(this.messageScrollState()),
          )
        },
        clickNewMessagesButton() {
          const button = document.querySelector('.new-messages-button')
          if (!button) {
            throw new Error(
              'Missing new messages button: ' +
                JSON.stringify(this.messageScrollState()),
            )
          }
          button.click()
          return this.messageScrollState()
        },
        focusNewMessagesButton() {
          const button = document.querySelector('.new-messages-button')
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error('Missing new messages button')
          }
          button.focus()
          return document.activeElement === button
        },
        async waitForMessageListNearBottom(maxDistance = 24) {
          for (let attempt = 0; attempt < 160; attempt += 1) {
            const state = this.messageScrollState()
            if (state.exists && state.distanceFromBottom <= maxDistance) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'New messages button did not jump the message list to the latest turn: ' +
              JSON.stringify(this.messageScrollState()),
          )
        },
        async waitForComposerIdle() {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const button = document.querySelector('.send-button')
            const textarea = document.querySelector('.composer textarea')
            if (textarea && button?.getAttribute('type') === 'submit') return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Composer did not return to an idle send state.')
        },
        async waitForReadyToSend() {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const button = document.querySelector('.send-button[type="submit"]')
            if (button && !button.disabled) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          const button = document.querySelector('.send-button')
          const textarea = document.querySelector('.composer textarea')
          throw new Error(
            'Composer send button did not become enabled: ' +
              JSON.stringify({
                buttonAria: button?.getAttribute('aria-label') ?? '',
                buttonDisabled: button?.disabled ?? null,
                buttonTitle: button?.getAttribute('title') ?? '',
                buttonType: button?.getAttribute('type') ?? '',
                body: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
                textareaDisabled: textarea?.disabled ?? null,
                textareaValue: textarea?.value ?? null,
              }),
          )
        },
        async waitForTooltipForSelector(selector) {
          const candidates = Array.from(document.querySelectorAll(selector))
          const target =
            candidates.find((candidate) => {
              const rect = candidate.getBoundingClientRect()
              const style = window.getComputedStyle(candidate)
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden'
              )
            }) ?? candidates[0]
          if (!target) throw new Error('Missing tooltip target: ' + selector)
          const startedAt = Date.now()
          target.scrollIntoView?.({ block: 'center', inline: 'nearest' })
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const rect = target.getBoundingClientRect()
          const clientX = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1)
          const clientY = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1)
          const eventBase = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX,
            clientY,
            screenX: clientX,
            screenY: clientY,
            relatedTarget: document.body,
          }
          const dispatchPointerEvent = (type) => {
            const PointerCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
            target.dispatchEvent(
              new PointerCtor(type, {
                ...eventBase,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true,
              }),
            )
          }
          const dispatchMouseEvent = (type) => {
            target.dispatchEvent(new MouseEvent(type, eventBase))
          }
          dispatchPointerEvent('pointerover')
          dispatchPointerEvent('pointerenter')
          dispatchMouseEvent('mouseover')
          dispatchMouseEvent('mouseenter')
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const tooltip = document.querySelector('.app-tooltip[role="tooltip"]')
            const text = (tooltip?.textContent || '').replace(/\\s+/g, ' ').trim()
            if (text) {
              dispatchPointerEvent('pointerout')
              dispatchPointerEvent('pointerleave')
              dispatchMouseEvent('mouseout')
              dispatchMouseEvent('mouseleave')
              return {
                elapsedMs: Date.now() - startedAt,
                placement: tooltip.getAttribute('data-placement') ?? '',
                text,
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
          throw new Error(
            'Tooltip did not appear for ' +
              selector +
              '; targetTooltip=' +
              (target.getAttribute('data-tooltip') || '') +
              '; targetAria=' +
              (target.getAttribute('aria-label') || '') +
              '; targetRect=' +
              JSON.stringify({
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                candidateCount: candidates.length,
              }),
          )
        },
        installButtonFeedbackProbe() {
          document.querySelector('[data-button-feedback-probe="true"]')?.remove()
          const button = document.createElement('button')
          button.className = 'send-button'
          button.type = 'button'
          button.textContent = 'Feedback probe'
          button.setAttribute('aria-label', 'Feedback probe')
          button.setAttribute('data-button-feedback-probe', 'true')
          Object.assign(button.style, {
            left: '48px',
            position: 'fixed',
            top: '48px',
            zIndex: '2147483647',
          })
          ;(document.querySelector('.guide-modal') ?? document.body).append(button)
          return this.buttonFeedbackProbeState()
        },
        buttonFeedbackProbeState() {
          const button = document.querySelector('[data-button-feedback-probe="true"]')
          if (!button) throw new Error('Missing button feedback probe')
          const rect = button.getBoundingClientRect()
          const style = getComputedStyle(button)
          const matrix =
            style.transform === 'none'
              ? new DOMMatrixReadOnly()
              : new DOMMatrixReadOnly(style.transform)

          return {
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            transform: style.transform,
            scaleX: Number(matrix.a.toFixed(3)),
            scaleY: Number(matrix.d.toFixed(3)),
            transitionDuration: style.transitionDuration,
            transitionProperty: style.transitionProperty,
          }
        },
        removeButtonFeedbackProbe() {
          const guideModal = document.querySelector('.guide-modal')
          document.querySelector('[data-button-feedback-probe="true"]')?.remove()
          guideModal?.querySelector('button:not([disabled])')?.focus()
          return true
        },
        async sendChatSmokeMessage(value) {
          await this.waitForComposerIdle()
          const beforeMessages = document.querySelectorAll('.message').length
          this.setComposerDraft(value)
          await this.waitForReadyToSend()
          document.querySelector('.send-button')?.click()
          await this.waitForText([value])

          for (let attempt = 0; attempt < 120; attempt += 1) {
            const messageCount = document.querySelectorAll('.message').length
            const button = document.querySelector('.send-button')
            if (messageCount >= beforeMessages + 2 && button?.getAttribute('type') === 'submit') {
              return {
                beforeMessages,
                messageCount,
                scroll: this.messageScrollState(),
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Chat smoke message did not finish: ' +
              JSON.stringify({
                beforeMessages,
                messageCount: document.querySelectorAll('.message').length,
                scroll: this.messageScrollState(),
              }),
          )
        },
        assistantTextState() {
          const assistantTexts = Array.from(document.querySelectorAll('.message.assistant p'))
            .map((item) => (item.textContent || '').trim())
            .filter(Boolean)
          const sendButton = document.querySelector('.send-button')

          return {
            assistantTexts,
            lastAssistantText: assistantTexts.at(-1) ?? '',
            sendButtonType: sendButton?.getAttribute('type') ?? '',
            sendButtonLabel: sendButton ? this.textOf(sendButton) : '',
            streamingCursorCount: document.querySelectorAll('[data-streaming-cursor="true"]').length,
            streamingMessageCount: document.querySelectorAll('.message.assistant.streaming').length,
            streamingSmokeRequests: window.__zeroChatStreamingSmokeRequestCount ?? 0,
            typingIndicatorCount: document.querySelectorAll('[data-streaming-typing-indicator="true"]').length,
          }
        },
        generationRetryState() {
          const retryButton = document.querySelector('[data-message-retry-action="true"]')
          const errorMessages = Array.from(document.querySelectorAll('.message.assistant.error'))
            .map((item) => (item.textContent || '').replace(/\\s+/g, ' ').trim())
            .filter(Boolean)

          return {
            errorCount: errorMessages.length,
            errorText: errorMessages.join('\\n'),
            retryButtonText: retryButton ? this.textOf(retryButton) : '',
            retryButtonAria: retryButton?.getAttribute('aria-label') ?? '',
            retryButtonVisible: Boolean(retryButton),
            manualRetryRequests: window.__zeroChatManualRetrySmokeRequestCount ?? 0,
            assistantTexts: this.assistantTextState().assistantTexts,
          }
        },
        async waitForManualRetryError() {
          for (let attempt = 0; attempt < 180; attempt += 1) {
            const state = this.generationRetryState()

            if (
              state.errorCount > 0 &&
              state.retryButtonVisible &&
              state.manualRetryRequests === 4
            ) {
              return state
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Manual retry error state did not appear: ' +
              JSON.stringify(this.generationRetryState()),
          )
        },
        async clickManualRetryButton() {
          const retryButton = document.querySelector('[data-message-retry-action="true"]')
          if (!retryButton) {
            throw new Error(
              'Missing manual retry button: ' +
                JSON.stringify(this.generationRetryState()),
            )
          }

          retryButton.click()

          for (let attempt = 0; attempt < 180; attempt += 1) {
            const state = this.generationRetryState()

            if (
              state.manualRetryRequests >= 5 &&
              state.errorCount === 0 &&
              state.assistantTexts.some((text) =>
                text.includes('Manual retry smoke recovered'),
              )
            ) {
              return state
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Manual retry did not recover the failed assistant turn: ' +
              JSON.stringify(this.generationRetryState()),
          )
        },
        async waitForAssistantText(text) {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const state = this.assistantTextState()
            if (state.assistantTexts.some((item) => item.includes(text))) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Assistant text did not appear: ' +
              text +
              '; state=' +
              JSON.stringify(this.assistantTextState()),
          )
        },
        async startStreamingTokenSmoke() {
          await this.waitForComposerIdle()
          this.setComposerDraft('Streaming token smoke')
          await this.waitForReadyToSend()
          document.querySelector('.send-button')?.click()
          return this.assistantTextState()
        },
        markdownRenderState() {
          const markdown = document.querySelector('.message-markdown')
          const codeBlock = markdown?.querySelector('.markdown-code-block')
          const copyButton = codeBlock?.querySelector('.code-copy-button')
          const table = markdown?.querySelector('.markdown-table-scroll table')
          const secureLink = markdown?.querySelector('a[href="https://example.com/zerochat"]')
          const blockedCustomLinkCount =
            markdown?.querySelectorAll('a[href^="intent:"]').length ?? 0
          const remoteMarkdownImageCount =
            markdown?.querySelectorAll('img[src^="http://"], img[src^="https://"]').length ?? 0
          const markdownWorkerResourceLoaded = performance
            .getEntriesByType('resource')
            .some((entry) => String(entry.name).includes('markdown.worker'))
          const remoteMarkdownImageResourceLoaded = performance
            .getEntriesByType('resource')
            .some((entry) => String(entry.name).includes('tracker.example/zerochat-pixel.png'))
          const assistantTexts = Array.from(document.querySelectorAll('.message.assistant p, .message.assistant .message-markdown'))
            .map((item) => (item.textContent || '').trim())
            .filter(Boolean)

          return {
            markdownRendered: Boolean(markdown),
            assistantTexts,
            heading: markdown?.querySelector('h1, h2, h3')?.textContent?.trim() ?? '',
            listText: markdown?.querySelector('li')?.textContent?.trim() ?? '',
            tableWrapped: Boolean(table),
            tableText: table?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
            linkText: secureLink?.textContent?.trim() ?? '',
            linkTarget: secureLink?.getAttribute('target') ?? '',
            linkRel: secureLink?.getAttribute('rel') ?? '',
            blockedCustomLinkCount,
            remoteMarkdownImageCount,
            blockedUrlTextVisible:
              (markdown?.textContent?.includes(
                '[Blocked custom link](intent://open/settings)',
              ) &&
                markdown?.textContent?.includes(
                  '![Blocked remote image](https://tracker.example/zerochat-pixel.png)',
                )) ??
              false,
            markdownWorkerResourceLoaded,
            remoteMarkdownImageResourceLoaded,
            scriptElementCount: markdown?.querySelectorAll('script').length ?? 0,
            escapedHtmlText:
              (markdown?.textContent?.includes('<script>alert(') &&
                markdown?.textContent?.includes('</script>')) ??
              false,
            codeLanguage: codeBlock?.getAttribute('data-language') ?? '',
            codeText: codeBlock?.querySelector('code')?.textContent ?? '',
            copyButtonAria: copyButton?.getAttribute('aria-label') ?? '',
            copyButtonCopyCodeLabel: copyButton?.getAttribute('data-copy-code-label') ?? '',
            copyButtonCopyLabel: copyButton?.getAttribute('data-copy-label') ?? '',
            copyButtonCopied: copyButton?.getAttribute('data-copied') ?? '',
            copyButtonCopiedLabel: copyButton?.getAttribute('data-copied-label') ?? '',
            copyButtonTooltip: copyButton?.getAttribute('data-tooltip') ?? '',
            copyButtonText: copyButton?.textContent?.trim() ?? '',
            copiedText: window.__zeroChatCopiedText ?? '',
          }
        },
        async waitForMarkdownRenderSmoke() {
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const state = this.markdownRenderState()

            if (
              state.heading === 'Markdown smoke' &&
              state.listText === 'Rendered list item' &&
              state.tableWrapped &&
              state.tableText.includes('Feature Status Tables Rendered') &&
              state.linkText === 'Secure link' &&
              state.linkTarget === '_blank' &&
              state.linkRel.includes('noopener') &&
              state.linkRel.includes('noreferrer') &&
              state.blockedCustomLinkCount === 0 &&
              state.remoteMarkdownImageCount === 0 &&
              state.blockedUrlTextVisible &&
              !state.remoteMarkdownImageResourceLoaded &&
              state.markdownWorkerResourceLoaded &&
              state.scriptElementCount === 0 &&
              state.escapedHtmlText &&
              state.codeLanguage === 'typescript' &&
              state.codeText.includes('const value: number = 42') &&
              state.codeText.includes('<Button>{value}</Button>') &&
              state.copyButtonCopyCodeLabel &&
              state.copyButtonAria === state.copyButtonCopyCodeLabel &&
              state.copyButtonTooltip === state.copyButtonCopyCodeLabel &&
              state.copyButtonText
            ) {
              return state
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Markdown message did not render with a code block header and copy button: ' +
              JSON.stringify(this.markdownRenderState()),
          )
        },
        async clickMarkdownCodeCopy() {
          const button = document.querySelector('.message-markdown .code-copy-button')
          if (!button) throw new Error('Missing Markdown code copy button')
          button.click()

          for (let attempt = 0; attempt < 40; attempt += 1) {
            const copiedText = window.__zeroChatCopiedText ?? ''
            const state = this.markdownRenderState()
            if (
              copiedText.includes('const value: number = 42') &&
              state.copyButtonCopied === 'true'
            ) {
              return state
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Markdown code copy button did not write the code text: ' +
              JSON.stringify(this.markdownRenderState()),
          )
        },
        messageArticleByText(text, role) {
          const messages = Array.from(document.querySelectorAll('.message[data-message-id]'))
          return messages.find((message) => {
            const roleMatches = !role || message.classList.contains(role)
            return roleMatches && (message.textContent || '').includes(text)
          }) ?? null
        },
        messageContextMenuState() {
          const menu = document.querySelector('[data-message-context-menu="true"]')
          const rect = menu?.getBoundingClientRect()
          const buttons = Array.from(menu?.querySelectorAll('button[role="menuitem"]') ?? [])
          const markerForButton = (button) =>
            Array.from(button?.attributes ?? [])
              .find(
                (attribute) =>
                  attribute.name.startsWith('data-message-context-') &&
                  attribute.value === 'true',
              )
              ?.name.replace('data-message-context-', '') ?? ''
          const items = buttons.map((button) => {
            return {
              disabled: button.disabled,
              marker: markerForButton(button),
              role: button.getAttribute('role') ?? '',
              text: this.textOf(button),
            }
          })
          const activeElement = document.activeElement

          return {
            activeMessageId:
              activeElement instanceof HTMLElement
                ? activeElement.closest('[data-message-id]')?.getAttribute('data-message-id') ?? ''
                : '',
            activeMarker:
              activeElement instanceof HTMLButtonElement ? markerForButton(activeElement) : '',
            activeAriaLabel:
              activeElement instanceof HTMLElement
                ? activeElement.getAttribute('aria-label') ?? ''
                : '',
            activeText:
              activeElement instanceof HTMLElement ? this.textOf(activeElement) : '',
            exists: Boolean(menu),
            role: menu?.getAttribute('role') ?? '',
            itemCount: items.length,
            items,
            markers: items.map((item) => item.marker).filter(Boolean),
            labels: items.map((item) => item.text).filter(Boolean),
            left: rect?.left ?? -1,
            top: rect?.top ?? -1,
            right: rect?.right ?? -1,
            bottom: rect?.bottom ?? -1,
            width: rect?.width ?? 0,
            height: rect?.height ?? 0,
            withinViewport: Boolean(
              rect &&
                rect.left >= 0 &&
                rect.top >= 0 &&
                rect.right <= window.innerWidth &&
                rect.bottom <= window.innerHeight,
            ),
          }
        },
        async openMessageContextMenuForText(text, role) {
          const article = this.messageArticleByText(text, role)
          if (!article) {
            throw new Error(
              'Missing message for context menu: ' +
                role +
                ' / ' +
                text +
                '; available=' +
                Array.from(document.querySelectorAll('.message[data-message-id]'))
                  .map((message) =>
                    [
                      message.classList.contains('user') ? 'user' : 'assistant',
                      (message.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
                    ].join(': '),
                  )
                  .join(' | '),
            )
          }

          const rect = article.getBoundingClientRect()
          const clientX = Math.min(
            window.innerWidth - 12,
            Math.max(12, rect.left + Math.min(32, rect.width / 2)),
          )
          const clientY = Math.min(
            window.innerHeight - 12,
            Math.max(12, rect.top + Math.min(32, rect.height / 2)),
          )
          const event = new MouseEvent('contextmenu', {
            bubbles: true,
            button: 2,
            buttons: 2,
            cancelable: true,
            clientX,
            clientY,
          })
          const preventedDefault = !article.dispatchEvent(event)

          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.messageContextMenuState()
            if (state.exists) {
              return {
                ...state,
                articleMessageId: article.getAttribute('data-message-id') ?? '',
                articleRole: role,
                articleText: (article.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
                preventedDefault,
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Message context menu did not open: ' +
              JSON.stringify(this.messageContextMenuState()),
          )
        },
        async openMessageKeyboardContextMenuForText(text, role) {
          const article = this.messageArticleByText(text, role)
          const target = article?.querySelector('.message-actions button:not(:disabled)')
          if (!article || !(target instanceof HTMLButtonElement)) {
            throw new Error('Missing keyboard context-menu target: ' + role + ' / ' + text)
          }

          target.focus()
          const targetAriaLabel = target.getAttribute('aria-label') ?? ''
          const targetRect = target.getBoundingClientRect()
          const expectedLeft = Math.min(
            Math.max(8, targetRect.left),
            Math.max(8, window.innerWidth - 220),
          )
          const expectedTop = Math.min(
            Math.max(8, targetRect.bottom),
            Math.max(8, window.innerHeight - 260),
          )
          const event = new MouseEvent('contextmenu', {
            bubbles: true,
            button: 0,
            buttons: 0,
            cancelable: true,
            clientX: 0,
            clientY: 0,
          })
          const preventedDefault = !target.dispatchEvent(event)

          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.messageContextMenuState()
            if (state.exists) {
              return {
                ...state,
                articleMessageId: article.getAttribute('data-message-id') ?? '',
                expectedLeft,
                expectedTop,
                preventedDefault,
                targetAriaLabel,
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Keyboard message context menu did not open: ' +
              JSON.stringify(this.messageContextMenuState()),
          )
        },
        async waitForMessageContextMenuFocus(marker) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.messageContextMenuState()
            if (state.exists && state.activeMarker === marker) return state
            await new Promise((resolve) => setTimeout(resolve, 25))
          }

          throw new Error(
            'Message context menu focus did not settle on ' +
              marker +
              ': ' +
              JSON.stringify(this.messageContextMenuState()),
          )
        },
        async pressMessageContextMenuKey(key) {
          const menu = document.querySelector('[data-message-context-menu="true"]')
          const target =
            document.activeElement instanceof HTMLElement ? document.activeElement : menu
          if (!menu || !target) throw new Error('Missing message context menu for key: ' + key)

          const event = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key,
          })
          target.dispatchEvent(event)
          await new Promise((resolve) => setTimeout(resolve, 25))

          return {
            ...this.messageContextMenuState(),
            defaultPrevented: event.defaultPrevented,
            key,
          }
        },
        async openMessageLongPressMenuForText(text, role) {
          const article = this.messageArticleByText(text, role)
          if (!article) {
            throw new Error('Missing message for long-press menu: ' + role + ' / ' + text)
          }

          const rect = article.getBoundingClientRect()
          const clientX = Math.min(
            window.innerWidth - 12,
            Math.max(12, rect.left + Math.min(36, rect.width / 2)),
          )
          const clientY = Math.min(
            window.innerHeight - 12,
            Math.max(12, rect.top + Math.min(36, rect.height / 2)),
          )
          const pointerId = 77
          const pointerDown = new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            buttons: 1,
            cancelable: true,
            clientX,
            clientY,
            isPrimary: true,
            pointerId,
            pointerType: 'touch',
          })
          article.dispatchEvent(pointerDown)

          for (let attempt = 0; attempt < 100; attempt += 1) {
            const state = this.messageContextMenuState()
            if (state.exists) {
              article.dispatchEvent(
                new PointerEvent('pointerup', {
                  bubbles: true,
                  button: 0,
                  buttons: 0,
                  cancelable: true,
                  clientX,
                  clientY,
                  isPrimary: true,
                  pointerId,
                  pointerType: 'touch',
                }),
              )

              return {
                ...state,
                articleMessageId: article.getAttribute('data-message-id') ?? '',
                openedByLongPress: true,
                pointerDownPrevented: pointerDown.defaultPrevented,
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 25))
          }

          article.dispatchEvent(
            new PointerEvent('pointercancel', {
              bubbles: true,
              cancelable: true,
              clientX,
              clientY,
              isPrimary: true,
              pointerId,
              pointerType: 'touch',
            }),
          )

          throw new Error(
            'Message long-press menu did not open: ' +
              JSON.stringify(this.messageContextMenuState()),
          )
        },
        async waitForMessageContextMenuClosed(expectedMessageId = '', expectedAriaLabel = '') {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (!document.querySelector('[data-message-context-menu="true"]')) {
              const state = this.messageContextMenuState()
              if (
                (!expectedMessageId || state.activeMessageId === expectedMessageId) &&
                (!expectedAriaLabel || state.activeAriaLabel === expectedAriaLabel)
              ) {
                return state
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Message context menu did not close: ' +
              JSON.stringify(this.messageContextMenuState()),
          )
        },
        async exerciseMessageContextMenu() {
          window.__zeroChatCopiedText = ''
          const user = await this.openMessageContextMenuForText(
            'Markdown render smoke',
            'user',
          )
          const focusInitial = await this.waitForMessageContextMenuFocus('copy')
          const focusAfterArrowDown = await this.pressMessageContextMenuKey('ArrowDown')
          const focusAfterSecondArrowDown = await this.pressMessageContextMenuKey('ArrowDown')
          const focusAfterHome = await this.pressMessageContextMenuKey('Home')
          const focusAfterEnd = await this.pressMessageContextMenuKey('End')
          const focusAfterArrowUp = await this.pressMessageContextMenuKey('ArrowUp')
          const focusAfterSecondHome = await this.pressMessageContextMenuKey('Home')
          const copyButton = document.querySelector('[data-message-context-copy="true"]')
          if (!copyButton) {
            throw new Error(
              'Missing copy menu item: ' +
                JSON.stringify(this.messageContextMenuState()),
            )
          }
          copyButton.click()

          for (let attempt = 0; attempt < 80; attempt += 1) {
            if ((window.__zeroChatCopiedText ?? '') === 'Markdown render smoke') break
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          const copiedText = window.__zeroChatCopiedText ?? ''
          if (copiedText !== 'Markdown render smoke') {
            throw new Error('Message context copy wrote unexpected text: ' + copiedText)
          }
          const afterCopy = await this.waitForMessageContextMenuClosed()
          const assistant = await this.openMessageContextMenuForText(
            'Markdown smoke',
            'assistant',
          )
          document.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              key: 'Escape',
            }),
          )
          const afterEscape = await this.waitForMessageContextMenuClosed(
            assistant.articleMessageId,
          )
          const longPress = await this.openMessageLongPressMenuForText(
            'Markdown render smoke',
            'user',
          )
          document.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              key: 'Escape',
            }),
          )
          const afterLongPressEscape = await this.waitForMessageContextMenuClosed(
            longPress.articleMessageId,
          )
          const keyboard = await this.openMessageKeyboardContextMenuForText(
            'Markdown render smoke',
            'user',
          )
          document.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              key: 'Escape',
            }),
          )
          const afterKeyboardEscape = await this.waitForMessageContextMenuClosed(
            keyboard.articleMessageId,
            keyboard.targetAriaLabel,
          )

          return {
            afterCopy,
            afterEscape,
            afterKeyboardEscape,
            afterLongPressEscape,
            assistant,
            copiedText,
            focusAfterArrowDown,
            focusAfterArrowUp,
            focusAfterEnd,
            focusAfterHome,
            focusAfterSecondArrowDown,
            focusAfterSecondHome,
            focusInitial,
            keyboard,
            longPress,
            user,
          }
        },
        fieldViewport(labelNames) {
          const label = this.label(labelNames)
          const field = label.querySelector('input, textarea, select') ?? label
          const labelRect = label.getBoundingClientRect()
          const fieldRect = field.getBoundingClientRect()
          const modalRect = document.querySelector('.settings-modal')?.getBoundingClientRect()
          const stickyRect = document.querySelector('.settings-sticky')?.getBoundingClientRect()
          const visibleTop = Math.max(0, stickyRect?.bottom ?? 0)
          const visibleBottom = Math.min(window.innerHeight, modalRect?.bottom ?? window.innerHeight)

          return {
            bottom: labelRect.bottom,
            fieldBottom: fieldRect.bottom,
            fieldTop: fieldRect.top,
            modalBottom: modalRect?.bottom ?? window.innerHeight,
            modalTop: modalRect?.top ?? 0,
            stickyBottom: stickyRect?.bottom ?? 0,
            top: labelRect.top,
            viewportHeight: window.innerHeight,
            visible:
              labelRect.top >= visibleTop - 1 &&
              labelRect.bottom <= visibleBottom + 1 &&
              (!modalRect ||
                (labelRect.top >= modalRect.top - 1 && labelRect.bottom <= modalRect.bottom + 1)),
          }
        },
        async waitForFieldInViewport(labelNames) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.fieldViewport(labelNames)
            if (state.visible) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Field did not scroll into view: ' +
              labelNames.join(' / ') +
              '; state=' +
              JSON.stringify(this.fieldViewport(labelNames)),
          )
        },
        settingsScrollState() {
          const modal = document.querySelector('.settings-modal')
          const panel = document.querySelector('.settings-modal [role="tabpanel"]')
          const sticky = document.querySelector('.settings-sticky')
          const modalRect = modal?.getBoundingClientRect()
          const panelRect = panel?.getBoundingClientRect()
          const stickyRect = sticky?.getBoundingClientRect()
          const stickyBottom = stickyRect?.bottom ?? modalRect?.top ?? 0

          return {
            exists: Boolean(modal),
            scrollTop: modal?.scrollTop ?? -1,
            scrollHeight: modal?.scrollHeight ?? 0,
            clientHeight: modal?.clientHeight ?? 0,
            canScroll: modal ? modal.scrollHeight > modal.clientHeight + 1 : false,
            panelTop: panelRect?.top ?? -1,
            stickyBottom,
            panelStartsBelowSticky: panelRect ? panelRect.top >= stickyBottom - 1 : false,
          }
        },
        scrollSettingsModal(position) {
          const modal = document.querySelector('.settings-modal')
          if (!modal) throw new Error('Missing settings modal')
          modal.scrollTop = position === 'bottom' ? modal.scrollHeight : 0
          return this.settingsScrollState()
        },
        async waitForSettingsTabScrollReset() {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.settingsScrollState()
            if (
              state.exists &&
              state.scrollTop <= 1 &&
              state.panelStartsBelowSticky
            ) {
              return state
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Settings tab did not reset scrolled content to the top: ' +
              JSON.stringify(this.settingsScrollState()),
          )
        },
        syncRequirementViewport() {
          const notice = document.querySelector('.sync-config-fields .guide-requirement')
          if (!notice) return { visible: true, missing: true }
          const rect = notice.getBoundingClientRect()
          const modalRect = document.querySelector('.settings-modal')?.getBoundingClientRect()
          const stickyRect = document.querySelector('.settings-sticky')?.getBoundingClientRect()
          const visibleTop = Math.max(0, stickyRect?.bottom ?? 0)
          const visibleBottom = Math.min(window.innerHeight, modalRect?.bottom ?? window.innerHeight)

          return {
            bottom: rect.bottom,
            modalBottom: modalRect?.bottom ?? window.innerHeight,
            modalTop: modalRect?.top ?? 0,
            stickyBottom: stickyRect?.bottom ?? 0,
            top: rect.top,
            viewportHeight: window.innerHeight,
            visible:
              rect.top >= visibleTop - 1 &&
              rect.bottom <= visibleBottom + 1 &&
              (!modalRect ||
                (rect.top >= modalRect.top - 1 && rect.bottom <= modalRect.bottom + 1)),
          }
        },
        async waitForSyncRequirementInViewport() {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.syncRequirementViewport()
            if (state.visible) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Sync requirement did not scroll into view: ' +
              JSON.stringify(this.syncRequirementViewport()),
          )
        },
        setCheckedNear(rowText, labelText, checked) {
          const row = Array.from(document.querySelectorAll('.skill-row'))
            .find((item) => (item.textContent || '').includes(rowText))
          if (!row) throw new Error('Missing skill row: ' + rowText)
          const label = Array.from(row.querySelectorAll('label'))
            .find((item) => (item.textContent || '').includes(labelText))
          if (!label) throw new Error('Missing skill checkbox: ' + labelText)
          const input = label.querySelector('input')
          input.checked = checked
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return input.checked
        },
        clickSkillEdit(rowText) {
          const row = Array.from(document.querySelectorAll('.skill-row'))
            .find((item) => (item.textContent || '').includes(rowText))
          if (!row) throw new Error('Missing skill row: ' + rowText)
          const button = row.querySelector('.skill-edit-button')
          if (!button) throw new Error('Missing skill edit button: ' + rowText)
          button.click()
          return true
        },
        setSkillEditor(rowText, name, content) {
          const row = Array.from(document.querySelectorAll('.skill-row'))
            .find((item) => (item.textContent || '').includes(rowText))
          if (!row) throw new Error('Missing skill row: ' + rowText)
          const form = row.querySelector('.skill-edit-form')
          if (!form) throw new Error('Missing skill edit form: ' + rowText)
          const nameInput = form.querySelector('input')
          const textarea = form.querySelector('textarea')
          if (!nameInput || !textarea) throw new Error('Missing skill edit fields')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(nameInput, name)
          nameInput.dispatchEvent(new Event('input', { bubbles: true }))
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, content)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        },
        saveSkillEditor(rowText) {
          const row = Array.from(document.querySelectorAll('.skill-row'))
            .find((item) => (item.textContent || '').includes(rowText))
          if (!row) throw new Error('Missing skill row: ' + rowText)
          const button = Array.from(row.querySelectorAll('.skill-edit-form button'))
            .find((item) => this.match(item, ['保存', 'Save']))
          if (!button) throw new Error('Missing skill save button: ' + rowText)
          button.click()
          return true
        },
        async waitForSkillEditor(rowText) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const row = Array.from(document.querySelectorAll('.skill-row'))
              .find((item) => (item.textContent || '').includes(rowText))
            const textarea = row?.querySelector('.skill-edit-form textarea')
            if (textarea && !textarea.disabled && textarea.value.trim()) {
              return textarea.value
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Missing loaded skill editor: ' + rowText)
        },
        skillNames() {
          return Array.from(document.querySelectorAll('.skill-row .skill-summary strong'))
            .map((item) => (item.textContent || '').trim())
            .filter(Boolean)
        },
        async waitForSkillName(name) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (this.skillNames().includes(name)) return this.skillNames()
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Missing skill name: ' +
              name +
              '; current names: ' +
              this.skillNames().join(' | '),
          )
        },
        skillRowViewport(name) {
          const row = Array.from(document.querySelectorAll('.skill-row'))
            .find((item) => (item.textContent || '').includes(name))
          const rect = row?.getBoundingClientRect()
          const modalRect = document.querySelector('.settings-modal')?.getBoundingClientRect()
          const stickyRect = document.querySelector('.settings-sticky')?.getBoundingClientRect()
          const visibleTop = Math.max(0, stickyRect?.bottom ?? modalRect?.top ?? 0)
          const visibleBottom = Math.min(
            window.innerHeight,
            modalRect?.bottom ?? window.innerHeight,
          )

          return {
            found: Boolean(row),
            top: rect?.top ?? -1,
            bottom: rect?.bottom ?? -1,
            visibleTop,
            visibleBottom,
            visible: Boolean(rect) && rect.top >= visibleTop - 1 && rect.bottom <= visibleBottom + 1,
          }
        },
        async waitForSkillVisible(name) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const state = this.skillRowViewport(name)
            if (state.visible) return state
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Skill row did not reveal in the settings viewport: ' +
              name +
              '; state=' +
              JSON.stringify(this.skillRowViewport(name)),
          )
        },
        async idbKeys() {
          return new Promise((resolve, reject) => {
            const request = indexedDB.open('zerochat')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const db = request.result
              const tx = db.transaction('documents', 'readonly')
              const keyRequest = tx.objectStore('documents').getAllKeys()
              keyRequest.onerror = () => reject(keyRequest.error)
              keyRequest.onsuccess = () => resolve(keyRequest.result)
              tx.oncomplete = () => db.close()
            }
          })
        },
        async installStreamingAutoSyncFixture(syncEndpoint) {
          const deleteDatabase = (name) =>
            new Promise((resolve, reject) => {
              const request = indexedDB.deleteDatabase(name)
              request.onerror = () => reject(request.error)
              request.onblocked = () => reject(new Error('IndexedDB deletion blocked: ' + name))
              request.onsuccess = () => resolve(true)
            })
          const writeSnapshot = (snapshot) =>
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
                tx.objectStore('documents').put(snapshot, 'app')
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
          const timestamp = Date.now()
          const conversationId = 'streaming-sync-conversation'
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
          const snapshot = {
            version: 1,
            providers: [provider],
            conversations: [
              {
                id: conversationId,
                title: 'Streaming sync smoke',
                providerId: provider.id,
                model: provider.model,
                messages: [],
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
              mode: 'cloudflare',
              autoSync: true,
              encryptionEnabled: true,
              gistFile: 'zerochat-sync.json',
              workerEndpoint: syncEndpoint,
              lastSyncAt: timestamp,
              lastSyncStatus: 'Streaming sync smoke baseline',
            },
            preferences: {
              firstRunDone: true,
              theme: 'system',
              language: 'zh-CN',
              compactMode: false,
              activeConversationId: conversationId,
              dismissedDangerWarnings: [],
              dismissedFeatureHints: [],
            },
            updatedAt: timestamp,
          }

          await deleteDatabase('zerochat-secrets')
          await writeSnapshot(snapshot)
          localStorage.setItem('zerochat:secret:provider:openai', 'zerochat-sync-smoke-provider-key')
          localStorage.setItem('zerochat:secret:sync-passphrase', 'zerochat-sync-smoke-passphrase')
          sessionStorage.setItem('zerochat:secret:sync-passphrase', 'zerochat-sync-smoke-passphrase')
          window.__zeroChatCloudSyncRequests = []
          window.__zeroChatCloudSyncStore = {
            generation: '00000000-0000-4000-8000-000000000001',
            head: null,
            objects: {},
          }
          return snapshot
        },
        resetCloudSyncRequests() {
          window.__zeroChatCloudSyncRequests = []
          window.__zeroChatCloudSyncStore = {
            generation: '00000000-0000-4000-8000-000000000001',
            head: null,
            objects: {},
          }
          return this.cloudSyncRequestState()
        },
        cloudSyncRequestState() {
          const requests = window.__zeroChatCloudSyncRequests ?? []
          const store = window.__zeroChatCloudSyncStore ?? { head: null, objects: {} }
          const paths = requests.map((request) => request.path)
          const methods = requests.map((request) => request.method + ' ' + request.path)

          return {
            count: requests.length,
            headWritten: Boolean(store.head),
            methods,
            objectCount: Object.keys(store.objects ?? {}).length,
            objectPutCount: requests.filter(
              (request) =>
                request.method === 'PUT' && request.path.startsWith('/sync/object/'),
            ).length,
            paths,
            putCount: requests.filter((request) => request.method === 'PUT').length,
            snapshotReadCount: requests.filter(
              (request) => request.method === 'GET' && request.path === '/snapshot',
            ).length,
            streaming: this.assistantTextState(),
          }
        },
        async waitForCloudSyncRequests(minCount = 1) {
          for (let attempt = 0; attempt < 160; attempt += 1) {
            const state = this.cloudSyncRequestState()
            if (state.count >= minCount && state.putCount > 0 && state.headWritten) {
              return state
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Cloudflare sync smoke requests did not appear after streaming completed: ' +
              JSON.stringify(this.cloudSyncRequestState()),
          )
        },
        metrics() {
          const actionSelector = [
            'button',
            'label.file-button',
            '.ghost-button',
            '.primary-button',
            '.danger-button',
            '.send-button',
            '.danger-skip',
          ].join(',')
          const fieldSelector = [
            'input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])',
            'select',
            'textarea',
          ].join(',')
          const centeredControlSelector = [
            '.primary-button',
            '.ghost-button',
            '.danger-button',
            '.send-button',
            'label.file-button',
            '.composer-toolbar button',
            '.image-mode-tabs button',
            '.segmented button',
          ].join(',')
          const visibleRectFor = (element) => {
            const base = element.getBoundingClientRect()
            let rect = {
              left: base.left,
              right: base.right,
              top: base.top,
              bottom: base.bottom,
              width: base.width,
              height: base.height,
            }
            let parent = element.parentElement

            while (parent && parent !== document.documentElement) {
              const style = getComputedStyle(parent)
              const clips =
                ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX) ||
                ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)

              if (clips) {
                const parentBox = parent.getBoundingClientRect()
                const left = Math.max(rect.left, parentBox.left)
                const right = Math.min(rect.right, parentBox.right)
                const top = Math.max(rect.top, parentBox.top)
                const bottom = Math.min(rect.bottom, parentBox.bottom)

                rect = {
                  left,
                  right,
                  top,
                  bottom,
                  width: right - left,
                  height: bottom - top,
                }

                if (rect.width <= 1 || rect.height <= 1) {
                  return null
                }
              }

              parent = parent.parentElement
            }

            return rect
          }
          const isVisible = (element) => {
            const box = visibleRectFor(element)
            const style = getComputedStyle(element)
            const stickyBox = document.querySelector('.settings-sticky')?.getBoundingClientRect()
            const hiddenBehindSticky =
              Boolean(stickyBox) &&
              Boolean(box) &&
              box.bottom <= stickyBox.bottom + 1 &&
              box.top < stickyBox.bottom
            return (
              Boolean(box) &&
              box.width > 0 &&
              box.height > 0 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              !hiddenBehindSticky
            )
          }
          const labelFor = (element) => {
            const text = this.textOf(element).replace(/\\s+/g, ' ')
            return text || element.getAttribute('aria-label') || element.className || element.tagName.toLowerCase()
          }
          const isMeasuredControl = (element) =>
            isVisible(element) && !element.classList.contains('sidebar-backdrop')
          const clipsContent = (element) => {
            const style = getComputedStyle(element)
            const clipsX =
              (style.overflowX === 'hidden' || style.overflowX === 'clip') &&
              element.scrollWidth > element.clientWidth + 1
            const clipsY =
              (style.overflowY === 'hidden' || style.overflowY === 'clip') &&
              element.scrollHeight > element.clientHeight + 1
            return clipsX || clipsY
          }
          const placeholderTooWide = (element) => {
            const placeholder = element.getAttribute('placeholder')?.trim()
            if (!placeholder || element.value) return false

            const style = getComputedStyle(element)
            const canvas = document.createElement('canvas')
            const context = canvas.getContext('2d')
            if (!context) return false

            context.font = [
              style.fontStyle,
              style.fontVariant,
              style.fontWeight,
              style.fontSize,
              style.fontFamily,
            ].join(' ')

            const padding =
              Number.parseFloat(style.paddingLeft || '0') +
              Number.parseFloat(style.paddingRight || '0')
            const available = element.clientWidth - padding - 2
            const measured = context.measureText(placeholder).width

            return measured > available + 1
          }
          const contentRectsFor = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              if (!node.textContent?.trim() || typeof document.createRange !== 'function') return []

              const range = document.createRange()
              range.selectNodeContents(node)
              return Array.from(range.getClientRects()).filter(
                (rect) => rect.width > 0 && rect.height > 0,
              )
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return []

            const element = node
            if (element.matches('input, textarea, select')) return []

            const style = getComputedStyle(element)
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return []
            }

            const directContent = Array.from(element.childNodes).flatMap(contentRectsFor)
            if (directContent.length) return directContent

            const box = element.getBoundingClientRect()
            return box.width > 0 && box.height > 0 ? [box] : []
          }
          const unionRects = (rects) =>
            rects.reduce(
              (acc, rect) => ({
                left: Math.min(acc.left, rect.left),
                right: Math.max(acc.right, rect.right),
                top: Math.min(acc.top, rect.top),
                bottom: Math.max(acc.bottom, rect.bottom),
              }),
              { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
            )
          const modal = document.querySelector('.modal')
          const scope = modal ?? document
          const actions = Array.from(scope.querySelectorAll(actionSelector)).filter(isMeasuredControl)
          const controls = Array.from(scope.querySelectorAll(actionSelector + ',' + fieldSelector)).filter(isMeasuredControl)
          const clippedControls = actions
            .filter((element) => {
              const text = labelFor(element)
              if (!text || element.classList.contains('icon-button')) return false
              return clipsContent(element)
            })
            .map(labelFor)
          const clippedGroups = Array.from(
            scope.querySelectorAll('.composer-toolbar, .image-mode-tabs'),
          )
            .filter(
              (element) =>
                isVisible(element) &&
                clipsContent(element),
            )
            .map(labelFor)
          const clippedPlaceholders = Array.from(
            scope.querySelectorAll(
              'input[placeholder]:not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea[placeholder]',
            ),
          )
            .filter(isVisible)
            .filter(placeholderTooWide)
            .map((element) => {
              const placeholder = element.getAttribute('placeholder')?.trim() ?? ''
              const box = element.getBoundingClientRect()
              return labelFor(element) + ' placeholder "' + placeholder + '" in ' + Math.round(box.width) + 'px'
            })
          const smallTargets = actions
            .filter((element) => {
              const visibleBox = visibleRectFor(element)
              const rawBox = element.getBoundingClientRect()
              const clippedByScrollableAncestor =
                Boolean(visibleBox) &&
                (visibleBox.width < rawBox.width - 1 ||
                  visibleBox.height < rawBox.height - 1)
              return (
                Boolean(visibleBox) &&
                !clippedByScrollableAncestor &&
                (rawBox.width < 28 || rawBox.height < 28)
              )
            })
            .map(labelFor)
          const referencedText = (element, attribute) =>
            (element.getAttribute(attribute) ?? '')
              .split(/\\s+/)
              .filter(Boolean)
              .map((id) => document.getElementById(id)?.textContent?.trim().replace(/\\s+/g, ' ') ?? '')
              .filter(Boolean)
              .join(' ')
          const dialogA11yIssues = Array.from(
            document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
          )
            .filter(isVisible)
            .flatMap((element) => {
              const role = element.getAttribute('role')
              const label = referencedText(element, 'aria-labelledby')
              const description = referencedText(element, 'aria-describedby')
              const issues = []

              if (element.getAttribute('aria-modal') !== 'true') {
                issues.push(role + ' missing aria-modal=true')
              }

              if (!label) {
                issues.push(role + ' missing labelled title')
              }

              if (!description) {
                issues.push(role + ' missing described body')
              }

              return issues
            })
          const overlaps = []
          const boxes = controls.map((element) => ({
            element,
            label: labelFor(element),
            rect: visibleRectFor(element),
          })).filter((item) => item.rect)

          for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
              const left = boxes[leftIndex]
              const right = boxes[rightIndex]
              if (left.element.contains(right.element) || right.element.contains(left.element)) continue
              const xOverlap = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left)
              const yOverlap = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top)
              if (xOverlap > 2 && yOverlap > 2) {
                overlaps.push(left.label + ' <> ' + right.label)
              }
            }
          }
          const offCenterControls = Array.from(scope.querySelectorAll(centeredControlSelector))
            .filter((element) => isVisible(element) && this.textOf(element))
            .filter((element) => !element.classList.contains('icon-button'))
            .map((element) => {
              const box = element.getBoundingClientRect()
              const contentRects = contentRectsFor(element)
              if (!contentRects.length) return null

              const content = unionRects(contentRects)
              const dx = Math.abs((content.left + content.right) / 2 - (box.left + box.right) / 2)
              const dy = Math.abs((content.top + content.bottom) / 2 - (box.top + box.bottom) / 2)
              const maxDx = Math.max(3, box.width * 0.08)
              const maxDy = Math.max(3, box.height * 0.12)

              return dx > maxDx || dy > maxDy
                ? labelFor(element) + ' (' + Math.round(dx * 10) / 10 + 'px x, ' + Math.round(dy * 10) / 10 + 'px y)'
                : null
            })
            .filter(Boolean)

          const modalBox = modal?.getBoundingClientRect()
          const welcomeElement = document.querySelector('.welcome-panel')
          const welcome =
            welcomeElement && isVisible(welcomeElement)
              ? welcomeElement.getBoundingClientRect()
              : null
          const composerElement = document.querySelector('.composer')
          const composer = composerElement?.getBoundingClientRect()
          const composerToolbar = document.querySelector('.composer-toolbar')
          const messageList = document.querySelector('.message-list')?.getBoundingClientRect()
          const sendButton = document.querySelector('.send-button')?.getBoundingClientRect()
          const guideSyncButtons = Array.from(
            document.querySelectorAll('.guide-modal .mode-grid button'),
          )
          const guideSyncButtonRects = guideSyncButtons.map((button) => {
            const raw = button.getBoundingClientRect()
            const visible = visibleRectFor(button)

            return {
              label: labelFor(button),
              raw: {
                left: Math.round(raw.left),
                top: Math.round(raw.top),
                right: Math.round(raw.right),
                bottom: Math.round(raw.bottom),
                width: Math.round(raw.width),
                height: Math.round(raw.height),
              },
              visible: visible
                ? {
                    left: Math.round(visible.left),
                    top: Math.round(visible.top),
                    right: Math.round(visible.right),
                    bottom: Math.round(visible.bottom),
                    width: Math.round(visible.width),
                    height: Math.round(visible.height),
                  }
                : null,
              isVisible: isVisible(button),
            }
          })
          const guideActions = document
            .querySelector('.guide-modal .modal-actions')
            ?.getBoundingClientRect()

          return {
            width: window.innerWidth,
            height: window.innerHeight,
            lang: document.documentElement.lang,
            dir: document.documentElement.dir,
            compact: document.documentElement.dataset.compact,
            scrollWidth: document.documentElement.scrollWidth,
            overflowing: document.documentElement.scrollWidth > window.innerWidth + 1,
            clippedControls,
            clippedGroups,
            clippedPlaceholders,
            smallTargets,
            dialogA11yIssues,
            overlaps,
            offCenterControls,
            modalOutOfBounds: modalBox
              ? modalBox.left < -1 ||
                modalBox.right > window.innerWidth + 1 ||
                modalBox.top < -1 ||
                modalBox.bottom > window.innerHeight + 1
              : false,
            welcomeComposerCenterDelta: welcome && composer
              ? Math.abs((welcome.left + welcome.right) / 2 - (composer.left + composer.right) / 2)
              : 0,
            welcomeWiderThanComposer: welcome && composer ? welcome.width > composer.width + 1 : false,
            composerToolbarOutOfBounds: composerToolbar
              ? composerToolbar.getBoundingClientRect().right > window.innerWidth + 1
              : false,
            messageListComposerMisaligned: messageList && composer && window.innerWidth <= 860
              ? Math.abs(messageList.left - composer.left) > 13 ||
                Math.abs(messageList.right - composer.right) > 13
              : false,
            compactSendButtonTooWide: composer && sendButton && window.innerWidth <= 520
              ? !(
                  window.innerWidth <= 360 &&
                  (composerElement?.classList.contains('composer-image-edit') ||
                    composerElement?.classList.contains('composer-image-inpaint'))
                ) && sendButton.width > composer.width * 0.72
              : false,
            compactSendButtonTooTall: composer && sendButton && window.innerWidth <= 520
              ? !(
                  composerElement?.classList.contains('composer-image-edit') ||
                  composerElement?.classList.contains('composer-image-inpaint')
                ) && sendButton.height > 72
              : false,
            guideSyncModeButtonsReachable: (() => {
              const guide = document.querySelector('.guide-modal')
              if (!guide) return true

              const layout = guide.querySelector('.guide-layout')
              const syncPanel = guide.querySelector('.guide-sync-panel')
              if (guideSyncButtons.length !== 3 || !layout || !syncPanel) {
                return false
              }

              const layoutBox = layout.getBoundingClientRect()
              const syncBox = syncPanel.getBoundingClientRect()
              const syncBottomInScrollArea =
                syncBox.bottom - layoutBox.top + layout.scrollTop

              return (
                guideSyncButtons.every((button) => {
                  const box = button.getBoundingClientRect()
                  const style = getComputedStyle(button)
                  return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    box.width >= 28 &&
                    box.height >= 28
                  )
                }) &&
                syncBottomInScrollArea <= layout.scrollHeight + 1
              )
            })(),
            guideProviderBeforeSync: (() => {
              const guide = document.querySelector('.guide-modal')
              if (!guide || window.innerWidth > 520) return true

              const providerFields = guide.querySelector('.guide-provider-fields')
              const syncPanel = guide.querySelector('.guide-sync-panel')
              if (!providerFields || !syncPanel) return false

              return (
                Boolean(
                  providerFields.compareDocumentPosition(syncPanel) &
                    Node.DOCUMENT_POSITION_FOLLOWING,
                ) &&
                providerFields.getBoundingClientRect().top <=
                  syncPanel.getBoundingClientRect().top
              )
            })(),
            guideSyncModeLabels: document.querySelector('.guide-modal')
              ? guideSyncButtons.map((button) => labelFor(button))
              : [],
            guideSyncButtonRects,
            guideActionsInsideViewport: guideActions
              ? guideActions.top >= -1 && guideActions.bottom <= window.innerHeight + 1
              : true,
            skillRows: document.querySelectorAll('.skill-row').length,
          }
        },
        async guideSyncNoteStates() {
          const modal = document.querySelector('.guide-modal')
          const buttons = Array.from(modal?.querySelectorAll('.mode-grid button') ?? [])

          if (!modal || buttons.length !== 3) {
            return []
          }

          const states = []

          for (const button of buttons) {
            button.click()
            await new Promise((resolve) => setTimeout(resolve, 80))

            const note = modal.querySelector('.guide-sync-note')
            const noteBox = note?.getBoundingClientRect()
            const noteStyle = note ? getComputedStyle(note) : null

            states.push({
              active: button.classList.contains('active'),
              label: this.textOf(button),
              note: (note?.textContent || '').trim(),
              noteVisible: Boolean(
                note &&
                  noteStyle?.display !== 'none' &&
                  noteBox &&
                  noteBox.width > 0 &&
                  noteBox.height > 0,
              ),
            })
          }

          await this.clickGuideSyncMode([this.textOf(buttons[0])])

          return states
        },
      }
    `)
    await evaluate(`window.__zeroChatSmoke.waitForControl()`, true)
    await evaluate(`window.__zeroChatSmoke.waitForDocumentLanguage('fr-FR', 'ltr')`, true)
    await evaluate(`window.__zeroChatSmoke.waitForText(['Première configuration'])`, true)
    await evaluate(
      `window.__zeroChatSmoke.waitForElement('.guide-modal .guide-provider-picker')`,
      true,
    )
    const initialGuideProviderPickerState = await evaluate(
      `window.__zeroChatSmoke.guideProviderPickerState()`,
    )
    assert.equal(
      initialGuideProviderPickerState.visible,
      true,
      `first-run guide should render the provider picker (${JSON.stringify(initialGuideProviderPickerState)})`,
    )
    assert.deepEqual(
      initialGuideProviderPickerState.missingExpected,
      [],
      `first-run guide should show the six mainstream provider cards (${JSON.stringify(initialGuideProviderPickerState)})`,
    )
    assert.deepEqual(
      initialGuideProviderPickerState.hiddenExpected,
      [],
      `first-run guide provider cards should be visible (${JSON.stringify(initialGuideProviderPickerState)})`,
    )
    assert.equal(
      initialGuideProviderPickerState.cardCount >= 6,
      true,
      `first-run guide should keep a card-first provider picker (${JSON.stringify(initialGuideProviderPickerState)})`,
    )
    assert.equal(
      initialGuideProviderPickerState.openaiAccent,
      'openai',
      `OpenAI guide card should use the branded avatar accent (${JSON.stringify(initialGuideProviderPickerState)})`,
    )
    assert.equal(
      initialGuideProviderPickerState.openaiAvatarText.length > 0 &&
        /\d/.test(initialGuideProviderPickerState.openaiMetaText),
      true,
      `OpenAI guide card should show an avatar and model metadata (${JSON.stringify(initialGuideProviderPickerState)})`,
    )
    assert.equal(
      initialGuideProviderPickerState.geminiTooltip.includes('Google Gemini') &&
        initialGuideProviderPickerState.geminiAriaLabel ===
          initialGuideProviderPickerState.geminiTooltip &&
        initialGuideProviderPickerState.geminiTitle === '',
      true,
      `first-run guide cards should expose full provider names through the app tooltip and aria label without native titles (${JSON.stringify(initialGuideProviderPickerState)})`,
    )
    const geminiGuideCardTooltipState = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('[data-guide-provider-card="gemini"]')`,
      true,
    )
    assert.ok(
      geminiGuideCardTooltipState.text.includes('Google Gemini'),
      `first-run guide card app tooltip should expose the full Provider name (${JSON.stringify(geminiGuideCardTooltipState)})`,
    )
    assert.equal(
      !initialGuideProviderPickerState.customRelayShortcutStripPresent &&
        initialGuideProviderPickerState.completeSelectHasFeatured &&
        initialGuideProviderPickerState.completeSelectHasCustomRelay,
      true,
      `first-run guide should use the complete Provider menu as the sole custom-relay entry point (${JSON.stringify(initialGuideProviderPickerState)})`,
    )
    const customRelayGuideState = await evaluate(
      `window.__zeroChatSmoke.selectGuideProviderPreset('custom-openai-relay')`,
      true,
    )
    assert.equal(
      customRelayGuideState.customFieldsVisible,
      true,
      `custom relay menu selection should reveal custom provider fields (${JSON.stringify(customRelayGuideState)})`,
    )
    assert.equal(
      customRelayGuideState.selectedProviderId === 'custom-openai-relay' &&
        !customRelayGuideState.activeIds.includes('custom-openai-relay'),
      true,
      `custom relay should remain selectable through the complete Provider menu without a duplicate card (${JSON.stringify(customRelayGuideState)})`,
    )
    const workerHostedRelayGuideState = await evaluate(
      `window.__zeroChatSmoke.enableGuideWorkerHostedKeyRelay()`,
      true,
    )
    assert.equal(
      workerHostedRelayGuideState.workerHostedKeyVisible &&
        workerHostedRelayGuideState.workerHostedKeyChecked &&
        workerHostedRelayGuideState.providerKeyValueLength === 0 &&
        workerHostedRelayGuideState.modelValue === 'gpt-5.5' &&
        workerHostedRelayGuideState.proxyValue === 'https://worker.example.com' &&
        workerHostedRelayGuideState.requirementText === '' &&
        !workerHostedRelayGuideState.clientRequestModeChecked &&
        !workerHostedRelayGuideState.doneDisabled,
      true,
      `custom relay first-run setup should allow a Worker-hosted provider key without sending a browser API key (${JSON.stringify(workerHostedRelayGuideState)})`,
    )
    const restoredGuideProviderPickerState = await evaluate(
      `window.__zeroChatSmoke.clickGuideProviderCard('openai')`,
      true,
    )
    assert.equal(
      restoredGuideProviderPickerState.activeIds.includes('openai') &&
        !restoredGuideProviderPickerState.customFieldsVisible,
      true,
      `OpenAI guide card should restore the mainstream setup path (${JSON.stringify(restoredGuideProviderPickerState)})`,
    )
    const openaiGuideKeyHelpState = await evaluate(
      `window.__zeroChatSmoke.guideProviderKeyHelpState()`,
    )
    assert.equal(
      openaiGuideKeyHelpState.visible &&
        openaiGuideKeyHelpState.href.includes('platform.openai.com/api-keys') &&
        openaiGuideKeyHelpState.rel.includes('noreferrer') &&
        openaiGuideKeyHelpState.target === '_blank' &&
        /OpenAI/.test(openaiGuideKeyHelpState.titleText) &&
        openaiGuideKeyHelpState.noteText.length > 20,
      true,
      `OpenAI guide key help should link to the official key page and explain local encryption (${JSON.stringify(openaiGuideKeyHelpState)})`,
    )
    assert.equal(
      openaiGuideKeyHelpState.doneDisabled &&
        openaiGuideKeyHelpState.donePointerEvents === 'none' &&
        openaiGuideKeyHelpState.doneDescribedBy.includes('guide-requirement') &&
        openaiGuideKeyHelpState.requirementText.length > 0 &&
        openaiGuideKeyHelpState.doneTitle === '' &&
        openaiGuideKeyHelpState.doneTooltip === openaiGuideKeyHelpState.requirementText &&
        openaiGuideKeyHelpState.doneTargetTitle === '' &&
        openaiGuideKeyHelpState.doneTargetTooltip === openaiGuideKeyHelpState.requirementText &&
        openaiGuideKeyHelpState.doneHitTag === 'SPAN' &&
        String(openaiGuideKeyHelpState.doneHitClass).includes('guide-done-tooltip-target'),
      true,
      `disabled first-run Done button should expose its visible requirement through data-tooltip, aria-describedby, and a title-free tooltip target (${JSON.stringify(openaiGuideKeyHelpState)})`,
    )
    const guideDoneTooltipState = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.guide-done-tooltip-target')`,
      true,
    )
    assert.equal(
      guideDoneTooltipState.text,
      openaiGuideKeyHelpState.requirementText,
      `disabled first-run Done button should show its blocking reason in the delayed app tooltip (${JSON.stringify({ guideDoneTooltipState, openaiGuideKeyHelpState })})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickGuideProviderCard('gemini')`, true)
    const geminiGuideKeyHelpState = await evaluate(
      `window.__zeroChatSmoke.guideProviderKeyHelpState()`,
    )
    assert.equal(
      geminiGuideKeyHelpState.visible &&
        geminiGuideKeyHelpState.href.includes('aistudio.google.com/app/apikey') &&
        geminiGuideKeyHelpState.rel.includes('noreferrer') &&
        /Gemini/.test(geminiGuideKeyHelpState.titleText) &&
        geminiGuideKeyHelpState.noteText.length > 20,
      true,
      `Gemini guide key help should switch to the official key page (${JSON.stringify(geminiGuideKeyHelpState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickGuideProviderCard('openai')`, true)

    const setViewport = async (width, height, mobile = width <= 520) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile,
      })
      await sleep(120)
    }

    const assertReducedMotion = async () => {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      })
      await sleep(120)
      const reducedState = await evaluate(`window.__zeroChatSmoke.reducedMotionState()`)

      assert.equal(
        reducedState.mediaMatches,
        true,
        `reduced-motion media query should match when emulated (${JSON.stringify(reducedState)})`,
      )
      assert.equal(
        reducedState.sampleTransitionMs <= 0.01,
        true,
        `reduced-motion should make generic transitions effectively instant (${JSON.stringify(reducedState)})`,
      )
      assert.equal(
        reducedState.sampleAnimationMs <= 0.01,
        true,
        `reduced-motion should make generic animations effectively instant (${JSON.stringify(reducedState)})`,
      )
      assert.equal(
        reducedState.sampleAnimationIterationCount,
        '1',
        `reduced-motion should cap repeated animations to one iteration (${JSON.stringify(reducedState)})`,
      )
      assert.equal(
        reducedState.spinAnimationName,
        'none',
        `reduced-motion should stop sync spinner rotation (${JSON.stringify(reducedState)})`,
      )
      assert.equal(
        reducedState.modeButtonTransitionMs <= 0.01,
        true,
        `reduced-motion should reduce first-run mode-button transitions (${JSON.stringify(reducedState)})`,
      )

      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
      })
      await sleep(120)
      const normalState = await evaluate(`window.__zeroChatSmoke.reducedMotionState()`)

      assert.equal(
        normalState.mediaMatches,
        false,
        `reduced-motion media query should clear after no-preference reset (${JSON.stringify(normalState)})`,
      )
      assert.equal(
        normalState.sampleTransitionMs >= 100,
        true,
        `smoke reduced-motion assertion must exercise a real transition before reduction (${JSON.stringify(normalState)})`,
      )
      assert.equal(
        normalState.spinAnimationName,
        'spin',
        `smoke reduced-motion assertion must exercise the real spinner animation before reduction (${JSON.stringify(normalState)})`,
      )
    }

    const assertQuality = async (label) => {
      const metrics = await evaluate(`window.__zeroChatSmoke.metrics()`)
      assert.equal(metrics.overflowing, false, `${label}: page should not overflow horizontally`)
      assert.deepEqual(metrics.clippedControls, [], `${label}: controls should not clip their labels`)
      assert.deepEqual(metrics.clippedGroups, [], `${label}: control groups should not clip their labels`)
      assert.deepEqual(metrics.clippedPlaceholders, [], `${label}: input placeholders should fit their fields`)
      assert.deepEqual(metrics.smallTargets, [], `${label}: visible action targets should be at least 28px`)
      assert.deepEqual(metrics.dialogA11yIssues, [], `${label}: visible dialogs should expose title and description semantics`)
      assert.deepEqual(metrics.overlaps, [], `${label}: controls should not overlap`)
      assert.deepEqual(metrics.offCenterControls, [], `${label}: button content should stay visually centered`)
      assert.equal(metrics.modalOutOfBounds, false, `${label}: modal should stay inside viewport`)
      assert.equal(metrics.welcomeComposerCenterDelta <= 1, true, `${label}: welcome panel should stay centered with composer`)
      assert.equal(metrics.welcomeWiderThanComposer, false, `${label}: welcome panel should not be wider than composer`)
      assert.equal(metrics.composerToolbarOutOfBounds, false, `${label}: composer toolbar should stay inside viewport`)
      assert.equal(metrics.messageListComposerMisaligned, false, `${label}: chat and composer gutters should stay aligned`)
      assert.equal(metrics.compactSendButtonTooWide, false, `${label}: compact send button should not consume the whole composer row`)
      assert.equal(metrics.compactSendButtonTooTall, false, `${label}: compact send button should not stretch into a tall rail`)
      assert.equal(
        metrics.guideSyncModeButtonsReachable,
        true,
        `${label}: first-run sync choices should remain reachable in the setup scroll area (${JSON.stringify(metrics.guideSyncButtonRects)})`,
      )
      assert.equal(
        metrics.guideProviderBeforeSync,
        true,
        `${label}: first-run Provider setup should precede optional sync in mobile visual and DOM order`,
      )
      if (metrics.guideSyncModeLabels.length > 0) {
        assert.equal(
          metrics.guideSyncModeLabels.includes('Cloudflare'),
          true,
          `${label}: first-run sync choices should name Cloudflare instead of a low-level Worker label (${metrics.guideSyncModeLabels.join(', ')})`,
        )
        assert.equal(
          metrics.guideSyncModeLabels.includes('Worker'),
          false,
          `${label}: first-run sync choices should not show Worker as the user-facing mode label (${metrics.guideSyncModeLabels.join(', ')})`,
        )
      }
      assert.equal(metrics.guideActionsInsideViewport, true, `${label}: first-run actions should stay fully visible`)
      return metrics
    }

    await assertReducedMotion()

    const assertButtonFeedback = async () => {
      const normalState = await evaluate(
        `window.__zeroChatSmoke.installButtonFeedbackProbe()`,
        true,
      )
      assert.equal(
        normalState.transitionProperty.includes('transform'),
        true,
        `button feedback should animate transform changes (${JSON.stringify(normalState)})`,
      )

      try {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: normalState.centerX,
          y: normalState.centerY,
        })
        await sleep(180)
        const hoverState = await evaluate(
          `window.__zeroChatSmoke.buttonFeedbackProbeState()`,
          true,
        )
        assert.equal(
          hoverState.scaleX >= 1.015 && hoverState.scaleY >= 1.015,
          true,
          `button hover feedback should micro-scale to roughly 1.02 without changing layout (${JSON.stringify(hoverState)})`,
        )

        await cdp.send('Input.dispatchMouseEvent', {
          button: 'left',
          clickCount: 1,
          type: 'mousePressed',
          x: hoverState.centerX,
          y: hoverState.centerY,
        })
        await sleep(140)
        const activeState = await evaluate(
          `window.__zeroChatSmoke.buttonFeedbackProbeState()`,
          true,
        )
        assert.equal(
          activeState.scaleX <= 0.935 && activeState.scaleY <= 0.935,
          true,
          `send button active feedback should press down to roughly scale(0.92) (${JSON.stringify(activeState)})`,
        )

        await cdp.send('Input.dispatchMouseEvent', {
          button: 'left',
          clickCount: 1,
          type: 'mouseReleased',
          x: activeState.centerX,
          y: activeState.centerY,
        })
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: 1,
          y: 1,
        })
      } finally {
        await evaluate(`window.__zeroChatSmoke.removeButtonFeedbackProbe()`, true)
      }
    }

    await assertButtonFeedback()

    const pressEscape = async () => {
      const params = {
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      }
      await cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyDown' })
      await cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
      await sleep(80)
    }

    const pressEnter = async () => {
      const params = {
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      }
      await cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyDown' })
      await cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
      await sleep(80)
    }

    const pressTab = async ({ shift = false } = {}) => {
      const params = {
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
        modifiers: shift ? 8 : 0,
      }
      if (shift) {
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Shift',
          code: 'ShiftLeft',
          windowsVirtualKeyCode: 16,
          nativeVirtualKeyCode: 16,
          modifiers: 8,
        })
      }
      await cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyDown' })
      await cdp.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
      if (shift) {
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Shift',
          code: 'ShiftLeft',
          windowsVirtualKeyCode: 16,
          nativeVirtualKeyCode: 16,
        })
      }
      await sleep(20)
    }

    const assertFocusCyclesWithin = async (selector, label) => {
      await evaluate(`window.__zeroChatSmoke.waitForFocusWithin('${selector}')`, true)
      for (let index = 0; index < 24; index += 1) {
        await pressTab()
      }
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.focusWithin('${selector}')`),
        true,
        `Tab navigation should stay inside ${label}`,
      )
      for (let index = 0; index < 24; index += 1) {
        await pressTab({ shift: true })
      }
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.focusWithin('${selector}')`),
        true,
        `Shift+Tab navigation should stay inside ${label}`,
      )
    }

    const clickViewportPoint = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
      })
      await sleep(80)
    }

    const waitForPageLoadCompletion = async (startIndex, timeoutMs = 30_000) => {
      const started = Date.now()

      for (;;) {
        const event = findMainFrameLoadCompletionEvent(
          cdp.events,
          startIndex,
          mainFrameId,
        )

        if (event) {
          return event
        }

        if (Date.now() - started > timeoutMs) {
          const observedPageEvents = [
            ...new Set(
              cdp.events
                .slice(startIndex)
                .map((candidate) => candidate.method)
                .filter((method) => method?.startsWith('Page.')),
            ),
          ]
          throw new Error(
            `Timed out waiting for main-frame page load completion; observed Page events: ${observedPageEvents.join(', ') || 'none'}`,
          )
        }

        await sleep(50)
      }
    }

    const clickSidebarBackdropOutsidePanel = async (label) => {
      const target = await evaluate(`(() => {
        const sidebar = document.querySelector('.sidebar.open')
        const backdrop = document.querySelector('.sidebar-backdrop')
        const sidebarBox = sidebar?.getBoundingClientRect()
        const backdropBox = backdrop?.getBoundingClientRect()

        if (!sidebarBox || !backdropBox) {
          return { ok: false, reason: 'missing sidebar or backdrop' }
        }

        const left = Math.max(backdropBox.left, sidebarBox.right)
        const right = backdropBox.right
        const top = backdropBox.top
        const bottom = backdropBox.bottom

        return {
          ok: right - left >= 24 && bottom - top >= 24,
          left,
          right,
          top,
          bottom,
          sidebarRight: sidebarBox.right,
          x: Math.floor((left + right) / 2),
          y: Math.floor((top + bottom) / 2),
        }
      })()`)

      assert.equal(
        target.ok,
        true,
        `${label}: sidebar backdrop should expose a real clickable area outside the panel (${JSON.stringify(target)})`,
      )

      await clickViewportPoint(target.x, target.y)
    }

    const assertClosedSidebarA11y = async (label, options = {}) => {
      const { expectFocusReturned = true } = options
      const state = await evaluate(`window.__zeroChatSmoke.sidebarA11yState()`)
      assert.equal(
        state.ariaHidden,
        'true',
        `${label}: closed mobile sidebar should be hidden from assistive tech (${JSON.stringify(state)})`,
      )
      assert.equal(
        state.inert,
        true,
        `${label}: closed mobile sidebar should be inert (${JSON.stringify(state)})`,
      )
      assert.equal(
        state.canFocusFirstButton,
        false,
        `${label}: closed mobile sidebar controls should not accept focus (${JSON.stringify(state)})`,
      )
      assert.equal(
        state.tabbableButtons,
        0,
        `${label}: closed mobile sidebar controls should be removed from the Tab order (${JSON.stringify(state)})`,
      )
      if (expectFocusReturned) {
        assert.equal(
          state.activeLabel,
          '打开边栏',
          `${label}: focus should return to the open-sidebar button (${JSON.stringify(state)})`,
        )
        assert.equal(
          state.openButtonFocused,
          true,
          `${label}: open-sidebar button should receive focus (${JSON.stringify(state)})`,
        )
        return
      }

      assert.equal(
        state.openButtonFocused,
        false,
        `${label}: pointer close should not focus the open-sidebar button (${JSON.stringify(state)})`,
      )
      assert.equal(
        state.openButtonFocusVisible,
        false,
        `${label}: pointer close should not leave a visible ring on the open-sidebar button (${JSON.stringify(state)})`,
      )
    }

    const assertOpenSidebarFocus = async (label) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await evaluate(`window.__zeroChatSmoke.activeControlMatches(['关闭边栏', 'Close sidebar'])`)) {
          return
        }
        await sleep(50)
      }

      assert.equal(
        await evaluate(`window.__zeroChatSmoke.activeControlLabel()`),
        '关闭边栏',
        `${label}: opening the mobile sidebar should move focus to the close button`,
      )
    }

    const assertPointerOpenSidebarFocus = async (width, height, label) => {
      await setViewport(width, height)
      await evaluate(`window.__zeroChatSmoke.openSidebarByPointer()`)
      await sleep(80)
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.isSidebarOpen()`),
        true,
        `${label}: sidebar should open from a pointer-style header click`,
      )
      const state = await evaluate(`window.__zeroChatSmoke.sidebarCloseFocusState()`)
      assert.equal(
        state.activeLabel,
        '关闭边栏',
        `${label}: pointer-opened sidebar should still move focus into the panel (${JSON.stringify(state)})`,
      )
      assert.equal(
        state.pointerOpen,
        'true',
        `${label}: pointer-opened sidebar should mark the pointer-open state (${JSON.stringify(state)})`,
      )
      assert.equal(
        state.closeButtonFocused,
        true,
        `${label}: pointer-opened sidebar should focus the close button for continued navigation (${JSON.stringify(state)})`,
      )
      assert.ok(
        !state.closeButtonBoxShadow || state.closeButtonBoxShadow === 'none',
        `${label}: pointer-opened sidebar close button should not show a focus shadow (${JSON.stringify(state)})`,
      )
      await clickSidebarBackdropOutsidePanel(label)
    }

    const assertSidebarBackdropClose = async (width, height, label) => {
      await setViewport(width, height)
      await evaluate(`window.__zeroChatSmoke.click(['打开边栏', 'Open sidebar'])`)
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.isSidebarOpen()`),
        true,
        `${label}: sidebar should open from the header button`,
      )
      await assertOpenSidebarFocus(label)
      await clickSidebarBackdropOutsidePanel(label)
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.isSidebarOpen()`),
        false,
        `${label}: sidebar should close when the surrounding area is clicked`,
      )
      await assertClosedSidebarA11y(label, { expectFocusReturned: false })
      await assertQuality(`${label} after backdrop close`)
    }

    const assertSidebarEscapeClose = async (width, height, label) => {
      await setViewport(width, height)
      await evaluate(`window.__zeroChatSmoke.click(['打开边栏', 'Open sidebar'])`)
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.isSidebarOpen()`),
        true,
        `${label}: sidebar should open from the header button`,
      )
      await assertOpenSidebarFocus(label)
      await pressEscape()
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.isSidebarOpen()`),
        false,
        `${label}: sidebar should close when Escape is pressed`,
      )
      await assertClosedSidebarA11y(label)
      await assertQuality(`${label} after Escape close`)
    }

    const assertSettingsReturnFocusFromMobileSidebar = async (
      width,
      height,
      label,
    ) => {
      await setViewport(width, height)
      await evaluate(`window.__zeroChatSmoke.click(['打开边栏', 'Open sidebar'])`)
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.isSidebarOpen()`),
        true,
        `${label}: sidebar should open before opening Settings`,
      )
      await assertOpenSidebarFocus(label)
      await evaluate(`window.__zeroChatSmoke.openSettingsFromSidebar()`)
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.waitForElement('.settings-modal')`, true),
        true,
        `${label}: opening Settings from the sidebar should show the settings modal`,
      )
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.isSidebarOpen()`),
        false,
        `${label}: sidebar should close before the settings modal becomes interactive`,
      )
      await pressEscape()
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.exists('.settings-modal')`),
        false,
        `${label}: Settings should close when Escape is pressed`,
      )
      await evaluate(
        `window.__zeroChatSmoke.waitForActiveControl(['打开边栏', 'Open sidebar'])`,
        true,
      )
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.activeControlMatches(['打开边栏', 'Open sidebar'])`),
        true,
        `${label}: closing Settings should restore focus to the mobile sidebar opener`,
      )
      await assertClosedSidebarA11y(label)
      await assertQuality(`${label} after Settings Escape`)
    }

    const assertSidebarDangerFocusReturn = async (width, height, label) => {
      await setViewport(width, height)
      await evaluate(`window.__zeroChatSmoke.click(['打开边栏', 'Open sidebar'])`)
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.isSidebarOpen()`),
        true,
        `${label}: sidebar should open before delete warning`,
      )
      await evaluate(`window.__zeroChatSmoke.blurActiveControl()`)
      await evaluate(`window.__zeroChatSmoke.click(['删除对话', 'Delete chat'])`)
      await evaluate(
        `window.__zeroChatSmoke.waitForText(['删除整个对话', 'Delete chat'])`,
        true,
      )
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.isSidebarOpen()`),
        false,
        `${label}: mobile sidebar should close before showing delete warning`,
      )
      await assertFocusCyclesWithin('.danger-modal', `${label} delete warning`)
      await assertQuality(`${label} delete warning`)
      await pressEscape()
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.exists('.danger-modal')`),
        false,
        `${label}: delete warning should close with Escape`,
      )
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.activeControlMatches(['打开边栏', 'Open sidebar'])`),
        true,
        `${label}: delete warning should restore focus to the sidebar opener`,
      )
      await assertClosedSidebarA11y(label)
    }

    for (const [width, height, mobile] of [
      [1440, 900, false],
      [390, 780, true],
      [320, 640, true],
      [300, 620, true],
      [280, 560, false],
    ]) {
      await setViewport(width, height, mobile)
      const guideVisible = await evaluate(`
        Array.from(document.querySelectorAll('button'))
          .some((item) => window.__zeroChatSmoke.match(item, [
            '跳过，先本地使用',
            'Skip, use locally',
            'Skip, use local first',
            'Ignorer, utiliser en local'
          ]))
      `)
      if (guideVisible) {
        const providerPickerState = await evaluate(
          `window.__zeroChatSmoke.guideProviderPickerState()`,
        )
        assert.equal(
            providerPickerState.providerSelectVisible &&
            providerPickerState.providerSelectOptionCount >= 20 &&
            providerPickerState.completeSelectHasFeatured &&
            providerPickerState.completeSelectHasCustomRelay &&
            !providerPickerState.customRelayShortcutStripPresent,
          true,
          `first-run guide ${width}x${height} should keep the complete Provider menu visible and actionable without a duplicate custom-relay shortcut strip (${JSON.stringify(providerPickerState)})`,
        )
        await assertQuality(`first-run guide ${width}x${height}`)
      }
    }

    await setViewport(390, 780, true)
    if (await evaluate(`window.__zeroChatSmoke.exists('.guide-modal')`)) {
      await assertFocusCyclesWithin('.guide-modal', 'the first-run guide modal')
      await assertQuality('first-run guide after keyboard tab cycle')
      await pressEscape()
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.exists('.guide-modal')`),
        true,
        'required first-run guide should stay open when Escape is pressed before setup is skipped or completed',
      )
      await assertQuality('first-run guide after ignored Escape')
    }

    const guideSyncNoteStates = await evaluate(
      `window.__zeroChatSmoke.guideSyncNoteStates()`,
      true,
    )
    if (guideSyncNoteStates.length > 0) {
      assert.equal(
        guideSyncNoteStates.length,
        3,
        `first-run guide should expose three sync choices (${JSON.stringify(guideSyncNoteStates)})`,
      )
      assert.equal(
        guideSyncNoteStates.every((state) => state.active),
        true,
        `first-run guide sync choice should become active after each click (${JSON.stringify(guideSyncNoteStates)})`,
      )
      assert.equal(
        guideSyncNoteStates.every((state) => state.noteVisible && state.note.length > 0),
        true,
        `first-run guide sync note should stay visible and non-empty at 390px (${JSON.stringify(guideSyncNoteStates)})`,
      )
      assert.equal(
        new Set(guideSyncNoteStates.map((state) => state.note)).size,
        3,
        `first-run guide sync note must change for Local/Gist/Cloudflare (${JSON.stringify(guideSyncNoteStates)})`,
      )
    }

    if (await evaluate(`window.__zeroChatSmoke.exists('.guide-modal')`)) {
      await evaluate(`window.__zeroChatSmoke.clickGuideProviderCard('openai')`, true)
      await evaluate(
        `window.__zeroChatSmoke.clickGuideSyncMode([
          'Local',
          '本地',
          'Локально',
          'ローカル',
          '로컬',
          'लोकल',
          'محلي'
        ])`,
        true,
      )
      await evaluate(
        `window.__zeroChatSmoke.setField(
          ['Clé du fournisseur', 'Provider key', 'API Key'],
          'zerochat-guide-invalid'
        )`,
      )
      await sleep(120)
      await evaluate(`window.__zeroChatSmoke.click(['Terminé', 'Done', '完成'])`)
      const rejectedGuideKeyState = await evaluate(
        `window.__zeroChatSmoke.waitForGuideProviderKeyHelpState(
          "(state) => state.statusTone === 'error' && state.statusField === 'providerKey' && state.keyInvalid && state.requestCount >= 1"
        )`,
        true,
      )
      assert.equal(
        /invalide|invalid|无效/.test(rejectedGuideKeyState.statusText),
        true,
        `first-run guide should reject an invalid key without closing (${JSON.stringify(rejectedGuideKeyState)})`,
      )
      assert.equal(
        await evaluate(`window.__zeroChatSmoke.exists('.guide-modal')`),
        true,
        'first-run guide should stay open after automatic key validation fails',
      )
      await evaluate(
        `window.__zeroChatSmoke.setField(
          ['Clé du fournisseur', 'Provider key', 'API Key'],
          'zerochat-guide-valid'
        )`,
      )
      await sleep(120)
      await evaluate(`window.__zeroChatSmoke.click(['Terminé', 'Done', '完成'])`)
      await evaluate(`window.__zeroChatSmoke.waitForPendingModelCheckRequest()`, true)
      await evaluate(`window.__zeroChatResolveModelCheck?.()`, true)
      const connectedGuideState = await evaluate(
        `window.__zeroChatSmoke.waitForGuideProviderKeyHelpState(
          "(state) => state.requestCount >= 2 && state.statusTone === 'success' && state.doneDisabled && /Connecté|Connected|连接成功|Conectado|Подключено|接続済み|연결됨|जुड़ गया|تم الاتصال/.test(state.doneText)"
        )`,
        true,
      )
      assert.equal(
        connectedGuideState.noticeTone === 'success' &&
          /Connexion réussie|Connection successful|连接成功|Conexión correcta|Conexão bem-sucedida|Подключение успешно|接続成功|연결 성공|कनेक्शन सफल|نجح الاتصال/.test(connectedGuideState.noticeText),
        true,
        `first-run guide should show a success confirmation before closing (${JSON.stringify(connectedGuideState)})`,
      )
      const completedGuideState = await evaluate(
        `window.__zeroChatSmoke.waitForGuideProviderKeyHelpState(
          "(state) => state.requestCount >= 2 && !document.querySelector('.guide-modal')"
        )`,
        true,
      )
      assert.equal(
        connectedGuideState.requestCount >= 2 && completedGuideState.requestCount >= 2,
        true,
        `first-run guide should validate through /models before completing (${JSON.stringify(completedGuideState)})`,
      )
    }

    const maybeSkipGuide = await evaluate(`
      (() => {
        const helper = window.__zeroChatSmoke
        const canSkip = Array.from(document.querySelectorAll('button'))
          .some((item) => helper.match(item, [
          '跳过，先本地使用',
          'Skip, use locally',
          'Skip, use local first',
          'Ignorer, utiliser en local'
        ]))
        if (canSkip) helper.click([
          '跳过，先本地使用',
          'Skip, use locally',
          'Skip, use local first',
          'Ignorer, utiliser en local'
        ])
        return canSkip
      })()
    `)

    if (maybeSkipGuide) {
      await evaluate(`window.__zeroChatSmoke.waitForText(['Nouveau chat'])`, true)
      const leakedDefaultTitle = await evaluate(`
        Array.from(document.querySelectorAll('h1, .conversation-select span'))
          .some((item) => item.textContent?.trim() === '新建对话')
      `)
      assert.equal(
        leakedDefaultTitle,
        false,
        'fresh French startup must not show the Chinese default conversation title',
      )
    }

    await setViewport(1440, 900, false)
    const chatFeatureHintState = await evaluate(
      `window.__zeroChatSmoke.waitForFeatureHint('chat')`,
      true,
    )
    assert.equal(
      chatFeatureHintState.visible &&
        chatFeatureHintState.dismissVisible &&
        chatFeatureHintState.role === 'status' &&
        chatFeatureHintState.live === 'polite' &&
        chatFeatureHintState.atomic === 'true' &&
        chatFeatureHintState.placement === 'chat' &&
        chatFeatureHintState.text.length > 20,
      true,
      `chat feature hint should appear once after first-run setup is dismissed (${JSON.stringify(chatFeatureHintState)})`,
    )
    const dismissedChatFeatureHint = await evaluate(
      `window.__zeroChatSmoke.dismissFeatureHint('chat')`,
      true,
    )
    assert.equal(
      dismissedChatFeatureHint.before.visible &&
        !dismissedChatFeatureHint.after.visible,
      true,
      `dismissing chat feature hint should hide it immediately (${JSON.stringify(dismissedChatFeatureHint)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-compose-mode="image"]')`)
    const imageFeatureHintState = await evaluate(
      `window.__zeroChatSmoke.waitForFeatureHint('image')`,
      true,
    )
    assert.equal(
      imageFeatureHintState.visible &&
        imageFeatureHintState.dismissVisible &&
        imageFeatureHintState.role === 'status' &&
        imageFeatureHintState.live === 'polite' &&
        imageFeatureHintState.atomic === 'true' &&
        imageFeatureHintState.placement === 'chat' &&
        imageFeatureHintState.text.length > 20,
      true,
      `image feature hint should appear the first time image mode is entered (${JSON.stringify(imageFeatureHintState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.dismissFeatureHint('image')`, true)
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-compose-mode="chat"]')`)
    const chatFeatureHintReturnState = await evaluate(
      `window.__zeroChatSmoke.waitForFeatureHint('chat', false)`,
      true,
    )
    assert.equal(
      chatFeatureHintReturnState.visible,
      false,
      `dismissed chat feature hint should not reappear when returning to chat mode (${JSON.stringify(chatFeatureHintReturnState)})`,
    )
    const providerModelTriggerFocused = await evaluate(`(() => {
      const trigger = document.querySelector('.provider-model-trigger')
      trigger?.focus()
      return trigger === document.activeElement
    })()`)
    assert.equal(
      providerModelTriggerFocused,
      true,
      'provider/model menu keyboard smoke should begin on its trigger',
    )
    await pressEnter()
    const providerModelFeatureHintState = await evaluate(
      `window.__zeroChatSmoke.waitForFeatureHintDismissFocus('provider-model')`,
      true,
    )
    assert.equal(
      providerModelFeatureHintState.visible &&
        providerModelFeatureHintState.dismissVisible &&
        providerModelFeatureHintState.dismissRole === 'menuitem' &&
        providerModelFeatureHintState.dismissFocused &&
        providerModelFeatureHintState.dismissDescriptionLinked &&
        providerModelFeatureHintState.role === 'none' &&
        providerModelFeatureHintState.live === '' &&
        providerModelFeatureHintState.atomic === '' &&
        providerModelFeatureHintState.placement === 'menu',
      true,
      `provider/model feature hint should be the focused accessible menu item (${JSON.stringify(providerModelFeatureHintState)})`,
    )
    await pressEnter()
    const providerModelHintKeyboardDismissState = {
      hint: await evaluate(
        `window.__zeroChatSmoke.waitForFeatureHint('provider-model', false)`,
        true,
      ),
      menuOpen: await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      focusWithinMenu: await evaluate(`window.__zeroChatSmoke.focusWithin('[role="menu"]')`),
      focusedMenuItem: await evaluate(
        `document.activeElement?.matches('[role^="menuitem"]:not(:disabled)') ?? false`,
      ),
    }
    assert.equal(
      !providerModelHintKeyboardDismissState.hint.visible &&
        providerModelHintKeyboardDismissState.menuOpen &&
        providerModelHintKeyboardDismissState.focusWithinMenu &&
        providerModelHintKeyboardDismissState.focusedMenuItem,
      true,
      `Enter should dismiss the provider/model hint without closing or defocusing its menu (${JSON.stringify(providerModelHintKeyboardDismissState)})`,
    )
    await pressEscape()
    await evaluate(`window.__zeroChatSmoke.click(['打开设置', 'Open settings', 'Ouvrir les paramètres'])`)
    const providersFeatureHintState = await evaluate(
      `window.__zeroChatSmoke.waitForFeatureHint('providers')`,
      true,
    )
    assert.equal(
      providersFeatureHintState.visible &&
        providersFeatureHintState.dismissVisible &&
        providersFeatureHintState.role === 'status' &&
        providersFeatureHintState.live === 'polite' &&
        providersFeatureHintState.atomic === 'true' &&
        providersFeatureHintState.placement === 'settings',
      true,
      `providers settings feature hint should appear on first settings entry (${JSON.stringify(providersFeatureHintState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.dismissFeatureHint('providers')`, true)
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-models')`)
    const modelsFeatureHintState = await evaluate(
      `window.__zeroChatSmoke.waitForFeatureHint('models')`,
      true,
    )
    assert.equal(
      modelsFeatureHintState.visible &&
        modelsFeatureHintState.dismissVisible &&
        modelsFeatureHintState.role === 'status' &&
        modelsFeatureHintState.live === 'polite' &&
        modelsFeatureHintState.atomic === 'true' &&
        modelsFeatureHintState.placement === 'settings',
      true,
      `models settings feature hint should appear on first tab entry (${JSON.stringify(modelsFeatureHintState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-providers')`)
    const providersFeatureHintReturnState = await evaluate(
      `window.__zeroChatSmoke.waitForFeatureHint('providers', false)`,
      true,
    )
    assert.equal(
      providersFeatureHintReturnState.visible,
      false,
      `dismissed providers feature hint should not reappear after switching settings tabs (${JSON.stringify(providersFeatureHintReturnState)})`,
    )
    await pressEscape()
    const conversationSearchInitialState = await evaluate(
      `window.__zeroChatSmoke.conversationSearchState()`,
    )
    assert.equal(
      conversationSearchInitialState.rowCount > 0,
      true,
      `conversation sidebar search should start with visible chats (${JSON.stringify(conversationSearchInitialState)})`,
    )
    assert.equal(
      Boolean(conversationSearchInitialState.placeholder && conversationSearchInitialState.ariaLabel),
      true,
      `conversation sidebar search needs localized placeholder and aria-label (${JSON.stringify(conversationSearchInitialState)})`,
    )
    const conversationSearchNoResultsState = await evaluate(
      `window.__zeroChatSmoke.setConversationSearch('zerochat-no-such-chat')`,
      true,
    )
    assert.equal(
      conversationSearchNoResultsState.rowCount,
      0,
      `non-matching conversation search should hide chat rows (${JSON.stringify(conversationSearchNoResultsState)})`,
    )
    assert.equal(
      conversationSearchNoResultsState.noResultsVisible,
      true,
      `non-matching conversation search should show a no-results empty state (${JSON.stringify(conversationSearchNoResultsState)})`,
    )
    assert.equal(
      conversationSearchNoResultsState.noResultsText.length > 20,
      true,
      `conversation search no-results state should include a useful suggestion (${JSON.stringify(conversationSearchNoResultsState)})`,
    )
    assert.equal(
      conversationSearchNoResultsState.focused,
      true,
      `typing in conversation search should keep focus in the search field (${JSON.stringify(conversationSearchNoResultsState)})`,
    )
    const conversationSearchClearedState = await evaluate(
      `window.__zeroChatSmoke.clearConversationSearch()`,
      true,
    )
    assert.equal(
      conversationSearchClearedState.rowCount > 0 &&
        !conversationSearchClearedState.noResultsVisible &&
        conversationSearchClearedState.inputValue === '',
      true,
      `clearing conversation search should restore the full chat list (${JSON.stringify(conversationSearchClearedState)})`,
    )
    const providerModelTriggerState = await evaluate(
      `window.__zeroChatSmoke.providerModelTriggerState()`,
    )
    assert.equal(
      providerModelTriggerState.visible &&
        providerModelTriggerState.ariaLabel.length > 0 &&
        providerModelTriggerState.height >= 40 &&
        providerModelTriggerState.radius >= providerModelTriggerState.height / 2 - 1 &&
        providerModelTriggerState.text.length > 0,
      true,
      `provider/model header selector should render as a labelled pill (${JSON.stringify(providerModelTriggerState)})`,
    )
    const conversationTitleInitialState = await evaluate(
      `window.__zeroChatSmoke.conversationTitleState()`,
    )
    assert.equal(
      conversationTitleInitialState.buttonVisible &&
        conversationTitleInitialState.titleText.length > 0 &&
        conversationTitleInitialState.ariaLabel.length > 0 &&
        conversationTitleInitialState.hint.length > 0 &&
        conversationTitleInitialState.nativeTitle === '' &&
        conversationTitleInitialState.tooltip === conversationTitleInitialState.hint,
      true,
      `conversation title should expose an editable, labelled, app-tooltipped header control (${JSON.stringify(conversationTitleInitialState)})`,
    )
    const conversationTitleEditingState = await evaluate(
      `window.__zeroChatSmoke.beginConversationTitleEdit()`,
      true,
    )
    assert.equal(
      conversationTitleEditingState.inputVisible &&
        conversationTitleEditingState.focusedInput &&
        conversationTitleEditingState.placeholder.length > 0 &&
        conversationTitleEditingState.width > 120,
      true,
      `conversation title edit mode should focus a stable input (${JSON.stringify(conversationTitleEditingState)})`,
    )
    const renamedConversationTitle = `Smoke renamed chat ${Date.now()}`
    await evaluate(
      `window.__zeroChatSmoke.setConversationTitleDraft(${JSON.stringify(renamedConversationTitle)})`,
      true,
    )
    const conversationTitleSavedState = await evaluate(
      `window.__zeroChatSmoke.pressConversationTitleKey('Enter')`,
      true,
    )
    assert.equal(
      conversationTitleSavedState.buttonVisible &&
        !conversationTitleSavedState.inputVisible &&
        conversationTitleSavedState.titleText === renamedConversationTitle &&
        conversationTitleSavedState.activeRowTitle === renamedConversationTitle &&
        conversationTitleSavedState.focusedButton,
      true,
      `conversation title Enter should save, restore focus, and update the sidebar (${JSON.stringify(conversationTitleSavedState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.beginConversationTitleEdit()`, true)
    await evaluate(
      `window.__zeroChatSmoke.setConversationTitleDraft('Smoke title that should cancel')`,
      true,
    )
    const conversationTitleCancelledState = await evaluate(
      `window.__zeroChatSmoke.pressConversationTitleKey('Escape')`,
      true,
    )
    assert.equal(
      conversationTitleCancelledState.buttonVisible &&
        !conversationTitleCancelledState.inputVisible &&
        conversationTitleCancelledState.titleText === renamedConversationTitle &&
        conversationTitleCancelledState.activeRowTitle === renamedConversationTitle &&
        conversationTitleCancelledState.focusedButton,
      true,
      `conversation title Escape should cancel without changing header or sidebar (${JSON.stringify(conversationTitleCancelledState)})`,
    )
    await setViewport(390, 780, true)
    const mobileConversationTitleEditingState = await evaluate(
      `window.__zeroChatSmoke.beginConversationTitleEdit()`,
      true,
    )
    assert.equal(
      mobileConversationTitleEditingState.inputVisible &&
        mobileConversationTitleEditingState.focusedInput &&
        mobileConversationTitleEditingState.width > 180 &&
        mobileConversationTitleEditingState.width < 390,
      true,
      `conversation title edit field should fit compact mobile headers (${JSON.stringify(mobileConversationTitleEditingState)})`,
    )
    const mobileConversationTitleCancelledState = await evaluate(
      `window.__zeroChatSmoke.pressConversationTitleKey('Escape')`,
      true,
    )
    assert.equal(
      mobileConversationTitleCancelledState.buttonVisible &&
        !mobileConversationTitleCancelledState.inputVisible &&
        mobileConversationTitleCancelledState.titleText === renamedConversationTitle,
      true,
      `conversation title mobile Escape should restore the compact header title (${JSON.stringify(mobileConversationTitleCancelledState)})`,
    )
    await setViewport(390, 780, true)

    await evaluate(
      `window.__zeroChatSmoke.focusActionButton([
        '打开设置',
        'Open settings',
        'Ouvrir les paramètres'
      ])`,
    )
    await evaluate(`window.__zeroChatSmoke.click(['打开设置', 'Open settings', 'Ouvrir les paramètres'])`)
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-data')`)
    await evaluate(
      `window.__zeroChatSmoke.click([
        '打开配置引导',
        'Open setup guide',
        'Ouvrir le guide de configuration'
      ])`,
    )
    await evaluate(`window.__zeroChatSmoke.waitForText(['Première configuration', '首次配置'])`, true)
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('.guide-modal')`),
      true,
      'setup guide should reopen from the Data settings page',
    )
    const reopenedGuideActions = await evaluate(`(() => {
      const helper = window.__zeroChatSmoke
      const buttons = Array.from(document.querySelectorAll('.guide-modal button'))
      return {
        labels: buttons.map((button) => helper.textOf(button)).filter(Boolean),
        hasSkipLocal: buttons.some((button) =>
          helper.match(button, [
            '跳过，先本地使用',
            'Skip, use locally',
            'Skip, use local first',
            'Ignorer, utiliser en local'
          ])
        ),
        hasCloseGuide: buttons.some((button) =>
          helper.match(button, [
            '关闭引导',
            'Close guide',
            'Fermer le guide'
          ])
        ),
      }
    })()`)
    assert.equal(
      reopenedGuideActions.hasSkipLocal,
      false,
      `reopened setup guide should not show the first-run skip-local action (${JSON.stringify(reopenedGuideActions)})`,
    )
    assert.equal(
      reopenedGuideActions.hasCloseGuide,
      true,
      `reopened setup guide should show a harmless close action (${JSON.stringify(reopenedGuideActions)})`,
    )
    await pressEscape()
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('.guide-modal')`),
      false,
      'reopened setup guide should close when Escape is pressed after first run',
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.waitForElement('.settings-modal')`, true),
      true,
      'reopened setup guide should return to Settings after Escape',
    )
    assert.equal(
      await evaluate(`document.querySelector('#settings-tab-data')?.getAttribute('aria-selected') === 'true'`),
      true,
      'reopened setup guide should return to the Data settings tab after Escape',
    )
    await evaluate(
      `window.__zeroChatSmoke.click([
        '打开配置引导',
        'Open setup guide',
        'Ouvrir le guide de configuration'
      ])`,
    )
    await evaluate(`window.__zeroChatSmoke.waitForText(['Première configuration', '首次配置'])`, true)
    await evaluate(
      `window.__zeroChatSmoke.click([
        '关闭引导',
        'Close guide',
        'Fermer le guide'
      ])`,
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('.guide-modal')`),
      false,
      'reopened setup guide should close when the close button is clicked after first run',
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.waitForElement('.settings-modal')`, true),
      true,
      'reopened setup guide should return to Settings after close button click',
    )
    assert.equal(
      await evaluate(`document.querySelector('#settings-tab-data')?.getAttribute('aria-selected') === 'true'`),
      true,
      'reopened setup guide should return to the Data settings tab after close button click',
    )
    await evaluate(`window.__zeroChatSmoke.waitForFocusWithin('.settings-modal')`, true)
    await pressEscape()
    await evaluate(
      `window.__zeroChatSmoke.waitForActiveControl([
        '打开设置',
        'Open settings',
        'Ouvrir les paramètres'
      ])`,
      true,
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.activeControlMatches([
        '打开设置',
        'Open settings',
        'Ouvrir les paramètres'
      ])`),
      true,
      'settings should restore focus to the settings opener after closing the returned Data tab',
    )

    const openSettingsFocus = await evaluate(
      `window.__zeroChatSmoke.focusActionButton(['打开设置', 'Open settings', 'Ouvrir les paramètres'])`,
    )
    assert.equal(
      openSettingsFocus.active,
      true,
      `focused action button should become the active element (${JSON.stringify(openSettingsFocus)})`,
    )
    assert.notEqual(
      openSettingsFocus.boxShadow,
      'none',
      `focused action button should show a focus ring (${JSON.stringify(openSettingsFocus)})`,
    )

    await evaluate(`window.__zeroChatSmoke.click(['打开设置', 'Open settings', 'Ouvrir les paramètres'])`)
    const settingsBackgroundA11y = await evaluate(
      `window.__zeroChatSmoke.modalBackgroundA11yState()`,
    )
    assert.deepEqual(
      settingsBackgroundA11y,
      {
        visibleModal: true,
        mainAriaHidden: 'true',
        mainInert: true,
        sidebarAriaHidden: 'true',
        sidebarInert: true,
      },
      `settings modal should isolate the chat pane and sidebar from assistive tech (${JSON.stringify(settingsBackgroundA11y)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-appearance')`)
    await assertFocusCyclesWithin('.settings-modal', 'the settings modal')
    await evaluate(`window.__zeroChatSmoke.setThemeValue('dark')`)
    await evaluate(`window.__zeroChatSmoke.waitForThemeColor('#0f1117')`, true)
    await evaluate(`window.__zeroChatSmoke.setThemeValue('light')`)
    await evaluate(`window.__zeroChatSmoke.waitForThemeColor('#fafbfc')`, true)
    await evaluate(`window.__zeroChatSmoke.setSelectValue('ar-SA')`)
    await evaluate(`window.__zeroChatSmoke.waitForDocumentLanguage('ar-SA', 'rtl')`, true)
    await assertQuality('settings Arabic RTL language switch')
    await evaluate(`window.__zeroChatSmoke.setSelectValue('hi-IN')`)
    await evaluate(`window.__zeroChatSmoke.waitForDocumentLanguage('hi-IN', 'ltr')`, true)
    await assertQuality('settings Hindi LTR after RTL switch')
    await evaluate(`window.__zeroChatSmoke.setSelectValue('zh-CN')`)
    await evaluate(`window.__zeroChatSmoke.waitForDocumentLanguage('zh-CN', 'ltr')`, true)
    await evaluate(`window.__zeroChatSmoke.setCheckboxLabel(['紧凑显示', 'Compact display'], true)`)
    await evaluate(`window.__zeroChatSmoke.waitForCompact('true')`, true)
    await assertQuality('settings compact display enabled')
    await evaluate(`window.__zeroChatSmoke.setCheckboxLabel(['紧凑显示', 'Compact display'], false)`)
    await evaluate(`window.__zeroChatSmoke.waitForCompact('false')`, true)
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('.settings-modal')`),
      true,
      'settings modal should be open before Escape close check',
    )
    await pressEscape()
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('.settings-modal')`),
      false,
      'settings modal should close when Escape is pressed',
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.activeControlMatches(['打开设置', 'Open settings', 'Ouvrir les paramètres'])`),
      true,
      'settings modal should restore focus to the button that opened it',
    )
    await evaluate(`window.__zeroChatSmoke.click(['打开设置', 'Open settings', 'Ouvrir les paramètres'])`)
    const pointerCloseFocus = await evaluate(`window.__zeroChatSmoke.closeSettingsByPointer()`, true)
    assert.equal(
      pointerCloseFocus.modalOpen,
      false,
      `mouse-style settings close should close the modal (${JSON.stringify(pointerCloseFocus)})`,
    )
    assert.equal(
      pointerCloseFocus.openerFocused,
      false,
      `mouse-style settings close should not leave focus on the settings opener (${JSON.stringify(pointerCloseFocus)})`,
    )
    assert.equal(
      pointerCloseFocus.openerFocusVisible,
      false,
      `mouse-style settings close should not leave a visible focus ring on the settings opener (${JSON.stringify(pointerCloseFocus)})`,
    )

    for (const [width, height, mobile] of [
      [1440, 900, false],
      [860, 700, false],
      [520, 740, true],
      [390, 780, true],
      [320, 640, true],
      [300, 620, true],
      [280, 560, false],
    ]) {
      await setViewport(width, height, mobile)
      await assertQuality(`chat ${width}x${height}`)
    }

    await assertSidebarBackdropClose(720, 760, 'narrow desktop sidebar backdrop')
    await assertSidebarBackdropClose(390, 780, 'mobile sidebar backdrop')
    await assertSidebarBackdropClose(320, 640, 'compact mobile sidebar backdrop')
    await assertPointerOpenSidebarFocus(390, 780, 'mobile sidebar pointer open')
    await assertSidebarEscapeClose(720, 760, 'narrow desktop sidebar Escape')
    await assertSidebarEscapeClose(390, 780, 'mobile sidebar Escape')
    await assertSettingsReturnFocusFromMobileSidebar(
      390,
      780,
      'mobile sidebar Settings Escape',
    )
    await assertSidebarDangerFocusReturn(
      320,
      640,
      'compact mobile sidebar delete warning',
    )

    await setViewport(1180, 820)
    const appChromeState = await evaluate(
      `window.__zeroChatSmoke.waitForAppChromeState()`,
      true,
    )
    assert.equal(
      appChromeState.brandLogoRendered,
      true,
      `sidebar brand lockup should render the ZeroChat app icon, not only text (${JSON.stringify(appChromeState)})`,
    )
    assert.equal(
      appChromeState.brandLogoSrc.endsWith('/favicon.svg') ||
        appChromeState.brandLogoSrc.endsWith('./favicon.svg'),
      true,
      `sidebar brand icon should use the shared branded favicon asset (${JSON.stringify(appChromeState)})`,
    )
    assert.equal(
      appChromeState.syncPillStartCloudSync && appChromeState.syncPillAriaCloudOff,
      true,
      `local sync mode should expose a start-cloud-sync entry while preserving cloud-off status for accessibility (${JSON.stringify(appChromeState)})`,
    )
    assert.equal(
      appChromeState.syncPillAria.includes(appChromeState.syncPillText),
      true,
      `sync pill accessible name should include the visible mode and cloud-off status (${JSON.stringify(appChromeState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.click(['打开设置', 'Open settings'])`)
    await assertQuality('settings initial desktop')

    for (const tabId of ['appearance', 'providers', 'models', 'skills', 'sync', 'data']) {
      await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-${tabId}')`)
      await sleep(80)
      await assertQuality(`settings tab ${tabId}`)
    }

    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-skills')`)
    const skillImportFocus = await evaluate(
      `window.__zeroChatSmoke.focusFileButton(['导入技能', 'Import skill'])`,
    )
    assert.equal(
      skillImportFocus.focusWithin,
      true,
      `focused file input should activate the visible file button (${JSON.stringify(skillImportFocus)})`,
    )
    assert.notEqual(
      skillImportFocus.boxShadow,
      'none',
      `focused file button should show a focus ring (${JSON.stringify(skillImportFocus)})`,
    )
    const disabledSkillAddButton = await evaluate(
      `(() => {
        const button = Array.from(document.querySelectorAll('button'))
          .find((item) => window.__zeroChatSmoke.match(item, ['添加技能', 'Add skill']))
        if (!button) {
          throw new Error('Settings Skills tab must show an Add skill button.')
        }
        const tooltipTarget = button.closest('.skill-add-tooltip-target')
        tooltipTarget?.scrollIntoView({ block: 'center', inline: 'nearest' })
        const rect = button.getBoundingClientRect()
        return {
          describedBy: button.getAttribute('aria-describedby') ?? '',
          disabled: button.disabled,
          pointerEvents: getComputedStyle(button).pointerEvents,
          title: button.getAttribute('title') ?? '',
          tooltip: button.getAttribute('data-tooltip') ?? '',
          targetTitle: tooltipTarget?.getAttribute('title') ?? '',
          targetTooltip: tooltipTarget?.getAttribute('data-tooltip') ?? '',
          visible: rect.width >= 90 && rect.height >= 36,
        }
      })()`,
      true,
    )
    assert.equal(
      disabledSkillAddButton.disabled,
      true,
      `empty Skill drafts should keep Add skill unavailable (${JSON.stringify(disabledSkillAddButton)})`,
    )
    assert.equal(
      disabledSkillAddButton.pointerEvents,
      'none',
      `disabled Add skill button should let the tooltip target receive the pointer (${JSON.stringify(disabledSkillAddButton)})`,
    )
    assert.equal(
      disabledSkillAddButton.visible,
      true,
      `Add skill button should stay visibly sized in the Skills tab (${JSON.stringify(disabledSkillAddButton)})`,
    )
    assert.equal(
      disabledSkillAddButton.title === '' &&
        disabledSkillAddButton.tooltip === '' &&
        disabledSkillAddButton.targetTitle === '' &&
        Boolean(disabledSkillAddButton.targetTooltip),
      true,
      `Disabled Add skill button should expose the blocking reason on its tooltip target without duplicating button tooltips (${JSON.stringify(disabledSkillAddButton)})`,
    )
    assert.equal(
      disabledSkillAddButton.describedBy.includes('skill-add-requirement'),
      true,
      `Disabled Add skill button should be described by its visible requirement (${JSON.stringify(disabledSkillAddButton)})`,
    )
    await sleep(120)
    const disabledSkillAddTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.skill-add-tooltip-target')`,
      true,
    )
    assert.equal(
      disabledSkillAddTooltip.text,
      disabledSkillAddButton.targetTooltip,
      `Disabled Add skill button should show its blocking reason in the delayed app tooltip (${JSON.stringify({ disabledSkillAddButton, disabledSkillAddTooltip })})`,
    )

    await setViewport(844, 390)
    const horizontalSafeAreaState = await evaluate(
      `window.__zeroChatSmoke.horizontalSafeAreaState()`,
    )
    assert.deepEqual(
      horizontalSafeAreaState,
      {
        mobileLayout: true,
        sidebarPaddingLeft: 32,
        chatPanePaddingLeft: 32,
        chatPanePaddingRight: 44,
      },
      `landscape mobile shell should consume both horizontal safe-area insets (${JSON.stringify(horizontalSafeAreaState)})`,
    )

    await setViewport(390, 780)
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-sync')`)
    await evaluate(`window.__zeroChatSmoke.clickSyncMode(['本地', 'Local'])`)
    const localManualSyncButton = await evaluate(
      `(() => {
        const button = Array.from(document.querySelectorAll('button'))
          .find((item) => window.__zeroChatSmoke.match(item, ['立即同步', 'Sync now']))
        if (!button) {
          throw new Error('Settings Sync tab must show a manual Sync now button.')
        }
        const tooltipTarget = button.closest('.sync-now-tooltip-target')
        const rect = button.getBoundingClientRect()
        return {
          disabled: button.disabled,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          title: button.getAttribute('title') ?? '',
          tooltip: button.getAttribute('data-tooltip') ?? '',
          targetTitle: tooltipTarget?.getAttribute('title') ?? '',
          targetTooltip: tooltipTarget?.getAttribute('data-tooltip') ?? '',
          visible: rect.width >= 90 && rect.height >= 36,
        }
      })()`,
      true,
    )
    assert.equal(
      localManualSyncButton.disabled,
      true,
      `local sync mode should show Sync now as unavailable until a cloud mode is configured (${JSON.stringify(localManualSyncButton)})`,
    )
    assert.equal(
      localManualSyncButton.visible,
      true,
      `Sync now button should be visibly sized in the Sync tab (${JSON.stringify(localManualSyncButton)})`,
    )
    assert.equal(
      localManualSyncButton.title === '' &&
        localManualSyncButton.tooltip === '' &&
        localManualSyncButton.targetTitle === '' &&
        Boolean(localManualSyncButton.targetTooltip),
      true,
      `Disabled Sync now button should expose the blocking reason on its tooltip target without duplicating button tooltips (${JSON.stringify(localManualSyncButton)})`,
    )
    const localManualSyncTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.sync-now-tooltip-target')`,
      true,
    )
    assert.equal(
      localManualSyncTooltip.text,
      localManualSyncButton.targetTooltip,
      `Disabled Sync now button should show its blocking reason in the delayed app tooltip (${JSON.stringify({ localManualSyncButton, localManualSyncTooltip })})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSyncMode(['GitHub Gist'])`)
    await evaluate(`window.__zeroChatSmoke.waitForText(['GitHub 令牌'])`, true)
    await evaluate(
      `window.__zeroChatSmoke.waitForSyncRequirementInViewport()`,
      true,
    )
    await evaluate(
      `window.__zeroChatSmoke.waitForFieldInViewport(['Gist ID'])`,
      true,
    )
    await assertQuality('settings sync Gist autoscroll mobile')
    await evaluate(`window.__zeroChatSmoke.clickSyncMode(['本地', 'Local'])`)
    await evaluate(`window.__zeroChatSmoke.clickSyncMode(['Cloudflare'])`)
    await evaluate(
      `window.__zeroChatSmoke.waitForSyncRequirementInViewport()`,
      true,
    )
    await evaluate(
      `window.__zeroChatSmoke.waitForFieldInViewport(['Worker 地址', 'Worker endpoint'])`,
      true,
    )
    await assertQuality('settings sync Cloudflare autoscroll mobile')
    await evaluate(`window.__zeroChatSmoke.clickSyncMode(['本地', 'Local'])`)
    await evaluate(
      `new Promise((resolve, reject) => {
        let attempts = 0
        const wait = () => {
          const active = Array.from(document.querySelectorAll('.sync-compare-card.active'))
            .some((card) => ['本地', 'Local'].some((label) => (card.textContent || '').includes(label)))
          if (active) {
            resolve(true)
            return
          }
          attempts += 1
          if (attempts > 80) {
            reject(new Error('Local sync mode did not become active before sync-password smoke'))
            return
          }
          setTimeout(wait, 50)
        }
        wait()
      })`,
      true,
    )
    await setViewport(320, 640)
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-data')`)
    const scrolledSettingsState = await evaluate(
      `window.__zeroChatSmoke.scrollSettingsModal('bottom')`,
    )
    assert.equal(
      scrolledSettingsState.canScroll,
      true,
      `settings data tab must be tall enough to prove tab-switch scroll reset (${JSON.stringify(scrolledSettingsState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-sync')`)
    const resetSettingsState = await evaluate(
      `window.__zeroChatSmoke.waitForSettingsTabScrollReset()`,
      true,
    )
    assert.equal(
      resetSettingsState.scrollTop <= 1,
      true,
      `settings tab switch should reset the scroll position (${JSON.stringify(resetSettingsState)})`,
    )
    await setViewport(1180, 820)

    await setViewport(280, 560, false)
    await assertQuality('settings data tiny desktop')
    await setViewport(1180, 820)

    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-data')`)
    await evaluate(`window.__zeroChatSmoke.click(['重置同步密码', 'Reset sync password'])`)
    await evaluate(`window.__zeroChatSmoke.waitForText(['这只会清除本机当前记住的数据加密密码。', 'This only clears'])`, true)
    assert.equal(
      await evaluate(`document.querySelector('.danger-skip') === null`),
      true,
      'reset sync password warning must not offer skip option',
    )
    await assertFocusCyclesWithin('.danger-modal', 'the reset sync password warning')
    await assertQuality('reset sync password dialog')
    await pressEscape()
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('.danger-modal')`),
      false,
      'reset sync password warning should close when Escape is pressed',
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.activeControlMatches(['重置同步密码', 'Reset sync password'])`),
      true,
      'reset sync password warning should restore focus to its trigger',
    )
    await evaluate(`window.__zeroChatSmoke.setField(['数据加密密码', 'Data encryption password'], 'old-passphrase-for-smoke')`)
    await evaluate(
      `new Promise((resolve, reject) => {
        let attempts = 0
        const wait = () => {
          if (sessionStorage.getItem('zerochat:secret:sync-passphrase') === 'old-passphrase-for-smoke') {
            resolve(true)
            return
          }
          attempts += 1
          if (attempts > 80) {
            reject(new Error('Old sync passphrase was not committed before rotation smoke'))
            return
          }
          setTimeout(wait, 50)
        }
        wait()
      })`,
      true,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-sync')`)
    await evaluate(`window.__zeroChatSmoke.clickSyncMode(['GitHub Gist'])`)
    await evaluate(
      `new Promise((resolve, reject) => {
        let attempts = 0
        const wait = () => {
          const active = Array.from(document.querySelectorAll('.sync-compare-card.active'))
            .some((card) => (card.textContent || '').includes('GitHub Gist'))
          if (active) {
            resolve(true)
            return
          }
          attempts += 1
          if (attempts > 80) {
            reject(new Error('GitHub Gist sync mode did not become active before rotation smoke'))
            return
          }
          setTimeout(wait, 50)
        }
        wait()
      })`,
      true,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-data')`)
    await evaluate(`window.__zeroChatSmoke.setField(['数据加密密码', 'Data encryption password'], 'new-passphrase-for-smoke')`)
    await evaluate(`window.__zeroChatSmoke.waitForText(['修改同步密码', 'Change sync password'])`, true)
    assert.equal(
      await evaluate(`document.querySelector('.danger-skip') === null`),
      true,
      'rotate sync password warning must not offer skip option',
    )
    await assertQuality('rotate sync password dialog')
    await pressEscape()
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('.danger-modal')`),
      false,
      'rotate sync password warning should close when Escape is pressed',
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-sync')`)
    await evaluate(`window.__zeroChatSmoke.clickSyncMode(['本地', 'Local'])`)
    await setViewport(320, 640)
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-data')`)
    await evaluate(`window.__zeroChatSmoke.click(['重置本机数据', 'Reset local data'])`)
    await evaluate(`window.__zeroChatSmoke.waitForText(['重置本机数据', 'Reset local data'])`, true)
    await assertQuality('reset local data dialog compact mobile')
    await pressEscape()
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('.danger-modal')`),
      false,
      'reset local data warning should close when Escape is pressed',
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.activeControlMatches(['重置本机数据', 'Reset local data'])`),
      true,
      'reset local data warning should restore focus to its trigger',
    )
    await setViewport(1180, 820)

    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-appearance')`)
    await evaluate(`window.__zeroChatSmoke.setSelectValue('ar-SA')`)
    await evaluate(`window.__zeroChatSmoke.waitForDocumentLanguage('ar-SA', 'rtl')`, true)
    await assertQuality('settings Arabic RTL')
    await evaluate(`window.__zeroChatSmoke.setSelectValue('zh-CN')`)
    await evaluate(`window.__zeroChatSmoke.waitForDocumentLanguage('zh-CN', 'ltr')`, true)

    await setViewport(390, 780)
    for (const locale of smokeLanguageLocales) {
      const [language, direction] = locale
      await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-appearance')`)
      await evaluate(`window.__zeroChatSmoke.setSelectValue('${language}')`)
      await evaluate(
        `window.__zeroChatSmoke.waitForDocumentLanguage('${language}', '${direction}')`,
        true,
      )

      for (const tabId of ['appearance', 'providers', 'models', 'skills', 'sync', 'data']) {
        await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-${tabId}')`)
        await sleep(60)
        await assertQuality(`settings ${language} ${tabId} mobile`)
      }
    }

    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-appearance')`)
    await evaluate(`window.__zeroChatSmoke.setSelectValue('zh-CN')`)
    await evaluate(`window.__zeroChatSmoke.waitForDocumentLanguage('zh-CN', 'ltr')`, true)

    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-skills')`)
    await evaluate(
      `window.__zeroChatSmoke.setSkillDraft(
        '',
        '# Blank name fallback\\nA pasted Skill without a name should use the localized single-skill fallback.'
      )`,
    )
    await evaluate(`window.__zeroChatSmoke.click(['添加技能', 'Add skill'])`)
    const fallbackSkillNames = await evaluate(
      `window.__zeroChatSmoke.waitForSkillName('技能')`,
      true,
    )
    assert.equal(
      fallbackSkillNames.includes('技能'),
      true,
      `blank pasted Skill should use the localized single-skill fallback (${JSON.stringify(fallbackSkillNames)})`,
    )
    await setViewport(320, 640)
    await evaluate(`window.__zeroChatSmoke.scrollSettingsModal('bottom')`)
    await evaluate(
      `window.__zeroChatSmoke.setSkillDraft(
        'React hooks smoke',
        '# Hooks\\nReview React hooks for dependency arrays, stale closures, cleanup, memoization, and render loops.\\n\\n# UX\\nKeep buttons centered and layouts stable.'
      )`,
    )
    await evaluate(`window.__zeroChatSmoke.click(['添加技能', 'Add skill'])`)
    await evaluate(`window.__zeroChatSmoke.waitForSkillVisible('React hooks smoke')`, true)
    await evaluate(`window.__zeroChatSmoke.waitForText(['React hooks smoke'])`, true)
    await evaluate(`window.__zeroChatSmoke.waitForText(['词元'])`, true)
    await evaluate(`window.__zeroChatSmoke.setCheckedNear('React hooks smoke', '固定', true)`)
    await evaluate(`window.__zeroChatSmoke.clickSkillEdit('React hooks smoke')`)
    await evaluate(`window.__zeroChatSmoke.waitForSkillEditor('React hooks smoke')`, true)
    await evaluate(
      `window.__zeroChatSmoke.setSkillEditor(
        'React hooks smoke',
        'React hooks smoke',
        ''
      )`,
    )
    const disabledSkillSaveButton = await evaluate(
      `(() => {
        const row = Array.from(document.querySelectorAll('.skill-row'))
          .find((item) => (item.textContent || '').includes('React hooks smoke'))
        if (!row) throw new Error('Missing Skill row for disabled save smoke.')
        const button = Array.from(row.querySelectorAll('.skill-edit-form button'))
          .find((item) => window.__zeroChatSmoke.match(item, ['保存', 'Save']))
        if (!button) throw new Error('Missing Skill save button for disabled save smoke.')
        const tooltipTarget = button.closest('.skill-save-tooltip-target')
        tooltipTarget?.scrollIntoView({ block: 'center', inline: 'nearest' })
        const rect = button.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return {
          describedBy: button.getAttribute('aria-describedby') ?? '',
          disabled: button.disabled,
          pointerEvents: getComputedStyle(button).pointerEvents,
          title: button.getAttribute('title') ?? '',
          tooltip: button.getAttribute('data-tooltip') ?? '',
          targetTitle: tooltipTarget?.getAttribute('title') ?? '',
          targetTooltip: tooltipTarget?.getAttribute('data-tooltip') ?? '',
          hitTag: hit?.tagName ?? '',
          hitClass: hit?.className ?? '',
          visible: rect.width >= 90 && rect.height >= 36,
        }
      })()`,
      true,
    )
    assert.equal(
      disabledSkillSaveButton.disabled,
      true,
      `empty Skill edit content should keep Save unavailable (${JSON.stringify(disabledSkillSaveButton)})`,
    )
    assert.equal(
      disabledSkillSaveButton.pointerEvents,
      'none',
      `disabled Skill save button should let the tooltip target receive the pointer (${JSON.stringify(disabledSkillSaveButton)})`,
    )
    assert.equal(
      disabledSkillSaveButton.visible,
      true,
      `Skill save button should stay visibly sized in the editor (${JSON.stringify(disabledSkillSaveButton)})`,
    )
    assert.equal(
      disabledSkillSaveButton.title === '' &&
        disabledSkillSaveButton.tooltip === '' &&
        disabledSkillSaveButton.targetTitle === '' &&
        Boolean(disabledSkillSaveButton.targetTooltip),
      true,
      `Disabled Skill save button should expose the blocking reason on its tooltip target without duplicating button tooltips (${JSON.stringify(disabledSkillSaveButton)})`,
    )
    assert.equal(
      disabledSkillSaveButton.describedBy.includes('skill-edit-requirement'),
      true,
      `Disabled Skill save button should be described by its visible requirement (${JSON.stringify(disabledSkillSaveButton)})`,
    )
    assert.equal(
      disabledSkillSaveButton.hitTag === 'SPAN' &&
        String(disabledSkillSaveButton.hitClass).includes('skill-save-tooltip-target'),
      true,
      `disabled Skill save pointer hit-test should land on the tooltip target (${JSON.stringify(disabledSkillSaveButton)})`,
    )
    await sleep(120)
    const disabledSkillSaveTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.skill-save-tooltip-target')`,
      true,
    )
    assert.equal(
      disabledSkillSaveTooltip.text,
      disabledSkillSaveButton.targetTooltip,
      `Disabled Skill save button should show its blocking reason in the delayed app tooltip (${JSON.stringify({ disabledSkillSaveButton, disabledSkillSaveTooltip })})`,
    )
    await evaluate(
      `window.__zeroChatSmoke.setSkillEditor(
        'React hooks smoke',
        'React hooks smoke edited',
        '# Hooks\\nReview React hooks for dependency arrays, stale closures, cleanup, memoization, render loops, and accessible labels.'
      )`,
    )
    await evaluate(`window.__zeroChatSmoke.saveSkillEditor('React hooks smoke')`)
    await evaluate(`window.__zeroChatSmoke.waitForText(['技能已保存', 'Skill saved'])`, true)
    await evaluate(`window.__zeroChatSmoke.waitForSkillName('React hooks smoke edited')`, true)

    const keys = await evaluate(`window.__zeroChatSmoke.idbKeys()`, true)
    assert.equal(
      keys.some((key) => typeof key === 'string' && key.startsWith('skill-chunk:')),
      true,
      'skill chunk content should be stored separately in IndexedDB',
    )

    const desktopMetrics = await evaluate(`window.__zeroChatSmoke.metrics()`)
    assert.equal(desktopMetrics.overflowing, false, 'desktop layout should not overflow horizontally')
    assert.equal(desktopMetrics.skillRows, 2, 'added skills should be visible')

    for (const [width, height] of [
      [720, 760],
      [390, 780],
      [320, 640],
      [300, 620],
    ]) {
      await setViewport(width, height)
      await assertQuality(`settings skills ${width}x${height}`)
    }

    await setViewport(1180, 820)
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-providers')`)
    let initialProviderListStatus = await evaluate(
      `window.__zeroChatSmoke.providerConnectivityState()`,
    )
    if (initialProviderListStatus.listStatusTone === 'success') {
      await evaluate(
        `window.__zeroChatSmoke.setField(
          ['Clé du fournisseur', 'Provider key', 'API Key'],
          ''
        )`,
      )
      await sleep(120)
      initialProviderListStatus = await evaluate(
        `window.__zeroChatSmoke.providerConnectivityState()`,
      )
    }
    assert.equal(
      initialProviderListStatus.listStatusTone,
      'warning',
      `Provider list should surface missing-key state before a blind connection check (${JSON.stringify(initialProviderListStatus)})`,
    )
    assert.equal(
      initialProviderListStatus.providerAccent,
      'openai',
      `Provider list should show the branded OpenAI accent avatar on first run (${JSON.stringify(initialProviderListStatus)})`,
    )
    assert.equal(
      initialProviderListStatus.providerBadgeText.length > 0 &&
        initialProviderListStatus.modelRequestCount >= 2 &&
        initialProviderListStatus.providerMetaText.includes('3'),
      true,
      `Provider list should include a visible provider avatar and the three /models-discovered models from first-run setup (${JSON.stringify(initialProviderListStatus)})`,
    )
    assert.equal(
      initialProviderListStatus.providerRowDraggable &&
        initialProviderListStatus.providerRowTooltip.length > 0 &&
        initialProviderListStatus.providerRowTitle === '' &&
        initialProviderListStatus.providerRowTooltip.includes(
          initialProviderListStatus.providerNameText,
        ),
      true,
      `Provider list rows should expose contextual drag reorder hints through the app tooltip without native titles (${JSON.stringify(initialProviderListStatus)})`,
    )
    const providerDragTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.provider-list-row[draggable="true"]')`,
      true,
    )
    assert.equal(
      providerDragTooltip.text.includes(initialProviderListStatus.providerNameText),
      true,
      `Provider drag row should show its contextual hint in the delayed app tooltip (${JSON.stringify({ providerDragTooltip, initialProviderListStatus })})`,
    )
    await evaluate(`window.__zeroChatSmoke.click(['检查连接', 'Check connection'])`)
    const missingKeyConnectivityState = await evaluate(
      `window.__zeroChatSmoke.waitForProviderConnectivityState(
        "(state) => state.tone === 'error' && state.field === 'providerKey' && state.keyInvalid && state.listStatusTone === 'error'"
      )`,
      true,
    )
    assert.equal(
      missingKeyConnectivityState.retryVisible,
      false,
      `missing Provider key check should mark the key field without offering a blind retry (${JSON.stringify(missingKeyConnectivityState)})`,
    )
    assert.equal(
      /API Key|provider key|服务商/.test(missingKeyConnectivityState.statusText),
      true,
      `missing Provider key check should use human-readable setup copy (${JSON.stringify(missingKeyConnectivityState)})`,
    )
    await evaluate(
      `window.__zeroChatSmoke.setField(['API Key', 'Provider key'], 'zerochat-provider-connectivity-fail')`,
    )
    await evaluate(`window.__zeroChatSmoke.click(['检查连接', 'Check connection'])`)
    const failedConnectivityState = await evaluate(
      `window.__zeroChatSmoke.waitForProviderConnectivityState(
        "(state) => state.tone === 'error' && state.field === 'baseUrl' && state.retryVisible"
      )`,
      true,
    )
    assert.equal(
      failedConnectivityState.retryAction,
      'connectivity',
      `ordinary Provider connection failures should retry the connectivity check, not full capability checks (${JSON.stringify(failedConnectivityState)})`,
    )
    await evaluate(
      `window.__zeroChatSmoke.setField(['API Key', 'Provider key'], 'zerochat-smoke-provider-key')`,
    )
    const clearedKeyConnectivityState = await evaluate(
      `window.__zeroChatSmoke.providerConnectivityState()`,
    )
    assert.equal(
      clearedKeyConnectivityState.keyInvalid,
      false,
      `editing the Provider key should clear the red field state (${JSON.stringify(clearedKeyConnectivityState)})`,
    )
    assert.equal(
      clearedKeyConnectivityState.listStatusTone,
      'muted',
      `editing the Provider key should return the list status to not-checked instead of leaving a stale failure (${JSON.stringify(clearedKeyConnectivityState)})`,
    )
    await evaluate(
      `window.__zeroChatSmoke.setField(['API Key', 'Provider key'], 'zerochat-provider-loading')`,
    )
    await evaluate(
      `document
        .querySelector('[data-provider-connectivity-check="true"]')
        ?.scrollIntoView({ block: 'center', inline: 'nearest' })`,
      true,
    )
    await sleep(80)
    await evaluate(`window.__zeroChatSmoke.click(['检查连接', 'Check connection'])`)
    const loadingConnectivityState = await evaluate(
      `window.__zeroChatSmoke.waitForProviderConnectivityState(
        "(state) => state.checkDisabled && /正在检查|Checking|Vérification|Comprobando|Verificando|Проверка|確認中|확인 중|जाँच|التحقق/.test(state.checkText)"
      )`,
      true,
    )
    assert.equal(
      loadingConnectivityState.checkPointerEvents,
      'none',
      `loading Provider connection button should let its tooltip target receive pointer events (${JSON.stringify(loadingConnectivityState)})`,
    )
    assert.equal(
      String(loadingConnectivityState.checkHitTag) === 'SPAN' &&
        String(loadingConnectivityState.checkHitClass).includes('provider-connectivity-tooltip-target'),
      true,
      `loading Provider connection pointer hit-test should land on the tooltip target (${JSON.stringify(loadingConnectivityState)})`,
    )
    assert.equal(
      loadingConnectivityState.checkTitle === '' &&
        loadingConnectivityState.checkTooltip === '' &&
        loadingConnectivityState.checkTargetTitle === '' &&
        Boolean(loadingConnectivityState.checkTargetTooltip),
      true,
      `loading Provider connection button should expose the busy reason on its tooltip target without duplicating button tooltips (${JSON.stringify(loadingConnectivityState)})`,
    )
    assert.equal(
      loadingConnectivityState.checkDescribedBy.includes('provider-connectivity-check-hint'),
      true,
      `loading Provider connection button should stay described by the visible connectivity guidance (${JSON.stringify(loadingConnectivityState)})`,
    )
    const loadingProviderTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.provider-connectivity-tooltip-target')`,
      true,
    )
    assert.equal(
      loadingProviderTooltip.text,
      loadingConnectivityState.checkTargetTooltip,
      `loading Provider connection button should show its busy reason in the delayed app tooltip (${JSON.stringify({ loadingConnectivityState, loadingProviderTooltip })})`,
    )
    await evaluate(`window.__zeroChatResolveProviderLoadingModels?.()`, true)
    await evaluate(`window.__zeroChatSmoke.waitForPendingModelCheckRequest()`, true)
    await evaluate(`window.__zeroChatResolveModelCheck?.()`, true)
    const completedConnectivityState = await evaluate(
      `window.__zeroChatSmoke.waitForProviderConnectivityState(
        "(state) => !state.checkDisabled && state.tone === 'success' && state.listStatusTone === 'success'"
      )`,
      true,
    )
    assert.equal(
      completedConnectivityState.checkDisabled,
      false,
      `Provider connection check should re-enable after the pending /models request resolves (${JSON.stringify(completedConnectivityState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-models')`)
    await evaluate(
      `document
        .querySelector('[data-model-fetch-button="settings"]')
        ?.closest('.model-fetch-tooltip-target')
        ?.scrollIntoView({ block: 'center', inline: 'nearest' })`,
      true,
    )
    await sleep(80)
    const readyModelFetchButton = await evaluate(
      `window.__zeroChatSmoke.modelFetchButtonState('settings')`,
      true,
    )
    assert.equal(
      readyModelFetchButton.visible &&
        readyModelFetchButton.disabled === false &&
        readyModelFetchButton.scope === 'settings' &&
        readyModelFetchButton.title === '' &&
        readyModelFetchButton.tooltip === '' &&
        readyModelFetchButton.targetTitle === '' &&
        readyModelFetchButton.targetTooltip &&
        readyModelFetchButton.describedBy.includes('model-list-hint-'),
      true,
      `ready Fetch models button should expose the visible model-list guidance and tooltip contract (${JSON.stringify(readyModelFetchButton)})`,
    )
    const modelFetchRequestCountBefore = readyModelFetchButton.modelRequestCount
    await evaluate(`window.__zeroChatSmoke.clickModelFetchButton('settings')`, true)
    const loadingModelFetchButton = await evaluate(
      `window.__zeroChatSmoke.waitForModelFetchButtonState(
        'settings',
        "(state) => state.disabled && state.modelRequestCount > " + ${JSON.stringify(modelFetchRequestCountBefore)} + " && /正在获取模型|Fetching models|Récupération|Obteniendo|Buscando|Получение|モデルを取得中|모델 가져오는 중|मॉडल|جلب النماذج/.test(state.text)"
      )`,
      true,
    )
    assert.equal(
      loadingModelFetchButton.pointerEvents,
      'none',
      `loading Fetch models button should let its tooltip target receive pointer events (${JSON.stringify(loadingModelFetchButton)})`,
    )
    assert.equal(
      String(loadingModelFetchButton.hitTag) === 'SPAN' &&
        String(loadingModelFetchButton.hitClass).includes('model-fetch-tooltip-target'),
      true,
      `loading Fetch models pointer hit-test should land on the tooltip target (${JSON.stringify(loadingModelFetchButton)})`,
    )
    assert.equal(
      loadingModelFetchButton.title === '' &&
        loadingModelFetchButton.tooltip === '' &&
        loadingModelFetchButton.targetTitle === '' &&
        loadingModelFetchButton.text === loadingModelFetchButton.targetTooltip,
      true,
      `loading Fetch models button should expose the busy reason on its tooltip target without duplicating button tooltips (${JSON.stringify(loadingModelFetchButton)})`,
    )
    const loadingModelFetchTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.model-fetch-tooltip-target')`,
      true,
    )
    assert.equal(
      loadingModelFetchTooltip.text,
      loadingModelFetchButton.targetTooltip,
      `loading Fetch models button should show its busy reason in the delayed app tooltip (${JSON.stringify({ loadingModelFetchButton, loadingModelFetchTooltip })})`,
    )
    await evaluate(`window.__zeroChatResolveProviderLoadingModels?.()`, true)
    const completedModelFetchButton = await evaluate(
      `window.__zeroChatSmoke.waitForModelFetchButtonState(
        'settings',
        "(state) => !state.disabled && state.modelRequestCount > " + ${JSON.stringify(modelFetchRequestCountBefore)} + ""
      )`,
      true,
    )
    assert.equal(
      completedModelFetchButton.disabled,
      false,
      `Fetch models button should re-enable after the pending /models request resolves (${JSON.stringify(completedModelFetchButton)})`,
    )
    await evaluate(
      `document
        .querySelector('[data-model-check-kind="chat"]')
        ?.closest('.model-check-tooltip-target')
        ?.scrollIntoView({ block: 'center', inline: 'nearest' })`,
      true,
    )
    await sleep(80)
    const readyModelCheckButtons = await evaluate(
      `window.__zeroChatSmoke.modelCheckButtonStates()`,
      true,
    )
    assert.equal(
      readyModelCheckButtons.chat.visible &&
        readyModelCheckButtons.image.visible &&
        readyModelCheckButtons.chat.disabled === false &&
        readyModelCheckButtons.image.disabled === false &&
        readyModelCheckButtons.chat.targetTooltip === readyModelCheckButtons.chat.noteText &&
        readyModelCheckButtons.image.targetTooltip === readyModelCheckButtons.image.noteText &&
        readyModelCheckButtons.chat.title === '' &&
        readyModelCheckButtons.image.title === '' &&
        readyModelCheckButtons.chat.tooltip === '' &&
        readyModelCheckButtons.image.tooltip === '',
      true,
      `ready model check buttons should expose the visible connectivity guidance before a request (${JSON.stringify(readyModelCheckButtons)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickModelCheckButton('chat')`, true)
    const loadingModelCheckButtons = await evaluate(
      `window.__zeroChatSmoke.waitForModelCheckButtonStates(
        "(state) => state.chat.disabled && state.image.disabled && state.chat.targetTooltip && state.chat.text === state.chat.targetTooltip && state.image.targetTooltip === state.image.noteText && state.image.text !== state.chat.text"
      )`,
      true,
    )
    assert.equal(
      loadingModelCheckButtons.chat.pointerEvents === 'none' &&
        loadingModelCheckButtons.image.pointerEvents === 'none',
      true,
      `loading model check buttons should let their tooltip targets receive pointer events (${JSON.stringify(loadingModelCheckButtons)})`,
    )
    assert.equal(
      String(loadingModelCheckButtons.chat.hitTag) === 'SPAN' &&
        String(loadingModelCheckButtons.chat.hitClass).includes('model-check-tooltip-target') &&
        String(loadingModelCheckButtons.image.hitTag) === 'SPAN' &&
        String(loadingModelCheckButtons.image.hitClass).includes('model-check-tooltip-target'),
      true,
      `loading model check pointer hit-tests should land on the tooltip targets (${JSON.stringify(loadingModelCheckButtons)})`,
    )
    assert.equal(
      loadingModelCheckButtons.chat.targetTooltip &&
        loadingModelCheckButtons.chat.text === loadingModelCheckButtons.chat.targetTooltip &&
        loadingModelCheckButtons.chat.title === '' &&
        loadingModelCheckButtons.chat.tooltip === '' &&
        loadingModelCheckButtons.chat.targetTitle === '' &&
        loadingModelCheckButtons.image.targetTooltip === loadingModelCheckButtons.image.noteText &&
        loadingModelCheckButtons.image.title === '' &&
        loadingModelCheckButtons.image.tooltip === '' &&
        loadingModelCheckButtons.image.targetTitle === '' &&
        loadingModelCheckButtons.image.text !== loadingModelCheckButtons.chat.text,
      true,
      `loading model check buttons should scope the busy reason to the active field while disabled idle fields keep guidance (${JSON.stringify(loadingModelCheckButtons)})`,
    )
    assert.equal(
      loadingModelCheckButtons.chat.describedBy.includes('model-connectivity-check-hint-') &&
        loadingModelCheckButtons.image.describedBy.includes('model-connectivity-check-hint-'),
      true,
      `loading model check buttons should stay described by the visible request/cost guidance (${JSON.stringify(loadingModelCheckButtons)})`,
    )
    const loadingModelCheckTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.model-check-tooltip-target')`,
      true,
    )
    assert.equal(
      loadingModelCheckTooltip.text,
      loadingModelCheckButtons.chat.targetTooltip,
      `loading model check button should show its busy reason in the delayed app tooltip (${JSON.stringify({ loadingModelCheckButtons, loadingModelCheckTooltip })})`,
    )
    await evaluate(`window.__zeroChatResolveModelCheck?.()`, true)
    const completedModelCheckButtons = await evaluate(
      `window.__zeroChatSmoke.waitForModelCheckButtonStates(
        "(state) => !state.chat.disabled && !state.image.disabled && state.modelCheckRequests >= 1"
      )`,
      true,
    )
    assert.equal(
      completedModelCheckButtons.chat.disabled === false &&
        completedModelCheckButtons.image.disabled === false,
      true,
      `model check buttons should re-enable after the pending chat model check resolves (${JSON.stringify(completedModelCheckButtons)})`,
    )
    await evaluate(
      `document
        .querySelector('.model-add-tooltip-target')
        ?.scrollIntoView({ block: 'center', inline: 'nearest' })`,
      true,
    )
    await sleep(80)
    const disabledModelAddButton = await evaluate(
      `window.__zeroChatSmoke.modelAddButtonState()`,
      true,
    )
    assert.equal(
      disabledModelAddButton.disabled,
      true,
      `empty manual model draft should keep Add model disabled (${JSON.stringify(disabledModelAddButton)})`,
    )
    assert.equal(
      disabledModelAddButton.visible,
      true,
      `disabled Add model button should remain visibly sized in Models settings (${JSON.stringify(disabledModelAddButton)})`,
    )
    assert.equal(
      disabledModelAddButton.pointerEvents,
      'none',
      `disabled Add model button should let its tooltip target receive pointer events (${JSON.stringify(disabledModelAddButton)})`,
    )
    assert.equal(
      String(disabledModelAddButton.hitTag) === 'SPAN' &&
        String(disabledModelAddButton.hitClass).includes('model-add-tooltip-target'),
      true,
      `disabled Add model pointer hit-test should land on the tooltip target (${JSON.stringify(disabledModelAddButton)})`,
    )
    assert.equal(
      disabledModelAddButton.title === '' &&
        disabledModelAddButton.tooltip === '' &&
        disabledModelAddButton.targetTitle === '' &&
        disabledModelAddButton.targetTooltip === disabledModelAddButton.noteText,
      true,
      `disabled Add model button should expose the visible model-list guidance on its tooltip target without duplicating button tooltips (${JSON.stringify(disabledModelAddButton)})`,
    )
    assert.equal(
      disabledModelAddButton.describedBy.includes('model-list-hint-'),
      true,
      `disabled Add model button should be described by the visible model-list guidance (${JSON.stringify(disabledModelAddButton)})`,
    )
    const disabledModelAddTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.model-add-tooltip-target')`,
      true,
    )
    assert.equal(
      disabledModelAddTooltip.text,
      disabledModelAddButton.targetTooltip,
      `disabled Add model button should show the model-list guidance in the delayed app tooltip (${JSON.stringify({ disabledModelAddButton, disabledModelAddTooltip })})`,
    )
    await evaluate(`window.__zeroChatSmoke.addModelTag('gpt-image-2')`)
    await evaluate(`window.__zeroChatSmoke.waitForText(['gpt-image-2'])`, true)
    const modelChipTooltipState = await evaluate(
      `window.__zeroChatSmoke.modelChipTooltipState()`,
    )
    assert.equal(
      modelChipTooltipState.count > 0 &&
        modelChipTooltipState.draggable.every(Boolean) &&
        modelChipTooltipState.titles.every((title) => title === '') &&
        modelChipTooltipState.tooltips.every(
          (tooltip, index) =>
            tooltip &&
            tooltip.includes(modelChipTooltipState.labels[index]),
        ),
      true,
      `Model chips should expose contextual drag reorder hints through the app tooltip without native titles (${JSON.stringify(modelChipTooltipState)})`,
    )
    const modelChipDragTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.model-chip[draggable="true"]')`,
      true,
    )
    assert.equal(
      modelChipTooltipState.labels.some((label) =>
        modelChipDragTooltip.text.includes(label),
      ),
      true,
      `Model chip drag row should show its contextual hint in the delayed app tooltip (${JSON.stringify({ modelChipDragTooltip, modelChipTooltipState })})`,
    )

    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-providers')`)
    await evaluate(
      `window.__zeroChatSmoke.waitForElement('[data-provider-api-key-field="true"] input')`,
      true,
    )
    await evaluate(
      `window.__zeroChatSmoke.setField(['API Key', 'Provider key'], 'zerochat-smoke-provider-key')`,
    )
    const finalProviderKeyState = await evaluate(
      `window.__zeroChatSmoke.waitForProviderConnectivityState(
        "(state) => state.keyPresent && !state.keyInvalid && state.listStatusTone === 'muted' && state.tone === ''"
      )`,
      true,
    )
    assert.equal(
      finalProviderKeyState.keyPresent &&
        !finalProviderKeyState.keyInvalid &&
        finalProviderKeyState.listStatusTone === 'muted',
      true,
      `Provider connectivity fixture should restore a stable browser key before chat smoke continues (${JSON.stringify(finalProviderKeyState)})`,
    )

    await evaluate(`window.__zeroChatSmoke.closeSettings()`)
    await sleep(100)
    const welcomeQuickPromptInitialState = await evaluate(
      `window.__zeroChatSmoke.welcomeQuickPromptState()`,
      true,
    )
    const emptyComposerButtonState = await evaluate(
      `window.__zeroChatSmoke.composerShortcutState()`,
    )
    assert.equal(
      emptyComposerButtonState.sendButtonDisabled &&
        !emptyComposerButtonState.sendButtonTitle &&
        !emptyComposerButtonState.sendButtonTooltip &&
        !emptyComposerButtonState.sendButtonTargetTitle &&
        emptyComposerButtonState.sendButtonTooltipTarget.length > 0 &&
        emptyComposerButtonState.sendButtonAria.includes(
          emptyComposerButtonState.sendButtonTooltipTarget,
        ) &&
        (emptyComposerButtonState.sendButtonAria.includes('Ctrl+Enter') ||
          emptyComposerButtonState.sendButtonAria.includes('Cmd+Enter')),
      true,
      `Disabled composer send button should expose its human-readable blocking reason through aria-label and wrapper tooltip (${JSON.stringify(emptyComposerButtonState)})`,
    )
    const disabledSendTooltipState = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.send-button-tooltip-target')`,
      true,
    )
    assert.equal(
      disabledSendTooltipState.text,
      emptyComposerButtonState.sendButtonTooltipTarget,
      `Disabled composer send button should show the same blocking reason in the delayed app tooltip (${JSON.stringify({ disabledSendTooltipState, emptyComposerButtonState })})`,
    )
    assert.equal(
      welcomeQuickPromptInitialState.count,
      4,
      `Empty chat should expose four quick prompt cards (${JSON.stringify(welcomeQuickPromptInitialState)})`,
    )
    assert.deepEqual(
      [...welcomeQuickPromptInitialState.ids].sort(),
      ['brainstorm', 'code', 'email', 'translate'].sort(),
      `Empty chat quick prompts should cover the PRD suggestions (${JSON.stringify(welcomeQuickPromptInitialState)})`,
    )
    assert.equal(
      welcomeQuickPromptInitialState.tooltips.every(
        (tooltip, index) =>
          tooltip &&
          tooltip === welcomeQuickPromptInitialState.ariaLabels[index],
      ) && welcomeQuickPromptInitialState.titles.every((title) => title === ''),
      true,
      `Empty chat quick prompts should expose matching app tooltips and aria labels without native titles (${JSON.stringify(welcomeQuickPromptInitialState)})`,
    )
    const welcomeQuickPromptClickState = await evaluate(
      `window.__zeroChatSmoke.clickWelcomePrompt('code')`,
      true,
    )
    assert.equal(
      welcomeQuickPromptClickState.messageCount,
      0,
      `Clicking a quick prompt should fill the composer without sending (${JSON.stringify(welcomeQuickPromptClickState)})`,
    )
    assert.equal(
      welcomeQuickPromptClickState.focused,
      true,
      `Clicking a quick prompt should focus the composer (${JSON.stringify(welcomeQuickPromptClickState)})`,
    )
    assert.equal(
      welcomeQuickPromptClickState.sendButtonDisabled,
      false,
      `Clicking a quick prompt should enable sending (${JSON.stringify(welcomeQuickPromptClickState)})`,
    )
    assert.ok(
      welcomeQuickPromptClickState.draft.length > 20 &&
        /code|c[oó]digo|código|代码|コード|코드|كود|код/i.test(
          welcomeQuickPromptClickState.draft,
        ),
      `Code quick prompt should insert a useful draft (${JSON.stringify(welcomeQuickPromptClickState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.setComposerDraft('')`)
    await evaluate(`window.__zeroChatSmoke.startStreamingTokenSmoke()`, true)
    let streamingTypingState = null
    let streamingPartialState = null
    const streamingObservations = []
    for (let attempt = 0; attempt < 70; attempt += 1) {
      const state = await evaluate(`window.__zeroChatSmoke.assistantTextState()`)
      if (attempt % 10 === 0 || state.assistantTexts.length > 0) {
        streamingObservations.push(state)
      }
      if (
        !streamingTypingState &&
        state.typingIndicatorCount > 0 &&
        state.streamingMessageCount === 1 &&
        state.streamingSmokeRequests === 1
      ) {
        streamingTypingState = state
      }
      const hasPartial = state.assistantTexts.some((text) =>
        text.includes('Streaming token smoke: first'),
      )
      const hasFinal = state.assistantTexts.some((text) =>
        text.includes('Streaming token smoke: first second'),
      )

      if (hasPartial && !hasFinal && state.streamingSmokeRequests === 1) {
        streamingPartialState = state
        break
      }

      await sleep(50)
    }
    const streamingFinalState = await evaluate(
      `window.__zeroChatSmoke.waitForAssistantText('Streaming token smoke: first second')`,
      true,
    )
    await evaluate(`window.__zeroChatSmoke.waitForComposerIdle()`, true)
    const streamingTokenState = {
      typingState: streamingTypingState,
      partialState: streamingPartialState,
      finalState: streamingFinalState,
      observations: streamingObservations.slice(0, 20),
    }
    assert.equal(
      streamingPartialState?.streamingSmokeRequests,
      1,
      `streaming smoke should hit the delayed SSE response once (${JSON.stringify(streamingTokenState)})`,
    )
    assert.equal(
      streamingTypingState?.typingIndicatorCount,
      1,
      `streaming smoke should show a three-dot typing indicator before the first token (${JSON.stringify(streamingTokenState)})`,
    )
    assert.equal(
      streamingPartialState?.streamingCursorCount,
      1,
      `streaming smoke should show a blinking cursor while partial text is streaming (${JSON.stringify(streamingTokenState)})`,
    )
    assert.ok(
      streamingPartialState?.assistantTexts.some((text) =>
        text.includes('Streaming token smoke: first') &&
        !text.includes('Streaming token smoke: first second'),
      ),
      `streaming smoke should render the first token before the final token (${JSON.stringify(streamingTokenState)})`,
    )
    assert.ok(
      streamingTokenState.finalState.assistantTexts.some((text) =>
        text.includes('Streaming token smoke: first second'),
      ),
      `streaming smoke should render the complete response after later SSE chunks (${JSON.stringify(streamingTokenState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.sendChatSmokeMessage('Markdown render smoke')`, true)
    const markdownState = await evaluate(
      `window.__zeroChatSmoke.waitForMarkdownRenderSmoke()`,
      true,
    )
    assert.equal(
      markdownState.heading,
      'Markdown smoke',
      `Markdown smoke should render a heading (${JSON.stringify(markdownState)})`,
    )
    assert.ok(
      markdownState.copyButtonCopyCodeLabel &&
        markdownState.copyButtonAria === markdownState.copyButtonCopyCodeLabel &&
        markdownState.copyButtonTooltip === markdownState.copyButtonCopyCodeLabel,
      `Markdown code copy button should expose a code-specific accessible label and app tooltip (${JSON.stringify(markdownState)})`,
    )
    assert.equal(
      markdownState.codeLanguage,
      'typescript',
      `Markdown smoke should show the fenced code language (${JSON.stringify(markdownState)})`,
    )
    assert.ok(
      markdownState.tableWrapped && markdownState.tableText.includes('Feature Status Tables Rendered'),
      `Markdown smoke should render tables inside a bounded scroll wrapper (${JSON.stringify(markdownState)})`,
    )
    assert.equal(
      markdownState.linkTarget,
      '_blank',
      `Markdown smoke should open external links in a new tab (${JSON.stringify(markdownState)})`,
    )
    assert.ok(
      markdownState.linkRel.includes('noopener') && markdownState.linkRel.includes('noreferrer'),
      `Markdown smoke should protect external links with rel attributes (${JSON.stringify(markdownState)})`,
    )
    assert.ok(
      markdownState.blockedCustomLinkCount === 0 &&
        markdownState.remoteMarkdownImageCount === 0 &&
        markdownState.blockedUrlTextVisible &&
        !markdownState.remoteMarkdownImageResourceLoaded,
      `Markdown smoke should keep custom-scheme links and remote images inert without issuing tracking requests (${JSON.stringify(markdownState)})`,
    )
    assert.equal(
      markdownState.markdownWorkerResourceLoaded,
      true,
      `Markdown smoke should render through the lazy Markdown Web Worker (${JSON.stringify(markdownState)})`,
    )
    assert.equal(
      markdownState.scriptElementCount,
      0,
      `Markdown smoke should not create executable script nodes (${JSON.stringify(markdownState)})`,
    )
    assert.ok(
      markdownState.escapedHtmlText,
      `Markdown smoke should show raw HTML as text, not execute it (${JSON.stringify(markdownState)})`,
    )
    const markdownCopyState = await evaluate(
      `window.__zeroChatSmoke.clickMarkdownCodeCopy()`,
      true,
    )
    assert.ok(
        markdownCopyState.copiedText.includes('const value: number = 42'),
      `Markdown code copy should write the raw code text (${JSON.stringify(markdownCopyState)})`,
    )
    assert.ok(
      markdownCopyState.copyButtonCopied === 'true' &&
        markdownCopyState.copyButtonText === markdownCopyState.copyButtonCopiedLabel &&
        markdownCopyState.copyButtonAria === markdownCopyState.copyButtonCopiedLabel,
      `Markdown code copy should show a localized copied state (${JSON.stringify(markdownCopyState)})`,
    )
    const messageContextMenuState = await evaluate(
      `window.__zeroChatSmoke.exerciseMessageContextMenu()`,
      true,
    )
    assert.equal(
      messageContextMenuState.user.preventedDefault,
      true,
      `message context menu should replace the browser default context menu (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      messageContextMenuState.user.role === 'menu' &&
        messageContextMenuState.user.items.every((item) => item.role === 'menuitem') &&
        messageContextMenuState.assistant.role === 'menu' &&
        messageContextMenuState.assistant.items.every((item) => item.role === 'menuitem'),
      `message context menu should expose menu semantics (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      messageContextMenuState.focusInitial.activeMarker === 'copy' &&
        messageContextMenuState.focusAfterArrowDown.activeMarker === 'edit' &&
        messageContextMenuState.focusAfterSecondArrowDown.activeMarker === 'delete' &&
        messageContextMenuState.focusAfterHome.activeMarker === 'copy' &&
        messageContextMenuState.focusAfterEnd.activeMarker === 'delete' &&
        messageContextMenuState.focusAfterArrowUp.activeMarker === 'edit' &&
        messageContextMenuState.focusAfterSecondHome.activeMarker === 'copy',
      `message context menu should focus the first item and support arrow/Home/End keyboard navigation (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      [
        messageContextMenuState.focusAfterArrowDown,
        messageContextMenuState.focusAfterSecondArrowDown,
        messageContextMenuState.focusAfterHome,
        messageContextMenuState.focusAfterEnd,
        messageContextMenuState.focusAfterArrowUp,
        messageContextMenuState.focusAfterSecondHome,
      ].every((state) => state.defaultPrevented),
      `message context menu keyboard navigation should prevent page scrolling while moving focus (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      ['copy', 'edit', 'delete'].every((marker) =>
        messageContextMenuState.user.markers.includes(marker),
      ) &&
        !messageContextMenuState.user.markers.includes('speak') &&
        !messageContextMenuState.user.markers.includes('regenerate') &&
        ['copy', 'speak', 'regenerate', 'delete'].every((marker) =>
          messageContextMenuState.assistant.markers.includes(marker),
        ) &&
        !messageContextMenuState.assistant.markers.includes('edit') &&
        ['copy', 'edit', 'delete'].every((marker) =>
          messageContextMenuState.longPress.markers.includes(marker),
        ) &&
        !messageContextMenuState.longPress.markers.includes('speak'),
      `message context menu should expose copy/edit/delete for user messages and copy/speak/regenerate/delete for assistant messages (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      messageContextMenuState.user.withinViewport &&
        messageContextMenuState.assistant.withinViewport &&
        messageContextMenuState.longPress.withinViewport,
      `message context menu should stay within the viewport (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      messageContextMenuState.longPress.openedByLongPress &&
        messageContextMenuState.longPress.role === 'menu' &&
        messageContextMenuState.longPress.items.every((item) => item.role === 'menuitem') &&
        !messageContextMenuState.longPress.pointerDownPrevented,
      `message long-press menu should open without blocking normal touch scrolling before the delay (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.equal(
      messageContextMenuState.copiedText,
      'Markdown render smoke',
      `message context menu copy should write the full message text (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      !messageContextMenuState.afterCopy.exists &&
        !messageContextMenuState.afterEscape.exists &&
        !messageContextMenuState.afterLongPressEscape.exists,
      `message context menu should close after copy and Escape (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      messageContextMenuState.afterEscape.activeMessageId ===
        messageContextMenuState.assistant.articleMessageId &&
      messageContextMenuState.afterLongPressEscape.activeMessageId ===
          messageContextMenuState.longPress.articleMessageId &&
        messageContextMenuState.afterKeyboardEscape.activeMessageId ===
          messageContextMenuState.keyboard.articleMessageId &&
        messageContextMenuState.afterKeyboardEscape.activeAriaLabel ===
          messageContextMenuState.keyboard.targetAriaLabel,
      `message context menu Escape should restore focus to its invoking message (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      messageContextMenuState.keyboard.preventedDefault &&
        Boolean(messageContextMenuState.keyboard.targetAriaLabel),
      `keyboard-invoked message context menu Escape should restore the exact invoking control (${JSON.stringify(messageContextMenuState)})`,
    )
    assert.ok(
      messageContextMenuState.keyboard.withinViewport &&
        Math.abs(
          messageContextMenuState.keyboard.left -
            messageContextMenuState.keyboard.expectedLeft,
        ) <= 1 &&
        Math.abs(
          messageContextMenuState.keyboard.top -
            messageContextMenuState.keyboard.expectedTop,
        ) <= 1,
      `keyboard-invoked message context menu should anchor to its invoking control (${JSON.stringify(messageContextMenuState.keyboard)})`,
    )
    await evaluate(`window.__zeroChatSmoke.sendChatSmokeMessage('Manual retry smoke')`, true)
    const manualRetryErrorState = await evaluate(
      `window.__zeroChatSmoke.waitForManualRetryError()`,
      true,
    )
    assert.equal(
      manualRetryErrorState.manualRetryRequests,
      4,
      `Manual retry smoke should auto-retry three times before surfacing the failed turn (${JSON.stringify(manualRetryErrorState)})`,
    )
    assert.equal(
      manualRetryErrorState.retryButtonVisible,
      true,
      `Failed assistant turns should expose a visible retry action (${JSON.stringify(manualRetryErrorState)})`,
    )
    assert.ok(
      !/\\b503\\b|upstream|ERR_|stack/i.test(manualRetryErrorState.errorText),
      `Failed assistant turn should show friendly text instead of raw provider details (${JSON.stringify(manualRetryErrorState)})`,
    )
    const manualRetryRecoveredState = await evaluate(
      `window.__zeroChatSmoke.clickManualRetryButton()`,
      true,
    )
    assert.ok(
      manualRetryRecoveredState.assistantTexts.some((text) =>
        text.includes('Manual retry smoke recovered'),
      ),
      `Clicking retry should regenerate the failed assistant turn successfully (${JSON.stringify(manualRetryRecoveredState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.waitForComposerIdle()`, true)
    await evaluate(`window.__zeroChatSmoke.setComposerDraft('Keyboard shortcut smoke')`)
    const shortcutReadyState = await evaluate(`window.__zeroChatSmoke.composerShortcutState()`)
    assert.ok(
      shortcutReadyState.sendButtonTooltipTarget.includes('Ctrl+Enter') ||
        shortcutReadyState.sendButtonTooltipTarget.includes('Cmd+Enter'),
      `Send button wrapper tooltip should expose the platform shortcut (${JSON.stringify(shortcutReadyState)})`,
    )
    assert.ok(
      shortcutReadyState.sendButtonAria.includes('Ctrl+Enter') ||
        shortcutReadyState.sendButtonAria.includes('Cmd+Enter'),
      `Send button accessible label should include the platform shortcut (${JSON.stringify(shortcutReadyState)})`,
    )
    const sendTooltipState = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.send-button[type="submit"]')`,
      true,
    )
    assert.ok(
      sendTooltipState.elapsedMs >= 450,
      `App tooltip should wait roughly 500ms before appearing (${JSON.stringify(sendTooltipState)})`,
    )
    assert.ok(
      sendTooltipState.text.includes('Ctrl+Enter') ||
        sendTooltipState.text.includes('Cmd+Enter'),
      `App tooltip should expose the composer keyboard shortcut, not only rely on native title (${JSON.stringify(sendTooltipState)})`,
    )
    const plainEnterState = await evaluate(
      `window.__zeroChatSmoke.dispatchComposerEnter({})`,
      true,
    )
    assert.equal(
      plainEnterState.defaultPrevented,
      false,
      `Plain Enter should be left to the textarea instead of sending (${JSON.stringify(plainEnterState)})`,
    )
    assert.equal(
      plainEnterState.after.chatRequests,
      plainEnterState.before.chatRequests,
      `Plain Enter must not submit the composer (${JSON.stringify(plainEnterState)})`,
    )
    const shiftEnterState = await evaluate(
      `window.__zeroChatSmoke.dispatchComposerEnter({ shiftKey: true })`,
      true,
    )
    assert.equal(
      shiftEnterState.defaultPrevented,
      false,
      `Shift+Enter should remain a textarea newline shortcut (${JSON.stringify(shiftEnterState)})`,
    )
    assert.equal(
      shiftEnterState.after.chatRequests,
      shiftEnterState.before.chatRequests,
      `Shift+Enter must not submit the composer (${JSON.stringify(shiftEnterState)})`,
    )
    const ctrlEnterState = await evaluate(
      `window.__zeroChatSmoke.dispatchComposerEnter({ ctrlKey: true, waitMs: 0 })`,
      true,
    )
    assert.equal(
      ctrlEnterState.defaultPrevented,
      true,
      `Ctrl+Enter should prevent the textarea default and submit (${JSON.stringify(ctrlEnterState)})`,
    )
    const keyboardShortcutState = await evaluate(
      `window.__zeroChatSmoke.waitForAssistantText('Keyboard shortcut smoke sent by shortcut')`,
      true,
    )
    assert.ok(
      keyboardShortcutState.assistantTexts.some((text) =>
        text.includes('Keyboard shortcut smoke sent by shortcut'),
      ),
      `Ctrl+Enter should send the chat message (${JSON.stringify(keyboardShortcutState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.waitForComposerIdle()`, true)
    const newChatReadyState = await evaluate(
      `window.__zeroChatSmoke.newChatShortcutState()`,
      true,
    )
    assert.equal(
      newChatReadyState.newChatTitle,
      '',
      `New chat button should rely on the app tooltip instead of a native title (${JSON.stringify(newChatReadyState)})`,
    )
    assert.ok(
      newChatReadyState.newChatAria.includes('Ctrl+N') ||
        newChatReadyState.newChatAria.includes('Cmd+N'),
      `New chat button accessible label should include the platform shortcut (${JSON.stringify(newChatReadyState)})`,
    )
    assert.ok(
      newChatReadyState.newChatShortcut === 'Control+N' ||
        newChatReadyState.newChatShortcut === 'Meta+N',
      `New chat button should expose aria-keyshortcuts (${JSON.stringify(newChatReadyState)})`,
    )
    const newChatShortcutState = await evaluate(
      `window.__zeroChatSmoke.dispatchNewChatShortcut()`,
      true,
    )
    assert.equal(
      newChatShortcutState.defaultPrevented,
      true,
      `Ctrl/Cmd+N should prevent the browser default and create a chat (${JSON.stringify(newChatShortcutState)})`,
    )
    assert.equal(
      newChatShortcutState.after.conversationCount,
      newChatShortcutState.before.conversationCount + 1,
      `Ctrl/Cmd+N should create exactly one new conversation (${JSON.stringify(newChatShortcutState)})`,
    )
    assert.equal(
      newChatShortcutState.after.messageCount,
      0,
      `Ctrl/Cmd+N should land in an empty new chat (${JSON.stringify(newChatShortcutState)})`,
    )
    assert.ok(
      newChatShortcutState.after.composerFocused &&
        newChatShortcutState.after.activeTitle.length > 0,
      `Ctrl/Cmd+N should focus the composer in the new active chat (${JSON.stringify(newChatShortcutState)})`,
    )
    const chatRequestsBeforeOffline = await evaluate(`window.__zeroChatChatRequestCount`)
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    })
    await evaluate(`window.dispatchEvent(new Event('offline'))`)
    await evaluate(`window.__zeroChatSmoke.setComposerDraft('Offline queue smoke')`)
    await evaluate(`window.__zeroChatSmoke.clickSelector('.send-button')`)
    await evaluate(
      `window.__zeroChatSmoke.waitForText([
        '当前离线，消息将在联网后发送',
        "You're offline. Messages will send when you're back online.",
      ])`,
      true,
    )
    await evaluate(
      `window.__zeroChatSmoke.waitForText([
        '等待联网后发送',
        'Waiting to send when you are back online',
      ])`,
      true,
    )
    const queuedState = await evaluate(`({
      queuedMessages: document.querySelectorAll('.message.queued').length,
      chatRequests: window.__zeroChatChatRequestCount,
      chatRequestsBeforeOffline: ${chatRequestsBeforeOffline},
      textareaDisabled: document.querySelector('.composer textarea')?.disabled ?? null,
      draft: document.querySelector('.composer textarea')?.value ?? '',
    })`)
    assert.equal(
      queuedState.queuedMessages,
      1,
      `offline send should create one queued assistant turn (${JSON.stringify(queuedState)})`,
    )
    assert.equal(
      queuedState.chatRequests,
      chatRequestsBeforeOffline,
      `offline send should not call the provider before the browser is online (${JSON.stringify(queuedState)})`,
    )
    assert.equal(
      queuedState.textareaDisabled,
      false,
      `offline queued send should leave the composer textarea usable (${JSON.stringify(queuedState)})`,
    )
    assert.equal(
      queuedState.draft,
      '',
      `offline queued send should clear the submitted draft (${JSON.stringify(queuedState)})`,
    )
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })
    await evaluate(`window.dispatchEvent(new Event('online'))`)
    await evaluate(`window.__zeroChatSmoke.waitForText(['Queued offline reply'])`, true)
    const flushedState = await evaluate(`({
      queuedMessages: document.querySelectorAll('.message.queued').length,
      chatRequests: window.__zeroChatChatRequestCount,
      assistantText: Array.from(document.querySelectorAll('.message.assistant p')).map((item) => item.textContent || '').join('\\n'),
    })`)
    assert.equal(
      flushedState.queuedMessages,
      0,
      `queued message should clear after the online flush (${JSON.stringify(flushedState)})`,
    )
    assert.ok(
      flushedState.chatRequests >= chatRequestsBeforeOffline + 1,
      `online flush should send the queued request (${JSON.stringify(flushedState)})`,
    )
    await setViewport(390, 780)
    for (let index = 1; index <= 10; index += 1) {
      const label = `Scroll retention smoke ${String(index).padStart(2, '0')}`
      await evaluate(`window.__zeroChatSmoke.sendChatSmokeMessage(${JSON.stringify(label)})`, true)
    }
    const scrollableState = await evaluate(`window.__zeroChatSmoke.waitForMessageListScrollable()`, true)
    assert.equal(
      scrollableState.canScroll,
      true,
      `new messages button smoke needs a scrollable transcript (${JSON.stringify(scrollableState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.scrollMessageListAwayFromBottom()`)
    const awayState = await evaluate(`window.__zeroChatSmoke.waitForMessageListAwayFromBottom(100)`, true)
    assert.ok(
      awayState.distanceFromBottom > 100,
      `reader should be measurably away from the latest messages before the new turn (${JSON.stringify(awayState)})`,
    )
    await evaluate(
      `window.__zeroChatSmoke.sendChatSmokeMessage('New messages button smoke')`,
      true,
    )
    const newMessagesState = await evaluate(
      `window.__zeroChatSmoke.waitForNewMessagesButtonVisible()`,
      true,
    )
    assert.ok(
      newMessagesState.distanceFromBottom > 100,
      `new messages button should appear without forcing the reader to the bottom (${JSON.stringify(newMessagesState)})`,
    )
    assert.match(
      newMessagesState.newMessagesButtonLabel,
      /新消息|New messages/,
      `new messages button should expose a localized label (${JSON.stringify(newMessagesState)})`,
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.focusNewMessagesButton()`),
      true,
      'new messages button should accept keyboard focus before activation',
    )
    const focusedNewMessagesState = await evaluate(
      `window.__zeroChatSmoke.messageScrollState()`,
    )
    assert.equal(
      focusedNewMessagesState.activeElementClass,
      'new-messages-button',
      `new messages button should retain keyboard focus until activation (${JSON.stringify(focusedNewMessagesState)})`,
    )
    await pressEnter()
    const jumpedState = await evaluate(`window.__zeroChatSmoke.waitForMessageListNearBottom()`, true)
    assert.equal(
      jumpedState.newMessagesButtonVisible,
      false,
      `new messages button should hide after jumping to the latest turn (${JSON.stringify(jumpedState)})`,
    )
    assert.equal(
      jumpedState.transcriptFocused,
      true,
      `new messages button should move focus to the transcript before it unmounts (${JSON.stringify(jumpedState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.click(['新建对话', 'New chat'])`)

    await setViewport(390, 780)
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-compose-mode="image"]')`)
    const imageTaskModeState = await evaluate(`window.__zeroChatSmoke.imageTaskModeState()`)
    assert.equal(
      imageTaskModeState.count,
      3,
      `image composer should expose all three image task modes (${JSON.stringify(imageTaskModeState)})`,
    )
    assert.equal(
      imageTaskModeState.tabs.every(
        (tab) =>
          tab.mode &&
          tab.ariaLabel &&
          !tab.title &&
          !tab.dataTooltip &&
          !tab.targetTitle &&
          tab.ariaLabel === tab.targetTooltip,
      ),
      true,
      `image task mode tabs should preserve full labels through aria-label and wrapper app tooltip without duplicating button titles (${JSON.stringify(imageTaskModeState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-image-task-mode="edit"]')`)
    await evaluate(
      `window.__zeroChatSmoke.waitForText(['开始修改图片', 'Start editing images'])`,
      true,
    )
    await assertQuality('image edit composer mobile')
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-image-task-mode="inpaint"]')`)
    await evaluate(
      `window.__zeroChatSmoke.waitForText(['开始局部重绘', 'Start inpainting'])`,
      true,
    )
    const emptyMaskActionState = await evaluate(
      `window.__zeroChatSmoke.maskActionButtonStates()`,
      true,
    )
    assert.equal(
      !emptyMaskActionState.undo.visible && !emptyMaskActionState.clear.visible,
      true,
      `empty inpaint source state should hide mask actions until an image exists (${JSON.stringify(emptyMaskActionState)})`,
    )
    await assertQuality('image inpaint composer mobile')
    await setViewport(320, 640)
    await assertQuality('image composer 320px')
    await setViewport(300, 620)
    await assertQuality('image composer 300px')

    await setViewport(320, 640)
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-image-task-mode="edit"]')`)
    await evaluate(`window.__zeroChatSmoke.startImagePreviewObjectUrlTracking()`)
    const droppedImageState = await evaluate(
      `window.__zeroChatSmoke.dropTinyImage('zerochat-smoke-dropped-source.png')`,
      true,
    )
    assert.equal(
      droppedImageState.activeBeforeDrop !== null,
      true,
      `dragging an accepted image over the source panel should show drop feedback (${JSON.stringify(droppedImageState)})`,
    )
    assert.ok(
      droppedImageState.sourceText.includes('zerochat-smoke-dropped-source.png') &&
        droppedImageState.hasPreview,
      `dropping an image on the source panel should attach it without using the file picker (${JSON.stringify(droppedImageState)})`,
    )
    const pastedImageState = await evaluate(
      `window.__zeroChatSmoke.pasteTinyImage('zerochat-smoke-pasted-source.png')`,
      true,
    )
    assert.ok(
      pastedImageState.activeElementClass.includes('image-source-panel') &&
        pastedImageState.defaultPrevented &&
        !pastedImageState.notCancelled &&
        pastedImageState.sourceText.includes('zerochat-smoke-pasted-source.png') &&
        pastedImageState.hasPreview &&
        pastedImageState.tooltip,
      `pasting an image on the focused source panel should attach it without using the file picker (${JSON.stringify(pastedImageState)})`,
    )
    const imagePreviewObjectUrlState = await evaluate(
      `window.__zeroChatSmoke.stopImagePreviewObjectUrlTracking()`,
      true,
    )
    assert.deepEqual(
      imagePreviewObjectUrlState,
      {
        createdCount: 2,
        currentPreviewIndex: 1,
        revokeCounts: [1, 0],
      },
      `replacing an image preview should revoke the previous object URL exactly once while retaining the current URL (${JSON.stringify(imagePreviewObjectUrlState)})`,
    )
    const unsupportedDropState = await evaluate(
      `window.__zeroChatSmoke.dropUnsupportedImageSource('zerochat-smoke-source.txt')`,
      true,
    )
    assert.ok(
      unsupportedDropState.rejectedBeforeDrop !== null &&
        !unsupportedDropState.activeAfterDrop &&
        !unsupportedDropState.rejectedAfterDrop &&
        unsupportedDropState.sourceText === unsupportedDropState.beforeSourceText &&
        /PNG|JPEG|WebP/i.test(unsupportedDropState.noticeText),
      `dropping an unsupported source file should show rejected drop feedback without replacing the image (${JSON.stringify(unsupportedDropState)})`,
    )
    const unsupportedPasteState = await evaluate(
      `window.__zeroChatSmoke.pasteUnsupportedImageSource('zerochat-smoke-source.pdf')`,
      true,
    )
    assert.ok(
      unsupportedPasteState.defaultPrevented &&
        !unsupportedPasteState.notCancelled &&
        unsupportedPasteState.sourceText === unsupportedPasteState.beforeSourceText &&
        /PNG|JPEG|WebP/i.test(unsupportedPasteState.noticeText),
      `pasting an unsupported source file should explain the accepted formats without replacing the image (${JSON.stringify(unsupportedPasteState)})`,
    )
    const plainTextPasteState = await evaluate(
      `window.__zeroChatSmoke.pastePlainTextOnSourcePanel()`,
      true,
    )
    assert.ok(
      !plainTextPasteState.defaultPrevented &&
        plainTextPasteState.notCancelled &&
        plainTextPasteState.sourceText === plainTextPasteState.beforeSourceText,
      `plain text pasted on the source panel should not be intercepted as an image paste (${JSON.stringify(plainTextPasteState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-image-task-mode="inpaint"]')`)
    const sourceMaskActionState = await evaluate(
      `window.__zeroChatSmoke.maskActionButtonStates()`,
      true,
    )
    assert.equal(
      sourceMaskActionState.undo.visible &&
        sourceMaskActionState.clear.visible &&
        sourceMaskActionState.undo.disabled &&
        sourceMaskActionState.clear.disabled,
      true,
      `inpaint mask should keep undo and clear disabled until the user paints after choosing a source image (${JSON.stringify(sourceMaskActionState)})`,
    )
    assert.equal(
      sourceMaskActionState.undo.pointerEvents === 'none' &&
        sourceMaskActionState.clear.pointerEvents === 'none',
      true,
      `disabled inpaint mask actions should let their tooltip targets receive pointer events (${JSON.stringify(sourceMaskActionState)})`,
    )
    assert.equal(
      String(sourceMaskActionState.undo.hitTag) === 'SPAN' &&
        String(sourceMaskActionState.undo.hitClass).includes('mask-action-tooltip-target') &&
        String(sourceMaskActionState.clear.hitTag) === 'SPAN' &&
        String(sourceMaskActionState.clear.hitClass).includes('mask-action-tooltip-target'),
      true,
      `disabled inpaint mask action hit-tests should land on tooltip targets (${JSON.stringify(sourceMaskActionState)})`,
    )
    assert.equal(
      sourceMaskActionState.undo.title === '' &&
        sourceMaskActionState.clear.title === '' &&
        sourceMaskActionState.undo.targetTitle === '' &&
        sourceMaskActionState.clear.targetTitle === '' &&
        sourceMaskActionState.undo.tooltip &&
        sourceMaskActionState.undo.tooltip === sourceMaskActionState.undo.targetTooltip &&
        sourceMaskActionState.clear.tooltip === sourceMaskActionState.clear.targetTooltip &&
        sourceMaskActionState.undo.tooltip === sourceMaskActionState.clear.tooltip &&
        sourceMaskActionState.undo.describedBy.includes('mask-keyboard-help') &&
        sourceMaskActionState.clear.describedBy.includes('mask-keyboard-help'),
      true,
      `disabled inpaint mask actions should expose the missing-mask reason through data-tooltip, aria-describedby, and title-free tooltip targets (${JSON.stringify(sourceMaskActionState)})`,
    )
    const sourceMaskActionTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.mask-action-tooltip-target')`,
      true,
    )
    assert.equal(
      sourceMaskActionTooltip.text,
      sourceMaskActionState.undo.targetTooltip,
      `disabled inpaint mask action should show its missing-mask reason in the delayed app tooltip (${JSON.stringify({ sourceMaskActionState, sourceMaskActionTooltip })})`,
    )
    const maskUndoState = await evaluate(`window.__zeroChatSmoke.exerciseMaskUndo()`, true)
    assert.ok(
      maskUndoState.initialPixels === 0 &&
        maskUndoState.secondaryButtonState.pixels === 0 &&
        !maskUndoState.secondaryButtonState.undoEnabled &&
        !maskUndoState.secondaryButtonState.clearEnabled &&
        maskUndoState.nonPrimaryPointerState.pixels === 0 &&
        !maskUndoState.nonPrimaryPointerState.undoEnabled &&
        !maskUndoState.nonPrimaryPointerState.clearEnabled &&
        maskUndoState.afterPaintPixels > 0 &&
        maskUndoState.undoEnabledAfterPaint &&
        maskUndoState.clearEnabledAfterPaint &&
        maskUndoState.afterUndoPixels === 0 &&
        !maskUndoState.undoEnabledAfterUndo &&
        !maskUndoState.clearEnabledAfterUndo &&
        maskUndoState.afterSecondPaintPixels > 0 &&
        maskUndoState.afterClearPixels === 0 &&
        maskUndoState.undoEnabledAfterClear &&
        maskUndoState.afterClearUndoPixels === maskUndoState.afterSecondPaintPixels &&
        maskUndoState.captureFailurePaintPixels > 0 &&
        maskUndoState.captureFailureRecoveryUndoPixels ===
          maskUndoState.captureFailurePaintPixels &&
        maskUndoState.keyboardMovePrevented &&
        maskUndoState.keyboardPaintPrevented &&
        maskUndoState.keyboardPaintPixels > 0 &&
        maskUndoState.keyboardCursorLeft !== '50%' &&
        maskUndoState.keyboardCursorVisible &&
        /arrow|方向键|fl[eè]ches|flechas|setas|стрелки|矢印|화살표|مفاتيح الأسهم|ऐरो/i.test(
          maskUndoState.keyboardHelpText,
        ),
      `inpaint mask controls should reject secondary/non-primary pointers, recover ownership after capture loss, undo one owned stroke, undo clear, support keyboard painting, and keep disabled states honest (${JSON.stringify(maskUndoState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-image-task-mode="edit"]')`)
    await evaluate(
      `window.__zeroChatSmoke.attachTinyImage('zerochat-smoke-source-with-a-deliberately-long-file-name-for-compact-layout-regression-check.png')`,
    )
    await assertQuality('image edit long filename 320px')
    await setViewport(390, 780)
    await evaluate(`window.__zeroChatSmoke.setComposerDraft('Smoke-test locked image controls')`)
    await evaluate(
      `new Promise((resolve, reject) => {
        const started = Date.now()
        const check = () => {
          const button = document.querySelector('.send-button')
          if (button && !button.disabled) {
            resolve(true)
            return
          }
          if (Date.now() - started > 10000) {
            reject(new Error('Image edit send button stayed disabled'))
            return
          }
          setTimeout(check, 50)
        }
        check()
      })`,
      true,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('.send-button')`)
    await evaluate(`window.__zeroChatSmoke.waitForImageRequestStarted()`, true)
    const imageBusyLockState = await evaluate(`window.__zeroChatSmoke.imageBusyLockState()`)
    assert.equal(
      imageBusyLockState.requestStarted,
      true,
      `image edit request should reach the mocked pending request (${JSON.stringify(imageBusyLockState)})`,
    )
    assert.equal(
      imageBusyLockState.chatModeDisabled,
      true,
      `chat/image mode controls should lock during image requests (${JSON.stringify(imageBusyLockState)})`,
    )
    assert.equal(
      imageBusyLockState.imageModeDisabled,
      true,
      `active image mode control should lock during image requests (${JSON.stringify(imageBusyLockState)})`,
    )
    assert.equal(
      imageBusyLockState.imageTabs.every((item) => item.disabled),
      true,
      `all image task tabs should lock during image requests (${JSON.stringify(imageBusyLockState)})`,
    )
    assert.equal(
      [imageBusyLockState.chatMode, imageBusyLockState.imageMode, ...imageBusyLockState.imageTabs]
        .every((item) => item.visible && item.pointerEvents === 'none'),
      true,
      `locked composer mode controls should let their tooltip targets receive pointer events (${JSON.stringify(imageBusyLockState)})`,
    )
    assert.equal(
      [imageBusyLockState.chatMode, imageBusyLockState.imageMode, ...imageBusyLockState.imageTabs]
        .every((item) =>
          String(item.targetHitTag) === 'SPAN' &&
          String(item.targetHitClass).includes('composer-mode-tooltip-target'),
        ),
      true,
      `locked composer mode controls should hit-test to the tooltip target (${JSON.stringify(imageBusyLockState)})`,
    )
    assert.equal(
      [imageBusyLockState.chatMode, imageBusyLockState.imageMode, ...imageBusyLockState.imageTabs]
        .every((item) =>
          !item.title &&
          !item.tooltip &&
          !item.targetTitle &&
          item.targetTooltip &&
          /生成中|Generating|Génération|Generando|Gerando|Генерация|生成中|생성 중|जनरेट|توليد/.test(item.targetTooltip),
        ),
      true,
      `locked composer mode controls should expose the busy reason through tooltip targets without duplicating button titles (${JSON.stringify(imageBusyLockState)})`,
    )
    const composerModeBusyTooltip = await evaluate(
      `window.__zeroChatSmoke.waitForTooltipForSelector('.composer-mode-tooltip-target')`,
      true,
    )
    assert.equal(
      composerModeBusyTooltip.text,
      imageBusyLockState.chatMode.targetTooltip,
      `locked composer mode controls should show the busy reason in the delayed app tooltip (${JSON.stringify({ composerModeBusyTooltip, imageBusyLockState })})`,
    )
    assert.equal(
      imageBusyLockState.chooseAriaDisabled,
      'true',
      `image upload label must expose disabled state while sending (${JSON.stringify(imageBusyLockState)})`,
    )
    assert.equal(
      imageBusyLockState.chooseClassDisabled,
      true,
      `image upload label must look disabled while sending (${JSON.stringify(imageBusyLockState)})`,
    )
    assert.equal(
      imageBusyLockState.chooseInputDisabled,
      true,
      `hidden image upload input must be disabled while sending (${JSON.stringify(imageBusyLockState)})`,
    )
    assert.equal(
      imageBusyLockState.sendButtonIsStop,
      true,
      `image send button should become a stop action while request is pending (${JSON.stringify(imageBusyLockState)})`,
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('.send-button')`)
    await evaluate(`window.__zeroChatSmoke.waitForImageComposerUnlocked()`, true)
    const inlineImageDownloadState = await evaluate(
      `window.__zeroChatSmoke.exerciseInlineImageDownload()`,
      true,
    )
    assert.equal(
      inlineImageDownloadState.buttonDisabled,
      false,
      `inline image download action should be enabled after the image request unlocks (${JSON.stringify(inlineImageDownloadState)})`,
    )
    assert.ok(
      inlineImageDownloadState.buttonWidth >= 30 &&
        inlineImageDownloadState.buttonHeight >= 30 &&
        inlineImageDownloadState.insideFrame,
      `inline image download action should stay visible inside the image frame with a stable tap target (${JSON.stringify(inlineImageDownloadState)})`,
    )
    assert.ok(
      /下载图片|Download image/i.test(inlineImageDownloadState.ariaLabel) &&
        inlineImageDownloadState.title === '' &&
        inlineImageDownloadState.dataTooltip === inlineImageDownloadState.ariaLabel,
      `inline image download action should expose a localized accessible label (${JSON.stringify(inlineImageDownloadState)})`,
    )
    assert.ok(
      inlineImageDownloadState.download?.href?.startsWith('blob:') ||
        inlineImageDownloadState.download?.href?.startsWith('data:image/'),
      `inline image download action should trigger an image download href (${JSON.stringify(inlineImageDownloadState)})`,
    )
    assert.ok(
      /^zerochat-image-.+\.(png|jpg|webp)$/.test(
        inlineImageDownloadState.download?.download ?? '',
      ),
      `inline image download action should use a useful image filename (${JSON.stringify(inlineImageDownloadState)})`,
    )

    await evaluate(`window.__zeroChatSmoke.click(['新建对话', 'New chat'])`)
    await sleep(100)
    await setViewport(390, 780)
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-compose-mode="audio"]')`)
    const emptyAudioState = await evaluate(`window.__zeroChatSmoke.audioComposerState()`)
    assert.equal(
      emptyAudioState.modeActive &&
        emptyAudioState.panelVisible &&
        emptyAudioState.sendButtonDisabled &&
        emptyAudioState.sourceText &&
        /audio|MP4|WebM|音频|视频/i.test(emptyAudioState.noteText) &&
        /Transcribe|转写/i.test(emptyAudioState.sendButtonText),
      true,
      `audio composer should expose the upload panel and disabled transcription action before a file is selected (${JSON.stringify(emptyAudioState)})`,
    )
    assert.equal(
      !emptyAudioState.sendButtonTitle &&
        !emptyAudioState.sendButtonTooltip &&
        !emptyAudioState.sendButtonTargetTitle &&
        emptyAudioState.sendButtonTooltipTarget &&
        emptyAudioState.sendButtonAria.includes(emptyAudioState.sourceText),
      true,
      `disabled audio transcription should expose the missing-source reason through wrapper tooltip target and aria-label (${JSON.stringify(emptyAudioState)})`,
    )
    await assertQuality('audio composer mobile')
    await setViewport(320, 640)
    await assertQuality('audio composer 320px')
    const attachedAudioState = await evaluate(
      `window.__zeroChatSmoke.attachTinyAudio('zerochat-smoke-source-with-a-deliberately-long-file-name-for-compact-layout-regression-check.wav')`,
      true,
    )
    assert.ok(
      attachedAudioState.accept.includes('audio/wav') &&
        attachedAudioState.sourceText.includes('zerochat-smoke-source-with-a-deliberately-long-file-name'),
      `choosing an audio file should update the audio source name and accept common audio formats (${JSON.stringify(attachedAudioState)})`,
    )
    await assertQuality('audio long filename 320px')
    const droppedAudioState = await evaluate(
      `window.__zeroChatSmoke.dropTinyAudio('zerochat-smoke-dropped-audio.wav')`,
      true,
    )
    assert.equal(
      droppedAudioState.activeBeforeDrop !== null,
      true,
      `dragging an accepted audio file over the source panel should show drop feedback (${JSON.stringify(droppedAudioState)})`,
    )
    assert.ok(
      droppedAudioState.sourceText.includes('zerochat-smoke-dropped-audio.wav'),
      `dropping an audio file on the source panel should attach it without using the file picker (${JSON.stringify(droppedAudioState)})`,
    )
    const unsupportedAudioDropState = await evaluate(
      `window.__zeroChatSmoke.dropUnsupportedAudioSource('zerochat-smoke-audio-source.txt')`,
      true,
    )
    assert.ok(
      unsupportedAudioDropState.rejectedBeforeDrop !== null &&
        !unsupportedAudioDropState.activeAfterDrop &&
        !unsupportedAudioDropState.rejectedAfterDrop &&
        unsupportedAudioDropState.sourceText === unsupportedAudioDropState.beforeSourceText &&
        /audio|MP4|WebM|音频|视频/i.test(unsupportedAudioDropState.noticeText),
      `dropping an unsupported audio source should show rejected drop feedback without replacing the audio (${JSON.stringify(unsupportedAudioDropState)})`,
    )
    const chosenAudioState = await evaluate(`window.__zeroChatSmoke.audioComposerState()`)
    assert.equal(
      chosenAudioState.clearButtonVisible &&
        chosenAudioState.chooseAriaDisabled === 'false' &&
        chosenAudioState.chooseClassDisabled === false &&
        chosenAudioState.chooseInputDisabled === false &&
        chosenAudioState.rootScrollWidth <= chosenAudioState.viewportWidth + 1,
      true,
      `selected audio source should keep clear/choose controls usable without horizontal overflow (${JSON.stringify(chosenAudioState)})`,
    )

    await setViewport(1024, 760)
    await evaluate(`window.__zeroChatSmoke.click(['新建对话', 'New chat'])`)
    await sleep(100)
    await evaluate(`window.__zeroChatSmoke.clickSelector('[data-compose-mode="chat"]')`)
    await sleep(100)
    await evaluate(`window.__zeroChatSmoke.clickSelector('.provider-model-trigger')`)
    await sleep(100)
    await assertQuality('provider model menu desktop')
    assert.equal(
      await evaluate(`document.activeElement?.matches('[role^="menuitem"]') ?? false`),
      true,
      'provider/model menu should focus its first menu item before Tab navigation',
    )
    await pressTab()
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      false,
      'provider/model menu should close when Tab is pressed',
    )
    assert.equal(
      await evaluate(`document.activeElement?.matches('.chat-sync-strip') ?? false`),
      true,
      'provider/model menu Tab close should advance focus to the next header control',
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('.provider-model-trigger')`)
    await sleep(100)
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      true,
      'provider/model menu should reopen before Shift+Tab close check',
    )
    await pressTab({ shift: true })
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      false,
      'provider/model menu should close when Shift+Tab is pressed',
    )
    assert.equal(
      await evaluate(`document.activeElement?.matches('.provider-model-trigger') ?? false`),
      true,
      'provider/model menu Shift+Tab close should restore focus to its trigger',
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('.provider-model-trigger')`)
    await sleep(100)
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      true,
      'provider/model menu should open before Escape close check',
    )
    await pressEscape()
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      false,
      'provider/model menu should close when Escape is pressed',
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.activeControlMatches(['服务商和模型', 'Provider and model'])`),
      true,
      'provider/model menu should restore focus to its trigger after Escape',
    )
    await assertQuality('provider model menu after Escape close')
    await evaluate(`window.__zeroChatSmoke.clickSelector('.provider-model-trigger')`)
    await sleep(100)
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      true,
      'provider/model menu should reopen before outside-click close check',
    )
    await clickViewportPoint(512, 520)
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      false,
      'provider/model menu should close when the surrounding page is clicked',
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.activeControlMatches(['服务商和模型', 'Provider and model'])`),
      false,
      'provider/model outside-click close should not leave focus on its trigger',
    )
    assert.equal(
      await evaluate(`document.querySelector('.provider-model-trigger')?.matches(':focus-visible') ?? false`),
      false,
      'provider/model outside-click close should not leave a visible focus ring',
    )
    await assertQuality('provider model menu after outside-click close')
    await evaluate(`window.__zeroChatSmoke.clickSelector('.provider-model-trigger')`)
    await sleep(100)
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      true,
      'provider/model menu should reopen before model selection check',
    )
    await evaluate(`window.__zeroChatSmoke.clickSelector('.provider-model-option')`)
    await sleep(100)
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.exists('[role="menu"]')`),
      false,
      'provider/model menu should close after model selection',
    )
    assert.equal(
      await evaluate(`window.__zeroChatSmoke.activeControlMatches(['服务商和模型', 'Provider and model'])`),
      true,
      'provider/model menu should restore focus to its trigger after model selection',
    )
    await assertQuality('provider model menu after selection close')

    await setViewport(390, 780)
    await evaluate(`
      window.dispatchEvent(new CustomEvent('zerochat:smoke-sync-conflict'))
    `)
    await evaluate(
      `new Promise((resolve, reject) => {
        const started = Date.now()
        const check = () => {
          if (document.querySelector('.sync-conflict-modal')) {
            resolve(true)
            return
          }
          if (Date.now() - started > 15000) {
            reject(new Error(
              'First-sync conflict prompt did not appear; body=' +
                (document.body.textContent || '').trim().slice(0, 500)
            ))
            return
          }
          setTimeout(check, 100)
        }
        check()
      })`,
      true,
    )
    const conflictMetrics = await evaluate(`(() => {
      const modal = document.querySelector('.sync-conflict-modal')
      const box = modal?.getBoundingClientRect()
      const labelFor = (element) =>
        (element.textContent || element.getAttribute('aria-label') || element.tagName).trim()
      const buttons = Array.from(modal?.querySelectorAll('button') || [])
      return {
        exists: Boolean(modal),
        outOfBounds: box
          ? box.left < -1 ||
            box.right > window.innerWidth + 1 ||
            box.top < -1 ||
            box.bottom > window.innerHeight + 1
          : true,
        clippedButtons: buttons
          .filter((element) =>
            element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1
          )
          .map(labelFor),
        smallButtons: buttons
          .filter((element) => {
            const buttonBox = element.getBoundingClientRect()
            return buttonBox.width < 28 || buttonBox.height < 28
          })
          .map(labelFor),
      }
    })()`)
    assert.equal(conflictMetrics.exists, true, 'first-sync conflict prompt should render')
    assert.equal(conflictMetrics.outOfBounds, false, 'first-sync conflict prompt should fit mobile viewport')
    assert.deepEqual(
      conflictMetrics.clippedButtons,
      [],
      'first-sync conflict prompt buttons should not clip labels',
    )
    assert.deepEqual(
      conflictMetrics.smallButtons,
      [],
      'first-sync conflict prompt buttons should keep usable targets',
    )
    await assertFocusCyclesWithin('.sync-conflict-modal', 'the first-sync conflict prompt')
    await pressEscape()
    assert.equal(
      await evaluate(`document.querySelector('.sync-conflict-modal') === null`),
      true,
      'first-sync conflict prompt should close when Escape is pressed',
    )
    assert.equal(
      await evaluate(`document.querySelector('.settings-modal') !== null`),
      true,
      'Escape should close only the topmost sync conflict prompt first',
    )
    await evaluate(`window.__zeroChatSmoke.waitForFocusWithin('.settings-modal')`, true)
    await pressEscape()
    assert.equal(
      await evaluate(`document.querySelector('.settings-modal') === null`),
      true,
      'settings modal should still close with a second Escape after conflict prompt closes',
    )

    await setViewport(1180, 820)
    await evaluate(`window.__zeroChatSmoke.click(['打开设置', 'Open settings', 'Ouvrir les paramètres'])`)
    await evaluate(`window.__zeroChatSmoke.clickSelector('#settings-tab-appearance')`)
    await evaluate(`window.__zeroChatSmoke.setSelectValue('zh-CN')`)
    await evaluate(`window.__zeroChatSmoke.waitForDocumentLanguage('zh-CN', 'ltr')`, true)
    await evaluate(`window.__zeroChatSmoke.closeSettings()`)
    await sleep(700)
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          const recordFirstAppShell = () => {
            if (window.__zeroChatSavedLanguageProbeFirstAppShell) {
              return
            }

            if (!document.querySelector('.app-shell')) {
              return
            }

            window.__zeroChatSavedLanguageProbeFirstAppShell = {
              lang: document.documentElement.lang,
              dir: document.documentElement.dir,
              text: (document.body.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
            }
          }
          const start = () => {
            recordFirstAppShell()
            const observer = new MutationObserver(recordFirstAppShell)
            observer.observe(document.documentElement, {
              attributes: true,
              attributeFilter: ['lang', 'dir'],
              childList: true,
              subtree: true,
            })
            window.addEventListener('pagehide', () => observer.disconnect(), { once: true })
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true })
          } else {
            start()
          }
        })()
      `,
    })
    const reloadEventStart = cdp.events.length
    await cdp.send('Page.reload', { ignoreCache: true })
    await waitForPageLoadCompletion(reloadEventStart)
    const savedLanguageReloadState = await evaluate(
      `new Promise((resolve, reject) => {
        const started = Date.now()
        const check = () => {
          const text = (document.body.textContent || '').replace(/\\s+/g, ' ').trim()
          const firstAppShell = window.__zeroChatSavedLanguageProbeFirstAppShell ?? null
          const ready =
            document.querySelector('.app-shell') &&
            document.documentElement.lang === 'zh-CN' &&
            document.documentElement.dir === 'ltr' &&
            text.includes('新建对话')

          if (ready) {
            resolve({
              lang: document.documentElement.lang,
              dir: document.documentElement.dir,
              firstAppShell,
              hasFrenchNewChat: text.includes('Nouveau chat'),
              text: text.slice(0, 400),
            })
            return
          }

          if (Date.now() - started > 12000) {
            reject(new Error(
              'Saved language did not restore after reload: ' +
                JSON.stringify({
                  lang: document.documentElement.lang,
                  dir: document.documentElement.dir,
                  firstAppShell,
                  text: text.slice(0, 400),
                })
            ))
            return
          }

          setTimeout(check, 50)
        }
        check()
      })`,
      true,
    )
    assert.equal(
      savedLanguageReloadState.lang,
      'zh-CN',
      `saved manual language should restore after reload (${JSON.stringify(savedLanguageReloadState)})`,
    )
    assert.equal(
      savedLanguageReloadState.firstAppShell?.lang,
      'zh-CN',
      `saved manual language should restore after reload before the app shell is shown (${JSON.stringify(savedLanguageReloadState)})`,
    )
    assert.equal(
      savedLanguageReloadState.hasFrenchNewChat,
      false,
      `saved manual language reload must not render the system-language chat UI (${JSON.stringify(savedLanguageReloadState)})`,
    )

    if (iconSyncDomReportPath) {
      const iconSyncDomReport = await evaluate(iconSyncDomProbeSource(), true)
      assert.equal(
        iconSyncDomReport.passed,
        true,
        `current-page icon/sync DOM report must keep the app icon and local cloud-sync entry visible (${JSON.stringify(iconSyncDomReport)})`,
      )
      await mkdir(path.dirname(iconSyncDomReportPath), { recursive: true })
      await writeFile(
        iconSyncDomReportPath,
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            ...iconSyncDomReport,
          },
          null,
          2,
        )}\n`,
      )
    }

    const streamingSyncHelperSource = `
      (() => {
        window.__zeroChatStreamingSyncSmoke = {
          textOf(element) {
            return (element?.textContent || '').replace(/\s+/g, ' ').trim()
          },
          findButton(labels) {
            return Array.from(document.querySelectorAll('button')).find((button) =>
              labels.some((label) => this.textOf(button).includes(label) || button.getAttribute('aria-label')?.includes(label)),
            )
          },
          async waitForElement(selector) {
            for (let attempt = 0; attempt < 120; attempt += 1) {
              const element = document.querySelector(selector)
              if (element) return element
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
            throw new Error('Element did not appear: ' + selector)
          },
          localResetPersistenceDrainState() {
            const modal = document.querySelector('.settings-modal')
            const navigation = modal?.querySelector('.settings-modal-navigation')
            const content = modal?.querySelector('.settings-modal-content')
            const progress = modal?.querySelector('.settings-data-progress')
            const text = this.textOf(document.body)
            return {
              encryptionBlocked: Boolean(this.localEncryptionBlocked),
              encryptionHeld: Boolean(this.localEncryptionRelease),
              encryptionStack: this.localEncryptionStack ?? '',
              busy:
                navigation?.getAttribute('aria-busy') === 'true' &&
                content?.getAttribute('aria-busy') === 'true',
              dangerOpen: Boolean(document.querySelector('.danger-modal')),
              inert: Boolean(navigation?.inert && content?.inert),
              modalInert: modal?.inert ?? false,
              progressVisible: Boolean(progress),
              progressFocused: progress === document.activeElement,
              progressRole: progress?.getAttribute('role') ?? '',
              progressLive: progress?.getAttribute('aria-live') ?? '',
              activeDataAction:
                document.activeElement?.getAttribute('data-settings-data-action') ?? '',
              successVisible: text.includes('已重置本机数据') || text.includes('Local data reset'),
            }
          },
          async prepareHeldLocalSaveAndConfirmReset() {
            if (!document.querySelector('.settings-modal')) {
              const openSettings = this.findButton(['打开设置', 'Open settings'])
              if (!openSettings) throw new Error('Missing Settings opener before local-reset smoke')
              openSettings.click()
              await this.waitForElement('.settings-modal')
            }

            document.querySelector('#settings-tab-sync')?.click()
            await this.waitForElement('.sync-compare-card')
            const localMode = Array.from(document.querySelectorAll('.sync-compare-card'))
              .find((card) => ['本地', 'Local'].some((label) => this.textOf(card).includes(label)))
            if (!localMode) throw new Error('Missing local sync mode before local-reset smoke')
            localMode.click()
            let localModeActive = false
            for (let attempt = 0; attempt < 80; attempt += 1) {
              localModeActive = Array.from(document.querySelectorAll('.sync-compare-card.active'))
                .some((card) => ['本地', 'Local'].some((label) => this.textOf(card).includes(label)))
              if (localModeActive) break
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
            if (!localModeActive) {
              throw new Error('Local sync mode did not become active before local-reset smoke')
            }
            await new Promise((resolve) => setTimeout(resolve, 600))

            document.querySelector('#settings-tab-appearance')?.click()
            await this.waitForElement('#settings-panel-appearance')
            const subtle = crypto.subtle
            const originalEncrypt = subtle.encrypt.bind(subtle)
            this.localEncryptionBlocked = false
            Object.defineProperty(subtle, 'encrypt', {
              configurable: true,
              value: (...args) => {
                const aad = new TextDecoder().decode(
                  new Uint8Array(args[0]?.additionalData),
                )
                const plaintext = new TextDecoder().decode(new Uint8Array(args[2]))
                const isCompactAppData =
                  aad === 'zerochat:local:v1:app-data' &&
                  plaintext.includes('"compactMode":true') &&
                  plaintext.includes('"conversations"')
                if (!isCompactAppData || this.localEncryptionBlocked) {
                  return originalEncrypt(...args)
                }
                this.localEncryptionBlocked = true
                this.localEncryptionStack = new Error('Held local AppData encryption').stack
                return new Promise((resolve, reject) => {
                  this.localEncryptionRelease = () => originalEncrypt(...args).then(resolve, reject)
                })
              },
            })

            const compactLabel = Array.from(document.querySelectorAll('label'))
              .find((label) => ['紧凑显示', 'Compact display'].some((text) => this.textOf(label).includes(text)))
            const compactInput = compactLabel?.querySelector('input[type="checkbox"]')
            if (!compactInput) throw new Error('Missing compact display control before local-reset smoke')
            if (!compactInput.checked) compactInput.click()
            for (let attempt = 0; attempt < 120; attempt += 1) {
              if (
                document.documentElement.dataset.compact === 'true' &&
                this.localEncryptionBlocked &&
                this.localEncryptionRelease
              ) break
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
            if (!this.localEncryptionRelease) {
              throw new Error('Local AppData encryption did not enter the held state')
            }

            document.querySelector('#settings-tab-data')?.click()
            await this.waitForElement('.data-danger-actions')
            const reset = this.findButton(['重置本机数据', 'Reset local data'])
            if (!reset) throw new Error('Missing local-reset action')
            reset.click()
            await this.waitForElement('.danger-modal')
            document.querySelector('.danger-modal .danger-button')?.click()

            for (let attempt = 0; attempt < 120; attempt += 1) {
              const state = this.localResetPersistenceDrainState()
              if (
                state.busy &&
                state.inert &&
                !state.modalInert &&
                state.progressVisible &&
                state.progressFocused &&
                state.progressRole === 'status' &&
                state.progressLive === 'polite' &&
                !state.dangerOpen
              ) return state
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
            throw new Error(
              'Local reset did not wait on the held persistence write: ' +
                JSON.stringify(this.localResetPersistenceDrainState()),
            )
          },
          async startResetGenerationOwnershipSmoke() {
            await this.waitForComposerIdle()
            window.__zeroChatResetGenerationAborted = false
            window.__zeroChatResetGenerationRequestCount = 0
            window.__zeroChatReleaseResetGeneration = null
            this.setComposerDraft('Reset generation ownership smoke')
            await this.waitForReadyToSend()
            document.querySelector('.send-button')?.click()

            for (let attempt = 0; attempt < 120; attempt += 1) {
              const state = this.assistantTextState()
              if (
                window.__zeroChatResetGenerationRequestCount === 1 &&
                state.sendButtonType === 'button'
              ) {
                return state
              }
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
            throw new Error(
              'Reset generation ownership request did not enter the held state: ' +
                JSON.stringify(this.assistantTextState()),
            )
          },
          async waitForResetGenerationAbort() {
            for (let attempt = 0; attempt < 120; attempt += 1) {
              if (
                window.__zeroChatResetGenerationAborted &&
                typeof window.__zeroChatReleaseResetGeneration === 'function'
              ) {
                return this.localResetPersistenceDrainState()
              }
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
            throw new Error(
              'Local reset did not abort and wait for the active generation request: ' +
                JSON.stringify(this.localResetPersistenceDrainState()),
            )
          },
          releaseResetGeneration() {
            const release = window.__zeroChatReleaseResetGeneration
            if (typeof release !== 'function') {
              throw new Error('No held reset-generation request to release')
            }
            release()
            return true
          },
          releaseLocalEncryption() {
            const release = this.localEncryptionRelease
            if (!release) throw new Error('No held local encryption request to release')
            delete crypto.subtle.encrypt
            this.localEncryptionRelease = null
            this.localEncryptionBlocked = false
            release()
            return true
          },
          async waitForLocalResetComplete() {
            for (let attempt = 0; attempt < 160; attempt += 1) {
              const state = this.localResetPersistenceDrainState()
              if (
                !state.busy &&
                !state.inert &&
                !state.progressVisible &&
                state.activeDataAction === 'reset-local' &&
                state.successVisible
              ) return state
              await new Promise((resolve) => setTimeout(resolve, 25))
            }
            throw new Error(
              'Local reset did not finish after persistence released: ' +
                JSON.stringify(this.localResetPersistenceDrainState()),
            )
          },
          async installStreamingAutoSyncFixture(syncEndpoint) {
            const deleteDatabase = (name) =>
              new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(name)
                request.onerror = () => reject(request.error)
                request.onblocked = () => reject(new Error('IndexedDB deletion blocked: ' + name))
                request.onsuccess = () => resolve(true)
              })
            const writeSnapshot = (snapshot) =>
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
                  tx.objectStore('documents').put(snapshot, 'app')
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
            const timestamp = Date.now()
            const conversationId = 'streaming-sync-conversation'
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
            const snapshot = {
              version: 1,
              providers: [provider],
              conversations: [
                {
                  id: conversationId,
                  title: 'Streaming sync smoke',
                  providerId: provider.id,
                  model: provider.model,
                  messages: [],
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
                mode: 'cloudflare',
                autoSync: true,
                encryptionEnabled: true,
                gistFile: 'zerochat-sync.json',
                workerEndpoint: syncEndpoint,
                lastSyncAt: timestamp,
                lastSyncStatus: 'Streaming sync smoke baseline',
              },
              preferences: {
                firstRunDone: true,
                theme: 'system',
                language: 'zh-CN',
                compactMode: false,
                activeConversationId: conversationId,
                dismissedDangerWarnings: [],
                dismissedFeatureHints: [],
              },
              updatedAt: timestamp,
            }

            await deleteDatabase('zerochat-secrets')
            await writeSnapshot(snapshot)
            localStorage.setItem('zerochat:secret:provider:openai', 'zerochat-sync-smoke-provider-key')
            localStorage.setItem('zerochat:secret:sync-passphrase', 'zerochat-sync-smoke-passphrase')
            sessionStorage.setItem('zerochat:secret:sync-passphrase', 'zerochat-sync-smoke-passphrase')
            window.__zeroChatManualRetrySmokeRequestCount = 0
            window.__zeroChatStreamingSmokeRequestCount = 0
            window.__zeroChatCloudSyncRequests = []
            window.__zeroChatCloudSyncStore = {
              generation: '00000000-0000-4000-8000-000000000001',
              head: null,
              objects: {},
            }
            return snapshot
          },
          async waitForDocumentLanguage(language, direction) {
            for (let attempt = 0; attempt < 120; attempt += 1) {
              if (
                document.documentElement.lang === language &&
                document.documentElement.dir === direction
              ) {
                return true
              }
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            throw new Error(
              'Document language did not settle: ' +
                document.documentElement.lang +
                '/' +
                document.documentElement.dir,
            )
          },
          async waitForText(names) {
            for (let attempt = 0; attempt < 160; attempt += 1) {
              const text = (document.body.textContent || '').replace(/\\s+/g, ' ')
              if (names.some((name) => text.includes(name))) return true
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            throw new Error(
              'Text did not appear: ' +
                names.join(' / ') +
                '; errors=' +
                JSON.stringify(window.__zeroChatRuntimeErrors ?? []) +
                '; root=' +
                (document.querySelector('#root')?.innerHTML || '').trim().slice(0, 400) +
                '; scripts=' +
                Array.from(document.scripts).map((script) => script.src || 'inline').join(' | ') +
                '; body=' +
                (document.body.textContent || '').trim().slice(0, 400),
            )
          },
          async waitForComposerIdle() {
            for (let attempt = 0; attempt < 120; attempt += 1) {
              const button = document.querySelector('.send-button')
              const textarea = document.querySelector('.composer textarea')
              if (textarea && button?.getAttribute('type') === 'submit') return true
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            throw new Error('Composer did not return to an idle send state.')
          },
          async waitForReadyToSend() {
            for (let attempt = 0; attempt < 200; attempt += 1) {
              const button = document.querySelector('.send-button[type="submit"]')
              if (button && !button.disabled) return true
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            const button = document.querySelector('.send-button')
            const textarea = document.querySelector('.composer textarea')
            throw new Error(
              'Composer send button did not become enabled: ' +
                JSON.stringify({
                  buttonAria: button?.getAttribute('aria-label') ?? '',
                  buttonDisabled: button?.disabled ?? null,
                  buttonTitle: button?.getAttribute('title') ?? '',
                  buttonType: button?.getAttribute('type') ?? '',
                  body: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
                  textareaDisabled: textarea?.disabled ?? null,
                  textareaValue: textarea?.value ?? null,
                }),
            )
          },
          setComposerDraft(value) {
            const textarea = document.querySelector('.composer textarea')
            if (!textarea) throw new Error('Missing composer textarea')
            textarea.focus()
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
              .set.call(textarea, value)
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            textarea.dispatchEvent(new Event('change', { bubbles: true }))
            return true
          },
          assistantTextState() {
            const assistantTexts = Array.from(document.querySelectorAll('.message.assistant p'))
              .map((item) => (item.textContent || '').trim())
              .filter(Boolean)
            const sendButton = document.querySelector('.send-button')

            return {
              assistantTexts,
              lastAssistantText: assistantTexts.at(-1) ?? '',
              sendButtonType: sendButton?.getAttribute('type') ?? '',
              streamingCursorCount: document.querySelectorAll('[data-streaming-cursor="true"]').length,
              streamingMessageCount: document.querySelectorAll('.message.assistant.streaming').length,
              streamingSmokeRequests: window.__zeroChatStreamingSmokeRequestCount ?? 0,
              typingIndicatorCount: document.querySelectorAll('[data-streaming-typing-indicator="true"]').length,
            }
          },
          generationRetryState() {
            const retryButton = document.querySelector('[data-message-retry-action="true"]')
            const errorMessages = Array.from(document.querySelectorAll('.message.assistant.error'))
              .map((item) => (item.textContent || '').replace(/\\s+/g, ' ').trim())
              .filter(Boolean)
            const requests = window.__zeroChatCloudSyncRequests ?? []
            const store = window.__zeroChatCloudSyncStore ?? { head: null, objects: {} }
            const assistant = this.assistantTextState()
            const cloudSyncMutationMethods = requests
              .filter((request) => request.method !== 'GET')
              .map((request) => request.method + ' ' + request.path)

            return {
              assistantTexts: assistant.assistantTexts,
              cloudSyncCount: requests.length,
              cloudSyncMethods: requests.map((request) => request.method + ' ' + request.path),
              cloudSyncMutationCount: cloudSyncMutationMethods.length,
              cloudSyncMutationMethods,
              errorCount: errorMessages.length,
              errorText: errorMessages.join('\\n'),
              headWritten: Boolean(store.head),
              manualRetryRequests: window.__zeroChatManualRetrySmokeRequestCount ?? 0,
              retryButtonAria: retryButton?.getAttribute('aria-label') ?? '',
              retryButtonText: retryButton ? (retryButton.textContent || '').replace(/\\s+/g, ' ').trim() : '',
              retryButtonVisible: Boolean(retryButton),
              streaming: assistant,
            }
          },
          resetCloudSyncRequests() {
            window.__zeroChatCloudSyncRequests = []
            window.__zeroChatCloudSyncStore = {
              generation: '00000000-0000-4000-8000-000000000001',
              head: null,
              objects: {},
            }
            return this.cloudSyncRequestState()
          },
          resetCloudSyncRequestLog() {
            window.__zeroChatCloudSyncRequests = []
            return this.cloudSyncRequestState()
          },
          cloudSyncRequestState() {
            const requests = window.__zeroChatCloudSyncRequests ?? []
            const store = window.__zeroChatCloudSyncStore ?? { head: null, objects: {} }

            return {
              count: requests.length,
              headWritten: Boolean(store.head),
              methods: requests.map((request) => request.method + ' ' + request.path),
              objectCount: Object.keys(store.objects ?? {}).length,
              objectPutCount: requests.filter(
                (request) =>
                  request.method === 'PUT' && request.path.startsWith('/sync/object/'),
              ).length,
              putCount: requests.filter((request) => request.method === 'PUT').length,
              snapshotReadCount: requests.filter(
                (request) => request.method === 'GET' && request.path === '/snapshot',
              ).length,
              streaming: this.assistantTextState(),
            }
          },
          async waitForCloudSyncRequests(minCount = 1) {
            for (let attempt = 0; attempt < 160; attempt += 1) {
              const state = this.cloudSyncRequestState()
              if (state.count >= minCount && state.putCount > 0 && state.headWritten) {
                return state
              }
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            throw new Error(
              'Cloudflare sync smoke requests did not appear after streaming completed: ' +
                JSON.stringify(this.cloudSyncRequestState()),
            )
          },
          async waitForCloudSyncQuiet(minCount = 1) {
            let lastCount = -1
            let stableTicks = 0

            for (let attempt = 0; attempt < 200; attempt += 1) {
              const state = this.cloudSyncRequestState()
              const completeEnough =
                state.count >= minCount && state.putCount > 0 && state.headWritten

              if (completeEnough && state.count === lastCount) {
                stableTicks += 1
                if (stableTicks >= 4) {
                  return state
                }
              } else {
                stableTicks = 0
                lastCount = state.count
              }

              await new Promise((resolve) => setTimeout(resolve, 50))
            }

            throw new Error(
              'Cloudflare sync smoke requests did not settle: ' +
                JSON.stringify(this.cloudSyncRequestState()),
            )
          },
          stopGenerating() {
            const button = document.querySelector('.send-button')
            if (!button || button.getAttribute('type') !== 'button') {
              throw new Error(
                'Stop button is not available during streaming: ' +
                  JSON.stringify(this.assistantTextState()),
              )
            }
            button.click()
            return this.assistantTextState()
          },
          async startManualRetrySmoke() {
            await this.waitForComposerIdle()
            this.setComposerDraft('Manual retry smoke')
            await this.waitForReadyToSend()
            document.querySelector('.send-button')?.click()
            return this.generationRetryState()
          },
          async waitForManualRetryInFlight() {
            for (let attempt = 0; attempt < 120; attempt += 1) {
              const state = this.generationRetryState()

              if (
                state.manualRetryRequests > 0 &&
                state.manualRetryRequests < 4 &&
                state.errorCount === 0
              ) {
                return state
              }

              await new Promise((resolve) => setTimeout(resolve, 50))
            }

            throw new Error(
              'Manual retry smoke did not expose an in-flight retry window: ' +
                JSON.stringify(this.generationRetryState()),
            )
          },
          async waitForManualRetryError() {
            for (let attempt = 0; attempt < 200; attempt += 1) {
              const state = this.generationRetryState()

              if (
                state.errorCount > 0 &&
                state.retryButtonVisible &&
                state.manualRetryRequests === 4
              ) {
                return state
              }

              await new Promise((resolve) => setTimeout(resolve, 50))
            }

            throw new Error(
              'Manual retry error state did not appear in sync smoke: ' +
                JSON.stringify(this.generationRetryState()),
            )
          },
          async clickManualRetryButton() {
            const retryButton = document.querySelector('[data-message-retry-action="true"]')
            if (!retryButton) {
              throw new Error(
                'Missing manual retry button in sync smoke: ' +
                  JSON.stringify(this.generationRetryState()),
              )
            }

            retryButton.click()

            for (let attempt = 0; attempt < 200; attempt += 1) {
              const state = this.generationRetryState()

              if (
                state.manualRetryRequests >= 5 &&
                state.errorCount === 0 &&
                state.assistantTexts.some((text) =>
                  text.includes('Manual retry smoke recovered'),
                )
              ) {
                return state
              }

              await new Promise((resolve) => setTimeout(resolve, 50))
            }

            throw new Error(
              'Manual retry did not recover the failed assistant turn in sync smoke: ' +
                JSON.stringify(this.generationRetryState()),
            )
          },
          async waitForAssistantText(text) {
            for (let attempt = 0; attempt < 160; attempt += 1) {
              const state = this.assistantTextState()
              if (state.assistantTexts.some((item) => item.includes(text))) return state
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            throw new Error(
              'Assistant text did not appear: ' +
                text +
                '; state=' +
                JSON.stringify(this.assistantTextState()),
            )
          },
          async startStreamingTokenSmoke() {
            await this.waitForComposerIdle()
            this.setComposerDraft('Streaming token smoke')
            await this.waitForReadyToSend()
            document.querySelector('.send-button')?.click()
            return this.assistantTextState()
          },
        }
      })()
    `
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: streamingSyncHelperSource,
    })
    await evaluate(streamingSyncHelperSource, true)
    const cloudSyncEndpoint = `http://127.0.0.1:${streamingSmokePort}`
    await evaluate(
      `window.__zeroChatStreamingSyncSmoke.installStreamingAutoSyncFixture(${JSON.stringify(cloudSyncEndpoint)})`,
      true,
    )
    const streamingSyncReloadStart = cdp.events.length
    await cdp.send('Page.reload', { ignoreCache: true })
    await waitForPageLoadCompletion(streamingSyncReloadStart)
    await evaluate(`window.__zeroChatStreamingSyncSmoke.waitForDocumentLanguage('zh-CN', 'ltr')`, true)
    await evaluate(`window.__zeroChatStreamingSyncSmoke.waitForComposerIdle()`, true)
    const streamingSyncBaseline = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.resetCloudSyncRequests()`,
      true,
    )
    assert.equal(
      streamingSyncBaseline.count,
      0,
      `Cloudflare sync smoke baseline should start without pending Worker calls (${JSON.stringify(streamingSyncBaseline)})`,
    )
    await evaluate(`window.__zeroChatStreamingSyncSmoke.startStreamingTokenSmoke()`, true)
    let streamingSyncTypingState = null
    let streamingSyncPartialState = null
    const streamingSyncObservations = []

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const state = await evaluate(`window.__zeroChatStreamingSyncSmoke.cloudSyncRequestState()`)
      const latestAssistantText = state.streaming.lastAssistantText ?? ''
      const hasPartial = latestAssistantText.includes('Streaming token smoke: first')
      const hasFinal = latestAssistantText.includes('Streaming token smoke: first second')

      if (attempt % 10 === 0 || hasPartial || state.count > 0) {
        streamingSyncObservations.push(state)
      }

      if (
        !streamingSyncTypingState &&
        state.streaming.typingIndicatorCount > 0 &&
        state.streaming.streamingMessageCount === 1
      ) {
        streamingSyncTypingState = state
      }

      if (hasPartial && !hasFinal) {
        streamingSyncPartialState = state
        break
      }

      await sleep(50)
    }

    assert.equal(
      streamingSyncTypingState?.putCount,
      0,
      `Cloudflare auto-sync must not write while the assistant is only showing the pre-token typing state (${JSON.stringify({ streamingSyncTypingState, streamingSyncObservations })})`,
    )
    assert.equal(
      streamingSyncTypingState?.headWritten,
      false,
      `Cloudflare auto-sync must not write the sync head while the assistant is only showing the pre-token typing state (${JSON.stringify({ streamingSyncTypingState, streamingSyncObservations })})`,
    )
    assert.equal(
      streamingSyncPartialState?.putCount,
      0,
      `Cloudflare auto-sync must not upload a partial streaming assistant turn (${JSON.stringify({ streamingSyncPartialState, streamingSyncObservations })})`,
    )
    assert.equal(
      streamingSyncPartialState?.headWritten,
      false,
      `Cloudflare auto-sync must not write the sync head for a partial streaming assistant turn (${JSON.stringify({ streamingSyncPartialState, streamingSyncObservations })})`,
    )
    await evaluate(
      `window.__zeroChatStreamingSyncSmoke.waitForAssistantText('Streaming token smoke: first second')`,
      true,
    )
    await evaluate(`window.__zeroChatStreamingSyncSmoke.waitForComposerIdle()`, true)
    const streamingSyncFinalState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.waitForCloudSyncRequests(1)`,
      true,
    )
    assert.equal(
      streamingSyncFinalState.headWritten,
      true,
      `Cloudflare auto-sync must write the incremental head after the assistant turn reaches a terminal state (${JSON.stringify(streamingSyncFinalState)})`,
    )
    assert.ok(
      streamingSyncFinalState.objectPutCount > 0,
      `Cloudflare auto-sync must upload encrypted incremental objects only after streaming completes (${JSON.stringify(streamingSyncFinalState)})`,
    )
    assert.ok(
      streamingSyncFinalState.methods.some((method) => method === 'GET /sync/head') &&
        streamingSyncFinalState.methods.some((method) => method === 'PUT /sync/head'),
      `Cloudflare auto-sync smoke should exercise the real incremental Worker protocol (${JSON.stringify(streamingSyncFinalState)})`,
    )

    await evaluate(
      `window.__zeroChatStreamingSyncSmoke.installStreamingAutoSyncFixture(${JSON.stringify(cloudSyncEndpoint)})`,
      true,
    )
    const streamingStopReloadStart = cdp.events.length
    await cdp.send('Page.reload', { ignoreCache: true })
    await waitForPageLoadCompletion(streamingStopReloadStart)
    await evaluate(`window.__zeroChatStreamingSyncSmoke.waitForDocumentLanguage('zh-CN', 'ltr')`, true)
    await evaluate(`window.__zeroChatStreamingSyncSmoke.waitForComposerIdle()`, true)
    const streamingStopBaseline = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.resetCloudSyncRequests()`,
      true,
    )
    assert.equal(
      streamingStopBaseline.count,
      0,
      `Cloudflare stop smoke baseline should start without pending Worker calls (${JSON.stringify(streamingStopBaseline)})`,
    )
    await evaluate(`window.__zeroChatStreamingSyncSmoke.startStreamingTokenSmoke()`, true)
    let streamingStopPartialState = null
    const streamingStopObservations = []

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const state = await evaluate(`window.__zeroChatStreamingSyncSmoke.cloudSyncRequestState()`)
      const latestAssistantText = state.streaming.lastAssistantText ?? ''
      const hasPartial = latestAssistantText.includes('Streaming token smoke: first')
      const hasFinal = latestAssistantText.includes('Streaming token smoke: first second')

      if (attempt % 10 === 0 || hasPartial || state.count > 0) {
        streamingStopObservations.push(state)
      }

      if (hasPartial && !hasFinal) {
        streamingStopPartialState = state
        break
      }

      await sleep(50)
    }

    assert.equal(
      streamingStopPartialState?.count,
      0,
      `Cloudflare auto-sync must stay silent before the user stops a partial stream (${JSON.stringify({ streamingStopPartialState, streamingStopObservations })})`,
    )
    assert.equal(
      streamingStopPartialState?.streaming.sendButtonType,
      'button',
      `the streaming composer should expose Stop before the abort smoke clicks it (${JSON.stringify(streamingStopPartialState)})`,
    )
    await evaluate(`window.__zeroChatStreamingSyncSmoke.stopGenerating()`, true)
    await evaluate(`window.__zeroChatStreamingSyncSmoke.waitForComposerIdle()`, true)
    const streamingStopFinalState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.waitForCloudSyncRequests(1)`,
      true,
    )
    const streamingStopFinalText = streamingStopFinalState.streaming.lastAssistantText ?? ''
    assert.ok(
      streamingStopFinalText.includes('Streaming token smoke: first') &&
        !streamingStopFinalText.includes('Streaming token smoke: first second'),
      `stopping generation should preserve the partial assistant text instead of replacing it with generic copy (${JSON.stringify(streamingStopFinalState)})`,
    )
    assert.equal(
      streamingStopFinalText.includes('Streaming token smoke: first second'),
      false,
      `stopping generation should abort the later SSE token before it renders (${JSON.stringify(streamingStopFinalState)})`,
    )
    assert.ok(
      streamingStopFinalState.objectPutCount > 0 && streamingStopFinalState.headWritten,
      `Cloudflare auto-sync must upload the stopped terminal turn only after Stop resolves (${JSON.stringify(streamingStopFinalState)})`,
    )

    await evaluate(
      `window.__zeroChatStreamingSyncSmoke.installStreamingAutoSyncFixture(${JSON.stringify(cloudSyncEndpoint)})`,
      true,
    )
    const failedTerminalReloadStart = cdp.events.length
    await cdp.send('Page.reload', { ignoreCache: true })
    await waitForPageLoadCompletion(failedTerminalReloadStart)
    await evaluate(`window.__zeroChatStreamingSyncSmoke.waitForDocumentLanguage('zh-CN', 'ltr')`, true)
    await evaluate(`window.__zeroChatStreamingSyncSmoke.waitForComposerIdle()`, true)
    const failedTerminalBaseline = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.resetCloudSyncRequests()`,
      true,
    )
    assert.equal(
      failedTerminalBaseline.count,
      0,
      `Cloudflare failed-terminal smoke baseline should start without pending Worker calls (${JSON.stringify(failedTerminalBaseline)})`,
    )
    await evaluate(`window.__zeroChatStreamingSyncSmoke.startManualRetrySmoke()`, true)
    const failedRetryInFlightState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.waitForManualRetryInFlight()`,
      true,
    )
    assert.equal(
      failedRetryInFlightState.cloudSyncMutationCount,
      0,
      `Cloudflare auto-sync must not upload a failed turn while automatic retries are still in flight (${JSON.stringify(failedRetryInFlightState)})`,
    )
    assert.equal(
      failedRetryInFlightState.headWritten,
      false,
      `Cloudflare auto-sync must not write the sync head while automatic retries are still in flight (${JSON.stringify(failedRetryInFlightState)})`,
    )
    const failedRetryErrorState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.waitForManualRetryError()`,
      true,
    )
    assert.equal(
      failedRetryErrorState.manualRetryRequests,
      4,
      `Cloudflare failed-terminal smoke should exhaust the three automatic retries before syncing assertions continue (${JSON.stringify(failedRetryErrorState)})`,
    )
    assert.equal(
      failedRetryErrorState.retryButtonVisible,
      true,
      `Cloudflare failed terminal turn should expose a visible retry action before syncing assertions continue (${JSON.stringify(failedRetryErrorState)})`,
    )
    assert.ok(
      !/\\b503\\b|upstream|ERR_|stack/i.test(failedRetryErrorState.errorText),
      `Failed terminal sync smoke should hide raw provider details (${JSON.stringify(failedRetryErrorState)})`,
    )
    const failedTerminalSyncState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.waitForCloudSyncQuiet(1)`,
      true,
    )
    assert.ok(
      failedTerminalSyncState.objectPutCount > 0 && failedTerminalSyncState.headWritten,
      `Cloudflare auto-sync must upload the failed terminal turn only after retry exhaustion (${JSON.stringify(failedTerminalSyncState)})`,
    )
    assert.ok(
      failedTerminalSyncState.streaming.assistantTexts.some((text) =>
        text.includes('服务商暂时不可用') || text.includes('暂时不可用'),
      ),
      `Cloudflare failed-terminal sync should persist friendly localized error copy in the visible assistant turn (${JSON.stringify(failedTerminalSyncState)})`,
    )
    const manualRetrySyncBaseline = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.resetCloudSyncRequestLog()`,
      true,
    )
    assert.equal(
      manualRetrySyncBaseline.count,
      0,
      `Cloudflare manual retry sync baseline should clear only the request log after the failed turn is synced (${JSON.stringify(manualRetrySyncBaseline)})`,
    )
    const failedManualRetryRecoveredState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.clickManualRetryButton()`,
      true,
    )
    assert.ok(
      failedManualRetryRecoveredState.assistantTexts.some((text) =>
        text.includes('Manual retry smoke recovered'),
      ),
      `Cloudflare failed-terminal smoke should recover through the visible retry action (${JSON.stringify(failedManualRetryRecoveredState)})`,
    )
    await evaluate(`window.__zeroChatStreamingSyncSmoke.waitForComposerIdle()`, true)
    const manualRetryTerminalSyncState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.waitForCloudSyncQuiet(1)`,
      true,
    )
    assert.ok(
      manualRetryTerminalSyncState.objectPutCount > 0 &&
        manualRetryTerminalSyncState.headWritten,
      `Cloudflare auto-sync should upload the manually retried success only after the retry succeeds (${JSON.stringify(manualRetryTerminalSyncState)})`,
    )
    assert.ok(
      manualRetryTerminalSyncState.streaming.assistantTexts.some((text) =>
        text.includes('Manual retry smoke recovered'),
      ),
      `Cloudflare manual retry terminal sync should persist the recovered assistant turn (${JSON.stringify(manualRetryTerminalSyncState)})`,
    )

    const resetGenerationStartState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.startResetGenerationOwnershipSmoke()`,
      true,
    )
    assert.equal(
      resetGenerationStartState.sendButtonType,
      'button',
      `local reset generation smoke must start from an active provider request (${JSON.stringify(resetGenerationStartState)})`,
    )
    const localResetDrainState = await evaluate(
      `window.__zeroChatLocalResetPreparePromise =
        window.__zeroChatStreamingSyncSmoke.prepareHeldLocalSaveAndConfirmReset()`,
      true,
    )
    assert.equal(
      localResetDrainState.busy &&
        localResetDrainState.inert &&
        !localResetDrainState.modalInert &&
        localResetDrainState.progressVisible &&
        localResetDrainState.progressFocused &&
        localResetDrainState.progressRole === 'status' &&
        localResetDrainState.progressLive === 'polite' &&
        !localResetDrainState.dangerOpen &&
        !localResetDrainState.successVisible,
      true,
      `local reset must stay pending without early success while an older AppData save is held (${JSON.stringify(localResetDrainState)})`,
    )
    const resetGenerationAbortState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.waitForResetGenerationAbort()`,
      true,
    )
    assert.equal(
      resetGenerationAbortState.busy &&
        resetGenerationAbortState.inert &&
        resetGenerationAbortState.progressFocused &&
        !resetGenerationAbortState.successVisible,
      true,
      `local reset must stay pending after abort until the active generation task exits (${JSON.stringify(resetGenerationAbortState)})`,
    )
    await evaluate(`window.__zeroChatStreamingSyncSmoke.releaseLocalEncryption()`)
    await sleep(150)
    const localResetGenerationHeldState = await evaluate(
      `window.__zeroChatStreamingSyncSmoke.localResetPersistenceDrainState()`,
    )
    assert.equal(
      localResetGenerationHeldState.busy &&
        localResetGenerationHeldState.inert &&
        localResetGenerationHeldState.progressFocused &&
        !localResetGenerationHeldState.successVisible,
      true,
      `releasing stale persistence alone must not let reset pass while generation cleanup is still held (${JSON.stringify(localResetGenerationHeldState)})`,
    )
    await evaluate(`window.__zeroChatStreamingSyncSmoke.releaseResetGeneration()`)
    const localResetCompleteState = await evaluate(
      `window.__zeroChatLocalResetCompletePromise =
        window.__zeroChatStreamingSyncSmoke.waitForLocalResetComplete()`,
      true,
    )
    assert.equal(
      !localResetCompleteState.busy &&
        !localResetCompleteState.inert &&
        !localResetCompleteState.progressVisible &&
        localResetCompleteState.activeDataAction === 'reset-local' &&
        localResetCompleteState.successVisible,
      true,
      `local reset must report success only after stale persistence drains (${JSON.stringify(localResetCompleteState)})`,
    )
    await sleep(400)
    const localResetReloadStart = cdp.events.length
    await cdp.send('Page.navigate', { url: appUrl })
    await waitForPageLoadCompletion(localResetReloadStart)
    const localResetReloadState = await evaluate(
      `new Promise((resolve, reject) => {
        const started = Date.now()
        const check = () => {
          const text = (document.body.textContent || '').replace(/\s+/g, ' ').trim()
          const guide = document.querySelector('.guide-modal')
          const compact = document.documentElement.dataset.compact ?? ''
          if (guide && compact === 'false') {
            resolve({ compact, guideOpen: true, text: text.slice(0, 300) })
            return
          }
          if (Date.now() - started > 12000) {
            reject(new Error('Fresh local-reset state did not survive reload: ' + text.slice(0, 400)))
            return
          }
          setTimeout(check, 50)
        }
        check()
      })`,
      true,
    )
    assert.equal(
      localResetReloadState.guideOpen && localResetReloadState.compact === 'false',
      true,
      `local reset must persist the fresh first-run snapshot instead of resurrecting the held compact snapshot (${JSON.stringify(localResetReloadState)})`,
    )

    const providerlessSnapshotPageStart = cdp.events.length
    await cdp.send('Page.navigate', { url: new URL('favicon.svg', appUrl).href })
    await waitForPageLoadCompletion(providerlessSnapshotPageStart)
    await evaluate(
      `new Promise((resolve, reject) => {
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
          const snapshot = {
            version: 1,
            providers: [],
            conversations: [],
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
              theme: 'system',
              language: 'zh-CN',
              compactMode: false,
              dismissedDangerWarnings: [],
              dismissedFeatureHints: [],
            },
            updatedAt: Date.now(),
          }
          tx.objectStore('documents').put(snapshot, 'app')
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
      })`,
      true,
    )
    const providerlessReloadStart = cdp.events.length
    await cdp.send('Page.navigate', { url: appUrl })
    await waitForPageLoadCompletion(providerlessReloadStart)
    const providerlessState = await evaluate(
      `new Promise((resolve, reject) => {
        const started = Date.now()
        const check = () => {
          const text = (document.body.textContent || '').replace(/\\s+/g, ' ').trim()
          const button = document.querySelector('[data-add-first-provider="true"]')
          const ready =
            document.documentElement.lang === 'zh-CN' &&
            text.includes('添加你的第一个 AI 服务') &&
            button

          if (ready) {
            const isVisible = (element) => {
              const rect = element.getBoundingClientRect()
              const style = window.getComputedStyle(element)
              return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
            }
            const visibleLoading = Array.from(document.querySelectorAll('.empty-state p, .initial-state p'))
              .some((element) =>
                isVisible(element) &&
                /Loading|加载|Chargement|読み込み|로딩/.test(element.textContent || '')
              )

            resolve({
              lang: document.documentElement.lang,
              text: text.slice(0, 400),
              buttonText: button.textContent?.trim() ?? '',
              loadingVisible: visibleLoading,
            })
            return
          }

          if (Date.now() - started > 12000) {
            reject(new Error('Providerless empty state did not appear: ' + text.slice(0, 400)))
            return
          }

          setTimeout(check, 50)
        }
        check()
      })`,
      true,
    )
    assert.equal(
      providerlessState.loadingVisible,
      false,
      `providerless snapshot should show the first-provider empty state instead of loading (${JSON.stringify(providerlessState)})`,
    )
    const firstProviderRecoveryState = await evaluate(
      `new Promise((resolve, reject) => {
        document.querySelector('[data-add-first-provider="true"]')?.click()
        const started = Date.now()
        const check = () => {
          const modal = document.querySelector('.settings-modal')
          const providerRows = document.querySelectorAll('.provider-list-row').length
          const keyField = document.querySelector('[data-provider-api-key-field="true"] input')
          const text = (document.body.textContent || '').replace(/\\s+/g, ' ').trim()

          if (modal && providerRows > 0 && keyField) {
            resolve({
              providerRows,
              hasSettings: true,
              hasKeyField: true,
              text: text.slice(0, 400),
            })
            return
          }

          if (Date.now() - started > 12000) {
            reject(new Error('First-provider recovery did not open settings: ' + text.slice(0, 400)))
            return
          }

          setTimeout(check, 50)
        }
        check()
      })`,
      true,
    )
    assert.equal(
      firstProviderRecoveryState.hasSettings &&
        firstProviderRecoveryState.hasKeyField &&
        firstProviderRecoveryState.providerRows > 0,
      true,
      `first-provider empty state action should add a provider and focus the user on provider setup (${JSON.stringify(firstProviderRecoveryState)})`,
    )

    const concurrentSecretFixtureState = await evaluate(
      `new Promise((resolve, reject) => {
        const input = document.querySelector('[data-provider-api-key-field="true"] input')
        const providerId = input?.id?.startsWith('provider:')
          ? input.id.slice('provider:'.length)
          : ''

        if (!providerId) {
          reject(new Error('Missing selected Provider id for concurrent secret smoke.'))
          return
        }

        const request = indexedDB.open('zerochat-secrets')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('records', 'readwrite')
          const store = tx.objectStore('records')
          const targetKey = 'secret:provider:' + providerId
          const revisionRequest = store.get('meta:revision')
          const recordRequest = store.get(targetKey)
          const winnerRevision = 'browser-secret-winner-' + crypto.randomUUID()
          const winnerRecord = {
            kind: 'zerochat.browserSecretWinner',
            version: 1,
            marker: winnerRevision,
          }
          let pendingReads = 2
          let originalRevision
          let originalRecord

          const installWinner = () => {
            pendingReads -= 1
            if (pendingReads !== 0) return

            window.__zeroChatConcurrentSecretOriginalRevision = originalRevision
            window.__zeroChatConcurrentSecretOriginalRecord = originalRecord
            window.__zeroChatConcurrentSecretProviderId = providerId
            window.__zeroChatConcurrentSecretWinnerRevision = winnerRevision
            store.put(winnerRecord, targetKey)
            store.put(winnerRevision, 'meta:revision')
          }

          revisionRequest.onsuccess = () => {
            originalRevision = revisionRequest.result
            installWinner()
          }
          revisionRequest.onerror = () => reject(revisionRequest.error ?? tx.error)
          recordRequest.onsuccess = () => {
            originalRecord = recordRequest.result
            installWinner()
          }
          recordRequest.onerror = () => reject(recordRequest.error ?? tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve({
              providerId,
              originalRevision: originalRevision ?? null,
              winnerRevision,
            })
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
      })`,
      true,
    )
    assert.notEqual(
      concurrentSecretFixtureState.winnerRevision,
      concurrentSecretFixtureState.originalRevision,
      `concurrent secret smoke must install a distinct winner revision (${JSON.stringify(concurrentSecretFixtureState)})`,
    )
    await evaluate(
      `(() => {
        const input = document.querySelector(
          '[data-provider-api-key-field="true"] input',
        )
        if (!input) throw new Error('Missing Provider key input for stale secret smoke')
        input.focus()
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          input,
          'zerochat-stale-browser-secret',
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.blur()
        return true
      })()`,
    )
    const concurrentSecretConflictState = await evaluate(
      `new Promise((resolve, reject) => {
        const started = Date.now()
        const check = () => {
          const request = indexedDB.open('zerochat-secrets')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('records', 'readonly')
            const store = tx.objectStore('records')
            const targetKey =
              'secret:provider:' + window.__zeroChatConcurrentSecretProviderId
            const revisionRequest = store.get('meta:revision')
            const recordRequest = store.get(targetKey)
            let pendingReads = 2
            let revision
            let record

            const inspect = () => {
              pendingReads -= 1
              if (pendingReads !== 0) return

              db.close()
              const conflictVisible = (document.body.textContent || '').includes(
                '本机数据已在另一个标签页或窗口中更改，请重新加载后再保存。',
              )
              const input = document.querySelector(
                '[data-provider-api-key-field="true"] input',
              )
              const winnerPreserved =
                revision === window.__zeroChatConcurrentSecretWinnerRevision &&
                record?.kind === 'zerochat.browserSecretWinner' &&
                record?.marker === window.__zeroChatConcurrentSecretWinnerRevision

              if (conflictVisible && winnerPreserved && input?.value === '') {
                resolve({
                  conflictVisible,
                  inputValue: input.value,
                  revision,
                  winnerPreserved,
                })
                return
              }

              if (Date.now() - started > 12000) {
                reject(new Error(
                  'Stale Provider secret write did not preserve the browser winner.',
                ))
                return
              }

              setTimeout(check, 80)
            }

            revisionRequest.onsuccess = () => {
              revision = revisionRequest.result
              inspect()
            }
            revisionRequest.onerror = () => reject(revisionRequest.error ?? tx.error)
            recordRequest.onsuccess = () => {
              record = recordRequest.result
              inspect()
            }
            recordRequest.onerror = () => reject(recordRequest.error ?? tx.error)
          }
        }
        check()
      })`,
      true,
    )
    assert.equal(
      concurrentSecretConflictState.conflictVisible &&
        concurrentSecretConflictState.winnerPreserved &&
        concurrentSecretConflictState.revision ===
          concurrentSecretFixtureState.winnerRevision,
      true,
      `stale Provider secret writes must surface a localized conflict without replacing the IndexedDB winner (${JSON.stringify(concurrentSecretConflictState)})`,
    )
    await evaluate(
      `new Promise((resolve, reject) => {
        const request = indexedDB.open('zerochat-secrets')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('records', 'readwrite')
          const store = tx.objectStore('records')
          const targetKey =
            'secret:provider:' + window.__zeroChatConcurrentSecretProviderId
          const originalRecord = window.__zeroChatConcurrentSecretOriginalRecord
          const originalRevision =
            window.__zeroChatConcurrentSecretOriginalRevision

          if (originalRecord === undefined) {
            store.delete(targetKey)
          } else {
            store.put(originalRecord, targetKey)
          }
          if (originalRevision === undefined) {
            store.delete('meta:revision')
          } else {
            store.put(originalRevision, 'meta:revision')
          }

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
      })`,
      true,
    )
    await evaluate(
      `(() => {
        const input = document.querySelector(
          '[data-provider-api-key-field="true"] input',
        )
        if (!input) throw new Error('Missing Provider key input for secret recovery smoke')
        input.focus()
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          input,
          'zerochat-recovered-browser-secret',
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.blur()
        return true
      })()`,
    )
    const concurrentSecretRecoveryState = await evaluate(
      `new Promise((resolve, reject) => {
        const started = Date.now()
        const check = () => {
          const request = indexedDB.open('zerochat-secrets')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('records', 'readonly')
            const store = tx.objectStore('records')
            const targetKey =
              'secret:provider:' + window.__zeroChatConcurrentSecretProviderId
            const revisionRequest = store.get('meta:revision')
            const recordRequest = store.get(targetKey)
            let pendingReads = 2
            let revision
            let record

            const inspect = () => {
              pendingReads -= 1
              if (pendingReads !== 0) return

              db.close()
              const input = document.querySelector(
                '[data-provider-api-key-field="true"] input',
              )
              const recovered =
                typeof revision === 'string' &&
                revision !== window.__zeroChatConcurrentSecretWinnerRevision &&
                record?.kind === 'zerochat.localEncrypted' &&
                input?.value === 'zerochat-recovered-browser-secret'

              if (recovered) {
                resolve({ recovered, revision, recordKind: record.kind })
                return
              }

              if (Date.now() - started > 12000) {
                reject(new Error(
                  'Provider secret mutation queue did not recover after restoring its expected revision.',
                ))
                return
              }

              setTimeout(check, 80)
            }

            revisionRequest.onsuccess = () => {
              revision = revisionRequest.result
              inspect()
            }
            revisionRequest.onerror = () => reject(revisionRequest.error ?? tx.error)
            recordRequest.onsuccess = () => {
              record = recordRequest.result
              inspect()
            }
            recordRequest.onerror = () => reject(recordRequest.error ?? tx.error)
          }
        }
        check()
      })`,
      true,
    )
    assert.equal(
      concurrentSecretRecoveryState.recovered,
      true,
      `Provider secret mutation queue should recover after the expected revision is restored (${JSON.stringify(concurrentSecretRecoveryState)})`,
    )

    const concurrentWriteFixtureState = await evaluate(
      `new Promise(async (resolve, reject) => {
        const readAppRecord = () => new Promise((readResolve, readReject) => {
          const request = indexedDB.open('zerochat')
          request.onerror = () => readReject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('documents', 'readonly')
            const getRequest = tx.objectStore('documents').get('app')
            getRequest.onsuccess = () => readResolve(getRequest.result ?? null)
            getRequest.onerror = () => readReject(getRequest.error ?? tx.error)
            tx.oncomplete = () => db.close()
            tx.onerror = () => {
              db.close()
              readReject(tx.error)
            }
            tx.onabort = () => {
              db.close()
              readReject(tx.error)
            }
          }
        })
        const writeAppRecord = (value) => new Promise((writeResolve, writeReject) => {
          const request = indexedDB.open('zerochat')
          request.onerror = () => writeReject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('documents', 'readwrite')
            tx.objectStore('documents').put(value, 'app')
            tx.oncomplete = () => {
              db.close()
              writeResolve()
            }
            tx.onerror = () => {
              db.close()
              writeReject(tx.error)
            }
            tx.onabort = () => {
              db.close()
              writeReject(tx.error)
            }
          }
        })
        const readLocalCryptoKey = () => new Promise((readResolve, readReject) => {
          const request = indexedDB.open('zerochat-local-crypto')
          request.onerror = () => readReject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('keys', 'readonly')
            const getRequest = tx.objectStore('keys').get('local-aes-gcm-v1')
            getRequest.onsuccess = () => readResolve(getRequest.result)
            getRequest.onerror = () => readReject(getRequest.error ?? tx.error)
            tx.oncomplete = () => db.close()
            tx.onerror = () => {
              db.close()
              readReject(tx.error)
            }
            tx.onabort = () => {
              db.close()
              readReject(tx.error)
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

        try {
          let previous = await readAppRecord()
          let stableReads = 0
          const started = Date.now()

          while (stableReads < 3) {
            await new Promise((waitResolve) => setTimeout(waitResolve, 120))
            const current = await readAppRecord()

            if (
              current?.kind === 'zerochat.localEncrypted' &&
              previous?.kind === 'zerochat.localEncrypted' &&
              current.iv === previous.iv
            ) {
              stableReads += 1
            } else {
              stableReads = 0
            }
            previous = current

            if (Date.now() - started > 12000) {
              throw new Error('AppData record did not become stable before concurrent-write smoke.')
            }
          }

          const original = previous
          const key = await readLocalCryptoKey()
          if (!key) throw new Error('Missing local AppData encryption key.')
          const aad = base64ToBytes(original.aad)
          const decrypted = await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: base64ToBytes(original.iv),
              additionalData: aad,
              tagLength: 128,
            },
            key,
            base64ToBytes(original.payload),
          )
          const competingData = JSON.parse(new TextDecoder().decode(decrypted))
          const competingCompactMode = !Boolean(competingData.preferences?.compactMode)
          competingData.preferences = {
            ...competingData.preferences,
            compactMode: competingCompactMode,
          }
          competingData.updatedAt = Math.max(
            Date.now(),
            Number(competingData.updatedAt || 0) + 1,
          )
          const competingIv = crypto.getRandomValues(new Uint8Array(12))
          const encrypted = await crypto.subtle.encrypt(
            {
              name: 'AES-GCM',
              iv: competingIv,
              additionalData: aad,
              tagLength: 128,
            },
            key,
            new TextEncoder().encode(JSON.stringify(competingData)),
          )
          const competing = {
            ...original,
            iv: bytesToBase64(competingIv),
            payload: bytesToBase64(new Uint8Array(encrypted)),
          }

          window.__zeroChatConcurrentWriteOriginal = original
          window.__zeroChatConcurrentWriteCompetingIv = competing.iv
          window.__zeroChatConcurrentWriteRemoteCompactMode = competingCompactMode
          await writeAppRecord(competing)
          resolve({
            competingCompactMode,
            competingIv: competing.iv,
            originalIv: original.iv,
            stableReads,
          })
        } catch (error) {
          reject(error)
        }
      })`,
      true,
    )
    assert.notEqual(
      concurrentWriteFixtureState.competingIv,
      concurrentWriteFixtureState.originalIv,
      `concurrent-write smoke must install a distinct competing AppData revision (${JSON.stringify(concurrentWriteFixtureState)})`,
    )
    await evaluate(
      `(() => {
        const tab = document.querySelector('#settings-tab-appearance')
        if (!tab) throw new Error('Missing appearance settings tab')
        tab.click()
        return true
      })()`,
    )
    await evaluate(
      `(() => {
        const select = Array.from(document.querySelectorAll('select')).find((item) => {
          const values = Array.from(item.options).map((option) => option.value)
          return values.includes('system') && values.includes('light') && values.includes('dark')
        })
        if (!select) throw new Error('Missing theme select for concurrent-write smoke')
        select.value = 'dark'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`,
    )
    const concurrentWriteMergeState = await evaluate(
      `new Promise((resolve, reject) => {
        const base64ToBytes = (value) => {
          const binary = atob(value)
          return Uint8Array.from(binary, (character) => character.charCodeAt(0))
        }
        const readKey = () => new Promise((keyResolve, keyReject) => {
          const request = indexedDB.open('zerochat-local-crypto')
          request.onerror = () => keyReject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('keys', 'readonly')
            const getRequest = tx.objectStore('keys').get('local-aes-gcm-v1')
            getRequest.onsuccess = () => keyResolve(getRequest.result)
            getRequest.onerror = () => keyReject(getRequest.error ?? tx.error)
            tx.oncomplete = () => db.close()
          }
        })
        const started = Date.now()
        const check = async () => {
          try {
            const record = await new Promise((recordResolve, recordReject) => {
              const request = indexedDB.open('zerochat')
              request.onerror = () => recordReject(request.error)
              request.onsuccess = () => {
                const db = request.result
                const tx = db.transaction('documents', 'readonly')
                const getRequest = tx.objectStore('documents').get('app')
                getRequest.onsuccess = () => recordResolve(getRequest.result ?? null)
                getRequest.onerror = () => recordReject(getRequest.error ?? tx.error)
                tx.oncomplete = () => db.close()
              }
            })
            if (
              record?.kind === 'zerochat.localEncrypted' &&
              record.iv !== window.__zeroChatConcurrentWriteOriginal.iv &&
              record.iv !== window.__zeroChatConcurrentWriteCompetingIv
            ) {
              const decrypted = await crypto.subtle.decrypt(
                {
                  name: 'AES-GCM',
                  iv: base64ToBytes(record.iv),
                  additionalData: base64ToBytes(record.aad),
                  tagLength: 128,
                },
                await readKey(),
                base64ToBytes(record.payload),
              )
              const data = JSON.parse(new TextDecoder().decode(decrypted))
              const state = {
                compactMode: data.preferences?.compactMode,
                conflictVisible: (document.body.textContent || '').includes(
                  '本机数据已在另一个标签页或窗口中更改，请重新加载后再保存。',
                ),
                currentIv: record.iv,
                theme: data.preferences?.theme,
              }
              if (
                state.theme === 'dark' &&
                state.compactMode === window.__zeroChatConcurrentWriteRemoteCompactMode
              ) {
                window.__zeroChatConcurrentWriteMergedIv = record.iv
                resolve(state)
                return
              }
            }
            if (Date.now() - started > 12000) {
              reject(new Error('Concurrent AppData changes were not merged into a durable snapshot.'))
              return
            }
            setTimeout(check, 80)
          } catch (error) {
            reject(error)
          }
        }
        check()
      })`,
      true,
    )
    assert.equal(
      concurrentWriteMergeState.theme === 'dark' &&
        concurrentWriteMergeState.compactMode ===
          concurrentWriteFixtureState.competingCompactMode &&
        concurrentWriteMergeState.conflictVisible === false,
      true,
      `concurrent AppData saves must merge disjoint remote and local edits without a stale-conflict notice (${JSON.stringify(concurrentWriteMergeState)})`,
    )
    await evaluate(
      `(() => {
        const select = Array.from(document.querySelectorAll('select')).find((item) => {
          const values = Array.from(item.options).map((option) => option.value)
          return values.includes('system') && values.includes('light') && values.includes('dark')
        })
        if (!select) throw new Error('Missing theme select during concurrent-write recovery')
        select.value = 'system'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`,
    )
    const concurrentWriteRecoveryState = await evaluate(
      `new Promise((resolve, reject) => {
        const base64ToBytes = (value) => {
          const binary = atob(value)
          return Uint8Array.from(binary, (character) => character.charCodeAt(0))
        }
        const readKey = () => new Promise((keyResolve, keyReject) => {
          const request = indexedDB.open('zerochat-local-crypto')
          request.onerror = () => keyReject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('keys', 'readonly')
            const getRequest = tx.objectStore('keys').get('local-aes-gcm-v1')
            getRequest.onsuccess = () => keyResolve(getRequest.result)
            getRequest.onerror = () => keyReject(getRequest.error ?? tx.error)
            tx.oncomplete = () => db.close()
          }
        })
        const started = Date.now()
        const check = () => {
          const request = indexedDB.open('zerochat')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('documents', 'readonly')
            const getRequest = tx.objectStore('documents').get('app')
            getRequest.onsuccess = async () => {
              const record = getRequest.result
              const currentIv = record?.iv ?? ''
              db.close()

              if (
                currentIv &&
                currentIv !== window.__zeroChatConcurrentWriteMergedIv
              ) {
                try {
                  const decrypted = await crypto.subtle.decrypt(
                    {
                      name: 'AES-GCM',
                      iv: base64ToBytes(record.iv),
                      additionalData: base64ToBytes(record.aad),
                      tagLength: 128,
                    },
                    await readKey(),
                    base64ToBytes(record.payload),
                  )
                  const data = JSON.parse(new TextDecoder().decode(decrypted))
                  if (
                    data.preferences?.theme === 'system' &&
                    data.preferences?.compactMode ===
                      window.__zeroChatConcurrentWriteRemoteCompactMode
                  ) {
                    resolve({
                      compactMode: data.preferences.compactMode,
                      currentIv,
                      recovered: true,
                      theme: data.preferences.theme,
                    })
                    return
                  }
                } catch (error) {
                  reject(error)
                  return
                }
              }

              if (Date.now() - started > 12000) {
                reject(new Error('Local save queue did not persist a follow-up edit after concurrent merge recovery.'))
                return
              }

              setTimeout(check, 80)
            }
            getRequest.onerror = () => {
              db.close()
              reject(getRequest.error ?? tx.error)
            }
          }
        }
        check()
      })`,
      true,
    )
    assert.equal(
      concurrentWriteRecoveryState.recovered,
      true,
      `local save queue should remain writable after automatic concurrent merge recovery (${JSON.stringify(concurrentWriteRecoveryState)})`,
    )

    for (const event of cdp.events) {
      if (event.method === 'Runtime.exceptionThrown') {
        const details = event.params.exceptionDetails
        errors.push(
          details.exception?.description ??
            details.exception?.value ??
            `${details.text} at ${details.url || '<anonymous>'}:${details.lineNumber + 1}:${details.columnNumber + 1}`,
        )
      }
      if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
        errors.push(event.params.entry.text)
      }
    }

    assert.deepEqual(errors, [], 'browser console should not report runtime errors')
    console.log('Browser skill smoke passed')
  } finally {
    cdp?.close()
  }
}

const smokeRun = main()
smokeRun.catch(() => undefined)

try {
  await waitForSmokeRun(smokeRun, browserSmokeTimeoutMs)
} catch (error) {
  console.error(`Browser skill smoke failure context: last CDP operation ${lastCdpOperation}`)
  throw error
} finally {
  await stopChildProcessTree(chrome)
  await devServer?.close()
  const profileRemoved = await removeBrowserProfileWithRetry(profileDir, 120)
  assert.ok(profileRemoved, `Browser skill smoke profile cleanup failed: ${profileDir}`)
}
