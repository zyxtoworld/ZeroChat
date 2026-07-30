package app.zerochat.data

internal data class ProviderKeyImportIntentMetadata(
    val sourceFingerprint: String?,
    val replacementFingerprint: String,
    val replacementUpdatedAt: Long,
)

internal enum class ProviderKeyImportRecoveryAction {
    RestorePreviousKeys,
    KeepReplacementKeys,
    Block,
}

internal fun providerKeyImportRecoveryAction(
    intent: ProviderKeyImportIntentMetadata,
    currentFingerprint: String,
): ProviderKeyImportRecoveryAction = when {
    currentFingerprint == intent.replacementFingerprint ->
        ProviderKeyImportRecoveryAction.KeepReplacementKeys
    intent.sourceFingerprint != null && currentFingerprint == intent.sourceFingerprint ->
        ProviderKeyImportRecoveryAction.RestorePreviousKeys
    else -> ProviderKeyImportRecoveryAction.Block
}
