function contract(condition, message) {
  if (!condition) {
    throw new Error(`Linux local persistence contract failed: ${message}`)
  }
}

function functionBlock(source, signature, label) {
  const start = source.indexOf(signature)
  contract(start >= 0, `${label} function is missing`)
  const openingBrace = source.indexOf('{', start)
  contract(openingBrace >= 0, `${label} function body is missing`)

  let depth = 0
  let inString = false
  let inLineComment = false
  let inBlockComment = false
  let escaped = false
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]

    if (inLineComment) {
      if (character === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false
        index += 1
      }
      continue
    }
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '/' && next === '/') {
      inLineComment = true
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      inBlockComment = true
      index += 1
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }

  throw new Error(`Linux local persistence contract failed: ${label} function is truncated`)
}

function includes(source, marker, message) {
  contract(source.includes(marker), message)
}

function ordered(source, markers, message) {
  let cursor = -1
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1)
    contract(next > cursor, message)
    cursor = next
  }
}

export function assertLinuxLocalPersistenceContract({
  appState,
  resetState,
  syncState,
  transition,
}) {
  for (const [name, source] of Object.entries({ appState, resetState, syncState, transition })) {
    contract(typeof source === 'string' && source.length > 0, `${name} source is missing`)
  }

  const startup = functionBlock(appState, 'pub(crate) fn load_resources()', 'startup load')
  ordered(
    startup,
    [
      'let guard = store.lock_local_data_commit();',
      'store.load_during_local_data_commit(&guard)',
      'store.load_local_data_transition_during_local_data_commit(&guard)',
      'recover_pending_local_data_transition_during_local_data_commit(',
      '&guard,',
      'drop(guard);',
    ],
    'startup must read and recover the snapshot under one local-data commit guard',
  )
  includes(
    appState,
    'snapshot_load_failure_is_not_treated_as_first_run',
    'startup load-failure distinction must remain covered by a Rust unit test',
  )
  includes(
    appState,
    'failed_snapshot_save_restores_the_last_committed_state',
    'ordinary save rollback must remain covered by a Rust unit test',
  )
  includes(
    appState,
    'successful_snapshot_save_advances_the_committed_state',
    'ordinary save commit must remain covered by a Rust unit test',
  )

  const persist = functionBlock(
    syncState,
    'fn persist_current_snapshot(&self)',
    'ordinary snapshot persistence',
  )
  includes(
    persist,
    'store.save_if_unchanged(Some(&expected), &candidate)',
    'ordinary saves must compare against the committed baseline',
  )
  ordered(
    persist,
    [
      'Ok(SnapshotCompareAndSave::Changed(None)) | Err(_) => {',
      'self.restore_committed_snapshot();',
      'self.report_local_storage_issue(LinuxLocalStorageIssue::SnapshotSaveFailed);',
      'None',
    ],
    'ordinary save failure must report a persistent storage blocker',
  )

  for (const [signature, label] of [
    ['fn ensure_sync_secret_snapshot_commit_ready(&self)', 'sync-secret persistence'],
    ['pub(crate) fn request_first_sync_strategy(', 'first-sync request'],
    ['pub(crate) fn request_manual_sync(', 'manual sync request'],
  ]) {
    includes(
      functionBlock(syncState, signature, label),
      'self.local_storage_blocker_message()',
      `${label} must fail closed while local persistence is blocked`,
    )
  }

  const backupImport = functionBlock(
    syncState,
    'pub(crate) fn import_encrypted_backup(',
    'encrypted backup import',
  )
  ordered(
    backupImport,
    [
      'let guard = store.lock_local_data_commit();',
      'store.stage_local_data_transition(&guard, &transition)?;',
      'recover_pending_local_data_transition_during_local_data_commit(',
      '&guard,',
      'self.clear_local_storage_issue();',
    ],
    'backup import must enter the guarded recovery path before unblocking persistence',
  )
  includes(
    backupImport,
    'self.report_local_storage_issue(LinuxLocalStorageIssue::SnapshotLoadFailed);',
    'backup import recovery failure must remain visible',
  )

  const reset = functionBlock(resetState, 'pub(crate) fn reset_local_data(', 'local reset')
  ordered(
    reset,
    [
      'let guard = store.lock_local_data_commit();',
      'store.stage_local_data_transition(&guard, &transition)?;',
      'recover_pending_local_data_transition_during_local_data_commit(',
      '&guard,',
      'self.clear_local_storage_issue();',
    ],
    'reset must stage its journal under the local-data commit guard',
  )
  includes(
    reset,
    'self.report_local_storage_issue(super::LinuxLocalStorageIssue::SnapshotLoadFailed);',
    'reset recovery failure must remain visible',
  )

  const pendingRecovery = functionBlock(
    transition,
    'pub(crate) fn recover_pending_local_data_transition_during_local_data_commit',
    'pending local-data recovery',
  )
  includes(
    pendingRecovery,
    'store.load_local_data_transition_during_local_data_commit(guard)?',
    'pending recovery must read its journal under the caller-owned guard',
  )
  includes(
    pendingRecovery,
    'recover_local_data_transition(store, secrets, guard, transition).map(Some)',
    'pending recovery must pass guard ownership into transition recovery',
  )

  const recovery = functionBlock(
    transition,
    'pub(crate) fn recover_local_data_transition<S',
    'local-data transition recovery',
  )
  ordered(
    recovery,
    [
      '.load_local_data_transition_during_local_data_commit(guard)?',
      'clear_secrets_transactionally(secrets, &provider_ids)?',
      'commit_transition_snapshot(',
      'store.complete_local_data_transition(guard, &target_fingerprint)?;',
    ],
    'transition completion must use the same local-data commit guard',
  )
  includes(
    transition,
    'interrupted_reset_rolls_forward_all_secrets_and_snapshot',
    'interrupted reset recovery must remain covered by a Rust unit test',
  )
  includes(
    transition,
    'interrupted_encrypted_import_rolls_forward_keys_and_keeps_other_secrets',
    'interrupted encrypted import recovery must remain covered by a Rust unit test',
  )
  includes(
    transition,
    'unrelated_snapshot_rejects_reset_and_restores_cleared_secrets',
    'stale reset recovery must remain covered by a Rust unit test',
  )

  return true
}
