import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withReleaseReportLock } from './release-report-lock.mjs'
import {
  credentialEnvironmentFamiliesStripped,
  sanitizedDiagnosticEnv,
} from './release-diagnostics-env.mjs'
import {
  releaseBlockerIdsFromReport,
  releaseDiagnosticsChildSummaryFailures,
} from './release-diagnostics-summary-policy.mjs'
import { currentSummaryRefreshPlan } from './release-diagnostics-summary-refresh-plan.mjs'
import {
  parseReleaseDiagnosticsCliArgs,
  releaseDiagnosticsUsage,
} from './release-diagnostics-cli.mjs'
import { currentAndroidDebugApkEvidence } from './android-source-fingerprint.mjs'
import {
  androidRuntimeArtifactExpectation,
  isRuntimeArtifactGatePass,
  liveSyncRuntimeArtifactExpectation,
  webCurrentPageRuntimeArtifactExpectation,
} from './release-diagnostics-runtime-artifact-policy.mjs'

const cliResult = parseReleaseDiagnosticsCliArgs(process.argv.slice(2))

if (cliResult.kind === 'help') {
  console.log(releaseDiagnosticsUsage())
  process.exit(0)
}

if (cliResult.kind === 'error') {
  console.error(cliResult.message)
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const checkOnly = cliResult.mode === 'check'
const refreshSourceReportsOnly = cliResult.mode === 'refresh-source-reports'
const writeCurrentSummaryOnly = cliResult.mode === 'write-current-summary'
const validateCurrentSources = cliResult.validateCurrentSources
const allowRefreshableWebCurrentPageStale = cliResult.allowRefreshableWebCurrentPageStale
const liveSyncReleasePassReportPath = '.manual-qa/live-sync-release-drill.json'
const liveSyncDiagnosticReportPath =
  '.manual-qa/live-sync-release-drill-current-diagnostic.json'
const liveProviderDiagnosticReportPath = '.manual-qa/live-provider-smoke-current-diagnostic.json'
const liveProviderAttemptReportPath = '.manual-qa/live-provider-smoke-attempt-current.json'
const liveProviderUiReportPath = '.manual-qa/live-provider-ui-smoke-current.json'
const liveProviderUiAttemptReportPath = '.manual-qa/live-provider-ui-smoke-attempt-current.json'
const releaseDiagnosticsReportPath = '.manual-qa/release-diagnostics-current.json'
const releaseBlockerReportPath = '.manual-qa/release-blockers-current.json'
const publishSafetyScope =
  'sanitized-diagnostic-summary-only; relative paths, status, evidence types, and hashes only; child release-evidence metadata may be referenced without promoting this aggregate; no provider keys, URLs, tokens, passphrases, or payloads'
const releaseDiagnosticsTopLevelKeys = [
  'kind',
  'version',
  'generatedAt',
  'startedAt',
  'finishedAt',
  'status',
  'passed',
  'releaseEvidence',
  'evidenceType',
  'safeToPublish',
  'publishSafetyScope',
  'sanitizedChildEnvironment',
  'credentialEnvironmentFamiliesStripped',
  'steps',
  'runtimeArtifactExpectedBlocker',
  'reportSummaries',
  'reportCount',
  'residualReleaseBlockers',
]

const reportPaths = [
  '.manual-qa/windows-msix-host-preflight.json',
  '.manual-qa/hosted-native-ci-evidence.json',
  liveSyncReleasePassReportPath,
  liveSyncDiagnosticReportPath,
  liveProviderDiagnosticReportPath,
  liveProviderAttemptReportPath,
  liveProviderUiReportPath,
  liveProviderUiAttemptReportPath,
  '.manual-qa/strict-release-preflight.json',
  '.manual-qa/release-blockers-current.json',
]

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function removeTemporaryPathAfterFailedAtomicWrite(temporaryPath, originalError) {
  try {
    await rm(temporaryPath, { force: true })
  } catch (cleanupError) {
    throw new Error(
      `Atomic release diagnostics write failed and temporary file cleanup failed: ${errorMessage(
        originalError,
      )}; cleanup failure: ${errorMessage(cleanupError)}`,
    )
  }
}

function displayCommand(command, args) {
  const displayName = command === node ? 'node' : command

  return [displayName, ...args]
    .map((arg) => {
      if (isAbsolute(arg)) {
        return relative(root, arg) || arg
      }

      return arg
    })
    .join(' ')
}

function runStep({ label, command = node, args, env }) {
  return new Promise((resolveStep, rejectStep) => {
    console.log(`\n[release-diagnostics] ${label}`)
    console.log(`> ${displayCommand(command, args)}`)
    const startedAt = new Date().toISOString()

    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', rejectStep)
    child.on('close', (code) => {
      if (code === 0) {
        resolveStep({
          label,
          command: displayCommand(command, args),
          startedAt,
          finishedAt: new Date().toISOString(),
          expectedExitCode: 0,
          actualExitCode: code,
          passed: true,
        })
        return
      }

      rejectStep(
        new Error(`${label} failed with exit code ${code ?? 'unknown'}.`),
      )
    })
  })
}

function runCapturedStep({ command = node, args, env }) {
  return new Promise((resolveStep, rejectStep) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', rejectStep)
    child.on('close', (code) => {
      resolveStep({
        code: code ?? 1,
        output: `${stdout}\n${stderr}`,
      })
    })
  })
}

