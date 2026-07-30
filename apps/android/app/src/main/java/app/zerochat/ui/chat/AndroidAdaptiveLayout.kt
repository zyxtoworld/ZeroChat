package app.zerochat.ui.chat

internal const val ANDROID_CHAT_TWO_PANE_MIN_WIDTH_DP = 840
internal const val ANDROID_CHAT_SIDEBAR_WIDTH_DP = 320
internal const val ANDROID_CHAT_COMPACT_TOP_BAR_ACTIONS_MAX_WIDTH_DP = 480

internal enum class AndroidChatLayoutMode {
    Compact,
    AdaptiveTwoPane,
}

internal fun androidChatLayoutMode(widthDp: Int): AndroidChatLayoutMode =
    if (widthDp >= ANDROID_CHAT_TWO_PANE_MIN_WIDTH_DP) {
        AndroidChatLayoutMode.AdaptiveTwoPane
    } else {
        AndroidChatLayoutMode.Compact
    }

internal fun androidChatTopBarUsesIconActions(widthDp: Int): Boolean =
    widthDp < ANDROID_CHAT_COMPACT_TOP_BAR_ACTIONS_MAX_WIDTH_DP
