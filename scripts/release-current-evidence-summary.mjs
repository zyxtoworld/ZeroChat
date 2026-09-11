import { createHash } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import {
  liveProviderSourceBindingLineFromBlockerEvidence,
  liveProviderUiReleaseEvidencePassed,
  liveProviderUiSourceBindingLineFromEvidence,
} from './release-evidence-lines.mjs'
import { releaseDiagnosticsChildSummaryFailures } from './release-diagnostics-summary-policy.mjs'
import { withReleaseReportLock } from './release-report-lock.mjs'
import { windowsTrustedMsixNextProofGate as resolveWindowsTrustedMsixNextProofGate } from './windows-msix-remediation.mjs'
import {
  currentEvidenceUsage,
  parseCurrentEvidenceCliArgs,
  shouldAllowStaleVerifyReleaseCheckpointForWriteDocs,
} from './release-current-evidence-cli.mjs'
import {
  syncLiveProviderUiQaResidualChecklist,
  syncLiveProviderUiMilestoneChecklist,
  syncLiveSyncQaResidualChecklist,
  syncLiveSyncRequirementsMilestoneChecklist,
} from './release-milestone-checklist.mjs'
import {
  currentAndroidDebugApkEvidence,
  sameAndroidSourceFingerprint,
} from './android-source-fingerprint.mjs'
import { currentWebAppShellContractMarkers } from './current-web-app-shell-contract.mjs'
import { windowsTrustedMsixReleasePassFailures } from './windows-msix-release-pass-policy.mjs'
import { verifyReleaseCheckpointBindingFailures } from './verify-release-checkpoint-binding.mjs'

const cliResult = parseCurrentEvidenceCliArgs(process.argv.slice(2))

if (cliResult.kind === 'help') {
  console.log(currentEvidenceUsage())
  process.exit(0)
}

if (cliResult.kind === 'error') {
  console.error(cliResult.message)
  process.exit(1)
}

const checkOnly = cliResult.mode === 'check'
const writeDocs = cliResult.mode === 'write-docs'
const allowStaleVerifyReleaseCheckpointForWriteDocs =
  shouldAllowStaleVerifyReleaseCheckpointForWriteDocs({
    mode: cliResult.mode,
    environment: process.env,
  })

const paths = {
  requirements: 'docs/REQUIREMENTS.md',
  qaAudit: 'docs/QA_AUDIT.md',
  releaseDiagnostics: '.manual-qa/release-diagnostics-current.json',
  releaseBlockers: '.manual-qa/release-blockers-current.json',
  verifyReleaseCheckpoint: '.manual-qa/verify-release-current.json',
  strictPreflight: '.manual-qa/strict-release-preflight.json',
  windowsHostPreflight: '.manual-qa/windows-msix-host-preflight.json',
  hostedNativeCi: '.manual-qa/hosted-native-ci-evidence.json',
  liveSyncDiagnostic: '.manual-qa/live-sync-release-drill-current-diagnostic.json',
  liveSyncReleasePass: '.manual-qa/live-sync-release-drill.json',
  liveProviderApi: '.manual-qa/live-provider-smoke.json',
  liveProviderDiagnostic: '.manual-qa/live-provider-smoke-current-diagnostic.json',
  liveProviderFull: '.manual-qa/live-provider-smoke-full-current.json',
  liveProviderUi: '.manual-qa/live-provider-ui-smoke-current.json',
  liveProviderUiAttempt: '.manual-qa/live-provider-ui-smoke-attempt-current.json',
  nativePrereq: '.manual-qa/native-prereq-all-platforms.json',
  androidRuntime: '.manual-qa/android-emulator-qa.json',
  androidUiSmoke: '.manual-qa/android-ui-smoke.json',
  androidCloudSyncSmoke: '.manual-qa/android-cloud-sync-smoke.json',
  androidContactSheet: '.manual-qa/android-current-contact-sheet.json',
  androidContactSheetImage: '.manual-qa/android-current-contact-sheet.png',
  webCurrentPage: '.manual-qa/web-current-page-qa.json',
  webCurrentPageVisual: '.manual-qa/web-current-page-visual-audit/visual-audit-manifest.json',
  releaseVisual: '.visual-audit/visual-audit-manifest.json',
  windowsTrustedMsixFailure:
    '.manual-qa/windows-msix-current-trusted-install-update-qa.failure.json',
  windowsTrustedMsixPass:
    '.manual-qa/windows-msix-current-trusted-install-update-qa.json',
  windowsCurrentMsixPackageCandidate: '.manual-qa/ZeroChat_0.0.1.0_x64.msix',
  distIndex: 'dist/index.html',
}

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]{20,}/u,
  /Bearer\s+sk-/iu,
  /ZEROCHAT_LIVE_PROVIDER_API_KEY\s*=/iu,
  /https?:\/\/(?!127\.0\.0\.1(?::|\/|$)|localhost(?::|\/|$)|\[::1\](?::|\/|$))[^\s"'`)]*/iu,
]

function formatBytes(value) {
  return Number(value).toLocaleString('en-US')
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function removeTemporaryPathAfterFailedAtomicWrite(temporaryPath, originalError) {
  try {
    await rm(temporaryPath, { force: true })
  } catch (cleanupError) {
    throw new Error(
      `Atomic current evidence write failed and temporary file cleanup failed: ${errorMessage(
        originalError,
      )}; cleanup failure: ${errorMessage(cleanupError)}`,
    )
  }
}

function asiaShanghaiDateTime(isoTimestamp) {
  if (typeof isoTimestamp !== 'string') {
    return ''
  }

  const timestamp = Date.parse(isoTimestamp.replace(/\.(\d{3})\d+(Z)$/u, '.$1$2'))
  if (!Number.isFinite(timestamp)) {
    return ''
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(new Date(timestamp))
    .reduce((result, part) => {
      result[part.type] = part.value
      return result
    }, {})

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} Asia/Shanghai`
}

async function fileEvidence(path) {
  const buffer = await readFile(path)
  return {
    path,
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

async function jsonEvidence(path) {
  const evidence = await fileEvidence(path)
  const json = JSON.parse(await readFile(path, 'utf8'))
  return { ...evidence, json }
}

async function optionalJsonEvidence(path) {
  try {
    return { ...(await jsonEvidence(path)), missing: false }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }

    return {
      path,
      bytes: 0,
      sha256: 'missing',
      missing: true,
      json: {
        status: 'missing',
        releaseEvidence: false,
        safeToPublish: false,
      },
    }
  }
}

function generatedAtOf(report) {
  return (
    report.generatedAt ??
    report.finishedAt ??
    report.run?.generatedAt ??
    report.metadata?.generatedAt ??
    null
  )
}

function generatedAtMs(report, label) {
  const generatedAt = generatedAtOf(report)
  const timestamp = typeof generatedAt === 'string' ? Date.parse(generatedAt) : NaN

  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must include a parseable generatedAt timestamp.`)
  }

  return timestamp
}

function assertVerifyReleaseCheckpointFreshness(evidence) {
  const verifyGeneratedAtMs = generatedAtMs(
    evidence.verifyReleaseCheckpoint.json,
    paths.verifyReleaseCheckpoint,
  )
  const comparedReports = [
    ['release diagnostics', evidence.releaseDiagnostics],
    ['release blockers', evidence.releaseBlockers],
    ['Web current-page QA', evidence.webCurrentPage],
  ]

  for (const [label, report] of comparedReports) {
    const reportGeneratedAtMs = generatedAtMs(report.json, report.path)

    if (verifyGeneratedAtMs < reportGeneratedAtMs) {
      throw new Error(
        `${paths.verifyReleaseCheckpoint} is older than the current ${label} report ${report.path}; rerun D:\\Node.js\\pnpm.CMD run verify:release before syncing current evidence.`,
      )
    }
  }
}

async function assertVerifyReleaseCheckpointInputBinding(evidence) {
  const bindingFailures = await verifyReleaseCheckpointBindingFailures({
    binding: evidence.verifyReleaseCheckpoint.json.inputBinding,
    repoRoot: process.cwd(),
  })

  if (bindingFailures.length > 0) {
    throw new Error(
      `${paths.verifyReleaseCheckpoint} input binding is stale or invalid: ${bindingFailures.join(' ')} Rerun D:\\Node.js\\pnpm.CMD run verify:release before syncing current evidence.`,
    )
  }
}

function currentMsixPackageCandidateFreshnessError(
  currentMsixPackageCandidate,
  actualPackageEvidence,
) {
  const refreshInstructions =
    'Run D:\\Node.js\\pnpm.CMD run report:release-blockers, then rerun D:\\Node.js\\pnpm.CMD run verify:release before syncing current evidence.'

  if (!currentMsixPackageCandidate || typeof currentMsixPackageCandidate !== 'object') {
    return `Current Windows trusted MSIX release blocker is missing currentMsixPackageCandidate evidence. ${refreshInstructions}`
  }

  if (currentMsixPackageCandidate.path !== actualPackageEvidence.path) {
    return `Current Windows trusted MSIX release blocker package-candidate path does not match the current package on disk. ${refreshInstructions}`
  }

  if (
    !Number.isSafeInteger(currentMsixPackageCandidate.bytes) ||
    currentMsixPackageCandidate.bytes < 0 ||
    typeof currentMsixPackageCandidate.sha256 !== 'string' ||
    !/^[A-F0-9]{64}$/u.test(currentMsixPackageCandidate.sha256)
  ) {
    return `Current Windows trusted MSIX release blocker package-candidate evidence is malformed. ${refreshInstructions}`
  }

  if (
    currentMsixPackageCandidate.bytes !== actualPackageEvidence.bytes ||
    currentMsixPackageCandidate.sha256 !== actualPackageEvidence.sha256
  ) {
    return `Current Windows trusted MSIX release blocker package-candidate evidence does not match the current package on disk. ${refreshInstructions}`
  }

  return null
}

function assertCurrentMsixPackageCandidateFreshness(evidence) {
  const windowsBlocker = releaseBlockerById(
    evidence,
    'windows-trusted-msix-release-pass',
  )

  if (!windowsBlocker) {
    const failures = windowsTrustedMsixReleasePassFailures({
      report: evidence.windowsTrustedMsixPass?.json,
      validation: evidence.releaseBlockers.json.validationResults?.find(
        (item) => item?.id === 'windowsTrustedMsixFailure',
      ),
    })
    if (failures.length > 0) {
      throw new Error(
        `Windows trusted MSIX blocker is absent without a valid current release pass: ${failures.join(' ')}`,
      )
    }
    return
  }

  const failure = currentMsixPackageCandidateFreshnessError(
    windowsBlocker?.evidence?.currentMsixPackageCandidate,
    evidence.currentWindowsMsixPackageCandidate,
  )

  if (failure) {
    throw new Error(failure)
  }
}

function reportLine(label, report) {
  const generatedAt = generatedAtOf(report.json)
  const localTime = asiaShanghaiDateTime(generatedAt)
  const status = report.json.status ? `, status ${JSON.stringify(report.json.status)}` : ''
  const releaseEvidence =
    typeof report.json.releaseEvidence === 'boolean'
      ? `, releaseEvidence ${report.json.releaseEvidence}`
      : ''

  return `- ${label}: \`${report.path}\`, ${formatBytes(report.bytes)} bytes / SHA-256 \`${report.sha256}\`${generatedAt ? `, generatedAt \`${generatedAt}\`${localTime ? ` (${localTime})` : ''}` : ''}${status}${releaseEvidence}.`
}

function webCurrentPageLine(report) {
  const generatedAt = generatedAtOf(report.json)
  const localTime = asiaShanghaiDateTime(generatedAt)
  const webSource = report.json.webSource ?? {}
  const visualAudit = report.json.visualAudit ?? {}
  const iconSyncDom = report.json.iconSyncDom ?? {}
  const screenshotCount = visualAudit.screenshotCount ?? visualAudit.expectedScreenshotCount
  const expectedScreenshotCount = visualAudit.expectedScreenshotCount ?? screenshotCount
  const syncSettingsOpened = iconSyncDom.syncSettingsOpened === true
  const browserPassed = report.json.browserSmoke?.passed === true

  return [
    `- Web current-page QA: \`${report.path}\`, ${formatBytes(report.bytes)} bytes / SHA-256 \`${report.sha256}\`${generatedAt ? `, generatedAt \`${generatedAt}\`${localTime ? ` (${localTime})` : ''}` : ''}, passed ${report.json.passed === true}.`,
    `  Web source digest \`${webSource.digest ?? 'unknown'}\`${webSource.fileCount ? ` across ${webSource.fileCount} files` : ''}; screenshots ${screenshotCount ?? 'unknown'}/${expectedScreenshotCount ?? 'unknown'}; browser smoke ${browserPassed ? 'passed' : 'not-passed'}; Settings to Sync proof ${syncSettingsOpened ? 'passed' : 'not-passed'}.`,
  ].join('\n')
}

function blockerIds(report) {
  return (report.json.blockers ?? [])
    .map((blocker) => blocker.id)
    .filter((id) => typeof id === 'string' && id.length > 0)
}

function allNextActions(report) {
  return (report.json.blockers ?? []).flatMap((blocker) =>
    (blocker.nextActions ?? []).map((action) => ({
      blocker: blocker.id,
      action,
    })),
  )
}

function reportSummary(label, report) {
  const generatedAt = generatedAtOf(report.json)
  const localTime = asiaShanghaiDateTime(generatedAt)
  const status = report.json.status ? `，status \`${report.json.status}\`` : ''
  const releaseEvidence =
    typeof report.json.releaseEvidence === 'boolean'
      ? `，releaseEvidence ${report.json.releaseEvidence}`
      : ''

  return `${label}\`${report.path}\`（${formatBytes(report.bytes)} bytes / SHA-256 \`${report.sha256}\`${generatedAt ? `，generatedAt \`${generatedAt}\`${localTime ? `，${localTime}` : ''}` : ''}${status}${releaseEvidence}）`
}

function aggregateDiagnosticChildSafetyLine(evidence) {
  const summaries = Array.isArray(evidence.releaseDiagnostics.json.reportSummaries)
    ? evidence.releaseDiagnostics.json.reportSummaries
    : []
  const reportCount =
    typeof evidence.releaseDiagnostics.json.reportCount === 'number'
      ? evidence.releaseDiagnostics.json.reportCount
      : summaries.length
  const safeToPublishCount = summaries.filter((summary) => summary?.safeToPublish === true).length
  const releaseEvidenceFalseCount = summaries.filter(
    (summary) => summary?.releaseEvidence === false,
  ).length
  const releaseEvidenceTrueCount = summaries.filter(
    (summary) => summary?.releaseEvidence === true,
  ).length
  const unsafeChildPaths = summaries
    .filter((summary) => summary?.safeToPublish !== true)
    .map((summary) => summary?.path ?? 'unknown')
  const childPolicyFailures = releaseDiagnosticsChildSummaryFailures(summaries)

  if (summaries.length !== reportCount) {
    throw new Error(
      `Aggregate release diagnostics reportCount ${reportCount} does not match ${summaries.length} reportSummaries.`,
    )
  }
  if (unsafeChildPaths.length) {
    throw new Error(
      `Aggregate release diagnostics includes child summaries that are not safeToPublish=true: ${unsafeChildPaths.join(', ')}.`,
    )
  }
  if (childPolicyFailures.length) {
    throw new Error(
      `Aggregate release diagnostics child summary policy failed: ${childPolicyFailures.join(' ')}`,
    )
  }

  return `Aggregate diagnostic child safety: ${safeToPublishCount}/${reportCount} child summaries are \`safeToPublish: true\`, ${releaseEvidenceFalseCount}/${reportCount} are \`releaseEvidence: false\`, and ${releaseEvidenceTrueCount}/${reportCount} are validated child release evidence; \`pnpm run check:release-diagnostics\` rejects unsafe or invalid child summaries without promoting the aggregate.`
}

function verifyReleaseFailureDetailLine(evidence) {
  const checkpoint = evidence.verifyReleaseCheckpoint.json ?? {}
  const failedSteps = Array.isArray(checkpoint.steps)
    ? checkpoint.steps.filter((step) => step?.passed === false && step?.toleratedFailure !== true)
    : []
  const runtimeFailure =
    failedSteps.find((step) => step?.label === 'Runtime smoke artifacts') ?? failedSteps[0]
  const failureText = `${checkpoint.failureSummary ?? ''}\n${runtimeFailure?.error ?? ''}`

  if (
    checkpoint.status === 'passed' &&
    checkpoint.passed === true &&
    failedSteps.length === 0
  ) {
    return 'Verify-release checkpoint detail: the current full local release verifier passed with no failed steps; this proves the local gate only and does not close target-host or remote release blockers.'
  }

  if (checkpoint.status !== 'failed' || !runtimeFailure || failureText.trim() === '') {
    return 'Verify-release checkpoint failure detail: no failed release checkpoint detail is currently captured; rerun `pnpm run verify:release` before treating the handoff as current.'
  }

  if (runtimeFailure.label !== 'Runtime smoke artifacts') {
    return `Verify-release checkpoint failure detail: failed \`${runtimeFailure.label}\`; expectedFailure ${checkpoint.expectedFailure === true ? 'true' : 'false'}, expectedFailureKind \`${checkpoint.expectedFailureKind ?? 'none'}\`. Inspect \`${paths.verifyReleaseCheckpoint}\` for the exact sanitized gate output; this failure is not classified as a Windows runtime-artifact blocker.`
  }

  const classification =
    failureText.match(/blockerClassification=([a-z0-9-]+)/u)?.[1] ??
    (failureText.includes('windows-appx-deployment-deleted-package-cleanup-access-denied')
      ? 'windows-appx-deployment-deleted-package-cleanup-access-denied'
      : 'unknown')
  const owner = failureText.match(/owner=([a-z0-9-]+)/u)?.[1] ?? 'unknown'
  const hostStatus =
    failureText.match(/current host preflight status=([a-z0-9-]+)/u)?.[1] ??
    evidence.windowsHostPreflight.json?.status ??
    'unknown'
  const readiness =
    failureText.match(/trustedMsixQaReadiness=([a-z0-9-]+)/u)?.[1] ??
    evidence.windowsHostPreflight.json?.trustedMsixQaReadiness ??
    'unknown'
  const cleanupVerified = failureText.includes('cleanupVerified shows no ZeroChat package')
  const windowsBlocker = releaseBlockerById(evidence, 'windows-trusted-msix-release-pass')
  const currentBlockerKind =
    windowsBlocker?.blockerKind ?? windowsBlocker?.evidence?.blockerKind ?? 'unknown'
  const currentOwner = windowsBlocker?.owner ?? windowsBlocker?.evidence?.owner ?? 'unknown'
  const historicalKind =
    windowsBlocker?.evidence?.historicalTrustedQaFailureKind ?? classification
  const historicalOwner =
    windowsBlocker?.evidence?.historicalTrustedQaFailureOwner ?? owner
  const expectedFailureKind = checkpoint.expectedFailureKind ?? null
  const runtimeFailureBulletLines = [
    ...new Set(
      failureText
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- ')),
    ),
  ]
  const windowsRuntimeReportPaths = [
    '.manual-qa/windows-msix-current-trusted-install-update-qa.json',
    '.manual-qa/windows-msix-current-trusted-install-update-qa.failure.json',
    '.manual-qa/windows-msix-host-preflight.json',
  ]
  const isWindowsRuntimeFailureLine = (line) =>
    windowsRuntimeReportPaths.some((reportPath) => {
      const prefix = `- ${reportPath}`
      return line === prefix || line.startsWith(`${prefix} `)
    })
  const windowsRuntimeFailureLines = runtimeFailureBulletLines.filter(
    isWindowsRuntimeFailureLine,
  )
  const independentRuntimeFailureLines = runtimeFailureBulletLines.filter(
    (line) => !isWindowsRuntimeFailureLine(line),
  )

  if (
    checkpoint.expectedFailure === true &&
    expectedFailureKind === 'windows-trusted-msix-release-pass-missing'
  ) {
    const currentMsix = windowsBlocker?.evidence?.currentMsixPackageCandidate ?? {}
    const stageWebMatchesDist =
      currentMsix.stageWebMatchesDist === true ? 'true' : 'false'
    const packageWebMatchesDist =
      currentMsix.packageWebMatchesDist === true ? 'true' : 'false'
    const packageWebMatchesStage =
      currentMsix.packageWebMatchesStage === true ? 'true' : 'false'

    return `Verify-release checkpoint failure detail: failed \`${runtimeFailure.label}\` is expected blocker \`${expectedFailureKind}\`; current release blockerKind is \`${currentBlockerKind}\`, owner \`${currentOwner}\`; Windows host preflight status \`${hostStatus}\`, trustedMsixQaReadiness \`${readiness}\`; current MSIX package-candidate staged web matches dist: \`${stageWebMatchesDist}\`, package-internal web matches dist: \`${packageWebMatchesDist}\`, package-internal web matches stage: \`${packageWebMatchesStage}\`; next proof gate \`${windowsTrustedMsixNextProofGate(evidence, windowsBlocker)}\`; this is diagnostic-only and not release evidence.`
  }

  if (independentRuntimeFailureLines.length > 0) {
    const expectedAdditionalBlockers = Array.isArray(
      evidence.releaseDiagnostics.json.runtimeArtifactExpectedBlocker
        ?.additionalExpectedBlockers,
    )
      ? evidence.releaseDiagnostics.json.runtimeArtifactExpectedBlocker
          .additionalExpectedBlockers
      : []
    const matchedAdditionalBlockers = expectedAdditionalBlockers.filter(
      (blocker) =>
        typeof blocker?.reportPath === 'string' &&
        independentRuntimeFailureLines.some((line) => {
          const prefix = `- ${blocker.reportPath}`
          return line === prefix || line.startsWith(`${prefix} `)
        }),
    )
    const matchedReportPaths = new Set(
      matchedAdditionalBlockers.map((blocker) => blocker.reportPath),
    )
    const unmatchedIndependentLineCount = independentRuntimeFailureLines.filter(
      (line) =>
        ![...matchedReportPaths].some((reportPath) => {
          const prefix = `- ${reportPath}`
          return line === prefix || line.startsWith(`${prefix} `)
        }),
    ).length
    const additionalBlockerSummary = matchedAdditionalBlockers.length
      ? matchedAdditionalBlockers
          .map(
            (blocker) =>
              `\`${blocker.id ?? 'unknown'}\` (\`${blocker.classification ?? 'unknown'}\`)`,
          )
          .join(', ')
      : 'no aggregate blocker identity matched'
    const unmatchedSummary = unmatchedIndependentLineCount
      ? `; ${unmatchedIndependentLineCount} independent failure line(s) remain unclassified`
      : ''
    const compoundScope = windowsRuntimeFailureLines.length
      ? 'contains the Windows trusted-MSIX blocker plus independent blocker evidence'
      : 'contains independent non-Windows blocker evidence'

    return `Verify-release checkpoint failure detail: failed \`${runtimeFailure.label}\` ${compoundScope} and is intentionally not classified as Windows-only; matched additional blockers: ${additionalBlockerSummary}${unmatchedSummary}; current Windows blockerKind is \`${currentBlockerKind}\`, owner \`${currentOwner}\`, host preflight status \`${hostStatus}\`, trustedMsixQaReadiness \`${readiness}\`; next Windows proof gate \`${windowsTrustedMsixNextProofGate(evidence, windowsBlocker)}\`; this checkpoint and aggregate are diagnostic-only and not release evidence.`
  }

  return `Verify-release checkpoint failure detail: failed \`${runtimeFailure.label}\` captured historical trusted-MSIX diagnostic \`${historicalKind}\`, owner \`${historicalOwner}\`, while current release blockerKind is \`${currentBlockerKind}\`, owner \`${currentOwner}\`; Windows host preflight status \`${hostStatus}\`, trustedMsixQaReadiness \`${readiness}\`${cleanupVerified ? ', and cleanupVerified no ZeroChat package/test certificate/private PFX/local data/temp-directory residue' : ''}; this is diagnostic-only and not release evidence.`
}

function releaseBlockerById(evidence, id) {
  return evidence.releaseBlockers.json.blockers?.find((blocker) => blocker.id === id)
}

function windowsTrustedMsixCurrentReleasePassLine(evidence) {
  const failures = windowsTrustedMsixReleasePassFailures({
    report: evidence.windowsTrustedMsixPass?.json,
    validation: evidence.releaseBlockers.json.validationResults?.find(
      (item) => item?.id === 'windowsTrustedMsixFailure',
    ),
  })
  if (failures.length > 0) {
    throw new Error(
      `Cannot summarize Windows trusted MSIX release pass: ${failures.join(' ')}`,
    )
  }

  const report = evidence.windowsTrustedMsixPass.json
  const cleanup = report.cleanupVerified
  return `Windows trusted MSIX current release-pass: run \`${report.runId}\` passed elevated fresh install \`${report.previousVersion}\`, trusted update to \`${report.currentVersion}\`, packaged launch after both stages, uninstall, and cleanup; current \`dist\` binding \`${report.distWebAssets.fileCount} files / ${report.distWebAssets.totalBytes} bytes\`, fresh/update screenshots \`${report.launchAfterInstall.windowWidth}x${report.launchAfterInstall.windowHeight} / ${report.launchAfterInstall.screenshotBytes} bytes\` and \`${report.launchAfterUpdate.windowWidth}x${report.launchAfterUpdate.windowHeight} / ${report.launchAfterUpdate.screenshotBytes} bytes\`; cleanup leaves packageInstalled ${cleanup.packageInstalled}, test certificates false, privatePfxExists ${cleanup.privatePfxExists}, packageLocalDataExists ${cleanup.packageLocalDataExists}, temporaryDirectoryExists ${cleanup.temporaryDirectoryExists}; report \`${paths.windowsTrustedMsixPass}\`, ${formatBytes(evidence.windowsTrustedMsixPass.bytes)} bytes / SHA-256 \`${evidence.windowsTrustedMsixPass.sha256}\`.`
}

function liveProviderUiEvidenceState(evidence) {
  const blocker = releaseBlockerById(
    evidence,
    'live-provider-web-ui-browser-origin-release-evidence',
  )
  const passed = liveProviderUiReleaseEvidencePassed({
    blocker,
    currentReport: evidence.liveProviderUi.json,
    attemptReport: evidence.liveProviderUiAttempt.json,
  })

  if (!blocker && !passed) {
    throw new Error(
      'Live provider UI blocker is absent, but the preserved attempt is not valid current-source browser-origin release evidence.',
    )
  }

  return { blocker, passed }
}

function residualReleaseBlockerIdsLine(evidence, prefix) {
  const ids = blockerIds(evidence.releaseBlockers)
  return `${prefix}（${ids.length}）${ids.length ? `：${inlineCodeList(ids)}` : '：`none`'}。`
}

function windowsTrustedMsixNextProofGate(evidence, blocker = releaseBlockerById(evidence, 'windows-trusted-msix-release-pass')) {
  const blockerEvidence = blocker?.evidence ?? {}
  const hostPreflight = blockerEvidence.hostPreflight ?? {}
  const hostStatus = hostPreflight.status ?? evidence.windowsHostPreflight.json?.status ?? 'unknown'

  return resolveWindowsTrustedMsixNextProofGate({
    hostStatus,
    activeLockProcessCount: hostPreflight.activeLockProcessCount,
    activeLockApplicationNames: hostPreflight.activeLockApplicationNames,
  })
}

function windowsTrustedMsixCurrentBlockerLine(evidence) {
  const blocker = releaseBlockerById(evidence, 'windows-trusted-msix-release-pass')
  const blockerEvidence = blocker?.evidence ?? {}
  const hostPreflight = blockerEvidence.hostPreflight ?? {}
  const historicalKind =
    blockerEvidence.historicalTrustedQaFailureKind ??
    evidence.windowsTrustedMsixFailure.json?.blockerClassification?.kind ??
    'unknown'
  const historicalOwner =
    blockerEvidence.historicalTrustedQaFailureOwner ??
    evidence.windowsTrustedMsixFailure.json?.blockerClassification?.owner ??
    'unknown'

  return `Windows trusted MSIX current blocker semantics: blockerKind \`${blocker?.blockerKind ?? blockerEvidence.blockerKind ?? 'unknown'}\`, owner \`${blocker?.owner ?? blockerEvidence.owner ?? 'unknown'}\`; currentTrustedQaState \`${blockerEvidence.currentTrustedQaState ?? 'unknown'}\`; needsElevatedTrustedQaRerun ${blockerEvidence.needsElevatedTrustedQaRerun === true ? 'true' : 'false'}; nextProofGate \`${windowsTrustedMsixNextProofGate(evidence, blocker)}\`; hostPreflight status \`${hostPreflight.status ?? evidence.windowsHostPreflight.json?.status ?? 'unknown'}\`, trustedMsixQaReadiness \`${hostPreflight.trustedMsixQaReadiness ?? evidence.windowsHostPreflight.json?.trustedMsixQaReadiness ?? 'unknown'}\`; historicalTrustedQaFailureKind \`${historicalKind}\`, historicalTrustedQaFailureOwner \`${historicalOwner}\`.`
}

