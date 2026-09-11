import { describe, expect, it } from 'vitest'

import {
  androidRuntimeEvidenceState,
  buildAndroidTargetRuntimeBlocker,
} from '../android-runtime-blocker.mjs'

const currentFingerprint = {
  kind: 'zerochat.androidSourceFingerprint.v1',
  roots: ['apps/android/app/src'],
  fileCount: 199,
  totalBytes: 1_941_513,
  sha256: 'A'.repeat(64),
}
const staleFingerprint = {
  ...currentFingerprint,
  totalBytes: 1_941_512,
  sha256: 'B'.repeat(64),
}
const currentApkEvidence = {
  bytes: 16_160_821,
  sha256: 'C'.repeat(64),
  sourceFingerprint: currentFingerprint,
}

function reports({
  emulatorPassed = true,
  uiPassed = true,
  cloudSyncPassed = true,
  emulatorFingerprint = currentFingerprint,
  uiFingerprint = currentFingerprint,
  cloudSyncFingerprint = currentFingerprint,
  emulatorApk = currentApkEvidence,
  uiApk = currentApkEvidence,
  cloudSyncApk = currentApkEvidence,
} = {}) {
  return {
    emulatorReport: {
      passed: emulatorPassed,
      apkEvidence: { ...emulatorApk, sourceFingerprint: emulatorFingerprint },
    },
    uiReport: {
      passed: uiPassed,
      apk: { local: { ...uiApk, sourceFingerprint: uiFingerprint } },
    },
    cloudSyncReport: {
      passed: cloudSyncPassed,
      apk: { local: { ...cloudSyncApk, sourceFingerprint: cloudSyncFingerprint } },
    },
  }
}

describe('Android runtime blocker', () => {
  it('has no blocker when all Android reports pass on one source fingerprint', () => {
    expect(
      androidRuntimeEvidenceState({
        ...reports(),
        currentApkEvidence,
      }).failureReasons,
    ).toEqual([])
    expect(
      buildAndroidTargetRuntimeBlocker({
        ...reports(),
        currentApkEvidence,
      }),
    ).toBeNull()
  })

  it('keeps a blocker when all reports agree on a stale fingerprint', () => {
    const state = androidRuntimeEvidenceState({
      ...reports({
        emulatorFingerprint: staleFingerprint,
        uiFingerprint: staleFingerprint,
        cloudSyncFingerprint: staleFingerprint,
      }),
      currentApkEvidence,
    })

    expect(state.sourceStale).toBe(true)
    expect(state.failureReasons).toEqual(
      expect.arrayContaining([
        'emulator-source-stale',
        'ui-source-stale',
        'cloud-sync-source-stale',
      ]),
    )
    expect(
      buildAndroidTargetRuntimeBlocker({
        ...reports({
          emulatorFingerprint: staleFingerprint,
          uiFingerprint: staleFingerprint,
          cloudSyncFingerprint: staleFingerprint,
        }),
        currentApkEvidence,
      }),
    ).toMatchObject({
      id: 'android-target-runtime-qa',
      releaseEvidence: false,
      evidence: { sourceStale: true },
    })
  })

  it('fails closed when the current source-bound APK evidence is unavailable', () => {
    const blocker = buildAndroidTargetRuntimeBlocker({
      ...reports(),
      currentApkEvidence: null,
    })

    expect(blocker).toMatchObject({
      id: 'android-target-runtime-qa',
      releaseEvidence: false,
      evidence: {
        failureReasons: ['current-source-bound-apk-missing'],
      },
    })
  })

  it('fails closed when a report APK differs despite a current source fingerprint', () => {
    const blocker = buildAndroidTargetRuntimeBlocker({
      ...reports({
        uiApk: { ...currentApkEvidence, bytes: currentApkEvidence.bytes + 1 },
      }),
      currentApkEvidence,
    })

    expect(blocker).toMatchObject({
      id: 'android-target-runtime-qa',
      evidence: {
        failureReasons: ['ui-apk-stale'],
        sourceStale: true,
      },
    })
  })

  it('creates an explicit stale/failed blocker with headless QA handoff', () => {
    const blocker = buildAndroidTargetRuntimeBlocker({
      ...reports({
        emulatorPassed: false,
        uiFingerprint: staleFingerprint,
        cloudSyncFingerprint: staleFingerprint,
      }),
      currentApkEvidence,
      strictReport: { blockers: [{ label: 'Native runtime smoke artifacts' }] },
      sourcePaths: {
        strictPreflight: '.manual-qa/strict-release-preflight.json',
        androidEmulatorQa: '.manual-qa/android-emulator-qa.json',
        androidUiSmoke: '.manual-qa/android-ui-smoke.json',
        androidCloudSyncSmoke: '.manual-qa/android-cloud-sync-smoke.json',
      },
    })

    expect(blocker).toMatchObject({
      id: 'android-target-runtime-qa',
      blockerKind: 'android-target-runtime-qa-source-stale',
      releaseEvidence: false,
      evidence: {
        sourceStale: true,
        runtimeFailed: true,
        emulatorPassed: false,
        uiPassed: true,
        cloudSyncPassed: true,
        targetHostRuntimeEvidence: {
          headless: true,
          currentHostSatisfiesTargetRuntime: false,
        },
      },
    })
    expect(blocker.sourceReports).toEqual([
      '.manual-qa/strict-release-preflight.json',
      '.manual-qa/android-emulator-qa.json',
      '.manual-qa/android-ui-smoke.json',
      '.manual-qa/android-cloud-sync-smoke.json',
    ])
    expect(blocker.nextActions[0]).toMatch(/headless Android QA/u)
  })
})
