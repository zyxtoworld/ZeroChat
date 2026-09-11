use crate::{
    crypto::SnapshotCrypto,
    defaults::default_snapshot,
    models::AppSnapshot,
    secret_store::{
        SyncSecretStore, clear_secrets_transactionally, replace_provider_keys_transactionally,
        rollback_provider_keys_after_failure,
    },
    storage::{
        LocalDataCommitGuard, LocalDataTransition, LocalDataTransitionKind, SnapshotCompareAndSave,
        SnapshotStore, snapshot_fingerprint,
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
    let guard = store.lock_local_data_commit();
    recover_pending_local_data_transition_during_local_data_commit(store, secrets, &guard)
}

pub(crate) fn recover_pending_local_data_transition_during_local_data_commit<
    S: SyncSecretStore + ?Sized,
>(
    store: &SnapshotStore,
    secrets: &S,
    guard: &LocalDataCommitGuard<'_>,
) -> Result<Option<AppSnapshot>> {
    let Some(transition) = store.load_local_data_transition_during_local_data_commit(guard)? else {
        return Ok(None);
    };
    recover_local_data_transition(store, secrets, guard, transition).map(Some)
}

pub(crate) fn recover_local_data_transition<S: SyncSecretStore + ?Sized>(
    store: &SnapshotStore,
    secrets: &S,
    guard: &LocalDataCommitGuard<'_>,
    transition: LocalDataTransition,
) -> Result<AppSnapshot> {
    let pending = store
        .load_local_data_transition_during_local_data_commit(guard)?
        .ok_or_else(|| anyhow::anyhow!("The pending local data recovery record disappeared."))?;
    if pending.id != transition.id {
        anyhow::bail!("The pending local data recovery record changed before recovery.");
    }

    let (target, provider_keys) = transition_target(secrets, &transition)?;
    let target_fingerprint = snapshot_fingerprint(Some(&target))?;

    match transition.kind {
        LocalDataTransitionKind::Reset => {
            let provider_ids = transition.provider_ids.iter().cloned().collect();
            let secret_transaction = clear_secrets_transactionally(secrets, &provider_ids)?;
            match commit_transition_snapshot(
                store,
                guard,
                &transition,
                &target,
                &target_fingerprint,
            ) {
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
        LocalDataTransitionKind::EncryptedBackupImport | LocalDataTransitionKind::SyncCommit => {
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
            match commit_transition_snapshot(
                store,
                guard,
                &transition,
                &target,
                &target_fingerprint,
            ) {
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

    store.complete_local_data_transition(guard, &target_fingerprint)?;
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
        LocalDataTransitionKind::SyncCommit => {
            let passphrase = secrets.sync_passphrase()?;
            if passphrase.trim().is_empty() {
                anyhow::bail!("Data encryption password is required.");
            }
            let envelope = transition.encrypted_vault.as_ref().ok_or_else(|| {
                anyhow::anyhow!("The pending local data recovery record is invalid.")
            })?;
            let vault = SnapshotCrypto::new().decrypt_vault(envelope, &passphrase)?;
            let target_fingerprint = snapshot_fingerprint(Some(&vault.data))?;
            if vault.data.version != 1
                || transition.target_snapshot_fingerprint.as_deref()
                    != Some(target_fingerprint.as_str())
            {
                anyhow::bail!("The pending local data recovery record is invalid.");
            }

            let defaults = default_snapshot();
            let required_provider_ids = vault
                .data
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
            let encrypted_provider_ids = vault
                .secrets
                .provider_keys
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>();
            if !required_provider_ids.is_subset(&journal_provider_ids)
                || encrypted_provider_ids != journal_provider_ids
            {
                anyhow::bail!("The pending local data recovery record is invalid.");
            }
            Ok((vault.data, vault.secrets.provider_keys))
        }
    }
}

fn commit_transition_snapshot(
    store: &SnapshotStore,
    guard: &LocalDataCommitGuard<'_>,
    transition: &LocalDataTransition,
    target: &AppSnapshot,
    target_fingerprint: &str,
) -> TransitionSnapshotCommit {
    match store.save_local_data_transition_target(
        guard,
        transition.source_snapshot_fingerprint.as_deref(),
        target,
    ) {
        Ok(SnapshotCompareAndSave::Saved) => TransitionSnapshotCommit::Committed,
        Ok(SnapshotCompareAndSave::Changed(_)) => TransitionSnapshotCommit::Rejected(
            anyhow::anyhow!("Local data changed while a recovery operation was pending."),
        ),
        Err(operation_error) => match store.load_during_local_data_commit(guard) {
            Ok(current) => match snapshot_fingerprint(current.as_ref()) {
                Ok(fingerprint) => classify_transition_snapshot_after_write_error(
                    operation_error,
                    &fingerprint,
                    transition.source_snapshot_fingerprint.as_deref(),
                    target_fingerprint,
                ),
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

fn classify_transition_snapshot_after_write_error(
    operation_error: anyhow::Error,
    observed_fingerprint: &str,
    source_fingerprint: Option<&str>,
    target_fingerprint: &str,
) -> TransitionSnapshotCommit {
    if observed_fingerprint == target_fingerprint {
        return TransitionSnapshotCommit::Committed;
    }
    if source_fingerprint == Some(observed_fingerprint) {
        return TransitionSnapshotCommit::Rejected(operation_error);
    }
    TransitionSnapshotCommit::Indeterminate(anyhow::anyhow!(
        "{operation_error:#}; durable local recovery state diverged from both the source and target snapshots ({observed_fingerprint})"
    ))
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
    use super::{
        TransitionSnapshotCommit, classify_transition_snapshot_after_write_error,
        recover_pending_local_data_transition, transition_target,
    };
    use crate::{
        crypto::SnapshotCrypto,
        defaults::default_snapshot,
        models::{ProviderSecrets, SyncVault},
        secret_store::{SyncSecretStore, replace_provider_keys_transactionally},
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

    fn stage_transition(store: &SnapshotStore, transition: &LocalDataTransition) {
        let guard = store.lock_local_data_commit();
        store
            .stage_local_data_transition(&guard, transition)
            .unwrap();
    }

    fn sync_commit_transition(
        source: &crate::models::AppSnapshot,
        target: &crate::models::AppSnapshot,
        provider_keys: BTreeMap<String, String>,
        passphrase: &str,
    ) -> LocalDataTransition {
        let provider_ids = provider_keys.keys().cloned().collect();
        let encrypted_vault = SnapshotCrypto::new()
            .encrypt_vault(
                &SyncVault {
                    data: target.clone(),
                    secrets: ProviderSecrets { provider_keys },
                },
                passphrase,
            )
            .unwrap();
        LocalDataTransition::sync_commit(
            snapshot_fingerprint(Some(source)).unwrap(),
            snapshot_fingerprint(Some(target)).unwrap(),
            encrypted_vault,
            provider_ids,
        )
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
        stage_transition(&store, &transition);

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
        stage_transition(&store, &transition);

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
        store.save(&concurrent).unwrap();
        stage_transition(&store, &transition);

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

    #[test]
    fn interrupted_sync_commit_rolls_forward_encrypted_keys_and_snapshot() {
        let (directory, store) = test_store();
        let mut source = default_snapshot();
        source.updated_at = 90;
        let mut target = source.clone();
        target.updated_at = 100;
        target.providers[0].base_url = "https://target.example/v1".to_owned();
        let ids = provider_ids(&target);
        let provider_id = ids[0].clone();
        let mut replacements = ids
            .into_iter()
            .map(|provider_id| (provider_id, String::new()))
            .collect::<BTreeMap<_, _>>();
        replacements.insert(provider_id.clone(), "target-provider-secret".to_owned());
        let secrets = MemorySecretStore::default();
        secrets.set_sync_passphrase("sync-passphrase").unwrap();
        secrets
            .set_provider_key(&provider_id, "source-provider-secret")
            .unwrap();
        store.save(&source).unwrap();
        let transition = sync_commit_transition(&source, &target, replacements, "sync-passphrase");
        stage_transition(&store, &transition);

        let journal =
            fs::read_to_string(directory.join("snapshot.v1.local-data-transition.json")).unwrap();
        assert!(!journal.contains("target-provider-secret"));
        assert!(!journal.contains("https://target.example/v1"));

        // Simulate a process exit after the key transaction but before the
        // target snapshot and journal completion were published.
        secrets
            .set_provider_key(&provider_id, "target-provider-secret")
            .unwrap();
        let recovered = recover_pending_local_data_transition(&store, &secrets)
            .unwrap()
            .unwrap();

        assert_eq!(recovered.providers[0].base_url, "https://target.example/v1");
        assert_eq!(
            secrets.provider_key(&provider_id).unwrap(),
            "target-provider-secret"
        );
        assert!(store.load_local_data_transition().unwrap().is_none());
        assert_eq!(
            snapshot_fingerprint(store.load().unwrap().as_ref()).unwrap(),
            snapshot_fingerprint(Some(&target)).unwrap()
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn invalid_sync_commit_target_fingerprint_fails_closed_with_journal_retained() {
        let (directory, store) = test_store();
        let mut source = default_snapshot();
        source.updated_at = 110;
        let mut target = source.clone();
        target.updated_at = 120;
        let ids = provider_ids(&target);
        let provider_id = ids[0].clone();
        let replacements = ids
            .into_iter()
            .map(|id| (id, "target-provider-secret".to_owned()))
            .collect::<BTreeMap<_, _>>();
        let secrets = MemorySecretStore::default();
        secrets.set_sync_passphrase("sync-passphrase").unwrap();
        secrets
            .set_provider_key(&provider_id, "source-provider-secret")
            .unwrap();
        store.save(&source).unwrap();
        let mut transition =
            sync_commit_transition(&source, &target, replacements, "sync-passphrase");
        transition.target_snapshot_fingerprint = Some("0".repeat(64));
        stage_transition(&store, &transition);

        let error = recover_pending_local_data_transition(&store, &secrets).unwrap_err();

        assert!(error.to_string().contains("recovery record is invalid"));
        assert_eq!(
            secrets.provider_key(&provider_id).unwrap(),
            "source-provider-secret"
        );
        assert_eq!(
            snapshot_fingerprint(store.load().unwrap().as_ref()).unwrap(),
            snapshot_fingerprint(Some(&source)).unwrap()
        );
        assert!(store.load_local_data_transition().unwrap().is_some());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn post_write_third_snapshot_keeps_target_keys_and_journal_indeterminate() {
        let (directory, store) = test_store();
        let mut source = default_snapshot();
        source.updated_at = 150;
        let mut target = source.clone();
        target.updated_at = 160;
        target.providers[0].base_url = "https://target.example/v1".to_owned();
        let mut third = source.clone();
        third.updated_at = 170;
        third.providers[0].base_url = "https://third.example/v1".to_owned();
        let ids = provider_ids(&target);
        let provider_id = ids[0].clone();
        let mut replacements = ids
            .into_iter()
            .map(|id| (id, String::new()))
            .collect::<BTreeMap<_, _>>();
        replacements.insert(provider_id.clone(), "target-provider-secret".to_owned());
        let secrets = MemorySecretStore::default();
        secrets.set_sync_passphrase("sync-passphrase").unwrap();
        secrets
            .set_provider_key(&provider_id, "source-provider-secret")
            .unwrap();
        store.save(&source).unwrap();
        let transition = sync_commit_transition(&source, &target, replacements, "sync-passphrase");
        stage_transition(&store, &transition);

        let (_, target_keys) = transition_target(&secrets, &transition).unwrap();
        let target_replacements = transition
            .provider_ids
            .iter()
            .map(|provider_id| {
                (
                    provider_id.clone(),
                    target_keys.get(provider_id).cloned().unwrap_or_default(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let _key_transaction =
            replace_provider_keys_transactionally(&secrets, &target_replacements).unwrap();
        let observed_third_fingerprint = snapshot_fingerprint(Some(&third)).unwrap();
        let outcome = classify_transition_snapshot_after_write_error(
            anyhow::anyhow!("injected target write failure"),
            &observed_third_fingerprint,
            transition.source_snapshot_fingerprint.as_deref(),
            transition.target_snapshot_fingerprint.as_deref().unwrap(),
        );
        let TransitionSnapshotCommit::Indeterminate(error) = outcome else {
            panic!("a post-write third generation must remain indeterminate");
        };

        assert!(error.to_string().contains("diverged from both"));
        assert_eq!(
            secrets.provider_key(&provider_id).unwrap(),
            "target-provider-secret"
        );
        assert_eq!(store.load().unwrap().unwrap().updated_at, source.updated_at);
        assert!(store.load_local_data_transition().unwrap().is_some());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn ordinary_snapshot_writes_fail_closed_while_transition_is_pending() {
        let (directory, store) = test_store();
        let mut source = default_snapshot();
        source.updated_at = 130;
        let mut target = source.clone();
        target.updated_at = 140;
        store.save(&source).unwrap();
        let transition = LocalDataTransition::reset(
            Some(snapshot_fingerprint(Some(&source)).unwrap()),
            target.clone(),
            provider_ids(&source),
        );
        stage_transition(&store, &transition);

        let error = store.save(&target).unwrap_err();

        assert!(error.to_string().contains("recovery operation is pending"));
        assert_eq!(store.load().unwrap().unwrap().updated_at, source.updated_at);
        assert!(store.load_local_data_transition().unwrap().is_some());
        let _ = fs::remove_dir_all(directory);
    }
}
