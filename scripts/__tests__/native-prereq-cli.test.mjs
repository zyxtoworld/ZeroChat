import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  nativeBuildPrereqCliFlags,
  nativeBuildPrereqUsage,
  nativePrereqReportRefreshCliFlags,
  nativePrereqReportRefreshUsage,
  nativePrereqSupportedPlatforms,
  parseNativeBuildPrereqCliArgs,
  parseNativePrereqReportRefreshCliArgs,
} from '../native-prereq-cli.mjs'

describe('native prerequisite CLI', () => {
  it('parses a direct preflight with supported platform and report forms', () => {
    expect(parseNativeBuildPrereqCliArgs([])).toEqual({
      kind: 'run',
      requestedPlatform: 'all',
      reportPath: '',
    })
    expect(
      parseNativeBuildPrereqCliArgs([
        '--platform',
        'WINDOWS',
        '--report',
        '.manual-qa/native-prereq-windows-fixture.json',
      ]),
    ).toEqual({
      kind: 'run',
      requestedPlatform: 'windows',
      reportPath: '.manual-qa/native-prereq-windows-fixture.json',
    })
    expect(
      parseNativeBuildPrereqCliArgs(['--platform=current'], {
        defaultReportPath: '.manual-qa/native-prereq-from-environment.json',
      }),
    ).toEqual({
      kind: 'run',
      requestedPlatform: 'current',
      reportPath: '.manual-qa/native-prereq-from-environment.json',
    })
  })

  it.each([['--help'], ['-h'], ['--', '--help']])(
    'accepts %j only as standalone direct-preflight help',
    (...args) => {
      expect(parseNativeBuildPrereqCliArgs(args)).toEqual({ kind: 'help' })
    },
  )

  it('rejects direct-preflight unknown input without echoing it', () => {
    const result = parseNativeBuildPrereqCliArgs(['--private-value'])

    expect(result).toMatchObject({ kind: 'error' })
    expect(result.message).not.toContain('private-value')
  })

  it('rejects direct-preflight combined help, empty values, duplicates, and invalid platforms', () => {
    expect(parseNativeBuildPrereqCliArgs(['--platform=current', '--help'])).toMatchObject({
      kind: 'error',
    })
    expect(parseNativeBuildPrereqCliArgs(['--platform='])).toMatchObject({ kind: 'error' })
    expect(parseNativeBuildPrereqCliArgs(['--report'])).toMatchObject({ kind: 'error' })
    expect(
      parseNativeBuildPrereqCliArgs(['--platform=windows', '--platform=android']),
    ).toMatchObject({ kind: 'error' })
    expect(
      parseNativeBuildPrereqCliArgs([
        '--report=.manual-qa/one.json',
        '--report=.manual-qa/two.json',
      ]),
    ).toMatchObject({ kind: 'error' })
    expect(parseNativeBuildPrereqCliArgs(['--platform=other'])).toMatchObject({ kind: 'error' })
  })

  it('parses explicit refresh report sets without doing filesystem discovery', () => {
    expect(parseNativePrereqReportRefreshCliArgs([])).toEqual({
      kind: 'run',
      reportPaths: [],
    })
    expect(
      parseNativePrereqReportRefreshCliArgs([
        '--report=.manual-qa/native-prereq-current-fixture.json',
        '--report',
        '.manual-qa/native-prereq-windows-fixture.json',
      ]),
    ).toEqual({
      kind: 'run',
      reportPaths: [
        '.manual-qa/native-prereq-current-fixture.json',
        '.manual-qa/native-prereq-windows-fixture.json',
      ],
    })
  })

  it.each([['--help'], ['-h'], ['--', '--help']])(
    'accepts %j only as standalone refresh help',
    (...args) => {
      expect(parseNativePrereqReportRefreshCliArgs(args)).toEqual({ kind: 'help' })
    },
  )

  it('rejects refresh unknown input without echoing it', () => {
    const result = parseNativePrereqReportRefreshCliArgs(['--private-value'])

    expect(result).toMatchObject({ kind: 'error' })
    expect(result.message).not.toContain('private-value')
  })

  it('rejects refresh combined help, empty reports, and duplicate paths', () => {
    expect(
      parseNativePrereqReportRefreshCliArgs(['--report=.manual-qa/native-prereq-fixture.json', '--help']),
    ).toMatchObject({ kind: 'error' })
    expect(parseNativePrereqReportRefreshCliArgs(['--report='])).toMatchObject({ kind: 'error' })
    expect(parseNativePrereqReportRefreshCliArgs(['--report'])).toMatchObject({ kind: 'error' })
    expect(
      parseNativePrereqReportRefreshCliArgs([
        '--report=.manual-qa/native-prereq-fixture.json',
        '--report=.manual-qa/native-prereq-fixture.json',
      ]),
    ).toMatchObject({ kind: 'error' })
  })

  it('rejects case-variant refresh report paths before either report can change', async () => {
    const reportPath = '.manual-qa/native-prereq-current-' + process.pid + '.json'
    const reportFile = path.resolve(reportPath)
    await mkdir(path.dirname(reportFile), { recursive: true })
    await writeFile(reportFile, 'fixture-report\\n', 'utf8')
    const result = spawnSync(
      process.execPath,
      [
        path.resolve('scripts/native-prereq-report-refresh.mjs'),
        `--report=${reportPath}`,
        '--report=' + reportPath.toUpperCase(),
      ],
      { cwd: path.resolve(), encoding: 'utf8' },
    )

    expect(result.status).toBe(1)
    await expect(readFile(reportFile)).resolves.toEqual(Buffer.from('fixture-report\\n'))
    await rm(reportFile, { force: true })
  })

  it('documents supported flags and the no-write help contract', () => {
    const directUsage = nativeBuildPrereqUsage()
    const refreshUsage = nativePrereqReportRefreshUsage()

    for (const flag of nativeBuildPrereqCliFlags) {
      expect(directUsage).toContain(flag)
    }
    for (const flag of nativePrereqReportRefreshCliFlags) {
      expect(refreshUsage).toContain(flag)
    }
    for (const platform of nativePrereqSupportedPlatforms) {
      expect(directUsage).toContain(platform)
    }
    expect(directUsage).toContain('do not read or write reports')
    expect(refreshUsage).toContain('do not read or write reports')
  })

  it('parses both write-capable commands before report discovery or preflight work', async () => {
    const [directSource, refreshSource] = await Promise.all([
      readFile(new URL('../native-build-prereq-check.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../native-prereq-report-refresh.mjs', import.meta.url), 'utf8'),
    ])
    const directParseIndex = directSource.indexOf(
      'const cliResult = parseNativeBuildPrereqCliArgs(process.argv.slice(2)',
    )
    const refreshParseIndex = refreshSource.indexOf(
      'const cliResult = parseNativePrereqReportRefreshCliArgs(process.argv.slice(2))',
    )

    expect(directParseIndex).toBeGreaterThanOrEqual(0)
    expect(directParseIndex).toBeLessThan(directSource.indexOf('function commandExists'))
    expect(refreshParseIndex).toBeGreaterThanOrEqual(0)
    expect(refreshParseIndex).toBeLessThan(refreshSource.indexOf('function reportPathsFromArgs'))
    expect(refreshParseIndex).toBeLessThan(refreshSource.indexOf('const reportPaths ='))
  })
})
