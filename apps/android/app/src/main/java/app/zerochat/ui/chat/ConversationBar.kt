@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.zerochat.ui.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.data.Conversation
import app.zerochat.ui.NativeI18n
import java.text.Normalizer
import java.util.Locale

@Composable
internal fun CompactConversationBar(
    conversationSearch: String,
    onConversationSearchChange: (String) -> Unit,
    onClearConversationSearch: () -> Unit,
    filteredConversations: List<Conversation>,
    conversationSearchActive: Boolean,
    activeConversation: Conversation?,
    conversationPickerOpen: Boolean,
    onConversationPickerOpenChange: (Boolean) -> Unit,
    onSelectConversation: (String) -> Unit,
    onDeleteConversation: (Conversation) -> Unit,
    onDismissKeyboard: () -> Unit,
    i18n: NativeI18n,
    showTrigger: Boolean,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    if (showTrigger) {
        OutlinedButton(
            onClick = { onConversationPickerOpenChange(true) },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
        ) {
            Text(
                i18n.t("conversation.searchLabel"),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }

    if (conversationPickerOpen) {
        ModalBottomSheet(
            onDismissRequest = { onConversationPickerOpenChange(false) },
            sheetState = sheetState,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxHeight(0.82f)
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .clickable(onClick = onDismissKeyboard),
            ) {
                ConversationSearchField(
                    value = conversationSearch,
                    onValueChange = onConversationSearchChange,
                    onClear = onClearConversationSearch,
                    i18n = i18n,
                )
                if (conversationSearchActive && filteredConversations.isEmpty()) {
                    ConversationSearchEmptyState(i18n)
                }
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .clickable(onClick = onDismissKeyboard)
                        .padding(PaddingValues(horizontal = 12.dp, vertical = 8.dp)),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(filteredConversations, key = { it.id }) { conversation ->
                        ConversationListItem(
                            conversation = conversation,
                            selected = conversation.id == activeConversation?.id,
                            onSelect = {
                                onConversationPickerOpenChange(false)
                                onSelectConversation(conversation.id)
                            },
                            onDelete = { onDeleteConversation(conversation) },
                            i18n = i18n,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun ConversationSidebar(
    conversationSearch: String,
    onConversationSearchChange: (String) -> Unit,
    onClearConversationSearch: () -> Unit,
    filteredConversations: List<Conversation>,
    conversationSearchActive: Boolean,
    activeConversation: Conversation?,
    onSelectConversation: (String) -> Unit,
    onDeleteConversation: (Conversation) -> Unit,
    i18n: NativeI18n,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .padding(vertical = 4.dp),
    ) {
        ConversationSearchField(
            value = conversationSearch,
            onValueChange = onConversationSearchChange,
            onClear = onClearConversationSearch,
            i18n = i18n,
        )
        if (conversationSearchActive && filteredConversations.isEmpty()) {
            ConversationSearchEmptyState(i18n)
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(filteredConversations, key = { it.id }) { conversation ->
                SwipeToDismissConversationListItem(
                    conversation = conversation,
                    selected = conversation.id == activeConversation?.id,
                    onSelect = { onSelectConversation(conversation.id) },
                    onDelete = { onDeleteConversation(conversation) },
                    i18n = i18n,
                )
            }
        }
    }
}

@Composable
internal fun SwipeToDismissConversationListItem(
    conversation: Conversation,
    selected: Boolean,
    onSelect: () -> Unit,
    onDelete: () -> Unit,
    i18n: NativeI18n,
) {
    val dismissState = rememberSwipeToDismissBoxState()

    LaunchedEffect(conversation.id, dismissState.currentValue) {
        if (conversationSwipeDeleteAction(dismissState.currentValue) == ConversationSwipeDeleteAction.RequestDelete) {
            onDelete()
            dismissState.snapTo(SwipeToDismissBoxValue.Settled)
        }
    }

    SwipeToDismissBox(
        state = dismissState,
        backgroundContent = {
            ConversationSwipeDeleteBackground(i18n)
        },
    ) {
        ConversationListItem(
            conversation = conversation,
            selected = selected,
            onSelect = onSelect,
            onDelete = onDelete,
            i18n = i18n,
        )
    }
}

@Composable
private fun ConversationSwipeDeleteBackground(i18n: NativeI18n) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
        modifier = Modifier.fillMaxSize(),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterEnd,
        ) {
            Text(
                i18n.t("action.delete"),
                color = MaterialTheme.colorScheme.onErrorContainer,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

internal enum class ConversationSwipeDeleteAction {
    None,
    RequestDelete,
}

internal fun conversationSwipeDeleteAction(value: SwipeToDismissBoxValue): ConversationSwipeDeleteAction =
    when (value) {
        SwipeToDismissBoxValue.Settled -> ConversationSwipeDeleteAction.None
        SwipeToDismissBoxValue.StartToEnd,
        SwipeToDismissBoxValue.EndToStart,
        -> ConversationSwipeDeleteAction.RequestDelete
    }

@Composable
internal fun ConversationSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    onClear: () -> Unit,
    i18n: NativeI18n,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(i18n.t("conversation.searchLabel")) },
        placeholder = { Text(i18n.t("conversation.searchPlaceholder")) },
        singleLine = true,
        trailingIcon = {
            if (value.isNotBlank()) {
                TextButton(onClick = onClear) {
                    Text(i18n.t("conversation.searchClear"))
                }
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
    )
}

@Composable
internal fun ConversationSearchEmptyState(i18n: NativeI18n) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                i18n.t("conversation.searchNoResultsTitle"),
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                i18n.t("conversation.searchNoResultsBody"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun ConversationChip(
    conversation: Conversation,
    selected: Boolean,
    onSelect: () -> Unit,
    onDelete: () -> Unit,
    i18n: NativeI18n,
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
        ),
        modifier = Modifier.clickable(onClick = onSelect),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                conversationDisplayTitle(conversation, i18n),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.width(140.dp),
            )
            TextButton(onClick = onDelete) {
                Text(i18n.t("action.delete"))
            }
        }
    }
}

@Composable
internal fun ConversationListItem(
    conversation: Conversation,
    selected: Boolean,
    onSelect: () -> Unit,
    onDelete: () -> Unit,
    i18n: NativeI18n,
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
        ),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect),
    ) {
        ListItem(
            colors = ListItemDefaults.colors(
                containerColor = if (selected) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                },
            ),
            headlineContent = {
                Text(
                    conversationDisplayTitle(conversation, i18n),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontWeight = FontWeight.SemiBold,
                )
            },
            supportingContent = if (conversation.model.isNotBlank()) {
                {
                    Text(
                        conversation.model,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                null
            },
            trailingContent = {
                TextButton(onClick = onDelete) {
                    Text(i18n.t("action.delete"))
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

internal fun conversationDisplayTitle(conversation: Conversation, i18n: NativeI18n): String =
    conversation.title.trim().ifBlank { i18n.t("title.newChat") }

internal fun normalizeConversationSearchValue(value: String): String {
    val normalized = Normalizer.normalize(value.trim(), Normalizer.Form.NFKD)
    return conversationSearchCombiningMarks
        .replace(normalized, "")
        .lowercase(Locale.ROOT)
}

internal fun conversationMatchesSearch(
    conversation: Conversation,
    normalizedQuery: String,
    i18n: NativeI18n,
): Boolean {
    val haystack = listOf(
        conversationDisplayTitle(conversation, i18n),
        conversation.model,
    ) + conversation.messages.map { it.content }

    return normalizeConversationSearchValue(haystack.joinToString("\n")).contains(normalizedQuery)
}

private val conversationSearchCombiningMarks = Regex("\\p{Mn}+")
