package app.zerochat.ui.chat

import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import app.zerochat.data.MessageRole
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class MessageBubblePlacementTest {
    @Test
    fun userMessagesKeepBubbleAndTextEndAligned() {
        val placement = messageBubblePlacement(MessageRole.User)

        assertEquals(Alignment.CenterEnd, placement.containerAlignment)
        assertEquals(Alignment.End, placement.contentAlignment)
        assertEquals(TextAlign.End, placement.textAlignment)
    }

    @Test
    fun assistantAndSystemMessagesKeepBubbleAndTextStartAligned() {
        listOf(MessageRole.Assistant, MessageRole.System).forEach { role ->
            val placement = messageBubblePlacement(role)

            assertEquals(Alignment.CenterStart, placement.containerAlignment)
            assertEquals(Alignment.Start, placement.contentAlignment)
            assertEquals(TextAlign.Start, placement.textAlignment)
        }
    }
}
