use crate::models::{
    AppSnapshot, Conversation, ProviderConfig, ProviderSecrets, SkillSettings, SyncConfig,
    SyncVault, UserSkill,
};
use std::collections::BTreeMap;

pub(crate) fn accept_remote_vault(remote: SyncVault, local: &AppSnapshot) -> SyncVault {
    let mut accepted = remote;
    accepted.data.sync = merge_sync_config(&accepted.data.sync, &local.sync);
    accepted
}

fn merge_sync_config(remote: &SyncConfig, local: &SyncConfig) -> SyncConfig {
    let mut merged = remote.clone();
    merged.mode = local.mode.clone();
    merged.auto_sync = local.auto_sync;
    merged.encryption_enabled = true;
    merged.gist_id = local.gist_id.clone().or_else(|| remote.gist_id.clone());
    merged.gist_file = local.gist_file.clone().or_else(|| remote.gist_file.clone());
    merged.worker_endpoint = local
        .worker_endpoint
        .clone()
        .or_else(|| remote.worker_endpoint.clone());
    merged.last_sync_at = Some(now_millis());
    merged.last_sync_status = Some("Remote data restored".to_owned());
    merged
}

pub(crate) fn merge_first_sync_vault(remote: SyncVault, local: SyncVault) -> SyncVault {
    let conversations = merge_conversations(remote.data.conversations, local.data.conversations);
    let providers = merge_providers(remote.data.providers, local.data.providers);
    let skills = merge_skills(remote.data.skills, local.data.skills);
    let mut data = local.data;
    data.providers = providers;
    data.conversations = conversations;
    data.skills = skills;
    data.skill_settings = merge_skill_settings(remote.data.skill_settings, data.skill_settings);
    data.updated_at = remote
        .data
        .updated_at
        .max(data.updated_at)
        .max(now_millis());

    let mut provider_keys = remote.secrets.provider_keys;
    provider_keys.extend(local.secrets.provider_keys);

    SyncVault {
        data,
        secrets: ProviderSecrets { provider_keys },
    }
}

fn merge_conversations(remote: Vec<Conversation>, local: Vec<Conversation>) -> Vec<Conversation> {
    let mut merged: BTreeMap<String, Conversation> = remote
        .into_iter()
        .map(|item| (item.id.clone(), item))
        .collect();
    for item in local {
        match merged.get(&item.id) {
            Some(existing) if existing.updated_at > item.updated_at => {}
            _ => {
                merged.insert(item.id.clone(), item);
            }
        }
    }
    let mut values: Vec<Conversation> = merged.into_values().collect();
    values.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    values
}

fn merge_providers(remote: Vec<ProviderConfig>, local: Vec<ProviderConfig>) -> Vec<ProviderConfig> {
    let mut merged: BTreeMap<String, ProviderConfig> = remote
        .into_iter()
        .map(|item| (item.id.clone(), item))
        .collect();
    for item in local {
        match merged.get(&item.id) {
            Some(existing) if existing.updated_at > item.updated_at => {}
            _ => {
                merged.insert(item.id.clone(), item);
            }
        }
    }
    merged.into_values().collect()
}

fn merge_skills(remote: Vec<UserSkill>, local: Vec<UserSkill>) -> Vec<UserSkill> {
    let mut merged: BTreeMap<String, UserSkill> = remote
        .into_iter()
        .map(|item| (item.id.clone(), item))
        .collect();
    for item in local {
        match merged.get(&item.id) {
            Some(existing) if existing.updated_at > item.updated_at => {}
            _ => {
                merged.insert(item.id.clone(), item);
            }
        }
    }
    let mut values: Vec<UserSkill> = merged.into_values().collect();
    values.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    values
}

fn merge_skill_settings(remote: SkillSettings, local: SkillSettings) -> SkillSettings {
    let defaults = SkillSettings {
        auto_match: true,
        context_budget: 2400,
        max_auto_skills: 3,
    };

    SkillSettings {
        auto_match: if local.auto_match != defaults.auto_match {
            local.auto_match
        } else {
            remote.auto_match
        },
        context_budget: if local.context_budget != defaults.context_budget {
            local.context_budget
        } else {
            remote.context_budget
        },
        max_auto_skills: if local.max_auto_skills != defaults.max_auto_skills {
            local.max_auto_skills
        } else {
            remote.max_auto_skills
        },
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
