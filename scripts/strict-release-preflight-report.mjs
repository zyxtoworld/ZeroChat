import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withReleaseReportLock } from './release-report-lock.mjs'
import {
  isStrictReleaseBlocked,
  isStrictReleasePass,
} from './release-blocker-state.mjs'
import { sanitizedDiagnosticEnv } from './release-diagnostics-env.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const reportPath = '.manual-qa/strict-release-preflight.json'
const strictBlockerHeading = 'Strict release preflight blockers remain'
const strictGateArgs = [
  'scripts/verify-release.mjs',
  '--all-platforms',
  '--require-native-runtime-artifacts',
  '--require-live-sync-pass',
  '--require-hosted-native-ci-evidence',
  '--require-live-provider-full-capability',
]
const sourceReportRefreshArgs = [
  'scripts/release-diagnostics-refresh.mjs',
  '--refresh-source-reports',
]
const validationArgs = [
  'scripts/runtime-smoke-artifact-check.mjs',
  '--only-strict-release-preflight-report',
  `--require-strict-release-preflight-report=${reportPath}`,
]
const releaseBlockerValidationArgs = [
  'scripts/release-blocker-report.mjs',
  '--check',
]

function displayCommand(args) {
  return ['node', ...args]
    .map((arg) => (isAbsolute(arg) ? relative(root, arg) || arg : arg))
    .join(' ')
}

function sanitizeText(value) {
  const rootForward = root.replaceAll('\\', '/')

  return String(value)
    .replaceAll(root, '<repo>')
    .replaceAll(rootForward, '<repo>')
    .replace(/\bBearer\s+[^\s"'`]+/giu, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, 'sk-[redacted]')
    .replace(/https?:\/\/[^\s"'`)]*/giu, '[redacted-url]')
    .replace(
      /\b(ZEROCHAT_[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|BASE_URL))\s*=\s*[^\s"'`]+/gu,
      '$1=[redacted]',
    )
}

function compactOutput(output) {
  const lines = sanitizeText(output)
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')

  if (lines.length <= 80) {
    return lines.join('\n')
  }

  return [
    ...lines.slice(0, 40),
    `... ${lines.length - 80} lines omitted ...`,
    ...lines.slice(-40),
  ].join('\n')
}

function runNode(args) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(node, args, {
      cwd: root,
      env: {
        ...sanitizedDiagnosticEnv(process.env),
        ZEROCHAT_SKIP_VERIFY_RELEASE_CHECKPOINT: '1',
        ZEROCHAT_SKIP_STRICT_RELEASE_PREFLIGHT_REFRESH: '1',
      },
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
    child.on('error', rejectProcess)
    child.on('close', (code, signal) => {
      resolveProcess({
        code,
        signal,
        stdout,
        stderr,
        combinedOutput: `${stdout}\n${stderr}`,
      })
    })
  })
}

async function readReport() {
  const report = JSON.parse(await readFile(resolve(root, reportPath), 'utf8'))

  if (!Array.isArray(report.blockers)) {
    throw new Error(`${reportPath} blockers must be an array after validation.`)
  }

  return report
}

function summarizeReport(report) {
  const blockerLabels = report.blockers.map((blocker) => sanitizeText(blocker.label))
  const strictPreflightPassed = isStrictReleasePass(report)

  console.log('\nStrict release preflight diagnostic report refreshed and validated.')
  console.log(`Report: ${reportPath}`)
  console.log(`Generated: ${report.generatedAt}`)
  console.log(`Status: ${report.status}`)
  console.log(`Blockers: ${report.blockerCount}`)
  if (strictPreflightPassed) {
    console.log('No strict release preflight blockers remain.')
  } else {
    for (const label of blockerLabels) {
      console.log(`- ${label}`)
    }
  }
  console.log('\nThis is diagnostic-only blocker evidence; it is not release readiness.')
}

async function main() {
  const startedAtMs = Date.now()
  console.log(
    `Refreshing sanitized diagnostic source reports: ${displayCommand(sourceReportRefreshArgs)}`,
  )
  const sourceReportRefreshResult = await runNode(sourceReportRefreshArgs)
  if (sourceReportRefreshResult.code !== 0) {
    throw new Error(
      [
        'The strict release preflight could not refresh current sanitized source diagnostic reports.',
        'Captured output:',
        compactOutput(sourceReportRefreshResult.combinedOutput),
      ].join('\n'),
    )
  }

  console.log(`Running strict release preflight diagnostic: ${displayCommand(strictGateArgs)}`)

  const strictResult = await runNode(strictGateArgs)

  const strictPreflightPassed = strictResult.code === 0
  if (!strictPreflightPassed && !strictResult.combinedOutput.includes(strictBlockerHeading)) {
    throw new Error(
      [
        'The strict release preflight failed before producing the expected blocker report.',
        `Expected output marker: ${strictBlockerHeading}`,
        'Captured output:',
        compactOutput(strictResult.combinedOutput),
      ].join('\n'),
    )
  }

  console.log(`Validating strict release preflight report: ${displayCommand(validationArgs)}`)
  const validationResult = await runNode(validationArgs)
  if (validationResult.code !== 0) {
    throw new Error(
      [
        'The strict release preflight report was written but did not validate.',
        'Captured output:',
        compactOutput(validationResult.combinedOutput),
      ].join('\n'),
    )
  }

  const report = await readReport()
  const reportPassed = isStrictReleasePass(report)
  const reportBlocked = isStrictReleaseBlocked(report)
  if (!reportPassed && !reportBlocked) {
    throw new Error(`${reportPath} must represent a valid strict preflight passed or blocked state.`)
  }
  if (strictPreflightPassed !== reportPassed) {
    throw new Error(
      `${reportPath} status does not match the strict preflight process result (exitCode=${String(strictResult.code)}).`,
    )
  }

  const generatedAtMs = Date.parse(report.generatedAt ?? '')
  if (!Number.isFinite(generatedAtMs) || generatedAtMs < startedAtMs - 5000) {
    throw new Error(
      `${reportPath} was not refreshed by this diagnostic run; generatedAt=${String(report.generatedAt)}`,
    )
  }

  if (report.releaseEvidence !== false || report.evidenceType !== 'strict-release-preflight-diagnostic') {
    throw new Error(`${reportPath} must remain diagnostic-only releaseEvidence=false.`)
  }

  console.log(`Validating refreshed release blocker summary: ${displayCommand(releaseBlockerValidationArgs)}`)
  const releaseBlockerValidationResult = await runNode(releaseBlockerValidationArgs)
  if (releaseBlockerValidationResult.code !== 0) {
    throw new Error(
      [
        'The strict release preflight report validated, but the refreshed release blocker summary did not.',
        'Captured output:',
        compactOutput(releaseBlockerValidationResult.combinedOutput),
      ].join('\n'),
    )
  }

  summarizeReport(report)
}

try {
  await withReleaseReportLock('strict-release-preflight-report', main)
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
