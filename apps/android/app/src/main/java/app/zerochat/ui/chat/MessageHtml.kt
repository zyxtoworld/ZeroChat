package app.zerochat.ui.chat

private data class AssistantHtmlTag(
    val name: String,
    val closing: Boolean,
    val selfClosing: Boolean,
    val attributes: String,
)

private data class AssistantHtmlList(
    val ordered: Boolean,
    var nextNumber: Int = 1,
)

private data class AssistantHtmlLink(val url: String?)

private val assistantHtmlTokenPattern = Regex(
    "(?is)<!--.*?-->|<![^>]*>|<\\s*/?\\s*[a-z][^>]*>",
)
private val assistantHtmlTagPattern = Regex(
    "(?is)^<\\s*(/?)\\s*([a-z][a-z0-9:-]*)(.*?)(/?)\\s*>$",
)
private val assistantHtmlAttributePattern = Regex(
    "(?is)([a-z][a-z0-9:-]*)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
)
private val assistantHtmlEntityPattern = Regex(
    "&(#x[0-9a-f]+|#\\d+|[a-z][a-z0-9]+);",
    RegexOption.IGNORE_CASE,
)
private val assistantHtmlWhitespacePattern = Regex("[\\t\\r ]+")
private val assistantHtmlExtraLinePattern = Regex("\\n{3,}")
private val assistantHtmlKnownTags = setOf(
    "a",
    "article",
    "aside",
    "b",
    "blockquote",
    "box",
    "br",
    "cite",
    "code",
    "dd",
    "details",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "footer",
    "grid",
    "grid-item",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "i",
    "icon",
    "kbd",
    "li",
    "main",
    "mark",
    "noscript",
    "ol",
    "p",
    "pre",
    "row",
    "s",
    "script",
    "section",
    "small",
    "span",
    "strong",
    "style",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "text",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
    "var",
)
private val assistantHtmlSuppressedTags = setOf("noscript", "script", "style", "template")
private val assistantHtmlVoidTags = setOf("br", "hr", "img", "input", "meta", "link")

/**
 * Converts common model-generated HTML to the Markdown subset rendered by the chat UI.
 * Fenced code is deliberately left untouched so code examples containing HTML stay code.
 */
internal fun normalizeAssistantHtmlOutsideCodeFences(content: String): String {
    if (!assistantHtmlLooksPresent(content)) {
        return content
    }

    val normalized = StringBuilder(content.length)
    var outsideStart = 0
    var fenceStart = -1
    var inFence = false
    var lineStart = 0

    fun appendOutside(segment: String) {
        val normalizedSegment = normalizeAssistantHtml(segment)
        if (normalizedSegment.isEmpty()) {
            return
        }
        if (normalized.isNotEmpty() && normalized.last() != '\n') {
            normalized.append('\n')
        }
        normalized.append(normalizedSegment)
    }

    while (lineStart <= content.length) {
        val lineEnd = content.indexOf('\n', lineStart).takeIf { it >= 0 } ?: content.length
        val line = content.substring(lineStart, lineEnd)
        val nextLineStart = if (lineEnd < content.length) lineEnd + 1 else content.length
        if (line.trimStart().startsWith("```")) {
            if (!inFence) {
                appendOutside(content.substring(outsideStart, lineStart))
                if (normalized.isNotEmpty() && normalized.last() != '\n') {
                    normalized.append('\n')
                }
                fenceStart = lineStart
                inFence = true
            } else {
                normalized.append(content.substring(fenceStart, nextLineStart))
                outsideStart = nextLineStart
                fenceStart = -1
                inFence = false
            }
        }
        if (lineEnd >= content.length) {
            break
        }
        lineStart = nextLineStart
    }

    if (inFence) {
        normalized.append(content.substring(fenceStart))
    } else {
        appendOutside(content.substring(outsideStart))
    }
    return normalized.toString()
}

