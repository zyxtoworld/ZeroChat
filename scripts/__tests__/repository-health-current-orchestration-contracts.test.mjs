import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  browserSkillCleanupOwnerContract,
  releaseAuditMutationHarnessContract,
  verifyReleaseTimeoutOwnerContract,
} from '../repository-health-current-orchestration-contracts.mjs'

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
const contractTestTimeoutMs = 30_000

describe('current repository-health orchestration owners', () => {
  it('binds migration checks to the current-source runtime-only contract', async () => {
    const source = await read('scripts/__tests__/release-audit-migration-contract.test.mjs')

    expect(releaseAuditMutationHarnessContract(source)).toBe(true)
    expect(
      releaseAuditMutationHarnessContract(
        source.replace(
          'assertReleaseAuditMigrationContract(checkerId, source)',
          'assertReleaseAuditMigrationContract(checkerId, mutatedSource)',
        ),
      ),
    ).toBe(false)
    expect(
      releaseAuditMutationHarnessContract(
        source.replace(
          'runtime-only audit metadata',
          'removed runtime metadata guard',
        ),
      ),
    ).toBe(false)
  }, contractTestTimeoutMs)

  it('binds verify timeout ownership to the override-aware runner and bounded aggregate proof', async () => {
    const sources = {
      verifyGate: await read('scripts/verify-release.mjs'),
      verifyReleasePreflightPolicyTest: await read(
        'scripts/__tests__/verify-release-preflight-policy.test.mjs',
      ),
    }

    expect(verifyReleaseTimeoutOwnerContract(sources)).toBe(true)
    expect(
      verifyReleaseTimeoutOwnerContract({
        ...sources,
        verifyGate: sources.verifyGate.replace(
          'const timeoutMs = timeoutOverrideMs ?? checkTimeoutMs(label)',
          'const timeoutMs = checkTimeoutMs(label)',
        ),
      }),
    ).toBe(false)
    expect(
      verifyReleaseTimeoutOwnerContract({
        ...sources,
        verifyGate: sources.verifyGate.replace(
          'releaseAuditMigrationContractsTimeoutMs(verifyCheckTimeoutMs)',
          'removed migration timeout owner',
        ),
      }),
    ).toBe(false)
    expect(
      verifyReleaseTimeoutOwnerContract({
        ...sources,
        verifyReleasePreflightPolicyTest: sources.verifyReleasePreflightPolicyTest.replace(
          'derives a dedicated aggregate budget from bounded strict-preflight phases',
          'removed aggregate budget proof',
        ),
      }),
    ).toBe(false)
    expect(
      verifyReleaseTimeoutOwnerContract({
        ...sources,
        verifyReleasePreflightPolicyTest: sources.verifyReleasePreflightPolicyTest.replace(
          'gives the single migration test child one measured, bounded budget',
          'removed migration budget proof',
        ),
      }),
    ).toBe(false)
  }, contractTestTimeoutMs)

  it('binds browser cleanup to the exact-profile fallback and fail-closed tests', async () => {
    const sources = {
      browserSmoke: await read('scripts/browser-skill-smoke.mjs'),
      browserRuntimeCleanup: await read('scripts/browser-runtime-cleanup.mjs'),
      browserRuntimeCleanupTest: await read(
        'scripts/__tests__/browser-runtime-cleanup.test.mjs',
      ),
    }

    expect(browserSkillCleanupOwnerContract(sources)).toBe(true)
    for (const [sourceName, marker] of [
      ['browserSmoke', 'await settleBrowserRuntimeCleanup({'],
      ['browserRuntimeCleanup', 'export async function settleBrowserRuntimeCleanup({'],
      [
        'browserRuntimeCleanupTest',
        'falls back to exact-profile cleanup after an unconfirmed Windows tree kill',
      ],
      [
        'browserRuntimeCleanupTest',
        'fails closed when exact-profile process cleanup cannot confirm quiescence',
      ],
    ]) {
      expect(
        browserSkillCleanupOwnerContract({
          ...sources,
          [sourceName]: sources[sourceName].replace(marker, 'removed-owner-anchor'),
        }),
        `${sourceName} must fail closed without ${marker}`,
      ).toBe(false)
    }
  }, contractTestTimeoutMs)
})
