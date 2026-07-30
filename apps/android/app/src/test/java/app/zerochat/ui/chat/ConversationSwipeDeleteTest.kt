package app.zerochat.ui.chat

import androidx.compose.material3.SwipeToDismissBoxValue
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ConversationSwipeDeleteTest {
    @Test
    fun settledSwipeStateDoesNotRequestDeletion() {
        assertEquals(
            ConversationSwipeDeleteAction.None,
            conversationSwipeDeleteAction(SwipeToDismissBoxValue.Settled),
        )
    }

    @Test
    fun completedSwipeInEitherDirectionRequestsDeletionConfirmation() {
        assertEquals(
            ConversationSwipeDeleteAction.RequestDelete,
            conversationSwipeDeleteAction(SwipeToDismissBoxValue.StartToEnd),
        )
        assertEquals(
            ConversationSwipeDeleteAction.RequestDelete,
            conversationSwipeDeleteAction(SwipeToDismissBoxValue.EndToStart),
        )
    }
}