function releaseBlockerOwnershipMatrixLine(evidence) {
  const blockers = Array.isArray(evidence.releaseBlockers.json.blockers)
    ? evidence.releaseBlockers.json.blockers
    : []
  const entries = blockers.map((blocker) => {
    const evidenceBlocker = blocker?.evidence ?? {}
    const id = blocker?.id ?? 'unknown'
    const status = blocker?.status ?? 'unknown'
    const blockerKind = blocker?.blockerKind ?? evidenceBlocker.blockerKind ?? 'unknown'
    const owner = blocker?.owner ?? evidenceBlocker.owner ?? 'unknown'

    return `\`${id}\` status \`${status}\`, blockerKind \`${blockerKind}\`, owner \`${owner}\``
  })

  return `Release blocker ownership matrix: ${entries.length ? entries.join('; ') : '`none`'}.`
}

function releaseBlockerChecklistEntries(report) {
  const blockers = report?.json?.blockers
  const blockerCount = report?.json?.blockerCount

  if (!Array.isArray(blockers)) {
    throw new Error('Current release blocker report must include a blockers array.')
  }
  if (!Number.isInteger(blockerCount) || blockerCount < 0) {
    throw new Error('Current release blocker report must include a non-negative blockerCount.')
  }
  if (blockers.length !== blockerCount) {
    throw new Error(
      `Current release blocker report blockerCount ${blockerCount} does not match ${blockers.length} blockers.`,
    )
  }

  const seenIds = new Set()
  return blockers.map((blocker, index) => {
    const id = typeof blocker?.id === 'string' ? blocker.id.trim() : ''
    const status = typeof blocker?.status === 'string' ? blocker.status.trim() : ''
    const blockerKind =
      typeof blocker?.blockerKind === 'string'
        ? blocker.blockerKind.trim()
        : typeof blocker?.evidence?.blockerKind === 'string'
          ? blocker.evidence.blockerKind.trim()
          : ''
    const owner =
      typeof blocker?.owner === 'string'
        ? blocker.owner.trim()
        : typeof blocker?.evidence?.owner === 'string'
          ? blocker.evidence.owner.trim()
          : ''
    const nextAction = Array.isArray(blocker?.nextActions)
      ? blocker.nextActions.find(
          (action) => typeof action === 'string' && action.trim() !== '',
        )
      : null

    if (!id || !status || !blockerKind || !owner || !nextAction) {
      throw new Error(
        `Current release blocker at index ${index} must include id, status, blockerKind, owner, and at least one nextAction.`,
      )
    }
    if (seenIds.has(id)) {
      throw new Error(`Current release blocker checklist ids must be unique; duplicate ${id}.`)
    }
    seenIds.add(id)

    return {
      id,
      line: `- [ ] 当前 release blocker \`${id}\`：status \`${status}\`，blockerKind \`${blockerKind}\`，owner \`${owner}\`；next action：${conciseReleaseBlockerNextAction(liveProviderFullCapabilityChecklistAction(blocker, nextAction))}`,
    }
  })
}

function liveProviderFullCapabilityChecklistAction(blocker, fallbackAction) {
  if (blocker?.id !== 'live-provider-full-capability-release-evidence') {
    return fallbackAction
  }

  const evidence = blocker?.evidence ?? {}
  const attemptReport = evidence.credentialConfirmedAttemptReport ?? {}
  const currentAffectedCapabilities = evidence.capabilityFailureSummary?.affectedCapabilities
  const attemptAffectedCapabilities = attemptReport.capabilityFailureSummary?.affectedCapabilities
  const uniqueCurrentAffectedCapabilities = Array.isArray(currentAffectedCapabilities)
    ? [...new Set(currentAffectedCapabilities.filter((item) => typeof item === 'string' && item))]
    : []
  const uniqueAttemptAffectedCapabilities = Array.isArray(attemptAffectedCapabilities)
    ? [...new Set(attemptAffectedCapabilities.filter((item) => typeof item === 'string' && item))]
    : []
  const credentialConfirmedAttempt =
    attemptReport.hasCredentialConfirmedProviderAttempt === true ||
    evidence.selectedSourceReport?.hasCredentialConfirmedProviderAttempt === true
  const currentCredentialConfirmedAttempt =
    uniqueCurrentAffectedCapabilities.length > 0 &&
    credentialConfirmedAttempt &&
    (attemptReport.sourceFingerprintCurrent === true ||
      (evidence.selectedSourceReport?.sourceFingerprintCurrent === true &&
        evidence.selectedSourceReport?.hasCredentialConfirmedProviderAttempt === true))
  const uniqueAffectedCapabilities = currentCredentialConfirmedAttempt
    ? uniqueCurrentAffectedCapabilities
    : credentialConfirmedAttempt
      ? uniqueAttemptAffectedCapabilities
      : []

  if (!uniqueAffectedCapabilities.length) {
    return fallbackAction
  }

  const evidenceScope = currentCredentialConfirmedAttempt
    ? 'current credential-confirmed'
    : 'preserved credential-confirmed'

  return `Repair ${evidenceScope} ${uniqueAffectedCapabilities.join(', ')} failures, then rerun pnpm run drill:live-provider on the current source.`
}

function conciseReleaseBlockerNextAction(action) {
  const normalized = action.trim().replace(/\s+/gu, ' ')
  const detailSeparator = normalized.indexOf(': ')

  if (detailSeparator > 0 && detailSeparator <= 160) {
    return normalized.slice(0, detailSeparator)
  }

  return normalized.match(/^.*?[.!?](?:\s|$)/u)?.[0]?.trim() ?? normalized
}

function releaseBlockerChecklistLines(report) {
  return releaseBlockerChecklistEntries(report).map((entry) => entry.line)
}

function assertRequirementsOverlayBlockerChecklist(overlay, report) {
  const expectedIds = releaseBlockerChecklistEntries(report).map((entry) => entry.id)
  const uncheckedLines = overlay.match(/^- \[ \].*$/gmu) ?? []
  const actualIds = uncheckedLines.map(
    (line) =>
      line.match(/^- \[ \] 当前 release blocker `([^`]+)`：/u)?.[1] ?? null,
  )

  if (
    uncheckedLines.length !== expectedIds.length ||
    actualIds.some((id) => id === null) ||
    actualIds.some((id, index) => id !== expectedIds[index])
  ) {
    throw new Error(
      `Requirements current evidence overlay unchecked blocker checklist must exactly match release blocker ids. Expected [${expectedIds.join(', ')}], received [${actualIds.map((id) => id ?? 'non-blocker-checkbox').join(', ')}].`,
    )
  }
}

function androidRuntimeEvidenceLine(evidence) {
  const runtime = evidence.androidRuntime.json ?? {}
  const contactSheetEvidence =
    runtime.contactSheetEvidence ?? evidence.androidContactSheet.json?.contactSheetEvidence ?? {}
  const screenshotBreakdown = runtime.screenshotBreakdown ?? {}
  const generatedAt = generatedAtOf(runtime)
  const localTime = asiaShanghaiDateTime(generatedAt)

  const currentApk = evidence.androidCurrentApk
  const reportApkEvidence = [
    ['UI smoke', evidence.androidUiSmoke.json?.apk?.local],
    ['Cloudflare sync smoke', evidence.androidCloudSyncSmoke.json?.apk?.local],
    ['aggregate emulator QA', runtime.apkEvidence],
  ]
  const staleReports = currentApk
    ? reportApkEvidence
        .filter(
          ([, reportApk]) =>
            !reportApk ||
            reportApk.bytes !== currentApk.bytes ||
            reportApk.sha256 !== currentApk.sha256 ||
            !sameAndroidSourceFingerprint(
              reportApk.sourceFingerprint,
              currentApk.sourceFingerprint,
            ),
        )
        .map(([label]) => label)
    : reportApkEvidence.map(([label]) => label)
  const currentBindingLine = currentApk
    ? staleReports.length
      ? `当前 source-bound debug APK 为 ${formatBytes(currentApk.bytes)} bytes / SHA-256 \`${currentApk.sha256}\`；${staleReports.join('、')} 报告仍绑定旧 APK 或旧 Android source fingerprint，不能作为当前源码 runtime QA，必须用该 APK 在授权设备/模拟器上重跑。QA marker: Current Android runtime evidence refuses stale APK reports.`
      : `三份 Android runtime 报告均绑定当前 source-bound debug APK（${formatBytes(currentApk.bytes)} bytes / SHA-256 \`${currentApk.sha256}\`）和同一 Android source fingerprint。QA marker: Current Android runtime evidence refuses stale APK reports.`
    : '当前 source-bound Android debug APK 证据不可读；现有 Android runtime 报告不能被当作当前源码证据。QA marker: Current Android runtime evidence refuses stale APK reports.'

  return `Android emulator runtime QA 当前 ${localTime || 'unknown time'} ${staleReports.length ? '历史报告记录' : '通过'} ${runtime.screenshotCount ?? 'unknown'} screenshots（UI ${screenshotBreakdown.ui ?? 'unknown'} / Cloudflare sync ${screenshotBreakdown.cloudSync ?? 'unknown'}），\`.manual-qa/android-emulator-qa.json\` 为 ${formatBytes(evidence.androidRuntime.bytes)} bytes / SHA-256 \`${evidence.androidRuntime.sha256}\`，UI smoke 为 ${formatBytes(evidence.androidUiSmoke.bytes)} bytes / SHA-256 \`${evidence.androidUiSmoke.sha256}\`，Cloudflare sync smoke 为 ${formatBytes(evidence.androidCloudSyncSmoke.bytes)} bytes / SHA-256 \`${evidence.androidCloudSyncSmoke.sha256}\`，contact sheet report 为 ${formatBytes(evidence.androidContactSheet.bytes)} bytes / SHA-256 \`${evidence.androidContactSheet.sha256}\`，contact sheet PNG 为 ${typeof contactSheetEvidence.bytes === 'number' ? formatBytes(contactSheetEvidence.bytes) : formatBytes(evidence.androidContactSheetImage.bytes)} bytes / SHA-256 \`${contactSheetEvidence.sha256 ?? evidence.androidContactSheetImage.sha256}\`，debug APK SHA-256 \`${runtime.apkEvidence?.sha256 ?? 'unknown'}\`。${currentBindingLine}`
}

function liveProviderUiProxyPreflight(evidence) {
  const uiBlocker = releaseBlockerById(
    evidence,
    'live-provider-web-ui-browser-origin-release-evidence',
  )

  return (
    uiBlocker?.evidence?.attemptedBrowserOriginReport?.proxyPreflight ??
    uiBlocker?.evidence?.proxyPreflight ??
    evidence.liveProviderUiAttempt.json.proxyPreflight ??
    null
  )
}

function liveProviderUiBrowserOriginProven(evidence) {
  const uiBlocker = releaseBlockerById(
    evidence,
    'live-provider-web-ui-browser-origin-release-evidence',
  )

  return (
    uiBlocker?.evidence?.attemptedBrowserOriginReport?.browserOriginProven === true ||
    uiBlocker?.evidence?.browserOriginProven === true ||
    evidence.liveProviderUiAttempt.json.browserOriginProven === true ||
    evidence.liveProviderUi.json.browserOriginProven === true
  )
}

function liveProviderUiProxyPreflightLine(evidence) {
  const proxyPreflight = liveProviderUiProxyPreflight(evidence)
  const topLevelBrowserOriginProven = liveProviderUiBrowserOriginProven(evidence)
  const uiEvidencePassed = liveProviderUiEvidenceState(evidence).passed

  if (!proxyPreflight || typeof proxyPreflight !== 'object') {
    return `Live provider UI proxyPreflight is not reported; top-level browserOriginProven ${topLevelBrowserOriginProven ? 'true' : 'false'}; browser-origin release evidence remains unproven.`
  }

  const status = proxyPreflight.status ?? 'unknown'
  const transportPath = proxyPreflight.transportPath ?? 'unknown'
  const browserOriginProven = proxyPreflight.browserOriginProven === true
  const selectedModel =
    typeof proxyPreflight.selectedModel === 'string' && proxyPreflight.selectedModel
      ? proxyPreflight.selectedModel
      : 'unknown'
  const chatStatus = Number.isInteger(proxyPreflight.chatStatus)
    ? proxyPreflight.chatStatus
    : 'unknown'

  return `Live provider UI browser-origin proxy preflight semantics: top-level browserOriginProven ${topLevelBrowserOriginProven ? 'true' : 'false'}; proxyPreflight.status \`${status}\`, transportPath \`${transportPath}\`, browserOriginProven ${browserOriginProven ? 'true' : 'false'}, selectedModel \`${selectedModel}\`, chatStatus \`${chatStatus}\`; Node-side preflight is not browser-origin release evidence${uiEvidencePassed ? '; the passed browserNetworkTrace supplies that proof.' : '.'}`
}

function liveProviderUiLocalProxyContractLine(evidence) {
  const uiBlocker = releaseBlockerById(
    evidence,
    'live-provider-web-ui-browser-origin-release-evidence',
  )
  const diagnostic = uiBlocker?.evidence?.localProxyContractDiagnostic

  if (!diagnostic || diagnostic.missing === true) {
    return 'Live provider UI loopback Worker contract diagnostic is not available; it remains optional supporting evidence and cannot replace browser-origin release evidence.'
  }

  return `Live provider UI loopback Worker contract diagnostic: path \`${diagnostic.path ?? 'unknown'}\`, status \`${diagnostic.status ?? 'unknown'}\`, releaseEvidence ${diagnostic.releaseEvidence === true ? 'true' : 'false'}, browserUiExecuted ${diagnostic.browserUiExecuted === true ? 'true' : 'false'}, browserOriginProven ${diagnostic.browserOriginProven === true ? 'true' : 'false'}, workerHostedProviderKeyConfigured ${diagnostic.workerHostedProviderKeyConfigured === true ? 'true' : 'false'}, providerKeyBrowserExposed ${diagnostic.providerKeyBrowserExposed === true ? 'true' : 'false'}, requestCredentialsAbsent ${diagnostic.requestCredentialsAbsent === true ? 'true' : 'false'}, modelListStatus \`${diagnostic.modelListStatus ?? 'unknown'}\`, chatStatus \`${diagnostic.chatStatus ?? 'unknown'}\`, selectedModel \`${diagnostic.selectedModel ?? 'unknown'}\`, markerCaptured ${diagnostic.markerCaptured === true ? 'true' : 'false'}, harnessClosed ${diagnostic.harnessClosed === true ? 'true' : 'false'}, sourceFingerprintCurrent ${diagnostic.sourceFingerprintCurrent === true ? 'true' : 'false'}; loopback contract proof is diagnostic-only and does not prove a deployed browser origin.`
}

function liveProviderUiSourceBindingLine(evidence) {
  const { blocker } = liveProviderUiEvidenceState(evidence)
  return liveProviderUiSourceBindingLineFromEvidence({
    blocker,
    currentReport: evidence.liveProviderUi.json,
    currentReportPath: paths.liveProviderUi,
    attemptReport: evidence.liveProviderUiAttempt.json,
    attemptReportPath: paths.liveProviderUiAttempt,
  })
}

function liveProviderUiRequiredRemediation(evidence) {
  if (liveProviderUiEvidenceState(evidence).passed) {
    return null
  }

  const uiBlocker = releaseBlockerById(
    evidence,
    'live-provider-web-ui-browser-origin-release-evidence',
  )
  const blockerEvidence = uiBlocker?.evidence ?? {}

  return (
    blockerEvidence.requiredRemediation ??
    blockerEvidence.attemptedBrowserOriginReport?.requiredRemediation ??
    evidence.liveProviderUiAttempt.json.requiredRemediation ??
    evidence.liveProviderUi.json.requiredRemediation ??
    {}
  )
}

function liveProviderUiRequiredRemediationLine(evidence) {
  const remediation = liveProviderUiRequiredRemediation(evidence)

  if (!remediation) {
    return 'Live provider UI required remediation: none; current-source browser-origin release evidence is already passed.'
  }
  const actions = Array.isArray(remediation.actions)
    ? remediation.actions.filter((action) => typeof action === 'string' && action.trim() !== '')
    : []
  const booleanText = (value) =>
    value === true ? 'true' : value === false ? 'false' : 'unknown'

  return `Live provider UI required remediation: kind \`${remediation.kind ?? 'unknown'}\`; browserAllowedProxyRequired ${booleanText(remediation.browserAllowedProxyRequired)}; requiresProxyUrl ${booleanText(remediation.requiresProxyUrl)}; requiresSyncPassphrase ${booleanText(remediation.requiresSyncPassphrase)}; requiresWorkerHostedProviderKey ${booleanText(remediation.requiresWorkerHostedProviderKey)}; actionCount ${actions.length}; actions ${inlineCodeList(actions)}.`
}

function liveProviderUiSourceFingerprint(evidence) {
  return (
    evidence.liveProviderUiAttempt.json.sourceFingerprint ??
    evidence.liveProviderUi.json.sourceFingerprint ??
    {}
  )
}

function sourceFingerprintSummaryLine(label, fingerprint, fallbackKind) {
  return `${label} source fingerprint schema \`${fingerprint.kind ?? fallbackKind}\`; ${fingerprint.fileCount ?? 'unknown'} files / ${typeof fingerprint.totalBytes === 'number' ? formatBytes(fingerprint.totalBytes) : 'unknown'} bytes; SHA-256 \`${fingerprint.sha256 ?? 'unknown'}\`.`
}

function failureSummaryTotal(summary) {
  return Number.isInteger(summary?.total) ? summary.total : 0
}

function routeHealthBlockerText(summary) {
  return Array.isArray(summary?.routeHealthBlockers)
    ? summary.routeHealthBlockers.join(' / ')
    : ''
}

function affectedCapabilitiesText(summary) {
  return Array.isArray(summary?.affectedCapabilities)
    ? summary.affectedCapabilities.join(' / ')
    : ''
}

function liveProviderHistoricalAttemptContextLine(blockerEvidence = {}) {
  const currentFailureSummary = blockerEvidence.capabilityFailureSummary ?? {}
  const attemptFailureSummary =
    blockerEvidence.credentialConfirmedAttemptReport?.capabilityFailureSummary ?? {}
  const attemptRemediationActions = Array.isArray(
    blockerEvidence.credentialConfirmedAttemptRemediationActions,
  )
    ? blockerEvidence.credentialConfirmedAttemptRemediationActions
    : []

  return failureSummaryTotal(currentFailureSummary) === 0 &&
    failureSummaryTotal(attemptFailureSummary) > 0
    ? `Preserved credential-confirmed full-capability attempt remains historical remediation context: \`capabilityFailureSummary.total = ${failureSummaryTotal(attemptFailureSummary)}\`, \`affectedCapabilities\` = \`${affectedCapabilitiesText(attemptFailureSummary) || 'none'}\`, \`routeHealthBlockers\` = \`${routeHealthBlockerText(attemptFailureSummary) || 'none'}\`, \`credentialConfirmedAttemptRemediationActions = ${attemptRemediationActions.length}\`; rerun \`pnpm run drill:live-provider\` on the current source before claiming release evidence.`
    : ''
}

function liveProviderFullRemediationTargetText(hint = {}) {
  const capability =
    typeof hint.capability === 'string' && hint.capability.trim() !== ''
      ? hint.capability.trim()
      : 'unknown'
  const endpointPath =
    typeof hint.endpointPath === 'string' && hint.endpointPath.trim() !== ''
      ? hint.endpointPath.trim()
      : 'unknown'
  const owner =
    typeof hint.owner === 'string' && hint.owner.trim() !== ''
      ? hint.owner.trim()
      : 'unknown'
  const status = Number.isInteger(hint.status) ? `HTTP ${hint.status}` : 'no-status'
  const failureKind =
    typeof hint.failureKind === 'string' && hint.failureKind.trim() !== ''
      ? hint.failureKind.trim()
      : 'unknown'
  const fallback =
    typeof hint.fallbackRoute === 'string' && hint.fallbackRoute.trim() !== ''
      ? `; fallback ${hint.fallbackRoute.trim()} ${Number.isInteger(hint.fallbackStatus) ? `HTTP ${hint.fallbackStatus}` : 'no-status'} ${typeof hint.fallbackFailureKind === 'string' && hint.fallbackFailureKind.trim() !== '' ? hint.fallbackFailureKind.trim() : 'unknown'}`
      : ''

  return `${capability} ${endpointPath} ${owner} ${status} ${failureKind}${fallback}`
}

function liveProviderFullRequiredRemediationLine(blockerEvidence = {}) {
  const currentSummary = blockerEvidence.capabilityFailureSummary ?? {}
  const attemptSummary =
    blockerEvidence.credentialConfirmedAttemptReport?.capabilityFailureSummary ?? {}
  const currentHints = Array.isArray(blockerEvidence.capabilityRemediationHints)
    ? blockerEvidence.capabilityRemediationHints
    : []
  const attemptHints = Array.isArray(
    blockerEvidence.credentialConfirmedAttemptReport?.capabilityRemediationHints,
  )
    ? blockerEvidence.credentialConfirmedAttemptReport.capabilityRemediationHints
    : []
  const hints = currentHints.length ? currentHints : attemptHints
  const summary = failureSummaryTotal(currentSummary) > 0 ? currentSummary : attemptSummary
  const source = currentHints.length
    ? 'current-selected-report'
    : attemptHints.length
      ? 'credential-confirmed-attempt-context'
      : 'none'
  const reportRemediationHints = Array.isArray(blockerEvidence.reportRemediationHints)
    ? blockerEvidence.reportRemediationHints
    : []

  return `Live provider full-capability required remediation: source \`${source}\`; capabilityFailureSummary.total ${failureSummaryTotal(summary)}; affectedCapabilities ${inlineCodeList(summary.affectedCapabilities)}; routeHealthBlockers ${inlineCodeList(summary.routeHealthBlockers)}; capabilityRemediationHintCount ${hints.length}; reportRemediationHintCount ${reportRemediationHints.length}; remediationTargets ${inlineCodeList(hints.map(liveProviderFullRemediationTargetText))}; rerunCommands \`pnpm run drill:live-provider\` / \`pnpm run check:live-provider-report\` / \`pnpm run check:live-provider-full-capability\`.`
}

function liveProviderSourceBindingLine(blockerEvidence = {}) {
  return liveProviderSourceBindingLineFromBlockerEvidence(blockerEvidence)
}

function hasCredentialConfirmedLiveProviderAttempt(blockerEvidence = {}) {
  const attemptReport = blockerEvidence.credentialConfirmedAttemptReport ?? {}
  const selectedSource = blockerEvidence.selectedSourceReport ?? {}

  return (
    blockerEvidence.hasCredentialConfirmedProviderAttempt === true ||
    attemptReport.hasCredentialConfirmedProviderAttempt === true ||
    selectedSource.hasCredentialConfirmedProviderAttempt === true
  )
}

function liveProviderFullReportLabel(blockerEvidence = {}) {
  return hasCredentialConfirmedLiveProviderAttempt(blockerEvidence)
    ? 'Live provider credential-confirmed full-capability attempt'
    : 'Live provider canonical full-current diagnostic'
}

function assertLiveProviderFullReportLabelSelfTest() {
  const diagnosticOnlyLabel = liveProviderFullReportLabel({
    credentialConfirmedAttemptReport: null,
    hasCredentialConfirmedProviderAttempt: false,
    selectedSourceReport: {
      hasCredentialConfirmedProviderAttempt: false,
    },
  })

  if (
    diagnosticOnlyLabel !== 'Live provider canonical full-current diagnostic' ||
    diagnosticOnlyLabel.includes('credential-confirmed')
  ) {
    throw new Error(
      'Current evidence handoff self-test mislabeled a no-credential live-provider diagnostic as credential-confirmed.',
    )
  }

  const credentialConfirmedLabel = liveProviderFullReportLabel({
    credentialConfirmedAttemptReport: {
      hasCredentialConfirmedProviderAttempt: true,
    },
  })

  if (
    credentialConfirmedLabel !==
    'Live provider credential-confirmed full-capability attempt'
  ) {
    throw new Error(
      'Current evidence handoff self-test failed to label a credential-confirmed live-provider attempt.',
    )
  }
}

function liveProviderRouteBoundaryLine(blockerEvidence = {}) {
  const boundary = blockerEvidence.routeRemediationBoundary ?? {}
  const paths = Array.isArray(boundary.workerProxyActionPaths)
    ? boundary.workerProxyActionPaths
        .filter(
          (item) =>
            item &&
            typeof item.action === 'string' &&
            typeof item.upstreamPath === 'string',
        )
        .map((item) => `${item.action}->${item.upstreamPath}`)
    : []

  if (
    boundary.owner !== 'external-provider-or-third-party-relay' ||
    paths.length === 0
  ) {
    return ''
  }

  return `Live-provider route remediation boundary: owner \`${boundary.owner}\`; ZeroChat Worker coverage \`${boundary.zeroChatWorkerCoverage ?? 'unknown'}\`, guarded by \`${boundary.verificationCommand ?? 'pnpm run check:security'}\`; Worker proxy action paths ${paths.map((item) => `\`${item}\``).join(', ')}. Third-party relay/provider 404/503 route or service failures remain external remediation and cannot be counted as ZeroChat release evidence.`
}

function boolText(value) {
  return value === true ? 'true' : 'false'
}

function countText(value) {
  return Number.isInteger(value) && value >= 0 ? formatBytes(value) : 'unknown'
}

function hostedNativeCiDiagnostics(evidence) {
  return (
    evidence.hostedNativeCi.json.localHandoffDiagnostics ??
    releaseBlockerById(evidence, 'hosted-native-ci-release-evidence')?.evidence
      ?.localHandoffDiagnostics ??
    {}
  )
}

function hostedNativeCiCoverageText(hostedDiagnostics = {}) {
  return `current-source coverage \`gitWorktreeDirty: ${boolText(hostedDiagnostics.gitWorktreeDirty)}\`, \`nativeSourceWorktreeDirty: ${boolText(hostedDiagnostics.nativeSourceWorktreeDirty)}\`, \`gitStatusEntryCount: ${countText(hostedDiagnostics.gitStatusEntryCount)}\`, \`nativeSourceStatusEntryCount: ${countText(hostedDiagnostics.nativeSourceStatusEntryCount)}\`, \`hostedCiCoversCurrentWorktree: ${boolText(hostedDiagnostics.hostedCiCoversCurrentWorktree)}\`, \`hostedCiCoversCurrentNativeSource: ${boolText(hostedDiagnostics.hostedCiCoversCurrentNativeSource)}\`, \`releaseEvidenceHandoffReady: ${boolText(hostedDiagnostics.releaseEvidenceHandoffReady)}\``
}

function inlineCodeList(values) {
  const items = Array.isArray(values)
    ? values.filter((item) => typeof item === 'string' && item.trim() !== '')
    : []
  return items.length ? items.map((item) => `\`${item}\``).join(' / ') : '`none`'
}

function targetHostRuntimeEvidenceText(label, blocker) {
  const blockerEvidence = blocker?.evidence ?? {}
  const runtimeEvidence = blockerEvidence.targetHostRuntimeEvidence ?? {}
  const required =
    blockerEvidence.targetRuntimeEvidenceRequired === true ||
    runtimeEvidence.required === true
  const targetHost =
    typeof runtimeEvidence.targetHost === 'string' && runtimeEvidence.targetHost.trim() !== ''
      ? runtimeEvidence.targetHost
      : 'unknown'
  const deferredText = Array.isArray(runtimeEvidence.deferredTargetChecks) &&
    runtimeEvidence.deferredTargetChecks.length
    ? `; deferredTargetChecks ${inlineCodeList(runtimeEvidence.deferredTargetChecks)}`
    : ''

  return `${label} target-host runtime evidence: targetRuntimeEvidenceRequired ${boolText(required)}; targetHost \`${targetHost}\`; currentHostSatisfiesTargetRuntime ${boolText(runtimeEvidence.currentHostSatisfiesTargetRuntime)}; localPreflightIsRuntimeEvidence ${boolText(runtimeEvidence.localPreflightIsRuntimeEvidence)}; runtimeQaMustRunOnTargetHost ${boolText(runtimeEvidence.runtimeQaMustRunOnTargetHost)}; requiredHostTools ${inlineCodeList(runtimeEvidence.requiredHostTools)}${deferredText}; requiredProof ${inlineCodeList(runtimeEvidence.requiredProof)}.`
}

