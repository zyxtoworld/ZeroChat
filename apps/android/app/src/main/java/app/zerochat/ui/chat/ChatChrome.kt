@file:OptIn(
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package app.zerochat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.ai.ImageUpload
import app.zerochat.client.R
import app.zerochat.data.AppSnapshot
import app.zerochat.sync.LocalUserTriggeredSyncAction
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.ComposerMode
import app.zerochat.ui.ImageTaskMode
import app.zerochat.ui.NativeI18n
import java.text.DateFormat
import java.util.Date

enum class NoticeKind {
    Success,
    Warning,
    Error,
}

data class InlineNotice(
    val message: String,
    val kind: NoticeKind,
)

private const val ManualSyncProgressTestTag = "zerochat-cloud-sync-progress"

@Composable
internal fun ProviderModelSelector(
    providers: List<ProviderConfig>,
    activeProvider: ProviderConfig?,
    mode: ComposerMode,
    activeModel: String,
    providerDisplayName: (ProviderConfig) -> String,
    chatModelsForProvider: (ProviderConfig) -> List<String>,
    imageModelsForProvider: (ProviderConfig) -> List<String>,
    onSelected: (ProviderConfig, String) -> Unit,
    i18n: NativeI18n,
) {
    var sheetOpen by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val activeModelLabel = activeModel.ifBlank { i18n.t("message.chooseModel") }

    Box(modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
        OutlinedButton(
            onClick = { sheetOpen = true },
            enabled = providers.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (activeProvider == null) {
                    i18n.t("message.noEnabledProvider")
                } else {
                    "${providerDisplayName(activeProvider)} / $activeModelLabel"
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }

    if (sheetOpen) {
        ModalBottomSheet(
            onDismissRequest = { sheetOpen = false },
            sheetState = sheetState,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    i18n.t("message.chooseModel"),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                activeProvider?.let { provider ->
                    Text(
                        "${providerDisplayName(provider)} / $activeModelLabel",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 480.dp),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = 8.dp,
                    end = 16.dp,
                    bottom = 24.dp,
                ),
            ) {
                providers.forEach { provider ->
                    item(key = "provider-${provider.id}") {
                        ProviderModelSheetHeader(providerDisplayName(provider))
                    }

                    val models = providerModelSheetModels(
                        provider = provider,
                        mode = mode,
                        chatModelsForProvider = chatModelsForProvider,
                        imageModelsForProvider = imageModelsForProvider,
                    )
                    if (models.isEmpty()) {
                        item(key = "empty-${provider.id}") {
                            ProviderModelSheetEmptyRow(
                                text = i18n.t(providerModelSheetEmptyMessageKey(mode)),
                            )
                        }
                    } else {
                        items(
                            items = models,
                            key = { model -> "model-${provider.id}-$model" },
                        ) { model ->
                            ProviderModelSheetModelRow(
                                model = model,
                                selected = provider.id == activeProvider?.id && model == activeModel,
                                onClick = {
                                    sheetOpen = false
                                    onSelected(provider, model)
                                },
                            )
                        }
                    }
                    item(key = "divider-${provider.id}") {
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
private fun ProviderModelSheetHeader(name: String) {
    Text(
        name,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        color = MaterialTheme.colorScheme.primary,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun ProviderModelSheetEmptyRow(text: String) {
    ListItem(
        headlineContent = {
            Text(
                text,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        },
    )
}

@Composable
private fun ProviderModelSheetModelRow(
    model: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    ListItem(
        headlineContent = {
            Text(
                model,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        colors = ListItemDefaults.colors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    )
}

internal fun providerModelSheetModels(
    provider: ProviderConfig,
    mode: ComposerMode,
    chatModelsForProvider: (ProviderConfig) -> List<String>,
    imageModelsForProvider: (ProviderConfig) -> List<String>,
): List<String> = when (mode) {
    ComposerMode.Chat -> chatModelsForProvider(provider)
    ComposerMode.Image -> imageModelsForProvider(provider)
}

internal fun providerModelSheetEmptyMessageKey(mode: ComposerMode): String = when (mode) {
    ComposerMode.Chat -> "message.noModels"
    ComposerMode.Image -> "message.imageModelRequired"
}

@Composable
internal fun InlineNoticeView(notice: InlineNotice?) {
    if (notice == null) {
        return
    }

    val colors = when (notice.kind) {
        NoticeKind.Success -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        NoticeKind.Warning -> MaterialTheme.colorScheme.tertiaryContainer to MaterialTheme.colorScheme.onTertiaryContainer
        NoticeKind.Error -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
    }

    Text(
        text = notice.message,
        color = colors.second,
        modifier = Modifier
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .fillMaxWidth()
            .background(colors.first, RoundedCornerShape(8.dp))
            .padding(10.dp),
    )
}

@Composable
internal fun FeatureHintCard(
    id: String,
    message: String,
    dismissLabel: String,
    onDismiss: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .testTag("zerochat-feature-hint-$id")
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painter = painterResource(id = R.drawable.ic_lightbulb_24),
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Text(
                message,
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.heightIn(min = 40.dp),
                contentPadding = PaddingValues(horizontal = 8.dp),
            ) {
                Text(
                    dismissLabel,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
internal fun CloudSyncStatusStrip(
    snapshot: AppSnapshot,
    compact: Boolean,
    manualSyncRunning: Boolean,
    manualSyncBlockedReason: String?,
    onSyncClick: () -> Unit,
    onOpenSettings: () -> Unit,
    onDismiss: () -> Unit,
    i18n: NativeI18n,
) {
    val userTriggeredSyncAction = LocalUserTriggeredSyncAction.current
    val cloudSyncConfigured = snapshot.sync.mode != "local"
    val syncStatus = cloudSyncStatus(snapshot, i18n)
    val syncSummary = cloudSyncSummary(snapshot, syncStatus, i18n)
    val primaryActionText = if (cloudSyncConfigured) {
        i18n.t("button.syncNow")
    } else {
        i18n.t("action.startCloudSync")
    }
    val primaryActionEnabled = manualSyncActionEnabled(
        manualSyncRunning = manualSyncRunning,
        cloudSyncConfigured = cloudSyncConfigured,
        manualSyncBlockedReason = manualSyncBlockedReason,
    )
    val primaryAction = if (cloudSyncConfigured) {
        { userTriggeredSyncAction.run(onSyncClick) }
    } else {
        onOpenSettings
    }

    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .testTag("zerochat-cloud-sync-status"),
    ) {
        if (compact) {
            Row(
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedButton(
                    onClick = onOpenSettings,
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 40.dp)
                        .semantics {
                            contentDescription = "${i18n.t("setting.sync")} $syncSummary"
                        },
                    contentPadding = PaddingValues(horizontal = 8.dp),
                ) {
                    Icon(
                        painter = painterResource(id = R.drawable.ic_cloud_sync_24),
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        i18n.t("setting.sync"),
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                TextButton(
                    onClick = primaryAction,
                    enabled = primaryActionEnabled,
                    modifier = Modifier
                        .heightIn(min = 40.dp)
                        .semantics {
                            if (manualSyncRunning) {
                                stateDescription = i18n.t("sync.status.inProgress")
                            }
                        },
                    contentPadding = PaddingValues(horizontal = 8.dp),
                ) {
                    if (manualSyncRunning) {
                        CloudSyncProgressIndicator()
                        Spacer(modifier = Modifier.width(6.dp))
                    }
                    Text(
                        primaryActionText,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.heightIn(min = 40.dp),
                    contentPadding = PaddingValues(horizontal = 4.dp),
                ) {
                    Text(
                        i18n.t("featureHint.dismiss"),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        } else {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        painter = painterResource(id = R.drawable.ic_cloud_sync_24),
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        i18n.t("setting.sync"),
                        modifier = Modifier.weight(1f),
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.heightIn(min = 40.dp),
                        contentPadding = PaddingValues(horizontal = 4.dp),
                    ) {
                        Text(
                            i18n.t("featureHint.dismiss"),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Text(
                    syncSummary,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onOpenSettings) {
                        Text(i18n.t("title.settings"))
                    }
                    Button(
                        onClick = primaryAction,
                        enabled = primaryActionEnabled,
                        modifier = Modifier.semantics {
                            if (manualSyncRunning) {
                                stateDescription = i18n.t("sync.status.inProgress")
                            }
                        },
                    ) {
                        if (manualSyncRunning) {
                            CloudSyncProgressIndicator()
                            Spacer(modifier = Modifier.width(8.dp))
                        }
                        Text(primaryActionText)
                    }
                }
                manualSyncBlockedReason
                    ?.takeIf {
                        snapshot.sync.mode != "local" &&
                            shouldShowCloudSyncBlockedReason(syncStatus, it)
                    }
                    ?.let { reason ->
                        Text(
                            reason,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
            }
        }
    }
}

@Composable
private fun CloudSyncProgressIndicator() {
    CircularProgressIndicator(
        modifier = Modifier
            .size(16.dp)
            .testTag(ManualSyncProgressTestTag),
        color = MaterialTheme.colorScheme.primary,
        strokeWidth = 2.dp,
    )
}

@Composable
internal fun EmptyState(
    hasProvider: Boolean,
    mode: ComposerMode,
    imageTask: ImageTaskMode,
    setupHint: String?,
    imageHint: String?,
    settingsActionLabel: String?,
    onOpenSettings: () -> Unit,
    i18n: NativeI18n,
) {
    val title = when {
        !hasProvider -> i18n.t("title.settings")
        mode == ComposerMode.Image -> i18n.imageTaskTitle(imageTask)
        else -> i18n.t("title.newChat")
    }
    val body = when {
        mode == ComposerMode.Image && imageHint != null -> imageHint
        setupHint != null -> setupHint
        mode == ComposerMode.Image -> i18n.t("placeholder.imagePrompt")
        else -> i18n.t("message.emptyChat")
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            title,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurface,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            body,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (settingsActionLabel != null) {
            OutlinedButton(onClick = onOpenSettings) {
                Text(settingsActionLabel)
            }
        }
    }
}

@Composable
internal fun DiscardComposerDraftDialog(
    confirmLabel: String,
    i18n: NativeI18n,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(i18n.t("message.discardDraftTitle")) },
        text = { Text(i18n.t("message.discardDraftBody")) },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(i18n.t("action.cancel"))
            }
        },
        confirmButton = {
            Button(onClick = onConfirm) {
                Text(
                    confirmLabel,
                    maxLines = 2,
                    textAlign = TextAlign.Center,
                )
            }
        },
    )
}

internal fun imageComposerHint(
    provider: ProviderConfig?,
    providerKeyMissing: Boolean,
    imageModel: String,
    imageTask: ImageTaskMode,
    sourceImage: ImageUpload?,
    maskImage: ImageUpload?,
    i18n: NativeI18n,
): String? = when {
    provider == null -> i18n.t("message.configureModelFirst")
    providerKeyMissing -> i18n.t("error.providerKeyRequired")
    provider.kind == ProviderKind.Anthropic -> i18n.t("message.imageProviderRequired")
    imageModel.isBlank() -> i18n.t("message.imageModelRequired")
    imageTask != ImageTaskMode.Generate && sourceImage == null -> i18n.t("message.sourceImageRequired")
    imageTask == ImageTaskMode.Inpaint && maskImage == null -> i18n.t("message.maskImageRequired")
    else -> null
}

internal fun String.isCompletedSyncStatus(): Boolean =
    this == "Sync complete" ||
        this == "Remote data restored" ||
        this == "Remote encrypted data applied"

private fun cloudSyncSummary(
    snapshot: AppSnapshot,
    status: String,
    i18n: NativeI18n,
): String {
    if (snapshot.sync.mode == "local") {
        return i18n.t("sync.localSummary")
    }

    val mode = when (snapshot.sync.mode) {
        "gist" -> i18n.t("mode.gist")
        "cloudflare" -> i18n.t("mode.cloudflare")
        else -> i18n.t("mode.local")
    }

    return "$mode · $status"
}

private fun cloudSyncStatus(snapshot: AppSnapshot, i18n: NativeI18n): String {
    val lastSyncAt = snapshot.sync.lastSyncAt
    return when {
        !snapshot.sync.lastSyncStatus.isNullOrBlank() ->
            i18n.syncStatusMessage(snapshot.sync.lastSyncStatus)
        lastSyncAt != null -> formatTimestamp(lastSyncAt)
        else -> i18n.t("button.syncNow")
    }
}

private fun formatTimestamp(value: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
        .format(Date(value))
