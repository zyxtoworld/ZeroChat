package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import app.zerochat.data.SkillSettings
import app.zerochat.ui.NativeI18n

@Composable
fun SkillGlobalControls(
    settings: SkillSettings,
    onSettingsChange: (SkillSettings) -> Unit,
    i18n: NativeI18n,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(i18n.t("label.skillGlobalAutoMatch"), modifier = Modifier.weight(1f))
        Switch(
            checked = settings.autoMatch,
            onCheckedChange = {
                onSettingsChange(settings.copy(autoMatch = it))
            },
        )
    }
    OutlinedTextField(
        value = settings.contextBudget.toString(),
        onValueChange = { value ->
            value.toIntOrNull()?.let {
                onSettingsChange(
                    settings.copy(contextBudget = it.coerceIn(600, 8000)),
                )
            }
        },
        label = { Text(i18n.t("field.skillContextBudget")) },
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    )
    OutlinedTextField(
        value = settings.maxAutoSkills.toString(),
        onValueChange = { value ->
            value.toIntOrNull()?.let {
                onSettingsChange(
                    settings.copy(maxAutoSkills = it.coerceIn(1, 8)),
                )
            }
        },
        label = { Text(i18n.t("field.skillAutoCount")) },
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    )
    Text(
        i18n.t("settings.skillBudgetNote"),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
