import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import { terminateTimedOutChild } from '../verify-release-child-runner.mjs'
import {
  preCheckpointAuditOptions,
  releaseAuditMigrationContractsTimeoutMs,
  shouldDeferGeneratedDocumentAssertion,
  strictReleasePreflightFreshnessTimeoutMs,
  strictReleasePreflightPhaseTimeoutMs,
} from '../verify-release-preflight-policy.mjs'

describe('verify-release pre-checkpoint policy', () => {
  it.each(['Repository health', 'Completion audit'])(
    'keeps %s evidence-aware but fail-closed',
    (label) => {
      const options = preCheckpointAuditOptions(label, { EXISTING: 'value' })

      expect(options).toEqual({
        env: {
          EXISTING: 'value',
          ZEROCHAT_VERIFY_RELEASE_PREFLIGHT: '1',
        },
      })
      expect(options).not.toHaveProperty('tolerateFailure')
    },
  )

  it('does not alter unrelated release checks', () => {
    expect(preCheckpointAuditOptions('TypeScript', { EXISTING: 'value' })).toEqual({})
  })

  it('derives a dedicated aggregate budget from bounded strict-preflight phases', () => {
    expect(strictReleasePreflightPhaseTimeoutMs('sourceReports')).toBe(120_000)
    expect(strictReleasePreflightPhaseTimeoutMs('strictGate')).toBe(180_000)
    expect(strictReleasePreflightPhaseTimeoutMs('blockerRefresh')).toBe(120_000)
    expect(strictReleasePreflightPhaseTimeoutMs('blockerValidation')).toBe(120_000)
    expect(strictReleasePreflightFreshnessTimeoutMs(300_000)).toBe(600_000)
    expect(strictReleasePreflightFreshnessTimeoutMs(600_000)).toBe(600_000)
    expect(() => strictReleasePreflightPhaseTimeoutMs('unknown')).toThrow(
      'Unknown strict release preflight phase',
    )
  })

  it('gives the single migration test child one measured, bounded budget', () => {
    expect(releaseAuditMigrationContractsTimeoutMs(300_000)).toBe(900_000)
    expect(releaseAuditMigrationContractsTimeoutMs(900_000)).toBe(900_000)
    expect(releaseAuditMigrationContractsTimeoutMs(1_000_000)).toBe(1_000_000)
    expect(releaseAuditMigrationContractsTimeoutMs(0)).toBe(900_000)
  })

  it('waits for the whole child tree before settling a timed-out check', async () => {
    const child = { pid: 1234 }
    let releaseCleanup
    const cleanup = new Promise((resolve) => {
      releaseCleanup = resolve
    })
    const stopProcessTreeImpl = vi.fn(async (ownedChild) => {
      expect(ownedChild).toBe(child)
      await cleanup
      return { childQuiesced: true }
    })
    let settle
    const settled = new Promise((resolve) => {
      settle = resolve
    })
    const setTimeoutImpl = vi.fn(() => 'settlement-timer')
    const clearTimeoutImpl = vi.fn()

    terminateTimedOutChild(child, settle, {
      stopProcessTreeImpl,
      setTimeoutImpl,
      clearTimeoutImpl,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(stopProcessTreeImpl).toHaveBeenCalledTimes(1)

    let didSettle = false
    void settled.then(() => {
      didSettle = true
    })
    await Promise.resolve()
    expect(didSettle).toBe(false)

    releaseCleanup()
    await expect(settled).resolves.toEqual({ childQuiesced: true })
    expect(clearTimeoutImpl).toHaveBeenCalledWith('settlement-timer')
  })

  it('marks an unconfirmed child tree as unquiesced', async () => {
    let settle
    const settled = new Promise((resolve) => {
      settle = resolve
    })

    terminateTimedOutChild({ pid: 1234 }, settle, {
      stopProcessTreeImpl: vi.fn(async () => ({ childQuiesced: false })),
    })

    await expect(settled).resolves.toEqual({ childQuiesced: false })
  })

  it('defers only registered document sources during the preflight audit', () => {
    const generatedDocument = 'generated current evidence'
    const deferredSources = new Set([generatedDocument])

    expect(
      shouldDeferGeneratedDocumentAssertion(generatedDocument, true, deferredSources),
    ).toBe(true)
    expect(
      shouldDeferGeneratedDocumentAssertion(generatedDocument, false, deferredSources),
    ).toBe(false)
    expect(
      shouldDeferGeneratedDocumentAssertion('source contract', true, deferredSources),
    ).toBe(false)
  })

  it('routes generated checklist cardinality through preflight deferral', async () => {
    const completionAudit = await readFile(
      new URL('../completion-audit-check.mjs', import.meta.url),
      'utf8',
    )

    expect(completionAudit).toMatch(
      /function assertExactUncheckedChecklistPrefixes\(section, label, expectedPrefixes\) \{\s+if \(shouldDeferDocumentAssertion\(section\)\) \{\s+return/u,
    )
  })
})
