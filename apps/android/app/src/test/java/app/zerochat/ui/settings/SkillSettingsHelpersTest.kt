package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.UserSkill
import app.zerochat.data.UserSkillChunk
import app.zerochat.ui.NativeI18n
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SkillSettingsHelpersTest {
    @Test
    fun createNativeSkillNormalizesContentAndPreservesMetadata() {
        val skill = createNativeSkill(
            name = "  Concise Answers  ",
            content = "\r\nUse short answers.\r\nPrefer bullets.\r\n",
            contentType = "markdown",
            fileName = "concise.md",
            id = "skill-fixed-id",
            createdAt = 42,
            fixed = true,
            enabled = false,
            autoMatch = false,
            fallbackSkillName = "Fallback Skill",
            fallbackHeading = "Overview",
            emptyContentMessage = "empty",
        )

        assertEquals("skill-fixed-id", skill.id)
        assertEquals("Concise Answers", skill.name)
        assertEquals("Use short answers.", skill.description)
        assertEquals("concise.md", skill.fileName)
        assertEquals("markdown", skill.contentType)
        assertEquals("Use short answers.\nPrefer bullets.".length, skill.sourceSize)
        assertEquals(
            "604c4442dc79dce566312c08278c3a17467d6a657f10fb4014a751132a5bbb86",
            skill.contentHash,
        )
        assertEquals(true, skill.fixed)
        assertEquals(false, skill.enabled)
        assertEquals(false, skill.autoMatch)
        assertEquals(42, skill.createdAt)
        assertTrue(skill.updatedAt >= skill.createdAt)
        assertEquals(listOf("Use short answers.\nPrefer bullets."), skill.chunks.map { it.content })
        assertEquals("Overview", skill.chunks.single().heading)
        assertEquals(skill.chunks.single().content, skillContent(skill))
    }

    @Test
    fun createNativeSkillFallsBackToLocalizedNamesAndRejectsEmptyContent() {
        val fallback = createNativeSkill(
            name = "   ",
            content = "A useful habit",
            contentType = "text",
            fallbackSkillName = "Fallback Skill",
            fallbackHeading = "Overview",
            emptyContentMessage = "empty skill",
        )
        val fromFile = createNativeSkill(
            name = "   ",
            content = "A useful habit",
            contentType = "text",
            fileName = "habit.md",
            fallbackSkillName = "Fallback Skill",
            fallbackHeading = "Overview",
            emptyContentMessage = "empty skill",
        )
        val failure = assertThrows(IllegalArgumentException::class.java) {
            createNativeSkill(
                name = "Empty",
                content = " \r\n\t ",
                contentType = "text",
                fallbackSkillName = "Fallback Skill",
                fallbackHeading = "Overview",
                emptyContentMessage = "empty skill",
            )
        }

        assertEquals("Fallback Skill", fallback.name)
        assertEquals("habit.md", fromFile.name)
        assertEquals("empty skill", failure.message)
    }

    @Test
    fun createNativeSkillBuildsBoundedChunksKeywordsAndLocalizedMeta() {
        val content = "# Guide\n\n" + "alpha beta beta ".repeat(220)
        val skill = createNativeSkill(
            name = "Guide Skill",
            content = content,
            contentType = "markdown",
            fallbackSkillName = "Fallback Skill",
            fallbackHeading = "Overview",
            emptyContentMessage = "empty",
        )

        assertTrue(skill.chunks.size >= 2)
        assertTrue(skill.chunks.all { it.content.length <= 2600 })
        assertTrue(skill.chunks.all { it.heading == "Guide" })
        assertTrue(skill.chunks.all { it.tokenEstimate > 0 })
        assertEquals("beta", skill.keywords.first())
        assertTrue(skill.keywords.contains("guide"))
        assertTrue(skill.chunks.first().keywords.contains("alpha"))
        assertTrue(skillMetaText(skill, NativeI18n.forMode("en-US")).contains("${skill.chunks.size} chunks"))
        assertTrue(skillMetaText(skill, NativeI18n.forMode("zh-CN")).contains("${skill.chunks.size} 段"))
    }

    @Test
    fun skillMetaTextFormatsLargeNumbersForLocale() {
        val skill = UserSkill(
            id = "skill-large-number",
            name = "Large number",
            chunks = listOf(
                UserSkillChunk(
                    id = "chunk-1",
                    heading = "One",
                    tokenEstimate = 1234,
                ),
                UserSkillChunk(
                    id = "chunk-2",
                    heading = "Two",
                    tokenEstimate = 5678,
                ),
            ),
            createdAt = 1,
            updatedAt = 1,
        )
        val french = NativeI18n.forMode("fr-FR")
        val arabic = NativeI18n.forMode("ar-SA")

        assertTrue(skillMetaText(skill, french).contains(french.formatNumber(6912)))
        assertTrue(skillMetaText(skill, arabic).contains(arabic.formatNumber(6912)))
        assertFalse(skillMetaText(skill, french).contains("6912"))
    }

    @Test
    fun createNativeSkillUpdatesContentHashWhenContentChanges() {
        val first = createNativeSkill(
            name = "Hash",
            content = "first version",
            contentType = "text",
            fallbackSkillName = "Fallback Skill",
            fallbackHeading = "Overview",
            emptyContentMessage = "empty",
        )
        val second = createNativeSkill(
            name = "Hash",
            content = "second version",
            contentType = "text",
            fallbackSkillName = "Fallback Skill",
            fallbackHeading = "Overview",
            emptyContentMessage = "empty",
        )

        assertNotEquals(first.contentHash, second.contentHash)
        assertNotEquals(first.keywords, second.keywords)
    }

    @Test
    fun skillSettingsPrependImportedSkillUsesTheLatestSnapshotSkills() {
        val existing = createNativeSkill(
            name = "Existing",
            content = "Existing content",
            contentType = "text",
            fallbackSkillName = "Fallback Skill",
            fallbackHeading = "Overview",
            emptyContentMessage = "empty",
        )
        val imported = createNativeSkill(
            name = "Imported",
            content = "Imported content",
            contentType = "text",
            fallbackSkillName = "Fallback Skill",
            fallbackHeading = "Overview",
            emptyContentMessage = "empty",
        )
        val current = AppSnapshot(skills = listOf(existing))

        val updated = skillSettingsPrependImportedSkill(current, imported)

        assertEquals(listOf(imported, existing), updated.skills)
    }

    @Test
    fun skillImportFailureNoticeDoesNotExposeRawExceptionText() {
        val sentinel =
            "C:\\private\\skills\\secret.json /home/runner/.config/token " +
                "https://provider.invalid/v1 sk-test-not-a-real-key"

        val notice = skillImportFailureNotice(
            NativeI18n.forMode("en-US"),
            IllegalStateException(sentinel),
        )

        assertFalse(notice.contains(sentinel))
        assertFalse(notice.contains("C:\\private"))
        assertFalse(notice.contains("/home/runner"))
        assertFalse(notice.contains("provider.invalid"))
        assertFalse(notice.contains("sk-test-not-a-real-key"))
    }

    @Test
    fun skillImportFailureNoticeShowsSafeLocalValidationMessage() {
        val i18n = NativeI18n.forMode("en-US")
        val expected = i18n.t("message.skillFileEmpty")

        val notice = skillImportFailureNotice(i18n, SkillImportUserError(expected))

        assertEquals(expected, notice)
    }
}