function liveSyncReleasePassInputBindingLine(blocker) {
  const blockerEvidence = blocker?.evidence ?? {}
  const sourceFingerprint = blockerEvidence.sourceFingerprint ?? {}
  const fileCount = Number.isInteger(sourceFingerprint.fileCount)
    ? sourceFingerprint.fileCount
    : 'unknown'
  const totalBytes = Number.isInteger(sourceFingerprint.totalBytes)
    ? formatBytes(sourceFingerprint.totalBytes)
    : 'unknown'

  return `Live sync release-pass input binding: blockerKind \`${blockerEvidence.blockerKind ?? 'unknown'}\`; mode \`${blockerEvidence.mode ?? 'none'}\`; remoteTouched ${boolText(blockerEvidence.remoteTouched)}; missingInputKeys ${inlineCodeList(blockerEvidence.missingInputKeys)}; supportedModes ${inlineCodeList(blockerEvidence.supportedModes)}; sourceFingerprint.current ${boolText(sourceFingerprint.current)}, ${fileCount} files / ${totalBytes} bytes / SHA-256 \`${sourceFingerprint.sha256 ?? 'unknown'}\`.`
}

function liveSyncCanonicalReleaseEvidenceLine(evidence, blocker) {
  const releasePass = evidence.liveSyncReleasePass
  const diagnostic = evidence.liveSync
  const report = releasePass.json ?? {}
  const sourceFingerprint = report.sourceFingerprint ?? {}
  const diagnosticSourceFingerprint = diagnostic.json.sourceFingerprint ?? {}
  const sourceFingerprintMatchesCurrentDiagnostic =
    typeof sourceFingerprint.sha256 === 'string' &&
    sourceFingerprint.sha256 === diagnosticSourceFingerprint.sha256 &&
    sourceFingerprint.fileCount === diagnosticSourceFingerprint.fileCount &&
    sourceFingerprint.totalBytes === diagnosticSourceFingerprint.totalBytes
  const canonicalPassed =
    blocker == null &&
    releasePass.missing !== true &&
    report.status === 'passed' &&
    report.passed === true &&
    report.releaseEvidence === true &&
    report.safeToPublish === true &&
    report.evidenceType === 'release-pass' &&
    sourceFingerprintMatchesCurrentDiagnostic

  if (canonicalPassed) {
    return `Live sync canonical release pass: \`${releasePass.path}\` is passed current-source release evidence (${formatBytes(releasePass.bytes)} bytes / SHA-256 \`${releasePass.sha256}\`); sourceFingerprint ${sourceFingerprint.fileCount ?? 'unknown'} files / ${typeof sourceFingerprint.totalBytes === 'number' ? formatBytes(sourceFingerprint.totalBytes) : 'unknown'} bytes / SHA-256 \`${sourceFingerprint.sha256 ?? 'unknown'}\`. The later sanitized no-credential diagnostic \`${diagnostic.path}\` (status \`${diagnostic.json.status ?? 'unknown'}\`, releaseEvidence ${diagnostic.json.releaseEvidence === true ? 'true' : 'false'}, SHA-256 \`${diagnostic.sha256}\`) is separate and does not reopen this current canonical release pass.`
  }

  return `Live sync canonical release pass is missing or not current-passed at \`${releasePass.path}\` (status \`${report.status ?? 'missing'}\`, releaseEvidence ${report.releaseEvidence === true ? 'true' : 'false'}, SHA-256 \`${releasePass.sha256}\`); the current sanitized diagnostic is \`${diagnostic.path}\` (status \`${diagnostic.json.status ?? 'unknown'}\`, SHA-256 \`${diagnostic.sha256}\`).${blocker ? ` ${liveSyncReleasePassInputBindingLine(blocker)}` : ''}`
}

function verifyCheckpointLabel(evidence) {
  const requestedMode = evidence.verifyReleaseCheckpoint.json.requestedMode ?? {}

  if (requestedMode.webLocal === true && requestedMode.release !== true) {
    return 'Focused Web-local verifier checkpoint'
  }

  if (requestedMode.release === true || requestedMode.allPlatforms === true) {
    return 'Current full release verifier checkpoint'
  }

  return 'Current verifier checkpoint'
}

function currentWindowsTrustedMsixRuntimeQaLine(evidence) {
  const preflight = evidence.windowsHostPreflight.json ?? {}
  return `Windows trusted MSIX install/update/uninstall 当前 runtime QA：当前 host 状态以 \`.manual-qa/windows-msix-host-preflight.json\` 为准（status: \`${preflight.status ?? 'unknown'}\`, hostReadyForTrustedMsix: ${preflight.hostReadyForTrustedMsix === true ? 'true' : 'false'}, currentShellElevated: ${preflight.currentShellElevated === true ? 'true' : 'false'}）。`
}

const currentProductContractMarkerStrings = Object.freeze([
  'QA marker: Current verify-release metadata is validated from the checkpoint report, never a hard-coded digest.',
  ...new Set([
    ...currentWebAppShellContractMarkers.requirementsDoc,
    ...currentWebAppShellContractMarkers.qaAudit,
  ]),
])

const currentLiveSyncContractMarkerStrings = Object.freeze([
  'QA marker: Live-sync drill CLI help and invalid arguments cannot write reports or touch remote storage.',
  'QA marker: Live-sync release evidence rejects ephemeral tunnel endpoints.',
])

const currentGeneratedContractMarkerStrings = Object.freeze([
  ...currentProductContractMarkerStrings,
  ...currentLiveSyncContractMarkerStrings,
])

function currentWebAppShellContractSection(markers) {
  return [
    'Current product contract / QA markers:',
    '',
    'QA marker: Current verify-release metadata is validated from the checkpoint report, never a hard-coded digest.',
    ...markers.map((marker) => `- ${marker}`),
    '',
    'Current live-sync safety contract:',
    '',
    '- QA marker: Live-sync drill CLI help and invalid arguments cannot write reports or touch remote storage.',
    '- QA marker: Live-sync release evidence rejects ephemeral tunnel endpoints.',
    '- Live sync release drill rejects invalid CLI arguments before environment-driven report or remote behavior.',
    '- Live sync release-pass drill-name uniqueness guard rejects an epoch-millisecond suffix error before release evidence is accepted.',
    '- A passing live sync release drill report is the only release evidence; diagnostic reports retain requiredInputs, missingInputKeys, and releaseBlockerSummary.',
  ]
}

function currentLiveProviderSafetyContractSection() {
  return [
    '',
    'Current live-provider API/UI smoke safety contract:',
    '',
    '- Temporary provider API and UI smoke must normalize known endpoint-suffixed Base URLs, require minimal streaming `ZeroChat OK` proof, and retain redacted per-candidate status summaries.',
    '- Browser-origin UI smoke records `assistant-marker` and `ZC_LIVE_UI_PASS_`, uses `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL` when a browser-allowed relay is required, and fails quickly with visible-page diagnostics.',
    '- Low-cost embedding/moderation capability smoke is also separately confirmed.',
    '- Audio speech/transcription round-trip smoke is separately confirmed.',
    '- Current browser-origin artifacts include `web-live-ui-provider-smoke.png`, `web-live-ui-provider-smoke-current.png`, and `web-live-ui-provider-smoke-current-relay.png`; live provider UI screenshots are checked by `check:live-provider-ui-screenshot`.',
    '- Live provider full-capability current source fingerprint guard and Live provider diagnostic current source fingerprint guard bind sanitized evidence to the current source tree.',
    '- Live provider API smoke report artifact is sanitized before validation or upload; sourceFingerprint and model-selection source evidence remain current-source bound.',
  ]
}

function stripCurrentProductContractMarkers(text) {
  return normalizeGeneratedDocumentText(
    currentGeneratedContractMarkerStrings.reduce(
      (source, marker) => source.replaceAll(marker, ''),
      text,
    ),
  )
}

function normalizeGeneratedDocumentText(text) {
  return text.replace(/[ \t]+(?=\r?$)/gmu, '')
}

function buildRequirementsOverlayVerbose(evidence) {
  const releaseDiagnosticsTime = asiaShanghaiDateTime(
    generatedAtOf(evidence.releaseDiagnostics.json),
  )
  const verifyFailedLabels = Array.isArray(evidence.verifyReleaseCheckpoint.json.failedStepLabels)
    ? evidence.verifyReleaseCheckpoint.json.failedStepLabels
    : []
  const verifyFailureDetail = verifyReleaseFailureDetailLine(evidence)
  const nativeTime = asiaShanghaiDateTime(generatedAtOf(evidence.nativePrereq.json))
  const liveSyncTime = asiaShanghaiDateTime(generatedAtOf(evidence.liveSync.json))
  const hostedTime = asiaShanghaiDateTime(generatedAtOf(evidence.hostedNativeCi.json))
  const liveProviderDiagnosticTime = asiaShanghaiDateTime(
    generatedAtOf(evidence.liveProviderDiagnostic.json),
  )
  const nativeFingerprint = evidence.nativePrereq.json.sourceFingerprint ?? {}
  const liveSyncFingerprint = evidence.liveSync.json.sourceFingerprint ?? {}
  const liveProviderFingerprint = evidence.liveProviderDiagnostic.json.sourceFingerprint ?? {}
  const liveProviderUiFingerprint = liveProviderUiSourceFingerprint(evidence)
  const webSource = evidence.webCurrentPage.json.webSource ?? {}
  const visualAudit = evidence.webCurrentPage.json.visualAudit ?? {}
  const webQaTime = asiaShanghaiDateTime(generatedAtOf(evidence.webCurrentPage.json))
  const webScreenshotCount = visualAudit.screenshotCount ?? visualAudit.expectedScreenshotCount
  const webExpectedScreenshotCount = visualAudit.expectedScreenshotCount ?? webScreenshotCount
  const androidRuntimeLine = androidRuntimeEvidenceLine(evidence)
  const hostedDiagnostics = hostedNativeCiDiagnostics(evidence)
  const liveSyncBlocker = releaseBlockerById(
    evidence,
    'disposable-live-sync-release-pass',
  )
  const appleTargetRuntimeEvidence = targetHostRuntimeEvidenceText(
    'Apple',
    releaseBlockerById(evidence, 'apple-target-runtime-qa'),
  )
  const linuxTargetRuntimeEvidence = targetHostRuntimeEvidenceText(
    'Linux',
    releaseBlockerById(evidence, 'linux-target-runtime-qa'),
  )
  const liveProviderBlocker = releaseBlockerById(
    evidence,
    'live-provider-full-capability-release-evidence',
  )
  const liveProviderBlockerEvidence = liveProviderBlocker?.evidence ?? {}
  const liveProviderFailureSummary =
    liveProviderBlockerEvidence.capabilityFailureSummary ?? {}
  const liveProviderHistoricalAttemptContext =
    liveProviderHistoricalAttemptContextLine(liveProviderBlockerEvidence)
  const windowsBlocker = releaseBlockerById(evidence, 'windows-trusted-msix-release-pass')
  const trustedMsixPass = evidence.windowsTrustedMsixPass.json ?? {}
  const currentMsix = windowsBlocker?.evidence?.currentMsixPackageCandidate
  const currentDistWebAssets =
    windowsBlocker?.evidence?.currentDistWebAssets ??
    currentMsix?.stageWebAssets ??
    trustedMsixPass.distWebAssets ??
    {}
  const msixSummary =
    !windowsBlocker
      ? `${windowsTrustedMsixCurrentReleasePassLine(evidence)} `
      : currentMsix?.path && currentMsix?.sha256
      ? `current MSIX package-candidate \`${currentMsix.path}\` 为 ${formatBytes(currentMsix.bytes)} bytes / SHA-256 \`${currentMsix.sha256}\`，staged web tree 与当前 \`dist\` 匹配 ${currentMsix.stageWebAssets?.fileCount ?? 'unknown'} files / ${typeof currentMsix.stageWebAssets?.totalBytes === 'number' ? formatBytes(currentMsix.stageWebAssets.totalBytes) : 'unknown'} bytes / SHA-256 \`${currentMsix.stageWebAssets?.sha256 ?? 'unknown'}\`；package-internal web tree 与当前 \`dist\` 及 staged web tree 匹配 ${currentMsix.packageWebAssets?.fileCount ?? 'unknown'} files / ${typeof currentMsix.packageWebAssets?.totalBytes === 'number' ? formatBytes(currentMsix.packageWebAssets.totalBytes) : 'unknown'} bytes / SHA-256 \`${currentMsix.packageWebAssets?.sha256 ?? 'unknown'}\`，packageWebMatchesDist: ${currentMsix.packageWebMatchesDist === true ? 'true' : 'false'}，packageWebMatchesStage: ${currentMsix.packageWebMatchesStage === true ? 'true' : 'false'}；该 package-candidate 只是 packaging freshness evidence，不是 trusted install/update/uninstall release evidence。`
      : 'current MSIX package-candidate 未在 release-blocker summary 中报告；不能作为 trusted install/update/uninstall release evidence。'
  const windowsRuntimeQaEvidence = windowsBlocker
    ? `当前 \`.manual-qa/ZeroChat_0.0.1.0_x64.msix\` package-candidate 为 ${currentMsix?.bytes ? formatBytes(currentMsix.bytes) : 'unknown'} bytes / SHA-256 \`${currentMsix?.sha256 ?? 'unknown'}\`，staged \`web\` tree 与当前 \`dist\` 匹配 ${currentMsix?.stageWebAssets?.fileCount ?? 'unknown'} files / ${typeof currentMsix?.stageWebAssets?.totalBytes === 'number' ? formatBytes(currentMsix.stageWebAssets.totalBytes) : 'unknown'} bytes / SHA-256 \`${currentMsix?.stageWebAssets?.sha256 ?? 'unknown'}\`，stageWebMatchesDist: ${currentMsix?.stageWebMatchesDist === true ? 'true' : 'false'}；package-internal \`web\` tree 匹配当前 \`dist\` 与 staged \`web\` tree ${currentMsix?.packageWebAssets?.fileCount ?? 'unknown'} files / ${typeof currentMsix?.packageWebAssets?.totalBytes === 'number' ? formatBytes(currentMsix.packageWebAssets.totalBytes) : 'unknown'} bytes / SHA-256 \`${currentMsix?.packageWebAssets?.sha256 ?? 'unknown'}\`，packageWebMatchesDist: ${currentMsix?.packageWebMatchesDist === true ? 'true' : 'false'}，packageWebMatchesStage: ${currentMsix?.packageWebMatchesStage === true ? 'true' : 'false'}；Windows trusted MSIX host readiness \`${evidence.windowsHostPreflight.json.trustedMsixQaReadiness ?? 'unknown'}\``
    : windowsTrustedMsixCurrentReleasePassLine(evidence)
  const historicalLiveSyncMilestoneLine =
    '- [x] Disposable live sync release-pass（历史 source-bound 证据；当前 source fingerprint/输入刷新未通过，不代表当前 release blocker 已关闭。）'
  const routeHealthBlockers = routeHealthBlockerText(liveProviderFailureSummary)
  const affectedCapabilities = affectedCapabilitiesText(liveProviderFailureSummary)
  const liveProviderHistoricalAttemptText = liveProviderHistoricalAttemptContext
    ? ` ${liveProviderHistoricalAttemptContext}`
    : ''
  const liveProviderRouteBoundaryText = liveProviderRouteBoundaryLine(
    liveProviderBlockerEvidence,
  )
  const liveProviderRouteBoundaryMarkerText = liveProviderRouteBoundaryText
    ? ` ${liveProviderRouteBoundaryText}`
    : ''
  const liveProviderFullHashLabel = liveProviderFullReportLabel(liveProviderBlockerEvidence)
  const ownershipMatrixLine = releaseBlockerOwnershipMatrixLine(evidence)
  const aggregateChildSafetyLine = aggregateDiagnosticChildSafetyLine(evidence)
  const windowsTrustedCurrentBlockerMarkerText =
    windowsBlocker
      ? `Windows trusted MSIX 当前 blocker 语义：${windowsTrustedMsixCurrentBlockerLine(evidence)} Historical trusted-MSIX AppX deployment-service cleanup failure is preserved diagnostic context only, not the current blocker；`
      : `${windowsTrustedMsixCurrentReleasePassLine(evidence)} Historical trusted-MSIX AppX deployment-service cleanup failure is preserved diagnostic context only and does not reopen the current pass；`
  const liveProviderDiagnosticStatus =
    evidence.liveProviderDiagnostic.json.status ?? 'unknown'
  const liveProviderDiagnosticEvidenceType =
    evidence.liveProviderDiagnostic.json.evidenceType ?? 'diagnostic'
  const liveProviderDiagnosticReleaseEvidence =
    evidence.liveProviderDiagnostic.json.releaseEvidence === true ? 'true' : 'false'
  const liveProviderDiagnosticHandoffLine = [
    `当前 ${liveProviderDiagnosticTime} aggregate handoff 引用 \`.manual-qa/live-provider-smoke-current-diagnostic.json\`；该报告为 \`status: "${liveProviderDiagnosticStatus}"\`、\`evidenceType: "${liveProviderDiagnosticEvidenceType}"\`、\`releaseEvidence: ${liveProviderDiagnosticReleaseEvidence}\`（${formatBytes(evidence.liveProviderDiagnostic.bytes)} bytes / SHA-256 \`${evidence.liveProviderDiagnostic.sha256}\`，generatedAt \`${generatedAtOf(evidence.liveProviderDiagnostic.json)}\`）；`,
    `repeatable diagnostic command 为 \`pnpm run report:live-provider-diagnostic\`，artifact path 为 \`.manual-qa/live-provider-smoke-current-diagnostic.json\`；无 provider env 会生成 skipped diagnostic，带临时 provider env 才能复核真实能力失败；`,
    `skipped/failed/passed provider reports 都带 \`sourceFingerprint\`（${liveProviderFingerprint.fileCount ?? 'unknown'} files / ${typeof liveProviderFingerprint.totalBytes === 'number' ? formatBytes(liveProviderFingerprint.totalBytes) : 'unknown'} bytes / SHA-256 \`${liveProviderFingerprint.sha256 ?? 'unknown'}\`）。`,
  ].join('')
  const releaseBlockerChecklist = releaseBlockerChecklistLines(evidence.releaseBlockers)
  const liveSyncDiagnosticHandoffLine = [
    `当前 ${liveSyncTime || 'unknown time'} sanitized no-credential diagnostic: ${paths.liveSyncDiagnostic}; status ${evidence.liveSync.json.status ?? 'unknown'}; remoteTouched ${boolText(evidence.liveSync.json.remoteTouched)}; releaseEvidence ${evidence.liveSync.json.releaseEvidence === true ? 'true' : 'false'}; sourceFingerprint ${liveSyncFingerprint.fileCount ?? 'unknown'} files / ${typeof liveSyncFingerprint.totalBytes === 'number' ? formatBytes(liveSyncFingerprint.totalBytes) : 'unknown'} bytes / SHA-256 ${liveSyncFingerprint.sha256 ?? 'unknown'}.`,
    ' Drill command pnpm run drill:live-sync and validation commands pnpm run check:live-sync-report / pnpm run check:live-sync-release-pass remain distinct.',
    ` ${liveSyncCanonicalReleaseEvidenceLine(evidence, liveSyncBlocker)}`,
  ].join('')
  const liveSyncDiagnosticStalePattern =
    /当前 [^。]* sanitized no-mode diagnostic[\s\S]*?仍不能替代 passed-only live-sync release gate。(?:Live sync release-pass input binding:[^。]*\.)? 当前 /u
  const liveProviderUiEvidencePassed = liveProviderUiEvidenceState(evidence).passed
  const passedLiveProviderUiEvidenceLine =
    '- [x] 当前 live-provider UI browser-origin 证据语义：current-source browser-origin release evidence is passed；browserOriginProven true、browserMessageSent true、markerCaptured true，且 browserProviderKeyInjected false。'

  let overlay = [
    `## 当前发布证据覆盖层（${releaseDiagnosticsTime || 'unknown time'}）`,
    '',
    `- 注：PRD 只保留当前机器可读 handoff；逐次运行证据写入被忽略的 \`.manual-qa\` 或 Actions artifacts，不追加到 Git 跟踪文档。活跃 release blocker 交接以 ${releaseDiagnosticsTime || 'unknown time'} 的机器可读 handoff 为准。`,
    '',
    `- 当前机器可读 blocker handoff（${releaseDiagnosticsTime || 'unknown time'}）：\`D:\\Node.js\\pnpm.CMD run report:current-evidence\` 确认当前 sanitized handoff 来自 ${reportSummary('', evidence.releaseDiagnostics)}、${reportSummary('', evidence.releaseBlockers)}、${reportSummary('', evidence.verifyReleaseCheckpoint)}，failedStepLabels = [${verifyFailedLabels.map((label) => `\`${label}\``).join(', ')}]，${verifyFailureDetail} \`pnpm run check:verify-release-checkpoint\` 可复核，和 ${reportSummary('', evidence.strictPreflight)}。${aggregateChildSafetyLine} Aggregate diagnostic child hashes: Windows host preflight \`${evidence.windowsHostPreflight.sha256}\`; Hosted native CI \`${evidence.hostedNativeCi.sha256}\`; Live sync \`${evidence.liveSync.sha256}\`; Live provider ordinary API \`${evidence.liveProviderApi.sha256}\`; Live provider current diagnostic \`${evidence.liveProviderDiagnostic.sha256}\`; ${liveProviderFullHashLabel} \`${evidence.liveProviderFull.sha256}\`; Live provider UI current \`${evidence.liveProviderUi.sha256}\`; Live provider UI preserved attempt \`${evidence.liveProviderUiAttempt.sha256}\`; Native prereq \`${evidence.nativePrereq.sha256}\`。Web current-page QA 当前 ${asiaShanghaiDateTime(generatedAtOf(evidence.webCurrentPage.json))} 通过 ${webScreenshotCount ?? 'unknown'}/${webExpectedScreenshotCount ?? 'unknown'} screenshots，\`.manual-qa/web-current-page-qa.json\` 为 ${formatBytes(evidence.webCurrentPage.bytes)} bytes / SHA-256 \`${evidence.webCurrentPage.sha256}\`，Web source digest \`${webSource.digest ?? 'unknown'}\`，current-page visual manifest 为 ${formatBytes(evidence.webCurrentPageVisual.bytes)} bytes / SHA-256 \`${evidence.webCurrentPageVisual.sha256}\`，release visual manifest 为 ${formatBytes(evidence.releaseVisual.bytes)} bytes / SHA-256 \`${evidence.releaseVisual.sha256}\`。`,
    `- 当前 release blocker ownership matrix（${releaseDiagnosticsTime || 'unknown time'}）：${ownershipMatrixLine}`,
    `- 当前 Windows trusted MSIX ${windowsBlocker ? 'blocker' : 'release-pass'} 语义（${releaseDiagnosticsTime || 'unknown time'}）：${windowsBlocker ? windowsTrustedMsixCurrentBlockerLine(evidence) : windowsTrustedMsixCurrentReleasePassLine(evidence)}`,
    `- Live-sync evidence separation: ${liveSyncCanonicalReleaseEvidenceLine(evidence, liveSyncBlocker)}`,
    '',
    `- 各平台 runtime QA：Web current-page QA 当前 ${webQaTime} 通过 ${webScreenshotCount ?? 'unknown'}/${webExpectedScreenshotCount ?? 'unknown'} screenshots，\`.manual-qa/web-current-page-qa.json\` 为 ${formatBytes(evidence.webCurrentPage.bytes)} bytes / SHA-256 \`${evidence.webCurrentPage.sha256}\`，current-page visual manifest 为 ${formatBytes(evidence.webCurrentPageVisual.bytes)} bytes / SHA-256 \`${evidence.webCurrentPageVisual.sha256}\`，Web source digest \`${webSource.digest ?? 'unknown'}\`；${androidRuntimeLine}；Windows WebView runtime 当前匹配最新 \`dist\`（${currentDistWebAssets.fileCount ?? 'unknown'} files / \`${currentDistWebAssets.totalBytes ?? 'unknown'}\` bytes，\`webAssetsMatchDist: true\`）；${windowsRuntimeQaEvidence}；${appleTargetRuntimeEvidence} ${linuxTargetRuntimeEvidence}`,
    '',
    '### Release 阻塞残项',
    '',
    `- 注：PRD 只保留当前机器可读 handoff；逐次运行证据写入被忽略的 \`.manual-qa\` 或 Actions artifacts，不追加到 Git 跟踪文档。活跃 release blocker 交接以 ${releaseDiagnosticsTime || 'unknown time'} 的机器可读 handoff 为准。`,
    '',
    ...releaseBlockerChecklist,
    ...(liveProviderUiEvidencePassed ? [passedLiveProviderUiEvidenceLine] : []),
    '',
    '### 已完成源码里程碑（不替代当前 release blocker）',
    '',
    '- [x] 引入设计系统 token',
    '- [x] 引入 Zustand 状态管理',
    historicalLiveSyncMilestoneLine,
    '',
    `- 当前 release blocker 精确证据（${releaseDiagnosticsTime || 'unknown time'}）：当前 ${nativeTime} all-platform preflight 仍缺 Apple \`swift\` 与 \`xcodebuild\`；当前 ${nativeTime} all-platform preflight 仍缺 Linux runtime host；\`.manual-qa/native-prereq-all-platforms.json\` 为 ${formatBytes(evidence.nativePrereq.bytes)} bytes / SHA-256 \`${evidence.nativePrereq.sha256}\`，generatedAt \`${generatedAtOf(evidence.nativePrereq.json)}\`，sourceFingerprint with schema \`${nativeFingerprint.kind ?? 'zerochat.nativeSourceFingerprint.v1'}\`，native source fingerprint 覆盖 ${nativeFingerprint.fileCount ?? 'unknown'} files / ${typeof nativeFingerprint.totalBytes === 'number' ? formatBytes(nativeFingerprint.totalBytes) : 'unknown'} bytes，SHA-256 \`${nativeFingerprint.sha256 ?? 'unknown'}\`。${appleTargetRuntimeEvidence} ${linuxTargetRuntimeEvidence} 当前 ${liveSyncTime} sanitized no-mode diagnostic 仍为 \`status: "skipped"\`、\`remoteTouched: false\`、\`releaseEvidence: false\`，\`.manual-qa/live-sync-release-drill.json\` 为 ${formatBytes(evidence.liveSync.bytes)} bytes / SHA-256 \`${evidence.liveSync.sha256}\`，\`sourceFingerprint\`（${liveSyncFingerprint.fileCount ?? 'unknown'} files / ${typeof liveSyncFingerprint.totalBytes === 'number' ? formatBytes(liveSyncFingerprint.totalBytes) : 'unknown'} bytes / SHA-256 \`${liveSyncFingerprint.sha256 ?? 'unknown'}\`），drill command \`pnpm run drill:live-sync\`、validation commands \`pnpm run check:live-sync-report\` / \`pnpm run check:live-sync-release-pass\`，仍不能替代 passed-only live-sync release gate。${liveSyncReleasePassInputBindingLine(liveSyncBlocker)} 当前 ${hostedTime} \`.manual-qa/hosted-native-ci-evidence.json\` 只是 \`zerochat.hostedNativeCiEvidenceDiagnostic\` missing report（${formatBytes(evidence.hostedNativeCi.bytes)} bytes / SHA-256 \`${evidence.hostedNativeCi.sha256}\`，generatedAt \`${generatedAtOf(evidence.hostedNativeCi.json)}\`），不能替代真实 hosted native CI release evidence，safe alias set \`git-remote-origin\` / \`github-cli-gh\` / \`github-cli-auth\` / \`git-status-readable\` / \`native-source-status-readable\` / \`clean-git-worktree\` / \`clean-native-source-worktree\`，current missing aliases \`${(hostedDiagnostics.missingLocalPrerequisites ?? []).join('` / `') || 'none'}\`，\`githubCliAuthenticated: ${hostedDiagnostics.githubCliAuthenticated === true}\`，\`localArtifactFetchReady: ${hostedDiagnostics.localArtifactFetchReady === true}\`，${hostedNativeCiCoverageText(hostedDiagnostics)}。本机 ${liveProviderDiagnosticTime} \`pnpm run report:release-diagnostics\` 已刷新 \`.manual-qa/live-provider-smoke-current-diagnostic.json\`；当前 \`.manual-qa/live-provider-smoke-current-diagnostic.json\` 为 no-credential skipped diagnostic（${formatBytes(evidence.liveProviderDiagnostic.bytes)} bytes / SHA-256 \`${evidence.liveProviderDiagnostic.sha256}\`，generatedAt \`${generatedAtOf(evidence.liveProviderDiagnostic.json)}\`）；repeatable diagnostic command 为 \`pnpm run report:live-provider-diagnostic\`，artifact path 为 \`.manual-qa/live-provider-smoke-current-diagnostic.json\`；skipped/failed/passed provider reports 都带 \`sourceFingerprint\`（${liveProviderFingerprint.fileCount ?? 'unknown'} files / ${typeof liveProviderFingerprint.totalBytes === 'number' ? formatBytes(liveProviderFingerprint.totalBytes) : 'unknown'} bytes / SHA-256 \`${liveProviderFingerprint.sha256 ?? 'unknown'}\`）。\`.manual-qa/live-provider-smoke-full-current.json\` 仍是 canonical full-capability release-evidence path，当前为同一 fingerprint 下的 ${evidence.liveProviderFull.json.status ?? 'unknown'} diagnostic（${formatBytes(evidence.liveProviderFull.bytes)} bytes / SHA-256 \`${evidence.liveProviderFull.sha256}\`）；\`.manual-qa/release-blockers-current.json\` 同时引用 full-current 和 current-diagnostic，并在 \`currentDiagnosticReport\` 中记录 \`generatedAt: "${generatedAtOf(evidence.liveProviderDiagnostic.json)}"\` / \`status: "${evidence.liveProviderDiagnostic.json.status ?? 'unknown'}"\`。\`scripts/repository-health-check.mjs\` 与 \`scripts/completion-audit-check.mjs\` 现在守护 \`liveProviderDiagnostic\`、\`preferredLiveProviderBlockerSource\`、\`hasLiveProviderFullCapabilityAttempt\`、\`liveProviderReportHasCurrentSourceFingerprint\`、\`currentDiagnosticReport\`、\`sourceFingerprintCurrent\` 和当前 diagnostic timestamp。当前 \`.manual-qa/release-blockers-current.json\` 中 live-provider blocker 为 \`${liveProviderBlockerEvidence.blockerKind ?? 'unknown'}\`，selected chat \`${liveProviderBlockerEvidence.selectedCandidateModels?.chat ?? ''}\`、image \`${liveProviderBlockerEvidence.selectedCandidateModels?.image ?? ''}\`，\`capabilityFailureSummary.total = ${liveProviderFailureSummary.total ?? 0}\`，\`affectedCapabilities\` = \`${affectedCapabilities || 'none'}\`，\`routeHealthBlockers\` = \`${routeHealthBlockers || 'none'}\`. ${liveProviderSourceBindingLine(liveProviderBlockerEvidence)}${liveProviderRouteBoundaryMarkerText}${liveProviderHistoricalAttemptText} ${windowsTrustedCurrentBlockerMarkerText}\`.manual-qa/windows-msix-host-preflight.json\` 为 ${formatBytes(evidence.windowsHostPreflight.bytes)} bytes / SHA-256 \`${evidence.windowsHostPreflight.sha256}\`，${msixSummary}${residualReleaseBlockerIdsLine(evidence, '剩余 release blockers')}`,
    `- 当前 live-provider full-capability required remediation：${liveProviderFullRequiredRemediationLine(liveProviderBlockerEvidence)}`,
    `- 当前 live-provider UI browser-origin 证据语义：${liveProviderUiProxyPreflightLine(evidence)} ${liveProviderUiLocalProxyContractLine(evidence)} ${liveProviderUiSourceBindingLine(evidence)}`,
    `- 当前 live-provider UI required remediation：${liveProviderUiRequiredRemediationLine(evidence)}`,
    `- 当前 live-provider UI source fingerprint：${sourceFingerprintSummaryLine('Live-provider UI', liveProviderUiFingerprint, 'zerochat.liveProviderUiSourceFingerprint.v1')}`,
    '',
    '---',
  ].join('\n').replace(
    /本机 [^。]* `pnpm run report:release-diagnostics` 已刷新 `\.manual-qa\/live-provider-smoke-current-diagnostic\.json`；当前 `\.manual-qa\/live-provider-smoke-current-diagnostic\.json` 为 no-credential skipped diagnostic（[^。]*）；repeatable diagnostic command 为 `pnpm run report:live-provider-diagnostic`，artifact path 为 `\.manual-qa\/live-provider-smoke-current-diagnostic\.json`；skipped\/failed\/passed provider reports 都带 `sourceFingerprint`（[^。]*）。/u,
    liveProviderDiagnosticHandoffLine,
  )

  overlay = overlay.replace(
    liveSyncDiagnosticStalePattern,
    `${liveSyncDiagnosticHandoffLine} 当前 `,
  )

  if (
    liveProviderDiagnosticStatus !== 'skipped' &&
    overlay.includes('no-credential skipped diagnostic')
  ) {
    throw new Error(
      'Current evidence overlay must not describe a non-skipped live-provider diagnostic as no-credential skipped.',
    )
  }

  if (overlay.includes('sanitized no-mode diagnostic 仍为')) {
    throw new Error(
      'Current evidence overlay retained the legacy live-sync diagnostic wording.',
    )
  }

  assertRequirementsOverlayBlockerChecklist(overlay, evidence.releaseBlockers)

  return overlay
}

