export function verifyReleaseTimeoutOwnerContract({
  verifyGate = '',
  verifyReleasePreflightPolicyTest = '',
}) {
  return (
    verifyGate.includes('const timeoutMs = timeoutOverrideMs ?? checkTimeoutMs(label)') &&
    verifyGate.includes(
      "import { terminateTimedOutChild } from './verify-release-child-runner.mjs'",
    ) &&
    verifyGate.includes(
      'releaseAuditMigrationContractsTimeoutMs(verifyCheckTimeoutMs)',
    ) &&
    verifyGate.includes('childQuiesced,') &&
    verifyGate.includes(
      'strictReleasePreflightFreshnessTimeoutMs(verifyCheckTimeoutMs)',
    ) &&
    verifyReleasePreflightPolicyTest.includes(
      'gives the single migration test child one measured, bounded budget',
    ) &&
    verifyReleasePreflightPolicyTest.includes(
      'waits for the whole child tree before settling a timed-out check',
    ) &&
    verifyReleasePreflightPolicyTest.includes(
      'marks an unconfirmed child tree as unquiesced',
    ) &&
    verifyReleasePreflightPolicyTest.includes(
      'derives a dedicated aggregate budget from bounded strict-preflight phases',
    )
  )
}

export function releaseAuditMutationHarnessContract(source = '') {
  return (
    source.includes("test('live checker contracts bind only to current source and reject mutated input'") &&
    source.includes('assertReleaseAuditMigrationContract(checkerId, source)') &&
    source.includes('runtime-only audit metadata')
  )
}

export function browserSkillCleanupOwnerContract({
  browserSmoke = '',
  browserRuntimeCleanup = '',
  browserRuntimeCleanupTest = '',
}) {
  return (
    browserSmoke.includes('await settleBrowserRuntimeCleanup({') &&
    browserSmoke.includes(
      'stopProcessTree: async () => await stopChildProcessTree(chrome)',
    ) &&
    browserSmoke.includes(
      'removeProfile: async () => await removeBrowserProfileWithRetry(profileDir, 120)',
    ) &&
    browserRuntimeCleanup.includes(
      'export async function settleBrowserRuntimeCleanup({',
    ) &&
    browserRuntimeCleanup.includes('profileRemoved = await removeProfile()') &&
    browserRuntimeCleanup.includes('processTreeError?.childQuiesced !== false') &&
    browserRuntimeCleanup.includes('if (!stopWindowsProcessesUsingProfile(target))') &&
    browserRuntimeCleanupTest.includes(
      'falls back to exact-profile cleanup after an unconfirmed Windows tree kill',
    ) &&
    browserRuntimeCleanupTest.includes(
      'fails closed when exact-profile process cleanup cannot confirm quiescence',
    )
  )
}
