use crate::{
    models::{
        AttachmentContentChunk, ConversationChunk, IncrementalAttachmentRef, IncrementalChunkRef,
        IncrementalManifest, IncrementalSkillRef, IncrementalSyncHead, SkillContentChunk,
        UserSkillChunk,
    },
    sync_incremental_helpers::{
        INCREMENTAL_CHUNK_SIZE, attachment_chunk_fingerprint, attachment_chunk_object_type,
        attachment_ref_key, chunk_fingerprint, chunk_object_type, is_safe_object_key,
        skill_chunk_fingerprint, skill_chunk_object_type, skill_ref_key,
    },
    sync_vault_validation::has_unique_snapshot_record_ids,
};
use anyhow::{Result, bail};
use std::collections::{HashMap, HashSet};

fn valid_incremental_fingerprint(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn indexes_are_contiguous(indexes: &mut [i32]) -> bool {
    indexes.sort_unstable();
    indexes
        .iter()
        .enumerate()
        .all(|(expected, actual)| usize::try_from(*actual) == Ok(expected))
}

pub(crate) fn validate_incremental_manifest(
    manifest: &IncrementalManifest,
    head: &IncrementalSyncHead,
) -> Result<()> {
    if manifest.kind != "zerochat.incrementalManifest"
        || manifest.version != 1
        || manifest.updated_at <= 0
        || manifest.updated_at != head.updated_at
        || !has_unique_snapshot_record_ids(&manifest.data)
    {
        bail!("Remote incremental manifest is invalid.");
    }

    let conversation_ids = manifest
        .data
        .conversations
        .iter()
        .map(|conversation| conversation.id.as_str())
        .collect::<HashSet<_>>();
    let skill_chunks = manifest
        .data
        .skills
        .iter()
        .flat_map(|skill| {
            skill
                .chunks
                .iter()
                .map(move |chunk| (skill.id.as_str(), chunk.id.as_str()))
        })
        .collect::<HashSet<_>>();
    let mut object_keys = HashSet::new();
    let mut conversation_indexes = HashMap::<&str, Vec<i32>>::new();
    let mut skill_references = HashSet::new();
    let mut attachment_indexes = HashMap::<String, Vec<i32>>::new();
    let mut attachment_chunk_counts = HashMap::<String, i32>::new();

    for reference in &manifest.chunks {
        if reference.conversation_id.is_empty()
            || !conversation_ids.contains(reference.conversation_id.as_str())
            || reference.index < 0
            || !is_safe_object_key(&reference.key)
            || !reference.key.starts_with("chunk-")
            || reference.object_type
                != chunk_object_type(&reference.conversation_id, reference.index)
            || !valid_incremental_fingerprint(&reference.fingerprint)
            || !(0..=INCREMENTAL_CHUNK_SIZE as i32).contains(&reference.message_count)
            || reference.updated_at <= 0
            || !object_keys.insert(reference.key.as_str())
        {
            bail!("Remote incremental manifest is invalid.");
        }
        conversation_indexes
            .entry(reference.conversation_id.as_str())
            .or_default()
            .push(reference.index);
    }

    if conversation_indexes
        .values_mut()
        .any(|indexes| !indexes_are_contiguous(indexes))
    {
        bail!("Remote incremental manifest is invalid.");
    }

    for reference in &manifest.skill_chunks {
        let identity = (reference.skill_id.as_str(), reference.chunk_id.as_str());
        if reference.skill_id.is_empty()
            || reference.chunk_id.is_empty()
            || !skill_chunks.contains(&identity)
            || !is_safe_object_key(&reference.key)
            || !reference.key.starts_with("skill-")
            || reference.object_type
                != skill_chunk_object_type(&reference.skill_id, &reference.chunk_id)
            || !valid_incremental_fingerprint(&reference.fingerprint)
            || reference.updated_at <= 0
            || !skill_references.insert(identity)
            || !object_keys.insert(reference.key.as_str())
        {
            bail!("Remote incremental manifest is invalid.");
        }
    }

    for reference in &manifest.attachment_chunks {
        let identity = attachment_ref_key(
            &reference.conversation_id,
            &reference.message_id,
            &reference.attachment_id,
        );
        if reference.conversation_id.is_empty()
            || reference.message_id.is_empty()
            || reference.attachment_id.is_empty()
            || !conversation_ids.contains(reference.conversation_id.as_str())
            || reference.index < 0
            || reference.chunk_count <= 0
            || reference.index >= reference.chunk_count
            || !is_safe_object_key(&reference.key)
            || !reference.key.starts_with("attachment-")
            || reference.object_type
                != attachment_chunk_object_type(
                    &reference.conversation_id,
                    &reference.message_id,
                    &reference.attachment_id,
                    reference.index,
                )
            || !valid_incremental_fingerprint(&reference.fingerprint)
            || reference.updated_at <= 0
            || !object_keys.insert(reference.key.as_str())
        {
            bail!("Remote incremental manifest is invalid.");
        }

        if attachment_chunk_counts
            .insert(identity.clone(), reference.chunk_count)
            .is_some_and(|count| count != reference.chunk_count)
        {
            bail!("Remote incremental manifest is invalid.");
        }
        attachment_indexes
            .entry(identity)
            .or_default()
            .push(reference.index);
    }

    for (identity, indexes) in &mut attachment_indexes {
        if attachment_chunk_counts.get(identity).copied() != Some(indexes.len() as i32)
            || !indexes_are_contiguous(indexes)
        {
            bail!("Remote incremental manifest is invalid.");
        }
    }

    Ok(())
}

pub(crate) fn conversation_refs_by_id(
    manifest: &IncrementalManifest,
) -> HashMap<String, Vec<IncrementalChunkRef>> {
    let mut refs_by_conversation: HashMap<String, Vec<IncrementalChunkRef>> = HashMap::new();
    for reference in &manifest.chunks {
        refs_by_conversation
            .entry(reference.conversation_id.clone())
            .or_default()
            .push(reference.clone());
    }
    refs_by_conversation
}

pub(crate) fn attachment_refs_by_id(
    manifest: &IncrementalManifest,
) -> HashMap<String, Vec<IncrementalAttachmentRef>> {
    let mut refs = HashMap::new();
    for reference in &manifest.attachment_chunks {
        refs.entry(attachment_ref_key(
            &reference.conversation_id,
            &reference.message_id,
            &reference.attachment_id,
        ))
        .or_insert_with(Vec::new)
        .push(reference.clone());
    }
    refs
}

pub(crate) fn skill_refs_by_chunk(
    manifest: &IncrementalManifest,
) -> HashMap<String, IncrementalSkillRef> {
    manifest
        .skill_chunks
        .iter()
        .map(|reference| {
            (
                skill_ref_key(&reference.skill_id, &reference.chunk_id),
                reference.clone(),
            )
        })
        .collect()
}

pub(crate) fn skill_ref_for_chunk<'a>(
    refs: &'a HashMap<String, IncrementalSkillRef>,
    skill_id: &str,
    chunk_id: &str,
) -> Option<&'a IncrementalSkillRef> {
    refs.get(&skill_ref_key(skill_id, chunk_id))
}

