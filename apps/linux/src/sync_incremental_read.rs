use crate::{
    models::{
        AttachmentContentChunk, ConversationChunk, IncrementalAttachmentRef, IncrementalChunkRef,
        IncrementalManifest, IncrementalSkillRef, SkillContentChunk, UserSkillChunk,
    },
    sync_incremental_helpers::{
        attachment_chunk_fingerprint, attachment_ref_key, chunk_fingerprint,
        skill_chunk_fingerprint, skill_ref_key,
    },
};
use anyhow::{Result, bail};
use std::collections::HashMap;

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
        || chunk.messages.len() != reference.message_count as usize
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
