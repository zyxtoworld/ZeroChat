use crate::{
    ai_protocol::safe_generated_image_data_url,
    crypto::SnapshotCrypto,
    models::{
        AttachmentContentChunk, ConversationChunk, EncryptedObjectEnvelope,
        IncrementalAttachmentRef, IncrementalChunkRef, IncrementalManifest, IncrementalSkillRef,
        IncrementalSyncHead, SkillContentChunk, SyncVault,
    },
    sync_incremental_helpers::{
        INCREMENTAL_CHUNK_SIZE, attachment_chunk_fingerprint, attachment_chunk_object_type,
        attachment_content_parts, chunk_fingerprint, chunk_object_type, chunk_updated_at,
        empty_skill_content, object_key, skill_chunk_fingerprint, skill_chunk_object_type,
    },
};
use anyhow::{Result, bail};
use std::collections::HashMap;

pub(crate) struct PendingChunkUpload {
    pub(crate) key: String,
    pub(crate) envelope: EncryptedObjectEnvelope,
}

pub(crate) struct BuiltIncrementalUpload {
    pub(crate) head: IncrementalSyncHead,
    pub(crate) manifest: IncrementalManifest,
    pub(crate) manifest_envelope: EncryptedObjectEnvelope,
    pub(crate) chunks: Vec<PendingChunkUpload>,
}

