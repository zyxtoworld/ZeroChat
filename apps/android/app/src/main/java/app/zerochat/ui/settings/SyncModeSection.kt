package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.zerochat.data.AppSnapshot
import app.zerochat.ui.NativeI18n

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SyncModeSection(
    snapshot: AppSnapshot,
    onLocalSnapshotChange: (AppSnapshot) -> Unit,
    manualSyncRunning: Boolean,
    manualSyncBlockedReason: String?,
    onManualSyncClick: () -> Unit,
    i18n: NativeI18n,
) {
    val options = listOf("local", "gist", "cloudflare")
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(i18n.t("field.composeMode"))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { value ->
                FilterChip(
                    selected = value == snapshot.sync.mode,
                    onClick = {
                        onLocalSnapshotChange(syncSettingsSelectMode(snapshot, value))
                    },
                    label = {
                        Text(
                            when (value) {
                                "local" -> i18n.t("mode.local")
                                "gist" -> i18n.t("mode.gist")
                                "cloudflare" -> i18n.t("mode.cloudflare")
                                else -> value
                            },
                        )
                    },
                )
            }
        }
    }
    when (snapshot.sync.mode) {
        "local" -> Text(i18n.t("sync.requirement.local"))
        "gist" -> Text(i18n.t("sync.compare.gist.fit"))
        "cloudflare" -> Text(i18n.t("sync.compare.cloudflare.fit"))
    }
    Button(
        onClick = onManualSyncClick,
        enabled = !manualSyncRunning && manualSyncBlockedReason == null,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(i18n.t("button.syncNow"))
    }
    manualSyncBlockedReason?.let { reason ->
        Text(
            reason,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun AutoSyncControl(
    snapshot: AppSnapshot,
    onLocalSnapshotChange: (AppSnapshot) -> Unit,
    i18n: NativeI18n,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            i18n.t("field.autoSync"),
            modifier = Modifier.weight(1f),
        )
        Switch(
            checked = snapshot.sync.autoSync,
            onCheckedChange = {
                onLocalSnapshotChange(syncSettingsSetAutoSync(snapshot, it))
            },
        )
    }
    Text(
        if (snapshot.sync.autoSync) {
            i18n.t("sync.autoSync.on")
        } else {
            i18n.t("sync.autoSync.off")
        },
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
