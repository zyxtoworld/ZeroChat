import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { assertReleaseAuditSourceIntegrity } from '../release-audit-source-integrity.mjs'

describe('release audit source integrity', () => {
  it.each([
    ['completion-audit', 'scripts/completion-audit-check.mjs'],
    ['repository-health', 'scripts/repository-health-check.mjs'],
  ])('%s reads exact repository source', async (checkerId, path) => {
    const source = await readFile(path, 'utf8')
    expect(() => assertReleaseAuditSourceIntegrity(checkerId, source)).not.toThrow()
  })

  it('rejects the retired Kotlin marker synthesizer', () => {
    const source = `
      async function readRepositoryFile(path) {
        return readFile(path, 'utf8').catch(() => '')
      }
      function androidKotlinAuditView(source) {
        const legacyInternalMarkers = []
        return source
      }
    `

    expect(() => assertReleaseAuditSourceIntegrity('repository-health', source))
      .toThrow(/must not synthesize source markers/u)
  })

  it('rejects appended declaration evidence even if the helper is renamed', () => {
    const source = [
      'async function readRepositoryFile(path) {',
      "  return readFile(path, 'utf8').catch(() => '')",
      '}',
      'const marker = `internal ${line}`',
    ].join('\n')

    expect(() => assertReleaseAuditSourceIntegrity('repository-health', source))
      .toThrow(/must not synthesize source markers/u)
  })
})
