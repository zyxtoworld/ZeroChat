import { describe, expect, it } from 'vitest'

import {
  liveProviderCurrentDiagnosticReportPath,
  liveProviderFullCapabilityReportPath,
  liveProviderWorkflowReportPath,
  selectLiveProviderMirrorReportPath,
  selectLiveProviderReportPath,
} from '../live-provider-report-path.mjs'

describe('live provider report path', () => {
  it('keeps an explicit report path authoritative without a mirror', () => {
    const options = {
      explicitPath: ' .manual-qa/live-provider-smoke-custom.json ',
      credentialConfirmed: true,
      fullCapabilityConfirmed: true,
    }

    expect(selectLiveProviderReportPath(options)).toBe(
      '.manual-qa/live-provider-smoke-custom.json',
    )
    expect(selectLiveProviderMirrorReportPath(options)).toBe('')
  })

  it('keeps no-credential diagnostics away from canonical evidence', () => {
    expect(selectLiveProviderReportPath()).toBe(liveProviderCurrentDiagnosticReportPath)
    expect(selectLiveProviderMirrorReportPath()).toBe('')
  })

  it('writes ordinary credential-confirmed attempts only to the workflow report', () => {
    const options = { credentialConfirmed: true }

    expect(selectLiveProviderReportPath(options)).toBe(liveProviderWorkflowReportPath)
    expect(selectLiveProviderMirrorReportPath(options)).toBe('')
  })

  it('writes full-capability attempts to canonical evidence and the workflow mirror', () => {
    const options = {
      credentialConfirmed: true,
      fullCapabilityConfirmed: true,
    }

    expect(selectLiveProviderReportPath(options)).toBe(
      liveProviderFullCapabilityReportPath,
    )
    expect(selectLiveProviderMirrorReportPath(options)).toBe(liveProviderWorkflowReportPath)
  })

  it('does not trust a full-capability flag without confirmed credentials', () => {
    const options = { fullCapabilityConfirmed: true }

    expect(selectLiveProviderReportPath(options)).toBe(
      liveProviderCurrentDiagnosticReportPath,
    )
    expect(selectLiveProviderMirrorReportPath(options)).toBe('')
  })
})
