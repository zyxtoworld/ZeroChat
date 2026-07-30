const LIVE_SYNC_RELEASE_PASS_PATH = '.manual-qa/live-sync-release-drill.json'
const RUNTIME_ARTIFACT_FAILURE_HEADER = 'Runtime smoke artifact checks failed:'
const WINDOWS_TRUSTED_MSIX_RUNTIME_ARTIFACT_PATHS = [
  '.manual-qa/windows-msix-current-trusted-install-update-qa.json',
  '.manual-qa/windows-msix-current-trusted-install-update-qa.failure.json',
  '.manual-qa/windows-msix-host-preflight.json',
]
const ANDROID_RUNTIME_ARTIFACT_SPECS = [
  { path: '.manual-qa/android-ui-smoke.json', label: 'apk.local' },
  { path: '.manual-qa/android-cloud-sync-smoke.json', label: 'apk.local' },
  { path: '.manual-qa/android-emulator-qa.json', label: 'apkEvidence' },
]
const WEB_CURRENT_PAGE_QA_PATH = '.manual-qa/web-current-page-qa.json'
const WEB_CURRENT_PAGE_SOURCE_STALE_MARKERS = [
  `${WEB_CURRENT_PAGE_QA_PATH} Web source file count must match current source`,
  `${WEB_CURRENT_PAGE_QA_PATH} Web source digest must match current source`,
]
const WEB_CURRENT_PAGE_SOURCE_STALE_BULLET_PREFIXES = [
  `- ${WEB_CURRENT_PAGE_SOURCE_STALE_MARKERS[0]} `,
  `- ${WEB_CURRENT_PAGE_SOURCE_STALE_MARKERS[1]}. Rerun pnpm run qa:web-current after Web source changes.`,
]

export const WINDOWS_TRUSTED_MSIX_ONLY_SCOPE_MARKER =
  'Runtime artifact blocker scope: windows-trusted-msix-only.'

export function webCurrentPageRuntimeArtifactExpectation({ allowRefreshableStale = false } = {}) {
  return {
    allowRefreshableStale,
    allowedBulletPrefixes: allowRefreshableStale
      ? WEB_CURRENT_PAGE_SOURCE_STALE_BULLET_PREFIXES
      : [],
    forbiddenMarkers: allowRefreshableStale ? [] : WEB_CURRENT_PAGE_SOURCE_STALE_MARKERS,
  }
}

export function isWindowsTrustedMsixOnlyRuntimeArtifactFailure(output) {
  if (typeof output !== 'string' || !output.includes(RUNTIME_ARTIFACT_FAILURE_HEADER)) {
    return false
  }

  const bulletLines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))

  return (
    bulletLines.length > 0 &&
    bulletLines.every((line) =>
      WINDOWS_TRUSTED_MSIX_RUNTIME_ARTIFACT_PATHS.some((reportPath) => {
        const prefix = `- ${reportPath}`
        return line === prefix || line.startsWith(`${prefix} `)
      }),
    )
  )
}

export function isWindowsTrustedMsixOnlyExpectedFailureSummary(summary) {
  if (typeof summary !== 'string') {
    return false
  }

  if (
    summary.includes(
      'Expected release blocker: windows-trusted-msix-release-pass-missing',
    ) &&
    summary.includes(WINDOWS_TRUSTED_MSIX_ONLY_SCOPE_MARKER)
  ) {
    return true
  }

  if (!isWindowsTrustedMsixOnlyRuntimeArtifactFailure(summary)) {
    return false
  }

  return (
    summary.includes('windows-trusted-msix-needs-elevated-current-source-rerun') ||
    (summary.includes('windows-msix-current-trusted-install-update-qa.failure.json') &&
      summary.includes('releaseEvidence=false'))
  )
}

export function androidRuntimeArtifactExpectation({ currentApkEvidence } = {}) {
  const apkSha256 = currentApkEvidence?.sha256
  if (
    !Number.isSafeInteger(currentApkEvidence?.bytes) ||
    currentApkEvidence.bytes < 0 ||
    typeof apkSha256 !== 'string' ||
    !/^[A-F0-9]{64}$/u.test(apkSha256)
  ) {
    return {
      currentSourceBoundApk: false,
      allowedBulletPrefixes: [],
      blocker: null,
    }
  }

  const allowedBulletPrefixes = ANDROID_RUNTIME_ARTIFACT_SPECS.flatMap(({ path, label }) => [
    `- ${path} ${label} source fingerprint must match the current source-bound debug APK.`,
    `- ${path} ${label} sha256 must match ${apkSha256}, got `,
  ])

  return {
    currentSourceBoundApk: true,
    allowedBulletPrefixes,
    blocker: {
      id: 'android-current-source-runtime-qa',
      classification: 'android-runtime-qa-needs-current-source-rebind',
      owner: 'android-runtime-qa-operator',
      reportPaths: ANDROID_RUNTIME_ARTIFACT_SPECS.map(({ path }) => path),
      currentApkEvidence: {
        bytes: currentApkEvidence.bytes,
        sha256: apkSha256,
        sourceFingerprint: currentApkEvidence.sourceFingerprint ?? null,
      },
    },
  }
}