function compactOutput(output) {
  const lines = String(output)
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')

  if (lines.length <= 40) {
    return lines.join('\n')
  }

  return [
    ...lines.slice(0, 20),
    `... ${lines.length - 40} lines omitted ...`,
    ...lines.slice(-20),
  ].join('\n')
}

function evidencePath(reportPath) {
  return relative(root, resolve(root, reportPath)).replace(/\\/gu, '/')
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

async function readReportBytes(reportPath, label = 'diagnostic report') {
  try {
    return await readFile(resolve(root, reportPath))
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw new Error(
      `Unable to read ${label} at ${evidencePath(reportPath)} (${fileSystemErrorCode(error)}).`,
    )
  }
}

function parseReportJson(buffer, reportPath, label = 'diagnostic report') {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    throw new Error(
      `Unable to parse ${label} at ${evidencePath(reportPath)}: ${jsonParseErrorMessage(error)}`,
    )
  }
}

async function readJsonReport(reportPath) {
  const buffer = await readReportBytes(reportPath, 'JSON report')
  if (!buffer) {
    throw new Error(`Missing JSON report at ${evidencePath(reportPath)}.`)
  }

  return parseReportJson(buffer, reportPath, 'JSON report')
}

async function readOptionalJsonReport(reportPath, label = 'JSON report') {
  const buffer = await readReportBytes(reportPath, label)
  if (!buffer) {
    return null
  }

  return parseReportJson(buffer, reportPath, label)
}

