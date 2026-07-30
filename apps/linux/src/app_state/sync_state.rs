use super::{LinuxAppState, LinuxLocalStorageIssue, now_millis, persist_snapshot_candidate};
use crate::{
    background::poll_background_result,
    crypto::SnapshotCrypto,
    defaults::default_snapshot,
    local_data_transition::recover_pending_local_data_transition,
    models::{AppSnapshot, EncryptedSnapshotEnvelope, ProviderSecrets, SyncConfig, SyncVault},
    secret_store::{
        SecretValueTransaction, SyncSecretStore, github_token_transaction_after_direct_set,
        rollback_secret_value_after_failure, sync_passphrase_transaction_after_direct_set,
    },
    storage::{LocalDataTransition, SnapshotCompareAndSave, snapshot_fingerprint},
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
        let previous_secret = self.secrets.sync_passphrase()?;
        if previous_secret == value.trim() {
            self.snapshot.borrow_mut().updated_at = now_millis();
            self.save();
            if let Some(message) = self.local_storage_blocker_message() {
                anyhow::bail!(message);
            }
            return Ok(());
        }

        let previous = self.snapshot.borrow().clone();
        let mut candidate = previous.clone();
        candidate.updated_at = now_millis();
        self.secrets.set_sync_passphrase(value.trim())?;
        let transaction = sync_passphrase_transaction_after_direct_set(
            self.secrets.as_ref(),
            previous_secret,
            value,
        )?;
        self.commit_sync_secret_snapshot(&previous, candidate, transaction)
    }

    pub(crate) fn sync_passphrase(&self) -> String {
        self.secrets.sync_passphrase().unwrap_or_default()
    }

    pub(crate) fn reset_sync_passphrase(&self) -> anyhow::Result<()> {
        self.ensure_sync_secret_snapshot_commit_ready()?;
        let previous = self.snapshot.borrow().clone();
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
        self.commit_sync_secret_snapshot(&previous, candidate, transaction)
    }

    pub(crate) fn cloudflare_access_key(&self) -> String {
        self.secrets.cloudflare_access_key().unwrap_or_default()
    }

    pub(crate) fn github_token(&self) -> String {
        self.secrets.github_token().unwrap_or_default()
    }

    pub(crate) fn save_github_token(&self, value: &str) -> anyhow::Result<()> {
        self.ensure_sync_secret_snapshot_commit_ready()?;
        let previous = self.snapshot.borrow().clone();
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
        self.commit_sync_secret_snapshot(&previous, candidate, transaction)
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
    ) -> anyhow::Result<()> {
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Local storage is unavailable."))?;
        match store.save_if_unchanged(Some(previous), &candidate) {
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

    pub(crate) fn export_encrypted_backup(&self) -> anyhow::Result<String> {
        let passphrase = self.secrets.sync_passphrase()?;
        if passphrase.trim().is_empty() {
            anyhow::bail!("Data encryption password is required.");
        }

        let snapshot = self.snapshot.borrow().clone();
        let vault = SyncVault {
            data: snapshot.clone(),
            secrets: ProviderSecrets {
                provider_keys: self.provider_keys_for_backup(&snapshot),
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
        let recovering = self.local_persistence_blocked();
        let source_snapshot_fingerprint = if recovering {
            None
        } else {
            Some(snapshot_fingerprint(store.load()?.as_ref())?)
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
        store.stage_local_data_transition(&transition)?;
        let imported = match recover_pending_local_data_transition(store, self.secrets.as_ref()) {
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
        snapshot: &AppSnapshot,
    ) -> BTreeMap<String, String> {
        snapshot
            .providers
            .iter()
            .filter_map(|provider| {
                let value = self.secrets.provider_key(&provider.id).unwrap_or_default();
                (!value.trim().is_empty()).then_some((provider.id.clone(), value))
            })
            .collect()
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
            poll_background_result(receiver, move |result| {
                if !matches!(result, Ok(Some(_))) {
                    return;
                }

                // The coordinator may merge edits queued while the remote request
                // is in flight. Reload its committed snapshot instead of applying
                // the older request result to GTK memory.
                if let Some(snapshot) = state
                    .store
                    .as_ref()
                    .and_then(|store| store.load().ok().flatten())
                {
                    *state.snapshot.borrow_mut() = snapshot.clone();
                    *state.committed_snapshot.borrow_mut() = snapshot;
                }
            });
        }
    }

    fn persist_current_snapshot(&self) -> Option<AppSnapshot> {
        let Some(store) = &self.store else {
            self.restore_committed_snapshot();
            self.report_local_storage_issue(LinuxLocalStorageIssue::StorageUnavailable);
            return None;
        };

        match persist_snapshot_candidate(&self.snapshot, &self.committed_snapshot, |snapshot| {
            store.save(snapshot)
        }) {
            Ok(snapshot) => Some(snapshot),
            Err(issue) => {
                self.report_local_storage_issue(issue);
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
            let _ = sender.send(Err("Cloud sync is not configured.".to_owned()));
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
            let _ = sender.send(Err("Cloud sync is not configured.".to_owned()));
        }
    }
}
