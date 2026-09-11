import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startVitePreviewLoopbackServer } from './vite-loopback-server.mjs'
import { webCurrentPageSourceManifest } from './web-current-page-source-manifest.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rawArgs = process.argv.slice(2)
const manualQaDir = path.join(repoRoot, '.manual-qa')
const visualDir = path.join(manualQaDir, 'web-current-page-visual-audit')
const visualManifestPath = path.join(visualDir, 'visual-audit-manifest.json')
const reportPath = path.join(manualQaDir, 'web-current-page-qa.json')
const iconSyncDomReportPath = path.join(manualQaDir, 'web-current-icon-sync-dom.json')
function optionValue(name) {
  const prefixed = `${name}=`
  const inline = rawArgs.find((arg) => arg.startsWith(prefixed))
  if (inline) return inline.slice(prefixed.length)

  const index = rawArgs.indexOf(name)
  return index >= 0 ? rawArgs[index + 1] : undefined
}

function withBrowserSmokeParam(value) {
  const url = new URL(value)
  url.searchParams.set('app-test', '1')
  return url.href
}

const explicitUrl =
  optionValue('--url') ??
  process.env.ZEROCHAT_QA_URL ??
  process.env.ZEROCHAT_VISUAL_URL ??
  process.env.ZEROCHAT_SMOKE_URL ??
  ''
const autoPreviewRequested = rawArgs.includes('--auto-preview')
const autoPreviewDisabled = rawArgs.includes('--no-auto-preview')
const jsonOutputRequested = rawArgs.includes('--json')
const autoPreviewEnabled = !autoPreviewDisabled && (autoPreviewRequested || explicitUrl === '')
let appUrl = explicitUrl ? new URL(explicitUrl).href : ''

function assertLocalUrl(value) {
  const url = new URL(value)
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1'])

  if (!['http:', 'https:'].includes(url.protocol) || !localHosts.has(url.hostname)) {
    throw new Error(
      `Current-page QA only accepts a local app URL; got ${value}. Use --url http://127.0.0.1:5173/.`,
    )
  }
}

function runStep(label, script, extraEnv = {}, scriptArgs = []) {
  console.log(`\n==> ${label}`)
  console.log(`node ${[path.relative(repoRoot, script), ...scriptArgs].join(' ')}`)

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          signal
            ? `${label} stopped by signal ${signal}`
            : `${label} failed with exit code ${code}`,
        ),
      )
    })
  })
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForHttp(url, options = {}) {
  const { attempts = 80, throwOnFailure = true, failureMessage } = options

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // The user's dev server may still be starting.
    }

    await delay(250)
  }

  if (!throwOnFailure) {
    return false
  }

  throw new Error(failureMessage ?? `Current-page QA target did not become reachable: ${url}`)
}

function previewPortForUrl(value) {
  const url = new URL(value)
  const port = Number(url.port)

  if (Number.isInteger(port) && port > 0) {
    return port
  }

  return url.protocol === 'https:' ? 443 : 80
}

async function startPreview(value) {
  console.log('\n==> Auto-start Vite preview')
  const configuredPort = value ? previewPortForUrl(value) : undefined
  const server = await startVitePreviewLoopbackServer({
    configuredPort,
    root: repoRoot,
    serverLabel: 'Current-page QA preview server',
  })
  const command = {
    display: `shared Vite preview ${server.url}`,
  }
  console.log(command.display)
  return { server, command }
}

async function stopPreview(preview) {
  await preview?.server?.close()
}

async function assertZeroChatTarget(url) {
  const response = await fetch(url)
  const html = await response.text()
  const requiredMarkers = [
    '<title>ZeroChat</title>',
    'id="root"',
    'data-initial-loading',
    'favicon.svg',
    'manifest.webmanifest',
  ]
  const missingMarkers = requiredMarkers.filter((marker) => !html.includes(marker))

  if (missingMarkers.length) {
    throw new Error(
      [
        `Current-page QA target is not the ZeroChat app: ${url}`,
        `Missing ZeroChat shell markers: ${missingMarkers.join(', ')}`,
        'Start the ZeroChat Web/PWA dev or preview server and pass its URL with --url http://127.0.0.1:<port>/.',
      ].join('\n'),
    )
  }
}

