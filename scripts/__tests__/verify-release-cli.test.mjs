import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  parseVerifyReleaseCliArgs,
  verifyReleaseCliFlags,
  verifyReleaseRerunCommands,
  verifyReleaseUsage,
} from '../verify-release-cli.mjs'

describe('verify-release CLI', () => {
  it('accepts the package-defined release combinations', () => {
    const result = parseVerifyReleaseCliArgs([
      '--all-platforms',
      '--require-native-runtime-artifacts',
      '--require-live-sync-pass',
      '--require-hosted-native-ci-evidence',
      '--require-live-provider-full-capability',
    ])

    expect(result.kind).toBe('run')
    expect([...result.flags]).toEqual([
      '--all-platforms',
      '--require-native-runtime-artifacts',
      '--require-live-sync-pass',
      '--require-hosted-native-ci-evidence',
      '--require-live-provider-full-capability',
    ])
  })

  it.each([['--help'], ['-h']])('accepts %s only as standalone help', (flag) => {
    expect(parseVerifyReleaseCliArgs([flag])).toEqual({ kind: 'help' })
  })

  it('consumes the package-manager separator before standalone help', () => {
    expect(parseVerifyReleaseCliArgs(['--', '--help'])).toEqual({ kind: 'help' })
  })

  it('rejects unknown flags before verification can start', () => {
    expect(parseVerifyReleaseCliArgs(['--not-a-mode'])).toEqual({
      kind: 'error',
      message:
        'Verify release failed: Unsupported command-line argument. Run with --help for supported modes.',
    })
  })

  it('rejects help combined with a verification mode', () => {
    expect(parseVerifyReleaseCliArgs(['--release', '--', '--help'])).toEqual({
      kind: 'error',
      message: 'Verify release failed: --help must be used by itself. Run with --help for supported modes.',
    })
  })

  it('rejects duplicate flags instead of silently discarding them', () => {
    expect(parseVerifyReleaseCliArgs(['--release', '--release'])).toEqual({
      kind: 'error',
      message: 'Verify release failed: Each command-line flag may appear only once.',
    })
  })

  it('documents every parsed verification flag', () => {
    const usage = verifyReleaseUsage()

    for (const flag of verifyReleaseCliFlags) {
      expect(usage).toContain(flag)
    }
    expect(usage).toContain('without checks or report writes')
  })

  it('keeps exact and baseline rerun guidance for release live-sync checkpoints', () => {
    expect(
      verifyReleaseRerunCommands(
        new Set(['--release', '--require-live-sync-pass']),
      ),
    ).toEqual([
      'pnpm run verify:release:live-sync',
      'pnpm run verify:release',
    ])
  })

  it('maps the strict all-platform package variant to its exact rerun command', () => {
    expect(
      verifyReleaseRerunCommands(
        new Set([
          '--all-platforms',
          '--require-native-runtime-artifacts',
          '--require-live-sync-pass',
          '--require-hosted-native-ci-evidence',
          '--require-live-provider-full-capability',
        ]),
      ),
    ).toEqual([
      'pnpm run verify:all-platforms:runtime-live-sync-hosted-provider',
    ])
  })

  it('parses CLI arguments before it establishes release paths or checks', async () => {
    const source = await readFile(new URL('../verify-release.mjs', import.meta.url), 'utf8')
    const parseIndex = source.indexOf(
      'const cliResult = parseVerifyReleaseCliArgs(process.argv.slice(2))',
    )

    expect(parseIndex).toBeGreaterThanOrEqual(0)
    expect(parseIndex).toBeLessThan(source.indexOf("const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')"))
    expect(parseIndex).toBeLessThan(source.indexOf("const verifyReleaseCheckpointReport = '.manual-qa/verify-release-current.json'"))
  })
})
