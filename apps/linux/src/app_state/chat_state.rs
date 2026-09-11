use super::{
    ImageTaskMode, LinuxAppState,
    chat_message_state::{
        complete_message, complete_stopped_message, delete_message_from_active,
        edit_and_resend_user_in_active, regenerate_assistant_in_active, update_streaming_message,
    },
    now_millis,
};
use crate::{
    ai::ImageUpload,
    ai_protocol::{provider_needs_client_key, provider_proxy_access_key, provider_request},
    background::{AiChatRequest, AiImageRequest, AiImageRequestKind, AiSpeechRequest},
    conversations::{
        ensure_active_conversation, ensure_active_conversation_for_provider, title_from_message,
    },
    i18n::tr,
    media::upload_to_attachment,
    models::{
        AppSnapshot, ChatMessage, MessageAttachment, MessageRole, ProviderConfig, ProviderKind,
    },
    providers::{
        image_editing_model_for_provider, image_model_for_provider, model_for_provider_audio_speech,
    },
    secret_store::SyncSecretStore,
    skills::skill_context_for_prompt,
};
use uuid::Uuid;

struct ProviderRequestBinding {
    provider: ProviderConfig,
    request_provider: ProviderConfig,
    api_key: String,
    access_key: String,
}

fn provider_request_binding_from_snapshot(
    snapshot: &AppSnapshot,
    preferred_provider_id: Option<&str>,
    locale: &str,
    provider_key: impl FnOnce(&str) -> anyhow::Result<String>,
    cloudflare_access_key: impl FnOnce() -> String,
) -> Result<ProviderRequestBinding, String> {
    let provider = match preferred_provider_id {
        Some(provider_id) => snapshot
            .providers
            .iter()
            .find(|provider| provider.id == provider_id && provider.enabled),
        None => snapshot.providers.iter().find(|provider| provider.enabled),
    }
    .cloned()
    .ok_or_else(|| tr(locale, "message.noEnabledProvider").to_owned())?;
    let request_provider = provider_request(&provider, &snapshot.sync);
    let api_key = provider_key(&provider.id)
        .map_err(|_| tr(locale, "error.providerKeyRequired").to_owned())?;
    if provider_needs_client_key(&request_provider) && api_key.trim().is_empty() {
        return Err(tr(locale, "error.providerKeyRequired").to_owned());
    }
    let access_key = provider_proxy_access_key(&request_provider, cloudflare_access_key);
    Ok(ProviderRequestBinding {
        provider,
        request_provider,
        api_key,
        access_key,
    })
}

impl LinuxAppState {
    pub(crate) fn delete_message(&self, message_id: &str) -> bool {
        let deleted = {
            let mut snapshot = self.snapshot.borrow_mut();
            delete_message_from_active(&mut snapshot, message_id, now_millis())
        };

        if deleted {
            if self.speaking_message_id().as_deref() == Some(message_id) {
                self.stop_speaking_message();
            }
            self.save();
        }

        deleted
    }

    pub(crate) fn regenerate_assistant_message(
        &self,
        message_id: &str,
        assistant_content: String,
    ) -> Option<ChatMessage> {
        let result = {
            let mut snapshot = self.snapshot.borrow_mut();
            regenerate_assistant_in_active(
                &mut snapshot,
                message_id,
                assistant_content,
                now_millis(),
            )
        };

        if result.is_some() {
            self.save();
        }

        result
    }

    pub(crate) fn edit_and_resend_message(
        &self,
        message_id: &str,
        content: String,
        assistant_content: String,
    ) -> Option<(ChatMessage, ChatMessage)> {
        let result = {
            let mut snapshot = self.snapshot.borrow_mut();
            edit_and_resend_user_in_active(
                &mut snapshot,
                message_id,
                content,
                assistant_content,
                format!("linux-message-{}-assistant", Uuid::new_v4()),
                now_millis(),
            )
        };

        if result.is_some() {
            self.save();
        }

        result
    }

