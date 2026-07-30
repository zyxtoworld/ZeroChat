use crate::{
    crypto::SnapshotCrypto,
    models::{EncryptedObjectEnvelope, SyncVault},
    sync_http_body::{MAX_SYNC_INCREMENTAL_OBJECT_BYTES, ensure_text_size},
    sync_vault_validation::decode_validated_sync_vault,
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

const GIST_OPERATION_KIND: &str = "zerochat.gistOperation";
const GIST_OPERATION_OBJECT_TYPE: &str = "gist-operation-v2";
const GIST_CURSOR_VERSION: i32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GistTombstone {
    pub(crate) fingerprint: String,
    pub(crate) id: String,
    pub(crate) kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_id: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) enum GistOperation {
    State {
        id: String,
        parents: Vec<String>,
        tombstones: Vec<GistTombstone>,
        vault: Value,
    },
    Clear {
        id: String,
        parents: Vec<String>,
    },
}

impl GistOperation {
    pub(crate) fn id(&self) -> &str {
        match self {
            Self::State { id, .. } | Self::Clear { id, .. } => id,
        }
    }

    pub(crate) fn parents(&self) -> &[String] {
        match self {
            Self::State { parents, .. } | Self::Clear { parents, .. } => parents,
        }
    }

    fn state_vault(&self) -> Option<&Value> {
        match self {
            Self::State { vault, .. } => Some(vault),
            Self::Clear { .. } => None,
        }
    }

    fn state_tombstones(&self) -> &[GistTombstone] {
        match self {
            Self::State { tombstones, .. } => tombstones,
            Self::Clear { .. } => &[],
        }
    }

    pub(crate) fn is_state(&self) -> bool {
        matches!(self, Self::State { .. })
    }
}

#[derive(Clone, Debug)]
pub(crate) struct MaterializedGistOperations {
    pub(crate) heads: Vec<String>,
    pub(crate) tombstones: Vec<GistTombstone>,
    pub(crate) vault: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BaselineConversation {
    fingerprint: String,
    messages: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GistBaseline {
    conversations: BTreeMap<String, BaselineConversation>,
    provider_secrets: BTreeMap<String, String>,
    providers: BTreeMap<String, String>,
    skills: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GistCursor {
    baseline: GistBaseline,
    pub(crate) heads: Vec<String>,
    local_sync_at: i64,
    version: i32,
}

pub(crate) fn gist_operation_file_prefix(file_name: &str) -> String {
    format!("{file_name}.zerochat-op-")
}

pub(crate) fn gist_operation_file_name(file_name: &str, id: &str) -> String {
    format!("{}{id}.json", gist_operation_file_prefix(file_name))
}

pub(crate) fn gist_operation_id_from_file_name(file_name: &str, candidate: &str) -> Option<String> {
    let prefix = gist_operation_file_prefix(file_name);
    let id = candidate.strip_prefix(&prefix)?.strip_suffix(".json")?;
    if id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        Some(id.to_owned())
    } else {
        None
    }
}

pub(crate) fn normalize_gist_vault(vault: &Value) -> Result<Value> {
    let mut normalized = vault.clone();
    let root = normalized
        .as_object_mut()
        .context("Remote Gist operation vault is invalid.")?;
    let data = root
        .get_mut("data")
        .and_then(Value::as_object_mut)
        .context("Remote Gist operation vault is invalid.")?;

    data.entry("skills".to_owned())
        .or_insert_with(|| Value::Array(Vec::new()));
    data.entry("skillSettings".to_owned()).or_insert_with(|| {
        json!({
            "autoMatch": true,
            "contextBudget": 2400,
            "maxAutoSkills": 3,
        })
    });

    let providers = data
        .get_mut("providers")
        .and_then(Value::as_array_mut)
        .context("Remote Gist operation vault is invalid.")?;
    for provider in providers {
        let provider = provider
            .as_object_mut()
            .context("Remote Gist operation vault is invalid.")?;
        for key in ["clientRequestMode", "custom"] {
            if provider.get(key) == Some(&Value::Bool(false)) {
                provider.remove(key);
            }
        }
        for key in ["models", "capabilities"] {
            if provider
                .get(key)
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
            {
                provider.remove(key);
            }
        }
    }

    let conversations = data
        .get_mut("conversations")
        .and_then(Value::as_array_mut)
        .context("Remote Gist operation vault is invalid.")?;
    for conversation in conversations {
        let messages = conversation
            .get_mut("messages")
            .and_then(Value::as_array_mut)
            .context("Remote Gist operation vault is invalid.")?;
        for message in messages {
            let message = message
                .as_object_mut()
                .context("Remote Gist operation vault is invalid.")?;
            if message.get("status").and_then(Value::as_str) == Some("done") {
                message.remove("status");
            }
            if message
                .get("attachments")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
            {
                message.remove("attachments");
            }
        }
    }

    let skills = data
        .get_mut("skills")
        .and_then(Value::as_array_mut)
        .context("Remote Gist operation vault is invalid.")?;
    for skill in skills {
        let chunks = skill
            .get_mut("chunks")
            .and_then(Value::as_array_mut)
            .context("Remote Gist operation vault is invalid.")?;
        for chunk in chunks {
            let chunk = chunk
                .as_object_mut()
                .context("Remote Gist operation vault is invalid.")?;
            if chunk.get("content").and_then(Value::as_str) == Some("") {
                chunk.remove("content");
            }
        }
    }

    let sync = data
        .get_mut("sync")
        .and_then(Value::as_object_mut)
        .context("Remote Gist operation vault is invalid.")?;
    sync.remove("gistId");
    sync.remove("gistFile");
    sync.remove("lastSyncAt");
    sync.remove("lastSyncStatus");
    sync.insert("encryptionEnabled".to_owned(), Value::Bool(true));

    let preferences = data
        .get_mut("preferences")
        .and_then(Value::as_object_mut)
        .context("Remote Gist operation vault is invalid.")?;
    if preferences
        .get("chatContextMessageLimit")
        .and_then(Value::as_i64)
        == Some(24)
    {
        preferences.remove("chatContextMessageLimit");
    }
    for key in ["dismissedDangerWarnings", "dismissedFeatureHints"] {
        if preferences
            .get(key)
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            preferences.remove(key);
        }
    }

    Ok(normalized)
}

fn validated_normalized_gist_vault(vault: &Value) -> Result<Value> {
    let normalized = normalize_gist_vault(vault)?;
    decode_validated_sync_vault(&serde_json::to_vec(&normalized)?)?;
    Ok(normalized)
}

pub(crate) fn vault_value(vault: &SyncVault) -> Result<Value> {
    validated_normalized_gist_vault(&serde_json::to_value(vault)?)
}

pub(crate) fn vault_from_value(vault: &Value) -> Result<SyncVault> {
    decode_validated_sync_vault(&serde_json::to_vec(vault)?)
}

fn utf16_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn write_canonical_json(value: &Value, output: &mut String) -> Result<()> {
    match value {
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_canonical_json(value, output)?;
            }
            output.push(']');
        }
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort_by(|left, right| utf16_cmp(left, right));
            output.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(&serde_json::to_string(key)?);
                output.push(':');
                write_canonical_json(&object[key], output)?;
            }
            output.push('}');
        }
        _ => output.push_str(&serde_json::to_string(value)?),
    }
    Ok(())
}

pub(crate) fn canonical_json(value: &Value) -> Result<String> {
    let mut output = String::new();
    write_canonical_json(value, &mut output)?;
    Ok(output)
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn fingerprint(value: &Value) -> Result<String> {
    Ok(sha256_hex(canonical_json(value)?.as_bytes()))
}

fn valid_hex_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn normalized_parents(parents: &[String]) -> Result<Vec<String>> {
    if !parents.iter().all(|parent| valid_hex_id(parent)) {
        bail!("Remote Gist operation parent ID is invalid.");
    }
    let mut normalized = parents.to_vec();
    normalized.sort_by(|left, right| utf16_cmp(left, right));
    normalized.dedup();
    Ok(normalized)
}

fn tombstone_key(tombstone: &GistTombstone) -> String {
    format!(
        "{}\0{}\0{}\0{}",
        tombstone.kind,
        tombstone.parent_id.as_deref().unwrap_or_default(),
        tombstone.id,
        tombstone.fingerprint
    )
}

fn valid_tombstone(tombstone: &GistTombstone) -> bool {
    matches!(
        tombstone.kind.as_str(),
        "conversation" | "message" | "provider" | "provider-secret" | "skill"
    ) && !tombstone.id.is_empty()
        && valid_hex_id(&tombstone.fingerprint)
        && tombstone
            .parent_id
            .as_ref()
            .is_none_or(|parent_id| !parent_id.is_empty())
        && (tombstone.kind == "message") == tombstone.parent_id.is_some()
}

fn normalized_tombstones(tombstones: &[GistTombstone]) -> Result<Vec<GistTombstone>> {
    if !tombstones.iter().all(valid_tombstone) {
        bail!("Remote Gist operation tombstone is invalid.");
    }
    let mut normalized = tombstones.to_vec();
    normalized.sort_by(|left, right| utf16_cmp(&tombstone_key(left), &tombstone_key(right)));
    normalized.dedup_by(|left, right| tombstone_key(left) == tombstone_key(right));
    Ok(normalized)
}

fn state_core(parents: &[String], vault: &Value, tombstones: &[GistTombstone]) -> Result<Value> {
    Ok(json!({
        "kind": GIST_OPERATION_KIND,
        "version": 2,
        "operation": "state",
        "parents": normalized_parents(parents)?,
        "tombstones": normalized_tombstones(tombstones)?,
        "vault": validated_normalized_gist_vault(vault)?,
    }))
}

fn clear_core(parents: &[String]) -> Result<Value> {
    Ok(json!({
        "kind": GIST_OPERATION_KIND,
        "version": 2,
        "operation": "clear",
        "parents": normalized_parents(parents)?,
        "tombstones": [],
    }))
}

fn operation_id(core: &Value) -> Result<String> {
    Ok(sha256_hex(canonical_json(core)?.as_bytes()))
}

pub(crate) fn create_state_operation(
    parents: &[String],
    vault: &Value,
    tombstones: &[GistTombstone],
) -> Result<GistOperation> {
    let core = state_core(parents, vault, tombstones)?;
    let id = operation_id(&core)?;
    Ok(GistOperation::State {
        id,
        parents: normalized_parents(parents)?,
        tombstones: normalized_tombstones(tombstones)?,
        vault: validated_normalized_gist_vault(vault)?,
    })
}

pub(crate) fn create_clear_operation(parents: &[String]) -> Result<GistOperation> {
    let core = clear_core(parents)?;
    Ok(GistOperation::Clear {
        id: operation_id(&core)?,
        parents: normalized_parents(parents)?,
    })
}

fn operation_value(operation: &GistOperation) -> Value {
    match operation {
        GistOperation::State {
            id,
            parents,
            tombstones,
            vault,
        } => json!({
            "kind": GIST_OPERATION_KIND,
            "version": 2,
            "operation": "state",
            "parents": parents,
            "tombstones": tombstones,
            "vault": vault,
            "id": id,
        }),
        GistOperation::Clear { id, parents } => json!({
            "kind": GIST_OPERATION_KIND,
            "version": 2,
            "operation": "clear",
            "parents": parents,
            "tombstones": [],
            "id": id,
        }),
    }
}

pub(crate) fn serialize_operation(
    crypto: &SnapshotCrypto,
    operation: &GistOperation,
    passphrase: &str,
    updated_at: i64,
) -> Result<String> {
    let envelope = crypto.encrypt_object(
        &operation_value(operation),
        passphrase,
        GIST_OPERATION_OBJECT_TYPE,
        updated_at.max(1),
    )?;
    let serialized = serde_json::to_string_pretty(&envelope)?;
    ensure_text_size(
        &serialized,
        MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
        "Encrypted Gist sync operation",
    )?;
    Ok(serialized)
}

fn exact_keys(object: &Map<String, Value>, expected: &[&str]) -> bool {
    object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key))
}

