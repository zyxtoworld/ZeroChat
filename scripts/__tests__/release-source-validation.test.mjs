import { describe, expect, it } from 'vitest'

import { selectSourceValidationOutcome } from '../release-source-validation.mjs'

const windowsTrustedMsixOutcomes = [
  {
    expectedCode: 0,
    requiredOutput: [
      'Runtime smoke artifact checks passed: windows-msix-trusted:',
    ],
  },
  {
    expectedCode: 1,
    requiredOutputAny: [
      [
        '.manual-qa/windows-msix-current-trusted-install-update-qa.json distWebAssets',
        '.manual-qa/windows-msix-current-trusted-install-update-qa.json currentPackageEvidence',
      ],
      [
        '.manual-qa/windows-msix-host-preflight.json current host preflight status=blocked',
      ],
    ],
  },
]

describe('release blocker source validation outcomes', () => {
  it('accepts a current trusted MSIX runtime pass', () => {
    expect(
      selectSourceValidationOutcome(
        {
          code: 0,
          output:
            'Runtime smoke artifact checks passed: windows-msix-trusted: freshInstall 1280x735; update 1280x735',
        },
        { outcomes: windowsTrustedMsixOutcomes },
      ),
    ).toMatchObject({
      passed: true,
      expectedCode: 0,
      outcome: 'passed',
    })
  })

  it('accepts the exact stale-package diagnostic failure', () => {
    expect(
      selectSourceValidationOutcome(
        {
          code: 1,
          output: [
            '.manual-qa/windows-msix-current-trusted-install-update-qa.json distWebAssets requires rerun',
            '.manual-qa/windows-msix-current-trusted-install-update-qa.json currentPackageEvidence requires rerun',
          ].join('\n'),
        },
        { outcomes: windowsTrustedMsixOutcomes },
      ),
    ).toMatchObject({
      passed: true,
      expectedCode: 1,
      outcome: 'expected-diagnostic-failure',
    })
  })

  it('accepts the exact blocked-host diagnostic failure', () => {
    expect(
      selectSourceValidationOutcome(
        {
          code: 1,
          output:
            '.manual-qa/windows-msix-host-preflight.json current host preflight status=blocked',
        },
        { outcomes: windowsTrustedMsixOutcomes },
      ),
    ).toMatchObject({
      passed: true,
      expectedCode: 1,
      outcome: 'expected-diagnostic-failure',
    })
  })

  it('rejects a successful process without the trusted runtime pass marker', () => {
    expect(
      selectSourceValidationOutcome(
        { code: 0, output: 'unrelated success' },
        { outcomes: windowsTrustedMsixOutcomes },
      ),
    ).toMatchObject({
      passed: false,
      expectedCode: null,
      outcome: 'unrecognized',
    })
  })

  it('rejects a failed process without a declared diagnostic marker set', () => {
    expect(
      selectSourceValidationOutcome(
        { code: 1, output: 'unexpected failure' },
        { outcomes: windowsTrustedMsixOutcomes },
      ),
    ).toMatchObject({
      passed: false,
      expectedCode: null,
      outcome: 'unrecognized',
    })
  })

  it('preserves the legacy single-outcome contract', () => {
    expect(
      selectSourceValidationOutcome(
        { code: 0, output: 'ready' },
        { expectedCode: 0, requiredOutput: ['ready'] },
      ),
    ).toMatchObject({
      passed: true,
      expectedCode: 0,
      outcome: 'passed',
    })
  })
})
