use crate::{
    crypto::SnapshotCrypto,
    defaults::default_snapshot,
    models::AppSnapshot,
    secret_store::{
        SyncSecretStore, clear_secrets_transactionally, replace_provider_keys_transactionally,
        rollback_provider_keys_after_failure,
    },
    storage::{
        LocalDataTransition, LocalDataTransitionKind, SnapshotCompareAndSave, SnapshotStore,
        snapshot_fingerprint,
    },
};
use anyhow::Result;
use std::collections::{BTreeMap, BTreeSet};

enum TransitionSnapshotCommit {
    Committed,
    Rejected(anyhow::Error),
    Indeterminate(anyhow::Error),
}

pub(crate) fn recover_pending_local_data_transition<S: SyncSecretStore + ?Sized>(
    store: &SnapshotStore,
    secrets: &S,
) -> Result<Option<AppSnapshot>> {
    let Some(transition) = store.load_local_data_transition()? else {
        return Ok(None);
    };
    recover_local_data_transition(store, secrets, transition).map(Some)
}

pub(crate) fn recover_local_data_transition<S: SyncSecretStore + ?Sized>(
    store: &SnapshotStore,
    secrets: &S,
    transition: LocalDataTransition,
) -> Result<AppSnapshot> {
    let (target, provider_keys) = transition_target(secrets, &transition)?;
    let target_fingerprint = snapshot_fingerprint(Some(&target))?;

    match transition.kind {
        LocalDataTransitionKind::Reset => {
            let provider_ids = transition.provider_ids.iter().cloned().collect();
            let secret_transaction = clear_secrets_transactionally(secrets, &provider_ids)?;
            match commit_transition_snapshot(store, &transition, &target, &target_fingerprint) {
                TransitionSnapshotCommit::Committed => {}
                TransitionSnapshotCommit::Rejected(error) => {
                    return Err(rollback_secret_clear_after_rejected_snapshot(
                        error,
                        &secret_transaction,
                    ));
                }
                TransitionSnapshotCommit::Indeterminate(error) => return Err(error),
            }
        }
        LocalDataTransitionKind::EncryptedBackupImport => {
            let replacements = transition
                .provider_ids
                .iter()
                .map(|provider_id| {
                    (
                        provider_id.clone(),
                        provider_keys.get(provider_id).cloned().unwrap_or_default(),
                    )
                })
                .collect::<BTreeMap<_, _>>();
            let secret_transaction = replace_provider_keys_transactionally(secrets, &replacements)?;
            match commit_transition_snapshot(store, &transition, &target, &target_fingerprint) {
                TransitionSnapshotCommit::Committed => {}
                TransitionSnapshotCommit::Rejected(error) => {
                    return Err(rollback_provider_keys_after_failure(
                        error,
                        &secret_transaction,
                    ));
                }
                TransitionSnapshotCommit::Indeterminate(error) => return Err(error),
            }
        }
    }

    store.complete_local_data_transition(&target_fingerprint)?;
    Ok(target)
}

fn transition_target<S: SyncSecretStore + ?Sized>(
    secrets: &S,
    transition: &LocalDataTransition,
) -> Result<(AppSnapshot, BTreeMap<String, String>)> {
    match transition.kind {
        LocalDataTransitionKind::Reset => {
            let target = transition.target_snapshot.clone().ok_or_else(|| {
                anyhow::anyhow!("The pending local data recovery record is invalid.")
            })?;
            Ok((target, BTreeMap::new()))
        }
        LocalDataTransitionKind::EncryptedBackupImport => {
            let passphrase = secrets.sync_passphrase()?;
            if passphrase.trim().is_empty() {
                anyhow::bail!("Data encryption password is required.");
            }
            let envelope = transition.encrypted_backup.as_ref().ok_or_else(|| {
                anyhow::anyhow!("The pending local data recovery record is invalid.")
            })?;
            let vault = SnapshotCrypto::new().decrypt_vault(envelope, &passphrase)?;
            if vault.data.version != 1 {
                anyhow::bail!("File format is invalid");
            }
            let mut target = vault.data;
            target.updated_at = transition.target_updated_at.ok_or_else(|| {
                anyhow::anyhow!("The pending local data recovery record is invalid.")
            })?;
            let defaults = default_snapshot();
            let required_provider_ids = target
                .providers
                .iter()
                .chain(defaults.providers.iter())
                .map(|provider| provider.id.clone())
                .collect::<BTreeSet<_>>();
            let journal_provider_ids = transition
                .provider_ids
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>();
            if !required_provider_ids.is_subset(&journal_provider_ids) {
                anyhow::bail!("The pending local data recovery record is invalid.");
            }
            Ok((target, vault.secrets.provider_keys))
        }
    }
}

