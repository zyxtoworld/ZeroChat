use super::{LinuxAppState, LinuxLocalStorageIssue, now_millis};
use crate::{
    auto_sync::collect_provider_keys,
    background::{BACKGROUND_TASK_DISCONNECTED, poll_background_result},
    crypto::SnapshotCrypto,
    defaults::default_snapshot,
    local_data_transition::recover_pending_local_data_transition_during_local_data_commit,
    models::{AppSnapshot, EncryptedSnapshotEnvelope, ProviderSecrets, SyncConfig, SyncVault},
    secret_store::{
        SecretValueTransaction, SyncSecretStore, github_token_transaction_after_direct_set,
        rollback_secret_value_after_failure, sync_passphrase_transaction_after_direct_set,
    },
    storage::{
        LocalDataCommitGuard, LocalDataTransition, SnapshotCompareAndSave, SnapshotStore,
        snapshot_fingerprint,
    },
    sync::FirstSyncStrategy,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::mpsc,
};

impl LinuxAppState {
    pub(crate) fn adopt_committed_sync_snapshot(&self, snapshot: AppSnapshot) {
        *self.snapshot.borrow_mut() = snapshot.clone();
        *self.committed_snapshot.borrow_mut() = snapshot;
    }

    pub(crate) fn sync_config(&self) -> SyncConfig {
        self.snapshot.borrow().sync.clone()
    }

    pub(crate) fn save_sync_passphrase(&self, value: &str) -> anyhow::Result<()> {
        self.ensure_sync_secret_snapshot_commit_ready()?;
        let store = self.store.as_ref().expect("storage readiness was checked");
        let guard = store.lock_local_data_commit();
        let previous = self.snapshot.borrow().clone();
        self.ensure_snapshot_generation_during_local_data_commit(store, &guard, &previous)?;
        let mut candidate = previous.clone();
        candidate.updated_at = now_millis();
        let previous_secret = self.secrets.sync_passphrase()?;
        if previous_secret != value.trim() {
            self.secrets.set_sync_passphrase(value.trim())?;
        }
        let transaction = sync_passphrase_transaction_after_direct_set(
            self.secrets.as_ref(),
            previous_secret,
            value,
        )?;
        self.commit_sync_secret_snapshot(&previous, candidate, transaction, store, &guard)
    }

    pub(crate) fn sync_passphrase(&self) -> String {
        self.secrets.sync_passphrase().unwrap_or_default()
    }

    pub(crate) fn reset_sync_passphrase(&self) -> anyhow::Result<()> {
        self.ensure_sync_secret_snapshot_commit_ready()?;
        let store = self.store.as_ref().expect("storage readiness was checked");
        let guard = store.lock_local_data_commit();
        let previous = self.snapshot.borrow().clone();
        self.ensure_snapshot_generation_during_local_data_commit(store, &guard, &previous)?;
        let mut candidate = previous.clone();
        candidate.updated_at = now_millis();
        let previous_secret = self.secrets.sync_passphrase()?;
        if !previous_secret.is_empty() {
            self.secrets.clear_sync_passphrase()?;
        }
        let transaction = sync_passphrase_transaction_after_direct_set(
            self.secrets.as_ref(),
            previous_secret,
            "",
        )?;
        self.commit_sync_secret_snapshot(&previous, candidate, transaction, store, &guard)
    }

    pub(crate) fn cloudflare_access_key(&self) -> String {
        self.secrets.cloudflare_access_key().unwrap_or_default()
    }

    pub(crate) fn github_token(&self) -> String {
        self.secrets.github_token().unwrap_or_default()
    }

    pub(crate) fn save_github_token(&self, value: &str) -> anyhow::Result<()> {
        self.ensure_sync_secret_snapshot_commit_ready()?;
        let store = self.store.as_ref().expect("storage readiness was checked");
        let guard = store.lock_local_data_commit();
        let previous = self.snapshot.borrow().clone();
        self.ensure_snapshot_generation_during_local_data_commit(store, &guard, &previous)?;
        let mut candidate = previous.clone();
        candidate.updated_at = now_millis();
        let previous_secret = self.secrets.github_token()?;
        if previous_secret != value.trim() {
            self.secrets.set_github_token(value.trim())?;
        }
        let transaction = github_token_transaction_after_direct_set(
            self.secrets.as_ref(),
            previous_secret,
            value,
        )?;
        self.commit_sync_secret_snapshot(&previous, candidate, transaction, store, &guard)
    }

