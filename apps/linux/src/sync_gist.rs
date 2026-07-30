use crate::{
    crypto::SnapshotCrypto,
    models::{EncryptedSnapshotEnvelope, SyncVault},
    sync::FirstSyncStrategy,
    sync_gist_protocol::{
        GistOperation, GistTombstone, clear_cursor, create_clear_operation, create_state_operation,
        gist_operation_file_name, gist_operation_id_from_file_name, load_cursor,
        materialize_operations, merge_first_sync_vault, merge_vaults, normalize_gist_vault,
        parse_operation, serialize_operation, store_cursor, tombstones_between_vaults,
        tombstones_from_cursor, vault_from_value, vault_value,
    },
    sync_http_body::{
        MAX_SYNC_GIST_RESPONSE_BYTES, MAX_SYNC_INCREMENTAL_OBJECT_BYTES, MAX_SYNC_SNAPSHOT_BYTES,
        drain_bounded_body, ensure_text_size, read_bounded_json, read_bounded_text,
    },
};
use anyhow::{Context, Result, bail};
use reqwest::{StatusCode, header};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Debug)]
struct RemoteGistState {
    heads: Vec<String>,
    legacy: bool,
    managed_files: Vec<String>,
    operations: BTreeMap<String, GistOperation>,
    tombstones: Vec<GistTombstone>,
    vault: Option<Value>,
}

#[derive(Debug)]
struct ReconciledVault {
    should_write: bool,
    tombstones: Vec<GistTombstone>,
    vault: Value,
}

type GistFileChanges = BTreeMap<String, Option<String>>;

pub(crate) async fn sync_gist_v2(
    http: &reqwest::Client,
    crypto: &SnapshotCrypto,
    vault: SyncVault,
    passphrase: &str,
    gist_id: &str,
    gist_file: &str,
    token: &str,
    first_sync_strategy: FirstSyncStrategy,
    has_completed_sync: bool,
    has_local_user_content: bool,
) -> Result<SyncVault> {
    let token = token.trim();
    if token.is_empty() {
        bail!("GitHub token is required.");
    }
    if passphrase.is_empty() {
        bail!("Data encryption password is required.");
    }

    let file_name = normalized_gist_file(gist_file)?;
    let local = vault_value(&vault)?;
    let Some(gist_id) = normalized_gist_id(gist_id)? else {
        return create_new_gist(http, crypto, &vault, &local, passphrase, &file_name, token).await;
    };

    let json = read_gist(http, &gist_id, token, false)
        .await?
        .context("Configured GitHub Gist was not found.")?;
    let remote = decode_remote_gist(http, crypto, json, &file_name, token, passphrase).await?;
    let reconciled = reconcile_vault(
        &vault,
        &local,
        &remote,
        &gist_id,
        &file_name,
        first_sync_strategy,
        has_completed_sync,
        has_local_user_content,
    )?;
    let migrate_legacy = remote.legacy;
    let should_write = reconciled.should_write || migrate_legacy;
    let mut heads = remote.heads.clone();

    if should_write {
        let operation =
            create_state_operation(&remote.heads, &reconciled.vault, &reconciled.tombstones)?;
        let operation_file = gist_operation_file_name(&file_name, operation.id());
        let operation_exists = remote
            .managed_files
            .iter()
            .any(|candidate| candidate == &operation_file);
        let content = if !operation_exists {
            let updated_at = reconciled
                .vault
                .pointer("/data/updatedAt")
                .and_then(Value::as_i64)
                .unwrap_or(1);
            Some(serialize_operation(
                crypto, &operation, passphrase, updated_at,
            )?)
        } else {
            None
        };
        let changes = state_file_changes(
            &file_name,
            &operation_file,
            content,
            &remote.managed_files,
            migrate_legacy.then_some(file_name.as_str()),
        );
        if !changes.is_empty() {
            patch_gist_files(http, &gist_id, token, &changes).await?;
        }
        heads = vec![operation.id().to_owned()];
    }

    let result = configured_result_vault(
        &reconciled.vault,
        &vault,
        &gist_id,
        &file_name,
        if should_write {
            "Sync complete"
        } else {
            "Remote data restored"
        },
    )?;
    store_cursor(
        &gist_id,
        &file_name,
        &heads,
        result.data.sync.last_sync_at,
        &reconciled.vault,
    );
    Ok(result)
}

