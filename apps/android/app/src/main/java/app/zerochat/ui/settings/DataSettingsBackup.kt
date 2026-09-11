@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package app.zerochat.ui.settings

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import app.zerochat.data.AppSnapshot
import app.zerochat.data.EncryptedSnapshotEnvelope
import app.zerochat.data.ProviderSecrets
import app.zerochat.data.SyncVault
import app.zerochat.mapCatchingPreservingCancellation
import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.security.SecretStore
import app.zerochat.sync.CryptoEngine
import app.zerochat.sync.InvalidSyncVaultFormatException
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.MAX_ENCRYPTED_BACKUP_FILE_BYTES
import app.zerochat.ui.assertLocalByteSize
import app.zerochat.ui.localFileTooLargeMessage
import app.zerochat.ui.readBoundedLocalUriText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.text.DateFormat
import java.util.Date
import java.util.Locale

class DataSettingsBackupController constructor(
    val exportEncryptedBackup: (String) -> Unit,
    val importEncryptedBackup: (String) -> Unit,
)

internal enum class BackupOperation {
    Export,
    Import,
}

internal fun backupFailureNotice(
    i18n: NativeI18n,
    operation: BackupOperation,
): String = i18n.t(
    when (operation) {
        BackupOperation.Export -> "notice.backupExportFailedPrefix"
        BackupOperation.Import -> "notice.backupImportFailedPrefix"
    },
)

internal class BackupPassphraseHandoff {
    private var exportPassphrase: String? = null
    private var importPassphrase: String? = null

    @Synchronized
    fun stageExport(value: String): Boolean {
        if (exportPassphrase != null) {
            return false
        }
        exportPassphrase = value
        return true
    }

    @Synchronized
    fun consumeExport(): String = exportPassphrase.orEmpty().also {
        exportPassphrase = null
    }

    @Synchronized
    fun stageImport(value: String): Boolean {
        if (importPassphrase != null) {
            return false
        }
        importPassphrase = value
        return true
    }

    @Synchronized
    fun consumeImport(): String = importPassphrase.orEmpty().also {
        importPassphrase = null
    }
}

private val backupPassphraseHandoff = BackupPassphraseHandoff()

