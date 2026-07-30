use crate::models::{AppSnapshot, SkillSettings};

pub(crate) fn with_sync_status(
    mut snapshot: AppSnapshot,
    status: &str,
    completed: bool,
) -> AppSnapshot {
    snapshot.sync.encryption_enabled = true;
    snapshot.sync.last_sync_status = Some(status.to_owned());
    if completed {
        snapshot.sync.last_sync_at = Some(now_millis());
    }
    snapshot
}

pub(crate) fn is_stale_sync_result(source: &AppSnapshot, current: &AppSnapshot) -> bool {
    current.sync.mode != source.sync.mode
        || current.sync.auto_sync != source.sync.auto_sync
        || current.sync.gist_id != source.sync.gist_id
        || current.sync.gist_file != source.sync.gist_file
        || current.sync.worker_endpoint != source.sync.worker_endpoint
        || (current.updated_at > source.updated_at && has_meaningful_local_changes(source, current))
}

pub(crate) fn has_meaningful_local_changes(source: &AppSnapshot, current: &AppSnapshot) -> bool {
    let mut aligned_source = source.clone();
    aligned_source.updated_at = current.updated_at;
    aligned_source.sync.encryption_enabled = current.sync.encryption_enabled;
    aligned_source.sync.last_sync_at = current.sync.last_sync_at;
    aligned_source.sync.last_sync_status = current.sync.last_sync_status.clone();

    match (
        serde_json::to_value(&aligned_source),
        serde_json::to_value(current),
    ) {
        (Ok(aligned), Ok(current)) => aligned != current,
        _ => true,
    }
}

pub(crate) fn merge_sync_result(
    mut current: AppSnapshot,
    source: &AppSnapshot,
    synced: AppSnapshot,
) -> AppSnapshot {
    if synced.updated_at != source.updated_at {
        return synced;
    }

    current.sync.encryption_enabled = synced.sync.encryption_enabled;
    current.sync.last_sync_at = synced.sync.last_sync_at;
    current.sync.last_sync_status = synced.sync.last_sync_status;
    current
}

pub(crate) fn has_local_user_content(snapshot: &AppSnapshot) -> bool {
    let defaults = SkillSettings {
        auto_match: true,
        context_budget: 2400,
        max_auto_skills: 3,
    };

    snapshot
        .conversations
        .iter()
        .any(|conversation| !conversation.messages.is_empty())
        || has_user_provider_content(snapshot)
        || !snapshot.skills.is_empty()
        || snapshot.skill_settings.auto_match != defaults.auto_match
        || snapshot.skill_settings.context_budget != defaults.context_budget
        || snapshot.skill_settings.max_auto_skills != defaults.max_auto_skills
        || snapshot.preferences.theme != "system"
        || snapshot.preferences.language != "system"
        || snapshot.preferences.compact_mode
}

fn has_user_provider_content(snapshot: &AppSnapshot) -> bool {
    snapshot.providers.iter().any(|provider| {
        provider.updated_at != provider.created_at
            || (provider.custom.unwrap_or(false)
                && provider.enabled
                && !provider.id.starts_with("custom-"))
    })
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
