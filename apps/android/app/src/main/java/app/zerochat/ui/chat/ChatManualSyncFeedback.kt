package app.zerochat.ui.chat

internal fun manualCloudSyncBlockerMessageKey(blocker: ManualCloudSyncBlocker): String = when (blocker) {
    ManualCloudSyncBlocker.Generating -> "message.generating"
    ManualCloudSyncBlocker.LocalOnly -> "sync.requirement.local"
    ManualCloudSyncBlocker.SyncPasswordRequired -> "message.dataPasswordRequired"
    ManualCloudSyncBlocker.GithubTokenRequired -> "error.syncGithubTokenRequired"
    ManualCloudSyncBlocker.CloudflareWorkerRequired -> "message.cloudflareWorkerRequired"
    ManualCloudSyncBlocker.CloudflareAccessKeyRequired -> "message.dataPasswordRequired"
}

internal fun manualCloudSyncStatusNotice(
    status: String?,
    syncStatusMessage: (String) -> String,
): InlineNotice {
    val resolvedStatus = status ?: MANUAL_SYNC_COMPLETE_STATUS
    val kind = if (resolvedStatus.isCompletedSyncStatus()) {
        NoticeKind.Success
    } else {
        NoticeKind.Warning
    }

    return InlineNotice(syncStatusMessage(resolvedStatus), kind)
}

internal fun manualCloudSyncSettingsStatusNotice(
    status: String?,
    isFirstSyncConflict: Boolean,
    syncStatusMessage: (String) -> String,
): InlineNotice? =
    if (isFirstSyncConflict) {
        null
    } else {
        manualCloudSyncStatusNotice(status, syncStatusMessage)
    }

internal fun manualCloudSyncErrorNotice(
    error: Throwable,
    errorMessage: (String) -> String,
): InlineNotice =
    InlineNotice(
        errorMessage(error.message ?: error::class.java.simpleName),
        NoticeKind.Error,
    )

internal fun manualSyncActionEnabled(
    manualSyncRunning: Boolean,
    cloudSyncConfigured: Boolean,
    manualSyncBlockedReason: String?,
): Boolean =
    !manualSyncRunning && (!cloudSyncConfigured || manualSyncBlockedReason == null)

private const val MANUAL_SYNC_COMPLETE_STATUS = "Sync complete"
