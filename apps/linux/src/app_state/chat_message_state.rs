use crate::{
    conversations::title_from_message,
    models::{
        AppSnapshot, ChatMessage, Conversation, MessageAttachment, MessageRole, Preferences,
        SkillSettings, SyncConfig,
    },
};

pub(crate) fn active_conversation_index(snapshot: &AppSnapshot) -> Option<usize> {
    snapshot
        .preferences
        .active_conversation_id
        .as_deref()
        .and_then(|id| {
            snapshot
                .conversations
                .iter()
                .position(|conversation| conversation.id == id)
        })
        .or_else(|| (!snapshot.conversations.is_empty()).then_some(0))
}

pub(crate) fn delete_message_from_active(
    snapshot: &mut AppSnapshot,
    message_id: &str,
    now: i64,
) -> bool {
    let Some(index) = active_conversation_index(snapshot) else {
        return false;
    };

    let conversation = &mut snapshot.conversations[index];
    let previous_len = conversation.messages.len();
    conversation
        .messages
        .retain(|message| message.id != message_id);
    if conversation.messages.len() == previous_len {
        false
    } else {
        conversation.updated_at = now;
        snapshot.updated_at = now;
        true
    }
}

pub(crate) fn regenerate_assistant_in_active(
    snapshot: &mut AppSnapshot,
    message_id: &str,
    assistant_content: String,
    now: i64,
) -> Option<ChatMessage> {
    let index = active_conversation_index(snapshot)?;
    let conversation = &mut snapshot.conversations[index];
    let message_index = conversation.messages.iter().position(|message| {
        message.id == message_id && matches!(&message.role, MessageRole::Assistant)
    })?;

    let has_prompt = conversation.messages[..message_index]
        .iter()
        .any(|message| matches!(&message.role, MessageRole::User));
    if !has_prompt {
        return None;
    }

    let assistant_message = &mut conversation.messages[message_index];
    assistant_message.content = assistant_content;
    assistant_message.created_at = now;
    assistant_message.status = Some("done".to_owned());
    assistant_message.error = None;
    assistant_message.attachments.clear();
    conversation.messages.truncate(message_index + 1);
    let assistant_message = conversation.messages[message_index].clone();
    conversation.updated_at = now;
    snapshot.updated_at = now;

    Some(assistant_message)
}

pub(crate) fn edit_and_resend_user_in_active(
    snapshot: &mut AppSnapshot,
    message_id: &str,
    content: String,
    assistant_content: String,
    assistant_id: String,
    now: i64,
) -> Option<(ChatMessage, ChatMessage)> {
    let index = active_conversation_index(snapshot)?;
    let conversation = &mut snapshot.conversations[index];
    let message_index = conversation.messages.iter().position(|message| {
        message.id == message_id && matches!(&message.role, MessageRole::User)
    })?;

    let first_user_index = conversation
        .messages
        .iter()
        .position(|message| matches!(&message.role, MessageRole::User));
    let mut user_message = conversation.messages[message_index].clone();
    user_message.content = content;
    user_message.status = Some("done".to_owned());
    user_message.error = None;

    let assistant_message = ChatMessage {
        id: assistant_id,
        role: MessageRole::Assistant,
        content: assistant_content,
        created_at: now + 1,
        status: Some("done".to_owned()),
        error: None,
        attachments: vec![],
        queued_text_request: None,
        offline_replay_claim: None,
    };

    conversation.messages.truncate(message_index);
    conversation.messages.push(user_message.clone());
    conversation.messages.push(assistant_message.clone());
    if first_user_index == Some(message_index) {
        conversation.title = title_from_message(&user_message.content);
    }
    conversation.updated_at = now;
    snapshot.updated_at = now;

    Some((user_message, assistant_message))
}

pub(crate) fn update_streaming_message(
    snapshot: &mut AppSnapshot,
    message_id: &str,
    content: String,
    now: i64,
) -> bool {
    update_message(snapshot, message_id, now, |message| {
        message.content = content;
        message.status = Some("streaming".to_owned());
        message.error = None;
    })
}