function buildRequirementsOverlay(evidence) {
  const releaseDiagnosticsTime = asiaShanghaiDateTime(
    generatedAtOf(evidence.releaseDiagnostics.json),
  )
  const blockerLines = releaseBlockerChecklistLines(evidence.releaseBlockers)
  const blockers = blockerIds(evidence.releaseBlockers)
  const webSource = evidence.webCurrentPage.json.webSource ?? {}
  const visualAudit = evidence.webCurrentPage.json.visualAudit ?? {}
  const currentDist = evidence.windowsHostPreflight.json.currentDistWebAssets ?? {}
  const nativeFingerprint = evidence.nativePrereq.json.sourceFingerprint ?? {}
  const liveSyncFingerprint = evidence.liveSync.json.sourceFingerprint ?? {}
  const liveProviderFingerprint = evidence.liveProviderDiagnostic.json.sourceFingerprint ?? {}
  const liveProviderBlocker = releaseBlockerById(
    evidence,
    'live-provider-full-capability-release-evidence',
  )
  const windowsBlocker = releaseBlockerById(
    evidence,
    'windows-trusted-msix-release-pass',
  )
  const uiPassed = liveProviderUiEvidenceState(evidence).passed
  const currentMsix = windowsBlocker?.evidence?.currentMsixPackageCandidate ?? {}
  const fragments = [
    `## 当前发布证据覆盖层（${releaseDiagnosticsTime || 'unknown time'}）`,
    '',
    '- 注：PRD 只保留当前机器可读 handoff；逐次运行证据写入被忽略的 `.manual-qa` 或 Actions artifacts，不追加到 Git 跟踪文档。',
    '',
    `- 当前 release diagnostics：${reportSummary('', evidence.releaseDiagnostics)}；release blockers：${reportSummary('', evidence.releaseBlockers)}；verify-release checkpoint：${reportSummary('', evidence.verifyReleaseCheckpoint)}。`,
    `- 当前 strict preflight：${reportSummary('', evidence.strictPreflight)}；Windows host preflight：${reportSummary('', evidence.windowsHostPreflight)}；Hosted native CI diagnostic：${reportSummary('', evidence.hostedNativeCi)}；native prerequisite：${reportSummary('', evidence.nativePrereq)}。`,
    `- 当前 Web QA：${asiaShanghaiDateTime(generatedAtOf(evidence.webCurrentPage.json))} 通过 ${visualAudit.screenshotCount ?? 'unknown'}/${visualAudit.expectedScreenshotCount ?? 'unknown'} screenshots；Web source digest \`${webSource.digest ?? 'unknown'}\`；current dist ${currentDist.fileCount ?? 'unknown'} files / ${currentDist.totalBytes ?? 'unknown'} bytes。`,
    `- 当前 blocker IDs (${blockers.length})：${blockers.map((id) => `\`${id}\``).join(', ')}。`,
    `- 当前 native source fingerprint：${nativeFingerprint.fileCount ?? 'unknown'} files / ${nativeFingerprint.totalBytes ?? 'unknown'} bytes / SHA-256 \`${nativeFingerprint.sha256 ?? 'unknown'}\`。`,
    `- 当前 live-sync diagnostic：${reportSummary('', evidence.liveSync)}；source fingerprint ${liveSyncFingerprint.fileCount ?? 'unknown'} files / ${liveSyncFingerprint.totalBytes ?? 'unknown'} bytes / SHA-256 \`${liveSyncFingerprint.sha256 ?? 'unknown'}\`；Drill command \`pnpm run drill:live-sync\` 与 validation commands \`pnpm run check:live-sync-report\` / \`pnpm run check:live-sync-release-pass\` 保持分离。`,
    `- 当前 live-provider diagnostic：${reportSummary('', evidence.liveProviderDiagnostic)}；source fingerprint ${liveProviderFingerprint.fileCount ?? 'unknown'} files / ${liveProviderFingerprint.totalBytes ?? 'unknown'} bytes / SHA-256 \`${liveProviderFingerprint.sha256 ?? 'unknown'}\`；Node-side preflight is not browser-origin release evidence。`,
    `- 当前 Windows trusted MSIX blocker 语义：${windowsBlocker ? windowsTrustedMsixCurrentBlockerLine(evidence) : windowsTrustedMsixCurrentReleasePassLine(evidence)}；Current host status is report-derived from \`.manual-qa/windows-msix-host-preflight.json\`，historical trusted-MSIX diagnostic evidence is preserved separately from current release evidence。`,
    `- ${currentWindowsTrustedMsixRuntimeQaLine(evidence)}`,
    '',
    ...currentWebAppShellContractSection(currentWebAppShellContractMarkers.requirementsDoc),
    liveProviderBlocker?.evidence
      ? `- 当前 live-provider full-capability source binding：${liveProviderSourceBindingLine(liveProviderBlocker.evidence)} ${liveProviderFullRequiredRemediationLine(liveProviderBlocker.evidence)}`
      : '- 当前 live-provider full-capability source binding is not reported.',
    `- 当前 live-provider UI browser-origin 证据语义：${liveProviderUiProxyPreflightLine(evidence)} ${liveProviderUiSourceBindingLine(evidence)} ${uiPassed ? 'browserOriginProven true, browserMessageSent true' : 'browserOriginProven false, browserMessageSent false'}。`,
    '',
    '### Release 阻塞残项',
    '',
    ...blockerLines,
    '',
    '---',
  ]
  return fragments.join('\n')
}

function buildQaCurrentOverlay(evidence) {
  const releaseDiagnosticsTime = asiaShanghaiDateTime(
    generatedAtOf(evidence.releaseDiagnostics.json),
  )
  const releaseBlockersTime = asiaShanghaiDateTime(generatedAtOf(evidence.releaseBlockers.json))
  const strictTime = asiaShanghaiDateTime(generatedAtOf(evidence.strictPreflight.json))
  const verifyTime = asiaShanghaiDateTime(generatedAtOf(evidence.verifyReleaseCheckpoint.json))
  const nativeTime = asiaShanghaiDateTime(generatedAtOf(evidence.nativePrereq.json))
  const liveSyncTime = asiaShanghaiDateTime(generatedAtOf(evidence.liveSync.json))
  const liveProviderDiagnosticTime = asiaShanghaiDateTime(
    generatedAtOf(evidence.liveProviderDiagnostic.json),
  )
  const hostedTime = asiaShanghaiDateTime(generatedAtOf(evidence.hostedNativeCi.json))
  const liveProviderFullTime = asiaShanghaiDateTime(generatedAtOf(evidence.liveProviderFull.json))
  const liveSyncBlocker = releaseBlockerById(
    evidence,
    'disposable-live-sync-release-pass',
  )
  const liveProviderBlocker = releaseBlockerById(
    evidence,
    'live-provider-full-capability-release-evidence',
  )
  const liveProviderRouteBoundaryText = liveProviderRouteBoundaryLine(
    liveProviderBlocker?.evidence ?? {},
  )
  const verifyFailedLabels = Array.isArray(evidence.verifyReleaseCheckpoint.json.failedStepLabels)
    ? evidence.verifyReleaseCheckpoint.json.failedStepLabels
    : []
  const verifyCheckpointKind = verifyCheckpointLabel(evidence)
  const verifyFailureDetail = verifyReleaseFailureDetailLine(evidence)
  const webSource = evidence.webCurrentPage.json.webSource ?? {}
  const androidRuntimeLine = androidRuntimeEvidenceLine(evidence)
  const liveSyncFingerprint = evidence.liveSync.json.sourceFingerprint ?? {}
  const liveProviderFingerprint = evidence.liveProviderDiagnostic.json.sourceFingerprint ?? {}
  const liveProviderUiFingerprint = liveProviderUiSourceFingerprint(evidence)
  const nativeFingerprint = evidence.nativePrereq.json.sourceFingerprint ?? {}
  const hostedDiagnostics = hostedNativeCiDiagnostics(evidence)
  const appleTargetRuntimeEvidence = targetHostRuntimeEvidenceText(
    'Apple',
    releaseBlockerById(evidence, 'apple-target-runtime-qa'),
  )
  const linuxTargetRuntimeEvidence = targetHostRuntimeEvidenceText(
    'Linux',
    releaseBlockerById(evidence, 'linux-target-runtime-qa'),
  )
  const webQaTime = asiaShanghaiDateTime(generatedAtOf(evidence.webCurrentPage.json))
  const windowsBlocker = releaseBlockerById(evidence, 'windows-trusted-msix-release-pass')
  const currentMsix = windowsBlocker?.evidence?.currentMsixPackageCandidate
  const ownershipMatrixLine = releaseBlockerOwnershipMatrixLine(evidence)
  const aggregateChildSafetyLine = aggregateDiagnosticChildSafetyLine(evidence)
  const runtimeArtifactExpectedBlocker =
    evidence.releaseDiagnostics.json.runtimeArtifactExpectedBlocker ?? {}
  const runtimeArtifactExpectedBlockerSummary =
    typeof runtimeArtifactExpectedBlocker.summary === 'string'
      ? runtimeArtifactExpectedBlocker.summary.trim()
      : ''
  const additionalRuntimeArtifactBlockerIds = Array.isArray(
    runtimeArtifactExpectedBlocker.additionalExpectedBlockers,
  )
    ? runtimeArtifactExpectedBlocker.additionalExpectedBlockers
        .map((blocker) => blocker?.id)
        .filter((id) => typeof id === 'string' && id.trim() !== '')
    : []
  const additionalRuntimeArtifactBlockerText = additionalRuntimeArtifactBlockerIds.length
    ? ` plus additional blocker(s) ${additionalRuntimeArtifactBlockerIds.map((id) => `\`${id}\``).join(', ')}`
    : ''
  const liveProviderFullHashLabel = liveProviderFullReportLabel(
    liveProviderBlocker?.evidence ?? {},
  )
  const currentDistWebAssets =
    windowsBlocker?.evidence?.currentDistWebAssets ??
    windowsBlocker?.evidence?.currentMsixPackageCandidate?.stageWebAssets ??
    evidence.windowsTrustedMsixPass.json?.distWebAssets ??
    {}
  const trustedFailure = evidence.windowsTrustedMsixFailure?.json ?? {}
  const trustedFailureDist = trustedFailure.distWebAssets ?? {}
  const blockerKind =
    trustedFailure.blockerClassification?.kind ??
    trustedFailure.blockerClassification ??
    'windows-appx-deployment-deleted-package-cleanup-access-denied'
  const trustedInstallState =
    evidence.windowsHostPreflight.json.status === 'clear'
      ? 'and now requires an elevated disposable-host trusted install/update rerun'
      : 'and trusted install/update was not rerun because host preflight is still blocked'
  const currentWindowsMsixFailureLine =
    `Windows trusted MSIX run \`${trustedFailure.runId ?? 'unknown'}\` remains the current host AppXDeploymentServer \`${trustedFailure.blockerClassification?.kind ?? blockerKind}\` diagnostic for the historical ${trustedFailureDist.fileCount ?? 'unknown'}-file \`${trustedFailureDist.totalBytes ?? 'unknown'}\`-byte \`dist\`, does not match the current ${currentDistWebAssets.fileCount ?? 'unknown'}-file \`${currentDistWebAssets.totalBytes ?? 'unknown'}\`-byte \`dist\`, ${trustedInstallState}`
  return [
    'Current diagnostic overlay: the latest aggregate diagnostic batch superseding',
    'older current-labelled diagnostic rows and the older long-form release-gates',
    `table row was generated on ${releaseDiagnosticsTime || 'unknown time'} by`,
    '`D:\\Node.js\\pnpm.CMD run report:release-diagnostics` and summarized by',
    '`D:\\Node.js\\pnpm.CMD run report:current-evidence` after the current Web,',
    'Windows WebView, MSIX package-candidate, and release blocker refresh.',
    `\`.manual-qa/release-diagnostics-current.json\` is ${formatBytes(evidence.releaseDiagnostics.bytes)} bytes / SHA-256`,
    `\`${evidence.releaseDiagnostics.sha256}\`, generatedAt \`${generatedAtOf(evidence.releaseDiagnostics.json)}\``,
    `(${releaseDiagnosticsTime || 'unknown time'}), status \`${evidence.releaseDiagnostics.json.status ?? 'unknown'}\`, releaseEvidence`,
    `${evidence.releaseDiagnostics.json.releaseEvidence === true ? 'true' : 'false'}. \`.manual-qa/release-blockers-current.json\` is ${formatBytes(evidence.releaseBlockers.bytes)} bytes / SHA-256`,
    `\`${evidence.releaseBlockers.sha256}\`, generatedAt \`${generatedAtOf(evidence.releaseBlockers.json)}\``,
    `(${releaseBlockersTime || 'unknown time'}), status \`${evidence.releaseBlockers.json.status ?? 'unknown'}\`, blockerCount \`${(evidence.releaseBlockers.json.blockers ?? []).length}\`.`,
    ownershipMatrixLine,
    `\`.manual-qa/verify-release-current.json\` is ${formatBytes(evidence.verifyReleaseCheckpoint.bytes)} bytes / SHA-256`,
    `\`${evidence.verifyReleaseCheckpoint.sha256}\`, generatedAt \`${generatedAtOf(evidence.verifyReleaseCheckpoint.json)}\``,
    `(${verifyTime || 'unknown time'}), status \`${evidence.verifyReleaseCheckpoint.json.status ?? 'unknown'}\`, failedStepLabels`,
    `[${verifyFailedLabels.map((label) => `\`${label}\``).join(', ')}], and remains reproducibly checked by`,
    '`pnpm run check:verify-release-checkpoint`.',
    verifyFailureDetail,
    windowsBlocker
      ? windowsTrustedMsixCurrentBlockerLine(evidence)
      : windowsTrustedMsixCurrentReleasePassLine(evidence),
    `\`.manual-qa/strict-release-preflight.json\` is ${formatBytes(evidence.strictPreflight.bytes)} bytes / SHA-256`,
    `\`${evidence.strictPreflight.sha256}\`, generatedAt \`${generatedAtOf(evidence.strictPreflight.json)}\``,
    `(${strictTime || 'unknown time'}), status \`${evidence.strictPreflight.json.status ?? 'unknown'}\`.`,
    aggregateChildSafetyLine,
    ...(runtimeArtifactExpectedBlockerSummary
      ? [
          `${runtimeArtifactExpectedBlocker.status === 'passed' ? 'Runtime artifact gate audit' : 'Expected red gate audit'}: runtimeArtifactExpectedBlocker.status = ${runtimeArtifactExpectedBlocker.status ?? 'unknown'}, actualExitCode = ${runtimeArtifactExpectedBlocker.actualExitCode ?? 'unknown'}, unexpectedBulletLineCount = ${runtimeArtifactExpectedBlocker.unexpectedBulletLineCount ?? 'unknown'}. ${runtimeArtifactExpectedBlockerSummary}`,
        ]
      : []),
    'Aggregate diagnostic child hashes: Windows host preflight',
    `\`${evidence.windowsHostPreflight.sha256}\`; Hosted native CI`,
    `Windows trusted MSIX current pass \`${evidence.windowsTrustedMsixPass.sha256}\`;`,
    `\`${evidence.hostedNativeCi.sha256}\`; Live sync canonical release pass`,
    `\`${evidence.liveSyncReleasePass.sha256}\`; Live sync current diagnostic \`${evidence.liveSync.sha256}\`;`,
    `Live provider ordinary API \`${evidence.liveProviderApi.sha256}\`;`,
    `Live provider current diagnostic \`${evidence.liveProviderDiagnostic.sha256}\`;`,
    `${liveProviderFullHashLabel} \`${evidence.liveProviderFull.sha256}\`;`,
    `Live provider UI current \`${evidence.liveProviderUi.sha256}\`;`,
    `Live provider UI preserved attempt \`${evidence.liveProviderUiAttempt.sha256}\`;`,
    `Native prereq \`${evidence.nativePrereq.sha256}\`.`,
    `Hosted native CI handoff coverage: ${hostedNativeCiCoverageText(hostedDiagnostics)}; current missing aliases \`${(hostedDiagnostics.missingLocalPrerequisites ?? []).join('` / `') || 'none'}\`.`,
    appleTargetRuntimeEvidence,
    linuxTargetRuntimeEvidence,
    liveSyncCanonicalReleaseEvidenceLine(evidence, liveSyncBlocker),
    liveProviderBlocker?.evidence
      ? liveProviderSourceBindingLine(liveProviderBlocker.evidence)
      : 'Live provider full-capability evidence source binding is not reported.',
    liveProviderFullRequiredRemediationLine(liveProviderBlocker?.evidence ?? {}),
    liveProviderUiProxyPreflightLine(evidence),
    liveProviderUiLocalProxyContractLine(evidence),
    liveProviderUiSourceBindingLine(evidence),
    liveProviderUiRequiredRemediationLine(evidence),
    windowsBlocker
      ? 'Current Web/Windows evidence: Web .opus MIME parity and Windows trusted MSIX host AppX blocker refresh remain diagnostic-only.'
      : 'Current Web/Windows evidence: Web .opus MIME parity and current-source Windows trusted MSIX install/update/uninstall runtime evidence pass.',
    `Web source digest\n  \`${webSource.digest ?? 'unknown'}\``,
    `Web current-page QA report hash \`${evidence.webCurrentPage.sha256}\`; current-page visual-audit manifest hash \`${evidence.webCurrentPageVisual.sha256}\`; release visual-audit manifest hash \`${evidence.releaseVisual.sha256}\`.`,
    androidRuntimeLine,
    `Current Web/Windows refresh recorded release-build \`dist/index.html\` SHA-256 \`${evidence.distIndex.sha256}\`.`,
    currentMsix
      ? `Current MSIX package-candidate \`${currentMsix.path}\` is ${formatBytes(currentMsix.bytes)} bytes / SHA-256 \`${currentMsix.sha256}\`; staged MSIX web tree matches current \`dist\` at ${currentMsix.stageWebAssets?.fileCount ?? 'unknown'} files / ${typeof currentMsix.stageWebAssets?.totalBytes === 'number' ? formatBytes(currentMsix.stageWebAssets.totalBytes) : 'unknown'} bytes / SHA-256 \`${currentMsix.stageWebAssets?.sha256 ?? 'unknown'}\`, stageWebMatchesDist: ${currentMsix.stageWebMatchesDist === true ? 'true' : 'false'}; package-internal web tree matches current \`dist\` and stage at ${currentMsix.packageWebAssets?.fileCount ?? 'unknown'} files / ${typeof currentMsix.packageWebAssets?.totalBytes === 'number' ? formatBytes(currentMsix.packageWebAssets.totalBytes) : 'unknown'} bytes / SHA-256 \`${currentMsix.packageWebAssets?.sha256 ?? 'unknown'}\`, packageWebMatchesDist: ${currentMsix.packageWebMatchesDist === true ? 'true' : 'false'}, packageWebMatchesStage: ${currentMsix.packageWebMatchesStage === true ? 'true' : 'false'}. This is package-candidate freshness only, not trusted install/update/uninstall release evidence.`
      : windowsTrustedMsixCurrentReleasePassLine(evidence),
    `Current Web QA timestamp: ${webQaTime || 'unknown time'}.`,
    `- ${currentWindowsTrustedMsixRuntimeQaLine(evidence)}`,
    '',
    ...currentWebAppShellContractSection(currentWebAppShellContractMarkers.qaAudit),
    ...currentLiveProviderSafetyContractSection(),
    'historical trusted MSIX diagnostic evidence is preserved separately from current release evidence.',
    currentWindowsMsixFailureLine,
    'current Windows MSIX same-bundle diagnostic evidence in `.manual-qa/windows-msix-current-trusted-install-update-qa.failure.json` remains report-derived and is not a trusted release pass.',
    'current trusted MSIX install/update/uninstall release-pass remains blocked by the host AppX cleanup diagnostic; releaseEvidence remains false.',
    'The current trusted MSIX self-signed install/update/uninstall attempt only produced `.manual-qa\\windows-msix-current-trusted-install-update-qa.failure.json` diagnostic evidence.',
    'The current trusted MSIX attempt is diagnostic-only failure evidence; it is not a trusted release pass.',
    'Current visual audit uses named scenarios from the generated manifest instead of historical screenshot indices.',
    '`audio-composer-mobile` and `audio-composer-micro-desktop`',
    '`src/i18n.ts` 的 `supportedLocales`',
    '.visual-audit/visual-audit-manifest.json',
    '.visual-audit/visual-audit-contact-sheet.jpg',
    'custom relay 不再复制首启专用字段',
    'Web/PWA src/app/store.ts owns the production Skill mutation boundary',
    'Web/PWA SettingsView.tsx owns the production Skill settings shell',
    'Web/PWA current store tests lock durable add/import/edit/delete and stale ref cleanup',
    'current trusted MSIX install/update/uninstall release-pass remains blocked',
    windowsBlocker
      ? `Windows trusted MSIX historical run \`${trustedFailure.runId ?? 'unknown'}\` remains stale-dist AppXDeploymentServer diagnostic context \`${blockerKind}\` for the historical ${trustedFailureDist.fileCount ?? 'unknown'}-file \`${trustedFailureDist.totalBytes ?? 'unknown'}\`-byte \`dist\`; it does not match the current ${currentDistWebAssets.fileCount ?? 'unknown'}-file \`${currentDistWebAssets.totalBytes ?? 'unknown'}\`-byte \`dist\`, and the current blocker is the missing elevated current-source trusted MSIX release-pass.`
      : `Windows trusted MSIX historical run \`${trustedFailure.runId ?? 'unknown'}\` remains diagnostic context only; current release-pass run \`${evidence.windowsTrustedMsixPass.json.runId ?? 'unknown'}\` supersedes it for the ${currentDistWebAssets.fileCount ?? 'unknown'}-file \`${currentDistWebAssets.totalBytes ?? 'unknown'}\`-byte \`dist\`.`,
    windowsBlocker
      ? `The current Web current-page refresh covers digest \`${webSource.digest ?? 'unknown'}\`, recorded by focused Web-local current-page QA, and the latest Windows WebView runtime evidence now targets the ${currentDistWebAssets.fileCount ?? 'unknown'}-file \`${currentDistWebAssets.totalBytes ?? 'unknown'}\`-byte \`dist\`; the full release gate currently stops at Runtime smoke artifacts on the Windows trusted MSIX blocker${additionalRuntimeArtifactBlockerText}.`
      : `The current Web current-page refresh covers digest \`${webSource.digest ?? 'unknown'}\`, and Windows WebView plus trusted MSIX runtime evidence both target the ${currentDistWebAssets.fileCount ?? 'unknown'}-file \`${currentDistWebAssets.totalBytes ?? 'unknown'}\`-byte \`dist\`; Windows no longer blocks the full release gate.`,
    `Windows trusted MSIX run \`${trustedFailure.runId ?? 'unknown'}\` is a host AppX deployment diagnostic, not release evidence. Report: \`${paths.windowsTrustedMsixFailure}\`, SHA-256 \`${evidence.windowsTrustedMsixFailure?.sha256 ?? 'unknown'}\`.`,
    ...(liveProviderRouteBoundaryText ? [liveProviderRouteBoundaryText] : []),
    sourceFingerprintSummaryLine(
      'Live-provider',
      liveProviderFingerprint,
      'zerochat.liveProviderSourceFingerprint.v1',
    ),
    sourceFingerprintSummaryLine(
      'Live-provider UI',
      liveProviderUiFingerprint,
      'zerochat.liveProviderUiSourceFingerprint.v1',
    ),
    `Live-sync source fingerprint schema \`${liveSyncFingerprint.kind ?? 'zerochat.liveSyncSourceFingerprint.v1'}\`; ${liveSyncFingerprint.fileCount ?? 'unknown'} files / ${typeof liveSyncFingerprint.totalBytes === 'number' ? formatBytes(liveSyncFingerprint.totalBytes) : 'unknown'} bytes; SHA-256 \`${liveSyncFingerprint.sha256 ?? 'unknown'}\`.`,
    `Native source fingerprint: ${nativeFingerprint.fileCount ?? 'unknown'} files / ${typeof nativeFingerprint.totalBytes === 'number' ? formatBytes(nativeFingerprint.totalBytes) : 'unknown'} bytes; SHA-256 \`${nativeFingerprint.sha256 ?? 'unknown'}\`.`,
    'Native README and platform docs now scope clear-cloud-data; copy guard rejects the old unqualified native clear-cloud-data wording, and Cloudflare remote-clear wording remains platform-scoped.',
    'Windows now uses the shared PWA Skill UI through WebView2; Linux now wires Skill settings and the shared snapshot store in source, while target-host runtime QA remains required.',
    `Current diagnostic timestamps: native prereq ${nativeTime || 'unknown time'};`,
    `live sync diagnostic ${liveSyncTime || 'unknown time'}; live provider diagnostic`,
    `${liveProviderDiagnosticTime || 'unknown time'}; hosted native CI diagnostic ${hostedTime || 'unknown time'}.`,
    'Completion verdict: not complete as an all-platform release because the',
    `current\n${liveProviderFullTime || 'unknown time'} live-provider full-current report is a ${evidence.liveProviderFull.json.status ?? 'unknown'}`,
    'full-capability diagnostic.',
    `${verifyCheckpointKind}: \`.manual-qa/verify-release-current.json\` was refreshed at ${verifyTime || 'unknown time'}`,
    `(\`${generatedAtOf(evidence.verifyReleaseCheckpoint.json)}\`), is ${formatBytes(evidence.verifyReleaseCheckpoint.bytes)} bytes / SHA-256`,
    `\`${evidence.verifyReleaseCheckpoint.sha256}\`, status \`${evidence.verifyReleaseCheckpoint.json.status ?? 'unknown'}\`, releaseEvidence ${evidence.verifyReleaseCheckpoint.json.releaseEvidence === true ? 'true' : 'false'}, failedStepLabels [${verifyFailedLabels.map((label) => `\`${label}\``).join(', ')}],`,
    `${verifyFailureDetail} It is rechecked by \`pnpm run check:verify-release-checkpoint\`.`,
  ].join('\n')
}

