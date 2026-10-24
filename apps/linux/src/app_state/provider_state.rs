use super::{LinuxAppState, LinuxLocalStorageIssue, now_millis};
use crate::{
    defaults::CUSTOM_OPENAI_RELAY_CAPABILITIES,
    models::{AppSnapshot, Conversation, ProviderConfig, ProviderKind},
    providers::default_chat_model_for_provider,
    secret_store::{
        SyncSecretStore, replace_provider_keys_transactionally,
        rollback_provider_keys_after_failure, stage_provider_keys_transactionally,
    },
    storage::{SnapshotCompareAndSave, snapshot_fingerprint},
    sync::FirstSyncStrategy,
};
use std::collections::BTreeMap;
use uuid::Uuid;

impl LinuxAppState {
    pub(crate) fn providers(&self) -> Vec<ProviderConfig> {
        self.snapshot.borrow().providers.clone()
    }

    pub(crate) fn provider(&self, provider_id: &str) -> Option<ProviderConfig> {
        self.snapshot
            .borrow()
            .providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .cloned()
    }

    pub(crate) fn add_custom_provider(&self, name: &str) -> ProviderConfig {
        let now = now_millis();
        let provider = ProviderConfig {
            id: Uuid::new_v4().to_string(),
            name: name.to_owned(),
            kind: ProviderKind::OpenaiCompatible,
            base_url: "https://relay.example.com/v1".to_owned(),
            proxy_url: None,
            client_request_mode: false,
            model: String::new(),
            image_model: None,
            audio_speech_model: None,
            audio_transcription_model: None,
            embedding_model: None,
            moderation_model: None,
            realtime_model: None,
            models: vec![],
            model_metadata: std::collections::BTreeMap::new(),
            capabilities: CUSTOM_OPENAI_RELAY_CAPABILITIES
                .iter()
                .map(|capability| (*capability).to_owned())
                .collect(),
            enabled: true,
            needs_api_key: true,
            custom: Some(true),
            created_at: now,
            updated_at: now,
        };

        {
            let mut snapshot = self.snapshot.borrow_mut();
            snapshot.providers.insert(0, provider.clone());
            snapshot.updated_at = now;
        }
        self.save();

        provider
    }

    pub(crate) fn delete_provider(&self, provider_id: &str) -> anyhow::Result<bool> {
        let previous = self.snapshot.borrow().clone();
        if previous.providers.len() <= 1 {
            return Ok(false);
        }
        let Some(fallback_provider) =
            provider_fallback_for_deleted(&previous.providers, provider_id)
        else {
            return Ok(false);
        };
        let mut candidate = previous.clone();
        let previous_len = candidate.providers.len();
        candidate
            .providers
            .retain(|provider| provider.id != provider_id);
        if candidate.providers.len() == previous_len {
            return Ok(false);
        }

        let now = now_millis();
        move_conversations_to_provider(
            &mut candidate.conversations,
            provider_id,
            &fallback_provider,
            now,
        );
        candidate.updated_at = now;
        self.commit_provider_secret_snapshot(
            &previous,
            candidate,
            BTreeMap::from([(provider_id.to_owned(), String::new())]),
            true,
        )?;
        Ok(true)
    }

    pub(crate) fn update_active_conversation_provider(&self, provider_id: String, model: String) {
        {
            let mut snapshot = self.snapshot.borrow_mut();
            let now = now_millis();
            let active_id = snapshot
                .preferences
                .active_conversation_id
                .as_deref()
                .and_then(|id| {
                    snapshot
                        .conversations
                        .iter()
                        .any(|conversation| conversation.id == id)
                        .then(|| id.to_owned())
                })
                .or_else(|| {
                    snapshot
                        .conversations
                        .first()
                        .map(|conversation| conversation.id.clone())
                });

            if let Some(active_id) = active_id {
                if let Some(conversation) = snapshot
                    .conversations
                    .iter_mut()
                    .find(|conversation| conversation.id == active_id)
                {
                    conversation.provider_id = provider_id;
                    conversation.model = model;
                    conversation.updated_at = now;
                    snapshot.preferences.active_conversation_id = Some(active_id);
                    snapshot.updated_at = now;
                }
            } else {
                let conversation_id = format!("linux-conversation-{}", now);
                snapshot.conversations.insert(
                    0,
                    Conversation {
                        id: conversation_id.clone(),
                        title: String::new(),
                        provider_id,
                        model,
                        messages: vec![],
                        context_compaction: None,
                        created_at: now,
                        updated_at: now,
                    },
                );
                snapshot.preferences.active_conversation_id = Some(conversation_id);
                snapshot.updated_at = now;
            }
        }
        self.save();
    }

    pub(crate) fn update_provider_config(
        &self,
        provider_id: &str,
        mutate: impl FnOnce(&mut ProviderConfig),
    ) {
        {
            let mut snapshot = self.snapshot.borrow_mut();
            let mut updated_at = None;
            if let Some(provider) = snapshot
                .providers
                .iter_mut()
                .find(|provider| provider.id == provider_id)
            {
                mutate(provider);
                let now = now_millis();
                provider.updated_at = now;
                updated_at = Some(now);
            }

            if let Some(updated_at) = updated_at {
                snapshot.updated_at = updated_at;
            }
        }
        self.save();
    }

