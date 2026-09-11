import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { describe, it } from 'vitest'

describe('live sync safety checker process lifetime', () => {
  it('uses one bounded spawn helper for child fixtures', async () => {
    const source = await readFile('scripts/live-sync-release-drill-check.mjs', 'utf8')

    assert.match(source, /const LIVE_SYNC_CHECK_CHILD_TIMEOUT_MS = 60_000/u)
    assert.match(source, /function runDrillFixture\(/u)
    assert.match(source, /timeout: LIVE_SYNC_CHECK_CHILD_TIMEOUT_MS/u)
    assert.match(source, /killSignal: 'SIGKILL'/u)
    assert.doesNotMatch(source, /spawnSync\(process\.execPath/u)
  })
})
