package app.zerochat.ui.settings

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import app.zerochat.data.AppSnapshot
import app.zerochat.data.UserSkill
import app.zerochat.data.UserSkillChunk
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.MAX_SKILL_FILE_BYTES
import app.zerochat.ui.localFileTooLargeMessage
import app.zerochat.ui.readBoundedLocalUriBytes
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID

internal class SkillImportUserError(message: String) : IllegalArgumentException(message)

internal fun readSkillFromUri(context: Context, uri: Uri, i18n: NativeI18n): UserSkill {
    val resolver = context.contentResolver
    val fileName = resolver.query(uri, null, null, null, null)?.use { cursor ->
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
    } ?: "skill.txt"
    val tooLargeMessage = localFileTooLargeMessage(i18n, MAX_SKILL_FILE_BYTES)
    val bytes = try {
        readBoundedLocalUriBytes(
            context,
            uri,
            MAX_SKILL_FILE_BYTES,
            tooLargeMessage,
        )
    } catch (error: IllegalArgumentException) {
        if (error.message == tooLargeMessage) {
            throw SkillImportUserError(tooLargeMessage)
        }
        throw error
    }
    if (bytes.isEmpty()) {
        throw SkillImportUserError(i18n.t("message.skillFileEmpty"))
    }
    val content = bytes.toString(Charsets.UTF_8)
    val contentType = when {
        fileName.endsWith(".json", ignoreCase = true) -> "json"
        fileName.endsWith(".md", ignoreCase = true) ||
            fileName.endsWith(".markdown", ignoreCase = true) -> "markdown"
        else -> "text"
    }
    val name = fileName.substringBeforeLast('.').replace(Regex("[-_]+"), " ")
        .ifBlank { i18n.t("fallback.skillName") }
    val emptyContentMessage = i18n.t("message.skillContentEmpty")

    return try {
        createNativeSkill(
            name = name,
            content = content,
            contentType = contentType,
            fileName = fileName,
            fallbackSkillName = i18n.t("fallback.skillName"),
            fallbackHeading = i18n.t("fallback.skillHeading"),
            emptyContentMessage = emptyContentMessage,
        )
    } catch (error: IllegalArgumentException) {
        if (error.message == emptyContentMessage) {
            throw SkillImportUserError(emptyContentMessage)
        }
        throw error
    }
}

internal fun createNativeSkill(
    name: String,
    content: String,
    contentType: String,
    fileName: String? = null,
    id: String = newId(),
    createdAt: Long = skillNowMillis(),
    fixed: Boolean = false,
    enabled: Boolean = true,
    autoMatch: Boolean = true,
    fallbackSkillName: String,
    fallbackHeading: String,
    emptyContentMessage: String,
): UserSkill {
    val normalized = content.replace(Regex("\\r\\n?"), "\n").trim()

    if (normalized.isBlank()) {
        throw IllegalArgumentException(emptyContentMessage)
    }

    val now = skillNowMillis()
    val chunks = chunkSkillContent(normalized, fallbackHeading)
    val description = normalized
        .lineSequence()
        .map { it.replace(Regex("^#{1,6}\\s+"), "").trim() }
        .firstOrNull { it.isNotBlank() && !it.startsWith("```") }
        .orEmpty()
        .take(140)

    return UserSkill(
        id = id,
        name = name.trim().ifBlank { fileName ?: fallbackSkillName },
        description = description,
        fileName = fileName,
        contentType = contentType,
        sourceSize = normalized.length,
        contentHash = sha256Hex(normalized),
        keywords = skillKeywords("$name\n$description\n$normalized", 48),
        chunks = chunks,
        fixed = fixed,
        enabled = enabled,
        autoMatch = autoMatch,
        createdAt = createdAt,
        updatedAt = now,
    )
}

private fun chunkSkillContent(content: String, fallbackHeading: String): List<UserSkillChunk> {
    val maxChunkChars = 2600
    val chunks = mutableListOf<UserSkillChunk>()
    var start = 0

    while (start < content.length) {
        val end = minOf(content.length, start + maxChunkChars)
        val part = content.substring(start, end).trim()

        if (part.isNotBlank()) {
            chunks += UserSkillChunk(
                id = "chunk-${chunks.size + 1}",
                heading = content.lineSequence()
                    .firstOrNull { it.startsWith("#") }
                    ?.replace(Regex("^#{1,6}\\s+"), "")
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                    ?: fallbackHeading,
                content = part,
                keywords = skillKeywords(part, 28),
                tokenEstimate = maxOf(1, kotlin.math.ceil(part.length / 3.8).toInt()),
            )
        }

        start = end
    }

    return chunks
}

private fun skillKeywords(content: String, limit: Int): List<String> {
    val counts = LinkedHashMap<String, Int>()
    Regex("[\\p{L}\\p{N}]{2,}").findAll(content.lowercase(Locale.ROOT)).forEach {
        counts[it.value] = (counts[it.value] ?: 0) + 1
    }

    return counts.entries
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .take(limit)
        .map { it.key }
}

fun skillContent(skill: UserSkill): String =
    skill.chunks.joinToString("\n\n") { it.content }

fun skillMetaText(skill: UserSkill, i18n: NativeI18n): String =
    i18n.t("settings.skillMeta")
        .replace("{chunks}", i18n.formatNumber(skill.chunks.size))
        .replace("{tokens}", i18n.formatNumber(skill.chunks.sumOf { it.tokenEstimate }))

fun skillSettingsPrependImportedSkill(snapshot: AppSnapshot, skill: UserSkill): AppSnapshot =
    snapshot.copy(skills = listOf(skill) + snapshot.skills)

private fun sha256Hex(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))

    return digest.joinToString("") { "%02x".format(it) }
}

private fun skillNowMillis(): Long = System.currentTimeMillis()

private fun newId(): String = UUID.randomUUID().toString()
