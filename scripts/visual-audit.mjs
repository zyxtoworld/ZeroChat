import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'
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

const rawArgs = process.argv.slice(2)
const visualAuditSummaryOnly =
  rawArgs.includes('--summary') || process.env.ZEROCHAT_VISUAL_SUMMARY_ONLY === '1'

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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run visual audit.')
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  if (upDistance <= upperLeftDistance) return up
  return upperLeft
}

function pngChannels(colorType) {
  switch (colorType) {
    case 0:
    case 3:
      return 1
    case 2:
      return 3
    case 4:
      return 2
    case 6:
      return 4
    default:
      throw new Error(`Unsupported PNG color type: ${colorType}`)
  }
}

function parsePng(buffer) {
  const signature = '89504e470d0a1a0a'

  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Screenshot is not a PNG')
  }

  let offset = 8
  let ihdr = null
  let palette = null
  const idatParts = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + length

    if (chunkEnd + 4 > buffer.length) {
      throw new Error(`PNG chunk is truncated: ${type}`)
    }

    const data = buffer.subarray(chunkStart, chunkEnd)

    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
      }
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'IDAT') {
      idatParts.push(data)
    } else if (type === 'IEND') {
      break
    }

    offset = chunkEnd + 4
  }

  if (!ihdr) throw new Error('PNG is missing IHDR')
  if (idatParts.length === 0) throw new Error('PNG is missing IDAT')

  return {
    ...ihdr,
    idat: Buffer.concat(idatParts),
    palette,
  }
}

function samplePngPixel(row, x, channels, colorType, palette) {
  const offset = x * channels

  if (colorType === 0) {
    const value = row[offset]
    return `${value},${value},${value},255`
  }

  if (colorType === 2) {
    return `${row[offset]},${row[offset + 1]},${row[offset + 2]},255`
  }

  if (colorType === 3) {
    const paletteOffset = row[offset] * 3
    if (!palette || paletteOffset + 2 >= palette.length) return '0,0,0,255'
    return `${palette[paletteOffset]},${palette[paletteOffset + 1]},${palette[paletteOffset + 2]},255`
  }

  if (colorType === 4) {
    const value = row[offset]
    return `${value},${value},${value},${row[offset + 1]}`
  }

  return `${row[offset]},${row[offset + 1]},${row[offset + 2]},${row[offset + 3]}`
}

function analyzePngScreenshot(buffer, expectedViewport, name) {
  const png = parsePng(buffer)

  assert.equal(
    png.width,
    expectedViewport.width,
    `${name} screenshot width should match the audited viewport`,
  )
  assert.equal(
    png.height,
    expectedViewport.height,
    `${name} screenshot height should match the audited viewport`,
  )
  assert.equal(png.bitDepth, 8, `${name} screenshot should use 8-bit PNG samples`)

  const channels = pngChannels(png.colorType)
  const bytesPerPixel = channels
  const rowLength = png.width * channels
  const inflated = inflateSync(png.idat)
  const expectedLength = (rowLength + 1) * png.height

  assert.ok(
    inflated.length >= expectedLength,
    `${name} screenshot pixel payload is shorter than expected`,
  )

  const sampleStep = Math.max(1, Math.floor((png.width * png.height) / 8000))
  const colors = new Set()
  let previousRow = Buffer.alloc(rowLength)
  let offset = 0
  let pixelIndex = 0

  for (let y = 0; y < png.height; y += 1) {
    const filterType = inflated[offset]
    offset += 1
    const source = inflated.subarray(offset, offset + rowLength)
    offset += rowLength
    const row = Buffer.alloc(rowLength)

    for (let x = 0; x < rowLength; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0
      const up = previousRow[x] ?? 0
      const upperLeft = x >= bytesPerPixel ? previousRow[x - bytesPerPixel] : 0

      if (filterType === 0) {
        row[x] = source[x]
      } else if (filterType === 1) {
        row[x] = (source[x] + left) & 0xff
      } else if (filterType === 2) {
        row[x] = (source[x] + up) & 0xff
      } else if (filterType === 3) {
        row[x] = (source[x] + Math.floor((left + up) / 2)) & 0xff
      } else if (filterType === 4) {
        row[x] = (source[x] + paethPredictor(left, up, upperLeft)) & 0xff
      } else {
        throw new Error(`${name} screenshot uses unsupported PNG filter: ${filterType}`)
      }
    }

    for (let x = 0; x < png.width; x += 1) {
      if (pixelIndex % sampleStep === 0) {
        colors.add(samplePngPixel(row, x, channels, png.colorType, png.palette))
      }
      pixelIndex += 1

      if (colors.size >= 256) break
    }

    previousRow = row
  }

  assert.ok(
    colors.size >= 16,
    `${name} screenshot appears blank or visually collapsed (${colors.size} sampled colors)`,
  )

  return {
    bytes: buffer.length,
    colorType: png.colorType,
    distinctSampledColors: colors.size,
  }
}

async function readJson(url, init) {
  return readCdpJson(url, init)
}

function connect(wsUrl) {
  return connectCdp(wsUrl)
}

async function waitForChrome(port, chromeProcess) {
  return waitForCdpChrome(port, {
    childProcess: chromeProcess,
    timeoutMs: 30_000,
  })
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

const i18nSourceText = await readFile('src/i18n.ts', 'utf8')
const supportedLocales = extractSupportedLocales(i18nSourceText)
const compactLanguageLocales = supportedLocales.map((locale) => [
  locale,
  localeDirection(locale),
])
const visualAuditBaseScreenshotCount = 108
const expectedScreenshotCount =
  visualAuditBaseScreenshotCount + compactLanguageLocales.length
const chromePath = await resolveChromePath()
const cdpPort = await resolveFetchSafeLoopbackPort(
  process.env.ZEROCHAT_VISUAL_CDP_PORT,
  'Visual audit Chrome remote debugging',
)
const providedAppUrl = process.env.ZEROCHAT_VISUAL_URL
let appUrl = providedAppUrl ?? ''
const profileDir = path.join(os.tmpdir(), `zerochat-visual-audit-${Date.now()}`)
const outputDir = path.resolve(process.env.ZEROCHAT_VISUAL_DIR ?? '.visual-audit')
let screenshotIndex = 1
let currentViewport = { width: 1440, height: 900 }
const screenshotRecords = []

async function cleanOutputScreenshots(directory) {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory, { withFileTypes: true })

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.toLowerCase().endsWith('.png') ||
            entry.name === 'visual-audit-contact-sheet.jpg' ||
            entry.name === 'visual-audit-gallery.html' ||
            entry.name === 'visual-audit-manifest.json'),
      )
      .map((entry) => rm(path.join(directory, entry.name), { force: true })),
  )
}

