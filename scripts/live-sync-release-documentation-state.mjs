export const LIVE_SYNC_CURRENT_PASS_ROW =
  '- [x] Disposable live sync release-pass：当前 source-current Gist drill 已通过'
export const LIVE_SYNC_OPEN_ROW =
  '- [ ] Disposable live sync release-pass：提供一次性 Cloudflare 或 Gist 凭据后重跑 live sync release drill。'
export const LIVE_SYNC_COMPLETION_MARKER =
  'QA marker: Current disposable Gist live-sync completion cannot regress to an open checklist item.'

const LIVE_SYNC_BLOCKER_ID = 'disposable-live-sync-release-pass'
const LIVE_SYNC_MISSING_INPUTS_KIND = 'missing-live-sync-release-inputs'

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value, label) {
  if (!isRecord(value)) {
    throw new Error(`Live-sync ${label} report is missing or malformed.`)
  }
  return value
}

function fingerprintKey(value, label) {
  const fingerprint = requireRecord(value, label)
  if (
    fingerprint.kind !== 'zerochat.liveSyncSourceFingerprint.v1' ||
    !Number.isInteger(fingerprint.fileCount) ||
    !Number.isInteger(fingerprint.totalBytes) ||
    typeof fingerprint.sha256 !== 'string' ||
    fingerprint.sha256.length === 0
  ) {
    throw new Error(`Live-sync ${label} source fingerprint is malformed.`)
  }

  return `${fingerprint.kind}:${fingerprint.fileCount}:${fingerprint.totalBytes}:${fingerprint.sha256}`
}

function sameFingerprint(left, right, label) {
  return fingerprintKey(left, `${label} left`) === fingerprintKey(right, `${label} right`)
}

function requireLiveSyncReleasePass(report) {
  requireRecord(report, 'release-pass')
  if (
    report.status !== 'passed' ||
    report.passed !== true ||
    report.releaseEvidence !== true ||
    report.safeToPublish !== true ||
    report.evidenceType !== 'release-pass'
  ) {
    throw new Error('Live-sync release-pass report is not a valid passed release evidence report.')
  }
}

function requireCurrentDiagnostic(report) {
  requireRecord(report, 'current diagnostic')
  if (
    report.releaseEvidence === true ||
    !isRecord(report.sourceFingerprint)
  ) {
    throw new Error('Live-sync current diagnostic report is not diagnostic-only or lacks a fingerprint.')
  }
}

function findLiveSyncBlocker(report) {
  requireRecord(report, 'blocker summary')
  if (!Array.isArray(report.blockers)) {
    throw new Error('Live-sync blocker summary must contain a blockers array.')
  }

  const matches = report.blockers.filter((blocker) => blocker?.id === LIVE_SYNC_BLOCKER_ID)
  if (matches.length > 1) {
    throw new Error('Live-sync blocker summary contains duplicate disposable live-sync blockers.')
  }

  return matches[0] ?? null
}

export function evaluateLiveSyncReleaseDocumentationState({
  blockerReport,
  diagnosticReport,
  releasePassReport,
}) {
  const blocker = findLiveSyncBlocker(blockerReport)
  requireCurrentDiagnostic(diagnosticReport)
  requireLiveSyncReleasePass(releasePassReport)

  const diagnosticFingerprint = fingerprintKey(
    diagnosticReport.sourceFingerprint,
    'current diagnostic',
  )
  const releasePassFingerprint = fingerprintKey(
    releasePassReport.sourceFingerprint,
    'release-pass',
  )

  if (blocker) {
    const evidence = requireRecord(blocker.evidence, 'blocker evidence')
    const currentDiagnosticBinding = requireRecord(
      evidence.currentDiagnosticReport,
      'blocker current diagnostic binding',
    )
    const releasePassBinding = requireRecord(
      evidence.releasePassReport,
      'blocker release-pass binding',
    )
    const sourceFingerprint = requireRecord(evidence.sourceFingerprint, 'blocker source fingerprint')

    if (
      blocker.blockerKind !== LIVE_SYNC_MISSING_INPUTS_KIND ||
      evidence.blockerKind !== LIVE_SYNC_MISSING_INPUTS_KIND ||
      blocker.releaseEvidence === true ||
      sourceFingerprint.current !== true ||
      currentDiagnosticBinding.sourceFingerprintCurrent !== true ||
      releasePassBinding.sourceFingerprintCurrent !== false ||
      fingerprintKey(sourceFingerprint, 'blocker') !== diagnosticFingerprint ||
      diagnosticReport.status !== 'skipped' ||
      diagnosticReport.passed !== false ||
      releasePassFingerprint === diagnosticFingerprint
    ) {
      throw new Error('Live-sync blocker evidence is inconsistent with the current source diagnostic.')
    }

    return {
      kind: 'open-blocker',
      blockerKind: LIVE_SYNC_MISSING_INPUTS_KIND,
    }
  }

  if (
    blockerReport.releaseEvidence === true &&
    blockerReport.status === 'clear' &&
    releasePassFingerprint === diagnosticFingerprint
  ) {
    return { kind: 'current-pass' }
  }

  throw new Error(
    'Live-sync evidence is inconsistent: no blocker exists, but the canonical pass is not current and valid.',
  )
}

function requireIncludes(source, value, label) {
  if (typeof source !== 'string' || !source.includes(value)) {
    throw new Error(`Live-sync ${label} documentation is missing ${value}.`)
  }
}

function requireAbsent(source, value, label) {
  if (typeof source !== 'string' || source.includes(value)) {
    throw new Error(`Live-sync ${label} documentation still contains ${value}.`)
  }
}

function currentChecklistRow(requirements) {
  return requirements
    .split(/\r?\n/u)
    .find((line) => line.includes('当前 release blocker `disposable-live-sync-release-pass`'))
}

export function assertLiveSyncReleaseDocumentationState(state, {
  requirements,
  qaAudit,
}) {
  requireRecord(state, 'documentation state')

  if (state.kind === 'open-blocker') {
    const row = currentChecklistRow(requirements)
    if (
      !row ||
      !row.startsWith('- [ ]') ||
      !row.includes('status `skipped`') ||
      !row.includes(`blockerKind \`${state.blockerKind}\``)
    ) {
      throw new Error(
        'Live-sync open blocker Requirements row must match the current skipped blocker state.',
      )
    }
    requireIncludes(qaAudit, state.blockerKind, 'QA audit current diagnostic')
    return
  }

  if (state.kind === 'current-pass') {
    const row = currentChecklistRow(requirements)
    if (row && !row.startsWith('- [x]')) {
      throw new Error('Live-sync current-pass Requirements row still marks an open blocker.')
    }

    if (!row) {
      requireIncludes(requirements, LIVE_SYNC_CURRENT_PASS_ROW, 'Requirements')
    }
    requireAbsent(requirements, LIVE_SYNC_OPEN_ROW, 'current-pass Requirements')
    requireIncludes(requirements, LIVE_SYNC_COMPLETION_MARKER, 'Requirements')
    requireIncludes(qaAudit, LIVE_SYNC_COMPLETION_MARKER, 'QA audit')
    return
  }

  throw new Error(`Unknown live-sync documentation state: ${state.kind ?? 'missing'}.`)
}
