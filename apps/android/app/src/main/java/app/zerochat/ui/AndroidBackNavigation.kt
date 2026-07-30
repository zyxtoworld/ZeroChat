package app.zerochat.ui

enum class AndroidBackNavigationAction {
    None,
    DismissConversationDelete,
    CloseSettings,
}

internal fun androidBackNavigationAction(
    settingsOpen: Boolean,
    conversationDeleteDialogOpen: Boolean,
): AndroidBackNavigationAction = when {
    conversationDeleteDialogOpen -> AndroidBackNavigationAction.DismissConversationDelete
    settingsOpen -> AndroidBackNavigationAction.CloseSettings
    else -> AndroidBackNavigationAction.None
}