fn parse_string_array(value: Option<&Value>) -> Result<Vec<String>> {
    let values = value
        .and_then(Value::as_array)
        .context("Remote Gist operation parents are invalid.")?;
    let parents = values
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .context("Remote Gist operation parents are invalid.")
        })
        .collect::<Result<Vec<_>>>()?;
    if normalized_parents(&parents)?.len() != parents.len() {
        bail!("Remote Gist operation parents are invalid.");
    }
    Ok(parents)
}

pub(crate) fn parse_operation(
    crypto: &SnapshotCrypto,
    content: &str,
    passphrase: &str,
    expected_id: &str,
) -> Result<GistOperation> {
    ensure_text_size(
        content,
        MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
        "Encrypted Gist sync operation",
    )?;
    let envelope: EncryptedObjectEnvelope =
        serde_json::from_str(content).context("Remote Gist operation is not valid JSON.")?;
    let value: Value = crypto.decrypt_object(&envelope, passphrase, GIST_OPERATION_OBJECT_TYPE)?;
    let object = value
        .as_object()
        .context("Remote Gist operation payload is invalid.")?;
    let operation_type = object
        .get("operation")
        .and_then(Value::as_str)
        .context("Remote Gist operation payload is invalid.")?;
    let expected_keys = if operation_type == "state" {
        &[
            "id",
            "kind",
            "operation",
            "parents",
            "tombstones",
            "vault",
            "version",
        ][..]
    } else if operation_type == "clear" {
        &[
            "id",
            "kind",
            "operation",
            "parents",
            "tombstones",
            "version",
        ][..]
    } else {
        bail!("Remote Gist operation payload is invalid.");
    };
    if !exact_keys(object, expected_keys)
        || object.get("kind").and_then(Value::as_str) != Some(GIST_OPERATION_KIND)
        || object.get("version").and_then(Value::as_i64) != Some(2)
    {
        bail!("Remote Gist operation payload is invalid.");
    }
    let embedded_id = object
        .get("id")
        .and_then(Value::as_str)
        .context("Remote Gist operation ID is invalid.")?;
    let parents = parse_string_array(object.get("parents"))?;
    let tombstones: Vec<GistTombstone> = serde_json::from_value(
        object
            .get("tombstones")
            .cloned()
            .context("Remote Gist operation tombstones are invalid.")?,
    )?;

    let operation = if operation_type == "state" {
        create_state_operation(
            &parents,
            object
                .get("vault")
                .context("Remote Gist operation vault is invalid.")?,
            &tombstones,
        )?
    } else {
        if !tombstones.is_empty() {
            bail!("Remote Gist clear operation tombstones are invalid.");
        }
        create_clear_operation(&parents)?
    };

    if embedded_id != operation.id() || expected_id != operation.id() {
        bail!("Remote Gist operation ID does not match its content.");
    }
    Ok(operation)
}

fn value_object(value: &Value) -> &Map<String, Value> {
    value
        .as_object()
        .expect("validated sync values are objects")
}

fn value_array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value_object(value)
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn string_field<'a>(value: &'a Value, key: &str) -> &'a str {
    value_object(value)
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn i64_field(value: &Value, key: &str) -> i64 {
    value_object(value)
        .get(key)
        .and_then(Value::as_i64)
        .unwrap_or_default()
}

fn sort_created_at_then_utf16_id(values: &mut [Value]) {
    values.sort_by(|left, right| {
        i64_field(left, "createdAt")
            .cmp(&i64_field(right, "createdAt"))
            .then_with(|| utf16_cmp(string_field(left, "id"), string_field(right, "id")))
    });
}

fn sort_conversation_children(conversation: &mut Value) {
    let Some(messages) = conversation
        .get_mut("messages")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for message in messages.iter_mut() {
        if let Some(attachments) = message.get_mut("attachments").and_then(Value::as_array_mut) {
            sort_created_at_then_utf16_id(attachments);
        }
    }
    sort_created_at_then_utf16_id(messages);
}

fn resolve_value(
    base: Option<&Value>,
    remote: Option<&Value>,
    local: Option<&Value>,
    prefer_local: bool,
) -> Option<Value> {
    if local == base {
        return remote.cloned();
    }
    if remote == base || local == remote {
        return local.cloned();
    }
    if prefer_local {
        local.cloned()
    } else {
        remote.cloned()
    }
}

