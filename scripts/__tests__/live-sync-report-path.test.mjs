import { describe, expect, it } from 'vitest'

import {
  liveSyncCurrentDiagnosticReportPath,
  liveSyncReleasePassReportPath,
  liveSyncReportPath,
} from '../live-sync-report-path.mjs'

describe('live sync report path', () => {
  it('keeps an explicit report path authoritative', () => {
    expect(liveSyncReportPath({ explicitPath: ' reports/custom.json ', mode: 'gist' })).toBe(
      'reports/custom.json',
    )
  })

  it.each(['gist', 'cloudflare', ' GIST '])(
    'writes configured %s release attempts to the canonical report',
    (mode) => {
      expect(liveSyncReportPath({ mode })).toBe(liveSyncReleasePassReportPath)
    },
  )

  it.each([undefined, '', 'unsupported'])(
    'keeps non-release mode %s on the current diagnostic path',
    (mode) => {
      expect(liveSyncReportPath({ mode })).toBe(liveSyncCurrentDiagnosticReportPath)
    },
  )
})
