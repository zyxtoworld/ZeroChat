const evidenceAwareAuditLabels = new Set([
  'Repository health',
  'Completion audit',
])

export const strictReleasePreflightPhaseTimeoutsMs = Object.freeze({
  sourceReports: 120_000,
  strictGate: 180_000,
  reportValidation: 30_000,
  blockerRefresh: 120_000,
  blockerValidation: 120_000,
})

const strictReleasePreflightCleanupBudgetMs = 30_000

// The three migration contract files execute real checker subprocesses against
// isolated mirrors. Their measured wall time is about 773s on the release host;
// keep this budget local to that one check and leave ordinary checks unchanged.
const releaseAuditMigrationContractsBudgetMs = 900_000

export function strictReleasePreflightPhaseTimeoutMs(phase) {
  const timeoutMs = strictReleasePreflightPhaseTimeoutsMs[phase]
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Unknown strict release preflight phase: ${String(phase)}`)
  }

  return timeoutMs
}

export function strictReleasePreflightFreshnessTimeoutMs(configuredTimeoutMs = 300_000) {
  const baseTimeoutMs =
    Number.isInteger(configuredTimeoutMs) && configuredTimeoutMs > 0
      ? configuredTimeoutMs
      : 300_000
  const phaseBudgetMs = Object.values(strictReleasePreflightPhaseTimeoutsMs).reduce(
    (total, timeoutMs) => total + timeoutMs,
    strictReleasePreflightCleanupBudgetMs,
  )

  return Math.max(baseTimeoutMs, phaseBudgetMs)
}

export function releaseAuditMigrationContractsTimeoutMs(configuredTimeoutMs = 300_000) {
  const baseTimeoutMs =
    Number.isInteger(configuredTimeoutMs) && configuredTimeoutMs > 0
      ? configuredTimeoutMs
      : 300_000

  return Math.max(baseTimeoutMs, releaseAuditMigrationContractsBudgetMs)
}

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