fn merge_object_fields(
    base: Option<&Value>,
    remote: &Value,
    local: &Value,
    prefer_local: bool,
) -> Value {
    let empty = Map::new();
    let base = base.and_then(Value::as_object).unwrap_or(&empty);
    let remote = value_object(remote);
    let local = value_object(local);
    let keys = base
        .keys()
        .chain(remote.keys())
        .chain(local.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut merged = Map::new();
    for key in keys {
        if let Some(value) = resolve_value(
            base.get(&key),
            remote.get(&key),
            local.get(&key),
            prefer_local,
        ) {
            merged.insert(key, value);
        }
    }
    Value::Object(merged)
}

fn merge_string_set(
    base: Option<&Value>,
    remote: Option<&Value>,
    local: Option<&Value>,
    prefer_local: bool,
) -> Value {
    let strings = |value: Option<&Value>| {
        value
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    let base_values = strings(base);
    let remote_values = strings(remote);
    let local_values = strings(local);
    let base_set = base_values.iter().cloned().collect::<BTreeSet<_>>();
    let remote_set = remote_values.iter().cloned().collect::<BTreeSet<_>>();
    let local_set = local_values.iter().cloned().collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();
    let mut result = Vec::new();
    for value in local_values
        .iter()
        .chain(remote_values.iter())
        .chain(base_values.iter())
    {
        if !seen.insert(value.clone()) {
            continue;
        }
        let base_value = Value::Bool(base_set.contains(value));
        let remote_value = Value::Bool(remote_set.contains(value));
        let local_value = Value::Bool(local_set.contains(value));
        if resolve_value(
            Some(&base_value),
            Some(&remote_value),
            Some(&local_value),
            prefer_local,
        ) == Some(Value::Bool(true))
        {
            result.push(Value::String(value.clone()));
        }
    }
    Value::Array(result)
}

fn record_map(values: &[Value]) -> BTreeMap<String, Value> {
    values
        .iter()
        .map(|value| (string_field(value, "id").to_owned(), value.clone()))
        .collect()
}

fn ordered_record_ids(base: &[Value], remote: &[Value], local: &[Value]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut ids = Vec::new();
    for value in local.iter().chain(remote.iter()).chain(base.iter()) {
        let id = string_field(value, "id").to_owned();
        if seen.insert(id.clone()) {
            ids.push(id);
        }
    }
    ids
}

fn merge_record_list<FUpdated, FMerge>(
    base_items: &[Value],
    remote_items: &[Value],
    local_items: &[Value],
    remote_branch_updated_at: i64,
    local_branch_updated_at: i64,
    item_updated_at: FUpdated,
    mut merge_same_id: FMerge,
) -> Vec<Value>
where
    FUpdated: Fn(&Value, i64) -> i64,
    FMerge: FnMut(Option<&Value>, &Value, &Value) -> Value,
{
    let base = record_map(base_items);
    let remote = record_map(remote_items);
    let local = record_map(local_items);
    let mut merged = Vec::new();
    for id in ordered_record_ids(base_items, remote_items, local_items) {
        let base_value = base.get(&id);
        let remote_value = remote.get(&id);
        let local_value = local.get(&id);
        match (base_value, remote_value, local_value) {
            (None, Some(remote), Some(local)) => {
                merged.push(merge_same_id(None, remote, local));
            }
            (None, remote, local) => {
                if let Some(value) = local.or(remote) {
                    merged.push(value.clone());
                }
            }
            (Some(_), None, None) => {}
            (Some(base), None, Some(local)) => {
                if local != base
                    && item_updated_at(local, local_branch_updated_at) > remote_branch_updated_at
                {
                    merged.push(local.clone());
                }
            }
            (Some(base), Some(remote), None) => {
                if remote != base
                    && item_updated_at(remote, remote_branch_updated_at) > local_branch_updated_at
                {
                    merged.push(remote.clone());
                }
            }
            (Some(base), Some(remote), Some(local)) => {
                merged.push(merge_same_id(Some(base), remote, local));
            }
        }
    }
    merged
}

fn merge_attachments(
    base: Option<&Value>,
    remote: Option<&Value>,
    local: Option<&Value>,
    remote_updated_at: i64,
    local_updated_at: i64,
) -> Vec<Value> {
    let empty = Vec::new();
    let base = base.and_then(Value::as_array).unwrap_or(&empty);
    let remote = remote.and_then(Value::as_array).unwrap_or(&empty);
    let local = local.and_then(Value::as_array).unwrap_or(&empty);
    let prefer_local = local_updated_at >= remote_updated_at;
    let mut merged = merge_record_list(
        base,
        remote,
        local,
        remote_updated_at,
        local_updated_at,
        |attachment, _| i64_field(attachment, "createdAt"),
        |base, remote, local| merge_object_fields(base, remote, local, prefer_local),
    );
    sort_created_at_then_utf16_id(&mut merged);
    merged
}

fn merge_message(
    base: Option<&Value>,
    remote: &Value,
    local: &Value,
    remote_updated_at: i64,
    local_updated_at: i64,
) -> Value {
    let prefer_local = local_updated_at >= remote_updated_at;
    let mut merged = merge_object_fields(base, remote, local, prefer_local);
    let attachments = merge_attachments(
        base.and_then(|value| value.get("attachments")),
        remote.get("attachments"),
        local.get("attachments"),
        remote_updated_at,
        local_updated_at,
    );
    let object = merged.as_object_mut().unwrap();
    object.insert(
        "id".to_owned(),
        Value::String(string_field(local, "id").to_owned()),
    );
    object.insert(
        "createdAt".to_owned(),
        Value::from(i64_field(remote, "createdAt").min(i64_field(local, "createdAt"))),
    );
    if attachments.is_empty() {
        object.remove("attachments");
    } else {
        object.insert("attachments".to_owned(), Value::Array(attachments));
    }
    merged
}

fn merge_conversation(base: Option<&Value>, remote: &Value, local: &Value) -> Value {
    let remote_updated_at = i64_field(remote, "updatedAt");
    let local_updated_at = i64_field(local, "updatedAt");
    let prefer_local = local_updated_at >= remote_updated_at;
    let mut merged = merge_object_fields(base, remote, local, prefer_local);
    let mut messages = merge_record_list(
        base.map(|value| value_array(value, "messages"))
            .unwrap_or(&[]),
        value_array(remote, "messages"),
        value_array(local, "messages"),
        remote_updated_at,
        local_updated_at,
        |_, branch_updated_at| branch_updated_at,
        |base, remote, local| {
            merge_message(base, remote, local, remote_updated_at, local_updated_at)
        },
    );
    sort_created_at_then_utf16_id(&mut messages);
    let object = merged.as_object_mut().unwrap();
    object.insert(
        "id".to_owned(),
        Value::String(string_field(local, "id").to_owned()),
    );
    object.insert("messages".to_owned(), Value::Array(messages));
    object.insert(
        "createdAt".to_owned(),
        Value::from(i64_field(remote, "createdAt").min(i64_field(local, "createdAt"))),
    );
    object.insert(
        "updatedAt".to_owned(),
        Value::from(remote_updated_at.max(local_updated_at)),
    );
    sort_conversation_children(&mut merged);
    merged
}

fn merge_provider(base: Option<&Value>, remote: &Value, local: &Value) -> Value {
    let remote_updated_at = i64_field(remote, "updatedAt");
    let local_updated_at = i64_field(local, "updatedAt");
    let prefer_local = local_updated_at >= remote_updated_at;
    let mut merged = merge_object_fields(base, remote, local, prefer_local);
    let models = merge_string_set(
        base.and_then(|value| value.get("models")),
        remote.get("models"),
        local.get("models"),
        prefer_local,
    );
    let capabilities = merge_string_set(
        base.and_then(|value| value.get("capabilities")),
        remote.get("capabilities"),
        local.get("capabilities"),
        prefer_local,
    );
    let object = merged.as_object_mut().unwrap();
    object.insert(
        "id".to_owned(),
        Value::String(string_field(local, "id").to_owned()),
    );
    if models.as_array().is_some_and(Vec::is_empty) {
        object.remove("models");
    } else {
        object.insert("models".to_owned(), models);
    }
    if capabilities.as_array().is_some_and(Vec::is_empty) {
        object.remove("capabilities");
    } else {
        object.insert("capabilities".to_owned(), capabilities);
    }
    object.insert(
        "createdAt".to_owned(),
        Value::from(i64_field(remote, "createdAt").min(i64_field(local, "createdAt"))),
    );
    object.insert(
        "updatedAt".to_owned(),
        Value::from(remote_updated_at.max(local_updated_at)),
    );
    merged
}

fn merge_skill_chunk(
    base: Option<&Value>,
    remote: &Value,
    local: &Value,
    prefer_local: bool,
) -> Value {
    let mut merged = merge_object_fields(base, remote, local, prefer_local);
    let object = merged.as_object_mut().unwrap();
    object.insert(
        "id".to_owned(),
        Value::String(string_field(local, "id").to_owned()),
    );
    object.insert(
        "keywords".to_owned(),
        merge_string_set(
            base.and_then(|value| value.get("keywords")),
            remote.get("keywords"),
            local.get("keywords"),
            prefer_local,
        ),
    );
    merged
}

fn merge_skill(base: Option<&Value>, remote: &Value, local: &Value) -> Value {
    let remote_updated_at = i64_field(remote, "updatedAt");
    let local_updated_at = i64_field(local, "updatedAt");
    let prefer_local = local_updated_at >= remote_updated_at;
    let mut merged = merge_object_fields(base, remote, local, prefer_local);
    let chunks = merge_record_list(
        base.map(|value| value_array(value, "chunks"))
            .unwrap_or(&[]),
        value_array(remote, "chunks"),
        value_array(local, "chunks"),
        remote_updated_at,
        local_updated_at,
        |_, branch_updated_at| branch_updated_at,
        |base, remote, local| merge_skill_chunk(base, remote, local, prefer_local),
    );
    let object = merged.as_object_mut().unwrap();
    object.insert(
        "id".to_owned(),
        Value::String(string_field(local, "id").to_owned()),
    );
    object.insert(
        "keywords".to_owned(),
        merge_string_set(
            base.and_then(|value| value.get("keywords")),
            remote.get("keywords"),
            local.get("keywords"),
            prefer_local,
        ),
    );
    object.insert("chunks".to_owned(), Value::Array(chunks));
    object.insert(
        "createdAt".to_owned(),
        Value::from(i64_field(remote, "createdAt").min(i64_field(local, "createdAt"))),
    );
    object.insert(
        "updatedAt".to_owned(),
        Value::from(remote_updated_at.max(local_updated_at)),
    );
    merged
}

fn merge_preferences(
    base: Option<&Value>,
    remote: &Value,
    local: &Value,
    prefer_local: bool,
) -> Value {
    let mut merged = merge_object_fields(base, remote, local, prefer_local);
    let object = merged.as_object_mut().unwrap();
    for key in ["dismissedDangerWarnings", "dismissedFeatureHints"] {
        object.insert(
            key.to_owned(),
            merge_string_set(
                base.and_then(|value| value.get(key)),
                remote.get(key),
                local.get(key),
                prefer_local,
            ),
        );
    }
    merged
}

fn merge_app_data(base: Option<&Value>, remote: &Value, local: &Value) -> Value {
    let remote_updated_at = i64_field(remote, "updatedAt");
    let local_updated_at = i64_field(local, "updatedAt");
    let prefer_local = local_updated_at >= remote_updated_at;
    let mut providers = merge_record_list(
        base.map(|value| value_array(value, "providers"))
            .unwrap_or(&[]),
        value_array(remote, "providers"),
        value_array(local, "providers"),
        remote_updated_at,
        local_updated_at,
        |provider, _| i64_field(provider, "updatedAt"),
        merge_provider,
    );
    let mut conversations = merge_record_list(
        base.map(|value| value_array(value, "conversations"))
            .unwrap_or(&[]),
        value_array(remote, "conversations"),
        value_array(local, "conversations"),
        remote_updated_at,
        local_updated_at,
        |conversation, _| i64_field(conversation, "updatedAt"),
        merge_conversation,
    );
    let skills = merge_record_list(
        base.map(|value| value_array(value, "skills"))
            .unwrap_or(&[]),
        value_array(remote, "skills"),
        value_array(local, "skills"),
        remote_updated_at,
        local_updated_at,
        |skill, _| i64_field(skill, "updatedAt"),
        merge_skill,
    );
    if providers.is_empty() {
        providers = value_array(if prefer_local { local } else { remote }, "providers")
            .iter()
            .take(1)
            .cloned()
            .collect();
    }
    if conversations.is_empty() {
        conversations = value_array(if prefer_local { local } else { remote }, "conversations")
            .iter()
            .take(1)
            .cloned()
            .collect();
    }
    for conversation in &mut conversations {
        sort_conversation_children(conversation);
    }
    let provider_models = providers
        .iter()
        .map(|provider| {
            (
                string_field(provider, "id").to_owned(),
                string_field(provider, "model").to_owned(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    for conversation in &mut conversations {
        let provider_id = string_field(conversation, "providerId").to_owned();
        if provider_models.contains_key(&provider_id) {
            continue;
        }
        if let Some(fallback) = providers.first() {
            let fallback_id = string_field(fallback, "id").to_owned();
            let fallback_model = string_field(fallback, "model").to_owned();
            let updated_at =
                i64_field(conversation, "updatedAt").max(remote_updated_at.max(local_updated_at));
            let object = conversation.as_object_mut().unwrap();
            object.insert("providerId".to_owned(), Value::String(fallback_id));
            object.insert("model".to_owned(), Value::String(fallback_model));
            object.insert("updatedAt".to_owned(), Value::from(updated_at));
        }
    }
    let remote_preferences = remote.get("preferences").unwrap();
    let local_preferences = local.get("preferences").unwrap();
    let mut preferences = merge_preferences(
        base.and_then(|value| value.get("preferences")),
        remote_preferences,
        local_preferences,
        prefer_local,
    );
    let conversation_ids = conversations
        .iter()
        .map(|value| string_field(value, "id").to_owned())
        .collect::<BTreeSet<_>>();
    let candidate_active_ids = [
        preferences
            .get("activeConversationId")
            .and_then(Value::as_str),
        local_preferences
            .get("activeConversationId")
            .and_then(Value::as_str),
        remote_preferences
            .get("activeConversationId")
            .and_then(Value::as_str),
        conversations.first().map(|value| string_field(value, "id")),
    ];
    let active_id = candidate_active_ids
        .into_iter()
        .flatten()
        .find(|id| conversation_ids.contains(*id))
        .map(str::to_owned);
    if let Some(active_id) = active_id {
        preferences
            .as_object_mut()
            .unwrap()
            .insert("activeConversationId".to_owned(), Value::String(active_id));
    } else {
        preferences
            .as_object_mut()
            .unwrap()
            .remove("activeConversationId");
    }

    json!({
        "version": 1,
        "providers": providers,
        "conversations": conversations,
        "skills": skills,
        "skillSettings": merge_object_fields(
            base.and_then(|value| value.get("skillSettings")),
            remote.get("skillSettings").unwrap(),
            local.get("skillSettings").unwrap(),
            prefer_local,
        ),
        "sync": merge_object_fields(
            base.and_then(|value| value.get("sync")),
            remote.get("sync").unwrap(),
            local.get("sync").unwrap(),
            prefer_local,
        ),
        "preferences": preferences,
        "updatedAt": remote_updated_at.max(local_updated_at),
    })
}

fn append_unique_trimmed_strings(
    target: &mut Vec<Value>,
    seen: &mut BTreeSet<String>,
    value: Option<&Value>,
) {
    let Some(values) = value.and_then(Value::as_array) else {
        return;
    };
    for value in values.iter().filter_map(Value::as_str) {
        append_unique_trimmed_string(target, seen, value);
    }
}

fn append_unique_trimmed_string(target: &mut Vec<Value>, seen: &mut BTreeSet<String>, value: &str) {
    let value = value.trim();
    if !value.is_empty() && seen.insert(value.to_owned()) {
        target.push(Value::String(value.to_owned()));
    }
}

fn first_sync_string_union(
    primary: Option<&Value>,
    secondary: Option<&Value>,
    extras: &[&str],
) -> Vec<Value> {
    let mut values = Vec::new();
    let mut seen = BTreeSet::new();
    append_unique_trimmed_strings(&mut values, &mut seen, primary);
    append_unique_trimmed_strings(&mut values, &mut seen, secondary);
    for extra in extras {
        append_unique_trimmed_string(&mut values, &mut seen, extra);
    }
    values
}

fn merge_first_sync_provider(remote: &Value, local: &Value) -> Value {
    let local_is_newer = i64_field(local, "updatedAt") >= i64_field(remote, "updatedAt");
    let (primary, secondary) = if local_is_newer {
        (local, remote)
    } else {
        (remote, local)
    };
    let mut merged = value_object(primary).clone();
    for (key, value) in value_object(secondary) {
        merged.entry(key.clone()).or_insert_with(|| value.clone());
    }

    for key in [
        "model",
        "imageModel",
        "audioSpeechModel",
        "audioTranscriptionModel",
        "embeddingModel",
        "moderationModel",
        "realtimeModel",
    ] {
        let primary_value = merged.get(key).and_then(Value::as_str).unwrap_or_default();
        if primary_value.is_empty()
            && let Some(value) = secondary.get(key).and_then(Value::as_str)
            && !value.is_empty()
        {
            merged.insert(key.to_owned(), Value::String(value.to_owned()));
        }
    }

    let model_extras = [
        string_field(primary, "model"),
        string_field(secondary, "model"),
        string_field(primary, "imageModel"),
        string_field(secondary, "imageModel"),
    ];
    let models = first_sync_string_union(
        primary.get("models"),
        secondary.get("models"),
        &model_extras,
    );
    if models.is_empty() {
        merged.remove("models");
    } else {
        merged.insert("models".to_owned(), Value::Array(models));
    }

    let capabilities = first_sync_string_union(
        primary.get("capabilities"),
        secondary.get("capabilities"),
        &[],
    );
    if capabilities.is_empty() {
        merged.remove("capabilities");
    } else {
        merged.insert("capabilities".to_owned(), Value::Array(capabilities));
    }

    if primary.get("custom").and_then(Value::as_bool) == Some(true)
        || secondary.get("custom").and_then(Value::as_bool) == Some(true)
    {
        merged.insert("custom".to_owned(), Value::Bool(true));
    } else {
        merged.remove("custom");
    }
    merged.insert(
        "createdAt".to_owned(),
        Value::from(i64_field(remote, "createdAt").min(i64_field(local, "createdAt"))),
    );
    merged.insert(
        "updatedAt".to_owned(),
        Value::from(i64_field(remote, "updatedAt").max(i64_field(local, "updatedAt"))),
    );
    Value::Object(merged)
}

fn merge_first_sync_records(
    remote: &[Value],
    local: &[Value],
    merge_same_id: Option<fn(&Value, &Value) -> Value>,
) -> Vec<Value> {
    let mut merged = remote.to_vec();
    let mut indexes = remote
        .iter()
        .enumerate()
        .map(|(index, value)| (string_field(value, "id").to_owned(), index))
        .collect::<BTreeMap<_, _>>();
    for local_value in local {
        let id = string_field(local_value, "id").to_owned();
        if let Some(index) = indexes.get(&id).copied() {
            let remote_value = &merged[index];
            merged[index] = if let Some(merge_same_id) = merge_same_id {
                merge_same_id(remote_value, local_value)
            } else if i64_field(local_value, "updatedAt") >= i64_field(remote_value, "updatedAt") {
                local_value.clone()
            } else {
                remote_value.clone()
            };
        } else {
            indexes.insert(id, merged.len());
            merged.push(local_value.clone());
        }
    }
    merged
}

fn sort_updated_at_desc_then_utf16_id(values: &mut [Value]) {
    values.sort_by(|left, right| {
        i64_field(right, "updatedAt")
            .cmp(&i64_field(left, "updatedAt"))
            .then_with(|| utf16_cmp(string_field(left, "id"), string_field(right, "id")))
    });
}

fn merge_first_sync_skill_settings(remote: &Value, local: &Value) -> Value {
    let defaults = [
        ("autoMatch", Value::Bool(true)),
        ("contextBudget", Value::from(2400)),
        ("maxAutoSkills", Value::from(3)),
    ];
    let mut merged = Map::new();
    for (key, default_value) in defaults {
        let local_value = local.get(key);
        let selected = if local_value.is_some_and(|value| value != &default_value) {
            local_value
        } else {
            remote.get(key)
        };
        if let Some(selected) = selected {
            merged.insert(key.to_owned(), selected.clone());
        }
    }
    Value::Object(merged)
}

fn merge_first_sync_preferences(remote: &Value, local: &Value, conversations: &[Value]) -> Value {
    let mut merged = Map::new();
    let bool_value =
        |value: &Value, key: &str| value.get(key).and_then(Value::as_bool).unwrap_or(false);
    merged.insert(
        "firstRunDone".to_owned(),
        Value::Bool(bool_value(local, "firstRunDone") || bool_value(remote, "firstRunDone")),
    );
    let local_theme = string_field(local, "theme");
    merged.insert(
        "theme".to_owned(),
        Value::String(
            if local_theme != "system" {
                local_theme
            } else {
                string_field(remote, "theme")
            }
            .to_owned(),
        ),
    );
    let local_language = string_field(local, "language");
    merged.insert(
        "language".to_owned(),
        Value::String(
            if local_language != "system" {
                local_language
            } else {
                string_field(remote, "language")
            }
            .to_owned(),
        ),
    );
    merged.insert(
        "compactMode".to_owned(),
        Value::Bool(bool_value(local, "compactMode") || bool_value(remote, "compactMode")),
    );
    if let Some(limit) = local
        .get("chatContextMessageLimit")
        .or_else(|| remote.get("chatContextMessageLimit"))
    {
        merged.insert("chatContextMessageLimit".to_owned(), limit.clone());
    }

    let conversation_ids = conversations
        .iter()
        .map(|value| string_field(value, "id").to_owned())
        .collect::<BTreeSet<_>>();
    let active_conversation_id = [local, remote].into_iter().find_map(|preferences| {
        preferences
            .get("activeConversationId")
            .and_then(Value::as_str)
            .filter(|id| conversation_ids.contains(*id))
    });
    if let Some(active_conversation_id) = active_conversation_id {
        merged.insert(
            "activeConversationId".to_owned(),
            Value::String(active_conversation_id.to_owned()),
        );
    }

    for key in ["dismissedDangerWarnings", "dismissedFeatureHints"] {
        let values = first_sync_string_union(remote.get(key), local.get(key), &[]);
        if !values.is_empty() {
            merged.insert(key.to_owned(), Value::Array(values));
        }
    }
    Value::Object(merged)
}

pub(crate) fn merge_first_sync_vault(remote: &Value, local: &Value) -> Result<Value> {
    let remote = validated_normalized_gist_vault(remote)?;
    let local = validated_normalized_gist_vault(local)?;
    let remote_data = remote.get("data").unwrap();
    let local_data = local.get("data").unwrap();

    let providers = merge_first_sync_records(
        value_array(remote_data, "providers"),
        value_array(local_data, "providers"),
        Some(merge_first_sync_provider),
    );
    let mut conversations = merge_first_sync_records(
        value_array(remote_data, "conversations"),
        value_array(local_data, "conversations"),
        None,
    );
    for conversation in &mut conversations {
        sort_conversation_children(conversation);
    }
    sort_updated_at_desc_then_utf16_id(&mut conversations);
    let mut skills = merge_first_sync_records(
        value_array(remote_data, "skills"),
        value_array(local_data, "skills"),
        None,
    );
    sort_updated_at_desc_then_utf16_id(&mut skills);

    let mut sync = value_object(local_data.get("sync").unwrap()).clone();
    sync.insert("encryptionEnabled".to_owned(), Value::Bool(true));
    let mut provider_keys = value_object(remote.pointer("/secrets/providerKeys").unwrap()).clone();
    provider_keys.extend(value_object(local.pointer("/secrets/providerKeys").unwrap()).clone());
    let skill_settings = merge_first_sync_skill_settings(
        remote_data.get("skillSettings").unwrap(),
        local_data.get("skillSettings").unwrap(),
    );
    let preferences = merge_first_sync_preferences(
        remote_data.get("preferences").unwrap(),
        local_data.get("preferences").unwrap(),
        &conversations,
    );

    validated_normalized_gist_vault(&json!({
        "data": {
            "version": 1,
            "providers": providers,
            "conversations": conversations,
            "skills": skills,
            "skillSettings": skill_settings,
            "sync": Value::Object(sync),
            "preferences": preferences,
            "updatedAt": i64_field(remote_data, "updatedAt").max(i64_field(local_data, "updatedAt")),
        },
        "secrets": { "providerKeys": provider_keys },
    }))
}

pub(crate) fn merge_vaults(base: Option<&Value>, left: &Value, right: &Value) -> Result<Value> {
    let left = validated_normalized_gist_vault(left)?;
    let right = validated_normalized_gist_vault(right)?;
    let base = base.map(validated_normalized_gist_vault).transpose()?;
    let left_data = left.get("data").unwrap();
    let right_data = right.get("data").unwrap();
    let base_data = base.as_ref().and_then(|value| value.get("data"));
    let data = merge_app_data(base_data, left_data, right_data);

    let base_keys = base
        .as_ref()
        .and_then(|value| value.pointer("/secrets/providerKeys"))
        .and_then(Value::as_object);
    let left_keys = left
        .pointer("/secrets/providerKeys")
        .unwrap()
        .as_object()
        .unwrap();
    let right_keys = right
        .pointer("/secrets/providerKeys")
        .unwrap()
        .as_object()
        .unwrap();
    let keys = base_keys
        .into_iter()
        .flat_map(Map::keys)
        .chain(left_keys.keys())
        .chain(right_keys.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut provider_keys = Map::new();
    for key in keys {
        if let Some(value) = resolve_value(
            base_keys.and_then(|values| values.get(&key)),
            left_keys.get(&key),
            right_keys.get(&key),
            true,
        ) {
            provider_keys.insert(key, value);
        }
    }
    validated_normalized_gist_vault(&json!({
        "data": data,
        "secrets": { "providerKeys": provider_keys },
    }))
}

fn operation_ancestors(
    id: &str,
    operations: &BTreeMap<String, GistOperation>,
    memo: &mut BTreeMap<String, BTreeSet<String>>,
    visiting: &mut BTreeSet<String>,
) -> Result<BTreeSet<String>> {
    if let Some(cached) = memo.get(id) {
        return Ok(cached.clone());
    }
    if !visiting.insert(id.to_owned()) {
        bail!("Remote Gist operation graph contains a cycle.");
    }
    let mut ancestors = BTreeSet::from([id.to_owned()]);
    if let Some(operation) = operations.get(id) {
        for parent in operation.parents() {
            if !operations.contains_key(parent) {
                continue;
            }
            ancestors.extend(operation_ancestors(parent, operations, memo, visiting)?);
        }
    }
    visiting.remove(id);
    memo.insert(id.to_owned(), ancestors.clone());
    Ok(ancestors)
}

fn active_operation_ids(
    ids: &[String],
    operations: &BTreeMap<String, GistOperation>,
    ancestor_memo: &mut BTreeMap<String, BTreeSet<String>>,
) -> Result<Vec<String>> {
    let existing = ids
        .iter()
        .filter(|id| operations.contains_key(*id))
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut active = Vec::new();
    for candidate in &existing {
        let mut hidden = false;
        for other in &existing {
            if other == candidate {
                continue;
            }
            if operation_ancestors(other, operations, ancestor_memo, &mut BTreeSet::new())?
                .contains(candidate)
            {
                hidden = true;
                break;
            }
        }
        if !hidden {
            active.push(candidate.clone());
        }
    }
    Ok(active)
}

struct Materializer<'a> {
    operations: &'a BTreeMap<String, GistOperation>,
    ancestor_memo: BTreeMap<String, BTreeSet<String>>,
    group_memo: BTreeMap<String, Option<Value>>,
}

impl Materializer<'_> {
    fn common_ancestor_ids(&mut self, ids: &[String]) -> Result<Vec<String>> {
        let sets = ids
            .iter()
            .map(|id| {
                operation_ancestors(
                    id,
                    self.operations,
                    &mut self.ancestor_memo,
                    &mut BTreeSet::new(),
                )
            })
            .collect::<Result<Vec<_>>>()?;
        let Some(first) = sets.first() else {
            return Ok(Vec::new());
        };
        let common = first
            .iter()
            .filter(|id| sets.iter().skip(1).all(|set| set.contains(*id)))
            .cloned()
            .collect::<Vec<_>>();
        active_operation_ids(&common, self.operations, &mut self.ancestor_memo)
    }

    fn materialize_group(&mut self, ids: &[String]) -> Result<Option<Value>> {
        let active = active_operation_ids(ids, self.operations, &mut self.ancestor_memo)?;
        let key = active.join(",");
        if let Some(cached) = self.group_memo.get(&key) {
            return Ok(cached.clone());
        }
        if active.is_empty() {
            self.group_memo.insert(key, None);
            return Ok(None);
        }
        if active.len() == 1 {
            let value = self.operations[&active[0]].state_vault().cloned();
            self.group_memo.insert(key, value.clone());
            return Ok(value);
        }
        let mut merged: Option<Value> = None;
        let mut merged_ids = Vec::new();
        for id in active {
            let Some(current) = self.operations[&id].state_vault().cloned() else {
                continue;
            };
            let Some(previous) = merged else {
                merged = Some(current);
                merged_ids.push(id);
                continue;
            };
            let mut comparison_ids = merged_ids.clone();
            comparison_ids.push(id.clone());
            let common = self.common_ancestor_ids(&comparison_ids)?;
            let base = if common.is_empty() {
                None
            } else {
                self.materialize_group(&common)?
            };
            merged = Some(merge_vaults(base.as_ref(), &previous, &current)?);
            merged_ids.push(id);
        }
        self.group_memo.insert(key, merged.clone());
        Ok(merged)
    }
}

fn tombstone_matches(value: &Value, candidates: &[&GistTombstone]) -> Result<bool> {
    if candidates.is_empty() {
        return Ok(false);
    }
    let value_fingerprint = fingerprint(value)?;
    Ok(candidates
        .iter()
        .any(|candidate| candidate.fingerprint == value_fingerprint))
}

fn remove_tombstoned_records(vault: &Value, tombstones: &[GistTombstone]) -> Result<Value> {
    let mut vault = normalize_gist_vault(vault)?;
    let data = vault.get_mut("data").unwrap().as_object_mut().unwrap();
    let providers = data
        .get("providers")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|provider| {
            let candidates = tombstones
                .iter()
                .filter(|item| item.kind == "provider" && item.id == string_field(provider, "id"))
                .collect::<Vec<_>>();
            !tombstone_matches(provider, &candidates).unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();
    data.insert("providers".to_owned(), Value::Array(providers));

    let mut conversations = Vec::new();
    for conversation in data
        .get("conversations")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
    {
        let conversation_id = string_field(conversation, "id");
        let candidates = tombstones
            .iter()
            .filter(|item| item.kind == "conversation" && item.id == conversation_id)
            .collect::<Vec<_>>();
        if tombstone_matches(conversation, &candidates)? {
            continue;
        }
        let mut conversation = conversation.clone();
        let messages = value_array(&conversation, "messages")
            .iter()
            .filter(|message| {
                let candidates = tombstones
                    .iter()
                    .filter(|item| {
                        item.kind == "message"
                            && item.parent_id.as_deref() == Some(conversation_id)
                            && item.id == string_field(message, "id")
                    })
                    .collect::<Vec<_>>();
                !tombstone_matches(message, &candidates).unwrap_or(false)
            })
            .cloned()
            .collect::<Vec<_>>();
        conversation
            .as_object_mut()
            .unwrap()
            .insert("messages".to_owned(), Value::Array(messages));
        conversations.push(conversation);
    }
    data.insert("conversations".to_owned(), Value::Array(conversations));

    let skills = data
        .get("skills")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|skill| {
            let candidates = tombstones
                .iter()
                .filter(|item| item.kind == "skill" && item.id == string_field(skill, "id"))
                .collect::<Vec<_>>();
            !tombstone_matches(skill, &candidates).unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();
    data.insert("skills".to_owned(), Value::Array(skills));

    let keys = vault
        .pointer("/secrets/providerKeys")
        .unwrap()
        .as_object()
        .unwrap()
        .iter()
        .filter(|(provider_id, value)| {
            let candidates = tombstones
                .iter()
                .filter(|item| item.kind == "provider-secret" && item.id == **provider_id)
                .collect::<Vec<_>>();
            !tombstone_matches(value, &candidates).unwrap_or(false)
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Map<_, _>>();
    vault
        .pointer_mut("/secrets/providerKeys")
        .unwrap()
        .clone_from(&Value::Object(keys));
    validated_normalized_gist_vault(&vault)
}

fn tombstone_still_active(vault: &Value, tombstone: &GistTombstone) -> bool {
    match tombstone.kind.as_str() {
        "provider" => !value_array(vault.pointer("/data").unwrap(), "providers")
            .iter()
            .any(|value| string_field(value, "id") == tombstone.id),
        "conversation" => !value_array(vault.pointer("/data").unwrap(), "conversations")
            .iter()
            .any(|value| string_field(value, "id") == tombstone.id),
        "skill" => !value_array(vault.pointer("/data").unwrap(), "skills")
            .iter()
            .any(|value| string_field(value, "id") == tombstone.id),
        "provider-secret" => vault
            .pointer("/secrets/providerKeys")
            .and_then(Value::as_object)
            .is_none_or(|keys| !keys.contains_key(&tombstone.id)),
        "message" => vault
            .pointer("/data/conversations")
            .and_then(Value::as_array)
            .and_then(|values| {
                values.iter().find(|value| {
                    string_field(value, "id") == tombstone.parent_id.as_deref().unwrap_or_default()
                })
            })
            .is_none_or(|conversation| {
                !value_array(conversation, "messages")
                    .iter()
                    .any(|value| string_field(value, "id") == tombstone.id)
            }),
        _ => false,
    }
}

pub(crate) fn materialize_operations(
    operations: &BTreeMap<String, GistOperation>,
) -> Result<MaterializedGistOperations> {
    if operations.is_empty() {
        return Ok(MaterializedGistOperations {
            heads: Vec::new(),
            tombstones: Vec::new(),
            vault: None,
        });
    }
    let all_ids = operations.keys().cloned().collect::<Vec<_>>();
    let mut ancestor_memo = BTreeMap::new();
    let heads = active_operation_ids(&all_ids, operations, &mut ancestor_memo)?;
    let state_heads = heads
        .iter()
        .filter(|id| operations[*id].is_state())
        .cloned()
        .collect::<Vec<_>>();
    let mut materializer = Materializer {
        operations,
        ancestor_memo,
        group_memo: BTreeMap::new(),
    };
    let mut vault = materializer.materialize_group(&state_heads)?;
    let tombstones = normalized_tombstones(
        &state_heads
            .iter()
            .flat_map(|id| operations[id].state_tombstones().iter().cloned())
            .collect::<Vec<_>>(),
    )?;
    if let Some(value) = &vault {
        vault = Some(remove_tombstoned_records(value, &tombstones)?);
    }
    let active_tombstones = vault
        .as_ref()
        .map(|vault| {
            tombstones
                .iter()
                .filter(|tombstone| tombstone_still_active(vault, tombstone))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    Ok(MaterializedGistOperations {
        heads,
        tombstones: active_tombstones,
        vault,
    })
}

fn create_baseline(vault: &Value) -> Result<GistBaseline> {
    let data = vault.get("data").unwrap();
    let mut conversations = BTreeMap::new();
    for conversation in value_array(data, "conversations") {
        conversations.insert(
            string_field(conversation, "id").to_owned(),
            BaselineConversation {
                fingerprint: fingerprint(conversation)?,
                messages: value_array(conversation, "messages")
                    .iter()
                    .map(|message| {
                        Ok((
                            string_field(message, "id").to_owned(),
                            fingerprint(message)?,
                        ))
                    })
                    .collect::<Result<_>>()?,
            },
        );
    }
    let record_fingerprints = |values: &[Value]| -> Result<BTreeMap<String, String>> {
        values
            .iter()
            .map(|value| Ok((string_field(value, "id").to_owned(), fingerprint(value)?)))
            .collect()
    };
    let provider_secrets = vault
        .pointer("/secrets/providerKeys")
        .unwrap()
        .as_object()
        .unwrap()
        .iter()
        .map(|(id, value)| Ok((id.clone(), fingerprint(value)?)))
        .collect::<Result<_>>()?;
    Ok(GistBaseline {
        providers: record_fingerprints(value_array(data, "providers"))?,
        conversations,
        skills: record_fingerprints(value_array(data, "skills"))?,
        provider_secrets,
    })
}

fn missing_tombstones(
    kind: &str,
    baseline: &BTreeMap<String, String>,
    current_ids: &BTreeSet<String>,
) -> Vec<GistTombstone> {
    baseline
        .iter()
        .filter(|(id, _)| !current_ids.contains(*id))
        .map(|(id, fingerprint)| GistTombstone {
            fingerprint: fingerprint.clone(),
            id: id.clone(),
            kind: kind.to_owned(),
            parent_id: None,
        })
        .collect()
}

pub(crate) fn tombstones_from_cursor(
    cursor: &GistCursor,
    vault: &Value,
) -> Result<Vec<GistTombstone>> {
    let data = vault.get("data").unwrap();
    let ids = |values: &[Value]| {
        values
            .iter()
            .map(|value| string_field(value, "id").to_owned())
            .collect::<BTreeSet<_>>()
    };
    let providers = ids(value_array(data, "providers"));
    let conversations = ids(value_array(data, "conversations"));
    let skills = ids(value_array(data, "skills"));
    let provider_secrets = vault
        .pointer("/secrets/providerKeys")
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut tombstones = missing_tombstones("provider", &cursor.baseline.providers, &providers);
    tombstones.extend(missing_tombstones(
        "conversation",
        &cursor
            .baseline
            .conversations
            .iter()
            .map(|(id, value)| (id.clone(), value.fingerprint.clone()))
            .collect(),
        &conversations,
    ));
    tombstones.extend(missing_tombstones(
        "skill",
        &cursor.baseline.skills,
        &skills,
    ));
    tombstones.extend(missing_tombstones(
        "provider-secret",
        &cursor.baseline.provider_secrets,
        &provider_secrets,
    ));
    for conversation in value_array(data, "conversations") {
        let conversation_id = string_field(conversation, "id");
        let Some(baseline) = cursor.baseline.conversations.get(conversation_id) else {
            continue;
        };
        let message_ids = ids(value_array(conversation, "messages"));
        for (id, message_fingerprint) in &baseline.messages {
            if !message_ids.contains(id) {
                tombstones.push(GistTombstone {
                    fingerprint: message_fingerprint.clone(),
                    id: id.clone(),
                    kind: "message".to_owned(),
                    parent_id: Some(conversation_id.to_owned()),
                });
            }
        }
    }
    normalized_tombstones(&tombstones)
}

pub(crate) fn tombstones_between_vaults(
    baseline: &Value,
    current: &Value,
) -> Result<Vec<GistTombstone>> {
    let cursor = GistCursor {
        baseline: create_baseline(baseline)?,
        heads: Vec::new(),
        local_sync_at: 0,
        version: GIST_CURSOR_VERSION,
    };
    tombstones_from_cursor(&cursor, current)
}

fn resolve_data_home(xdg_data_home: Option<OsString>, home: Option<OsString>) -> Result<PathBuf> {
    if let Some(path) = xdg_data_home
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
    {
        return Ok(path);
    }
    let home = home
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .context("Local Gist cursor directory is unavailable.")?;
    Ok(home.join(".local/share"))
}

fn cursor_path(gist_id: &str, file_name: &str) -> Result<PathBuf> {
    let base = resolve_data_home(std::env::var_os("XDG_DATA_HOME"), std::env::var_os("HOME"))?;
    let dir = base.join("zerochat");
    fs::create_dir_all(&dir)?;
    let key = sha256_hex(format!("{gist_id}\0{file_name}").as_bytes());
    Ok(dir.join(format!("gist-sync-cursor-v2-{key}.json")))
}

fn write_cursor(path: &Path, cursor: &GistCursor) -> Result<()> {
    let temporary = path.with_extension("json.tmp");
    let result = (|| -> Result<()> {
        let mut options = OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary)?;
        file.write_all(serde_json::to_string(cursor)?.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)?;
        if let Some(parent) = path.parent() {
            File::open(parent)?.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(crate) fn load_cursor(
    gist_id: &str,
    file_name: &str,
    local_sync_at: Option<i64>,
) -> Option<GistCursor> {
    let local_sync_at = local_sync_at?;
    let path = cursor_path(gist_id, file_name).ok()?;
    let cursor: GistCursor = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    (cursor.version == GIST_CURSOR_VERSION && cursor.local_sync_at == local_sync_at)
        .then_some(cursor)
}

pub(crate) fn store_cursor(
    gist_id: &str,
    file_name: &str,
    heads: &[String],
    local_sync_at: Option<i64>,
    vault: &Value,
) {
    let Some(local_sync_at) = local_sync_at else {
        return;
    };
    let Ok(path) = cursor_path(gist_id, file_name) else {
        return;
    };
    let Ok(baseline) = create_baseline(vault) else {
        return;
    };
    let Ok(heads) = normalized_parents(heads) else {
        return;
    };
    let cursor = GistCursor {
        baseline,
        heads,
        local_sync_at,
        version: GIST_CURSOR_VERSION,
    };
    let _ = write_cursor(&path, &cursor);
}

pub(crate) fn clear_cursor(gist_id: &str, file_name: &str) {
    if let Ok(path) = cursor_path(gist_id, file_name) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_vault_value() -> Value {
        normalize_gist_vault(&json!({
            "data": {
                "version": 1,
                "providers": [{
                    "id": "provider-1",
                    "name": "Provider",
                    "kind": "openai-responses",
                    "baseUrl": "https://example.com/v1",
                    "clientRequestMode": false,
                    "model": "model-1",
                    "models": ["model-1"],
                    "capabilities": ["chat"],
                    "enabled": true,
                    "needsApiKey": true,
                    "createdAt": 1,
                    "updatedAt": 1
                }],
                "conversations": [{
                    "id": "conversation-1",
                    "title": "Conversation",
                    "providerId": "provider-1",
                    "model": "model-1",
                    "messages": [],
                    "createdAt": 1,
                    "updatedAt": 1
                }],
                "skills": [],
                "skillSettings": {
                    "autoMatch": true,
                    "contextBudget": 2400,
                    "maxAutoSkills": 3
                },
                "sync": {
                    "mode": "gist",
                    "autoSync": true,
                    "encryptionEnabled": true
                },
                "preferences": {
                    "firstRunDone": true,
                    "theme": "system",
                    "language": "system",
                    "compactMode": false,
                    "chatContextMessageLimit": 24
                },
                "updatedAt": 1
            },
            "secrets": { "providerKeys": {} }
        }))
        .unwrap()
    }

    fn message(id: &str, created_at: i64) -> Value {
        json!({
            "id": id,
            "role": "user",
            "content": id,
            "createdAt": created_at,
        })
    }

    fn attachment(id: &str, created_at: i64) -> Value {
        json!({
            "id": id,
            "kind": "image",
            "mimeType": "image/png",
            "dataUrl": "data:image/png;base64,AA==",
            "createdAt": created_at,
        })
    }

    fn conversation(id: &str, title: &str, updated_at: i64) -> Value {
        json!({
            "id": id,
            "title": title,
            "providerId": "provider-1",
            "model": "model-1",
            "messages": [],
            "createdAt": 1,
            "updatedAt": updated_at,
        })
    }

    fn skill(id: &str, name: &str, updated_at: i64) -> Value {
        json!({
            "id": id,
            "name": name,
            "description": "",
            "contentType": "text",
            "sourceSize": 4,
            "contentHash": "hash",
            "keywords": [],
            "chunks": [{
                "id": format!("chunk-{id}"),
                "heading": "Heading",
                "content": "Body",
                "keywords": [],
                "tokenEstimate": 1,
            }],
            "fixed": false,
            "enabled": true,
            "autoMatch": true,
            "createdAt": 1,
            "updatedAt": updated_at,
        })
    }

    fn with_messages(mut vault: Value, messages: Vec<Value>, updated_at: i64) -> Value {
        let conversation = vault
            .pointer_mut("/data/conversations/0")
            .unwrap()
            .as_object_mut()
            .unwrap();
        conversation.insert("messages".to_owned(), Value::Array(messages));
        conversation.insert("updatedAt".to_owned(), Value::from(updated_at));
        vault
            .pointer_mut("/data/updatedAt")
            .unwrap()
            .clone_from(&Value::from(updated_at));
        normalize_gist_vault(&vault).unwrap()
    }

    #[test]
    fn matches_shared_golden_operation_ids_and_file_names() {
        let vectors: Value = serde_json::from_str(include_str!(
            "../../../shared/examples/gist-operation-v2-vectors.json"
        ))
        .unwrap();
        let base_file = vectors["baseFileName"].as_str().unwrap();
        let vector_parents = vectors["clear"]["core"]["parents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        let parent_input = vec![
            vector_parents[1].clone(),
            vector_parents[0].clone(),
            vector_parents[1].clone(),
        ];
        let clear = create_clear_operation(&parent_input).unwrap();
        assert_eq!(
            clear.id(),
            vectors["clear"]["operationId"].as_str().unwrap()
        );
        assert_eq!(
            gist_operation_file_name(base_file, clear.id()),
            vectors["clear"]["fileName"].as_str().unwrap()
        );
        assert_eq!(
            canonical_json(&clear_core(clear.parents()).unwrap()).unwrap(),
            vectors["clear"]["canonicalJson"].as_str().unwrap()
        );

        let tombstones: Vec<GistTombstone> =
            serde_json::from_value(vectors["state"]["core"]["tombstones"].clone()).unwrap();
        let state = create_state_operation(
            &parent_input,
            &vectors["state"]["core"]["vault"],
            &tombstones,
        )
        .unwrap();
        assert_eq!(
            state.id(),
            vectors["state"]["operationId"].as_str().unwrap()
        );
        assert_eq!(
            gist_operation_file_name(base_file, state.id()),
            vectors["state"]["fileName"].as_str().unwrap()
        );
        let GistOperation::State {
            parents,
            tombstones,
            vault,
            ..
        } = state
        else {
            unreachable!();
        };
        assert_eq!(
            canonical_json(&state_core(&parents, &vault, &tombstones).unwrap()).unwrap(),
            vectors["state"]["canonicalJson"].as_str().unwrap()
        );
    }

    #[test]
    fn normalization_matches_shared_defaults_and_materializes_missing_top_level_defaults() {
        let vectors: Value = serde_json::from_str(include_str!(
            "../../../shared/examples/gist-operation-v2-vectors.json"
        ))
        .unwrap();
        assert_eq!(
            normalize_gist_vault(&vectors["normalization"]["input"]).unwrap(),
            vectors["normalization"]["normalized"]
        );

        let mut missing_defaults = vectors["state"]["core"]["vault"].clone();
        let data = missing_defaults["data"].as_object_mut().unwrap();
        data.remove("skills");
        data.remove("skillSettings");
        let normalized = normalize_gist_vault(&missing_defaults).unwrap();
        assert_eq!(normalized["data"]["skills"], json!([]));
        assert_eq!(
            normalized["data"]["skillSettings"],
            json!({
                "autoMatch": true,
                "contextBudget": 2400,
                "maxAutoSkills": 3,
            })
        );
        assert_eq!(
            create_state_operation(&[], &missing_defaults, &[])
                .unwrap()
                .id(),
            create_state_operation(&[], &normalized, &[]).unwrap().id()
        );
    }

    #[test]
    fn canonical_json_uses_utf16_code_unit_order_for_non_bmp_keys() {
        let non_bmp = "\u{10000}";
        let private_use = "\u{e000}";
        let value = Value::Object(Map::from_iter([
            (private_use.to_owned(), Value::from(1)),
            (non_bmp.to_owned(), Value::from(2)),
        ]));

        assert_eq!(
            canonical_json(&value).unwrap(),
            format!("{{\"{non_bmp}\":2,\"{private_use}\":1}}")
        );
    }

    #[test]
    fn tombstones_use_the_same_utf16_order_without_locale_collation() {
        let non_bmp = "\u{10000}";
        let private_use = "\u{e000}";
        let tombstones = normalized_tombstones(&[
            GistTombstone {
                fingerprint: "1".repeat(64),
                id: private_use.to_owned(),
                kind: "provider".to_owned(),
                parent_id: None,
            },
            GistTombstone {
                fingerprint: "2".repeat(64),
                id: non_bmp.to_owned(),
                kind: "provider".to_owned(),
                parent_id: None,
            },
        ])
        .unwrap();

        assert_eq!(tombstones[0].id, non_bmp);
        assert_eq!(tombstones[1].id, private_use);
    }

    #[test]
    fn operation_rejects_non_hex_parent_and_fingerprint() {
        assert!(create_clear_operation(&["a".repeat(64)]).is_ok());
        assert!(create_clear_operation(&["z".repeat(64)]).is_err());
        let invalid_tombstone = GistTombstone {
            fingerprint: "z".repeat(64),
            id: "message-1".to_owned(),
            kind: "message".to_owned(),
            parent_id: Some("conversation-1".to_owned()),
        };
        assert!(create_state_operation(&[], &default_vault_value(), &[invalid_tombstone]).is_err());

        let message_without_parent = GistTombstone {
            fingerprint: "0".repeat(64),
            id: "message-1".to_owned(),
            kind: "message".to_owned(),
            parent_id: None,
        };
        let provider_with_parent = GistTombstone {
            fingerprint: "0".repeat(64),
            id: "provider-1".to_owned(),
            kind: "provider".to_owned(),
            parent_id: Some("conversation-1".to_owned()),
        };
        assert!(
            create_state_operation(&[], &default_vault_value(), &[message_without_parent]).is_err()
        );
        assert!(
            create_state_operation(&[], &default_vault_value(), &[provider_with_parent]).is_err()
        );
    }

    #[test]
    fn concurrent_state_heads_preserve_both_messages() {
        let base_vault = with_messages(default_vault_value(), Vec::new(), 10);
        let base = create_state_operation(&[], &base_vault, &[]).unwrap();
        let left = create_state_operation(
            &[base.id().to_owned()],
            &with_messages(base_vault.clone(), vec![message("left", 20)], 20),
            &[],
        )
        .unwrap();
        let right = create_state_operation(
            &[base.id().to_owned()],
            &with_messages(base_vault, vec![message("right", 30)], 30),
            &[],
        )
        .unwrap();
        let operations = [base, left, right]
            .into_iter()
            .map(|operation| (operation.id().to_owned(), operation))
            .collect();
        let result = materialize_operations(&operations).unwrap();
        let vault = result.vault.unwrap();
        let ids = vault
            .pointer("/data/conversations/0/messages")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|value| string_field(value, "id"))
            .collect::<Vec<_>>();
        assert_eq!(ids, ["left", "right"]);
    }

    #[test]
    fn merged_messages_and_attachments_use_utf16_id_tie_breaks() {
        let non_bmp = "\u{10000}";
        let private_use = "\u{e000}";
        let mut shared_remote = message("shared", 20);
        shared_remote.as_object_mut().unwrap().insert(
            "attachments".to_owned(),
            Value::Array(vec![attachment(private_use, 5)]),
        );
        let mut shared_local = message("shared", 20);
        shared_local.as_object_mut().unwrap().insert(
            "attachments".to_owned(),
            Value::Array(vec![attachment(non_bmp, 5)]),
        );
        let remote = with_messages(
            default_vault_value(),
            vec![message(private_use, 10), shared_remote],
            30,
        );
        let local = with_messages(
            default_vault_value(),
            vec![message(non_bmp, 10), shared_local],
            30,
        );

        let merged = merge_vaults(None, &remote, &local).unwrap();
        let messages = merged["data"]["conversations"][0]["messages"]
            .as_array()
            .unwrap();
        assert_eq!(
            messages
                .iter()
                .map(|value| string_field(value, "id"))
                .collect::<Vec<_>>(),
            [non_bmp, private_use, "shared"]
        );
        assert_eq!(
            messages[2]["attachments"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| string_field(value, "id"))
                .collect::<Vec<_>>(),
            [non_bmp, private_use]
        );
    }

    #[test]
    fn first_sync_merge_matches_provider_preferences_settings_and_secret_semantics() {
        let non_bmp = "\u{10000}";
        let private_use = "\u{e000}";
        let mut remote = default_vault_value();
        let mut local = default_vault_value();

        let remote_provider = remote["data"]["providers"][0].as_object_mut().unwrap();
        remote_provider.insert("name".to_owned(), Value::String("Remote".to_owned()));
        remote_provider.insert("model".to_owned(), Value::String("remote-model".to_owned()));
        remote_provider.insert(
            "imageModel".to_owned(),
            Value::String("remote-image".to_owned()),
        );
        remote_provider.insert(
            "audioSpeechModel".to_owned(),
            Value::String("remote-speech".to_owned()),
        );
        remote_provider.insert("models".to_owned(), json!(["remote-model"]));
        remote_provider.insert("capabilities".to_owned(), json!(["chat"]));
        remote_provider.insert("custom".to_owned(), Value::Bool(true));
        remote_provider.insert("createdAt".to_owned(), Value::from(5));
        remote_provider.insert("updatedAt".to_owned(), Value::from(10));

        let local_provider = local["data"]["providers"][0].as_object_mut().unwrap();
        local_provider.insert("name".to_owned(), Value::String("Local".to_owned()));
        local_provider.insert("model".to_owned(), Value::String("local-model".to_owned()));
        local_provider.insert("models".to_owned(), json!(["local-model"]));
        local_provider.insert("capabilities".to_owned(), json!(["image"]));
        local_provider.insert("custom".to_owned(), Value::Bool(false));
        local_provider.insert("createdAt".to_owned(), Value::from(7));
        local_provider.insert("updatedAt".to_owned(), Value::from(20));

        remote["data"]["conversations"] = Value::Array(vec![
            conversation(private_use, "Remote Unicode", 50),
            conversation("shared", "Remote Shared", 20),
        ]);
        local["data"]["conversations"] = Value::Array(vec![
            conversation(non_bmp, "Local Unicode", 50),
            conversation("shared", "Local Shared", 30),
        ]);
        remote["data"]["skills"] = Value::Array(vec![
            skill(private_use, "Remote Unicode", 50),
            skill("shared", "Remote Shared", 20),
        ]);
        local["data"]["skills"] = Value::Array(vec![
            skill(non_bmp, "Local Unicode", 50),
            skill("shared", "Local Shared", 30),
        ]);
        remote["data"]["skillSettings"] = json!({
            "autoMatch": false,
            "contextBudget": 3600,
            "maxAutoSkills": 5,
        });
        local["data"]["skillSettings"] = json!({
            "autoMatch": true,
            "contextBudget": 2400,
            "maxAutoSkills": 3,
        });
        remote["data"]["preferences"] = json!({
            "firstRunDone": false,
            "theme": "dark",
            "language": "zh-CN",
            "compactMode": true,
            "chatContextMessageLimit": 64,
            "activeConversationId": private_use,
            "dismissedDangerWarnings": ["remote", "shared"],
            "dismissedFeatureHints": ["remote-hint"],
        });
        local["data"]["preferences"] = json!({
            "firstRunDone": true,
            "theme": "system",
            "language": "en-US",
            "compactMode": false,
            "chatContextMessageLimit": 24,
            "activeConversationId": "missing",
            "dismissedDangerWarnings": ["local", "shared"],
            "dismissedFeatureHints": ["local-hint"],
        });
        remote["data"]["updatedAt"] = Value::from(100);
        local["data"]["updatedAt"] = Value::from(200);
        local["data"]["sync"]["autoSync"] = Value::Bool(false);
        remote["secrets"]["providerKeys"] = json!({
            "provider-1": "remote-secret",
            "remote-only": "remote-only-secret",
        });
        local["secrets"]["providerKeys"] = json!({
            "provider-1": "local-secret",
        });

        let merged = merge_first_sync_vault(&remote, &local).unwrap();
        let provider = &merged["data"]["providers"][0];
        assert_eq!(provider["name"], "Local");
        assert_eq!(provider["audioSpeechModel"], "remote-speech");
        assert_eq!(
            provider["models"],
            json!(["local-model", "remote-model", "remote-image"])
        );
        assert_eq!(provider["capabilities"], json!(["image", "chat"]));
        assert_eq!(provider["custom"], true);
        assert_eq!(provider["createdAt"], 5);
        assert_eq!(provider["updatedAt"], 20);
        assert_eq!(
            merged["data"]["conversations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| string_field(value, "id"))
                .collect::<Vec<_>>(),
            [non_bmp, private_use, "shared"]
        );
        assert_eq!(merged["data"]["conversations"][2]["title"], "Local Shared");
        assert_eq!(
            merged["data"]["skills"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| string_field(value, "id"))
                .collect::<Vec<_>>(),
            [non_bmp, private_use, "shared"]
        );
        assert_eq!(merged["data"]["skills"][2]["name"], "Local Shared");
        assert_eq!(
            merged["data"]["skillSettings"],
            remote["data"]["skillSettings"]
        );
        assert_eq!(merged["data"]["preferences"]["theme"], "dark");
        assert_eq!(merged["data"]["preferences"]["language"], "en-US");
        assert_eq!(merged["data"]["preferences"]["firstRunDone"], true);
        assert_eq!(merged["data"]["preferences"]["compactMode"], true);
        assert_eq!(merged["data"]["preferences"]["chatContextMessageLimit"], 64);
        assert_eq!(
            merged["data"]["preferences"]["activeConversationId"],
            private_use
        );
        assert_eq!(
            merged["data"]["preferences"]["dismissedDangerWarnings"],
            json!(["remote", "shared", "local"])
        );
        assert_eq!(merged["data"]["sync"]["autoSync"], false);
        assert_eq!(merged["data"]["updatedAt"], 200);
        assert_eq!(
            merged["secrets"]["providerKeys"]["provider-1"],
            "local-secret"
        );
        assert_eq!(
            merged["secrets"]["providerKeys"]["remote-only"],
            "remote-only-secret"
        );
    }

    #[test]
    fn message_tombstone_wins_over_stale_copy_and_keeps_concurrent_append() {
        let original = message("original", 10);
        let base_vault = with_messages(default_vault_value(), vec![original.clone()], 10);
        let base = create_state_operation(&[], &base_vault, &[]).unwrap();
        let tombstone = GistTombstone {
            fingerprint: fingerprint(&original).unwrap(),
            id: "original".to_owned(),
            kind: "message".to_owned(),
            parent_id: Some(string_field(&base_vault["data"]["conversations"][0], "id").to_owned()),
        };
        let deletion = create_state_operation(
            &[base.id().to_owned()],
            &with_messages(base_vault.clone(), vec![], 20),
            &[tombstone],
        )
        .unwrap();
        let append = create_state_operation(
            &[base.id().to_owned()],
            &with_messages(base_vault, vec![original, message("new", 30)], 30),
            &[],
        )
        .unwrap();
        let operations = [base, deletion, append]
            .into_iter()
            .map(|operation| (operation.id().to_owned(), operation))
            .collect();
        let result = materialize_operations(&operations).unwrap();
        let vault = result.vault.unwrap();
        let ids = vault
            .pointer("/data/conversations/0/messages")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|value| string_field(value, "id"))
            .collect::<Vec<_>>();
        assert_eq!(ids, ["new"]);
    }

    #[test]
    fn concurrent_state_survives_clear_but_descendant_clear_is_durable() {
        let base_vault = default_vault_value();
        let base = create_state_operation(&[], &base_vault, &[]).unwrap();
        let clear = create_clear_operation(&[base.id().to_owned()]).unwrap();
        let concurrent = create_state_operation(
            &[base.id().to_owned()],
            &with_messages(base_vault, vec![message("survives", 20)], 20),
            &[],
        )
        .unwrap();
        let operations = [base.clone(), clear, concurrent]
            .into_iter()
            .map(|operation| (operation.id().to_owned(), operation))
            .collect();
        assert!(materialize_operations(&operations).unwrap().vault.is_some());

        let clear = create_clear_operation(&[base.id().to_owned()]).unwrap();
        let operations = [base, clear]
            .into_iter()
            .map(|operation| (operation.id().to_owned(), operation))
            .collect();
        assert!(materialize_operations(&operations).unwrap().vault.is_none());
    }

    #[test]
    fn rejects_corruption_and_wrong_file_id() {
        let crypto = SnapshotCrypto::new();
        let operation = create_state_operation(&[], &default_vault_value(), &[]).unwrap();
        let content = serialize_operation(&crypto, &operation, "test-passphrase", 10).unwrap();
        assert!(parse_operation(&crypto, "{bad", "test-passphrase", operation.id()).is_err());
        assert!(parse_operation(&crypto, &content, "test-passphrase", &"0".repeat(64)).is_err());

        let mut invalid_embedded_id = operation_value(&operation);
        invalid_embedded_id
            .as_object_mut()
            .unwrap()
            .insert("id".to_owned(), Value::String("z".repeat(64)));
        let invalid_content = serde_json::to_string(
            &crypto
                .encrypt_object(
                    &invalid_embedded_id,
                    "test-passphrase",
                    GIST_OPERATION_OBJECT_TYPE,
                    10,
                )
                .unwrap(),
        )
        .unwrap();
        assert!(
            parse_operation(&crypto, &invalid_content, "test-passphrase", operation.id()).is_err()
        );
    }
}
