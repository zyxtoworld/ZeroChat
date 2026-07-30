import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  androidSourceFingerprint,
  currentAndroidDebugApkEvidence,
  sameAndroidSourceFingerprint,
  writeAndroidDebugApkBuildStamp,
} from '../android-source-fingerprint.mjs'

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function fixture() {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'zerochat-android-source-'))
  temporaryRoots.push(repoRoot)
  mkdirSync(path.join(repoRoot, 'source'), { recursive: true })
  writeFileSync(path.join(repoRoot, 'source', 'Main.kt'), 'fun main() = Unit\n')
  const apkPath = path.join(repoRoot, 'app-debug.apk')
  const stampPath = path.join(repoRoot, 'zerochat-build-source.json')
  writeFileSync(apkPath, 'apk-v1')
  return { repoRoot, roots: ['source'], apkPath, stampPath }
}

describe('Android APK source fingerprint', () => {
  it('is deterministic and changes with packaged source content', () => {
    const input = fixture()
    const first = androidSourceFingerprint(input)
    const second = androidSourceFingerprint(input)
    expect(sameAndroidSourceFingerprint(first, second)).toBe(true)

    writeFileSync(path.join(input.repoRoot, 'source', 'Main.kt'), 'fun main() = println("changed")\n')
    expect(sameAndroidSourceFingerprint(first, androidSourceFingerprint(input))).toBe(false)
  })

  it('binds the debug APK to the exact source used by assembleDebug', () => {
    const input = fixture()
    writeAndroidDebugApkBuildStamp({
      ...input,
      sourceFingerprint: androidSourceFingerprint(input),
    })

    expect(currentAndroidDebugApkEvidence(input).sourceFingerprint.kind).toBe(
      'zerochat.androidSourceFingerprint.v1',
    )

    writeFileSync(path.join(input.repoRoot, 'source', 'Main.kt'), 'fun main() = error("new")\n')
    expect(() => currentAndroidDebugApkEvidence(input)).toThrow(/built from stale source/u)
  })

  it('rejects an APK changed after the build-source stamp was written', () => {
    const input = fixture()
    writeAndroidDebugApkBuildStamp({
      ...input,
      sourceFingerprint: androidSourceFingerprint(input),
    })
    writeFileSync(input.apkPath, 'apk-v2')

    expect(() => currentAndroidDebugApkEvidence(input)).toThrow(/does not match its build-source stamp/u)
  })

  it('replaces an existing build-source stamp after a later successful build', () => {
    const input = fixture()
    const sourceFingerprint = androidSourceFingerprint(input)
    writeAndroidDebugApkBuildStamp({ ...input, sourceFingerprint })

    writeFileSync(input.apkPath, 'apk-v2-with-current-source')
    writeAndroidDebugApkBuildStamp({ ...input, sourceFingerprint })

    expect(currentAndroidDebugApkEvidence(input)).toMatchObject({
      bytes: Buffer.byteLength('apk-v2-with-current-source'),
      sourceFingerprint,
    })
  })
})
