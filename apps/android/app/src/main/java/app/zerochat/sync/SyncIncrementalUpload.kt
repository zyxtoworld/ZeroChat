package app.zerochat.sync

import app.zerochat.ai.safeGeneratedImageDataUrl
import app.zerochat.data.AttachmentContentChunk
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.ConversationChunk
import app.zerochat.data.EncryptedObjectEnvelope
import app.zerochat.data.IncrementalAttachmentRef
import app.zerochat.data.IncrementalChunkRef
import app.zerochat.data.IncrementalManifest
import app.zerochat.data.IncrementalSkillRef
import app.zerochat.data.IncrementalSyncHead
import app.zerochat.data.SkillContentChunk
import app.zerochat.data.SyncVault
import app.zerochat.data.UserSkill
import app.zerochat.data.UserSkillChunk
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.security.MessageDigest

internal fun buildIncrementalUpload(
    vault: SyncVault,
    passphrase: String,
    remoteManifest: IncrementalManifest?,
    crypto: CryptoEngine,
    json: Json,
): BuiltIncrementalUpload {
    val normalizedVault = normalizeSyncVaultForProtocol(vault)
    val reusableChunks = remoteManifest?.chunks.orEmpty().associateBy { it.fingerprint }
    val reusableSkillChunks = remoteManifest?.skillChunks.orEmpty().associateBy { it.fingerprint }
    val reusableAttachmentChunks = remoteManifest?.attachmentChunks.orEmpty().associateBy { it.fingerprint }
    val pending = mutableListOf<PendingChunkUpload>()
    val chunkRefs = mutableListOf<IncrementalChunkRef>()
    val skillRefs = mutableListOf<IncrementalSkillRef>()
    val attachmentRefs = mutableListOf<IncrementalAttachmentRef>()

    for (conversation in normalizedVault.data.conversations) {
        val messages = conversation.messages.map { message ->
            message.copy(
                attachments = message.attachments.map attachmentMap@{ attachment ->
                    val dataUrl = attachment.dataUrl ?: return@attachmentMap attachment
                    val safeDataUrl = requireNotNull(safeGeneratedImageDataUrl(dataUrl)?.first) {
                        "Image attachment data URL is invalid."
                    }
                    val parts = attachmentContentParts(safeDataUrl)
                    for ((index, content) in parts.withIndex()) {
                        val fingerprint = attachmentChunkFingerprint(
                            conversation.id,
                            message.id,
                            attachment.id,
                            index,
                            content,
                            json,
                        )
                        val objectType = attachmentChunkObjectType(
                            conversation.id,
                            message.id,
                            attachment.id,
                            index,
                        )
                        val reusable = reusableAttachmentChunks[fingerprint]
                            ?.takeIf { it.chunkCount == parts.size }
                        val key = reusable?.key ?: objectKey("attachment")
                        val updatedAt = reusable?.updatedAt ?: maxOf(1, attachment.createdAt)
                        attachmentRefs += IncrementalAttachmentRef(
                            conversationId = conversation.id,
                            messageId = message.id,
                            attachmentId = attachment.id,
                            index = index,
                            chunkCount = parts.size,
                            key = key,
                            objectType = objectType,
                            fingerprint = fingerprint,
                            updatedAt = updatedAt,
                        )
                        if (reusable == null) {
                            pending += PendingChunkUpload(
                                key = key,
                                envelope = crypto.encryptObject(
                                    AttachmentContentChunk.serializer(),
                                    AttachmentContentChunk(
                                        conversationId = conversation.id,
                                        messageId = message.id,
                                        attachmentId = attachment.id,
                                        index = index,
                                        chunkCount = parts.size,
                                        content = content,
                                        updatedAt = updatedAt,
                                        fingerprint = fingerprint,
                                    ),
                                    passphrase,
                                    objectType,
                                    updatedAt,
                                ),
                            )
                        }
                    }
                    attachment.copy(dataUrl = null, url = null)
                },
            )
        }

        messages.chunked(INCREMENTAL_CHUNK_SIZE).forEachIndexed { index, chunkMessages ->
            val updatedAt = chunkUpdatedAt(conversation, chunkMessages)
            val fingerprint = chunkFingerprint(conversation.id, index, chunkMessages, updatedAt, json)
            val objectType = chunkObjectType(conversation.id, index)
            val reusable = reusableChunks[fingerprint]
            val key = reusable?.key ?: objectKey("chunk")
            val ref = IncrementalChunkRef(
                conversationId = conversation.id,
                index = index,
                key = key,
                objectType = objectType,
                fingerprint = fingerprint,
                messageCount = chunkMessages.size,
                updatedAt = updatedAt,
            )
            chunkRefs += ref

            if (reusable == null) {
                val chunk = ConversationChunk(
                    conversationId = conversation.id,
                    index = index,
                    messages = chunkMessages,
                    updatedAt = updatedAt,
                    fingerprint = fingerprint,
                )
                pending += PendingChunkUpload(
                    key = key,
                    envelope = crypto.encryptObject(
                        ConversationChunk.serializer(),
                        chunk,
                        passphrase,
                        objectType,
                        updatedAt,
                    ),
                )
            }
        }
    }

    for (skill in normalizedVault.data.skills) {
        for (chunk in skill.chunks) {
            val content = chunk.content.trim()
            require(content.isNotEmpty()) { "Skill content is missing." }
            val fingerprint = skillChunkFingerprint(skill.id, chunk.id, content, json)
            val objectType = skillChunkObjectType(skill.id, chunk.id)
            val reusable = reusableSkillChunks[fingerprint]
            val key = reusable?.key ?: objectKey("skill")
            val updatedAt = reusable?.updatedAt ?: skill.updatedAt
            val ref = IncrementalSkillRef(
                skillId = skill.id,
                chunkId = chunk.id,
                key = key,
                objectType = objectType,
                fingerprint = fingerprint,
                updatedAt = updatedAt,
            )
            skillRefs += ref

            if (reusable == null) {
                val skillChunk = SkillContentChunk(
                    skillId = skill.id,
                    chunkId = chunk.id,
                    content = content,
                    updatedAt = updatedAt,
                    fingerprint = fingerprint,
                )
                pending += PendingChunkUpload(
                    key = key,
                    envelope = crypto.encryptObject(
                        SkillContentChunk.serializer(),
                        skillChunk,
                        passphrase,
                        objectType,
                        updatedAt,
                    ),
                )
            }
        }
    }

    val manifest = IncrementalManifest(
        updatedAt = normalizedVault.data.updatedAt,
        data = normalizedVault.data.copy(
            conversations = normalizedVault.data.conversations.map { it.copy(messages = emptyList()) },
            skills = normalizedVault.data.skills.map(::emptySkillContent),
        ),
        secrets = normalizedVault.secrets,
        chunks = chunkRefs,
        skillChunks = skillRefs,
        attachmentChunks = attachmentRefs,
    )
    val manifestKey = objectKey("manifest")
    val manifestEnvelope = crypto.encryptObject(
        IncrementalManifest.serializer(),
        manifest,
        passphrase,
        "manifest",
        manifest.updatedAt,
    )

    return BuiltIncrementalUpload(
        head = IncrementalSyncHead(
            manifestKey = manifestKey,
            updatedAt = manifest.updatedAt,
        ),
        manifest = manifest,
        manifestEnvelope = manifestEnvelope,
        chunks = pending,
    )
}

