import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../android-emulator-qa.mjs', import.meta.url),
  'utf8',
)
const cloudSyncSource = readFileSync(
  new URL('../android-cloud-sync-smoke.mjs', import.meta.url),
  'utf8',
)

describe('Android emulator QA timeout budget', () => {
  it('serializes the complete Android QA lifecycle with an owner lock', () => {
    expect(source).toContain('acquireAndroidQaLock()')
    expect(source).toContain('releaseAndroidQaLock()')
    expect(source).toContain('Another ZeroChat Android QA is already running')
    expect(source).toContain('rmSync(androidQaLockPath, { recursive: true, force: true })')
  })

  it('allows the full UI smoke to include real Activity recreation evidence', () => {
    const match = source.match(
      /const ANDROID_UI_SMOKE_TIMEOUT_MS = ([\d_]+)/u,
    )

    expect(match).not.toBeNull()
    expect(Number(match[1].replaceAll('_', ''))).toBeGreaterThanOrEqual(2_700_000)
  })

  it('allows incremental sync to finish its per-object key derivation on the emulator', () => {
    const match = cloudSyncSource.match(
      /const conversationUploadWaitAttempts = ([\d_]+)/u,
    )

    expect(match).not.toBeNull()
    expect(Number(match[1].replaceAll('_', ''))).toBeGreaterThanOrEqual(360)
  })

  it('keeps the parent Cloudflare smoke budget above the measured full drill runtime', () => {
    const match = source.match(
      /const ANDROID_CLOUD_SYNC_SMOKE_TIMEOUT_MS = ([\d_]+)/u,
    )

    expect(match).not.toBeNull()
    expect(Number(match[1].replaceAll('_', ''))).toBeGreaterThanOrEqual(2_700_000)
  })
})
