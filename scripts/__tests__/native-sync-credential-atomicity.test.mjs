import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const appleStore = await readFile(
  new URL('../../apps/apple/Sources/ZeroChatCore/SnapshotStore.swift', import.meta.url),
  'utf8',
)
const appleViewModel = await readFile(
  new URL('../../apps/apple/App/AppleChatViewModel.swift', import.meta.url),
  'utf8',
)
const appleModelSettings = await readFile(
  new URL('../../apps/apple/App/ModelSettingsView.swift', import.meta.url),
  'utf8',
)
const appleProviderEditor = await readFile(
  new URL('../../apps/apple/App/ProviderEditor.swift', import.meta.url),
  'utf8',
)
const linuxStorage = await readFile(
  new URL('../../apps/linux/src/storage.rs', import.meta.url),
  'utf8',
)
const linuxAutoSync = await readFile(
  new URL('../../apps/linux/src/auto_sync.rs', import.meta.url),
  'utf8',
)
const linuxTransition = await readFile(
  new URL('../../apps/linux/src/local_data_transition.rs', import.meta.url),
  'utf8',
)
const linuxChatState = await readFile(
  new URL('../../apps/linux/src/app_state/chat_state.rs', import.meta.url),
  'utf8',
)
const linuxProviderState = await readFile(
  new URL('../../apps/linux/src/app_state/provider_state.rs', import.meta.url),
  'utf8',
)
const linuxSyncState = await readFile(
  new URL('../../apps/linux/src/app_state/sync_state.rs', import.meta.url),
  'utf8',
)

function functionBody(source, signature, nextSignature) {
  const start = source.indexOf(signature)
  expect(start, `missing ${signature}`).not.toBe(-1)
  const end = source.indexOf(nextSignature, start + signature.length)
  expect(end, `missing ${nextSignature}`).not.toBe(-1)
  return source.slice(start, end)
}

function expectBefore(source, first, second) {
  const firstIndex = source.indexOf(first)
  const secondIndex = source.indexOf(second)
  expect(firstIndex, `missing ${first}`).toBeGreaterThanOrEqual(0)
  expect(secondIndex, `missing ${second}`).toBeGreaterThan(firstIndex)
}

