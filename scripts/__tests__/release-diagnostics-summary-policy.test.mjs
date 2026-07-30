import { describe, expect, it } from 'vitest'

import {
  releaseBlockerIdsFromReport,
  releaseDiagnosticsChildSummaryFailures,
} from '../release-diagnostics-summary-policy.mjs'
import { currentSummaryRefreshPlan } from '../release-diagnostics-summary-refresh-plan.mjs'

describe('release diagnostics summary policy', () => {
  it('rebuilds the blocker summary before writing a current aggregate summary', () => {
    const plan = currentSummaryRefreshPlan(true)

    expect(plan.refreshBlockerSummary).toEqual({
      label: 'Refresh current release blocker summary',
      args: ['scripts/release-blocker-report.mjs'],
    })
    expect(plan.validateBlockerSources).toEqual({
      label: 'Validate current release blocker source reports',
      args: ['scripts/release-blocker-report.mjs', '--check'],
    })
  })

  it('does not add a source validation pass unless requested', () => {
    expect(currentSummaryRefreshPlan(false).validateBlockerSources).toBeNull()
  })

  it('accepts a safe passed browser-origin child without promoting the aggregate', () => {
    expect(
      releaseDiagnosticsChildSummaryFailures([
        {
          path: '.manual-qa/live-provider-ui-smoke-attempt-current.json',
          status: 'passed',
          evidenceType: 'live-provider-ui-release-evidence',
          safeToPublish: true,
          releaseEvidence: true,
        },
        {
          path: '.manual-qa/release-blockers-current.json',
          status: 'blocked',
          evidenceType: 'release-blocker-summary-diagnostic',
          safeToPublish: true,
          releaseEvidence: false,
        },
      ]),
    ).toEqual([])
  })

  it('rejects release-evidence flags on unknown, failed, or mismatched child summaries', () => {
    expect(
      releaseDiagnosticsChildSummaryFailures([
        {
          path: '.manual-qa/strict-release-preflight.json',
          status: 'passed',
          evidenceType: 'strict-release-preflight-diagnostic',
          safeToPublish: true,
          releaseEvidence: true,
        },
        {
          path: '.manual-qa/live-provider-ui-smoke-attempt-current.json',
          status: 'failed',
          evidenceType: 'live-provider-ui-release-evidence',
          safeToPublish: true,
          releaseEvidence: true,
        },
        {
          path: '.manual-qa/live-sync-release-drill.json',
          status: 'passed',
          evidenceType: 'diagnostic',
          safeToPublish: true,
          releaseEvidence: true,
        },
      ]),
    ).toEqual([
      '.manual-qa/strict-release-preflight.json is not an allowed child release-evidence summary path.',
      '.manual-qa/live-provider-ui-smoke-attempt-current.json release evidence must have status=passed.',
      '.manual-qa/live-sync-release-drill.json release evidence must have evidenceType=release-pass.',
    ])
  })

  it('derives residual blocker ids from the current blocker report', () => {
    expect(
      releaseBlockerIdsFromReport({
        blockerCount: 2,
        blockers: [
          { id: 'apple-target-runtime-qa' },
          { id: 'live-provider-full-capability-release-evidence' },
        ],
      }),
    ).toEqual([
      'apple-target-runtime-qa',
      'live-provider-full-capability-release-evidence',
    ])
  })

  it('rejects duplicate residual blocker ids', () => {
    expect(() =>
      releaseBlockerIdsFromReport({
        blockerCount: 2,
        blockers: [{ id: 'duplicate' }, { id: 'duplicate' }],
      }),
    ).toThrow('release blocker report blocker ids must be unique.')
  })
})