fn commit_transition_snapshot(
    store: &SnapshotStore,
    transition: &LocalDataTransition,
    target: &AppSnapshot,
    target_fingerprint: &str,
) -> TransitionSnapshotCommit {
    match store.save_local_data_transition_target(
        transition.source_snapshot_fingerprint.as_deref(),
        target,
    ) {
        Ok(SnapshotCompareAndSave::Saved) => TransitionSnapshotCommit::Committed,
        Ok(SnapshotCompareAndSave::Changed(_)) => TransitionSnapshotCommit::Rejected(
            anyhow::anyhow!("Local data changed while a recovery operation was pending."),
        ),
        Err(operation_error) => match store.load() {
            Ok(current) => match snapshot_fingerprint(current.as_ref()) {
                Ok(fingerprint) if fingerprint == target_fingerprint => {
                    TransitionSnapshotCommit::Committed
                }
                Ok(_) => TransitionSnapshotCommit::Rejected(operation_error),
                Err(read_error) => TransitionSnapshotCommit::Indeterminate(anyhow::anyhow!(
                    "{operation_error:#}; durable local recovery state could not be fingerprinted: {read_error:#}"
                )),
            },
            Err(read_error) => TransitionSnapshotCommit::Indeterminate(anyhow::anyhow!(
                "{operation_error:#}; durable local recovery state could not be read: {read_error:#}"
            )),
        },
    }
}

