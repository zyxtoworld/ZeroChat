import { describe, expect, it } from 'vitest'

import { windowsTrustedMsixReleasePassFailures } from '../windows-msix-release-pass-policy.mjs'

function currentPassFixture() {
  return {
    validation: {
      passed: true,
      expectedCode: 0,
      actualCode: 0,
      outcome: 'passed',
    },
    report: {
      passed: true,
      elevated: true,
      previousVersion: '0.0.0.9',
      currentVersion: '0.0.1.0',
      webAssetsMatchDist: true,
      distWebAssets: { fileCount: 42, totalBytes: 1_117_221 },
      windowsOutputWebAssets: { fileCount: 42, totalBytes: 1_117_221 },
      install: { InstalledVersion: '0.0.0.9', SignatureTrusted: true },
      update: { InstalledVersion: '0.0.1.0', SignatureTrusted: true },
      uninstall: { Installed: false },
      launchAfterInstall: {
        windowWidth: 1280,
        windowHeight: 735,
        screenshotBytes: 143_464,
      },
      launchAfterUpdate: {
        windowWidth: 1280,
        windowHeight: 735,
        screenshotBytes: 143_464,
      },
      cleanupVerified: {
        packageInstalled: false,
        currentUserTrustedPeople: false,
        localMachineTrustedPeople: false,
        localMachineRoot: false,
        currentUserMy: false,
        privatePfxExists: false,
        packageLocalDataExists: false,
        temporaryDirectoryExists: false,
      },
    },
  }
}

describe('Windows trusted MSIX release-pass policy', () => {
  it('accepts a validated elevated install/update/uninstall pass with complete cleanup', () => {
    expect(windowsTrustedMsixReleasePassFailures(currentPassFixture())).toEqual([])
  })

  it('rejects an absent current runtime validation', () => {
    const fixture = currentPassFixture()
    fixture.validation = undefined

    expect(windowsTrustedMsixReleasePassFailures(fixture)).toContain(
      'release blocker source validation must record the trusted MSIX runtime artifact as a current pass.',
    )
  })

  it('rejects residue and missing packaged launch evidence', () => {
    const fixture = currentPassFixture()
    fixture.report.cleanupVerified.packageInstalled = true
    fixture.report.launchAfterUpdate.screenshotBytes = 0

    expect(windowsTrustedMsixReleasePassFailures(fixture)).toEqual([
      'trusted MSIX cleanupVerified.packageInstalled must be false.',
      'trusted MSIX report must preserve non-empty packaged launch screenshots.',
    ])
  })
})