private fun normalizeAssistantHtml(content: String): String {
    if (!assistantHtmlLooksPresent(content)) {
        return content
    }

    val output = StringBuilder(content.length)
    val lists = mutableListOf<AssistantHtmlList>()
    val links = mutableListOf<AssistantHtmlLink>()
    val suppressedTags = mutableListOf<String>()
    var preDepth = 0
    var cursor = 0

    fun ensureLineBreak() {
        if (output.isNotEmpty() && output.last() != '\n') {
            output.append('\n')
        }
    }

    fun ensureBlockBreak() {
        if (output.isEmpty()) {
            return
        }
        if (output.last() != '\n') {
            output.append('\n')
        }
        if (output.length < 2 || output[output.length - 2] != '\n') {
            output.append('\n')
        }
    }

    fun appendText(rawText: String) {
        if (rawText.isEmpty() || suppressedTags.isNotEmpty()) {
            return
        }
        val decoded = decodeAssistantHtmlEntities(rawText)
        if (preDepth > 0) {
            output.append(decoded)
        } else {
            output.append(assistantHtmlWhitespacePattern.replace(decoded, " "))
        }
    }

    for (match in assistantHtmlTokenPattern.findAll(content)) {
        appendText(content.substring(cursor, match.range.first))
        val tag = parseAssistantHtmlTag(match.value)
        cursor = match.range.last + 1
        if (tag == null) {
            continue
        }

        if (suppressedTags.isNotEmpty()) {
            if (tag.closing && tag.name == suppressedTags.last()) {
                suppressedTags.removeAt(suppressedTags.lastIndex)
            } else if (!tag.closing && !tag.selfClosing && tag.name == suppressedTags.last()) {
                suppressedTags += tag.name
            }
            continue
        }

        if (!tag.closing && tag.name in assistantHtmlSuppressedTags) {
            if (!tag.selfClosing) {
                suppressedTags += tag.name
            }
            continue
        }

        when (tag.name) {
            "p", "div", "section", "article", "header", "footer", "main", "aside", "figure", "figcaption" -> {
                if (tag.closing) ensureBlockBreak() else ensureBlockBreak()
            }

            "h1", "h2", "h3", "h4", "h5", "h6" -> {
                if (tag.closing) {
                    ensureBlockBreak()
                } else {
                    ensureBlockBreak()
                    output.append("#".repeat(tag.name.drop(1).toInt())).append(' ')
                }
            }

            "br" -> output.append('\n')
            "hr" -> {
                ensureBlockBreak()
                output.append("---")
                ensureBlockBreak()
            }

            "ul", "ol" -> {
                if (tag.closing) {
                    ensureBlockBreak()
                    if (lists.isNotEmpty()) lists.removeAt(lists.lastIndex)
                } else {
                    ensureBlockBreak()
                    lists += AssistantHtmlList(ordered = tag.name == "ol")
                }
            }

            "box", "grid", "grid-item" -> ensureBlockBreak()
            "row", "text", "icon", "cite" -> Unit

            "li" -> {
                if (tag.closing) {
                    ensureLineBreak()
                } else {
                    ensureLineBreak()
                    val depth = (lists.size - 1).coerceAtLeast(0)
                    output.append("  ".repeat(depth))
                    val list = lists.lastOrNull()
                    if (list?.ordered == true) {
                        output.append(list.nextNumber++).append(". ")
                    } else {
                        output.append("- ")
                    }
                }
            }

            "blockquote" -> {
                if (tag.closing) {
                    ensureBlockBreak()
                } else {
                    ensureBlockBreak()
                    output.append("> ")
                }
            }

            "pre" -> {
                if (tag.closing) {
                    if (preDepth > 0) preDepth -= 1
                    ensureLineBreak()
                    output.append("```")
                    ensureBlockBreak()
                } else {
                    ensureBlockBreak()
                    output.append("```\n")
                    preDepth += 1
                }
            }

            "code" -> if (preDepth == 0) output.append('`')
            "strong", "b" -> output.append("**")
            "em", "i" -> output.append('*')
            "a" -> {
                if (tag.closing) {
                    val link = links.removeLastOrNull()
                    link?.url?.let { output.append("](").append(it).append(')') }
                } else {
                    val url = assistantHtmlAttribute(tag.attributes, "href")
                        ?.let(::decodeAssistantHtmlEntities)
                        ?.let(::safeMessageLinkUrl)
                    links += AssistantHtmlLink(url)
                    if (url != null) output.append('[')
                }
            }

            "table", "thead", "tbody", "tfoot" -> {
                if (tag.closing) ensureBlockBreak() else ensureBlockBreak()
            }

            "tr" -> {
                if (tag.closing) {
                    ensureLineBreak()
                } else {
                    ensureLineBreak()
                }
            }

            "td", "th" -> if (tag.closing) output.append(" | ") else output.append("| ")
            "dl" -> if (tag.closing) ensureBlockBreak() else ensureBlockBreak()
            "dt" -> if (tag.closing) ensureLineBreak() else ensureBlockBreak()
            "dd" -> if (tag.closing) ensureLineBreak() else {
                ensureLineBreak()
                output.append("- ")
            }
            "details", "summary" -> if (tag.closing) ensureBlockBreak() else ensureBlockBreak()
            else -> Unit
        }
    }

    appendText(content.substring(cursor))
    return output.toString()
        .replace("\r\n", "\n")
        .replace(Regex("[ \\t]+\\n"), "\n")
        .replace(assistantHtmlExtraLinePattern, "\n\n")
        .trim()
}

