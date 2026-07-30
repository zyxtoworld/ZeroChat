import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  preCheckpointAuditOptions,
  shouldDeferGeneratedDocumentAssertion,
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
