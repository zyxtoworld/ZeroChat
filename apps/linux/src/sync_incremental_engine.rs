use crate::{
    ai_protocol::safe_generated_image_data_url,
    crypto::SnapshotCrypto,
    models::{
        AttachmentContentChunk, ConversationChunk, IncrementalManifest, IncrementalSyncHead,
        SkillContentChunk, SyncVault,
    },
    sync_incremental_read::{
        attachment_refs_by_id, conversation_refs_by_id, materialize_skill_chunk,
        skill_ref_for_chunk, skill_refs_by_chunk, validate_attachment_chunk,
        validate_conversation_chunk, validate_skill_chunk,
    },
    sync_incremental_remote::{
        IncrementalHeadRead, SyncGeneration, delete_incremental_object, delete_legacy_snapshot,
        is_cloud_sync_conflict, read_incremental_manifest, read_incremental_object,
        write_incremental_head, write_incremental_object,
    },
    sync_incremental_upload::build_incremental_upload,
    sync_vault_validation::decode_validated_sync_vault,
};
use anyhow::{Result, bail};
use reqwest::Client;
use std::collections::HashSet;

pub(crate) struct IncrementalRemoteState {
    pub(crate) head: IncrementalSyncHead,
    pub(crate) manifest: IncrementalManifest,
}

pub(crate) async fn read_incremental_remote_state(
    http: &Client,
    crypto: &SnapshotCrypto,
    endpoint: &str,
    token: &str,
    passphrase: &str,
    head: IncrementalHeadRead,
) -> Result<Option<IncrementalRemoteState>> {
    match head {
        IncrementalHeadRead::Head { head, .. } => Ok(Some(IncrementalRemoteState {
            manifest: read_incremental_manifest(http, crypto, endpoint, token, passphrase, &head)
                .await?,
            head,
        })),
        IncrementalHeadRead::Empty { .. } | IncrementalHeadRead::Unsupported => Ok(None),
    }
}

pub(crate) async fn manifest_to_vault(
    http: &Client,
    crypto: &SnapshotCrypto,
    endpoint: &str,
    token: &str,
    passphrase: &str,
    manifest: &IncrementalManifest,
) -> Result<SyncVault> {
    let mut refs_by_conversation = conversation_refs_by_id(manifest);
    let refs_by_skill = skill_refs_by_chunk(manifest);
    let refs_by_attachment = attachment_refs_by_id(manifest);
    let mut consumed_attachment_refs = HashSet::new();

    let mut conversations = Vec::new();
    for conversation in &manifest.data.conversations {
        let mut refs = refs_by_conversation
            .remove(&conversation.id)
            .unwrap_or_default();
        refs.sort_by_key(|reference| reference.index);

        let mut messages = Vec::new();
        for reference in refs {
            let envelope = read_incremental_object(http, endpoint, token, &reference.key).await?;
            let chunk = crypto.decrypt_object::<ConversationChunk>(
                &envelope,
                passphrase,
                &reference.object_type,
            )?;

            validate_conversation_chunk(&chunk, &reference)?;
            messages.extend(chunk.messages);
        }

        for message in &mut messages {
            for attachment in &mut message.attachments {
                let key = crate::sync_incremental_helpers::attachment_ref_key(
                    &conversation.id,
                    &message.id,
                    &attachment.id,
                );
                let Some(refs) = refs_by_attachment.get(&key) else {
                    continue;
                };
                let mut refs = refs.clone();
                refs.sort_by_key(|reference| reference.index);
                if attachment.data_url.is_some()
                    || refs.iter().enumerate().any(|(index, reference)| {
                        reference.index != index as i32
                            || reference.chunk_count != refs.len() as i32
                            || reference.object_type
                                != crate::sync_incremental_helpers::attachment_chunk_object_type(
                                    &conversation.id,
                                    &message.id,
                                    &attachment.id,
                                    index as i32,
                                )
                    })
                {
                    bail!("Remote message chunk does not match its manifest reference.");
                }

                let mut data_url = String::new();
                for reference in &refs {
                    let envelope =
                        read_incremental_object(http, endpoint, token, &reference.key).await?;
                    let chunk = crypto.decrypt_object::<AttachmentContentChunk>(
                        &envelope,
                        passphrase,
                        &reference.object_type,
                    )?;
                    validate_attachment_chunk(&chunk, reference)?;
                    data_url.push_str(&chunk.content);
                }
                let Some((safe_data_url, _)) = safe_generated_image_data_url(&data_url) else {
                    bail!("Remote message chunk does not match its manifest reference.");
                };
                attachment.data_url = Some(safe_data_url);
                consumed_attachment_refs.insert(key);
            }
        }

        let mut copy = conversation.clone();
        copy.messages = messages;
        conversations.push(copy);
    }

    if consumed_attachment_refs.len() != refs_by_attachment.len() {
        bail!("Remote message chunk does not match its manifest reference.");
    }

    let mut skills = Vec::new();
    for skill in &manifest.data.skills {
        let mut copy = skill.clone();
        let mut chunks = Vec::new();
        for chunk in &skill.chunks {
            let content = if let Some(reference) =
                skill_ref_for_chunk(&refs_by_skill, &skill.id, &chunk.id)
            {
                let envelope =
                    read_incremental_object(http, endpoint, token, &reference.key).await?;
                let remote_chunk = crypto.decrypt_object::<SkillContentChunk>(
                    &envelope,
                    passphrase,
                    &reference.object_type,
                )?;
                validate_skill_chunk(&remote_chunk, reference)?;
                remote_chunk.content.trim().to_owned()
            } else {
                chunk.content.trim().to_owned()
            };
            chunks.push(materialize_skill_chunk(chunk, content)?);
        }
        copy.chunks = chunks;
        skills.push(copy);
    }

    let mut data = manifest.data.clone();
    data.conversations = conversations;
    data.skills = skills;

    let vault = SyncVault {
        data,
        secrets: manifest.secrets.clone(),
    };
    decode_validated_sync_vault(&serde_json::to_vec(&vault)?)
}

