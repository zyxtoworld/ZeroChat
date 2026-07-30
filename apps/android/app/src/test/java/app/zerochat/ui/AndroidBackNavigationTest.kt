package app.zerochat.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AndroidBackNavigationTest {
    @Test
    fun androidBackNavigationIgnoresPlainChat() {
        assertEquals(
            AndroidBackNavigationAction.None,
            androidBackNavigationAction(settingsOpen = false, conversationDeleteDialogOpen = false),
        )
    }

    @Test
    fun androidBackNavigationClosesSettingsSheet() {
        assertEquals(
            AndroidBackNavigationAction.CloseSettings,
            androidBackNavigationAction(settingsOpen = true, conversationDeleteDialogOpen = false),
        )
    }

    @Test
    fun androidBackNavigationClosesConversationDeleteBeforeSettings() {
        assertEquals(
            AndroidBackNavigationAction.DismissConversationDelete,
            androidBackNavigationAction(settingsOpen = true, conversationDeleteDialogOpen = true),
        )
    }
}