fn rollback_secret_clear_after_rejected_snapshot<S: SyncSecretStore + ?Sized>(
    operation_error: anyhow::Error,
    transaction: &crate::secret_store::SecretClearTransaction<'_, S>,
) -> anyhow::Error {
    match transaction.rollback() {
        Ok(()) => operation_error,
        Err(rollback_error) => anyhow::anyhow!(
            "{operation_error:#}; local reset secret rollback failed: {rollback_error:#}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::recover_pending_local_data_transition;
    use crate::{
        crypto::SnapshotCrypto,
        defaults::default_snapshot,
        models::{ProviderSecrets, SyncVault},
        secret_store::SyncSecretStore,
        storage::{LocalDataTransition, SnapshotStore, snapshot_fingerprint},
    };
    use anyhow::Result;
    use std::{
        collections::BTreeMap,
        fs,
        sync::{Mutex, MutexGuard},
    };
    use uuid::Uuid;

    #[derive(Default)]
    struct MemorySecretStore {
        sync_passphrase: Mutex<String>,
        github_token: Mutex<String>,
        provider_keys: Mutex<BTreeMap<String, String>>,
    }

    impl SyncSecretStore for MemorySecretStore {
        fn sync_passphrase(&self) -> Result<String> {
            Ok(lock(&self.sync_passphrase).clone())
        }

        fn set_sync_passphrase(&self, value: &str) -> Result<()> {
            *lock(&self.sync_passphrase) = value.to_owned();
            Ok(())
        }

        fn github_token(&self) -> Result<String> {
            Ok(lock(&self.github_token).clone())
        }

        fn set_github_token(&self, value: &str) -> Result<()> {
            *lock(&self.github_token) = value.to_owned();
            Ok(())
        }

        fn provider_key(&self, provider_id: &str) -> Result<String> {
            Ok(lock(&self.provider_keys)
                .get(provider_id)
                .cloned()
                .unwrap_or_default())
        }

        fn set_provider_key(&self, provider_id: &str, value: &str) -> Result<()> {
            let mut keys = lock(&self.provider_keys);
            if value.is_empty() {
                keys.remove(provider_id);
            } else {
                keys.insert(provider_id.to_owned(), value.to_owned());
            }
            Ok(())
        }
    }

    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn test_store() -> (std::path::PathBuf, SnapshotStore) {
        let directory =
            std::env::temp_dir().join(format!("zerochat-local-data-transition-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let store = SnapshotStore::for_test_file(directory.join("snapshot.v1.json"));
        (directory, store)
    }

    fn provider_ids(snapshot: &crate::models::AppSnapshot) -> Vec<String> {
        let mut ids = snapshot
            .providers
            .iter()
            .map(|provider| provider.id.clone())
            .collect::<Vec<_>>();
        ids.sort();
        ids.dedup();
        ids
    }

    #[test]
    fn interrupted_reset_rolls_forward_all_secrets_and_snapshot() {
        let (directory, store) = test_store();
        let mut source = default_snapshot();
        source.updated_at = 10;
        let mut target = default_snapshot();
        target.updated_at = 20;
        store.save(&source).unwrap();
        let provider_ids = provider_ids(&source);
        let secrets = MemorySecretStore::default();
        secrets.set_sync_passphrase("old-passphrase").unwrap();
        secrets.set_github_token("old-token").unwrap();
        secrets
            .set_provider_key(&provider_ids[0], "old-provider-key")
            .unwrap();
        let transition = LocalDataTransition::reset(
            Some(snapshot_fingerprint(Some(&source)).unwrap()),
            target.clone(),
            provider_ids.clone(),
        );
        store.stage_local_data_transition(&transition).unwrap();

        let recovered = recover_pending_local_data_transition(&store, &secrets)
            .unwrap()
            .unwrap();

        assert_eq!(recovered.updated_at, target.updated_at);
        assert_eq!(secrets.sync_passphrase().unwrap(), "");
        assert_eq!(secrets.github_token().unwrap(), "");
        assert_eq!(secrets.provider_key(&provider_ids[0]).unwrap(), "");
        assert!(store.load_local_data_transition().unwrap().is_none());
        assert_eq!(
            snapshot_fingerprint(store.load().unwrap().as_ref()).unwrap(),
            snapshot_fingerprint(Some(&target)).unwrap()
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn interrupted_encrypted_import_rolls_forward_keys_and_keeps_other_secrets() {
        let (directory, store) = test_store();
        let mut source = default_snapshot();
        source.updated_at = 30;
        let mut imported = source.clone();
        imported.updated_at = 40;
        let provider_ids = provider_ids(&imported);
        let provider_id = provider_ids[0].clone();
        store.save(&source).unwrap();
        let secrets = MemorySecretStore::default();
        secrets.set_sync_passphrase("backup-passphrase").unwrap();
        secrets.set_github_token("keep-token").unwrap();
        secrets.set_provider_key(&provider_id, "old-key").unwrap();
        let envelope = SnapshotCrypto::new()
            .encrypt_vault(
                &SyncVault {
                    data: imported,
                    secrets: ProviderSecrets {
                        provider_keys: BTreeMap::from([(
                            provider_id.clone(),
                            "imported-key".to_owned(),
                        )]),
                    },
                },
                "backup-passphrase",
            )
            .unwrap();
        let transition = LocalDataTransition::encrypted_backup_import(
            Some(snapshot_fingerprint(Some(&source)).unwrap()),
            50,
            envelope,
            provider_ids,
        );
        store.stage_local_data_transition(&transition).unwrap();

        let recovered = recover_pending_local_data_transition(&store, &secrets)
            .unwrap()
            .unwrap();

        assert_eq!(recovered.updated_at, 50);
        assert_eq!(secrets.provider_key(&provider_id).unwrap(), "imported-key");
        assert_eq!(secrets.sync_passphrase().unwrap(), "backup-passphrase");
        assert_eq!(secrets.github_token().unwrap(), "keep-token");
        assert!(store.load_local_data_transition().unwrap().is_none());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn unrelated_snapshot_rejects_reset_and_restores_cleared_secrets() {
        let (directory, store) = test_store();
        let mut source = default_snapshot();
        source.updated_at = 60;
        let mut target = default_snapshot();
        target.updated_at = 70;
        let mut concurrent = source.clone();
        concurrent.updated_at = 80;
        let provider_ids = provider_ids(&source);
        let secrets = MemorySecretStore::default();
        secrets.set_sync_passphrase("old-passphrase").unwrap();
        secrets.set_github_token("old-token").unwrap();
        secrets
            .set_provider_key(&provider_ids[0], "old-provider-key")
            .unwrap();
        store.save(&source).unwrap();
        let transition = LocalDataTransition::reset(
            Some(snapshot_fingerprint(Some(&source)).unwrap()),
            target,
            provider_ids.clone(),
        );
        store.stage_local_data_transition(&transition).unwrap();
        store.save(&concurrent).unwrap();

        let error = recover_pending_local_data_transition(&store, &secrets).unwrap_err();

        assert!(error.to_string().contains("Local data changed"));
        assert_eq!(secrets.sync_passphrase().unwrap(), "old-passphrase");
        assert_eq!(secrets.github_token().unwrap(), "old-token");
        assert_eq!(
            secrets.provider_key(&provider_ids[0]).unwrap(),
            "old-provider-key"
        );
        assert!(store.load_local_data_transition().unwrap().is_some());
        assert_eq!(store.load().unwrap().unwrap().updated_at, 80);
        let _ = fs::remove_dir_all(directory);
    }
}