function buildMarkdown(evidence) {
  const releaseDiagnosticsTime = asiaShanghaiDateTime(
    generatedAtOf(evidence.releaseDiagnostics.json),
  )
  const ids = blockerIds(evidence.releaseBlockers)
  const hostedDiagnostics = hostedNativeCiDiagnostics(evidence)
  const hostedMissing = hostedDiagnostics?.missingLocalPrerequisites ?? []
  const hostedDiagnosticCommands = Array.isArray(
    hostedDiagnostics?.diagnosticCommands,
  )
    ? hostedDiagnostics.diagnosticCommands.filter(
        (command) => typeof command === 'string' && command.length > 0,
      )
    : []
  const liveSyncBlocker = evidence.releaseBlockers.json.blockers?.find(
    (blocker) => blocker.id === 'disposable-live-sync-release-pass',
  )
  const liveSyncBlockerFingerprint = liveSyncBlocker?.evidence?.sourceFingerprint
  const liveProviderFingerprint = evidence.liveProviderDiagnostic.json.sourceFingerprint ?? {}
  const liveProviderUiFingerprint = liveProviderUiSourceFingerprint(evidence)
  const androidRuntimeLine = androidRuntimeEvidenceLine(evidence)
  const liveProviderBlocker = evidence.releaseBlockers.json.blockers?.find(
    (blocker) => blocker.id === 'live-provider-full-capability-release-evidence',
  )
  const liveProviderHistoricalAttemptContext =
    liveProviderHistoricalAttemptContextLine(liveProviderBlocker?.evidence ?? {})
  const uiBlocker = evidence.releaseBlockers.json.blockers?.find(
    (blocker) => blocker.id === 'live-provider-web-ui-browser-origin-release-evidence',
  )
  const uiEvidencePassed = liveProviderUiEvidenceState(evidence).passed
  const windowsBlocker = evidence.releaseBlockers.json.blockers?.find(
    (blocker) => blocker.id === 'windows-trusted-msix-release-pass',
  )
  const appleBlocker = evidence.releaseBlockers.json.blockers?.find(
    (blocker) => blocker.id === 'apple-target-runtime-qa',
  )
  const linuxBlocker = evidence.releaseBlockers.json.blockers?.find(
    (blocker) => blocker.id === 'linux-target-runtime-qa',
  )
  const nextActions = allNextActions(evidence.releaseBlockers)
  const verifyFailureDetail = verifyReleaseFailureDetailLine(evidence)
  const liveProviderFullHashLabel = liveProviderFullReportLabel(
    liveProviderBlocker?.evidence ?? {},
  )

  return [
    `## Current Release Evidence Handoff (${releaseDiagnosticsTime || 'unknown time'})`,
    '',
    reportLine('Aggregate diagnostics', evidence.releaseDiagnostics),
    reportLine('Release blocker summary', evidence.releaseBlockers),
    reportLine('Verify release checkpoint', evidence.verifyReleaseCheckpoint),
    verifyFailureDetail,
    reportLine('Strict release preflight', evidence.strictPreflight),
    reportLine('Windows trusted MSIX host preflight', evidence.windowsHostPreflight),
    reportLine('Windows trusted MSIX current release pass', evidence.windowsTrustedMsixPass),
    reportLine('Hosted native CI diagnostic', evidence.hostedNativeCi),
    reportLine('Live sync canonical release pass', evidence.liveSyncReleasePass),
    reportLine('Live sync current diagnostic', evidence.liveSync),
    reportLine('Live provider ordinary API', evidence.liveProviderApi),
    reportLine('Live provider current diagnostic', evidence.liveProviderDiagnostic),
    reportLine(liveProviderFullHashLabel, evidence.liveProviderFull),
    reportLine('Live provider UI current diagnostic', evidence.liveProviderUi),
    reportLine('Live provider UI preserved attempt', evidence.liveProviderUiAttempt),
    reportLine('Native prerequisite diagnostic', evidence.nativePrereq),
    androidRuntimeLine,
    webCurrentPageLine(evidence.webCurrentPage),
    reportLine('Web current-page visual manifest', evidence.webCurrentPageVisual),
    reportLine('Release visual audit manifest', evidence.releaseVisual),
    '',
    `Residual blocker IDs (${ids.length}): ${ids.map((id) => `\`${id}\``).join(', ')}.`,
    releaseBlockerOwnershipMatrixLine(evidence),
    hostedMissing.length
      ? `Hosted native CI local prerequisites still missing: ${hostedMissing.map((item) => `\`${item}\``).join(', ')}.`
      : 'Hosted native CI local prerequisites are not reported as missing.',
    hostedDiagnostics
      ? `Hosted native CI local handoff readiness: git remote ${hostedDiagnostics.githubRemoteConfigured === true}, gh CLI ${hostedDiagnostics.githubCliAvailable === true}, gh auth ${hostedDiagnostics.githubCliAuthenticated === true}, artifact fetch ready ${hostedDiagnostics.localArtifactFetchReady === true}; diagnostic commands ${hostedDiagnosticCommands.length ? hostedDiagnosticCommands.map((command) => `\`${command}\``).join(', ') : 'not reported'}.`
      : 'Hosted native CI local handoff readiness is not reported.',
    hostedDiagnostics
      ? `Hosted native CI current-source coverage: ${hostedNativeCiCoverageText(hostedDiagnostics)}.`
      : 'Hosted native CI current-source coverage is not reported.',
    targetHostRuntimeEvidenceText('Apple', appleBlocker),
    targetHostRuntimeEvidenceText('Linux', linuxBlocker),
    liveSyncCanonicalReleaseEvidenceLine(evidence, liveSyncBlocker),
    liveSyncBlockerFingerprint
      ? `Live sync blocker source fingerprint: current ${liveSyncBlockerFingerprint.current === true}; ${liveSyncBlockerFingerprint.fileCount ?? 'unknown'} files / ${typeof liveSyncBlockerFingerprint.totalBytes === 'number' ? formatBytes(liveSyncBlockerFingerprint.totalBytes) : 'unknown'} bytes; SHA-256 \`${liveSyncBlockerFingerprint.sha256 ?? 'unknown'}\`.`
      : 'Live sync blocker source fingerprint is not reported.',
    sourceFingerprintSummaryLine(
      'Live-provider',
      liveProviderFingerprint,
      'zerochat.liveProviderSourceFingerprint.v1',
    ),
    sourceFingerprintSummaryLine(
      'Live-provider UI',
      liveProviderUiFingerprint,
      'zerochat.liveProviderUiSourceFingerprint.v1',
    ),
    windowsBlocker
      ? `Windows trusted MSIX blocker: \`${windowsBlocker.status}\`; ${windowsBlocker.summary}`
      : windowsTrustedMsixCurrentReleasePassLine(evidence),
    liveProviderBlocker
      ? `Live provider blocker: \`${liveProviderBlocker.status}\`; ${liveProviderBlocker.summary}`
      : 'Live provider full-capability blocker was not found in the current summary.',
    liveProviderBlocker?.evidence
      ? liveProviderSourceBindingLine(liveProviderBlocker.evidence)
      : 'Live provider full-capability evidence source binding is not reported.',
    liveProviderFullRequiredRemediationLine(liveProviderBlocker?.evidence ?? {}),
    ...(liveProviderBlocker?.evidence
      ? [liveProviderRouteBoundaryLine(liveProviderBlocker.evidence)].filter(Boolean)
      : []),
    ...(liveProviderHistoricalAttemptContext ? [liveProviderHistoricalAttemptContext] : []),
    uiEvidencePassed
      ? 'Live provider UI browser-origin release evidence: passed on the current source; no residual UI blocker is present.'
      : uiBlocker
        ? `Live provider UI blocker: \`${uiBlocker.status}\`; ${uiBlocker.summary}`
        : 'Live provider UI blocker was not found in the current summary.',
    liveProviderUiProxyPreflightLine(evidence),
    liveProviderUiLocalProxyContractLine(evidence),
    liveProviderUiSourceBindingLine(evidence),
    liveProviderUiRequiredRemediationLine(evidence),
    '',
    'All next actions:',
    ...nextActions.map(
      ({ blocker, action }) => `- \`${blocker}\`: ${action}`,
    ),
    '',
    'This summary is diagnostic-only. It is not release evidence and must not contain provider credentials, raw tokens, passphrases, or private endpoint URLs.',
  ].join('\n')
}

function replaceMarkedSection(text, startMarker, endMarker, fallbackPattern, replacement) {
  const markedPattern = new RegExp(
    `${startMarker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[\\s\\S]*?${endMarker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`,
    'u',
  )
  const markedReplacement = `${startMarker}\n${replacement}\n${endMarker}`

  if (markedPattern.test(text)) {
    return text.replace(markedPattern, markedReplacement)
  }

  if (!fallbackPattern.test(text)) {
    throw new Error(`Unable to locate document section for marker ${startMarker}.`)
  }

  return text.replace(fallbackPattern, markedReplacement)
}

function removeLegacyRequirementsCurrentEvidenceOverlays(text, requirementsEndMarker) {
  const markerIndex = text.indexOf(requirementsEndMarker)
  if (markerIndex === -1) {
    return text
  }

  const markerEnd = markerIndex + requirementsEndMarker.length
  const requirementsStartMarker = '<!-- zerochat-current-evidence:requirements:start -->'
  const markerStart = text.lastIndexOf(requirementsStartMarker, markerIndex)
  const headerEnd = text.indexOf('\n', text.indexOf('# ZeroChat 产品需求文档'))
  const header = headerEnd >= 0 ? text.slice(0, headerEnd + 1).trimEnd() : '# ZeroChat 产品需求文档 (PRD)'
  const productIndex = text.indexOf('\n## 一、产品定位', markerEnd)
  if (productIndex >= 0) {
    const currentOverlay = markerStart >= 0 ? text.slice(markerStart, markerEnd) : ''
    return `${header}\n\n${currentOverlay}\n\n> 历史发布证据不写入 Git 跟踪文档；逐次运行证据保留在被忽略的 .manual-qa 或 Actions artifacts。\n${text.slice(productIndex)}`
  }

  const afterMarkerEnd = text.slice(markerEnd)
  const legacyCurrentOverlayPattern =
    /(?:\r?\n){1,2}## 当前发布证据覆盖层（[^\r\n]*）[\s\S]*?(?=\r?\n## |\s*$)/gu
  return `${header}\n\n${text.slice(markerStart >= 0 ? markerStart : 0, markerEnd)}${afterMarkerEnd.replace(legacyCurrentOverlayPattern, '\n')}`
}

function compactRequirementsMilestones(text) {
  const start = text.indexOf('## 十三、里程碑')
  const end = text.indexOf('## 十四、各平台 UI 设计规范', start)
  if (start < 0 || end < 0) {
    return text
  }

  const stableMilestones = `## 十三、里程碑

> 里程碑只记录当前产品目标与仍未关闭的真实发布门槛；逐次运行证据保留在被忽略的 \`.manual-qa\` 或 Actions artifacts。

### Phase 1: 基础重构

- [x] Web 生产入口、当前状态管理、核心服务测试与消息渲染已落地并由 release gate 守护。
- [x] 当前 Web 设计系统、PWA 离线能力、Provider/SSE 边界与本地加密存储已由源码合同覆盖。

### Phase 2: UI 升级

- [x] Onboarding、聊天、Settings overlay、响应式布局、暗色模式、可访问性与多语言已纳入当前 Web/Android 验收。

### Phase 3: 原生端补齐

- [x] Android 当前 emulator QA、云同步冲突/恢复/重启与原生合同测试已通过。
- [x] Apple、Linux、Windows 的源码级合同与本机可执行门禁保留；目标主机 runtime 证据仍按下方 blocker 管理。

### Phase 4: 质量收尾

- [x] Web/PWA 当前本地完整验证、覆盖率、浏览器 smoke、云/Gist 合同与资源清理已通过。
- [ ] 各平台包体大小优化
- [ ] 各平台 runtime QA

### Release 阻塞残项

- [ ] Apple iOS/iPadOS/macOS 目标 runtime build/visual/sync QA
- [ ] Linux GTK/Secret Service 目标 runtime build/visual/sync QA
- [ ] Windows trusted MSIX install/update/uninstall 当前 runtime QA
- [ ] Disposable live sync release-pass
- [ ] Hosted native CI 首次真实 push/PR 运行
- [ ] Live-provider full capability release evidence
- [ ] Live-provider Web UI browser-origin pass evidence

---

`
  return `${text.slice(0, start)}${stableMilestones}${text.slice(end)}`
}

function updateQaCurrentEvidenceNote(text, evidence) {
  const releaseDiagnosticsTime = asiaShanghaiDateTime(
    generatedAtOf(evidence.releaseDiagnostics.json),
  )
  const verifyCheckpoint = evidence.verifyReleaseCheckpoint.json
  const verifyTime = asiaShanghaiDateTime(generatedAtOf(verifyCheckpoint))
  const isFocusedWebLocalPass =
    verifyCheckpoint.status === 'passed' &&
    verifyCheckpoint.passed === true &&
    verifyCheckpoint.releaseEvidence !== true &&
    verifyCheckpoint.requestedMode?.webLocal === true &&
    verifyCheckpoint.requestedMode?.release !== true &&
    verifyCheckpoint.requestedMode?.allPlatforms !== true

  let nextText = text
    .replace(
      /For the latest \d{4}-\d{2}-\d{2} \d{2}:\d{2} Asia\/Shanghai Web\/Windows\/package\/live\/hosted-CI/u,
      `For the latest ${releaseDiagnosticsTime || 'unknown time'} Web/Windows/package/live/hosted-CI`,
    )
    .replace(
      /without redefining the\r?\n\d{2}:\d{2} machine-readable release-blocker handoff\./u,
      `without redefining the\n${releaseDiagnosticsTime?.slice(11, 16) ?? 'unknown'} machine-readable release-blocker handoff.`,
    )

  if (isFocusedWebLocalPass) {
    nextText = nextText.replace(
      /The newest focused Web\/PWA local gate was refreshed at\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+Asia\/Shanghai;/u,
      `The newest focused Web/PWA local gate was refreshed at ${verifyTime || 'unknown time'};`,
    )
  }

  return nextText
}

function buildQaOpenGaps(evidence) {
  const windowsBlocker = releaseBlockerById(evidence, 'windows-trusted-msix-release-pass')
  const liveSyncBlocker = releaseBlockerById(
    evidence,
    'disposable-live-sync-release-pass',
  )
  const liveProviderBlocker = releaseBlockerById(
    evidence,
    'live-provider-full-capability-release-evidence',
  )
  const currentMsix = windowsBlocker?.evidence?.currentMsixPackageCandidate ?? {}
  const currentDistWebAssets =
    windowsBlocker?.evidence?.currentDistWebAssets ??
    currentMsix.stageWebAssets ??
    {}
  const trustedFailure = evidence.windowsTrustedMsixFailure?.json ?? {}
  const trustedFailureDist = trustedFailure.distWebAssets ?? {}
  const preflight = evidence.windowsHostPreflight.json ?? {}
  const preflightTime = asiaShanghaiDateTime(generatedAtOf(preflight))
  const blockerKind =
    trustedFailure.blockerClassification?.kind ??
    trustedFailure.blockerClassification ??
    'windows-appx-deployment-deleted-package-cleanup-access-denied'
  const currentHostBlockerKind =
    preflight.blockerClassification?.kind ??
    windowsBlocker?.evidence?.hostPreflight?.blockerKind ??
    'unknown'
  const trustedInstallState =
    preflight.status === 'clear'
      ? 'and now requires an elevated disposable-host trusted install/update rerun'
      : 'and trusted install/update was\n  not rerun while host preflight is blocked'
  const trustedRunId = trustedFailure.runId ?? 'unknown'
  const currentTrustedMsixReopenedLine =
    `Current trusted MSIX install/update/uninstall QA is reopened: run\n  \`${trustedRunId}\` remains diagnostic-only host AppX\n  evidence for the historical ${trustedFailureDist.fileCount ?? 'unknown'}-file\n  \`${trustedFailureDist.totalBytes ?? 'unknown'}\`-byte \`dist\`; it does not match the current\n  ${currentDistWebAssets.fileCount ?? 'unknown'}-file \`${currentDistWebAssets.totalBytes ?? 'unknown'}\`-byte \`dist\`, ${trustedInstallState}`
  const currentMsixPath = currentMsix.path ?? '.manual-qa/ZeroChat_0.0.1.0_x64.msix'
  const currentMsixBytes =
    typeof currentMsix.bytes === 'number' ? formatBytes(currentMsix.bytes) : 'unknown'
  const currentStageWeb = currentMsix.stageWebAssets ?? {}
  const currentPackageWeb = currentMsix.packageWebAssets ?? {}
  const nativeTime = asiaShanghaiDateTime(generatedAtOf(evidence.nativePrereq.json))
  const liveSyncTime = asiaShanghaiDateTime(generatedAtOf(evidence.liveSync.json))
  const hostedTime = asiaShanghaiDateTime(generatedAtOf(evidence.hostedNativeCi.json))
  const liveProviderDiagnosticTime = asiaShanghaiDateTime(
    generatedAtOf(evidence.liveProviderDiagnostic.json),
  )
  const liveProviderFullTime = asiaShanghaiDateTime(generatedAtOf(evidence.liveProviderFull.json))
  const liveProviderFullHashLabel = liveProviderFullReportLabel(
    liveProviderBlocker?.evidence ?? {},
  )
  const liveSyncFingerprint = evidence.liveSync.json.sourceFingerprint ?? {}
  const liveProviderFingerprint = evidence.liveProviderDiagnostic.json.sourceFingerprint ?? {}
  const liveProviderUiFingerprint = liveProviderUiSourceFingerprint(evidence)
  const residualBlockerIds = blockerIds(evidence.releaseBlockers)
  const uiEvidencePassed = liveProviderUiEvidenceState(evidence).passed
  const uiAttempt = evidence.liveProviderUiAttempt.json ?? {}
  const uiAttemptModel =
    uiAttempt.selectedModel ??
    uiAttempt.selectedCandidateModels?.chat ??
    uiAttempt.proxyPreflight?.selectedModel ??
    uiAttempt.model ??
    'unknown'

  let openGaps = [
    `Top current blocker summary: ${residualBlockerIds.length} residual blockers remain:`,
    `  ${inlineCodeList(residualBlockerIds)}.`,
    '',
    '- Current trusted MSIX install/update/uninstall release-pass remains blocked.',
    '- current trusted\n  install/update/uninstall release-pass evidence remains reopened on run',
    `  \`${trustedRunId}\``,
    `- ${currentTrustedMsixReopenedLine}`,
    '',
    ...(preflight.status === 'clear'
      ? [
          '- Current trusted MSIX install/update/uninstall QA still needs an elevated',
          `  current-source rerun: historical run \`${trustedRunId}\` remains diagnostic-only`,
        ]
      : [
          '- Current trusted MSIX install/update/uninstall release-pass is still missing:',
          `  historical run \`${trustedRunId}\` remains diagnostic-only`,
        ]),
    '  host AppX',
    `  evidence for the historical ${trustedFailureDist.fileCount ?? 'unknown'}-file`,
    `  \`${trustedFailureDist.totalBytes ?? 'unknown'}\`-byte \`dist\`; it does not match the current`,
    `  ${currentDistWebAssets.fileCount ?? 'unknown'}-file \`${currentDistWebAssets.totalBytes ?? 'unknown'}\`-byte \`dist\`, ${trustedInstallState}.`,
    '  The historical trusted-MSIX AppX failure is stale-dist diagnostic context, not the current blocker root.',
    '  Windows trusted MSIX run',
    `  \`${trustedRunId}\` remains a historical AppXDeploymentServer`,
    `  \`${blockerKind}\``,
    `  diagnostic for the historical ${trustedFailureDist.fileCount ?? 'unknown'}-file \`${trustedFailureDist.totalBytes ?? 'unknown'}\`-byte \`dist\`, does not`,
    `  match the current ${currentDistWebAssets.fileCount ?? 'unknown'}-file \`${currentDistWebAssets.totalBytes ?? 'unknown'}\`-byte \`dist\`, ${trustedInstallState}. Current host preflight`,
    '  `.manual-qa/windows-msix-host-preflight.json` was refreshed at',
    `  ${preflightTime} (\`${preflight.generatedAt ?? ''}\`) with`,
    `  \`status: "${preflight.status ?? 'unknown'}"\`, \`hostReadyForTrustedMsix: ${preflight.hostReadyForTrustedMsix}\`,`,
    `  \`currentShellElevated: ${preflight.currentShellElevated}\`, \`trustedMsixQaReadiness: "${preflight.trustedMsixQaReadiness ?? 'unknown'}"\`,`,
    `  blockerClassification \`${currentHostBlockerKind}\`,`,
    '  and SHA-256',
    `  \`${evidence.windowsHostPreflight.sha256}\`. The current package candidate is`,
    `  \`${currentMsixPath}\` (${currentMsixBytes} bytes / SHA-256`,
    `  \`${currentMsix.sha256 ?? 'unknown'}\`) with a staged web tree matching current \`dist\` at`,
    `  ${currentStageWeb.fileCount ?? 'unknown'} files / ${typeof currentStageWeb.totalBytes === 'number' ? formatBytes(currentStageWeb.totalBytes) : 'unknown'} bytes / SHA-256`,
    `  \`${currentStageWeb.sha256 ?? 'unknown'}\`, stageWebMatchesDist: ${currentMsix.stageWebMatchesDist === true ? 'true' : 'false'}.`,
    `  The package-internal web tree matches current \`dist\` and staged web at`,
    `  ${currentPackageWeb.fileCount ?? 'unknown'} files / ${typeof currentPackageWeb.totalBytes === 'number' ? formatBytes(currentPackageWeb.totalBytes) : 'unknown'} bytes / SHA-256`,
    `  \`${currentPackageWeb.sha256 ?? 'unknown'}\`, packageWebMatchesDist: ${currentMsix.packageWebMatchesDist === true ? 'true' : 'false'}, packageWebMatchesStage: ${currentMsix.packageWebMatchesStage === true ? 'true' : 'false'}.`,
    '- The active host path is report-derived from `.manual-qa/windows-msix-host-preflight.json`; current trusted MSIX release evidence remains blocked until that report and target-host proof pass.',
    '- This remains packaging freshness, not release-pass evidence; current trusted',
    '  install/update/uninstall release-pass evidence is still missing, while run',
    `  \`${trustedRunId}\` is historical diagnostic context; currentShellElevated: ${preflight.currentShellElevated}.`,
    `  ${windowsTrustedMsixCurrentBlockerLine(evidence)}`,
    ...(preflight.status === 'clear'
      ? [
          '  The current host preflight is clear but the current shell is not elevated, so',
          '  the next proof must be an elevated disposable-host trusted install/update',
          '  rerun.',
        ]
      : [
          '  blocked by Windows AppXDeploymentServer cleanup access-denied state, so that',
          '  run is historical diagnostic evidence only and the next proof must come from',
          '  a repaired or clean disposable Windows host before trusted MSIX QA can be',
          '  rerun.',
        ]),
    '- Apple and Linux still need real platform builds and visual QA on machines with',
    '  the required SDKs. Windows Debug/Release build, visual smoke, MSIX manifest',
    '  readiness, `makeappx` packaging, SignTool signing, unsigned dry-run, and',
    '  signed-but-untrusted dry-run are covered locally, but current trusted',
    '  install/update/uninstall release-pass evidence remains open. Use',
    '  `pnpm run report:windows-msix-host-preflight`, then only after a clear',
    '  elevated host run `pnpm run qa:windows-msix-trusted:elevated`,',
    '  `pnpm run check:windows-msix-trusted-report`,',
    '  `pnpm run check:runtime-artifacts`, and `pnpm run check:local-cleanup`.',
    `- Live-provider full-capability release evidence remains open: current ${liveProviderFullTime}`,
    `  full-current report status is \`${evidence.liveProviderFull.json.status ?? 'unknown'}\`; current`,
    `  no-credential diagnostic refreshed at ${liveProviderDiagnosticTime} has SHA-256`,
    `  \`${evidence.liveProviderDiagnostic.sha256}\`, while ${liveProviderFullHashLabel} SHA-256 is`,
    `  \`${evidence.liveProviderFull.sha256}\`, with source fingerprint ${liveProviderFingerprint.fileCount ?? 'unknown'} files / ${typeof liveProviderFingerprint.totalBytes === 'number' ? formatBytes(liveProviderFingerprint.totalBytes) : 'unknown'} / SHA-256`,
    `  \`${liveProviderFingerprint.sha256 ?? 'unknown'}\`.`,
    `  ${liveProviderFullRequiredRemediationLine(liveProviderBlocker?.evidence ?? {})}`,
    `  ${liveProviderUiLocalProxyContractLine(evidence)}`,
    ...(uiEvidencePassed
      ? [
          '- Live-provider Web UI browser-origin release evidence is passed and is no longer a blocker:',
          `  credential-confirmed UI attempt hash \`${evidence.liveProviderUiAttempt.sha256}\`, generatedAt \`${generatedAtOf(uiAttempt)}\`, selected model \`${uiAttemptModel}\`, browserOriginProven true, browserMessageSent true, markerCaptured true, browserProviderKeyInjected false; UI source fingerprint schema \`${liveProviderUiFingerprint.kind ?? 'zerochat.liveProviderUiSourceFingerprint.v1'}\`, ${liveProviderUiFingerprint.fileCount ?? 'unknown'} files / ${typeof liveProviderUiFingerprint.totalBytes === 'number' ? formatBytes(liveProviderUiFingerprint.totalBytes) : 'unknown'} / SHA-256 \`${liveProviderUiFingerprint.sha256 ?? 'unknown'}\`.`,
          `  The later no-credential current diagnostic does not reopen the passed current-source attempt. ${liveProviderUiRequiredRemediationLine(evidence)}`,
        ]
      : [
          '- Live-provider Web UI browser-origin release evidence remains open: the',
          `  credential-confirmed UI attempt hash is \`${evidence.liveProviderUiAttempt.sha256}\`,`,
          `  generatedAt \`${generatedAtOf(uiAttempt)}\`, selected model \`${uiAttemptModel}\`, with UI source fingerprint schema \`${liveProviderUiFingerprint.kind ?? 'zerochat.liveProviderUiSourceFingerprint.v1'}\`, ${liveProviderUiFingerprint.fileCount ?? 'unknown'} files / ${typeof liveProviderUiFingerprint.totalBytes === 'number' ? formatBytes(liveProviderUiFingerprint.totalBytes) : 'unknown'} / SHA-256 \`${liveProviderUiFingerprint.sha256 ?? 'unknown'}\`; it needs`,
          '  a browser-allowed AI proxy or Cloudflare Worker root before release-pass UI',
          '  evidence can exist.',
          `  ${liveProviderUiRequiredRemediationLine(evidence)}`,
        ]),
    `- Disposable Cloudflare/Gist live-sync release-pass and hosted native CI remain open. Current ${liveSyncTime}`,
    `  live-sync diagnostic hash is \`${evidence.liveSync.sha256}\`, with source fingerprint`,
    `  ${liveSyncFingerprint.fileCount ?? 'unknown'} files / ${typeof liveSyncFingerprint.totalBytes === 'number' ? formatBytes(liveSyncFingerprint.totalBytes) : 'unknown'} /`,
    `  SHA-256 \`${liveSyncFingerprint.sha256 ?? 'unknown'}\`; current ${hostedTime}`,
    `  hosted native CI diagnostic hash is \`${evidence.hostedNativeCi.sha256}\`.`,
    `- Native prerequisite diagnostic remains current at ${nativeTime}; Apple and Linux target runtime QA still require target hosts.`,
  ].join('\n')

  if (!windowsBlocker) {
    openGaps = openGaps.replace(
      /- Current trusted MSIX install\/update\/uninstall QA still needs an elevated[\s\S]*?(?=- Live-provider full-capability release evidence remains open:)/u,
      `- ${windowsTrustedMsixCurrentReleasePassLine(evidence)} The Windows blocker no longer appears in the residual blocker set. The historical AppX cleanup diagnostic is retained as diagnostic context only; it does not reopen the current passed evidence. Apple and Linux still need real platform builds and visual QA on target hosts.\n`,
    )
  }

  if (!liveSyncBlocker) {
    openGaps = openGaps.replace(
      /- Disposable Cloudflare\/Gist live-sync release-pass and hosted native CI remain open\.[\s\S]*?hosted native CI diagnostic hash is `[^`]*`\./u,
      `- ${liveSyncCanonicalReleaseEvidenceLine(evidence, null)} Hosted native CI remains open; current ${hostedTime} diagnostic hash is ${evidence.hostedNativeCi.sha256}.`,
    )
  }

  return openGaps
}

function updateQaOpenGaps(text, evidence) {
  const openGapsPattern = /## Open Gaps\r?\n[\s\S]*?(?=\r?\n## |\s*$)/u

  if (!openGapsPattern.test(text)) {
    throw new Error('Unable to locate QA audit Open Gaps section.')
  }

  return text.replace(openGapsPattern, `## Open Gaps\n\n${buildQaOpenGaps(evidence)}\n`)
}

function currentReleaseResidualChecklist(evidence) {
  const expectedIds = blockerIds(evidence.releaseBlockers)
  const entries = releaseBlockerChecklistEntries(evidence.releaseBlockers)
  const actualIds = entries.map((entry) => entry.id)
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index])
  ) {
    throw new Error(
      `Current release residual checklist ids must match releaseBlockers. Expected [${expectedIds.join(', ')}], received [${actualIds.join(', ')}].`,
    )
  }

  return [
    '## 当前发布残余清单',
    '',
    ...entries.map((entry) => entry.line),
  ].join('\n')
}

