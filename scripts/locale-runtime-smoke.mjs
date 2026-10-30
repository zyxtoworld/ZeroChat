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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run locale runtime smoke.')
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

async function waitForBrowserState(cdp, expression, label, attempts = 160) {
  const samples = []

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await evaluate(cdp, expression)
    samples.push(state)

    if (state?.ready) {
      return { state, samples }
    }

    await sleep(50)
  }

  throw new Error(`${label} did not settle: ${JSON.stringify(samples.slice(-8))}`)
}

function localeChunkRequests(events, locale) {
  const escapedLocale = locale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`/assets/${escapedLocale}-[^/]+\\.js(?:\\?|$)`)

  return events
    .filter((event) => event.method === 'Network.requestWillBeSent')
    .map((event) => event.params?.request?.url ?? '')
    .filter((url) => pattern.test(url))
}

const runtimeLocaleCases = [
  { locale: 'en-US', dir: 'ltr' },
  { locale: 'es-ES', dir: 'ltr' },
  { locale: 'hi-IN', dir: 'ltr' },
  { locale: 'ar-SA', dir: 'rtl' },
  { locale: 'pt-BR', dir: 'ltr' },
  { locale: 'ru-RU', dir: 'ltr' },
  { locale: 'ja-JP', dir: 'ltr' },
  { locale: 'ko-KR', dir: 'ltr' },
  { locale: 'fr-FR', dir: 'ltr' },
  { locale: 'zh-CN', dir: 'ltr' },
]

