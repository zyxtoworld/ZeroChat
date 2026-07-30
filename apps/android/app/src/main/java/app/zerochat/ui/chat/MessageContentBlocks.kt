package app.zerochat.ui.chat

import java.util.Locale

internal sealed interface MessageContentBlock

internal data class MessageTextBlock(val text: String) : MessageContentBlock

internal data class MessageCodeBlock(
    val language: String,
    val code: String,
) : MessageContentBlock

internal enum class MessageCodeHighlightKind {
    Keyword,
    String,
    Comment,
    Number,
}

internal data class MessageCodeHighlightSpan(
    val start: Int,
    val end: Int,
    val kind: MessageCodeHighlightKind,
)

internal fun messageCodeHighlightSpans(
    language: String,
    code: String,
): List<MessageCodeHighlightSpan> {
    val keywords = messageCodeHighlightKeywords(language)
    val spans = mutableListOf<MessageCodeHighlightSpan>()
    var index = 0

    fun add(end: Int, kind: MessageCodeHighlightKind) {
        spans += MessageCodeHighlightSpan(
            start = index,
            end = end,
            kind = kind,
        )
        index = end
    }

    while (index < code.length) {
        val char = code[index]
        val next = code.getOrNull(index + 1)
        if (char == '/' && next == '/') {
            add(code.indexOf('\n', index).takeIf { it >= 0 } ?: code.length, MessageCodeHighlightKind.Comment)
            continue
        }
        if (messageCodeHashStartsComment(language, code, index)) {
            add(code.indexOf('\n', index).takeIf { it >= 0 } ?: code.length, MessageCodeHighlightKind.Comment)
            continue
        }
        if (char == '"' || char == '\'' || char == '`') {
            add(messageCodeStringEnd(code, index, char), MessageCodeHighlightKind.String)
            continue
        }
        if (char.isDigit() && messageCodeBoundaryBefore(code, index)) {
            val end = messageCodeNumberEnd(code, index)
            if (end > index && messageCodeBoundaryAfter(code, end)) {
                add(end, MessageCodeHighlightKind.Number)
                continue
            }
        }
        if (char == '_' || char.isLetter()) {
            val end = messageCodeWordEnd(code, index)
            val word = code.substring(index, end)
            if (word in keywords) {
                add(end, MessageCodeHighlightKind.Keyword)
                continue
            }
        }
        index += 1
    }

    return spans
}

internal fun messageCodeHighlightKeywords(language: String): Set<String> {
    val normalized = language.lowercase(Locale.ROOT)
    val common = setOf(
        "async",
        "await",
        "class",
        "const",
        "else",
        "enum",
        "false",
        "for",
        "fun",
        "function",
        "if",
        "import",
        "let",
        "null",
        "private",
        "return",
        "struct",
        "true",
        "val",
        "var",
        "when",
        "while",
    )
    return when (normalized) {
        "js", "jsx", "ts", "tsx", "javascript", "typescript" -> common + setOf(
            "export",
            "from",
            "interface",
            "type",
        )

        "kt", "kotlin", "java" -> common + setOf(
            "data",
            "internal",
            "object",
            "override",
            "sealed",
        )

        "py", "python" -> common + setOf(
            "def",
            "elif",
            "except",
            "finally",
            "in",
            "is",
            "lambda",
            "none",
            "pass",
            "with",
        )

        "rs", "rust" -> common + setOf(
            "impl",
            "match",
            "mut",
            "pub",
            "trait",
            "use",
        )

        "swift" -> common + setOf(
            "actor",
            "extension",
            "guard",
            "protocol",
        )

        else -> common
    }
}

private fun messageCodeHashStartsComment(
    language: String,
    code: String,
    index: Int,
): Boolean {
    if (code[index] != '#') {
        return false
    }
    val normalized = language.lowercase(Locale.ROOT)
    return normalized in setOf("bash", "sh", "shell", "zsh", "ps1", "powershell", "py", "python") &&
        messageCodeBoundaryBefore(code, index)
}

private fun messageCodeStringEnd(
    code: String,
    start: Int,
    quote: Char,
): Int {
    var index = start + 1
    while (index < code.length) {
        if (code[index] == '\\') {
            index += 2
            continue
        }
        if (code[index] == quote) {
            return index + 1
        }
        index += 1
    }
    return code.length
}

private fun messageCodeNumberEnd(code: String, start: Int): Int {
    var index = start
    while (index < code.length && (code[index].isDigit() || code[index] == '.')) {
        index += 1
    }
    return index
}

private fun messageCodeWordEnd(code: String, start: Int): Int {
    var index = start
    while (index < code.length && (code[index] == '_' || code[index].isLetterOrDigit())) {
        index += 1
    }
    return index
}

private fun messageCodeBoundaryBefore(code: String, index: Int): Boolean =
    index == 0 || !code[index - 1].isLetterOrDigit()

private fun messageCodeBoundaryAfter(code: String, index: Int): Boolean =
    index >= code.length || !code[index].isLetterOrDigit()

internal fun messageContentBlocks(content: String): List<MessageContentBlock> {
    val codeFence = Regex("(?m)^```([^\\r\\n`]*)\\r?\\n([\\s\\S]*?)\\r?\\n```[ \\t]*$")
    val blocks = mutableListOf<MessageContentBlock>()
    var cursor = 0

    for (match in codeFence.findAll(content)) {
        val text = content.substring(cursor, match.range.first)
        if (text.isNotBlank()) {
            blocks += MessageTextBlock(text.trim())
        }
        blocks += MessageCodeBlock(
            language = messageCodeLanguage(match.groupValues[1]),
            code = match.groupValues[2].trimEnd('\r', '\n'),
        )
        cursor = match.range.last + 1
    }

    val tail = content.substring(cursor)
    if (tail.isNotBlank()) {
        blocks += MessageTextBlock(tail.trim())
    }

    return blocks.ifEmpty { listOf(MessageTextBlock(content)) }
}

internal fun messageCodeLanguage(info: String): String =
    info.trim().split(Regex("\\s+")).firstOrNull { it.isNotBlank() } ?: "text"