async function auditExpectedRuntimeArtifactBlocker(
  env,
  { allowRefreshableWebCurrentPageStale = false } = {},
) {
  const args = ['scripts/runtime-smoke-artifact-check.mjs']
  const trustedMsixValidationArgs = [
    'scripts/runtime-smoke-artifact-check.mjs',
    '--only-runtime-artifact',
    '--require-runtime-artifact=windows-msix-trusted',
  ]
  const trustedMsixCurrentReportPath = '.manual-qa/windows-msix-current-trusted-install-update-qa.json'
  const hostPreflightReportPath = '.manual-qa/windows-msix-host-preflight.json'
  const hostPreflightReport = await readOptionalJsonReport(
    hostPreflightReportPath,
    'Windows MSIX host preflight report',
  )
  const liveSyncExpectation = liveSyncRuntimeArtifactExpectation({
    releasePassReport: await readOptionalJsonReport(
      liveSyncReleasePassReportPath,
      'live sync canonical release-pass report',
    ),
    currentDiagnosticReport: await readOptionalJsonReport(
      liveSyncDiagnosticReportPath,
      'live sync current diagnostic report',
    ),
  })
  let currentAndroidApkEvidence = null
  try {
    currentAndroidApkEvidence = currentAndroidDebugApkEvidence({ repoRoot: root })
  } catch {
    currentAndroidApkEvidence = null
  }
  const androidExpectation = androidRuntimeArtifactExpectation({
    currentApkEvidence: currentAndroidApkEvidence,
  })
  const webCurrentPageExpectation = webCurrentPageRuntimeArtifactExpectation({
    allowRefreshableStale: allowRefreshableWebCurrentPageStale,
  })
  const trustedMsixValidationResult = await runCapturedStep({
    args: trustedMsixValidationArgs,
    env,
  })
  const trustedMsixValidationOutput = trustedMsixValidationResult.output
  const trustedMsixReleasePassCurrent =
    trustedMsixValidationResult.code === 0 &&
    isRuntimeArtifactGatePass(trustedMsixValidationOutput)
  if (
    (trustedMsixValidationResult.code === 0 && !trustedMsixReleasePassCurrent) ||
    (trustedMsixValidationResult.code !== 0 &&
      !trustedMsixValidationOutput.includes('Runtime smoke artifact checks failed:'))
  ) {
    throw new Error(
      [
        'Focused trusted MSIX runtime-artifact validation returned an unrecognized result.',
        'Captured output:',
        compactOutput(trustedMsixValidationOutput),
      ].join('\n'),
    )
  }
  const hostClassification = isObject(hostPreflightReport?.blockerClassification)
    ? hostPreflightReport.blockerClassification
    : {}
  const hostPreflightClear =
    hostPreflightReport?.status === 'clear' &&
    hostPreflightReport?.hostReadyForTrustedMsix === true
  const currentShellElevated = hostPreflightReport?.currentShellElevated === true
  const trustedMsixQaCanRunInCurrentShell = hostPreflightClear && currentShellElevated
  const trustedMsixQaReadiness = hostPreflightClear
    ? currentShellElevated
      ? 'host-clear-current-shell-elevated'
      : 'host-clear-current-shell-not-elevated'
    : 'host-blocked'
  const liveSyncExpectedReason = liveSyncExpectation.releasePassCurrent
    ? ''
    : liveSyncExpectation.sourceFingerprintCurrent
      ? ' plus missing current-source live sync release-pass evidence'
      : ' plus stale live sync release-pass evidence'
  const expectedReason = trustedMsixReleasePassCurrent
    ? liveSyncExpectation.releasePassCurrent
      ? 'no trusted-MSIX or live-sync blocker'
      : liveSyncExpectation.sourceFingerprintCurrent
        ? 'missing current-source live sync release-pass evidence only'
        : 'stale live sync release-pass evidence only'
    : hostPreflightClear
      ? `trusted MSIX release-pass evidence is still missing after a clear host preflight${liveSyncExpectedReason}`
      : `current trusted MSIX host blocker${
          liveSyncExpectation.releasePassCurrent ? ' only' : liveSyncExpectedReason
        }`
  const summary = trustedMsixReleasePassCurrent
    ? 'Focused Windows trusted MSIX runtime-artifact validation passes for the current packaged release.'
    : hostPreflightClear
      ? currentShellElevated
        ? 'Full runtime-artifact gate still fails on Windows trusted MSIX release-pass evidence; host preflight is clear and the current shell is elevated, so a trusted MSIX QA rerun on a disposable Windows profile is required.'
        : 'Full runtime-artifact gate still fails on Windows trusted MSIX release-pass evidence; host preflight is clear but the current shell is not elevated, so an elevated trusted MSIX QA rerun is required.'
      : 'Full runtime-artifact gate still fails on the current trusted MSIX host AppX cleanup blocker.'
  const completeSummary = liveSyncExpectation.releasePassCurrent
    ? summary
    : liveSyncExpectation.sourceFingerprintCurrent
      ? `${summary} The current sync source still needs a disposable live-sync release-pass.`
      : `${summary} The current sync source also needs a fresh disposable live-sync release drill.`
  const expectedOutcome =
    trustedMsixReleasePassCurrent && liveSyncExpectation.releasePassCurrent
      ? 'requires a complete runtime-artifact pass'
      : `accepts a complete pass or the exact audited blocker: ${expectedReason}`
  console.log('\n[release-diagnostics] Audit full runtime-artifact gate')
  console.log(`> ${displayCommand(node, args)}  # ${expectedOutcome}`)

  const result = await runCapturedStep({ args, env })
  const output = result.output
  const blockerClassification = trustedMsixReleasePassCurrent
    ? null
    : hostPreflightClear
      ? 'windows-trusted-msix-needs-elevated-current-source-rerun'
      : (hostClassification.kind ?? 'windows-host-preflight-blocked')
  const blockerOwner = trustedMsixReleasePassCurrent
    ? null
    : hostPreflightClear
      ? 'windows-release-qa-operator'
      : (hostClassification.owner ?? 'host-windows-appx-deployment-service')

  if (result.code === 0) {
    const passFailures = []
    if (!isRuntimeArtifactGatePass(output)) {
      passFailures.push('Runtime artifact gate exit code 0 must include the explicit pass marker without a failure header.')
    }
    if (!liveSyncExpectation.releasePassCurrent) {
      passFailures.push('Runtime artifact gate cannot pass while current-source live sync release-pass evidence is missing.')
    }
    if (!trustedMsixReleasePassCurrent) {
      passFailures.push('Runtime artifact gate cannot pass while focused trusted MSIX release evidence is not current.')
    }
    for (const marker of webCurrentPageExpectation.forbiddenMarkers) {
      if (output.includes(marker)) {
        passFailures.push(`Runtime artifact pass contains forbidden stale marker: ${marker}`)
      }
    }
    if (passFailures.length > 0) {
      throw new Error(
        [
          'Runtime artifact pass audit failed.',
          ...passFailures,
          'Captured output:',
          compactOutput(output),
        ].join('\n'),
      )
    }

    const passSummary =
      'Full runtime-artifact gate passes with current Windows trusted MSIX, Android, Web visual, and canonical live-sync artifacts; target-host prerequisites and strict remote evidence remain separate release blockers.'
    console.log(`[release-diagnostics] ${passSummary}`)
    return {
      kind: 'zerochat.releaseDiagnosticsRuntimeArtifactExpectedBlocker.v1',
      command: displayCommand(node, args),
      expectedExitCode: 0,
      actualExitCode: 0,
      passed: true,
      status: 'passed',
      blockerReport: null,
      blockerClassification: null,
      owner: null,
      currentHostPreflight: {
        path: hostPreflightReportPath,
        status: hostPreflightReport?.status ?? null,
        hostReadyForTrustedMsix: hostPreflightClear,
        currentShellElevated,
        trustedMsixQaCanRunInCurrentShell,
        trustedMsixQaReadiness,
        blockerKind: hostClassification.kind ?? null,
        matchedEventIds: Array.isArray(hostClassification.matchedEventIds)
          ? hostClassification.matchedEventIds
          : [],
        generatedAt:
          hostPreflightReport?.generatedAt ??
          hostPreflightReport?.finishedAt ??
          hostPreflightReport?.startedAt ??
          null,
      },
      currentTrustedQaState: 'current-trusted-msix-release-pass',
      additionalExpectedBlockers: [],
      androidRuntimeArtifact: {
        currentSourceBoundApk: androidExpectation.currentSourceBoundApk,
        staleBulletLines: [],
      },
      webCurrentPageArtifact: {
        allowRefreshableStale: allowRefreshableWebCurrentPageStale,
        staleBulletLines: [],
      },
      requiredMarkersPresent: ['Runtime smoke artifact checks passed:'],
      forbiddenMarkersAbsent: [
        'Runtime smoke artifact checks failed:',
        ...webCurrentPageExpectation.forbiddenMarkers,
      ],
      unexpectedBulletLineCount: 0,
      bulletLineCount: 0,
      summary: passSummary,
    }
  }
  const windowsRequiredMarkers = trustedMsixReleasePassCurrent
    ? []
    : hostPreflightClear
      ? [
          `${trustedMsixCurrentReportPath} distWebAssets`,
          `${trustedMsixCurrentReportPath} currentPackageEvidence`,
        ]
      : [`${hostPreflightReportPath} current host preflight status=blocked`]
  const requiredMarkers = [
    ...windowsRequiredMarkers,
    ...liveSyncExpectation.requiredMarkers,
  ]
  const forbiddenMarkers = [
    ...webCurrentPageExpectation.forbiddenMarkers,
    ...liveSyncExpectation.forbiddenMarkers,
    'required runtime smoke artifact is missing',
    'must be a passing live sync release drill report',
    'must be hosted native CI release evidence',
    'must be a passing full-capability live provider report',
  ]
  const bulletLines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
  const failures = []

  if (result.code !== 1) {
    failures.push(`Expected runtime artifact gate exit code 1, got ${result.code}.`)
  }

  for (const marker of requiredMarkers) {
    if (!output.includes(marker)) {
      failures.push(`Missing expected blocker marker: ${marker}`)
    }
  }

  for (const marker of forbiddenMarkers) {
    if (output.includes(marker)) {
      failures.push(`Unexpected runtime artifact blocker marker: ${marker}`)
    }
  }

  if (!bulletLines.length) {
    failures.push('Expected runtime artifact gate to print bullet failure lines.')
  }

  const androidStaleBulletLines = bulletLines.filter((line) =>
    androidExpectation.allowedBulletPrefixes.some((prefix) => line.startsWith(prefix)),
  )
  const webCurrentPageStaleBulletLines = bulletLines.filter((line) =>
    webCurrentPageExpectation.allowedBulletPrefixes.some((prefix) => line.startsWith(prefix)),
  )

  const unexpectedBulletLines = bulletLines.filter(
    (line) =>
      !(
        !trustedMsixReleasePassCurrent &&
        (line.startsWith(
          `- ${hostPreflightClear ? trustedMsixCurrentReportPath : hostPreflightReportPath}`,
        ) ||
          line.startsWith(`- ${hostPreflightReportPath}`))
      ) &&
      !liveSyncExpectation.allowedBulletPrefixes.some((prefix) => line.startsWith(prefix)) &&
      !androidExpectation.allowedBulletPrefixes.some((prefix) => line.startsWith(prefix)) &&
      !webCurrentPageExpectation.allowedBulletPrefixes.some((prefix) => line.startsWith(prefix)),
  )
  if (unexpectedBulletLines.length) {
    failures.push(
      `Unexpected runtime artifact blocker lines:\n${unexpectedBulletLines.join('\n')}`,
    )
  }

  if (failures.length) {
    throw new Error(
      [
        'Runtime artifact expected-blocker audit failed.',
        ...failures,
        'Captured output:',
        compactOutput(output),
      ].join('\n'),
    )
  }

  const androidSummary = androidStaleBulletLines.length
    ? ' Current Android runtime reports are bound to an older debug APK; rerun UI, Cloudflare sync, and aggregate emulator QA with the current source-bound APK.'
    : ''
  const webCurrentPageSummary = webCurrentPageStaleBulletLines.length
    ? ' Current-page Web evidence is source-stale only inside the verifier refresh window; the required current-page QA must regenerate it before the refreshed summary is reused.'
    : ''
  const finalSummary = `${completeSummary}${androidSummary}${webCurrentPageSummary}`
  console.log(`[release-diagnostics] ${finalSummary}`)

  return {
    kind: 'zerochat.releaseDiagnosticsRuntimeArtifactExpectedBlocker.v1',
    command: displayCommand(node, args),
    expectedExitCode: 1,
    actualExitCode: result.code,
    passed: true,
    status: 'expected-blocker',
    blockerReport: trustedMsixReleasePassCurrent
      ? null
      : hostPreflightClear
        ? trustedMsixCurrentReportPath
        : hostPreflightReportPath,
    blockerClassification,
    owner: blockerOwner,
    currentHostPreflight: {
      path: hostPreflightReportPath,
      status: hostPreflightReport?.status ?? null,
      hostReadyForTrustedMsix: hostPreflightClear,
      currentShellElevated,
      trustedMsixQaCanRunInCurrentShell,
      trustedMsixQaReadiness,
      blockerKind: hostClassification.kind ?? null,
      matchedEventIds: Array.isArray(hostClassification.matchedEventIds)
        ? hostClassification.matchedEventIds
        : [],
      generatedAt:
        hostPreflightReport?.generatedAt ??
        hostPreflightReport?.finishedAt ??
        hostPreflightReport?.startedAt ??
        null,
    },
    currentTrustedQaState: trustedMsixReleasePassCurrent
      ? 'current-trusted-msix-release-pass'
      : hostPreflightClear
        ? 'host-clear-needs-elevated-trusted-msix-rerun'
        : 'host-preflight-blocked-or-unproven',
    additionalExpectedBlockers: [
      ...(liveSyncExpectation.blocker ? [liveSyncExpectation.blocker] : []),
      ...(androidStaleBulletLines.length && androidExpectation.blocker
        ? [androidExpectation.blocker]
        : []),
    ],
    androidRuntimeArtifact: {
      currentSourceBoundApk: androidExpectation.currentSourceBoundApk,
      staleBulletLines: androidStaleBulletLines,
    },
    webCurrentPageArtifact: {
      allowRefreshableStale: allowRefreshableWebCurrentPageStale,
      staleBulletLines: webCurrentPageStaleBulletLines,
    },
    requiredMarkersPresent: requiredMarkers,
    forbiddenMarkersAbsent: forbiddenMarkers,
    unexpectedBulletLineCount: 0,
    bulletLineCount: bulletLines.length,
    summary: finalSummary,
  }
}

