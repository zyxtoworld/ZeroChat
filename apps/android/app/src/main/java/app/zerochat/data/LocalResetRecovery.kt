package app.zerochat.data

import java.security.MessageDigest
import kotlinx.serialization.json.Json

internal data class LocalResetIntentMetadata(
    val sourceFingerprint: String?,
    val replacementFingerprint: String,
    val replacementUpdatedAt: Long,
)

internal enum class LocalResetRecoveryAction {
    RestoreCredentials,
    FinishReset,
    Block,
}

internal fun localResetRecoveryAction(
    intent: LocalResetIntentMetadata,
    currentFingerprint: String,
): LocalResetRecoveryAction = when {
    currentFingerprint == intent.replacementFingerprint -> LocalResetRecoveryAction.FinishReset
    intent.sourceFingerprint != null && currentFingerprint == intent.sourceFingerprint ->
        LocalResetRecoveryAction.RestoreCredentials
    else -> LocalResetRecoveryAction.Block
}

internal fun localResetSnapshotFingerprint(snapshot: AppSnapshot): String {
    val encoded = LocalResetFingerprintJson.encodeToString(AppSnapshot.serializer(), snapshot)
    return MessageDigest.getInstance("SHA-256")
        .digest(encoded.toByteArray(Charsets.UTF_8))
        .joinToString(separator = "") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        }
}

private val LocalResetFingerprintJson = Json {
    encodeDefaults = true
    explicitNulls = true
}
