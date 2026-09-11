package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.MessageRole
import app.zerochat.data.SyncVault
import app.zerochat.data.UserSkill
import app.zerochat.data.UserSkillChunk
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncIncrementalUploadTest {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    @Test
    fun incrementalUploadObjectKeysStayScopedToWorkerObjectRoutes() {
        val key = objectKey("manifest")

        assertTrue(isSafeObjectKey(key))
        assertTrue(isSafeObjectKey("chunk-123e4567-e89b-12d3-a456-426614174000.json"))
        assertTrue(isSafeObjectKey("skill-ABCDEF.json"))
        assertTrue(isSafeObjectKey("attachment-123e4567-e89b-12d3-a456-426614174000.json"))
        assertFalse(isSafeObjectKey("../manifest-123.json"))
        assertFalse(isSafeObjectKey("manifest-123.json/extra"))
        assertFalse(isSafeObjectKey("snapshot-123.json"))
    }

    @Test
    fun incrementalUploadRedactsSkillContentButKeepsBoundedPreview() {
        val skill = skill(
            chunk = UserSkillChunk(
                id = "chunk-1",
                heading = "Setup",
                content = "  Alpha\n\nBeta\tGamma  ",
                contentRef = "local-ref",
                contentPreview = "   ",
                tokenEstimate = 5,
            ),
        )

        val redacted = emptySkillContent(skill).chunks.single()

        assertEquals("", redacted.content)
        assertNull(redacted.contentRef)
        assertEquals("Alpha Beta Gamma", redacted.contentPreview)
    }

    @Test
    fun incrementalUploadFingerprintsChangeWithMessageAndSkillContent() {
        val messages = listOf(message("m1", "hello", 10))
        val same = chunkFingerprint("conversation-1", 0, messages, 30, json)
        val sameAgain = chunkFingerprint("conversation-1", 0, messages, 30, json)
        val changedMessage = chunkFingerprint(
            "conversation-1",
            0,
            listOf(message("m1", "hello again", 10)),
            30,
            json,
        )
        val changedUpdatedAt = chunkFingerprint("conversation-1", 0, messages, 31, json)

        assertEquals(same, sameAgain)
        assertNotEquals(same, changedMessage)
        assertNotEquals(same, changedUpdatedAt)
        assertEquals(
            skillChunkFingerprint("skill-1", "chunk-1", "content", json),
            skillChunkFingerprint("skill-1", "chunk-1", "content", json),
        )
        assertNotEquals(
            skillChunkFingerprint("skill-1", "chunk-1", "content", json),
            skillChunkFingerprint("skill-1", "chunk-1", "changed", json),
        )
        assertEquals(
            "64631e8acc0858a7da34a542e62b9df48525a1b6ae53d2529a0bff177ee6c749",
            attachmentChunkFingerprint(
                "conversation-1",
                "message-1",
                "attachment-1",
                0,
                "data:image/png;base64,iVBORw0KGgo=",
                json,
            ),
        )
        val dataUrl = "data:image/png;base64," + "A".repeat(1_500_018)
        val parts = attachmentContentParts(dataUrl)
        assertEquals(2, parts.size)
        assertEquals(dataUrl, parts.joinToString(separator = ""))
    }

    @Test
    fun incrementalUploadUsesLatestConversationOrMessageTimestamp() {
        val conversation = conversation(
            updatedAt = 20,
            messages = listOf(
                message("m1", "old", 10),
                message("m2", "new", 45),
            ),
        )

        assertEquals(45, chunkUpdatedAt(conversation, conversation.messages))
        assertEquals(20, chunkUpdatedAt(conversation, emptyList()))
    }

    @Test
    fun incrementalUploadBlocksMissingSkillContentBeforeRemoteAssembly() {
        val vault = SyncVault(
            data = AppSnapshot(
                skills = listOf(
                    skill(
                        chunk = UserSkillChunk(
                            id = "chunk-1",
                            heading = "Empty",
                            content = " \n\t ",
                            tokenEstimate = 0,
                        ),
                    ),
                ),
                updatedAt = 100,
            ),
        )

        val failure = assertThrows(IllegalArgumentException::class.java) {
            buildIncrementalUpload(
                vault = vault,
                passphrase = "test-passphrase",
                remoteManifest = null,
                crypto = CryptoEngine(),
                json = json,
            )
        }

        assertEquals("Skill content is missing.", failure.message)
    }

    @Test
    fun incrementalUploadCancellationRollsBackAndKeepsOriginalSignal() {
        val cancellation = CancellationException("cancelled")
        var rollbackCalls = 0

        val thrown = assertThrows(CancellationException::class.java) {
            runBlocking {
                runWithRollbackOnFailure(
                    operation = { throw cancellation },
                    rollback = { rollbackCalls += 1 },
                )
            }
        }

        assertSame(cancellation, thrown)
        assertEquals(1, rollbackCalls)
    }

    @Test
    fun incrementalUploadOrdinaryFailureRollsBackAndKeepsOriginalError() {
        val failure = IllegalStateException("upload failed")
        var rollbackCalls = 0

        val thrown = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                runWithRollbackOnFailure(
                    operation = { throw failure },
                    rollback = { rollbackCalls += 1 },
                )
            }
        }

        assertSame(failure, thrown)
        assertEquals(1, rollbackCalls)
    }

    @Test
    fun incrementalUploadRollbackFailureDoesNotReplaceThePrimaryError() {
        val failure = IllegalStateException("upload failed")
        val rollbackFailure = IllegalArgumentException("rollback failed")

        val thrown = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                runWithRollbackOnFailure(
                    operation = { throw failure },
                    rollback = { throw rollbackFailure },
                )
            }
        }

        assertSame(failure, thrown)
        val suppressed = thrown.suppressed.single()
        assertTrue(suppressed is IllegalArgumentException)
        assertEquals(rollbackFailure.message, suppressed.message)
    }

    private fun conversation(
        updatedAt: Long,
        messages: List<ChatMessage>,
    ): Conversation = Conversation(
        id = "conversation-1",
        title = "Thread",
        providerId = "provider-1",
        model = "gpt-4o",
        messages = messages,
        createdAt = 1,
        updatedAt = updatedAt,
    )

    private fun message(
        id: String,
        content: String,
        createdAt: Long,
    ): ChatMessage = ChatMessage(
        id = id,
        role = MessageRole.User,
        content = content,
        createdAt = createdAt,
    )

    private fun skill(chunk: UserSkillChunk): UserSkill = UserSkill(
        id = "skill-1",
        name = "Skill",
        chunks = listOf(chunk),
        createdAt = 1,
        updatedAt = 2,
    )
}
