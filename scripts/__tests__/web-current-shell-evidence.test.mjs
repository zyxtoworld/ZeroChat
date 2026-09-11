import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertWebCurrentShellEvidenceValidatorContract,
  findWebCurrentShellEvidenceFailures,
} from '../web-current-shell-evidence.mjs'

test('current Web shell evidence validator rejects every representative mutation', () => {
  assert.doesNotThrow(() => assertWebCurrentShellEvidenceValidatorContract())
})

test('current Web shell evidence requires a reachable Settings to Sync action', () => {
  const failures = findWebCurrentShellEvidenceFailures(
    {
      settingsEntryActionable: false,
      syncSettingsOpenProof: { activeTabId: '', opened: false },
      visibleDeprecatedSyncAriaCount: 1,
      visibleDeprecatedSyncControlCount: 1,
    },
    {},
  )

  assert.ok(failures.some((failure) => failure.includes('control count')))
  assert.ok(failures.some((failure) => failure.includes('aria-label')))
  assert.ok(failures.some((failure) => failure.includes('actionable')))
  assert.ok(failures.some((failure) => failure.includes('open the Sync tab')))
  assert.ok(failures.some((failure) => failure.includes('summary')))
})
