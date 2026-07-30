package app.zerochat.ui.chat

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Test

class MessageMarkdownBlocksTest {
    @Test
    fun markdownBlocksRecognizeHeadingsParagraphsAndBulletLists() {
        val blocks = messageMarkdownBlocks(
            """
            # Release notes
            First line
            wraps softly.

            - Chat is faster
            - Code is clearer

            ### Details
            """.trimIndent(),
        )

        assertEquals(4, blocks.size)
        assertEquals(1, block<MessageMarkdownHeading>(blocks[0]).level)
        assertEquals("Release notes", block<MessageMarkdownHeading>(blocks[0]).text)
        assertEquals("First line wraps softly.", block<MessageMarkdownParagraph>(blocks[1]).text)
        assertEquals(
            listOf("Chat is faster", "Code is clearer"),
            block<MessageMarkdownBulletList>(blocks[2]).items.map { it.text },
        )
        assertEquals(3, block<MessageMarkdownHeading>(blocks[3]).level)
        assertEquals("Details", block<MessageMarkdownHeading>(blocks[3]).text)
    }

    @Test
    fun markdownHeadingRequiresSpaceAfterMarker() {
        val blocks = messageMarkdownBlocks("#Not a heading")

        assertEquals(listOf(MessageMarkdownParagraph("#Not a heading")), blocks)
    }

    @Test
    fun inlineLinksAcceptOnlyHttpAndHttpsUrls() {
        val links = messageInlineLinks(
            "Read [docs](https://example.com/guide) and [api](http://example.com/api), not [bad](javascript:alert(1)).",
        )

        assertEquals(
            listOf(
                MessageInlineLink(
                    start = 5,
                    end = 38,
                    label = "docs",
                    url = "https://example.com/guide",
                ),
                MessageInlineLink(
                    start = 43,
                    end = 72,
                    label = "api",
                    url = "http://example.com/api",
                ),
            ),
            links,
        )
    }

    @Test
    fun bareHttpUrlsBecomeSafeInlineLinksWithoutTrailingPunctuation() {
        val text = "Open https://example.com/docs?q=zerochat, then http://example.org/path."

        assertEquals(
            listOf(
                MessageInlineTextSpan("Open "),
                MessageInlineLinkSpan(
                    label = "https://example.com/docs?q=zerochat",
                    url = "https://example.com/docs?q=zerochat",
                ),
                MessageInlineTextSpan(", then "),
                MessageInlineLinkSpan(label = "http://example.org/path", url = "http://example.org/path"),
                MessageInlineTextSpan("."),
            ),
            messageInlineSpans(text),
        )
        assertEquals(
            listOf(
                MessageInlineLink(
                    start = 5,
                    end = 40,
                    label = "https://example.com/docs?q=zerochat",
                    url = "https://example.com/docs?q=zerochat",
                ),
                MessageInlineLink(
                    start = 47,
                    end = 70,
                    label = "http://example.org/path",
                    url = "http://example.org/path",
                ),
            ),
            messageInlineLinks(text),
        )
    }

    @Test
    fun explicitMarkdownLinksDoNotDuplicateBareUrlExtraction() {
        val text = "[docs](https://example.com/docs) and https://example.com/raw"

        assertEquals(
            listOf(
                MessageInlineLink(
                    start = 0,
                    end = 32,
                    label = "docs",
                    url = "https://example.com/docs",
                ),
                MessageInlineLink(
                    start = 37,
                    end = 60,
                    label = "https://example.com/raw",
                    url = "https://example.com/raw",
                ),
            ),
            messageInlineLinks(text),
        )
    }