@Composable
internal fun rememberDataSettingsBackupController(
    snapshot: AppSnapshot,
    backupTasks: BackupTaskOwner,
    secretStore: SecretStore,
    i18n: NativeI18n,
): DataSettingsBackupController {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val backupJson = remember {
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            prettyPrint = true
            encodeDefaults = true
        }
    }
    val backupCrypto = remember { CryptoEngine() }
    val exportBackupLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        val exportPassphrase = backupPassphraseHandoff.consumeExport()
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }

        if (exportPassphrase.isBlank()) {
            backupTasks.publishNotice(
                i18n.t("notice.backupExportNeedsPassphrase"),
                SettingsNoticeKind.Warning,
            )
            return@rememberLauncherForActivityResult
        }

        backupTasks.launch {
            val result = runCatchingPreservingCancellation {
                withContext(Dispatchers.Default) {
                    val envelope = backupCrypto.encryptVault(
                        SyncVault(
                            data = snapshot,
                            secrets = ProviderSecrets(providerKeys = providerKeysForBackup(snapshot, secretStore)),
                        ),
                        exportPassphrase,
                    )
                    backupJson.encodeToString(EncryptedSnapshotEnvelope.serializer(), envelope)
                        .also { text ->
                            assertLocalByteSize(
                                text.toByteArray(Charsets.UTF_8).size,
                                MAX_ENCRYPTED_BACKUP_FILE_BYTES,
                                localFileTooLargeMessage(
                                    i18n,
                                    MAX_ENCRYPTED_BACKUP_FILE_BYTES,
                                ),
                            )
                        }
                }
            }.mapCatchingPreservingCancellation { text ->
                withContext(Dispatchers.IO) {
                    writeUriText(appContext, uri, text)
                }
            }

            result.fold(
                onSuccess = {
                    backupTasks.publishNotice(
                        i18n.t("notice.backupExportStarted"),
                        SettingsNoticeKind.Success,
                    )
                },
                onFailure = {
                    backupTasks.publishNotice(
                        backupFailureNotice(i18n, BackupOperation.Export),
                        SettingsNoticeKind.Error,
                    )
                },
            )
        }
    }

    val importBackupLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        val importPassphrase = backupPassphraseHandoff.consumeImport()
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }

        if (importPassphrase.isBlank()) {
            backupTasks.publishNotice(
                i18n.t("notice.backupImportNeedsPassphrase"),
                SettingsNoticeKind.Warning,
            )
            return@rememberLauncherForActivityResult
        }

        backupTasks.launch {
            val result = runCatchingPreservingCancellation {
                val text = withContext(Dispatchers.IO) {
                    readBoundedLocalUriText(
                        appContext,
                        uri,
                        MAX_ENCRYPTED_BACKUP_FILE_BYTES,
                        localFileTooLargeMessage(i18n, MAX_ENCRYPTED_BACKUP_FILE_BYTES),
                    )
                }
                val envelope = backupJson.decodeFromString(
                    EncryptedSnapshotEnvelope.serializer(),
                    text,
                )
                val vault = withContext(Dispatchers.Default) {
                    backupCrypto.decryptVault(envelope, importPassphrase)
                }
                backupTasks.requestImport(vault.data, vault.secrets.providerKeys).getOrThrow()
            }

            result.fold(
                onSuccess = {
                    backupTasks.publishNotice(
                        i18n.t("notice.backupImported"),
                        SettingsNoticeKind.Success,
                    )
                },
                onFailure = { error ->
                    val message = if (error is InvalidSyncVaultFormatException) {
                        i18n.t("notice.backupImportFormatInvalid")
                    } else {
                        backupFailureNotice(i18n, BackupOperation.Import)
                    }
                    backupTasks.publishNotice(message, SettingsNoticeKind.Error)
                },
            )
        }
    }

    return DataSettingsBackupController(
        exportEncryptedBackup = { passphrase ->
            if (passphrase.isBlank()) {
                backupTasks.publishNotice(
                    i18n.t("notice.backupExportNeedsPassphrase"),
                    SettingsNoticeKind.Warning,
                )
            } else {
                if (!backupPassphraseHandoff.stageExport(passphrase)) {
                    backupTasks.publishNotice(
                        backupFailureNotice(i18n, BackupOperation.Export),
                        SettingsNoticeKind.Error,
                    )
                } else {
                    try {
                        exportBackupLauncher.launch(backupFileName())
                    } catch (error: Throwable) {
                        backupPassphraseHandoff.consumeExport()
                        backupTasks.publishNotice(
                            backupFailureNotice(i18n, BackupOperation.Export),
                            SettingsNoticeKind.Error,
                        )
                    }
                }
            }
        },
        importEncryptedBackup = { passphrase ->
            if (passphrase.isBlank()) {
                backupTasks.publishNotice(
                    i18n.t("notice.backupImportNeedsPassphrase"),
                    SettingsNoticeKind.Warning,
                )
            } else {
                if (!backupPassphraseHandoff.stageImport(passphrase)) {
                    backupTasks.publishNotice(
                        backupFailureNotice(i18n, BackupOperation.Import),
                        SettingsNoticeKind.Error,
                    )
                } else {
                    try {
                        importBackupLauncher.launch(arrayOf("application/json", "text/json", "*/*"))
                    } catch (error: Throwable) {
                        backupPassphraseHandoff.consumeImport()
                        backupTasks.publishNotice(
                            backupFailureNotice(i18n, BackupOperation.Import),
                            SettingsNoticeKind.Error,
                        )
                    }
                }
            }
        },
    )
}

private fun providerKeysForBackup(
    snapshot: AppSnapshot,
    secretStore: SecretStore,
): Map<String, String> =
    dataSettingsProviderKeysForBackup(snapshot, secretStore::providerKey)

private fun backupFileName(): String =
    "zerochat-encrypted-${DateFormat.getDateInstance(DateFormat.SHORT, Locale.US).format(Date()).replace('/', '-')}.json"

private fun writeUriText(context: Context, uri: Uri, text: String) {
    context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { writer ->
        writer.write(text)
    } ?: throw IllegalArgumentException("Could not open backup file for writing.")
}
