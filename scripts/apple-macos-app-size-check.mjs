import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const maxBytes = 15 * 1024 * 1024
const defaultAppPath =
  '.manual-qa/apple-derived-data/Build/Products/Debug/ZeroChat.app'
const defaultReportPath = '.manual-qa/apple-macos-app-size.json'
const publishSafetyScope =
  'sanitized-package-size evidence under .manual-qa; no local absolute paths or secrets'

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

function parseArgs(argv) {
  const options = {
    appPath: defaultAppPath,
    reportPath: defaultReportPath,
  }
  const positional = []

  for (const arg of argv) {
    if (arg.startsWith('--app=')) {
      options.appPath = arg.slice('--app='.length)
      continue
    }

    if (arg === '--app') {
      throw new Error('Use --app=<path> instead of a separate --app value.')
    }

    if (arg.startsWith('--report=')) {
      options.reportPath = arg.slice('--report='.length)
      continue
    }

    if (arg === '--report') {
      throw new Error('Use --report=<path> instead of a separate --report value.')
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown Apple macOS app size check argument: ${arg}`)
    }

    positional.push(arg)
  }

  if (positional.length > 1) {
    throw new Error(`Expected at most one positional app bundle path, got: ${positional.join(', ')}`)
  }

  if (positional.length === 1) {
    options.appPath = positional[0]
  }

  return options
}

function safeReportPath(value) {
  const resolved = path.resolve(repoRoot, value)
  const manualQaDir = path.resolve(repoRoot, '.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !/^apple-macos-app-size(?:-[a-z0-9-]+)?\.json$/u.test(path.basename(resolved))
  ) {
    throw new Error(
      'Apple macOS app size report must stay under .manual-qa and be named apple-macos-app-size*.json.',
    )
  }

  return resolved
}

function safeAppBundlePath(value) {
  const resolved = path.resolve(repoRoot, value)
  const manualQaDir = path.resolve(repoRoot, '.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      'Apple macOS .app evidence must stay under .manual-qa. Build or copy ZeroChat.app to .manual-qa, then rerun with --app=.manual-qa/<file>.app.',
    )
  }

  if (path.extname(resolved).toLowerCase() !== '.app') {
    throw new Error(`Apple macOS app size check expects a .app bundle, got: ${value}`)
  }

  return resolved
}

function evidencePath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/gu, '/')
}

function isMissingPathError(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
}

function fileSystemErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN'
}

async function statReleaseEvidence(filePath, label) {
  try {
    return await stat(filePath)
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw new Error(
      `Unable to stat ${label} at ${evidencePath(filePath)} (${fileSystemErrorCode(error)}).`,
    )
  }
}

async function readFileEvidence(filePath) {
  const [buffer, stats] = await Promise.all([readFile(filePath), stat(filePath)])

  return {
    path: evidencePath(filePath),
    bytes: stats.size,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

async function readOptionalFileEvidence(filePath, label) {
  try {
    return await readFileEvidence(filePath)
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw new Error(
      `Unable to read ${label} at ${evidencePath(filePath)} (${fileSystemErrorCode(error)}).`,
    )
  }
}

async function readAppBundleEvidence(appBundlePath) {
  const files = []

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const evidence = await readFileEvidence(fullPath)
      files.push({
        path: path.relative(appBundlePath, fullPath).replace(/\\/gu, '/'),
        bytes: evidence.bytes,
        sha256: evidence.sha256,
      })
    }
  }

  await walk(appBundlePath)

  const digest = createHash('sha256')
  for (const file of files) {
    digest.update(file.path)
    digest.update('\0')
    digest.update(String(file.bytes))
    digest.update('\0')
    digest.update(file.sha256)
    digest.update('\n')
  }

  return {
    path: evidencePath(appBundlePath),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    sha256: digest.digest('hex').toUpperCase(),
  }
}

async function main() {
  const { appPath, reportPath } = parseArgs(process.argv.slice(2))
  const resolvedAppPath = safeAppBundlePath(appPath)
  const resolvedReportPath = safeReportPath(reportPath)
  const appStats = await statReleaseEvidence(resolvedAppPath, 'Apple macOS .app bundle')

  if (!appStats?.isDirectory()) {
    throw new Error(
      `Missing Apple macOS .app bundle at ${path.relative(repoRoot, resolvedAppPath)}. Build the macOS app with Xcode, then rerun this check with --app=<path>.`,
    )
  }

  const failures = []
  const executablePath = path.join(resolvedAppPath, 'Contents', 'MacOS', 'ZeroChat')
  const infoPlistPath = path.join(resolvedAppPath, 'Contents', 'Info.plist')
  const [appBundle, executable, infoPlist] = await Promise.all([
    readAppBundleEvidence(resolvedAppPath),
    readOptionalFileEvidence(executablePath, 'Apple macOS app executable'),
    readOptionalFileEvidence(infoPlistPath, 'Apple macOS Info.plist'),
  ])

  if (appBundle.totalBytes > maxBytes) {
    failures.push(
      `Apple macOS .app bundle is ${formatMiB(appBundle.totalBytes)}, above the PRD budget of ${formatMiB(maxBytes)}.`,
    )
  }

  if (!infoPlist) {
    failures.push('Apple macOS .app bundle must contain Contents/Info.plist.')
  }

  if (!executable) {
    failures.push('Apple macOS .app bundle must contain Contents/MacOS/ZeroChat.')
  } else if (executable.bytes <= 0) {
    failures.push('Apple macOS .app executable evidence must record positive bytes.')
  }

  const report = {
    schema: 'zerochat.appleMacosAppSize.v1',
    generatedAt: new Date().toISOString(),
    passed: failures.length === 0,
    safeToPublish: true,
    publishSafetyScope,
    platform: 'apple-macos-app',
    appBundle,
    ...(infoPlist ? { infoPlist } : {}),
    ...(executable ? { executable } : {}),
    budget: {
      label: 'PRD macOS .app < 15MB',
      maxBytes,
    },
  }

  await mkdir(path.dirname(resolvedReportPath), { recursive: true })
  await writeFile(resolvedReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (failures.length) {
    throw new Error(
      `Apple macOS app size checks failed:\n- ${failures.join('\n- ')}\nReport: ${path.relative(repoRoot, resolvedReportPath)}`,
    )
  }

  console.log(
    `Apple macOS app size check passed: ${formatMiB(appBundle.totalBytes)} (${appBundle.totalBytes} bytes), SHA-256 ${appBundle.sha256}; report ${path.relative(repoRoot, resolvedReportPath)}`,
  )
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