    fn provider_request_binding(
        &self,
        preferred_provider_id: Option<&str>,
        locale: &str,
    ) -> Result<ProviderRequestBinding, String> {
        if self.local_persistence_blocked() {
            return Err(tr(locale, "message.localSnapshotLoadFailed").to_owned());
        }
        let bind = |snapshot: &AppSnapshot| {
            provider_request_binding_from_snapshot(
                snapshot,
                preferred_provider_id,
                locale,
                |provider_id| self.secrets.provider_key(provider_id),
                || self.secrets.cloudflare_access_key().unwrap_or_default(),
            )
        };

        if let Some(store) = &self.store {
            let guard = store.lock_local_data_commit();
            if store
                .load_local_data_transition_during_local_data_commit(&guard)
                .map_err(|_| tr(locale, "message.localSnapshotLoadFailed").to_owned())?
                .is_some()
            {
                return Err(tr(locale, "message.localSnapshotLoadFailed").to_owned());
            }
            let snapshot = store
                .load_during_local_data_commit(&guard)
                .map_err(|_| tr(locale, "message.localSnapshotLoadFailed").to_owned())?
                .ok_or_else(|| tr(locale, "message.localSnapshotLoadFailed").to_owned())?;
            return bind(&snapshot);
        }

        if self.auto_sync.is_none() {
            return bind(&self.snapshot.borrow());
        }
        Err(tr(locale, "message.localSnapshotLoadFailed").to_owned())
    }

    pub(crate) fn prepare_message_speech(
        &self,
        message_id: &str,
        locale: &str,
    ) -> Result<AiSpeechRequest, String> {
        let (preferred_provider_id, input) = {
            let snapshot = self.snapshot.borrow();
            let conversation = snapshot
                .preferences
                .active_conversation_id
                .as_deref()
                .and_then(|id| {
                    snapshot
                        .conversations
                        .iter()
                        .find(|conversation| conversation.id == id)
                })
                .or_else(|| snapshot.conversations.first())
                .ok_or_else(|| tr(locale, "message.noEnabledProvider").to_owned())?;
            let message = conversation
                .messages
                .iter()
                .find(|message| message.id == message_id)
                .ok_or_else(|| tr(locale, "notice.audioSpeechEmpty").to_owned())?;

            if !matches!(message.role, MessageRole::Assistant) {
                return Err(tr(locale, "notice.audioSpeechEmpty").to_owned());
            }
            if matches!(
                message.status.as_deref(),
                Some("streaming") | Some("pending")
            ) {
                return Err(tr(locale, "message.generating").to_owned());
            }

            let input = message.content.trim().to_owned();
            if input.is_empty() {
                return Err(tr(locale, "notice.audioSpeechEmpty").to_owned());
            }
            (Some(conversation.provider_id.clone()), input)
        };
        let binding = self.provider_request_binding(preferred_provider_id.as_deref(), locale)?;
        if !binding.provider.enabled {
            return Err(tr(locale, "message.noEnabledProvider").to_owned());
        }
        let model = model_for_provider_audio_speech(&binding.provider);
        if model.trim().is_empty() {
            return Err(tr(locale, "message.audioSpeechModelRequired").to_owned());
        }

        Ok(AiSpeechRequest {
            provider: binding.request_provider,
            api_key: binding.api_key,
            access_key: binding.access_key,
            model,
            input,
        })
    }

    pub(crate) fn append_local_chat_turn(
        &self,
        content: String,
        assistant_content: String,
    ) -> (ChatMessage, ChatMessage) {
        let user_message = {
            let mut snapshot = self.snapshot.borrow_mut();
            let now = now_millis();
            let conversation_id = ensure_active_conversation(&mut snapshot, &content, now);
            let user_message = ChatMessage {
                id: format!("linux-message-{}-user", now),
                role: MessageRole::User,
                content,
                created_at: now,
                status: Some("done".to_owned()),
                error: None,
                attachments: vec![],
                queued_text_request: None,
                offline_replay_claim: None,
            };
            let assistant_message = ChatMessage {
                id: format!("linux-message-{}-assistant", now),
                role: MessageRole::Assistant,
                content: assistant_content,
                created_at: now + 1,
                status: Some("done".to_owned()),
                error: None,
                attachments: vec![],
                queued_text_request: None,
                offline_replay_claim: None,
            };
            if let Some(conversation) = snapshot
                .conversations
                .iter_mut()
                .find(|conversation| conversation.id == conversation_id)
            {
                conversation.messages.push(user_message.clone());
                conversation.messages.push(assistant_message.clone());
                conversation.updated_at = now;
            }

            snapshot.updated_at = now;
            (user_message, assistant_message)
        };
        self.save();
        user_message
    }