pub(crate) fn validate_conversation_chunk(
    chunk: &ConversationChunk,
    reference: &IncrementalChunkRef,
) -> Result<()> {
    if chunk.kind != "zerochat.conversationChunk"
        || chunk.version != 1
        || chunk.conversation_id != reference.conversation_id
        || chunk.index != reference.index
        || chunk.updated_at != reference.updated_at
        || chunk.fingerprint != reference.fingerprint
        || chunk_fingerprint(
            &reference.conversation_id,
            reference.index,
            &chunk.messages,
            chunk.updated_at,
        )? != reference.fingerprint
        || usize::try_from(reference.message_count).ok() != Some(chunk.messages.len())
    {
        bail!("Remote message chunk does not match its manifest reference.");
    }
    Ok(())
}

pub(crate) fn validate_skill_chunk(
    chunk: &SkillContentChunk,
    reference: &IncrementalSkillRef,
) -> Result<()> {
    if chunk.kind != "zerochat.skillChunk"
        || chunk.version != 1
        || chunk.skill_id != reference.skill_id
        || chunk.chunk_id != reference.chunk_id
        || chunk.updated_at != reference.updated_at
        || chunk.fingerprint != reference.fingerprint
        || skill_chunk_fingerprint(&reference.skill_id, &reference.chunk_id, &chunk.content)?
            != reference.fingerprint
    {
        bail!("Remote Skill chunk does not match its manifest reference.");
    }
    Ok(())
}