internal fun emptySkillContent(skill: UserSkill): UserSkill =
    skill.copy(chunks = skill.chunks.map(::emptySkillChunkContent))

internal fun emptySkillChunkContent(chunk: UserSkillChunk): UserSkillChunk {
    val content = chunk.content.trim()
    val preview = chunk.contentPreview?.trim()?.takeIf { it.isNotBlank() }
        ?: content.replace(Regex("\\s+"), " ").trim().take(SKILL_CHUNK_PREVIEW_CHARS)
            .takeIf { it.isNotBlank() }

    return chunk.copy(
        content = "",
        contentRef = null,
        contentPreview = preview,
    )
}

internal fun chunkUpdatedAt(conversation: Conversation, messages: List<ChatMessage>): Long =
    maxOf(conversation.updatedAt, messages.maxOfOrNull { it.createdAt } ?: conversation.updatedAt)

internal fun chunkFingerprint(
    conversationId: String,
    index: Int,
    messages: List<ChatMessage>,
    updatedAt: Long,
    json: Json,
): String =
    sha256Hex(
        json.encodeToString(
            ConversationFingerprint.serializer(),
            ConversationFingerprint(conversationId, index, messages, updatedAt),
        ),
    )

internal fun skillChunkFingerprint(
    skillId: String,
    chunkId: String,
    content: String,
    json: Json,
): String =
    sha256Hex(
        json.encodeToString(
            SkillFingerprint.serializer(),
            SkillFingerprint(skillId, chunkId, content),
        ),
    )

internal fun attachmentChunkFingerprint(
    conversationId: String,
    messageId: String,
    attachmentId: String,
    index: Int,
    content: String,
    json: Json,
): String =
    sha256Hex(
        json.encodeToString(
            AttachmentFingerprint.serializer(),
            AttachmentFingerprint(conversationId, messageId, attachmentId, index, content),
        ),
    )

internal fun chunkObjectType(conversationId: String, index: Int): String =
    "conversationChunk:$conversationId:$index"

internal fun skillChunkObjectType(skillId: String, chunkId: String): String =
    "skillChunk:$skillId:$chunkId"

internal fun attachmentChunkObjectType(
    conversationId: String,
    messageId: String,
    attachmentId: String,
    index: Int,
): String = "attachmentChunk:$conversationId:$messageId:$attachmentId:$index"

internal fun attachmentRefKey(
    conversationId: String,
    messageId: String,
    attachmentId: String,
): String = "$conversationId\u0000$messageId\u0000$attachmentId"

internal fun attachmentContentParts(dataUrl: String): List<String> =
    dataUrl.chunked(INCREMENTAL_ATTACHMENT_CONTENT_CHARS)

internal fun skillRefKey(skillId: String, chunkId: String): String =
    "$skillId\u0000$chunkId"

private fun sha256Hex(value: String): String =
    MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

internal data class PendingChunkUpload(
    val key: String,
    val envelope: EncryptedObjectEnvelope,
)

internal data class BuiltIncrementalUpload(
    val head: IncrementalSyncHead,
    val manifest: IncrementalManifest,
    val manifestEnvelope: EncryptedObjectEnvelope,
    val chunks: List<PendingChunkUpload>,
)

@Serializable
private data class ConversationFingerprint(
    val conversationId: String,
    val index: Int,
    val messages: List<ChatMessage>,
    val updatedAt: Long,
)

@Serializable
private data class SkillFingerprint(
    val skillId: String,
    val chunkId: String,
    val content: String,
)

@Serializable
private data class AttachmentFingerprint(
    val conversationId: String,
    val messageId: String,
    val attachmentId: String,
    val index: Int,
    val content: String,
)

private const val INCREMENTAL_CHUNK_SIZE = 60
private const val SKILL_CHUNK_PREVIEW_CHARS = 180
private const val INCREMENTAL_ATTACHMENT_CONTENT_CHARS = 1_500_000
