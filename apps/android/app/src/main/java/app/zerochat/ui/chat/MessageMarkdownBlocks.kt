package app.zerochat.ui.chat

import java.net.IDN
import java.net.URI
import java.util.Locale

internal sealed interface MessageMarkdownBlock

internal data class MessageMarkdownHeading(
    val level: Int,
    val text: String,
) : MessageMarkdownBlock

internal data class MessageMarkdownParagraph(val text: String) : MessageMarkdownBlock

internal data class MessageMarkdownBlockQuote(val text: String) : MessageMarkdownBlock

internal data class MessageMarkdownListItem(
    val text: String,
    val depth: Int = 0,
    val number: Int? = null,
)

internal data class MessageMarkdownBulletList(val items: List<MessageMarkdownListItem>) : MessageMarkdownBlock

internal data class MessageMarkdownOrderedList(
    val start: Int,
    val items: List<MessageMarkdownListItem>,
) : MessageMarkdownBlock

internal data class MessageMarkdownTable(
    val headers: List<String>,
    val rows: List<List<String>>,
) : MessageMarkdownBlock

internal data class MessageInlineLink(
    val start: Int,
    val end: Int,
    val label: String,
    val url: String,
)

internal sealed interface MessageInlineSpan

internal data class MessageInlineTextSpan(val text: String) : MessageInlineSpan

internal data class MessageInlineStrongSpan(val text: String) : MessageInlineSpan

internal data class MessageInlineEmphasisSpan(val text: String) : MessageInlineSpan

internal data class MessageInlineCodeSpan(val code: String) : MessageInlineSpan

internal data class MessageInlineLinkSpan(
    val label: String,
    val url: String,
) : MessageInlineSpan

internal fun messageMarkdownBlocks(text: String): List<MessageMarkdownBlock> {
    val blocks = mutableListOf<MessageMarkdownBlock>()
    val paragraphLines = mutableListOf<String>()
    val quoteLines = mutableListOf<String>()
    val bulletItems = mutableListOf<MessageMarkdownListItem>()
    var orderedStart: Int? = null
    val orderedItems = mutableListOf<MessageMarkdownListItem>()
    val lines = text.lines()
    var index = 0

    fun flushParagraph() {
        if (paragraphLines.isNotEmpty()) {
            blocks += MessageMarkdownParagraph(paragraphLines.joinToString(" ").trim())
            paragraphLines.clear()
        }
    }

    fun flushQuotes() {
        if (quoteLines.isNotEmpty()) {
            blocks += MessageMarkdownBlockQuote(quoteLines.joinToString(" ").trim())
            quoteLines.clear()
        }
    }

    fun flushBullets() {
        if (bulletItems.isNotEmpty()) {
            blocks += MessageMarkdownBulletList(bulletItems.toList())
            bulletItems.clear()
        }
    }

    fun flushOrdered() {
        val start = orderedStart
        if (start != null && orderedItems.isNotEmpty()) {
            blocks += MessageMarkdownOrderedList(
                start = start,
                items = orderedItems.toList(),
            )
            orderedStart = null
            orderedItems.clear()
        }
    }

    fun flushLists() {
        flushBullets()
        flushOrdered()
    }

    fun flushFlow() {
        flushParagraph()
        flushQuotes()
        flushLists()
    }

    while (index < lines.size) {
        val trimmed = lines[index].trim()
        if (trimmed.isEmpty()) {
            flushFlow()
            index += 1
            continue
        }

        val table = messageMarkdownTableAt(lines, index)
        if (table != null) {
            flushFlow()
            blocks += table.table
            index = table.nextIndex
            continue
        }

        val heading = Regex("^(#{1,6})\\s+(.+)$").matchEntire(trimmed)
        if (heading != null) {
            flushFlow()
            blocks += MessageMarkdownHeading(
                level = heading.groupValues[1].length,
                text = heading.groupValues[2].trim(),
            )
            index += 1
            continue
        }

        val quote = messageMarkdownQuoteLine(lines[index])
        if (quote != null) {
            flushParagraph()
            flushLists()
            quoteLines += quote
            index += 1
            continue
        }

        val bullet = messageMarkdownBulletListItem(lines[index])
        if (bullet != null) {
            flushParagraph()
            flushQuotes()
            flushOrdered()
            bulletItems += bullet
            index += 1
            continue
        }

        val ordered = messageMarkdownOrderedListItem(lines[index])
        if (ordered != null) {
            flushParagraph()
            flushQuotes()
            flushBullets()
            if (orderedStart == null) {
                orderedStart = ordered.number ?: 1
            }
            orderedItems += ordered
            index += 1
            continue
        }

        flushQuotes()
        flushLists()
        paragraphLines += trimmed
        index += 1
    }

    flushFlow()

    return blocks.ifEmpty { listOf(MessageMarkdownParagraph(text)) }
}