describe('native sync Provider credential crash consistency', () => {
  it('stages an encrypted Apple sync commit before snapshot or Keychain mutation', () => {
    expect(appleStore).toMatch(/case syncCommit/)
    expect(appleStore).not.toMatch(/var providerKeys:/)

    const acceptance = functionBody(
      appleViewModel,
      '    private func applySyncedSnapshot(',
      '    private func notifySyncCompleteIfNeeded(',
    )
    expect(acceptance).toMatch(/kind: \.syncCommit/)
    expect(acceptance).toMatch(/crypto\.encryptVault\(/)
    expectBefore(acceptance, 'stageLocalDataTransition(', 'recoverPendingLocalDataTransition(')

    const recovery = functionBody(
      appleViewModel,
      '    private func recoverPendingLocalDataTransition(',
      '    private func reportLocalSnapshotIssue(',
    )
    expectBefore(recovery, 'appleApplyProviderKeyValues(', 'recoverLocalSnapshot(')
  })

  it('stages an encrypted Linux sync commit before Provider key or snapshot mutation', () => {
    expect(linuxStorage).toMatch(/SyncCommit/)
    expect(linuxStorage).not.toMatch(/provider_keys: BTreeMap/)

    const commit = functionBody(
      linuxAutoSync,
      '    fn commit_sync(',
      '\n}\n\nstruct SyncCandidate',
    )
    expect(commit).toMatch(/SnapshotCrypto::new\(\)\.encrypt_vault\(/)
    expect(commit).toMatch(/LocalDataTransition::sync_commit\(/)
    expectBefore(commit, 'stage_local_data_transition(', 'recover_local_data_transition(')

    const recovery = functionBody(
      linuxTransition,
      'pub(crate) fn recover_local_data_transition',
      '\nfn transition_target',
    )
    const providerKeyRecovery = recovery.slice(
      recovery.indexOf(
        'LocalDataTransitionKind::EncryptedBackupImport | LocalDataTransitionKind::SyncCommit',
      ),
    )
    expectBefore(
      providerKeyRecovery,
      'replace_provider_keys_transactionally(',
      'commit_transition_snapshot(',
    )
    expect(providerKeyRecovery).toMatch(
      /TransitionSnapshotCommit::Indeterminate\(error\) => return Err\(error\)/,
    )
    expect(linuxTransition).toMatch(
      /fn post_write_third_snapshot_keeps_target_keys_and_journal_indeterminate\(\)/,
    )
    const failedWriteClassification = functionBody(
      linuxTransition,
      'fn classify_transition_snapshot_after_write_error(',
      '\nfn rollback_secret_clear_after_rejected_snapshot',
    )
    expect(failedWriteClassification).toMatch(/observed_fingerprint == target_fingerprint/)
    expect(failedWriteClassification).toMatch(/source_fingerprint == Some\(observed_fingerprint\)/)
    expect(failedWriteClassification).toMatch(/TransitionSnapshotCommit::Indeterminate/)
  })

  it('freezes Apple request credentials before asynchronous work starts', () => {
    const requestFunctions = [
      functionBody(
        appleViewModel,
        '    func speakMessage(',
        '    private func startSpeechPlayback(',
      ),
      functionBody(
        appleViewModel,
        '    private func sendChat(',
        '    private func sendImagePrompt(',
      ),
      functionBody(
        appleViewModel,
        '    private func sendImagePrompt(',
        '    private func updateStreamingAssistant(',
      ),
    ]

    for (const body of requestFunctions) {
      expect(body).toMatch(/!recoveringLocalSnapshot/)
      const taskStart = body.indexOf('Task {')
      expect(taskStart).toBeGreaterThanOrEqual(0)
      const beforeTask = body.slice(0, taskStart)
      const task = body.slice(taskStart)
      expect(beforeTask).toMatch(/let requestProvider = providerRequest\(/)
      expect(beforeTask).toMatch(/let apiKey = providerKey\(/)
      expect(task).not.toMatch(/providerKey\(/)
      expect(task).not.toMatch(/providerRequest\(/)
    }

    for (const source of [appleModelSettings, appleProviderEditor]) {
      expect(source).toMatch(/!model\.recoveringLocalSnapshot/)
      expect(source).toMatch(/model\.localSnapshotIssue == nil/)
    }
  })

  it('binds Linux Provider configuration and credentials under the local-data commit guard', () => {
    expect(linuxStorage).toMatch(/struct LocalDataCommitGuard/)
    expect(linuxStorage).toMatch(/fn lock_local_data_commit\(/)
    expect(linuxStorage).toMatch(/fn load_during_local_data_commit\(/)

    const binding = functionBody(
      linuxChatState,
      '    fn provider_request_binding(',
      '    pub(crate) fn prepare_message_speech(',
    )
    expect(binding).toMatch(/lock_local_data_commit\(/)
    expect(binding).toMatch(/load_during_local_data_commit\(/)
    expect(binding).toMatch(/local_persistence_blocked\(\)/)
    expect(binding).toMatch(/provider_key\(/)
    expect(binding).toMatch(/cloudflare_access_key\(/)
    expect(binding).toMatch(/return bind\(&snapshot\)/)

    const bindingAssembly = functionBody(
      linuxChatState,
      'fn provider_request_binding_from_snapshot(',
      '\nimpl LinuxAppState',
    )
    expect(bindingAssembly).toMatch(/provider_request\(/)
    expect(bindingAssembly).toMatch(/provider_key\(/)
    expect(bindingAssembly).toMatch(/provider_proxy_access_key\(/)
    expect(bindingAssembly).toMatch(/match preferred_provider_id/)
    expect(linuxChatState).toMatch(
      /missing_preferred_provider_never_falls_back_to_another_enabled_provider/,
    )
    expect(linuxChatState).toMatch(
      /disabled_preferred_provider_never_falls_back_to_another_enabled_provider/,
    )

    for (const signature of [
      '    pub(crate) fn prepare_message_speech(',
      '    pub(crate) fn append_pending_chat_turn(',
      '    pub(crate) fn append_pending_image_turn(',
    ]) {
      const start = linuxChatState.indexOf(signature)
      expect(start, `missing ${signature}`).not.toBe(-1)
      const next = linuxChatState.indexOf('\n    pub(crate) fn ', start + signature.length)
      const body = linuxChatState.slice(start, next === -1 ? undefined : next)
      expect(body).toMatch(/provider_request_binding\(/)
    }
  })

  it('serializes Linux snapshot and secret mutations with the local-data commit guard', () => {
    const ordinarySave = functionBody(
      linuxStorage,
      '    pub fn save(',
      '    pub(crate) fn save_during_local_data_commit(',
    )
    expectBefore(ordinarySave, 'lock_local_data_commit(', 'save_during_local_data_commit(')

    const providerSecretCommit = functionBody(
      linuxProviderState,
      '    fn commit_provider_secret_snapshot(',
      '\n}\n\nfn provider_fallback_for_deleted',
    )
    expectBefore(
      providerSecretCommit,
      'lock_local_data_commit(',
      'replace_provider_keys_transactionally(',
    )
    expect(providerSecretCommit).toMatch(/save_if_unchanged_during_local_data_commit\(/)

    for (const [signature, nextSignature] of [
      ['    pub(crate) fn save_sync_passphrase(', '    pub(crate) fn sync_passphrase('],
      ['    pub(crate) fn reset_sync_passphrase(', '    pub(crate) fn cloudflare_access_key('],
      ['    pub(crate) fn save_github_token(', '    pub(crate) fn update_sync_config('],
    ]) {
      const body = functionBody(linuxSyncState, signature, nextSignature)
      expectBefore(body, 'lock_local_data_commit(', 'commit_sync_secret_snapshot(')
    }
    expect(linuxSyncState).toMatch(/save_if_unchanged_during_local_data_commit\(/)
  })
})