pub(crate) async fn clear_gist_v2(
    http: &reqwest::Client,
    crypto: &SnapshotCrypto,
    gist_id: &str,
    gist_file: &str,
    token: &str,
    passphrase: &str,
) -> Result<()> {
    let token = token.trim();
    if token.is_empty() {
        bail!("GitHub token is required.");
    }
    if passphrase.is_empty() {
        bail!("Data encryption password is required.");
    }
    let Some(gist_id) = normalized_gist_id(gist_id)? else {
        return Ok(());
    };
    let file_name = normalized_gist_file(gist_file)?;
    let Some(json) = read_gist(http, &gist_id, token, true).await? else {
        clear_cursor(&gist_id, &file_name);
        return Ok(());
    };
    let observed_managed_files = managed_file_names(&json, &file_name);
    let remote = decode_remote_gist(http, crypto, json, &file_name, token, passphrase).await;
    let (parents, managed_files) = match remote {
        Ok(remote) => (remote.heads, remote.managed_files),
        Err(_) => (Vec::new(), observed_managed_files),
    };
    let operation = create_clear_operation(&parents)?;
    let operation_file = gist_operation_file_name(&file_name, operation.id());
    let mut changes = GistFileChanges::from([(
        operation_file.clone(),
        Some(serialize_operation(
            crypto,
            &operation,
            passphrase,
            now_millis().max(1),
        )?),
    )]);
    for candidate in managed_files {
        if candidate != operation_file {
            changes.insert(candidate, None);
        }
    }
    patch_gist_files(http, &gist_id, token, &changes).await?;
    clear_cursor(&gist_id, &file_name);
    Ok(())
}

async fn create_new_gist(
    http: &reqwest::Client,
    crypto: &SnapshotCrypto,
    local_typed: &SyncVault,
    local: &Value,
    passphrase: &str,
    file_name: &str,
    token: &str,
) -> Result<SyncVault> {
    let operation = create_state_operation(&[], local, &[])?;
    let content = serialize_operation(
        crypto,
        &operation,
        passphrase,
        local
            .pointer("/data/updatedAt")
            .and_then(Value::as_i64)
            .unwrap_or(1),
    )?;
    let operation_file = gist_operation_file_name(file_name, operation.id());
    let gist_id = create_gist(http, &operation_file, &content, token).await?;
    let result = configured_result_vault(local, local_typed, &gist_id, file_name, "Sync complete")?;
    store_cursor(
        &gist_id,
        file_name,
        &[operation.id().to_owned()],
        result.data.sync.last_sync_at,
        local,
    );
    Ok(result)
}

