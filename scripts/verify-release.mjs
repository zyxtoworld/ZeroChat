import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withReleaseReportLock } from './release-report-lock.mjs'
import { sanitizeReleaseReportText } from './release-report-sanitizer.mjs'
import { stopChildProcessTree } from './browser-runtime-cleanup.mjs'
import { startVitePreviewLoopbackServer } from './vite-loopback-server.mjs'
import { checksWithReleaseDiagnosticsBootstrap } from './verify-release-check-order.mjs'
import { preCheckpointAuditOptions } from './verify-release-preflight-policy.mjs'
import {
  WINDOWS_TRUSTED_MSIX_ONLY_SCOPE_MARKER,
  isWindowsTrustedMsixOnlyExpectedFailureSummary,
  isWindowsTrustedMsixOnlyRuntimeArtifactFailure,
} from './release-diagnostics-runtime-artifact-policy.mjs'
import {
  parseVerifyReleaseCliArgs,
  verifyReleaseRerunCommands,
  verifyReleaseUsage,
} from './verify-release-cli.mjs'
import { windowsTrustedMsixNextProofGate } from './windows-msix-remediation.mjs'

const cliResult = parseVerifyReleaseCliArgs(process.argv.slice(2))

if (cliResult.kind === 'help') {
  console.log(verifyReleaseUsage())
  process.exit(0)
}

if (cliResult.kind === 'error') {
  console.error(cliResult.message)
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const webLocal = cliResult.flags.has('--web-local')
const allPlatforms = cliResult.flags.has('--all-platforms')
const requireLiveSyncPass = cliResult.flags.has('--require-live-sync-pass')
const requireNativeRuntimeArtifacts = cliResult.flags.has('--require-native-runtime-artifacts')
const requireHostedNativeCiEvidence = cliResult.flags.has('--require-hosted-native-ci-evidence')
const requireLiveProviderFullCapability = cliResult.flags.has('--require-live-provider-full-capability')
const releaseRequested = cliResult.flags.has('--release')
const strictReleasePreflightRequested =
  allPlatforms ||
  requireLiveSyncPass ||
  requireNativeRuntimeArtifacts ||
  requireHostedNativeCiEvidence ||
  requireLiveProviderFullCapability
const release =
  webLocal ||
  strictReleasePreflightRequested ||
  releaseRequested
const allPlatformPrereqReport = '.manual-qa/native-prereq-all-platforms.json'
const liveSyncReleasePassReport = '.manual-qa/live-sync-release-drill.json'
const hostedNativeCiEvidenceReport = '.manual-qa/hosted-native-ci-evidence.json'
const liveProviderFullCapabilityReport = '.manual-qa/live-provider-smoke-full-current.json'
const strictReleasePreflightReport = '.manual-qa/strict-release-preflight.json'
const releaseBlockerSummaryReport = '.manual-qa/release-blockers-current.json'
const verifyReleaseCheckpointReport = '.manual-qa/verify-release-current.json'
const skipVerifyReleaseCheckpoint = process.env.ZEROCHAT_SKIP_VERIFY_RELEASE_CHECKPOINT === '1'
const skipStrictReleasePreflightRefresh =
  process.env.ZEROCHAT_SKIP_STRICT_RELEASE_PREFLIGHT_REFRESH === '1'
const configuredVerifyCheckTimeoutMs = Number(process.env.ZEROCHAT_VERIFY_CHECK_TIMEOUT_MS)
const verifyCheckTimeoutMs =
  Number.isInteger(configuredVerifyCheckTimeoutMs) && configuredVerifyCheckTimeoutMs > 0
    ? configuredVerifyCheckTimeoutMs
    : 300_000
const liveProviderSmokeCheckTimeoutMs = Math.max(verifyCheckTimeoutMs, 600_000)
const eslintCheckTimeoutMs = Math.max(verifyCheckTimeoutMs, 600_000)
const androidLintCheckTimeoutMs = Math.max(verifyCheckTimeoutMs, 600_000)
const verifyRunStartedAt = new Date()
const verifyRunSteps = []
const releaseReportRedactedValues = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      typeof value === 'string' &&
      value.length >= 8 &&
      /(?:^ZEROCHAT_|(?:API|ACCESS)[_-]?KEY|TOKEN|SECRET|PASSPHRASE|PASSWORD|BASE_URL|ENDPOINT)/iu.test(
        name,
      ),
  )
  .map(([, value]) => value)
  .concat([
    'zerochat-sync-smoke-provider-key',
    'old-passphrase-for-smoke',
    'new-passphrase-for-smoke',
  ])

function fromRoot(path) {
  return resolve(root, path)
}

