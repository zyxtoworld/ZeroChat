package app.zerochat.ui.chat

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import app.zerochat.ui.NativeI18n

@Composable
internal fun MessageDeleteDialog(
    i18n: NativeI18n,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(i18n.t("danger.deleteMessage.title")) },
        text = {
            Text(
                text = i18n.t("danger.deleteMessage.body"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(
                    text = i18n.t("action.delete"),
                    color = MaterialTheme.colorScheme.error,
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(i18n.t("action.cancel"))
            }
        },
    )
}