async function fileEvidence(file) {
  const buffer = await readFile(file)
  const stats = await stat(file)

  return {
    path: path.resolve(file),
    bytes: stats.size,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

function printReportSummary(report) {
  console.log([
    '',
    'Current-page QA passed',
    `- Report: ${path.relative(repoRoot, reportPath)}`,
    `- App URL: ${report.appUrl}`,
    `- Preview: ${report.preview.autoStarted ? 'auto-started temporary Vite preview' : 'already-running local target'}`,
    `- Screenshots: ${report.visualAudit.screenshotCount}/${report.visualAudit.expectedScreenshotCount}`,
    `- Browser smoke: ${report.browserSmoke.passed ? 'passed' : 'failed'}`,
    `- Settings to Sync proof: ${report.iconSyncDom.syncSettingsOpened ? 'passed' : 'failed'}`,
    `- Web source digest: ${report.webSource.digest}`,
    `- Full JSON: rerun with --json or read ${path.relative(repoRoot, reportPath)}`,
  ].join('\n'))
}

await mkdir(manualQaDir, { recursive: true })

let preview = null
let targetReachableBeforePreview = false

try {
  if (appUrl) {
    assertLocalUrl(appUrl)
    targetReachableBeforePreview = await waitForHttp(appUrl, {
      throwOnFailure: false,
    })
  }

  if (!targetReachableBeforePreview) {
    if (!autoPreviewEnabled) {
      throw new Error(
        [
          `Current-page QA target did not become reachable: ${appUrl || 'no local URL was provided'}`,
          'Start the ZeroChat Web/PWA dev or preview server and pass its URL with --url http://127.0.0.1:<port>/,',
          'or rerun without --url so this command can auto-start a temporary Vite preview.',
        ].join('\n'),
      )
    }

    await runStep(
      'Current page production build',
      path.join(repoRoot, 'scripts', 'web-production-build.mjs'),
    )
    preview = await startPreview(appUrl)
    appUrl = preview.server.url
  }

  appUrl = withBrowserSmokeParam(appUrl)
  assertLocalUrl(appUrl)
  await assertZeroChatTarget(appUrl)

  await runStep('Current page visual audit', path.join(repoRoot, 'scripts', 'visual-audit.mjs'), {
    ZEROCHAT_VISUAL_URL: appUrl,
    ZEROCHAT_VISUAL_DIR: visualDir,
    ZEROCHAT_VISUAL_SUMMARY_ONLY: '1',
  })
  await runStep('Current page browser smoke', path.join(repoRoot, 'scripts', 'browser-skill-smoke.mjs'), {
    ZEROCHAT_SMOKE_URL: appUrl,
    ZEROCHAT_ICON_SYNC_DOM_REPORT: iconSyncDomReportPath,
  })

  const visualManifest = JSON.parse(await readFile(visualManifestPath, 'utf8'))
  const iconSyncDomReport = JSON.parse(await readFile(iconSyncDomReportPath, 'utf8'))
  const report = {
    kind: 'zerochat.webCurrentPageQa',
    version: 1,
    appUrl,
    generatedAt: new Date().toISOString(),
    preview: {
      autoStartAllowed: autoPreviewEnabled,
      autoStarted: Boolean(preview),
      targetReachableBeforePreview,
      command: preview?.command.display ?? null,
    },
    visualAudit: {
      directory: path.relative(repoRoot, visualDir),
      manifest: path.relative(repoRoot, visualManifestPath),
      manifestEvidence: await fileEvidence(visualManifestPath),
      appUrl: visualManifest.appUrl,
      expectedScreenshotCount: visualManifest.expectedScreenshotCount,
      screenshotCount: visualManifest.screenshotCount,
      generatedAt: visualManifest.generatedAt,
    },
    browserSmoke: {
      passed: true,
    },
    iconSyncDom: {
      report: path.relative(repoRoot, iconSyncDomReportPath),
      reportEvidence: await fileEvidence(iconSyncDomReportPath),
      generatedAt: iconSyncDomReport.generatedAt,
      visibleFaviconLogoCount: iconSyncDomReport.visibleFaviconLogoCount,
      visibleDeprecatedSyncControlCount:
        iconSyncDomReport.visibleDeprecatedSyncControlCount,
      visibleDeprecatedSyncAriaCount:
        iconSyncDomReport.visibleDeprecatedSyncAriaCount,
      settingsEntryActionable: iconSyncDomReport.settingsEntryActionable,
      syncSettingsOpened: iconSyncDomReport.syncSettingsOpenProof?.opened,
      syncSettingsTabId: iconSyncDomReport.syncSettingsOpenProof?.activeTabId,
      passed: iconSyncDomReport.passed,
    },
    webSource: await webCurrentPageSourceManifest({ repoRoot }),
    passed: true,
  }

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  await runStep(
    'Current page artifact validation',
    path.join(repoRoot, 'scripts', 'runtime-smoke-artifact-check.mjs'),
    {},
    ['--only-web-current-page'],
  )

  if (jsonOutputRequested) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printReportSummary(report)
  }
} finally {
  await stopPreview(preview)
}