    pub(crate) fn update_sync_config(&self, mutate: impl FnOnce(&mut SyncConfig)) {
        {
            let mut snapshot = self.snapshot.borrow_mut();
            mutate(&mut snapshot.sync);
            snapshot.updated_at = now_millis();
        }
        self.save();
    }

    fn ensure_sync_secret_snapshot_commit_ready(&self) -> anyhow::Result<()> {
        if let Some(message) = self.local_storage_blocker_message() {
            anyhow::bail!(message);
        }
        if self.store.is_none() {
            anyhow::bail!("Local storage is unavailable.");
        }
        Ok(())
    }

    fn commit_sync_secret_snapshot<S: SyncSecretStore + ?Sized>(
        &self,
        previous: &AppSnapshot,
        candidate: AppSnapshot,
        transaction: SecretValueTransaction<'_, S>,
        store: &SnapshotStore,
        guard: &LocalDataCommitGuard<'_>,
    ) -> anyhow::Result<()> {
        match store.save_if_unchanged_during_local_data_commit(guard, Some(previous), &candidate) {
            Ok(SnapshotCompareAndSave::Saved) => {}
            Ok(SnapshotCompareAndSave::Changed(_)) => {
                return Err(rollback_secret_value_after_failure(
                    anyhow::anyhow!(
                        "Local data changed while the sync secret was being committed."
                    ),
                    &transaction,
                ));
            }
            Err(error) => {
                self.report_local_storage_issue(LinuxLocalStorageIssue::SnapshotSaveFailed);
                return Err(rollback_secret_value_after_failure(error, &transaction));
            }
        }

        *self.snapshot.borrow_mut() = candidate.clone();
        *self.committed_snapshot.borrow_mut() = candidate.clone();
        self.enqueue_auto_sync_snapshot(candidate, FirstSyncStrategy::Ask);
        Ok(())
    }

    fn ensure_snapshot_generation_during_local_data_commit(
        &self,
        store: &SnapshotStore,
        guard: &LocalDataCommitGuard<'_>,
        expected: &AppSnapshot,
    ) -> anyhow::Result<()> {
        if store
            .load_local_data_transition_during_local_data_commit(guard)?
            .is_some()
        {
            anyhow::bail!("A local data recovery operation is pending.");
        }
        let current = store.load_during_local_data_commit(guard)?;
        if snapshot_fingerprint(current.as_ref())? != snapshot_fingerprint(Some(expected))? {
            anyhow::bail!("Local data changed before the secret transaction started.");
        }
        Ok(())
    }

    pub(crate) fn export_encrypted_backup(&self) -> anyhow::Result<String> {
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Local storage is unavailable."))?;
        let guard = store.lock_local_data_commit();
        if store
            .load_local_data_transition_during_local_data_commit(&guard)?
            .is_some()
        {
            anyhow::bail!("A local data recovery operation is pending.");
        }
        let passphrase = self.secrets.sync_passphrase()?;
        if passphrase.trim().is_empty() {
            anyhow::bail!("Data encryption password is required.");
        }

        let snapshot = store
            .load_during_local_data_commit(&guard)?
            .ok_or_else(|| anyhow::anyhow!("Local snapshot is unavailable."))?;
        let vault = SyncVault {
            data: snapshot.clone(),
            secrets: ProviderSecrets {
                provider_keys: self.provider_keys_for_backup(&guard, &snapshot)?,
            },
        };
        let envelope = SnapshotCrypto::new().encrypt_vault(&vault, &passphrase)?;
        Ok(serde_json::to_string_pretty(&envelope)?)
    }

