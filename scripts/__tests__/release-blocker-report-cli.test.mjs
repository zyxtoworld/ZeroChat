import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  liveProviderUiAttemptReportPathPrefix,
  liveProviderUiReportPathPrefix,
  parseReleaseBlockerReportCliArgs,
  releaseBlockerReportCliFlags,
  releaseBlockerReportUsage,
} from '../release-blocker-report-cli.mjs'

describe('release blocker report CLI', () => {
  it.each([
    [[], 'report'],
    [['--check'], 'check'],
    [['--check-live-provider-ui-report'], 'check-live-provider-ui-report'],
  ])('accepts %j as %s mode', (args, mode) => {
    expect(parseReleaseBlockerReportCliArgs(args)).toMatchObject({ kind: 'run', mode })
  })

  it('accepts both live-provider UI report overrides only with the matching check mode', () => {
    expect(
      parseReleaseBlockerReportCliArgs([
        '--check-live-provider-ui-report',
        `${liveProviderUiReportPathPrefix}.manual-qa/live-provider-ui-smoke-current.json`,
        `${liveProviderUiAttemptReportPathPrefix}.manual-qa/live-provider-ui-smoke-attempt-current.json`,
      ]),
    ).toEqual({
      kind: 'run',
      mode: 'check-live-provider-ui-report',
      liveProviderUiReportPathOverride: '.manual-qa/live-provider-ui-smoke-current.json',
      liveProviderUiAttemptReportPathOverride: '.manual-qa/live-provider-ui-smoke-attempt-current.json',
    })
  })

  it.each([['--help'], ['-h'], ['--', '--help']])(
    'accepts %j only as standalone help',
    (...args) => {
      expect(parseReleaseBlockerReportCliArgs(args)).toEqual({ kind: 'help' })
    },
  )

  it('rejects unknown input without echoing it', () => {
    const result = parseReleaseBlockerReportCliArgs(['--private-value'])

    expect(result).toMatchObject({ kind: 'error' })
    expect(result.message).not.toContain('private-value')
  })

  it('rejects combined help, duplicates, conflicting modes, and orphan overrides', () => {
    expect(
      parseReleaseBlockerReportCliArgs(['--check', '--', '--help']),
    ).toMatchObject({ kind: 'error' })
    expect(parseReleaseBlockerReportCliArgs(['--check', '--check'])).toMatchObject({
      kind: 'error',
    })
    expect(
      parseReleaseBlockerReportCliArgs(['--check', '--check-live-provider-ui-report']),
    ).toMatchObject({ kind: 'error' })
    expect(
      parseReleaseBlockerReportCliArgs([
        `${liveProviderUiReportPathPrefix}.manual-qa/live-provider-ui-smoke-current.json`,
      ]),
    ).toMatchObject({ kind: 'error' })
  })

  it('documents every supported flag and the no-I/O help contract', () => {
    const usage = releaseBlockerReportUsage()

    for (const flag of releaseBlockerReportCliFlags) {
      expect(usage).toContain(flag)
    }
    expect(usage).toContain('without reading or writing reports')
  })

  it('parses CLI arguments before establishing the release root or summary paths', async () => {
    const source = await readFile(
      new URL('../release-blocker-report.mjs', import.meta.url),
      'utf8',
    )
    const parseIndex = source.indexOf(
      'const cliResult = parseReleaseBlockerReportCliArgs(process.argv.slice(2))',
    )

    expect(parseIndex).toBeGreaterThanOrEqual(0)
    expect(parseIndex).toBeLessThan(source.indexOf('const root ='))
    expect(parseIndex).toBeLessThan(source.indexOf('const sourceReportPaths = {'))
  })
})
