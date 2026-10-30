package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.zerochat.data.UserSkill
import app.zerochat.ui.NativeI18n

private const val SKILL_LIST_INITIAL_RENDER_LIMIT = 80
private const val SKILL_LIST_RENDER_BATCH = 80

@Composable
internal fun SkillListSection(
    skills: List<UserSkill>,
    i18n: NativeI18n,
    onChange: (UserSkill) -> Unit,
    onSaved: () -> Unit,
    onDelete: (UserSkill) -> Unit,
) {
    var renderedSkillLimit by rememberSaveable { mutableIntStateOf(SKILL_LIST_INITIAL_RENDER_LIMIT) }
    val visibleSkillCount = skills.size.coerceAtMost(renderedSkillLimit)
    val visibleSkills = skills.take(renderedSkillLimit)

    if (visibleSkillCount < skills.size) {
        SkillListProgressControls(
            shown = visibleSkillCount,
            total = skills.size,
            i18n = i18n,
            onShowMore = {
                renderedSkillLimit = (renderedSkillLimit + SKILL_LIST_RENDER_BATCH)
                    .coerceAtMost(skills.size)
            },
        )
    }

    visibleSkills.forEach { skill ->
        NativeSkillEditor(
            skill = skill,
            i18n = i18n,
            onChange = onChange,
            onSaved = onSaved,
            onDelete = { onDelete(skill) },
        )
    }

    if (visibleSkillCount < skills.size) {
        SkillListProgressControls(
            shown = visibleSkillCount,
            total = skills.size,
            i18n = i18n,
            onShowMore = {
                renderedSkillLimit = (renderedSkillLimit + SKILL_LIST_RENDER_BATCH)
                    .coerceAtMost(skills.size)
            },
        )
    }
}

@Composable
internal fun SkillListProgressControls(
    shown: Int,
    total: Int,
    i18n: NativeI18n,
    onShowMore: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            i18n.t("settings.skillListProgress")
                .replace("{shown}", i18n.formatNumber(shown))
                .replace("{total}", i18n.formatNumber(total)),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(
            onClick = onShowMore,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(i18n.t("button.showMoreSkills"))
        }
    }
}
