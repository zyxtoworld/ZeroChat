package app.zerochat.ui.chat

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AndroidAdaptiveLayoutTest {
    @Test
    fun androidChatLayoutModeKeepsPhonesAndNarrowTabletsSinglePane() {
        assertEquals(AndroidChatLayoutMode.Compact, androidChatLayoutMode(360))
        assertEquals(AndroidChatLayoutMode.Compact, androidChatLayoutMode(600))
        assertEquals(AndroidChatLayoutMode.Compact, androidChatLayoutMode(839))
    }

    @Test
    fun androidChatLayoutModeUsesTwoPaneForExpandedTabletsAndFoldables() {
        assertEquals(AndroidChatLayoutMode.AdaptiveTwoPane, androidChatLayoutMode(840))
        assertEquals(AndroidChatLayoutMode.AdaptiveTwoPane, androidChatLayoutMode(1280))
    }

    @Test
    fun androidConversationSidebarWidthMatchesTabletRequirement() {
        assertEquals(320, ANDROID_CHAT_SIDEBAR_WIDTH_DP)
    }

    @Test
    fun androidCompactTopBarUsesIconActionsBeforeTheyCanCrowdOutTheTitle() {
        assertTrue(androidChatTopBarUsesIconActions(320))
        assertTrue(androidChatTopBarUsesIconActions(360))
        assertTrue(androidChatTopBarUsesIconActions(479))
        assertFalse(androidChatTopBarUsesIconActions(480))
        assertFalse(androidChatTopBarUsesIconActions(840))
    }

    @Test
    fun compactHeightHidesOptionalProviderModelHintToKeepSetupActionVisible() {
        assertTrue(androidChatShowsProviderModelFeatureHint(720, requested = true))
        assertFalse(androidChatShowsProviderModelFeatureHint(719, requested = true))
        assertFalse(androidChatShowsProviderModelFeatureHint(720, requested = false))
    }
}