const baseChecks = [
  ['Service Worker source build', [fromRoot('scripts/build-service-worker.mjs')]],
  ['TypeScript', [fromRoot('node_modules/typescript/bin/tsc'), '-b']],
  ['Vite production build', [fromRoot('node_modules/vite/bin/vite.js'), 'build']],
  ['ESLint', [fromRoot('node_modules/eslint/bin/eslint.js'), '.']],
  ['Android Lint', [fromRoot('scripts/android-debug-build.mjs'), 'lintDebug']],
  ['Repository health', [fromRoot('scripts/repository-health-check.mjs')]],
  ['Shared schema', [fromRoot('scripts/shared-schema-check.mjs')]],
  ['Release report lock', [fromRoot('scripts/release-report-lock-check.mjs')]],
  ['Icon/cloud-sync redlines', [fromRoot('scripts/icon-sync-redline-check.mjs')]],
  ['Worker security', [fromRoot('scripts/worker-security-check.mjs')]],
  ['Deployment readiness', [fromRoot('scripts/deploy-readiness-check.mjs')]],
  ['Cloudflare Pages deploy dry-run', [fromRoot('scripts/deploy-cloudflare-pages.mjs'), '--dry-run', '--skip-build']],
  ['Bundle size', [fromRoot('scripts/bundle-size-check.mjs')]],
  ['Copy consistency', [fromRoot('scripts/copy-consistency-check.mjs')]],
  ['Documentation links', [fromRoot('scripts/docs-link-check.mjs')]],
  ['Completion audit', [fromRoot('scripts/completion-audit-check.mjs')]],
  ['Release blocker summary', [fromRoot('scripts/release-blocker-report.mjs'), '--check']],
  ['Runtime smoke artifacts', [fromRoot('scripts/runtime-smoke-artifact-check.mjs')]],
  ['UI accessibility', [fromRoot('scripts/ui-accessibility-check.mjs')]],
  ['Axe accessibility', [fromRoot('scripts/axe-accessibility-check.mjs')]],
  ['Lighthouse performance', [fromRoot('scripts/lighthouse-check.mjs')]],
  ['Hosted native CI evidence', [fromRoot('scripts/hosted-native-ci-evidence-check.mjs')]],
  ['Windows WebView shell', [fromRoot('scripts/windows-webview-shell-check.mjs')]],
  ['Windows MSIX readiness', [fromRoot('scripts/windows-msix-readiness-check.mjs')]],
  [
    'Apple native contract tests',
    ['--test', fromRoot('apps/apple/ContractTests/apple-image-request-cost-contract.test.mjs')],
  ],
  [
    'Linux native contract tests',
    ['--test', fromRoot('apps/linux/contract-tests/linux-chat-retry-contract.test.mjs')],
  ],
  ['Windows native contract tests', [fromRoot('scripts/windows-native-contract-check.mjs')]],
  [
    'Unit tests',
    [fromRoot('node_modules/vitest/vitest.mjs'), 'run', '--testTimeout', '15000'],
  ],
  ['Web source coverage', [fromRoot('scripts/unit-coverage-check.mjs')]],
  ['Skill system', [fromRoot('scripts/skill-system-check.mjs')]],
  ['Cloud sync E2E', [fromRoot('scripts/cloud-sync-e2e-check.mjs')]],
  ['Gist sync E2E', [fromRoot('scripts/gist-sync-e2e-check.mjs')]],
  ['Live sync drill safety', [fromRoot('scripts/live-sync-release-drill-check.mjs')]],
  ['Live provider smoke safety', [fromRoot('scripts/live-provider-smoke-check.mjs')]],
  ['Linux Rustfmt', [fromRoot('scripts/linux-rustfmt-check.mjs')]],
  ['Linux packaging metadata', [fromRoot('scripts/linux-packaging-check.mjs')]],
  ['Web i18n', [fromRoot('scripts/i18n-completeness-check.mjs')]],
  ['Native i18n', [fromRoot('scripts/native-i18n-check.mjs')]],
  ['Android device selection', [fromRoot('scripts/android-device-selection-check.mjs')]],
  ['Native parity', [fromRoot('scripts/native-parity-check.mjs')]],
]

const releaseChecks = [
  ['Browser smoke', [fromRoot('scripts/browser-skill-smoke.mjs')]],
  ['Locale runtime smoke', [fromRoot('scripts/locale-runtime-smoke.mjs')]],
  ['Settings overlay preload smoke', [fromRoot('scripts/settings-overlay-preload-smoke.mjs')]],
  ['PWA offline smoke', [fromRoot('scripts/pwa-offline-smoke.mjs')]],
  ['Message virtualization smoke', [fromRoot('scripts/message-virtualization-smoke.mjs')]],
  ['Chat context window smoke', [fromRoot('scripts/chat-context-window-smoke.mjs')]],
  ['Composer autosize smoke', [fromRoot('scripts/composer-autosize-smoke.mjs')]],
  ['Visual audit', [fromRoot('scripts/visual-audit.mjs'), '--summary']],
  [
    'Visual audit artifact validation',
    [fromRoot('scripts/runtime-smoke-artifact-check.mjs'), '--only-web-local-artifacts'],
  ],
]

const webLocalBaseCheckLabels = new Set([
  'Service Worker source build',
  'TypeScript',
  'Vite production build',
  'ESLint',
  'Repository health',
  'Shared schema',
  'Icon/cloud-sync redlines',
  'Worker security',
  'Deployment readiness',
  'Cloudflare Pages deploy dry-run',
  'Bundle size',
  'Copy consistency',
  'Documentation links',
  'UI accessibility',
  'Axe accessibility',
  'Lighthouse performance',
  'Unit tests',
  'Web source coverage',
  'Skill system',
  'Cloud sync E2E',
  'Gist sync E2E',
  'Live sync drill safety',
  'Live provider smoke safety',
  'Web i18n',
])
const webLocalBaseChecks = baseChecks.filter(([label]) => webLocalBaseCheckLabels.has(label))
const webLocalReleaseChecks = releaseChecks.filter(([label]) => label !== 'Visual audit artifact validation')
const webLocalArtifactValidationCheck = [
  'Web local artifact validation',
  [fromRoot('scripts/runtime-smoke-artifact-check.mjs'), '--only-web-local-artifacts'],
]

const finalChecks = [
  ['Local runtime cleanup', [fromRoot('scripts/local-runtime-cleanup-check.mjs')]],
]
const capturedFailureCheckLabels = new Set([
  'Browser smoke',
  'Runtime smoke artifacts',
  'Web local artifact validation',
  'Native runtime smoke artifacts',
  'Live sync release-pass evidence',
  'Live provider full capability release evidence',
])
const postCheckpointValidationChecks = [
  [
    'Verify-release checkpoint report',
    [
      fromRoot('scripts/runtime-smoke-artifact-check.mjs'),
      '--only-verify-release-checkpoint-report',
      `--require-verify-release-checkpoint=${verifyReleaseCheckpointReport}`,
    ],
  ],
  ['Current evidence handoff', [fromRoot('scripts/release-current-evidence-summary.mjs'), '--check']],
  ['Completion audit after current evidence sync', [fromRoot('scripts/completion-audit-check.mjs')]],
  ['Repository health after current evidence sync', [fromRoot('scripts/repository-health-check.mjs')]],
]