function currentReleaseResidualChecklistIds(text) {
  const section = text.match(
    /## 当前发布残余清单\r?\n[\s\S]*?(?=\r?\n## Open Gaps\r?\n)/u,
  )?.[0]
  if (!section) return []
  return [...section.matchAll(/^- \[ \] 当前 release blocker `([^`]+)`：/gmu)].map(
    (match) => match[1],
  )
}

function assertCurrentReleaseResidualChecklist(text, report) {
  const expectedIds = blockerIds(report)
  const actualIds = currentReleaseResidualChecklistIds(text)
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index])
  ) {
    throw new Error(
      `Current release residual checklist ids must match releaseBlockers. Expected [${expectedIds.join(', ')}], received [${actualIds.join(', ')}].`,
    )
  }
}

function compactQaAuditHistory(text, evidence) {
  const normalizedText = stripCurrentProductContractMarkers(text)
  const firstHistoricalHeading = normalizedText.search(/^## \d{4}-\d{2}-\d{2}/mu)
  if (firstHistoricalHeading < 0) {
    const residualChecklistPattern =
      /## 当前发布残余清单\r?\n[\s\S]*?(?=\r?\n## Open Gaps\r?\n)/u
    if (residualChecklistPattern.test(normalizedText)) {
      return normalizedText.replace(
        residualChecklistPattern,
        `${currentReleaseResidualChecklist(evidence)}\n`,
      )
    }
    return normalizedText
  }
  const qaStart = '<!-- zerochat-current-evidence:qa-overlay:start -->'
  const qaEnd = '<!-- zerochat-current-evidence:qa-overlay:end -->'
  const start = normalizedText.indexOf(qaStart)
  const end = normalizedText.indexOf(qaEnd, start)
  const overlay =
    start >= 0 && end > start
      ? normalizedText.slice(start, end + qaEnd.length)
      : ''
  const prefixBeforeHistory = normalizedText.slice(0, firstHistoricalHeading)
  const prefixWithoutOverlay =
    start >= 0 && end > start && start < firstHistoricalHeading
      ? `${prefixBeforeHistory.slice(0, start)}${prefixBeforeHistory.slice(end + qaEnd.length)}`
      : prefixBeforeHistory
  const prefix = prefixWithoutOverlay.trimEnd()
  return `${prefix}\n\n${overlay}\n\n${currentReleaseResidualChecklist(evidence)}\n\n## Open Gaps\n\n`
}

async function writeTextFileAtomically(targetPath, contents) {
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`

  try {
    await writeFile(temporaryPath, contents)
    await rename(temporaryPath, targetPath)
  } catch (error) {
    await removeTemporaryPathAfterFailedAtomicWrite(temporaryPath, error)
    throw error
  }
}

function normalizeGeneratedDocumentEnding(text) {
  return `${normalizeGeneratedDocumentText(text).trimEnd()}\n`
}

async function writeCurrentEvidenceDocs(evidence) {
  const requirementsStart = '<!-- zerochat-current-evidence:requirements:start -->'
  const requirementsEnd = '<!-- zerochat-current-evidence:requirements:end -->'
  const qaStart = '<!-- zerochat-current-evidence:qa-overlay:start -->'
  const qaEnd = '<!-- zerochat-current-evidence:qa-overlay:end -->'
  const requirementsOverlay = buildRequirementsOverlay(evidence)
  const qaCurrentOverlay = buildQaCurrentOverlay(evidence)
  const qaOpenGaps = buildQaOpenGaps(evidence)

  assertPublishSafe(requirementsOverlay, 'generated Requirements current evidence overlay')
  assertPublishSafe(qaCurrentOverlay, 'generated QA current evidence overlay')
  assertPublishSafe(qaOpenGaps, 'generated QA Open Gaps')

  const requirements = await readFile(paths.requirements, 'utf8')
  const qaAudit = await readFile(paths.qaAudit, 'utf8')
  const requirementsWithoutGeneratedMarkers = stripCurrentProductContractMarkers(requirements)
  const liveSyncEvidencePassed = !releaseBlockerById(
    evidence,
    'disposable-live-sync-release-pass',
  )
  const nextRequirements = syncLiveProviderUiMilestoneChecklist(
    syncLiveSyncRequirementsMilestoneChecklist(
      compactRequirementsMilestones(
        removeLegacyRequirementsCurrentEvidenceOverlays(
        replaceMarkedSection(
          requirementsWithoutGeneratedMarkers,
          requirementsStart,
          requirementsEnd,
          /## 当前发布证据覆盖层（[\s\S]*?）[\s\S]*?(?=\r?\n## 当前发布证据覆盖层（)/u,
          requirementsOverlay,
        ),
        requirementsEnd,
        ),
      ),
      liveSyncEvidencePassed,
    ),
    liveProviderUiEvidenceState(evidence).passed,
  )
  const nextQaAudit = syncLiveProviderUiQaResidualChecklist(
    syncLiveSyncQaResidualChecklist(
      updateQaOpenGaps(
        updateQaCurrentEvidenceNote(
          replaceMarkedSection(
            compactQaAuditHistory(qaAudit, evidence),
            qaStart,
            qaEnd,
            /Current diagnostic overlay:[\s\S]*?(?:Current full release|Focused Web-local|Current) verifier checkpoint:[\s\S]*?pnpm run check:verify-release-checkpoint`\.\r?\n/u,
            qaCurrentOverlay,
          ),
          evidence,
        ),
        evidence,
      ),
      liveSyncEvidencePassed,
    ),
    liveProviderUiEvidenceState(evidence).passed,
  )

  await writeTextFileAtomically(
    paths.requirements,
    normalizeGeneratedDocumentEnding(nextRequirements),
  )
  await writeTextFileAtomically(
    paths.qaAudit,
    normalizeGeneratedDocumentEnding(nextQaAudit),
  )
}

async function readEvidence() {
  let androidCurrentApk = null
  try {
    androidCurrentApk = currentAndroidDebugApkEvidence({ repoRoot: process.cwd() })
  } catch {
    androidCurrentApk = null
  }

  return {
    releaseDiagnostics: await jsonEvidence(paths.releaseDiagnostics),
    releaseBlockers: await jsonEvidence(paths.releaseBlockers),
    verifyReleaseCheckpoint: await jsonEvidence(paths.verifyReleaseCheckpoint),
    strictPreflight: await jsonEvidence(paths.strictPreflight),
    windowsHostPreflight: await jsonEvidence(paths.windowsHostPreflight),
    hostedNativeCi: await jsonEvidence(paths.hostedNativeCi),
    liveSync: await jsonEvidence(paths.liveSyncDiagnostic),
    liveSyncReleasePass: await optionalJsonEvidence(paths.liveSyncReleasePass),
    liveProviderApi: await jsonEvidence(paths.liveProviderApi),
    liveProviderDiagnostic: await jsonEvidence(paths.liveProviderDiagnostic),
    liveProviderFull: await jsonEvidence(paths.liveProviderFull),
    liveProviderUi: await jsonEvidence(paths.liveProviderUi),
    liveProviderUiAttempt: await jsonEvidence(paths.liveProviderUiAttempt),
    nativePrereq: await jsonEvidence(paths.nativePrereq),
    androidRuntime: await jsonEvidence(paths.androidRuntime),
    androidCurrentApk,
    androidUiSmoke: await jsonEvidence(paths.androidUiSmoke),
    androidCloudSyncSmoke: await jsonEvidence(paths.androidCloudSyncSmoke),
    androidContactSheet: await jsonEvidence(paths.androidContactSheet),
    androidContactSheetImage: await fileEvidence(paths.androidContactSheetImage),
    webCurrentPage: await jsonEvidence(paths.webCurrentPage),
    webCurrentPageVisual: await jsonEvidence(paths.webCurrentPageVisual),
    releaseVisual: await jsonEvidence(paths.releaseVisual),
    windowsTrustedMsixFailure: await jsonEvidence(paths.windowsTrustedMsixFailure),
    windowsTrustedMsixPass: await jsonEvidence(paths.windowsTrustedMsixPass),
    currentWindowsMsixPackageCandidate: await fileEvidence(
      paths.windowsCurrentMsixPackageCandidate,
    ),
    distIndex: await fileEvidence(paths.distIndex),
  }
}

function assertPublishSafe(markdown, label = 'Generated handoff') {
  for (const pattern of forbiddenOutputPatterns) {
    if (pattern.test(markdown)) {
      throw new Error(`${label} contains forbidden sensitive pattern: ${pattern}`)
    }
  }
}

function assertPublishSafeRejectsSensitiveFixtures() {
  const fakeCredentialShapedProviderKey = ['sk', 'abcdefghijklmnopqrstuvwxyzABCDE'].join('-')
  const sensitiveFixtures = [
    ['provider key ', fakeCredentialShapedProviderKey].join(''),
    ['Authorization: Bearer ', fakeCredentialShapedProviderKey].join(''),
    ['ZEROCHAT_LIVE_PROVIDER_API_KEY', '=fixture'].join(''),
    'https://provider.example.invalid/v1',
  ]

  for (const fixture of sensitiveFixtures) {
    let rejected = false

    try {
      assertPublishSafe(fixture, 'publish-safety self-test fixture')
    } catch {
      rejected = true
    }

    if (!rejected) {
      throw new Error('Current evidence handoff publish-safety self-test accepted a sensitive fixture.')
    }
  }
}

function fixtureReport(path, json) {
  return {
    bytes: 1,
    json,
    path,
    sha256: '0'.repeat(64),
  }
}

function missingFixtureReport(path) {
  return {
    bytes: 0,
    json: {
      status: 'missing',
      releaseEvidence: false,
      safeToPublish: false,
    },
    missing: true,
    path,
    sha256: 'missing',
  }
}

function aggregateDiagnosticChildSafetyFixture(reportSummaries, reportCount = reportSummaries.length) {
  return {
    releaseDiagnostics: fixtureReport('.manual-qa/release-diagnostics-current.json', {
      reportCount,
      reportSummaries,
    }),
  }
}

function assertThrowsMatching(label, action, expectedPattern) {
  let thrown = null

  try {
    action()
  } catch (error) {
    thrown = error
  }

  if (!thrown) {
    throw new Error(`Current evidence handoff self-test accepted ${label}.`)
  }

  const message = String(thrown?.message ?? thrown)
  if (!expectedPattern.test(message)) {
    throw new Error(
      `Current evidence handoff self-test for ${label} threw unexpected error: ${message}`,
    )
  }
}

function assertAggregateDiagnosticChildSafetyLineSelfTest() {
  const safeEvidence = aggregateDiagnosticChildSafetyFixture([
    {
      path: '.manual-qa/live-provider-smoke-current-diagnostic.json',
      releaseEvidence: false,
      safeToPublish: true,
    },
    {
      path: '.manual-qa/live-provider-ui-smoke-current.json',
      releaseEvidence: false,
      safeToPublish: true,
    },
    {
      path: '.manual-qa/live-provider-ui-smoke-attempt-current.json',
      status: 'passed',
      evidenceType: 'live-provider-ui-release-evidence',
      releaseEvidence: true,
      safeToPublish: true,
    },
  ])
  const line = aggregateDiagnosticChildSafetyLine(safeEvidence)

  if (
    !line.includes('3/3 child summaries are `safeToPublish: true`') ||
    !line.includes('2/3 are `releaseEvidence: false`') ||
    !line.includes('1/3 are validated child release evidence')
  ) {
    throw new Error('Current evidence handoff self-test lost aggregate child safety proof line.')
  }

  assertThrowsMatching(
    'aggregate diagnostic reportCount mismatch',
    () =>
      aggregateDiagnosticChildSafetyLine(
        aggregateDiagnosticChildSafetyFixture(
          [
            {
              path: '.manual-qa/first-child.json',
              releaseEvidence: false,
              safeToPublish: true,
            },
            {
              path: '.manual-qa/second-child.json',
              releaseEvidence: false,
              safeToPublish: true,
            },
          ],
          3,
        ),
      ),
    /Aggregate release diagnostics reportCount 3 does not match 2 reportSummaries/u,
  )

  assertThrowsMatching(
    'unsafe aggregate diagnostic child summary',
    () =>
      aggregateDiagnosticChildSafetyLine(
        aggregateDiagnosticChildSafetyFixture([
          {
            path: '.manual-qa/unsafe-child.json',
            releaseEvidence: false,
            safeToPublish: false,
          },
        ]),
      ),
    /not safeToPublish=true: \.manual-qa\/unsafe-child\.json/u,
  )

  assertThrowsMatching(
    'unknown release-evidence aggregate diagnostic child summary',
    () =>
      aggregateDiagnosticChildSafetyLine(
        aggregateDiagnosticChildSafetyFixture([
          {
            path: '.manual-qa/release-child.json',
            releaseEvidence: true,
            safeToPublish: true,
          },
        ]),
      ),
    /child summary policy failed: \.manual-qa\/release-child\.json is not an allowed child release-evidence summary path/u,
  )
}

function assertRequirementsBlockerChecklistSelfTest() {
  const releaseBlockerReport = {
    json: {
      blockerCount: 2,
      blockers: [
        {
          blockerKind: 'fixture-first-kind',
          id: 'fixture-first-blocker',
          nextActions: ['Run the first fixture proof.'],
          owner: 'fixture-first-owner',
          status: 'blocked',
        },
        {
          blockerKind: 'fixture-second-kind',
          id: 'fixture-second-blocker',
          nextActions: ['Run the second fixture proof.'],
          owner: 'fixture-second-owner',
          status: 'missing',
        },
      ],
    },
  }
  const overlay = releaseBlockerChecklistLines(releaseBlockerReport).join('\n')

  assertRequirementsOverlayBlockerChecklist(overlay, releaseBlockerReport)
  if (
    conciseReleaseBlockerNextAction(
      'Repair fixture route: long diagnostic details remain in the structured report.',
    ) !== 'Repair fixture route'
  ) {
    throw new Error(
      'Current evidence handoff self-test failed to keep blocker checkbox next actions concise.',
    )
  }
  if (
    liveProviderFullCapabilityChecklistAction(
      {
        id: 'live-provider-full-capability-release-evidence',
        evidence: {
          capabilityFailureSummary: {
            affectedCapabilities: ['audio-speech', 'embeddings', 'realtime'],
          },
          credentialConfirmedAttemptReport: {
            sourceFingerprintCurrent: true,
            hasCredentialConfirmedProviderAttempt: true,
          },
        },
      },
      'Repair one route.',
    ) !==
      'Repair current credential-confirmed audio-speech, embeddings, realtime failures, then rerun pnpm run drill:live-provider on the current source.' ||
    liveProviderFullCapabilityChecklistAction(
      {
        id: 'live-provider-full-capability-release-evidence',
        evidence: {
          credentialConfirmedAttemptReport: {
            hasCredentialConfirmedProviderAttempt: true,
            capabilityFailureSummary: {
              affectedCapabilities: ['audio-speech', 'embeddings', 'realtime'],
            },
          },
        },
      },
      'Repair one route.',
    ) !==
      'Repair preserved credential-confirmed audio-speech, embeddings, realtime failures, then rerun pnpm run drill:live-provider on the current source.' ||
    liveProviderFullCapabilityChecklistAction(
      {
        id: 'live-provider-full-capability-release-evidence',
        evidence: {},
      },
      'Repair one route.',
    ) !== 'Repair one route.' ||
    liveProviderFullCapabilityChecklistAction(
      {
        id: 'live-provider-full-capability-release-evidence',
        evidence: {
          capabilityFailureSummary: {
            affectedCapabilities: ['audio-speech'],
          },
          credentialConfirmedAttemptReport: {
            sourceFingerprintCurrent: true,
          },
        },
      },
      'Repair one route.',
    ) !== 'Repair one route.'
  ) {
    throw new Error(
      'Current evidence handoff self-test failed to distinguish current, preserved, and unconfirmed live-provider capability failures.',
    )
  }
  if (
    !overlay.includes(
      '- [ ] 当前 release blocker `fixture-first-blocker`：status `blocked`，blockerKind `fixture-first-kind`，owner `fixture-first-owner`；next action：Run the first fixture proof.',
    ) ||
    (overlay.match(/^- \[ \]/gmu) ?? []).length !== 2
  ) {
    throw new Error(
      'Current evidence handoff self-test lost the one-checkbox-per-release-blocker checklist.',
    )
  }

  assertThrowsMatching(
    'release blocker checklist count mismatch',
    () =>
      releaseBlockerChecklistLines({
        json: { ...releaseBlockerReport.json, blockerCount: 1 },
      }),
    /blockerCount 1 does not match 2 blockers/u,
  )
  assertThrowsMatching(
    'release blocker checklist duplicate id',
    () =>
      releaseBlockerChecklistLines({
        json: {
          blockerCount: 2,
          blockers: [
            releaseBlockerReport.json.blockers[0],
            {
              ...releaseBlockerReport.json.blockers[1],
              id: 'fixture-first-blocker',
            },
          ],
        },
      }),
    /checklist ids must be unique/u,
  )
  assertThrowsMatching(
    'release blocker checklist extra informational checkbox',
    () =>
      assertRequirementsOverlayBlockerChecklist(
        `${overlay}\n- [ ] informational handoff`,
        releaseBlockerReport,
      ),
    /unchecked blocker checklist must exactly match release blocker ids/u,
  )
  assertThrowsMatching(
    'release blocker checklist missing blocker checkbox',
    () =>
      assertRequirementsOverlayBlockerChecklist(
        releaseBlockerChecklistLines(releaseBlockerReport)[0],
        releaseBlockerReport,
      ),
    /unchecked blocker checklist must exactly match release blocker ids/u,
  )
}

