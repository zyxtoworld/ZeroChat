package app.zerochat.ui.settings

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import app.zerochat.data.AppSnapshot
import app.zerochat.data.SkillSettings
import app.zerochat.data.UserSkill
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.chat.GenerationTaskOwner

@Composable
internal fun SkillsSettings(
    snapshot: AppSnapshot,
    onSnapshotChange: (AppSnapshot) -> Unit,
    onSnapshotReduce: ((AppSnapshot) -> AppSnapshot) -> Unit,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
    onRequestScrollTop: () -> Unit,
    generationTasks: GenerationTaskOwner,
) {
    var skillName by remember { mutableStateOf("") }
    var skillContent by remember { mutableStateOf("") }
    var showEmptyStateFirst by rememberSaveable { mutableStateOf(false) }
    val importer = rememberSkillImportController(
        onSnapshotReduce = { reducer ->
            onSnapshotReduce(reducer)
            showEmptyStateFirst = false
        },
        onNotice = onNotice,
        i18n = i18n,
        generationTasks = generationTasks,
    )

    fun updateSettings(settings: SkillSettings) {
        onSnapshotChange(snapshot.copy(skillSettings = settings))
    }

    fun upsertSkill(skill: UserSkill) {
        onSnapshotChange(
            snapshot.copy(
                skills = snapshot.skills.map { item ->
                    if (item.id == skill.id) skill else item
                },
            ),
        )
    }

    fun addSkillFromDraft() {
        if (skillContent.trim().isBlank()) {
            onNotice(i18n.t("notice.skillContentRequired"), SettingsNoticeKind.Warning)
            return
        }

        val skill = createNativeSkill(
            name = skillName.ifBlank { i18n.t("fallback.skillName") },
            content = skillContent,
            contentType = "text",
            fallbackSkillName = i18n.t("fallback.skillName"),
            fallbackHeading = i18n.t("fallback.skillHeading"),
            emptyContentMessage = i18n.t("message.skillContentEmpty"),
        )
        onSnapshotChange(snapshot.copy(skills = listOf(skill) + snapshot.skills))
        skillName = ""
        skillContent = ""
        showEmptyStateFirst = false
        onNotice(i18n.t("notice.skillAdded"), SettingsNoticeKind.Success)
    }

    SettingsCard(i18n.t("setting.skills")) {
        Text(
            i18n.t("settings.skillsHelp"),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (snapshot.skills.isEmpty() && showEmptyStateFirst) {
            SkillEmptyImportPrompt(
                onImportSkill = importer.importSkill,
                i18n = i18n,
            )
        }
        SkillGlobalControls(
            settings = snapshot.skillSettings,
            onSettingsChange = ::updateSettings,
            i18n = i18n,
        )

        if (snapshot.skills.isEmpty()) {
            NativeSkillAddForm(
                skillName = skillName,
                skillContent = skillContent,
                onSkillNameChange = { skillName = it },
                onSkillContentChange = { skillContent = it },
                onAddSkill = ::addSkillFromDraft,
                onImportSkill = importer.importSkill,
                i18n = i18n,
            )
            if (!showEmptyStateFirst) {
                Text(
                    i18n.t("settings.skillsEmpty"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            SkillListSection(
                skills = snapshot.skills,
                i18n = i18n,
                onChange = ::upsertSkill,
                onSaved = {
                    onNotice(i18n.t("notice.skillSaved"), SettingsNoticeKind.Success)
                },
                onDelete = { deletedSkill ->
                    val remainingSkills = snapshot.skills.filterNot { it.id == deletedSkill.id }
                    onSnapshotChange(
                        snapshot.copy(skills = remainingSkills),
                    )
                    showEmptyStateFirst = remainingSkills.isEmpty()
                    if (remainingSkills.isEmpty()) {
                        onRequestScrollTop()
                    }
                    onNotice(i18n.t("notice.skillDeleted"), SettingsNoticeKind.Success)
                },
            )

            NativeSkillAddForm(
                skillName = skillName,
                skillContent = skillContent,
                onSkillNameChange = { skillName = it },
                onSkillContentChange = { skillContent = it },
                onAddSkill = ::addSkillFromDraft,
                onImportSkill = importer.importSkill,
                i18n = i18n,
            )
        }
    }
}
