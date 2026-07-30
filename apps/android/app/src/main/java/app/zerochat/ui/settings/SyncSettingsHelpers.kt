package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SyncConfig

private const val FIRST_SYNC_CONFLICT_STATUS =
    "Local and cloud both have data. Choose local, cloud, or merge before syncing."
private const val DEFAULT_GIST_FILE = "zerochat-sync.json"

data class SyncSettingsStatusPresentation(
    val statusMessage: String?,
    val isFirstSyncConflict: Boolean,
)

fun syncSettingsSelectMode(
    snapshot: AppSnapshot,
    mode: String,
): AppSnapshot = snapshot.copy(
    sync = snapshot.sync.copy(
        mode = mode,
        autoSync = mode != "local",
        lastSyncAt = null,
        lastSyncStatus = null,
    ),
)

fun syncSettingsSetAutoSync(
    snapshot: AppSnapshot,
    autoSync: Boolean,
): AppSnapshot = snapshot.copy(
    sync = snapshot.sync.copy(
        autoSync = snapshot.sync.mode != "local" && autoSync,
        lastSyncAt = null,
        lastSyncStatus = null,
    ),
)

fun syncSettingsUpdateGistId(
    snapshot: AppSnapshot,
    gistId: String,
): AppSnapshot {
    val normalized = gistId.trim()
    return snapshot.copy(
        sync = snapshot.sync.copy(
            gistId = normalized.ifBlank { null },
            lastSyncAt = null,
            lastSyncStatus = null,
        ),
    )
}

fun syncSettingsUpdateGistFile(
    snapshot: AppSnapshot,
    gistFile: String,
): AppSnapshot {
    val normalized = gistFile.trim()
    return snapshot.copy(
        sync = snapshot.sync.copy(
            gistFile = normalized.ifBlank { DEFAULT_GIST_FILE },
            lastSyncAt = null,
            lastSyncStatus = null,
        ),
    )
}

fun syncSettingsUpdateCloudflareEndpoint(
    snapshot: AppSnapshot,
    workerEndpoint: String,
): AppSnapshot {
    val normalized = workerEndpoint.trim()
    return snapshot.copy(
        sync = snapshot.sync.copy(
            workerEndpoint = normalized.ifBlank { null },
            lastSyncAt = null,
            lastSyncStatus = null,
        ),
    )
}

fun syncSettingsManualBlockerKey(
    snapshot: AppSnapshot,
    hasSyncPassphrase: Boolean,
    hasGithubToken: Boolean,
    hasCloudflareAccessKey: Boolean,
): String? = when {
    snapshot.sync.mode == "local" -> "sync.requirement.local"
    !hasSyncPassphrase -> "message.dataPasswordRequired"
    snapshot.sync.mode == "gist" && !hasGithubToken -> "error.syncGithubTokenRequired"
    snapshot.sync.mode == "cloudflare" && snapshot.sync.workerEndpoint.isNullOrBlank() ->
        "message.cloudflareWorkerRequired"
    snapshot.sync.mode == "cloudflare" && !hasCloudflareAccessKey -> "message.dataPasswordRequired"
    else -> null
}

fun syncSettingsIsFirstSyncConflict(
    sync: SyncConfig,
    syncStatusMessage: (String?) -> String,
    localizedConflictMessage: String,
): Boolean = syncSettingsStatusPresentation(
    sync = sync,
    syncStatusMessage = syncStatusMessage,
    localizedConflictMessage = localizedConflictMessage,
).isFirstSyncConflict

fun syncSettingsStatusPresentation(
    sync: SyncConfig,
    syncStatusMessage: (String?) -> String,
    localizedConflictMessage: String,
): SyncSettingsStatusPresentation {
    val status = sync.lastSyncStatus?.trim().orEmpty()
    val localizedStatus = status.takeIf { it.isNotBlank() }?.let(syncStatusMessage)
    val isFirstSyncConflict = status == FIRST_SYNC_CONFLICT_STATUS ||
        localizedStatus == localizedConflictMessage
    return SyncSettingsStatusPresentation(
        statusMessage = localizedStatus?.takeUnless { isFirstSyncConflict },
        isFirstSyncConflict = isFirstSyncConflict,
    )
}
