import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { withReleaseReportLock } from './release-report-lock.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manualQaDir = path.join(repoRoot, '.manual-qa')
const uiReportPath = path.join(manualQaDir, 'android-ui-smoke.json')
const cloudReportPath = path.join(manualQaDir, 'android-cloud-sync-smoke.json')
const emulatorQaReportPath = path.join(manualQaDir, 'android-emulator-qa.json')
const htmlPath = path.join(manualQaDir, 'android-current-contact-sheet.html')
const pngPath = path.join(manualQaDir, 'android-current-contact-sheet.png')
const manifestPath = path.join(manualQaDir, 'android-current-contact-sheet.json')

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

  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to render Android contact sheet.')
}

function evidencePath(file) {
  return path.relative(repoRoot, path.resolve(file)).replace(/\\/gu, '/')
}

function isMissingPathError(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
}

function fileSystemErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN'
}

function jsonParseErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function readJsonSource(file, label, { optional = false } = {}) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (optional && isMissingPathError(error)) {
      return null
    }

    throw new Error(
      `Unable to read ${label} at ${evidencePath(file)} (${fileSystemErrorCode(error)}).`,
    )
  }
}

function parseJsonSource(source, file, label) {
  try {
    return JSON.parse(source.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(
      `Unable to parse ${label} at ${evidencePath(file)}: ${jsonParseErrorMessage(error)}`,
    )
  }
}

async function readJson(file, label = 'JSON report') {
  const source = await readJsonSource(file, label)
  return parseJsonSource(source, file, label)
}

async function readOptionalJson(file, label = 'JSON report') {
  const source = await readJsonSource(file, label, { optional: true })
  if (source === null) {
    return null
  }

  return parseJsonSource(source, file, label)
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function pngDimensions(buffer) {
  const signature = '89504e470d0a1a0a'
  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Screenshot is not a PNG')
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

async function screenshotEvidence(file) {
  const absolutePath = path.resolve(file)
  const buffer = await readFile(absolutePath)
  const dimensions = pngDimensions(buffer)

  return {
    path: absolutePath,
    name: path.basename(absolutePath),
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
    ...dimensions,
  }
}

function stopProcessTree(processId) {
  if (!processId) return

  if (process.platform !== 'win32') {
    return
  }

  spawnSync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `
$rootIds = @(${Number(processId)})
$allProcesses = Get-CimInstance Win32_Process
$toStop = New-Object System.Collections.Generic.HashSet[int]
function Add-ProcessTree([int]$processIdValue) {
  if ($toStop.Add($processIdValue)) {
    $children = $allProcesses | Where-Object { $_.ParentProcessId -eq $processIdValue }
    foreach ($child in $children) {
      Add-ProcessTree ([int]$child.ProcessId)
    }
  }
}
foreach ($rootId in $rootIds) {
  Add-ProcessTree $rootId
}
foreach ($processIdValue in $toStop) {
  $processHandle = Get-Process -Id $processIdValue -ErrorAction SilentlyContinue
  if ($processHandle) {
    Stop-Process -Id $processIdValue -Force -ErrorAction SilentlyContinue
  }
}
`,
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  )
}

async function stopProcessTreeWithRetries(processId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    stopProcessTree(processId)
  }
}

async function renderContactSheetPng(chrome, args) {
  const timeoutMs = 60_000

  return await new Promise((resolve, reject) => {
    const child = spawn(chrome, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      if (process.platform === 'win32') {
        stopProcessTree(child.pid)
      } else {
        child.kill('SIGKILL')
      }
      finish({
        processId: child.pid,
        status: null,
        signal: 'timeout',
        stdout,
        stderr,
        timedOut: true,
      })
    }, timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (status, signal) => {
      stopProcessTree(child.pid)
      finish({
        processId: child.pid,
        status,
        signal,
        stdout,
        stderr,
        timedOut: false,
      })
    })
  })
}

function reportScreenshots(report, group) {
  if (!Array.isArray(report.screenshots)) return []

  return report.screenshots.map((screenshot) => ({
    group,
    path: path.resolve(screenshot),
  }))
}

function contactSheetSourceTimestamp(reports) {
  const timestamps = [reports.ui?.generatedAt, reports.cloud?.generatedAt]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .sort()

  return timestamps.at(-1) ?? 'source reports'
}