fn reconcile_vault(
    local_typed: &SyncVault,
    local: &Value,
    remote: &RemoteGistState,
    gist_id: &str,
    file_name: &str,
    first_sync_strategy: FirstSyncStrategy,
    has_completed_sync: bool,
    has_local_user_content: bool,
) -> Result<ReconciledVault> {
    let Some(remote_vault) = remote.vault.as_ref() else {
        return Ok(ReconciledVault {
            should_write: true,
            tombstones: Vec::new(),
            vault: local.clone(),
        });
    };

    if let Some(cursor) = load_cursor(gist_id, file_name, local_typed.data.sync.last_sync_at) {
        let local_tombstones = tombstones_from_cursor(&cursor, local)?;
        let local_operation = create_state_operation(&cursor.heads, local, &local_tombstones)?;
        let mut combined = remote.operations.clone();
        combined.insert(local_operation.id().to_owned(), local_operation);
        let materialized = materialize_operations(&combined)?;
        let vault = materialized.vault.unwrap_or_else(|| local.clone());
        return Ok(ReconciledVault {
            should_write: !gist_vaults_equal(&vault, remote_vault)?,
            tombstones: materialized.tombstones,
            vault,
        });
    }

    if has_completed_sync || local_typed.data.sync.last_sync_at.is_some() {
        let vault = merge_vaults(None, remote_vault, local)?;
        return Ok(ReconciledVault {
            should_write: !gist_vaults_equal(&vault, remote_vault)?,
            tombstones: Vec::new(),
            vault,
        });
    }

    match first_sync_strategy {
        FirstSyncStrategy::UseRemote => Ok(ReconciledVault {
            should_write: false,
            tombstones: remote.tombstones.clone(),
            vault: remote_vault.clone(),
        }),
        FirstSyncStrategy::UseLocal => Ok(ReconciledVault {
            should_write: true,
            tombstones: tombstones_between_vaults(remote_vault, local)?,
            vault: local.clone(),
        }),
        FirstSyncStrategy::Merge => Ok(ReconciledVault {
            should_write: true,
            tombstones: Vec::new(),
            vault: merge_first_sync_vault(remote_vault, local)?,
        }),
        FirstSyncStrategy::Ask if !has_local_user_content => Ok(ReconciledVault {
            should_write: false,
            tombstones: remote.tombstones.clone(),
            vault: remote_vault.clone(),
        }),
        FirstSyncStrategy::Ask => {
            bail!("Local and cloud both have data. Choose local, cloud, or merge before syncing.")
        }
    }
}

fn gist_vaults_equal(left: &Value, right: &Value) -> Result<bool> {
    Ok(normalize_gist_vault(left)? == normalize_gist_vault(right)?)
}

fn configured_result_vault(
    selected: &Value,
    local: &SyncVault,
    gist_id: &str,
    file_name: &str,
    status: &str,
) -> Result<SyncVault> {
    let mut result = vault_from_value(selected)?;
    result.data.sync = local.data.sync.clone();
    result.data.sync.mode = "gist".to_owned();
    result.data.sync.encryption_enabled = true;
    result.data.sync.gist_id = Some(gist_id.to_owned());
    result.data.sync.gist_file = Some(file_name.to_owned());
    result.data.sync.last_sync_at = Some(now_millis());
    result.data.sync.last_sync_status = Some(status.to_owned());
    Ok(result)
}

async fn read_gist(
    http: &reqwest::Client,
    gist_id: &str,
    token: &str,
    allow_missing: bool,
) -> Result<Option<GithubGistResponse>> {
    let response = http
        .get(gist_endpoint(gist_id)?)
        .header(header::ACCEPT, "application/vnd.github+json")
        .bearer_auth(token)
        .send()
        .await?;
    if response.status() == StatusCode::NOT_FOUND && allow_missing {
        drain_bounded_body(response).await?;
        return Ok(None);
    }
    if !response.status().is_success() {
        response.error_for_status()?;
        return Ok(None);
    }
    Ok(Some(
        read_bounded_json(
            response,
            MAX_SYNC_GIST_RESPONSE_BYTES,
            "GitHub Gist sync response",
        )
        .await?,
    ))
}

fn managed_file_names(gist: &GithubGistResponse, file_name: &str) -> Vec<String> {
    gist.files
        .keys()
        .filter(|candidate| {
            *candidate == file_name
                || gist_operation_id_from_file_name(file_name, candidate).is_some()
        })
        .cloned()
        .collect()
}

async fn read_gist_file_content(
    http: &reqwest::Client,
    file: &GithubGistFile,
    token: &str,
) -> Result<String> {
    if !file.truncated {
        if let Some(content) = &file.content {
            return Ok(content.clone());
        }
    }
    let raw_url = file
        .raw_url
        .as_deref()
        .context("GitHub Gist file content is missing.")?;
    let raw_url = validated_github_gist_raw_url(raw_url)?;
    let response = http
        .get(raw_url)
        .header(header::ACCEPT, "application/vnd.github.raw+json")
        .bearer_auth(token)
        .send()
        .await?;
    if !response.status().is_success() {
        response.error_for_status()?;
        bail!("GitHub Gist file could not be read.");
    }
    read_bounded_text(
        response,
        MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
        "GitHub Gist sync file",
    )
    .await
}