pub(crate) async fn upload_incremental_vault(
    http: &Client,
    crypto: &SnapshotCrypto,
    vault: SyncVault,
    passphrase: &str,
    endpoint: &str,
    token: &str,
    generation: &SyncGeneration,
    previous: Option<IncrementalRemoteState>,
) -> Result<SyncVault> {
    let upload = build_incremental_upload(
        crypto,
        &vault,
        passphrase,
        previous.as_ref().map(|state| &state.manifest),
    )?;

    let mut uploaded_keys: Vec<String> = Vec::new();
    for chunk in &upload.chunks {
        if let Err(error) = write_incremental_object(
            http,
            endpoint,
            token,
            &chunk.key,
            &chunk.envelope,
            generation,
        )
        .await
        {
            for key in uploaded_keys {
                let _ = delete_incremental_object(http, endpoint, token, &key, generation).await;
            }
            return Err(error);
        }
        uploaded_keys.push(chunk.key.clone());
    }

    if let Err(error) = write_incremental_object(
        http,
        endpoint,
        token,
        &upload.head.manifest_key,
        &upload.manifest_envelope,
        generation,
    )
    .await
    {
        for key in uploaded_keys {
            let _ = delete_incremental_object(http, endpoint, token, &key, generation).await;
        }
        return Err(error);
    }

    if let Err(error) = write_incremental_head(
        http,
        endpoint,
        token,
        &upload.head,
        previous.as_ref().map(|state| &state.head),
        generation,
    )
    .await
    {
        if is_cloud_sync_conflict(&error) {
            for key in uploaded_keys {
                let _ = delete_incremental_object(http, endpoint, token, &key, generation).await;
            }
            let _ = delete_incremental_object(
                http,
                endpoint,
                token,
                &upload.head.manifest_key,
                generation,
            )
            .await;
        }
        return Err(error);
    }

    cleanup_incremental_objects(
        http,
        endpoint,
        token,
        generation,
        previous.as_ref(),
        &upload.manifest,
    )
    .await?;
    delete_legacy_snapshot(http, endpoint, token, generation).await?;
    Ok(vault)
}

async fn cleanup_incremental_objects(
    http: &Client,
    endpoint: &str,
    token: &str,
    generation: &SyncGeneration,
    previous: Option<&IncrementalRemoteState>,
    next: &IncrementalManifest,
) -> Result<()> {
    let Some(previous) = previous else {
        return Ok(());
    };

    let keep: HashSet<String> = next
        .chunks
        .iter()
        .map(|chunk| chunk.key.clone())
        .chain(next.skill_chunks.iter().map(|chunk| chunk.key.clone()))
        .chain(next.attachment_chunks.iter().map(|chunk| chunk.key.clone()))
        .collect();
    let mut stale = HashSet::from([previous.head.manifest_key.clone()]);

    for chunk in &previous.manifest.chunks {
        if !keep.contains(&chunk.key) {
            stale.insert(chunk.key.clone());
        }
    }

    for chunk in &previous.manifest.skill_chunks {
        if !keep.contains(&chunk.key) {
            stale.insert(chunk.key.clone());
        }
    }

    for chunk in &previous.manifest.attachment_chunks {
        if !keep.contains(&chunk.key) {
            stale.insert(chunk.key.clone());
        }
    }

    for key in stale {
        if let Err(error) = delete_incremental_object(http, endpoint, token, &key, generation).await
            && is_cloud_sync_conflict(&error)
        {
            return Err(error);
        }
    }
    Ok(())
}