function assertAllNextActionsRendered() {
  const liveProviderActions = [
    'Repair live-provider audio-speech /audio/speech',
    'Repair live-provider audio-transcription /audio/transcriptions',
    'Repair live-provider embeddings /embeddings',
    'Repair live-provider moderation /moderations',
    'Repair live-provider realtime /realtime, fallback /realtime/client_secrets',
  ]
  const evidence = {
    releaseDiagnostics: fixtureReport('.manual-qa/release-diagnostics-current.json', {
      generatedAt: '2026-06-25T04:29:03.594Z',
      releaseEvidence: false,
      status: 'blocked',
    }),
    releaseBlockers: fixtureReport('.manual-qa/release-blockers-current.json', {
      blockerCount: 7,
      blockers: [
        {
          blockerKind: 'missing-hosted-native-ci-release-evidence',
          evidence: {
            blockerKind: 'missing-hosted-native-ci-release-evidence',
            localHandoffDiagnostics: {
              diagnosticCommands: [
                'git status --porcelain=v1 --untracked-files=all',
                'git status --porcelain=v1 --untracked-files=all -- <native-source-roots-from-.manual-qa/native-prereq-all-platforms.json>',
                'git remote get-url origin',
                'gh --version',
                'gh auth status',
              ],
              githubCliAuthenticated: false,
              githubCliAvailable: false,
              githubRemoteConfigured: false,
              gitStatusEntryCount: 782,
              gitWorktreeDirty: true,
              hostedCiCoversCurrentNativeSource: false,
              hostedCiCoversCurrentWorktree: false,
              localArtifactFetchReady: false,
              nativeSourceStatusEntryCount: 356,
              nativeSourceWorktreeDirty: true,
              releaseEvidenceHandoffReady: false,
              missingLocalPrerequisites: [
                'git-remote-origin',
                'github-cli-gh',
                'clean-git-worktree',
                'clean-native-source-worktree',
              ],
            },
          },
          id: 'hosted-native-ci-release-evidence',
          nextActions: ['Configure GitHub remote and authenticate gh for artifact handoff.'],
          owner: 'release-operator-github-actions',
          status: 'missing',
          summary: 'fixture hosted native CI blocker',
        },
        {
          blockerKind: 'missing-live-sync-release-inputs',
          evidence: {
            blockerKind: 'missing-live-sync-release-inputs',
            owner: 'release-operator-disposable-sync-credentials',
            missingInputKeys: [
              'liveSyncMode',
              'providerSpecificDisposableCredential',
              'destructiveConfirmation',
              'throwawaySyncPassphrase',
            ],
            mode: null,
            remoteTouched: false,
            sourceFingerprint: {
              current: true,
              fileCount: 31,
              kind: 'zerochat.liveSyncSourceFingerprint.v1',
              sha256: 'A'.repeat(64),
              totalBytes: 573962,
            },
            supportedModes: ['cloudflare', 'gist'],
          },
          id: 'disposable-live-sync-release-pass',
          nextActions: ['Run the disposable live sync release drill with release-only credentials.'],
          owner: 'release-operator-disposable-sync-credentials',
          status: 'blocked',
          summary: 'fixture live sync blocker',
        },
        {
          blockerKind: 'missing-apple-target-runtime-prerequisites',
          evidence: {
            blockerKind: 'missing-apple-target-runtime-prerequisites',
            owner: 'target-host-macos-xcode-swift',
            targetRuntimeEvidenceRequired: true,
            targetHostRuntimeEvidence: {
              required: true,
              targetHost: 'macOS with Xcode/Swift',
              requiredHostTools: ['swift', 'xcodebuild'],
              currentHostSatisfiesTargetRuntime: false,
              runtimeQaMustRunOnTargetHost: true,
              localPreflightIsRuntimeEvidence: false,
              requiredProof: [
                'target-host build log',
                'target-host runtime screenshot',
                'target-host visual QA',
                'target-host sync QA',
                'target-host package-size evidence',
              ],
            },
          },
          id: 'apple-target-runtime-qa',
          nextActions: ['Run the Apple QA entry on macOS with Xcode/Swift installed.'],
          owner: 'target-host-macos-xcode-swift',
          status: 'blocked',
          summary: 'fixture Apple target runtime QA blocker',
        },
        {
          blockerKind: 'missing-linux-target-runtime-prerequisites',
          evidence: {
            blockerKind: 'missing-linux-target-runtime-prerequisites',
            owner: 'target-host-linux-gtk-secret-service',
            targetRuntimeEvidenceRequired: true,
            targetHostRuntimeEvidence: {
              required: true,
              targetHost: 'Linux or WSL with GTK4/libadwaita and Secret Service',
              requiredHostTools: [
                'cargo',
                'pkg-config',
                'secret-tool',
                'pkg-config gtk4',
                'pkg-config libadwaita-1',
              ],
              deferredTargetChecks: [
                'cargo',
                'pkg-config',
                'secret-tool',
                'pkg-config gtk4',
                'pkg-config libadwaita-1',
              ],
              currentHostSatisfiesTargetRuntime: false,
              runtimeQaMustRunOnTargetHost: true,
              localPreflightIsRuntimeEvidence: false,
              requiredProof: [
                'target-host build log',
                'target-host runtime screenshot',
                'target-host visual QA',
                'target-host sync QA',
                'target-host Secret Service QA',
                'target-host package-size evidence',
              ],
            },
          },
          id: 'linux-target-runtime-qa',
          nextActions: ['Run the Linux QA entry inside Linux or WSL with GTK4/libadwaita and Secret Service available.'],
          owner: 'target-host-linux-gtk-secret-service',
          status: 'blocked',
          summary: 'fixture Linux target runtime QA blocker',
        },
        {
          blockerKind: 'windows-trusted-msix-needs-elevated-current-source-rerun',
          evidence: {
            blockerKind: 'windows-trusted-msix-needs-elevated-current-source-rerun',
            currentTrustedQaState: 'host-clear-needs-elevated-trusted-msix-rerun',
            historicalTrustedQaFailureKind:
              'windows-appx-deployment-deleted-package-cleanup-access-denied',
            historicalTrustedQaFailureOwner: 'host-windows-appx-deployment-service',
            hostPreflight: {
              blockerKind: 'no-known-windows-msix-host-blocker',
              currentShellElevated: false,
              hostReadyForTrustedMsix: true,
              status: 'clear',
              trustedMsixQaReadiness: 'host-clear-current-shell-not-elevated',
            },
            needsElevatedTrustedQaRerun: true,
            owner: 'windows-release-qa-operator',
            currentDistWebAssets: {
              fileCount: 34,
              totalBytes: 1046554,
              sha256: 'B'.repeat(64),
            },
            currentMsixPackageCandidate: {
              bytes: 1326171,
              path: '.manual-qa/ZeroChat_0.0.1.0_x64.msix',
              sha256: 'C'.repeat(64),
              stageWebAssets: {
                fileCount: 34,
                totalBytes: 1046554,
                sha256: 'B'.repeat(64),
              },
              stageWebMatchesDist: true,
              packageWebAssets: {
                fileCount: 34,
                totalBytes: 1046554,
                sha256: 'B'.repeat(64),
              },
              packageWebMatchesDist: true,
              packageWebMatchesStage: true,
            },
          },
          id: 'windows-trusted-msix-release-pass',
          nextActions: ['Use an elevated PowerShell on a disposable Windows QA machine or profile and run pnpm run qa:windows-msix-trusted:elevated for the trusted MSIX QA rerun.'],
          owner: 'windows-release-qa-operator',
          status: 'blocked',
          summary: 'fixture Windows trusted MSIX blocker',
        },
        {
          blockerKind: 'failed-live-provider-capabilities',
          evidence: {
            blockerKind: 'failed-live-provider-capabilities',
            owner: 'external-provider-or-third-party-relay',
            capabilityFailureSummary: {
              affectedCapabilities: [],
              routeHealthBlockers: [],
              total: 0,
            },
            capabilityFailureModelAttempts: [
              {
                attempts: [
                  {
                    failureKind: 'model-missing',
                    model: 'text-embedding-3-large',
                    passed: false,
                    status: 404,
                  },
                  {
                    failureKind: 'model-missing',
                    model: 'text-embedding-3-small',
                    passed: false,
                    status: 404,
                  },
                ],
                capability: 'embeddings',
                endpointPath: '/embeddings',
              },
            ],
            credentialConfirmedAttemptReport: {
              capabilityFailureSummary: {
                affectedCapabilities: [
                  'audio-speech',
                  'audio-transcription',
                  'embeddings',
                  'moderation',
                  'realtime',
                ],
                routeHealthBlockers: [
                  'audio-speech',
                  'audio-transcription',
                  'embeddings',
                  'moderation',
                  'realtime',
                ],
                total: 5,
              },
              capabilityRemediationHints: [
                {
                  action: 'Expose and forward /audio/speech for audio-speech.',
                  capability: 'audio-speech',
                  endpointPath: '/audio/speech',
                  failureKind: 'route-missing',
                  owner: 'provider-relay-route',
                  status: 404,
                },
                {
                  action: 'Expose and forward /audio/transcriptions for audio-transcription.',
                  capability: 'audio-transcription',
                  endpointPath: '/audio/transcriptions',
                  failureKind: 'route-missing',
                  owner: 'provider-relay-route',
                  status: 404,
                },
                {
                  action: 'Provide a compatible embeddings model.',
                  capability: 'embeddings',
                  endpointPath: '/embeddings',
                  failureKind: 'model-missing',
                  owner: 'provider-model-catalog-or-override',
                  status: 404,
                },
                {
                  action: 'Expose and forward /moderations for moderation.',
                  capability: 'moderation',
                  endpointPath: '/moderations',
                  failureKind: 'route-missing',
                  owner: 'provider-relay-route',
                  status: 404,
                },
                {
                  action: 'Expose and forward /realtime and /realtime/client_secrets.',
                  capability: 'realtime',
                  endpointPath: '/realtime',
                  failureKind: 'route-missing',
                  fallbackFailureKind: 'route-missing',
                  fallbackRoute: '/realtime/client_secrets',
                  fallbackStatus: 404,
                  owner: 'provider-relay-route',
                  status: 404,
                },
              ],
              hasCredentialConfirmedProviderAttempt: true,
              hasFullCapabilityAttempt: true,
              releaseEndpointEligible: true,
              path: '.manual-qa/live-provider-smoke-attempt-current.json',
              releaseEvidence: false,
              sourceFingerprintCurrent: true,
              status: 'failed',
            },
            credentialConfirmedAttemptRemediationActions: liveProviderActions,
            hasReleaseEligibleProviderAttempt: true,
            currentDiagnosticReport: {
              hasFullCapabilityAttempt: false,
              releaseEndpointEligible: false,
              path: '.manual-qa/live-provider-smoke-current-diagnostic.json',
              releaseEvidence: false,
              sourceFingerprintCurrent: true,
              status: 'skipped',
            },
            modelSelectionSources: {
              chat: 'requested-override',
              image: 'requested-override',
            },
            preferredProviderBlockerSource: 'credential-confirmed-full-capability-attempt',
            requestedCapabilities: {
              audio: true,
              chat: true,
              image: true,
              lowCost: true,
              realtime: true,
            },
            selectedCandidateModels: {
              audioSpeech: 'gpt-4o-mini-tts',
              audioTranscription: 'gpt-4o-transcribe',
              chat: 'gpt-5-5',
              embedding: 'text-embedding-3-large',
              image: 'gpt-image-2',
              moderation: 'omni-moderation-latest',
              realtime: 'gpt-realtime-2',
            },
            selectedSourceReport: {
              hasCredentialConfirmedProviderAttempt: true,
              hasFullCapabilityAttempt: true,
              releaseEndpointEligible: true,
              path: '.manual-qa/live-provider-smoke-attempt-current.json',
              releaseEvidence: false,
              sourceFingerprintCurrent: true,
              status: 'failed',
            },
          },
          id: 'live-provider-full-capability-release-evidence',
          nextActions: liveProviderActions,
          owner: 'external-provider-or-third-party-relay',
          status: 'failed',
          summary: 'fixture live provider blocker',
        },
        {
          blockerKind: 'live-provider-ui-browser-origin-not-passed',
          evidence: {
            blockerKind: 'live-provider-ui-browser-origin-not-passed',
            owner: 'browser-allowed-ai-proxy-or-cloudflare-worker',
            browserMessageSent: false,
            browserOriginProven: false,
            currentDiagnosticReport: {
              path: '.manual-qa/live-provider-ui-smoke-current.json',
              releaseEvidence: false,
              releaseEndpointEligible: false,
              sourceFingerprintCurrent: true,
              status: 'skipped',
            },
            localProxyContractDiagnostic: {
              browserOriginProven: false,
              browserUiExecuted: false,
              chatStatus: 200,
              harnessClosed: true,
              markerCaptured: true,
              missing: false,
              modelCount: 10,
              modelListStatus: 200,
              path: '.manual-qa/live-provider-ui-local-proxy-diagnostic.json',
              passed: true,
              providerKeyBrowserExposed: false,
              releaseEvidence: false,
              requestCredentialsAbsent: true,
              selectedModel: 'gpt-5-5',
              sourceFingerprintCurrent: true,
              status: 'passed',
              workerHostedProviderKeyConfigured: true,
            },
            failureKind: 'browser-origin-connection-check-failed-with-proxy-guidance',
            markerCaptured: false,
            preferredUiBlockerSource: 'credential-confirmed-attempt',
            preservedAttemptFailureKind:
              'browser-origin-connection-check-failed-with-proxy-guidance',
            preservedAttemptSourceFingerprintCurrent: true,
            requestedInputs: {
              browserProviderKeyInjected: false,
              proxyConfigured: false,
              syncPassphraseProvided: false,
              workerHostedProviderKeyRequested: false,
            },
            requiredRemediation: {
              actions: [
                'Configure a browser-allowed AI proxy/Cloudflare Worker root for the UI smoke, then rerun pnpm run drill:live-provider-ui.',
                'When AI proxy mode is used, provide ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE so the browser can derive the Worker access key.',
                'For Worker-hosted provider-key mode, set ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true and do not inject the provider key into the browser.',
              ],
              browserAllowedProxyRequired: true,
              kind: 'browser-allowed-ai-proxy-required',
              requiresProxyUrl: true,
              requiresSyncPassphrase: true,
              requiresWorkerHostedProviderKey: false,
            },
            browserProviderKeyInjected: true,
            selectedSourceReport: {
              path: '.manual-qa/live-provider-ui-smoke-attempt-current.json',
              releaseEvidence: false,
              releaseEndpointEligible: true,
              sourceFingerprintCurrent: true,
              status: 'failed',
            },
            attemptedBrowserOriginReport: {
              path: '.manual-qa/live-provider-ui-smoke-attempt-current.json',
              browserOriginProven: false,
              releaseEndpointEligible: true,
              failureKind: 'browser-origin-connection-check-failed-with-proxy-guidance',
              proxyPreflight: {
                browserOriginProven: false,
                chatStatus: 200,
                selectedModel: 'gpt-5-5',
                status: 'passed',
                transportPath: 'node-to-provider',
              },
              screenshot: {
                bytes: 75275,
                path: '.manual-qa/web-live-ui-provider-smoke-current-relay.png',
                sha256: '8F52F4632D8F1209A993F69AAB11F56CEC67F5FD5F166E22B5E1AE80D6F2C8AA',
              },
            },
          },
          id: 'live-provider-web-ui-browser-origin-release-evidence',
          nextActions: ['Configure a browser-allowed AI proxy/Cloudflare Worker root.'],
          owner: 'browser-allowed-ai-proxy-or-cloudflare-worker',
          status: 'failed',
          summary: 'fixture live provider UI blocker',
        },
      ],
      releaseEvidence: false,
      status: 'blocked',
    }),
    strictPreflight: fixtureReport('.manual-qa/strict-release-preflight.json', {
      releaseEvidence: false,
      status: 'blocked',
    }),
    verifyReleaseCheckpoint: fixtureReport('.manual-qa/verify-release-current.json', {
      evidenceType: 'verify-release-checkpoint-diagnostic',
      expectedFailure: true,
      expectedFailureKind: 'windows-trusted-msix-release-pass-missing',
      failedStepLabels: ['Runtime smoke artifacts'],
      failureSummary:
        'Runtime smoke artifacts failed with exit code 1\nExpected release blocker: windows-trusted-msix-release-pass-missing.\nCurrent blocker kind: windows-trusted-msix-needs-elevated-current-source-rerun.\nHost preflight: host-clear-current-shell-not-elevated; currentShellElevated=false; hostReadyForTrustedMsix=true.\nAction: run pnpm run qa:windows-msix-trusted:elevated from an elevated disposable Windows PowerShell/profile, then pnpm run check:windows-msix-trusted-report and pnpm run check:runtime-artifacts.',
      releaseEvidence: false,
      steps: [
        {
          error:
            'Runtime smoke artifacts failed with exit code 1\nExpected release blocker: windows-trusted-msix-release-pass-missing.\nCurrent blocker kind: windows-trusted-msix-needs-elevated-current-source-rerun.\nHost preflight: host-clear-current-shell-not-elevated; currentShellElevated=false; hostReadyForTrustedMsix=true.\nAction: run pnpm run qa:windows-msix-trusted:elevated from an elevated disposable Windows PowerShell/profile, then pnpm run check:windows-msix-trusted-report and pnpm run check:runtime-artifacts.',
          label: 'Runtime smoke artifacts',
          passed: false,
        },
      ],
      status: 'failed',
    }),
    windowsHostPreflight: fixtureReport('.manual-qa/windows-msix-host-preflight.json', {
      blockerClassification: {
        kind: 'no-known-windows-msix-host-blocker',
        owner: 'host-preflight',
      },
      currentShellElevated: false,
      hostReadyForTrustedMsix: true,
      releaseEvidence: false,
      status: 'clear',
      trustedMsixQaReadiness: 'host-clear-current-shell-not-elevated',
    }),
    windowsTrustedMsixPass: fixtureReport(
      '.manual-qa/windows-msix-current-trusted-install-update-qa.json',
      {
        generatedAt: '2026-06-12T01:00:00.000Z',
        passed: true,
      },
    ),
    hostedNativeCi: fixtureReport('.manual-qa/hosted-native-ci-evidence.json', {
      releaseEvidence: false,
      status: 'missing',
    }),
    liveSync: fixtureReport('.manual-qa/live-sync-release-drill-current-diagnostic.json', {
      releaseEvidence: false,
      status: 'skipped',
    }),
    liveSyncReleasePass: missingFixtureReport(
      '.manual-qa/live-sync-release-drill.json',
    ),
    liveProviderApi: fixtureReport('.manual-qa/live-provider-smoke.json', {
      releaseEvidence: true,
      status: 'passed',
    }),
    liveProviderDiagnostic: fixtureReport(
      '.manual-qa/live-provider-smoke-current-diagnostic.json',
      {
        releaseEvidence: false,
        sourceFingerprint: {
          fileCount: 23,
          kind: 'zerochat.liveProviderSourceFingerprint.v1',
          sha256: 'F'.repeat(64),
          totalBytes: 859435,
        },
        status: 'skipped',
      },
    ),
    liveProviderFull: fixtureReport('.manual-qa/live-provider-smoke-full-current.json', {
      releaseEvidence: false,
      status: 'failed',
    }),
    liveProviderUi: fixtureReport('.manual-qa/live-provider-ui-smoke-current.json', {
      releaseEvidence: false,
      sourceFingerprint: {
        fileCount: 129,
        kind: 'zerochat.liveProviderUiSourceFingerprint.v1',
        sha256: 'E'.repeat(64),
        totalBytes: 1921218,
      },
      status: 'skipped',
    }),
    liveProviderUiAttempt: fixtureReport(
      '.manual-qa/live-provider-ui-smoke-attempt-current.json',
      {
        releaseEvidence: false,
        sourceFingerprint: {
          fileCount: 129,
          kind: 'zerochat.liveProviderUiSourceFingerprint.v1',
          sha256: 'E'.repeat(64),
          totalBytes: 1921218,
        },
        status: 'failed',
      },
    ),
    nativePrereq: fixtureReport('.manual-qa/native-prereq-all-platforms.json', {
      releaseEvidence: false,
      status: 'failed',
    }),
    androidRuntime: fixtureReport('.manual-qa/android-emulator-qa.json', {
      apkEvidence: {
        sha256: 'B'.repeat(64),
      },
      contactSheetEvidence: {
        bytes: 947153,
        sha256: 'C'.repeat(64),
      },
      generatedAt: '2026-06-25T05:35:00.000Z',
      passed: true,
      screenshotBreakdown: {
        cloudSync: 10,
        ui: 40,
      },
      screenshotCount: 50,
    }),
    androidUiSmoke: fixtureReport('.manual-qa/android-ui-smoke.json', {
      generatedAt: '2026-06-25T05:34:00.000Z',
      passed: true,
    }),
    androidCloudSyncSmoke: fixtureReport('.manual-qa/android-cloud-sync-smoke.json', {
      generatedAt: '2026-06-25T05:34:30.000Z',
      passed: true,
    }),
    androidContactSheet: fixtureReport('.manual-qa/android-current-contact-sheet.json', {
      contactSheetEvidence: {
        bytes: 947153,
        sha256: 'C'.repeat(64),
      },
      generatedAt: '2026-06-25T05:35:00.000Z',
      screenshotCount: 50,
    }),
    androidContactSheetImage: fixtureReport(
      '.manual-qa/android-current-contact-sheet.png',
      {},
    ),
    webCurrentPage: fixtureReport('.manual-qa/web-current-page-qa.json', {
      browserSmoke: { passed: true },
      generatedAt: '2026-06-25T05:33:34.766Z',
      iconSyncDom: { syncSettingsOpened: true },
      passed: true,
      visualAudit: { screenshotCount: 120 },
      webSource: {
        digest: 'D'.repeat(64),
        fileCount: 294,
      },
    }),
    webCurrentPageVisual: fixtureReport(
      '.manual-qa/web-current-page-visual-audit/visual-audit-manifest.json',
      {
        generatedAt: '2026-06-25T05:32:23.097Z',
      },
    ),
    releaseVisual: fixtureReport('.visual-audit/visual-audit-manifest.json', {
      generatedAt: '2026-06-25T05:31:00.000Z',
    }),
    distIndex: fixtureReport('dist/index.html', {}),
  }
  const markdown = buildMarkdown(evidence)
  const requirementsOverlay = buildRequirementsOverlay(evidence)
  const qaCurrentOverlay = buildQaCurrentOverlay(evidence)
  const qaOpenGaps = buildQaOpenGaps(evidence)

  assertPublishSafe(markdown, 'fixture current evidence markdown')
  assertPublishSafe(requirementsOverlay, 'fixture Requirements current evidence overlay')
  assertPublishSafe(qaCurrentOverlay, 'fixture QA current evidence overlay')
  assertPublishSafe(qaOpenGaps, 'fixture QA Open Gaps')

  const androidRuntimeFixture =
    `Android emulator runtime QA 当前 2026-06-25 13:35 Asia/Shanghai 历史报告记录 50 screenshots（UI 40 / Cloudflare sync 10），\`.manual-qa/android-emulator-qa.json\` 为 1 bytes / SHA-256 \`${'0'.repeat(64)}\`，UI smoke 为 1 bytes / SHA-256 \`${'0'.repeat(64)}\`，Cloudflare sync smoke 为 1 bytes / SHA-256 \`${'0'.repeat(64)}\`，contact sheet report 为 1 bytes / SHA-256 \`${'0'.repeat(64)}\`，contact sheet PNG 为 947,153 bytes / SHA-256 \`${'C'.repeat(64)}\`，debug APK SHA-256 \`${'B'.repeat(64)}\`。当前 source-bound Android debug APK 证据不可读；现有 Android runtime 报告不能被当作当前源码证据。QA marker: Current Android runtime evidence refuses stale APK reports.`
  if (
    !markdown.includes(androidRuntimeFixture) ||
    !requirementsOverlay.includes(androidRuntimeFixture) ||
    !qaCurrentOverlay.includes(androidRuntimeFixture)
  ) {
    throw new Error('Current evidence handoff self-test lost Android emulator runtime QA evidence.')
  }

  if (!markdown.includes('All next actions:') || markdown.includes('Top next actions:')) {
    throw new Error('Current evidence handoff must render an untruncated next-actions section.')
  }

  if (
    !markdown.includes(
      'Hosted native CI local handoff readiness: git remote false, gh CLI false, gh auth false, artifact fetch ready false; diagnostic commands `git status --porcelain=v1 --untracked-files=all`, `git status --porcelain=v1 --untracked-files=all -- <native-source-roots-from-.manual-qa/native-prereq-all-platforms.json>`, `git remote get-url origin`, `gh --version`, `gh auth status`.',
    )
  ) {
    throw new Error('Current evidence handoff self-test lost hosted native CI local handoff readiness.')
  }

  const ownershipMatrixFixture =
    'Release blocker ownership matrix: `hosted-native-ci-release-evidence` status `missing`, blockerKind `missing-hosted-native-ci-release-evidence`, owner `release-operator-github-actions`'
  const ownershipMatrixWindowsFixture =
    '`windows-trusted-msix-release-pass` status `blocked`, blockerKind `windows-trusted-msix-needs-elevated-current-source-rerun`, owner `windows-release-qa-operator`'
  const ownershipMatrixUiFixture =
    '`live-provider-web-ui-browser-origin-release-evidence` status `failed`, blockerKind `live-provider-ui-browser-origin-not-passed`, owner `browser-allowed-ai-proxy-or-cloudflare-worker`'
  if (
    !markdown.includes(ownershipMatrixFixture) ||
    !markdown.includes(ownershipMatrixWindowsFixture) ||
    !markdown.includes(ownershipMatrixUiFixture) ||
    !requirementsOverlay.includes(ownershipMatrixFixture) ||
    !requirementsOverlay.includes(ownershipMatrixWindowsFixture) ||
    !requirementsOverlay.includes(ownershipMatrixUiFixture) ||
    !qaCurrentOverlay.includes(ownershipMatrixFixture) ||
    !qaCurrentOverlay.includes(ownershipMatrixWindowsFixture) ||
    !qaCurrentOverlay.includes(ownershipMatrixUiFixture)
  ) {
    throw new Error('Current evidence handoff self-test lost release blocker ownership matrix.')
  }

  if (
    !markdown.includes(
      'Verify-release checkpoint failure detail: failed `Runtime smoke artifacts` is expected blocker `windows-trusted-msix-release-pass-missing`; current release blockerKind is `windows-trusted-msix-needs-elevated-current-source-rerun`, owner `windows-release-qa-operator`; Windows host preflight status `clear`, trustedMsixQaReadiness `host-clear-current-shell-not-elevated`; current MSIX package-candidate staged web matches dist: `true`, package-internal web matches dist: `true`, package-internal web matches stage: `true`; next proof gate `run pnpm run qa:windows-msix-trusted:elevated from an elevated disposable Windows profile`; this is diagnostic-only and not release evidence.',
    )
    || !requirementsOverlay.includes(
      'Verify-release checkpoint failure detail: failed `Runtime smoke artifacts` is expected blocker `windows-trusted-msix-release-pass-missing`; current release blockerKind is `windows-trusted-msix-needs-elevated-current-source-rerun`, owner `windows-release-qa-operator`; Windows host preflight status `clear`, trustedMsixQaReadiness `host-clear-current-shell-not-elevated`; current MSIX package-candidate staged web matches dist: `true`, package-internal web matches dist: `true`, package-internal web matches stage: `true`; next proof gate `run pnpm run qa:windows-msix-trusted:elevated from an elevated disposable Windows profile`; this is diagnostic-only and not release evidence.',
    )
    || !qaCurrentOverlay.includes(
      'Verify-release checkpoint failure detail: failed `Runtime smoke artifacts` is expected blocker `windows-trusted-msix-release-pass-missing`; current release blockerKind is `windows-trusted-msix-needs-elevated-current-source-rerun`, owner `windows-release-qa-operator`; Windows host preflight status `clear`, trustedMsixQaReadiness `host-clear-current-shell-not-elevated`; current MSIX package-candidate staged web matches dist: `true`, package-internal web matches dist: `true`, package-internal web matches stage: `true`; next proof gate `run pnpm run qa:windows-msix-trusted:elevated from an elevated disposable Windows profile`; this is diagnostic-only and not release evidence.',
    )
  ) {
    throw new Error('Current evidence handoff self-test lost verify-release failure root-cause detail.')
  }

  const compoundFailure = [
    'Runtime smoke artifacts failed with exit code 1',
    'Runtime smoke artifact checks failed:',
    '- .manual-qa/windows-msix-current-trusted-install-update-qa.failure.json blockerClassification=windows-appx-deployment-deleted-package-cleanup-access-denied owner=host-windows-appx-deployment-service releaseEvidence=false',
    '- .manual-qa/windows-msix-host-preflight.json current host preflight status=blocked trustedMsixQaReadiness=host-blocked',
    '- .manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint CURRENT',
  ].join('\n')
  const compoundEvidence = {
    ...evidence,
    releaseDiagnostics: fixtureReport('.manual-qa/release-diagnostics-current.json', {
      ...evidence.releaseDiagnostics.json,
      runtimeArtifactExpectedBlocker: {
        additionalExpectedBlockers: [
          {
            classification: 'live-sync-current-source-release-pass-missing',
            id: 'disposable-live-sync-release-pass',
            reportPath: '.manual-qa/live-sync-release-drill.json',
          },
        ],
      },
    }),
    verifyReleaseCheckpoint: fixtureReport('.manual-qa/verify-release-current.json', {
      evidenceType: 'verify-release-checkpoint-diagnostic',
      expectedFailure: false,
      expectedFailureKind: null,
      failedStepLabels: ['Runtime smoke artifacts'],
      failureSummary: compoundFailure,
      releaseEvidence: false,
      steps: [
        {
          error: compoundFailure,
          label: 'Runtime smoke artifacts',
          passed: false,
        },
      ],
      status: 'failed',
    }),
  }
  const compoundFailureDetail = verifyReleaseFailureDetailLine(compoundEvidence)

  if (
    !compoundFailureDetail.includes(
      'contains the Windows trusted-MSIX blocker plus independent blocker evidence and is intentionally not classified as Windows-only',
    ) ||
    !compoundFailureDetail.includes(
      '`disposable-live-sync-release-pass` (`live-sync-current-source-release-pass-missing`)',
    ) ||
    compoundFailureDetail.includes('is expected blocker `windows-trusted-msix-release-pass-missing`')
  ) {
    throw new Error('Current evidence handoff self-test lost compound runtime blocker detail.')
  }

  const windowsCurrentBlockerText =
    'Windows trusted MSIX current blocker semantics: blockerKind `windows-trusted-msix-needs-elevated-current-source-rerun`, owner `windows-release-qa-operator`; currentTrustedQaState `host-clear-needs-elevated-trusted-msix-rerun`; needsElevatedTrustedQaRerun true; nextProofGate `run pnpm run qa:windows-msix-trusted:elevated from an elevated disposable Windows profile`; hostPreflight status `clear`, trustedMsixQaReadiness `host-clear-current-shell-not-elevated`; historicalTrustedQaFailureKind `windows-appx-deployment-deleted-package-cleanup-access-denied`, historicalTrustedQaFailureOwner `host-windows-appx-deployment-service`.'

  if (
    !requirementsOverlay.includes(windowsCurrentBlockerText) ||
    !requirementsOverlay.includes('Windows trusted MSIX 当前 blocker 语义：') ||
    !qaCurrentOverlay.includes(windowsCurrentBlockerText) ||
    !qaOpenGaps.includes(windowsCurrentBlockerText) ||
    !qaOpenGaps.includes('blockerClassification `no-known-windows-msix-host-blocker`') ||
    !qaOpenGaps.includes(
      'The historical trusted-MSIX AppX failure is stale-dist diagnostic context, not the current blocker root.',
    ) ||
    !qaOpenGaps.includes('remains a historical AppXDeploymentServer') ||
    !qaOpenGaps.includes(
      'The current host preflight is clear but the current shell is not elevated, so\n  the next proof must be an elevated disposable-host trusted install/update\n  rerun.',
    ) ||
    qaOpenGaps.includes('remains the current host AppXDeploymentServer') ||
    requirementsOverlay.includes('Windows trusted MSIX blocker 当前为 host AppX deployment-service cleanup corruption') ||
    qaOpenGaps.includes('the current host preflight is\nWindows trusted MSIX current blocker semantics') ||
    qaOpenGaps.includes('current host preflight is\nWindows trusted MSIX current blocker semantics')
  ) {
    throw new Error('Current evidence handoff self-test lost Windows trusted MSIX current-vs-historical blocker semantics.')
  }

  if (
    !markdown.includes(
      'Hosted native CI current-source coverage: current-source coverage `gitWorktreeDirty: true`, `nativeSourceWorktreeDirty: true`, `gitStatusEntryCount: 782`, `nativeSourceStatusEntryCount: 356`, `hostedCiCoversCurrentWorktree: false`, `hostedCiCoversCurrentNativeSource: false`, `releaseEvidenceHandoffReady: false`.',
    )
  ) {
    throw new Error('Current evidence handoff self-test lost hosted native CI current-source coverage.')
  }

  if (
    !markdown.includes(
      'Apple target-host runtime evidence: targetRuntimeEvidenceRequired true; targetHost `macOS with Xcode/Swift`; currentHostSatisfiesTargetRuntime false; localPreflightIsRuntimeEvidence false; runtimeQaMustRunOnTargetHost true; requiredHostTools `swift` / `xcodebuild`; requiredProof `target-host build log` / `target-host runtime screenshot` / `target-host visual QA` / `target-host sync QA` / `target-host package-size evidence`.',
    )
  ) {
    throw new Error('Current evidence handoff self-test lost Apple target-host runtime evidence semantics.')
  }

  if (
    !markdown.includes(
      'Linux target-host runtime evidence: targetRuntimeEvidenceRequired true; targetHost `Linux or WSL with GTK4/libadwaita and Secret Service`; currentHostSatisfiesTargetRuntime false; localPreflightIsRuntimeEvidence false; runtimeQaMustRunOnTargetHost true; requiredHostTools `cargo` / `pkg-config` / `secret-tool` / `pkg-config gtk4` / `pkg-config libadwaita-1`; deferredTargetChecks `cargo` / `pkg-config` / `secret-tool` / `pkg-config gtk4` / `pkg-config libadwaita-1`; requiredProof `target-host build log` / `target-host runtime screenshot` / `target-host visual QA` / `target-host sync QA` / `target-host Secret Service QA` / `target-host package-size evidence`.',
    )
  ) {
    throw new Error('Current evidence handoff self-test lost Linux target-host runtime evidence semantics.')
  }

  if (
    !markdown.includes(
      'Live sync blocker source fingerprint: current true; 31 files / 573,962 bytes; SHA-256',
    ) ||
    !markdown.includes('A'.repeat(64))
  ) {
    throw new Error('Current evidence handoff self-test lost live-sync sourceFingerprint.current.')
  }

  if (
    !markdown.includes(
      `Live sync release-pass input binding: blockerKind \`missing-live-sync-release-inputs\`; mode \`none\`; remoteTouched false; missingInputKeys \`liveSyncMode\` / \`providerSpecificDisposableCredential\` / \`destructiveConfirmation\` / \`throwawaySyncPassphrase\`; supportedModes \`cloudflare\` / \`gist\`; sourceFingerprint.current true, 31 files / 573,962 bytes / SHA-256 \`${'A'.repeat(64)}\`.`,
    )
  ) {
    throw new Error('Current evidence handoff self-test lost live-sync release-pass input binding semantics.')
  }

  if (
    !markdown.includes(
      'Live provider UI browser-origin proxy preflight semantics: top-level browserOriginProven false; proxyPreflight.status `passed`, transportPath `node-to-provider`, browserOriginProven false, selectedModel `gpt-5-5`, chatStatus `200`; Node-side preflight is not browser-origin release evidence.',
    )
  ) {
    throw new Error('Current evidence handoff self-test lost live-provider UI browser-origin preflight semantics.')
  }

  const liveProviderUiLocalProxyText =
    'Live provider UI loopback Worker contract diagnostic: path `.manual-qa/live-provider-ui-local-proxy-diagnostic.json`, status `passed`, releaseEvidence false, browserUiExecuted false, browserOriginProven false, workerHostedProviderKeyConfigured true, providerKeyBrowserExposed false, requestCredentialsAbsent true, modelListStatus `200`, chatStatus `200`, selectedModel `gpt-5-5`, markerCaptured true, harnessClosed true, sourceFingerprintCurrent true; loopback contract proof is diagnostic-only and does not prove a deployed browser origin.'
  if (
    !markdown.includes(liveProviderUiLocalProxyText) ||
    !requirementsOverlay.includes(liveProviderUiLocalProxyText) ||
    !qaCurrentOverlay.includes(liveProviderUiLocalProxyText) ||
    !qaOpenGaps.includes(liveProviderUiLocalProxyText)
  ) {
    throw new Error(
      'Current evidence handoff self-test lost diagnostic-only live-provider UI loopback Worker contract evidence.',
    )
  }

  if (
    !markdown.includes(
      'Live provider UI browser-origin evidence source binding: preferredUiBlockerSource `credential-confirmed-attempt`; blockerKind `live-provider-ui-browser-origin-not-passed`; selectedFailureKind `browser-origin-connection-check-failed-with-proxy-guidance`; preservedAttemptFailureKind `browser-origin-connection-check-failed-with-proxy-guidance`; selectedSourceReport `.manual-qa/live-provider-ui-smoke-attempt-current.json`, status `failed`, releaseEvidence false, releaseEndpointEligible true, sourceFingerprintCurrent true; currentDiagnosticReport `.manual-qa/live-provider-ui-smoke-current.json`, status `skipped`, releaseEvidence false, releaseEndpointEligible false, sourceFingerprintCurrent true; preservedAttemptSourceFingerprintCurrent true; browserOriginProven false; markerCaptured false; browserMessageSent false; requestedInputs proxyConfigured false, syncPassphraseProvided false, workerHostedProviderKeyRequested false; browserProviderKeyInjected true; selectedScreenshot `.manual-qa/web-live-ui-provider-smoke-current-relay.png`, 75,275 bytes / SHA-256 `8F52F4632D8F1209A993F69AAB11F56CEC67F5FD5F166E22B5E1AE80D6F2C8AA`; preservedAttemptScreenshot `.manual-qa/web-live-ui-provider-smoke-current-relay.png`, 75,275 bytes / SHA-256 `8F52F4632D8F1209A993F69AAB11F56CEC67F5FD5F166E22B5E1AE80D6F2C8AA`.',
    )
  ) {
    throw new Error('Current evidence handoff self-test lost live-provider UI source-binding evidence semantics.')
  }

  const liveProviderUiRequiredRemediationText =
    'Live provider UI required remediation: kind `browser-allowed-ai-proxy-required`; browserAllowedProxyRequired true; requiresProxyUrl true; requiresSyncPassphrase true; requiresWorkerHostedProviderKey false; actionCount 3; actions `Configure a browser-allowed AI proxy/Cloudflare Worker root for the UI smoke, then rerun pnpm run drill:live-provider-ui.` / `When AI proxy mode is used, provide ZEROCHAT_LIVE_PROVIDER_UI_SYNC_PASSPHRASE so the browser can derive the Worker access key.` / `For Worker-hosted provider-key mode, set ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true and do not inject the provider key into the browser.`.'

  if (
    !markdown.includes(liveProviderUiRequiredRemediationText) ||
    !requirementsOverlay.includes(liveProviderUiRequiredRemediationText) ||
    !qaCurrentOverlay.includes(liveProviderUiRequiredRemediationText) ||
    !qaOpenGaps.includes(liveProviderUiRequiredRemediationText)
  ) {
    throw new Error('Current evidence handoff self-test lost live-provider UI required-remediation semantics.')
  }

  const liveProviderUiFingerprintText =
    `Live-provider UI source fingerprint schema \`zerochat.liveProviderUiSourceFingerprint.v1\`; 129 files / 1,921,218 bytes; SHA-256 \`${'E'.repeat(64)}\`.`

  if (
    !markdown.includes(liveProviderUiFingerprintText) ||
    !requirementsOverlay.includes(liveProviderUiFingerprintText) ||
    !qaCurrentOverlay.includes(liveProviderUiFingerprintText) ||
    !qaOpenGaps.includes(
      `UI source fingerprint schema \`zerochat.liveProviderUiSourceFingerprint.v1\`, 129 files / 1,921,218 / SHA-256 \`${'E'.repeat(64)}\``,
    )
  ) {
    throw new Error('Current evidence handoff self-test lost live-provider UI source fingerprint schema evidence.')
  }

  const passedUiEvidence = structuredClone(evidence)
  passedUiEvidence.releaseBlockers.json.blockers =
    passedUiEvidence.releaseBlockers.json.blockers.filter(
      (blocker) => blocker.id !== 'live-provider-web-ui-browser-origin-release-evidence',
    )
  passedUiEvidence.releaseBlockers.json.blockerCount =
    passedUiEvidence.releaseBlockers.json.blockers.length
  const passedUiFingerprint = {
    fileCount: 129,
    kind: 'zerochat.liveProviderUiSourceFingerprint.v1',
    roots: ['src/app', 'scripts/live-provider-ui-smoke.mjs'],
    sha256: 'E'.repeat(64),
    totalBytes: 1921218,
  }
  passedUiEvidence.liveProviderUi.json = {
    browserOriginProven: false,
    kind: 'zerochat.liveProviderUiSmoke.v1',
    releaseEndpointEligible: false,
    releaseEvidence: false,
    safeToPublish: true,
    sourceFingerprint: passedUiFingerprint,
    status: 'skipped',
  }
  passedUiEvidence.liveProviderUiAttempt.json = {
    browserMessageSent: true,
    browserProxyReadiness: {
      attemptCount: 2,
      consecutivePasses: 2,
      defaultUserAgentHeadless: true,
      effectiveUserAgentHeadless: false,
      originMatchesExpected: true,
      status: 'passed',
      statusCode: 403,
    },
    browserNetworkTrace: [
      {
        action: 'models',
        hasProviderAuthorization: false,
        hasProxyAccessKey: true,
        method: 'GET',
        outcome: 'response-canceled',
        path: '/proxy',
        status: 200,
      },
      {
        action: 'chat',
        hasProviderAuthorization: false,
        hasProxyAccessKey: true,
        method: 'POST',
        outcome: 'response-canceled',
        path: '/proxy',
        status: 200,
      },
    ],
    browserOriginProven: true,
    browserProviderKeyInjected: false,
    assistantMarkerExact: true,
    chatFeatureHintDismissed: true,
    generatedAt: '2026-06-25T05:45:00.000Z',
    kind: 'zerochat.liveProviderUiSmoke.v1',
    markerCaptured: true,
    proxyPreflight: {
      browserOriginProven: false,
      chatStatus: 200,
      selectedModel: 'gpt-5-5',
      status: 'passed',
      transportPath: 'node-to-ai-proxy',
    },
    releaseEndpointEligible: true,
    releaseEvidence: true,
    requestedInputs: {
      browserProviderKeyInjected: false,
      proxyConfigured: true,
      syncPassphraseProvided: true,
      workerHostedProviderKeyRequested: true,
    },
    safeToPublish: true,
    screenshot: {
      bytes: 51027,
      path: '.manual-qa/web-live-ui-provider-smoke-current-relay.png',
      sha256: 'F'.repeat(64),
    },
    sourceFingerprint: passedUiFingerprint,
    status: 'passed',
  }
  const passedUiMarkdown = buildMarkdown(passedUiEvidence)
  const passedUiRequirements = buildRequirementsOverlay(passedUiEvidence)
  const passedUiQaCurrent = buildQaCurrentOverlay(passedUiEvidence)
  const passedUiQaOpenGaps = buildQaOpenGaps(passedUiEvidence)
  const passedUiSourceBinding = liveProviderUiSourceBindingLine(passedUiEvidence)

  if (
    !passedUiMarkdown.includes(
      'Live provider UI browser-origin release evidence: passed on the current source; no residual UI blocker is present.',
    ) ||
    !passedUiRequirements.includes('- 当前 live-provider UI browser-origin 证据语义：') ||
    !passedUiRequirements.includes(
      '- [x] 当前 live-provider UI browser-origin 证据语义：current-source browser-origin release evidence is passed',
    ) ||
    !passedUiRequirements.includes('- 当前 live-provider UI required remediation：') ||
    !passedUiRequirements.includes('- 当前 live-provider UI source fingerprint：') ||
    !passedUiRequirements.includes(
      '剩余 release blockers（6）：`hosted-native-ci-release-evidence` / `disposable-live-sync-release-pass` / `apple-target-runtime-qa` / `linux-target-runtime-qa` / `windows-trusted-msix-release-pass` / `live-provider-full-capability-release-evidence`。',
    ) ||
    !passedUiQaCurrent.includes(passedUiSourceBinding) ||
    !passedUiQaOpenGaps.includes('Top current blocker summary: 6 residual blockers remain:') ||
    !passedUiQaOpenGaps.includes(
      'Live-provider Web UI browser-origin release evidence is passed and is no longer a blocker:',
    ) ||
    !passedUiQaOpenGaps.includes(
      'The later no-credential current diagnostic does not reopen the passed current-source attempt.',
    ) ||
    passedUiQaOpenGaps.includes('browser-origin release evidence remains open') ||
    !passedUiSourceBinding.includes(
      'preferredUiEvidenceSource `credential-confirmed-passed-attempt`; blockerPresent false',
    ) ||
    !passedUiSourceBinding.includes('browserProviderKeyInjected false') ||
    !passedUiRequirements.includes(
      'Live provider UI required remediation: none; current-source browser-origin release evidence is already passed.',
    )
  ) {
    throw new Error(
      'Current evidence handoff self-test failed to preserve a passed current-source live-provider UI attempt after a no-credential diagnostic refresh.',
    )
  }

  if (
    !markdown.includes(
      'Live provider full-capability evidence source binding: preferredProviderBlockerSource `credential-confirmed-full-capability-attempt`; blockerKind `failed-live-provider-capabilities`;',
    ) ||
    !markdown.includes(
      'capabilityFailureModelAttempts embeddings /embeddings [text-embedding-3-large:failed:HTTP 404:model-missing / text-embedding-3-small:failed:HTTP 404:model-missing]',
    ) ||
    !markdown.includes(
      'capabilityFailureSummary.total 0, affectedCapabilities `none`, routeHealthBlockers `none`.',
    )
  ) {
    throw new Error('Current evidence handoff self-test lost live-provider full-capability source-binding evidence semantics.')
  }

  const liveProviderFullRequiredRemediationText = liveProviderFullRequiredRemediationLine(
    releaseBlockerById(evidence, 'live-provider-full-capability-release-evidence')?.evidence ?? {},
  )

  if (
    !liveProviderFullRequiredRemediationText.includes(
      'source `credential-confirmed-attempt-context`',
    ) ||
    !liveProviderFullRequiredRemediationText.includes('capabilityRemediationHintCount 5') ||
    !liveProviderFullRequiredRemediationText.includes(
      '`embeddings /embeddings provider-model-catalog-or-override HTTP 404 model-missing`',
    ) ||
    !liveProviderFullRequiredRemediationText.includes(
      '`realtime /realtime provider-relay-route HTTP 404 route-missing; fallback /realtime/client_secrets HTTP 404 route-missing`',
    ) ||
    !markdown.includes(liveProviderFullRequiredRemediationText) ||
    !requirementsOverlay.includes(liveProviderFullRequiredRemediationText) ||
    !qaCurrentOverlay.includes(liveProviderFullRequiredRemediationText) ||
    !qaOpenGaps.includes(liveProviderFullRequiredRemediationText)
  ) {
    throw new Error('Current evidence handoff self-test lost live-provider full-capability required-remediation semantics.')
  }

  if (
    !markdown.includes(
      'Preserved credential-confirmed full-capability attempt remains historical remediation context: `capabilityFailureSummary.total = 5`, `affectedCapabilities` = `audio-speech / audio-transcription / embeddings / moderation / realtime`, `routeHealthBlockers` = `audio-speech / audio-transcription / embeddings / moderation / realtime`, `credentialConfirmedAttemptRemediationActions = 5`; rerun `pnpm run drill:live-provider` on the current source before claiming release evidence.',
    )
  ) {
    throw new Error('Current evidence handoff self-test lost stale live-provider attempt rerun-current-source context.')
  }

  const missing = liveProviderActions.filter((action) => !markdown.includes(action))
  if (missing.length) {
    throw new Error(
      `Current evidence handoff self-test lost next actions: ${missing.join(', ')}`,
    )
  }
}