    pub(crate) fn import_encrypted_backup(&self, text: &str) -> anyhow::Result<()> {
        let passphrase = self.secrets.sync_passphrase()?;
        if passphrase.trim().is_empty() {
            anyhow::bail!("Data encryption password is required.");
        }

        let envelope: EncryptedSnapshotEnvelope =
            serde_json::from_str(text).map_err(|_| anyhow::anyhow!("File format is invalid"))?;
        let vault = SnapshotCrypto::new().decrypt_vault(&envelope, &passphrase)?;
        if vault.data.version != 1 {
            anyhow::bail!("File format is invalid");
        }

        let previous = self.snapshot.borrow().clone();
        let mut imported = vault.data;
        imported.updated_at = now_millis();
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Local storage is unavailable."))?;
        let guard = store.lock_local_data_commit();
        if self.secrets.sync_passphrase()? != passphrase {
            anyhow::bail!("The data encryption password changed during backup import.");
        }
        if store
            .load_local_data_transition_during_local_data_commit(&guard)?
            .is_some()
        {
            anyhow::bail!("A local data recovery operation is pending.");
        }
        let recovering = self.local_persistence_blocked();
        let source_snapshot_fingerprint = if recovering {
            None
        } else {
            Some(snapshot_fingerprint(
                store.load_during_local_data_commit(&guard)?.as_ref(),
            )?)
        };
        let provider_ids = previous
            .providers
            .iter()
            .chain(imported.providers.iter())
            .map(|provider| provider.id.clone())
            .chain(
                default_snapshot()
                    .providers
                    .into_iter()
                    .map(|provider| provider.id),
            )
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let transition = LocalDataTransition::encrypted_backup_import(
            source_snapshot_fingerprint,
            imported.updated_at,
            envelope,
            provider_ids,
        );
        store.stage_local_data_transition(&guard, &transition)?;
        let imported = match recover_pending_local_data_transition_during_local_data_commit(
            store,
            self.secrets.as_ref(),
            &guard,
        ) {
            Ok(Some(imported)) => imported,
            Ok(None) => anyhow::bail!("The encrypted backup recovery record disappeared."),
            Err(error) => {
                self.report_local_storage_issue(LinuxLocalStorageIssue::SnapshotLoadFailed);
                return Err(error);
            }
        };

        *self.snapshot.borrow_mut() = imported.clone();
        *self.committed_snapshot.borrow_mut() = imported.clone();
        self.clear_local_storage_issue();
        self.enqueue_auto_sync_snapshot(imported, FirstSyncStrategy::Ask);
        Ok(())
    }

    pub(crate) fn provider_keys_for_backup(
        &self,
        _guard: &LocalDataCommitGuard<'_>,
        snapshot: &AppSnapshot,
    ) -> anyhow::Result<BTreeMap<String, String>> {
        collect_provider_keys(snapshot, |provider_id| {
            self.secrets.provider_key(provider_id)
        })
    }

    pub(crate) fn save(&self) {
        self.save_with_first_sync_strategy(FirstSyncStrategy::Ask);
    }

    pub(crate) fn save_local_only(&self) {
        if self.local_persistence_blocked() {
            self.restore_committed_snapshot();
            return;
        }
        self.persist_current_snapshot();
    }

    pub(crate) fn save_with_first_sync_strategy(&self, first_sync_strategy: FirstSyncStrategy) {
        if self.local_persistence_blocked() {
            self.restore_committed_snapshot();
            return;
        }
        let Some(snapshot) = self.persist_current_snapshot() else {
            return;
        };

        self.enqueue_auto_sync_snapshot(snapshot, first_sync_strategy);
    }