const allPlatformChecks = [
  [
    'Native build prerequisites for all platforms',
    [
      fromRoot('scripts/native-build-prereq-check.mjs'),
      '--platform=all',
      `--report=${allPlatformPrereqReport}`,
    ],
  ],
]
const allPlatformPrereqValidationCheck = [
  'All-platform native prerequisite blocker report validation',
  [
    fromRoot('scripts/runtime-smoke-artifact-check.mjs'),
    '--only-native-prereq-report',
    `--require-native-prereq=${allPlatformPrereqReport}`,
  ],
]
const liveSyncReleasePassCheck = [
  'Live sync release-pass evidence',
  [
    fromRoot('scripts/runtime-smoke-artifact-check.mjs'),
    '--only-live-sync-report',
    `--require-live-sync-passed-report=${liveSyncReleasePassReport}`,
  ],
]
const nativeRuntimeArtifactsCheck = [
  'Native runtime smoke artifacts',
  [
    fromRoot('scripts/runtime-smoke-artifact-check.mjs'),
    '--only-runtime-artifact',
    '--require-runtime-artifact=windows',
    '--require-runtime-artifact=windows-msix-trusted',
    '--require-runtime-artifact=android',
    '--require-runtime-artifact=apple',
    '--require-runtime-artifact=linux',
  ],
]
const hostedNativeCiEvidenceRequiredCheck = [
  'Hosted native CI release evidence',
  [
    fromRoot('scripts/hosted-native-ci-evidence-check.mjs'),
    `--report=${hostedNativeCiEvidenceReport}`,
    '--require',
  ],
]
const liveProviderFullCapabilityCheck = [
  'Live provider full capability release evidence',
  [
    fromRoot('scripts/runtime-smoke-artifact-check.mjs'),
    '--only-live-provider-api-report',
    `--require-live-provider-full-capability-report=${liveProviderFullCapabilityReport}`,
  ],
]
const strictReleaseBlockerSummaryRefreshCheck = [
  'Release blocker summary refresh',
  [fromRoot('scripts/release-blocker-report.mjs')],
]
const releaseDiagnosticsFreshnessBootstrapCheck = [
  'Release diagnostics freshness bootstrap',
  [
    fromRoot('scripts/release-diagnostics-refresh.mjs'),
    '--write-current-summary',
    '--validate-current-sources',
    '--allow-refreshable-web-current-page-stale',
  ],
]
const strictReleasePreflightFreshnessCheck = [
  'Strict release preflight freshness refresh',
  [fromRoot('scripts/strict-release-preflight-report.mjs')],
]
const releaseDiagnosticsPrerequisiteChecks =
  skipStrictReleasePreflightRefresh || strictReleasePreflightRequested
    ? []
    : [strictReleasePreflightFreshnessCheck]

function displayArgs(args) {
  return args
    .map((arg) => (isAbsolute(arg) ? relative(root, arg) || arg : arg))
    .join(' ')
}

function checkTimeoutMs(label) {
  if (label === 'Live provider smoke safety') {
    return liveProviderSmokeCheckTimeoutMs
  }

  if (label === 'ESLint') {
    return eslintCheckTimeoutMs
  }

  if (label === 'Android Lint') {
    return androidLintCheckTimeoutMs
  }

  return verifyCheckTimeoutMs
}

function compactCapturedOutput(output) {
  return output
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim()

      return (
        trimmed.length > 0 &&
        !trimmed.startsWith('file://') &&
        !trimmed.startsWith('at file://') &&
        !trimmed.startsWith('at process.') &&
        !trimmed.startsWith('Node.js v') &&
        !trimmed.startsWith('throw new Error(') &&
        trimmed !== '^'
      )
    })
    .join('\n')
}

function currentWindowsTrustedMsixBlocker() {
  let report = null
  try {
    report = JSON.parse(readFileSync(resolve(root, releaseBlockerSummaryReport), 'utf8'))
  } catch {
    return null
  }

  const blockers = Array.isArray(report?.blockers) ? report.blockers : []
  const blocker = blockers.find((candidate) => candidate?.id === 'windows-trusted-msix-release-pass')
  const evidence = blocker?.evidence ?? {}
  const hostPreflight = evidence.hostPreflight ?? {}
  const packageCandidate = evidence.currentMsixPackageCandidate ?? {}
  const needsElevatedRerun =
    blocker?.blockerKind === 'windows-trusted-msix-needs-elevated-current-source-rerun' &&
    evidence.currentTrustedQaState === 'host-clear-needs-elevated-trusted-msix-rerun' &&
    evidence.needsElevatedTrustedQaRerun === true &&
    hostPreflight.currentShellElevated === false
  const hostAppxDeploymentBlockerKinds = new Set([
    'windows-appx-deployment-deleted-package-cleanup-access-denied',
    'windows-appx-deployment-deleted-package-cleanup-failure',
  ])
  const hostAppxDeploymentBlocked =
    hostAppxDeploymentBlockerKinds.has(blocker?.blockerKind) &&
    hostPreflight.blockerKind === blocker.blockerKind &&
    evidence.currentTrustedQaState === 'host-preflight-blocked-or-unproven' &&
    evidence.needsHostRepairBeforeTrustedQa === true &&
    evidence.needsElevatedTrustedQaRerun === false &&
    hostPreflight.status === 'blocked' &&
    hostPreflight.hostReadyForTrustedMsix === false &&
    hostPreflight.trustedMsixQaCanRunInCurrentShell === false

  if (
    (!needsElevatedRerun && !hostAppxDeploymentBlocked) ||
    packageCandidate.stageWebMatchesDist !== true ||
    packageCandidate.packageWebMatchesDist !== true ||
    packageCandidate.packageWebMatchesStage !== true
  ) {
    return null
  }

  return blocker
}

