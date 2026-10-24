@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.zerochat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.ai.ImageUpload
import app.zerochat.ui.ComposerMode
import app.zerochat.ui.ImageTaskMode
import app.zerochat.ui.NativeI18n

@Composable
fun Composer(
    input: String,
    onInputChange: (String) -> Unit,
    focusRequester: FocusRequester,
    keyboardVisible: Boolean,
    mode: ComposerMode,
    onModeChange: (ComposerMode) -> Unit,
    imageTask: ImageTaskMode,
    onImageTaskChange: (ImageTaskMode) -> Unit,
    sourceImage: ImageUpload?,
    maskImage: ImageUpload?,
    editing: Boolean,
    onPickSource: () -> Unit,
    onClearSource: () -> Unit,
    onPickMask: () -> Unit,
    onClearMask: () -> Unit,
    onCancelEdit: () -> Unit,
    streaming: Boolean,
    onStopGenerating: () -> Unit,
    canSend: Boolean,
    onSend: () -> Unit,
    i18n: NativeI18n,
) {
    val imageTaskListState = rememberLazyListState()

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .then(if (keyboardVisible) Modifier else Modifier.navigationBarsPadding()),
    ) {
        val compactKeyboardComposer = keyboardVisible && mode == ComposerMode.Chat
        val compactImageComposer = mode == ComposerMode.Image && maxWidth < 300.dp
        val composerPadding = when {
            compactKeyboardComposer -> 4.dp
            compactImageComposer -> 6.dp
            else -> 12.dp
        }
        val composerGap = if (compactKeyboardComposer || compactImageComposer) 4.dp else 8.dp
        val stackImageAction = mode == ComposerMode.Image && maxWidth < 260.dp
        val compactImageTaskSelector = mode == ComposerMode.Image && maxWidth < 380.dp

        LaunchedEffect(mode, imageTask, compactImageTaskSelector) {
            if (mode == ComposerMode.Image && !compactImageTaskSelector) {
                imageTaskListState.scrollToItem(ImageTaskMode.entries.indexOf(imageTask).coerceAtLeast(0))
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(composerPadding),
            verticalArrangement = Arrangement.spacedBy(composerGap),
        ) {
            if (!compactKeyboardComposer) {
                SingleChoiceSegmentedButtonRow {
                    ComposerMode.entries.forEachIndexed { index, item ->
                        SegmentedButton(
                            selected = mode == item,
                            onClick = { onModeChange(item) },
                            shape = SegmentedButtonDefaults.itemShape(index, ComposerMode.entries.size),
                        ) {
                            Text(i18n.composerModeTitle(item))
                        }
                    }
                }
            }

            if (mode == ComposerMode.Image) {
                val combineEmptyInpaintPickers = imageTask == ImageTaskMode.Inpaint &&
                    sourceImage == null &&
                    maskImage == null
                if (compactImageTaskSelector) {
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        ImageTaskMode.entries.forEachIndexed { index, item ->
                            SegmentedButton(
                                selected = imageTask == item,
                                onClick = { onImageTaskChange(item) },
                                shape = SegmentedButtonDefaults.itemShape(index, ImageTaskMode.entries.size),
                                modifier = Modifier
                                    .weight(1f)
                                    .semantics {
                                        contentDescription = i18n.imageTaskTitle(item)
                                    },
                            ) {
                                Text(
                                    i18n.imageTaskCompactTitle(item),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                } else {
                    LazyRow(
                        state = imageTaskListState,
                        horizontalArrangement = Arrangement.spacedBy(composerGap),
                    ) {
                        items(ImageTaskMode.entries) { item ->
                            FilterChip(
                                selected = imageTask == item,
                                onClick = { onImageTaskChange(item) },
                                label = { Text(i18n.imageTaskTitle(item)) },
                            )
                        }
                    }
                }
                if (combineEmptyInpaintPickers) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(composerGap),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(
                            onClick = onPickSource,
                            modifier = Modifier
                                .weight(1f)
                                .semantics {
                                    contentDescription = i18n.t("placeholder.sourceImage")
                                },
                        ) {
                            Text(
                                i18n.sourcePickerCompactTitle(),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        OutlinedButton(
                            onClick = onPickMask,
                            modifier = Modifier
                                .weight(1f)
                                .semantics {
                                    contentDescription = i18n.t("placeholder.maskImage")
                                },
                        ) {
                            Text(
                                i18n.maskPickerCompactTitle(),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                } else if (imageTask != ImageTaskMode.Generate) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(composerGap),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(
                            onClick = onPickSource,
                            modifier = if (sourceImage != null) Modifier.weight(1f) else Modifier,
                        ) {
                            Text(
                                sourceImage?.fileName ?: i18n.t("placeholder.sourceImage"),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (sourceImage != null) {
                            TextButton(onClick = onClearSource) {
                                Text(
                                    i18n.t("action.clear"),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
                if (imageTask == ImageTaskMode.Inpaint && !combineEmptyInpaintPickers) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(composerGap),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(
                            onClick = onPickMask,
                            modifier = if (maskImage != null) Modifier.weight(1f) else Modifier,
                        ) {
                            Text(
                                maskImage?.fileName ?: i18n.t("placeholder.maskImage"),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (maskImage != null) {
                            TextButton(onClick = onClearMask) {
                                Text(
                                    i18n.t("action.clear"),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }

            if (editing) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        i18n.t("message.editing"),
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                    TextButton(onClick = onCancelEdit) {
                        Text(i18n.t("action.cancel"))
                    }
                }
            }

            if (stackImageAction) {
                Column(verticalArrangement = Arrangement.spacedBy(composerGap)) {
                    ComposerPromptField(
                        input = input,
                        onInputChange = onInputChange,
                        mode = mode,
                        i18n = i18n,
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(focusRequester),
                    )
                    ComposerSubmitButton(
                        editing = editing,
                        mode = mode,
                        imageTask = imageTask,
                        streaming = streaming,
                        canSend = canSend,
                        onStopGenerating = onStopGenerating,
                        onSend = onSend,
                        i18n = i18n,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                    )
                }
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(composerGap),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    ComposerPromptField(
                        input = input,
                        onInputChange = onInputChange,
                        mode = mode,
                        i18n = i18n,
                        modifier = Modifier
                            .weight(1f)
                            .focusRequester(focusRequester),
                    )
                    ComposerSubmitButton(
                        editing = editing,
                        mode = mode,
                        imageTask = imageTask,
                        streaming = streaming,
                        canSend = canSend,
                        onStopGenerating = onStopGenerating,
                        onSend = onSend,
                        i18n = i18n,
                        modifier = Modifier.widthIn(min = 88.dp, max = 148.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ComposerPromptField(
    input: String,
    onInputChange: (String) -> Unit,
    mode: ComposerMode,
    i18n: NativeI18n,
    modifier: Modifier = Modifier,
) {
    val label = if (mode == ComposerMode.Chat) {
        i18n.t("placeholder.message")
    } else {
        i18n.t("placeholder.imagePrompt")
    }

    OutlinedTextField(
        value = input,
        onValueChange = onInputChange,
        modifier = modifier,
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        minLines = 1,
        maxLines = 5,
    )
}

@Composable
private fun ComposerSubmitButton(
    editing: Boolean,
    mode: ComposerMode,
    imageTask: ImageTaskMode,
    streaming: Boolean,
    canSend: Boolean,
    onStopGenerating: () -> Unit,
    onSend: () -> Unit,
    i18n: NativeI18n,
    modifier: Modifier = Modifier,
) {
    if (streaming) {
        OutlinedButton(
            onClick = onStopGenerating,
            modifier = modifier,
        ) {
            Text(
                i18n.t("action.stopGenerating"),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        return
    }

    Button(
        onClick = onSend,
        enabled = canSend,
        modifier = modifier,
        colors = ButtonDefaults.buttonColors(
            disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ),
    ) {
        Text(
            if (editing) {
                i18n.t("action.send")
            } else if (mode == ComposerMode.Image) {
                i18n.imageSubmitTitle(imageTask)
            } else {
                i18n.t("action.send")
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
