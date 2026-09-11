@file:Suppress("DEPRECATION")

package app.zerochat.security

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.zerochat.commitOrThrow
import app.zerochat.data.LocalResetIntentMetadata
import app.zerochat.data.LocalResetRecoveryAction
import app.zerochat.data.ProviderKeyImportIntentMetadata
import app.zerochat.data.ProviderKeyImportRecoveryAction
import app.zerochat.data.SyncPassphraseIntentMetadata
import app.zerochat.data.SyncPassphraseRecoveryAction
import app.zerochat.data.localResetRecoveryAction
import app.zerochat.data.providerKeyImportRecoveryAction
import app.zerochat.data.syncPassphraseRecoveryAction
import java.security.MessageDigest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private const val ACCESS_KEY_PREFIX = "zerochat-access:v1:"
private const val PENDING_PROVIDER_DELETIONS_KEY = "pending-provider-deletions"
private const val PENDING_LOCAL_RESET_KEY = "pending-local-reset"
private const val PENDING_PROVIDER_KEY_IMPORT_KEY = "pending-provider-key-import"
private const val PENDING_SYNC_PASSPHRASE_KEY = "pending-sync-passphrase"

@Serializable
private data class PendingLocalResetRecord(
    val sourceFingerprint: String? = null,
    val replacementFingerprint: String,
    val replacementUpdatedAt: Long,
    val stringValues: Map<String, String>,
    val stringSetValues: Map<String, Set<String>>,
) {
    fun metadata(): LocalResetIntentMetadata = LocalResetIntentMetadata(
        sourceFingerprint = sourceFingerprint,
        replacementFingerprint = replacementFingerprint,
        replacementUpdatedAt = replacementUpdatedAt,
    )
}

@Serializable
private data class PendingProviderKeyImportRecord(
    val sourceFingerprint: String? = null,
    val replacementFingerprint: String,
    val replacementUpdatedAt: Long,
    val previousKeys: Map<String, String>,
    val replacementKeys: Map<String, String>,
) {
    fun metadata(): ProviderKeyImportIntentMetadata = ProviderKeyImportIntentMetadata(
        sourceFingerprint = sourceFingerprint,
        replacementFingerprint = replacementFingerprint,
        replacementUpdatedAt = replacementUpdatedAt,
    )
}

@Serializable
private data class PendingSyncPassphraseRecord(
    val sourceFingerprint: String? = null,
    val replacementFingerprint: String,
    val replacementUpdatedAt: Long,
    val previousValue: String?,
    val replacementValue: String?,
) {
    fun metadata(): SyncPassphraseIntentMetadata = SyncPassphraseIntentMetadata(
        sourceFingerprint = sourceFingerprint,
        replacementFingerprint = replacementFingerprint,
        replacementUpdatedAt = replacementUpdatedAt,
    )
}

internal data class ProviderDeletionRecoveryPlan(
    val credentialIdsToRemove: Set<String>,
)

internal fun providerDeletionRecoveryPlan(
    pendingProviderIds: Set<String>,
    activeProviderIds: Set<String>,
): ProviderDeletionRecoveryPlan = ProviderDeletionRecoveryPlan(
    credentialIdsToRemove = pendingProviderIds - activeProviderIds,
)