    pub(crate) fn set_provider_enabled(&self, provider_id: &str, enabled: bool) -> bool {
        let changed = {
            let mut snapshot = self.snapshot.borrow_mut();
            let Some(index) = snapshot
                .providers
                .iter()
                .position(|provider| provider.id == provider_id)
            else {
                return false;
            };

            if !enabled
                && snapshot.providers[index].enabled
                && snapshot
                    .providers
                    .iter()
                    .filter(|provider| provider.enabled)
                    .count()
                    <= 1
            {
                return false;
            }

            let fallback_provider = if !enabled && snapshot.providers[index].enabled {
                provider_fallback_for_disabled(&snapshot.providers, provider_id)
            } else {
                None
            };
            let now = now_millis();
            snapshot.providers[index].enabled = enabled;
            snapshot.providers[index].updated_at = now;

            if let Some(fallback_provider) = fallback_provider {
                move_conversations_to_provider(
                    &mut snapshot.conversations,
                    provider_id,
                    &fallback_provider,
                    now,
                );
            }

            snapshot.updated_at = now;
            true
        };

        if changed {
            self.save();
        }

        changed
    }

    pub(crate) fn has_provider_key(&self, provider_id: &str) -> bool {
        self.secrets
            .provider_key(provider_id)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    }

    pub(crate) fn provider_key(&self, provider_id: &str) -> String {
        self.secrets.provider_key(provider_id).unwrap_or_default()
    }

    pub(crate) fn save_provider_key(&self, provider_id: &str, value: &str) -> anyhow::Result<()> {
        let previous = self.snapshot.borrow().clone();
        let mut candidate = previous.clone();
        let now = now_millis();
        let provider = candidate
            .providers
            .iter_mut()
            .find(|provider| provider.id == provider_id)
            .ok_or_else(|| anyhow::anyhow!("Provider no longer exists."))?;
        provider.updated_at = now;
        candidate.updated_at = now;
        self.commit_provider_secret_snapshot(
            &previous,
            candidate,
            BTreeMap::from([(provider_id.to_owned(), value.trim().to_owned())]),
            false,
        )
    }

    fn commit_provider_secret_snapshot(
        &self,
        previous: &AppSnapshot,
        candidate: AppSnapshot,
        replacements: BTreeMap<String, String>,
        require_durable_secret: bool,
    ) -> anyhow::Result<()> {
        if let Some(message) = self.local_storage_blocker_message() {
            anyhow::bail!(message);
        }
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
        let current = store.load_during_local_data_commit(&guard)?;
        if snapshot_fingerprint(current.as_ref())? != snapshot_fingerprint(Some(previous))? {
            anyhow::bail!("Local data changed before the Provider secret transaction started.");
        }
        let transaction = if require_durable_secret {
            replace_provider_keys_transactionally(self.secrets.as_ref(), &replacements)?
        } else {
            stage_provider_keys_transactionally(self.secrets.as_ref(), &replacements)?
        };
        match store.save_if_unchanged_during_local_data_commit(&guard, Some(previous), &candidate) {
            Ok(SnapshotCompareAndSave::Saved) => {}
            Ok(SnapshotCompareAndSave::Changed(_)) => {
                return Err(rollback_provider_keys_after_failure(
                    anyhow::anyhow!("Local data changed while the Provider secret was committed."),
                    &transaction,
                ));
            }
            Err(error) => {
                self.report_local_storage_issue(LinuxLocalStorageIssue::SnapshotSaveFailed);
                return Err(rollback_provider_keys_after_failure(error, &transaction));
            }
        }

        *self.snapshot.borrow_mut() = candidate.clone();
        *self.committed_snapshot.borrow_mut() = candidate.clone();
        self.enqueue_auto_sync_snapshot(candidate, FirstSyncStrategy::Ask);
        Ok(())
    }
}

fn provider_fallback_for_deleted(
    providers: &[ProviderConfig],
    provider_id: &str,
) -> Option<ProviderConfig> {
    providers
        .iter()
        .find(|provider| provider.id != provider_id && provider.enabled)
        .or_else(|| providers.iter().find(|provider| provider.id != provider_id))
        .cloned()
}

fn provider_fallback_for_disabled(
    providers: &[ProviderConfig],
    provider_id: &str,
) -> Option<ProviderConfig> {
    providers
        .iter()
        .find(|provider| provider.id != provider_id && provider.enabled)
        .cloned()
}

fn fallback_chat_model(provider: &ProviderConfig) -> String {
    default_chat_model_for_provider(provider)
}

