@file:OptIn(
    androidx.compose.foundation.ExperimentalFoundationApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package app.zerochat.ui.chat

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import app.zerochat.data.ChatMessage
import app.zerochat.data.MessageAttachment
import app.zerochat.data.MessageRole
import app.zerochat.client.R
import app.zerochat.ui.NativeI18n
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date
import java.util.Locale

private val JetBrainsMonoCodeFont = FontFamily(
    Font(R.font.jetbrains_mono_regular, FontWeight.Normal),
)
private const val ManualSyncRefreshingTestTag = "zerochat-manual-sync-refreshing"
private sealed interface MessageRenderBlock {
    data class Code(val value: MessageCodeBlock) : MessageRenderBlock
    data class Markdown(val value: MessageMarkdownBlock) : MessageRenderBlock
}

private data class MessageListItem(
    val message: ChatMessage,
    val renderBlocks: List<MessageRenderBlock>,
    val index: Int,
    val total: Int,
) {
    val key: String get() = "${message.id}:$index"
    val isFirst: Boolean get() = index == 0
    val isLast: Boolean get() = index == total - 1
}

private data class RenderedMessageItems(
    val source: List<ChatMessage>,
    val items: List<MessageListItem>,
)

private const val MaxMessageChunkCharacters = 900

private fun messageListItems(messages: List<ChatMessage>): List<MessageListItem> =
    messages.flatMap { message ->
        val chunks = messageContentChunks(message.content)
        chunks.mapIndexed { index, content ->
            MessageListItem(
                message = message,
                renderBlocks = messageRenderBlocks(content),
                index = index,
                total = chunks.size,
            )
        }
    }

private fun messageRenderBlocks(content: String): List<MessageRenderBlock> =
    messageContentBlocks(content).flatMap { contentBlock ->
        when (contentBlock) {
            is MessageCodeBlock -> listOf(MessageRenderBlock.Code(contentBlock))
            is MessageTextBlock -> messageMarkdownBlocks(contentBlock.text).map(
                MessageRenderBlock::Markdown,
            )
        }
    }

private fun messageContentChunks(content: String): List<String> {
    if (content.length <= MaxMessageChunkCharacters) {
        return listOf(content)
    }

    val chunks = mutableListOf<String>()
    var chunkStart = 0
    var lineStart = 0
    var codeFenceOpen = false

    fun addChunk(end: Int) {
        val chunk = content.substring(chunkStart, end).trim()
        if (chunk.isNotEmpty()) {
            chunks += chunk
        }
        chunkStart = end
    }

    while (lineStart < content.length) {
        val lineEnd = content.indexOf('\n', lineStart).takeIf { it >= 0 } ?: content.length
        val nextLineStart = if (lineEnd < content.length) lineEnd + 1 else content.length
        val line = content.substring(lineStart, lineEnd)
        val exceedsChunkLimit = nextLineStart - chunkStart > MaxMessageChunkCharacters

        if (exceedsChunkLimit && !codeFenceOpen && lineStart > chunkStart) {
            addChunk(lineStart)
        }

        if (line.trimStart().startsWith("```")) {
            codeFenceOpen = !codeFenceOpen
        }
        lineStart = nextLineStart
    }

    if (chunkStart < content.length) {
        addChunk(content.length)
    }

    return chunks.ifEmpty { listOf(content) }
}


@Composable
internal fun MessageList(
    conversationId: String?,
    messages: List<ChatMessage>,
    hasActiveChat: Boolean,
    manualSyncRefreshing: Boolean,
    onRefresh: () -> Unit,
    onEditMessage: (ChatMessage) -> Unit,
    onRegenerateMessage: (ChatMessage) -> Unit,
    onDeleteMessage: (ChatMessage) -> Unit,
    onSpeakMessage: (ChatMessage) -> Unit,
    onStopSpeaking: () -> Unit,
    speakingMessageId: String?,
    onDismissKeyboard: () -> Unit,
    i18n: NativeI18n,
    modifier: Modifier = Modifier,
    emptyContent: @Composable () -> Unit,
) {
    val pullToRefreshState = rememberPullToRefreshState()
    val messageListState = rememberLazyListState()
    val latestMessage = messages.lastOrNull()
    val renderedMessageItemsState = produceState<RenderedMessageItems?>(
        initialValue = null,
        key1 = messages,
    ) {
        value = null
        val items = withContext(Dispatchers.Default) {
            messageListItems(messages)
        }
        value = RenderedMessageItems(source = messages, items = items)
    }
    val renderedMessageItems = renderedMessageItemsState.value?.items.orEmpty()
    var renderedConversationId by remember { mutableStateOf<String?>(null) }
    val manualSyncRefreshMarker = if (manualSyncRefreshing) {
        Modifier.testTag(ManualSyncRefreshingTestTag)
    } else {
        Modifier
    }

    LaunchedEffect(conversationId, messages.size, latestMessage?.id) {
        renderedConversationId = conversationId

        val targetMessages = messages
        snapshotFlow {
            renderedMessageItemsState.value?.source === targetMessages
        }.first { it }
        val lastRenderedItemIndex = renderedMessageItemsState.value?.items?.lastIndex ?: -1
        if (lastRenderedItemIndex < 0) {
            messageListState.scrollToItem(0)
            return@LaunchedEffect
        }

        messageListState.scrollToItem(lastRenderedItemIndex)
    }

    PullToRefreshBox(
        isRefreshing = manualSyncRefreshing,
        onRefresh = onRefresh,
        modifier = modifier
            .semantics {
                contentDescription = i18n.t("setting.sync")
            }
            .then(manualSyncRefreshMarker),
        state = pullToRefreshState,
        indicator = {
            if (!manualSyncRefreshing) {
                PullToRefreshDefaults.Indicator(
                    state = pullToRefreshState,
                    isRefreshing = false,
                    modifier = Modifier.align(Alignment.TopCenter),
                )
            }
        },
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .clickable(onClick = onDismissKeyboard),
            state = messageListState,
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            if (!hasActiveChat) {
                item(key = "empty-state") {
                    emptyContent()
                }
            }

            items(
                items = renderedMessageItems,
                key = { it.key },
            ) { item ->
                MessageBubble(
                    item = item,
                    onEdit = { onEditMessage(item.message) },
                    onRegenerate = { onRegenerateMessage(item.message) },
                    onDelete = { onDeleteMessage(item.message) },
                    isSpeaking = speakingMessageId == item.message.id,
                    onSpeak = { onSpeakMessage(item.message) },
                    onStopSpeaking = onStopSpeaking,
                    i18n = i18n,
                )
            }
        }
    }
}