    pub(crate) fn enqueue_auto_sync_snapshot(
        &self,
        snapshot: AppSnapshot,
        first_sync_strategy: FirstSyncStrategy,
    ) {
        if let (Some(runtime), Some(auto_sync)) = (&self.sync_runtime, &self.auto_sync) {
            let auto_sync = auto_sync.clone();
            let (sender, receiver) = mpsc::channel();
            runtime.spawn(async move {
                let _ = sender.send(auto_sync.enqueue(snapshot, first_sync_strategy).await);
            });

            let state = self.clone();
            poll_background_result(
                receiver,
                move |result| {
                    if !matches!(result, Ok(Some(_))) {
                        return;
                    }

                    // The coordinator may merge edits queued while the remote request
                    // is in flight. Reload its committed snapshot instead of applying
                    // the older request result to GTK memory.
                    let loaded = state
                        .store
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("Local storage is unavailable."))
                        .and_then(|store| store.load());
                    match classify_synced_snapshot_reload(loaded) {
                        Ok(snapshot) => {
                            *state.snapshot.borrow_mut() = snapshot.clone();
                            *state.committed_snapshot.borrow_mut() = snapshot;
                        }
                        Err(issue) => {
                            // A successful remote operation cannot make a failed local
                            // reload safe. Block ordinary writes until explicit recovery.
                            state.report_local_storage_issue(issue);
                        }
                    }
                },
                || Err(BACKGROUND_TASK_DISCONNECTED.to_owned()),
            );
        }
    }

    fn persist_current_snapshot(&self) -> Option<AppSnapshot> {
        let Some(store) = &self.store else {
            self.restore_committed_snapshot();
            self.report_local_storage_issue(LinuxLocalStorageIssue::StorageUnavailable);
            return None;
        };

        let candidate = self.snapshot.borrow().clone();
        let expected = self.committed_snapshot.borrow().clone();
        match store.save_if_unchanged(Some(&expected), &candidate) {
            Ok(SnapshotCompareAndSave::Saved) => {
                *self.committed_snapshot.borrow_mut() = candidate.clone();
                Some(candidate)
            }
            Ok(SnapshotCompareAndSave::Changed(Some(current))) => {
                *self.snapshot.borrow_mut() = current.clone();
                *self.committed_snapshot.borrow_mut() = current;
                None
            }
            Ok(SnapshotCompareAndSave::Changed(None)) | Err(_) => {
                self.restore_committed_snapshot();
                self.report_local_storage_issue(LinuxLocalStorageIssue::SnapshotSaveFailed);
                None
            }
        }
    }

    pub(crate) fn request_first_sync_strategy(
        &self,
        first_sync_strategy: FirstSyncStrategy,
        sender: mpsc::Sender<Result<AppSnapshot, String>>,
    ) {
        if let Some(message) = self.local_storage_blocker_message() {
            let _ = sender.send(Err(message.to_owned()));
            return;
        }
        let snapshot = self.snapshot.borrow().clone();
        if let (Some(runtime), Some(auto_sync)) = (&self.sync_runtime, &self.auto_sync) {
            let auto_sync = auto_sync.clone();
            runtime.spawn(async move {
                let result = auto_sync
                    .enqueue(snapshot, first_sync_strategy)
                    .await
                    .map_err(|error| error.to_string())
                    .and_then(|synced| {
                        synced.ok_or_else(|| "Cloud sync is not configured.".to_owned())
                    });
                let _ = sender.send(result);
            });
        } else {
            let message = self
                .sync_initialization_issue
                .unwrap_or("Cloud sync is not configured.");
            let _ = sender.send(Err(message.to_owned()));
        }
    }

    pub(crate) fn request_manual_sync(&self, sender: mpsc::Sender<Result<AppSnapshot, String>>) {
        if let Some(message) = self.local_storage_blocker_message() {
            let _ = sender.send(Err(message.to_owned()));
            return;
        }
        let snapshot = self.snapshot.borrow().clone();
        if let (Some(runtime), Some(auto_sync)) = (&self.sync_runtime, &self.auto_sync) {
            let auto_sync = auto_sync.clone();
            runtime.spawn(async move {
                let result = auto_sync
                    .sync_now(snapshot, FirstSyncStrategy::Ask)
                    .await
                    .map_err(|error| error.to_string())
                    .and_then(|synced| {
                        synced.ok_or_else(|| "Cloud sync is not configured.".to_owned())
                    });
                let _ = sender.send(result);
            });
        } else {
            let message = self
                .sync_initialization_issue
                .unwrap_or("Cloud sync is not configured.");
            let _ = sender.send(Err(message.to_owned()));
        }
    }
}

fn classify_synced_snapshot_reload<E>(
    loaded: Result<Option<AppSnapshot>, E>,
) -> Result<AppSnapshot, LinuxLocalStorageIssue> {
    match loaded {
        Ok(Some(snapshot)) => Ok(snapshot),
        Ok(None) | Err(_) => Err(LinuxLocalStorageIssue::SnapshotLoadFailed),
    }
}

#[cfg(test)]
mod tests {
    use super::{LinuxLocalStorageIssue, classify_synced_snapshot_reload};
    use crate::defaults::default_snapshot;

    #[test]
    fn synced_snapshot_reload_accepts_a_present_snapshot() {
        assert!(classify_synced_snapshot_reload::<()>(Ok(Some(default_snapshot()))).is_ok());
    }

    #[test]
    fn synced_snapshot_reload_blocks_when_the_file_is_missing() {
        assert_eq!(
            classify_synced_snapshot_reload::<()>(Ok(None)).err(),
            Some(LinuxLocalStorageIssue::SnapshotLoadFailed)
        );
    }

    #[test]
    fn synced_snapshot_reload_blocks_when_reading_fails() {
        assert_eq!(
            classify_synced_snapshot_reload::<()>(Err(())).err(),
            Some(LinuxLocalStorageIssue::SnapshotLoadFailed)
        );
    }
}
