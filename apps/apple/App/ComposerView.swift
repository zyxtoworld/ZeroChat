import SwiftUI

struct ComposerView: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n
    let activeConversationId: String?
    @FocusState.Binding var promptFocused: Bool
    let pickSourceImage: () -> Void
    let pickMaskImage: () -> Void

    private var promptField: some View {
        TextField(
            model.composerMode == .chat ? i18n.t("placeholder.message") : i18n.t("placeholder.imagePrompt"),
            text: $model.input,
            axis: .vertical
        )
        .textFieldStyle(.roundedBorder)
        .focused($promptFocused)
        .lineLimit(1...6)
    }

    private var sendButton: some View {
        Button {
            if model.isChatStreaming {
                model.stopGenerating()
            } else {
                _ = model.sendCurrentInput(conversationId: activeConversationId)
            }
        } label: {
            Text(model.sendButtonTitle(i18n))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.return, modifiers: .command)
        .accessibilityHint("Cmd+Enter")
        .disabled(!model.isChatStreaming && !model.canSubmitCurrentInput(conversationId: activeConversationId))
    }

    var body: some View {
        VStack(spacing: 8) {
            Picker(i18n.t("field.composeMode"), selection: $model.composerMode) {
                Text(i18n.t("mode.chat")).tag(ComposerMode.chat)
                Text(i18n.t("mode.image")).tag(ComposerMode.image)
            }
            .pickerStyle(.segmented)

            if model.composerMode == .image {
                Picker(i18n.t("field.imageMode"), selection: $model.imageTaskMode) {
                    Text(i18n.t("mode.imageGenerateShort"))
                        .tag(ImageTaskMode.generate)
                        .accessibilityLabel(i18n.t("mode.imageGenerate"))
                    Text(i18n.t("mode.imageEditShort"))
                        .tag(ImageTaskMode.edit)
                        .accessibilityLabel(i18n.t("mode.imageEdit"))
                    Text(i18n.t("mode.imageInpaintShort"))
                        .tag(ImageTaskMode.inpaint)
                        .accessibilityLabel(i18n.t("mode.imageInpaint"))
                }
                .pickerStyle(.segmented)

                VStack(spacing: 6) {
                    if model.imageTaskMode != .generate {
                        ImagePickerRow(
                            title: model.sourceImageName ?? i18n.t("placeholder.sourceImage"),
                            clearTitle: i18n.t("action.clear"),
                            hasSelection: model.sourceImageName != nil,
                            onPick: pickSourceImage,
                            onClear: model.clearSourceImage
                        )
                    }
                    if model.imageTaskMode == .inpaint {
                        ImagePickerRow(
                            title: model.maskImageName ?? i18n.t("placeholder.maskImage"),
                            clearTitle: i18n.t("action.clear"),
                            hasSelection: model.maskImageName != nil,
                            onPick: pickMaskImage,
                            onClear: model.clearMaskImage
                        )
                    }
                }
            }

            if model.editingMessageId != nil {
                HStack {
                    Text(i18n.t("message.editing"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button(i18n.t("action.cancel")) { model.cancelEdit() }
                }
            }

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .bottom) {
                    promptField
                    sendButton
                }

                VStack(spacing: 8) {
                    promptField
                    sendButton
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding()
        .background(.bar)
    }
}

private struct ImagePickerRow: View {
    let title: String
    let clearTitle: String
    let hasSelection: Bool
    let onPick: () -> Void
    let onClear: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onPick) {
                Text(title)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.bordered)

            if hasSelection {
                Button(clearTitle, action: onClear)
                    .buttonStyle(.bordered)
                    .lineLimit(1)
            }
        }
    }
}
