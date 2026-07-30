@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.zerochat.data.SyncConfig
import app.zerochat.sync.FirstSyncStrategy
import app.zerochat.ui.NativeI18n
import java.text.DateFormat
import java.util.Date

@Composable
fun SyncStatusSection(
    sync: SyncConfig,
    onFirstSyncStrategy: (FirstSyncStrategy) -> Unit,
    i18n: NativeI18n,
) {
    val presentation = syncSettingsStatusPresentation(
        sync = sync,
        syncStatusMessage = i18n::syncStatusMessage,
        localizedConflictMessage = i18n.t("error.firstSyncConflict"),
    )
    presentation.statusMessage?.let { statusMessage ->
        Text(
            listOfNotNull(
                statusMessage,
                sync.lastSyncAt?.let { formatTimestamp(it) },
            ).joinToString(" · "),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    if (presentation.isFirstSyncConflict) {
        Text(
            i18n.t("error.firstSyncConflict"),
            color = MaterialTheme.colorScheme.error,
            fontWeight = FontWeight.SemiBold,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(onClick = { onFirstSyncStrategy(FirstSyncStrategy.Merge) }) {
                Text(i18n.t("button.mergeData"))
            }
            OutlinedButton(onClick = { onFirstSyncStrategy(FirstSyncStrategy.UseRemote) }) {
                Text(i18n.t("button.useCloudData"))
            }
            OutlinedButton(onClick = { onFirstSyncStrategy(FirstSyncStrategy.UseLocal) }) {
                Text(i18n.t("button.uploadThisDevice"))
            }
        }
    }
}

private fun formatTimestamp(value: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
        .format(Date(value))
