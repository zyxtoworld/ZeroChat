import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { assertLinuxLocalPersistenceContract } from './linux-local-persistence-contract.mjs'

const sources = {
  appState: await readFile(new URL('../src/app_state.rs', import.meta.url), 'utf8'),
  resetState: await readFile(
    new URL('../src/app_state/reset_state.rs', import.meta.url),
    'utf8',
  ),
  syncState: await readFile(
    new URL('../src/app_state/sync_state.rs', import.meta.url),
    'utf8',
  ),
  transition: await readFile(
    new URL('../src/local_data_transition.rs', import.meta.url),
    'utf8',
  ),
}

test('Linux local persistence keeps startup, reset, import, and ordinary saves fail closed', () => {
  assert.doesNotThrow(() => assertLinuxLocalPersistenceContract(sources))
})

test('Linux local persistence contract rejects an unguarded reset journal stage', () => {
  const resetState = sources.resetState.replace(
    'store.stage_local_data_transition(&guard, &transition)?;',
    'store.stage_local_data_transition(&transition)?;',
  )

  assert.throws(
    () => assertLinuxLocalPersistenceContract({ ...sources, resetState }),
    /reset must stage its journal under the local-data commit guard/,
  )
})

test('Linux local persistence contract rejects a save failure that is not made durable and visible', () => {
  const syncState = sources.syncState.replace(
    /fn persist_current_snapshot\([\s\S]*?\n    }\n/,
    (block) =>
      block.replace(
        'self.report_local_storage_issue(LinuxLocalStorageIssue::SnapshotSaveFailed);',
        '',
      ),
  )

  assert.throws(
    () => assertLinuxLocalPersistenceContract({ ...sources, syncState }),
    /ordinary save failure must report a persistent storage blocker/,
  )
})

test('Linux local persistence contract rejects transition completion outside the held guard', () => {
  const transition = sources.transition.replace(
    'store.complete_local_data_transition(guard, &target_fingerprint)?;',
    'store.complete_local_data_transition(&target_fingerprint)?;',
  )

  assert.throws(
    () => assertLinuxLocalPersistenceContract({ ...sources, transition }),
    /transition completion must use the same local-data commit guard/,
  )
})

test('Linux local persistence contract rejects a stale recovery helper without guard ownership', () => {
  const syncState = sources.syncState.replace(
    'let imported = match recover_pending_local_data_transition_during_local_data_commit(',
    'let imported = match recover_pending_local_data_transition(',
  )

  assert.throws(
    () => assertLinuxLocalPersistenceContract({ ...sources, syncState }),
    /backup import must enter the guarded recovery path/,
  )
})