function formatWindowsTrustedMsixExpectedFailure(label, status, output) {
  if (
    label !== 'Runtime smoke artifacts' ||
    !output.includes('windows-msix-current-trusted-install-update-qa') ||
    !isWindowsTrustedMsixOnlyRuntimeArtifactFailure(output)
  ) {
    return null
  }

  const blocker = currentWindowsTrustedMsixBlocker()
  if (!blocker) {
    return null
  }

  const evidence = blocker.evidence ?? {}
  const hostPreflight = evidence.hostPreflight ?? {}
  const packageCandidate = evidence.currentMsixPackageCandidate ?? {}
  const stageWebAssets = packageCandidate.stageWebAssets ?? evidence.currentDistWebAssets ?? {}
  const packageWebAssets = packageCandidate.packageWebAssets ?? {}
  const packagePath = packageCandidate.path ?? '.manual-qa/ZeroChat_0.0.1.0_x64.msix'
  const packageBytes =
    typeof packageCandidate.bytes === 'number' ? `${packageCandidate.bytes} bytes` : 'unknown bytes'
  const packageSha = packageCandidate.sha256 ?? 'unknown'
  const stageFileCount =
    typeof stageWebAssets.fileCount === 'number' ? `${stageWebAssets.fileCount} files` : 'unknown files'
  const stageBytes =
    typeof stageWebAssets.totalBytes === 'number' ? `${stageWebAssets.totalBytes} bytes` : 'unknown bytes'
  const stageSha = stageWebAssets.sha256 ?? 'unknown'
  const packageWebFileCount =
    typeof packageWebAssets.fileCount === 'number'
      ? `${packageWebAssets.fileCount} files`
      : 'unknown files'
  const packageWebBytes =
    typeof packageWebAssets.totalBytes === 'number'
      ? `${packageWebAssets.totalBytes} bytes`
      : 'unknown bytes'
  const packageWebSha = packageWebAssets.sha256 ?? 'unknown'
  const activeLockApplications = Array.isArray(hostPreflight.activeLockApplicationNames)
    ? hostPreflight.activeLockApplicationNames.filter(
        (value) => typeof value === 'string' && value.trim() !== '',
      )
    : []
  const activeLockPackages = Array.isArray(hostPreflight.activeLockPackages)
    ? hostPreflight.activeLockPackages.filter(
        (value) => typeof value === 'string' && value.trim() !== '',
      )
    : []
  const activeLockProcessCount = Number.isInteger(hostPreflight.activeLockProcessCount)
    ? hostPreflight.activeLockProcessCount
    : 0
  const nextProof = windowsTrustedMsixNextProofGate({
    hostStatus: hostPreflight.status,
    activeLockProcessCount,
    activeLockApplicationNames: activeLockApplications,
  })
  const activeLockSummary =
    activeLockProcessCount > 0
      ? `Active WindowsApps Deleted lock holders: ${activeLockProcessCount} processes; applications ${activeLockApplications.join(', ') || 'unknown'}; packages ${activeLockPackages.join(', ') || 'unknown'}.`
      : null

  return [
    status,
    'Expected release blocker: windows-trusted-msix-release-pass-missing.',
    WINDOWS_TRUSTED_MSIX_ONLY_SCOPE_MARKER,
    `Current blocker kind: ${blocker.blockerKind}.`,
    `Host preflight: ${hostPreflight.trustedMsixQaReadiness ?? 'unknown'}; currentShellElevated=${hostPreflight.currentShellElevated === true}; hostReadyForTrustedMsix=${hostPreflight.hostReadyForTrustedMsix === true}.`,
    activeLockSummary,
    `Action: ${nextProof}.`,
    `Current MSIX package candidate: ${packagePath} (${packageBytes} / SHA-256 ${packageSha}).`,
    `Staged web tree matches current dist: ${stageFileCount} / ${stageBytes} / SHA-256 ${stageSha}.`,
    `Package-internal web tree matches current dist and stage: ${packageWebFileCount} / ${packageWebBytes} / SHA-256 ${packageWebSha}.`,
    'Historical trusted MSIX evidence is stale diagnostic-only, not release evidence.',
  ]
    .filter(Boolean)
    .join('\n')
}

function shouldContinueAfterExpectedRuntimeArtifactFailure([label], error) {
  return (
    release &&
    label === 'Runtime smoke artifacts' &&
    currentWindowsTrustedMsixBlocker() !== null &&
    errorMessage(error).includes(
      'Expected release blocker: windows-trusted-msix-release-pass-missing',
    ) &&
    errorMessage(error).includes(WINDOWS_TRUSTED_MSIX_ONLY_SCOPE_MARKER)
  )
}

function formatCapturedFailure(label, code, signal, output) {
  const status = signal
    ? `${label} stopped by signal ${signal}`
    : `${label} failed with exit code ${code}`
  const windowsTrustedMsixExpectedFailure = formatWindowsTrustedMsixExpectedFailure(
    label,
    status,
    output,
  )
  if (windowsTrustedMsixExpectedFailure) {
    return windowsTrustedMsixExpectedFailure
  }

  const compactOutput = compactCapturedOutput(output)

  return compactOutput ? `${status}\n${compactOutput}` : status
}

const timedOutChildSettlementMs = 15_000

function terminateTimedOutChild(child, settleTimeout) {
  const settlementTimer = setTimeout(settleTimeout, timedOutChildSettlementMs)

  void stopChildProcessTree(child)
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(settlementTimer)
      settleTimeout()
    })

  return settlementTimer
}

