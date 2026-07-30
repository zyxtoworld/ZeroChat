@file:OptIn(
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.client.R
import app.zerochat.ui.NativeI18n
import kotlinx.coroutines.launch

enum class SettingsTab {
    Appearance,
    Providers,
    Models,
    Skills,
    Sync,
    Data,
}

@Composable
fun SettingsScreen(
    initialTab: SettingsTab,
    noticeContent: @Composable () -> Unit,
    onTabChanged: () -> Unit,
    i18n: NativeI18n,
    content: @Composable (SettingsTab, () -> Unit) -> Unit,
) {
    var tab by remember(initialTab) { mutableStateOf(initialTab) }
    val settingsContentListState = rememberLazyListState()
    val settingsContentScrollScope = rememberCoroutineScope()
    val requestContentScrollTop: () -> Unit = {
        settingsContentScrollScope.launch {
            settingsContentListState.scrollToItem(0)
        }
    }

    LaunchedEffect(tab) {
        settingsContentListState.scrollToItem(0)
    }

    Column(
        modifier = Modifier
            .fillMaxHeight(0.92f)
            .fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 16.dp),
    ) {
        Text(i18n.t("title.settings"), style = MaterialTheme.typography.headlineSmall)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painter = painterResource(id = R.drawable.ic_launcher_foreground),
                contentDescription = null,
                modifier = Modifier
                    .size(38.dp)
                    .testTag("zerochat-app-icon"),
                tint = Color.Unspecified,
            )
            Text(
                i18n.t("settings.changesAutoSave"),
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.height(12.dp))
        SettingsTabGrid(
            selected = tab,
            onSelected = { selected ->
                if (tab != selected) {
                    onTabChanged()
                }
                tab = selected
            },
            i18n = i18n,
        )
        noticeContent()
        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            state = settingsContentListState,
            contentPadding = PaddingValues(top = 12.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                content(tab, requestContentScrollTop)
            }
        }
    }
}

@Composable
private fun SettingsTabGrid(
    selected: SettingsTab,
    onSelected: (SettingsTab) -> Unit,
    i18n: NativeI18n,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val tabGap = 8.dp
        val tabColumns = if (maxWidth < 360.dp) 2 else 3
        val chipWidth = (maxWidth - tabGap * (tabColumns - 1)) / tabColumns
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(tabGap),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SettingsTab.entries.forEach { item ->
                FilterChip(
                    modifier = Modifier
                        .width(chipWidth)
                        .heightIn(min = 40.dp),
                    selected = selected == item,
                    onClick = { onSelected(item) },
                    leadingIcon = settingsTabIconRes(item)?.let { iconRes ->
                        {
                            Icon(
                                painter = painterResource(id = iconRes),
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    },
                    label = {
                        Text(
                            i18n.tabTitle(item),
                            modifier = Modifier.fillMaxWidth(),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = TextAlign.Center,
                        )
                    },
                )
            }
        }
    }
}

private fun settingsTabIconRes(tab: SettingsTab): Int? =
    when (tab) {
        SettingsTab.Sync -> R.drawable.ic_cloud_sync_24
        else -> null
    }
