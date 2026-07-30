package app.zerochat.ui.chat

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Test

class MessageContentBlocksTest {
    @Test
    fun fencedCodeBlocksKeepLanguageCodeAndSurroundingText() {
        val blocks = messageContentBlocks(
            """
            Before

            ```kotlin
            val answer = 42
            println(answer)
            ```

            After
            """.trimIndent(),
        )

        assertEquals(3, blocks.size)
        assertEquals("Before", block<MessageTextBlock>(blocks[0]).text)
        assertEquals("kotlin", block<MessageCodeBlock>(blocks[1]).language)
        assertEquals("val answer = 42\nprintln(answer)", block<MessageCodeBlock>(blocks[1]).code)
        assertEquals("After", block<MessageTextBlock>(blocks[2]).text)
    }

    @Test
    fun fencedCodeInfoStringFallsBackToFirstLanguageToken() {
        val blocks = messageContentBlocks(
            """
            ```tsx title=App.tsx
            export function App() {
              return null
            }
            ```
            """.trimIndent(),
        )

        val code = block<MessageCodeBlock>(blocks.single())
        assertEquals("tsx", code.language)
        assertEquals(
            "export function App() {\n  return null\n}",
            code.code,
        )
    }

    @Test
    fun blankCodeFenceLanguageFallsBackToText() {
        val blocks = messageContentBlocks(
            """
            ```
            plain text code
            ```
            """.trimIndent(),
        )

        val code = block<MessageCodeBlock>(blocks.single())
        assertEquals("text", code.language)
        assertEquals("plain text code", code.code)
    }

    @Test
    fun unterminatedFenceStaysPlainText() {
        val value = "Try this:\n```kotlin\nval open = true"

        assertEquals(listOf(MessageTextBlock(value)), messageContentBlocks(value))
    }

    @Test
    fun codeHighlightSpansRecognizeKeywordsStringsCommentsAndNumbers() {
        val code = """
            val answer = 42
            // say it
            println("ok")
        """.trimIndent()

        val spans = messageCodeHighlightSpans("kotlin", code)

        assertEquals(
            listOf(
                MessageCodeHighlightKind.Keyword to "val",
                MessageCodeHighlightKind.Number to "42",
                MessageCodeHighlightKind.Comment to "// say it",
                MessageCodeHighlightKind.String to "\"ok\"",
            ),
            spans.map { it.kind to code.substring(it.start, it.end) },
        )
    }

    @Test
    fun codeHighlightSpansSupportTypeScriptAliases() {
        val code = "export const ready = true"

        val spans = messageCodeHighlightSpans("tsx", code)

        assertEquals(
            listOf(
                MessageCodeHighlightKind.Keyword to "export",
                MessageCodeHighlightKind.Keyword to "const",
                MessageCodeHighlightKind.Keyword to "true",
            ),
            spans.map { it.kind to code.substring(it.start, it.end) },
        )
    }

    @Test
    fun codeHighlightSpansKeepPythonHashComments() {
        val code = "def run():\n  # safe\n  return 1"

        val spans = messageCodeHighlightSpans("python", code)

        assertEquals(
            listOf(
                MessageCodeHighlightKind.Keyword to "def",
                MessageCodeHighlightKind.Comment to "# safe",
                MessageCodeHighlightKind.Keyword to "return",
                MessageCodeHighlightKind.Number to "1",
            ),
            spans.map { it.kind to code.substring(it.start, it.end) },
        )
    }

    private inline fun <reified T : MessageContentBlock> block(value: MessageContentBlock): T =
        assertInstanceOf(T::class.java, value) as T
}
