const defaultSourcePaths = {
  strictPreflight: '.manual-qa/strict-release-preflight.json',
  androidEmulatorQa: '.manual-qa/android-emulator-qa.json',
  androidUiSmoke: '.manual-qa/android-ui-smoke.json',
  androidCloudSyncSmoke: '.manual-qa/android-cloud-sync-smoke.json',
}

function fingerprintKey(fingerprint) {
  if (!fingerprint || typeof fingerprint !== 'object') return null

  const kind = String(fingerprint.kind ?? '').trim()
  const roots = Array.isArray(fingerprint.roots)
    ? fingerprint.roots.filter((root) => typeof root === 'string' && root.trim() !== '')
    : []
  const sha256 = String(fingerprint.sha256 ?? '').trim().toUpperCase()
  const fileCount = Number(fingerprint.fileCount)
  const totalBytes = Number(fingerprint.totalBytes)
  if (kind !== 'zerochat.androidSourceFingerprint.v1' || roots.length === 0) return null
  if (!/^[A-F0-9]{64}$/u.test(sha256)) return null
  if (!Number.isInteger(fileCount) || fileCount < 0) return null
  if (!Number.isInteger(totalBytes) || totalBytes < 0) return null

  return `${kind}:${JSON.stringify(roots)}:${fileCount}:${totalBytes}:${sha256}`
}

function apkEvidenceKey(evidence) {
  if (!evidence || typeof evidence !== 'object') return null

  const bytes = Number(evidence.bytes)
  const sha256 = String(evidence.sha256 ?? '').trim().toUpperCase()
  if (!Number.isInteger(bytes) || bytes < 0) return null
  if (!/^[A-F0-9]{64}$/u.test(sha256)) return null

  return `${bytes}:${sha256}`
}

function fingerprintSummary(fingerprint) {
  if (!fingerprintKey(fingerprint)) return null

  return {
    kind: typeof fingerprint.kind === 'string' ? fingerprint.kind : null,
    roots: Array.isArray(fingerprint.roots)
      ? fingerprint.roots.filter((root) => typeof root === 'string')
      : [],
    fileCount: Number(fingerprint.fileCount),
    totalBytes: Number(fingerprint.totalBytes),
    sha256: String(fingerprint.sha256).toUpperCase(),
  }
}

function reportApkEvidence(report, label) {
  if (label === 'emulator') return report?.apkEvidence
  return report?.apk?.local
}

function reportFingerprint(report, label) {
  return reportApkEvidence(report, label)?.sourceFingerprint
}

function apkEvidenceSummary(evidence) {
  if (!apkEvidenceKey(evidence)) return null

  return {
    bytes: Number(evidence.bytes),
    sha256: String(evidence.sha256).toUpperCase(),
    sourceFingerprint: fingerprintSummary(evidence.sourceFingerprint),
  }
}

export function androidRuntimeEvidenceState({
  emulatorReport = {},
  uiReport = {},
  cloudSyncReport = {},
  currentApkEvidence = null,
} = {}) {
  const reports = [
    ['emulator', emulatorReport],
    ['ui', uiReport],
    ['cloud-sync', cloudSyncReport],
  ]
  const failureReasons = []
  const emulatorFingerprint = reportFingerprint(emulatorReport, 'emulator')
  const currentSourceKey = fingerprintKey(currentApkEvidence?.sourceFingerprint)
  const currentApkKey = apkEvidenceKey(currentApkEvidence)

  if (!currentSourceKey || !currentApkKey) {
    failureReasons.push('current-source-bound-apk-missing')
  }

  for (const [label, report] of reports) {
    if (report?.passed !== true) {
      failureReasons.push(`${label}-runtime-failed`)
    }

    const fingerprint = reportFingerprint(report, label)
    const key = fingerprintKey(fingerprint)
    if (!key) {
      failureReasons.push(`${label}-source-fingerprint-missing`)
    } else if (currentSourceKey && key !== currentSourceKey) {
      failureReasons.push(`${label}-source-stale`)
    }

    const apkEvidence = reportApkEvidence(report, label)
    const apkKey = apkEvidenceKey(apkEvidence)
    if (!apkKey) {
      failureReasons.push(`${label}-apk-evidence-missing`)
    } else if (currentApkKey && apkKey !== currentApkKey) {
      failureReasons.push(`${label}-apk-stale`)
    }
  }

  return {
    failureReasons,
    sourceStale: failureReasons.some(
      (reason) => reason.includes('source-') || reason.includes('-apk-'),
    ),
    runtimeFailed: failureReasons.some((reason) => reason.endsWith('-runtime-failed')),
    emulatorPassed: emulatorReport?.passed === true,
    uiPassed: uiReport?.passed === true,
    cloudSyncPassed: cloudSyncReport?.passed === true,
    currentApkEvidence: apkEvidenceSummary(currentApkEvidence),
    emulatorSourceFingerprint: fingerprintSummary(emulatorFingerprint),
    uiSourceFingerprint: fingerprintSummary(reportFingerprint(uiReport, 'ui')),
    cloudSyncSourceFingerprint: fingerprintSummary(
      reportFingerprint(cloudSyncReport, 'cloud-sync'),
    ),
  }
}

