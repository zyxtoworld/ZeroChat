package app.zerochat.ui.settings

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.zerochat.ui.NativeI18n

@Composable
fun DataDangerActions(
    onResetLocalData: () -> Unit,
    onClearCloudData: () -> Unit,
    resetEnabled: Boolean = true,
    i18n: NativeI18n,
) {
    OutlinedButton(
        onClick = onResetLocalData,
        enabled = resetEnabled,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(i18n.t("action.resetLocalData"))
    }
    OutlinedButton(
        onClick = onClearCloudData,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(i18n.t("action.clearCloudData"))
    }
}
