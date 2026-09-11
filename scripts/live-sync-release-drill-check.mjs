import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sanitizeLiveSyncReportValue } from './live-sync-report-sanitizer.mjs'
import {
  liveSyncSourceFingerprint,
  liveSyncSourceFingerprintRoots,
} from './live-sync-source-fingerprint.mjs'

const failures = []
const LIVE_SYNC_CHECK_CHILD_TIMEOUT_MS = 60_000
const LIVE_SYNC_MISSING_INPUT_KEYS = new Set([
  'liveSyncMode',
  'throwawaySyncPassphrase',
  'destructiveConfirmation',
  'providerSpecificDisposableCredential',
  'disposableCloudflareWorkerEndpoint',
  'disposableGithubGistToken',
])

function runDrillFixture(args, { env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: LIVE_SYNC_CHECK_CHILD_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })

    child.once('error', (error) => {
      resolve({
        status: null,
        signal: null,
        stdout,
        stderr: `${stderr}${error instanceof Error ? error.message : String(error)}`,
      })
    })
    child.once('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr })
    })
  })
}

async function read(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${path}: ${error.message}`)
    return ''
  }
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

async function expectFileIsAbsent(filePath, label) {
  try {
    await readFile(filePath, 'utf8')
    failures.push(`${label} must not write a live sync report.`)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      failures.push(`${label} could not verify that no live sync report was written: ${error.message}`)
    }
  }
}

function has(source, value) {
  return typeof value === 'string' ? source.includes(value) : value.test(source)
}

async function liveSyncSourceFingerprintFixture() {
  return liveSyncSourceFingerprint()
}

function hasOnlySafeMissingInputKeys(report) {
  return (
    Array.isArray(report.missingInputKeys) &&
    report.missingInputKeys.every(
      (key) => typeof key === 'string' && LIVE_SYNC_MISSING_INPUT_KEYS.has(key),
    ) &&
    new Set(report.missingInputKeys).size === report.missingInputKeys.length
  )
}

function hasExpectedReleaseBlockerSummary(report, status, mode) {
  const summary = report.releaseBlockerSummary
  const expectedBlockerKind =
    status === 'skipped'
      ? 'missing-live-sync-release-inputs'
      : status === 'failed'
        ? 'live-sync-runtime-failed'
        : 'live-sync-preflight-blocked'

  return (
    summary?.kind === 'zerochat.liveSyncReleaseBlockerSummary.v1' &&
    summary.status === status &&
    summary.blockerKind === expectedBlockerKind &&
    summary.mode === mode &&
    summary.evidenceType === 'diagnostic' &&
    summary.releaseEvidence === false &&
    summary.remoteTouched === report.remoteTouched &&
    JSON.stringify(summary.missingInputKeys) === JSON.stringify(report.missingInputKeys) &&
    summary.missingInputCount === report.missingInputKeys.length &&
    JSON.stringify(summary.supportedModes) === JSON.stringify(['cloudflare', 'gist']) &&
    summary.destructiveConfirmationRequired === true &&
    JSON.stringify(summary.requiredInputs) === JSON.stringify(report.requiredInputs) &&
    summary.requiredInputCount === report.requiredInputs.length &&
    summary.requiredAction ===
      'Configure disposable Cloudflare or Gist sync credentials, use the destructive confirmation value, then rerun the live sync release drill.' &&
    JSON.stringify(summary.validationCommands) ===
      JSON.stringify(report.nextSteps.validationCommands)
  )
}

function hasLiveSyncSourceFingerprint(report) {
  const fingerprint = report?.sourceFingerprint

  return (
    fingerprint?.kind === 'zerochat.liveSyncSourceFingerprint.v1' &&
    JSON.stringify(fingerprint.roots) ===
      JSON.stringify(liveSyncSourceFingerprintRoots.map((root) => root.replaceAll('\\', '/'))) &&
    Number.isInteger(fingerprint.fileCount) &&
    fingerprint.fileCount > 0 &&
    Number.isInteger(fingerprint.totalBytes) &&
    fingerprint.totalBytes > 0 &&
    typeof fingerprint.sha256 === 'string' &&
    /^[A-F0-9]{64}$/u.test(fingerprint.sha256)
  )
}

function expectBlockedReport(report, mode, expectedErrorMarkers, label) {
  expect(
    report.kind === 'zerochat.liveSyncReleaseDrill' &&
      report.mode === mode &&
      report.status === 'blocked' &&
      report.evidenceType === 'diagnostic' &&
      report.releaseEvidence === false &&
      report.safeToPublish === true &&
      report.remoteTouched === false &&
      hasLiveSyncSourceFingerprint(report) &&
      hasOnlySafeMissingInputKeys(report) &&
      hasExpectedReleaseBlockerSummary(report, 'blocked', mode) &&
      expectedErrorMarkers.every((marker) => String(report.error).includes(marker)),
    `${label} must write a blocked, sanitized, no-remote-touch report.`,
  )
}

async function expectSkippedDiagnosticMissingInputs() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-sync-skipped-'))
  const reportPath = path.join(tempDir, 'live-sync-release-drill.json')

  try {
    const result = await runDrillFixture(['scripts/live-sync-release-drill.mjs'], {
      env: {
        ...process.env,
        ZEROCHAT_LIVE_SYNC_MODE: '',
        ZEROCHAT_LIVE_SYNC_CONFIRM: '',
        ZEROCHAT_LIVE_SYNC_PASSPHRASE: '',
        ZEROCHAT_LIVE_WORKER_ENDPOINT: '',
        ZEROCHAT_LIVE_GITHUB_TOKEN: '',
        ZEROCHAT_LIVE_GIST_ID: '',
        ZEROCHAT_LIVE_GIST_FILE: '',
        ZEROCHAT_LIVE_SYNC_REPORT: reportPath,
      },
    })

    expect(result.status === 0, 'No-mode live sync drill must safely skip.')

    const report = JSON.parse(await readFile(reportPath, 'utf8'))

    expect(
      report.kind === 'zerochat.liveSyncReleaseDrill' &&
        report.mode === null &&
        report.status === 'skipped' &&
        report.evidenceType === 'diagnostic' &&
        report.releaseEvidence === false &&
        report.safeToPublish === true &&
        report.remoteTouched === false &&
        hasLiveSyncSourceFingerprint(report) &&
        hasOnlySafeMissingInputKeys(report) &&
        hasExpectedReleaseBlockerSummary(report, 'skipped', null) &&
        report.missingInputKeys.includes('liveSyncMode') &&
        report.missingInputKeys.includes('throwawaySyncPassphrase') &&
        report.missingInputKeys.includes('destructiveConfirmation') &&
        report.missingInputKeys.includes('providerSpecificDisposableCredential'),
      'No-mode skipped report must list concrete safe missingInputKeys aliases.',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function expectCliArgumentsFailClosed() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-sync-cli-'))
  const reportPath = path.join(tempDir, 'live-sync-release-drill.json')
  const env = {
    ...process.env,
    ZEROCHAT_LIVE_SYNC_MODE: 'cloudflare',
    ZEROCHAT_LIVE_SYNC_CONFIRM: 'DELETE_REMOTE_ZEROCHAT_TEST_DATA',
    ZEROCHAT_LIVE_SYNC_PASSPHRASE: 'cli-argument-safety-passphrase',
    ZEROCHAT_LIVE_WORKER_ENDPOINT: 'https://zerochat-cli-argument-safety.trycloudflare.com',
    ZEROCHAT_LIVE_GITHUB_TOKEN: '',
    ZEROCHAT_LIVE_GIST_ID: '',
    ZEROCHAT_LIVE_GIST_FILE: '',
    ZEROCHAT_LIVE_SYNC_REPORT: reportPath,
  }
  const cases = [
    {
      args: ['--help'],
      expectedStatus: 0,
      expectedOutput: 'Usage: node scripts/live-sync-release-drill.mjs',
      label: 'Live sync drill help',
    },
    {
      args: ['--unexpected-mode'],
      expectedStatus: null,
      expectedOutput:
        'Live sync release drill failed: Unsupported command-line argument. Run with --help for supported modes.',
      label: 'Live sync drill unknown argument',
    },
    {
      args: ['--help', '--unexpected-mode'],
      expectedStatus: null,
      expectedOutput:
        'Live sync release drill failed: Unsupported command-line argument. Run with --help for supported modes.',
      label: 'Live sync drill combined arguments',
    },
  ]

  try {
    for (const testCase of cases) {
      await rm(reportPath, { force: true })
      const result = await runDrillFixture(
        ['scripts/live-sync-release-drill.mjs', ...testCase.args],
        { env },
      )
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

      expect(
        testCase.expectedStatus === null
          ? result.status !== 0
          : result.status === testCase.expectedStatus,
        `${testCase.label} must exit with the expected status before a live sync run starts.`,
      )
      expect(
        output.includes(testCase.expectedOutput),
        `${testCase.label} must print its non-secret usage or failure message.`,
      )
      expect(
        !output.includes(env.ZEROCHAT_LIVE_SYNC_PASSPHRASE) &&
          !output.includes(env.ZEROCHAT_LIVE_WORKER_ENDPOINT),
        `${testCase.label} must not echo configured disposable inputs.`,
      )
      await expectFileIsAbsent(reportPath, testCase.label)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function expectPassingReportRejectsDiagnosticFields() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-sync-passed-diag-'))
  const reportPath = path.join(tempDir, 'live-sync-release-drill.json')
  const now = new Date().toISOString()
  const passingReportWithDiagnostics = {
    kind: 'zerochat.liveSyncReleaseDrill',
    version: 1,
    mode: 'gist',
    status: 'passed',
    evidenceType: 'release-pass',
    releaseEvidence: true,
    safeToPublish: true,
    publishSafetyScope: 'sanitized-release-pass evidence',
    startedAt: now,
    finishedAt: now,
    passed: true,
    remoteTouched: true,
    sourceFingerprint: await liveSyncSourceFingerprintFixture(),
    drillName: 'ZeroChat live sync release drill diagnostic-field-negative-control',
    stages: {
      upload: true,
      secondDevicePull: true,
      editUpload: true,
      editPull: true,
      deleteUpload: true,
      deletePull: true,
      remoteClear: true,
    },
    cloudflare: null,
    gist: {
      gistFile: 'zerochat-sync.json',
      usedExistingDisposableGist: false,
      createdDisposableGist: true,
      createdDisposableGistDeleted: true,
      fileCleared: true,
    },
    cleanup: {
      remoteCleared: true,
      createdDisposableGistDeleted: true,
      bestEffortAfterFailureAttempted: false,
      bestEffortAfterFailureSucceeded: null,
      bestEffortAfterFailureError: null,
    },
    requiredInputs: [
      'Disposable Cloudflare Worker namespace or disposable GitHub Gist',
      'Throwaway sync passphrase',
      'Provider-specific disposable credential',
      'Destructive confirmation for disposable storage only',
      'Passed-report validation after a successful drill',
    ],
    reviewerChecklist: [
      'Use only a disposable Cloudflare Worker namespace or disposable GitHub Gist.',
      'Choose cloudflare or gist mode before running the drill.',
      'Provide a throwaway sync passphrase and matching disposable provider credentials.',
      'Set the destructive confirmation value only for disposable storage.',
      'After a successful drill, validate with the passed-report runtime artifact gate.',
      'If remoteTouched is true, clear the disposable storage before rerunning.',
    ],
    nextSteps: {
      docs: ['docs/RELEASE_CHECKLIST.md', '.github/workflows/live-drills.yml'],
      validationCommands: [
        'node scripts/runtime-smoke-artifact-check.mjs --only-live-sync-report --require-live-sync-report=.manual-qa/live-sync-release-drill.json',
        'node scripts/runtime-smoke-artifact-check.mjs --only-live-sync-report --require-live-sync-passed-report=.manual-qa/live-sync-release-drill.json',
      ],
    },
    releaseBlockerSummary: {
      kind: 'zerochat.liveSyncReleaseBlockerSummary.v1',
      status: 'skipped',
      blockerKind: 'missing-live-sync-release-inputs',
      mode: null,
      evidenceType: 'diagnostic',
      releaseEvidence: false,
      remoteTouched: false,
      missingInputKeys: ['liveSyncMode'],
      missingInputCount: 1,
      supportedModes: ['cloudflare', 'gist'],
      destructiveConfirmationRequired: true,
      requiredInputs: [
        'Disposable Cloudflare Worker namespace or disposable GitHub Gist',
        'Throwaway sync passphrase',
        'Provider-specific disposable credential',
        'Destructive confirmation for disposable storage only',
        'Passed-report validation after a successful drill',
      ],
      requiredInputCount: 5,
      requiredAction:
        'Configure disposable Cloudflare or Gist sync credentials, use the destructive confirmation value, then rerun the live sync release drill.',
      validationCommands: [
        'node scripts/runtime-smoke-artifact-check.mjs --only-live-sync-report --require-live-sync-report=.manual-qa/live-sync-release-drill.json',
        'node scripts/runtime-smoke-artifact-check.mjs --only-live-sync-report --require-live-sync-passed-report=.manual-qa/live-sync-release-drill.json',
      ],
    },
  }

  try {
    await writeFile(reportPath, `${JSON.stringify(passingReportWithDiagnostics, null, 2)}\n`)

    const result = await runDrillFixture(
      [
        'scripts/runtime-smoke-artifact-check.mjs',
        '--only-live-sync-report',
        `--require-live-sync-passed-report=${reportPath}`,
      ],
      {},
    )
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

    expect(
      result.status !== 0 &&
        output.includes('passing report must not keep diagnostic requiredInputs') &&
        output.includes('passing report must not keep diagnostic reviewerChecklist') &&
        output.includes('passing report must not keep diagnostic nextSteps') &&
        output.includes('passing report must not keep diagnostic releaseBlockerSummary'),
      'Passing live sync release reports with diagnostic fields must fail the passed-only runtime artifact gate.',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function expectPassingReportRejectsGenericDrillName() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-sync-generic-name-'))
  const reportPath = path.join(tempDir, 'live-sync-release-drill.json')
  const now = new Date().toISOString()
  const passingReportWithGenericDrillName = {
    kind: 'zerochat.liveSyncReleaseDrill',
    version: 1,
    mode: 'gist',
    status: 'passed',
    evidenceType: 'release-pass',
    releaseEvidence: true,
    safeToPublish: true,
    publishSafetyScope: 'sanitized-release-pass evidence',
    startedAt: now,
    finishedAt: now,
    passed: true,
    remoteTouched: true,
    sourceFingerprint: await liveSyncSourceFingerprintFixture(),
    drillName: 'ZeroChat live sync release drill',
    stages: {
      upload: true,
      secondDevicePull: true,
      editUpload: true,
      editPull: true,
      deleteUpload: true,
      deletePull: true,
      remoteClear: true,
    },
    cloudflare: null,
    gist: {
      gistFile: 'zerochat-sync.json',
      usedExistingDisposableGist: false,
      createdDisposableGist: true,
      createdDisposableGistDeleted: true,
      fileCleared: true,
    },
    cleanup: {
      remoteCleared: true,
      createdDisposableGistDeleted: true,
      bestEffortAfterFailureAttempted: false,
      bestEffortAfterFailureSucceeded: null,
      bestEffortAfterFailureError: null,
    },
  }

  try {
    await writeFile(reportPath, `${JSON.stringify(passingReportWithGenericDrillName, null, 2)}\n`)

    const result = await runDrillFixture(
      [
        'scripts/runtime-smoke-artifact-check.mjs',
        '--only-live-sync-report',
        `--require-live-sync-passed-report=${reportPath}`,
      ],
      {},
    )
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

    expect(
      result.status !== 0 &&
        output.includes(
          'must record a unique disposable drill Skill name with an epoch-millisecond suffix',
        ),
      'Passing live sync release reports with a generic drillName must fail the passed-only runtime artifact gate.',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function expectPassingReportRejectsStaleSourceFingerprint() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-sync-stale-source-'))
  const reportPath = path.join(tempDir, 'live-sync-release-drill.json')
  const startedMs = Date.now()
  const sourceFingerprint = await liveSyncSourceFingerprintFixture()
  sourceFingerprint.sha256 = '0000000000000000000000000000000000000000000000000000000000000000'
  const passingReportWithStaleSource = {
    kind: 'zerochat.liveSyncReleaseDrill',
    version: 1,
    mode: 'gist',
    status: 'passed',
    evidenceType: 'release-pass',
    releaseEvidence: true,
    safeToPublish: true,
    publishSafetyScope: 'sanitized-release-pass evidence',
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(startedMs + 1).toISOString(),
    passed: true,
    remoteTouched: true,
    sourceFingerprint,
    drillName: `ZeroChat live sync release drill ${startedMs}`,
    stages: {
      upload: true,
      secondDevicePull: true,
      editUpload: true,
      editPull: true,
      deleteUpload: true,
      deletePull: true,
      remoteClear: true,
    },
    cloudflare: null,
    gist: {
      gistFile: 'zerochat-sync.json',
      usedExistingDisposableGist: false,
      createdDisposableGist: true,
      createdDisposableGistDeleted: true,
    },
    cleanup: {
      remoteCleared: true,
      createdDisposableGistDeleted: true,
      bestEffortAfterFailureAttempted: false,
      bestEffortAfterFailureSucceeded: null,
      bestEffortAfterFailureError: null,
    },
  }

  try {
    await writeFile(reportPath, `${JSON.stringify(passingReportWithStaleSource, null, 2)}\n`)

    const result = await runDrillFixture(
      [
        'scripts/runtime-smoke-artifact-check.mjs',
        '--only-live-sync-report',
        `--require-live-sync-passed-report=${reportPath}`,
      ],
      {},
    )
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

    expect(
      result.status !== 0 &&
        output.includes('sourceFingerprint.sha256 must match current live sync source fingerprint'),
      'Passing live sync release reports with stale source fingerprints must fail the passed-only runtime artifact gate.',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function expectDiagnosticReportRejectsStaleSourceFingerprint() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-sync-stale-diagnostic-'))
  const reportPath = path.join(tempDir, 'live-sync-release-drill.json')
  const now = new Date().toISOString()
  const sourceFingerprint = await liveSyncSourceFingerprintFixture()
  sourceFingerprint.sha256 = '0000000000000000000000000000000000000000000000000000000000000000'
  const staleDiagnosticReport = {
    kind: 'zerochat.liveSyncReleaseDrill',
    version: 1,
    mode: null,
    status: 'skipped',
    evidenceType: 'diagnostic',
    releaseEvidence: false,
    safeToPublish: true,
    publishSafetyScope: 'sanitized-diagnostic-only; not release evidence',
    startedAt: now,
    finishedAt: now,
    passed: false,
    remoteTouched: false,
    skipReason: 'no live sync mode configured',
    requiredAction:
      'Configure disposable Cloudflare or Gist sync credentials, use the destructive confirmation value, then rerun the live sync release drill.',
    supportedModes: ['cloudflare', 'gist'],
    destructiveConfirmationRequired: true,
    missingInputKeys: [
      'liveSyncMode',
      'providerSpecificDisposableCredential',
      'destructiveConfirmation',
      'throwawaySyncPassphrase',
    ],
    sourceFingerprint,
    releaseBlockerSummary: {
      kind: 'zerochat.liveSyncReleaseBlockerSummary.v1',
      status: 'skipped',
      blockerKind: 'missing-live-sync-release-inputs',
      mode: null,
      evidenceType: 'diagnostic',
      releaseEvidence: false,
      remoteTouched: false,
      missingInputKeys: [
        'liveSyncMode',
        'providerSpecificDisposableCredential',
        'destructiveConfirmation',
        'throwawaySyncPassphrase',
      ],
      missingInputCount: 4,
      supportedModes: ['cloudflare', 'gist'],
      destructiveConfirmationRequired: true,
      requiredInputs: [
        'Disposable Cloudflare Worker namespace or disposable GitHub Gist',
        'Throwaway sync passphrase',
        'Provider-specific disposable credential',
        'Destructive confirmation for disposable storage only',
        'Passed-report validation after a successful drill',
      ],
      requiredInputCount: 5,
      requiredAction:
        'Configure disposable Cloudflare or Gist sync credentials, use the destructive confirmation value, then rerun the live sync release drill.',
      validationCommands: [
        'pnpm run check:live-sync-report',
        'pnpm run check:live-sync-release-pass',
      ],
    },
    requiredInputs: [
      'Disposable Cloudflare Worker namespace or disposable GitHub Gist',
      'Throwaway sync passphrase',
      'Provider-specific disposable credential',
      'Destructive confirmation for disposable storage only',
      'Passed-report validation after a successful drill',
    ],
    reviewerChecklist: [
      'Use only a disposable Cloudflare Worker namespace or disposable GitHub Gist.',
      'Choose cloudflare or gist mode before running the drill.',
      'Provide a throwaway sync passphrase and matching disposable provider credentials.',
      'Set the destructive confirmation value only for disposable storage.',
      'After a successful drill, validate with the passed-report runtime artifact gate.',
      'If remoteTouched is true, clear the disposable storage before rerunning.',
    ],
    nextSteps: {
      docs: ['docs/RELEASE_CHECKLIST.md', '.github/workflows/live-drills.yml'],
      drillCommands: ['pnpm run drill:live-sync'],
      validationCommands: [
        'pnpm run check:live-sync-report',
        'pnpm run check:live-sync-release-pass',
      ],
    },
  }

  try {
    await writeFile(reportPath, `${JSON.stringify(staleDiagnosticReport, null, 2)}\n`)

    const result = await runDrillFixture(
      [
        'scripts/runtime-smoke-artifact-check.mjs',
        '--only-live-sync-report',
        `--require-live-sync-report=${reportPath}`,
      ],
      {},
    )
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

    expect(
      result.status !== 0 &&
        output.includes('sourceFingerprint.sha256 must match current live sync source fingerprint'),
      'Diagnostic live sync reports with stale source fingerprints must fail the runtime artifact gate.',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function expectBlockedUnsafeWorkerEndpoint(endpoint, expectedReasonMarker) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-sync-unsafe-endpoint-'))
  const reportPath = path.join(tempDir, 'live-sync-release-drill.json')

  try {
    const result = await runDrillFixture(['scripts/live-sync-release-drill.mjs'], {
      env: {
        ...process.env,
        ZEROCHAT_LIVE_SYNC_MODE: 'cloudflare',
        ZEROCHAT_LIVE_SYNC_CONFIRM: 'DELETE_REMOTE_ZEROCHAT_TEST_DATA',
        ZEROCHAT_LIVE_SYNC_PASSPHRASE: 'unsafe-endpoint-safety-check-passphrase',
        ZEROCHAT_LIVE_WORKER_ENDPOINT: endpoint,
        ZEROCHAT_LIVE_SYNC_REPORT: reportPath,
      },
    })

    expect(
      result.status !== 0,
      `Unsafe Cloudflare Worker endpoint ${endpoint} must fail before live sync starts.`,
    )

    const report = JSON.parse(await readFile(reportPath, 'utf8'))

    expectBlockedReport(
      report,
      'cloudflare',
      ['Cloudflare Worker endpoint is unsafe', expectedReasonMarker],
      `Unsafe Cloudflare Worker endpoint ${endpoint}`,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function expectBlockedUnsafeGistFile(fileName, expectedReasonMarker) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-sync-unsafe-gist-file-'))
  const reportPath = path.join(tempDir, 'live-sync-release-drill.json')

  try {
    const result = await runDrillFixture(['scripts/live-sync-release-drill.mjs'], {
      env: {
        ...process.env,
        ZEROCHAT_LIVE_SYNC_MODE: 'gist',
        ZEROCHAT_LIVE_SYNC_CONFIRM: 'DELETE_REMOTE_ZEROCHAT_TEST_DATA',
        ZEROCHAT_LIVE_SYNC_PASSPHRASE: 'unsafe-gist-file-safety-check-passphrase',
        ZEROCHAT_LIVE_GITHUB_TOKEN: 'dummy-github-token-for-preflight-only',
        ZEROCHAT_LIVE_GIST_FILE: fileName,
        ZEROCHAT_LIVE_SYNC_REPORT: reportPath,
      },
    })

    expect(
      result.status !== 0,
      `Unsafe Gist file name ${JSON.stringify(fileName)} must fail before live sync starts.`,
    )

    const report = JSON.parse(await readFile(reportPath, 'utf8'))

    expectBlockedReport(
      report,
      'gist',
      ['Gist file name is unsafe', expectedReasonMarker],
      `Unsafe Gist file name ${JSON.stringify(fileName)}`,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function expectBlockedUnsafeGistId(gistId, expectedReasonMarker) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'zerochat-live-sync-unsafe-gist-id-'))
  const reportPath = path.join(tempDir, 'live-sync-release-drill.json')

  try {
    const result = await runDrillFixture(['scripts/live-sync-release-drill.mjs'], {
      env: {
        ...process.env,
        ZEROCHAT_LIVE_SYNC_MODE: 'gist',
        ZEROCHAT_LIVE_SYNC_CONFIRM: 'DELETE_REMOTE_ZEROCHAT_TEST_DATA',
        ZEROCHAT_LIVE_SYNC_PASSPHRASE: 'unsafe-gist-id-safety-check-passphrase',
        ZEROCHAT_LIVE_GITHUB_TOKEN: 'dummy-github-token-for-preflight-only',
        ZEROCHAT_LIVE_GIST_ID: gistId,
        ZEROCHAT_LIVE_SYNC_REPORT: reportPath,
      },
    })

    expect(
      result.status !== 0,
      `Unsafe Gist id ${JSON.stringify(gistId)} must fail before live sync starts.`,
    )

    const report = JSON.parse(await readFile(reportPath, 'utf8'))

    expectBlockedReport(
      report,
      'gist',
      ['Gist id is unsafe', expectedReasonMarker],
      `Unsafe Gist id ${JSON.stringify(gistId)}`,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

const drill = await read('scripts/live-sync-release-drill.mjs')
const reportPathPolicy = await read('scripts/live-sync-report-path.mjs')
const reportPathPolicyTest = await read('scripts/__tests__/live-sync-report-path.test.mjs')
const sanitizer = await read('scripts/live-sync-report-sanitizer.mjs')
const packageJson = await read('package.json')
const releaseChecklist = await read('docs/RELEASE_CHECKLIST.md')
const requirements = await read('docs/REQUIREMENTS.md')
const qaAudit = await read('docs/QA_AUDIT.md')
const liveDrillsWorkflow = await read('.github/workflows/live-drills.yml')
const runtimeArtifactCheck = await read('scripts/runtime-smoke-artifact-check.mjs')

await expectCliArgumentsFailClosed()
await expectSkippedDiagnosticMissingInputs()
await expectPassingReportRejectsDiagnosticFields()
await expectPassingReportRejectsGenericDrillName()
await expectPassingReportRejectsStaleSourceFingerprint()
await expectDiagnosticReportRejectsStaleSourceFingerprint()

expect(
  has(drill, "const CONFIRM_VALUE = 'DELETE_REMOTE_ZEROCHAT_TEST_DATA'") &&
    has(drill, 'ZEROCHAT_LIVE_SYNC_CONFIRM') &&
    has(drill, 'Refusing to touch live sync storage'),
  'Live sync drill must require an explicit destructive confirmation value.',
)
expect(
  has(drill, 'Live sync release drill skipped') &&
    has(drill, 'process.exit(0)') &&
    has(drill, 'set ZEROCHAT_LIVE_SYNC_MODE=cloudflare or gist'),
  'Live sync drill must safely skip when no live mode is configured.',
)
expect(
  has(drill, "from './live-sync-report-path.mjs'") &&
    has(drill, 'const REPORT_PATH = liveSyncReportPath({') &&
    has(
      reportPathPolicy,
      "export const liveSyncReleasePassReportPath = '.manual-qa/live-sync-release-drill.json'",
    ) &&
    has(reportPathPolicy, "'.manual-qa/live-sync-release-drill-current-diagnostic.json'") &&
    has(reportPathPolicy, 'releaseModes.has(normalizedMode)') &&
    has(reportPathPolicyTest, 'keeps non-release mode %s on the current diagnostic path') &&
    has(reportPathPolicyTest, 'writes configured %s release attempts to the canonical report'),
  'No-mode live sync diagnostics must not overwrite canonical release-pass evidence.',
)
expect(
  has(drill, 'const cliArgs = process.argv.slice(2)') &&
    has(drill, 'function parseLiveSyncReleaseDrillCliArgs') &&
    has(drill, "cliArgs[0] === '--help'") &&
    has(drill, "cliArgs[0] === '-h'") &&
    has(drill, 'parseLiveSyncReleaseDrillCliArgs()') &&
    has(
      drill,
      'Live sync release drill failed: Unsupported command-line argument. Run with --help for supported modes.',
    ) &&
    has(releaseChecklist, 'pnpm run drill:live-sync --help') &&
    has(
      requirements,
      'QA marker: Live-sync drill CLI help and invalid arguments cannot write reports or touch remote storage.',
    ) &&
    has(
      qaAudit,
      'QA marker: Live-sync drill CLI help and invalid arguments cannot write reports or touch remote storage.',
    ),
  'Live sync drill CLI arguments must fail closed before environment-driven report or remote behavior.',
)
expect(
    has(drill, "status: 'skipped'") &&
    has(drill, 'releaseBlockerSummary: liveSyncReleaseBlockerSummary') &&
    has(drill, "evidenceType: 'diagnostic'") &&
    has(drill, 'releaseEvidence: false') &&
    has(drill, 'safeToPublish: true') &&
    has(drill, 'publishSafetyScope: DIAGNOSTIC_PUBLISH_SAFETY_SCOPE') &&
    has(drill, 'remoteTouched: false') &&
    has(drill, "skipReason: 'no live sync mode configured'") &&
    has(drill, 'requiredAction:') &&
    has(drill, 'supportedModes: [...SUPPORTED_LIVE_SYNC_MODES]') &&
    has(drill, 'destructiveConfirmationRequired: true') &&
    has(drill, 'const missingInputKeys = getMissingLiveSyncInputKeys(null)') &&
    has(drill, 'missingInputKeys,') &&
    has(drill, 'requiredInputs: DIAGNOSTIC_REQUIRED_INPUTS') &&
    has(drill, 'reviewerChecklist: DIAGNOSTIC_REVIEWER_CHECKLIST') &&
    has(drill, 'nextSteps: DIAGNOSTIC_NEXT_STEPS') &&
    has(drill, 'await writeLiveSyncReport({'),
  'Live sync drill must write a sanitized, reviewer-actionable diagnostic skipped report when no live mode is configured.',
)
expect(
    has(drill, "status: 'blocked'") &&
    has(drill, 'async function throwBlockedLiveSyncError') &&
    has(drill, 'throw new Error(errorSummary(error))') &&
    has(drill, 'writeBlockedLiveSyncReport') &&
    has(drill, 'remoteTouched: false') &&
    has(drill, "report.status = report.remoteTouched ? 'failed' : 'blocked'") &&
    has(drill, 'throw new Error(report.error)') &&
    has(drill, 'DIAGNOSTIC_REVIEWER_CHECKLIST') &&
    has(drill, 'DIAGNOSTIC_NEXT_STEPS') &&
    has(drill, 'DIAGNOSTIC_REQUIRED_INPUTS') &&
    has(drill, 'function liveSyncReleaseBlockerSummary') &&
    has(drill, 'zerochat.liveSyncReleaseBlockerSummary.v1') &&
    has(drill, 'const missingInputKeys = getMissingLiveSyncInputKeys(reportMode)') &&
    has(drill, 'missingInputKeys,') &&
    has(drill, 'releaseBlockerSummary: liveSyncReleaseBlockerSummary') &&
    has(drill, 'requiredInputs: DIAGNOSTIC_REQUIRED_INPUTS') &&
    has(drill, 'safeToPublish: true') &&
    has(drill, "'sanitized-diagnostic-only; not release evidence'"),
  'Live sync drill must write a sanitized blocked/failed report for preflight and runtime failures.',
)
expect(
  has(drill, 'const LIVE_SYNC_INPUT_KEYS') &&
    has(drill, 'function getMissingLiveSyncInputKeys') &&
    has(drill, "'liveSyncMode'") &&
    has(drill, "'throwawaySyncPassphrase'") &&
    has(drill, "'destructiveConfirmation'") &&
    has(drill, "'providerSpecificDisposableCredential'") &&
    has(drill, "'disposableCloudflareWorkerEndpoint'") &&
    has(drill, "'disposableGithubGistToken'") &&
    has(drill, 'delete report.missingInputKeys') &&
    has(drill, 'delete report.releaseBlockerSummary') &&
    has(drill, 'delete report.requiredInputs') &&
    has(drill, 'delete report.reviewerChecklist') &&
    has(drill, 'delete report.nextSteps'),
  'Live sync drill diagnostics must expose safe missingInputKeys aliases and remove them from passing release evidence.',
)
expect(
  has(drill, 'function unsafeDisposableGistFileReason') &&
    has(drill, 'Gist file name is unsafe for disposable live sync drill') &&
    has(drill, 'normalized.length > 120') &&
    has(drill, "/[\\0\\r\\n]/u.test(normalized)") &&
    has(drill, "normalized.includes('/')") &&
    has(drill, "normalized.includes('\\\\')") &&
    has(drill, 'redactLiveSyncReportText(normalized) !== normalized') &&
    has(drill, 'the value must be a single file name, not a path or URL') &&
    has(drill, 'the value looks like a URL, token, environment variable, or other secret-bearing input'),
  'Live sync drill must reject unsafe optional Gist file names before touching disposable remote storage.',
)
for (const [fileName, reason] of [
  ['nested/zerochat-sync.json', 'single file name'],
  ['nested\\zerochat-sync.json', 'single file name'],
  [`${'a'.repeat(121)}.json`, 'longer than 120 characters'],
  ['bad\nfile.json', 'control characters'],
  ['ZEROCHAT_LIVE_SYNC_PASSPHRASE', 'secret-bearing input'],
]) {
  await expectBlockedUnsafeGistFile(fileName, reason)
}
expect(
  has(drill, 'function unsafeDisposableGistIdReason') &&
    has(drill, 'Gist id is unsafe for disposable live sync drill') &&
    has(drill, 'safeGistId') &&
    has(drill, 'normalized.length < 8') &&
    has(drill, 'normalized.length > 64') &&
    has(drill, '/[\\0-\\x20]/u.test(normalized)') &&
    has(drill, "normalized.includes('/')") &&
    has(drill, "normalized.includes('\\\\')") &&
    has(drill, '/[?#]/u.test(normalized)') &&
    has(drill, 'redactDisposableGistIdSafetyText(normalized) !== normalized') &&
    has(drill, "ZEROCHAT_LIVE_GIST_ID: ''") &&
    has(drill, '/^[a-f0-9]{8,64}$/iu.test(normalized)') &&
    has(drill, 'encodeURIComponent(gistId)'),
  'Live sync drill must reject unsafe optional Gist ids before touching disposable remote storage.',
)
for (const [unsafeGistId, reason] of [
  ['https://gist.github.com/example/0123456789abcdef', 'path or URL'],
  ['owner/0123456789abcdef', 'path or URL'],
  ['0123456789abcdef?token=secret', 'path or URL'],
  ['abc 1234', 'whitespace or control characters'],
  ['ZEROCHAT_LIVE_SYNC_PASSPHRASE', 'secret-bearing input'],
  ['abc', 'shorter than 8 characters'],
  ['zzzzzzzz', '8 to 64 hexadecimal characters'],
]) {
  await expectBlockedUnsafeGistId(unsafeGistId, reason)
}
expect(
  has(drill, 'SUPPORTED_LIVE_SYNC_MODES.includes(mode)') &&
    has(drill, 'ZEROCHAT_LIVE_WORKER_ENDPOINT') &&
    has(drill, 'ZEROCHAT_LIVE_GITHUB_TOKEN'),
  'Live sync drill must constrain mode and require provider-specific disposable credentials.',
)
expect(
  has(drill, 'function unsafeLiveWorkerEndpointReason') &&
    has(drill, 'function normalizeLiveWorkerEndpoint') &&
    has(drill, 'const DISALLOWED_EPHEMERAL_TUNNEL_HOST_SUFFIXES') &&
    has(drill, "'trycloudflare.com'") &&
    has(drill, 'function isDisallowedEphemeralTunnelHost') &&
    has(drill, 'ephemeral tunnel endpoints are diagnostic-only') &&
    has(drill, 'Cloudflare Worker endpoint is unsafe for disposable live sync release drill') &&
    has(drill, "url.protocol !== 'https:'") &&
    has(drill, 'url.username || url.password') &&
    has(drill, 'url.search || url.hash') &&
    has(drill, 'isDisallowedRemoteHost(url.hostname)') &&
    has(drill, 'localhost, a private network, or a LAN-only name') &&
    has(drill, 'embeddedIpv4FromIpv6') &&
    has(drill, "normalized !== ipv4.join('.')") &&
    has(drill, "normalized.split('.').every((label) =>") &&
    has(drill, '/^(?:[0-9]+|0x[0-9a-f]+)$/iu.test(label)') &&
    has(drill, 'first === 192 && second === 0') &&
    has(drill, 'first === 198 && (second === 18 || second === 19)') &&
    has(drill, 'first >= 224') &&
    has(drill, 'first === 0x2001 && ipv6[1] === 0x0db8') &&
    has(drill, '(first & 0xff00) === 0xff00') &&
    has(drill, 'safeCloudflareEndpoint = normalizeLiveWorkerEndpoint(cloudflareEndpoint)') &&
    has(drill, 'workerEndpoint: safeCloudflareEndpoint'),
  'Live sync Cloudflare drill must reject unsafe Worker endpoints before touching disposable remote storage.',
)
for (const [endpoint, reason] of [
  ['http://localhost:8787', 'remote HTTPS Worker endpoint'],
  ['https://user:secret@sync.example.dev', 'embedded credentials'],
  ['https://sync.example.dev?token=secret', 'query strings or fragments'],
  ['https://192.168.1.20/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://worker.local/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://worker/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://2130706433/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://0x7f000001/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://0177.0.0.1/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://127.1/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://[64:ff9b::7f00:1]/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://198.18.0.1/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://[2001:db8::1]/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://[ff02::1]/sync', 'localhost, a private network, or a LAN-only name'],
  ['https://temporary-sync.trycloudflare.com', 'ephemeral tunnel endpoints are diagnostic-only'],
]) {
  await expectBlockedUnsafeWorkerEndpoint(endpoint, reason)
}
expect(
  has(drill, 'syncService.performSync(firstDevice, context)') &&
    has(drill, 'second empty device should pull live remote data') &&
    has(drill, 'Edited content') &&
    has(drill, 'deleted skill should not remain in live remote data'),
  'Live sync drill must cover upload, second-device pull, edit propagation, and deletion cleanup.',
)
expect(
  has(drill, 'syncService.clearRemoteSyncData(deletion.data, context)') &&
    has(drill, 'assertCloudflareRemoteCleared') &&
    has(drill, 'assertGistFileCleared') &&
    has(drill, 'Cloudflare stale object') &&
    has(drill, 'deleteDisposableGist') &&
    has(drill, 'DELETE') &&
    has(drill, 'const deletedGist = await readGist(gistId, token)') &&
    has(drill, "assert.equal(deletedGist, null, 'Disposable Gist should be absent after delete')"),
  'Live sync drill must clear remote sync data, read back the cleared remote state, and verify deletion of a disposable Gist it created.',
)
expect(
  has(drill, 'async function bestEffortCleanupAfterFailure()') &&
    has(drill, 'bestEffortAfterFailureAttempted') &&
    has(drill, 'bestEffortAfterFailureSucceeded') &&
    has(drill, 'bestEffortAfterFailureError') &&
    has(drill, 'cleanupData = firstDevice') &&
    has(drill, 'cleanupData = upload.data') &&
    has(drill, 'cleanupData = edit.data') &&
    has(drill, 'cleanupData = deletion.data') &&
    has(drill, 'cleanupKnownCloudflareKeys') &&
    has(drill, 'cleanupCreatedGistId') &&
    has(drill, 'cleanupSyncData') &&
    has(drill, 'await bestEffortCleanupAfterFailure()') &&
    has(drill, 'report.cleanup.bestEffortAfterFailureError = errorSummary(cleanupError)'),
  'Live sync drill must attempt sanitized best-effort cleanup after a failure that already touched disposable remote storage.',
)
expect(
    has(drill, "kind: 'zerochat.liveSyncReleaseDrill'") &&
    has(reportPathPolicy, "'.manual-qa/live-sync-release-drill.json'") &&
    has(drill, "docs: ['docs/RELEASE_CHECKLIST.md', '.github/workflows/live-drills.yml']") &&
    has(drill, 'delete report.requiredInputs') &&
    has(drill, 'delete report.reviewerChecklist') &&
    has(drill, 'pnpm run check:live-sync-report') &&
    has(drill, 'pnpm run check:live-sync-release-pass') &&
    has(drill, 'writeLiveSyncReport(report)') &&
    has(drill, 'report.stages.remoteClear = true') &&
    has(drill, 'report.cleanup.remoteCleared = true') &&
    has(drill, 'delete report.nextSteps') &&
    has(drill, 'createdDisposableGistDeleted') &&
    has(drill, 'staleSkillObjectsChecked'),
  'Live sync drill must write a reviewer-friendly JSON report with pass/fail, stage, cleanup, diagnostic next steps, and stale-object evidence.',
)
expect(
  has(drill, 'async function writeFailureLiveSyncReportOrThrow(report, failureError)') &&
    has(drill, 'Live sync release drill failed and could not write the sanitized failure report') &&
    has(drill, 'original failure: ${errorSummary(failureError)}') &&
    has(drill, 'await writeFailureLiveSyncReportOrThrow(report, error)') &&
    !has(drill, 'writeLiveSyncReport(report).catch(() => undefined)'),
  'Live sync drill failure reports must fail closed when sanitized report writing fails, instead of leaving stale evidence in place.',
)
expect(
  has(drill, "from './live-sync-report-sanitizer.mjs'") &&
    has(drill, 'sanitizeLiveSyncReportValue(reportWithFingerprint)') &&
    has(drill, 'redactLiveSyncReportText(error instanceof Error') &&
    has(sanitizer, 'function redactLiveSyncReportText') &&
    has(sanitizer, '[redacted-live-sync-secret]') &&
    has(sanitizer, 'Bearer [redacted]') &&
    has(sanitizer, 'ZEROCHAT_[A-Z0-9_]') &&
    has(sanitizer, 'gh[opsru]_') &&
    has(sanitizer, '[A-Za-z0-9+/=_-]{48,}') &&
    has(sanitizer, "keyPath[keyPath.length - 1] === 'sha256'") &&
    has(drill, 'JSON.stringify(sanitizedReport, null, 2)'),
  'Live sync drill must redact live endpoints, tokens, passphrases, object keys, environment variable names, and token-like headers before writing pass/fail reports.',
)
{
  const longToken = 'A'.repeat(56)
  const safeSha256 = 'B'.repeat(64)
  const fixtureEnv = {
    ZEROCHAT_LIVE_SYNC_PASSPHRASE: 'redaction-check-passphrase',
    ZEROCHAT_LIVE_GITHUB_TOKEN: 'ghs_redactionCheckToken1234567890',
    ZEROCHAT_LIVE_WORKER_ENDPOINT: 'https://sync.redaction-check.example/secret?token=leak',
    ZEROCHAT_LIVE_GIST_ID: 'gist-redaction-check-id',
  }
  const fixture = {
    error:
      `Failed with https://public.example/sync, ZEROCHAT_LIVE_SYNC_PASSPHRASE, Bearer abcdefghijklmnopqrstuvwxyz0123456789, and ${longToken}`,
    sourceFingerprint: {
      kind: 'zerochat.liveSyncSourceFingerprint.v1',
      sha256: safeSha256,
    },
    nested: [
      fixtureEnv.ZEROCHAT_LIVE_SYNC_PASSPHRASE,
      fixtureEnv.ZEROCHAT_LIVE_GITHUB_TOKEN,
      fixtureEnv.ZEROCHAT_LIVE_WORKER_ENDPOINT,
      fixtureEnv.ZEROCHAT_LIVE_GIST_ID,
    ],
    [fixtureEnv.ZEROCHAT_LIVE_GITHUB_TOKEN]: 'token in a JSON object key',
    'https://sync.redaction-check.example/key': 'endpoint in a JSON object key',
  }
  const sanitized = JSON.stringify(sanitizeLiveSyncReportValue(fixture, fixtureEnv))

  expect(
    !sanitized.includes(fixtureEnv.ZEROCHAT_LIVE_SYNC_PASSPHRASE) &&
      !sanitized.includes(fixtureEnv.ZEROCHAT_LIVE_GITHUB_TOKEN) &&
      !sanitized.includes(fixtureEnv.ZEROCHAT_LIVE_WORKER_ENDPOINT) &&
      !sanitized.includes(fixtureEnv.ZEROCHAT_LIVE_GIST_ID) &&
      !/https?:\/\//iu.test(sanitized) &&
      !/\bZEROCHAT_[A-Z0-9_]+\b/u.test(sanitized) &&
      !/\bBearer\s+(?!\[redacted\])/iu.test(sanitized) &&
      !sanitized.includes(longToken) &&
      sanitized.includes(safeSha256),
    'Live sync report sanitizer must remove fake endpoints, tokens, passphrases, sensitive object keys, env names, Bearer credentials, and long token-like values without network access while preserving sha256 evidence hashes.',
  )
}
expect(
  has(drill, "firstSyncStrategy: 'use-local'") &&
    has(drill, 'drillName') &&
    has(drill, 'Date.now()'),
  'Live sync drill must use a unique test skill and an explicit first-sync strategy.',
)
expect(
  has(packageJson, '"drill:live-sync": "node scripts/live-sync-release-drill.mjs"'),
  'package.json must expose the drill:live-sync package script.',
)
expect(
  has(
    packageJson,
    '"check:live-sync-release-pass": "node scripts/runtime-smoke-artifact-check.mjs --only-live-sync-report --require-live-sync-passed-report=.manual-qa/live-sync-release-drill.json"',
  ),
  'package.json must expose a passed-only live sync release evidence package script.',
)
expect(
    has(runtimeArtifactCheck, 'requiredLiveSyncPassedReports') &&
    has(runtimeArtifactCheck, '--only-live-sync-report') &&
    has(runtimeArtifactCheck, 'onlyLiveSyncReport') &&
    has(runtimeArtifactCheck, 'checkLiveSyncReleaseDrillArtifacts') &&
    has(runtimeArtifactCheck, '--only-live-sync-report can only be combined with live-sync report flags') &&
    has(runtimeArtifactCheck, '--require-live-sync-passed-report') &&
    has(runtimeArtifactCheck, 'requiresPassed') &&
    has(runtimeArtifactCheck, 'must be a passing live sync release drill report for release evidence') &&
    has(runtimeArtifactCheck, 'const liveSyncReleasePassMaxAgeHours = 72') &&
    has(runtimeArtifactCheck, 'spec.requiresPassed && passingReport') &&
    has(runtimeArtifactCheck, 'must be a fresh live sync release drill report for release evidence') &&
    has(runtimeArtifactCheck, 'finishedAt must not be in the future for release-pass evidence') &&
    has(runtimeArtifactCheck, 'readLiveSyncSourceFingerprint') &&
    has(runtimeArtifactCheck, 'zerochat.liveSyncSourceFingerprint.v1') &&
    has(runtimeArtifactCheck, 'sourceFingerprint.sha256 must match current live sync source fingerprint') &&
    has(runtimeArtifactCheck, 'function liveSyncDrillTimestamp') &&
    has(runtimeArtifactCheck, 'unique disposable drill Skill name with an epoch-millisecond suffix') &&
    has(runtimeArtifactCheck, 'drillName timestamp must fall within startedAt/finishedAt') &&
    has(runtimeArtifactCheck, 'Date.parse(report.startedAt)') &&
    has(runtimeArtifactCheck, 'skipped report must include a reviewer-actionable next step') &&
    has(runtimeArtifactCheck, 'skipped report must list the supported live sync modes') &&
    has(runtimeArtifactCheck, 'skipped report must state that destructive confirmation is required') &&
    has(runtimeArtifactCheck, 'safeToPublish') &&
    has(runtimeArtifactCheck, 'publishSafetyScope') &&
    has(runtimeArtifactCheck, 'diagnostic-only, not release evidence') &&
    has(runtimeArtifactCheck, 'sanitized-release-pass evidence') &&
    has(runtimeArtifactCheck, 'checkLiveSyncReviewerChecklist') &&
    has(runtimeArtifactCheck, 'checkLiveSyncReleaseBlockerSummary') &&
    has(runtimeArtifactCheck, 'releaseBlockerSummary.missingInputCount must match') &&
    has(runtimeArtifactCheck, 'checkLiveSyncDiagnosticNextSteps') &&
    has(runtimeArtifactCheck, 'diagnostic report must include a nextSteps object') &&
    has(runtimeArtifactCheck, 'diagnostic nextSteps must list both live-sync package validation gates') &&
    has(runtimeArtifactCheck, 'diagnostic report must include a reviewerChecklist array') &&
    has(runtimeArtifactCheck, 'diagnostic report must include a requiredInputs array') &&
    has(runtimeArtifactCheck, 'diagnostic report must include a missingInputKeys array') &&
    has(runtimeArtifactCheck, 'skipped report missingInputKeys must include liveSyncMode') &&
    has(runtimeArtifactCheck, 'passing report must not keep diagnostic missingInputKeys') &&
    has(runtimeArtifactCheck, 'passing report must not keep diagnostic requiredInputs') &&
    has(runtimeArtifactCheck, 'passing report must not keep diagnostic reviewerChecklist') &&
    has(runtimeArtifactCheck, 'passing report must not keep diagnostic nextSteps') &&
    has(runtimeArtifactCheck, 'passing report must not keep diagnostic releaseBlockerSummary') &&
    has(runtimeArtifactCheck, 'requiredInputs must mention') &&
    has(runtimeArtifactCheck, 'diagnostic non-release evidence') &&
    has(runtimeArtifactCheck, 'release-pass evidence') &&
    has(releaseChecklist, '--require-live-sync-passed-report') &&
    has(qaAudit, 'passing live sync release drill report') &&
    has(qaAudit, 'Live sync release-pass drill-name uniqueness guard') &&
    has(qaAudit, 'epoch-millisecond suffix error') &&
    has(qaAudit, 'requiredInputs') &&
    has(qaAudit, 'missingInputKeys') &&
    has(qaAudit, 'releaseBlockerSummary'),
  'Runtime artifact validation must distinguish live sync diagnostic reports from passing fresh release evidence.',
)
expect(
  has(releaseChecklist, 'ZEROCHAT_LIVE_SYNC_CONFIRM=DELETE_REMOTE_ZEROCHAT_TEST_DATA') &&
    has(releaseChecklist, 'Do not use a personal production vault') &&
    has(releaseChecklist, 'Quick Tunnel endpoints are diagnostic-only') &&
    has(releaseChecklist, 'ZEROCHAT_LIVE_GIST_ID') &&
    has(releaseChecklist, 'bare 8 to 64 character hexadecimal') &&
    has(releaseChecklist, 'not a GitHub URL, owner/id path, query string') &&
    has(releaseChecklist, 'within 72 hours') &&
    has(qaAudit, 'Live sync release drill') &&
    has(
      qaAudit,
      'QA marker: Live-sync release evidence rejects ephemeral tunnel endpoints.',
    ) &&
    has(liveDrillsWorkflow, 'sync_mode:') &&
    has(liveDrillsWorkflow, 'secrets.ZEROCHAT_LIVE_SYNC_PASSPHRASE') &&
    has(liveDrillsWorkflow, 'secrets.ZEROCHAT_LIVE_WORKER_ENDPOINT') &&
    has(liveDrillsWorkflow, 'secrets.ZEROCHAT_LIVE_GITHUB_TOKEN') &&
    has(liveDrillsWorkflow, 'ZEROCHAT_LIVE_SYNC_CONFIRM: DELETE_REMOTE_ZEROCHAT_TEST_DATA') &&
    has(liveDrillsWorkflow, 'id: run-cloudflare-live-sync-drill') &&
    has(liveDrillsWorkflow, 'id: run-gist-live-sync-drill') &&
    has(liveDrillsWorkflow, 'node scripts/live-sync-release-drill.mjs') &&
    has(liveDrillsWorkflow, 'Validate live sync drill report') &&
    has(liveDrillsWorkflow, 'id: validate-live-sync-report') &&
    has(
      liveDrillsWorkflow,
      '--only-live-sync-report --require-live-sync-report=.manual-qa/live-sync-release-drill.json',
    ) &&
    has(liveDrillsWorkflow, 'Validate passing live sync drill report') &&
    has(liveDrillsWorkflow, 'id: validate-live-sync-passed-report') &&
    has(liveDrillsWorkflow, 'pnpm run check:live-sync-release-pass') &&
    has(liveDrillsWorkflow, "steps.run-cloudflare-live-sync-drill.outcome == 'success'") &&
    has(liveDrillsWorkflow, "steps.run-gist-live-sync-drill.outcome == 'success'") &&
    has(liveDrillsWorkflow, "always() && inputs.sync_mode != 'none'") &&
    has(liveDrillsWorkflow, "steps.validate-live-sync-report.outcome == 'success'") &&
    has(liveDrillsWorkflow, "steps.validate-live-sync-passed-report.outcome == 'success'") &&
    has(liveDrillsWorkflow, "steps.validate-live-sync-passed-report.outcome == 'skipped'") &&
    has(liveDrillsWorkflow, 'name: live-sync-release-drill-report') &&
    has(liveDrillsWorkflow, '.manual-qa/live-sync-release-drill.json'),
  'Release and QA docs plus the manual live-drills workflow must keep live-drill safety requirements and success/failure report upload visible.',
)
expect(
  has(liveDrillsWorkflow, 'name: Check local runtime cleanup') &&
    has(liveDrillsWorkflow, 'if: ${{ always() }}') &&
    has(liveDrillsWorkflow, 'pnpm run check:local-cleanup'),
  'Manual live-drills workflow must always run local runtime cleanup after live sync drill attempts.',
)

if (failures.length) {
  throw new Error(`Live sync release drill checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('Live sync release drill checks passed')
