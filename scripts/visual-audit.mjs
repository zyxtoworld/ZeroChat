import assert from 'node:assert/strict'
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import { resolveFetchSafeLoopbackPort } from './fetch-safe-loopback-port.mjs'
import { startViteDevLoopbackServer } from './vite-loopback-server.mjs'
import {
  connectCdp,
  waitForMainFrameLoadCompletion,
  waitForCdpPageTarget,
  waitForChrome,
} from './browser-cdp.mjs'
import { runActionWithExpectedConfirm } from './browser-confirm-dialog.mjs'
import {
  removeBrowserProfileWithRetry,
  settleBrowserRuntimeCleanup,
  stopChildProcessTree,
} from './browser-runtime-cleanup.mjs'
import {
  analyzePngScreenshot,
  writeVisualContactSheet,
  writeVisualGallery,
} from './visual-audit-artifacts.mjs'
import {
  renderedActionTargetMeetsMinimum,
  renderedButtonContentIsCentered,
  renderedControlOverlap,
  renderedElementClipsContent,
  renderedPlaceholderFits,
  renderedSurfaceIsClosed,
  renderedTouchTargetMeetsMinimum,
  renderedVisibleRect,
} from './visual-geometry-contract.mjs'

const rawArgs = process.argv.slice(2)
const summaryOnly =
  rawArgs.includes('--summary') || process.env.ZEROCHAT_VISUAL_SUMMARY_ONLY === '1'
const outputDir = path.resolve(process.env.ZEROCHAT_VISUAL_DIR ?? '.visual-audit')
const providedAppUrl = process.env.ZEROCHAT_VISUAL_URL ?? ''
const visualAuditBaseScreenshotCount = 69

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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run visual audit.')
}

function extractSupportedLocales(source) {
  const match = source.match(/const supportedLocales:\s*Locale\[\]\s*=\s*\[([\s\S]*?)\]/)
  if (!match) throw new Error('Unable to find supportedLocales in src/i18n.ts.')
  const locales = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  if (locales.length === 0) throw new Error('src/i18n.ts supportedLocales is empty.')
  return locales
}

function localeDirection(locale) {
  return locale === 'ar-SA' ? 'rtl' : 'ltr'
}

async function cleanOutput(directory) {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith('.png') ||
            entry.name === 'visual-audit-gallery.html' ||
            entry.name === 'visual-audit-contact-sheet.jpg' ||
            entry.name === 'visual-audit-manifest.json'),
      )
      .map((entry) => rm(path.join(directory, entry.name), { force: true })),
  )
}

function visualSmokeScript() {
  return `(() => {
    const textOf = (element) =>
      (element?.textContent || element?.getAttribute('aria-label') || element?.title || '')
        .replace(/\\s+/g, ' ')
        .trim()
    const visible = (element) => {
      if (!element) return false
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return box.width > 0 && box.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && style.opacity !== '0'
    }
    const controls = (root = document) =>
      [...root.querySelectorAll('button, [role="button"], label')].filter(visible)
    const find = (names, root = document) => {
      const values = Array.isArray(names) ? names : [names]
      return controls(root).find((element) => {
        const text = textOf(element)
        return values.some((value) => text.includes(value))
      })
    }
    const setNativeValue = (element, value) => {
      const prototype = element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      descriptor?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    window.__zeroChatVisual = {
      textOf,
      visible,
      click(names, root = document) {
        const element = find(names, root)
        if (!element) {
          throw new Error('Missing production control: ' + valuesToText(names))
        }
        element.click()
        return textOf(element)
      },
      clickSelector(selector) {
        const element = document.querySelector(selector)
        if (!element || !visible(element)) throw new Error('Missing production selector: ' + selector)
        element.click()
        return true
      },
      async clickFirstConversationDelete() {
        const row = document.querySelector('.zc-conv-item')
        if (!(row instanceof HTMLElement)) {
          throw new Error('Missing conversation row')
        }
        row.focus({ preventScroll: true })
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const element = document.querySelector('.zc-conv-item .zc-conv-actions button:last-child:not([disabled])')
        if (!(element instanceof HTMLButtonElement) || !visible(element)) {
          throw new Error('Missing enabled conversation delete action')
        }
        element.click()
        return true
      },
      clickTab(id) {
        const element = document.querySelector('#settings-tab-' + id)
        if (!element || !visible(element)) throw new Error('Missing settings tab: ' + id)
        element.click()
        return true
      },
      setSelectValue(value) {
        const element = [...document.querySelectorAll('select')]
          .find((candidate) => [...candidate.options].some((option) => option.value === value))
        if (!element) throw new Error('Missing select option: ' + value)
        setNativeValue(element, value)
        return element.value
      },
      setCompact(value) {
        const element = document.querySelector('.zc-settings [role="switch"]')
        if (!element) throw new Error('Missing compact-mode switch')
        if ((element.getAttribute('aria-checked') === 'true') !== value) element.click()
        return element.getAttribute('aria-checked')
      },
      setProviderKey(value) {
        const element = document.querySelector('.zc-provider-card input[type="password"]')
        if (!element) throw new Error('Missing provider credential field')
        element.focus()
        element.select()
        document.execCommand?.('insertText', false, value)
        setNativeValue(element, value)
        return element.value
      },
      focusProviderKey() {
        const element = document.querySelector('.zc-provider-card input[type="password"]')
        if (!element) throw new Error('Missing provider credential field')
        element.focus()
        element.select()
        return true
      },
      async saveProviderKey() {
        const card = document.querySelector('.zc-provider-card')
        const element = [...(card?.querySelectorAll('button.zc-btn') ?? [])]
          .find((candidate) => ['保存', 'Save'].some((value) => textOf(candidate).includes(value)))
        if (!element) throw new Error('Missing provider credential save control')
        element.click()
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const input = card?.querySelector('input[type="password"]')
          const fieldShowsSavedState = Boolean(
            input?.placeholder?.includes('保存') ||
            input?.placeholder?.includes('saved'),
          )
          if (element.disabled || fieldShowsSavedState) {
            return {
              saveDisabled: Boolean(element.disabled),
              fieldHasValue: Boolean(input?.value),
              fieldShowsSavedState,
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        const input = card?.querySelector('input[type="password"]')
        return {
          saveDisabled: Boolean(element.disabled),
          fieldHasValue: Boolean(input?.value),
          fieldShowsSavedState: Boolean(
            input?.placeholder?.includes('保存') ||
            input?.placeholder?.includes('saved'),
          ),
        }
      },
      async saveDataPassphrase(value) {
        const input = document.querySelector('[data-zc-sync-passphrase="true"]')
        if (!(input instanceof HTMLInputElement)) {
          throw new Error('Missing current data passphrase field')
        }
        setNativeValue(input, value)
        const row = input.closest('.zc-credential-row')
        const save = row?.querySelector('button.zc-btn')
        if (!(save instanceof HTMLButtonElement)) {
          throw new Error('Missing current data passphrase save control')
        }
        for (let attempt = 0; attempt < 80 && save.disabled; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        if (save.disabled) {
          throw new Error('Current data passphrase save control did not become enabled')
        }
        save.click()
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (input.value === '' && save.disabled) {
            return { fieldCleared: true, saveDisabled: true }
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return { fieldCleared: input.value === '', saveDisabled: save.disabled }
      },
      setSidebarCollapsed(value) {
        const sidebar = document.querySelector('.zc-sidebar')
        if (!sidebar) throw new Error('Missing sidebar')
        if (sidebar.classList.contains('collapsed') !== value) {
          const button = document.querySelector('.zc-chat-header .zc-icon-btn')
          if (!button) throw new Error('Missing sidebar toggle')
          button.click()
        }
        return sidebar.classList.contains('collapsed')
      },
      scrollSettings(position) {
        const element = document.querySelector('.zc-settings-scroll')
        if (!element) throw new Error('Missing settings scroll area')
        element.scrollTop = position === 'top' ? 0 : element.scrollHeight
        element.dispatchEvent(new Event('scroll', { bubbles: true }))
        return element.scrollTop
      },
      dismissToast() {
        document.querySelector('.zc-toast button')?.click()
      },
      async sendOfflineProbe(value) {
        const textarea = document.querySelector('.zc-composer textarea')
        if (!textarea) throw new Error('Missing production composer')
        setNativeValue(textarea, value)
        document.querySelector('.zc-send-btn:not([disabled])')?.click()
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const queued = document.querySelectorAll('.zc-msg.message.queued').length
          const toast = document.querySelector('.zc-toast')
          if (queued > 0 && toast) return { queued, toast: textOf(toast) }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return {
          queued: document.querySelectorAll('.zc-msg.message.queued').length,
          toast: textOf(document.querySelector('.zc-toast')),
        }
      },
      focusComposer() {
        const textarea = document.querySelector('.zc-composer textarea')
        if (!textarea) throw new Error('Missing production composer')
        textarea.focus()
        textarea.select()
        return true
      },
      async submitOfflineProbe() {
        document.querySelector('.zc-send-btn:not([disabled])')?.click()
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const queued = document.querySelectorAll('.zc-msg.message.queued').length
          const toast = document.querySelector('.zc-toast')
          if (queued > 0 && toast) return { queued, toast: textOf(toast) }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return {
          queued: document.querySelectorAll('.zc-msg.message.queued').length,
          toast: textOf(document.querySelector('.zc-toast')),
        }
      },
    }
    function valuesToText(value) {
      return (Array.isArray(value) ? value : [value]).join(' / ')
    }
    return true
  })()`
}

