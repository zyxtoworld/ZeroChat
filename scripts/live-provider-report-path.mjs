export const liveProviderFullCapabilityReportPath =
  '.manual-qa/live-provider-smoke-full-current.json'
export const liveProviderWorkflowReportPath = '.manual-qa/live-provider-smoke.json'
export const liveProviderCurrentDiagnosticReportPath =
  '.manual-qa/live-provider-smoke-current-diagnostic.json'

function explicitReportPath(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function selectLiveProviderReportPath({
  explicitPath,
  credentialConfirmed = false,
  fullCapabilityConfirmed = false,
} = {}) {
  const configuredPath = explicitReportPath(explicitPath)
  if (configuredPath) {
    return configuredPath
  }

  if (!credentialConfirmed) {
    return liveProviderCurrentDiagnosticReportPath
  }

  return fullCapabilityConfirmed
    ? liveProviderFullCapabilityReportPath
    : liveProviderWorkflowReportPath
}

export function selectLiveProviderMirrorReportPath({
  explicitPath,
  credentialConfirmed = false,
  fullCapabilityConfirmed = false,
} = {}) {
  return !explicitReportPath(explicitPath) &&
    credentialConfirmed &&
    fullCapabilityConfirmed
    ? liveProviderWorkflowReportPath
    : ''
}
