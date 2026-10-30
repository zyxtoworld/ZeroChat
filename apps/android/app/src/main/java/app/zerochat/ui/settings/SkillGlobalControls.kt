package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import app.zerochat.data.SkillSettings
import app.zerochat.ui.NativeI18n
@Composable
internal fun SkillGlobalControls(
    settings: SkillSettings,
    onSettingsChange: (SkillSettings) -> Unit,
    i18n: NativeI18n,
) {
    var contextBudgetText by rememberSaveable { mutableStateOf(settings.contextBudget.toString()) }
    var maxAutoSkillsText by rememberSaveable { mutableStateOf(settings.maxAutoSkills.toString()) }
    var contextBudgetFocused by remember { mutableStateOf(false) }
    var maxAutoSkillsFocused by remember { mutableStateOf(false) }

    fun commitContextBudget() {
        val normalized = contextBudgetText.toIntOrNull()
            ?.coerceIn(600, 8000)
            ?: settings.contextBudget
        contextBudgetText = normalized.toString()
        if (normalized != settings.contextBudget) {
            onSettingsChange(settings.copy(contextBudget = normalized))
        }
    }

    fun commitMaxAutoSkills() {
        val normalized = maxAutoSkillsText.toIntOrNull()
            ?.coerceIn(1, 8)
            ?: settings.maxAutoSkills
        maxAutoSkillsText = normalized.toString()
        if (normalized != settings.maxAutoSkills) {
            onSettingsChange(settings.copy(maxAutoSkills = normalized))
        }
    }

    LaunchedEffect(settings.contextBudget) {
        if (!contextBudgetFocused) {
            contextBudgetText = settings.contextBudget.toString()
        }
    }
    LaunchedEffect(settings.maxAutoSkills) {
        if (!maxAutoSkillsFocused) {
            maxAutoSkillsText = settings.maxAutoSkills.toString()
        }
    }

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
        value = contextBudgetText,
        onValueChange = { value -> contextBudgetText = value.filter(Char::isDigit).take(4) },
        label = { Text(i18n.t("field.skillContextBudget")) },
        modifier = Modifier
            .fillMaxWidth()
            .onFocusChanged { focusState ->
                if (contextBudgetFocused && !focusState.isFocused) {
                    commitContextBudget()
                }
                contextBudgetFocused = focusState.isFocused
            },
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Number,
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { commitContextBudget() }),
    )
    OutlinedTextField(
        value = maxAutoSkillsText,
        onValueChange = { value -> maxAutoSkillsText = value.filter(Char::isDigit).take(2) },
        label = { Text(i18n.t("field.skillAutoCount")) },
        modifier = Modifier
            .fillMaxWidth()
            .onFocusChanged { focusState ->
                if (maxAutoSkillsFocused && !focusState.isFocused) {
                    commitMaxAutoSkills()
                }
                maxAutoSkillsFocused = focusState.isFocused
            },
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Number,
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { commitMaxAutoSkills() }),
    )
    Text(
        i18n.t("settings.skillBudgetNote"),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