    pub(crate) fn append_pending_chat_turn(
        &self,
        content: String,
        locale: &str,
    ) -> Result<(ChatMessage, ChatMessage, AiChatRequest), String> {
        let preferred_provider_id = {
            let snapshot = self.snapshot.borrow();
            snapshot
                .preferences
                .active_conversation_id
                .as_deref()
                .and_then(|id| {
                    snapshot
                        .conversations
                        .iter()
                        .find(|conversation| conversation.id == id)
                })
                .or_else(|| snapshot.conversations.first())
                .map(|conversation| conversation.provider_id.clone())
        };
        let binding = self.provider_request_binding(preferred_provider_id.as_deref(), locale)?;
        if !binding.provider.enabled {
            return Err(tr(locale, "message.noEnabledProvider").to_owned());
        }

        let (user_message, assistant_message, model, messages, context_message_limit) = {
            let mut snapshot = self.snapshot.borrow_mut();
            let now = now_millis();
            let conversation_id = ensure_active_conversation_for_provider(
                &mut snapshot,
                &content,
                now,
                &binding.provider,
            );
            let Some(conversation_index) = snapshot
                .conversations
                .iter()
                .position(|conversation| conversation.id == conversation_id)
            else {
                return Err(tr(locale, "message.noEnabledProvider").to_owned());
            };

            let model = snapshot.conversations[conversation_index]
                .model
                .trim()
                .to_owned();
            let model = if model.is_empty() {
                binding.provider.model.trim().to_owned()
            } else {
                model
            };
            if model.is_empty() {
                return Err(tr(locale, "message.modelRequired").to_owned());
            }

            let user_message = ChatMessage {
                id: format!("linux-message-{}-user", now),
                role: MessageRole::User,
                content,
                created_at: now,
                status: Some("done".to_owned()),
                error: None,
                attachments: vec![],
                queued_text_request: None,
                offline_replay_claim: None,
            };
            let assistant_message = ChatMessage {
                id: format!("linux-message-{}-assistant", now),
                role: MessageRole::Assistant,
                content: String::new(),
                created_at: now + 1,
                status: Some("streaming".to_owned()),
                error: None,
                attachments: vec![],
                queued_text_request: None,
                offline_replay_claim: None,
            };

            let mut messages = snapshot.conversations[conversation_index]
                .messages
                .iter()
                .filter(|message| {
                    message.status.as_deref() != Some("pending")
                        && message.status.as_deref() != Some("streaming")
                        && message.error.is_none()
                        && !message.content.trim().is_empty()
                })
                .cloned()
                .collect::<Vec<_>>();
            messages.push(user_message.clone());
            if let Some(skill_context) =
                skill_context_for_prompt(&snapshot, &user_message.content, locale)
            {
                messages.insert(
                    0,
                    ChatMessage {
                        id: format!("linux-message-{}-skills", now),
                        role: MessageRole::System,
                        content: skill_context,
                        created_at: now,
                        status: Some("done".to_owned()),
                        error: None,
                        attachments: vec![],
                        queued_text_request: None,
                        offline_replay_claim: None,
                    },
                );
            }

            let conversation = &mut snapshot.conversations[conversation_index];
            if conversation.provider_id != binding.provider.id {
                conversation.provider_id = binding.provider.id.clone();
            }
            if conversation.model.trim().is_empty() {
                conversation.model = model.clone();
            }
            if conversation.messages.is_empty() {
                conversation.title = title_from_message(&user_message.content);
            }
            conversation.messages.push(user_message.clone());
            conversation.messages.push(assistant_message.clone());
            conversation.updated_at = now;
            snapshot.updated_at = now;
            let context_message_limit = snapshot.preferences.chat_context_message_limit;

            (
                user_message,
                assistant_message,
                model,
                messages,
                context_message_limit,
            )
        };

        let request = AiChatRequest {
            provider: binding.request_provider,
            api_key: binding.api_key,
            access_key: binding.access_key,
            model,
            messages,
            context_message_limit,
        };
        self.save_local_only();

        Ok((user_message, assistant_message, request))
    }

