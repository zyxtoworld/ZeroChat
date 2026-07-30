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
    conversations::{ensure_active_conversation, title_from_message},
    i18n::tr,
    media::upload_to_attachment,
    models::{ChatMessage, MessageAttachment, MessageRole, ProviderKind},
    providers::{
        image_editing_model_for_provider, image_model_for_provider, model_for_provider_audio_speech,
    },
    skills::skill_context_for_prompt,
};
use uuid::Uuid;

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

    pub(crate) fn prepare_message_speech_request(
        &self,
        message_id: &str,
        locale: &str,
    ) -> Result<AiSpeechRequest, String> {
        let (provider, request_provider, model, input) = {
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

            let provider = snapshot
                .providers
                .iter()
                .find(|provider| provider.id == conversation.provider_id && provider.enabled)
                .or_else(|| snapshot.providers.iter().find(|provider| provider.enabled))
                .cloned()
                .ok_or_else(|| tr(locale, "message.noEnabledProvider").to_owned())?;
            if !provider.enabled {
                return Err(tr(locale, "message.noEnabledProvider").to_owned());
            }

            let request_provider = provider_request(&provider, &snapshot.sync);
            if provider_needs_client_key(&request_provider) && !self.has_provider_key(&provider.id)
            {
                return Err(tr(locale, "error.providerKeyRequired").to_owned());
            }

            let model = model_for_provider_audio_speech(&provider);
            if model.trim().is_empty() {
                return Err(tr(locale, "message.audioSpeechModelRequired").to_owned());
            }

            (provider, request_provider, model, input)
        };

        let access_key =
            provider_proxy_access_key(&request_provider, || self.cloudflare_access_key());
        Ok(AiSpeechRequest {
            provider: request_provider,
            api_key: self.provider_key(&provider.id),
            access_key,
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
        let (user_message, assistant_message, provider, request_provider, model, messages) = {
            let mut snapshot = self.snapshot.borrow_mut();
            let now = now_millis();
            let conversation_id = ensure_active_conversation(&mut snapshot, &content, now);
            let Some(conversation_index) = snapshot
                .conversations
                .iter()
                .position(|conversation| conversation.id == conversation_id)
            else {
                return Err(tr(locale, "message.noEnabledProvider").to_owned());
            };

            let provider_id = snapshot.conversations[conversation_index]
                .provider_id
                .clone();
            let provider = snapshot
                .providers
                .iter()
                .find(|provider| provider.id == provider_id && provider.enabled)
                .or_else(|| snapshot.providers.iter().find(|provider| provider.enabled))
                .or_else(|| snapshot.providers.first())
                .cloned()
                .ok_or_else(|| tr(locale, "message.noEnabledProvider").to_owned())?;

            if !provider.enabled {
                return Err(tr(locale, "message.noEnabledProvider").to_owned());
            }

            let request_provider = provider_request(&provider, &snapshot.sync);
            if provider_needs_client_key(&request_provider) && !self.has_provider_key(&provider.id)
            {
                return Err(tr(locale, "error.providerKeyRequired").to_owned());
            }

            let model = snapshot.conversations[conversation_index]
                .model
                .trim()
                .to_owned();
            let model = if model.is_empty() {
                provider.model.trim().to_owned()
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
            if conversation.provider_id != provider.id {
                conversation.provider_id = provider.id.clone();
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

            (
                user_message,
                assistant_message,
                provider,
                request_provider,
                model,
                messages,
            )
        };

        let provider_id = provider.id.clone();
        let access_key =
            provider_proxy_access_key(&request_provider, || self.cloudflare_access_key());
        let request = AiChatRequest {
            provider: request_provider,
            api_key: self.provider_key(&provider_id),
            access_key,
            model,
            messages,
            context_message_limit: self
                .snapshot
                .borrow()
                .preferences
                .chat_context_message_limit,
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

        let (user_message, assistant_message, provider, request_provider, model, responses_model) = {
            let mut snapshot = self.snapshot.borrow_mut();
            let now = now_millis();
            let conversation_id = ensure_active_conversation(&mut snapshot, &trimmed_prompt, now);
            let Some(conversation_index) = snapshot
                .conversations
                .iter()
                .position(|conversation| conversation.id == conversation_id)
            else {
                return Err(tr(locale, "message.noEnabledProvider").to_owned());
            };

            let provider_id = snapshot.conversations[conversation_index]
                .provider_id
                .clone();
            let provider = snapshot
                .providers
                .iter()
                .find(|provider| provider.id == provider_id && provider.enabled)
                .or_else(|| snapshot.providers.iter().find(|provider| provider.enabled))
                .or_else(|| snapshot.providers.first())
                .cloned()
                .ok_or_else(|| tr(locale, "message.noEnabledProvider").to_owned())?;

            if !provider.enabled || matches!(provider.kind, ProviderKind::Anthropic) {
                return Err(tr(locale, "message.imageProviderRequired").to_owned());
            }

            let request_provider = provider_request(&provider, &snapshot.sync);
            if provider_needs_client_key(&request_provider) && !self.has_provider_key(&provider.id)
            {
                return Err(tr(locale, "error.providerKeyRequired").to_owned());
            }

            let conversation_model = snapshot.conversations[conversation_index].model.clone();
            let model = if matches!(task_mode, ImageTaskMode::Generate) {
                image_model_for_provider(&provider, &conversation_model)
            } else {
                image_editing_model_for_provider(&provider, &conversation_model)
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
            if conversation.provider_id != provider.id {
                conversation.provider_id = provider.id.clone();
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

            (
                user_message,
                assistant_message,
                provider,
                request_provider,
                model,
                conversation_model,
            )
        };

        let provider_id = provider.id.clone();
        let access_key =
            provider_proxy_access_key(&request_provider, || self.cloudflare_access_key());
        let request = AiImageRequest {
            provider: request_provider,
            api_key: self.provider_key(&provider_id),
            access_key,
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