private fun assistantHtmlLooksPresent(content: String): Boolean =
    assistantHtmlTokenPattern.findAll(content).any { match ->
        parseAssistantHtmlTag(match.value)?.name in assistantHtmlKnownTags
    }

private fun parseAssistantHtmlTag(rawTag: String): AssistantHtmlTag? {
    val match = assistantHtmlTagPattern.matchEntire(rawTag) ?: return null
    val name = match.groupValues[2].lowercase()
    val attributes = match.groupValues[3]
    val selfClosing = match.groupValues[4].isNotBlank() || name in assistantHtmlVoidTags
    return AssistantHtmlTag(
        name = name,
        closing = match.groupValues[1].isNotBlank(),
        selfClosing = selfClosing,
        attributes = attributes,
    )
}

private fun assistantHtmlAttribute(attributes: String, name: String): String? =
    assistantHtmlAttributePattern.findAll(attributes)
        .firstOrNull { it.groupValues[1].equals(name, ignoreCase = true) }
        ?.let { match ->
            match.groupValues[2].ifEmpty {
                match.groupValues[3].ifEmpty { match.groupValues[4] }
            }
        }

private fun decodeAssistantHtmlEntities(value: String): String =
    assistantHtmlEntityPattern.replace(value) { match ->
        val entity = match.groupValues[1]
        when {
            entity.equals("amp", ignoreCase = true) -> "&"
            entity.equals("apos", ignoreCase = true) -> "'"
            entity.equals("gt", ignoreCase = true) -> ">"
            entity.equals("lt", ignoreCase = true) -> "<"
            entity.equals("nbsp", ignoreCase = true) -> " "
            entity.equals("quot", ignoreCase = true) -> "\""
            entity.equals("hellip", ignoreCase = true) -> "…"
            entity.equals("ndash", ignoreCase = true) -> "–"
            entity.equals("mdash", ignoreCase = true) -> "—"
            entity.equals("bull", ignoreCase = true) -> "•"
            entity.equals("copy", ignoreCase = true) -> "©"
            entity.equals("reg", ignoreCase = true) -> "®"
            entity.equals("trade", ignoreCase = true) -> "™"
            entity.equals("rarr", ignoreCase = true) -> "→"
            entity.equals("larr", ignoreCase = true) -> "←"
            entity.equals("le", ignoreCase = true) -> "≤"
            entity.equals("ge", ignoreCase = true) -> "≥"
            entity.equals("times", ignoreCase = true) -> "×"
            entity.equals("plusmn", ignoreCase = true) -> "±"
            entity.equals("frac12", ignoreCase = true) -> "½"
            entity.startsWith("#x", ignoreCase = true) ->
                entity.drop(2).toIntOrNull(16)?.let(::assistantHtmlCodePoint) ?: match.value
            entity.startsWith("#") ->
                entity.drop(1).toIntOrNull()?.let(::assistantHtmlCodePoint) ?: match.value
            else -> match.value
        }
    }

private fun assistantHtmlCodePoint(value: Int): String =
    runCatching { String(Character.toChars(value)) }.getOrElse { "" }