    pub(crate) fn append_pending_image_turn(
        &self,
        prompt: String,
        task_mode: ImageTaskMode,
        source: Option<ImageUpload>,
        mask: Option<ImageUpload>,
        locale: &str,
    ) -> Result<(ChatMessage, ChatMessage, AiImageRequest), String> {
        let trimmed_prompt = prompt.trim().to_owned();
        if trimmed_prompt.is_empty() {
            return Err(tr(locale, "message.imagePromptRequired").to_owned());
        }

        if matches!(task_mode, ImageTaskMode::Edit | ImageTaskMode::Inpaint) && source.is_none() {
            return Err(tr(locale, "message.sourceImageRequired").to_owned());
        }

        if matches!(task_mode, ImageTaskMode::Inpaint) && mask.is_none() {
            return Err(tr(locale, "message.maskImageRequired").to_owned());
        }
        let request_kind = match task_mode {
            ImageTaskMode::Generate => AiImageRequestKind::Generate,
            ImageTaskMode::Edit => AiImageRequestKind::Edit {
                source: source
                    .clone()
                    .ok_or_else(|| tr(locale, "message.sourceImageRequired").to_owned())?,
            },
            ImageTaskMode::Inpaint => AiImageRequestKind::Inpaint {
                source: source
                    .clone()
                    .ok_or_else(|| tr(locale, "message.sourceImageRequired").to_owned())?,
                mask: mask
                    .clone()
                    .ok_or_else(|| tr(locale, "message.maskImageRequired").to_owned())?,
            },
        };

        let preferred_provider_id = {
            let snapshot = self.snapshot.borrow();
            snapshot
                .preferences
                .active_conversation_id
                .as_deref()
                .and_then(|id| {
                    snapshot
                        .conversations
                        .iter()
                        .find(|conversation| conversation.id == id)
                })
                .or_else(|| snapshot.conversations.first())
                .map(|conversation| conversation.provider_id.clone())
        };
        let binding = self.provider_request_binding(preferred_provider_id.as_deref(), locale)?;
        if !binding.provider.enabled || matches!(binding.provider.kind, ProviderKind::Anthropic) {
            return Err(tr(locale, "message.imageProviderRequired").to_owned());
        }

        let (user_message, assistant_message, model, responses_model) = {
            let mut snapshot = self.snapshot.borrow_mut();
            let now = now_millis();
            let conversation_id = ensure_active_conversation_for_provider(
                &mut snapshot,
                &trimmed_prompt,
                now,
                &binding.provider,
            );
            let Some(conversation_index) = snapshot
                .conversations
                .iter()
                .position(|conversation| conversation.id == conversation_id)
            else {
                return Err(tr(locale, "message.noEnabledProvider").to_owned());
            };

            let conversation_model = snapshot.conversations[conversation_index].model.clone();
            let model = if matches!(task_mode, ImageTaskMode::Generate) {
                image_model_for_provider(&binding.provider, &conversation_model)
            } else {
                image_editing_model_for_provider(&binding.provider, &conversation_model)
            };
            if model.trim().is_empty() {
                return Err(tr(locale, "message.imageModelRequired").to_owned());
            }

            let source_attachment = source.as_ref().map(|upload| {
                upload_to_attachment(upload, "source", tr(locale, "placeholder.sourceImage"), now)
            });
            let mask_attachment = mask.as_ref().map(|upload| {
                upload_to_attachment(upload, "mask", tr(locale, "placeholder.maskImage"), now)
            });
            let user_attachments = [source_attachment, mask_attachment]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>();

            let user_message = ChatMessage {
                id: format!("linux-message-{}-image-user", Uuid::new_v4()),
                role: MessageRole::User,
                content: trimmed_prompt.clone(),
                created_at: now,
                status: Some("done".to_owned()),
                error: None,
                attachments: user_attachments,
                queued_text_request: None,
                offline_replay_claim: None,
            };
            let assistant_message = ChatMessage {
                id: format!("linux-message-{}-image-assistant", Uuid::new_v4()),
                role: MessageRole::Assistant,
                content: tr(locale, "message.generatingImage").to_owned(),
                created_at: now + 1,
                status: Some("pending".to_owned()),
                error: None,
                attachments: vec![],
                queued_text_request: None,
                offline_replay_claim: None,
            };

            let conversation = &mut snapshot.conversations[conversation_index];
            if conversation.provider_id != binding.provider.id {
                conversation.provider_id = binding.provider.id.clone();
            }
            if conversation.messages.is_empty() {
                conversation.title = format!(
                    "{}: {}",
                    tr(locale, "title.imageConversationPrefix"),
                    title_from_message(&trimmed_prompt)
                );
            }
            conversation.messages.push(user_message.clone());
            conversation.messages.push(assistant_message.clone());
            conversation.updated_at = now;
            snapshot.updated_at = now;

            (user_message, assistant_message, model, conversation_model)
        };

        let request = AiImageRequest {
            provider: binding.request_provider,
            api_key: binding.api_key,
            access_key: binding.access_key,
            model,
            responses_model,
            prompt: trimmed_prompt,
            kind: request_kind,
        };
        self.save();

        Ok((user_message, assistant_message, request))
    }