async function existingNativePrereqReports() {
  const manualQaDir = resolve(root, '.manual-qa')

  try {
    const entries = await readdir(manualQaDir)
    return entries
      .filter((entry) => /^native-prereq-.+\.json$/u.test(entry))
      .map((entry) => `.manual-qa/${entry}`)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }

    throw new Error(
      `Unable to list native prerequisite reports in ${evidencePath('.manual-qa')} (${fileSystemErrorCode(error)}).`,
    )
  }
}

async function reportSummary(reportPath) {
  const buffer = await readReportBytes(reportPath, 'release diagnostics child report')

  if (!buffer) {
    return null
  }

  const parsed = parseReportJson(buffer, reportPath, 'release diagnostics child report')

  const status =
    typeof parsed.status === 'string'
      ? parsed.status
      : parsed.passed === true
        ? 'passed'
        : parsed.passed === false
          ? 'failed'
          : 'unknown'

  return {
    path: reportPath,
    generatedAt:
      typeof parsed.generatedAt === 'string'
        ? parsed.generatedAt
        : typeof parsed.finishedAt === 'string'
          ? parsed.finishedAt
          : null,
    status,
    evidenceType: typeof parsed.evidenceType === 'string' ? parsed.evidenceType : 'unknown',
    safeToPublish: parsed.safeToPublish === true,
    releaseEvidence: parsed.releaseEvidence === true,
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

async function printReportSummaries({ refreshed = true } = {}) {
  const summaries = await collectReportSummaries()

  if (!summaries.length) {
    console.log('\n[release-diagnostics] No diagnostic reports found to summarize.')
    return summaries
  }

  console.log(
    `\n[release-diagnostics] ${refreshed ? 'Refreshed' : 'Current'} diagnostic artifacts:`,
  )
  for (const summary of summaries) {
    console.log(
      `- ${summary.path}: status=${summary.status}; evidenceType=${summary.evidenceType}; safeToPublish=${summary.safeToPublish}; releaseEvidence=${summary.releaseEvidence}; bytes=${summary.bytes}; sha256=${summary.sha256}`,
    )
  }

  return summaries
}

async function collectReportSummaries() {
  return (
    await Promise.all(
      [...reportPaths, ...(await existingNativePrereqReports())].map(reportSummary),
    )
  ).filter(Boolean)
}

async function readCurrentResidualReleaseBlockers() {
  return releaseBlockerIdsFromReport(await readJsonReport(releaseBlockerReportPath))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function timestampMs(value) {
  if (typeof value !== 'string') {
    return Number.NaN
  }

  const normalized = value.replace(/\.(\d{3})\d+(Z)$/u, '.$1$2')
  return Date.parse(normalized)
}

function isIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) &&
    Number.isFinite(timestampMs(value))
  )
}