fn validated_github_gist_raw_url(raw_url: &str) -> Result<reqwest::Url> {
    let endpoint = reqwest::Url::parse(raw_url).context("GitHub Gist file URL is invalid.")?;
    if endpoint.scheme() != "https"
        || endpoint.host_str() != Some("gist.githubusercontent.com")
        || endpoint.port().is_some()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.path().is_empty()
        || endpoint.path() == "/"
    {
        bail!("GitHub Gist file URL is invalid.");
    }
    Ok(endpoint)
}

async fn decode_remote_gist(
    http: &reqwest::Client,
    crypto: &SnapshotCrypto,
    gist: GithubGistResponse,
    file_name: &str,
    token: &str,
    passphrase: &str,
) -> Result<RemoteGistState> {
    let managed_files = managed_file_names(&gist, file_name);
    let mut contents = BTreeMap::new();
    for candidate in &managed_files {
        let file = gist
            .files
            .get(candidate)
            .context("GitHub Gist file metadata is missing.")?;
        contents.insert(
            candidate.clone(),
            read_gist_file_content(http, file, token).await?,
        );
    }
    decode_remote_contents(crypto, file_name, managed_files, contents, passphrase)
}

fn decode_remote_contents(
    crypto: &SnapshotCrypto,
    file_name: &str,
    managed_files: Vec<String>,
    contents: BTreeMap<String, String>,
    passphrase: &str,
) -> Result<RemoteGistState> {
    let mut operations = BTreeMap::new();
    for candidate in &managed_files {
        if candidate == file_name {
            continue;
        }
        let expected_id = gist_operation_id_from_file_name(file_name, candidate)
            .context("Managed Gist operation filename is invalid.")?;
        let content = contents
            .get(candidate)
            .context("Managed Gist operation content is missing.")?;
        let operation = parse_operation(crypto, content, passphrase, &expected_id)?;
        operations.insert(expected_id, operation);
    }
    if !operations.is_empty() {
        let materialized = materialize_operations(&operations)?;
        return Ok(RemoteGistState {
            heads: materialized.heads,
            legacy: false,
            managed_files,
            operations,
            tombstones: materialized.tombstones,
            vault: materialized.vault,
        });
    }

    let legacy_content = contents
        .get(file_name)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(legacy_content) = legacy_content else {
        return Ok(RemoteGistState {
            heads: Vec::new(),
            legacy: false,
            managed_files,
            operations,
            tombstones: Vec::new(),
            vault: None,
        });
    };
    ensure_text_size(
        legacy_content,
        MAX_SYNC_SNAPSHOT_BYTES,
        "Remote sync snapshot",
    )?;
    let envelope: EncryptedSnapshotEnvelope =
        serde_json::from_str(legacy_content).context("Legacy Gist snapshot is not valid JSON.")?;
    let legacy_vault = vault_value(&crypto.decrypt_vault(&envelope, passphrase)?)?;
    let operation = create_state_operation(&[], &legacy_vault, &[])?;
    let operation_id = operation.id().to_owned();
    operations.insert(operation_id.clone(), operation);
    Ok(RemoteGistState {
        heads: vec![operation_id],
        legacy: true,
        managed_files,
        operations,
        tombstones: Vec::new(),
        vault: Some(legacy_vault),
    })
}

async fn create_gist(
    http: &reqwest::Client,
    file_name: &str,
    content: &str,
    token: &str,
) -> Result<String> {
    let mut files = Map::new();
    files.insert(
        file_name.to_owned(),
        serde_json::json!({ "content": content }),
    );
    let body = serde_json::json!({
        "description": "ZeroChat encrypted sync vault",
        "public": false,
        "files": files,
    });
    let response = http
        .post("https://api.github.com/gists")
        .header(header::ACCEPT, "application/vnd.github+json")
        .bearer_auth(token)
        .json(&body)
        .send()
        .await?;
    if !response.status().is_success() {
        response.error_for_status()?;
        bail!("Could not get a Gist ID.");
    }
    let gist: GithubGistResponse = read_bounded_json(
        response,
        MAX_SYNC_GIST_RESPONSE_BYTES,
        "GitHub Gist create response",
    )
    .await?;
    let id = gist.id.context("Could not get a Gist ID.")?;
    normalized_gist_id(&id)?.context("Could not get a Gist ID.")
}

