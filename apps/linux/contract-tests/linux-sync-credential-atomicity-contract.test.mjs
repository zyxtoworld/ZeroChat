import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readLinuxSource = (...segments) =>
  readFileSync(path.join(repoRoot, 'apps', 'linux', 'src', ...segments), 'utf8')

const storage = readLinuxSource('storage.rs')
const transition = readLinuxSource('local_data_transition.rs')
const autoSync = readLinuxSource('auto_sync.rs')
const chatState = readLinuxSource('app_state', 'chat_state.rs')
const providerState = readLinuxSource('app_state', 'provider_state.rs')
const syncState = readLinuxSource('app_state', 'sync_state.rs')
const providerSettings = readLinuxSource('provider_settings.rs')
const modelSettings = readLinuxSource('model_settings.rs')
const providers = readLinuxSource('providers.rs')

function functionBody(source, signature, nextSignature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  assert.notEqual(end, -1, `missing ${nextSignature}`)
  return source.slice(start, end)
}

function assertProviderDeletionCommitContract(stateSource, settingsSource) {
  const deletion = functionBody(
    stateSource,
    '    pub(crate) fn delete_provider(',
    '    pub(crate) fn update_active_conversation_provider(',
  )
  assert.match(deletion, /provider_fallback_for_deleted\(&previous\.providers, provider_id\)/)
  assert.match(deletion, /self\.commit_provider_secret_snapshot\(/)
  assert.doesNotMatch(deletion, /self\.snapshot\.borrow_mut\(\)/)

  const commit = functionBody(
    stateSource,
    '    fn commit_provider_secret_snapshot(',
    '\n}\n\nfn provider_fallback_for_deleted',
  )
  const lock = commit.indexOf('store.lock_local_data_commit()')
  const secret = commit.indexOf('replace_provider_keys_transactionally(')
  const snapshot = commit.indexOf('save_if_unchanged_during_local_data_commit(')
  const publish = commit.indexOf('*self.snapshot.borrow_mut() = candidate.clone()')
  assert.ok(lock >= 0 && secret > lock && snapshot > secret && publish > snapshot)
  assert.match(commit, /rollback_provider_keys_after_failure\(/)

  const click = functionBody(
    settingsSource,
    '    delete_provider.connect_clicked(',
    '    card.append(&delete_provider);',
  )
  assert.match(click, /match state_for_delete\.delete_provider\(&provider_id_for_delete\)/)
  assert.match(click, /Err\(error\)[\s\S]*message\.secretSaveFailed/)
  assert.ok(
    click.indexOf('delete_provider(&provider_id_for_delete)') <
      click.indexOf('card_for_delete.set_visible(false)'),
  )
}

function assertSyncSecretCommitContract(stateSource) {
  for (const signature of [
    '    pub(crate) fn save_sync_passphrase(',
    '    pub(crate) fn reset_sync_passphrase(',
    '    pub(crate) fn save_github_token(',
  ]) {
    const start = stateSource.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature}`)
    const next = stateSource.indexOf('\n    pub(crate) fn ', start + signature.length)
    const body = stateSource.slice(start, next === -1 ? undefined : next)
    assert.match(body, /store\.lock_local_data_commit\(\)/)
    assert.match(body, /ensure_snapshot_generation_during_local_data_commit\(/)
    assert.match(body, /commit_sync_secret_snapshot\(/)
  }

  const commit = functionBody(
    stateSource,
    '    fn commit_sync_secret_snapshot<',
    '    fn ensure_snapshot_generation_during_local_data_commit(',
  )
  const save = commit.indexOf('save_if_unchanged_during_local_data_commit(')
  const rollback = commit.indexOf('rollback_secret_value_after_failure(')
  const publish = commit.indexOf('*self.snapshot.borrow_mut() = candidate.clone()')
  assert.ok(save >= 0 && rollback > save && publish > rollback)
  assert.match(commit, /guard: &LocalDataCommitGuard<'_>/)
}

function assertModelFetchOwnershipContract(source, providersSource) {
  const run = functionBody(source, 'fn run_model_fetch(', '\n#[cfg(test)]')
  const ownerCheck = run.indexOf('if !provider_request_is_current(')
  const publish = run.indexOf('state.update_provider_config(')
  assert.ok(ownerCheck >= 0 && publish > ownerCheck)
  assert.match(run, /let current_request_provider =\s*provider_request\(&current_provider, &state\.sync_config\(\)\)/)
  assert.match(run, /let current_api_key = state\.provider_key\(&provider_id\)/)
  assert.match(run, /state\.cloudflare_access_key\(\)/)

  const owner = functionBody(
    providersSource,
    'pub(crate) fn provider_request_is_current(',
    '\n\n#[derive(Clone)]',
  )
  assert.match(
    owner,
    /requested_provider == current_provider\s*&& requested_api_key == current_api_key\s*&& requested_access_key == current_access_key/,
  )
}

function assertProviderConnectivityOwnershipContract(source, providersSource) {
  const run = functionBody(
    source,
    'fn run_provider_connectivity_check(',
    '\n#[cfg(test)]',
  )
  const request = run.indexOf('let request_provider = provider_request(')
  const ownerCheck = run.indexOf('if !provider_request_is_current(')
  const result = run.indexOf('match result')
  assert.ok(request >= 0 && ownerCheck > request && ownerCheck < result)
  assert.match(run, /let Some\(current_provider\) = state\.provider\(&provider_id\)/)
  assert.match(run, /let current_request_provider =\s*provider_request\(&current_provider, &state\.sync_config\(\)\)/)
  assert.match(run, /let current_api_key = state\.provider_key\(&provider_id\)/)
  assert.match(run, /state\.cloudflare_access_key\(\)/)
  assert.match(
    providersSource,
    /fn provider_request_is_current\([\s\S]*?requested_provider == current_provider\s*&& requested_api_key == current_api_key\s*&& requested_access_key == current_access_key/,
  )
}

test('Linux sync commit stages an encrypted vault before key or snapshot recovery', () => {
  assert.match(storage, /SyncCommit/)
  assert.match(storage, /struct LocalDataCommitGuard/)
  assert.doesNotMatch(storage, /provider_keys: BTreeMap/)

  const commit = functionBody(autoSync, '    fn commit_sync(', '\n}\n\nstruct SyncCandidate')
  const stage = commit.indexOf('stage_local_data_transition(')
  const recover = commit.indexOf('recover_local_data_transition(')
  assert.match(commit, /SnapshotCrypto::new\(\)\.encrypt_vault\(/)
  assert.match(commit, /if accepted\.provider_key_replacements\.is_empty\(\)/)
  assert.match(
    commit,
    /provider_keys: accepted\.provider_key_replacements\.clone\(\)/,
  )
  assert.match(commit, /accepted\.provider_key_replacements\.keys\(\)\.cloned\(\)\.collect\(\)/)
  assert.match(commit, /LocalDataTransition::sync_commit\(/)
  assert.ok(stage >= 0 && recover > stage)
  assert.match(transition, /replace_provider_keys_transactionally\(secrets, &replacements\)\?/)
  assert.match(transition, /rollback_provider_keys_after_failure\(/)
})

test('Linux unknown third snapshot generations remain indeterminate without key rollback', () => {
  const recovery = functionBody(
    transition,
    'fn commit_transition_snapshot(',
    '\nfn rollback_secret_clear_after_rejected_snapshot',
  )
  assert.match(recovery, /fingerprint == target_fingerprint/)
  assert.match(recovery, /source_snapshot_fingerprint\.as_deref\(\)/)
  assert.match(recovery, /TransitionSnapshotCommit::Indeterminate/)
  assert.match(
    transition,
    /post_write_third_snapshot_keeps_target_keys_and_journal_indeterminate/,
  )
})

test('Linux Provider request binding freezes provider key and proxy access under one guard', () => {
  assert.match(chatState, /match preferred_provider_id/)
  assert.match(
    chatState,
    /Some\(provider_id\)[\s\S]*provider\.id == provider_id && provider\.enabled/,
  )
  assert.match(chatState, /None => snapshot\.providers\.iter\(\)\.find\(\|provider\| provider\.enabled\)/)
  assert.match(
    chatState,
    /missing_preferred_provider_never_falls_back_to_another_enabled_provider/,
  )
  assert.match(
    chatState,
    /disabled_preferred_provider_never_falls_back_to_another_enabled_provider/,
  )
  const binding = functionBody(
    chatState,
    '    fn provider_request_binding(',
    '    pub(crate) fn prepare_message_speech(',
  )
  const storageBlocker = binding.indexOf('self.local_persistence_blocked()')
  const memoryFallback = binding.indexOf('if self.auto_sync.is_none()')
  assert.ok(storageBlocker >= 0 && memoryFallback > storageBlocker)
  assert.match(binding, /lock_local_data_commit\(/)
  assert.match(binding, /load_during_local_data_commit\(/)
  assert.match(binding, /self\.secrets\.provider_key\(/)
  assert.match(binding, /self\.secrets\.cloudflare_access_key\(/)

  for (const signature of [
    '    pub(crate) fn prepare_message_speech(',
    '    pub(crate) fn append_pending_chat_turn(',
    '    pub(crate) fn append_pending_image_turn(',
  ]) {
    const start = chatState.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature}`)
    const next = chatState.indexOf('\n    pub(crate) fn ', start + signature.length)
    const body = chatState.slice(start, next === -1 ? undefined : next)
    assert.match(body, /provider_request_binding\(/)
    assert.doesNotMatch(body, /self\.(?:provider_key|has_provider_key|cloudflare_access_key)\(/)
    assert.doesNotMatch(body, /provider_request\(/)
    assert.doesNotMatch(body, /snapshot\.providers/)
  }
})

test('Linux Gist completion keeps its cursor revision and reloads the durable coordinator commit', () => {
  const gist = functionBody(autoSync, '    async fn sync_gist(', '    async fn sync_cloudflare(')
  assert.match(gist, /sync_vault_for_source\(&snapshot, passphrase\)/)
  assert.match(gist, /The Gist protocol stores its cursor against this exact completion/)
  assert.match(gist, /snapshot: synced_vault\.data/)
  assert.doesNotMatch(gist, /with_sync_status\(/)

  const enqueue = functionBody(
    syncState,
    '    pub(crate) fn enqueue_auto_sync_snapshot(',
    '    fn persist_current_snapshot(',
  )
  assert.match(
    enqueue,
    /poll_background_result\(\s*receiver,[\s\S]*?BACKGROUND_TASK_DISCONNECTED\.to_owned\(\)/,
    'auto-sync result polling must terminalize a disconnected worker with a fixed failure',
  )
  assert.match(enqueue, /match classify_synced_snapshot_reload\(loaded\)/)
  assert.match(enqueue, /\*state\.snapshot\.borrow_mut\(\) = snapshot\.clone\(\)/)
  assert.match(enqueue, /\*state\.committed_snapshot\.borrow_mut\(\) = snapshot/)
  assert.match(enqueue, /state\.report_local_storage_issue\(issue\)/)
  assert.doesNotMatch(enqueue, /\.ok\(\)\.flatten\(\)/)
  assert.match(syncState, /synced_snapshot_reload_blocks_when_the_file_is_missing/)
  assert.match(syncState, /synced_snapshot_reload_blocks_when_reading_fails/)
})

test('Linux Provider deletion publishes repaired conversations only after secret and snapshot commit', () => {
  assertProviderDeletionCommitContract(providerState, providerSettings)
})

test('Linux Provider deletion contract rejects snapshot writes outside the local-data commit guard', () => {
  const weakened = providerState.replace(
    'save_if_unchanged_during_local_data_commit(&guard, Some(previous), &candidate)',
    'save_if_unchanged(Some(previous), &candidate)',
  )
  assert.throws(() => assertProviderDeletionCommitContract(weakened, providerSettings))
})

test('Linux sync-secret publication holds the local-data guard through rollback-capable snapshot CAS', () => {
  assertSyncSecretCommitContract(syncState)
})

test('Linux sync-secret contract rejects an unguarded snapshot CAS', () => {
  const weakened = syncState.replace(
    'save_if_unchanged_during_local_data_commit(guard, Some(previous), &candidate)',
    'save_if_unchanged(Some(previous), &candidate)',
  )
  assert.throws(() => assertSyncSecretCommitContract(weakened))
})

test('Linux model fetch publishes only for the exact Provider request and credential owner', () => {
  assertModelFetchOwnershipContract(modelSettings, providers)
})

test('Linux model fetch contract rejects a callback that drops access-key ownership', () => {
  const weakened = providers.replace(
    '        && requested_access_key == current_access_key',
    '',
  )
  assert.throws(() => assertModelFetchOwnershipContract(modelSettings, weakened))
})

test('Linux Provider connectivity results are owned by the exact request and credentials', () => {
  assertProviderConnectivityOwnershipContract(providerSettings, providers)
})

test('Linux Provider connectivity contract rejects an unowned result callback', () => {
  const weakened = providerSettings.replace(
    'if !provider_request_is_current(',
    'if false && !provider_request_is_current(',
  )
  assert.throws(() => assertProviderConnectivityOwnershipContract(weakened, providers))
})
