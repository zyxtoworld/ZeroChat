use crate::{
    auto_sync_state::{
        has_local_user_content, is_stale_sync_result, merge_sync_result, with_sync_status,
    },
    defaults::default_snapshot,
    models::{AppSnapshot, ProviderSecrets, SyncVault},
    secret_store::{
        SyncSecretStore, replace_provider_keys_transactionally,
        rollback_provider_keys_after_failure,
    },
    storage::{SnapshotCompareAndSave, SnapshotStore},
    sync::{FirstSyncStrategy, SyncClient},
};
use anyhow::Result;
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
    pub fn new(store: Arc<SnapshotStore>, secrets: Arc<S>) -> Self {
        Self {
            store,
            secrets,
            sync_client: SyncClient::new(),
            pending: Mutex::new(None),
            drain_lock: Mutex::new(()),
        }
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
                let accepted =
                    match prepare_sync_commit(&next.snapshot, self.store.load()?, candidate) {
                        Ok(accepted) => accepted,
                        Err(current) => {
                            let mut pending = self.pending.lock().await;
                            if pending.is_none() {
                                *pending = Some(PendingSync {
                                    snapshot: current,
                                    first_sync_strategy: FirstSyncStrategy::Ask,
                                });
                            }
                            continue;
                        }
                    };

                match self.commit_sync(accepted)? {
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
            match prepare_sync_commit(&snapshot, self.store.load()?, candidate) {
                Ok(accepted) => {
                    latest = Some(match self.commit_sync(accepted)? {
                        Ok(snapshot) | Err(snapshot) => snapshot,
                    });
                }
                Err(current) => latest = Some(current),
            }
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

        if let Err(error) = self.secrets.flush() {
            return Err(SyncFailure {
                snapshot,
                message: error.to_string(),
            });
        }

        let passphrase = self.secrets.sync_passphrase().unwrap_or_default();
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
                let token = self.secrets.github_token().unwrap_or_default();
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
                let token = self.secrets.cloudflare_access_key().unwrap_or_default();
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
        let secrets = ProviderSecrets {
            provider_keys: self.provider_keys(&snapshot),
        };

        let had_completed_sync = snapshot.sync.last_sync_at.is_some();
        let had_local_user_content = has_local_user_content(&snapshot);
        let synced_vault = self
            .sync_client
            .sync_gist_vault(
                SyncVault {
                    data: snapshot.clone(),
                    secrets,
                },
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
        let secrets = ProviderSecrets {
            provider_keys: self.provider_keys(&snapshot),
        };

        let had_completed_sync = snapshot.sync.last_sync_at.is_some();
        let had_local_user_content = has_local_user_content(&snapshot);
        let synced_vault = self
            .sync_client
            .sync_cloudflare_vault(
                SyncVault {
                    data: snapshot.clone(),
                    secrets,
                },
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
        }))
    }

    fn provider_keys(&self, snapshot: &AppSnapshot) -> BTreeMap<String, String> {
        snapshot
            .providers
            .iter()
            .filter_map(|provider| {
                let value = self.secrets.provider_key(&provider.id).unwrap_or_default();
                (!value.trim().is_empty()).then(|| (provider.id.clone(), value))
            })
            .collect()
    }

    fn commit_sync(
        &self,
        accepted: SyncCommit,
    ) -> Result<std::result::Result<AppSnapshot, AppSnapshot>> {
        let transaction = replace_provider_keys_transactionally(
            self.secrets.as_ref(),
            &accepted.provider_key_replacements,
        )?;
        match self
            .store
            .save_if_unchanged(accepted.expected_snapshot.as_ref(), &accepted.snapshot)
        {
            Ok(SnapshotCompareAndSave::Saved) => Ok(Ok(accepted.snapshot)),
            Ok(SnapshotCompareAndSave::Changed(Some(current))) => {
                transaction.rollback()?;
                Ok(Err(current))
            }
            Ok(SnapshotCompareAndSave::Changed(None)) => Err(rollback_provider_keys_after_failure(
                anyhow::anyhow!("Local snapshot disappeared while sync data was being committed."),
                &transaction,
            )),
            Err(error) => Err(rollback_provider_keys_after_failure(error, &transaction)),
        }
    }
}

struct SyncCandidate {
    snapshot: AppSnapshot,
    provider_key_replacements: BTreeMap<String, String>,
}

#[derive(Debug)]
struct SyncCommit {
    snapshot: AppSnapshot,
    provider_key_replacements: BTreeMap<String, String>,
    expected_snapshot: Option<AppSnapshot>,
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
        });
    }

    Ok(SyncCommit {
        snapshot: candidate.snapshot,
        provider_key_replacements: candidate.provider_key_replacements,
        expected_snapshot,
    })
}

impl SyncCandidate {
    fn without_secret_changes(snapshot: AppSnapshot) -> Self {
        Self {
            snapshot,
            provider_key_replacements: BTreeMap::new(),
        }
    }
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
        };

        let rejected = prepare_sync_commit(&source, Some(current.clone()), candidate)
            .expect_err("a stale result must not reach the snapshot or secret commit phase");

        assert_eq!(rejected, current);
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
        };

        let accepted = prepare_sync_commit(&source, Some(source.clone()), candidate)
            .expect("an unchanged local source should accept the remote result");

        assert_eq!(accepted.snapshot, synced);
        assert_eq!(accepted.expected_snapshot, Some(source));
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
            capabilities: vec!["chat".to_owned()],
            enabled: true,
            needs_api_key: true,
            custom: Some(true),
            created_at: 1,
            updated_at: 1,
        }
    }
}
