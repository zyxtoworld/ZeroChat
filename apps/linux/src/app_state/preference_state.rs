use super::{LinuxAppState, now_millis};
use crate::models::Preferences;

pub(crate) const LINUX_PROVIDER_MODEL_FEATURE_HINT_ID: &str = "provider-model";

pub(crate) fn should_show_feature_hint(preferences: &Preferences, id: &str) -> bool {
    !preferences
        .dismissed_feature_hints
        .as_ref()
        .is_some_and(|items| items.iter().any(|item| item == id))
}

pub(crate) fn dismiss_feature_hint_id(preferences: &mut Preferences, id: &str) -> bool {
    let items = preferences
        .dismissed_feature_hints
        .get_or_insert_with(Vec::new);

    if items.iter().any(|item| item == id) {
        return false;
    }

    items.push(id.to_owned());
    true
}

impl LinuxAppState {
    pub(crate) fn language_mode(&self) -> String {
        self.snapshot.borrow().preferences.language.clone()
    }

    pub(crate) fn compact(&self) -> bool {
        self.snapshot.borrow().preferences.compact_mode
    }

    pub(crate) fn theme(&self) -> String {
        self.snapshot.borrow().preferences.theme.clone()
    }

    pub(crate) fn should_show_feature_hint(&self, id: &str) -> bool {
        should_show_feature_hint(&self.snapshot.borrow().preferences, id)
    }

    pub(crate) fn dismiss_feature_hint(&self, id: &str) {
        self.update_preferences(|preferences| {
            dismiss_feature_hint_id(preferences, id);
        });
    }

    pub(crate) fn update_preferences(&self, mutate: impl FnOnce(&mut Preferences)) {
        {
            let mut snapshot = self.snapshot.borrow_mut();
            mutate(&mut snapshot.preferences);
            snapshot.updated_at = now_millis();
        }
        self.save();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        LINUX_PROVIDER_MODEL_FEATURE_HINT_ID, dismiss_feature_hint_id, should_show_feature_hint,
    };
    use crate::models::Preferences;

    #[test]
    fn feature_hints_show_once_and_dismiss_without_duplicates() {
        let mut preferences = preferences(None);

        assert!(should_show_feature_hint(
            &preferences,
            LINUX_PROVIDER_MODEL_FEATURE_HINT_ID
        ));
        assert!(dismiss_feature_hint_id(
            &mut preferences,
            LINUX_PROVIDER_MODEL_FEATURE_HINT_ID
        ));
        assert!(!should_show_feature_hint(
            &preferences,
            LINUX_PROVIDER_MODEL_FEATURE_HINT_ID
        ));
        assert!(!dismiss_feature_hint_id(
            &mut preferences,
            LINUX_PROVIDER_MODEL_FEATURE_HINT_ID
        ));
        assert_eq!(
            preferences.dismissed_feature_hints,
            Some(vec![LINUX_PROVIDER_MODEL_FEATURE_HINT_ID.to_owned()])
        );
    }

    fn preferences(dismissed_feature_hints: Option<Vec<String>>) -> Preferences {
        Preferences {
            first_run_done: false,
            theme: "system".to_owned(),
            language: "system".to_owned(),
            compact_mode: false,
            chat_context_message_limit: 24,
            active_conversation_id: None,
            dismissed_danger_warnings: None,
            dismissed_feature_hints,
        }
    }
}
