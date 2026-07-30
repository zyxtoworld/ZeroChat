import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  nativePrereqReportRefreshUsage,
  parseNativePrereqReportRefreshCliArgs,
} from './native-prereq-cli.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manualQaDir = path.join(root, '.manual-qa')
const validPlatforms = new Set(['all', 'android', 'apple', 'windows', 'linux', 'current'])

function isManualQaNativePrereqReport(reportPath) {
  const resolved = path.resolve(root, reportPath)
  const relative = path.relative(manualQaDir, resolved)

  return (
    relative &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    /^native-prereq-.+\.json$/u.test(path.basename(resolved))
  )
}

const cliResult = parseNativePrereqReportRefreshCliArgs(process.argv.slice(2))

if (cliResult.kind === 'help') {
  console.log(nativePrereqReportRefreshUsage())
  process.exit(0)
}

if (cliResult.kind === 'error') {
  console.error(cliResult.message)
  process.exit(1)
}

function reportPathsFromArgs() {
  const reports = cliResult.reportPaths

  if (reports.length) {
    return reports
  }

  if (!existsSync(manualQaDir)) {
    return []
  }

  return readdirSync(manualQaDir)
    .filter((name) => /^native-prereq-.+\.json$/u.test(name))
    .map((name) => path.join('.manual-qa', name))
    .sort((left, right) => left.localeCompare(right))
}

function reportsAreSafeToRefresh(reportPaths) {
  const resolvedPaths = new Set()

  for (const reportPath of reportPaths) {
    if (!isManualQaNativePrereqReport(reportPath)) {
      return false
    }

    const resolved = path.resolve(root, reportPath)
    const identity = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (resolvedPaths.has(identity)) {
      return false
    }

    resolvedPaths.add(identity)
  }

  return true
}

function inferPlatformFromFilename(reportPath) {
  const name = path.basename(reportPath).toLowerCase()

  if (name.includes('all-platforms')) {
    return 'all'
  }

  for (const platform of ['android', 'apple', 'windows', 'linux', 'current']) {
    if (name.includes(platform)) {
      return platform
    }
  }

  return 'all'
}

function readRequestedPlatform(reportPath) {
  try {
    const report = JSON.parse(readFileSync(path.resolve(root, reportPath), 'utf8'))
    const requestedPlatform =
      typeof report.requestedPlatform === 'string'
        ? report.requestedPlatform.trim().toLowerCase()
        : ''

    if (validPlatforms.has(requestedPlatform)) {
      return requestedPlatform
    }
  } catch {
    // Fall through to the filename-based handoff for older diagnostics.
  }

  return inferPlatformFromFilename(reportPath)
}

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function compactOutput(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6)
    .join('\n')
}

function isNativeSourceFingerprintValidationFailure(output) {
  return (
    /sourceFingerprint\.(?:roots|fileCount|totalBytes|sha256) must match/u.test(output) ||
    /rerun native-build-prereq-check for the current source tree/u.test(output)
  )
}

const reportPaths = reportPathsFromArgs().map((reportPath) => reportPath.trim())

if (!reportPaths.length) {
  console.log('No native prerequisite reports found to refresh.')
  process.exit(0)
}

if (!reportsAreSafeToRefresh(reportPaths)) {
  console.error(
    'Native prerequisite report refresh failed: Reports must be unique native-prereq-*.json files under .manual-qa.',
  )
  process.exit(1)
}

const failures = []
const refreshed = []

for (const reportPath of reportPaths) {
  const requestedPlatform = readRequestedPlatform(reportPath)
  const preflight = runNode([
    'scripts/native-build-prereq-check.mjs',
    `--platform=${requestedPlatform}`,
    `--report=${reportPath}`,
  ])

  if (preflight.status !== 0 && preflight.status !== 1) {
    failures.push(
      `${reportPath} refresh command exited ${preflight.status ?? 'unknown'}.\n${compactOutput(preflight)}`,
    )
    continue
  }

  const validation = runNode([
    'scripts/runtime-smoke-artifact-check.mjs',
    '--only-native-prereq-report',
    `--require-native-prereq=${reportPath}`,
  ])

  if (validation.status !== 0) {
    const output = compactOutput(validation)
    failures.push(
      `${reportPath} failed focused validation after refresh.\n${output}`,
    )

    if (isNativeSourceFingerprintValidationFailure(output)) {
      failures.push(
        'Stopped native prerequisite refresh early because the preflight report and runtime-artifact validator disagree about the guarded native source fingerprint. Sync nativeSourceFingerprintRoots in scripts/native-build-prereq-check.mjs and scripts/runtime-smoke-artifact-check.mjs before refreshing the remaining reports.',
      )
      break
    }

    continue
  }

  refreshed.push({
    reportPath,
    requestedPlatform,
    preflightExitCode: preflight.status ?? 0,
    validationSummary: compactOutput(validation),
  })
}

for (const item of refreshed) {
  console.log(
    `Refreshed ${item.reportPath} platform=${item.requestedPlatform} preflightExit=${item.preflightExitCode}`,
  )
}

if (failures.length) {
  console.error(`Native prerequisite report refresh failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`Native prerequisite reports refreshed and validated: ${refreshed.length}`)
