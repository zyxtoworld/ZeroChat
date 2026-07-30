import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const rootDir = path.resolve(import.meta.dirname, '..', '..')

describe('live provider UI assistant marker', () => {
  it('rejects prefixed, suffixed, and duplicated marker content', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/live-provider-ui-smoke.mjs', '--self-test-assistant-marker'],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: { ...process.env },
        windowsHide: true,
      },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'Live provider UI exact assistant marker self-test passed',
    )
    expect(result.stderr).toBe('')
  })
})