async function runCheck([label, args], options = {}) {
  const {
    captureOutput = false,
    env = process.env,
  } = options
  const shouldCaptureOutput = captureOutput
  const startedAt = new Date().toISOString()
  const command = `node ${displayArgs(args)}`
  const timeoutMs = checkTimeoutMs(label)
  console.log(`\n==> ${label}`)
  console.log(command)

  await new Promise((resolveRun, rejectRun) => {
    let capturedOutput = ''
    let recorded = false
    let timedOut = false
    let timeoutTimer
    let timeoutSettlementTimer
    const recordStep = (result) => {
      if (recorded) {
        return
      }

      recorded = true
      verifyRunSteps.push({
        label: sanitizeReportText(label),
        command: sanitizeReportText(command),
        startedAt,
        finishedAt: new Date().toISOString(),
        expectedExitCode: 0,
        ...result,
      })
    }
    const child = spawn(node, args, {
      cwd: root,
      env,
      stdio: shouldCaptureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    })
    const timeoutMessage = `${label} timed out after ${timeoutMs} ms`
    const rejectTimedOutCheck = (code = child.exitCode, signal = child.signalCode) => {
      if (!timedOut || recorded) {
        return
      }

      recordStep({
        actualExitCode: code ?? null,
        signal: signal ?? 'TIMEOUT',
        passed: false,
        timedOut: true,
        error: timeoutMessage,
      })
      rejectRun(new Error(timeoutMessage))
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true
      console.error(
        `${label} timed out after ${timeoutMs} ms; killing child process tree.`,
      )
      timeoutSettlementTimer = terminateTimedOutChild(child, rejectTimedOutCheck)
    }, timeoutMs)

    if (shouldCaptureOutput) {
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk) => {
        capturedOutput += chunk
      })
      child.stderr?.on('data', (chunk) => {
        capturedOutput += chunk
      })
    }

    child.on('error', (error) => {
      clearTimeout(timeoutTimer)
      clearTimeout(timeoutSettlementTimer)
      if (timedOut) {
        rejectTimedOutCheck()
        return
      }

      recordStep({
        actualExitCode: null,
        signal: null,
        passed: false,
        error: sanitizeReportText(errorMessage(error)),
      })
      rejectRun(error)
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timeoutTimer)
      clearTimeout(timeoutSettlementTimer)

      if (timedOut) {
        rejectTimedOutCheck(code, signal)
        return
      }

      if (code === 0) {
        recordStep({
          actualExitCode: 0,
          signal: signal ?? null,
          passed: true,
        })
        resolveRun()
        return
      }

      const failureMessage = formatCapturedFailure(label, code, signal, capturedOutput)
      recordStep({
        actualExitCode: code,
        signal: signal ?? null,
        passed: false,
        error: sanitizeReportText(failureMessage),
      })
      rejectRun(
        new Error(failureMessage),
      )
    })
  })
}

function checkOptions(check) {
  const [label] = check
  const options = preCheckpointAuditOptions(label, process.env)

  return capturedFailureCheckLabels.has(label)
    ? { ...options, captureOutput: true }
    : options
}

async function runPostCheckpointValidationCheck([label, args]) {
  console.log(`\n==> ${label}`)
  console.log(`node ${displayArgs(args)}`)

  await new Promise((resolveRun, rejectRun) => {
    let timedOut = false
    let timeoutSettlementTimer
    const child = spawn(node, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
    const timeoutMessage = `${label} timed out after ${verifyCheckTimeoutMs} ms`
    const rejectTimedOutCheck = () => {
      if (timedOut) {
        rejectRun(new Error(timeoutMessage))
      }
    }
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      console.error(
        `${label} timed out after ${verifyCheckTimeoutMs} ms; killing child process tree.`,
      )
      timeoutSettlementTimer = terminateTimedOutChild(child, rejectTimedOutCheck)
    }, verifyCheckTimeoutMs)

    child.on('error', (error) => {
      clearTimeout(timeoutTimer)
      clearTimeout(timeoutSettlementTimer)
      if (timedOut) {
        rejectTimedOutCheck()
        return
      }

      rejectRun(error)
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timeoutTimer)
      clearTimeout(timeoutSettlementTimer)

      if (timedOut) {
        rejectTimedOutCheck()
        return
      }

      if (code === 0) {
        resolveRun()
        return
      }

      rejectRun(
        new Error(
          signal
            ? `${label} stopped by signal ${signal}`
            : `${label} failed with exit code ${code}`,
        ),
      )
    })
  })
}

async function runPostCheckpointValidations() {
  for (const check of postCheckpointValidationChecks) {
    await runPostCheckpointValidationCheck(check)
  }
}

