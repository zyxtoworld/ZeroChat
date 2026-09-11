const CURRENT_ARCHITECTURE_FAILURES = Object.freeze({
  cancellation:
    'Android suspend I/O must preserve CancellationException through Result helpers, upload rollback, body cleanup, persistence, sync, backup, generation, and Provider settings boundaries.',
  startupRecovery:
    'Android, Apple, and Linux startup load failures must preserve unreadable snapshots, block ordinary persistence and sync, and unlock only after explicit recovery succeeds.',
  modelSettings:
    'Android Model settings must live in focused ui/settings files with ModelSettings.kt delegating provider picking, catalog editing, default choices, and tested helpers while preserving missing-key fetch blockers, live model fetch, explicit manual model add, ordering, deletion fallback, and default chat/image model choices.',
  providerSettings:
    'Android Provider settings must progressively render the large built-in provider list with one complete editor at a time, keep every visible Provider editable through its compact summary, expose PRD connected/not-connected status labels, block missing provider keys before network connectivity checks, treat non-empty fetched model lists as authoritative, protect the final enabled Provider, migrate disabled/deleted Provider conversations to enabled fallbacks, and lock provider repair in ProviderSettingsHelpersTest so opening Settings stays responsive and provider removal remains data-safe on emulator and device.',
})

const CURRENT_ANDROID_REPOSITORY_HEALTH_ANCHORS = Object.freeze({
  cancellation: Object.freeze({
    legacy: Object.freeze([
      'persistence.queue.runSerially { persistLocalSnapshot(source) }',
      'SnapshotPersistence.queue exposed to callers',
    ]),
    production: Object.freeze([
      'runCatchingPreservingCancellation { persistence.runSnapshotMutation { repository.load() } }',
      'SnapshotPersistenceOwner private queue and runSnapshotReplacement',
    ]),
    behavior: Object.freeze([
      'SnapshotPersistenceQueueTest.queuedWritesRunInSubmissionOrder',
      'SnapshotPersistenceQueueTest.successfulReplacementDropsAdmittedSnapshotMutationBeforeExecution',
    ]),
    semantic: 'Cancellation remains the primary signal while admitted snapshot work is serialized and replacement invalidation is enforced by the owner.',
  }),
  startupRecovery: Object.freeze({
    legacy: Object.freeze([
      'restorePendingProviderKeyImportAfterSnapshotLoadFailure() called directly by the app',
      'persistence.queue.runSerially { persistLocalSnapshot(source) }',
    ]),
    production: Object.freeze([
      'restorePendingSecretTransactionsAfterSnapshotLoadFailure(secretStore)',
      'SecretStore attempts local reset, provider key, and sync passphrase recovery independently',
      'persistence.enqueueSnapshot(normalized, shouldSync = true)',
    ]),
    behavior: Object.freeze([
      'SecretStoreRecoveryTest.loadFailureAttemptsLocalProviderAndSyncPendingRecovery',
      'SecretStoreRecoveryTest.oneRecoveryFailureDoesNotSkipTheOtherPendingKinds',
    ]),
    semantic: 'Unreadable snapshots remain write-protected until explicit recovery; all durable secret transaction kinds are attempted without allowing one failure to skip another.',
  }),
  modelSettings: Object.freeze({
    legacy: Object.freeze([
      'modelSettingsApplyFetchedModels(provider, models, nowMillis())',
      'old model settings test name',
    ]),
    production: Object.freeze([
      'ModelCatalogEditor onSnapshotReduce rechecks the current provider before applying models',
      'modelSettingsApplyFetchedModelsToSnapshot(..., expectedOwner)',
    ]),
    behavior: Object.freeze([
      'ModelSettingsHelpersTest.modelSettingsApplyFetchedModelsToSnapshotRejectsResultAfterProviderEndpointReplacement',
      'ModelSettingsHelpersTest.modelSettingsFetchBlockerRequiresProviderKeyBeforeNetworkFetch',
    ]),
    semantic: 'A late catalog result cannot update a replaced provider, and a missing credential blocks the network request before any side effect.',
  }),
  providerSettings: Object.freeze({
    legacy: Object.freeze([
      'CredentialSnapshotTransaction.kt',
      'commitProviderKeySaveTransaction(...)',
      'commitSyncPassphraseSaveTransaction(...)',
      'providerSettingsApplyConnectivityModels(provider, models, nowMillis())',
    ]),
    production: Object.freeze([
      'commitProviderKeySnapshotSaveTransaction(...)',
      'commitSyncPassphraseSnapshotTransaction(...)',
      'ProviderSettings providerSettingsApplyConnectivityModelsToSnapshot(...)',
      'Provider deletion stage/CAS/finish/rollback transaction',
    ]),
    behavior: Object.freeze([
      'ProviderKeySaveTransactionTest.stagesProviderKeyBeforeSnapshotAndFinishesIntent',
      'ProviderKeySaveTransactionTest.processStopAfterSnapshotCasLeavesPendingIntentForStartupRecovery',
      'SyncPassphraseSaveTransactionTest.stagesPassphraseBeforeSnapshotAndFinishesIntent',
      'ProviderSettingsHelpersTest.providerSettingsApplyConnectivityModelsToSnapshotUsesTheLatestProviderRecordWhenOwnerMatches',
      'ProviderDeletionTransactionTest.credentialFinishFailureRollsSnapshotBackAndPreservesProviderKey',
    ]),
    semantic: 'Credential writes are crash-recoverable and provider model/deletion results are applied only to the current snapshot owner; the deleted unsafe transaction path stays absent.',
  }),
})

