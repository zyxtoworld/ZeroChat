const allowedReleaseEvidenceTypesByPath = new Map([
  ['.manual-qa/live-sync-release-drill.json', 'release-pass'],
  ['.manual-qa/live-provider-smoke-attempt-current.json', 'live-provider-smoke-pass'],
  ['.manual-qa/live-provider-ui-smoke-current.json', 'live-provider-ui-release-evidence'],
  ['.manual-qa/live-provider-ui-smoke-attempt-current.json', 'live-provider-ui-release-evidence'],
])

const hostedNativeCiEvidencePath = '.manual-qa/hosted-native-ci-evidence.json'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function releaseDiagnosticsChildSummaryFailures(reportSummaries) {
  if (!Array.isArray(reportSummaries)) {
    return ['reportSummaries must be an array.']
  }

  const failures = []

  for (const [index, summary] of reportSummaries.entries()) {
    if (!isObject(summary) || summary.releaseEvidence !== true) {
      continue
    }

    const path = typeof summary.path === 'string' ? summary.path : `reportSummaries[${index}]`
    const expectedEvidenceType = allowedReleaseEvidenceTypesByPath.get(path)
    const hostedNativeCiEvidence = path === hostedNativeCiEvidencePath

    if (!expectedEvidenceType && !hostedNativeCiEvidence) {
      failures.push(`${path} is not an allowed child release-evidence summary path.`)
      continue
    }

    if (summary.status !== 'passed') {
      failures.push(`${path} release evidence must have status=passed.`)
    }
    if (summary.safeToPublish !== true) {
      failures.push(`${path} release evidence must have safeToPublish=true.`)
    }
    if (expectedEvidenceType && summary.evidenceType !== expectedEvidenceType) {
      failures.push(
        `${path} release evidence must have evidenceType=${expectedEvidenceType}.`,
      )
    }
    if (
      hostedNativeCiEvidence &&
      (!summary.evidenceType || summary.evidenceType === 'diagnostic' || summary.evidenceType === 'unknown')
    ) {
      failures.push(`${path} release evidence must have a non-diagnostic evidenceType.`)
    }
  }

  return failures
}

export function releaseBlockerIdsFromReport(report) {
  if (!isObject(report) || !Array.isArray(report.blockers)) {
    throw new Error('release blocker report must include a blockers array.')
  }

  const ids = report.blockers.map((blocker, index) => {
    const id = isObject(blocker) && typeof blocker.id === 'string' ? blocker.id.trim() : ''
    if (!id) {
      throw new Error(`release blocker report blockers[${index}] must include a non-empty id.`)
    }
    return id
  })

  if (new Set(ids).size !== ids.length) {
    throw new Error('release blocker report blocker ids must be unique.')
  }
  if (Number.isInteger(report.blockerCount) && report.blockerCount !== ids.length) {
    throw new Error('release blocker report blockerCount must match blockers.length.')
  }

  return ids
}
