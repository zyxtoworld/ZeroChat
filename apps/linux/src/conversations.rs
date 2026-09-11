use crate::{
    models::{AppSnapshot, Conversation, ProviderConfig},
    skills::normalize_whitespace,
};

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

    let conversation_id = format!("linux-conversation-{}", now);
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