async function runWebCurrentPageQa() {
  console.log('\n==> Web current-page QA')
  const preview = await startVitePreviewLoopbackServer({
    serverLabel: 'Web current-page QA preview server',
  })
  const appUrl = preview.url
  console.log(`shared Vite preview ${appUrl}`)

  try {
    await runCheck([
      'Current-page Web QA',
      [fromRoot('scripts/web-current-page-qa.mjs'), `--url=${appUrl}`],
    ])
  } finally {
    await preview.close()
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function runAllPlatformPrerequisites(options = {}) {
  let prerequisiteError = null

  try {
    await runCheck(allPlatformChecks[0], options)
  } catch (error) {
    prerequisiteError = error
    console.log(
      '\nAll-platform native prerequisites did not pass; validating the blocker report before exiting.',
    )
  }

  try {
    await runCheck(allPlatformPrereqValidationCheck, options)
  } catch (validationError) {
    if (prerequisiteError) {
      throw new Error(`${errorMessage(prerequisiteError)}\n${errorMessage(validationError)}`)
    }

    throw validationError
  }

  if (prerequisiteError) {
    throw prerequisiteError
  }
}

function formatStrictPreflightFailures(failures) {
  return failures
    .map(({ label, message }) => {
      const indentedMessage = message
        .split(/\r?\n/u)
        .map((line) => `  ${line}`)
        .join('\n')

      return `- ${label}:\n${indentedMessage}`
    })
    .join('\n')
}

async function captureStrictPreflight(label, run) {
  try {
    await run()
    return null
  } catch (error) {
    return {
      label,
      message: errorMessage(error),
    }
  }
}

function sanitizeReportText(value) {
  return sanitizeReleaseReportText(value, {
    repositoryRoot: root,
    redactedValues: releaseReportRedactedValues,
  })
}

async function removeTemporaryPathAfterFailedAtomicWrite(temporaryPath, originalError) {
  try {
    await rm(temporaryPath, { force: true })
  } catch (cleanupError) {
    throw new Error(
      `Atomic report write failed and temporary file cleanup failed: ${sanitizeReportText(
        errorMessage(originalError),
      )}; cleanup failure: ${sanitizeReportText(errorMessage(cleanupError))}`,
    )
  }
}

function classifyExpectedVerifyFailure(failedSteps, failureSummary) {
  if (
    !release ||
    failedSteps.length !== 1 ||
    failedSteps[0]?.label !== 'Runtime smoke artifacts' ||
    typeof failureSummary !== 'string'
  ) {
    return null
  }

  if (
    isWindowsTrustedMsixOnlyExpectedFailureSummary(failureSummary) &&
    currentWindowsTrustedMsixBlocker()
  ) {
    return 'windows-trusted-msix-release-pass-missing'
  }

  return null
}

async function writeStrictReleasePreflightReport(failures) {
  const reportPath = resolve(root, strictReleasePreflightReport)
  const temporaryPath = `${reportPath}.${process.pid}.${Date.now()}.tmp`
  const blockers = failures.map((failure, index) => ({
    index: index + 1,
    label: sanitizeReportText(failure.label),
    message: sanitizeReportText(failure.message),
  }))
  const strictPreflightPassed = blockers.length === 0

  const report = {
    kind: 'zerochat.strictReleasePreflight.v1',
    version: 1,
    generatedAt: new Date().toISOString(),
    status: strictPreflightPassed ? 'passed' : 'blocked',
    passed: strictPreflightPassed,
    releaseEvidence: false,
    evidenceType: 'strict-release-preflight-diagnostic',
    safeToPublish: true,
    publishSafetyScope: 'sanitized-diagnostic-only; no secrets; relative paths only; not release evidence',
    requestedEvidence: {
      allPlatforms,
      nativeRuntimeArtifacts: requireNativeRuntimeArtifacts,
      liveSyncReleasePass: requireLiveSyncPass,
      hostedNativeCiEvidence: requireHostedNativeCiEvidence,
      liveProviderFullCapability: requireLiveProviderFullCapability,
    },
    blockerCount: blockers.length,
    blockers,
    slowerReleaseChecksStarted: false,
    nextSteps: {
      refreshCommands: [
        'pnpm run report:strict-release-preflight',
        'pnpm run report:release-blockers',
      ],
      validationCommands: [
        'pnpm run check:strict-release-preflight',
        'pnpm run check:release-blockers',
      ],
      releaseGateCommands: [
        'pnpm run verify:all-platforms:runtime-live-sync-hosted-provider',
      ],
    },
  }

  await withReleaseReportLock('verify-release strict release preflight report', async () => {
    await mkdir(dirname(reportPath), { recursive: true })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, reportPath)
    } catch (error) {
      await removeTemporaryPathAfterFailedAtomicWrite(temporaryPath, error)
      throw error
    }
  })
  console.log(
    strictPreflightPassed
      ? `\nStrict release preflight pass report written: ${strictReleasePreflightReport}`
      : `\nStrict release preflight blocker report written: ${strictReleasePreflightReport}`,
  )
}

async function writeVerifyReleaseCheckpoint(status, error = null) {
  const reportPath = resolve(root, verifyReleaseCheckpointReport)
  const temporaryPath = `${reportPath}.${process.pid}.${Date.now()}.tmp`
  const failedSteps = verifyRunSteps.filter(
    (step) => step.passed !== true,
  )
  const firstFailedStep = failedSteps[0] ?? null
  const failureSummary = error ? sanitizeReportText(errorMessage(error)) : null
  const expectedFailureKind = classifyExpectedVerifyFailure(failedSteps, failureSummary)
  const report = {
    kind: 'zerochat.verifyReleaseCheckpoint.v1',
    version: 1,
    generatedAt: new Date().toISOString(),
    startedAt: verifyRunStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    passed: status === 'passed',
    releaseEvidence: false,
    evidenceType: 'verify-release-checkpoint-diagnostic',
    safeToPublish: true,
    publishSafetyScope:
      'sanitized verification checkpoint; command labels, relative paths, statuses, and redacted failure summaries only; no provider keys, URLs, tokens, passphrases, payloads, or release evidence',
    requestedMode: {
      webLocal,
      release: releaseRequested,
      releaseChecksEnabled: release,
      allPlatforms,
      requireNativeRuntimeArtifacts,
      requireLiveSyncPass,
      requireHostedNativeCiEvidence,
      requireLiveProviderFullCapability,
    },
    stepCount: verifyRunSteps.length,
    failedStepCount: failedSteps.length,
    failedStepLabels: failedSteps.map((step) => step.label),
    failedStep: firstFailedStep?.label ?? null,
    failedStepCommand: firstFailedStep?.command ?? null,
    failedStepExitCode: firstFailedStep?.actualExitCode ?? null,
    expectedFailure: expectedFailureKind !== null,
    expectedFailureKind,
    failureSummary,
    steps: verifyRunSteps,
    nextSteps: {
      validationCommands: [
        'pnpm run check:repo',
        'pnpm run check:completion-audit',
        'pnpm run check:release-diagnostics',
        'pnpm run check:local-cleanup',
      ],
      rerunCommands: verifyReleaseRerunCommands(cliResult.flags),
    },
  }

  await withReleaseReportLock('verify-release checkpoint report', async () => {
    await mkdir(dirname(reportPath), { recursive: true })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, reportPath)
    } catch (writeError) {
      await removeTemporaryPathAfterFailedAtomicWrite(temporaryPath, writeError)
      throw writeError
    }
  })
  console.log(`\nVerify-release checkpoint written: ${verifyReleaseCheckpointReport}`)
}

