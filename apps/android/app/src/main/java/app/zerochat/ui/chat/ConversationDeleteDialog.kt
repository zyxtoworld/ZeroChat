package app.zerochat.ui.chat

import androidx.compose.runtime.Composable
import app.zerochat.data.Conversation
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.settings.DangerDialog
import app.zerochat.ui.settings.dangerBody

@Composable
fun ConversationDeleteDialog(
    conversation: Conversation,
    i18n: NativeI18n,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    DangerDialog(
        title = i18n.t("danger.deleteConversation.title"),
        body = conversationDeleteBody(i18n, conversationDisplayTitle(conversation, i18n)),
        confirm = i18n.t("action.delete"),
        i18n = i18n,
        onDismiss = onDismiss,
        onConfirm = onConfirm,
    )
}

private fun conversationDeleteBody(i18n: NativeI18n, title: String): String =
    dangerBody(i18n, "danger.deleteConversation").replace("{title}", title)
