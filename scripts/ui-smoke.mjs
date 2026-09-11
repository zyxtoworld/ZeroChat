// ZeroChat frontend smoke: boots headless Chrome against the development server,
// fails on any console error/page error, and captures screenshots.
// Usage:
//   node scripts/ui-smoke.mjs [--url http://localhost:5173/]
// Chrome must be available via CHROME_PATH or a standard install location.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCdp, waitForHttp } from './browser-cdp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rawArgs = process.argv.slice(2)

function optionValue(name, fallback) {
  const prefixed = `${name}=`
  const inline = rawArgs.find((arg) => arg.startsWith(prefixed))
  if (inline) return inline.slice(prefixed.length)
  const index = rawArgs.indexOf(name)
  return index >= 0 ? rawArgs[index + 1] : fallback
}

const appUrl = optionValue('--url', 'http://localhost:5173/')
const testUrl = new URL(appUrl)
testUrl.searchParams.set('app-test', '1')
const reportDir = path.join(repoRoot, '.manual-qa', 'ui-smoke')
const reportSuffix = optionValue('--report-suffix', '')
const captureDir = reportSuffix ? path.join(reportDir, reportSuffix) : reportDir
const viewport = optionValue('--viewport', '1440,900')
const debugPort = Number(optionValue('--debug-port', '9333'))

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean)
  for (const candidate of candidates) {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [candidate], {
      encoding: 'utf8',
    })
    if (result.status === 0) return candidate
    // `where` fails for absolute paths that do not exist; check directly.
    try {
      spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 })
      return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

function fail(message) {
  console.error(`[ui-smoke] FAIL: ${message}`)
  process.exit(1)
}

const chromePath = findChrome()
if (!chromePath) {
  fail('Chrome not found. Set CHROME_PATH.')
}

await waitForHttp(appUrl, { timeoutMs: 10_000 }).catch(() => {
  fail(`Development server not reachable at ${appUrl}. Start it with: pnpm run dev`)
})

const profileDir = await mkdtemp(path.join(tmpdir(), 'zerochat-ui-smoke-'))
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${viewport}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)

const consoleErrors = []
const pageErrors = []