async function main() {
  const supportedLocales = extractSupportedLocales(await readFile('src/i18n.ts', 'utf8'))
  const expectedScreenshotCount = visualAuditBaseScreenshotCount + supportedLocales.length
  const chromePath = await resolveChromePath()
  const cdpPort = await resolveFetchSafeLoopbackPort(
    process.env.ZEROCHAT_VISUAL_CDP_PORT,
    'Visual audit Chrome remote debugging',
  )
  const profileDir = path.join(os.tmpdir(), `zerochat-visual-audit-${Date.now()}`)
  await mkdir(profileDir, { recursive: true })
  await cleanOutput(outputDir)

  let appUrl = providedAppUrl
  let devServer = null
  if (!appUrl) {
    devServer = await startViteDevLoopbackServer({
      configuredPort: process.env.ZEROCHAT_VISUAL_APP_PORT,
      serverLabel: 'Visual audit app server',
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
    { detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true },
  )
  chrome.zerochatProcessGroupLeader = process.platform !== 'win32'

  let cdp = null
  try {
    await waitForChrome(cdpPort, { childProcess: chrome, timeoutMs: 30_000 })
    const target = await waitForCdpPageTarget(cdpPort, { timeoutMs: 30_000 })
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    const screenshots = []
    const errors = []
    let viewport = { width: 1440, height: 900 }
    let screenshotIndex = 1

    cdp.on('Runtime.exceptionThrown', (params) => {
      errors.push(params.exceptionDetails?.text ?? 'Runtime exception')
    })

    const evaluate = async (expression, awaitPromise = false) => {
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

    const waitForPaint = async () => {
      await evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        true,
      )
    }

    const waitFor = async (expression, timeout = 8000) => {
      const value = await evaluate(
        `(async () => {
          const started = Date.now()
          while (Date.now() - started < ${timeout}) {
            const value = (${expression})
            if (value) return value
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          return (${expression})
        })()`,
        true,
      )
      if (!value) {
        throw new Error(`Timed out waiting for visual-audit expression: ${expression}`)
      }
      return value
    }

    const waitForSidebarClosed = async (timeout = 8000) => {
      const state = await evaluate(`new Promise((resolve) => {
        const surfaceIsClosed = ${renderedSurfaceIsClosed.toString()}
        const visibleRectFor = ${renderedVisibleRect.toString()}
        const visibleRectForElement = (element) => {
          if (!(element instanceof HTMLElement)) return null
          const style = getComputedStyle(element)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return null
          }
          return visibleRectFor(element)
        }
        const snapshot = (element) => {
          if (!(element instanceof HTMLElement)) return null
          const box = element.getBoundingClientRect()
          return {
            box: {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            },
            visibleRect: visibleRectForElement(element),
          }
        }
        const started = performance.now()
        let stableFrames = 0
        const check = () => {
          const sidebar = document.querySelector('.zc-sidebar')
          const backdrop = document.querySelector('.zc-sidebar-backdrop')
          const sidebarSnapshot = snapshot(sidebar)
          const backdropSnapshot = snapshot(backdrop)
          const closed = surfaceIsClosed({
            sidebarCollapsed: sidebar instanceof HTMLElement && sidebar.classList.contains('collapsed'),
            sidebarVisibleRect: sidebarSnapshot?.visibleRect ?? null,
            backdropVisibleRect: backdropSnapshot?.visibleRect ?? null,
          })
          stableFrames = closed ? stableFrames + 1 : 0
          const state = {
            closed,
            stableFrames,
            sidebar: sidebarSnapshot,
            backdrop: backdropSnapshot,
          }
          if (stableFrames >= 2 || performance.now() - started >= ${timeout}) {
            resolve(state)
            return
          }
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      })`, true)
      assert.equal(
        state?.closed,
        true,
        `mobile sidebar must leave the viewport before visual capture: ${JSON.stringify(state)}`,
      )
      return state
    }

    const setViewport = async (width, height, mobile = false) => {
      viewport = { width, height }
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile,
      })
      await sleep(160)
      await waitForPaint()
    }

    const assertPageGeometry = async (name) => {
      const state = await evaluate(`(() => {
        const root = document.querySelector('.zc-app, .zc-boot')
        const dialog = document.querySelector('.zc-settings[role="dialog"]')
        const box = dialog?.getBoundingClientRect()
        const visible = (element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
            style.visibility !== 'hidden' && style.opacity !== '0' &&
            !element.closest('[aria-hidden="true"]')
        }
        const labelFor = (element) =>
          (element.textContent || element.getAttribute('aria-label') || element.className || element.tagName)
            .replace(/\\s+/g, ' ')
            .trim()
            .slice(0, 80)
        const clipsContent = ${renderedElementClipsContent.toString()}
        const placeholderFits = ${renderedPlaceholderFits.toString()}
        const buttonContentIsCentered = ${renderedButtonContentIsCentered.toString()}
        const actionTargetMeetsMinimum = ${renderedActionTargetMeetsMinimum.toString()}
        const touchTargetMeetsMinimum = ${renderedTouchTargetMeetsMinimum.toString()}
        const controlOverlap = ${renderedControlOverlap.toString()}
        const visibleRectFor = ${renderedVisibleRect.toString()}
        const visibleTextControls = [...document.querySelectorAll('button, [role="button"], label')]
          .filter((element) => visible(element) && Boolean(labelFor(element)))
        const clippedControls = visibleTextControls
          .filter((element) =>
            !element.classList.contains('zc-icon-btn') &&
            !element.classList.contains('zc-sidebar-backdrop'))
          .filter((element) => clipsContent(element))
          .map(labelFor)
        const clippedGroups = [...document.querySelectorAll([
          '.zc-chat-header',
          '.zc-composer-row',
          '.zc-conversation-starters',
          '.zc-credential-row',
          '.zc-image-task-modes',
          '.zc-model-order-actions',
          '.zc-msg-actions',
          '.zc-provider-head',
          '.zc-provider-order-actions',
          '.zc-segmented',
          '.zc-settings-body-header',
          '.zc-settings-nav',
          '.zc-skill-switches',
          '.image-source-actions',
          '.mask-controls',
        ].join(','))]
          .filter(visible)
          .filter((element) => clipsContent(element))
          .map(labelFor)
        const clippedPlaceholders = [...document.querySelectorAll([
          'input[placeholder]:not([type="file"]):not([type="checkbox"]):not([type="radio"])',
          'textarea[placeholder]',
        ].join(','))]
          .filter(visible)
          .filter((element) => !placeholderFits(element))
          .map((element) =>
            element.tagName.toLowerCase() + '[placeholder="' +
            element.getAttribute('placeholder') + '"]')
        const offCenterControls = [...document.querySelectorAll('button')]
          .filter(visible)
          .filter((element) => {
            const style = getComputedStyle(element)
            return style.textAlign === 'center' ||
              style.justifyContent === 'center' ||
              style.justifyItems === 'center'
          })
          .filter((element) => !buttonContentIsCentered(element))
          .map(labelFor)
        const smallActionTargets = [...document.querySelectorAll([
          'button',
          '[role="button"]',
          'label.zc-btn',
          'label.file-button',
        ].join(','))]
          .filter(visible)
          .filter((element) => !element.classList.contains('zc-sidebar-backdrop'))
          .filter((element) => !element.closest('.zc-toasts'))
          .filter((element) => !actionTargetMeetsMinimum(element))
          .map((element) => {
            const rect = element.getBoundingClientRect()
            return labelFor(element) + ' (' +
              Math.round(rect.width * 10) / 10 + 'x' +
              Math.round(rect.height * 10) / 10 + 'px)'
          })
        const mobileTouchTargets = innerWidth <= 480
          ? [...document.querySelectorAll([
              'button',
              '[role="button"]',
              'label.zc-btn',
              'label.file-button',
              'input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])',
              'select',
              'textarea',
            ].join(','))]
              .filter(visible)
              .filter((element) => !element.classList.contains('zc-sidebar-backdrop'))
              .filter((element) => !touchTargetMeetsMinimum(element))
              .map((element) => {
                const rect = element.getBoundingClientRect()
                return labelFor(element) + ' (' +
                  Math.round(rect.width * 10) / 10 + 'x' +
                  Math.round(rect.height * 10) / 10 + 'px)'
              })
          : []
        const geometryScope = dialog ?? document
        const measuredControls = [...geometryScope.querySelectorAll([
          'button',
          '[role="button"]',
          'label.zc-btn',
          'label.file-button',
          'input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])',
          'select',
          'textarea',
        ].join(','))]
          .filter(visible)
          .filter((element) => !element.classList.contains('zc-sidebar-backdrop'))
          .filter((element) => !element.closest('.zc-toasts'))
        const controlBoxes = measuredControls
          .map((element) => ({ element, rect: visibleRectFor(element) }))
          .filter((item) => item.rect)
          .sort((left, right) => left.rect.top - right.rect.top)
        const controlRectByElement = new Map(
          controlBoxes.map((item) => [item.element, item.rect]),
        )
        const overlappingControls = []
        for (let leftIndex = 0; leftIndex < controlBoxes.length; leftIndex += 1) {
          const left = controlBoxes[leftIndex]
          for (let rightIndex = leftIndex + 1; rightIndex < controlBoxes.length; rightIndex += 1) {
            const right = controlBoxes[rightIndex]
            if (right.rect.top >= left.rect.bottom - 2) break
            const overlap = controlOverlap(
              left.element,
              right.element,
              2,
              (element) => controlRectByElement.get(element),
            )
            if (!overlap) continue
            overlappingControls.push(
              labelFor(left.element) + ' <> ' + labelFor(right.element) + ' (' +
              Math.round(overlap.width * 10) / 10 + 'x' +
              Math.round(overlap.height * 10) / 10 + 'px)',
            )
          }
        }
        return {
          root: Boolean(root),
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 ||
            (document.body?.scrollWidth || 0) > innerWidth + 1,
          settingsScrollHorizontalOverflow: (() => {
            const scroll = document.querySelector('.zc-settings-scroll')
            return scroll instanceof HTMLElement && scroll.scrollWidth > scroll.clientWidth + 1
          })(),
          dialogInside: !box || (box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1),
          clippedControls,
          clippedGroups,
          clippedPlaceholders,
          offCenterControls,
          smallActionTargets,
          mobileTouchTargets,
          overlappingControls,
          controls: visibleTextControls.length,
        }
      })()`)
      assert.equal(state.root, true, `${name} must render the production app shell`)
      assert.equal(state.horizontalOverflow, false, `${name} must not overflow horizontally`)
      assert.equal(
        state.settingsScrollHorizontalOverflow,
        false,
        `${name} settings content must not overflow its scroll container horizontally`,
      )
      assert.equal(state.dialogInside, true, `${name} settings dialog must fit the viewport`)
      assert.deepEqual(state.clippedControls, [], `${name} visible controls must not clip labels: ${state.clippedControls.join(', ')}`)
      assert.deepEqual(state.clippedGroups, [], `${name} key control groups must not clip labels: ${state.clippedGroups.join(', ')}`)
      assert.deepEqual(state.clippedPlaceholders, [], `${name} empty input placeholders must fit their fields: ${state.clippedPlaceholders.join(', ')}`)
      assert.deepEqual(state.offCenterControls, [], `${name} centered button content must stay centered: ${state.offCenterControls.join(', ')}`)
      assert.deepEqual(state.smallActionTargets, [], `${name} visible action targets must be at least 28px: ${state.smallActionTargets.join(', ')}`)
      assert.deepEqual(state.mobileTouchTargets, [], `${name} mobile touch targets must be at least 44px: ${state.mobileTouchTargets.join(', ')}`)
      assert.deepEqual(state.overlappingControls, [], `${name} visible controls must not overlap: ${state.overlappingControls.join(', ')}`)
      assert.ok(state.controls > 0, `${name} must expose visible controls`)
    }

    const assertToastGeometry = async (name) => {
      const failures = await evaluate(`(() => {
        const settingsNav = document.querySelector('.zc-settings-nav')
        const settingsContentStart = settingsNav instanceof HTMLElement
          ? settingsNav.getBoundingClientRect().right + 8
          : 16
        const availableWidth = settingsNav instanceof HTMLElement
          ? innerWidth - settingsContentStart - 16
          : Math.min(480, innerWidth - 32)
        const minimumWidth = Math.min(280, availableWidth)
        const toasts = [...document.querySelectorAll('.zc-toast')].filter((toast) => {
          const style = getComputedStyle(toast)
          return style.display !== 'none' && style.visibility !== 'hidden'
        })
        const failures = innerWidth <= 480 && toasts.length > 1 ? ['too-many:' + toasts.length] : []
        return failures.concat(toasts.flatMap((toast) => {
          const box = toast.getBoundingClientRect()
          const issues = []
          if (box.width + 1 < minimumWidth) issues.push('too-narrow')
          if (box.left < 16 || box.right > innerWidth - 16) issues.push('out-of-bounds')
          return issues.length > 0 ? [issues.join(':')] : []
        }))
      })()`)
      assert.deepEqual(
        failures,
        [],
        `${name} toast messages must remain readable and inside the viewport: ${failures.join(', ')}`,
      )
    }

    const capture = async (name) => {
      await assertPageGeometry(name)
      await assertToastGeometry(name)
      await waitForPaint()
      await sleep(100)
      const index = screenshotIndex
      const result = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      })
      const fileName = `${String(index).padStart(2, '0')}-${name}-${viewport.width}x${viewport.height}.png`
      const buffer = Buffer.from(result.data, 'base64')
      const analysis = analyzePngScreenshot(buffer, viewport, name)
      const filePath = path.join(outputDir, fileName)
      await writeFile(filePath, buffer)
      screenshots.push({
        index,
        name,
        file: fileName,
        viewport: { ...viewport },
        analysis,
      })
      screenshotIndex += 1
      if (!summaryOnly) console.log(filePath)
    }

    const visual = (method, ...args) =>
      evaluate(`window.__zeroChatVisual.${method}(${args.map((value) => JSON.stringify(value)).join(', ')})`, true)

    const waitForSettingsViewportSettled = async () => {
      const settled = await evaluate(`new Promise((resolve) => {
        const scroll = document.querySelector('.zc-settings-scroll')
        if (!(scroll instanceof HTMLElement)) {
          resolve(false)
          return
        }
        let previous = scroll.scrollTop
        let stableFrames = 0
        const observe = () => {
          const current = scroll.scrollTop
          stableFrames = Math.abs(current - previous) <= 0.5 ? stableFrames + 1 : 0
          previous = current
          if (stableFrames >= 3) {
            resolve(true)
            return
          }
          requestAnimationFrame(observe)
        }
        requestAnimationFrame(observe)
      })`, true)
      assert.equal(settled, true, 'current Settings viewport must settle before target anchoring')
    }

    const anchorSettingsTarget = async (selector) => {
      await waitForSettingsViewportSettled()
      const anchored = await evaluate(`(() => {
        const scroll = document.querySelector('.zc-settings-scroll')
        const target = document.querySelector(${JSON.stringify(selector)})
        if (!(scroll instanceof HTMLElement) || !(target instanceof HTMLElement)) {
          return { valid: false, reason: 'missing-current-settings-target' }
        }
        const scrollBox = scroll.getBoundingClientRect()
        const targetBox = target.getBoundingClientRect()
        const desired = scroll.scrollTop + targetBox.top - scrollBox.top - 8
        scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, desired))
        scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
        return { valid: true, scrollTop: scroll.scrollTop }
      })()`)
      assert.equal(
        anchored.valid,
        true,
        `current Settings target must exist before anchoring: ${selector}`,
      )
      await waitForPaint()
      await waitForSettingsViewportSettled()
      const visible = await evaluate(`(() => {
        const scroll = document.querySelector('.zc-settings-scroll')
        const target = document.querySelector(${JSON.stringify(selector)})
        if (!(scroll instanceof HTMLElement) || !(target instanceof HTMLElement)) return false
        const scrollBox = scroll.getBoundingClientRect()
        const targetBox = target.getBoundingClientRect()
        return targetBox.top >= scrollBox.top - 1 &&
          targetBox.top <= scrollBox.top + 24 &&
          targetBox.bottom <= scrollBox.bottom + 1
      })()`)
      assert.equal(
        visible,
        true,
        `current Settings target must remain fully visible near the viewport top: ${selector}`,
      )
    }

    const assertCurrentPlaceholder = async (selector, expected) => {
      const actual = await evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('placeholder') ?? ''`)
      assert.equal(actual, expected, `${selector} must expose the current compact placeholder`)
    }

    const openLargeSkillLibrary = async (count = 241) => {
      const initialRenderCount = Math.min(80, count)
      let rendered = 0
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (attempt % 5 === 0) {
          await evaluate(`window.__zerochatAppTest.seedLargeSkillLibrary(${count})`, true)
        }
        rendered = await evaluate('document.querySelectorAll(".zc-skill-item").length')
        if (rendered >= initialRenderCount) break
        await sleep(50)
      }
      assert.ok(
        rendered >= initialRenderCount,
        `current large Skill fixture must render its first batch: ${rendered}/${initialRenderCount}`,
      )

      while (rendered < count) {
        const expectedCount = Math.min(rendered + 80, count)
        await visual('scrollSettings', 'bottom')
        await waitFor(
          `document.querySelectorAll(".zc-skill-item").length >= ${expectedCount}`,
        )
        rendered = await evaluate('document.querySelectorAll(".zc-skill-item").length')
      }
      assert.equal(rendered, count, 'current large Skill fixture must expose every row')
    }

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    const runtimeUrl = new URL(appUrl)
    runtimeUrl.searchParams.set('app-test', '1')
    appUrl = runtimeUrl.href
    const loadStart = cdp.events.length
    const navigation = await cdp.send('Page.navigate', { url: appUrl })
    await waitForMainFrameLoadCompletion(cdp.events, loadStart, navigation.frameId, {
      timeoutMs: 30_000,
    })
    await evaluate(visualSmokeScript())
    await waitFor('document.readyState === "complete"')
    await waitFor('Boolean(document.querySelector(".zc-app"))')
    await waitFor('Boolean(document.querySelector(".zc-empty-card"))')

    await setViewport(1440, 900)
    await capture('first-run-guide-desktop')
    await setViewport(390, 780, true)
    await capture('first-run-guide-mobile')

    await setViewport(320, 640, true)
    await visual('click', ['添加提供商', 'Add provider'])
    await waitFor('Boolean(document.querySelector(".zc-settings"))')
    await waitFor(`(() => {
      const scroll = document.querySelector('.zc-settings-scroll')
      const keyInput = document.querySelector('[data-provider-key-input="true"]')
      return scroll instanceof HTMLElement &&
        keyInput instanceof HTMLInputElement &&
        document.activeElement === keyInput &&
        scroll.scrollTop > 0
    })()`)
    const onboardingProviderKeyState = await evaluate(`(() => {
      const settings = document.querySelector('.zc-settings')
      const scroll = settings?.querySelector('.zc-settings-scroll')
      const providerTab = settings?.querySelector('#settings-tab-providers')
      const keyInput = settings?.querySelector('[data-provider-key-input="true"]')
      if (!(scroll instanceof HTMLElement) ||
          !(providerTab instanceof HTMLButtonElement) ||
          !(keyInput instanceof HTMLInputElement)) return { valid: false, reason: 'missing-current-provider-surface' }
      const scrollBox = scroll.getBoundingClientRect()
      const keyBox = keyInput.getBoundingClientRect()
      const valid = providerTab.classList.contains('active') &&
        document.activeElement === keyInput &&
        keyBox.width > 0 &&
        keyBox.height > 0 &&
        keyBox.top >= scrollBox.top - 1 &&
        keyBox.bottom <= scrollBox.bottom + 1 &&
        keyBox.left >= scrollBox.left - 1 &&
        keyBox.right <= scrollBox.right + 1
      return {
        valid,
        scrollTop: scroll.scrollTop,
        scroll: { top: scrollBox.top, bottom: scrollBox.bottom, height: scrollBox.height },
        key: { top: keyBox.top, bottom: keyBox.bottom, height: keyBox.height },
      }
    })()`)
    assert.equal(
      onboardingProviderKeyState.valid,
      true,
      `current first-run Provider entry must keep the first credential field visible in the compact Settings viewport: ${JSON.stringify(onboardingProviderKeyState)}`,
    )
    await setViewport(390, 780, true)
    await visual('clickTab', 'general')
    await visual('setSelectValue', 'fr-FR')
    await waitFor('document.documentElement.lang === "fr-FR"')
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')
    await capture('first-run-guide-fr-FR-mobile')

    await visual('click', ['添加提供商', 'Add provider'])
    await visual('clickTab', 'general')
    await visual('setSelectValue', 'ar-SA')
    await waitFor('document.documentElement.lang === "ar-SA" && document.documentElement.dir === "rtl"')
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')
    await capture('first-run-guide-ar-SA-mobile')

    await visual('click', ['إضافة مزود', '添加提供商', 'Add provider'])
    await visual('clickTab', 'general')
    await visual('setSelectValue', 'zh-CN')
    await waitFor('document.documentElement.lang === "zh-CN" && document.documentElement.dir === "ltr"')
    await visual('clickTab', 'providers')
    await waitFor('Boolean(document.querySelector(".zc-provider-card"))')
    await visual('focusProviderKey')
    await cdp.send('Input.insertText', { text: 'visual-audit-placeholder' })
    await sleep(120)
    const providerKeyState = await visual('saveProviderKey')
    assert.equal(
      providerKeyState.saveDisabled || providerKeyState.fieldShowsSavedState,
      true,
      `Provider credential save did not settle in the production settings view: ${JSON.stringify(providerKeyState)}`,
    )
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')

    await setViewport(320, 640, true)
    await capture('first-run-guide-compact-mobile')
    await setViewport(300, 620, true)
    await capture('first-run-guide-tiny-mobile')
    await setViewport(280, 560)
    const guideLayoutContentTightOnMicroViewport = await evaluate(`(() => {
      const card = document.querySelector('.zc-empty-card')
      if (!(card instanceof HTMLElement)) return false
      const children = [...card.children]
        .filter((child) => child instanceof HTMLElement && getComputedStyle(child).display !== 'none')
        .map((child) => child.getBoundingClientRect())
      if (children.length < 4) return false
      const maximumGap = children.slice(1).reduce(
        (largest, box, index) => Math.max(largest, box.top - children[index].bottom),
        0,
      )
      const cardBox = card.getBoundingClientRect()
      return maximumGap <= 24 &&
        children[0].top >= cardBox.top - 1 &&
        children.at(-1).bottom <= cardBox.bottom + 1 &&
        cardBox.top >= 0 &&
        cardBox.bottom <= innerHeight
    })()`)
    assert.equal(
      guideLayoutContentTightOnMicroViewport,
      true,
      'first-run content should not leave a large trailing blank gap on micro viewports',
    )
    await capture('first-run-guide-tiny-desktop')
    await setViewport(1440, 900)
    await capture('first-run-ready-desktop')
    await capture('guide-before-chat-desktop')
    await visual('click', ['开始使用', 'Start chatting'])
    await waitFor('Boolean(document.querySelector(".zc-composer textarea"))')
    await capture('chat-desktop')

    await setViewport(390, 780, true)
    await visual('clickSelector', '[data-zc-composer-mode="audio"]')
    await waitFor('Boolean(document.querySelector(\'[data-zc-audio-composer="true"]\'))')
    await capture('audio-composer-mobile')
    const compactAudioFileName =
      'visual-audit-audio-source-with-a-deliberately-long-filename-for-compact-layout.wav'
    await evaluate(`(() => {
      const input = document.querySelector('[data-zc-audio-composer="true"] input[type="file"]')
      if (!(input instanceof HTMLInputElement)) return false
      const transfer = new DataTransfer()
      transfer.items.add(new File(
        [new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69])],
        ${JSON.stringify(compactAudioFileName)},
        { type: 'audio/wav' },
      ))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    await waitFor(
      `document.querySelector('[data-zc-audio-composer="true"] .zc-audio-source-copy strong')?.textContent === ${JSON.stringify(compactAudioFileName)}`,
    )
    await setViewport(320, 640, true)
    const compactAudioFileNameBounded = await evaluate(`(() => {
      const panel = document.querySelector('[data-zc-audio-composer="true"]')
      const name = panel?.querySelector('.zc-audio-source-copy strong')
      const action = panel?.querySelector('[data-zc-audio-transcribe="true"]')
      if (!(panel instanceof HTMLElement) ||
          !(name instanceof HTMLElement) ||
          !(action instanceof HTMLButtonElement)) return false
      const panelBox = panel.getBoundingClientRect()
      const nameBox = name.getBoundingClientRect()
      const actionBox = action.getBoundingClientRect()
      return name.textContent === ${JSON.stringify(compactAudioFileName)} &&
        name.scrollWidth > name.clientWidth &&
        nameBox.left >= panelBox.left - 1 &&
        nameBox.right <= panelBox.right + 1 &&
        actionBox.left >= panelBox.left - 1 &&
        actionBox.right <= panelBox.right + 1 &&
        actionBox.bottom <= innerHeight + 1 &&
        !action.disabled
    })()`)
    assert.equal(
      compactAudioFileNameBounded,
      true,
      'compact audio composer must clip long source names without hiding transcription controls',
    )
    await capture('audio-composer-compact-mobile')
    await setViewport(260, 560)
    const audioComposerSubmissionVisible = await evaluate(`(() => {
      const panel = document.querySelector('[data-zc-audio-composer="true"]')
      const action = panel?.querySelector('[data-zc-audio-transcribe="true"]')
      if (!(panel instanceof HTMLElement) || !(action instanceof HTMLElement)) {
        return false
      }
      const panelBox = panel.getBoundingClientRect()
      const actionBox = action.getBoundingClientRect()
      const panelStyle = getComputedStyle(panel)
      return panelBox.left >= -1 &&
        panelBox.right <= innerWidth + 1 &&
        panelBox.top >= -1 &&
        panelBox.bottom <= innerHeight + 1 &&
        actionBox.left >= panelBox.left - 1 &&
        actionBox.right <= panelBox.right + 1 &&
        actionBox.top >= panelBox.top - 1 &&
        actionBox.bottom <= panelBox.bottom + 1 &&
        actionBox.bottom <= innerHeight + 1 &&
        panelStyle.overflowY === 'auto'
    })()`)
    assert.equal(
      audioComposerSubmissionVisible,
      true,
      'short-viewport audio composer must keep the transcription action visible',
    )
    await capture('audio-composer-micro-desktop')
    await visual('clickSelector', '[data-zc-composer-mode="chat"]')
    await waitFor('!document.querySelector(\'[data-zc-audio-composer="true"]\')')
    await setViewport(1440, 900)

    await visual('click', ['设置', 'Settings'])
    await waitFor('Boolean(document.querySelector(".zc-settings"))')
    await capture('settings-providers-desktop')
    await visual('clickTab', 'models')
    await waitFor('Boolean(document.querySelector(".zc-model-grid"))')
    await capture('settings-models-desktop')
    await visual('clickTab', 'skills')
    await waitFor('Boolean(document.querySelector(".zc-skill-editor"))')
    await capture('settings-skills-desktop')
    await openLargeSkillLibrary(241)
    await visual('scrollSettings', 'bottom')
    const largeSkillLibraryVisible = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.zc-skill-item')]
      const scroll = document.querySelector('.zc-settings-scroll')
      const last = rows.at(-1)
      if (!(scroll instanceof HTMLElement) || !(last instanceof HTMLElement)) return false
      const scrollBox = scroll.getBoundingClientRect()
      const lastBox = last.getBoundingClientRect()
      return rows.length === 241 &&
        last.textContent.includes('Visual Skill 241') &&
        lastBox.top >= scrollBox.top - 1 &&
        lastBox.bottom <= scrollBox.bottom + 1
    })()`)
    assert.equal(
      largeSkillLibraryVisible,
      true,
      'large Skill library must render all deterministic fixture rows and expose the final row',
    )
    await capture('settings-skills-large-desktop')
    await visual('scrollSettings', 'top')
    await visual('clickTab', 'sync')
    await waitFor('Boolean(document.querySelector(".zc-segmented"))')
    await capture('settings-sync-desktop')
    await visual('clickTab', 'data')
    await waitFor('Boolean(document.querySelector(".zc-settings-scroll input[type=password]"))')
    await capture('settings-data-desktop')
    await visual('clickTab', 'general')
    await visual('setCompact', true)
    await waitFor('document.querySelector(".zc-switch")?.getAttribute("aria-checked") === "true"')
    await capture('settings-general-compact-desktop')
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')
    await capture('chat-compact-preference-desktop')

    await visual('click', ['设置', 'Settings'])
    await visual('clickTab', 'general')
    await visual('setCompact', false)
    await visual('setSelectValue', 'ar-SA')
    await waitFor('document.documentElement.lang === "ar-SA" && document.documentElement.dir === "rtl"')
    await setViewport(390, 780, true)
    await capture('settings-general-rtl-mobile')
    for (const locale of supportedLocales) {
      await visual('setSelectValue', locale)
      await waitFor(`document.documentElement.lang === ${JSON.stringify(locale)}`)
      await capture(`settings-language-${locale}-mobile`)
    }
    await visual('setSelectValue', 'zh-CN')
    await waitFor('document.documentElement.lang === "zh-CN"')
    await visual('clickTab', 'providers')
    await visual('scrollSettings', 'bottom')
    await setViewport(390, 780, true)
    await capture('settings-providers-mobile')
    await setViewport(320, 640, true)
    const providerPresetSelectContracts = []
    let expectedProviderOptionValues = null
    for (const locale of supportedLocales) {
      await visual('clickTab', 'general')
      await visual('setSelectValue', locale)
      await waitFor(`document.documentElement.lang === ${JSON.stringify(locale)}`)
      await visual('clickTab', 'providers')
      await waitFor('Boolean(document.querySelector(".zc-settings-scroll select"))')
      await visual('scrollSettings', 'top')
      const providerPresetSelectContract = await evaluate(`(() => {
        const select = document.querySelector('.zc-settings-scroll select')
        if (!(select instanceof HTMLSelectElement)) {
          return { select: false, locale: document.documentElement.lang }
        }
        let changeEvents = 0
        const onChange = () => { changeEvents += 1 }
        select.addEventListener('change', onChange)
        select.focus({ focusVisible: true })
        select.dispatchEvent(new Event('change', { bubbles: true }))
        const box = select.getBoundingClientRect()
        const scroll = select.closest('.zc-settings-scroll')?.getBoundingClientRect()
        const style = getComputedStyle(select)
        const options = [...select.options]
        const optionValues = options.map((option) => option.value)
        const optionLabels = options.map((option) => option.textContent.trim())
        const labelMeasure = document.createElement('span')
        labelMeasure.style.position = 'absolute'
        labelMeasure.style.visibility = 'hidden'
        labelMeasure.style.display = 'inline-block'
        labelMeasure.style.whiteSpace = 'nowrap'
        labelMeasure.style.pointerEvents = 'none'
        for (const property of [
          'fontFamily',
          'fontSize',
          'fontWeight',
          'fontStyle',
          'fontStretch',
          'lineHeight',
          'letterSpacing',
          'wordSpacing',
          'textTransform',
        ]) {
          labelMeasure.style[property] = style[property]
        }
        document.body.append(labelMeasure)
        const optionWidths = optionLabels.map((label) => {
          labelMeasure.textContent = label
          return labelMeasure.getBoundingClientRect().width
        })
        labelMeasure.remove()
        const maxLabelWidth = optionWidths.length > 0 ? Math.max(...optionWidths) : 0
        const horizontalInset = [
          style.paddingLeft,
          style.paddingRight,
          style.borderLeftWidth,
          style.borderRightWidth,
        ].reduce((total, value) => total + (parseFloat(value) || 0), 0)
        const disclosureAllowance = 24
        const requiredWidth = maxLabelWidth + horizontalInset + disclosureAllowance
        const widestOptionIndex = optionWidths.indexOf(maxLabelWidth)
        const originalValue = select.value
        select.value = options[widestOptionIndex]?.value ?? originalValue
        const selectedLabel = select.selectedOptions[0]?.textContent?.trim() ?? ''
        const selectedLabelWidth = widestOptionIndex >= 0 ? optionWidths[widestOptionIndex] : 0
        select.value = originalValue
        select.removeEventListener('change', onChange)
        return {
          locale: document.documentElement.lang,
          select: true,
          focused: document.activeElement === select,
          changed: changeEvents === 1,
          touchTarget: box.width >= 44 && box.height >= 44,
          focusRing: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
          optionValues,
          optionLabels,
          optionWidths,
          optionLabelsNonEmpty: optionLabels.every(Boolean),
          optionLabelsUnique: new Set(optionLabels).size === optionLabels.length,
          selectedLabel,
          selectedLabelWidth,
          maxLabelWidth,
          horizontalInset,
          disclosureAllowance,
          requiredWidth,
          selectWidth: box.width,
          widthFits: box.width >= requiredWidth,
          focusRingInside: Boolean(scroll) &&
            box.left - 3 >= scroll.left - 1 &&
            box.right + 3 <= scroll.right + 1,
        }
      })()`)
      providerPresetSelectContracts.push(providerPresetSelectContract)
      assert.equal(
        providerPresetSelectContract.locale,
        locale,
        `provider preset select must render the requested locale: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      assert.equal(
        providerPresetSelectContract.select,
        true,
        `provider preset select must exist for ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      if (!expectedProviderOptionValues) {
        expectedProviderOptionValues = providerPresetSelectContract.optionValues
      }
      assert.deepEqual(
        providerPresetSelectContract.optionValues,
        expectedProviderOptionValues,
        `provider preset option values/order must stay stable in ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      assert.equal(
        providerPresetSelectContract.focused,
        true,
        `provider preset select must be focusable in ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      assert.equal(
        providerPresetSelectContract.changed,
        true,
        `provider preset select must dispatch change in ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      assert.equal(
        providerPresetSelectContract.touchTarget,
        true,
        `provider preset select must keep its touch target in ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      assert.equal(
        providerPresetSelectContract.focusRing,
        true,
        `provider preset select must keep its focus ring in ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      assert.equal(
        providerPresetSelectContract.optionLabelsNonEmpty,
        true,
        `provider preset option labels must be non-empty in ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      assert.equal(
        providerPresetSelectContract.optionLabelsUnique,
        true,
        `provider preset option labels must be unique in ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      assert.equal(
        providerPresetSelectContract.widthFits,
        true,
        `provider preset option labels must fit by measured pixels in ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
      assert.equal(
        providerPresetSelectContract.focusRingInside,
        true,
        `provider preset select focus ring must stay inside its scroll surface in ${locale}: ${JSON.stringify(providerPresetSelectContract)}`,
      )
    }
    assert.deepEqual(
      providerPresetSelectContracts.map((contract) => contract.locale),
      supportedLocales,
      'provider preset pixel coverage must include every supported locale',
    )
    await visual('clickTab', 'general')
    await visual('setSelectValue', 'zh-CN')
    await waitFor('document.documentElement.lang === "zh-CN"')
    await visual('clickTab', 'providers')
    await waitFor('Boolean(document.querySelector(".zc-settings-scroll select"))')
    await visual('scrollSettings', 'bottom')
    await capture('settings-providers-compact-mobile')
    await visual('scrollSettings', 'top')
    await setViewport(390, 780, true)
    await visual('clickTab', 'models')
    await capture('settings-models-mobile')
    await setViewport(320, 640, true)
    await capture('settings-models-compact-mobile')
    await setViewport(390, 780, true)
    await visual('clickTab', 'skills')
    await capture('settings-skills-mobile')
    await visual('clickTab', 'sync')
    await capture('settings-sync-mobile')
    await visual('clickTab', 'data')
    await capture('settings-data-mobile')
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')

    await setViewport(720, 760)
    await visual('setSidebarCollapsed', false)
    await capture('chat-narrow-desktop')
    await capture('sidebar-open-narrow-desktop')
    await visual('setSidebarCollapsed', true)
    await capture('sidebar-closed-narrow-desktop')
    await setViewport(390, 780, true)
    await capture('chat-mobile')
    await setViewport(320, 640, true)
    await capture('chat-compact-mobile')
    await setViewport(300, 620, true)
    await capture('chat-ultra-compact-mobile')
    await setViewport(280, 560)
    await capture('chat-tiny-desktop')
    await setViewport(260, 560)
    const compactChatTitleDefaultVisible = await evaluate(`(() => {
      const header = document.querySelector('.zc-chat-header')
      const title = header?.querySelector('.zc-chat-title span')
      const picker = header?.querySelector('.zc-model-picker')
      const buttons = [...(header?.querySelectorAll('.zc-icon-btn') ?? [])]
      if (!(header instanceof HTMLElement) ||
          !(title instanceof HTMLElement) ||
          !(picker instanceof HTMLElement) ||
          buttons.length !== 2 ||
          !buttons.every((button) => button instanceof HTMLButtonElement)) return false
      const headerBox = header.getBoundingClientRect()
      const pickerBox = picker.getBoundingClientRect()
      const controls = [title, picker, ...buttons]
      return title.textContent?.trim().length > 0 &&
        title.scrollWidth <= title.clientWidth + 1 &&
        headerBox.left >= -1 &&
        headerBox.right <= innerWidth + 1 &&
        pickerBox.left >= headerBox.left - 1 &&
        pickerBox.right <= headerBox.right + 1 &&
        controls.every((control) => {
          const box = control.getBoundingClientRect()
          return box.left >= headerBox.left - 1 && box.right <= headerBox.right + 1
        })
    })()`)
    assert.equal(
      compactChatTitleDefaultVisible,
      true,
      'current compact chat header should keep its short default conversation title fully visible',
    )
    await capture('chat-micro-desktop')
    await setViewport(320, 640, true)
    await visual('clickSelector', '[data-zc-composer-mode="image"]')
    await visual('click', ['编辑', 'Edit'])
    await evaluate(`(() => {
      const input = document.querySelector('.image-source-panel input[type="file"]')
      if (!(input instanceof HTMLInputElement)) return false
      const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=')
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'visual-image-source.png', { type: 'image/png' }))
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    await waitFor('document.querySelector(".image-source-preview")?.complete === true')
    const imageFeatureHintFitsCurrentChrome = await evaluate(`(() => {
      const header = document.querySelector('.zc-chat-header')
      const hint = document.querySelector('.zc-feature-hint[data-feature-hint="image"]')
      const composer = document.querySelector('.zc-composer-wrap')
      if (!(header instanceof HTMLElement) ||
          !(hint instanceof HTMLElement) ||
          !(composer instanceof HTMLElement)) return false
      const headerBox = header.getBoundingClientRect()
      const hintBox = hint.getBoundingClientRect()
      const composerBox = composer.getBoundingClientRect()
      return hintBox.width > 0 &&
        hintBox.height > 0 &&
        hintBox.top >= headerBox.bottom - 1 &&
        hintBox.bottom <= composerBox.top + 1 &&
        hintBox.left >= -1 &&
        hintBox.right <= innerWidth + 1
    })()`)
    assert.equal(
      imageFeatureHintFitsCurrentChrome,
      true,
      'current image feature hint must stay below the chat header, above the composer, and inside the compact viewport',
    )
    const imageShortViewportHeaderBounded = await evaluate(`(() => {
      const header = document.querySelector('.zc-chat-header')
      const picker = header?.querySelector('.zc-model-picker')
      const title = header?.querySelector('.zc-chat-title span')
      if (!(header instanceof HTMLElement) ||
          !(picker instanceof HTMLElement) ||
          !(title instanceof HTMLElement)) return false
      const headerBox = header.getBoundingClientRect()
      const pickerBox = picker.getBoundingClientRect()
      const titleBox = title.getBoundingClientRect()
      return pickerBox.left >= headerBox.left - 1 &&
        pickerBox.right <= headerBox.right + 1 &&
        titleBox.width >= 24 &&
        titleBox.left >= headerBox.left - 1 &&
        titleBox.right <= headerBox.right + 1
    })()`)
    assert.equal(
      imageShortViewportHeaderBounded,
      true,
      'short image edit viewports must keep the model picker and conversation title inside the current chat header',
    )
    await capture('image-edit-compact-mobile')
    await visual('click', ['局部重绘', 'Inpaint'])
    await waitFor('Boolean(document.querySelector(".mask-canvas"))')
    await setViewport(280, 560)
    const imageInpaintShortViewportBounded = await evaluate(`(() => {
      const composePanel = document.querySelector('.image-compose-panel')
      const panel = document.querySelector('.image-source-panel')
      const canvas = panel?.querySelector('.mask-canvas')
      const controls = panel?.querySelector('.mask-controls')
      if (!(composePanel instanceof HTMLElement) ||
          !(panel instanceof HTMLElement) ||
          !(canvas instanceof HTMLCanvasElement) ||
          !(controls instanceof HTMLElement)) return false
      composePanel.scrollTop = composePanel.scrollHeight
      const composePanelBox = composePanel.getBoundingClientRect()
      const panelBox = panel.getBoundingClientRect()
      const canvasBox = canvas.getBoundingClientRect()
      const controlsBox = controls.getBoundingClientRect()
      return panelBox.left >= -1 &&
        panelBox.right <= innerWidth + 1 &&
        canvasBox.width > 0 &&
        canvasBox.left >= panelBox.left - 1 &&
        canvasBox.right <= panelBox.right + 1 &&
        getComputedStyle(composePanel).overflowY === 'auto' &&
        composePanel.scrollHeight > composePanel.clientHeight &&
        controlsBox.top >= composePanelBox.top - 1 &&
        controlsBox.bottom <= composePanelBox.bottom + 1 &&
        controlsBox.bottom <= innerHeight + 1
    })()`)
    assert.equal(
      imageInpaintShortViewportBounded,
      true,
      'short image inpaint viewports must keep the source and mask controls inside the current composer',
    )
    await capture('image-inpaint-tiny-desktop')
    await visual('clickSelector', '[data-zc-composer-mode="chat"]')
    await setViewport(390, 780, true)
    await visual('setSidebarCollapsed', false)
    await capture('sidebar-open-mobile')

    const beforeCreate = await evaluate(
      'document.querySelectorAll(".zc-conv-item").length',
    )
    await visual('click', ['新会话', 'New chat'])
    await waitFor(
      `document.querySelectorAll(".zc-conv-item").length > ${beforeCreate} && Boolean(document.querySelector('.zc-conv-item .zc-conv-actions button:last-child:not([disabled])'))`,
    )
    await visual('setSidebarCollapsed', false)
    await waitFor(
      'Boolean(document.querySelector(".zc-sidebar:not(.collapsed)"))',
    )
    const beforeDelete = await evaluate('document.querySelectorAll(".zc-conv-item").length')
    await runActionWithExpectedConfirm(
      cdp,
      () => visual('clickFirstConversationDelete'),
      { expectedMessageFragments: ['删除', 'Delete'] },
    )
    await waitFor(`document.querySelectorAll(".zc-conv-item").length < ${beforeDelete}`)
    await capture('delete-conversation-mobile')
    await visual('setSidebarCollapsed', true)

    await setViewport(1024, 760)
    await visual('click', ['设置', 'Settings'])
    await visual('clickTab', 'general')
    await visual('setSelectValue', 'light')
    await waitFor('document.documentElement.dataset.theme === "light" || document.documentElement.classList.contains("light") || getComputedStyle(document.body).backgroundColor !== ""')
    await capture('settings-general-light-desktop')
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')
    await capture('chat-light-desktop')
    await visual('click', ['设置', 'Settings'])
    await visual('clickTab', 'data')
    await setViewport(280, 560)
    await visual('scrollSettings', 'bottom')
    const tinySettingsTooltipContract = await evaluate(`(() => {
      const tooltip = document.querySelector('.zc-app-tooltip')
      const back = document.querySelector('.zc-settings-back')
      if (!(tooltip instanceof HTMLElement) || !(back instanceof HTMLElement)) {
        return { visible: false, overlaps: [] }
      }
      const tooltipBox = tooltip.getBoundingClientRect()
      const overlaps = [...document.querySelectorAll(
        '.zc-settings-nav h2, .zc-settings-nav button, .zc-settings-body-header h3, .zc-settings-body-header button',
      )]
        .filter((element) => {
          if (element === back) return false
          const box = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return box.width > 0 && box.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden'
        })
        .filter((element) => {
          const box = element.getBoundingClientRect()
          return tooltipBox.left < box.right && tooltipBox.right > box.left &&
            tooltipBox.top < box.bottom && tooltipBox.bottom > box.top
        })
        .map((element) =>
          (element.textContent || element.getAttribute('aria-label') || element.tagName)
            .replace(/\s+/g, ' ')
            .trim(),
        )
      return { visible: true, overlaps }
    })()`)
    assert.deepEqual(
      tinySettingsTooltipContract,
      { visible: false, overlaps: [] },
      `compact Settings back control must not show an overlapping redundant tooltip: ${JSON.stringify(tinySettingsTooltipContract)}`,
    )
    await capture('settings-data-tiny-desktop')
    await setViewport(260, 560)
    await capture('settings-data-micro-desktop')
    await setViewport(780, 390, true)
    await capture('settings-data-light-mobile-landscape')
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')
    await capture('chat-light-mobile-landscape')

    const captureFixture = async (name, width, direction, kind) => {
      await setViewport(width, 560)
      const isBoot = kind === 'boot'
      const rootClass = isBoot ? 'zc-boot' : 'zc-empty'
      const cardClass = isBoot ? 'zc-boot-card' : 'zc-empty-card guide-modal'
      const titleTag = isBoot ? 'div' : 'h1'
      const titleText = isBoot ? 'ZeroChat' : 'Add a provider'
      const bodyText = isBoot ? 'Loading' : 'Connect a provider to start chatting.'
      await evaluate(`(() => {
        document.querySelector('[data-visual-fixture]')?.remove()
        const root = document.createElement('section')
        root.dataset.visualFixture = 'true'
        root.dir = ${JSON.stringify(direction)}
        root.className = ${JSON.stringify(rootClass)}
        Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '2147483647' })
        const card = document.createElement('div')
        card.className = ${JSON.stringify(cardClass)}
        const title = document.createElement(${JSON.stringify(titleTag)})
        title.textContent = ${JSON.stringify(titleText)}
        const body = document.createElement('p')
        body.textContent = ${JSON.stringify(bodyText)}
        if (${isBoot}) {
          const logo = document.createElement('img')
          logo.src = '/favicon.svg'
          logo.alt = ''
          card.append(logo, title, body)
        } else {
          card.append(title, body)
        }
        if (!${isBoot}) {
          const button = document.createElement('button')
          button.className = 'zc-btn primary'
          button.textContent = 'Add provider'
          card.append(button)
        }
        root.append(card)
        document.body.append(root)
        return true
      })()`)
      await capture(name)
      await evaluate('document.querySelector("[data-visual-fixture]")?.remove()')
    }
    await captureFixture('startup-loading-ultra-narrow-260', 260, 'ltr', 'boot')
    await captureFixture('startup-loading-ultra-narrow-240', 240, 'rtl', 'boot')
    await setViewport(320, 640, true)
    await evaluate(`(() => {
      document.querySelector('[data-visual-fixture]')?.remove()
      const root = document.createElement('section')
      root.dataset.visualFixture = 'true'
      root.className = 'zc-empty provider-empty-state'
      Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '2147483647' })
      const card = document.createElement('div')
      card.className = 'zc-empty-card guide-modal'
      const title = document.createElement('h1')
      title.textContent = 'Add your first AI provider'
      const body = document.createElement('p')
      body.textContent = 'Choose a provider and store its key locally.'
      const button = document.createElement('button')
      button.className = 'zc-btn primary'
      button.textContent = 'Add provider'
      card.append(title, body, button)
      root.append(card)
      document.body.append(root)
      return true
    })()`)
    const providerEmptyPrimaryActionNearTop = await evaluate(`(() => {
      const empty = document.querySelector('.zc-empty.provider-empty-state')
      const card = empty?.querySelector('.zc-empty-card')
      const action = card?.querySelector('button')
      if (!(empty instanceof HTMLElement) ||
          !(card instanceof HTMLElement) ||
          !(action instanceof HTMLButtonElement)) return false
      const cardBox = card.getBoundingClientRect()
      const actionBox = action.getBoundingClientRect()
      return getComputedStyle(empty).alignContent === 'start' &&
        cardBox.top >= 40 &&
        cardBox.top <= 72 &&
        actionBox.bottom <= innerHeight * 0.5
    })()`)
    assert.equal(
      providerEmptyPrimaryActionNearTop,
      true,
      'provider empty state should keep first-provider setup near the top on compact screens',
    )
    await capture('provider-empty-state-compact-mobile')
    await evaluate('document.querySelector("[data-visual-fixture]")?.remove()')

    await setViewport(320, 640, true)
    await visual('setSidebarCollapsed', false)
    await visual('click', ['设置', 'Settings'])
    await visual('clickTab', 'skills')
    await openLargeSkillLibrary(241)
    await visual('scrollSettings', 'bottom')
    await capture('settings-skills-large-library-compact-mobile')

    await visual('clickTab', 'sync')
    await visual('click', ['Cloudflare Worker'])
    await waitFor('Boolean(document.querySelector("[data-zc-cloudflare-worker-endpoint=true]"))')
    await anchorSettingsTarget('[data-zc-cloudflare-worker-endpoint="true"]')
    await assertCurrentPlaceholder(
      '[data-zc-cloudflare-worker-endpoint="true"] input',
      'https://…',
    )
    await capture('settings-sync-cloudflare-compact-mobile')

    await visual('clickTab', 'data')
    await anchorSettingsTarget('[data-zc-sync-passphrase="true"]')
    await assertCurrentPlaceholder('[data-zc-sync-passphrase="true"]', '输入密码')
    await capture('settings-data-compact-mobile')
    const savedVisualPassphrase = await visual(
      'saveDataPassphrase',
      'visual-audit-passphrase',
    )
    assert.deepEqual(
      savedVisualPassphrase,
      { fieldCleared: true, saveDisabled: true },
      'current data passphrase must persist before access-key visual evidence',
    )

    await visual('clickTab', 'sync')
    await waitFor('Boolean(document.querySelector("[data-zc-cloudflare-access-key=true]"))')
    await anchorSettingsTarget('[data-zc-cloudflare-access-key="true"]')
    await assertCurrentPlaceholder(
      '[data-zc-cloudflare-access-key="true"] input',
      '自动生成',
    )
    await capture('settings-sync-cloudflare-access-compact-mobile')

    await visual('clickTab', 'data')
    await setViewport(260, 560)
    await visual('scrollSettings', 'bottom')
    const tinySettingsToastContract = await evaluate(`(() => {
      const toast = [...document.querySelectorAll('.zc-toast')].find((candidate) => {
        const style = getComputedStyle(candidate)
        return style.display !== 'none' && style.visibility !== 'hidden'
      })
      const nav = document.querySelector('.zc-settings-nav')
      if (!(toast instanceof HTMLElement) || !(nav instanceof HTMLElement)) {
        return { visible: false, overlaps: [] }
      }
      const toastBox = toast.getBoundingClientRect()
      const overlaps = [...nav.querySelectorAll('h2, button')]
        .filter((element) => {
          const box = element.getBoundingClientRect()
          return toastBox.left < box.right && toastBox.right > box.left &&
            toastBox.top < box.bottom && toastBox.bottom > box.top
        })
        .map((element) => element.textContent?.trim() || element.tagName.toLowerCase())
      return { visible: true, overlaps }
    })()`)
    assert.deepEqual(
      tinySettingsToastContract.overlaps,
      [],
      `compact Settings toast must not cover navigation chrome: ${JSON.stringify(tinySettingsToastContract)}`,
    )
    await capture('danger-actions-micro-desktop')
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')

    await setViewport(390, 780, true)
    await visual('setSidebarCollapsed', true)
    await waitForSidebarClosed()
    await visual('clickSelector', '[data-zc-composer-mode="image"]')
    await waitFor('Boolean(document.querySelector("[data-zc-composer-mode=image][aria-pressed=true]"))')
    const lateImageSourceLoaded = await evaluate(`(() => {
      const input = document.querySelector('.image-source-panel input[type="file"]')
      if (!(input instanceof HTMLInputElement)) return false
      const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=')
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'visual-late-image-source.png', { type: 'image/png' }))
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    assert.equal(lateImageSourceLoaded, true, 'late inpaint evidence must load its image source through the production file input')
    await waitFor('document.querySelector(".image-source-preview")?.complete === true && document.querySelector(".image-source-preview")?.naturalWidth > 0')
    await visual('click', ['局部重绘', 'Inpaint'])
    await waitFor('Boolean(document.querySelector(".zc-image-task-modes button[aria-pressed=true]"))')
    await waitFor('Boolean(document.querySelector(".mask-canvas")?.getBoundingClientRect().width)')
    await waitForSidebarClosed()
    const imageInpaintSurface = await evaluate(`(() => {
      const canvas = document.querySelector('.mask-canvas')
      const sidebar = document.querySelector('.zc-sidebar')
      const backdrop = document.querySelector('.zc-sidebar-backdrop')
      const visibleRectFor = ${renderedVisibleRect.toString()}
      const visibleRectForElement = (element) => {
        if (!(element instanceof HTMLElement)) return false
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return null
        }
        return visibleRectFor(element)
      }
      const snapshot = (element) => {
        if (!(element instanceof HTMLElement)) return null
        const box = element.getBoundingClientRect()
        return {
          box: {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          },
          visibleRect: visibleRectForElement(element),
        }
      }
      return {
        canvasVisible: Boolean(visibleRectForElement(canvas)),
        sidebarVisible: Boolean(visibleRectForElement(sidebar)),
        backdropVisible: Boolean(visibleRectForElement(backdrop)),
        canvas: snapshot(canvas),
        sidebar: snapshot(sidebar),
        backdrop: snapshot(backdrop),
      }
    })()`)
    assert.equal(
      imageInpaintSurface.canvasVisible,
      true,
      `image inpaint evidence must expose a visible canvas: ${JSON.stringify(imageInpaintSurface)}`,
    )
    assert.equal(
      imageInpaintSurface.sidebarVisible,
      false,
      `image inpaint evidence must not show a mobile sidebar overlay: ${JSON.stringify(imageInpaintSurface)}`,
    )
    assert.equal(
      imageInpaintSurface.backdropVisible,
      false,
      `image inpaint evidence must not show a mobile sidebar backdrop: ${JSON.stringify(imageInpaintSurface)}`,
    )
    await capture('image-inpaint-mobile')
    await visual('clickSelector', '[data-zc-composer-mode="chat"]')

    await setViewport(1440, 900)
    await visual('setSidebarCollapsed', false)
    await visual('click', ['设置', 'Settings'])
    await visual('clickTab', 'skills')
    await openLargeSkillLibrary(241)
    const skillEditOpened = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.zc-skill-item')].at(-1)
      const edit = row?.querySelector('.zc-icon-btn:not(.danger)')
      if (!(edit instanceof HTMLButtonElement)) return false
      edit.click()
      return true
    })()`)
    assert.equal(skillEditOpened, true, 'current large Skill row must expose its edit action')
    await waitFor(
      'document.querySelector(".zc-skill-editor input")?.value === "Visual Skill 241"',
    )
    await anchorSettingsTarget('.zc-skill-editor')
    await capture('settings-skills-edit-desktop')
    await setViewport(320, 640, true)
    await anchorSettingsTarget('.zc-skill-editor')
    await capture('settings-skills-edit-mobile')
    await visual('clickSelector', '.zc-skill-editor .zc-icon-btn')
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')

    await setViewport(320, 640, true)
    await visual('setSidebarCollapsed', false)
    await visual('click', ['设置', 'Settings'])
    await visual('clickTab', 'general')
    for (const locale of supportedLocales) {
      await visual('setSelectValue', locale)
      await waitFor(`document.documentElement.lang === ${JSON.stringify(locale)}`)
      await capture(`settings-language-${locale}-compact-mobile`)
    }
    await visual('setSelectValue', 'zh-CN')
    await visual('clickSelector', '.zc-settings-back')
    await waitFor('!document.querySelector(".zc-settings")')
    await visual('setSidebarCollapsed', true)

    await setViewport(390, 780, true)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    })
    await visual('focusComposer')
    await cdp.send('Input.insertText', { text: 'visual audit offline probe' })
    const offline = await visual('submitOfflineProbe')
    assert.ok(offline.queued >= 1, `Offline queue did not render a queued message: ${JSON.stringify(offline)}`)
    await visual('dismissToast')
    await capture('chat-offline-queue-mobile')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    })

    assert.equal(screenshots.length, expectedScreenshotCount, 'Visual audit screenshot count changed')
    assert.deepEqual(errors, [], `Production page raised runtime exceptions: ${errors.join('; ')}`)
    await writeVisualGallery(outputDir, screenshots)
    const contactSheet = await writeVisualContactSheet(cdp, outputDir, evaluate)
    const manifest = {
      kind: 'zerochat.visualAudit',
      version: 2,
      entry: 'src/app/bootstrap.tsx',
      appUrl,
      expectedScreenshotCount,
      screenshotCount: screenshots.length,
      screenshots,
      gallery: 'visual-audit-gallery.html',
      contactSheet: 'visual-audit-contact-sheet.jpg',
      contactSheetEvidence: contactSheet,
      generatedAt: new Date().toISOString(),
    }
    await writeFile(
      path.join(outputDir, 'visual-audit-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    )
    console.log(
      `Visual audit passed: ${screenshots.length} screenshots, ${path.resolve(outputDir)}`,
    )
  } finally {
    cdp?.close()
    const profileCleanup = {
      removeProfile: async () => await removeBrowserProfileWithRetry(profileDir, 120),
    }
    const { profileRemoved } = await settleBrowserRuntimeCleanup({
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
    assert.equal(profileRemoved, true, `Visual audit browser profile cleanup failed: ${profileDir}`)
  }
}

await main()
