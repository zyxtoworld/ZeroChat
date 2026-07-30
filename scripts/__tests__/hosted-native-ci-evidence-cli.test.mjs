import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  defaultHostedNativeCiEvidenceReportPath,
  hostedNativeCiEvidenceCliFlags,
  hostedNativeCiEvidenceReportPathPrefix,
  hostedNativeCiEvidenceUsage,
  parseHostedNativeCiEvidenceCliArgs,
} from '../hosted-native-ci-evidence-cli.mjs'

describe('hosted native CI evidence CLI', () => {
  it.each([
    [[], 'check'],
    [['--require'], 'require'],
    [['--refresh-diagnostic'], 'refresh-diagnostic'],
  ])('accepts %j as %s mode', (args, mode) => {
    expect(parseHostedNativeCiEvidenceCliArgs(args)).toEqual({
      kind: 'run',
      mode,
      reportPath: defaultHostedNativeCiEvidenceReportPath,
    })
  })

  it('accepts one explicit report path with each valid action', () => {
    const reportPath = '.manual-qa/hosted-native-ci-evidence-fixture.json'

    expect(
      parseHostedNativeCiEvidenceCliArgs(['--refresh-diagnostic', `${hostedNativeCiEvidenceReportPathPrefix}${reportPath}`]),
    ).toEqual({
      kind: 'run',
      mode: 'refresh-diagnostic',
      reportPath,
    })
  })

  it.each([['--help'], ['-h'], ['--', '--help']])(
    'accepts %j only as standalone help',
    (...args) => {
      expect(parseHostedNativeCiEvidenceCliArgs(args)).toEqual({ kind: 'help' })
    },
  )

  it('rejects unknown input without echoing it', () => {
    const result = parseHostedNativeCiEvidenceCliArgs(['--private-value'])

    expect(result).toMatchObject({ kind: 'error' })
    expect(result.message).not.toContain('private-value')
  })

  it('rejects combined help, duplicates, ambiguous actions, and duplicate report paths', () => {
    expect(
      parseHostedNativeCiEvidenceCliArgs(['--refresh-diagnostic', '--', '--help']),
    ).toMatchObject({ kind: 'error' })
    expect(parseHostedNativeCiEvidenceCliArgs(['--require', '--require'])).toMatchObject({
      kind: 'error',
    })
    expect(
      parseHostedNativeCiEvidenceCliArgs(['--require', '--refresh-diagnostic']),
    ).toMatchObject({ kind: 'error' })
    expect(
      parseHostedNativeCiEvidenceCliArgs([
        `${hostedNativeCiEvidenceReportPathPrefix}.manual-qa/first.json`,
        `${hostedNativeCiEvidenceReportPathPrefix}.manual-qa/second.json`,
      ]),
    ).toMatchObject({ kind: 'error' })
  })

  it('documents every supported flag and the no-I/O help contract', () => {
    const usage = hostedNativeCiEvidenceUsage()

    for (const flag of hostedNativeCiEvidenceCliFlags) {
      expect(usage).toContain(flag)
    }
    expect(usage).toContain(hostedNativeCiEvidenceReportPathPrefix)
    expect(usage).toContain('without reading or writing reports')
  })

  it('parses CLI arguments before establishing report paths or invoking checks', async () => {
    const source = await readFile(
      new URL('../hosted-native-ci-evidence-check.mjs', import.meta.url),
      'utf8',
    )
    const parseIndex = source.indexOf(
      'const cliResult = parseHostedNativeCiEvidenceCliArgs(process.argv.slice(2))',
    )

    expect(parseIndex).toBeGreaterThanOrEqual(0)
    expect(parseIndex).toBeLessThan(source.indexOf('const DEFAULT_REPORT ='))
    expect(parseIndex).toBeLessThan(source.indexOf('const currentNativePrereqReportPath ='))
  })
})