internal fun messageMarkdownQuoteLine(line: String): String? {
    val match = Regex("^\\s*>\\s?(.*)$").matchEntire(line) ?: return null
    return match.groupValues[1].trim()
}

internal fun messageMarkdownBulletListItem(line: String): MessageMarkdownListItem? {
    val match = Regex("^(\\s*)[-*+]\\s+(.+)$").matchEntire(line) ?: return null
    return MessageMarkdownListItem(
        text = match.groupValues[2].trim(),
        depth = messageMarkdownListDepth(match.groupValues[1]),
    )
}

internal fun messageMarkdownOrderedListItem(line: String): MessageMarkdownListItem? {
    val match = Regex("^(\\s*)(\\d+)[.)]\\s+(.+)$").matchEntire(line) ?: return null
    val number = match.groupValues[2].toIntOrNull() ?: return null
    return MessageMarkdownListItem(
        text = match.groupValues[3].trim(),
        depth = messageMarkdownListDepth(match.groupValues[1]),
        number = number,
    )
}

internal fun messageMarkdownListDepth(indent: String): Int =
    (indent.replace("\t", "    ").length / 2).coerceIn(0, 6)

private data class ParsedMarkdownTable(
    val table: MessageMarkdownTable,
    val nextIndex: Int,
)

private fun messageMarkdownTableAt(
    lines: List<String>,
    startIndex: Int,
): ParsedMarkdownTable? {
    val headers = messageMarkdownTableCells(lines.getOrNull(startIndex) ?: return null) ?: return null
    val separator = messageMarkdownTableCells(lines.getOrNull(startIndex + 1) ?: return null) ?: return null
    if (!messageMarkdownTableSeparator(separator) || separator.size != headers.size) {
        return null
    }

    val rows = mutableListOf<List<String>>()
    var index = startIndex + 2
    while (index < lines.size) {
        val cells = messageMarkdownTableCells(lines[index]) ?: break
        if (messageMarkdownTableSeparator(cells)) {
            break
        }
        rows += messageMarkdownNormalizeTableRow(cells, headers.size)
        index += 1
    }

    return ParsedMarkdownTable(
        table = MessageMarkdownTable(
            headers = messageMarkdownNormalizeTableRow(headers, headers.size),
            rows = rows,
        ),
        nextIndex = index,
    )
}

internal fun messageMarkdownTableCells(line: String): List<String>? {
    val trimmed = line.trim()
    if (!trimmed.contains('|')) {
        return null
    }

    val cells = trimmed
        .trim('|')
        .split('|')
        .map { it.trim() }

    return cells.takeIf { it.size >= 2 && it.any { cell -> cell.isNotBlank() } }
}

internal fun messageMarkdownTableSeparator(cells: List<String>): Boolean =
    cells.size >= 2 && cells.all { Regex(":?-{3,}:?").matches(it) }

internal fun messageMarkdownNormalizeTableRow(
    cells: List<String>,
    size: Int,
): List<String> = when {
    cells.size == size -> cells
    cells.size < size -> cells + List(size - cells.size) { "" }
    else -> cells.take(size)
}

internal fun messageInlineSpans(text: String): List<MessageInlineSpan> {
    val spans = mutableListOf<MessageInlineSpan>()
    var cursor = 0
    var plainStart = 0

    fun flushPlain(until: Int) {
        if (plainStart < until) {
            spans += MessageInlineTextSpan(text.substring(plainStart, until))
        }
    }

    while (cursor < text.length) {
        val parsed = messageInlineSpanAt(text, cursor)
        if (parsed != null) {
            flushPlain(cursor)
            spans += parsed.span
            cursor = parsed.end
            plainStart = cursor
        } else {
            cursor += 1
        }
    }

    flushPlain(text.length)
    return spans.ifEmpty { listOf(MessageInlineTextSpan(text)) }
}

private data class ParsedInlineSpan(
    val span: MessageInlineSpan,
    val end: Int,
)

private fun messageInlineSpanAt(text: String, start: Int): ParsedInlineSpan? {
    if (text[start] == '`') {
        val end = text.indexOf('`', start + 1)
        if (end > start + 1) {
            return ParsedInlineSpan(
                span = MessageInlineCodeSpan(text.substring(start + 1, end)),
                end = end + 1,
            )
        }
    }

    if (text.startsWith("**", start)) {
        val end = text.indexOf("**", start + 2)
        if (end > start + 2) {
            return ParsedInlineSpan(
                span = MessageInlineStrongSpan(text.substring(start + 2, end)),
                end = end + 2,
            )
        }
    }

    if (text[start] == '*' && !text.startsWith("**", start)) {
        val end = text.indexOf('*', start + 1)
        if (end > start + 1) {
            return ParsedInlineSpan(
                span = MessageInlineEmphasisSpan(text.substring(start + 1, end)),
                end = end + 1,
            )
        }
    }

    if (text[start] == '[') {
        val labelEnd = text.indexOf("](", start + 1)
        val urlEnd = if (labelEnd > start) text.indexOf(')', labelEnd + 2) else -1
        if (urlEnd > labelEnd + 2) {
            val label = text.substring(start + 1, labelEnd)
            val url = text.substring(labelEnd + 2, urlEnd)
            if (
                label.isNotBlank() &&
                !label.contains('\n') &&
                Regex("https?://[^\\s)]+").matches(url)
            ) {
                return ParsedInlineSpan(
                    span = MessageInlineLinkSpan(label = label, url = url),
                    end = urlEnd + 1,
                )
            }
        }
    }

    val autoLink = messageInlineAutoLinkAt(text, start)
    if (autoLink != null) {
        return autoLink
    }

    return null
}

