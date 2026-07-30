package app.zerochat.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.data.AppSnapshot
import app.zerochat.ui.NativeI18n
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SkillImportController constructor(
    val importSkill: () -> Unit,
)

@Composable
fun rememberSkillImportController(
    onSnapshotReduce: ((AppSnapshot) -> AppSnapshot) -> Unit,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
): SkillImportController {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }

        scope.launch {
            val result = runCatchingPreservingCancellation {
                withContext(Dispatchers.IO) {
                    readSkillFromUri(context, uri, i18n)
                }
            }
            result.fold(
                onSuccess = { skill ->
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
                        i18n.t("notice.skillImportFailed")
                            .replace("{message}", error.message.orEmpty()),
                        SettingsNoticeKind.Error,
                    )
                },
            )
        }
    }

    return SkillImportController(
        importSkill = { importer.launch("*/*") },
    )
}
