package app.zerochat.ui.chat

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.MessageRole
import app.zerochat.data.SkillSettings
import app.zerochat.data.UserSkill
import app.zerochat.data.UserSkillChunk
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SkillContextTest {
    @Test
    fun requestMessagesWithSkillsPrependsEnabledPinnedSkillWhenAutoMatchIsOff() {
        val messages = listOf(message("user", MessageRole.User, "What should I do?"))
        val requested = requestMessagesWithSkills(
            snapshot = AppSnapshot(
                skills = listOf(
                    skill(
                        name = "Pinned release policy",
                        content = "Always check release blockers.",
                        fixed = true,
                    ),
                    skill(
                        name = "Automatic review",
                        content = "Review dependency arrays.",
                    ),
                ),
                skillSettings = SkillSettings(autoMatch = false),
            ),
            latestInput = "What should I do?",
            messages = messages,
            createdAt = 42L,
        )

        assertEquals(2, requested.size)
        assertEquals(MessageRole.System, requested.first().role)
        assertEquals("skill-context-42", requested.first().id)
        assertTrue(requested.first().content.contains("[Skill: Pinned release policy]"))
        assertFalse(requested.first().content.contains("[Skill: Automatic review]"))
        assertEquals(messages.single(), requested.last())
    }

    @Test
    fun buildSkillSystemMessageIncludesOnlyRelevantEnabledAutomaticSkillsWithinLimit() {
        val content = buildSkillSystemMessage(
            AppSnapshot(
                skills = listOf(
                    skill(
                        name = "React review",
                        content = "Check hook dependencies and cleanup.",
                        keywords = listOf("react", "hooks", "dependencies"),
                        chunkKeywords = listOf("react", "hooks"),
                    ),
                    skill(
                        name = "Database review",
                        content = "Check transaction isolation.",
                        keywords = listOf("database", "transaction"),
                        chunkKeywords = listOf("database", "transaction"),
                    ),
                    skill(
                        name = "Disabled React review",
                        content = "This must not be sent.",
                        keywords = listOf("react"),
                        chunkKeywords = listOf("react"),
                        enabled = false,
                    ),
                ),
                skillSettings = SkillSettings(
                    autoMatch = true,
                    contextBudget = 600,
                    maxAutoSkills = 1,
                ),
            ),
            latestInput = "Please review React hook dependencies.",
        )

        assertTrue(content.contains("[Skill: React review]"))
        assertFalse(content.contains("[Skill: Database review]"))
        assertFalse(content.contains("[Skill: Disabled React review]"))
    }

    private fun skill(
        name: String,
        content: String,
        fixed: Boolean = false,
        enabled: Boolean = true,
        keywords: List<String> = listOf("review"),
        chunkKeywords: List<String> = keywords,
    ): UserSkill = UserSkill(
        id = name,
        name = name,
        keywords = keywords,
        chunks = listOf(
            UserSkillChunk(
                id = "chunk",
                heading = "Guidance",
                content = content,
                keywords = chunkKeywords,
                tokenEstimate = 8,
            ),
        ),
        fixed = fixed,
        enabled = enabled,
        createdAt = 1L,
        updatedAt = 1L,
    )

    private fun message(id: String, role: MessageRole, content: String): ChatMessage = ChatMessage(
        id = id,
        role = role,
        content = content,
        createdAt = 1L,
    )
}