function assertArrayEquals(actual, expected, label, failures) {
  if (!Array.isArray(actual)) {
    failures.push(`${label} must be an array.`)
    return
  }

  if (
    actual.length !== expected.length ||
    actual.some((item, index) => item !== expected[index])
  ) {
    failures.push(`${label} must exactly match ${JSON.stringify(expected)}.`)
  }
}

function assertJsonEquals(actual, expected, label, failures) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label} must match current diagnostic artifacts.`)
  }
}

function assertNoUnsafeSummaryMaterial(report, failures) {
  const serialized = JSON.stringify(report)
  const rootVariants = [root, root.replace(/\\/g, '/')]
  const unsafePatterns = [
    /(?<![A-Za-z])sk-[A-Za-z0-9_-]{20,}/u,
    /Bearer\s+sk-/iu,
    /https?:\/\//iu,
    /ZEROCHAT_LIVE_PROVIDER_API_KEY\s*=/iu,
    /ZEROCHAT_LIVE_PROVIDER_BASE_URL\s*=/iu,
  ]

  for (const rootVariant of rootVariants) {
    if (rootVariant && serialized.includes(rootVariant)) {
      failures.push('Release diagnostics summary must not contain absolute workspace paths.')
      break
    }
  }

  for (const pattern of unsafePatterns) {
    pattern.lastIndex = 0
    if (pattern.test(serialized)) {
      failures.push(
        `Release diagnostics summary contains unsafe material matching ${pattern}.`,
      )
    }
  }
}

function validateStepResults(reportSteps, failures) {
  if (!Array.isArray(reportSteps)) {
    failures.push('steps must be an array.')
    return
  }

  if (reportSteps.length !== fullDiagnosticRefreshSteps.length) {
    failures.push(`steps must contain ${fullDiagnosticRefreshSteps.length} entries.`)
    return
  }

  for (const [index, expectedStep] of fullDiagnosticRefreshSteps.entries()) {
    const step = reportSteps[index]
    const expectedCommand = displayCommand(
      expectedStep.command ?? node,
      expectedStep.args,
    )

    if (!isObject(step)) {
      failures.push(`steps[${index}] must be an object.`)
      continue
    }

    if (step.label !== expectedStep.label) {
      failures.push(`steps[${index}].label must be ${expectedStep.label}.`)
    }

    if (step.command !== expectedCommand) {
      failures.push(`steps[${index}].command must be ${expectedCommand}.`)
    }

    if (step.expectedExitCode !== 0 || step.actualExitCode !== 0 || step.passed !== true) {
      failures.push(`steps[${index}] must record a passing exit code 0 diagnostic step.`)
    }

    if (!isIsoTimestamp(step.startedAt) || !isIsoTimestamp(step.finishedAt)) {
      failures.push(`steps[${index}] must include ISO startedAt and finishedAt timestamps.`)
    } else if (timestampMs(step.finishedAt) < timestampMs(step.startedAt)) {
      failures.push(`steps[${index}].finishedAt must not be before startedAt.`)
    }
  }
}

function validateReleaseDiagnosticsReport({
  report,
  currentReportSummaries,
  currentResidualReleaseBlockers,
  runtimeArtifactExpectedBlocker,
}) {
  const failures = []

  if (!isObject(report)) {
    throw new Error('Release diagnostics summary must be a JSON object.')
  }

  assertArrayEquals(
    Object.keys(report),
    releaseDiagnosticsTopLevelKeys,
    'top-level release diagnostics keys',
    failures,
  )

  for (const [key, expected] of [
    ['kind', 'zerochat.releaseDiagnosticsRefresh.v1'],
    ['version', 1],
    ['status', 'blocked'],
    ['passed', false],
    ['releaseEvidence', false],
    ['evidenceType', 'release-diagnostics-summary'],
    ['safeToPublish', true],
    ['publishSafetyScope', publishSafetyScope],
    ['sanitizedChildEnvironment', true],
  ]) {
    if (report[key] !== expected) {
      failures.push(`${key} must be ${JSON.stringify(expected)}.`)
    }
  }

  for (const key of ['generatedAt', 'startedAt', 'finishedAt']) {
    if (!isIsoTimestamp(report[key])) {
      failures.push(`${key} must be an ISO timestamp.`)
    }
  }

  const generatedAtMs = timestampMs(report.generatedAt)
  const startedAtMs = timestampMs(report.startedAt)
  const finishedAtMs = timestampMs(report.finishedAt)
  if (
    Number.isFinite(startedAtMs) &&
    Number.isFinite(finishedAtMs) &&
    finishedAtMs < startedAtMs
  ) {
    failures.push('finishedAt must not be before startedAt.')
  }

  if (
    Number.isFinite(generatedAtMs) &&
    Number.isFinite(finishedAtMs) &&
    Math.abs(generatedAtMs - finishedAtMs) > 1000
  ) {
    failures.push('generatedAt must match the summary finishedAt timestamp.')
  }

  const newestSummaryMs = Math.max(
    ...currentReportSummaries
      .map((summary) => timestampMs(summary.generatedAt))
      .filter(Number.isFinite),
  )
  if (
    Number.isFinite(generatedAtMs) &&
    Number.isFinite(newestSummaryMs) &&
    generatedAtMs + 5000 < newestSummaryMs
  ) {
    failures.push(
      'generatedAt must not be older than newest summarized diagnostic report.',
    )
  }

  if (Number.isFinite(generatedAtMs) && generatedAtMs > Date.now() + 5 * 60 * 1000) {
    failures.push('generatedAt must not be more than five minutes in the future.')
  }

  assertArrayEquals(
    report.credentialEnvironmentFamiliesStripped,
    credentialEnvironmentFamiliesStripped,
    'credentialEnvironmentFamiliesStripped',
    failures,
  )
  assertArrayEquals(
    report.residualReleaseBlockers,
    currentResidualReleaseBlockers,
    'residualReleaseBlockers',
    failures,
  )
  validateStepResults(report.steps, failures)
  assertJsonEquals(
    report.runtimeArtifactExpectedBlocker,
    runtimeArtifactExpectedBlocker,
    'runtimeArtifactExpectedBlocker',
    failures,
  )
  assertJsonEquals(
    report.reportSummaries,
    currentReportSummaries,
    'report.reportSummaries',
    failures,
  )
  failures.push(...releaseDiagnosticsChildSummaryFailures(currentReportSummaries))
  const unsafeSummaryPaths = currentReportSummaries
    .filter((summary) => summary?.safeToPublish !== true)
    .map((summary) => summary?.path ?? 'unknown')
  if (unsafeSummaryPaths.length) {
    failures.push(
      `reportSummaries must only include child reports marked safeToPublish=true: ${unsafeSummaryPaths.join(', ')}.`,
    )
  }

  if (report.reportCount !== currentReportSummaries.length) {
    failures.push(`reportCount must be ${currentReportSummaries.length}.`)
  }

  assertNoUnsafeSummaryMaterial(report, failures)

  if (failures.length) {
    throw new Error(
      [
        'Release diagnostics summary check failed.',
        ...failures.map((failure) => `- ${failure}`),
      ].join('\n'),
    )
  }
}

async function checkReleaseDiagnosticsReport(env) {
  const reportPath = resolve(root, releaseDiagnosticsReportPath)
  const buffer = await readFile(reportPath)
  let report

  try {
    report = JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    throw new Error(
      `Unable to parse ${releaseDiagnosticsReportPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  console.log(
    '[release-diagnostics] Checking existing sanitized diagnostic summary without refreshing source reports.',
  )
  const currentReportSummaries = await collectReportSummaries()
  const currentResidualReleaseBlockers = await readCurrentResidualReleaseBlockers()
  const runtimeArtifactExpectedBlocker = await auditExpectedRuntimeArtifactBlocker(env)
  validateReleaseDiagnosticsReport({
    report,
    currentReportSummaries,
    currentResidualReleaseBlockers,
    runtimeArtifactExpectedBlocker,
  })

  const sha256 = createHash('sha256').update(buffer).digest('hex').toUpperCase()
  console.log(
    `\n[release-diagnostics] Release diagnostics summary check passed: ${releaseDiagnosticsReportPath}: ${report.reportCount} reports; ${report.runtimeArtifactExpectedBlocker.status}; bytes=${buffer.length}; sha256=${sha256}`,
  )
}