function includes(source, marker) {
  return typeof source === 'string' && source.includes(marker)
}

function matches(source, pattern) {
  return typeof source === 'string' && pattern.test(source)
}

function currentCancellationContract(sources) {
  return (
    includes(sources.androidApp, 'val loadedSnapshotResult = runCatchingPreservingCancellation') &&
    matches(
      sources.androidApp,
      /runCatchingPreservingCancellation\s*\{[\s\S]*?persistence\.runSnapshotMutation\s*\{\s*repository\.load\(\)\s*\}[\s\S]*?\}/u,
    ) &&
    includes(sources.androidSnapshotPersistence, 'private val queue = SnapshotPersistenceQueue(scope)') &&
    includes(sources.androidSnapshotPersistence, 'suspend fun <T> runSnapshotMutation(') &&
    includes(sources.androidSnapshotPersistence, 'suspend fun <T> runSnapshotReplacement(') &&
    includes(sources.androidSnapshotPersistenceQueueTest, 'queuedWritesRunInSubmissionOrder') &&
    includes(
      sources.androidSnapshotPersistenceQueueTest,
      'successfulReplacementDropsAdmittedSnapshotMutationBeforeExecution',
    )
  )
}

function currentStartupRecoveryContract(sources) {
  return (
    includes(
      sources.androidApp,
      'restorePendingSecretTransactionsAfterSnapshotLoadFailure(secretStore)',
    ) &&
    includes(
      sources.androidSecretStore,
      'attemptRecovery { secretStore.restorePendingLocalResetAfterSnapshotLoadFailure() }',
    ) &&
    includes(
      sources.androidSecretStore,
      'attemptRecovery { secretStore.restorePendingProviderKeyImportAfterSnapshotLoadFailure() }',
    ) &&
    includes(
      sources.androidSecretStore,
      'attemptRecovery { secretStore.restorePendingSyncPassphraseAfterSnapshotLoadFailure() }',
    ) &&
    includes(
      sources.androidSecretStoreRecoveryTest,
      'loadFailureAttemptsLocalProviderAndSyncPendingRecovery',
    ) &&
    includes(
      sources.androidSecretStoreRecoveryTest,
      'oneRecoveryFailureDoesNotSkipTheOtherPendingKinds',
    ) &&
    includes(sources.androidApp, 'persistence.enqueueSnapshot(normalized, shouldSync = true)')
  )
}