// Keep the deprecated AndroidX Security API isolated here until the native
// secret store migrates to a non-deprecated encrypted storage backend.
class SecretStore(context: Context) {
    private val secretStoreLock = Any()
    private val json = Json { ignoreUnknownKeys = false }
    private var localResetBackupCache: PendingLocalResetRecord? = null
    private var providerKeyImportBackupCache: PendingProviderKeyImportRecord? = null
    private var syncPassphraseBackupCache: PendingSyncPassphraseRecord? = null
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val preferences = EncryptedSharedPreferences.create(
        context,
        "zerochat-secrets",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun providerKey(providerId: String): String =
        synchronized(secretStoreLock) {
            preferences.getString("provider:$providerId", null).orEmpty()
        }

    fun setProviderKey(providerId: String, value: String) {
        replaceProviderKeys(mapOf(providerId to value))
    }

    fun replaceProviderKeys(replacements: Map<String, String>) {
        if (replacements.isEmpty()) {
            return
        }

        synchronized(secretStoreLock) {
            requireNoPendingSecretTransaction()
            commitProviderKeys(replacements)
        }
    }

    fun stageProviderDeletion(providerId: String) {
        synchronized(secretStoreLock) {
            requireNoPendingSecretTransaction()
            val pending = pendingProviderDeletionIds().toMutableSet().apply { add(providerId) }
            preferences.commitOrThrow("Could not stage provider credential deletion.") {
                putStringSet(PENDING_PROVIDER_DELETIONS_KEY, pending)
            }
        }
    }

    fun finishProviderDeletion(providerId: String) {
        synchronized(secretStoreLock) {
            requireNoPendingSecretTransaction()
            val pending = pendingProviderDeletionIds().toMutableSet().apply { remove(providerId) }
            preferences.commitOrThrow("Could not finish provider credential deletion.") {
                remove("provider:$providerId")
                writePendingProviderDeletionIds(pending)
            }
        }
    }

    fun cancelProviderDeletion(providerId: String) {
        synchronized(secretStoreLock) {
            requireNoPendingSecretTransaction()
            val pending = pendingProviderDeletionIds().toMutableSet().apply { remove(providerId) }
            preferences.commitOrThrow("Could not cancel provider credential deletion.") {
                writePendingProviderDeletionIds(pending)
            }
        }
    }

    fun reconcilePendingProviderDeletions(activeProviderIds: Set<String>) {
        synchronized(secretStoreLock) {
            requireNoPendingSecretTransaction()
            val pending = pendingProviderDeletionIds()
            if (pending.isEmpty()) {
                return
            }
            val plan = providerDeletionRecoveryPlan(pending, activeProviderIds)
            preferences.commitOrThrow("Could not recover provider credential deletion.") {
                plan.credentialIdsToRemove.forEach { providerId ->
                    remove("provider:$providerId")
                }
                remove(PENDING_PROVIDER_DELETIONS_KEY)
            }
        }
    }

    private fun commitProviderKeys(replacements: Map<String, String>) {
        preferences.commitOrThrow("Could not persist provider credentials.") {
            writeProviderKeys(replacements)
        }
    }

    private fun android.content.SharedPreferences.Editor.writeProviderKeys(
        replacements: Map<String, String>,
    ) {
        replacements.forEach { (providerId, value) ->
            if (value.isBlank()) {
                remove("provider:$providerId")
            } else {
                putString("provider:$providerId", value.trim())
            }
        }
    }

    private fun providerKeyValue(providerId: String): String =
        preferences.getString("provider:$providerId", null).orEmpty()

    private fun pendingProviderDeletionIds(): Set<String> =
        preferences.getStringSet(PENDING_PROVIDER_DELETIONS_KEY, emptySet())?.toSet().orEmpty()

    private fun android.content.SharedPreferences.Editor.writePendingProviderDeletionIds(
        pending: Set<String>,
    ) {
        if (pending.isEmpty()) {
            remove(PENDING_PROVIDER_DELETIONS_KEY)
        } else {
            putStringSet(PENDING_PROVIDER_DELETIONS_KEY, pending)
        }
    }

    fun githubToken(): String = synchronized(secretStoreLock) {
        preferences.getString("github-token", null).orEmpty()
    }

    fun setGithubToken(value: String) {
        synchronized(secretStoreLock) {
            requireNoPendingSecretTransaction()
            preferences.commitOrThrow("Could not persist the GitHub credential.") {
                if (value.isBlank()) {
                    remove("github-token")
                } else {
                    putString("github-token", value.trim())
                }
            }
        }
    }

    fun syncPassphrase(): String = synchronized(secretStoreLock) {
        preferences.getString("sync-passphrase", null).orEmpty()
    }

    fun cloudflareAccessKey(): String {
        val passphrase = syncPassphrase()
        if (passphrase.isEmpty()) {
            return ""
        }

        val digest = MessageDigest
            .getInstance("SHA-256")
            .digest("$ACCESS_KEY_PREFIX$passphrase".toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(
            digest,
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
        )
    }

    fun setSyncPassphrase(value: String) {
        synchronized(secretStoreLock) {
            requireNoPendingSecretTransaction()
            preferences.commitOrThrow("Could not persist the data encryption password.") {
                if (value.isBlank()) {
                    remove("sync-passphrase")
                } else {
                    putString("sync-passphrase", value)
                }
            }
        }
    }

    fun clearAll() {
        synchronized(secretStoreLock) {
            requireNoPendingSecretTransaction()
            preferences.commitOrThrow("Could not clear local credentials.") { clear() }
        }
    }

    internal fun pendingLocalResetIntent(): LocalResetIntentMetadata? = synchronized(secretStoreLock) {
        (pendingLocalResetRecord() ?: localResetBackupCache)?.metadata()
    }

    internal fun pendingProviderKeyImportIntent(): ProviderKeyImportIntentMetadata? =
        synchronized(secretStoreLock) {
            (pendingProviderKeyImportRecord() ?: providerKeyImportBackupCache)?.metadata()
        }

    internal fun pendingSyncPassphraseIntent(): SyncPassphraseIntentMetadata? =
        synchronized(secretStoreLock) {
            (pendingSyncPassphraseRecord() ?: syncPassphraseBackupCache)?.metadata()
        }

    internal fun stageProviderKeyImport(
        intent: ProviderKeyImportIntentMetadata,
        replacements: Map<String, String>,
    ) {
        synchronized(secretStoreLock) {
            requireNoPendingLocalReset()
            requireNoPendingSyncPassphrase()
            check(pendingProviderDeletionIds().isEmpty()) {
                "Provider credential deletion is pending recovery."
            }
            val normalized = replacements.mapValues { (_, value) -> value.trim() }
            pendingProviderKeyImportRecord()?.let { pending ->
                check(pending.metadata() == intent && pending.replacementKeys == normalized) {
                    "A different provider credential snapshot replacement is pending recovery."
                }
                providerKeyImportBackupCache = pending
                return
            }
            check(providerKeyImportBackupCache == null) {
                "Provider credential snapshot replacement is pending recovery."
            }

            val pending = PendingProviderKeyImportRecord(
                sourceFingerprint = intent.sourceFingerprint,
                replacementFingerprint = intent.replacementFingerprint,
                replacementUpdatedAt = intent.replacementUpdatedAt,
                previousKeys = normalized.keys.associateWith(::providerKeyValue),
                replacementKeys = normalized,
            )
            providerKeyImportBackupCache = pending
            try {
                preferences.commitOrThrow("Could not stage provider credential snapshot replacement.") {
                    writeProviderKeys(normalized)
                    putString(PENDING_PROVIDER_KEY_IMPORT_KEY, json.encodeToString(pending))
                }
            } catch (error: Throwable) {
                val restoreError = runCatching {
                    restorePendingProviderKeyImport(pending)
                }.exceptionOrNull()
                restoreError?.let(error::addSuppressed)
                if (restoreError == null) {
                    providerKeyImportBackupCache = null
                }
                throw error
            }
        }
    }

    internal fun finishProviderKeyImport(intent: ProviderKeyImportIntentMetadata) {
        synchronized(secretStoreLock) {
            val pending = requirePendingProviderKeyImport(intent)
            providerKeyImportBackupCache = pending
            preferences.commitOrThrow("Could not finish provider credential snapshot replacement.") {
                writeProviderKeys(pending.replacementKeys)
                remove(PENDING_PROVIDER_KEY_IMPORT_KEY)
            }
            providerKeyImportBackupCache = null
        }
    }

    internal fun restoreProviderKeyImport(intent: ProviderKeyImportIntentMetadata) {
        synchronized(secretStoreLock) {
            val pending = requirePendingProviderKeyImport(intent)
            restorePendingProviderKeyImport(pending)
            providerKeyImportBackupCache = null
        }
    }

    internal fun reconcilePendingProviderKeyImport(
        currentFingerprint: String,
    ): ProviderKeyImportRecoveryAction? = synchronized(secretStoreLock) {
        val pending = pendingProviderKeyImportRecord() ?: return@synchronized null
        providerKeyImportBackupCache = pending
        val action = providerKeyImportRecoveryAction(pending.metadata(), currentFingerprint)
        when (action) {
            ProviderKeyImportRecoveryAction.RestorePreviousKeys ->
                restorePendingProviderKeyImport(pending)
            ProviderKeyImportRecoveryAction.KeepReplacementKeys ->
                preferences.commitOrThrow("Could not recover provider credential snapshot replacement.") {
                    writeProviderKeys(pending.replacementKeys)
                    remove(PENDING_PROVIDER_KEY_IMPORT_KEY)
                }
            ProviderKeyImportRecoveryAction.Block -> error(
                "Pending provider credential snapshot replacement does not match the durable snapshot.",
            )
        }
        providerKeyImportBackupCache = null
        action
    }

    internal fun restorePendingProviderKeyImportAfterSnapshotLoadFailure(): Boolean =
        synchronized(secretStoreLock) {
            val pending = pendingProviderKeyImportRecord() ?: return@synchronized false
            providerKeyImportBackupCache = pending
            restorePendingProviderKeyImport(pending)
            providerKeyImportBackupCache = null
            true
        }

    internal fun restorePendingLocalResetAfterSnapshotLoadFailure(): Boolean =
        synchronized(secretStoreLock) {
            val pending = pendingLocalResetRecord() ?: return@synchronized false
            localResetBackupCache = pending
            restorePendingLocalReset(pending)
            localResetBackupCache = null
            true
        }

    internal fun stageSyncPassphrase(
        intent: SyncPassphraseIntentMetadata,
        value: String,
    ) {
        synchronized(secretStoreLock) {
            requireNoPendingLocalReset()
            requireNoPendingProviderKeyImport()
            check(pendingProviderDeletionIds().isEmpty()) {
                "Provider credential deletion is pending recovery."
            }
            val replacementValue = value.takeUnless(String::isBlank)
            pendingSyncPassphraseRecord()?.let { pending ->
                check(pending.metadata() == intent && pending.replacementValue == replacementValue) {
                    "A different sync passphrase snapshot replacement is pending recovery."
                }
                syncPassphraseBackupCache = pending
                return
            }
            check(syncPassphraseBackupCache == null) {
                "Sync passphrase snapshot replacement is pending recovery."
            }

            val pending = PendingSyncPassphraseRecord(
                sourceFingerprint = intent.sourceFingerprint,
                replacementFingerprint = intent.replacementFingerprint,
                replacementUpdatedAt = intent.replacementUpdatedAt,
                previousValue = preferences.getString("sync-passphrase", null),
                replacementValue = replacementValue,
            )
            syncPassphraseBackupCache = pending
            try {
                preferences.commitOrThrow("Could not stage sync passphrase snapshot replacement.") {
                    writeSyncPassphrase(replacementValue)
                    putString(PENDING_SYNC_PASSPHRASE_KEY, json.encodeToString(pending))
                }
            } catch (error: Throwable) {
                val restoreError = runCatching {
                    restorePendingSyncPassphrase(pending)
                }.exceptionOrNull()
                restoreError?.let(error::addSuppressed)
                if (restoreError == null) {
                    syncPassphraseBackupCache = null
                }
                throw error
            }
        }
    }

    internal fun finishSyncPassphrase(intent: SyncPassphraseIntentMetadata) {
        synchronized(secretStoreLock) {
            val pending = requirePendingSyncPassphrase(intent)
            syncPassphraseBackupCache = pending
            preferences.commitOrThrow("Could not finish sync passphrase snapshot replacement.") {
                writeSyncPassphrase(pending.replacementValue)
                remove(PENDING_SYNC_PASSPHRASE_KEY)
            }
            syncPassphraseBackupCache = null
        }
    }

    internal fun restoreSyncPassphrase(intent: SyncPassphraseIntentMetadata) {
        synchronized(secretStoreLock) {
            val pending = requirePendingSyncPassphrase(intent)
            restorePendingSyncPassphrase(pending)
            syncPassphraseBackupCache = null
        }
    }

    internal fun reconcilePendingSyncPassphrase(
        currentFingerprint: String,
    ): SyncPassphraseRecoveryAction? = synchronized(secretStoreLock) {
        val pending = pendingSyncPassphraseRecord() ?: return@synchronized null
        syncPassphraseBackupCache = pending
        val action = syncPassphraseRecoveryAction(pending.metadata(), currentFingerprint)
        when (action) {
            SyncPassphraseRecoveryAction.RestorePrevious ->
                restorePendingSyncPassphrase(pending)
            SyncPassphraseRecoveryAction.KeepReplacement ->
                preferences.commitOrThrow("Could not recover sync passphrase snapshot replacement.") {
                    writeSyncPassphrase(pending.replacementValue)
                    remove(PENDING_SYNC_PASSPHRASE_KEY)
                }
            SyncPassphraseRecoveryAction.Block -> error(
                "Pending sync passphrase snapshot replacement does not match the durable snapshot.",
            )
        }
        syncPassphraseBackupCache = null
        action
    }

    internal fun restorePendingSyncPassphraseAfterSnapshotLoadFailure(): Boolean =
        synchronized(secretStoreLock) {
            val pending = pendingSyncPassphraseRecord() ?: return@synchronized false
            syncPassphraseBackupCache = pending
            restorePendingSyncPassphrase(pending)
            syncPassphraseBackupCache = null
            true
        }

    internal fun stageLocalReset(intent: LocalResetIntentMetadata) {
        synchronized(secretStoreLock) {
            requireNoPendingProviderKeyImport()
            requireNoPendingSyncPassphrase()
            pendingLocalResetRecord()?.let { pending ->
                check(pending.metadata() == intent) {
                    "A different local credential reset is already pending recovery."
                }
                localResetBackupCache = pending
                return
            }

            val strings = linkedMapOf<String, String>()
            val stringSets = linkedMapOf<String, Set<String>>()
            preferences.all.forEach { (key, value) ->
                when (value) {
                    is String -> strings[key] = value
                    is Set<*> -> stringSets[key] = value.mapTo(linkedSetOf()) { entry ->
                        entry as? String
                            ?: error("Unsupported local credential set value for $key.")
                    }
                    else -> error("Unsupported local credential value for $key.")
                }
            }
            val pending = PendingLocalResetRecord(
                sourceFingerprint = intent.sourceFingerprint,
                replacementFingerprint = intent.replacementFingerprint,
                replacementUpdatedAt = intent.replacementUpdatedAt,
                stringValues = strings,
                stringSetValues = stringSets,
            )
            localResetBackupCache = pending
            try {
                preferences.commitOrThrow("Could not stage local credential reset.") {
                    clear()
                    putString(PENDING_LOCAL_RESET_KEY, json.encodeToString(pending))
                }
            } catch (error: Throwable) {
                val restoreError = runCatching { restorePendingLocalReset(pending) }.exceptionOrNull()
                restoreError?.let(error::addSuppressed)
                if (restoreError == null) {
                    localResetBackupCache = null
                }
                throw error
            }
        }
    }

    internal fun finishLocalReset(intent: LocalResetIntentMetadata) {
        synchronized(secretStoreLock) {
            val pending = requirePendingLocalReset(intent)
            localResetBackupCache = pending
            preferences.commitOrThrow("Could not finish local credential reset.") { clear() }
            localResetBackupCache = null
        }
    }

    internal fun restoreLocalReset(intent: LocalResetIntentMetadata) {
        synchronized(secretStoreLock) {
            val pending = requirePendingLocalReset(intent)
            restorePendingLocalReset(pending)
            localResetBackupCache = null
        }
    }

    internal fun reconcilePendingLocalReset(currentFingerprint: String): LocalResetRecoveryAction? =
        synchronized(secretStoreLock) {
            val pending = pendingLocalResetRecord() ?: return@synchronized null
            localResetBackupCache = pending
            val action = localResetRecoveryAction(pending.metadata(), currentFingerprint)
            when (action) {
                LocalResetRecoveryAction.RestoreCredentials -> restorePendingLocalReset(pending)
                LocalResetRecoveryAction.FinishReset ->
                    preferences.commitOrThrow("Could not recover local credential reset.") { clear() }
                LocalResetRecoveryAction.Block -> error(
                    "Pending local credential reset does not match the durable snapshot.",
                )
            }
            localResetBackupCache = null
            action
        }

    private fun restorePendingLocalReset(pending: PendingLocalResetRecord) {
        preferences.commitOrThrow("Could not restore local credentials after reset failure.") {
            clear()
            pending.stringValues.forEach { (key, value) -> putString(key, value) }
            pending.stringSetValues.forEach { (key, value) -> putStringSet(key, value) }
        }
    }

    private fun restorePendingProviderKeyImport(pending: PendingProviderKeyImportRecord) {
        preferences.commitOrThrow("Could not restore provider credentials after snapshot replacement failure.") {
            writeProviderKeys(pending.previousKeys)
            remove(PENDING_PROVIDER_KEY_IMPORT_KEY)
        }
    }

    private fun android.content.SharedPreferences.Editor.writeSyncPassphrase(
        value: String?,
    ) {
        if (value.isNullOrBlank()) {
            remove("sync-passphrase")
        } else {
            putString("sync-passphrase", value)
        }
    }

    private fun restorePendingSyncPassphrase(pending: PendingSyncPassphraseRecord) {
        preferences.commitOrThrow("Could not restore sync passphrase after snapshot replacement failure.") {
            writeSyncPassphrase(pending.previousValue)
            remove(PENDING_SYNC_PASSPHRASE_KEY)
        }
    }

    private fun requirePendingProviderKeyImport(
        expected: ProviderKeyImportIntentMetadata,
    ): PendingProviderKeyImportRecord = checkNotNull(
        pendingProviderKeyImportRecord() ?: providerKeyImportBackupCache,
    ) {
        "Provider credential snapshot replacement intent is missing."
    }.also { pending ->
        check(pending.metadata() == expected) {
            "Provider credential snapshot replacement intent changed during commit."
        }
    }

    private fun pendingProviderKeyImportRecord(): PendingProviderKeyImportRecord? =
        preferences.getString(PENDING_PROVIDER_KEY_IMPORT_KEY, null)?.let {
            json.decodeFromString<PendingProviderKeyImportRecord>(it)
        }

    private fun requirePendingSyncPassphrase(
        expected: SyncPassphraseIntentMetadata,
    ): PendingSyncPassphraseRecord = checkNotNull(
        pendingSyncPassphraseRecord() ?: syncPassphraseBackupCache,
    ) {
        "Sync passphrase snapshot replacement intent is missing."
    }.also { pending ->
        check(pending.metadata() == expected) {
            "Sync passphrase snapshot replacement intent changed during commit."
        }
    }

    private fun pendingSyncPassphraseRecord(): PendingSyncPassphraseRecord? =
        preferences.getString(PENDING_SYNC_PASSPHRASE_KEY, null)?.let {
            json.decodeFromString<PendingSyncPassphraseRecord>(it)
        }

    private fun requirePendingLocalReset(
        expected: LocalResetIntentMetadata,
    ): PendingLocalResetRecord = checkNotNull(
        pendingLocalResetRecord() ?: localResetBackupCache,
    ) {
        "Local credential reset intent is missing."
    }.also { pending ->
        check(pending.metadata() == expected) {
            "Local credential reset intent changed during commit."
        }
    }

    private fun pendingLocalResetRecord(): PendingLocalResetRecord? =
        preferences.getString(PENDING_LOCAL_RESET_KEY, null)?.let {
            json.decodeFromString<PendingLocalResetRecord>(it)
        }

    private fun requireNoPendingLocalReset() {
        check(
            !preferences.contains(PENDING_LOCAL_RESET_KEY) && localResetBackupCache == null,
        ) {
            "Local credential reset is pending recovery."
        }
    }

    private fun requireNoPendingProviderKeyImport() {
        check(
            !preferences.contains(PENDING_PROVIDER_KEY_IMPORT_KEY) &&
                providerKeyImportBackupCache == null,
        ) {
            "Provider credential import is pending recovery."
        }
    }

    private fun requireNoPendingSyncPassphrase() {
        check(
            !preferences.contains(PENDING_SYNC_PASSPHRASE_KEY) &&
                syncPassphraseBackupCache == null,
        ) {
            "Sync passphrase snapshot replacement is pending recovery."
        }
    }

    private fun requireNoPendingSecretTransaction() {
        requireNoPendingLocalReset()
        requireNoPendingProviderKeyImport()
        requireNoPendingSyncPassphrase()
    }
}

internal fun restorePendingSecretTransactionsAfterSnapshotLoadFailure(
    secretStore: SecretStore,
) {
    val failures = mutableListOf<Throwable>()
    fun attemptRecovery(recover: () -> Unit) {
        try {
            recover()
        } catch (error: Throwable) {
            failures += error
        }
    }
    attemptRecovery { secretStore.restorePendingLocalResetAfterSnapshotLoadFailure() }
    attemptRecovery { secretStore.restorePendingProviderKeyImportAfterSnapshotLoadFailure() }
    attemptRecovery { secretStore.restorePendingSyncPassphraseAfterSnapshotLoadFailure() }
    failures.firstOrNull()?.let { first ->
        failures.drop(1).forEach(first::addSuppressed)
        throw first
    }
}
