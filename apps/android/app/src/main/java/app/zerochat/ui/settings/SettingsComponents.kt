@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.ui.NativeI18n

enum class SettingsNoticeKind {
    Success,
    Warning,
    Error,
}

@Composable
fun SettingsCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

fun dangerBody(i18n: NativeI18n, prefix: String): String =
    listOf("body", "detail1", "detail2", "detail3", "detail4")
        .map { i18n.t("$prefix.$it") }
        .filterNot { it.startsWith(prefix) }
        .joinToString("\n\n")

@Composable
fun DangerDialog(
    title: String,
    body: String,
    confirm: String,
    i18n: NativeI18n,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    var checked by remember { mutableStateOf(false) }
    val paragraphs = remember(body) {
        body.split(Regex("\\n\\s*\\n"))
            .map { it.trim() }
            .filter { it.isNotEmpty() }
    }
    val scrollState = rememberScrollState()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 320.dp)
                        .verticalScroll(scrollState),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    paragraphs.forEach { paragraph ->
                        Text(
                            paragraph,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = checked, onCheckedChange = { checked = it })
                    Text(
                        i18n.t("action.iUnderstand"),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        },
        confirmButton = {
            Button(onClick = onConfirm, enabled = checked) {
                Text(
                    confirm,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(i18n.t("action.cancel"), maxLines = 1)
            }
        },
    )
}

@Composable
fun OptionChips(
    title: String,
    options: List<String>,
    selected: String,
    labelFor: (String) -> String = { it },
    onSelected: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontWeight = FontWeight.SemiBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { item ->
                FilterChip(
                    selected = item == selected,
                    onClick = { onSelected(item) },
                    label = { Text(labelFor(item)) },
                )
            }
        }
    }
}