async function syncCurrentEvidenceDocsAfterCheckpoint() {
  await new Promise((resolveRun, rejectRun) => {
    const args = [fromRoot('scripts/release-current-evidence-summary.mjs'), '--write-docs']
    let timedOut = false
    let timeoutSettlementTimer
    const child = spawn(node, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
    const timeoutMessage = `Current evidence doc sync timed out after ${verifyCheckTimeoutMs} ms`
    const rejectTimedOutCheck = () => {
      if (timedOut) {
        rejectRun(new Error(timeoutMessage))
      }
    }
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      console.error(
        `Current evidence doc sync timed out after ${verifyCheckTimeoutMs} ms; killing child process tree.`,
      )
      timeoutSettlementTimer = terminateTimedOutChild(child, rejectTimedOutCheck)
    }, verifyCheckTimeoutMs)

    child.on('error', (error) => {
      clearTimeout(timeoutTimer)
      clearTimeout(timeoutSettlementTimer)
      if (timedOut) {
        rejectTimedOutCheck()
        return
      }

      rejectRun(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeoutTimer)
      clearTimeout(timeoutSettlementTimer)

      if (timedOut) {
        rejectTimedOutCheck()
        return
      }

      if (code === 0) {
        resolveRun()
        return
      }

      rejectRun(
        new Error(
          signal
            ? `Current evidence doc sync stopped by signal ${signal}`
            : `Current evidence doc sync failed with exit code ${code}`,
        ),
      )
    })
  })
}

async function refreshCheckpointSyncDocsAndValidate(status, error = null) {
  // Keep this refresh separate from the preflight bootstrap: checks after the
  // bootstrap can change the host/runtime diagnostics that the checkpoint and
  // generated current-evidence docs must summarize.
  await refreshReleaseDiagnosticsBeforeCheckpoint()
  await writeVerifyReleaseCheckpoint(status, error)
  await syncCurrentEvidenceDocsAfterCheckpoint()
  await runPostCheckpointValidations()
}

async function refreshReleaseDiagnosticsBeforeCheckpoint() {
  await new Promise((resolveRun, rejectRun) => {
    const args = [fromRoot('scripts/release-diagnostics-refresh.mjs'), '--write-current-summary']
    let timedOut = false
    let timeoutSettlementTimer
    const child = spawn(node, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
    const timeoutMessage = `Release diagnostics refresh timed out after ${verifyCheckTimeoutMs} ms`
    const rejectTimedOutCheck = () => {
      if (timedOut) {
        rejectRun(new Error(timeoutMessage))
      }
    }
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      console.error(
        `Release diagnostics refresh timed out after ${verifyCheckTimeoutMs} ms; killing child process tree.`,
      )
      timeoutSettlementTimer = terminateTimedOutChild(child, rejectTimedOutCheck)
    }, verifyCheckTimeoutMs)

    child.on('error', (error) => {
      clearTimeout(timeoutTimer)
      clearTimeout(timeoutSettlementTimer)
      if (timedOut) {
        rejectTimedOutCheck()
        return
      }

      rejectRun(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeoutTimer)
      clearTimeout(timeoutSettlementTimer)

      if (timedOut) {
        rejectTimedOutCheck()
        return
      }

      if (code === 0) {
        resolveRun()
        return
      }

      rejectRun(
        new Error(
          signal
            ? `Release diagnostics refresh before verify checkpoint stopped by signal ${signal}`
            : `Release diagnostics refresh before verify checkpoint failed with exit code ${code}`,
        ),
      )
    })
  })
}

async function runStrictReleasePreflightChecks() {
  const failures = []
  const preflightRunOptions = { captureOutput: true }

  if (allPlatforms) {
    const failure = await captureStrictPreflight(
      'All-platform native prerequisites',
      () => runAllPlatformPrerequisites(preflightRunOptions),
    )
    if (failure) {
      failures.push(failure)
    }
  }

  if (requireNativeRuntimeArtifacts) {
    const failure = await captureStrictPreflight('Native runtime smoke artifacts', () =>
      runCheck(nativeRuntimeArtifactsCheck, preflightRunOptions),
    )
    if (failure) {
      failures.push(failure)
    }
  }

  if (requireLiveSyncPass) {
    const failure = await captureStrictPreflight('Live sync release-pass evidence', () =>
      runCheck(liveSyncReleasePassCheck, preflightRunOptions),
    )
    if (failure) {
      failures.push(failure)
    }
  }

  if (requireHostedNativeCiEvidence) {
    const failure = await captureStrictPreflight('Hosted native CI release evidence', () =>
      runCheck(hostedNativeCiEvidenceRequiredCheck, preflightRunOptions),
    )
    if (failure) {
      failures.push(failure)
    }
  }

  if (requireLiveProviderFullCapability) {
    const failure = await captureStrictPreflight(
      'Live provider full capability release evidence',
      () => runCheck(liveProviderFullCapabilityCheck, preflightRunOptions),
    )
    if (failure) {
      failures.push(failure)
    }
  }

  await writeStrictReleasePreflightReport(failures)

  let releaseBlockerSummaryError = null
  try {
    await runCheck(strictReleaseBlockerSummaryRefreshCheck, preflightRunOptions)
  } catch (error) {
    releaseBlockerSummaryError = error
  }

  if (failures.length > 0) {
    throw new Error(
      [
        `Strict release preflight blockers remain (${failures.length}):`,
        formatStrictPreflightFailures(failures),
        releaseBlockerSummaryError
          ? `Release blocker summary refresh failed after strict preflight report was written:\n${errorMessage(releaseBlockerSummaryError)}`
          : null,
        '',
        'Resolve every required evidence blocker above, then rerun the same gate. The slower Web/release checks were not started.',
      ].filter(Boolean).join('\n'),
    )
  }

  if (releaseBlockerSummaryError) {
    throw new Error(
      `Strict release preflight passed but release blocker summary refresh failed:\n${errorMessage(releaseBlockerSummaryError)}`,
    )
  }
}