pub(crate) fn build_incremental_upload(
    crypto: &SnapshotCrypto,
    vault: &SyncVault,
    passphrase: &str,
    remote_manifest: Option<&IncrementalManifest>,
) -> Result<BuiltIncrementalUpload> {
    let reusable_chunks: HashMap<String, IncrementalChunkRef> = remote_manifest
        .map(|manifest| {
            manifest
                .chunks
                .iter()
                .map(|chunk| (chunk.fingerprint.clone(), chunk.clone()))
                .collect()
        })
        .unwrap_or_default();
    let reusable_skill_chunks: HashMap<String, IncrementalSkillRef> = remote_manifest
        .map(|manifest| {
            manifest
                .skill_chunks
                .iter()
                .map(|chunk| (chunk.fingerprint.clone(), chunk.clone()))
                .collect()
        })
        .unwrap_or_default();
    let reusable_attachment_chunks: HashMap<String, IncrementalAttachmentRef> = remote_manifest
        .map(|manifest| {
            manifest
                .attachment_chunks
                .iter()
                .map(|chunk| (chunk.fingerprint.clone(), chunk.clone()))
                .collect()
        })
        .unwrap_or_default();

    let mut pending = Vec::new();
    let mut refs = Vec::new();
    let mut skill_refs = Vec::new();
    let mut attachment_refs = Vec::new();

    for conversation in &vault.data.conversations {
        let mut redacted_messages = Vec::with_capacity(conversation.messages.len());
        for message in &conversation.messages {
            let mut message_copy = message.clone();
            let mut attachments = Vec::with_capacity(message.attachments.len());
            for attachment in &message.attachments {
                let Some(data_url) = attachment.data_url.as_deref() else {
                    attachments.push(attachment.clone());
                    continue;
                };
                let Some((safe_data_url, _)) = safe_generated_image_data_url(data_url) else {
                    bail!("Image attachment data URL is invalid.");
                };
                let parts = attachment_content_parts(&safe_data_url)?;
                for (index, content) in parts.iter().enumerate() {
                    let index = index as i32;
                    let fingerprint = attachment_chunk_fingerprint(
                        &conversation.id,
                        &message.id,
                        &attachment.id,
                        index,
                        content,
                    )?;
                    let object_type = attachment_chunk_object_type(
                        &conversation.id,
                        &message.id,
                        &attachment.id,
                        index,
                    );
                    let reusable = reusable_attachment_chunks
                        .get(&fingerprint)
                        .filter(|reference| reference.chunk_count == parts.len() as i32);
                    let key = reusable
                        .map(|reference| reference.key.clone())
                        .unwrap_or_else(|| object_key("attachment"));
                    let updated_at = reusable
                        .map(|reference| reference.updated_at)
                        .unwrap_or(attachment.created_at.max(1));
                    attachment_refs.push(IncrementalAttachmentRef {
                        conversation_id: conversation.id.clone(),
                        message_id: message.id.clone(),
                        attachment_id: attachment.id.clone(),
                        index,
                        chunk_count: parts.len() as i32,
                        key: key.clone(),
                        object_type: object_type.clone(),
                        fingerprint: fingerprint.clone(),
                        updated_at,
                    });
                    if reusable.is_none() {
                        let chunk = AttachmentContentChunk {
                            kind: "zerochat.attachmentChunk".to_owned(),
                            version: 1,
                            conversation_id: conversation.id.clone(),
                            message_id: message.id.clone(),
                            attachment_id: attachment.id.clone(),
                            index,
                            chunk_count: parts.len() as i32,
                            content: content.clone(),
                            updated_at,
                            fingerprint,
                        };
                        pending.push(PendingChunkUpload {
                            key,
                            envelope: crypto.encrypt_object(
                                &chunk,
                                passphrase,
                                &object_type,
                                updated_at,
                            )?,
                        });
                    }
                }
                let mut attachment_copy = attachment.clone();
                attachment_copy.data_url = None;
                attachment_copy.url = None;
                attachments.push(attachment_copy);
            }
            message_copy.attachments = attachments;
            redacted_messages.push(message_copy);
        }

        for (index, messages) in redacted_messages.chunks(INCREMENTAL_CHUNK_SIZE).enumerate() {
            let updated_at = chunk_updated_at(conversation, messages);
            let fingerprint =
                chunk_fingerprint(conversation.id.as_str(), index as i32, messages, updated_at)?;
            let object_type = chunk_object_type(&conversation.id, index as i32);
            let reusable = reusable_chunks.get(&fingerprint);
            let key = reusable
                .map(|reference| reference.key.clone())
                .unwrap_or_else(|| object_key("chunk"));
            let reference = IncrementalChunkRef {
                conversation_id: conversation.id.clone(),
                index: index as i32,
                key: key.clone(),
                object_type: object_type.clone(),
                fingerprint: fingerprint.clone(),
                message_count: messages.len() as i32,
                updated_at,
            };
            refs.push(reference);

            if reusable.is_none() {
                let chunk = ConversationChunk {
                    kind: "zerochat.conversationChunk".to_owned(),
                    version: 1,
                    conversation_id: conversation.id.clone(),
                    index: index as i32,
                    messages: messages.to_vec(),
                    updated_at,
                    fingerprint,
                };
                pending.push(PendingChunkUpload {
                    key,
                    envelope: crypto.encrypt_object(
                        &chunk,
                        passphrase,
                        &object_type,
                        updated_at,
                    )?,
                });
            }
        }
    }

    for skill in &vault.data.skills {
        for chunk in &skill.chunks {
            let content = chunk.content.trim();
            if content.is_empty() {
                bail!("Skill content is missing.");
            }
            let fingerprint = skill_chunk_fingerprint(&skill.id, &chunk.id, content)?;
            let object_type = skill_chunk_object_type(&skill.id, &chunk.id);
            let reusable = reusable_skill_chunks.get(&fingerprint);
            let key = reusable
                .map(|reference| reference.key.clone())
                .unwrap_or_else(|| object_key("skill"));
            let updated_at = reusable
                .map(|reference| reference.updated_at)
                .unwrap_or(skill.updated_at);
            let reference = IncrementalSkillRef {
                skill_id: skill.id.clone(),
                chunk_id: chunk.id.clone(),
                key: key.clone(),
                object_type: object_type.clone(),
                fingerprint: fingerprint.clone(),
                updated_at,
            };
            skill_refs.push(reference);

            if reusable.is_none() {
                let skill_chunk = SkillContentChunk {
                    kind: "zerochat.skillChunk".to_owned(),
                    version: 1,
                    skill_id: skill.id.clone(),
                    chunk_id: chunk.id.clone(),
                    content: content.to_owned(),
                    updated_at,
                    fingerprint,
                };
                pending.push(PendingChunkUpload {
                    key,
                    envelope: crypto.encrypt_object(
                        &skill_chunk,
                        passphrase,
                        &object_type,
                        updated_at,
                    )?,
                });
            }
        }
    }

    let mut manifest_data = vault.data.clone();
    manifest_data.conversations = manifest_data
        .conversations
        .iter()
        .map(|conversation| {
            let mut copy = conversation.clone();
            copy.messages = Vec::new();
            copy
        })
        .collect();
    manifest_data.skills = manifest_data
        .skills
        .iter()
        .map(empty_skill_content)
        .collect();

    let manifest = IncrementalManifest {
        kind: "zerochat.incrementalManifest".to_owned(),
        version: 1,
        updated_at: vault.data.updated_at,
        data: manifest_data,
        secrets: vault.secrets.clone(),
        chunks: refs,
        skill_chunks: skill_refs,
        attachment_chunks: attachment_refs,
    };
    let manifest_key = object_key("manifest");
    let manifest_envelope =
        crypto.encrypt_object(&manifest, passphrase, "manifest", manifest.updated_at)?;

    Ok(BuiltIncrementalUpload {
        head: IncrementalSyncHead {
            kind: "zerochat.incrementalHead".to_owned(),
            version: 1,
            manifest_key,
            updated_at: manifest.updated_at,
        },
        manifest,
        manifest_envelope,
        chunks: pending,
    })
}