try {
  // Wait for the debugger endpoint.
  let version = null
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      version = await res.json()
      break
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!version) fail('Chrome DevTools endpoint never came up.')

  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) =>
    r.json(),
  )
  const page = targets.find((t) => t.type === 'page')
  if (!page) fail('No debuggable page target.')

  const cdp = await connectCdp(page.webSocketDebuggerUrl)
  const send = cdp.send.bind(cdp)
  const on = cdp.on.bind(cdp)

  on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      consoleErrors.push(
        (params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '),
      )
    }
  })
  on('Runtime.exceptionThrown', (params) => {
    pageErrors.push(
      params.exceptionDetails?.exception?.description ??
        params.exceptionDetails?.text ??
        'unknown exception',
    )
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: testUrl.href })
  await new Promise((r) => setTimeout(r, 4000))

  const evalJson = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          'evaluate failed',
      )
    }
    return result.result?.value
  }

  const capture = async (name) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const { mkdir } = await import('node:fs/promises')
    await mkdir(captureDir, { recursive: true })
    await writeFile(
      path.join(captureDir, `${name}.png`),
      Buffer.from(shot.data, 'base64'),
    )
  }

  const domState = await evalJson(`(() => {
    const root = document.getElementById('root')
    const text = document.body ? document.body.innerText.slice(0, 400) : ''
    return {
      hasRoot: Boolean(root),
      rootChildren: root ? root.children.length : 0,
      hasSidebar: Boolean(document.querySelector('.zc-sidebar')),
      hasMain: Boolean(document.querySelector('.zc-main')),
      hasOnboarding: Boolean(document.querySelector('.zc-empty-card')),
      bodyTextSample: text,
    }
  })()`)

  if (!domState.hasRoot || domState.rootChildren === 0) {
    fail('React app did not mount into #root.')
  }
  if (!domState.hasSidebar) {
    fail(`Sidebar missing. DOM state: ${JSON.stringify(domState)}`)
  }
  if (!domState.hasMain || !domState.hasOnboarding) {
    fail(`Main/onboarding missing. DOM state: ${JSON.stringify(domState)}`)
  }

  // Screenshot the initial onboarding view.
  await capture('app-onboarding')

  // Open settings and verify the provider editor renders.
  await evalJson(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const target = buttons.find((b) => (b.textContent ?? '').includes('添加提供商'))
    if (!target) throw new Error('add-provider button not found')
    target.click()
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  const settingsState = await evalJson(`(() => ({
    hasDialog: Boolean(document.querySelector('.zc-settings')),
    hasProviderCard: Boolean(document.querySelector('.zc-provider-card')),
  }))()`)
  if (!settingsState.hasDialog || !settingsState.hasProviderCard) {
    fail(`Settings dialog did not render: ${JSON.stringify(settingsState)}`)
  }
  await capture('app-settings')

  const settingsTabProbes = {
    models: '.zc-model-grid',
    skills: '.zc-skill-editor',
    sync: '.zc-segmented',
    general: '.zc-field select',
    data: '.zc-field input[type="password"]',
  }
  for (const [tab, selector] of Object.entries(settingsTabProbes)) {
    await evalJson(`(() => {
      const button = document.querySelector('#settings-tab-${tab}')
      if (!button) throw new Error('settings tab not found: ${tab}')
      button.click()
      return true
    })()`)
    await new Promise((r) => setTimeout(r, 180))
    const tabState = await evalJson(`(() => ({
      active: document.querySelector('#settings-tab-${tab}')?.classList.contains('active'),
      hasContent: Boolean(document.querySelector('${selector}')),
    }))()`)
    if (!tabState.active || !tabState.hasContent) {
      fail(`Settings ${tab} tab did not render: ${JSON.stringify(tabState)}`)
    }
    await capture(`app-settings-${tab}`)
  }

  // Close settings, start a chat, and send a message with no API key:
  // the composer must surface a localized error toast, not crash.
  await evalJson(`(() => {
    const close = document.querySelector('.zc-settings-body-header button')
    if (!close) throw new Error('settings close button not found')
    close.click()
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 400))
  await evalJson(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const start = buttons.find((b) => (b.textContent ?? '').includes('开始使用'))
    if (!start) throw new Error('start button not found')
    start.click()
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 600))
  const chatState = await evalJson(`(() => ({
    hasComposer: Boolean(document.querySelector('.zc-composer textarea')),
    hasHeader: Boolean(document.querySelector('.zc-chat-header')),
  }))()`)
  if (!chatState.hasComposer || !chatState.hasHeader) {
    fail(`Chat view did not render: ${JSON.stringify(chatState)}`)
  }
  const imageModeState = await evalJson(`(() => {
    const buttons = [...document.querySelectorAll('.zc-composer-mode button')]
    const image = buttons.find((button) => (button.textContent ?? '').includes('图片'))
    if (!image) throw new Error('image mode button not found')
    image.click()
    return true
  })()`)
  if (!imageModeState) fail('Image mode could not be selected')
  await new Promise((r) => setTimeout(r, 250))
  const imageComposerState = await evalJson(`(() => ({
    hasTaskModes: Boolean(document.querySelector('.zc-image-task-modes')),
    hasSourcePanel: Boolean(document.querySelector('.image-compose-panel')),
  }))()`)
  if (!imageComposerState.hasTaskModes || !imageComposerState.hasSourcePanel) {
    fail(`Image composer did not render: ${JSON.stringify(imageComposerState)}`)
  }
  await evalJson(`(() => {
    const chat = [...document.querySelectorAll('.zc-composer-mode button')]
      .find((button) => (button.textContent ?? '').includes('聊天'))
    if (!chat) throw new Error('chat mode button not found')
    chat.click()
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 250))
  // The send-click below intentionally fails (no API key) and opens the
  // settings dialog; close it before probing further.
  await evalJson(`(() => {
    const overlay = document.querySelector('.zc-settings-overlay')
    if (overlay) {
      const close = document.querySelector('.zc-settings-body-header button')
      if (close) close.click()
    }
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 300))
  const overlayGone = await evalJson(
    `!document.querySelector('.zc-settings-overlay')`,
  )
  if (!overlayGone) {
    await evalJson(`(() => {
      const bridge = window.__zerochatAppTest
      if (!bridge) throw new Error('app test bridge is not installed')
      bridge.closeSettings()
      return true
    })()`)
    await new Promise((r) => setTimeout(r, 300))
  }
  await evalJson(`(() => {
    const textarea = document.querySelector('.zc-composer textarea')
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value',
    ).set
    setter.call(textarea, '你好')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 200))
  await evalJson(`(() => {
    const send = document.querySelector('.zc-send-btn')
    if (!send) throw new Error('send button not found')
    send.click()
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 1200))
  const toastState = await evalJson(`(() => ({
    hasToast: Boolean(document.querySelector('.zc-toast')),
    toastText: document.querySelector('.zc-toast')?.textContent ?? '',
    hasUserMessage: [...document.querySelectorAll('.zc-msg')].length > 0,
  }))()`)
  if (!toastState.hasToast && !toastState.hasUserMessage) {
    fail(`Send flow produced neither toast nor message: ${JSON.stringify(toastState)}`)
  }
  if (toastState.hasToast) {
    const toastGeometry = await evalJson(`(() => {
      const toast = document.querySelector('.zc-toast')?.getBoundingClientRect()
      const composer = document.querySelector('.zc-composer')?.getBoundingClientRect()
      if (!toast || !composer) return { overlap: false }
      return {
        overlap: toast.bottom > composer.top && toast.top < composer.bottom,
        toastTop: Math.round(toast.top),
        toastBottom: Math.round(toast.bottom),
        composerTop: Math.round(composer.top),
        composerBottom: Math.round(composer.bottom),
      }
    })()`)
    if (toastGeometry.overlap) {
      fail(`Toast overlaps composer: ${JSON.stringify(toastGeometry)}`)
    }
  }
  await evalJson(`(() => {
    const overlay = document.querySelector('.zc-settings-overlay')
    if (!overlay) return true
    const close = document.querySelector('.zc-settings-body-header button')
    if (close) close.click()
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 300))
  await capture('app-chat')

  // Performance: seed 300 messages, reload into them, measure virtualization.
  await evalJson(`(async () => {
    const bridge = window.__zerochatAppTest
    if (!bridge) throw new Error('app test bridge is not installed')
    await bridge.seedPerformanceConversation()
    return true
  })()`)
  await send('Page.navigate', { url: testUrl.href })
  await new Promise((r) => setTimeout(r, 4000))

  const perf = await evalJson(`(async () => {
    const app = document.querySelector('.zc-app')
    if (!app) return { error: 'no app' }
    const dbg = {
      active: document.querySelector('.zc-chat-title')?.textContent ?? '',
      msgCount: document.querySelectorAll('.zc-msg').length,
      hasScroller: Boolean(document.querySelector('.zc-chat-scroll')),
      hasMsg: document.querySelectorAll('.zc-msg').length,
      scrollH: document.querySelector('.zc-chat-scroll')?.scrollHeight,
      clientH: document.querySelector('.zc-chat-scroll')?.clientHeight,
      scrollTop: document.querySelector('.zc-chat-scroll')?.scrollTop,
    }
    if (dbg.hasMsg === 0) return { error: 'no rows', dbg }
    const rendered = document.querySelectorAll('.zc-msg').length
    const scroller = document.querySelector('.zc-chat-scroll')
    if (!scroller) {
      return {
        error: 'no scroller',
        renderedRows: rendered,
        bodyClasses: document.body.innerHTML.slice(0, 300),
        hasMain: Boolean(document.querySelector('.zc-main')),
        hasOnboarding: Boolean(document.querySelector('.zc-empty-card')),
      }
    }
    const t0 = performance.now()
    scroller.scrollTop = 0
    await new Promise((r) => setTimeout(r, 350))
    const topRendered = document.querySelectorAll('.zc-msg').length
    scroller.scrollTop = scroller.scrollHeight
    await new Promise((r) => setTimeout(r, 350))
    const t1 = performance.now()
    return {
      totalMessages: 300,
      renderedRows: rendered,
      renderedAfterTop: topRendered,
      scrollRoundTripMs: Math.round(t1 - t0),
      scrollHeight: scroller.scrollHeight,
    }
  })()`)
  if (perf.error) {
    fail(`Perf probe failed: ${JSON.stringify(perf)}`)
  }
  // Virtualization must keep the DOM small regardless of history size.
  if (perf.renderedRows > 60) {
    fail(`Virtualization ineffective: ${perf.renderedRows} rows rendered for 300 messages`)
  }
  console.log(`[ui-smoke] Perf: ${JSON.stringify(perf)}`)
  await capture('app-long-list')

  const fatalConsole = consoleErrors.filter(
    (line) =>
      !line.includes('favicon') &&
      !line.includes('DevTools') &&
      !line.includes('net::ERR_') &&
      !line.includes('Failed to load resource'),
  )
  if (pageErrors.length > 0) {
    fail(`Page exceptions: ${pageErrors.join(' | ')}`)
  }
  if (fatalConsole.length > 0) {
    fail(`Console errors: ${fatalConsole.join(' | ')}`)
  }

  console.log('[ui-smoke] OK: app booted, sidebar + onboarding rendered, no console/page errors.')
  console.log(`[ui-smoke] Screenshots in: ${captureDir}`)
  console.log(`[ui-smoke] DOM: ${JSON.stringify(domState.bodyTextSample)}`)
  console.log(`[ui-smoke] Send-flow: ${JSON.stringify(toastState)}`)
} finally {
  try {
    chrome.kill()
  } catch {
    // already gone
  }
  await rm(profileDir, { recursive: true, force: true }).catch(() => {})
}
