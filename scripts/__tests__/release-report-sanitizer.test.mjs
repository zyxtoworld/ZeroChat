import { describe, expect, it } from 'vitest'

import {
  hasUnsafeReleaseReportMaterial,
  sanitizeReleaseReportText,
} from '../release-report-sanitizer.mjs'

const repositoryRoot = 'E:\\workspace\\ZeroChat'

describe('release report sanitizer', () => {
  it.each([
    ['provider key', 'sk-' + 'a'.repeat(48)],
    ['bearer token', 'Bearer ' + 'b'.repeat(48)],
    ['fine-grained GitHub PAT', 'github_pat_' + 'c'.repeat(48)],
    ['classic GitHub PAT', 'ghp_' + 'd'.repeat(40)],
    ['passphrase assignment', 'ZEROCHAT_LIVE_SYNC_PASSPHRASE=correct-horse-battery-staple'],
    ['quoted API-key assignment', ['ZEROCHAT_LIVE_PROVIDER_API_KEY', '=secret-value'].join('')],
    ['provider URL', 'https://provider.example/v1/models'],
    ['repository path', `${repositoryRoot}\\.manual-qa\\report.json`],
    ['outside drive path', 'C:\\Users\\Alice\\Desktop\\private.txt'],
    ['extended drive path', '\\\\?\\D:\\QA\\private.txt'],
    ['UNC path', '\\\\server\\share\\private.txt'],
  ])('redacts and rejects raw %s material', (_label, unsafe) => {
    expect(hasUnsafeReleaseReportMaterial({ value: unsafe }, { repositoryRoot })).toBe(true)

    const sanitized = sanitizeReleaseReportText(unsafe, { repositoryRoot })
    expect(sanitized).not.toContain(unsafe)
    expect(hasUnsafeReleaseReportMaterial({ value: sanitized }, { repositoryRoot })).toBe(false)
  })

  it('preserves protocol paths, relative evidence paths, commands, and SHA-256 evidence', () => {
    const safe = {
      endpointPath: '/audio/transcriptions',
      evidencePath: '.manual-qa/live-provider-smoke.json',
      command: 'pnpm run check:release-blockers',
      sha256: 'A'.repeat(64),
      redactedAssignment: 'ZEROCHAT_LIVE_SYNC_PASSPHRASE=[redacted]',
    }

    expect(hasUnsafeReleaseReportMaterial(safe, { repositoryRoot })).toBe(false)
    expect(sanitizeReleaseReportText(safe.endpointPath, { repositoryRoot })).toBe(
      safe.endpointPath,
    )
  })

  it('redacts caller-supplied ephemeral credential values before publishing diagnostics', () => {
    const ephemeralCredential = 'temporary-provider-credential-value'
    const sanitized = sanitizeReleaseReportText(
      `Browser smoke emitted ${ephemeralCredential} while failing`,
      {
        repositoryRoot,
        redactedValues: [ephemeralCredential],
      },
    )

    expect(sanitized).not.toContain(ephemeralCredential)
    expect(sanitized).toContain('[redacted]')
  })
})