async function writeTextFileAtomically(reportPath, text) {
  const targetPath = resolve(root, reportPath)
  const temporaryPath = resolve(
    root,
    `${reportPath}.${process.pid}.${Date.now()}.tmp`,
  )

  await mkdir(dirname(targetPath), { recursive: true })

  try {
    await writeFile(temporaryPath, text)
    await rename(temporaryPath, targetPath)
  } catch (error) {
    await removeTemporaryPathAfterFailedAtomicWrite(temporaryPath, error)
    throw error
  }
}

async function writeReleaseDiagnosticsReport({
  startedAt,
  steps,
  runtimeArtifactExpectedBlocker,
  reportSummaries,
  residualReleaseBlockers,
}) {
  const finishedAt = new Date().toISOString()
  const report = {
    kind: 'zerochat.releaseDiagnosticsRefresh.v1',
    version: 1,
    generatedAt: finishedAt,
    startedAt,
    finishedAt,
    status: 'blocked',
    passed: false,
    releaseEvidence: false,
    evidenceType: 'release-diagnostics-summary',
    safeToPublish: true,
    publishSafetyScope,
    sanitizedChildEnvironment: true,
    credentialEnvironmentFamiliesStripped,
    steps,
    runtimeArtifactExpectedBlocker,
    reportSummaries,
    reportCount: reportSummaries.length,
    residualReleaseBlockers,
  }

  validateReleaseDiagnosticsReport({
    report,
    currentReportSummaries: reportSummaries,
    currentResidualReleaseBlockers: residualReleaseBlockers,
    runtimeArtifactExpectedBlocker,
  })

  await writeTextFileAtomically(
    releaseDiagnosticsReportPath,
    `${JSON.stringify(report, null, 2)}\n`,
  )

  const buffer = await readFile(resolve(root, releaseDiagnosticsReportPath))
  const sha256 = createHash('sha256').update(buffer).digest('hex').toUpperCase()
  console.log(
    `\n[release-diagnostics] Summary report written: ${releaseDiagnosticsReportPath}; bytes=${buffer.length}; sha256=${sha256}`,
  )
  return { path: releaseDiagnosticsReportPath, bytes: buffer.length, sha256 }
}

