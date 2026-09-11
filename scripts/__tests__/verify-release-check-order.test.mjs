import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  checksWithReleaseDiagnosticsBootstrap,
  reconcileDeferredRuntimeArtifactStep,
  shouldRefreshWebCurrentPageEvidenceBeforeValidation,
} from '../verify-release-check-order.mjs'

const bootstrapCheck = ['Release diagnostics freshness bootstrap', ['refresh']]
const strictPreflightRefreshCheck = ['Strict release preflight freshness refresh', ['strict-refresh']]
const currentEvidencePreCheckpointSyncCheck = [
  'Current evidence docs pre-checkpoint sync',
  ['current-evidence-sync'],
]
const verifyReleaseCheckpointBootstrapCheck = [
  'Current source-bound checkpoint bootstrap',
  ['checkpoint-bootstrap'],
]

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

  it('refreshes the source-bound checkpoint before focused Web consumers', async () => {
    const verifyRelease = await readFile(
      new URL('../verify-release.mjs', import.meta.url),
      'utf8',
    )

    expect(verifyRelease).toContain('const shouldRefreshVerifyReleaseCheckpoint =')
    expect(verifyRelease).toContain('const currentEvidencePreCheckpointSyncCheck = [')
    expect(verifyRelease).toContain("'Current evidence docs pre-checkpoint sync'")
    expect(verifyRelease).toContain('ZEROCHAT_ALLOW_STALE_VERIFY_RELEASE_CHECKPOINT')
    expect(verifyRelease).toMatch(
      /const shouldRefreshVerifyReleaseCheckpoint = !skipVerifyReleaseCheckpoint/u,
    )
    expect(verifyRelease).toMatch(
      /if \(webLocal\) \{[\s\S]*?const webLocalChecks = checksWithReleaseDiagnosticsBootstrap\([\s\S]*?webLocalBaseChecks[\s\S]*?verifyReleaseCheckpointBootstrapCheck[\s\S]*?currentEvidencePreCheckpointSyncCheck[\s\S]*?for \(const check of webLocalChecks\)/u,
    )
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

  it('runs post-bootstrap sync before strict repository and completion audits', () => {
    const checks = [
      ['TypeScript', ['tsc']],
      ['Vite production build', ['vite', 'build']],
      ['ESLint', ['eslint']],
      ['Repository health', ['repo']],
      ['Completion audit', ['audit']],
    ]

    const result = checksWithReleaseDiagnosticsBootstrap(
      checks,
      bootstrapCheck,
      true,
      [strictPreflightRefreshCheck],
      [verifyReleaseCheckpointBootstrapCheck, currentEvidencePreCheckpointSyncCheck],
    )

    expect(result.map(([label]) => label)).toEqual([
      'TypeScript',
      'Vite production build',
      'Strict release preflight freshness refresh',
      'Release diagnostics freshness bootstrap',
      'Current source-bound checkpoint bootstrap',
      'Current evidence docs pre-checkpoint sync',
      'ESLint',
      'Repository health',
      'Completion audit',
    ])
  })

  it('writes a current source-bound checkpoint before checkpoint-dependent release consumers', async () => {
    const verifyRelease = await readFile(
      new URL('../verify-release.mjs', import.meta.url),
      'utf8',
    )
    const bootstrap = await readFile(
      new URL('../verify-release-checkpoint-bootstrap.mjs', import.meta.url),
      'utf8',
    )

    expect(verifyRelease).toContain('const verifyReleaseCheckpointBootstrapCheck = [')
    expect(verifyRelease).toContain("'Current source-bound checkpoint bootstrap'")
    expect(verifyRelease).toContain(
      '[verifyReleaseCheckpointBootstrapCheck, currentEvidencePreCheckpointSyncCheck]',
    )
    expect(bootstrap).toContain('createVerifyReleaseCheckpointBinding')
    expect(bootstrap).toContain('assertVerifyReleaseCheckpointInputBinding')
    expect(bootstrap).toContain("status: 'in-progress'")
  })

  it('keeps completion audit exclusively after the final checkpoint evidence sync', async () => {
    const verifyRelease = await readFile(
      new URL('../verify-release.mjs', import.meta.url),
      'utf8',
    )

    expect(verifyRelease).not.toContain(
      "['Completion audit', [fromRoot('scripts/completion-audit-check.mjs')]]",
    )
    expect(verifyRelease).toContain(
      "['Completion audit after current evidence sync', [fromRoot('scripts/completion-audit-check.mjs')]]",
    )
    expect(verifyRelease.indexOf('const postCheckpointValidationChecks = [')).toBeLessThan(
      verifyRelease.indexOf('Completion audit after current evidence sync'),
    )
  })

  it('refreshes audited stale current-page evidence immediately before artifact validation', async () => {
    const auditedStale = {
      webCurrentPageArtifact: {
        allowRefreshableStale: true,
        staleBulletLines: [
          '- .manual-qa/web-current-page-qa.json Web source digest must match current source. Rerun pnpm run qa:web-current after Web source changes.',
        ],
      },
    }

    expect(
      shouldRefreshWebCurrentPageEvidenceBeforeValidation({
        release: true,
        checkLabel: 'Visual audit artifact validation',
        audit: auditedStale,
      }),
    ).toBe(true)
    expect(
      shouldRefreshWebCurrentPageEvidenceBeforeValidation({
        release: false,
        checkLabel: 'Visual audit artifact validation',
        audit: auditedStale,
      }),
    ).toBe(false)
    expect(
      shouldRefreshWebCurrentPageEvidenceBeforeValidation({
        release: true,
        checkLabel: 'Repository health',
        audit: auditedStale,
      }),
    ).toBe(false)
    expect(
      shouldRefreshWebCurrentPageEvidenceBeforeValidation({
        release: true,
        checkLabel: 'Visual audit artifact validation',
        audit: {
          webCurrentPageArtifact: {
            allowRefreshableStale: false,
            staleBulletLines: auditedStale.webCurrentPageArtifact.staleBulletLines,
          },
        },
      }),
    ).toBe(false)
    expect(
      shouldRefreshWebCurrentPageEvidenceBeforeValidation({
        release: true,
        checkLabel: 'Visual audit artifact validation',
        audit: {
          webCurrentPageArtifact: {
            allowRefreshableStale: true,
            staleBulletLines: [],
          },
        },
      }),
    ).toBe(false)

    const verifyRelease = await readFile(
      new URL('../verify-release.mjs', import.meta.url),
      'utf8',
    )
    expect(verifyRelease).toContain('shouldRefreshWebCurrentPageEvidenceBeforeValidation({')
    expect(verifyRelease).toMatch(
      /shouldRefreshWebCurrentPageEvidenceBeforeValidation\([\s\S]*?await runWebCurrentPageQa\(\)/u,
    )
  })

  it('reconciles the deferred runtime step with its post-refresh result', async () => {
    const failedSteps = [
      { label: 'TypeScript', passed: true },
      {
        label: 'Runtime smoke artifacts',
        passed: false,
        error: 'Windows blocker plus stale Web evidence',
      },
      { label: 'Visual audit artifact validation', passed: true },
    ]

    expect(
      reconcileDeferredRuntimeArtifactStep(failedSteps, 'Current Windows blocker only'),
    ).toBe(true)
    expect(failedSteps).toHaveLength(3)
    expect(failedSteps[1]).toMatchObject({
      label: 'Runtime smoke artifacts',
      passed: false,
      error: 'Current Windows blocker only',
    })

    expect(reconcileDeferredRuntimeArtifactStep(failedSteps, null)).toBe(true)
    expect(failedSteps.map(({ label }) => label)).toEqual([
      'TypeScript',
      'Visual audit artifact validation',
    ])

    const verifyRelease = await readFile(
      new URL('../verify-release.mjs', import.meta.url),
      'utf8',
    )
    expect(verifyRelease).toContain('recordResult: false')
    expect(verifyRelease).toContain('reconcileDeferredRuntimeArtifactStep(')
  })

  it('writes a failed checkpoint even when the pre-checkpoint diagnostic refresh fails', async () => {
    const verifyRelease = await readFile(
      new URL('../verify-release.mjs', import.meta.url),
      'utf8',
    )

    expect(verifyRelease).toMatch(
      /let diagnosticsError = null[\s\S]*?diagnosticsError = refreshError[\s\S]*?await writeVerifyReleaseCheckpoint\(checkpointStatus, checkpointError\)/u,
    )
    expect(verifyRelease).toContain("const checkpointStatus = diagnosticsError ? 'failed' : status")
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
    const [verifyRelease, browserSmoke, currentPageQa] = await Promise.all([
      readFile(new URL('../verify-release.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../browser-skill-smoke.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../web-current-page-qa.mjs', import.meta.url), 'utf8'),
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
    expect(browserSmoke).toContain(
      "'.manual-qa/browser-skill-smoke-icon-sync-dom.json'",
    )
    expect(browserSmoke).not.toContain(
      "'.manual-qa/web-current-icon-sync-dom.json'",
    )
    expect(currentPageQa).toContain('ZEROCHAT_ICON_SYNC_DOM_REPORT: iconSyncDomReportPath')
  })

  it('defers a diagnostics-audited trusted-MSIX plus stale live-sync runtime failure', async () => {
    const verifyRelease = await readFile(
      new URL('../verify-release.mjs', import.meta.url),
      'utf8',
    )

    expect(verifyRelease).toContain('classifyAuditedRuntimeArtifactFailure')
    expect(verifyRelease).toContain('TRUSTED_MSIX_HOST_PREFLIGHT_BLOCKER_KINDS')
    expect(verifyRelease).not.toContain('const hostAppxDeploymentBlockerKinds = new Set(')
    expect(verifyRelease).toContain('function currentRuntimeArtifactExpectedBlockerAudit()')
    expect(verifyRelease).toMatch(
      /shouldContinueAfterExpectedRuntimeArtifactFailure[\s\S]*?classifyAuditedRuntimeArtifactFailure\([\s\S]*?currentRuntimeArtifactExpectedBlockerAudit\(\)/u,
    )
    expect(verifyRelease).toMatch(
      /classifyExpectedVerifyFailure[\s\S]*?classifyAuditedRuntimeArtifactFailure\([\s\S]*?currentRuntimeArtifactExpectedBlockerAudit\(\)/u,
    )
  })
})
