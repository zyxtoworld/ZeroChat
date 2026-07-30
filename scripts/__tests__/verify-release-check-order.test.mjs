import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { checksWithReleaseDiagnosticsBootstrap } from '../verify-release-check-order.mjs'

const bootstrapCheck = ['Release diagnostics freshness bootstrap', ['refresh']]
const strictPreflightRefreshCheck = ['Strict release preflight freshness refresh', ['strict-refresh']]

describe('verify-release check order', () => {
  it('inserts diagnostics bootstrap exactly once immediately after Vite production build', () => {
    const checks = [
      ['TypeScript', ['tsc']],
      ['Vite production build', ['vite', 'build']],
      ['ESLint', ['eslint']],
      ['Completion audit', ['audit']],
    ]

    const result = checksWithReleaseDiagnosticsBootstrap(checks, bootstrapCheck, true)

    expect(result.map(([label]) => label)).toEqual([
      'TypeScript',
      'Vite production build',
      'Release diagnostics freshness bootstrap',
      'ESLint',
      'Completion audit',
    ])
    expect(result.filter(([label]) => label === bootstrapCheck[0])).toHaveLength(1)
  })

  it('build-anchors the focused Web check sequence before expensive browser checks', () => {
    const webLocalChecks = [
      ['TypeScript', ['tsc']],
      ['Vite production build', ['vite', 'build']],
      ['ESLint', ['eslint']],
      ['Browser smoke', ['browser-smoke']],
    ]

    const result = checksWithReleaseDiagnosticsBootstrap(webLocalChecks, bootstrapCheck, true)

    expect(result.map(([label]) => label)).toEqual([
      'TypeScript',
      'Vite production build',
      'Release diagnostics freshness bootstrap',
      'ESLint',
      'Browser smoke',
    ])
  })

  it('runs prerequisite refreshes before diagnostics bootstrap after build', () => {
    const checks = [
      ['TypeScript', ['tsc']],
      ['Vite production build', ['vite', 'build']],
      ['ESLint', ['eslint']],
    ]

    const result = checksWithReleaseDiagnosticsBootstrap(checks, bootstrapCheck, true, [
      strictPreflightRefreshCheck,
    ])

    expect(result.map(([label]) => label)).toEqual([
      'TypeScript',
      'Vite production build',
      'Strict release preflight freshness refresh',
      'Release diagnostics freshness bootstrap',
      'ESLint',
    ])
  })

  it('leaves the non-release check sequence unchanged', () => {
    const checks = [['TypeScript', ['tsc']]]

    expect(checksWithReleaseDiagnosticsBootstrap(checks, bootstrapCheck, false)).toBe(checks)
  })

  it('fails closed when the production build anchor is missing', () => {
    expect(() =>
      checksWithReleaseDiagnosticsBootstrap(
        [
          ['TypeScript', ['tsc']],
          ['ESLint', ['eslint']],
        ],
        bootstrapCheck,
        true,
      ),
    ).toThrow('requires exactly one Vite production build check; found 0')
  })

  it('captures Browser smoke failures with redacted operation context', async () => {
    const [verifyRelease, browserSmoke] = await Promise.all([
      readFile(new URL('../verify-release.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../browser-skill-smoke.mjs', import.meta.url), 'utf8'),
    ])

    expect(verifyRelease).toMatch(
      /const capturedFailureCheckLabels = new Set\(\[[\s\S]*?'Browser smoke',/u,
    )
    expect(verifyRelease).toContain("from './release-report-sanitizer.mjs'")
    expect(verifyRelease).toContain('redactedValues: releaseReportRedactedValues')
    expect(verifyRelease).toContain('value.length >= 8')
    expect(browserSmoke).toContain(
      'Browser skill smoke failure context: last CDP operation ${lastCdpOperation}',
    )
    expect(browserSmoke).toContain('return rawCdp.send(method, params, sendOptions)')
  })
})