function assertVerifyReleaseCheckpointFreshnessSelfTest() {
  const baseEvidence = {
    verifyReleaseCheckpoint: fixtureReport('.manual-qa/verify-release-current.json', {
      generatedAt: '2026-06-25T05:00:00.000Z',
    }),
    releaseDiagnostics: fixtureReport('.manual-qa/release-diagnostics-current.json', {
      generatedAt: '2026-06-25T04:59:00.000Z',
    }),
    releaseBlockers: fixtureReport('.manual-qa/release-blockers-current.json', {
      generatedAt: '2026-06-25T04:58:00.000Z',
    }),
    webCurrentPage: fixtureReport('.manual-qa/web-current-page-qa.json', {
      generatedAt: '2026-06-25T04:57:00.000Z',
    }),
  }

  assertVerifyReleaseCheckpointFreshness(baseEvidence)

  let rejected = false

  try {
    assertVerifyReleaseCheckpointFreshness({
      ...baseEvidence,
      releaseDiagnostics: fixtureReport('.manual-qa/release-diagnostics-current.json', {
        generatedAt: '2026-06-25T05:01:00.000Z',
      }),
    })
  } catch {
    rejected = true
  }

  if (!rejected) {
    throw new Error('Current evidence handoff self-test accepted a stale verify-release checkpoint.')
  }

  rejected = false

  try {
    assertVerifyReleaseCheckpointFreshness({
      ...baseEvidence,
      webCurrentPage: fixtureReport('.manual-qa/web-current-page-qa.json', {
        generatedAt: '2026-06-25T05:01:00.000Z',
      }),
    })
  } catch {
    rejected = true
  }

  if (!rejected) {
    throw new Error(
      'Current evidence handoff self-test accepted a checkpoint older than current Web QA.',
    )
  }
}

function assertCurrentMsixPackageCandidateFreshnessSelfTest() {
  const currentPackageEvidence = {
    path: paths.windowsCurrentMsixPackageCandidate,
    bytes: 1234,
    sha256: 'A'.repeat(64),
  }
  const matchingEvidence = {
    releaseBlockers: fixtureReport('.manual-qa/release-blockers-current.json', {
      blockers: [
        {
          id: 'windows-trusted-msix-release-pass',
          evidence: {
            currentMsixPackageCandidate: { ...currentPackageEvidence },
          },
        },
      ],
    }),
    currentWindowsMsixPackageCandidate: currentPackageEvidence,
  }

  assertCurrentMsixPackageCandidateFreshness(matchingEvidence)
  assertThrowsMatching(
    'a stale MSIX package candidate',
    () =>
      assertCurrentMsixPackageCandidateFreshness({
        ...matchingEvidence,
        currentWindowsMsixPackageCandidate: {
          ...currentPackageEvidence,
          bytes: currentPackageEvidence.bytes + 1,
        },
      }),
    /package-candidate evidence does not match the current package on disk/u,
  )
}

function extractMarkedText(text, startMarker, endMarker, label) {
  const startIndex = text.indexOf(startMarker)
  const endIndex = text.indexOf(endMarker)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`${label} current evidence markers are missing or out of order.`)
  }

  return text.slice(startIndex, endIndex + endMarker.length)
}

function assertNoUncheckedChecklistBeforeCurrentEvidence(source, marker, label) {
  const markerIndex = source.indexOf(marker)

  if (markerIndex < 0) {
    throw new Error(`${label} is missing current evidence marker ${marker}.`)
  }

  const uncheckedLines = source.slice(0, markerIndex).match(/^- \[ \].*$/gmu) ?? []
  if (uncheckedLines.length) {
    throw new Error(
      `${label} must not contain unchecked diagnostic or changelog items before the current evidence overlay: ${uncheckedLines.join(' | ')}`,
    )
  }
}

function assertNoUncheckedChecklistBeforeCurrentEvidenceSelfTest() {
  const marker = '<!-- fixture-current-evidence:start -->'

  assertNoUncheckedChecklistBeforeCurrentEvidence(
    `- historical diagnostic\n- [x] completed hardening\n${marker}\n- [ ] current blocker`,
    marker,
    'fixture Requirements',
  )
  assertThrowsMatching(
    'unchecked pre-overlay diagnostic',
    () =>
      assertNoUncheckedChecklistBeforeCurrentEvidence(
        `- [ ] stale diagnostic\n${marker}\n- [ ] current blocker`,
        marker,
        'fixture Requirements',
      ),
    /must not contain unchecked diagnostic or changelog items before the current evidence overlay/u,
  )
}

function assertCurrentEvidenceDocumentContract(requirements, qaAudit) {
  const requirementsBytes = Buffer.byteLength(requirements, 'utf8')
  const qaBytes = Buffer.byteLength(qaAudit, 'utf8')
  if (requirementsBytes > 500_000 || qaBytes > 300_000) {
    throw new Error(
      `Generated evidence documents exceed stable size limits: requirements=${requirementsBytes}, qa=${qaBytes}.`,
    )
  }
  if (/^## 历史发布证据覆盖层/mu.test(requirements)) {
    throw new Error('Requirements must not contain historical release evidence overlays.')
  }
  if (/^## \d{4}-\d{2}-\d{2}/mu.test(qaAudit)) {
    throw new Error('QA Audit must not contain dated historical run sections.')
  }
  for (const [source, start, end, label] of [
    [requirements, '<!-- zerochat-current-evidence:requirements:start -->', '<!-- zerochat-current-evidence:requirements:end -->', 'Requirements'],
    [qaAudit, '<!-- zerochat-current-evidence:qa-overlay:start -->', '<!-- zerochat-current-evidence:qa-overlay:end -->', 'QA Audit'],
  ]) {
    if ((source.split(start).length - 1) !== 1 || (source.split(end).length - 1) !== 1) {
      throw new Error(`${label} must contain exactly one current evidence marker pair.`)
    }
    if (!source.endsWith('\n') || source.endsWith('\n\n')) {
      throw new Error(`${label} must end with exactly one newline.`)
    }
    if (/[ \t]+$/mu.test(source)) {
      throw new Error(`${label} must not contain trailing whitespace.`)
    }
    for (const marker of currentProductContractMarkerStrings) {
      if ((source.split(marker).length - 1) !== 1) {
        throw new Error(`${label} must contain exactly one current product contract marker: ${marker}`)
      }
    }
    for (const marker of currentLiveSyncContractMarkerStrings) {
      if ((source.split(marker).length - 1) !== 1) {
        throw new Error(`${label} must contain exactly one current live-sync contract marker: ${marker}`)
      }
    }
  }
}

async function assertDocsContainCurrentEvidence(evidence) {
  const requirements = await readFile(paths.requirements, 'utf8')
  const qaAudit = await readFile(paths.qaAudit, 'utf8')
  const requirementsStartMarker = '<!-- zerochat-current-evidence:requirements:start -->'
  const requirementsEndMarker = '<!-- zerochat-current-evidence:requirements:end -->'
  const qaStartMarker = '<!-- zerochat-current-evidence:qa-overlay:start -->'
  const qaEndMarker = '<!-- zerochat-current-evidence:qa-overlay:end -->'
  const requirementsMarkedText = extractMarkedText(
    requirements,
    requirementsStartMarker,
    requirementsEndMarker,
    'docs/REQUIREMENTS.md',
  )
  const qaMarkedText = extractMarkedText(
    qaAudit,
    qaStartMarker,
    qaEndMarker,
    'docs/QA_AUDIT.md',
  )
  const qaOpenGapsMatch = qaAudit.match(/## Open Gaps\r?\n[\s\S]*?(?=\r?\n## |\s*$)/u)

  if (!qaOpenGapsMatch) {
    throw new Error('docs/QA_AUDIT.md current Open Gaps section is missing.')
  }
  assertNoUncheckedChecklistBeforeCurrentEvidence(
    requirements,
    requirementsStartMarker,
    paths.requirements,
  )
  const currentDocs = `${requirementsMarkedText}\n${qaMarkedText}\n${qaOpenGapsMatch[0]}`
  const uiEvidencePassed = liveProviderUiEvidenceState(evidence).passed
  const liveSyncEvidencePassed = !releaseBlockerById(
    evidence,
    'disposable-live-sync-release-pass',
  )
  const synchronizedRequirements = syncLiveProviderUiMilestoneChecklist(
    syncLiveSyncRequirementsMilestoneChecklist(requirements, liveSyncEvidencePassed),
    uiEvidencePassed,
  )
  const synchronizedQaAudit = syncLiveProviderUiQaResidualChecklist(
    syncLiveSyncQaResidualChecklist(qaAudit, liveSyncEvidencePassed),
    uiEvidencePassed,
  )

  if (synchronizedRequirements !== requirements) {
    throw new Error(
      'docs/REQUIREMENTS.md milestone release checklist is stale. Run pnpm run sync:current-evidence.',
    )
  }
  if (synchronizedQaAudit !== qaAudit) {
    throw new Error(
      'docs/QA_AUDIT.md release residual checklist is stale. Run pnpm run sync:current-evidence.',
    )
  }

  assertPublishSafe(requirementsMarkedText, 'written Requirements current evidence overlay')
  assertPublishSafe(qaMarkedText, 'written QA current evidence overlay')
  assertPublishSafe(qaOpenGapsMatch[0], 'written QA Open Gaps')
  assertCurrentReleaseResidualChecklist(qaAudit, evidence.releaseBlockers)
  assertRequirementsOverlayBlockerChecklist(requirementsMarkedText, evidence.releaseBlockers)
  const requirementsStartMarkerCount = requirements.split(requirementsStartMarker).length - 1
  const requirementsEndMarkerCount = requirements.split(requirementsEndMarker).length - 1
  const qaStartMarkerCount = qaAudit.split(qaStartMarker).length - 1
  const qaEndMarkerCount = qaAudit.split(qaEndMarker).length - 1
  assertCurrentEvidenceDocumentContract(requirements, qaAudit)
  const requirementsCurrentOverlayCount = requirements.match(
    /^## 当前发布证据覆盖层（/gmu,
  )?.length ?? 0
  const releaseDiagnosticsTime = asiaShanghaiDateTime(
    generatedAtOf(evidence.releaseDiagnostics.json),
  )
  const liveSyncBlocker = releaseBlockerById(
    evidence,
    'disposable-live-sync-release-pass',
  )
  const liveProviderBlocker = releaseBlockerById(
    evidence,
    'live-provider-full-capability-release-evidence',
  )
  const liveProviderSourceBindingText = liveProviderBlocker?.evidence
    ? liveProviderSourceBindingLine(liveProviderBlocker.evidence)
    : 'Live provider full-capability evidence source binding is not reported.'
  const liveProviderFullRequiredRemediationText = liveProviderFullRequiredRemediationLine(
    liveProviderBlocker?.evidence ?? {},
  )
  const liveProviderUiFingerprintText = sourceFingerprintSummaryLine(
    'Live-provider UI',
    liveProviderUiSourceFingerprint(evidence),
    'zerochat.liveProviderUiSourceFingerprint.v1',
  )
  const liveProviderUiRequiredRemediationText = liveProviderUiRequiredRemediationLine(evidence)
  const liveProviderHistoricalAttemptText = liveProviderHistoricalAttemptContextLine(
    liveProviderBlocker?.evidence ?? {},
  )
  const verifyFailureDetail = verifyReleaseFailureDetailLine(evidence)
  const requiredFragments = [
    evidence.releaseDiagnostics.sha256,
    evidence.releaseBlockers.sha256,
    evidence.verifyReleaseCheckpoint.sha256,
    evidence.strictPreflight.sha256,
    evidence.windowsHostPreflight.sha256,
   evidence.hostedNativeCi.sha256,
   evidence.liveSync.sha256,
    evidence.liveSyncReleasePass.sha256,
   evidence.liveProviderApi.sha256,
    evidence.liveProviderDiagnostic.sha256,
    evidence.liveProviderFull.sha256,
    evidence.liveProviderUi.sha256,
    evidence.liveProviderUiAttempt.sha256,
    evidence.nativePrereq.sha256,
    evidence.androidRuntime.sha256,
    evidence.androidUiSmoke.sha256,
    evidence.androidCloudSyncSmoke.sha256,
    evidence.androidContactSheet.sha256,
    evidence.androidContactSheetImage.sha256,
    evidence.webCurrentPage.sha256,
    evidence.webCurrentPageVisual.sha256,
    evidence.releaseVisual.sha256,
    evidence.distIndex.sha256,
    evidence.windowsTrustedMsixFailure.sha256,
    evidence.webCurrentPage.json.webSource?.digest ?? '',
    releaseDiagnosticsTime,
    paths.verifyReleaseCheckpoint,
    'pnpm run check:verify-release-checkpoint',
    verifyFailureDetail,
    androidRuntimeEvidenceLine(evidence),
    'Current diagnostic overlay',
    '当前发布证据覆盖层',
    liveProviderUiProxyPreflightLine(evidence),
    liveProviderUiLocalProxyContractLine(evidence),
    liveProviderUiSourceBindingLine(evidence),
    liveProviderUiRequiredRemediationText,
    liveProviderUiFingerprintText,
    liveProviderSourceBindingText,
    liveProviderFullRequiredRemediationText,
    liveProviderHistoricalAttemptText,
    liveSyncCanonicalReleaseEvidenceLine(evidence, liveSyncBlocker),
    ...(liveSyncBlocker
      ? ['missing-live-sync-release-inputs', 'supportedModes']
      : ['Live sync canonical release pass:']),
    'preferredProviderBlockerSource',
    'sourceFingerprintCurrent true',
    uiEvidencePassed ? 'preferredUiEvidenceSource' : 'preferredUiBlockerSource',
    uiEvidencePassed ? 'browserMessageSent true' : 'browserMessageSent false',
    uiEvidencePassed ? 'browserOriginProven true' : 'browserOriginProven false',
    uiEvidencePassed ? 'blockerPresent false' : 'selectedFailureKind',
    'Node-side preflight is not browser-origin release evidence',
    'Apple target-host runtime evidence: targetRuntimeEvidenceRequired true',
    'Linux target-host runtime evidence: targetRuntimeEvidenceRequired true',
    'localPreflightIsRuntimeEvidence false',
    'runtimeQaMustRunOnTargetHost true',
  ].filter(Boolean)

  const missing = requiredFragments.filter((fragment) => !currentDocs.includes(fragment))
  if (missing.length) {
    throw new Error(
      `Current evidence docs are missing generated handoff fragments: ${missing.join(', ')}`,
    )
  }

  if (requirementsCurrentOverlayCount !== 1) {
    throw new Error(
      `docs/REQUIREMENTS.md must contain exactly one current evidence overlay; found ${requirementsCurrentOverlayCount}. Run pnpm run sync:current-evidence.`,
    )
  }

  if (requirementsStartMarkerCount !== 1 || requirementsEndMarkerCount !== 1) {
    throw new Error(
      `docs/REQUIREMENTS.md must contain exactly one current evidence marker pair; found start=${requirementsStartMarkerCount}, end=${requirementsEndMarkerCount}. Run pnpm run sync:current-evidence.`,
    )
  }

  if (qaStartMarkerCount !== 1 || qaEndMarkerCount !== 1) {
    throw new Error(
      `docs/QA_AUDIT.md must contain exactly one current evidence QA overlay marker pair; found start=${qaStartMarkerCount}, end=${qaEndMarkerCount}. Run pnpm run sync:current-evidence.`,
    )
  }
}

async function runEvidenceHandoff() {
  const evidence = await readEvidence()
  if (!allowStaleVerifyReleaseCheckpointForWriteDocs) {
    await assertVerifyReleaseCheckpointInputBinding(evidence)
    assertVerifyReleaseCheckpointFreshness(evidence)
  }
  assertCurrentMsixPackageCandidateFreshness(evidence)
  const markdown = buildMarkdown(evidence)
  assertPublishSafe(markdown, 'current evidence markdown')

  if (writeDocs) {
    await writeCurrentEvidenceDocs(evidence)
    await assertDocsContainCurrentEvidence(evidence)
    console.log('Current release evidence docs updated and checked')
    return
  }

  if (!checkOnly) {
    console.log(markdown)
    return
  }

  await assertDocsContainCurrentEvidence(evidence)
  for (const path of Object.values(paths)) {
    await stat(path)
  }
  console.log('Current release evidence summary checks passed')
}

async function main() {
  if (writeDocs) {
    await withReleaseReportLock('release-current-evidence-summary', runEvidenceHandoff)
    return
  }

  await runEvidenceHandoff()
}

await main()