async fn patch_gist_files(
    http: &reqwest::Client,
    gist_id: &str,
    token: &str,
    changes: &GistFileChanges,
) -> Result<()> {
    let files = changes
        .iter()
        .map(|(name, content)| {
            (
                name.clone(),
                content
                    .as_ref()
                    .map(|content| serde_json::json!({ "content": content }))
                    .unwrap_or(Value::Null),
            )
        })
        .collect::<Map<_, _>>();
    let response = http
        .patch(gist_endpoint(gist_id)?)
        .header(header::ACCEPT, "application/vnd.github+json")
        .bearer_auth(token)
        .json(&serde_json::json!({ "files": files }))
        .send()
        .await?;
    if !response.status().is_success() {
        response.error_for_status()?;
    }
    drain_bounded_body(response).await?;
    Ok(())
}

fn state_file_changes(
    file_name: &str,
    operation_file: &str,
    content: Option<String>,
    observed_managed_files: &[String],
    legacy_file: Option<&str>,
) -> GistFileChanges {
    let mut changes = GistFileChanges::new();
    if let Some(content) = content {
        changes.insert(operation_file.to_owned(), Some(content));
    }
    for observed in observed_managed_files {
        if observed != operation_file
            && gist_operation_id_from_file_name(file_name, observed).is_some()
        {
            changes.insert(observed.clone(), None);
        }
    }
    if let Some(legacy_file) = legacy_file {
        if legacy_file != operation_file {
            changes.insert(legacy_file.to_owned(), None);
        }
    }
    changes
}

pub(crate) fn normalized_gist_id(value: &str) -> Result<Option<String>> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if !is_valid_gist_id(value) {
        bail!("Gist ID is invalid.");
    }
    Ok(Some(value.to_owned()))
}

pub(crate) fn normalized_gist_file(value: &str) -> Result<String> {
    let value = value.trim();
    let file_name = if value.is_empty() {
        "zerochat-sync.json"
    } else {
        value
    };
    if file_name.contains('/') || file_name.contains('\\') {
        bail!("Gist file name is invalid.");
    }
    Ok(file_name.to_owned())
}

#[derive(Debug, Deserialize)]
struct GithubGistResponse {
    id: Option<String>,
    #[serde(default)]
    files: BTreeMap<String, GithubGistFile>,
}

#[derive(Debug, Deserialize)]
struct GithubGistFile {
    content: Option<String>,
    raw_url: Option<String>,
    #[serde(default)]
    truncated: bool,
}

fn gist_endpoint(gist_id: &str) -> Result<String> {
    let gist_id = normalized_gist_id(gist_id)?.context("Gist ID is invalid.")?;
    Ok(format!("https://api.github.com/gists/{gist_id}"))
}

