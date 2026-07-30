import { describe, expect, it } from 'vitest'

import {
  activeBaselineReleaseBlockerIds,
  baselineReleaseBlockerIds,
} from '../release-blocker-state.mjs'

const nativeFailures = {
  label: 'Native runtime smoke artifacts',
  message: [
    'apple: required runtime smoke artifact is missing',
    'linux: required runtime smoke artifact is missing',
    'windows-msix trusted install evidence is stale',
  ].join('\n'),
}
const directFailures = [
  { label: 'Live sync release-pass evidence', message: 'skipped' },
  { label: 'Hosted native CI release evidence', message: 'missing' },
  { label: 'Live provider full capability release evidence', message: 'failed' },
]

const fullRequestedEvidence = {
  allPlatforms: true,
  nativeRuntimeArtifacts: true,
  liveSyncReleasePass: true,
  hostedNativeCiEvidence: true,
  liveProviderFullCapability: true,
}

function blockedReport(blockers, requestedEvidence = fullRequestedEvidence) {
  return {
    status: 'blocked',
    passed: false,
    blockerCount: blockers.length,
    blockers,
    requestedEvidence,
  }
}

describe('release blocker active-state transitions', () => {
  it('keeps every baseline blocker active for the current six-way failure state', () => {
    expect(
      activeBaselineReleaseBlockerIds({
        strictReport: blockedReport([nativeFailures, ...directFailures]),
        applePrerequisitesMissing: true,
        linuxPrerequisitesMissing: true,
      }),
    ).toEqual(baselineReleaseBlockerIds)
  })

  it.each([
    ['disposable-live-sync-release-pass', 'Live sync release-pass evidence'],
    ['hosted-native-ci-release-evidence', 'Hosted native CI release evidence'],
    [
      'live-provider-full-capability-release-evidence',
      'Live provider full capability release evidence',
    ],
  ])('closes %s independently when its strict failure disappears', (id, label) => {
    const active = activeBaselineReleaseBlockerIds({
      strictReport: blockedReport([
        nativeFailures,
        ...directFailures.filter((blocker) => blocker.label !== label),
      ]),
      applePrerequisitesMissing: true,
      linuxPrerequisitesMissing: true,
    })

    expect(active).not.toContain(id)
    expect(active.length).toBe(baselineReleaseBlockerIds.length - 1)
  })

  it('closes native platforms independently from one combined runtime failure', () => {
    const active = activeBaselineReleaseBlockerIds({
      strictReport: blockedReport([
        { label: 'Native runtime smoke artifacts', message: 'linux: artifact missing' },
        ...directFailures,
      ]),
    })

    expect(active).toContain('linux-target-runtime-qa')
    expect(active).not.toContain('apple-target-runtime-qa')
    expect(active).not.toContain('windows-trusted-msix-release-pass')
  })

  it('fails closed for malformed blocked and unknown native-runtime diagnostics', () => {
    expect(
      activeBaselineReleaseBlockerIds({ strictReport: blockedReport([]) }),
    ).toEqual(baselineReleaseBlockerIds)

    const active = activeBaselineReleaseBlockerIds({
      strictReport: blockedReport([
        { label: 'Native runtime smoke artifacts', message: 'unclassified runtime failure' },
      ]),
    })
    expect(active).toEqual(baselineReleaseBlockerIds.slice(0, 3))
  })

  it('reaches an empty terminal baseline state only after a strict release pass', () => {
    expect(
      activeBaselineReleaseBlockerIds({
        strictReport: {
          status: 'passed',
          passed: true,
          blockerCount: 0,
          blockers: [],
          requestedEvidence: fullRequestedEvidence,
        },
      }),
    ).toEqual([])
  })

  it('closes only live sync after a live-sync-only strict pass', () => {
    const active = activeBaselineReleaseBlockerIds({
      strictReport: {
        status: 'passed',
        passed: true,
        blockerCount: 0,
        blockers: [],
        requestedEvidence: {
          allPlatforms: false,
          nativeRuntimeArtifacts: false,
          liveSyncReleasePass: true,
          hostedNativeCiEvidence: false,
          liveProviderFullCapability: false,
        },
      },
    })

    expect(active).toEqual(
      baselineReleaseBlockerIds.filter(
        (id) => id !== 'disposable-live-sync-release-pass',
      ),
    )
  })

  it('keeps unrequested blockers active when a partial strict check fails', () => {
    expect(
      activeBaselineReleaseBlockerIds({
        strictReport: blockedReport(
          [{ label: 'Live sync release-pass evidence', message: 'failed' }],
          {
            allPlatforms: false,
            nativeRuntimeArtifacts: false,
            liveSyncReleasePass: true,
            hostedNativeCiEvidence: false,
            liveProviderFullCapability: false,
          },
        ),
      }),
    ).toEqual(baselineReleaseBlockerIds)
  })

  it('intersects partial preflight state with current source-derived candidates', () => {
    expect(
      activeBaselineReleaseBlockerIds({
        strictReport: {
          status: 'passed',
          passed: true,
          blockerCount: 0,
          blockers: [],
          requestedEvidence: {
            allPlatforms: false,
            nativeRuntimeArtifacts: false,
            liveSyncReleasePass: true,
            hostedNativeCiEvidence: false,
            liveProviderFullCapability: false,
          },
        },
        candidateIds: [
          'windows-trusted-msix-release-pass',
          'hosted-native-ci-release-evidence',
        ],
      }),
    ).toEqual([
      'windows-trusted-msix-release-pass',
      'hosted-native-ci-release-evidence',
    ])
  })

  it('does not clear baseline blockers for contradictory strict pass metadata', () => {
    expect(
      activeBaselineReleaseBlockerIds({
        strictReport: {
          status: 'passed',
          passed: true,
          blockerCount: 1,
          blockers: [],
          requestedEvidence: fullRequestedEvidence,
        },
      }),
    ).toEqual(baselineReleaseBlockerIds)
  })

  it('fails closed when requested evidence scope is missing', () => {
    expect(
      activeBaselineReleaseBlockerIds({
        strictReport: {
          status: 'passed',
          passed: true,
          blockerCount: 0,
          blockers: [],
        },
      }),
    ).toEqual(baselineReleaseBlockerIds)
  })
})