async function switchRuntimeLocale(cdp, locale, expectedDir) {
  const beforeRequests = localeChunkRequests(cdp.events, locale).length
  const selected = await evaluate(
    cdp,
    `(() => {
      const option = document.querySelector(
        '.zc-settings-overlay select option[value=${JSON.stringify(locale)}]',
      )
      const select = option?.parentElement
      if (!(select instanceof HTMLSelectElement)) return false
      select.value = ${JSON.stringify(locale)}
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
  )

  assert.equal(selected, true, `${locale} runtime smoke must select its language option.`)

  const wait = await waitForBrowserState(
    cdp,
    `(() => {
      const visible = (element) => {
        if (!element) return false
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      }
      const body = document.body.innerText.replace(/\\s+/g, ' ').trim()
      const select = document.querySelector(
        '.zc-settings-overlay select option[value=${JSON.stringify(locale)}]',
      )?.parentElement
      const visibleFullScreenLoading = Array.from(document.querySelectorAll('.empty-state p, [data-initial-loading]'))
        .some((element) => visible(element) && /Loading|Chargement|جار التحميل|正在载入/.test(element.textContent || ''))

      return {
        ready:
          document.documentElement.lang === ${JSON.stringify(locale)} &&
          (document.documentElement.dir || 'ltr') === ${JSON.stringify(expectedDir)} &&
          select instanceof HTMLSelectElement &&
          select.value === ${JSON.stringify(locale)} &&
          Boolean(document.querySelector('.zc-settings-overlay')) &&
          body.length > 0 &&
          !visibleFullScreenLoading,
        lang: document.documentElement.lang,
        dir: document.documentElement.dir || 'ltr',
        selectValue: select instanceof HTMLSelectElement ? select.value : '',
        visibleFullScreenLoading,
        body: body.slice(0, 500),
      }
    })()`,
    `${locale} runtime switch`,
  )
  const requests = localeChunkRequests(cdp.events, locale)

  assert.equal(
    wait.state.lang,
    locale,
    `${locale} runtime switch must settle on its document language: ${JSON.stringify(wait.state)}`,
  )
  assert.equal(
    wait.state.dir,
    expectedDir,
    `${locale} runtime switch must settle on its document direction: ${JSON.stringify(wait.state)}`,
  )
  assert.equal(
    wait.state.selectValue,
    locale,
    `${locale} runtime switch must keep the selected language: ${JSON.stringify(wait.state)}`,
  )
  assert.ok(
    requests.length >= 1,
    `${locale} runtime switch must have a production locale chunk request: ${JSON.stringify({
      beforeRequests,
      requests,
      state: wait.state,
    })}`,
  )

  return {
    locale,
    lang: wait.state.lang,
    dir: wait.state.dir,
    chunkRequests: requests.length,
    loadedDuringSwitch: requests.length > beforeRequests,
    everFullScreenLoading: wait.samples.some((sample) => Boolean(sample?.visibleFullScreenLoading)),
  }
}

const chromePath = await resolveChromePath()
const cdpPort = await resolveFetchSafeLoopbackPort(
  process.env.ZEROCHAT_LOCALE_SMOKE_CDP_PORT,
  'Locale runtime Chrome remote debugging',
)
const providedAppUrl = process.env.ZEROCHAT_LOCALE_SMOKE_URL
let appUrl = providedAppUrl ?? ''
const profileDir = path.join(os.tmpdir(), `zerochat-locale-smoke-${Date.now()}`)

await access(path.resolve('dist', 'index.html')).catch(() => {
  throw new Error('dist/index.html is missing. Run the production build before locale runtime smoke.')
})
await mkdir(profileDir, { recursive: true })

let previewServer = null
if (!providedAppUrl) {
  previewServer = await startVitePreviewLoopbackServer({
    configuredPort: process.env.ZEROCHAT_LOCALE_SMOKE_PORT,
    serverLabel: 'Locale runtime preview server',
  })
  appUrl = previewServer.url
}
const appTestUrl = new URL(appUrl)
appTestUrl.searchParams.set('app-test', '1')

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
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' },
  )
  const cdp = await connect(target.webSocketDebuggerUrl)
  const browserErrors = []

  try {
    await cdp.send('Page.enable')
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
      `,
    })
    await cdp.send('Page.navigate', { url: appTestUrl.toString() })
    await waitForLoad(cdp)

    const { state: startupState } = await waitForBrowserState(
      cdp,
      `(() => {
        const visible = (element) => {
          if (!element) return false
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        }
        const textOf = (element) =>
          (element?.textContent || element?.getAttribute?.('aria-label') || '').replace(/\\s+/g, ' ').trim()
        const findControl = (names) =>
          Array.from(document.querySelectorAll('button, [role="button"], label, a')).find((control) =>
            names.some((name) => textOf(control).includes(name) || control.getAttribute?.('aria-label')?.includes(name))
          )
        const body = document.body.innerText.replace(/\\s+/g, ' ').trim()
        const guide = document.querySelector('.zc-empty-card.guide-modal')
        const primaryAction = findControl([
          'Start chatting',
          '开始使用',
          'Add provider',
          '添加提供商',
        ])
        const visibleFullScreenLoading = Array.from(document.querySelectorAll('.empty-state p, [data-initial-loading]'))
          .some((element) => visible(element) && /Loading|Chargement|جار التحميل|正在载入/.test(element.textContent || ''))
        const guideRendered =
          Boolean(guide) &&
          (body.includes('Welcome to ZeroChat') || body.includes('欢迎使用 ZeroChat'))
        const ready =
          document.documentElement.lang === 'fr-FR' &&
          (document.documentElement.dir || 'ltr') === 'ltr' &&
          Boolean(primaryAction) &&
          guideRendered

        return {
          ready,
          lang: document.documentElement.lang,
          dir: document.documentElement.dir || 'ltr',
          primaryActionVisible: Boolean(primaryAction),
          visibleFullScreenLoading,
          body: body.slice(0, 500),
        }
      })()`,
      'French system-language startup',
    )

    assert.equal(
      startupState.lang,
      'fr-FR',
      `System language must resolve to French before first user action: ${JSON.stringify(startupState)}`,
    )
    assert.equal(
      startupState.dir,
      'ltr',
      `French startup must stay LTR: ${JSON.stringify(startupState)}`,
    )
    assert.equal(
      startupState.primaryActionVisible,
      true,
      `French first-run guide must render with its primary action: ${JSON.stringify(startupState)}`,
    )
    assert.equal(
      startupState.visibleFullScreenLoading,
      false,
      `French startup should settle on the guide instead of a visible full-screen loading state: ${JSON.stringify(startupState)}`,
    )

    // The runtime locale dictionary follows the resolved system language.
    const startupLocaleRequests = localeChunkRequests(cdp.events, 'fr-FR')
    assert.ok(
      startupLocaleRequests.length >= 1,
      `Production startup must fetch the runtime locale chunk for the system language: ${JSON.stringify({
        startupState,
        startupLocaleRequests,
      })}`,
    )

    const skipClicked = await evaluate(
      cdp,
      `(() => {
        const textOf = (element) =>
          (element?.textContent || element?.getAttribute?.('aria-label') || '').replace(/\\s+/g, ' ').trim()
        const control = Array.from(document.querySelectorAll('button, [role="button"], label, a')).find((item) =>
          ['Start chatting', '开始使用', 'Add provider', '添加提供商'].some((name) =>
            textOf(item).includes(name) || item.getAttribute?.('aria-label')?.includes(name)
          )
        )

        if (!control) return false
        control.click()
        return true
      })()`,
    )

    assert.equal(skipClicked, true, 'Locale runtime smoke must click the first-run guide action.')

    await waitForBrowserState(
      cdp,
      `(() => ({
        ready: Boolean(document.querySelector('.zc-settings-overlay') ||
          document.querySelector('button[aria-label="Settings"], button[aria-label="设置"]')),
        lang: document.documentElement.lang,
        body: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 500),
      }))()`,
      'settings opener after first-run guide action',
    )

    const settingsClicked = await evaluate(
      cdp,
      `(() => {
        const opener = document.querySelector('button[aria-label="Settings"], button[aria-label="设置"]')
        if (!opener) return Boolean(document.querySelector('.zc-settings-overlay'))
        opener.click()
        return true
      })()`,
    )

    assert.equal(settingsClicked, true, 'Locale runtime smoke must open Settings through the real UI opener.')

    await waitForBrowserState(
      cdp,
      `(() => ({
        ready: Boolean(document.querySelector('#settings-tab-general')),
        lang: document.documentElement.lang,
        body: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 500),
      }))()`,
      'settings tab hosting the language control',
    )

    const generalClicked = await evaluate(
      cdp,
      `(() => {
        const tab = document.querySelector('#settings-tab-general')
        if (!tab) return false
        tab.click()
        return true
      })()`,
    )

    assert.equal(generalClicked, true, 'Locale runtime smoke must switch Settings to the General tab.')

    await waitForBrowserState(
      cdp,
      `(() => {
        const visible = (element) => {
          if (!element) return false
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        }
        const select = document.querySelector('.zc-settings-overlay select option[value="ar-SA"]')?.parentElement
        const visibleFullScreenLoading = Array.from(document.querySelectorAll('.empty-state p, [data-initial-loading]'))
          .some((element) => visible(element) && /Loading|Chargement|جار التحميل|正在载入/.test(element.textContent || ''))

        return {
          ready: select instanceof HTMLSelectElement,
          lang: document.documentElement.lang,
          dir: document.documentElement.dir || 'ltr',
          modalVisible: visible(document.querySelector('.zc-settings-overlay')),
          visibleFullScreenLoading,
          body: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 500),
        }
      })()`,
      'runtime language select',
    )

    const selectArabic = await evaluate(
      cdp,
      `(() => {
        const select = document.querySelector('.zc-settings-overlay select option[value="ar-SA"]')?.parentElement
        if (!(select instanceof HTMLSelectElement)) return false
        select.value = 'ar-SA'
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`,
    )

    assert.equal(selectArabic, true, 'Locale runtime smoke must select Arabic through the settings language control.')

    const arabicWait = await waitForBrowserState(
      cdp,
      `(() => {
        const visible = (element) => {
          if (!element) return false
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        }
        const body = document.body.innerText.replace(/\\s+/g, ' ').trim()
        const visibleFullScreenLoading = Array.from(document.querySelectorAll('.empty-state p, [data-initial-loading]'))
          .some((element) => visible(element) && /Loading|Chargement|جار التحميل|正在载入/.test(element.textContent || ''))
        const arabicUiRendered = body.includes('Settings') && body.includes('General')
        const ready =
          document.documentElement.lang === 'ar-SA' &&
          (document.documentElement.dir || 'ltr') === 'rtl' &&
          arabicUiRendered

        return {
          ready,
          lang: document.documentElement.lang,
          dir: document.documentElement.dir || 'ltr',
          visibleFullScreenLoading,
          body: body.slice(0, 500),
        }
      })()`,
      'Arabic runtime switch',
    )
    const arabicLocaleRequests = localeChunkRequests(cdp.events, 'ar-SA')
    assert.ok(
      arabicLocaleRequests.length >= 1,
      `Arabic runtime switch must fetch its production locale chunk: ${JSON.stringify({
        arabicState: arabicWait.state,
        arabicLocaleRequests,
      })}`,
    )

    const selectChinese = await evaluate(
      cdp,
      `(() => {
        const select = document.querySelector('.zc-settings-overlay select option[value="zh-CN"]')?.parentElement
        if (!(select instanceof HTMLSelectElement)) return false
        select.value = 'zh-CN'
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`,
    )

    assert.equal(selectChinese, true, 'Locale runtime smoke must select Chinese after the Arabic switch.')

    const chineseWait = await waitForBrowserState(
      cdp,
      `(() => {
        const visible = (element) => {
          if (!element) return false
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        }
        const body = document.body.innerText.replace(/\\s+/g, ' ').trim()
        const visibleFullScreenLoading = Array.from(document.querySelectorAll('.empty-state p, [data-initial-loading]'))
          .some((element) => visible(element) && /Loading|Chargement|جار التحميل|正在载入/.test(element.textContent || ''))
        const ready =
          document.documentElement.lang === 'zh-CN' &&
          (document.documentElement.dir || 'ltr') === 'ltr' &&
          body.includes('设置') &&
          body.includes('通用')

        return {
          ready,
          lang: document.documentElement.lang,
          dir: document.documentElement.dir || 'ltr',
          visibleFullScreenLoading,
          body: body.slice(0, 500),
        }
      })()`,
      'Chinese runtime switch',
    )
    const chineseLocaleRequests = localeChunkRequests(cdp.events, 'zh-CN')
    assert.ok(
      chineseLocaleRequests.length >= 1,
      `Chinese runtime switch must fetch its production locale chunk: ${JSON.stringify({
        chineseState: chineseWait.state,
        chineseLocaleRequests,
      })}`,
    )

    const allLocaleSwitches = []
    for (const localeCase of runtimeLocaleCases) {
      allLocaleSwitches.push(
        await switchRuntimeLocale(cdp, localeCase.locale, localeCase.dir),
      )
    }

    const loadingDuringSwitches = [
      ...arabicWait.samples.map((sample) => Boolean(sample?.visibleFullScreenLoading)),
      ...chineseWait.samples.map((sample) => Boolean(sample?.visibleFullScreenLoading)),
      ...allLocaleSwitches.map((result) => result.everFullScreenLoading),
    ]
    const switchState = {
      arabic: arabicWait.state,
      chinese: chineseWait.state,
      allLocales: allLocaleSwitches,
      loadingDuringSwitches,
      everFullScreenLoadingDuringSwitch: loadingDuringSwitches.some(Boolean),
      languageSelectValue: await evaluate(
        cdp,
        `document.querySelector('.zc-settings-overlay select option[value="zh-CN"]')?.parentElement?.value ?? ''`,
      ),
    }

    assert.equal(
      switchState.arabic?.lang,
      'ar-SA',
      `Runtime language switch must settle on Arabic: ${JSON.stringify(switchState)}`,
    )
    assert.equal(
      switchState.arabic?.dir,
      'rtl',
      `Arabic runtime switch must flip document direction to RTL: ${JSON.stringify(switchState)}`,
    )
    assert.equal(
      switchState.chinese?.lang,
      'zh-CN',
      `Runtime language switch must settle on Chinese: ${JSON.stringify(switchState)}`,
    )
    assert.equal(
      switchState.chinese?.dir,
      'ltr',
      `Chinese runtime switch must restore document direction to LTR: ${JSON.stringify(switchState)}`,
    )
    assert.equal(
      switchState.everFullScreenLoadingDuringSwitch,
      false,
      `Runtime language switches must not show a full-screen loading state: ${JSON.stringify(switchState)}`,
    )

    const languageSaveFlushed = await evaluate(
      cdp,
      `(async () => {
        const bridge = window.__zerochatAppTest
        if (!bridge) return false
        await bridge.flushLocalSaves()
        return true
      })()`,
      true,
    )
    assert.equal(
      languageSaveFlushed,
      true,
      'Locale runtime smoke must flush the real local save lane before reload.',
    )

    const pageLoadCountBeforeReload = cdp.events.filter(
      (event) => event.method === 'Page.loadEventFired',
    ).length
    const persistedLocaleProbe = await cdp.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: `(() => {
          window.__zerochatPersistedLocaleFirstShell = null
          const observer = new MutationObserver(() => {
            const shell = document.querySelector('.zc-app')
            if (!shell || window.__zerochatPersistedLocaleFirstShell) return
            window.__zerochatPersistedLocaleFirstShell = {
              lang: document.documentElement.lang,
              dir: document.documentElement.dir || 'ltr',
            }
            observer.disconnect()
          })
          observer.observe(document, { childList: true, subtree: true })
        })()`,
      },
    )
    try {
      await cdp.send('Page.reload', { ignoreCache: true })
      for (let attempt = 0; attempt < 160; attempt += 1) {
        const pageLoadCount = cdp.events.filter(
          (event) => event.method === 'Page.loadEventFired',
        ).length
        if (pageLoadCount > pageLoadCountBeforeReload) break
        if (attempt === 159) {
          throw new Error('Saved-language reload did not emit a new page load event.')
        }
        await sleep(50)
      }

      const persistedLocaleReload = await waitForBrowserState(
        cdp,
        `(() => {
          const firstShell = window.__zerochatPersistedLocaleFirstShell
          return {
            ready: Boolean(firstShell),
            firstShell,
            currentLang: document.documentElement.lang,
            currentDir: document.documentElement.dir || 'ltr',
          }
        })()`,
        'saved manual language after reload',
      )
      assert.deepEqual(
        persistedLocaleReload.state.firstShell,
        { lang: 'zh-CN', dir: 'ltr' },
        'saved manual language should restore after reload before the app shell is shown',
      )
    } finally {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: persistedLocaleProbe.identifier,
      })
    }


    for (const event of cdp.events) {
      if (event.method === 'Runtime.exceptionThrown') {
        browserErrors.push(event.params.exceptionDetails.text)
      }
      if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
        browserErrors.push(event.params.entry.text)
      }
    }

    assert.deepEqual(browserErrors, [], 'locale runtime smoke should not report browser runtime errors')
    const testedLocales = allLocaleSwitches
      .map((result) => `${result.locale}/${result.dir}`)
      .join(', ')
    console.log(
      `Locale runtime smoke passed: all locales [${testedLocales}], system fr-FR loaded ${startupLocaleRequests[0]}, runtime ar-SA flipped document lang/dir, zh-CN re-rendered the Chinese UI, no full-screen loading flash during switches`,
    )
  } finally {
    cdp.close()
  }
}

try {
  await main()
} finally {
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