fn move_conversations_to_provider(
    conversations: &mut [Conversation],
    provider_id: &str,
    fallback_provider: &ProviderConfig,
    now: i64,
) {
    let fallback_model = fallback_chat_model(fallback_provider);
    for conversation in conversations {
        if conversation.provider_id == provider_id {
            conversation.provider_id = fallback_provider.id.clone();
            conversation.model = fallback_model.clone();
            conversation.updated_at = now;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AppSnapshot, Preferences, SkillSettings, SyncConfig};

    fn provider(id: &str, enabled: bool, model: &str, models: &[&str]) -> ProviderConfig {
        ProviderConfig {
            id: id.to_owned(),
            name: id.to_owned(),
            kind: ProviderKind::OpenaiCompatible,
            base_url: "https://relay.example.com/v1".to_owned(),
            proxy_url: None,
            client_request_mode: false,
            model: model.to_owned(),
            image_model: None,
            audio_speech_model: None,
            audio_transcription_model: None,
            embedding_model: None,
            moderation_model: None,
            realtime_model: None,
            models: models.iter().map(|model| (*model).to_owned()).collect(),
            model_metadata: std::collections::BTreeMap::new(),
            capabilities: vec!["chat".to_owned()],
            enabled,
            needs_api_key: true,
            custom: Some(true),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn conversation(provider_id: &str, model: &str) -> Conversation {
        Conversation {
            id: format!("conversation-{provider_id}"),
            title: String::new(),
            provider_id: provider_id.to_owned(),
            model: model.to_owned(),
            messages: vec![],
            context_compaction: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    fn snapshot(providers: Vec<ProviderConfig>, conversations: Vec<Conversation>) -> AppSnapshot {
        AppSnapshot {
            version: 1,
            providers,
            conversations,
            skills: vec![],
            skill_settings: SkillSettings {
                auto_match: true,
                context_budget: 2400,
                max_auto_skills: 3,
            },
            sync: SyncConfig {
                mode: "local".to_owned(),
                auto_sync: false,
                encryption_enabled: true,
                gist_id: None,
                gist_file: None,
                worker_endpoint: None,
                last_sync_at: None,
                last_sync_status: None,
            },
            preferences: Preferences {
                first_run_done: true,
                theme: "system".to_owned(),
                language: "system".to_owned(),
                compact_mode: false,
                chat_context_message_limit: 24,
                active_conversation_id: None,
                dismissed_danger_warnings: None,
                dismissed_feature_hints: None,
            },
            updated_at: 1,
        }
    }

    #[test]
    fn fallback_chat_model_prefers_strongest_configured_chat_model() {
        let fallback = provider(
            "fallback",
            true,
            "",
            &["", "gpt-image-2", "gpt-5.4-mini", "gpt-5.5"],
        );

        assert_eq!(fallback_chat_model(&fallback), "gpt-5.5");
    }

    #[test]
    fn fallback_chat_model_preserves_valid_provider_default() {
        let fallback = provider(
            "fallback",
            true,
            "gpt-5.4-mini",
            &["gpt-image-2", "gpt-5.4-mini", "gpt-5.5"],
        );

        assert_eq!(fallback_chat_model(&fallback), "gpt-5.4-mini");
    }

    #[test]
    fn fallback_chat_model_rejects_image_only_models() {
        let fallback = provider("fallback", true, "gpt-image-2", &["", "gpt-image-2"]);

        assert_eq!(fallback_chat_model(&fallback), "");
    }

    #[test]
    fn deleted_provider_repair_prefers_enabled_fallback_model_list() {
        let mut snapshot = snapshot(
            vec![
                provider("removed", true, "removed-model", &["removed-model"]),
                provider("disabled", false, "disabled-model", &["disabled-model"]),
                provider(
                    "fallback",
                    true,
                    "",
                    &["gpt-image-2", "gpt-5.4-mini", "gpt-5.5"],
                ),
            ],
            vec![
                conversation("removed", "removed-model"),
                conversation("fallback", "gpt-5.4-mini"),
            ],
        );
        let fallback = provider_fallback_for_deleted(&snapshot.providers, "removed")
            .expect("enabled fallback should be selected");

        move_conversations_to_provider(&mut snapshot.conversations, "removed", &fallback, 99);

        assert_eq!(snapshot.conversations[0].provider_id, "fallback");
        assert_eq!(snapshot.conversations[0].model, "gpt-5.5");
        assert_eq!(snapshot.conversations[0].updated_at, 99);
        assert_eq!(snapshot.conversations[1].provider_id, "fallback");
    }

    #[test]
    fn disabled_provider_repair_uses_enabled_fallback_only() {
        let providers = vec![
            provider("disabled-target", true, "old-model", &["old-model"]),
            provider("disabled-fallback", false, "wrong-model", &["wrong-model"]),
            provider(
                "enabled-fallback",
                true,
                "",
                &["gpt-image-2", "gpt-5.4-mini", "gpt-5.5"],
            ),
        ];
        let fallback = provider_fallback_for_disabled(&providers, "disabled-target")
            .expect("enabled fallback should be selected");
        let mut conversations = vec![conversation("disabled-target", "old-model")];

        move_conversations_to_provider(&mut conversations, "disabled-target", &fallback, 42);

        assert_eq!(fallback.id, "enabled-fallback");
        assert_eq!(conversations[0].provider_id, "enabled-fallback");
        assert_eq!(conversations[0].model, "gpt-5.5");
        assert_eq!(conversations[0].updated_at, 42);
    }
}