function contactSheetHtml(records, reports) {
  const generatedAt = contactSheetSourceTimestamp(reports)
  const cards = records
    .map((record) => {
      const src = pathToFileURL(record.path).href

      return `
        <figure class="card">
          <figcaption>
            <strong>${escapeHtml(record.name)}</strong>
            <span>${escapeHtml(record.group)} · ${record.width}x${record.height}</span>
          </figcaption>
          <img src="${src}" alt="${escapeHtml(record.name)}" loading="eager" decoding="sync">
        </figure>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ZeroChat Android Current Contact Sheet</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #eef4ef;
      color: #122019;
      font: 13px/1.35 Arial, sans-serif;
    }
    main {
      width: 1280px;
      padding: 18px 20px 24px;
    }
    header {
      display: grid;
      gap: 4px;
      margin-bottom: 14px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.1;
    }
    p {
      margin: 0;
      color: #4b5f54;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(6, 190px);
      gap: 14px 16px;
      align-items: start;
    }
    .card {
      margin: 0;
      min-width: 0;
      display: grid;
      gap: 8px;
    }
    figcaption {
      min-height: 38px;
      display: grid;
      gap: 2px;
    }
    figcaption strong,
    figcaption span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    figcaption strong {
      font-size: 12px;
    }
    figcaption span {
      color: #5c6c63;
      font-size: 11px;
    }
    img {
      width: 190px;
      height: 422px;
      object-fit: contain;
      object-position: top center;
      background: #f8fbf8;
      border: 1px solid #cfd8d1;
      display: block;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>ZeroChat Android Current Contact Sheet</h1>
      <p>${escapeHtml(generatedAt)} · UI smoke ${reports.ui.screenshots.length} screenshots · Cloud sync smoke ${reports.cloud?.screenshots?.length ?? 0} screenshots</p>
    </header>
    <section class="grid">
      ${cards}
    </section>
  </main>
</body>
</html>`
}

async function main() {
  const uiReport = await readJson(uiReportPath, 'Android UI smoke report')
  const cloudReport = await readOptionalJson(
    cloudReportPath,
    'Android Cloudflare sync smoke report',
  )
  const sourceScreenshots = [
    ...reportScreenshots(uiReport, 'android-ui'),
    ...(cloudReport ? reportScreenshots(cloudReport, 'android-cloud-sync') : []),
  ]

  if (sourceScreenshots.length < 20) {
    throw new Error(`Expected at least 20 Android screenshots, got ${sourceScreenshots.length}.`)
  }

  const records = []
  for (const source of sourceScreenshots) {
    records.push({
      group: source.group,
      ...(await screenshotEvidence(source.path)),
    })
  }

  await mkdir(manualQaDir, { recursive: true })
  await writeFile(htmlPath, contactSheetHtml(records, { ui: uiReport, cloud: cloudReport }))

  const rows = Math.ceil(records.length / 6)
  const viewportWidth = 1280
  const viewportHeight = 72 + rows * (422 + 38 + 14) + 32
  const chrome = await resolveChromePath()
  const result = await renderContactSheetPng(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-background-networking',
    '--disable-component-extensions-with-background-pages',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    `--window-size=${viewportWidth},${viewportHeight}`,
    `--screenshot=${pngPath}`,
    pathToFileURL(htmlPath).href,
  ])

  if (result.timedOut) {
    await screenshotEvidence(pngPath).catch((error) => {
      throw new Error(`Chrome timed out before rendering Android contact sheet: ${error.message}`)
    })
  } else if (result.status !== 0) {
    throw new Error(
      [
        `Chrome failed to render Android contact sheet with exit code ${result.status}.`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  await stopProcessTreeWithRetries(result.processId)

  const contactSheet = await screenshotEvidence(pngPath)
  const manifest = {
    kind: 'zerochat.androidContactSheet',
    generatedAt: new Date().toISOString(),
    html: path.resolve(htmlPath),
    contactSheet: path.resolve(pngPath),
    contactSheetEvidence: contactSheet,
    sourceReports: [uiReportPath, cloudReport ? cloudReportPath : null]
      .filter(Boolean)
      .map((file) => path.resolve(file)),
    screenshotCount: records.length,
    screenshots: records,
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  const emulatorReport = await readOptionalJson(
    emulatorQaReportPath,
    'Android emulator QA wrapper report',
  )
  if (emulatorReport) {
    const apkEvidence = uiReport?.apk?.local ?? emulatorReport.apkEvidence ?? null

    await writeFile(
      emulatorQaReportPath,
      `${JSON.stringify(
        {
          ...emulatorReport,
          generatedAt: new Date().toISOString(),
          apkEvidence,
          contactSheetReport: path.resolve(manifestPath),
          contactSheet: path.resolve(pngPath),
          contactSheetEvidence: contactSheet,
          screenshotCount: records.length,
          screenshotBreakdown: {
            ui: Array.isArray(uiReport.screenshots) ? uiReport.screenshots.length : 0,
            cloudSync: Array.isArray(cloudReport?.screenshots) ? cloudReport.screenshots.length : 0,
          },
          screenshots: sourceScreenshots.map((source) => path.resolve(source.path)),
        },
        null,
        2,
      )}\n`,
    )
  }

  console.log(
    JSON.stringify(
      {
        contactSheet: path.resolve(pngPath),
        screenshotCount: records.length,
        bytes: contactSheet.bytes,
      },
      null,
      2,
    ),
  )
}

await withReleaseReportLock('android-contact-sheet', main)
