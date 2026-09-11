import { describe, expect, it } from 'vitest'

import {
  WINDOWS_TRUSTED_MSIX_ONLY_SCOPE_MARKER,
  androidRuntimeArtifactExpectation,
  classifyAuditedRuntimeArtifactFailure,
  isAuditedDeferrableRuntimeArtifactFailure,
  isRuntimeArtifactGatePass,
  trustedMsixArtifactBlockerSource,
  isWindowsTrustedMsixOnlyExpectedFailureSummary,
  isWindowsTrustedMsixOnlyRuntimeArtifactFailure,
  liveSyncRuntimeArtifactExpectation,
  webCurrentPageRuntimeArtifactExpectation,
} from '../release-diagnostics-runtime-artifact-policy.mjs'

const fingerprint = {
  roots: ['src/services/sync.ts'],
  fileCount: 57,
  totalBytes: 960471,
  sha256: 'A'.repeat(64),
}
const androidApkEvidence = {
  bytes: 16_144_417,
  sha256: 'C'.repeat(64),
  sourceFingerprint: {
    kind: 'zerochat.androidSourceFingerprint.v1',
    fileCount: 193,
    totalBytes: 1_898_642,
    sha256: 'D'.repeat(64),
  },
}

describe('release diagnostics runtime-artifact policy', () => {
  it('prefers a current blocked host preflight over a newer stale trusted pass', () => {
    expect(
      trustedMsixArtifactBlockerSource({
        hostPreflightStatus: 'blocked',
        failureGeneratedAt: '2026-06-15T01:29:57.000Z',
        baselineGeneratedAt: '2026-07-31T07:21:08.000Z',
      }),
    ).toBe('host-preflight')
  })

  it('uses a current failure report only when host preflight does not supersede it', () => {
    const currentFailure = {
      failureGeneratedAt: '2026-08-09T09:00:00.000Z',
      baselineGeneratedAt: '2026-08-09T08:59:59.000Z',
    }

    expect(trustedMsixArtifactBlockerSource(currentFailure)).toBe('failure-report')
    expect(
      trustedMsixArtifactBlockerSource({
        ...currentFailure,
        failureGeneratedAt: currentFailure.baselineGeneratedAt,
      }),
    ).toBe('failure-report')
    expect(
      trustedMsixArtifactBlockerSource({
        ...currentFailure,
        failureGeneratedAt: '2026-08-09T08:59:58.000Z',
      }),
    ).toBeNull()
    expect(
      trustedMsixArtifactBlockerSource({
        failureGeneratedAt: currentFailure.failureGeneratedAt,
      }),
    ).toBe('failure-report')
    expect(
      trustedMsixArtifactBlockerSource({
        ...currentFailure,
        hostPreflightStatus: 'clear',
      }),
    ).toBeNull()
  })

  it('accepts only an explicit runtime artifact pass without a failure header', () => {
    expect(
      isRuntimeArtifactGatePass(
        'Runtime smoke artifact checks passed: windows-msix-trusted: freshInstall; update',
      ),
    ).toBe(true)
    expect(
      isRuntimeArtifactGatePass(
        'Runtime smoke artifact checks passed:\nRuntime smoke artifact checks failed:',
      ),
    ).toBe(false)
    expect(isRuntimeArtifactGatePass('unrelated success')).toBe(false)
  })

  it('fails closed on stale current-page Web evidence outside the verifier refresh window', () => {
    expect(webCurrentPageRuntimeArtifactExpectation()).toEqual({
      allowRefreshableStale: false,
      allowedBulletPrefixes: [],
      forbiddenMarkers: [
        '.manual-qa/web-current-page-qa.json Web source file count must match current source',
        '.manual-qa/web-current-page-qa.json Web source digest must match current source',
      ],
    })
  })

  it('allows only the exact pending current-page Web source pair during the verifier refresh window', () => {
    expect(
      webCurrentPageRuntimeArtifactExpectation({ allowRefreshableStale: true }),
    ).toEqual({
      allowRefreshableStale: true,
      allowedBulletPrefixes: [
        '- .manual-qa/web-current-page-qa.json Web source file count must match current source ',
        '- .manual-qa/web-current-page-qa.json Web source digest must match current source. Rerun pnpm run qa:web-current after Web source changes.',
      ],
      forbiddenMarkers: [],
    })
  })

  it('accepts only current-source Android runtime rebind lines', () => {
    const expectation = androidRuntimeArtifactExpectation({
      currentApkEvidence: androidApkEvidence,
    })

    expect(expectation).toMatchObject({
      currentSourceBoundApk: true,
      blocker: {
        id: 'android-current-source-runtime-qa',
        classification: 'android-runtime-qa-needs-current-source-rebind',
        owner: 'android-runtime-qa-operator',
      },
    })
    expect(expectation.allowedBulletPrefixes).toEqual([
      '- .manual-qa/android-ui-smoke.json apk.local source fingerprint must match the current source-bound debug APK.',
      `- .manual-qa/android-ui-smoke.json apk.local sha256 must match ${androidApkEvidence.sha256}, got `,
      '- .manual-qa/android-cloud-sync-smoke.json apk.local source fingerprint must match the current source-bound debug APK.',
      `- .manual-qa/android-cloud-sync-smoke.json apk.local sha256 must match ${androidApkEvidence.sha256}, got `,
      '- .manual-qa/android-emulator-qa.json apkEvidence source fingerprint must match the current source-bound debug APK.',
      `- .manual-qa/android-emulator-qa.json apkEvidence sha256 must match ${androidApkEvidence.sha256}, got `,
    ])
  })

  it('fails closed when current source-bound APK evidence is missing', () => {
    expect(androidRuntimeArtifactExpectation()).toEqual({
      currentSourceBoundApk: false,
      allowedBulletPrefixes: [],
      blocker: null,
    })
  })

  it('accepts a runtime-artifact failure containing only trusted MSIX evidence', () => {
    const output = [
      'Runtime smoke artifact checks failed:',
      '- .manual-qa/windows-msix-current-trusted-install-update-qa.failure.json blockerClassification=windows-appx-deployment-deleted-package-cleanup-access-denied owner=host-windows-appx-deployment-service releaseEvidence=false',
      '- .manual-qa/windows-msix-host-preflight.json current host preflight status=blocked',
    ].join('\n')

    expect(isWindowsTrustedMsixOnlyRuntimeArtifactFailure(output)).toBe(true)
    expect(isWindowsTrustedMsixOnlyExpectedFailureSummary(output)).toBe(true)
  })

  it('accepts the explicit compact Windows-only scope marker', () => {
    expect(
      isWindowsTrustedMsixOnlyExpectedFailureSummary(
        [
          'Runtime smoke artifacts failed with exit code 1',
          'Expected release blocker: windows-trusted-msix-release-pass-missing.',
          WINDOWS_TRUSTED_MSIX_ONLY_SCOPE_MARKER,
        ].join('\n'),
      ),
    ).toBe(true)
  })

  it('classifies a host-preflight-only runtime failure as the expected Windows blocker', () => {
    const output = [
      'Runtime smoke artifacts failed with exit code 1',
      'Runtime smoke artifact checks failed:',
      '- .manual-qa/windows-msix-host-preflight.json current host preflight status=blocked hostReadyForTrustedMsix=false trustedMsixQaReadiness=host-blocked',
    ].join('\n')

    expect(isWindowsTrustedMsixOnlyRuntimeArtifactFailure(output)).toBe(true)
    expect(isWindowsTrustedMsixOnlyExpectedFailureSummary(output)).toBe(true)
  })

  it('rejects Windows-only classification when live-sync evidence also fails', () => {
    const output = [
      'Runtime smoke artifact checks failed:',
      '- .manual-qa/windows-msix-current-trusted-install-update-qa.failure.json blockerClassification=windows-appx-deployment-deleted-package-cleanup-access-denied owner=host-windows-appx-deployment-service releaseEvidence=false',
      '- .manual-qa/windows-msix-host-preflight.json current host preflight status=blocked',
      '- .manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint CURRENT',
    ].join('\n')

    expect(isWindowsTrustedMsixOnlyRuntimeArtifactFailure(output)).toBe(false)
    expect(isWindowsTrustedMsixOnlyExpectedFailureSummary(output)).toBe(false)
  })

  it('defers an audited trusted-MSIX plus stale live-sync failure without dropping either blocker', () => {
    const currentLiveSyncSha256 = 'E'.repeat(64)
    const requiredMarkers = [
      '.manual-qa/windows-msix-current-trusted-install-update-qa.json distWebAssets',
      '.manual-qa/windows-msix-current-trusted-install-update-qa.json currentPackageEvidence',
      '.manual-qa/live-sync-release-drill.json sourceFingerprint.totalBytes',
      `.manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${currentLiveSyncSha256}`,
    ]
    const output = [
      'Runtime smoke artifact checks failed:',
      '- .manual-qa/windows-msix-current-trusted-install-update-qa.json distWebAssets require elevated trusted MSIX QA rerun for the current source.',
      '- .manual-qa/windows-msix-current-trusted-install-update-qa.json currentPackageEvidence requires rerunning trusted MSIX QA.',
      '- .manual-qa/live-sync-release-drill.json sourceFingerprint.totalBytes must match current live sync source bytes 123.',
      `- .manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${currentLiveSyncSha256}; rerun the disposable live sync release drill.`,
    ].join('\n')
    const audit = {
      kind: 'zerochat.releaseDiagnosticsRuntimeArtifactExpectedBlocker.v1',
      actualExitCode: 1,
      passed: true,
      status: 'expected-blocker',
      blockerReport: '.manual-qa/windows-msix-current-trusted-install-update-qa.json',
      blockerClassification: 'windows-trusted-msix-needs-elevated-current-source-rerun',
      additionalExpectedBlockers: [
        {
          id: 'disposable-live-sync-release-pass',
          classification: 'live-sync-current-source-release-pass-missing',
          owner: 'release-qa-operator',
          reportPath: '.manual-qa/live-sync-release-drill.json',
        },
      ],
      androidRuntimeArtifact: {
        currentSourceBoundApk: true,
        staleBulletLines: [],
      },
      requiredMarkersPresent: requiredMarkers,
      forbiddenMarkersAbsent: ['required runtime smoke artifact is missing'],
      unexpectedBulletLineCount: 0,
      bulletLineCount: 4,
    }

    expect(isAuditedDeferrableRuntimeArtifactFailure(output, audit)).toBe(true)
    expect(classifyAuditedRuntimeArtifactFailure(output, audit)).toBe(
      'windows-trusted-msix-release-pass-missing',
    )
    expect(
      isAuditedDeferrableRuntimeArtifactFailure(
        `${output}\n- .manual-qa/android-ui-smoke.json apk.local source fingerprint must match current APK.`,
        audit,
      ),
    ).toBe(false)
    expect(
      classifyAuditedRuntimeArtifactFailure(
        `${output}\n- .manual-qa/android-ui-smoke.json apk.local source fingerprint must match current APK.`,
        audit,
      ),
    ).toBeNull()
    expect(
      isAuditedDeferrableRuntimeArtifactFailure(output, {
        ...audit,
        additionalExpectedBlockers: [
          {
            id: 'android-current-source-runtime-qa',
            classification: 'android-runtime-qa-needs-current-source-rebind',
            reportPath: '.manual-qa/android-ui-smoke.json',
          },
        ],
      }),
    ).toBe(false)
    expect(
      classifyAuditedRuntimeArtifactFailure(output, {
        ...audit,
        requiredMarkersPresent: [
          ...requiredMarkers,
          '.manual-qa/windows-msix-current-trusted-install-update-qa.json unexpected',
        ],
      }),
    ).toBeNull()
  })

  it('defers a current blocked host preflight plus stale live-sync failure', () => {
    const currentLiveSyncSha256 = '9'.repeat(64)
    const hostMarker =
      '.manual-qa/windows-msix-host-preflight.json current host preflight status=blocked'
    const requiredMarkers = [
      hostMarker,
      '.manual-qa/live-sync-release-drill.json sourceFingerprint.totalBytes',
      `.manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${currentLiveSyncSha256}`,
    ]
    const output = [
      'Runtime smoke artifact checks failed:',
      `- ${hostMarker} hostReadyForTrustedMsix=false trustedMsixQaReadiness=host-blocked`,
      '- .manual-qa/live-sync-release-drill.json sourceFingerprint.totalBytes must match current live sync source bytes 123.',
      `- .manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${currentLiveSyncSha256}; rerun the disposable live sync release drill.`,
    ].join('\n')
    const audit = {
      kind: 'zerochat.releaseDiagnosticsRuntimeArtifactExpectedBlocker.v1',
      actualExitCode: 1,
      passed: true,
      status: 'expected-blocker',
      blockerReport: '.manual-qa/windows-msix-host-preflight.json',
      blockerClassification:
        'windows-appx-deployment-deleted-package-cleanup-access-denied',
      owner: 'host-windows-appx-deployment-service',
      currentTrustedQaState: 'host-preflight-blocked-or-unproven',
      additionalExpectedBlockers: [
        {
          id: 'disposable-live-sync-release-pass',
          classification: 'live-sync-current-source-release-pass-missing',
          owner: 'release-qa-operator',
          reportPath: '.manual-qa/live-sync-release-drill.json',
        },
      ],
      androidRuntimeArtifact: {
        currentSourceBoundApk: true,
        staleBulletLines: [],
      },
      requiredMarkersPresent: requiredMarkers,
      forbiddenMarkersAbsent: ['required runtime smoke artifact is missing'],
      unexpectedBulletLineCount: 0,
      bulletLineCount: 3,
    }

    expect(isAuditedDeferrableRuntimeArtifactFailure(output, audit)).toBe(true)
  })

  it('classifies the current cleanup-failure host report with stale live-sync evidence', () => {
    const currentLiveSyncSha256 =
      'CF06D480593C9D0A77345314F0277C95F6170972AC950BD515CC578912B22B79'
    const hostMarker =
      '.manual-qa/windows-msix-host-preflight.json current host preflight status=blocked'
    const requiredMarkers = [
      hostMarker,
      '.manual-qa/live-sync-release-drill.json sourceFingerprint.fileCount',
      '.manual-qa/live-sync-release-drill.json sourceFingerprint.totalBytes',
      `.manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${currentLiveSyncSha256}`,
    ]
    const output = [
      'Runtime smoke artifact checks failed:',
      `- ${hostMarker} hostReadyForTrustedMsix=false trustedMsixQaReadiness=host-blocked`,
      '- .manual-qa/live-sync-release-drill.json sourceFingerprint.fileCount must match current live sync source file count 65.',
      '- .manual-qa/live-sync-release-drill.json sourceFingerprint.totalBytes must match current live sync source bytes 1017099.',
      `- .manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${currentLiveSyncSha256}; rerun the disposable live sync release drill.`,
    ].join('\n')
    const audit = {
      kind: 'zerochat.releaseDiagnosticsRuntimeArtifactExpectedBlocker.v1',
      actualExitCode: 1,
      passed: true,
      status: 'expected-blocker',
      blockerReport: '.manual-qa/windows-msix-host-preflight.json',
      blockerClassification:
        'windows-appx-deployment-deleted-package-cleanup-failure',
      owner: 'host-windows-appx-deployment-service',
      currentTrustedQaState: 'host-preflight-blocked-or-unproven',
      additionalExpectedBlockers: [
        {
          id: 'disposable-live-sync-release-pass',
          classification: 'live-sync-current-source-release-pass-missing',
          owner: 'release-qa-operator',
          reportPath: '.manual-qa/live-sync-release-drill.json',
        },
      ],
      androidRuntimeArtifact: {
        currentSourceBoundApk: true,
        staleBulletLines: [],
      },
      webCurrentPageArtifact: {
        allowRefreshableStale: false,
        staleBulletLines: [],
      },
      requiredMarkersPresent: requiredMarkers,
      forbiddenMarkersAbsent: [
        '.manual-qa/web-current-page-qa.json Web source file count must match current source',
        '.manual-qa/web-current-page-qa.json Web source digest must match current source',
        'required runtime smoke artifact is missing',
        'must be a passing live sync release drill report',
        'must be hosted native CI release evidence',
        'must be a passing full-capability live provider report',
      ],
      unexpectedBulletLineCount: 0,
      bulletLineCount: 4,
    }

    expect(isAuditedDeferrableRuntimeArtifactFailure(output, audit)).toBe(true)
    expect(classifyAuditedRuntimeArtifactFailure(output, audit)).toBe(
      'windows-trusted-msix-release-pass-missing',
    )
    expect(
      classifyAuditedRuntimeArtifactFailure(output, {
        ...audit,
        blockerClassification: 'unknown-host-blocker-kind',
      }),
    ).toBeNull()
  })

  it('defers a current blocked host preflight without additional blockers', () => {
    const hostMarker =
      '.manual-qa/windows-msix-host-preflight.json current host preflight status=blocked'
    const output = [
      'Runtime smoke artifact checks failed:',
      `- ${hostMarker} hostReadyForTrustedMsix=false trustedMsixQaReadiness=host-blocked`,
    ].join('\n')
    const audit = {
      kind: 'zerochat.releaseDiagnosticsRuntimeArtifactExpectedBlocker.v1',
      actualExitCode: 1,
      passed: true,
      status: 'expected-blocker',
      blockerReport: '.manual-qa/windows-msix-host-preflight.json',
      blockerClassification:
        'windows-appx-deployment-deleted-package-cleanup-access-denied',
      owner: 'host-windows-appx-deployment-service',
      currentTrustedQaState: 'host-preflight-blocked-or-unproven',
      additionalExpectedBlockers: [],
      androidRuntimeArtifact: {
        currentSourceBoundApk: true,
        staleBulletLines: [],
      },
      requiredMarkersPresent: [hostMarker],
      forbiddenMarkersAbsent: ['required runtime smoke artifact is missing'],
      unexpectedBulletLineCount: 0,
      bulletLineCount: 1,
    }

    expect(isAuditedDeferrableRuntimeArtifactFailure(output, audit)).toBe(true)
    const { additionalExpectedBlockers: _additionalExpectedBlockers, ...incompleteAudit } =
      audit
    expect(isAuditedDeferrableRuntimeArtifactFailure(output, incompleteAudit)).toBe(false)
  })

  it('defers only audited current-page Web staleness inside the verifier refresh window', () => {
    const hostMarker =
      '.manual-qa/windows-msix-host-preflight.json current host preflight status=blocked'
    const webStaleLine =
      '- .manual-qa/web-current-page-qa.json Web source digest must match current source. Rerun pnpm run qa:web-current after Web source changes.'
    const output = [
      'Runtime smoke artifact checks failed:',
      `- ${hostMarker} hostReadyForTrustedMsix=false trustedMsixQaReadiness=host-blocked`,
      webStaleLine,
    ].join('\n')
    const audit = {
      kind: 'zerochat.releaseDiagnosticsRuntimeArtifactExpectedBlocker.v1',
      actualExitCode: 1,
      passed: true,
      status: 'expected-blocker',
      blockerReport: '.manual-qa/windows-msix-host-preflight.json',
      blockerClassification:
        'windows-appx-deployment-deleted-package-cleanup-access-denied',
      owner: 'host-windows-appx-deployment-service',
      currentTrustedQaState: 'host-preflight-blocked-or-unproven',
      additionalExpectedBlockers: [],
      androidRuntimeArtifact: {
        currentSourceBoundApk: true,
        staleBulletLines: [],
      },
      webCurrentPageArtifact: {
        allowRefreshableStale: true,
        staleBulletLines: [webStaleLine],
      },
      requiredMarkersPresent: [hostMarker],
      forbiddenMarkersAbsent: ['required runtime smoke artifact is missing'],
      unexpectedBulletLineCount: 0,
      bulletLineCount: 2,
    }

    expect(isAuditedDeferrableRuntimeArtifactFailure(output, audit)).toBe(true)
    expect(
      isAuditedDeferrableRuntimeArtifactFailure(output.replace('Rerun', 'Skip'), audit),
    ).toBe(false)
    expect(
      isAuditedDeferrableRuntimeArtifactFailure(output, {
        ...audit,
        webCurrentPageArtifact: {
          ...audit.webCurrentPageArtifact,
          allowRefreshableStale: false,
        },
      }),
    ).toBe(false)
  })

  it('defers an audited stale live-sync-only failure after trusted MSIX passes', () => {
    const currentLiveSyncSha256 = 'F'.repeat(64)
    const requiredMarkers = [
      '.manual-qa/live-sync-release-drill.json sourceFingerprint.fileCount',
      '.manual-qa/live-sync-release-drill.json sourceFingerprint.totalBytes',
      `.manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${currentLiveSyncSha256}`,
    ]
    const output = [
      'Runtime smoke artifact checks failed:',
      '- .manual-qa/live-sync-release-drill.json sourceFingerprint.fileCount must match current live sync source file count 60.',
      '- .manual-qa/live-sync-release-drill.json sourceFingerprint.totalBytes must match current live sync source bytes 986910.',
      `- .manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${currentLiveSyncSha256}; rerun the disposable live sync release drill.`,
    ].join('\n')
    const audit = {
      kind: 'zerochat.releaseDiagnosticsRuntimeArtifactExpectedBlocker.v1',
      actualExitCode: 1,
      passed: true,
      status: 'expected-blocker',
      blockerReport: null,
      blockerClassification: null,
      owner: null,
      currentTrustedQaState: 'current-trusted-msix-release-pass',
      additionalExpectedBlockers: [
        {
          id: 'disposable-live-sync-release-pass',
          classification: 'live-sync-current-source-release-pass-missing',
          owner: 'release-qa-operator',
          reportPath: '.manual-qa/live-sync-release-drill.json',
        },
      ],
      androidRuntimeArtifact: {
        currentSourceBoundApk: true,
        staleBulletLines: [],
      },
      requiredMarkersPresent: requiredMarkers,
      forbiddenMarkersAbsent: ['required runtime smoke artifact is missing'],
      unexpectedBulletLineCount: 0,
      bulletLineCount: 3,
    }

    expect(isAuditedDeferrableRuntimeArtifactFailure(output, audit)).toBe(true)
    expect(
      isAuditedDeferrableRuntimeArtifactFailure(
        `${output}\n- .manual-qa/windows-msix-current-trusted-install-update-qa.json distWebAssets unexpectedly stale.`,
        audit,
      ),
    ).toBe(false)
  })

  it('fails closed without a structured runtime-artifact failure list', () => {
    expect(
      isWindowsTrustedMsixOnlyRuntimeArtifactFailure(
        '.manual-qa/windows-msix-current-trusted-install-update-qa.failure.json',
      ),
    ).toBe(false)
    expect(
      isWindowsTrustedMsixOnlyRuntimeArtifactFailure(
        'Runtime smoke artifact checks failed:',
      ),
    ).toBe(false)
  })

  it('keeps source fingerprint failures forbidden while the canonical live-sync pass is current', () => {
    const expectation = liveSyncRuntimeArtifactExpectation({
      releasePassReport: {
        status: 'passed',
        passed: true,
        releaseEvidence: true,
        sourceFingerprint: fingerprint,
      },
      currentDiagnosticReport: { sourceFingerprint: fingerprint },
    })

    expect(expectation).toMatchObject({
      releasePassCurrent: true,
      sourceFingerprintCurrent: true,
      requiredMarkers: [],
      allowedBulletPrefixes: [],
      forbiddenMarkers: ['sourceFingerprint'],
      blocker: null,
    })
  })

  it('keeps current skipped diagnostics out of runtime-artifact fingerprint failures', () => {
    const expectation = liveSyncRuntimeArtifactExpectation({
      releasePassReport: {
        status: 'skipped',
        passed: false,
        releaseEvidence: false,
        sourceFingerprint: fingerprint,
      },
      currentDiagnosticReport: { sourceFingerprint: fingerprint },
    })

    expect(expectation).toMatchObject({
      releasePassCurrent: false,
      sourceFingerprintCurrent: true,
      requiredMarkers: [],
      allowedBulletPrefixes: [],
      forbiddenMarkers: ['sourceFingerprint'],
      blocker: {
        id: 'disposable-live-sync-release-pass',
        classification: 'live-sync-current-source-release-pass-missing',
      },
    })
  })

  it('accepts only the declared stale live-sync pass lines after source changes', () => {
    const expectation = liveSyncRuntimeArtifactExpectation({
      releasePassReport: {
        status: 'passed',
        passed: true,
        releaseEvidence: true,
        sourceFingerprint: { ...fingerprint, sha256: 'B'.repeat(64) },
      },
      currentDiagnosticReport: { sourceFingerprint: fingerprint },
    })

    expect(expectation.releasePassCurrent).toBe(false)
    expect(expectation.sourceFingerprintCurrent).toBe(false)
    expect(expectation.requiredMarkers).toEqual([
      `.manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${fingerprint.sha256}`,
    ])
    expect(expectation.allowedBulletPrefixes).toEqual(
      expectation.requiredMarkers.map((marker) => `- ${marker}`),
    )
    expect(expectation.requiredMarkers).toContain(
      `.manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${fingerprint.sha256}`,
    )
    expect(expectation.blocker).toMatchObject({
      id: 'disposable-live-sync-release-pass',
      classification: 'live-sync-current-source-release-pass-missing',
      currentSourceFingerprint: fingerprint,
    })
  })

  it('does not require a file-count failure when existing source files only change content', () => {
    const expectation = liveSyncRuntimeArtifactExpectation({
      releasePassReport: {
        status: 'passed',
        passed: true,
        releaseEvidence: true,
        sourceFingerprint: {
          ...fingerprint,
          totalBytes: fingerprint.totalBytes - 12,
          sha256: 'B'.repeat(64),
        },
      },
      currentDiagnosticReport: { sourceFingerprint: fingerprint },
    })

    expect(expectation.requiredMarkers).toEqual([
      '.manual-qa/live-sync-release-drill.json sourceFingerprint.totalBytes',
      `.manual-qa/live-sync-release-drill.json sourceFingerprint.sha256 must match current live sync source fingerprint ${fingerprint.sha256}`,
    ])
    expect(expectation.requiredMarkers.join('\n')).not.toContain('sourceFingerprint.fileCount')
  })

  it('requires the roots failure without allowing unrelated lines from the same report', () => {
    const expectation = liveSyncRuntimeArtifactExpectation({
      releasePassReport: {
        status: 'passed',
        passed: true,
        releaseEvidence: true,
        sourceFingerprint: { ...fingerprint, roots: ['src/services/legacy-sync.ts'] },
      },
      currentDiagnosticReport: { sourceFingerprint: fingerprint },
    })

    expect(expectation.requiredMarkers).toEqual([
      '.manual-qa/live-sync-release-drill.json sourceFingerprint.roots must match the guarded live sync source roots',
    ])
    expect(expectation.allowedBulletPrefixes).toEqual([
      '- .manual-qa/live-sync-release-drill.json sourceFingerprint.roots must match the guarded live sync source roots',
    ])
  })

  it('fails closed when the canonical pass is missing', () => {
    expect(
      liveSyncRuntimeArtifactExpectation({
        releasePassReport: null,
        currentDiagnosticReport: { sourceFingerprint: fingerprint },
      }),
    ).toMatchObject({
      releasePassCurrent: false,
      sourceFingerprintCurrent: false,
    })
  })
})