    pub(crate) fn update_streaming_assistant_message(
        &self,
        message_id: &str,
        content: String,
    ) -> bool {
        let updated = {
            let mut snapshot = self.snapshot.borrow_mut();
            update_streaming_message(&mut snapshot, message_id, content, now_millis())
        };

        if updated {
            self.save_local_only();
        }

        updated
    }

    pub(crate) fn assistant_message_content(&self, message_id: &str) -> Option<String> {
        self.snapshot
            .borrow()
            .conversations
            .iter()
            .flat_map(|conversation| conversation.messages.iter())
            .find(|message| message.id == message_id)
            .map(|message| message.content.clone())
    }

    pub(crate) fn complete_assistant_message(
        &self,
        message_id: &str,
        content: String,
        error: Option<String>,
    ) -> bool {
        let updated = {
            let mut snapshot = self.snapshot.borrow_mut();
            complete_message(
                &mut snapshot,
                message_id,
                content,
                error,
                None,
                now_millis(),
            )
        };

        if updated {
            self.save();
        }

        updated
    }

    pub(crate) fn stop_streaming_assistant_message(
        &self,
        message_id: &str,
        visible_content: &str,
        generating_content: &str,
        stopped_content: &str,
    ) -> Option<String> {
        let content = {
            let mut snapshot = self.snapshot.borrow_mut();
            complete_stopped_message(
                &mut snapshot,
                message_id,
                visible_content,
                generating_content,
                stopped_content,
                now_millis(),
            )
        };

        if content.is_some() {
            self.save();
        }

        content
    }

    pub(crate) fn complete_assistant_image_message(
        &self,
        message_id: &str,
        content: String,
        attachment: Option<MessageAttachment>,
        error: Option<String>,
    ) -> bool {
        let updated = {
            let mut snapshot = self.snapshot.borrow_mut();
            complete_message(
                &mut snapshot,
                message_id,
                content,
                error,
                Some(attachment.into_iter().collect()),
                now_millis(),
            )
        };

        if updated {
            self.save();
        }

        updated
    }
}

