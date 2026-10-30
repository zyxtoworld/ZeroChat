use super::{LinuxAppState, now_millis};
use crate::{
    conversations::{active_conversation_is_untouched, default_conversation_provider},
    models::Conversation,
};
use uuid::Uuid;

impl LinuxAppState {
    pub(crate) fn conversations(&self) -> Vec<Conversation> {
        self.snapshot.borrow().conversations.clone()
    }

    pub(crate) fn active_conversation_id(&self) -> Option<String> {
        self.snapshot
            .borrow()
            .preferences
            .active_conversation_id
            .clone()
    }

    pub(crate) fn active_conversation(&self) -> Option<Conversation> {
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
            .cloned()
    }

    pub(crate) fn create_empty_conversation(&self) {
        {
            let mut snapshot = self.snapshot.borrow_mut();
            if active_conversation_is_untouched(&snapshot) {
                return;
            }

            let now = now_millis();
            let (provider_id, model) = default_conversation_provider(&snapshot);
            let conversation_id = format!("linux-conversation-{}", Uuid::new_v4());
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
        self.save();
    }

    pub(crate) fn select_conversation(&self, conversation_id: &str) {
        {
            let mut snapshot = self.snapshot.borrow_mut();
            if snapshot
                .conversations
                .iter()
                .any(|conversation| conversation.id == conversation_id)
            {
                snapshot.preferences.active_conversation_id = Some(conversation_id.to_owned());
                snapshot.updated_at = now_millis();
            }
        }
        self.save();
    }

    pub(crate) fn delete_conversation(&self, conversation_id: &str) -> bool {
        let (deleted, removed_speaking_message) = {
            let mut snapshot = self.snapshot.borrow_mut();
            let speaking_message_id = self.speaking_message_id();
            let removed_speaking_message = speaking_message_id.as_deref().is_some_and(|id| {
                snapshot
                    .conversations
                    .iter()
                    .find(|conversation| conversation.id == conversation_id)
                    .is_some_and(|conversation| {
                        conversation.messages.iter().any(|message| message.id == id)
                    })
            });
            let previous_len = snapshot.conversations.len();
            snapshot
                .conversations
                .retain(|conversation| conversation.id != conversation_id);

            if snapshot.conversations.len() == previous_len {
                (false, false)
            } else {
                let active_valid = snapshot
                    .preferences
                    .active_conversation_id
                    .as_deref()
                    .map(|active_id| {
                        snapshot
                            .conversations
                            .iter()
                            .any(|conversation| conversation.id == active_id)
                    })
                    .unwrap_or(false);

                if !active_valid {
                    snapshot.preferences.active_conversation_id = snapshot
                        .conversations
                        .first()
                        .map(|conversation| conversation.id.clone());
                }

                snapshot.updated_at = now_millis();
                (true, removed_speaking_message)
            }
        };

        if deleted {
            if removed_speaking_message {
                self.stop_speaking_message();
            }
            self.save();
        }

        deleted
    }
}
