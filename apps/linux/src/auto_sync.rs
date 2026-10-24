use crate::{
    auto_sync_state::{
        has_local_user_content, is_stale_sync_result, merge_sync_result, with_sync_status,
    },
    crypto::SnapshotCrypto,
    defaults::default_snapshot,
    local_data_transition::recover_local_data_transition,
    models::{AppSnapshot, ProviderSecrets, SyncVault},
    secret_store::SyncSecretStore,
    storage::{
        LocalDataCommitGuard, LocalDataTransition, SnapshotCompareAndSave, SnapshotStore,
        snapshot_fingerprint,
    },
    sync::{FirstSyncStrategy, SyncClient},
};
use anyhow::Result;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::Duration,
};
use tokio::{sync::Mutex, time::sleep};

const AUTO_SYNC_DEBOUNCE_MS: u64 = 700;

pub struct AutoSyncCoordinator<S: SyncSecretStore + 'static> {
    store: Arc<SnapshotStore>,
    secrets: Arc<S>,
    sync_client: SyncClient,
    pending: Mutex<Option<PendingSync>>,
    drain_lock: Mutex<()>,
}

impl<S: SyncSecretStore + 'static> AutoSyncCoordinator<S> {
    pub fn new(store: Arc<SnapshotStore>, secrets: Arc<S>) -> Result<Self> {
        Ok(Self {
            store,
            secrets,
            sync_client: SyncClient::new()?,
            pending: Mutex::new(None),
            drain_lock: Mutex::new(()),
        })
    }

    pub async fn enqueue(
        &self,
        snapshot: AppSnapshot,
        first_sync_strategy: FirstSyncStrategy,
    ) -> Result<Option<AppSnapshot>> {
        *self.pending.lock().await = Some(PendingSync {
            snapshot,
            first_sync_strategy,
        });

        let _guard = self.drain_lock.lock().await;

        self.drain_pending(None).await
    }

    async fn drain_pending(&self, mut latest: Option<AppSnapshot>) -> Result<Option<AppSnapshot>> {
        loop {
            if self.pending.lock().await.is_none() {
                break;
            }
            sleep(Duration::from_millis(AUTO_SYNC_DEBOUNCE_MS)).await;
            let Some(next) = self.pending.lock().await.take() else {
                continue;
            };

            let synced = match self
                .sync_if_configured(next.snapshot.clone(), next.first_sync_strategy, true)
                .await
            {
                Ok(value) => value,
                Err(error) => Some(SyncCandidate::without_secret_changes(with_sync_status(
                    error.snapshot,
                    &error.message,
                    false,
                ))),
            };

            if let Some(candidate) = synced {
                match self.commit_sync(&next.snapshot, candidate)? {
                    Ok(snapshot) => latest = Some(snapshot),
                    Err(current) => {
                        let mut pending = self.pending.lock().await;
                        if pending.is_none() {
                            *pending = Some(PendingSync {
                                snapshot: current,
                                first_sync_strategy: FirstSyncStrategy::Ask,
                            });
                        }
                    }
                }
            }
        }

        Ok(latest)
    }

    pub async fn sync_now(
        &self,
        snapshot: AppSnapshot,
        first_sync_strategy: FirstSyncStrategy,
    ) -> Result<Option<AppSnapshot>> {
        let _guard = self.drain_lock.lock().await;
        let synced = match self
            .sync_if_configured(snapshot.clone(), first_sync_strategy, false)
            .await
        {
            Ok(value) => value,
            Err(error) => Some(SyncCandidate::without_secret_changes(with_sync_status(
                error.snapshot,
                &error.message,
                false,
            ))),
        };

        let mut latest = None;
        if let Some(candidate) = synced {
            latest = Some(match self.commit_sync(&snapshot, candidate)? {
                Ok(snapshot) | Err(snapshot) => snapshot,
            });
        }

        // Saves that arrive while manual sync owns drain_lock have already put
        // their newest snapshot in pending. Drain them before releasing the
        // lock so no queued change is stranded until some unrelated save.
        self.drain_pending(latest).await
    }

    async fn sync_if_configured(
        &self,
        snapshot: AppSnapshot,
        first_sync_strategy: FirstSyncStrategy,
        requires_auto_sync: bool,
    ) -> Result<Option<SyncCandidate>, SyncFailure> {
        if !matches!(snapshot.sync.mode.as_str(), "gist" | "cloudflare")
            || (requires_auto_sync && !snapshot.sync.auto_sync)
        {
            return Ok(None);
        }

        if let Err(error) = self.secrets.ensure_readable() {
            return Err(SyncFailure {
                snapshot,
                message: error.to_string(),
            });
        }

        if let Err(error) = self.secrets.flush() {
            return Err(SyncFailure {
                snapshot,
                message: error.to_string(),
            });
        }

        let passphrase = self
            .secrets
            .sync_passphrase()
            .map_err(|error| SyncFailure {
                snapshot: snapshot.clone(),
                message: error.to_string(),
            })?;
        if passphrase.trim().is_empty() {
            return Ok(Some(SyncCandidate::without_secret_changes(
                with_sync_status(
                    snapshot,
                    "Cloud sync is waiting for the data encryption password.",
                    false,
                ),
            )));
        }

        let mode = snapshot.sync.mode.clone();
        let result = match mode.as_str() {
            "gist" => {
                let token = self.secrets.github_token().map_err(|error| SyncFailure {
                    snapshot: snapshot.clone(),
                    message: error.to_string(),
                })?;
                if token.trim().is_empty() {
                    return Ok(Some(SyncCandidate::without_secret_changes(
                        with_sync_status(snapshot, "GitHub token is required.", false),
                    )));
                }
                self.sync_gist(snapshot, &passphrase, &token, first_sync_strategy)
                    .await
            }
            "cloudflare" => {
                if snapshot
                    .sync
                    .worker_endpoint
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
                {
                    return Ok(None);
                }
                let token = self
                    .secrets
                    .cloudflare_access_key()
                    .map_err(|error| SyncFailure {
                        snapshot: snapshot.clone(),
                        message: error.to_string(),
                    })?;
                if token.trim().is_empty() {
                    return Ok(Some(SyncCandidate::without_secret_changes(
                        with_sync_status(
                            snapshot,
                            "Cloud sync is waiting for the data encryption password.",
                            false,
                        ),
                    )));
                }
                self.sync_cloudflare(snapshot, &passphrase, &token, first_sync_strategy)
                    .await
            }
            _ => Ok(None),
        };

        match result {
            Ok(value) => Ok(value),
            Err(error) => Err(SyncFailure {
                snapshot: error.snapshot,
                message: error.error.to_string(),
            }),
        }
    }

    async fn sync_gist(
        &self,
        snapshot: AppSnapshot,
        passphrase: &str,
        token: &str,
        first_sync_strategy: FirstSyncStrategy,
    ) -> Result<Option<SyncCandidate>, SyncErrorWithSnapshot> {
        let gist_id = snapshot.sync.gist_id.clone().unwrap_or_default();
        let gist_file = snapshot
            .sync
            .gist_file
            .clone()
            .unwrap_or_else(|| "zerochat-sync.json".to_owned());
        let source_vault = self
            .sync_vault_for_source(&snapshot, passphrase)
            .map_err(|error| SyncErrorWithSnapshot {
                snapshot: snapshot.clone(),
                error,
            })?;

        let had_completed_sync = snapshot.sync.last_sync_at.is_some();
        let had_local_user_content = has_local_user_content(&snapshot);
        let synced_vault = self
            .sync_client
            .sync_gist_vault(
                source_vault,
                passphrase,
                &gist_id,
                &gist_file,
                token,
                first_sync_strategy,
                had_completed_sync,
                had_local_user_content,
            )
            .await
            .map_err(|error| SyncErrorWithSnapshot {
                snapshot: snapshot.clone(),
                error,
            })?;

        // The Gist protocol stores its cursor against this exact completion
        // timestamp. Re-stamping the snapshot here would invalidate that cursor.
        let provider_key_replacements = provider_key_replacements_for_synced_vault(
            &snapshot,
            &synced_vault.data,
            &synced_vault.secrets.provider_keys,
        );

        Ok(Some(SyncCandidate {
            snapshot: synced_vault.data,
            provider_key_replacements,
            expected_passphrase_fingerprint: Some(secret_fingerprint(passphrase)),
        }))
    }

    async fn sync_cloudflare(
        &self,
        snapshot: AppSnapshot,
        passphrase: &str,
        token: &str,
        first_sync_strategy: FirstSyncStrategy,
    ) -> Result<Option<SyncCandidate>, SyncErrorWithSnapshot> {
        let endpoint = snapshot.sync.worker_endpoint.clone().unwrap_or_default();
        let source_vault = self
            .sync_vault_for_source(&snapshot, passphrase)
            .map_err(|error| SyncErrorWithSnapshot {
                snapshot: snapshot.clone(),
                error,
            })?;

        let had_completed_sync = snapshot.sync.last_sync_at.is_some();
        let had_local_user_content = has_local_user_content(&snapshot);
        let synced_vault = self
            .sync_client
            .sync_cloudflare_vault(
                source_vault,
                passphrase,
                &endpoint,
                token,
                first_sync_strategy,
                had_completed_sync,
                had_local_user_content,
            )
            .await
            .map_err(|error| SyncErrorWithSnapshot {
                snapshot: snapshot.clone(),
                error,
            })?;

        let provider_key_replacements = provider_key_replacements_for_synced_vault(
            &snapshot,
            &synced_vault.data,
            &synced_vault.secrets.provider_keys,
        );

        Ok(Some(SyncCandidate {
            snapshot: with_sync_status(synced_vault.data, "Sync complete", true),
            provider_key_replacements,
            expected_passphrase_fingerprint: Some(secret_fingerprint(passphrase)),
        }))
    }

    fn sync_vault_for_source(&self, snapshot: &AppSnapshot, passphrase: &str) -> Result<SyncVault> {
        let guard = self.store.lock_local_data_commit();
        if self
            .store
            .load_local_data_transition_during_local_data_commit(&guard)?
            .is_some()
        {
            anyhow::bail!("A local data recovery operation is pending.");
        }
        let committed = self.store.load_during_local_data_commit(&guard)?;
        if snapshot_fingerprint(committed.as_ref())? != snapshot_fingerprint(Some(snapshot))? {
            anyhow::bail!("Local data changed before the sync request was prepared.");
        }
        if self.secrets.sync_passphrase()? != passphrase {
            anyhow::bail!("The data encryption password changed before sync started.");
        }

        Ok(SyncVault {
            data: snapshot.clone(),
            secrets: ProviderSecrets {
                provider_keys: self.provider_keys(&guard, snapshot)?,
            },
        })
    }

    fn provider_keys(
        &self,
        _guard: &LocalDataCommitGuard<'_>,
        snapshot: &AppSnapshot,
    ) -> Result<BTreeMap<String, String>> {
        collect_provider_keys(snapshot, |provider_id| {
            self.secrets.provider_key(provider_id)
        })
    }

    fn commit_sync(
        &self,
        source: &AppSnapshot,
        candidate: SyncCandidate,
    ) -> Result<std::result::Result<AppSnapshot, AppSnapshot>> {
        let guard = self.store.lock_local_data_commit();
        if self
            .store
            .load_local_data_transition_during_local_data_commit(&guard)?
            .is_some()
        {
            anyhow::bail!("A local data recovery operation is pending.");
        }
        let current = self.store.load_during_local_data_commit(&guard)?;
        let accepted = match prepare_sync_commit(source, current, candidate) {
            Ok(accepted) => accepted,
            Err(current) => return Ok(Err(current)),
        };

        if accepted.provider_key_replacements.is_empty() {
            return match self.store.save_if_unchanged_during_local_data_commit(
                &guard,
                accepted.expected_snapshot.as_ref(),
                &accepted.snapshot,
            )? {
                SnapshotCompareAndSave::Saved => Ok(Ok(accepted.snapshot)),
                SnapshotCompareAndSave::Changed(Some(current)) => Ok(Err(current)),
                SnapshotCompareAndSave::Changed(None) => {
                    anyhow::bail!("Local snapshot disappeared while sync data was being committed.")
                }
            };
        }

        let passphrase = self.secrets.sync_passphrase()?;
        if passphrase.trim().is_empty() {
            anyhow::bail!("Data encryption password is required.");
        }
        let current_passphrase_fingerprint = secret_fingerprint(&passphrase);
        if accepted.expected_passphrase_fingerprint.as_deref()
            != Some(current_passphrase_fingerprint.as_str())
        {
            return Ok(Err(accepted
                .expected_snapshot
                .unwrap_or_else(|| source.clone())));
        }

        let target_vault = SyncVault {
            data: accepted.snapshot.clone(),
            secrets: ProviderSecrets {
                provider_keys: accepted.provider_key_replacements.clone(),
            },
        };
        let encrypted_vault = SnapshotCrypto::new().encrypt_vault(&target_vault, &passphrase)?;
        let source_fingerprint = snapshot_fingerprint(accepted.expected_snapshot.as_ref())?;
        let target_fingerprint = snapshot_fingerprint(Some(&accepted.snapshot))?;
        let provider_ids = accepted.provider_key_replacements.keys().cloned().collect();
        let transition = LocalDataTransition::sync_commit(
            source_fingerprint,
            target_fingerprint,
            encrypted_vault,
            provider_ids,
        );
        self.store
            .stage_local_data_transition(&guard, &transition)?;
        let recovered = recover_local_data_transition(
            self.store.as_ref(),
            self.secrets.as_ref(),
            &guard,
            transition,
        )?;
        Ok(Ok(recovered))
    }
}