#[cfg(test)]
mod tests {
    use super::provider_request_binding_from_snapshot;
    use crate::{
        defaults::default_snapshot, secret_store::derive_cloudflare_access_key,
        storage::SnapshotStore,
    };
    use std::{
        fs,
        sync::{Arc, Barrier, Mutex, MutexGuard},
        thread,
    };
    use uuid::Uuid;

    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn provider_request_binding_keeps_endpoint_key_and_access_on_one_guard_generation() {
        let directory = std::env::temp_dir().join(format!(
            "zerochat-provider-request-binding-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).unwrap();
        let store = Arc::new(SnapshotStore::for_test_file(
            directory.join("snapshot.v1.json"),
        ));
        let provider_key = Arc::new(Mutex::new("source-provider-key".to_owned()));
        let passphrase = Arc::new(Mutex::new("source-passphrase".to_owned()));
        let mut source = default_snapshot();
        source.sync.mode = "cloudflare".to_owned();
        source.sync.auto_sync = true;
        source.sync.worker_endpoint = Some("https://source-worker.example".to_owned());
        source.providers[0].base_url = "https://source-provider.example/v1".to_owned();
        source.updated_at = 10;
        let provider_id = source.providers[0].id.clone();
        let mut target = source.clone();
        target.sync.worker_endpoint = Some("https://target-worker.example".to_owned());
        target.providers[0].base_url = "https://target-provider.example/v1".to_owned();
        target.updated_at = 20;
        store.save(&source).unwrap();

        let guard = store.lock_local_data_commit();
        let committed = store
            .load_during_local_data_commit(&guard)
            .unwrap()
            .unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let writer_store = store.clone();
        let writer_key = provider_key.clone();
        let writer_passphrase = passphrase.clone();
        let writer_barrier = barrier.clone();
        let writer = thread::spawn(move || {
            writer_barrier.wait();
            let writer_guard = writer_store.lock_local_data_commit();
            *lock(&writer_key) = "target-provider-key".to_owned();
            *lock(&writer_passphrase) = "target-passphrase".to_owned();
            writer_store
                .save_during_local_data_commit(&writer_guard, &target)
                .unwrap();
        });
        barrier.wait();

        let binding = provider_request_binding_from_snapshot(
            &committed,
            Some(&provider_id),
            "en",
            |_| Ok(lock(&provider_key).clone()),
            || derive_cloudflare_access_key(&lock(&passphrase)),
        )
        .unwrap();

        assert_eq!(
            binding.provider.base_url,
            "https://source-provider.example/v1"
        );
        assert_eq!(
            binding.request_provider.proxy_url.as_deref(),
            Some("https://source-worker.example")
        );
        assert_eq!(binding.api_key, "source-provider-key");
        assert_eq!(
            binding.access_key,
            derive_cloudflare_access_key("source-passphrase")
        );
        drop(guard);
        writer.join().unwrap();

        let updated = store.load().unwrap().unwrap();
        assert_eq!(updated.updated_at, 20);
        assert_eq!(*lock(&provider_key), "target-provider-key");
        assert_eq!(*lock(&passphrase), "target-passphrase");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn missing_preferred_provider_never_falls_back_to_another_enabled_provider() {
        let snapshot = default_snapshot();

        let result = provider_request_binding_from_snapshot(
            &snapshot,
            Some("missing-provider"),
            "en",
            |_| Ok("unexpected-key".to_owned()),
            || "unexpected-access".to_owned(),
        );

        assert!(result.is_err());
    }

    #[test]
    fn disabled_preferred_provider_never_falls_back_to_another_enabled_provider() {
        let mut snapshot = default_snapshot();
        let preferred_provider_id = snapshot.providers[0].id.clone();
        snapshot.providers[0].enabled = false;
        assert!(
            snapshot
                .providers
                .iter()
                .skip(1)
                .any(|provider| provider.enabled)
        );

        let result = provider_request_binding_from_snapshot(
            &snapshot,
            Some(&preferred_provider_id),
            "en",
            |_| Ok("unexpected-key".to_owned()),
            || "unexpected-access".to_owned(),
        );

        assert!(result.is_err());
    }
}
