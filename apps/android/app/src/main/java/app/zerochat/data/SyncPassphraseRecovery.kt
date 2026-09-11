package app.zerochat.data

internal data class SyncPassphraseIntentMetadata(
    val sourceFingerprint: String?,
    val replacementFingerprint: String,
    val replacementUpdatedAt: Long,
)

internal enum class SyncPassphraseRecoveryAction {
    RestorePrevious,
    KeepReplacement,
    Block,
}

internal fun syncPassphraseRecoveryAction(
    intent: SyncPassphraseIntentMetadata,
    currentFingerprint: String,
): SyncPassphraseRecoveryAction = when {
    currentFingerprint == intent.replacementFingerprint ->
        SyncPassphraseRecoveryAction.KeepReplacement
    intent.sourceFingerprint != null && currentFingerprint == intent.sourceFingerprint ->
        SyncPassphraseRecoveryAction.RestorePrevious
    else -> SyncPassphraseRecoveryAction.Block
}
