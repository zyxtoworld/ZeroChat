import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  currentEvidenceCliFlags,
  currentEvidenceUsage,
  parseCurrentEvidenceCliArgs,
  shouldAllowStaleVerifyReleaseCheckpointForWriteDocs,
} from '../release-current-evidence-cli.mjs'

describe('current evidence CLI', () => {
  it.each([
    [[], 'report'],
    [['--check'], 'check'],
    [['--write-docs'], 'write-docs'],
  ])('accepts %j as %s mode', (args, mode) => {
    expect(parseCurrentEvidenceCliArgs(args)).toEqual({ kind: 'run', mode })
  })

  it.each([['--help'], ['-h'], ['--', '--help']])(
    'accepts %j only as standalone help',
    (...args) => {
      expect(parseCurrentEvidenceCliArgs(args)).toEqual({ kind: 'help' })
    },
  )

  it('rejects unknown input before evidence processing can start', () => {
    expect(parseCurrentEvidenceCliArgs(['--not-a-mode'])).toEqual({
      kind: 'error',
      message:
        'Current evidence summary failed: Unsupported command-line argument. Run with --help for supported modes.',
    })
  })

  it('rejects help combined with a write request after package-manager normalization', () => {
    expect(parseCurrentEvidenceCliArgs(['--write-docs', '--', '--help'])).toEqual({
      kind: 'error',
      message:
        'Current evidence summary failed: --help must be used by itself. Run with --help for supported modes.',
    })
  })

  it('rejects duplicate and conflicting modes', () => {
    expect(parseCurrentEvidenceCliArgs(['--check', '--check'])).toEqual({
      kind: 'error',
      message: 'Current evidence summary failed: Each command-line flag may appear only once.',
    })
    expect(parseCurrentEvidenceCliArgs(['--check', '--write-docs'])).toEqual({
      kind: 'error',
      message: 'Current evidence summary failed: Select exactly one command-line mode.',
    })
  })

  it('documents every supported evidence mode', () => {
    const usage = currentEvidenceUsage()

    for (const flag of currentEvidenceCliFlags) {
      expect(usage).toContain(flag)
    }
    expect(usage).toContain('without reading evidence or writing documents')
  })

  it('allows a stale checkpoint only for the verifier-owned write-docs bootstrap', () => {
    expect(
      shouldAllowStaleVerifyReleaseCheckpointForWriteDocs({
        mode: 'write-docs',
        environment: { ZEROCHAT_ALLOW_STALE_VERIFY_RELEASE_CHECKPOINT: '1' },
      }),
    ).toBe(true)

    for (const [mode, value] of [
      ['report', '1'],
      ['check', '1'],
      ['write-docs', undefined],
      ['write-docs', 'true'],
    ]) {
      expect(
        shouldAllowStaleVerifyReleaseCheckpointForWriteDocs({
          mode,
          environment: value
            ? { ZEROCHAT_ALLOW_STALE_VERIFY_RELEASE_CHECKPOINT: value }
            : {},
        }),
      ).toBe(false)
    }
  })

  it('parses CLI arguments before it establishes evidence paths or document writers', async () => {
    const source = await readFile(
      new URL('../release-current-evidence-summary.mjs', import.meta.url),
      'utf8',
    )
    const parseIndex = source.indexOf(
      'const cliResult = parseCurrentEvidenceCliArgs(process.argv.slice(2))',
    )

    expect(parseIndex).toBeGreaterThanOrEqual(0)
    expect(parseIndex).toBeLessThan(source.indexOf('const paths = {'))
    expect(parseIndex).toBeLessThan(source.indexOf('async function writeTextFileAtomically'))
  })
})
