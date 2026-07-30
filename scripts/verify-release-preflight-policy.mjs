const evidenceAwareAuditLabels = new Set([
  'Repository health',
  'Completion audit',
])

export function shouldDeferGeneratedDocumentAssertion(
  source,
  verifyReleasePreflight,
  deferredDocumentSources,
) {
  return verifyReleasePreflight && deferredDocumentSources.has(source)
}

export function preCheckpointAuditOptions(label, environment) {
  if (!evidenceAwareAuditLabels.has(label)) {
    return {}
  }

  return {
    env: {
      ...environment,
      ZEROCHAT_VERIFY_RELEASE_PREFLIGHT: '1',
    },
  }
}