struct SyncCandidate {
    snapshot: AppSnapshot,
    provider_key_replacements: BTreeMap<String, String>,
    expected_passphrase_fingerprint: Option<String>,
}

#[derive(Debug)]
struct SyncCommit {
    snapshot: AppSnapshot,
    provider_key_replacements: BTreeMap<String, String>,
    expected_snapshot: Option<AppSnapshot>,
    expected_passphrase_fingerprint: Option<String>,
}

fn prepare_sync_commit(
    source: &AppSnapshot,
    current: Option<AppSnapshot>,
    candidate: SyncCandidate,
) -> std::result::Result<SyncCommit, AppSnapshot> {
    let expected_snapshot = current.clone();
    if let Some(current) = current {
        if is_stale_sync_result(source, &current) {
            return Err(current);
        }
        return Ok(SyncCommit {
            snapshot: merge_sync_result(current, source, candidate.snapshot),
            provider_key_replacements: candidate.provider_key_replacements,
            expected_snapshot,
            expected_passphrase_fingerprint: candidate.expected_passphrase_fingerprint,
        });
    }

    Ok(SyncCommit {
        snapshot: candidate.snapshot,
        provider_key_replacements: candidate.provider_key_replacements,
        expected_snapshot,
        expected_passphrase_fingerprint: candidate.expected_passphrase_fingerprint,
    })
}

