package app.zerochat.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.client.R
import app.zerochat.ui.NativeI18n
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatTopBar(
    title: String,
    onNewConversation: () -> Unit,
    onOpenConversations: () -> Unit,
    onOpenSettings: () -> Unit,
    i18n: NativeI18n,
) {
    val containerWidthDp = with(LocalDensity.current) {
        LocalWindowInfo.current.containerSize.width.toDp().value.roundToInt()
    }
    val useIconActions = androidChatTopBarUsesIconActions(containerWidthDp)

    TopAppBar(
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    painter = painterResource(id = R.drawable.ic_launcher_foreground),
                    contentDescription = null,
                    modifier = Modifier
                        .size(32.dp)
                        .testTag("zerochat-app-icon"),
                    tint = Color.Unspecified,
                )
                Text(
                    title,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        },
        actions = {
            if (useIconActions) {
                IconButton(
                    onClick = onOpenConversations,
                    modifier = Modifier.testTag("zerochat-topbar-conversations"),
                ) {
                    Icon(
                        painter = painterResource(id = R.drawable.ic_list_24),
                        contentDescription = i18n.t("conversation.searchLabel"),
                    )
                }
                IconButton(
                    onClick = onNewConversation,
                    modifier = Modifier.testTag("zerochat-topbar-new"),
                ) {
                    Icon(
                        painter = painterResource(id = R.drawable.ic_add_24),
                        contentDescription = i18n.t("action.new"),
                    )
                }
                IconButton(
                    onClick = onOpenSettings,
                    modifier = Modifier.testTag("zerochat-topbar-settings"),
                ) {
                    Icon(
                        painter = painterResource(id = R.drawable.ic_settings_24),
                        contentDescription = i18n.t("title.settings"),
                    )
                }
            } else {
                TextButton(onClick = onOpenConversations) {
                    Text(i18n.t("conversation.searchLabel"))
                }
                TextButton(onClick = onNewConversation) {
                    Text(i18n.t("action.new"))
                }
                TextButton(
                    onClick = onOpenSettings,
                    modifier = Modifier.testTag("zerochat-topbar-settings"),
                ) {
                    Text(i18n.t("title.settings"))
                }
            }
        },
    )
}