internal fun messageInlineLinks(text: String): List<MessageInlineLink> {
    val links = mutableListOf<MessageInlineLink>()
    val explicitLinkPattern = Regex("\\[([^\\]]+)]\\((https?://[^\\s)]+)\\)")
    val explicitRanges = mutableListOf<IntRange>()

    explicitLinkPattern.findAll(text).forEach { match ->
        explicitRanges += match.range
        links += MessageInlineLink(
            start = match.range.first,
            end = match.range.last + 1,
            label = match.groupValues[1],
            url = match.groupValues[2],
        )
    }

    Regex("""https?://[^\s<>()\]]+""").findAll(text).forEach { match ->
        if (explicitRanges.any { match.range.first in it }) {
            return@forEach
        }

        val url = messageInlineTrimAutoLinkUrl(match.value)
        if (url.isBlank()) {
            return@forEach
        }

        links += MessageInlineLink(
            start = match.range.first,
            end = match.range.first + url.length,
            label = url,
            url = url,
        )
    }

    return links.sortedBy { it.start }
}

private fun messageInlineAutoLinkAt(text: String, start: Int): ParsedInlineSpan? {
    if (!text.startsWith("http://", start) && !text.startsWith("https://", start)) {
        return null
    }
    if (start > 0 && (text[start - 1].isLetterOrDigit() || text[start - 1] == '/' || text[start - 1] == '[')) {
        return null
    }

    val rawEnd = text.indexOfAny(charArrayOf(' ', '\n', '\r', '\t', '<', '>', '(', ')', ']'), start)
        .takeIf { it >= 0 }
        ?: text.length
    val rawUrl = text.substring(start, rawEnd)
    val url = messageInlineTrimAutoLinkUrl(rawUrl)
    if (url.isBlank() || safeMessageLinkUrl(url) == null) {
        return null
    }

    return ParsedInlineSpan(
        span = MessageInlineLinkSpan(label = url, url = url),
        end = start + url.length,
    )
}

private fun messageInlineTrimAutoLinkUrl(url: String): String =
    url.trimEnd('.', ',', ';', ':', '!', '?')

internal fun safeMessageLinkUrl(url: String): String? {
    val trimmed = url.trim()
    if (trimmed.isBlank() || trimmed.any { it.isWhitespace() }) {
        return null
    }

    val parsed = runCatching { URI(trimmed) }.getOrNull() ?: return null
    val scheme = parsed.scheme?.lowercase(Locale.ROOT) ?: return null
    if (scheme !in setOf("http", "https")) {
        return null
    }

    val authority = normalizedMessageLinkAuthority(parsed) ?: return null
    val path = parsed.rawPath.orEmpty()
    val query = parsed.rawQuery?.let { "?$it" }.orEmpty()
    val fragment = parsed.rawFragment?.let { "#$it" }.orEmpty()

    return runCatching { URI("$scheme://$authority$path$query$fragment").toASCIIString() }.getOrNull()
}

private fun normalizedMessageLinkAuthority(parsed: URI): String? {
    val rawAuthority = parsed.rawAuthority ?: return null
    if (rawAuthority.contains('@')) {
        return null
    }

    if (rawAuthority.startsWith("[")) {
        val bracketEnd = rawAuthority.indexOf(']')
        if (bracketEnd <= 0) {
            return null
        }
        val suffix = rawAuthority.substring(bracketEnd + 1)
        if (suffix.isNotEmpty() && !Regex("^:\\d{1,5}$").matches(suffix)) {
            return null
        }
        return rawAuthority
    }

    val portSeparator = rawAuthority.lastIndexOf(':')
    val hasPort = portSeparator > 0 &&
        rawAuthority.substring(portSeparator + 1).all { it.isDigit() }
    val hostPart = if (hasPort) rawAuthority.substring(0, portSeparator) else rawAuthority
    val portPart = if (hasPort) rawAuthority.substring(portSeparator) else ""
    if (hostPart.isBlank()) {
        return null
    }

    val asciiHost = runCatching { IDN.toASCII(hostPart) }
        .getOrNull()
        ?.takeIf { it.isNotBlank() }
        ?: return null

    return asciiHost + portPart
}