pub(crate) fn complete_stopped_message(
    snapshot: &mut AppSnapshot,
    message_id: &str,
    visible_content: &str,
    generating_content: &str,
    stopped_content: &str,
    now: i64,
) -> Option<String> {
    let content = stopped_message_content(visible_content, generating_content, stopped_content);
    let updated = update_message(snapshot, message_id, now, |message| {
        message.content = content.clone();
        message.status = Some("done".to_owned());
        message.error = None;
    });

    updated.then_some(content)
}

pub(crate) fn complete_message(
    snapshot: &mut AppSnapshot,
    message_id: &str,
    content: String,
    error: Option<String>,
    attachments: Option<Vec<MessageAttachment>>,
    now: i64,
) -> bool {
    update_message(snapshot, message_id, now, |message| {
        message.content = content;
        message.status = Some(if error.is_some() { "error" } else { "done" }.to_owned());
        message.error = error;
        if let Some(attachments) = attachments {
            message.attachments = attachments;
        }
    })
}

fn update_message(
    snapshot: &mut AppSnapshot,
    message_id: &str,
    now: i64,
    mutate: impl FnOnce(&mut ChatMessage),
) -> bool {
    for conversation in &mut snapshot.conversations {
        if let Some(message) = conversation
            .messages
            .iter_mut()
            .find(|message| message.id == message_id)
        {
            mutate(message);
            conversation.updated_at = now;
            snapshot.updated_at = now;
            return true;
        }
    }

    false
}