fn is_valid_gist_id(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_snapshot_is_materialized_for_single_patch_migration() {
        let crypto = SnapshotCrypto::new();
        let vectors: Value = serde_json::from_str(include_str!(
            "../../../shared/examples/gist-operation-v2-vectors.json"
        ))
        .unwrap();
        let typed = vault_from_value(&vectors["state"]["core"]["vault"]).unwrap();
        let content =
            serde_json::to_string(&crypto.encrypt_vault(&typed, "passphrase").unwrap()).unwrap();
        let remote = decode_remote_contents(
            &crypto,
            "zerochat-sync.json",
            vec!["zerochat-sync.json".to_owned()],
            BTreeMap::from([("zerochat-sync.json".to_owned(), content)]),
            "passphrase",
        )
        .unwrap();
        assert!(remote.legacy);
        assert!(remote.vault.is_some());
        assert_eq!(remote.operations.len(), 1);
        assert_eq!(remote.managed_files, ["zerochat-sync.json"]);
        let operation_file = gist_operation_file_name(
            "zerochat-sync.json",
            remote.operations.values().next().unwrap().id(),
        );
        let changes = state_file_changes(
            "zerochat-sync.json",
            &operation_file,
            Some("encrypted-operation".to_owned()),
            &["zerochat-sync.json".to_owned()],
            Some("zerochat-sync.json"),
        );
        assert_eq!(
            changes.get(&operation_file),
            Some(&Some("encrypted-operation".to_owned()))
        );
        assert_eq!(changes.get("zerochat-sync.json"), Some(&None));
    }

    #[test]
    fn mutable_snapshot_writer_is_not_part_of_v2() {
        assert_eq!(
            gist_operation_file_name("zerochat-sync.json", &"a".repeat(64)),
            format!("zerochat-sync.json.zerochat-op-{}.json", "a".repeat(64))
        );
    }

    #[test]
    fn managed_files_reject_operation_prefix_lookalikes() {
        let file_name = "zerochat-sync.json";
        let operation_file = gist_operation_file_name(file_name, &"a".repeat(64));
        let lookalike = format!("{file_name}.zerochat-op-not-an-id.json");
        let gist = GithubGistResponse {
            id: Some("gist-1".to_owned()),
            files: BTreeMap::from([
                (
                    file_name.to_owned(),
                    GithubGistFile {
                        content: None,
                        raw_url: None,
                        truncated: false,
                    },
                ),
                (
                    operation_file.clone(),
                    GithubGistFile {
                        content: None,
                        raw_url: None,
                        truncated: false,
                    },
                ),
                (
                    lookalike,
                    GithubGistFile {
                        content: None,
                        raw_url: None,
                        truncated: false,
                    },
                ),
            ]),
        };

        let mut managed = managed_file_names(&gist, file_name);
        managed.sort();
        assert_eq!(managed, [file_name.to_owned(), operation_file]);
    }

    #[test]
    fn gist_raw_file_urls_are_limited_to_github_gist() {
        assert!(validated_github_gist_raw_url("https://attacker.example/file").is_err());
        assert!(
            validated_github_gist_raw_url("https://gist.githubusercontent.com/user/gist/raw/file")
                .is_ok()
        );
        assert!(
            validated_github_gist_raw_url(
                "https://gist.githubusercontent.com:443/user/gist/raw/file"
            )
            .is_err()
        );
        assert!(
            validated_github_gist_raw_url(
                "https://user@gist.githubusercontent.com/user/gist/raw/file"
            )
            .is_err()
        );
    }

    fn apply_file_changes(files: &mut BTreeMap<String, String>, changes: GistFileChanges) {
        for (name, content) in changes {
            if let Some(content) = content {
                files.insert(name, content);
            } else {
                files.remove(&name);
            }
        }
    }

    #[test]
    fn serial_state_publication_keeps_observed_history_bounded() {
        let file_name = "zerochat-sync.json";
        let mut files = BTreeMap::from([(
            gist_operation_file_name(file_name, &"a".repeat(64)),
            "operation-a".to_owned(),
        )]);

        for id in ['b', 'c', 'd'] {
            let operation_file = gist_operation_file_name(file_name, &id.to_string().repeat(64));
            let observed = files.keys().cloned().collect::<Vec<_>>();
            let changes = state_file_changes(
                file_name,
                &operation_file,
                Some(format!("operation-{id}")),
                &observed,
                None,
            );
            apply_file_changes(&mut files, changes);
            assert_eq!(files.len(), 1);
            assert!(files.contains_key(&operation_file));
        }
    }

    #[test]
    fn state_compaction_rejects_unmanaged_observed_lookalikes() {
        let file_name = "zerochat-sync.json";
        let old_operation = gist_operation_file_name(file_name, &"a".repeat(64));
        let new_operation = gist_operation_file_name(file_name, &"b".repeat(64));
        let lookalike = format!("{file_name}.zerochat-op-not-an-id.json");
        let changes = state_file_changes(
            file_name,
            &new_operation,
            Some("new-operation".to_owned()),
            &[
                file_name.to_owned(),
                old_operation.clone(),
                lookalike.clone(),
            ],
            None,
        );

        assert_eq!(
            changes.get(&new_operation),
            Some(&Some("new-operation".to_owned()))
        );
        assert_eq!(changes.get(&old_operation), Some(&None));
        assert!(!changes.contains_key(file_name));
        assert!(!changes.contains_key(&lookalike));
    }

    #[test]
    fn concurrent_compacting_publications_survive_and_merge_with_pruned_parent() {
        let file_name = "zerochat-sync.json";
        let passphrase = "passphrase";
        let crypto = SnapshotCrypto::new();
        let typed = vault_from_value(&serde_json::json!({
            "data": {
                "version": 1,
                "providers": [{
                    "id": "provider-1",
                    "name": "Provider",
                    "kind": "openai-responses",
                    "baseUrl": "https://example.com/v1",
                    "model": "model-1",
                    "enabled": true,
                    "needsApiKey": true,
                    "createdAt": 1,
                    "updatedAt": 1,
                }],
                "conversations": [{
                    "id": "conversation-1",
                    "title": "Conversation",
                    "providerId": "provider-1",
                    "model": "model-1",
                    "messages": [],
                    "createdAt": 1,
                    "updatedAt": 1,
                }],
                "skills": [],
                "skillSettings": {
                    "autoMatch": true,
                    "contextBudget": 2400,
                    "maxAutoSkills": 3,
                },
                "sync": {
                    "mode": "gist",
                    "autoSync": true,
                    "encryptionEnabled": true,
                },
                "preferences": {
                    "firstRunDone": true,
                    "theme": "system",
                    "language": "system",
                    "compactMode": false,
                },
                "updatedAt": 1,
            },
            "secrets": { "providerKeys": {} },
        }))
        .unwrap();
        let base_vault = vault_value(&typed).unwrap();
        let base = create_state_operation(&[], &base_vault, &[]).unwrap();
        let base_file = gist_operation_file_name(file_name, base.id());
        let mut left_vault = base_vault.clone();
        let mut right_vault = base_vault;
        left_vault["data"]["conversations"][0]["messages"] = serde_json::json!([{
            "id": "left",
            "role": "user",
            "content": "left",
            "createdAt": 20,
        }]);
        left_vault["data"]["conversations"][0]["updatedAt"] = Value::from(20);
        left_vault["data"]["updatedAt"] = Value::from(20);
        right_vault["data"]["conversations"][0]["messages"] = serde_json::json!([{
            "id": "right",
            "role": "user",
            "content": "right",
            "createdAt": 30,
        }]);
        right_vault["data"]["conversations"][0]["updatedAt"] = Value::from(30);
        right_vault["data"]["updatedAt"] = Value::from(30);

        let left = create_state_operation(&[base.id().to_owned()], &left_vault, &[]).unwrap();
        let right = create_state_operation(&[base.id().to_owned()], &right_vault, &[]).unwrap();
        let left_file = gist_operation_file_name(file_name, left.id());
        let right_file = gist_operation_file_name(file_name, right.id());
        let mut files = BTreeMap::from([(
            base_file.clone(),
            serialize_operation(&crypto, &base, passphrase, 10).unwrap(),
        )]);
        let observed = vec![base_file];
        let left_changes = state_file_changes(
            file_name,
            &left_file,
            Some(serialize_operation(&crypto, &left, passphrase, 20).unwrap()),
            &observed,
            None,
        );
        let right_changes = state_file_changes(
            file_name,
            &right_file,
            Some(serialize_operation(&crypto, &right, passphrase, 30).unwrap()),
            &observed,
            None,
        );
        apply_file_changes(&mut files, left_changes);
        apply_file_changes(&mut files, right_changes);

        assert_eq!(files.len(), 2);
        assert!(files.contains_key(&left_file));
        assert!(files.contains_key(&right_file));
        let managed = files.keys().cloned().collect::<Vec<_>>();
        let remote =
            decode_remote_contents(&crypto, file_name, managed, files, passphrase).unwrap();
        assert_eq!(remote.heads.len(), 2);
        let merged_vault = remote.vault.unwrap();
        let messages = merged_vault["data"]["conversations"][0]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(messages, ["left", "right"]);
    }
}