function sameSourceFingerprint(left, right) {
  return (
    Array.isArray(left?.roots) &&
    Array.isArray(right?.roots) &&
    JSON.stringify(left.roots) === JSON.stringify(right.roots) &&
    Number.isInteger(left?.fileCount) &&
    left.fileCount === right?.fileCount &&
    Number.isInteger(left?.totalBytes) &&
    left.totalBytes === right?.totalBytes &&
    typeof left?.sha256 === 'string' &&
    left.sha256.length > 0 &&
    left.sha256 === right?.sha256
  )
}

function staleSourceFingerprintMarkers(left, right) {
  const markers = []

  if (
    !Array.isArray(left?.roots) ||
    !Array.isArray(right?.roots) ||
    JSON.stringify(left.roots) !== JSON.stringify(right.roots)
  ) {
    markers.push(
      `${LIVE_SYNC_RELEASE_PASS_PATH} sourceFingerprint.roots must match the guarded live sync source roots`,
    )
  }
  if (
    !Number.isInteger(left?.fileCount) ||
    !Number.isInteger(right?.fileCount) ||
    left.fileCount !== right.fileCount
  ) {
    markers.push(`${LIVE_SYNC_RELEASE_PASS_PATH} sourceFingerprint.fileCount`)
  }
  if (
    !Number.isInteger(left?.totalBytes) ||
    !Number.isInteger(right?.totalBytes) ||
    left.totalBytes !== right.totalBytes
  ) {
    markers.push(`${LIVE_SYNC_RELEASE_PASS_PATH} sourceFingerprint.totalBytes`)
  }
  if (
    typeof left?.sha256 !== 'string' ||
    typeof right?.sha256 !== 'string' ||
    left.sha256.length === 0 ||
    right.sha256.length === 0 ||
    left.sha256 !== right.sha256
  ) {
    markers.push(
      `${LIVE_SYNC_RELEASE_PASS_PATH} sourceFingerprint.sha256 must match current live sync source fingerprint ${right?.sha256 ?? ''}`,
    )
  }

  return markers
}

export function liveSyncRuntimeArtifactExpectation({
  releasePassReport,
  currentDiagnosticReport,
} = {}) {
  const currentFingerprint = currentDiagnosticReport?.sourceFingerprint ?? {}
  const sourceFingerprintCurrent = sameSourceFingerprint(
    releasePassReport?.sourceFingerprint,
    currentFingerprint,
  )
  const releasePassCurrent =
    releasePassReport?.status === 'passed' &&
    releasePassReport?.passed === true &&
    releasePassReport?.releaseEvidence === true &&
    sourceFingerprintCurrent

  if (releasePassCurrent) {
    return {
      releasePassCurrent: true,
      sourceFingerprintCurrent: true,
      requiredMarkers: [],
      allowedBulletPrefixes: [],
      forbiddenMarkers: ['sourceFingerprint'],
      blocker: null,
    }
  }

  if (sourceFingerprintCurrent) {
    return {
      releasePassCurrent: false,
      sourceFingerprintCurrent: true,
      requiredMarkers: [],
      allowedBulletPrefixes: [],
      forbiddenMarkers: ['sourceFingerprint'],
      blocker: {
        id: 'disposable-live-sync-release-pass',
        classification: 'live-sync-current-source-release-pass-missing',
        owner: 'release-qa-operator',
        reportPath: LIVE_SYNC_RELEASE_PASS_PATH,
        currentSourceFingerprint: {
          roots: Array.isArray(currentFingerprint.roots) ? currentFingerprint.roots : [],
          fileCount: currentFingerprint.fileCount ?? null,
          totalBytes: currentFingerprint.totalBytes ?? null,
          sha256: currentFingerprint.sha256 ?? null,
        },
      },
    }
  }

  const requiredMarkers = staleSourceFingerprintMarkers(
    releasePassReport?.sourceFingerprint,
    currentFingerprint,
  )

  return {
    releasePassCurrent: false,
    sourceFingerprintCurrent: false,
    requiredMarkers,
    allowedBulletPrefixes: requiredMarkers.map((marker) => `- ${marker}`),
    forbiddenMarkers: [],
    blocker: {
      id: 'disposable-live-sync-release-pass',
      classification: 'live-sync-current-source-release-pass-missing',
      owner: 'release-qa-operator',
      reportPath: LIVE_SYNC_RELEASE_PASS_PATH,
      currentSourceFingerprint: {
        roots: Array.isArray(currentFingerprint.roots) ? currentFingerprint.roots : [],
        fileCount: currentFingerprint.fileCount ?? null,
        totalBytes: currentFingerprint.totalBytes ?? null,
        sha256: currentFingerprint.sha256 ?? null,
      },
    },
  }
}