export function buildAndroidTargetRuntimeBlocker({
  strictReport,
  emulatorReport,
  uiReport,
  cloudSyncReport,
  currentApkEvidence = null,
  sourcePaths = defaultSourcePaths,
} = {}) {
  const state = androidRuntimeEvidenceState({
    emulatorReport,
    uiReport,
    cloudSyncReport,
    currentApkEvidence,
  })

  if (state.failureReasons.length === 0) return null

  const blockerKind = state.sourceStale
    ? 'android-target-runtime-qa-source-stale'
    : 'android-target-runtime-qa-failed'
  const reasons = state.failureReasons.join(', ')

  return {
    id: 'android-target-runtime-qa',
    category: 'native-runtime',
    blockerKind,
    owner: 'android-runtime-qa-operator',
    status: 'blocked',
    releaseEvidence: false,
    sourceReports: [
      sourcePaths.strictPreflight,
      sourcePaths.androidEmulatorQa,
      sourcePaths.androidUiSmoke,
      sourcePaths.androidCloudSyncSmoke,
    ],
    summary: `Android target runtime QA remains blocked: ${reasons}.`,
    evidence: {
      blockerKind,
      owner: 'android-runtime-qa-operator',
      sourceStale: state.sourceStale,
      runtimeFailed: state.runtimeFailed,
      failureReasons: state.failureReasons,
      emulatorPassed: state.emulatorPassed,
      uiPassed: state.uiPassed,
      cloudSyncPassed: state.cloudSyncPassed,
      currentApkEvidence: state.currentApkEvidence,
      emulatorSourceFingerprint: state.emulatorSourceFingerprint,
      uiSourceFingerprint: state.uiSourceFingerprint,
      cloudSyncSourceFingerprint: state.cloudSyncSourceFingerprint,
      targetRuntimeEvidenceRequired: true,
      targetHostRuntimeEvidence: {
        required: true,
        targetHost: 'Android emulator or device',
        currentHostSatisfiesTargetRuntime: false,
        localPreflightIsRuntimeEvidence: false,
        runtimeQaMustRunOnTargetHost: true,
        headless: true,
        requiredProof: [
          'current source-bound debug APK',
          'headless Android UI smoke',
          'headless Android Cloudflare sync smoke',
          'headless aggregate emulator QA',
        ],
      },
      strictPreflightBlockers: Array.isArray(strictReport?.blockers)
        ? strictReport.blockers
            .map((blocker) => blocker?.label)
            .filter((label) => typeof label === 'string' && label.trim() !== '')
        : [],
    },
    nextActions: [
      'Run headless Android QA on an Android-capable host with the current source-bound debug APK.',
      'Regenerate the Android UI, Cloudflare sync, and aggregate emulator reports from that same APK.',
      'Run pnpm run check:runtime-artifacts and pnpm run check:release-blockers after the reports are refreshed.',
    ],
  }
}
