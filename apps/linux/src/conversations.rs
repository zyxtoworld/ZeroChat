use crate::{
    models::{AppSnapshot, Conversation, ProviderConfig},
    skills::normalize_whitespace,
};
use uuid::Uuid;

pub(crate) fn linux_conversation_search_text(title: &str, conversation: &Conversation) -> String {
    let mut values = vec![title.to_owned(), conversation.model.clone()];
    values.extend(
        conversation
            .messages
            .iter()
            .map(|message| message.content.clone()),
    );
    values.join("\n")
}

pub(crate) fn normalize_conversation_search_value(value: &str) -> String {
    normalize_whitespace(value).to_lowercase()
}

pub(crate) fn default_conversation_provider(snapshot: &AppSnapshot) -> (String, String) {
    let provider = snapshot
        .providers
        .iter()
        .find(|provider| provider.enabled)
        .or_else(|| snapshot.providers.first());

    (
        provider
            .map(|provider| provider.id.clone())
            .unwrap_or_else(|| "custom-openai".to_owned()),
        provider
            .map(|provider| provider.model.clone())
            .unwrap_or_default(),
    )
}
pub(crate) fn active_conversation_is_untouched(snapshot: &AppSnapshot) -> bool {
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
        .is_some_and(|conversation| {
            conversation.messages.is_empty() && conversation.title.trim().is_empty()
        })
}
pub(crate) fn ensure_active_conversation(
    snapshot: &mut AppSnapshot,
    first_message: &str,
    now: i64,
) -> String {
    ensure_active_conversation_with_provider(snapshot, first_message, now, None)
}

pub(crate) fn ensure_active_conversation_for_provider(
    snapshot: &mut AppSnapshot,
    first_message: &str,
    now: i64,
    provider: &ProviderConfig,
) -> String {
    ensure_active_conversation_with_provider(snapshot, first_message, now, Some(provider))
}

fn ensure_active_conversation_with_provider(
    snapshot: &mut AppSnapshot,
    first_message: &str,
    now: i64,
    provider: Option<&ProviderConfig>,
) -> String {
    if let Some(existing_id) = snapshot.preferences.active_conversation_id.as_deref() {
        if snapshot
            .conversations
            .iter()
            .any(|conversation| conversation.id == existing_id)
        {
            return existing_id.to_owned();
        }
    }

    if let Some(existing) = snapshot.conversations.first() {
        let existing_id = existing.id.clone();
        snapshot.preferences.active_conversation_id = Some(existing_id.clone());
        return existing_id;
    }

    let conversation_id = format!("linux-conversation-{}", Uuid::new_v4());
    let title = title_from_message(first_message);
    let (provider_id, model) = provider.map_or_else(
        || default_conversation_provider(snapshot),
        |provider| (provider.id.clone(), provider.model.clone()),
    );

    snapshot.conversations.push(Conversation {
        id: conversation_id.clone(),
        title,
        provider_id,
        model,
        messages: vec![],
        context_compaction: None,
        created_at: now,
        updated_at: now,
    });
    snapshot.preferences.active_conversation_id = Some(conversation_id.clone());
    conversation_id
}

pub(crate) fn title_from_message(message: &str) -> String {
    let compact = message
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_owned();
    let title = if compact.is_empty() {
        "New chat".to_owned()
    } else {
        compact
    };

    let mut chars = title.chars();
    let preview = chars.by_ref().take(36).collect::<String>();
    if chars.next().is_some() {
        format!("{}...", preview)
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use super::active_conversation_is_untouched;
    use crate::{defaults::default_snapshot, models::Conversation};

    #[test]
    fn active_empty_placeholder_is_reused_but_used_chat_is_not() {
        let mut snapshot = default_snapshot();
        let now = snapshot.updated_at;
        snapshot.conversations.push(Conversation {
            id: "empty".to_owned(),
            title: String::new(),
            provider_id: "openai".to_owned(),
            model: "gpt-5.5".to_owned(),
            messages: vec![],
            context_compaction: None,
            created_at: now,
            updated_at: now,
        });
        snapshot.preferences.active_conversation_id = Some("empty".to_owned());
        assert!(active_conversation_is_untouched(&snapshot));

        snapshot.conversations[0]
            .messages
            .push(crate::models::ChatMessage {
                id: "message".to_owned(),
                role: crate::models::MessageRole::User,
                content: "used".to_owned(),
                created_at: now,
                status: Some("done".to_owned()),
                error: None,
                attachments: vec![],
                queued_text_request: None,
                offline_replay_claim: None,
            });
        assert!(!active_conversation_is_untouched(&snapshot));
    }
}
