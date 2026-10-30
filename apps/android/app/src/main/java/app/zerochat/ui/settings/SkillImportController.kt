package app.zerochat.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import app.zerochat.data.AppSnapshot
import app.zerochat.data.UserSkill
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.chat.GenerationTaskOwner
import app.zerochat.ui.chat.runIfCurrent
import java.util.concurrent.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext

class SkillImportController constructor(
    val importSkill: () -> Unit,
)

internal fun skillImportFailureNotice(i18n: NativeI18n, error: Throwable): String =
    (error as? SkillImportUserError)?.message
        ?: i18n.t("notice.skillImportFailed")
            .replace("{message}", i18n.t("error.apiRequestFailed"))

internal fun launchSkillImport(
    scope: CoroutineScope,
    generationTasks: GenerationTaskOwner,
    read: suspend () -> UserSkill,
    onImported: (UserSkill) -> Unit,
    onFailure: (Throwable) -> Unit,
): Job? {
    val lease = generationTasks.tryAcquire() ?: return null
    val job = generationTasks.launch(scope, lease) {
        val result: Result<UserSkill> = try {
            Result.success(read())
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            Result.failure(error)
        }

        result.fold(
            onSuccess = { skill ->
                lease.runIfCurrent { onImported(skill) }
            },
            onFailure = { error ->
                lease.runIfCurrent { onFailure(error) }
            },
        )
    }
    if (job == null) {
        lease.release()
    }
    return job
}

@Composable
internal fun rememberSkillImportController(
    onSnapshotReduce: ((AppSnapshot) -> AppSnapshot) -> Unit,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
    generationTasks: GenerationTaskOwner,
): SkillImportController {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }

        launchSkillImport(
            scope = scope,
            generationTasks = generationTasks,
            read = {
                withContext(Dispatchers.IO) {
                    readSkillFromUri(context, uri, i18n)
                }
            },
            onImported = { skill ->
                onSnapshotReduce { current ->
                    skillSettingsPrependImportedSkill(current, skill)
                }
                onNotice(
                    i18n.t("notice.skillImported").replace("{count}", "1"),
                    SettingsNoticeKind.Success,
                )
            },
            onFailure = { error ->
                onNotice(
                    skillImportFailureNotice(i18n, error),
                    SettingsNoticeKind.Error,
                )
            },
        )
    }

    return SkillImportController(
        importSkill = { importer.launch("*/*") },
    )
}