    @Test
    fun safeMessageLinkUrlAcceptsOnlyHttpAndHttpsBrowserUrls() {
        assertEquals(
            "https://example.com/Guide?x=1#top",
            safeMessageLinkUrl(" https://example.com/Guide?x=1#top "),
        )
        assertEquals(
            "http://xn--fsqu00a.example/path",
            safeMessageLinkUrl("http://例子.example/path"),
        )
        assertEquals(null, safeMessageLinkUrl("javascript:alert(1)"))
        assertEquals(null, safeMessageLinkUrl("file:///sdcard/secret.txt"))
        assertEquals(null, safeMessageLinkUrl("https://example.com/has space"))
        assertEquals(null, safeMessageLinkUrl("https:///missing-host"))
        assertEquals(null, safeMessageLinkUrl(""))
    }

    @Test
    fun inlineSpansRecognizeCodeStrongEmphasisAndSafeLinks() {
        val spans = messageInlineSpans(
            "Use `pnpm test`, **strong**, *careful*, and [docs](https://example.com).",
        )

        assertEquals(
            listOf(
                MessageInlineTextSpan("Use "),
                MessageInlineCodeSpan("pnpm test"),
                MessageInlineTextSpan(", "),
                MessageInlineStrongSpan("strong"),
                MessageInlineTextSpan(", "),
                MessageInlineEmphasisSpan("careful"),
                MessageInlineTextSpan(", and "),
                MessageInlineLinkSpan(label = "docs", url = "https://example.com"),
                MessageInlineTextSpan("."),
            ),
            spans,
        )
    }

    @Test
    fun rawHtmlAndUnsafeInlineLinksStayPlainText() {
        val text = "<script>alert(1)</script> [bad](javascript:alert(1)) <b>bold</b>"

        assertEquals(listOf(MessageMarkdownParagraph(text)), messageMarkdownBlocks(text))
        assertEquals(listOf(MessageInlineTextSpan(text)), messageInlineSpans(text))
        assertEquals(emptyList<MessageInlineLink>(), messageInlineLinks(text))
    }

    @Test
    fun bulletListStopsBeforeFollowingParagraph() {
        val blocks = messageMarkdownBlocks(
            """
            - One
            - Two
            Plain text
            """.trimIndent(),
        )

        assertEquals(listOf("One", "Two"), block<MessageMarkdownBulletList>(blocks[0]).items.map { it.text })
        assertEquals("Plain text", block<MessageMarkdownParagraph>(blocks[1]).text)
    }

    @Test
    fun blockQuotesJoinConsecutiveQuoteLinesAndStaySeparateFromFlow() {
        val blocks = messageMarkdownBlocks(
            """
            Before
            > Important
            > **quoted** [docs](https://example.com)
            - Next
            """.trimIndent(),
        )

        assertEquals("Before", block<MessageMarkdownParagraph>(blocks[0]).text)
        assertEquals(
            "Important **quoted** [docs](https://example.com)",
            block<MessageMarkdownBlockQuote>(blocks[1]).text,
        )
        assertEquals(listOf("Next"), block<MessageMarkdownBulletList>(blocks[2]).items.map { it.text })
        assertEquals(
            listOf(
                MessageInlineTextSpan("Important "),
                MessageInlineStrongSpan("quoted"),
                MessageInlineTextSpan(" "),
                MessageInlineLinkSpan(label = "docs", url = "https://example.com"),
            ),
            messageInlineSpans(block<MessageMarkdownBlockQuote>(blocks[1]).text),
        )
    }

    @Test
    fun blockQuoteMarkerWithoutSpaceIsStillAQuote() {
        val blocks = messageMarkdownBlocks(">Quoted")

        assertEquals(listOf(MessageMarkdownBlockQuote("Quoted")), blocks)
        assertEquals("Quoted", messageMarkdownQuoteLine(">Quoted"))
        assertEquals("", messageMarkdownQuoteLine(">"))
        assertEquals(null, messageMarkdownQuoteLine("Not > a quote"))
    }

