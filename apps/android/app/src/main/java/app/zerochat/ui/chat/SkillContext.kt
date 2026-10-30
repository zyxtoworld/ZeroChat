package app.zerochat.ui.chat

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.MessageRole
import app.zerochat.data.UserSkill
import app.zerochat.data.UserSkillChunk
import java.util.Locale

private const val MIN_SKILL_CONTEXT_BUDGET = 600
private const val MAX_SKILL_CONTEXT_BUDGET = 8_000
private const val MIN_AUTO_SKILL_COUNT = 1
private const val MAX_AUTO_SKILL_COUNT = 8
private const val MAX_CANDIDATE_SKILLS = 16
private const val MAX_CHUNKS_PER_AUTO_SKILL = 2
private const val MAX_CHUNKS_PER_FIXED_SKILL = 4
private const val MIN_REMAINING_TOKENS = 80
private const val SKILL_CONTEXT_INTRO = "Use these user-provided skills only when relevant. If they conflict with the latest user message, follow the latest user message."

private val skillTermsPattern = Regex("[\\p{L}\\p{N}]+")
private val cjkTermPattern = Regex("[\\p{IsHan}\\p{IsHiragana}\\p{IsKatakana}\\p{IsHangul}]")
private val skillStopWords = setOf(
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has",
    "have", "if", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the",
    "this", "to", "use", "with", "you", "your",
)

private data class SkillCandidate(
    val skill: UserSkill,
    val score: Int,
    val fixed: Boolean,
)

private data class RankedSkillChunk(
    val chunk: UserSkillChunk,
    val score: Int,
    val index: Int,
)

private data class PickedSkillChunk(
    val skill: UserSkill,
    val chunk: UserSkillChunk,
    val tokenBudget: Int,
)

internal fun requestMessagesWithSkills(
    snapshot: AppSnapshot,
    latestInput: String,
    messages: List<ChatMessage>,
    createdAt: Long = nowMillis(),
): List<ChatMessage> {
    if (snapshot.skills.none(UserSkill::enabled)) {
        return messages
    }

    val content = buildSkillSystemMessage(snapshot, latestInput)
    if (content.isBlank()) {
        return messages
    }

    return ArrayList<ChatMessage>(messages.size + 1).apply {
        add(
            ChatMessage(
                id = "skill-context-$createdAt",
                role = MessageRole.System,
                content = content,
                createdAt = createdAt,
            ),
        )
        addAll(messages)
    }
}

internal fun buildSkillSystemMessage(snapshot: AppSnapshot, latestInput: String): String {
    val settings = snapshot.skillSettings
    val queryTerms = skillTerms(latestInput)
    val candidates = skillCandidates(snapshot.skills, settings.autoMatch, settings.maxAutoSkills, queryTerms)
    if (candidates.isEmpty()) {
        return ""
    }

    val selected = pickSkillChunks(
        candidates = candidates,
        queryTerms = queryTerms,
        contextBudget = settings.contextBudget.coerceIn(
            MIN_SKILL_CONTEXT_BUDGET,
            MAX_SKILL_CONTEXT_BUDGET,
        ),
        maxAutoSkills = settings.maxAutoSkills.coerceIn(MIN_AUTO_SKILL_COUNT, MAX_AUTO_SKILL_COUNT),
    )
    if (selected.isEmpty()) {
        return ""
    }

    val content = StringBuilder(SKILL_CONTEXT_INTRO)
    var addedAny = false
    for (item in selected) {
        val chunkContent = trimSkillContent(item.chunk.content, item.tokenBudget)
        if (chunkContent.isBlank()) {
            continue
        }

        content.append("\n\n[Skill: ")
            .append(item.skill.name.trim())
            .append("]\n")
        item.chunk.heading.trim().takeIf(String::isNotEmpty)?.let { heading ->
            content.append(heading).append('\n')
        }
        content.append(chunkContent)
        addedAny = true
    }

    return if (addedAny) content.toString() else ""
}