@Composable
private fun MessageBubble(
    item: MessageListItem,
    onEdit: () -> Unit,
    onRegenerate: () -> Unit,
    onDelete: () -> Unit,
    isSpeaking: Boolean,
    onSpeak: () -> Unit,
    onStopSpeaking: () -> Unit,
    i18n: NativeI18n,
) {
    val message = item.message
    var menuExpanded by rememberSaveable(item.key) { mutableStateOf(false) }
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val isUser = message.role == MessageRole.User
    val isStreamingAssistant = message.role == MessageRole.Assistant && message.status == "streaming"
    val assistantRerunActionKey = if (message.status == "error") "button.retry" else "action.regenerate"
    val canSpeak = message.content.isNotBlank() && message.status != "streaming"
    val shape = when {
        item.isFirst && item.isLast -> RoundedCornerShape(12.dp)
        item.isFirst -> RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)
        item.isLast -> RoundedCornerShape(bottomStart = 12.dp, bottomEnd = 12.dp)
        else -> RoundedCornerShape(0.dp)
    }
    val renderBlocks = item.renderBlocks

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = if (item.isLast) 10.dp else 0.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            modifier = Modifier.fillMaxWidth(0.86f),
        ) {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (isUser) {
                        MaterialTheme.colorScheme.primary
                    } else if (message.status == "error") {
                        MaterialTheme.colorScheme.errorContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    },
                    contentColor = if (isUser) {
                        MaterialTheme.colorScheme.onPrimary
                    } else if (message.status == "error") {
                        MaterialTheme.colorScheme.onErrorContainer
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                ),
                shape = shape,
                modifier = Modifier
                    .fillMaxWidth()
                    .combinedClickable(
                        onClick = { menuExpanded = true },
                        onLongClick = { menuExpanded = true },
                    ),
            ) {
                Column(
                    modifier = Modifier.padding(
                        start = 12.dp,
                        end = 12.dp,
                        top = if (item.isFirst) 12.dp else 6.dp,
                        bottom = if (item.isLast) 12.dp else 6.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (isStreamingAssistant && message.content.isBlank() && item.isFirst) {
                        Text(i18n.t("message.generating"))
                    } else {
                        renderBlocks.forEach { block ->
                            MessageRenderBlockView(
                                block = block,
                                i18n = i18n,
                                onCopyCode = { code ->
                                    scope.launch {
                                        clipboard.setClipEntry(
                                            ClipEntry(
                                                ClipData.newPlainText("ZeroChat code", code),
                                            ),
                                        )
                                    }
                                },
                                onOpenLink = { url -> openMessageLink(context, url, i18n) },
                            )
                        }
                    }
                    if (item.isLast) {
                        message.error?.takeIf { it.isNotBlank() }?.let {
                            Text(it, color = MaterialTheme.colorScheme.error)
                        }
                        message.attachments.forEach { attachment ->
                            AttachmentPreview(attachment)
                        }
                        Text(
                            systemTime(message.createdAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (isUser) {
                                MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.75f)
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            modifier = Modifier.align(if (isUser) Alignment.End else Alignment.Start),
                        )
                    }
                }
            }
            DropdownMenu(
                expanded = menuExpanded,
                onDismissRequest = { menuExpanded = false },
            ) {
                DropdownMenuItem(
                    text = { Text(i18n.t("button.copy")) },
                    onClick = {
                        menuExpanded = false
                        scope.launch {
                            clipboard.setClipEntry(
                                ClipEntry(
                                    ClipData.newPlainText("ZeroChat", message.content),
                                ),
                            )
                        }
                    },
                    enabled = message.content.isNotBlank(),
                )
                if (isUser) {
                    DropdownMenuItem(
                        text = { Text(i18n.t("action.editResend")) },
                        onClick = {
                            menuExpanded = false
                            onEdit()
                        },
                    )
                } else {
                    DropdownMenuItem(
                        text = { Text(i18n.t("action.share")) },
                        onClick = {
                            menuExpanded = false
                            shareAssistantReply(context, message.content, i18n)
                        },
                        enabled = message.content.isNotBlank() && message.status != "streaming",
                    )
                    DropdownMenuItem(
                        text = {
                            Text(i18n.t(if (isSpeaking) "button.stopSpeaking" else "button.speakMessage"))
                        },
                        onClick = {
                            menuExpanded = false
                            if (isSpeaking) {
                                onStopSpeaking()
                            } else {
                                onSpeak()
                            }
                        },
                        enabled = canSpeak || isSpeaking,
                    )
                    DropdownMenuItem(
                        text = { Text(i18n.t(assistantRerunActionKey)) },
                        onClick = {
                            menuExpanded = false
                            onRegenerate()
                        },
                    )
                }
                DropdownMenuItem(
                    text = { Text(i18n.t("action.delete")) },
                    onClick = {
                        menuExpanded = false
                        onDelete()
                    },
                )
            }
        }
    }
}