    @Test
    fun nestedBulletListsPreserveIndentDepth() {
        val blocks = messageMarkdownBlocks(
            """
            - Parent
              - Child
                - Grandchild
            - Next
            """.trimIndent(),
        )

        val bullets = block<MessageMarkdownBulletList>(blocks.single()).items
        assertEquals(listOf("Parent", "Child", "Grandchild", "Next"), bullets.map { it.text })
        assertEquals(listOf(0, 1, 2, 0), bullets.map { it.depth })
    }

    @Test
    fun orderedListsKeepStartNumberAndItems() {
        val blocks = messageMarkdownBlocks(
            """
            3. Open settings
            4. Pick a model
            5) Send a prompt
            """.trimIndent(),
        )

        val ordered = block<MessageMarkdownOrderedList>(blocks.single())
        assertEquals(3, ordered.start)
        assertEquals(
            listOf("Open settings", "Pick a model", "Send a prompt"),
            ordered.items.map { it.text },
        )
        assertEquals(listOf(3, 4, 5), ordered.items.map { it.number })
    }

    @Test
    fun orderedListsSeparateFromBulletsAndParagraphs() {
        val blocks = messageMarkdownBlocks(
            """
            1. First
            2. Second
            - Bullet
            Plain text
            """.trimIndent(),
        )

        val ordered = block<MessageMarkdownOrderedList>(blocks[0])
        assertEquals(1, ordered.start)
        assertEquals(listOf("First", "Second"), ordered.items.map { it.text })
        assertEquals(listOf("Bullet"), block<MessageMarkdownBulletList>(blocks[1]).items.map { it.text })
        assertEquals("Plain text", block<MessageMarkdownParagraph>(blocks[2]).text)
    }

    @Test
    fun nestedOrderedListsPreserveIndentDepthAndNumbers() {
        val blocks = messageMarkdownBlocks(
            """
            2. Plan
              1. Inspect
              2. Patch
            3. Verify
            """.trimIndent(),
        )

        val ordered = block<MessageMarkdownOrderedList>(blocks.single()).items
        assertEquals(listOf("Plan", "Inspect", "Patch", "Verify"), ordered.map { it.text })
        assertEquals(listOf(0, 1, 1, 0), ordered.map { it.depth })
        assertEquals(listOf(2, 1, 2, 3), ordered.map { it.number })
    }

    @Test
    fun markdownTablesRecognizeHeaderSeparatorAndRows() {
        val blocks = messageMarkdownBlocks(
            """
            Before

            | Name | Status |
            | --- | :---: |
            | Chat | Ready |
            | Sync | Needs QA |

            After
            """.trimIndent(),
        )

        assertEquals("Before", block<MessageMarkdownParagraph>(blocks[0]).text)
        val table = block<MessageMarkdownTable>(blocks[1])
        assertEquals(listOf("Name", "Status"), table.headers)
        assertEquals(
            listOf(
                listOf("Chat", "Ready"),
                listOf("Sync", "Needs QA"),
            ),
            table.rows,
        )
        assertEquals("After", block<MessageMarkdownParagraph>(blocks[2]).text)
    }

    @Test
    fun markdownTableRowsPadMissingCellsAndTrimExtraCells() {
        val blocks = messageMarkdownBlocks(
            """
            | A | B | C |
            | --- | --- | --- |
            | one | two |
            | one | two | three | four |
            """.trimIndent(),
        )

        val table = block<MessageMarkdownTable>(blocks.single())
        assertEquals(listOf("A", "B", "C"), table.headers)
        assertEquals(
            listOf(
                listOf("one", "two", ""),
                listOf("one", "two", "three"),
            ),
            table.rows,
        )
    }

    @Test
    fun pipeTextWithoutSeparatorStaysParagraph() {
        val blocks = messageMarkdownBlocks("Name | Status\nChat | Ready")

        assertEquals(listOf(MessageMarkdownParagraph("Name | Status Chat | Ready")), blocks)
    }

    private inline fun <reified T : MessageMarkdownBlock> block(value: MessageMarkdownBlock): T =
        assertInstanceOf(T::class.java, value) as T
}
