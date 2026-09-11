use crate::models::{ChatMessage, Conversation, UserSkill, UserSkillChunk};
use anyhow::Result;
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(crate) const INCREMENTAL_CHUNK_SIZE: usize = 60;
pub(crate) const INCREMENTAL_ATTACHMENT_CONTENT_CHARS: usize = 1_500_000;
const SKILL_CHUNK_PREVIEW_CHARS: usize = 180;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConversationFingerprint<'a> {
    conversation_id: &'a str,
    index: i32,
    messages: &'a [ChatMessage],
    updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillFingerprint<'a> {
    skill_id: &'a str,
    chunk_id: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentFingerprint<'a> {
    conversation_id: &'a str,
    message_id: &'a str,
    attachment_id: &'a str,
    index: i32,
    content: &'a str,
}

pub(crate) fn empty_skill_content(skill: &UserSkill) -> UserSkill {
    let mut copy = skill.clone();
    copy.chunks = skill.chunks.iter().map(empty_skill_chunk_content).collect();
    copy
}

fn empty_skill_chunk_content(chunk: &UserSkillChunk) -> UserSkillChunk {
    let content = chunk.content.trim();
    let content_preview = chunk
        .content_preview
        .as_ref()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let preview = content
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(SKILL_CHUNK_PREVIEW_CHARS)
                .collect::<String>();
            (!preview.is_empty()).then_some(preview)
        });

    let mut copy = chunk.clone();
    copy.content.clear();
    copy.content_ref = None;
    copy.content_preview = content_preview;
    copy
}

pub(crate) fn chunk_updated_at(conversation: &Conversation, messages: &[ChatMessage]) -> i64 {
    messages
        .iter()
        .map(|message| message.created_at)
        .max()
        .unwrap_or(conversation.updated_at)
        .max(conversation.updated_at)
}

pub(crate) fn chunk_fingerprint(
    conversation_id: &str,
    index: i32,
    messages: &[ChatMessage],
    updated_at: i64,
) -> Result<String> {
    Ok(sha256_hex(&serde_json::to_vec(&ConversationFingerprint {
        conversation_id,
        index,
        messages,
        updated_at,
    })?))
}

pub(crate) fn skill_chunk_fingerprint(
    skill_id: &str,
    chunk_id: &str,
    content: &str,
) -> Result<String> {
    Ok(sha256_hex(&serde_json::to_vec(&SkillFingerprint {
        skill_id,
        chunk_id,
        content,
    })?))
}

pub(crate) fn attachment_chunk_fingerprint(
    conversation_id: &str,
    message_id: &str,
    attachment_id: &str,
    index: i32,
    content: &str,
) -> Result<String> {
    Ok(sha256_hex(&serde_json::to_vec(&AttachmentFingerprint {
        conversation_id,
        message_id,
        attachment_id,
        index,
        content,
    })?))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn object_key(prefix: &str) -> String {
    format!("{prefix}-{}.json", Uuid::new_v4())
}

pub(crate) fn chunk_object_type(conversation_id: &str, index: i32) -> String {
    format!("conversationChunk:{conversation_id}:{index}")
}

pub(crate) fn skill_chunk_object_type(skill_id: &str, chunk_id: &str) -> String {
    format!("skillChunk:{skill_id}:{chunk_id}")
}

pub(crate) fn attachment_chunk_object_type(
    conversation_id: &str,
    message_id: &str,
    attachment_id: &str,
    index: i32,
) -> String {
    format!("attachmentChunk:{conversation_id}:{message_id}:{attachment_id}:{index}")
}

pub(crate) fn attachment_ref_key(
    conversation_id: &str,
    message_id: &str,
    attachment_id: &str,
) -> String {
    format!("{conversation_id}\0{message_id}\0{attachment_id}")
}

pub(crate) fn attachment_content_parts(data_url: &str) -> Result<Vec<String>> {
    if !data_url.is_ascii() || data_url.is_empty() {
        anyhow::bail!("Image attachment data URL is invalid.");
    }
    Ok(data_url
        .as_bytes()
        .chunks(INCREMENTAL_ATTACHMENT_CONTENT_CHARS)
        .map(|part| String::from_utf8(part.to_vec()))
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

pub(crate) fn skill_ref_key(skill_id: &str, chunk_id: &str) -> String {
    format!("{skill_id}\0{chunk_id}")
}

pub(crate) fn is_safe_object_key(value: &str) -> bool {
    let Some((prefix, rest)) = value.split_once('-') else {
        return false;
    };
    matches!(prefix, "manifest" | "chunk" | "skill" | "attachment")
        && rest.ends_with(".json")
        && rest
            .trim_end_matches(".json")
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() || ch == '-')
}

#[cfg(test)]
mod tests {
    use super::{attachment_chunk_fingerprint, attachment_content_parts, is_safe_object_key};

    #[test]
    fn attachment_chunks_keep_cross_platform_contract() {
        assert_eq!(
            attachment_chunk_fingerprint(
                "conversation-1",
                "message-1",
                "attachment-1",
                0,
                "data:image/png;base64,iVBORw0KGgo=",
            )
            .expect("fingerprint"),
            "64631e8acc0858a7da34a542e62b9df48525a1b6ae53d2529a0bff177ee6c749"
        );
        assert!(is_safe_object_key(
            "attachment-123e4567-e89b-12d3-a456-426614174000.json"
        ));

        let content = format!("data:image/png;base64,{}", "A".repeat(1_500_018));
        let parts = attachment_content_parts(&content).expect("parts");
        assert_eq!(parts.len(), 2);
        assert_eq!(parts.concat(), content);
    }
}
