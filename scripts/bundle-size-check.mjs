import { readdir, readFile } from 'node:fs/promises'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const kib = 1024
const htmlShellRawLimit = 5 * kib
const firstLoadGzipLimit = 120 * kib
const entryJavaScriptGzipLimit = 90 * kib
const initialJavaScriptGzipLimit = 96 * kib
const totalStaticResourceGzipLimit = 300 * kib
const totalTextStaticResourceBrotliRatioLimit = 0.88
const localeGzipLimit = 16 * kib
const serviceGzipLimit = 8 * kib
const gistSyncGzipLimit = 8 * kib
const markdownGzipLimit = 50 * kib
const markdownClientGzipLimit = 3 * kib
const settingsOverlayGzipLimit = 14 * kib
const firstRunGuideGzipLimit = 10 * kib
const lazyServices = ['chat', 'crypto', 'settingsActions', 'skills', 'sync']
const chatRuntimeMergedServices = [
  'audioSpeech',
  'audioTranscription',
  'chatGenerationMessageReruns',
]
const brotliTextExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
])
const failures = []

function extractSupportedLocales(source) {
  const match = source.match(/const supportedLocales:\s*Locale\[\]\s*=\s*\[([\s\S]*?)\]/)

  if (!match) {
    failures.push('Unable to find supportedLocales in src/i18n.ts.')
    return []
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

function sizeLabel(bytes) {
  return `${(bytes / kib).toFixed(2)} KiB`
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

async function gzipFile(path) {
  const source = await readFile(path)
  return gzipSync(source).byteLength
}

async function brotliFile(path) {
  const source = await readFile(path)

  return brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).byteLength
}

function isBrotliTextAsset(file) {
  return [...brotliTextExtensions].some((extension) => file.endsWith(extension))
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const filePath = `${directory}/${entry.name}`

    if (entry.isDirectory()) {
      files.push(...(await listFiles(filePath)))
    } else {
      files.push(filePath)
    }
  }

  return files
}

const indexHtml = await readFile('dist/index.html', 'utf8')
const startupScriptPath = 'dist/zerochat-startup.js'
const distHeaders = await readFile('dist/_headers', 'utf8')
const appRuntimeControllerSource = await readFile(
  'src/services/appRuntimeController.ts',
  'utf8',
)
const appOverlaysViewSource = await readFile(
  'src/components/AppOverlaysView.tsx',
  'utf8',
)
const i18nSource = await readFile('src/i18n.ts', 'utf8')
const uiRuntimeSource = await readFile('src/services/uiRuntime.ts', 'utf8')
const lazyLocales = extractSupportedLocales(i18nSource)
const distFiles = await listFiles('dist')
const assetFiles = await readdir('dist/assets')
const moduleScripts = Array.from(
  indexHtml.matchAll(/<script[^>]+type="module"[^>]+src="\.\/assets\/([^"]+\.js)"/g),
).map((match) => match[1])
const modulePreloads = Array.from(
  indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\.\/assets\/([^"]+\.js)"/g),
).map((match) => match[1])
const initialJavaScriptFiles = [...new Set([...moduleScripts, ...modulePreloads])]
const mainScripts = moduleScripts.filter((file) => file.startsWith('index-'))
const stylesheets = Array.from(
  indexHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.\/assets\/([^"]+\.css)"/g),
).map((match) => match[1])

const htmlShellRawSize = Buffer.byteLength(indexHtml)
const htmlShellGzipSize = await gzipFile('dist/index.html')

expect(
  htmlShellRawSize <= htmlShellRawLimit,
  `HTML shell is ${sizeLabel(htmlShellRawSize)} raw; keep it at or below ${sizeLabel(
    htmlShellRawLimit,
  )}.`,
)

expect(
  mainScripts.length === 1,
  `dist/index.html should reference exactly one main JS bundle, found ${mainScripts.length}.`,
)

expect(
  stylesheets.length === 1,
  `dist/index.html should reference exactly one production stylesheet, found ${stylesheets.length}.`,
)

expect(
  indexHtml.includes('./zerochat-startup.js'),
  'dist/index.html must reference the external startup bootstrap script.',
)

expect(
  !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(indexHtml),
  'dist/index.html must not contain inline script so a strict CSP can disallow inline scripts.',
)

expect(
  distHeaders.includes("script-src 'self'") &&
    distHeaders.includes("connect-src 'self' https: wss:"),
  'dist/_headers must ship a CSP that keeps script-src self-only and connect-src limited to self plus secure remote protocols.',
)

expect(
  appOverlaysViewSource.includes("import('./SettingsOverlayHost')") &&
    appOverlaysViewSource.includes(
      'recoverLazyOverlay(loadSettingsOverlayHost, SettingsOverlayLoadFailure)',
    ) &&
    appOverlaysViewSource.includes("import('./FirstRunGuide')") &&
    appOverlaysViewSource.includes('recoverLazyOverlay<FirstRunGuideProps>(') &&
    appOverlaysViewSource.includes('scheduleSettingsOverlayPreload') &&
    appOverlaysViewSource.includes('shouldWarmLazyServices()'),
  'Settings overlay and first-run guide must stay lazy-loaded, with Settings idle-preloaded only off save-data, slow, or offline networks.',
)

let entryJavaScriptLabel = 'missing'
let initialJavaScriptGzipSize = 0
let firstLoadGzipSize = htmlShellGzipSize + (await gzipFile(startupScriptPath))

if (mainScripts[0]) {
  const mainGzipSize = await gzipFile(`dist/assets/${mainScripts[0]}`)
  entryJavaScriptLabel = sizeLabel(mainGzipSize)
  expect(
    mainGzipSize <= entryJavaScriptGzipLimit,
    `Entry JS gzip size is ${entryJavaScriptLabel}; keep it at or below ${sizeLabel(
      entryJavaScriptGzipLimit,
    )}.`,
  )
}

for (const file of initialJavaScriptFiles) {
  expect(
    assetFiles.includes(file),
    `Initial JavaScript dependency ${file} referenced by dist/index.html must exist in dist/assets.`,
  )

  if (assetFiles.includes(file)) {
    initialJavaScriptGzipSize += await gzipFile(`dist/assets/${file}`)
  }
}

firstLoadGzipSize += initialJavaScriptGzipSize

expect(
  initialJavaScriptGzipSize <= initialJavaScriptGzipLimit,
  `Initial JavaScript graph gzip size is ${sizeLabel(
    initialJavaScriptGzipSize,
  )}; keep entry plus modulepreload dependencies at or below ${sizeLabel(
    initialJavaScriptGzipLimit,
  )}.`,
)

for (const stylesheet of stylesheets) {
  firstLoadGzipSize += await gzipFile(`dist/assets/${stylesheet}`)
}

expect(
  firstLoadGzipSize <= firstLoadGzipLimit,
  `First-load HTML/CSS/main-JS gzip size is ${sizeLabel(
    firstLoadGzipSize,
  )}; keep it at or below ${sizeLabel(firstLoadGzipLimit)}.`,
)

let totalStaticResourceGzipSize = 0
let totalTextStaticResourceGzipSize = 0
let totalTextStaticResourceBrotliSize = 0

for (const file of distFiles) {
  totalStaticResourceGzipSize += await gzipFile(file)

  if (isBrotliTextAsset(file)) {
    totalTextStaticResourceGzipSize += await gzipFile(file)
    totalTextStaticResourceBrotliSize += await brotliFile(file)
  }
}

expect(
  totalStaticResourceGzipSize <= totalStaticResourceGzipLimit,
  `Total static resource gzip size is ${sizeLabel(
    totalStaticResourceGzipSize,
  )}; keep it at or below ${sizeLabel(totalStaticResourceGzipLimit)}.`,
)

expect(
  totalTextStaticResourceBrotliSize > 0,
  'Brotli text-asset compression must be measured for the production build.',
)

expect(
  totalTextStaticResourceBrotliSize <=
    totalTextStaticResourceGzipSize * totalTextStaticResourceBrotliRatioLimit,
  `Brotli text-asset size is ${sizeLabel(
    totalTextStaticResourceBrotliSize,
  )} versus ${sizeLabel(
    totalTextStaticResourceGzipSize,
  )} gzip; keep Brotli at or below ${Math.round(
    totalTextStaticResourceBrotliRatioLimit * 100,
  )}% of gzip.`,
)

const localeLabels = []

for (const locale of lazyLocales) {
  const chunks = assetFiles.filter(
    (file) => file.startsWith(`${locale}-`) && file.endsWith('.js'),
  )

  expect(
    chunks.length === 1,
    `${locale} should be emitted as exactly one lazy locale chunk, found ${chunks.length}.`,
  )

  if (chunks[0]) {
    const gzipSize = await gzipFile(`dist/assets/${chunks[0]}`)
    localeLabels.push(`${locale} ${sizeLabel(gzipSize)}`)
    expect(
      gzipSize <= localeGzipLimit,
      `${locale} lazy chunk gzip size is ${sizeLabel(gzipSize)}; keep it at or below ${sizeLabel(
        localeGzipLimit,
      )}.`,
    )
  }
}

const serviceLabels = []

for (const service of lazyServices) {
  const chunks = assetFiles.filter(
    (file) => file.startsWith(`${service}-`) && file.endsWith('.js'),
  )

  expect(
    chunks.length === 1,
    `${service} should be emitted as exactly one lazy service chunk, found ${chunks.length}.`,
  )

  if (chunks[0]) {
    const gzipSize = await gzipFile(`dist/assets/${chunks[0]}`)
    serviceLabels.push(`${service} ${sizeLabel(gzipSize)}`)
    expect(
      !modulePreloads.includes(chunks[0]),
      `${service} must remain lazy and must not be modulepreloaded by dist/index.html.`,
    )
    expect(
      gzipSize <= serviceGzipLimit,
      `${service} lazy chunk gzip size is ${sizeLabel(gzipSize)}; keep it at or below ${sizeLabel(
        serviceGzipLimit,
      )}.`,
    )
  }
}

const gistSyncChunks = assetFiles.filter(
  (file) => file.startsWith('syncGist-') && file.endsWith('.js'),
)
expect(
  gistSyncChunks.length === 1,
  `Gist sync should be emitted as exactly one nested lazy chunk, found ${gistSyncChunks.length}.`,
)

let gistSyncLabel = 'missing'

if (gistSyncChunks[0]) {
  const gzipSize = await gzipFile(`dist/assets/${gistSyncChunks[0]}`)
  gistSyncLabel = sizeLabel(gzipSize)
  expect(
    !modulePreloads.includes(gistSyncChunks[0]),
    'Gist sync must remain lazy and must not be modulepreloaded by dist/index.html.',
  )
  expect(
    gzipSize <= gistSyncGzipLimit,
    `Gist sync lazy chunk gzip size is ${gistSyncLabel}; keep it at or below ${sizeLabel(
      gistSyncGzipLimit,
    )}.`,
  )
}

for (const service of chatRuntimeMergedServices) {
  const chunks = assetFiles.filter(
    (file) => file.startsWith(`${service}-`) && file.endsWith('.js'),
  )

  expect(
    chunks.length === 0,
    `${service} must stay merged into the shared chat lazy runtime instead of emitting ${chunks.length} standalone chunk(s).`,
  )
}

const markdownChunks = assetFiles.filter(
  (file) => file.startsWith('markdown-') && file.endsWith('.js'),
)
const markdownWorkerChunks = assetFiles.filter(
  (file) => file.startsWith('markdown.worker-') && file.endsWith('.js'),
)
const markdownClientChunks = assetFiles.filter(
  (file) => file.startsWith('markdownWorkerClient-') && file.endsWith('.js'),
)
const settingsOverlayChunks = assetFiles.filter(
  (file) => file.startsWith('SettingsOverlayHost-') && file.endsWith('.js'),
)
const firstRunGuideChunks = assetFiles.filter(
  (file) => file.startsWith('FirstRunGuide-') && file.endsWith('.js'),
)

expect(
  markdownChunks.length === 0,
  `Markdown renderer should not ship a duplicate main-thread lazy chunk when the Web Worker is available, found ${markdownChunks.length}.`,
)
expect(
  markdownWorkerChunks.length === 1,
  `Markdown renderer should be emitted as exactly one lazy Web Worker chunk, found ${markdownWorkerChunks.length}.`,
)
expect(
  markdownClientChunks.length === 1,
  `Markdown Worker client should be emitted as exactly one small lazy chunk, found ${markdownClientChunks.length}.`,
)

let markdownLabel = 'missing'

if (markdownWorkerChunks[0]) {
  const gzipSize = await gzipFile(`dist/assets/${markdownWorkerChunks[0]}`)
  markdownLabel = `worker ${sizeLabel(gzipSize)}`
  expect(
    gzipSize <= markdownGzipLimit,
    `Markdown Worker renderer gzip size is ${sizeLabel(gzipSize)}; keep it at or below ${sizeLabel(
      markdownGzipLimit,
    )}.`,
  )
}

if (markdownClientChunks[0]) {
  const gzipSize = await gzipFile(`dist/assets/${markdownClientChunks[0]}`)
  markdownLabel += `, client ${sizeLabel(gzipSize)}`
  expect(
    gzipSize <= markdownClientGzipLimit,
    `Markdown Worker client gzip size is ${sizeLabel(gzipSize)}; keep it at or below ${sizeLabel(
      markdownClientGzipLimit,
    )}.`,
  )
}

expect(
  settingsOverlayChunks.length === 1,
  `Settings overlay should be emitted as exactly one lazy chunk, found ${settingsOverlayChunks.length}.`,
)
expect(
  firstRunGuideChunks.length === 1,
  `First-run guide should be emitted as exactly one lazy chunk, found ${firstRunGuideChunks.length}.`,
)

let settingsOverlayLabel = 'missing'
let firstRunGuideLabel = 'missing'

if (settingsOverlayChunks[0]) {
  const gzipSize = await gzipFile(`dist/assets/${settingsOverlayChunks[0]}`)
  settingsOverlayLabel = sizeLabel(gzipSize)
  expect(
    gzipSize <= settingsOverlayGzipLimit,
    `Settings overlay lazy chunk gzip size is ${settingsOverlayLabel}; keep it at or below ${sizeLabel(
      settingsOverlayGzipLimit,
    )}.`,
  )
}

if (firstRunGuideChunks[0]) {
  const gzipSize = await gzipFile(`dist/assets/${firstRunGuideChunks[0]}`)
  firstRunGuideLabel = sizeLabel(gzipSize)
  expect(
    gzipSize <= firstRunGuideGzipLimit,
    `First-run guide lazy chunk gzip size is ${firstRunGuideLabel}; keep it at or below ${sizeLabel(
      firstRunGuideGzipLimit,
    )}.`,
  )
}

expect(
  uiRuntimeSource.includes('export function shouldWarmLazyServices') &&
    uiRuntimeSource.includes('connection?.saveData') &&
    uiRuntimeSource.includes('online !== false') &&
    uiRuntimeSource.includes("effectiveType !== 'slow-2g'") &&
    uiRuntimeSource.includes("effectiveType !== '2g'") &&
    appRuntimeControllerSource.includes('shouldWarmLazyServices()'),
  'Web app should warm lazy service chunks only when the user is online and not on data saver, 2g, or slow-2g.',
)

expect(
    uiRuntimeSource.includes('export function scheduleIdleTask') &&
    uiRuntimeSource.includes('window.requestIdleCallback') &&
    uiRuntimeSource.includes('IDLE_SERVICE_WARM_TIMEOUT_MS') &&
    appRuntimeControllerSource.includes('scheduleIdleTask(() =>'),
  'Web app should warm likely next-use service chunks during idle time instead of blocking first render.',
)

expect(
  appRuntimeControllerSource.includes('!chatServiceWarmedRef.current') &&
    appRuntimeControllerSource.includes('warmRetryableLazyService({') &&
    appRuntimeControllerSource.includes('loadService: loadChatService') &&
    appRuntimeControllerSource.includes('hasEnabledSkills && !skillServiceWarmedRef.current') &&
    appRuntimeControllerSource.includes('loadService: loadSkillService') &&
    appRuntimeControllerSource.includes("syncMode !== 'local' && !syncServiceWarmedRef.current") &&
    appRuntimeControllerSource.includes('loadService: loadSyncService') &&
    appRuntimeControllerSource.includes('shouldWarmCryptoService(') &&
    appRuntimeControllerSource.includes('loadService: loadCryptoService') &&
    appRuntimeControllerSource.includes("settingsTab === 'data'"),
  'Web app should prefetch chat, enabled Skill, remote sync, and Data crypto chunks only when they are likely useful.',
)

if (failures.length) {
  throw new Error(`Bundle size checks failed:\n- ${failures.join('\n- ')}`)
}

console.log(
  `Bundle size checks passed: HTML shell ${sizeLabel(
    htmlShellRawSize,
  )} raw, first load ${sizeLabel(firstLoadGzipSize)} gzip, total static ${sizeLabel(
    totalStaticResourceGzipSize,
  )} gzip, text static ${sizeLabel(totalTextStaticResourceBrotliSize)} brotli/${sizeLabel(
    totalTextStaticResourceGzipSize,
  )} gzip, entry ${entryJavaScriptLabel}, initial JS ${sizeLabel(
    initialJavaScriptGzipSize,
  )}; lazy services ${serviceLabels.join(
    ', ',
  )}; Gist sync ${gistSyncLabel}; settings overlay ${settingsOverlayLabel}; first-run guide ${firstRunGuideLabel}; markdown ${markdownLabel}; lazy locales ${localeLabels.join(', ')}`,
)
