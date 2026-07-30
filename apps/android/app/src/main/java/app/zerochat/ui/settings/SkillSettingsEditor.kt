@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.zerochat.data.UserSkill
import app.zerochat.ui.NativeI18n

@Composable
fun NativeSkillEditor(
    skill: UserSkill,
    i18n: NativeI18n,
    onChange: (UserSkill) -> Unit,
    onSaved: () -> Unit,
    onDelete: () -> Unit,
) {
    var name by remember(skill.id, skill.name) { mutableStateOf(skill.name) }
    var content by remember(skill.id, skill.contentHash) { mutableStateOf(skillContent(skill)) }

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(i18n.t("field.skillName")) },
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                skillMetaText(skill, i18n),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SkillSwitch(
                    label = i18n.t("field.enabled"),
                    checked = skill.enabled,
                    onCheckedChange = {
                        onChange(skill.copy(enabled = it, updatedAt = nowMillis()))
                    },
                )
                SkillSwitch(
                    label = i18n.t("label.skillFixed"),
                    checked = skill.fixed,
                    onCheckedChange = {
                        onChange(skill.copy(fixed = it, updatedAt = nowMillis()))
                    },
                )
                SkillSwitch(
                    label = i18n.t("label.skillAutoMatch"),
                    checked = skill.autoMatch,
                    onCheckedChange = {
                        onChange(skill.copy(autoMatch = it, updatedAt = nowMillis()))
                    },
                )
            }
            OutlinedTextField(
                value = content,
                onValueChange = { content = it },
                label = { Text(i18n.t("field.skillContent")) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                maxLines = 4,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        if (content.trim().isNotBlank()) {
                            onChange(
                                createNativeSkill(
                                    name = name.ifBlank { skill.name },
                                    content = content,
                                    contentType = skill.contentType,
                                    fileName = skill.fileName,
                                    id = skill.id,
                                    createdAt = skill.createdAt,
                                    fixed = skill.fixed,
                                    enabled = skill.enabled,
                                    autoMatch = skill.autoMatch,
                                    fallbackSkillName = i18n.t("fallback.skillName"),
                                    fallbackHeading = i18n.t("fallback.skillHeading"),
                                    emptyContentMessage = i18n.t("message.skillContentEmpty"),
                                ),
                            )
                            onSaved()
                        }
                    },
                    enabled = content.trim().isNotBlank(),
                ) {
                    Text(i18n.t("button.save"))
                }
                OutlinedButton(onClick = onDelete) {
                    Text(i18n.t("button.deleteSkill"))
                }
            }
        }
    }
}

@Composable
fun NativeSkillAddForm(
    skillName: String,
    skillContent: String,
    onSkillNameChange: (String) -> Unit,
    onSkillContentChange: (String) -> Unit,
    onAddSkill: () -> Unit,
    onImportSkill: () -> Unit,
    i18n: NativeI18n,
) {
    OutlinedTextField(
        value = skillName,
        onValueChange = onSkillNameChange,
        label = { Text(i18n.t("field.skillName")) },
        placeholder = { Text(i18n.t("placeholder.skillName")) },
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        value = skillContent,
        onValueChange = onSkillContentChange,
        label = { Text(i18n.t("field.skillContent")) },
        placeholder = { Text(i18n.t("placeholder.skillContent")) },
        modifier = Modifier.fillMaxWidth(),
        minLines = 4,
        maxLines = 8,
    )
    Button(
        onClick = onAddSkill,
        modifier = Modifier.fillMaxWidth(),
        enabled = skillContent.trim().isNotBlank(),
    ) {
        Text(i18n.t("button.addSkill"))
    }
    OutlinedButton(
        onClick = onImportSkill,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(i18n.t("button.importSkill"))
    }
}

@Composable
private fun SkillSwitch(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = checked, onCheckedChange = onCheckedChange)
        Text(label)
    }
}

private fun nowMillis(): Long = System.currentTimeMillis()