function currentModelSettingsContract(sources) {
  return (
    matches(
      sources.androidModelCatalogEditor,
      /onSnapshotReduce\s*\{\s*current\s*->[\s\S]*?val currentProvider = current\.providers\.firstOrNull\s*\{\s*it\.id == provider\.id\s*\}[\s\S]*?modelSettingsApplyFetchedModels\(\s*currentProvider,\s*models,\s*nowMillis\(\),\s*\)/u,
    ) &&
    includes(
      sources.androidModelSettingsHelpersTest,
      'modelSettingsApplyFetchedModelsToSnapshotRejectsResultAfterProviderEndpointReplacement',
    ) &&
    includes(
      sources.androidModelSettingsHelpersTest,
      'modelSettingsFetchBlockerRequiresProviderKeyBeforeNetworkFetch',
    )
  )
}

function currentProviderSettingsContract(sources) {
  const hasDurableProviderKeySave =
    includes(sources.androidApp, 'commitProviderKeySnapshotSaveTransaction(') &&
    includes(sources.androidProviderKeySaveTransaction, 'commitProviderKeyImportTransaction(') &&
    includes(sources.androidProviderKeySaveTransactionTest, 'stagesProviderKeyBeforeSnapshotAndFinishesIntent') &&
    includes(
      sources.androidProviderKeySaveTransactionTest,
      'processStopAfterSnapshotCasLeavesPendingIntentForStartupRecovery',
    ) &&
    includes(
      sources.androidProviderKeySaveTransactionTest,
      'finishFailureRollsSnapshotBackAndRestoresStagedProviderKey',
    )

  const hasDurableSyncPassphraseSave =
    includes(sources.androidApp, 'commitSyncPassphraseSnapshotTransaction(') &&
    includes(sources.androidSyncPassphraseSaveTransaction, 'stageSyncPassphrase()') &&
    includes(sources.androidSyncPassphraseSaveTransaction, 'compareAndSetSnapshot(source, candidate)') &&
    includes(sources.androidSyncPassphraseSaveTransactionTest, 'stagesPassphraseBeforeSnapshotAndFinishesIntent') &&
    includes(
      sources.androidSyncPassphraseSaveTransactionTest,
      'processStopAfterSnapshotCasLeavesPendingIntentForStartupRecovery',
    ) &&
    includes(
      sources.androidSyncPassphraseSaveTransactionTest,
      'finishFailureRollsSnapshotBackAndRestoresStagedPassphrase',
    )

  const noUnsafeCredentialPath =
    sources.androidCredentialSnapshotTransaction === '' &&
    !includes(sources.androidApp, 'commitProviderKeySaveTransaction(') &&
    !includes(sources.androidApp, 'commitSyncPassphraseSaveTransaction(') &&
    !includes(sources.androidProviderKeySaveTransaction, 'commitCredentialSnapshotTransaction(') &&
    !includes(sources.androidSyncPassphraseSaveTransaction, 'commitCredentialSnapshotTransaction(')

  return (
    hasDurableProviderKeySave &&
    hasDurableSyncPassphraseSave &&
    noUnsafeCredentialPath &&
    includes(sources.androidApp, 'secretStore.reconcilePendingProviderDeletions(') &&
    includes(sources.androidSecretStore, 'fun reconcilePendingProviderDeletions(') &&
    includes(
      sources.androidProviderSettingsHelpersTest,
      'providerSettingsApplyConnectivityModelsToSnapshotUsesTheLatestProviderRecordWhenOwnerMatches',
    ) &&
    includes(
      sources.androidProviderSettingsHelpersTest,
      'providerSettingsDeleteProviderRemovesProviderAndRepairsDeletedConversations',
    ) &&
    includes(
      sources.androidProviderSettings,
      'providerSettingsApplyConnectivityModelsToSnapshot(',
    )
  )
}

export function currentAndroidRepositoryHealthContractResults(sources) {
  return Object.freeze({
    cancellation: currentCancellationContract(sources),
    startupRecovery: currentStartupRecoveryContract(sources),
    modelSettings: currentModelSettingsContract(sources),
    providerSettings: currentProviderSettingsContract(sources),
  })
}

export function currentAndroidRepositoryHealthFailures(sources) {
  const results = currentAndroidRepositoryHealthContractResults(sources)
  return Object.freeze(
    Object.entries(results)
      .filter(([, passed]) => !passed)
      .map(([id]) => ({ id, message: CURRENT_ARCHITECTURE_FAILURES[id] })),
  )
}

export { CURRENT_ARCHITECTURE_FAILURES }
export { CURRENT_ANDROID_REPOSITORY_HEALTH_ANCHORS }