async function main() {
  if (
    webLocal &&
    (
      allPlatforms ||
      requireLiveSyncPass ||
      requireNativeRuntimeArtifacts ||
      requireHostedNativeCiEvidence ||
      requireLiveProviderFullCapability
    )
  ) {
    throw new Error(
      '--web-local is a focused Web/PWA evidence refresh and cannot be combined with all-platform, native-runtime, live-sync, hosted-CI, or live-provider release-evidence modes.',
    )
  }

  if (webLocal) {
    console.log(
      'Web-local mode: refreshing local Web/PWA build, browser, visual, current-page, and focused artifact evidence. This is not a substitute for native runtime, trusted MSIX, live-sync, hosted CI, or live-provider release evidence.',
    )

    let runError = null
    try {
      const webLocalChecks = checksWithReleaseDiagnosticsBootstrap(
        webLocalBaseChecks,
        releaseDiagnosticsFreshnessBootstrapCheck,
        true,
        releaseDiagnosticsPrerequisiteChecks,
      )

      for (const check of webLocalChecks) {
        await runCheck(check, checkOptions(check))
      }

      for (const check of webLocalReleaseChecks) {
        await runCheck(check, checkOptions(check))
      }

      await runWebCurrentPageQa()
      await runCheck(webLocalArtifactValidationCheck, checkOptions(webLocalArtifactValidationCheck))
    } catch (error) {
      runError = error
    }

    let cleanupError = null
    try {
      for (const check of finalChecks) {
        await runCheck(check)
      }
    } catch (error) {
      cleanupError = error
    }

    if (runError || cleanupError) {
      throw new Error(
        [runError, cleanupError]
          .filter(Boolean)
          .map((error) => errorMessage(error))
          .join('\n'),
      )
    }

    console.log('\nWeb-local verification checks passed')
    return
  }

  if (allPlatforms) {
    console.log(
      'All-platform mode: checking native SDK/host prerequisites first. If this fails before Web checks, install or switch to the missing platform host and rerun.',
    )
  }

  if (requireLiveSyncPass) {
    console.log(
      'Live-sync release-pass mode: requiring a disposable live sync release-pass report before running the release gate.',
    )
  }

  if (requireNativeRuntimeArtifacts) {
    console.log(
      'Native-runtime-artifact mode: requiring Windows, Android, Apple, and Linux runtime smoke artifacts before running the release gate.',
    )
  }

  if (requireHostedNativeCiEvidence) {
    console.log(
      'Hosted-native-CI-evidence mode: requiring downloaded GitHub Actions native artifacts before running the release gate.',
    )
  }

  if (requireLiveProviderFullCapability) {
    console.log(
      'Live-provider-full-capability mode: requiring chat, image, audio, embeddings, moderation, and realtime provider release evidence before running the release gate.',
    )
  }

  let runError = null
  let deferredExpectedRuntimeArtifactError = null
  try {
    // Fail fast before slower Web/browser checks, but audit every requested
    // external release-evidence gate so strict release attempts expose the full
    // blocker set instead of only the first missing artifact. This still lives
    // inside runError so the checkpoint always records Local runtime cleanup.
    if (
      allPlatforms ||
      requireNativeRuntimeArtifacts ||
      requireLiveSyncPass ||
      requireHostedNativeCiEvidence ||
      requireLiveProviderFullCapability
    ) {
      await runStrictReleasePreflightChecks()
    }

    const checks = checksWithReleaseDiagnosticsBootstrap(
      [...baseChecks, ...(release ? releaseChecks : [])],
      releaseDiagnosticsFreshnessBootstrapCheck,
      release,
      releaseDiagnosticsPrerequisiteChecks,
    )

    for (const check of checks) {
      try {
        await runCheck(check, checkOptions(check))
      } catch (error) {
        if (shouldContinueAfterExpectedRuntimeArtifactFailure(check, error)) {
          deferredExpectedRuntimeArtifactError = error
          continue
        }

        throw error
      }
    }

    if (deferredExpectedRuntimeArtifactError) {
      runError = deferredExpectedRuntimeArtifactError
    }
  } catch (error) {
    runError = deferredExpectedRuntimeArtifactError
      ? new Error(
          `${errorMessage(deferredExpectedRuntimeArtifactError)}\n${errorMessage(error)}`,
        )
      : error
  }

  let cleanupError = null
  try {
    for (const check of finalChecks) {
      await runCheck(check)
    }
  } catch (error) {
    cleanupError = error
  }

  if (runError || cleanupError) {
    throw new Error(
      [runError, cleanupError]
        .filter(Boolean)
        .map((error) => errorMessage(error))
        .join('\n'),
    )
  }

  console.log(
    allPlatforms
      ? '\nAll-platform verification checks passed'
      : release
        ? '\nRelease verification checks passed'
        : '\nVerification checks passed',
  )
}

try {
  await main()
  if (!skipVerifyReleaseCheckpoint) {
    await refreshCheckpointSyncDocsAndValidate('passed')
  }
} catch (error) {
  if (!skipVerifyReleaseCheckpoint) {
    try {
      await refreshCheckpointSyncDocsAndValidate('failed', error)
    } catch (checkpointError) {
      console.error(`\nFailed to write/sync verify-release checkpoint: ${errorMessage(checkpointError)}`)
    }
  }
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