fn stopped_message_content(
    visible_content: &str,
    generating_content: &str,
    stopped_content: &str,
) -> String {
    let current = visible_content.trim_end_matches('|').trim();
    if current.is_empty() || current == generating_content {
        stopped_content.to_owned()
    } else {
        current.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str, role: MessageRole, content: &str, created_at: i64) -> ChatMessage {
        ChatMessage {
            id: id.to_owned(),
            role,
            content: content.to_owned(),
            created_at,
            status: Some("done".to_owned()),
            error: None,
            attachments: vec![],
            queued_text_request: None,
            offline_replay_claim: None,
        }
    }

    fn attachment(id: &str) -> MessageAttachment {
        MessageAttachment {
            id: id.to_owned(),
            kind: "image".to_owned(),
            purpose: Some("generated".to_owned()),
            mime_type: "image/png".to_owned(),
            data_url: Some("data:image/png;base64,AA==".to_owned()),
            url: None,
            alt: Some("Generated image".to_owned()),
            model: Some("gpt-image-1".to_owned()),
            created_at: 1,
        }
    }

    fn snapshot(messages: Vec<ChatMessage>) -> AppSnapshot {
        AppSnapshot {
            version: 1,
            providers: vec![],
            conversations: vec![Conversation {
                id: "active".to_owned(),
                title: "Old title".to_owned(),
                provider_id: "openai".to_owned(),
                model: "gpt-4o".to_owned(),
                messages,
                created_at: 1,
                updated_at: 1,
            }],
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
                active_conversation_id: Some("active".to_owned()),
                dismissed_danger_warnings: None,
                dismissed_feature_hints: None,
            },
            updated_at: 1,
        }
    }

    #[test]
    fn delete_message_from_active_only_removes_target_and_touches_timestamps() {
        let mut snapshot = snapshot(vec![
            message("user-1", MessageRole::User, "hello", 10),
            message("assistant-1", MessageRole::Assistant, "hi", 11),
        ]);

        assert!(delete_message_from_active(&mut snapshot, "assistant-1", 77));
        assert_eq!(snapshot.conversations[0].messages.len(), 1);
        assert_eq!(snapshot.conversations[0].messages[0].id, "user-1");
        assert_eq!(snapshot.conversations[0].updated_at, 77);
        assert_eq!(snapshot.updated_at, 77);
        assert!(!delete_message_from_active(&mut snapshot, "missing", 88));
        assert_eq!(snapshot.updated_at, 77);
    }

    #[test]
    fn regenerate_assistant_requires_prior_user_and_truncates_later_messages() {
        let mut snapshot = snapshot(vec![
            message("user-1", MessageRole::User, "first prompt", 10),
            message("assistant-1", MessageRole::Assistant, "old answer", 11),
            message("user-2", MessageRole::User, "later", 12),
        ]);

        let updated = regenerate_assistant_in_active(
            &mut snapshot,
            "assistant-1",
            "new answer".to_owned(),
            99,
        )
        .expect("assistant should regenerate");

        assert_eq!(updated.content, "new answer");
        assert_eq!(snapshot.conversations[0].messages.len(), 2);
        assert_eq!(snapshot.conversations[0].messages[1].created_at, 99);
        assert_eq!(snapshot.conversations[0].updated_at, 99);
    }

    #[test]
    fn edit_and_resend_user_updates_title_for_first_prompt_and_drops_later_turns() {
        let mut snapshot = snapshot(vec![
            message("user-1", MessageRole::User, "old prompt", 10),
            message("assistant-1", MessageRole::Assistant, "old answer", 11),
            message("user-2", MessageRole::User, "later", 12),
        ]);

        let (user, assistant) = edit_and_resend_user_in_active(
            &mut snapshot,
            "user-1",
            "new prompt with a cleaner title".to_owned(),
            "new answer".to_owned(),
            "assistant-new".to_owned(),
            42,
        )
        .expect("user edit should resend");

        assert_eq!(user.content, "new prompt with a cleaner title");
        assert_eq!(assistant.id, "assistant-new");
        assert_eq!(snapshot.conversations[0].messages.len(), 2);
        assert_eq!(
            snapshot.conversations[0].title,
            "new prompt with a cleaner title"
        );
        assert_eq!(snapshot.updated_at, 42);
    }

    #[test]
    fn complete_message_preserves_or_replaces_attachments_by_call_site() {
        let mut assistant = message("assistant-1", MessageRole::Assistant, "draft", 10);
        assistant.attachments.push(attachment("old-image"));
        let mut snapshot = snapshot(vec![assistant]);

        assert!(complete_message(
            &mut snapshot,
            "assistant-1",
            "final text".to_owned(),
            None,
            None,
            15,
        ));
        assert_eq!(snapshot.conversations[0].messages[0].attachments.len(), 1);

        assert!(complete_message(
            &mut snapshot,
            "assistant-1",
            "image ready".to_owned(),
            None,
            Some(vec![attachment("new-image")]),
            16,
        ));
        let message = &snapshot.conversations[0].messages[0];
        assert_eq!(message.status.as_deref(), Some("done"));
        assert_eq!(message.attachments.len(), 1);
        assert_eq!(message.attachments[0].id, "new-image");
    }

    #[test]
    fn complete_stopped_message_preserves_partial_output_and_clears_error() {
        let mut assistant = message("assistant-1", MessageRole::Assistant, "", 10);
        assistant.status = Some("streaming".to_owned());
        assistant.error = Some("temporary provider warning".to_owned());
        let mut snapshot = snapshot(vec![assistant]);

        let content = complete_stopped_message(
            &mut snapshot,
            "assistant-1",
            "partial answer|",
            "Generating...",
            "Generation stopped",
            31,
        )
        .expect("streaming assistant should stop");

        let message = &snapshot.conversations[0].messages[0];
        assert_eq!(content, "partial answer");
        assert_eq!(message.content, "partial answer");
        assert_eq!(message.status.as_deref(), Some("done"));
        assert_eq!(message.error, None);
        assert_eq!(snapshot.conversations[0].updated_at, 31);
        assert_eq!(snapshot.updated_at, 31);
    }

    #[test]
    fn complete_stopped_message_uses_fallback_for_empty_or_placeholder_output() {
        for visible in ["", "Generating...|"] {
            let mut assistant = message("assistant-1", MessageRole::Assistant, "", 10);
            assistant.status = Some("streaming".to_owned());
            let mut snapshot = snapshot(vec![assistant]);

            let content = complete_stopped_message(
                &mut snapshot,
                "assistant-1",
                visible,
                "Generating...",
                "Generation stopped",
                32,
            )
            .expect("streaming assistant should stop");

            let message = &snapshot.conversations[0].messages[0];
            assert_eq!(content, "Generation stopped");
            assert_eq!(message.content, "Generation stopped");
            assert_eq!(message.status.as_deref(), Some("done"));
            assert_eq!(message.error, None);
        }
    }
}
