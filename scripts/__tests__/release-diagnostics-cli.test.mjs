import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  releaseDiagnosticsCliFlags,
  releaseDiagnosticsUsage,
  parseReleaseDiagnosticsCliArgs,
} from '../release-diagnostics-cli.mjs'

describe('release diagnostics CLI', () => {
  it.each([
    [
      [],
      {
        kind: 'run',
        mode: 'refresh',
        validateCurrentSources: false,
        allowRefreshableWebCurrentPageStale: false,
      },
    ],
    [
      ['--check'],
      {
        kind: 'run',
        mode: 'check',
        validateCurrentSources: false,
        allowRefreshableWebCurrentPageStale: false,
      },
    ],
    [
      ['--refresh-source-reports'],
      {
        kind: 'run',
        mode: 'refresh-source-reports',
        validateCurrentSources: false,
        allowRefreshableWebCurrentPageStale: false,
      },
    ],
    [
      ['--write-current-summary'],
      {
        kind: 'run',
        mode: 'write-current-summary',
        validateCurrentSources: false,
        allowRefreshableWebCurrentPageStale: false,
      },
    ],
    [
      ['--validate-current-sources', '--write-current-summary'],
      {
        kind: 'run',
        mode: 'write-current-summary',
        validateCurrentSources: true,
        allowRefreshableWebCurrentPageStale: false,
      },
    ],
    [
      [
        '--write-current-summary',
        '--validate-current-sources',
        '--allow-refreshable-web-current-page-stale',
      ],
      {
        kind: 'run',
        mode: 'write-current-summary',
        validateCurrentSources: true,
        allowRefreshableWebCurrentPageStale: true,
      },
    ],
  ])('accepts %j', (args, expected) => {
    expect(parseReleaseDiagnosticsCliArgs(args)).toEqual(expected)
  })

  it.each([['--help'], ['-h'], ['--', '--help']])(
    'accepts %j only as standalone help',
    (...args) => {
      expect(parseReleaseDiagnosticsCliArgs(args)).toEqual({ kind: 'help' })
    },
  )

  it('rejects unknown input without echoing it', () => {
    const result = parseReleaseDiagnosticsCliArgs(['--private-value'])

    expect(result).toMatchObject({ kind: 'error' })
    expect(result.message).not.toContain('private-value')
  })

  it('rejects combined help, duplicates, and invalid mode combinations', () => {
    expect(
      parseReleaseDiagnosticsCliArgs(['--write-current-summary', '--', '--help']),
    ).toMatchObject({ kind: 'error' })
    expect(parseReleaseDiagnosticsCliArgs(['--check', '--check'])).toMatchObject({ kind: 'error' })
    expect(
      parseReleaseDiagnosticsCliArgs(['--check', '--write-current-summary']),
    ).toMatchObject({ kind: 'error' })
    expect(
      parseReleaseDiagnosticsCliArgs(['--refresh-source-reports', '--write-current-summary']),
    ).toMatchObject({ kind: 'error' })
    expect(parseReleaseDiagnosticsCliArgs(['--validate-current-sources'])).toMatchObject({
      kind: 'error',
    })
    expect(
      parseReleaseDiagnosticsCliArgs(['--allow-refreshable-web-current-page-stale']),
    ).toMatchObject({ kind: 'error' })
    expect(
      parseReleaseDiagnosticsCliArgs([
        '--write-current-summary',
        '--allow-refreshable-web-current-page-stale',
      ]),
    ).toMatchObject({ kind: 'error' })
  })

  it('documents every supported flag and the no-I/O help contract', () => {
    const usage = releaseDiagnosticsUsage()

    for (const flag of releaseDiagnosticsCliFlags) {
      expect(usage).toContain(flag)
    }
    expect(usage).toContain('without reading or writing reports')
  })

  it('parses CLI arguments before establishing the release root or diagnostic paths', async () => {
    const source = await readFile(
      new URL('../release-diagnostics-refresh.mjs', import.meta.url),
      'utf8',
    )
    const parseIndex = source.indexOf(
      'const cliResult = parseReleaseDiagnosticsCliArgs(process.argv.slice(2))',
    )

    expect(parseIndex).toBeGreaterThanOrEqual(0)
    expect(parseIndex).toBeLessThan(source.indexOf('const root ='))
    expect(parseIndex).toBeLessThan(source.indexOf('const reportPaths = ['))
  })
})
