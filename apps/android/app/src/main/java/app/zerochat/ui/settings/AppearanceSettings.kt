package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.zerochat.data.AppSnapshot
import app.zerochat.ui.NativeI18n

@Composable
fun AppearanceSettings(
    snapshot: AppSnapshot,
    onSnapshotChange: (AppSnapshot) -> Unit,
    i18n: NativeI18n,
) {
    SettingsCard(i18n.t("setting.appearance")) {
        OptionChips(
            title = i18n.t("field.theme"),
            options = listOf("system", "light", "dark"),
            selected = snapshot.preferences.theme,
            labelFor = { value ->
                when (value) {
                    "system" -> i18n.t("theme.system")
                    "light" -> i18n.t("theme.light")
                    "dark" -> i18n.t("theme.dark")
                    else -> value
                }
            },
            onSelected = {
                onSnapshotChange(snapshot.copy(preferences = snapshot.preferences.copy(theme = it)))
            },
        )
        OptionChips(
            title = i18n.t("field.language"),
            options = NativeI18n.languageModes,
            selected = snapshot.preferences.language,
            labelFor = { i18n.languageLabel(it) },
            onSelected = {
                onSnapshotChange(snapshot.copy(preferences = snapshot.preferences.copy(language = it)))
            },
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(i18n.t("field.compactDisplay"), modifier = Modifier.weight(1f))
            Switch(
                checked = snapshot.preferences.compactMode,
                onCheckedChange = {
                    onSnapshotChange(snapshot.copy(preferences = snapshot.preferences.copy(compactMode = it)))
                },
            )
        }
    }
}