async function readReusablePriorStepResults() {
  const priorReport = await readJsonReport(releaseDiagnosticsReportPath).catch((error) => {
    throw new Error(
      `Unable to write current release diagnostics summary because ${releaseDiagnosticsReportPath} is missing or unreadable. Run a full sanitized diagnostic refresh first: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  })
  const failures = []

  validateStepResults(priorReport?.steps, failures)
  if (failures.length) {
    throw new Error(
      [
        `Unable to write current release diagnostics summary because ${releaseDiagnosticsReportPath} does not contain reusable prior diagnostic step results.`,
        ...failures.map((failure) => `- ${failure}`),
      ].join('\n'),
    )
  }

  return priorReport.steps.map((step) => ({ ...step }))
}

function reusableSummaryStartedAt(steps) {
  const stepStartedTimes = steps
    .map((step) => timestampMs(step.startedAt))
    .filter(Number.isFinite)

  if (!stepStartedTimes.length) {
    return new Date().toISOString()
  }

  return new Date(Math.min(...stepStartedTimes)).toISOString()
}

async function writeCurrentReleaseDiagnosticsSummary(
  { allowRefreshableWebCurrentPageStale = false } = {},
) {
  await withReleaseReportLock('release-diagnostics-current-summary', async () => {
    const lockedDiagnosticEnv = sanitizedDiagnosticEnv(process.env)
    console.log(
      '[release-diagnostics] Rewriting aggregate summary from existing diagnostic reports only; child reports will not be refreshed.',
    )
    let stepResults
    try {
      stepResults = await readReusablePriorStepResults()
    } catch {
      console.log(
        '[release-diagnostics] Existing aggregate steps cannot be reused after a diagnostic command-set change; running one full sanitized diagnostic refresh.',
      )
      await refreshFullDiagnostics(lockedDiagnosticEnv)
      return
    }
    const runtimeArtifactExpectedBlocker = await auditExpectedRuntimeArtifactBlocker(
      lockedDiagnosticEnv,
      { allowRefreshableWebCurrentPageStale },
    )
    const reportSummaries = await printReportSummaries({ refreshed: false })
    const residualReleaseBlockers = await readCurrentResidualReleaseBlockers()
    await writeReleaseDiagnosticsReport({
      startedAt: reusableSummaryStartedAt(stepResults),
      steps: stepResults,
      runtimeArtifactExpectedBlocker,
      reportSummaries,
      residualReleaseBlockers,
    })
    console.log(
      '\n[release-diagnostics] Current diagnostic summary rewrite complete; the aggregate remains releaseEvidence=false and is not release readiness.',
    )
  })
}

const sourceReportRefreshSteps = [
  {
    label: 'Refresh Windows trusted MSIX host preflight',
    command: 'powershell',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'scripts/windows-msix-host-preflight.ps1',
    ],
  },
  {
    label: 'Validate Windows trusted MSIX host preflight report',
    args: ['scripts/windows-msix-host-preflight-check.mjs'],
  },
  {
    label: 'Refresh and validate native prerequisite diagnostics',
    args: ['scripts/native-prereq-report-refresh.mjs'],
  },
  {
    label: 'Refresh hosted native CI missing-evidence diagnostic',
    args: [
      'scripts/hosted-native-ci-evidence-check.mjs',
      '--refresh-diagnostic',
      '--report=.manual-qa/hosted-native-ci-evidence-diagnostic.json',
    ],
  },
  {
    label: 'Validate hosted native CI diagnostic report',
    args: [
      'scripts/hosted-native-ci-evidence-check.mjs',
      '--report=.manual-qa/hosted-native-ci-evidence-diagnostic.json',
    ],
  },
  {
    label: 'Refresh live sync no-credential diagnostic',
    args: ['scripts/live-sync-release-drill.mjs'],
  },
  {
    label: 'Validate live sync diagnostic report',
    args: [
      'scripts/runtime-smoke-artifact-check.mjs',
      '--only-live-sync-report',
      `--require-live-sync-report=${liveSyncDiagnosticReportPath}`,
    ],
  },
  {
    label: 'Refresh live provider no-credential diagnostic',
    args: ['scripts/live-provider-diagnostic-report.mjs'],
  },
  {
    label: 'Refresh live provider UI local-proxy no-credential diagnostic',
    args: ['scripts/live-provider-ui-local-proxy-diagnostic.mjs'],
  },
  {
    label: 'Refresh live provider UI no-credential diagnostic',
    args: ['scripts/live-provider-ui-smoke.mjs'],
  },
  {
    label: 'Validate live provider UI diagnostic report',
    args: ['scripts/release-blocker-report.mjs', '--check-live-provider-ui-report'],
  },
]
const fullDiagnosticRefreshSteps = [
  ...sourceReportRefreshSteps,
  {
    label: 'Refresh strict release preflight and release blocker diagnostics',
    args: ['scripts/strict-release-preflight-report.mjs'],
  },
  {
    label: 'Validate local runtime cleanup after diagnostics',
    args: ['scripts/local-runtime-cleanup-check.mjs'],
  },
]

async function refreshSourceReports(diagnosticEnv) {
  const stepResults = []

  for (const step of sourceReportRefreshSteps) {
    stepResults.push(
      await runStep({
        ...step,
        command: step.command ?? node,
        env: diagnosticEnv,
      }),
    )
  }

  return stepResults
}

async function refreshFullDiagnostics(diagnosticEnv) {
  const startedAt = new Date().toISOString()
  console.log(
    '[release-diagnostics] Running sanitized-diagnostic-only refresh; no live provider, live sync, or GitHub credential env is passed to child commands.',
  )

  const stepResults = await refreshSourceReports(diagnosticEnv)
  for (const step of fullDiagnosticRefreshSteps.slice(sourceReportRefreshSteps.length)) {
    stepResults.push(
      await runStep({
        ...step,
        command: step.command ?? node,
        env: diagnosticEnv,
      }),
    )
  }

  const runtimeArtifactExpectedBlocker = await auditExpectedRuntimeArtifactBlocker(
    diagnosticEnv,
  )
  const reportSummaries = await printReportSummaries()
  const residualReleaseBlockers = await readCurrentResidualReleaseBlockers()
  await writeReleaseDiagnosticsReport({
    startedAt,
    steps: stepResults,
    runtimeArtifactExpectedBlocker,
    reportSummaries,
    residualReleaseBlockers,
  })
  console.log(
    '\n[release-diagnostics] Diagnostic refresh complete; the aggregate remains releaseEvidence=false and is not release readiness.',
  )
}

try {
  if (checkOnly) {
    const diagnosticEnv = sanitizedDiagnosticEnv(process.env)
    await checkReleaseDiagnosticsReport(diagnosticEnv)
  } else if (writeCurrentSummaryOnly) {
    const diagnosticEnv = sanitizedDiagnosticEnv(process.env)
    const currentSummaryPlan = currentSummaryRefreshPlan(validateCurrentSources)
    await runStep({
      ...currentSummaryPlan.refreshBlockerSummary,
      env: diagnosticEnv,
    })
    await writeCurrentReleaseDiagnosticsSummary({ allowRefreshableWebCurrentPageStale })
    if (currentSummaryPlan.validateBlockerSources) {
      await runStep({
        ...currentSummaryPlan.validateBlockerSources,
        env: diagnosticEnv,
      })
    }
  } else if (refreshSourceReportsOnly) {
    await withReleaseReportLock('release-diagnostics-source-reports', async () => {
      const diagnosticEnv = sanitizedDiagnosticEnv(process.env)
      console.log(
        '[release-diagnostics] Refreshing sanitized source diagnostic reports only; no live provider, live sync, or GitHub credential env is passed to child commands.',
      )
      await refreshSourceReports(diagnosticEnv)
      console.log('\n[release-diagnostics] Source diagnostic report refresh complete.')
    })
  } else {
    await withReleaseReportLock('release-diagnostics-refresh', async () => {
      const diagnosticEnv = sanitizedDiagnosticEnv(process.env)
      await refreshFullDiagnostics(diagnosticEnv)
    })
  }
} catch (error) {
  console.error(
    `\n[release-diagnostics] ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
}