async function writeVisualGallery(directory, records) {
  const cards = records
    .map((record) => {
      const title = `${String(record.index).padStart(2, '0')}. ${record.name}`
      const size = `${record.viewport.width}x${record.viewport.height}`
      const quality = `${record.analysis.distinctSampledColors} colors · ${Math.round(
        record.analysis.bytes / 1024,
      )} KB`

      return `
        <figure class="shot">
          <a href="${escapeHtml(record.file)}" target="_blank" rel="noreferrer">
            <img src="${escapeHtml(record.file)}" alt="${escapeHtml(title)}" loading="lazy">
          </a>
          <figcaption>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(`${size} · ${quality}`)}</span>
          </figcaption>
        </figure>`
    })
    .join('\n')

  await writeFile(
    path.join(directory, 'visual-audit-gallery.html'),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZeroChat Visual Audit</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #101511;
      color: #e5ece5;
    }

    body {
      margin: 0;
      padding: 24px;
    }

    header {
      max-width: 1120px;
      margin: 0 auto 20px;
    }

    h1 {
      margin: 0 0 6px;
      font-size: 22px;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: #aeb8ad;
      line-height: 1.5;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
      max-width: 1900px;
      margin: 0 auto;
    }

    .shot {
      margin: 0;
      border: 1px solid #283229;
      border-radius: 8px;
      background: #151b16;
      overflow: hidden;
    }

    .shot a {
      display: block;
      background: #0b0f0c;
    }

    .shot img {
      display: block;
      width: 100%;
      height: 300px;
      object-fit: contain;
    }

    figcaption {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.35;
    }

    figcaption span {
      color: #9aa699;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <header>
    <h1>ZeroChat Visual Audit</h1>
    <p>Open each thumbnail to inspect the full-resolution screenshot. Review alignment, clipping, density, language expansion, RTL, sidebars, dialogs, and compact mobile states before release.</p>
  </header>
  <main class="grid">
${cards}
  </main>
</body>
</html>
`,
    'utf8',
  )
}

async function writeVisualContactSheet(cdp, directory, evaluate) {
  const galleryUrl = pathToFileURL(path.join(directory, 'visual-audit-gallery.html')).href
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1960,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp.send('Page.navigate', { url: galleryUrl })
  await evaluate(
    `new Promise((resolve) => {
      const done = () => resolve(document.readyState)
      if (document.readyState === 'complete') done()
      else window.addEventListener('load', done, { once: true })
    })`,
    true,
  )
  await evaluate(
    `Promise.race([
      Promise.all(Array.from(document.images).map((image) => {
        image.loading = 'eager'
        if (image.complete && image.naturalWidth > 0) return true
        return new Promise((resolve, reject) => {
          image.addEventListener('load', () => resolve(true), { once: true })
          image.addEventListener('error', () => reject(new Error('Contact sheet image failed to load: ' + image.src)), { once: true })
        })
      })),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timed out while loading visual audit contact sheet images')), 10000)
      })
    ])`,
    true,
  )
  const metrics = await cdp.send('Page.getLayoutMetrics')
  const { width, height } = metrics.cssContentSize
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 82,
    fromSurface: true,
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: Math.ceil(width),
      height: Math.ceil(height),
      scale: 1,
    },
  })
  const contactSheetPath = path.join(directory, 'visual-audit-contact-sheet.jpg')
  const contactSheet = Buffer.from(result.data, 'base64')
  await writeFile(contactSheetPath, contactSheet)

  return {
    path: path.resolve(contactSheetPath),
    bytes: contactSheet.length,
    sha256: createHash('sha256').update(contactSheet).digest('hex').toUpperCase(),
    width: Math.ceil(width),
    height: Math.ceil(height),
  }
}

await mkdir(profileDir, { recursive: true })
await cleanOutputScreenshots(outputDir)

let devServer = null
if (!providedAppUrl) {
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
  {
    stdio: 'ignore',
    windowsHide: true,
  },
)

async function main() {
  await waitForChrome(cdpPort, chrome)

  const target = await readJson(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(appUrl)}`,
    { method: 'PUT' },
  )
  const cdp = await connect(target.webSocketDebuggerUrl)
  const screenshots = []
  const errors = []

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
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      true,
    )
  }
  const waitForDeferredSettingsScroll = async () => {
    await evaluate(`new Promise((resolve) => setTimeout(resolve, 0))`, true)
    await waitForPaint()
  }

  const setViewport = async (width, height, mobile = false) => {
    currentViewport = { width, height }
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    })
    await sleep(180)
    await waitForPaint()
  }

  const assertViewportFit = async (name) => {
    const metrics = await evaluate(`(() => {
      const modal = document.querySelector('.modal')
      const modalBox = modal?.getBoundingClientRect()
      const scope = modal ?? document
      const actionSelector = [
        'button',
        '[role="button"]',
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
      const groupSelector = [
        '.composer-toolbar',
        '.image-mode-tabs',
        '.segmented',
        '.mode-grid',
        '.modal-actions',
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
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          !hiddenBehindSticky
        )
      }
      const textOf = (element) =>
        (element.textContent ?? '')
          .replace(/\\s+/g, ' ')
          .trim()
      const labelFor = (element) =>
        (
          textOf(element) ||
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          (typeof element.className === 'string' ? element.className : '') ||
          element.tagName.toLowerCase()
        )
          .replace(/\\s+/g, ' ')
          .trim()
          .slice(0, 80)
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
      const clippedControls = Array.from(scope.querySelectorAll(actionSelector))
        .filter((element) => isVisible(element) && !element.classList.contains('sidebar-backdrop'))
        .filter((element) => textOf(element) && !element.classList.contains('icon-button'))
        .filter(clipsContent)
        .map(labelFor)
      const clippedGroups = Array.from(scope.querySelectorAll(groupSelector))
        .filter(isVisible)
        .filter(clipsContent)
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
          return (
            labelFor(element) +
            ' placeholder "' +
            placeholder +
            '" in ' +
            Math.round(box.width) +
            'px'
          )
        })
      const measuredActions = Array.from(scope.querySelectorAll(actionSelector)).filter(
        (element) =>
          isVisible(element) &&
          !element.classList.contains('sidebar-backdrop') &&
          !element.closest('[aria-hidden="true"]'),
      )
      const measuredControls = Array.from(
        scope.querySelectorAll(actionSelector + ',' + fieldSelector),
      ).filter(
        (element) =>
          isVisible(element) &&
          !element.classList.contains('sidebar-backdrop') &&
          !element.closest('[aria-hidden="true"]'),
      )
      const smallTargets = measuredActions
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
        .map((element) => {
          const box = element.getBoundingClientRect()
          return (
            labelFor(element) +
            ' (' +
            Math.round(box.width * 10) / 10 +
            'x' +
            Math.round(box.height * 10) / 10 +
            'px)'
          )
        })
      const overlappingControls = []
      const controlBoxes = measuredControls.map((element) => ({
        element,
        label: labelFor(element),
        rect: visibleRectFor(element),
      })).filter((item) => item.rect)

      for (let leftIndex = 0; leftIndex < controlBoxes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < controlBoxes.length; rightIndex += 1) {
          const left = controlBoxes[leftIndex]
          const right = controlBoxes[rightIndex]

          if (left.element.contains(right.element) || right.element.contains(left.element)) {
            continue
          }

          const xOverlap =
            Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left)
          const yOverlap =
            Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top)

          if (xOverlap > 2 && yOverlap > 2) {
            overlappingControls.push(
              left.label +
                ' <> ' +
                right.label +
                ' (' +
                Math.round(xOverlap * 10) / 10 +
                'x' +
                Math.round(yOverlap * 10) / 10 +
                'px)',
            )
          }
        }
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
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0'
        ) {
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
      const offCenterControls = Array.from(scope.querySelectorAll(centeredControlSelector))
        .filter((element) => isVisible(element) && textOf(element))
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
            ? labelFor(element) +
                ' (' +
                Math.round(dx * 10) / 10 +
                'px x, ' +
                Math.round(dy * 10) / 10 +
                'px y)'
            : null
        })
        .filter(Boolean)

      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body?.scrollWidth ?? 0,
        horizontalOverflow:
          document.documentElement.scrollWidth > window.innerWidth + 1 ||
          (document.body?.scrollWidth ?? 0) > window.innerWidth + 1,
        modalOutOfBounds: modalBox
          ? modalBox.left < -1 ||
            modalBox.right > window.innerWidth + 1 ||
            modalBox.top < -1 ||
            modalBox.bottom > window.innerHeight + 1
          : false,
        clippedControls,
        clippedGroups,
        clippedPlaceholders,
        smallTargets,
        overlappingControls,
        offCenterControls,
        modalBackgroundIsolated: (() => {
          if (!modal) return true

          const main = document.querySelector('.chat-pane')
          const sidebar = document.querySelector('.sidebar')

          return Boolean(
            main?.getAttribute('aria-hidden') === 'true' &&
              main.hasAttribute('inert') &&
              sidebar?.getAttribute('aria-hidden') === 'true' &&
              sidebar.hasAttribute('inert'),
          )
        })(),
        guideSyncModeButtonsReachable: (() => {
          const guide = document.querySelector('.guide-modal')
          if (!guide) return true

          const buttons = Array.from(guide.querySelectorAll('.mode-grid button'))
          const layout = guide.querySelector('.guide-layout')
          const syncPanel = guide.querySelector('.guide-sync-panel')
          if (buttons.length !== 3 || !layout || !syncPanel) return false

          const layoutBox = layout.getBoundingClientRect()
          const syncBox = syncPanel.getBoundingClientRect()
          const syncBottomInScrollArea =
            syncBox.bottom - layoutBox.top + layout.scrollTop

          return (
            buttons.every((button) => {
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

          const providerBeforeSyncInDom = Boolean(
            providerFields.compareDocumentPosition(syncPanel) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          )

          return (
            providerBeforeSyncInDom &&
            providerFields.getBoundingClientRect().top <=
              syncPanel.getBoundingClientRect().top
          )
        })(),
        guideProviderChoicesReachable: (() => {
          const guide = document.querySelector('.guide-modal')
          if (!guide) return true

          const layout = guide.querySelector('.guide-layout')
          const select = guide.querySelector('.guide-provider-select-row select')
          const customRelayStrip = guide.querySelector('.guide-custom-relays')
          const selectValues = Array.from(select?.options ?? []).map(
            (option) => option.value,
          )
          if (!layout || !select || customRelayStrip !== null) return false

          const layoutBox = layout.getBoundingClientRect()
          const selectBox = select.getBoundingClientRect()
          const selectStyle = getComputedStyle(select)
          const selectBottomInScrollArea =
            selectBox.bottom - layoutBox.top + layout.scrollTop

          return (
            selectStyle.display !== 'none' &&
            selectStyle.visibility !== 'hidden' &&
            selectBox.width >= 28 &&
            selectBox.height >= 28 &&
            selectBottomInScrollArea <= layout.scrollHeight + 1 &&
            selectValues.length >= 20 &&
            selectValues.includes('custom-openai-relay')
          )
        })(),
        guideActionsInsideViewport: (() => {
          const actions = document
            .querySelector('.guide-modal .modal-actions')
            ?.getBoundingClientRect()

          return actions ? actions.top >= -1 && actions.bottom <= window.innerHeight + 1 : true
        })(),
        guideActionsStackOnMicroViewport: (() => {
          if (window.innerWidth > 300) return true

          const actionsElement = document.querySelector('.guide-modal .modal-actions')
          if (!actionsElement) return true

          const actionBox = actionsElement.getBoundingClientRect()
          const buttons = Array.from(
            actionsElement.querySelectorAll('button, label.file-button'),
          ).filter(isVisible)

          if (buttons.length < 2) return true

          const buttonBoxes = buttons.map((button) => button.getBoundingClientRect())
          const fullWidth = buttonBoxes.every((box) => box.width >= actionBox.width - 2)
          const stacked = buttonBoxes.every((box, index) => {
            if (index === 0) return true

            return box.top >= buttonBoxes[index - 1].bottom - 1
          })

          return fullWidth && stacked
        })(),
        guideLayoutContentTightOnMicroViewport: (() => {
          if (window.innerWidth > 300) return true

          const layout = document.querySelector('.guide-modal .guide-layout')
          if (!layout || !isVisible(layout)) return true

          if (layout.scrollHeight > layout.clientHeight + 2) return true

          const childBoxes = Array.from(layout.children)
            .filter(isVisible)
            .map((child) => child.getBoundingClientRect())
          if (childBoxes.length === 0) return true

          const layoutBox = layout.getBoundingClientRect()
          const contentBottom = Math.max(...childBoxes.map((box) => box.bottom))
          const trailingGap = layoutBox.bottom - contentBottom

          return trailingGap <= 96
        })(),
        guideRequiredFieldsVisible: (() => {
          const guide = document.querySelector('.guide-modal')
          const requirement = document.querySelector('.guide-modal .guide-requirement')

          if (!guide || !requirement) return true

          const requirementText = textOf(requirement).toLowerCase()
          const requiredSelectors = []
          if (requirementText.includes('base url')) {
            requiredSelectors.push("[data-provider-base-url-field='true']")
          }
          if (requirementText.includes('api key')) {
            requiredSelectors.push("label[data-provider-api-key-field='true'] input")
          }
          if (
            requirementText.includes('数据加密密码') ||
            requirementText.includes('data encryption password') ||
            requirementText.includes('sync password') ||
            requirementText.includes('passphrase')
          ) {
            requiredSelectors.push('#guide-sync-passphrase')
          }
          if (requirementText.includes('模型') || requirementText.includes('model')) {
            requiredSelectors.push('[data-provider-default-model-field="true"]')
          }

          if (!requiredSelectors.length) return true

          const fieldVisible = (element) => {
            const box = visibleRectFor(element)
            return (
              Boolean(box) &&
              box.top >= -1 &&
              box.bottom <= window.innerHeight + 1 &&
              box.width >= 28 &&
              box.height >= 28
            )
          }

          return requiredSelectors.every((selector) =>
            Array.from(guide.querySelectorAll(selector)).some(fieldVisible),
          )
        })(),
        dangerActionsInsideViewport: (() => {
          const dangerModal = document.querySelector('.danger-modal')
          if (!dangerModal) return true

          const actionsElement = dangerModal.querySelector('.modal-actions')
          const actions = actionsElement?.getBoundingClientRect()

          return Boolean(
            actionsElement &&
              isVisible(actionsElement) &&
              actions &&
              actions.top >= -1 &&
              actions.bottom <= window.innerHeight + 1,
          )
        })(),
        dangerModalClosesMobileSidebar: (() => {
          if (!document.querySelector('.danger-modal') || window.innerWidth > 860) {
            return true
          }

          return !document.querySelector('.sidebar.open')
        })(),
        providerMenuAvoidsWelcomeOverlap: (() => {
          const menu = document.querySelector('.provider-model-menu')
          const welcome = document.querySelector('.welcome-panel')

          if (!menu || !welcome || window.innerWidth > 520) {
            return true
          }

          const menuBox = menu.getBoundingClientRect()
          const welcomeBox = welcome.getBoundingClientRect()
          const separated =
            menuBox.bottom <= welcomeBox.top - 6 ||
            menuBox.top >= welcomeBox.bottom + 6 ||
            menuBox.right <= welcomeBox.left - 6 ||
            menuBox.left >= welcomeBox.right + 6

          return separated
        })(),
        chatHeaderContainsProviderTrigger: (() => {
          const header = document.querySelector('.chat-header')
          const trigger = document.querySelector('.provider-model-trigger')

          if (!header || !trigger || !isVisible(trigger)) return true

          const headerBox = header.getBoundingClientRect()
          const triggerBox = trigger.getBoundingClientRect()

          return (
            triggerBox.top >= headerBox.top - 1 &&
            triggerBox.bottom <= headerBox.bottom + 1
          )
        })(),
        compactChatTitleDefaultVisible: (() => {
          if (window.innerWidth > 300) return true

          const titleText = document.querySelector('.conversation-title-button span')
          const text = titleText?.textContent?.trim() ?? ''

          if (!titleText || !isVisible(titleText) || text.length > 8) return true

          return titleText.scrollWidth <= titleText.clientWidth + 1
        })(),
        imageToolHintClearsHeader: (() => {
          if (!document.querySelector('.chat-pane-image-tools')) return true

          const header = document.querySelector('.chat-header')
          const trigger = document.querySelector('.provider-model-trigger')
          const hint = document.querySelector('.feature-hint-chat')

          if (!header || !hint || !isVisible(hint)) return true

          const headerBox = header.getBoundingClientRect()
          const triggerBox = trigger?.getBoundingClientRect()
          const hintBox = hint.getBoundingClientRect()
          const chromeBottom = Math.max(headerBox.bottom, triggerBox?.bottom ?? 0)

          return hintBox.top >= chromeBottom + 6
        })(),
        audioComposerSubmissionVisible: (() => {
          const composer = document.querySelector('.composer-audio')

          if (!composer || window.innerWidth > 300 || window.innerHeight > 580) return true

          const textarea = composer.querySelector('textarea')
          const sendButton = composer.querySelector('.send-button')
          const controls = [textarea, sendButton].filter(Boolean)

          return (
            controls.length === 2 &&
            controls.every((element) => {
              const box = visibleRectFor(element)

              return (
                Boolean(box) &&
                box.top >= -1 &&
                box.bottom <= window.innerHeight + 1 &&
                box.width >= 28 &&
                box.height >= 28
              )
            })
          )
        })(),
      }
    })()`)

    assert.equal(
      metrics.horizontalOverflow,
      false,
      `${name} should not overflow horizontally: viewport ${metrics.innerWidth}x${metrics.innerHeight}, root scroll ${metrics.rootScrollWidth}, body scroll ${metrics.bodyScrollWidth}`,
    )
    assert.equal(
      metrics.modalOutOfBounds,
      false,
      `${name} modal should stay inside the ${metrics.innerWidth}x${metrics.innerHeight} viewport`,
    )
    assert.deepEqual(
      metrics.clippedControls,
      [],
      `${name} visible controls should not clip labels: ${metrics.clippedControls.join(', ')}`,
    )
    assert.deepEqual(
      metrics.clippedGroups,
      [],
      `${name} control groups should not clip labels: ${metrics.clippedGroups.join(', ')}`,
    )
    assert.deepEqual(
      metrics.clippedPlaceholders,
      [],
      `${name} input placeholders should fit their fields: ${metrics.clippedPlaceholders.join(', ')}`,
    )
    assert.deepEqual(
      metrics.smallTargets,
      [],
      `${name} visible action targets should be at least 28px: ${metrics.smallTargets.join(', ')}`,
    )
    assert.deepEqual(
      metrics.overlappingControls,
      [],
      `${name} visible controls should not overlap: ${metrics.overlappingControls.join(', ')}`,
    )
    assert.deepEqual(
      metrics.offCenterControls,
      [],
      `${name} button content should stay visually centered: ${metrics.offCenterControls.join(', ')}`,
    )
    assert.equal(
      metrics.modalBackgroundIsolated,
      true,
      `${name} modals should isolate the chat pane and sidebar from assistive technology`,
    )
    assert.equal(
      metrics.guideSyncModeButtonsReachable,
      true,
      `${name} first-run sync choices should remain reachable in the setup scroll area`,
    )
    assert.equal(
      metrics.guideProviderBeforeSync,
      true,
      `${name} first-run Provider setup should precede optional sync in mobile visual and DOM order`,
    )
    assert.equal(
      metrics.guideProviderChoicesReachable,
      true,
      `${name} first-run guide should keep the complete Provider menu reachable without a clipped mobile shortcut strip`,
    )
    assert.equal(
      metrics.guideActionsInsideViewport,
      true,
      `${name} first-run actions should stay fully inside the viewport`,
    )
    assert.equal(
      metrics.guideActionsStackOnMicroViewport,
      true,
      `${name} first-run actions should stack as full-width rows on micro viewports`,
    )
    assert.equal(
      metrics.guideLayoutContentTightOnMicroViewport,
      true,
      `${name} first-run content should not leave a large trailing blank gap on micro viewports`,
    )
    assert.equal(
      metrics.guideRequiredFieldsVisible,
      true,
      `${name} first-run blocking requirement should keep its required field visible in the current viewport`,
    )
    assert.equal(
      metrics.dangerActionsInsideViewport,
      true,
      `${name} danger dialog actions should stay visible inside the viewport`,
    )
    assert.equal(
      metrics.dangerModalClosesMobileSidebar,
      true,
      `${name} mobile sidebar should close before showing a danger dialog`,
    )
    assert.equal(
      metrics.providerMenuAvoidsWelcomeOverlap,
      true,
      `${name} provider/model menu should not cover the welcome panel on compact screens`,
    )
    assert.equal(
      metrics.chatHeaderContainsProviderTrigger,
      true,
      `${name} sticky header should contain the Provider/Model trigger instead of letting it overflow`,
    )
    assert.equal(
      metrics.compactChatTitleDefaultVisible,
      true,
      `${name} compact chat header should keep short default conversation titles fully visible`,
    )
    assert.equal(
      metrics.imageToolHintClearsHeader,
      true,
      `${name} image tool feature hint should not be covered by the sticky header`,
    )
    assert.equal(
      metrics.audioComposerSubmissionVisible,
      true,
      `${name} audio composer textarea and transcribe action should stay visible in the short viewport`,
    )
  }

  const capture = async (name) => {
    await assertViewportFit(name)
    await waitForPaint()
    await sleep(120)
    const index = screenshotIndex
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    const fileName = `${String(index).padStart(2, '0')}-${name}-${currentViewport.width}x${currentViewport.height}.png`
    screenshotIndex += 1
    const filePath = path.join(outputDir, fileName)
    const pngBuffer = Buffer.from(result.data, 'base64')
    const analysis = analyzePngScreenshot(pngBuffer, currentViewport, name)
    await writeFile(filePath, pngBuffer)
    screenshots.push(filePath)
    screenshotRecords.push({
      index,
      name,
      file: fileName,
      viewport: { ...currentViewport },
      analysis,
    })
    if (!visualAuditSummaryOnly) {
      console.log(filePath)
    }
  }

  const captureStartupLoadingFixture = async (
    name,
    width,
    loadingText = '正在载入...',
    direction = 'ltr',
  ) => {
    await setViewport(width, 560, false)
    await evaluate(`(() => {
      document.querySelector('[data-visual-loading-fixture]')?.remove()
      const main = document.createElement('main')
      main.className = 'empty-state'
      main.dataset.visualLoadingFixture = 'true'
      main.dir = ${JSON.stringify(direction)}
      Object.assign(main.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        background: 'var(--bg)',
      })
      const title = document.createElement('h1')
      title.textContent = 'ZeroChat'
      const message = document.createElement('p')
      message.textContent = ${JSON.stringify(loadingText)}
      main.append(title, message)
      document.body.append(main)
      return true
    })()`)
    const state = await evaluate(`(() => {
      const title = document.querySelector('[data-visual-loading-fixture] h1')
      const message = document.querySelector('[data-visual-loading-fixture] p')
      const titleBox = title?.getBoundingClientRect()
      const messageBox = message?.getBoundingClientRect()
      return {
        innerWidth: window.innerWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body?.scrollWidth ?? 0,
        titleInside: titleBox
          ? titleBox.left >= -1 && titleBox.right <= window.innerWidth + 1
          : false,
        messageInside: messageBox
          ? messageBox.left >= -1 && messageBox.right <= window.innerWidth + 1
          : false,
      }
    })()`)

    assert.equal(
      state.titleInside && state.messageInside,
      true,
      `${name} loading text should stay inside the ${state.innerWidth}px viewport: ${JSON.stringify(
        state,
      )}`,
    )

    await capture(name)
    await evaluate(`document.querySelector('[data-visual-loading-fixture]')?.remove()`)
  }

  const captureProviderEmptyStateFixture = async (name, width, height) => {
    await setViewport(width, height, width <= 520)
    await evaluate(`(() => {
      document.querySelector('[data-visual-provider-empty-fixture]')?.remove()
      const main = document.createElement('main')
      main.className = 'empty-state provider-empty-state'
      main.dataset.visualProviderEmptyFixture = 'true'
      Object.assign(main.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        background: 'var(--bg)',
      })
      const logo = document.createElement('img')
      logo.className = 'app-logo app-logo-empty'
      logo.src = '/icon-192.png'
      logo.alt = ''
      logo.setAttribute('aria-hidden', 'true')
      const title = document.createElement('h1')
      title.textContent = '添加你的第一个 AI 服务'
      const message = document.createElement('p')
      message.textContent = '选择服务商并填写 API Key 后，就可以在本机开始聊天；密钥只会加密保存。'
      const button = document.createElement('button')
      button.className = 'primary-button'
      button.type = 'button'
      button.textContent = '添加你的第一个 AI 服务'
      main.append(logo, title, message, button)
      document.body.append(main)
      return true
    })()`)
    const state = await evaluate(`(() => {
      const fixture = document.querySelector('[data-visual-provider-empty-fixture]')
      const title = fixture?.querySelector('h1')
      const message = fixture?.querySelector('p')
      const button = fixture?.querySelector('button')
      const logo = fixture?.querySelector('.app-logo')
      const logoBox = logo?.getBoundingClientRect()
      const titleBox = title?.getBoundingClientRect()
      const messageBox = message?.getBoundingClientRect()
      const buttonBox = button?.getBoundingClientRect()
      const contentTop = Math.min(
        ...[logoBox, titleBox, messageBox, buttonBox]
          .map((box) => box?.top)
          .filter((value) => Number.isFinite(value)),
      )
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        titleInside: titleBox
          ? titleBox.left >= -1 && titleBox.right <= window.innerWidth + 1
          : false,
        messageInside: messageBox
          ? messageBox.left >= -1 && messageBox.right <= window.innerWidth + 1
          : false,
        buttonInside: buttonBox
          ? buttonBox.left >= -1 && buttonBox.right <= window.innerWidth + 1
          : false,
        contentTop,
        providerEmptyContentStartsNearTop: contentTop <= Math.max(24, window.innerHeight * 0.2),
        providerEmptyPrimaryActionNearTop: buttonBox
          ? buttonBox.top <= Math.min(window.innerHeight * 0.54, 340)
          : false,
        buttonHeight: buttonBox?.height ?? 0,
      }
    })()`)

    assert.equal(
      state.titleInside && state.messageInside && state.buttonInside,
      true,
      `${name} provider empty state should stay inside the ${state.innerWidth}px viewport: ${JSON.stringify(
        state,
      )}`,
    )
    assert.ok(
      state.buttonHeight >= 38,
      `${name} provider empty state primary action should remain tappable: ${JSON.stringify(
        state,
      )}`,
    )
    assert.equal(
      state.providerEmptyContentStartsNearTop && state.providerEmptyPrimaryActionNearTop,
      true,
      `${name} provider empty state should keep first-provider setup near the top on compact screens: ${JSON.stringify(
        state,
      )}`,
    )

    await capture(name)
    await evaluate(`document.querySelector('[data-visual-provider-empty-fixture]')?.remove()`)
  }

  const captureModalActionsFixture = async (name, width) => {
    await setViewport(width, 560, false)
    await evaluate(`(() => {
      document.querySelector('[data-visual-modal-actions-fixture]')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'modal-backdrop'
      backdrop.dataset.visualModalActionsFixture = 'true'
      backdrop.setAttribute('role', 'dialog')
      backdrop.setAttribute('aria-modal', 'true')
      backdrop.setAttribute('aria-labelledby', 'visual-modal-actions-title')
      const modal = document.createElement('section')
      modal.className = 'modal guide-modal'
      const header = document.createElement('div')
      header.className = 'modal-header'
      const titleWrap = document.createElement('div')
      const title = document.createElement('h2')
      title.id = 'visual-modal-actions-title'
      title.textContent = '首次配置'
      const intro = document.createElement('p')
      intro.textContent = '先接入一个可用模型，同步可以之后再设置。'
      titleWrap.append(title, intro)
      header.append(titleWrap)
      const layout = document.createElement('div')
      layout.className = 'guide-layout'
      const left = document.createElement('div')
      left.className = 'form-stack'
      const field = document.createElement('label')
      field.textContent = 'API Key'
      const input = document.createElement('input')
      input.placeholder = 'sk-...'
      field.append(input)
      left.append(field)
      const right = document.createElement('div')
      right.className = 'form-stack'
      const modes = document.createElement('div')
      modes.className = 'mode-grid'
      for (const label of ['本地', 'Gist', 'Cloudflare']) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        modes.append(button)
      }
      right.append(modes)
      layout.append(left, right)
      const requirement = document.createElement('p')
      requirement.className = 'settings-note guide-requirement'
      requirement.textContent = '请填写 API Key；也可以先跳过。'
      const actions = document.createElement('div')
      actions.className = 'modal-actions'
      const skip = document.createElement('button')
      skip.className = 'ghost-button'
      skip.type = 'button'
      skip.textContent = '跳过，先本地使用'
      const done = document.createElement('button')
      done.className = 'primary-button'
      done.type = 'button'
      done.textContent = '完成'
      actions.append(skip, done)
      modal.append(header, layout, requirement, actions)
      backdrop.append(modal)
      document.body.append(backdrop)
      return true
    })()`)
    await capture(name)
    await evaluate(`document.querySelector('[data-visual-modal-actions-fixture]')?.remove()`)
  }

  const captureDangerActionsFixture = async (name, width) => {
    await setViewport(width, 560, false)
    await evaluate(`(() => {
      document.querySelector('[data-visual-danger-actions-fixture]')?.remove()
      const backdrop = document.createElement('div')
      backdrop.className = 'modal-backdrop compact-dialog-backdrop'
      backdrop.dataset.visualDangerActionsFixture = 'true'
      backdrop.setAttribute('role', 'alertdialog')
      backdrop.setAttribute('aria-modal', 'true')
      backdrop.setAttribute('aria-labelledby', 'visual-danger-actions-title')
      const modal = document.createElement('section')
      modal.className = 'modal danger-modal'
      const header = document.createElement('div')
      header.className = 'modal-header'
      const titleWrap = document.createElement('div')
      const title = document.createElement('h2')
      title.id = 'visual-danger-actions-title'
      title.textContent = '重置本机数据'
      const intro = document.createElement('p')
      intro.textContent = '请先确认这个操作的影响'
      titleWrap.append(title, intro)
      header.append(titleWrap)
      const body = document.createElement('div')
      body.className = 'danger-copy'
      const text = document.createElement('p')
      text.textContent = '这会清空本机聊天记录、设置和本地密钥。'
      const list = document.createElement('ul')
      for (const item of ['不会主动删除云端数据。', '旧数据可能无法恢复。']) {
        const li = document.createElement('li')
        li.textContent = item
        list.append(li)
      }
      body.append(text, list)
      const acknowledge = document.createElement('label')
      acknowledge.className = 'danger-skip'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      const acknowledgeText = document.createElement('span')
      acknowledgeText.textContent = '我已理解这个风险，以后不再提醒这类操作'
      acknowledge.append(checkbox, acknowledgeText)
      const actions = document.createElement('div')
      actions.className = 'modal-actions'
      const cancel = document.createElement('button')
      cancel.className = 'ghost-button'
      cancel.type = 'button'
      cancel.textContent = '取消'
      const confirm = document.createElement('button')
      confirm.className = 'danger-button'
      confirm.type = 'button'
      confirm.textContent = '重置本机数据'
      actions.append(cancel, confirm)
      modal.append(header, body, acknowledge, actions)
      backdrop.append(modal)
      document.body.append(backdrop)
      return true
    })()`)
    await capture(name)
    await evaluate(`document.querySelector('[data-visual-danger-actions-fixture]')?.remove()`)
  }

  const assertWelcomeComposerGap = async (name) => {
    const state = await evaluate(`(() => {
      const welcome = document.querySelector('.welcome-panel')
      const composer = document.querySelector('.composer')
      if (!welcome || !composer) return { skipped: true }

      const welcomeBox = welcome.getBoundingClientRect()
      const composerBox = composer.getBoundingClientRect()
      return {
        composerTop: composerBox.top,
        gap: composerBox.top - welcomeBox.bottom,
        viewportHeight: window.innerHeight,
        welcomeBottom: welcomeBox.bottom,
      }
    })()`)

    assert.ok(
      state.skipped || state.gap >= 12,
      `${name} welcome panel and composer should keep at least 12px of visual separation: ${JSON.stringify(
        state,
      )}`,
    )
  }

  const assertImageToolShortViewportFit = async (name) => {
    const state = await evaluate(`(() => {
      const isVisible = (element) => {
        if (!element) return false
        const style = getComputedStyle(element)
        const box = element.getBoundingClientRect()
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          box.width > 0 &&
          box.height > 0
        )
      }
      const boxFor = (selector) => {
        const element = document.querySelector(selector)
        const box = element?.getBoundingClientRect()
        return box
          ? {
              top: box.top,
              bottom: box.bottom,
              left: box.left,
              right: box.right,
              width: box.width,
              height: box.height,
              visible: isVisible(element),
            }
          : null
      }
      const welcome = document.querySelector('.welcome-panel')
      const composer = boxFor('.composer')
      const imagePanel = boxFor('.image-compose-panel')
      const sourcePanel = boxFor('.image-source-panel')
      const textarea = boxFor('.composer textarea')
      const sendButton = boxFor('.send-button')

      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        welcomeVisible: isVisible(welcome),
        composer,
        imagePanel,
        sourcePanel,
        textarea,
        sendButton,
      }
    })()`)

    assert.equal(
      state.welcomeVisible,
      false,
      `${name} should hide the welcome card in the short image-tool viewport instead of crowding the composer: ${JSON.stringify(
        state,
      )}`,
    )

    for (const [label, box] of Object.entries({
      composer: state.composer,
      imagePanel: state.imagePanel,
      sourcePanel: state.sourcePanel,
      textarea: state.textarea,
      sendButton: state.sendButton,
    })) {
      assert.ok(
        box?.visible &&
          box.top >= -1 &&
          box.left >= -1 &&
          box.right <= state.innerWidth + 1 &&
          box.bottom <= state.innerHeight + 1,
        `${name} ${label} should stay visible inside the ${state.innerWidth}x${state.innerHeight} viewport: ${JSON.stringify(
          state,
        )}`,
      )
    }
  }

  const clickSidebarBackdropOutsidePanel = async (name) => {
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
      `${name} sidebar backdrop should expose a real clickable area outside the panel: ${JSON.stringify(
        target,
      )}`,
    )

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: target.x,
      y: target.y,
      button: 'left',
      clickCount: 1,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: target.x,
      y: target.y,
      button: 'left',
      clickCount: 1,
    })
    await sleep(80)

    const closed = await evaluate(`(() => {
      const sidebar = document.querySelector('.sidebar')
      const backdrop = document.querySelector('.sidebar-backdrop')

      return {
        sidebarOpen: Boolean(sidebar?.classList.contains('open')),
        backdropVisible: Boolean(backdrop && getComputedStyle(backdrop).display !== 'none'),
      }
    })()`)

    assert.deepEqual(
      closed,
      { sidebarOpen: false, backdropVisible: false },
      `${name} sidebar should close after clicking the outside backdrop`,
    )
  }

  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Page.navigate', { url: appUrl })
    await evaluate(
      `new Promise((resolve) => {
        const done = () => resolve(document.readyState)
        if (document.readyState === 'complete') done()
        else window.addEventListener('load', done, { once: true })
      })`,
      true,
    )
    await evaluate(`
      window.__zeroChatVisual = {
        textOf(element) {
          const text = (element.textContent || '').trim()
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
                controls.map((item) => this.textOf(item)).filter(Boolean).slice(0, 40).join(' | ')
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
        tinyAudioFile(fileName = 'zerochat-visual-audio.wav') {
          const bytes = Uint8Array.from(
            atob('UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='),
            (char) => char.charCodeAt(0),
          )
          return new File([bytes], fileName, { type: 'audio/wav' })
        },
        async attachTinyAudio(fileName = 'zerochat-visual-audio.wav') {
          const input = document.querySelector('.audio-source-actions input[type="file"]')
          if (!input) throw new Error('Missing audio source file input')
          const data = new DataTransfer()
          data.items.add(this.tinyAudioFile(fileName))
          input.files = data.files
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))

          for (let attempt = 0; attempt < 80; attempt += 1) {
            const sourceText = document.querySelector('.audio-source-name')?.textContent?.trim() ?? ''

            if (sourceText.includes(fileName)) return sourceText
            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'Audio source name did not update: ' +
              (document.querySelector('.audio-source-name')?.textContent?.trim() ?? ''),
          )
        },
        setSelectValue(value) {
          const select = Array.from(document.querySelectorAll('select'))
            .find((item) => Array.from(item.options).some((option) => option.value === value))
          if (!select) throw new Error('Missing select option: ' + value)
          select.value = value
          select.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        },
        async waitForGuideProviderSelection(presetId, expectsCustomFields) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const select = document.querySelector('.guide-modal .guide-provider-select-row select')
            const customBaseUrl = document.querySelector(
              ".guide-modal [data-provider-base-url-field='true']",
            )
            const customBlockingFields = [
              customBaseUrl,
              document.querySelector(
                ".guide-modal label[data-provider-api-key-field='true'] input",
              ),
              document.querySelector(
                '.guide-modal [data-provider-default-model-field="true"]',
              ),
            ]
            const customBlockingFieldsVisible = customBlockingFields.every((field) => {
              if (!field) return false

              const box = field.getBoundingClientRect()
              const style = getComputedStyle(field)
              return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                box.width >= 28 &&
                box.height >= 28 &&
                box.top >= -1 &&
                box.bottom <= window.innerHeight + 1
              )
            })

            if (
              select?.value === presetId &&
              Boolean(customBaseUrl) === expectsCustomFields &&
              (!expectsCustomFields || customBlockingFieldsVisible)
            ) {
              return true
            }

            await new Promise((resolve) => setTimeout(resolve, 50))
          }

          throw new Error(
            'First-run Provider menu selection did not settle with visible blocking fields: ' +
              presetId,
          )
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
        setSyncPassphrase(value) {
          const input = this.syncPassphraseInput()
          if (!input) throw new Error('Missing sync passphrase input')
          input.focus()
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          input.blur()
          return true
        },
        syncPassphraseInput() {
          return document.querySelector('#settings-tab-data')
            ? Array.from(document.querySelectorAll('.settings-modal [role="tabpanel"] input'))
                .find((item) => item.closest('label')?.textContent?.includes('数据加密密码') ||
                  item.closest('label')?.textContent?.includes('Data encryption password'))
            : null
        },
        assertSyncPassphrasePlaceholder(names) {
          const input = this.syncPassphraseInput()
          if (!input) throw new Error('Missing sync passphrase input')
          if (input.value) throw new Error('Sync passphrase input should be empty for placeholder audit')
          if (!names.some((name) => input.placeholder.includes(name))) {
            throw new Error(
              'Unexpected sync passphrase placeholder: ' + input.placeholder,
            )
          }
          return input.placeholder
        },
        cloudflareAccessKeyInput() {
          return Array.from(document.querySelectorAll('.settings-modal [role="tabpanel"] input'))
            .find((item) => item.closest('label')?.textContent?.includes('Cloudflare 访问密钥') ||
              item.closest('label')?.textContent?.includes('Cloudflare access key'))
        },
        assertCloudflareAccessKeyPlaceholder(names) {
          const input = this.cloudflareAccessKeyInput()
          if (!input) throw new Error('Missing Cloudflare access key input')
          if (input.value) throw new Error('Cloudflare access key input should be empty for placeholder audit')
          if (!names.some((name) => input.placeholder.includes(name))) {
            throw new Error(
              'Unexpected Cloudflare access key placeholder: ' + input.placeholder,
            )
          }
          return input.placeholder
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
        clickSkillEdit(rowText) {
          const row = Array.from(document.querySelectorAll('.skill-row'))
            .find((item) => (item.textContent || '').includes(rowText))
          if (!row) throw new Error('Missing skill row: ' + rowText)
          const button = row.querySelector('.skill-edit-button')
          if (!button) throw new Error('Missing skill edit button: ' + rowText)
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
        largeSkillListState() {
          const top = document.querySelector('.skill-list-more-top')
          const button = top?.querySelector('button')

          return {
            rowCount: document.querySelectorAll('.skill-row').length,
            topText: (top?.textContent || '').trim(),
            buttonText: (button?.textContent || '').trim(),
            buttonVisible: Boolean(
              button &&
                getComputedStyle(button).display !== 'none' &&
                button.getBoundingClientRect().width > 0 &&
                button.getBoundingClientRect().height > 0,
            ),
          }
        },
        assertLargeSkillListProgress(total, shown) {
          const state = this.largeSkillListState()

          if (state.rowCount !== shown) {
            throw new Error(
              'Large Skill list should render exactly ' +
                shown +
                ' rows before loading more, got ' +
                state.rowCount,
            )
          }

          if (!state.topText.includes(String(shown)) || !state.topText.includes(String(total))) {
            throw new Error('Large Skill progress is not visible: ' + state.topText)
          }

          if (!state.buttonVisible || !state.buttonText) {
            throw new Error('Large Skill show-more button is not visible')
          }

          return state
        },
        guideSyncNote() {
          const note = document.querySelector('.guide-modal .guide-sync-note')
          return (note?.textContent || '').trim()
        },
        selectGuideSyncMode(names) {
          const guide = document.querySelector('.guide-modal')
          if (!guide) throw new Error('Missing first-run guide')
          const buttons = Array.from(guide.querySelectorAll('.mode-grid button'))
          const button = buttons.find((item) => this.match(item, names))
          if (!button) {
            throw new Error(
              'Missing guide sync mode: ' +
                names.join(' / ') +
                '; available: ' +
                buttons.map((item) => this.textOf(item)).join(' | '),
            )
          }
          button.click()
          return this.textOf(button)
        },
        async waitForGuideSyncNote(names) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const note = this.guideSyncNote()
            if (names.some((name) => note.includes(name))) return note
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Guide sync note did not match: ' +
              names.join(' / ') +
              '; note=' +
              this.guideSyncNote(),
          )
        },
        reopenedGuideActionState() {
          const guide = document.querySelector('.guide-modal')
          if (!guide) throw new Error('Missing setup guide')
          const buttons = Array.from(guide.querySelectorAll('button'))
          const hasSkipLocal = buttons.some((button) =>
            this.match(button, [
              '跳过，先本地使用',
              'Skip, use locally',
              'Skip, use local first',
              'Ignorer, utiliser en local',
            ]),
          )
          const hasCloseGuide = buttons.some((button) =>
            this.match(button, ['关闭引导', 'Close guide', 'Fermer le guide']),
          )

          return {
            hasCloseGuide,
            hasSkipLocal,
            labels: buttons.map((button) => this.textOf(button)).filter(Boolean),
          }
        },
        async waitForText(names) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (Array.from(document.querySelectorAll('body *')).some((item) => this.match(item, names))) {
              return true
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Missing text: ' + names.join(' / '))
        },
        async openLargeSkillLibrary(count, names) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (attempt % 5 === 0) {
              window.dispatchEvent(new CustomEvent('zerochat:smoke-large-skills', {
                detail: { count },
              }))
            }
            if (Array.from(document.querySelectorAll('body *')).some((item) => this.match(item, names))) {
              return true
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Missing text after opening large Skill library: ' + names.join(' / '))
        },
        async waitForVisualSmokeReady() {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (window.__zeroChatVisualSmokeReady) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Visual smoke controller did not become ready')
        },
        async waitForTheme(theme) {
          for (let attempt = 0; attempt < 80; attempt += 1) {
            if (document.documentElement.dataset.theme === theme) {
              return true
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Theme did not settle: ' + document.documentElement.dataset.theme)
        },
        async waitForDocumentLanguage(lang, dir) {
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const langMatches = !lang || document.documentElement.lang === lang
            const actualDir = document.documentElement.dir
            const dirMatches =
              !dir ||
              actualDir === dir ||
              (dir === 'ltr' && actualDir === '')
            if (langMatches && dirMatches) return true
            if (lang) {
              window.dispatchEvent(new CustomEvent('zerochat:smoke-language', {
                detail: { language: lang },
              }))
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('Document language did not settle: ' + document.documentElement.lang + '/' + document.documentElement.dir)
        },
        scrollSettingsModal(position) {
          const modal = document.querySelector('.settings-modal')
          if (!modal) throw new Error('Missing settings modal')
          modal.scrollTop = position === 'bottom' ? modal.scrollHeight : 0
          return modal.scrollTop
        },
        scrollSettingsModalTo(names) {
          const modal = document.querySelector('.settings-modal')
          if (!modal) throw new Error('Missing settings modal')
          const target =
            Array.from(modal.querySelectorAll('label')).find((item) => this.match(item, names)) ||
            Array.from(modal.querySelectorAll('input, button, p, .notice')).find((item) =>
              this.match(item, names),
            )
          if (!target) throw new Error('Missing settings scroll target: ' + names.join(' / '))
          const scrollTarget = target
          const targetBox = scrollTarget.getBoundingClientRect()
          const modalBox = modal.getBoundingClientRect()
          const sticky = modal.querySelector('.settings-sticky')
          const stickyBottom =
            sticky?.getBoundingClientRect().bottom ?? modalBox.top
          const visibleTop = Math.max(modalBox.top, stickyBottom) + 12

          modal.scrollTop = Math.max(0, modal.scrollTop + targetBox.top - visibleTop)
          return modal.scrollTop
        },
        fieldViewport(labelNames) {
          const modal = document.querySelector('.settings-modal')
          if (!modal) throw new Error('Missing settings modal')
          const label = Array.from(modal.querySelectorAll('label'))
            .find((item) => this.match(item, labelNames))
          if (!label) throw new Error('Missing field: ' + labelNames.join(' / '))
          const field = label.querySelector('input, textarea, select') ?? label
          const labelRect = label.getBoundingClientRect()
          const fieldRect = field.getBoundingClientRect()
          const modalRect = modal.getBoundingClientRect()
          const stickyRect = modal.querySelector('.settings-sticky')?.getBoundingClientRect()
          const visibleTop = Math.max(0, stickyRect?.bottom ?? 0)
          const visibleBottom = Math.min(window.innerHeight, modalRect.bottom)

          return {
            bottom: labelRect.bottom,
            fieldBottom: fieldRect.bottom,
            fieldTop: fieldRect.top,
            modalBottom: modalRect.bottom,
            modalTop: modalRect.top,
            stickyBottom: stickyRect?.bottom ?? 0,
            top: labelRect.top,
            topGap: labelRect.top - visibleTop,
            viewportHeight: window.innerHeight,
            visibleTop,
            visible:
              labelRect.top >= visibleTop - 1 &&
              labelRect.bottom <= visibleBottom + 1 &&
              labelRect.top >= modalRect.top - 1 &&
              labelRect.bottom <= modalRect.bottom + 1,
          }
        },
        assertFieldInViewport(labelNames) {
          const state = this.fieldViewport(labelNames)
          if (!state.visible) {
            throw new Error(
              'Field is hidden by modal chrome or outside viewport: ' +
                labelNames.join(' / ') +
                '; state=' +
                JSON.stringify(state),
            )
          }
          return state
        },
        assertFieldNearViewportTop(labelNames, maxGap = 52) {
          const state = this.fieldViewport(labelNames)
          if (!state.visible || state.topGap > maxGap) {
            throw new Error(
              'Field is not anchored near the visible top of the settings modal: ' +
                labelNames.join(' / ') +
                '; state=' +
                JSON.stringify(state),
            )
          }
          return state
        },
        controlViewport(names) {
          const modal = document.querySelector('.settings-modal')
          if (!modal) throw new Error('Missing settings modal')
          const target = Array.from(
            modal.querySelectorAll('button, [role="button"], label.file-button'),
          ).find((item) => this.match(item, names))
          if (!target) throw new Error('Missing control: ' + names.join(' / '))
          const rect = target.getBoundingClientRect()
          const modalRect = modal.getBoundingClientRect()
          const stickyRect = modal.querySelector('.settings-sticky')?.getBoundingClientRect()
          const style = window.getComputedStyle(target)
          const visibleTop = Math.max(0, stickyRect?.bottom ?? modalRect.top)
          const visibleBottom = Math.min(window.innerHeight, modalRect.bottom)

          return {
            bottom: rect.bottom,
            modalBottom: modalRect.bottom,
            modalTop: modalRect.top,
            stickyBottom: stickyRect?.bottom ?? 0,
            top: rect.top,
            viewportHeight: window.innerHeight,
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.top >= visibleTop - 1 &&
              rect.bottom <= visibleBottom + 1 &&
              rect.left >= modalRect.left - 1 &&
              rect.right <= modalRect.right + 1,
          }
        },
        assertControlInViewport(names) {
          const state = this.controlViewport(names)
          if (!state.visible) {
            throw new Error(
              'Control is hidden by modal chrome or outside viewport: ' +
                names.join(' / ') +
                '; state=' +
                JSON.stringify(state),
            )
          }
          return state
        },
        assertSegmentedLabelsFit() {
          const labels = Array.from(document.querySelectorAll('.settings-modal .segmented-label'))
          if (!labels.length) throw new Error('Missing settings segmented labels')
          const failures = labels
            .filter((label) => {
              const style = window.getComputedStyle(label)
              const rect = label.getBoundingClientRect()
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                label.scrollWidth > label.clientWidth + 1
              )
            })
            .map((label) => ({
              text: (label.textContent || '').trim(),
              clientWidth: label.clientWidth,
              scrollWidth: label.scrollWidth,
            }))
          if (failures.length) {
            throw new Error('Settings segmented labels overflow: ' + JSON.stringify(failures))
          }
          return labels.map((label) => ({
            text: (label.textContent || '').trim(),
            clientWidth: label.clientWidth,
            scrollWidth: label.scrollWidth,
          }))
        },
        async waitForControl() {
          for (let attempt = 0; attempt < 100; attempt += 1) {
            if (document.querySelector('button, [role="button"], label')) return true
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error('No controls rendered')
        },
      }
    `)
    await evaluate(`window.__zeroChatVisual.waitForControl()`, true)

    await setViewport(1440, 900)
    await capture('first-run-guide-desktop')
    await setViewport(1280, 705)
    await assertViewportFit('first-run-guide-short-desktop')
    await evaluate(`window.__zeroChatVisual.setSelectValue('custom-openai-relay')`)
    await evaluate(
      `window.__zeroChatVisual.waitForGuideProviderSelection('custom-openai-relay', true)`,
      true,
    )
    await assertViewportFit('first-run-guide-custom-relay-short-desktop')
    await setViewport(320, 640, true)
    await assertViewportFit('first-run-guide-custom-relay-compact-mobile')
    await evaluate(`window.__zeroChatVisual.setSelectValue('openai')`)
    await evaluate(
      `window.__zeroChatVisual.waitForGuideProviderSelection('openai', false)`,
      true,
    )
    await setViewport(390, 780, true)
    await capture('first-run-guide-mobile')
    await evaluate(`
      window.dispatchEvent(new CustomEvent('zerochat:smoke-language', {
        detail: { language: 'fr-FR' },
      }))
    `)
    await evaluate(`window.__zeroChatVisual.waitForDocumentLanguage('fr-FR', 'ltr')`, true)
    await capture('first-run-guide-fr-FR-mobile')
    await evaluate(`
      window.dispatchEvent(new CustomEvent('zerochat:smoke-language', {
        detail: { language: 'ar-SA' },
      }))
    `)
    await evaluate(`window.__zeroChatVisual.waitForDocumentLanguage('ar-SA', 'rtl')`, true)
    const rtlTechnicalFieldState = await evaluate(`(() => {
      const secret = document.querySelector('.guide-modal .secret-input input')
      const model = document.querySelector('.guide-modal .model-row input[aria-label]')
      return {
        secretDir: secret?.getAttribute('dir') ?? '',
        secretPlaceholder: secret?.getAttribute('placeholder') ?? '',
        modelDir: model?.getAttribute('dir') ?? '',
        modelValue: model?.value ?? '',
      }
    })()`)
    assert.equal(
      rtlTechnicalFieldState.secretDir,
      'auto',
      'RTL setup guide provider key field should use content-based direction',
    )
    assert.equal(
      rtlTechnicalFieldState.secretPlaceholder,
      'sk-...',
      'RTL setup guide provider key placeholder should remain visually LTR',
    )
    assert.equal(
      rtlTechnicalFieldState.modelDir,
      'auto',
      'RTL setup guide model field should use content-based direction',
    )
    assert.ok(
      rtlTechnicalFieldState.modelValue.startsWith('gpt-'),
      'RTL setup guide model value should be a LTR model identifier',
    )
    await capture('first-run-guide-ar-SA-mobile')
    await evaluate(`
      window.dispatchEvent(new CustomEvent('zerochat:smoke-language', {
        detail: { language: 'zh-CN' },
      }))
    `)
    await evaluate(`window.__zeroChatVisual.waitForDocumentLanguage('zh-CN', 'ltr')`, true)
    await evaluate(`window.__zeroChatVisual.selectGuideSyncMode(['Gist'])`)
    await evaluate(`window.__zeroChatVisual.waitForGuideSyncNote(['GitHub 令牌', 'GitHub token'])`, true)
    await capture('first-run-guide-gist-mobile')
    await evaluate(`window.__zeroChatVisual.selectGuideSyncMode(['Cloudflare'])`)
    await evaluate(`window.__zeroChatVisual.waitForGuideSyncNote(['Worker + KV/R2', 'AI requests'])`, true)
    await capture('first-run-guide-cloudflare-mobile')
    const guideNotes = await evaluate(`(async () => {
      const helper = window.__zeroChatVisual
      const notes = []
      const modes = [
        { label: ['本地', 'Local'], note: ['本地模式', 'Local mode'] },
        { label: ['Gist'], note: ['GitHub 令牌', 'GitHub token'] },
        { label: ['Cloudflare'], note: ['Worker + KV/R2', 'AI requests'] },
      ]
      for (const { label, note } of modes) {
        helper.selectGuideSyncMode(label)
        notes.push(await helper.waitForGuideSyncNote(note))
      }
      return notes
    })()`, true)
    assert.equal(
      new Set(guideNotes).size,
      3,
      `first-run guide visual states should use distinct sync notes (${JSON.stringify(guideNotes)})`,
    )
    await setViewport(320, 640, true)
    await capture('first-run-guide-compact-mobile')
    await setViewport(300, 620, true)
    await capture('first-run-guide-ultra-compact-mobile')
    await setViewport(280, 560, false)
    await capture('first-run-guide-tiny-desktop')
    await setViewport(1440, 900)

    const skippedGuideState = await evaluate(`
      (async () => {
        const helper = window.__zeroChatVisual
        const names = ['跳过，先本地使用', 'Skip, use locally', 'Skip, use local first']
        const button =
          document.querySelector('[data-guide-skip-local-action="true"]') ||
          Array.from(document.querySelectorAll('button'))
            .find((item) => helper.match(item, names))

        if (!button) {
          return {
            clicked: false,
            guideVisible: Boolean(document.querySelector('.guide-modal')),
            skipDisabled: null,
          }
        }

        const skipDisabled = Boolean(button.disabled)
        button.click()

        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (!document.querySelector('.guide-modal')) {
            return {
              clicked: true,
              guideVisible: false,
              skipDisabled,
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 50))
        }

        return {
          clicked: true,
          guideVisible: Boolean(document.querySelector('.guide-modal')),
          skipDisabled,
          labels: Array.from(document.querySelectorAll('.guide-modal button'))
            .map((button) => helper.textOf(button))
            .filter(Boolean),
        }
      })()
    `, true)

    if (skippedGuideState.clicked) {
      assert.equal(
        skippedGuideState.guideVisible,
        false,
        `first-run skip-local action should close the guide before continuing (${JSON.stringify(skippedGuideState)})`,
      )
      await evaluate(`window.__zeroChatVisual.waitForText(['新建对话', 'New chat'])`, true)
    }

    await capture('chat-desktop')
    await evaluate(`window.__zeroChatVisual.click(['打开设置', 'Open settings'])`)
    await capture('settings-providers-desktop')
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-data')`)
    await capture('settings-data-desktop')
    await evaluate(`window.__zeroChatVisual.click(['打开配置引导', 'Open setup guide'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['首次配置', 'First setup'])`, true)
    const reopenedGuideActionState = await evaluate(`window.__zeroChatVisual.reopenedGuideActionState()`)
    assert.equal(
      reopenedGuideActionState.hasSkipLocal,
      false,
      `reopened setup guide visual state should not show the first-run skip-local action (${JSON.stringify(reopenedGuideActionState)})`,
    )
    assert.equal(
      reopenedGuideActionState.hasCloseGuide,
      true,
      `reopened setup guide visual state should show a harmless close action (${JSON.stringify(reopenedGuideActionState)})`,
    )
    await capture('reopened-setup-guide-desktop')
    await evaluate(`window.__zeroChatVisual.click(['关闭引导', 'Close guide'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['数据', 'Data'])`, true)
    await evaluate(`window.__zeroChatVisual.click(['重置同步密码', 'Reset sync password'])`)
    await capture('reset-sync-password-dialog-desktop')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await evaluate(`window.__zeroChatVisual.setSyncPassphrase('old-passphrase-for-visual-audit')`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-sync')`)
    await capture('settings-sync-desktop')
    await evaluate(`
      window.dispatchEvent(new CustomEvent('zerochat:smoke-sync-conflict'))
    `)
    await evaluate(`window.__zeroChatVisual.waitForText(['选择首次同步方向'])`, true)
    await capture('first-sync-conflict-dialog-desktop')
    await evaluate(`window.__zeroChatVisual.clickSelector('.sync-conflict-modal .modal-header .icon-button')`)
    await evaluate(`window.__zeroChatVisual.click(['GitHub Gist'])`)
    await evaluate(`window.__zeroChatVisual.scrollSettingsModalTo(['Gist ID'])`)
    await evaluate(`window.__zeroChatVisual.assertFieldInViewport(['Gist ID'])`)
    await capture('settings-sync-gist-desktop')
    await evaluate(`window.__zeroChatVisual.scrollSettingsModal('top')`)
    await evaluate(`window.__zeroChatVisual.click(['Cloudflare'])`)
    await waitForDeferredSettingsScroll()
    await evaluate(`window.__zeroChatVisual.scrollSettingsModalTo(['Worker 地址', 'Worker URL'])`)
    await evaluate(`window.__zeroChatVisual.assertFieldInViewport(['Worker 地址', 'Worker URL'])`)
    await capture('settings-sync-cloudflare-desktop')
    await evaluate(`window.__zeroChatVisual.scrollSettingsModal('top')`)
    await evaluate(`window.__zeroChatVisual.click(['GitHub Gist'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-data')`)
    await evaluate(`window.__zeroChatVisual.setSyncPassphrase('new-passphrase-for-visual-audit')`)
    await capture('rotate-sync-password-dialog-desktop')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-sync')`)
    await evaluate(`window.__zeroChatVisual.click(['本地', 'Local'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-models')`)
    await capture('settings-models-desktop')
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-skills')`)
    await evaluate(
      `window.__zeroChatVisual.setSkillDraft(
        'Visual review skill',
        '# Visual review\\nCheck alignment, tap targets, overflow, sidebar behavior, settings density, and mobile readability.'
      )`,
    )
    await evaluate(`window.__zeroChatVisual.click(['添加技能', 'Add skill'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['Visual review skill'])`, true)
    await capture('settings-skills-desktop')
    await evaluate(`window.__zeroChatVisual.clickSkillEdit('Visual review skill')`)
    await evaluate(`window.__zeroChatVisual.waitForSkillEditor('Visual review skill')`, true)
    await capture('settings-skills-edit-desktop')
    await evaluate(`window.__zeroChatVisual.clickSkillEdit('Visual review skill')`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-appearance')`)
    await evaluate(`window.__zeroChatVisual.setCheckboxLabel(['紧凑显示', 'Compact display'], true)`)
    await evaluate(`window.__zeroChatVisual.waitForCompact('true')`, true)
    await capture('settings-appearance-compact-desktop')
    await evaluate(`window.__zeroChatVisual.clickSelector('.settings-modal .modal-header .icon-button')`)
    await capture('chat-compact-preference-desktop')
    await evaluate(`window.__zeroChatVisual.click(['设置', 'Settings'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-appearance')`)
    await evaluate(`window.__zeroChatVisual.setCheckboxLabel(['紧凑显示', 'Compact display'], false)`)
    await evaluate(`window.__zeroChatVisual.waitForCompact('false')`, true)
    await evaluate(`window.__zeroChatVisual.setSelectValue('ar-SA')`)
    await evaluate(`window.__zeroChatVisual.waitForDocumentLanguage('ar-SA', 'rtl')`, true)
    await setViewport(390, 780, true)
    await capture('settings-appearance-rtl-mobile')
    for (const locale of [
      ['zh-CN', 'ltr'],
      ['en-US', 'ltr'],
      ['es-ES', 'ltr'],
      ['hi-IN', 'ltr'],
      ['ar-SA', 'rtl'],
      ['pt-BR', 'ltr'],
      ['ru-RU', 'ltr'],
      ['ja-JP', 'ltr'],
      ['ko-KR', 'ltr'],
      ['fr-FR', 'ltr'],
    ]) {
      const [language, direction] = locale
      await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-appearance')`)
      await evaluate(`window.__zeroChatVisual.setSelectValue('${language}')`)
      await evaluate(
        `window.__zeroChatVisual.waitForDocumentLanguage('${language}', '${direction}')`,
        true,
      )
      await evaluate(`window.__zeroChatVisual.assertSegmentedLabelsFit()`)
      await capture(`settings-language-${language}-mobile`)
    }
    await evaluate(`window.__zeroChatVisual.setSelectValue('zh-CN')`)
    await evaluate(`window.__zeroChatVisual.waitForDocumentLanguage('zh-CN', 'ltr')`, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-providers')`)
    await evaluate(`window.__zeroChatVisual.assertFieldInViewport(['API Key'])`)
    await capture('settings-providers-mobile')
    await setViewport(320, 640, true)
    await capture('settings-providers-compact-mobile')
    await evaluate(`window.__zeroChatVisual.scrollSettingsModalTo(['Base URL'])`)
    await capture('settings-providers-fields-compact-mobile')
    await evaluate(`window.__zeroChatVisual.scrollSettingsModal('top')`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-models')`)
    await capture('settings-models-mobile')
    await setViewport(320, 640, true)
    await capture('settings-models-compact-mobile')
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-sync')`)
    await evaluate(`window.__zeroChatVisual.click(['GitHub Gist'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-data')`)
    await capture('settings-data-mobile')
    await evaluate(`
      window.dispatchEvent(new CustomEvent('zerochat:smoke-import-backup-danger'))
    `)
    await evaluate(`window.__zeroChatVisual.waitForText(['导入会覆盖当前数据', 'Import will overwrite'])`, true)
    await capture('import-backup-dialog-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(320, 640, true)
    await evaluate(`
      window.dispatchEvent(new CustomEvent('zerochat:smoke-import-backup-danger'))
    `)
    await evaluate(`window.__zeroChatVisual.waitForText(['导入会覆盖当前数据', 'Import will overwrite'])`, true)
    await capture('import-backup-dialog-compact-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.click(['清空云端数据', 'Clear cloud data'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['这会清空当前同步方式', 'This clears'])`, true)
    await capture('clear-cloud-data-dialog-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.click(['清空云端数据', 'Clear cloud data'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['这会清空当前同步方式', 'This clears'])`, true)
    await capture('clear-cloud-data-dialog-compact-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.click(['重置本机数据', 'Reset local data'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['重置本机数据'])`, true)
    await capture('reset-local-data-dialog-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.click(['重置本机数据', 'Reset local data'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['重置本机数据'])`, true)
    await capture('reset-local-data-dialog-compact-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.click(['重置同步密码', 'Reset sync password'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['这只会清除本机当前记住的数据加密密码。', 'This only clears'])`, true)
    await capture('reset-sync-password-dialog-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.click(['重置同步密码', 'Reset sync password'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['这只会清除本机当前记住的数据加密密码。', 'This only clears'])`, true)
    await capture('reset-sync-password-dialog-compact-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-sync')`)
    await evaluate(`window.__zeroChatVisual.click(['GitHub Gist'])`)
    await evaluate(`window.__zeroChatVisual.scrollSettingsModalTo(['Gist ID'])`)
    await evaluate(`window.__zeroChatVisual.assertFieldInViewport(['Gist ID'])`)
    await capture('settings-sync-gist-mobile')
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.scrollSettingsModalTo(['Gist ID'])`)
    await evaluate(`window.__zeroChatVisual.assertFieldInViewport(['Gist ID'])`)
    await capture('settings-sync-gist-compact-mobile')
    await evaluate(`window.__zeroChatVisual.scrollSettingsModal('top')`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.click(['Cloudflare'])`)
    await waitForDeferredSettingsScroll()
    await evaluate(`window.__zeroChatVisual.scrollSettingsModalTo(['Worker 地址', 'Worker URL'])`)
    await evaluate(`window.__zeroChatVisual.assertFieldInViewport(['Worker 地址', 'Worker URL'])`)
    await capture('settings-sync-cloudflare-mobile')
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.scrollSettingsModalTo(['Worker 地址', 'Worker URL'])`)
    await evaluate(`window.__zeroChatVisual.assertFieldInViewport(['Worker 地址', 'Worker URL'])`)
    await capture('settings-sync-cloudflare-compact-mobile')
    await evaluate(`window.__zeroChatVisual.scrollSettingsModal('top')`)
    await evaluate(`window.__zeroChatVisual.click(['本地', 'Local'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-data')`)
    await evaluate(`window.__zeroChatVisual.setSyncPassphrase('')`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-sync')`)
    await evaluate(`window.__zeroChatVisual.click(['Cloudflare'])`)
    await waitForDeferredSettingsScroll()
    await evaluate(
      `window.__zeroChatVisual.scrollSettingsModalTo(['Cloudflare 访问密钥', 'Cloudflare access key'])`,
    )
    await waitForPaint()
    await evaluate(
      `window.__zeroChatVisual.assertFieldNearViewportTop(['Cloudflare 访问密钥', 'Cloudflare access key'])`,
    )
    await evaluate(
      `window.__zeroChatVisual.assertCloudflareAccessKeyPlaceholder(['自动生成', 'Auto-generated'])`,
    )
    await capture('settings-sync-cloudflare-access-compact-mobile')
    await evaluate(`window.__zeroChatVisual.scrollSettingsModal('top')`)
    await evaluate(`window.__zeroChatVisual.click(['本地', 'Local'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-data')`)
    await evaluate(`window.__zeroChatVisual.setSyncPassphrase('old-passphrase-for-visual-audit')`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-sync')`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.click(['GitHub Gist'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-data')`)
    await evaluate(`window.__zeroChatVisual.setSyncPassphrase('old-passphrase-for-visual-audit')`)
    await sleep(300)
    await evaluate(`window.__zeroChatVisual.setSyncPassphrase('mobile-rotate-passphrase-for-visual-audit')`)
    await evaluate(`window.__zeroChatVisual.waitForText(['修改同步密码'])`, true)
    await capture('rotate-sync-password-dialog-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.setSyncPassphrase('old-passphrase-for-visual-audit')`)
    await sleep(300)
    await evaluate(`window.__zeroChatVisual.setSyncPassphrase('compact-rotate-passphrase-for-visual-audit')`)
    await evaluate(`window.__zeroChatVisual.waitForText(['修改同步密码'])`, true)
    await capture('rotate-sync-password-dialog-compact-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-sync')`)
    await evaluate(`window.__zeroChatVisual.click(['本地', 'Local'])`)
    await capture('settings-sync-mobile')
    await evaluate(`
      window.dispatchEvent(new CustomEvent('zerochat:smoke-sync-conflict'))
    `)
    await evaluate(`window.__zeroChatVisual.waitForText(['选择首次同步方向'])`, true)
    await capture('first-sync-conflict-dialog-mobile')
    await evaluate(`window.__zeroChatVisual.clickSelector('.sync-conflict-modal .modal-header .icon-button')`)
    await setViewport(320, 640, true)
    await evaluate(`
      window.dispatchEvent(new CustomEvent('zerochat:smoke-sync-conflict'))
    `)
    await evaluate(`window.__zeroChatVisual.waitForText(['选择首次同步方向'])`, true)
    await capture('first-sync-conflict-dialog-compact-mobile')
    await evaluate(`window.__zeroChatVisual.clickSelector('.sync-conflict-modal .modal-header .icon-button')`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-skills')`)
    await capture('settings-skills-mobile')
    await evaluate(`window.__zeroChatVisual.clickSkillEdit('Visual review skill')`)
    await evaluate(`window.__zeroChatVisual.waitForSkillEditor('Visual review skill')`, true)
    await capture('settings-skills-edit-mobile')
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-data')`)
    await evaluate(`window.__zeroChatVisual.setSyncPassphrase('')`)
    await evaluate(`window.__zeroChatVisual.assertSyncPassphrasePlaceholder(['同步密码', 'Sync password'])`)
    await capture('settings-data-compact-mobile')
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-sync')`)
    await capture('settings-sync-compact-mobile')
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-skills')`)
    await capture('settings-skills-compact-mobile')
    await setViewport(300, 620, true)
    await capture('settings-skills-ultra-compact-mobile')
    await evaluate(`window.__zeroChatVisual.clickSelector('.settings-modal .modal-header .icon-button')`)

    await setViewport(720, 760)
    await capture('chat-narrow-desktop')
    await evaluate(`window.__zeroChatVisual.click(['打开边栏', 'Open sidebar'])`)
    await capture('sidebar-open-narrow-desktop')
    await clickSidebarBackdropOutsidePanel('narrow desktop')
    await capture('sidebar-closed-narrow-desktop')
    await evaluate(`window.__zeroChatVisual.click(['打开边栏', 'Open sidebar'])`)
    await evaluate(`window.__zeroChatVisual.click(['删除对话', 'Delete chat'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['删除整个对话', 'Delete chat'])`, true)
    await capture('delete-conversation-dialog-narrow-desktop')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)

    await setViewport(390, 780, true)
    await capture('chat-mobile')
    await setViewport(320, 640, true)
    await capture('chat-compact-mobile')
    await setViewport(300, 620, true)
    await capture('chat-ultra-compact-mobile')
    await setViewport(280, 560, false)
    await capture('chat-tiny-desktop')
    await setViewport(260, 560, false)
    await capture('chat-micro-desktop')
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.click(['打开边栏', 'Open sidebar'])`)
    await capture('sidebar-open-mobile')
    await clickSidebarBackdropOutsidePanel('mobile')
    await evaluate(`window.__zeroChatVisual.click(['打开边栏', 'Open sidebar'])`)
    await evaluate(`window.__zeroChatVisual.click(['删除对话', 'Delete chat'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['删除整个对话', 'Delete chat'])`, true)
    await capture('delete-conversation-dialog-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.click(['打开边栏', 'Open sidebar'])`)
    await capture('sidebar-open-compact-mobile')
    await clickSidebarBackdropOutsidePanel('compact mobile')
    await evaluate(`window.__zeroChatVisual.click(['打开边栏', 'Open sidebar'])`)
    await evaluate(`window.__zeroChatVisual.click(['删除对话', 'Delete chat'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['删除整个对话', 'Delete chat'])`, true)
    await capture('delete-conversation-dialog-compact-mobile')
    await evaluate(`window.__zeroChatVisual.click(['取消', 'Cancel'])`)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('[data-compose-mode="image"]')`)
    await evaluate(`window.__zeroChatVisual.clickSelector('[data-image-task-mode="generate"]')`)
    await capture('image-composer-mobile')
    await setViewport(320, 640, true)
    await capture('image-composer-compact-mobile')
    await setViewport(260, 560, false)
    await capture('image-composer-micro-desktop')
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('[data-image-task-mode="edit"]')`)
    await capture('image-edit-mobile')
    await setViewport(320, 640, true)
    await capture('image-edit-compact-mobile')
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('[data-image-task-mode="inpaint"]')`)
    await capture('image-inpaint-mobile')
    await setViewport(320, 720, true)
    await assertWelcomeComposerGap('image-inpaint-compact-tall-mobile')
    await capture('image-inpaint-compact-tall-mobile')
    await setViewport(320, 640, true)
    await assertWelcomeComposerGap('image-inpaint-compact-mobile')
    await capture('image-inpaint-compact-mobile')
    await setViewport(300, 620, true)
    await assertImageToolShortViewportFit('image-inpaint-ultra-compact-mobile')
    await capture('image-inpaint-ultra-compact-mobile')
    await setViewport(280, 560, false)
    await assertWelcomeComposerGap('image-inpaint-tiny-desktop')
    await capture('image-inpaint-tiny-desktop')
    await evaluate(`window.__zeroChatVisual.clickSelector('[data-image-task-mode="generate"]')`)
    await setViewport(780, 390, true)
    await assertWelcomeComposerGap('image-composer-mobile-landscape')
    await capture('image-composer-mobile-landscape')

    await setViewport(1024, 760)
    await evaluate(`window.__zeroChatVisual.clickSelector('.provider-model-trigger')`)
    await capture('provider-model-menu-desktop')
    await evaluate(`window.__zeroChatVisual.clickSelector('.provider-model-trigger')`)
    await evaluate(`window.__zeroChatVisual.click(['设置', 'Settings'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-appearance')`)
    await evaluate(`window.__zeroChatVisual.setSelectValue('light')`)
    await evaluate(`window.__zeroChatVisual.waitForTheme('light')`, true)
    await capture('settings-appearance-light-desktop')
    await evaluate(`window.__zeroChatVisual.clickSelector('.settings-modal .modal-header .icon-button')`)
    await evaluate(`window.__zeroChatVisual.clickSelector('[data-compose-mode="chat"]')`)
    await capture('chat-light-desktop')
    await evaluate(`window.__zeroChatVisual.click(['设置', 'Settings'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-data')`)
    await setViewport(280, 560, false)
    await evaluate(`window.__zeroChatVisual.scrollSettingsModalTo(['清空云端数据', 'Clear cloud data'])`)
    await evaluate(`window.__zeroChatVisual.assertControlInViewport(['清空云端数据', 'Clear cloud data'])`)
    await evaluate(`window.__zeroChatVisual.scrollSettingsModal('top')`)
    await capture('settings-data-tiny-desktop')
    await setViewport(260, 560, false)
    await capture('settings-data-micro-desktop')
    await setViewport(780, 390, true)
    await capture('settings-data-light-mobile-landscape')
    await evaluate(`window.__zeroChatVisual.clickSelector('.settings-modal .modal-header .icon-button')`)
    await assertWelcomeComposerGap('chat-light-mobile-landscape')
    await capture('chat-light-mobile-landscape')
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.click(['设置', 'Settings'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-data')`)
    await evaluate(`window.__zeroChatVisual.click(['打开配置引导', 'Open setup guide'])`)
    await evaluate(`window.__zeroChatVisual.waitForText(['首次配置', 'First setup'])`, true)
    const reopenedGuideMobileActionState = await evaluate(`window.__zeroChatVisual.reopenedGuideActionState()`)
    assert.equal(
      reopenedGuideMobileActionState.hasSkipLocal,
      false,
      `reopened mobile setup guide visual state should not show the first-run skip-local action (${JSON.stringify(reopenedGuideMobileActionState)})`,
    )
    assert.equal(
      reopenedGuideMobileActionState.hasCloseGuide,
      true,
      `reopened mobile setup guide visual state should show a harmless close action (${JSON.stringify(reopenedGuideMobileActionState)})`,
    )
    await capture('reopened-setup-guide-mobile')
    await captureStartupLoadingFixture(
      'startup-loading-ultra-narrow-260',
      260,
      'लोड हो रहा है...',
    )
    await captureStartupLoadingFixture(
      'startup-loading-ultra-narrow-240',
      240,
      'جار التحميل...',
      'rtl',
    )
    await captureModalActionsFixture('modal-actions-micro-desktop', 260)
    await captureDangerActionsFixture('danger-actions-micro-desktop', 260)
    await evaluate(`window.__zeroChatVisual.clickSelector('.guide-modal .modal-header .icon-button')`)
    await evaluate(`window.__zeroChatVisual.clickSelector('.settings-modal .modal-header .icon-button')`)
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('.provider-model-trigger')`)
    await capture('provider-model-menu-compact-mobile')
    await evaluate(`window.__zeroChatVisual.clickSelector('.provider-model-trigger')`)
    await captureProviderEmptyStateFixture('provider-empty-state-compact-mobile', 320, 640)
    await setViewport(390, 780, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('[data-compose-mode="audio"]')`)
    await capture('audio-composer-mobile')
    await setViewport(320, 640, true)
    await capture('audio-composer-compact-mobile')
    await evaluate(
      `window.__zeroChatVisual.attachTinyAudio('zerochat-visual-source-with-a-deliberately-long-file-name-for-compact-layout-regression-check.wav')`,
      true,
    )
    await capture('audio-long-filename-compact-mobile')
    await setViewport(260, 560, false)
    await capture('audio-composer-micro-desktop')
    await setViewport(320, 640, true)
    await evaluate(`window.__zeroChatVisual.click(['打开设置', 'Open settings'])`)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-appearance')`)
    for (const [language, direction] of compactLanguageLocales) {
      await evaluate(`window.__zeroChatVisual.setSelectValue('${language}')`)
      await evaluate(
        `window.__zeroChatVisual.waitForDocumentLanguage('${language}', '${direction}')`,
        true,
      )
      await evaluate(`window.__zeroChatVisual.assertSegmentedLabelsFit()`)
      await capture(`settings-language-${language}-compact-mobile`)
    }

    await evaluate(`window.__zeroChatVisual.setSelectValue('zh-CN')`)
    await evaluate(`window.__zeroChatVisual.waitForDocumentLanguage('zh-CN', 'ltr')`, true)
    await evaluate(`window.__zeroChatVisual.clickSelector('#settings-tab-skills')`)
    await evaluate(`window.__zeroChatVisual.waitForVisualSmokeReady()`, true)
    await evaluate(
      `window.__zeroChatVisual.openLargeSkillLibrary(241, ['Visual bulk skill 001'])`,
      true,
    )
    await evaluate(`window.__zeroChatVisual.scrollSettingsModal('top')`)
    const largeSkillListState = await evaluate(
      `window.__zeroChatVisual.assertLargeSkillListProgress(241, 80)`,
    )
    assert.ok(
      largeSkillListState.buttonText.length > 0,
      'large Skill library top show-more button should have visible text',
    )
    await capture('settings-skills-large-library-compact-mobile')
    await evaluate(`window.__zeroChatVisual.clickSelector('.settings-modal .modal-header .icon-button')`)

    for (const event of cdp.events) {
      if (event.method === 'Runtime.exceptionThrown') {
        errors.push(event.params.exceptionDetails.text)
      }
      if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
        errors.push(event.params.entry.text)
      }
    }

    assert.deepEqual(errors, [], 'visual audit browser console should not report runtime errors')
    assert.equal(
      screenshots.length,
      expectedScreenshotCount,
      `visual audit should capture ${expectedScreenshotCount} screenshots`,
    )
    await writeVisualGallery(outputDir, screenshotRecords)
    const contactSheetEvidence = await writeVisualContactSheet(cdp, outputDir, evaluate)
    await writeFile(
      path.join(outputDir, 'visual-audit-manifest.json'),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          appUrl,
          contactSheet: 'visual-audit-contact-sheet.jpg',
          contactSheetEvidence,
          gallery: 'visual-audit-gallery.html',
          expectedScreenshotCount,
          screenshotCount: screenshots.length,
          screenshots: screenshotRecords,
        },
        null,
        2,
      )}\n`,
    )
    console.log(`Visual audit captured ${screenshots.length} screenshots in ${outputDir}`)
    if (visualAuditSummaryOnly) {
      console.log(`- Manifest: ${path.join(outputDir, 'visual-audit-manifest.json')}`)
      console.log(`- Gallery: ${path.join(outputDir, 'visual-audit-gallery.html')}`)
      console.log(`- Contact sheet: ${path.join(outputDir, 'visual-audit-contact-sheet.jpg')}`)
    }
  } finally {
    cdp.close()
  }
}

try {
  await main()
} finally {
  await stopChildProcessTree(chrome)
  await devServer?.close()
  const profileRemoved = await removeBrowserProfileWithRetry(profileDir, 120)
  assert.ok(profileRemoved, `Visual audit browser profile cleanup failed: ${profileDir}`)
}
