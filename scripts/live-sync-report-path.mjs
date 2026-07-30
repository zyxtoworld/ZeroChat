export const liveSyncReleasePassReportPath = '.manual-qa/live-sync-release-drill.json'
export const liveSyncCurrentDiagnosticReportPath =
  '.manual-qa/live-sync-release-drill-current-diagnostic.json'

const releaseModes = new Set(['cloudflare', 'gist'])

export function liveSyncReportPath({ explicitPath, mode } = {}) {
  const configuredPath = typeof explicitPath === 'string' ? explicitPath.trim() : ''
  if (configuredPath) {
    return configuredPath
  }

  const normalizedMode = typeof mode === 'string' ? mode.trim().toLowerCase() : ''
  return releaseModes.has(normalizedMode)
    ? liveSyncReleasePassReportPath
    : liveSyncCurrentDiagnosticReportPath
}
