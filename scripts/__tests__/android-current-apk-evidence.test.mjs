import { describe, expect, it } from 'vitest'

import { readCurrentAndroidApkEvidence } from '../android-current-apk-evidence.mjs'

describe('current Android APK evidence boundary', () => {
  it('normalizes an unavailable source-bound APK to null without exposing the loader error', () => {
    const evidence = readCurrentAndroidApkEvidence({
      repoRoot: 'fixture-repo',
      loadEvidence: () => {
        throw new Error('private path and secret-shaped diagnostic')
      },
    })

    expect(evidence).toBeNull()
  })

  it('passes through validated evidence for report injection', () => {
    const evidence = {
      bytes: 12,
      sha256: 'A'.repeat(64),
      sourceFingerprint: { kind: 'zerochat.androidSourceFingerprint.v1' },
    }

    expect(
      readCurrentAndroidApkEvidence({
        repoRoot: 'fixture-repo',
        loadEvidence: () => evidence,
      }),
    ).toBe(evidence)
  })
})