private fun skillCandidates(
    skills: List<UserSkill>,
    autoMatch: Boolean,
    maxAutoSkills: Int,
    queryTerms: Set<String>,
): List<SkillCandidate> {
    val candidates = ArrayList<SkillCandidate>()
    for (skill in skills) {
        if (skill.enabled && skill.fixed) {
            candidates += SkillCandidate(skill, Int.MAX_VALUE, fixed = true)
        }
    }

    if (!autoMatch || queryTerms.isEmpty()) {
        return candidates
    }

    val automatic = ArrayList<SkillCandidate>()
    for (skill in skills) {
        if (!skill.enabled || skill.fixed || !skill.autoMatch) {
            continue
        }

        val score = candidateScore(skill, queryTerms)
        if (score > 0) {
            automatic += SkillCandidate(skill, score, fixed = false)
        }
    }
    automatic.sortWith(
        compareByDescending<SkillCandidate> { it.score }
            .thenBy { it.skill.name },
    )
    candidates.addAll(
        automatic.take(maxOf(MAX_CANDIDATE_SKILLS, maxAutoSkills.coerceAtLeast(1) * 4)),
    )
    return candidates
}

private fun pickSkillChunks(
    candidates: List<SkillCandidate>,
    queryTerms: Set<String>,
    contextBudget: Int,
    maxAutoSkills: Int,
): List<PickedSkillChunk> {
    val selected = ArrayList<PickedSkillChunk>()
    var remainingTokens = contextBudget
    var automaticSkillCount = 0

    for (candidate in candidates) {
        if (!candidate.fixed && automaticSkillCount >= maxAutoSkills) {
            continue
        }

        val rankedChunks = candidate.skill.chunks.mapIndexed { index, chunk ->
            RankedSkillChunk(
                chunk = chunk,
                score = chunkScore(chunk, queryTerms),
                index = index,
            )
        }.sortedWith(
            compareByDescending<RankedSkillChunk> { it.score }
                .thenBy { it.index },
        )
        val chunkLimit = if (candidate.fixed) {
            MAX_CHUNKS_PER_FIXED_SKILL
        } else {
            MAX_CHUNKS_PER_AUTO_SKILL
        }
        var usedForSkill = 0

        for (ranked in rankedChunks) {
            if (!candidate.fixed && ranked.score <= 0) {
                continue
            }
            if (usedForSkill >= chunkLimit) {
                break
            }
            if (remainingTokens <= MIN_REMAINING_TOKENS) {
                return selected
            }

            selected += PickedSkillChunk(
                skill = candidate.skill,
                chunk = ranked.chunk,
                tokenBudget = remainingTokens,
            )
            remainingTokens -= minOf(ranked.chunk.tokenEstimate.coerceAtLeast(1), remainingTokens)
            usedForSkill += 1
        }

        if (!candidate.fixed && usedForSkill > 0) {
            automaticSkillCount += 1
        }
    }

    return selected
}

private fun candidateScore(skill: UserSkill, queryTerms: Set<String>): Int =
    overlapScore(skill.keywords, queryTerms) * 2 +
        overlapScore(skillTerms("${skill.name} ${skill.description}"), queryTerms)

private fun chunkScore(chunk: UserSkillChunk, queryTerms: Set<String>): Int =
    overlapScore(chunk.keywords, queryTerms) +
        overlapScore(skillTerms(chunk.heading), queryTerms) * 2

private fun overlapScore(left: Iterable<String>, right: Set<String>): Int {
    var score = 0
    for (item in left) {
        if (item in right) {
            score += if (item.length >= 5) 3 else 1
        }
    }
    return score
}

private fun skillTerms(value: String): Set<String> {
    val terms = LinkedHashSet<String>()
    for (match in skillTermsPattern.findAll(value.lowercase(Locale.ROOT))) {
        val term = match.value
        if (cjkTermPattern.containsMatchIn(term)) {
            val codePoints = term.codePoints().toArray()
            if (codePoints.size <= 8) {
                terms += term
            }
            for (index in 0 until codePoints.size - 1) {
                terms += String(codePoints, index, 2)
            }
        } else if (term.length >= 2 && term !in skillStopWords) {
            terms += term
        }
    }
    return terms
}

private fun trimSkillContent(content: String, tokenBudget: Int): String {
    val normalized = content.trim()
    if (normalized.isBlank() || estimatedTokens(normalized) <= tokenBudget) {
        return normalized
    }

    val charBudget = maxOf(120, (tokenBudget * 3.8).toInt())
    val end = safeSkillContentEnd(normalized, charBudget.coerceAtMost(normalized.length))
    return normalized.substring(0, end).trimEnd() + "..."
}

private fun estimatedTokens(value: String): Int =
    maxOf(1, kotlin.math.ceil(value.length / 3.8).toInt())

private fun safeSkillContentEnd(value: String, end: Int): Int {
    if (end <= 0 || end >= value.length) {
        return end
    }

    return if (value[end - 1].isHighSurrogate() && value[end].isLowSurrogate()) {
        end - 1
    } else {
        end
    }
}