pub(crate) fn validate_attachment_chunk(
    chunk: &AttachmentContentChunk,
    reference: &IncrementalAttachmentRef,
) -> Result<()> {
    if chunk.kind != "zerochat.attachmentChunk"
        || chunk.version != 1
        || chunk.conversation_id != reference.conversation_id
        || chunk.message_id != reference.message_id
        || chunk.attachment_id != reference.attachment_id
        || chunk.index != reference.index
        || chunk.chunk_count != reference.chunk_count
        || chunk.updated_at != reference.updated_at
        || chunk.fingerprint != reference.fingerprint
        || chunk.content.is_empty()
        || attachment_chunk_fingerprint(
            &reference.conversation_id,
            &reference.message_id,
            &reference.attachment_id,
            reference.index,
            &chunk.content,
        )? != reference.fingerprint
    {
        bail!("Remote message chunk does not match its manifest reference.");
    }
    Ok(())
}

pub(crate) fn materialize_skill_chunk(
    chunk: &UserSkillChunk,
    content: String,
) -> Result<UserSkillChunk> {
    if content.is_empty() {
        bail!("Remote Skill content is missing.");
    }

    let mut copy = chunk.clone();
    copy.content = content;
    copy.content_ref = None;
    Ok(copy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        defaults::default_snapshot,
        models::{
            Conversation, IncrementalAttachmentRef, IncrementalChunkRef, IncrementalManifest,
            IncrementalSyncHead, ProviderSecrets,
        },
    };

    const FINGERPRINT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn head() -> IncrementalSyncHead {
        IncrementalSyncHead {
            kind: "zerochat.incrementalHead".to_owned(),
            version: 1,
            manifest_key: "manifest-00000000-0000-4000-8000-000000000001.json".to_owned(),
            updated_at: 10,
        }
    }

    fn manifest() -> IncrementalManifest {
        let mut data = default_snapshot();
        data.updated_at = 10;
        data.conversations.push(Conversation {
            id: "conversation".to_owned(),
            title: "Conversation".to_owned(),
            provider_id: "openai".to_owned(),
            model: "gpt-5.5".to_owned(),
            messages: Vec::new(),
            created_at: 10,
            updated_at: 10,
        });
        IncrementalManifest {
            kind: "zerochat.incrementalManifest".to_owned(),
            version: 1,
            updated_at: 10,
            data,
            secrets: ProviderSecrets::default(),
            chunks: vec![conversation_reference(0)],
            skill_chunks: Vec::new(),
            attachment_chunks: Vec::new(),
        }
    }

    fn conversation_reference(index: i32) -> IncrementalChunkRef {
        IncrementalChunkRef {
            conversation_id: "conversation".to_owned(),
            index,
            key: format!("chunk-00000000-0000-4000-8000-{index:012}.json"),
            object_type: chunk_object_type("conversation", index),
            fingerprint: FINGERPRINT.to_owned(),
            message_count: 1,
            updated_at: 10,
        }
    }

    #[test]
    fn canonical_incremental_manifest_is_accepted() {
        validate_incremental_manifest(&manifest(), &head()).unwrap();
    }

    #[test]
    fn unsafe_key_and_invalid_count_are_rejected_before_fetching_objects() {
        let mut unsafe_key = manifest();
        unsafe_key.chunks[0].key = "../snapshot".to_owned();
        assert!(validate_incremental_manifest(&unsafe_key, &head()).is_err());

        let mut invalid_count = manifest();
        invalid_count.chunks[0].message_count = -1;
        assert!(validate_incremental_manifest(&invalid_count, &head()).is_err());
    }

    #[test]
    fn conversation_indexes_must_be_unique_and_contiguous() {
        let mut duplicate = manifest();
        duplicate.chunks.push(conversation_reference(0));
        assert!(validate_incremental_manifest(&duplicate, &head()).is_err());

        let mut gap = manifest();
        gap.chunks.push(conversation_reference(2));
        assert!(validate_incremental_manifest(&gap, &head()).is_err());
    }

    #[test]
    fn attachment_chunk_group_must_be_complete_before_network_reads() {
        let mut invalid = manifest();
        invalid.attachment_chunks.push(IncrementalAttachmentRef {
            conversation_id: "conversation".to_owned(),
            message_id: "message".to_owned(),
            attachment_id: "attachment".to_owned(),
            index: 0,
            chunk_count: 2,
            key: "attachment-00000000-0000-4000-8000-000000000001.json".to_owned(),
            object_type: attachment_chunk_object_type("conversation", "message", "attachment", 0),
            fingerprint: FINGERPRINT.to_owned(),
            updated_at: 10,
        });

        assert!(validate_incremental_manifest(&invalid, &head()).is_err());
    }
}
