import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, readFile } from 'node:fs/promises'
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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run axe accessibility checks.')
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
  return connectCdp(wsUrl, {
    commandTimeoutMs: AXE_CDP_COMMAND_TIMEOUT_MS,
  })
}

async function waitForChrome(port, chromeProcess) {
  return waitForCdpChrome(port, { childProcess: chromeProcess })
}

function axeSummary(label, violation) {
  const nodes = violation.nodes
    .slice(0, 4)
    .map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? 'no failure summary'}`)
    .join('\n    ')

  return `${label}: ${violation.id} (${violation.impact ?? 'unknown impact'}) - ${violation.help}\n    ${nodes}`
}

const providedAppUrl = process.env.ZEROCHAT_AXE_URL
const AXE_CDP_COMMAND_TIMEOUT_MS = 60_000
let appUrl = providedAppUrl ?? ''
const cdpPort = await resolveFetchSafeLoopbackPort(
  process.env.ZEROCHAT_AXE_CDP_PORT,
  'Axe accessibility Chrome remote debugging',
)
const profileDir = path.join(os.tmpdir(), `zerochat-axe-${Date.now()}`)
const chromePath = await resolveChromePath()
const axeSource = await readFile(path.resolve('node_modules/axe-core/axe.min.js'), 'utf8')

await mkdir(profileDir, { recursive: true })

let devServer = null
if (!providedAppUrl) {
  devServer = await startViteDevLoopbackServer({
    configuredPort: process.env.ZEROCHAT_AXE_APP_PORT,
    serverLabel: 'Axe accessibility app server',
  })
  appUrl = devServer.url
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
  {
    stdio: 'ignore',
    windowsHide: true,
  },
)

let cdp = null

try {
  await waitForChrome(cdpPort, chrome)
  const target = await readJson(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' },
  )
  cdp = await connect(target.webSocketDebuggerUrl)

  async function evaluate(expression, awaitPromise = false) {
    let result

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        result = await cdp.send('Runtime.evaluate', {
          expression,
          awaitPromise,
          returnByValue: true,
        })
        break
      } catch (error) {
        if (!String(error?.message ?? error).includes('Execution context was destroyed')) {
          throw error
        }
        await sleep(100)
      }
    }

    if (!result) {
      throw new Error('Browser evaluation failed because the execution context kept changing.')
    }

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          'Browser evaluation failed',
      )
    }

    return result.result.value
  }

  async function setViewport(width, height, mobile = false) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    })
    await sleep(100)
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

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      Object.defineProperty(navigator, 'languages', {
        configurable: true,
        get: () => ['en-US', 'zh-CN'],
      })
      Object.defineProperty(navigator, 'language', {
        configurable: true,
        get: () => 'en-US',
      })
    `,
  })
  await cdp.send('Page.navigate', { url: appUrl })
  await waitForLoad()
  await evaluate(axeSource)
  await evaluate(`
    window.__zeroChatAxe = {
      textOf(element) {
        const text = (element.textContent || '').trim().replace(/\\s+/g, ' ')
        return text || element.getAttribute('aria-label') || element.title || ''
      },
      match(element, names) {
        const text = this.textOf(element)
        return names.some((name) => text.includes(name))
      },
      click(names) {
        const controls = Array.from(document.querySelectorAll('button, [role="button"], label'))
        const element = controls.find((item) => this.match(item, names))
        if (!element) {
          throw new Error(
            'Missing control: ' +
              names.join(' / ') +
              '; available: ' +
              controls.map((item) => this.textOf(item)).filter(Boolean).slice(0, 30).join(' | '),
          )
        }
        element.click()
        return this.textOf(element)
      },
      clickSelector(selector) {
        const element = document.querySelector(selector)
        if (!element) throw new Error('Missing selector: ' + selector)
        element.click()
        return true
      },
      setSelectValue(value) {
        const select = Array.from(document.querySelectorAll('select'))
          .find((item) => Array.from(item.options).some((option) => option.value === value))
        if (!select) throw new Error('Missing select option: ' + value)
        select.value = value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      },
      async waitForText(names) {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (Array.from(document.querySelectorAll('body *')).some((item) => this.match(item, names))) {
            return true
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error('Missing text: ' + names.join(' / '))
      },
      async waitForNoModal(selector) {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (!document.querySelector(selector)) return true
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error('Modal did not close: ' + selector)
      },
      async waitForDocumentLanguage(lang, dir) {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (document.documentElement.lang === lang && document.documentElement.dir === dir) {
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
    }
  `)
  await evaluate(`window.__zeroChatAxe.waitForText(['First setup', '首次配置'])`, true)

  async function runAxe(label) {
    await sleep(150)
    const violations = await evaluate(
      `axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        },
        resultTypes: ['violations'],
      }).then((result) => result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          failureSummary: node.failureSummary,
        })),
      })))`,
      true,
    )

    assert.equal(
      violations.length,
      0,
      `axe-core found ${violations.length} violation(s):\n${violations
        .map((violation) => axeSummary(label, violation))
        .join('\n')}`,
    )
    console.log(`axe ${label}: 0 violations`)
  }

  await setViewport(1440, 900, false)
  await runAxe('first-run guide desktop')

  await setViewport(390, 780, true)
  await runAxe('first-run guide mobile')

  await evaluate(`
    window.__zeroChatAxe.click([
      'Skip, use locally',
      'Skip, use local first',
      '跳过，先本地使用',
    ])
  `)
  await evaluate(`window.__zeroChatAxe.waitForText(['New chat', '新建对话'])`, true)

  await setViewport(1440, 900, false)
  await runAxe('chat desktop')

  await evaluate(`window.__zeroChatAxe.click(['Open settings', '打开设置'])`)
  await evaluate(`window.__zeroChatAxe.waitForText(['Settings', '设置'])`, true)
  await runAxe('settings providers desktop')

  await evaluate(`window.__zeroChatAxe.clickSelector('#settings-tab-appearance')`)
  await evaluate(`window.__zeroChatAxe.setSelectValue('ar-SA')`)
  await evaluate(`window.__zeroChatAxe.waitForDocumentLanguage('ar-SA', 'rtl')`, true)
  await setViewport(390, 780, true)
  await runAxe('settings appearance rtl mobile')

  await evaluate(`window.__zeroChatAxe.clickSelector('#settings-tab-data')`)
  await setViewport(320, 640, true)
  await runAxe('settings data compact mobile')

  await evaluate(`window.__zeroChatAxe.click(['Reset local data', '重置本机数据', 'إعادة تعيين البيانات المحلية'])`)
  await evaluate(`window.__zeroChatAxe.waitForText(['Reset local data', '重置本机数据', 'إعادة تعيين البيانات المحلية'])`, true)
  await runAxe('reset local data alertdialog compact mobile')
} finally {
  cdp?.close()
  await stopChildProcessTree(chrome)
  await devServer?.close()
  const profileRemoved = await removeBrowserProfileWithRetry(profileDir, 120)
  assert.ok(profileRemoved, `Axe browser profile cleanup failed: ${profileDir}`)
}

console.log('axe accessibility checks passed')