@Composable
private fun MessageRenderBlockView(
    block: MessageRenderBlock,
    i18n: NativeI18n,
    onCopyCode: (String) -> Unit,
    onOpenLink: (String) -> Unit,
) {
    when (block) {
        is MessageRenderBlock.Code -> MessageCodeBlockView(
            block = block.value,
            i18n = i18n,
            onCopy = { onCopyCode(block.value.code) },
        )

        is MessageRenderBlock.Markdown -> MessageMarkdownBlockView(
            block = block.value,
            onOpenLink = onOpenLink,
        )
    }
}

@Composable
private fun MessageMarkdownBlockView(
    block: MessageMarkdownBlock,
    onOpenLink: (String) -> Unit,
) {
    when (block) {
        is MessageMarkdownHeading -> Text(
            block.text,
            style = when (block.level) {
                1 -> MaterialTheme.typography.titleLarge
                2 -> MaterialTheme.typography.titleMedium
                else -> MaterialTheme.typography.titleSmall
            },
            fontWeight = FontWeight.SemiBold,
        )

        is MessageMarkdownBulletList -> Column(
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            block.items.forEach { item ->
                Row(
                    modifier = Modifier.padding(start = (item.depth * 18).dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("•", color = MaterialTheme.colorScheme.primary)
                    MessageInlineMarkdownText(
                        text = item.text,
                        onOpenLink = onOpenLink,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        is MessageMarkdownOrderedList -> Column(
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            block.items.forEach { item ->
                Row(
                    modifier = Modifier.padding(start = (item.depth * 18).dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        "${item.number ?: block.start}.",
                        modifier = Modifier.widthIn(min = 22.dp),
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                    )
                    MessageInlineMarkdownText(
                        text = item.text,
                        onOpenLink = onOpenLink,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        is MessageMarkdownTable -> MessageMarkdownTableView(
            table = block,
            onOpenLink = onOpenLink,
        )

        is MessageMarkdownBlockQuote -> MessageMarkdownBlockQuoteView(
            quote = block,
            onOpenLink = onOpenLink,
        )

        is MessageMarkdownParagraph -> MessageInlineMarkdownText(
            text = block.text,
            onOpenLink = onOpenLink,
        )
    }
}

@Composable
private fun MessageInlineMarkdownText(
    text: String,
    onOpenLink: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val linkColor = MaterialTheme.colorScheme.primary
    val codeBackground = MaterialTheme.colorScheme.surfaceVariant
    val codeColor = MaterialTheme.colorScheme.onSurface
    val annotated = remember(text, linkColor, codeBackground, codeColor) {
        val spans = messageInlineSpans(text)
        buildAnnotatedString {
            spans.forEach { span ->
                when (span) {
                    is MessageInlineTextSpan -> append(span.text)
                    is MessageInlineStrongSpan -> withStyle(
                        SpanStyle(fontWeight = FontWeight.SemiBold),
                    ) {
                        append(span.text)
                    }

                    is MessageInlineEmphasisSpan -> withStyle(
                        SpanStyle(fontStyle = FontStyle.Italic),
                    ) {
                        append(span.text)
                    }

                    is MessageInlineCodeSpan -> withStyle(
                        SpanStyle(
                            background = codeBackground,
                            color = codeColor,
                            fontFamily = JetBrainsMonoCodeFont,
                        ),
                    ) {
                        append(span.code)
                    }

                    is MessageInlineLinkSpan -> withLink(
                        LinkAnnotation.Url(
                            span.url,
                            styles = TextLinkStyles(
                                style = SpanStyle(
                                    color = linkColor,
                                    textDecoration = TextDecoration.Underline,
                                ),
                            ),
                            linkInteractionListener = LinkInteractionListener {
                                onOpenLink(span.url)
                            },
                        ),
                    ) {
                        append(span.label)
                    }
                }
            }
        }
    }

    Text(
        text = annotated,
        modifier = modifier,
    )
}

@Composable
private fun MessageMarkdownBlockQuoteView(
    quote: MessageMarkdownBlockQuote,
    onOpenLink: (String) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .width(3.dp)
                .height(24.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(MaterialTheme.colorScheme.primary),
        )
        MessageInlineMarkdownText(
            text = quote.text,
            onOpenLink = onOpenLink,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun MessageMarkdownTableView(
    table: MessageMarkdownTable,
    onOpenLink: (String) -> Unit,
) {
    val tableScroll = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface)
            .horizontalScroll(tableScroll),
    ) {
        MessageMarkdownTableRow(cells = table.headers, header = true, onOpenLink = onOpenLink)
        table.rows.forEach { row ->
            HorizontalDivider()
            MessageMarkdownTableRow(cells = row, header = false, onOpenLink = onOpenLink)
        }
    }
}

@Composable
private fun MessageMarkdownTableRow(
    cells: List<String>,
    header: Boolean,
    onOpenLink: (String) -> Unit,
) {
    Row(
        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        cells.forEach { cell ->
            if (header) {
                Text(
                    cell,
                    modifier = Modifier.widthIn(min = 96.dp, max = 220.dp),
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.SemiBold,
                )
            } else {
                MessageInlineMarkdownText(
                    text = cell,
                    onOpenLink = onOpenLink,
                    modifier = Modifier.widthIn(min = 96.dp, max = 220.dp),
                )
            }
        }
    }
}

@Composable
private fun MessageCodeBlockView(
    block: MessageCodeBlock,
    i18n: NativeI18n,
    onCopy: () -> Unit,
) {
    val codeScroll = rememberScrollState()
    val keywordColor = MaterialTheme.colorScheme.primary
    val stringColor = MaterialTheme.colorScheme.tertiary
    val commentColor = MaterialTheme.colorScheme.onSurfaceVariant
    val numberColor = MaterialTheme.colorScheme.secondary
    val highlightedCode = remember(
        block.language,
        block.code,
        keywordColor,
        stringColor,
        commentColor,
        numberColor,
    ) {
        messageHighlightedCode(
            language = block.language,
            code = block.code.ifEmpty { " " },
            keywordColor = keywordColor,
            stringColor = stringColor,
            commentColor = commentColor,
            numberColor = numberColor,
        )
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(start = 10.dp, top = 4.dp, end = 6.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                block.language,
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            TextButton(onClick = onCopy) {
                Text(i18n.t("button.copy"))
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(codeScroll)
                .padding(10.dp),
        ) {
            Text(
                highlightedCode,
                fontFamily = JetBrainsMonoCodeFont,
                softWrap = false,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private fun shareAssistantReply(context: Context, text: String, i18n: NativeI18n) {
    val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(sendIntent, i18n.t("action.share")))
}

private fun openMessageLink(context: Context, url: String, i18n: NativeI18n) {
    val intent = messageLinkIntent(url) ?: return
    context.startActivity(Intent.createChooser(intent, i18n.t("action.openLink")))
}

private fun messageLinkIntent(url: String): Intent? =
    safeMessageLinkUrl(url)?.let { safeUrl ->
        Intent(Intent.ACTION_VIEW, safeUrl.toUri()).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
        }
    }

@Composable
private fun AttachmentPreview(attachment: MessageAttachment) {
    val image = remember(attachment.dataUrl) {
        attachment.dataUrl?.let(::bitmapFromDataUrl)
    }

    if (image != null) {
        Image(
            bitmap = image.asImageBitmap(),
            contentDescription = attachment.alt,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxWidth()
                .height(220.dp)
                .background(Color.Black, RoundedCornerShape(8.dp)),
        )
    } else {
        Text(
            attachment.url ?: "Image attached",
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

private fun bitmapFromDataUrl(dataUrl: String): Bitmap? {
    val marker = "base64,"
    val index = dataUrl.indexOf(marker)
    if (index < 0) {
        return null
    }

    val raw = dataUrl.substring(index + marker.length)
    return runCatching {
        val bytes = Base64.decode(raw, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }.getOrNull()
}

private fun systemTime(value: Long): String =
    DateFormat.getDateTimeInstance(
        DateFormat.SHORT,
        DateFormat.SHORT,
        Locale.getDefault(),
    ).format(Date(value))

private fun messageHighlightedCode(
    language: String,
    code: String,
    keywordColor: Color,
    stringColor: Color,
    commentColor: Color,
    numberColor: Color,
) = buildAnnotatedString {
    val spans = messageCodeHighlightSpans(language, code)
    var cursor = 0
    spans.forEach { span ->
        append(code.substring(cursor, span.start))
        withStyle(
            SpanStyle(
                color = when (span.kind) {
                    MessageCodeHighlightKind.Keyword -> keywordColor
                    MessageCodeHighlightKind.String -> stringColor
                    MessageCodeHighlightKind.Comment -> commentColor
                    MessageCodeHighlightKind.Number -> numberColor
                },
                fontStyle = if (span.kind == MessageCodeHighlightKind.Comment) {
                    FontStyle.Italic
                } else {
                    null
                },
                fontWeight = if (span.kind == MessageCodeHighlightKind.Keyword) {
                    FontWeight.SemiBold
                } else {
                    null
                },
            ),
        ) {
            append(code.substring(span.start, span.end))
        }
        cursor = span.end
    }
    append(code.substring(cursor))
}
