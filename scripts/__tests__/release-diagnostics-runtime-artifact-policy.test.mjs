import { describe, expect, it } from 'vitest'

import {
  WINDOWS_TRUSTED_MSIX_ONLY_SCOPE_MARKER,
  androidRuntimeArtifactExpectation,
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