impl SyncCandidate {
    fn without_secret_changes(snapshot: AppSnapshot) -> Self {
        Self {
            snapshot,
            provider_key_replacements: BTreeMap::new(),
            expected_passphrase_fingerprint: None,
        }
    }
}

fn secret_fingerprint(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

pub(crate) fn collect_provider_keys(
    snapshot: &AppSnapshot,
    mut read: impl FnMut(&str) -> Result<String>,
) -> Result<BTreeMap<String, String>> {
    let mut provider_keys = BTreeMap::new();
    for provider in &snapshot.providers {
        let value = read(&provider.id)?;
        if !value.trim().is_empty() {
            provider_keys.insert(provider.id.clone(), value);
        }
    }
    Ok(provider_keys)
}

fn provider_key_replacements_for_synced_vault(
    local: &AppSnapshot,
    synced: &AppSnapshot,
    provider_keys: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut provider_ids = local
        .providers
        .iter()
        .chain(synced.providers.iter())
        .map(|provider| provider.id.clone())
        .collect::<BTreeSet<_>>();
    provider_ids.extend(
        default_snapshot()
            .providers
            .into_iter()
            .map(|provider| provider.id),
    );

    provider_ids
        .into_iter()
        .map(|provider_id| {
            let value = provider_keys.get(&provider_id).cloned().unwrap_or_default();
            (provider_id, value)
        })
        .collect()
}

struct PendingSync {
    snapshot: AppSnapshot,
    first_sync_strategy: FirstSyncStrategy,
}

struct SyncFailure {
    snapshot: AppSnapshot,
    message: String,
}

struct SyncErrorWithSnapshot {
    snapshot: AppSnapshot,
    error: anyhow::Error,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_snapshot_eq(actual: &AppSnapshot, expected: &AppSnapshot) {
        assert_eq!(
            serde_json::to_value(actual).expect("actual snapshot should serialize"),
            serde_json::to_value(expected).expect("expected snapshot should serialize")
        );
    }

    #[test]
    fn provider_key_replacements_for_synced_vault_clears_missing_local_and_default_provider_secrets()
     {
        let mut local = default_snapshot();
        local.providers = vec![provider("old-provider"), provider("shared-provider")];
        let mut synced = default_snapshot();
        synced.providers = vec![provider("shared-provider"), provider("new-provider")];
        let provider_keys = BTreeMap::from([
            ("shared-provider".to_owned(), "remote-shared-key".to_owned()),
            ("new-provider".to_owned(), "remote-new-key".to_owned()),
            ("orphan-provider".to_owned(), "orphan-key".to_owned()),
        ]);

        let replacements =
            provider_key_replacements_for_synced_vault(&local, &synced, &provider_keys);

        assert_eq!(
            replacements.get("shared-provider").map(String::as_str),
            Some("remote-shared-key"),
        );
        assert_eq!(
            replacements.get("new-provider").map(String::as_str),
            Some("remote-new-key"),
        );
        assert_eq!(
            replacements.get("old-provider").map(String::as_str),
            Some("")
        );
        assert_eq!(replacements.get("openai").map(String::as_str), Some(""));
        assert!(!replacements.contains_key("orphan-provider"));
    }

    #[test]
    fn provider_key_read_failure_aborts_remote_vault_key_collection() {
        let mut snapshot = default_snapshot();
        snapshot.providers = vec![provider("provider-a"), provider("provider-b")];

        let error = collect_provider_keys(&snapshot, |provider_id| {
            if provider_id == "provider-b" {
                Err(anyhow::anyhow!("injected provider key read failure"))
            } else {
                Ok("provider-a-key".to_owned())
            }
        })
        .expect_err("a failed Provider key read must abort Vault construction");

        assert!(error.to_string().contains("provider key read failure"));
    }

    #[test]
    fn stale_sync_candidate_cannot_commit_remote_provider_secrets() {
        let mut source = default_snapshot();
        source.updated_at = 10;
        let mut current = source.clone();
        current.updated_at = 11;
        current.preferences.theme = "dark".to_owned();
        let candidate = SyncCandidate {
            snapshot: source.clone(),
            provider_key_replacements: BTreeMap::from([(
                "openai".to_owned(),
                "remote-secret".to_owned(),
            )]),
            expected_passphrase_fingerprint: Some(secret_fingerprint("passphrase")),
        };

        let rejected = prepare_sync_commit(&source, Some(current.clone()), candidate)
            .expect_err("a stale result must not reach the snapshot or secret commit phase");

        assert_snapshot_eq(&rejected, &current);
    }

    #[test]
    fn accepted_sync_candidate_keeps_secret_changes_for_transactional_commit() {
        let mut source = default_snapshot();
        source.updated_at = 10;
        let mut synced = source.clone();
        synced.updated_at = 11;
        synced.preferences.theme = "dark".to_owned();
        let candidate = SyncCandidate {
            snapshot: synced.clone(),
            provider_key_replacements: BTreeMap::from([(
                "openai".to_owned(),
                "remote-secret".to_owned(),
            )]),
            expected_passphrase_fingerprint: Some(secret_fingerprint("passphrase")),
        };

        let accepted = prepare_sync_commit(&source, Some(source.clone()), candidate)
            .expect("an unchanged local source should accept the remote result");

        assert_snapshot_eq(&accepted.snapshot, &synced);
        assert_snapshot_eq(
            accepted
                .expected_snapshot
                .as_ref()
                .expect("accepted sync should preserve its source fingerprint snapshot"),
            &source,
        );
        assert_eq!(
            accepted
                .provider_key_replacements
                .get("openai")
                .map(String::as_str),
            Some("remote-secret")
        );
    }

    fn provider(id: &str) -> crate::models::ProviderConfig {
        crate::models::ProviderConfig {
            id: id.to_owned(),
            name: id.to_owned(),
            kind: crate::models::ProviderKind::OpenaiCompatible,
            base_url: "https://api.example.com/v1".to_owned(),
            proxy_url: None,
            client_request_mode: false,
            model: "model".to_owned(),
            image_model: None,
            audio_speech_model: None,
            audio_transcription_model: None,
            embedding_model: None,
            moderation_model: None,
            realtime_model: None,
            models: vec!["model".to_owned()],
            model_metadata: std::collections::BTreeMap::new(),
            capabilities: vec!["chat".to_owned()],
            enabled: true,
            needs_api_key: true,
            custom: Some(true),
            created_at: 1,
            updated_at: 1,
        }
    }
}
