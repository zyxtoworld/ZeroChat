package app.zerochat.ui.settings

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.zerochat.ui.NativeI18n

@Composable
internal fun SkillEmptyImportPrompt(
    onImportSkill: () -> Unit,
    i18n: NativeI18n,
) {
    Text(
        i18n.t("settings.skillsEmpty"),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedButton(
        onClick = onImportSkill,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(i18n.t("button.importSkill"))
    }
}
