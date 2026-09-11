import SwiftUI
import Foundation
import UniformTypeIdentifiers
import ZeroChatCore

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

private func copyMessageToPasteboard(_ text: String) {
#if os(iOS) || os(tvOS) || os(visionOS)
    UIPasteboard.general.string = text
#elseif os(macOS)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
#endif
}

struct MessageBubble: View {
    let message: ChatMessage
    let i18n: NativeI18n
    let isSpeaking: Bool
    let speak: () -> Void
    let stopSpeaking: () -> Void
    let edit: () -> Void
    let regenerate: () -> Void
    let delete: () -> Void

    var body: some View {
        let isStreamingAssistant = message.role == .assistant && message.status == "streaming"
        let assistantRerunAction = message.status == "error" ? i18n.t("button.retry") : i18n.t("action.regenerate")
        let content = (message.content.isEmpty && isStreamingAssistant) ? i18n.t("message.generating") : message.content
        let copyableContent = content
        let displayContent = isStreamingAssistant ? "\(content)|" : content

        HStack {
            if message.role == .user {
                Spacer(minLength: 32)
            }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
                Text(displayContent)
                    .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)

                ForEach(message.attachments ?? []) { attachment in
                    AttachmentView(attachment: attachment, i18n: i18n)
                }

                if let error = message.error, !error.isEmpty {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(message.role == .user ? messageForeground.opacity(0.9) : ZeroChatTheme.danger)
                }

                Text(Date(milliseconds: message.createdAt).formatted(date: .numeric, time: .shortened))
                    .font(.caption2)
                    .foregroundStyle(message.role == .user ? messageForeground.opacity(0.75) : .secondary)
            }
            .foregroundStyle(messageForeground)
            .padding(12)
            .background(messageBackground)
            .clipShape(RoundedRectangle(cornerRadius: ZeroChatTheme.radiusLarge))
            .contentShape(RoundedRectangle(cornerRadius: ZeroChatTheme.radiusLarge))
            .contextMenu {
                messageContextMenu(copyableContent: copyableContent)
            } preview: {
                MessagePreviewCard(message: message, i18n: i18n)
            }
            .accessibilityAction(named: Text(i18n.t("button.copy"))) {
                copyMessageToPasteboard(copyableContent)
            }
            .accessibilityAction(
                named: Text(message.role == .user ? i18n.t("action.editResend") : assistantRerunAction)
            ) {
                if message.role == .user {
                    edit()
                } else {
                    regenerate()
                }
            }
            .accessibilityAction(named: Text(i18n.t("action.delete"))) {
                delete()
            }
            .frame(maxWidth: 720, alignment: message.role == .user ? .trailing : .leading)

            if message.role != .user {
                Spacer(minLength: 32)
            }
        }
    }

    @ViewBuilder
    private func messageContextMenu(copyableContent: String) -> some View {
        Button(i18n.t("button.copy")) {
            copyMessageToPasteboard(copyableContent)
        }
        if message.role == .user {
            Button(i18n.t("action.editResend"), action: edit)
        } else {
            let canSpeak = !copyableContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                message.status != "streaming"
            if !copyableContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ShareLink(item: copyableContent) {
                    Label(i18n.t("action.share"), systemImage: "square.and.arrow.up")
                }
            }
            if isSpeaking || canSpeak {
                Button(isSpeaking ? i18n.t("button.stopSpeaking") : i18n.t("button.speakMessage")) {
                    if isSpeaking {
                        stopSpeaking()
                    } else {
                        speak()
                    }
                }
            }
            Button(message.status == "error" ? i18n.t("button.retry") : i18n.t("action.regenerate"), action: regenerate)
        }
        Button(i18n.t("action.delete"), role: .destructive, action: delete)
    }

    private var messageBackground: Color {
        if message.status == "error" {
            return ZeroChatTheme.danger.opacity(0.15)
        }

        // Current design: user bubble is solid accent with contrast text; assistant uses an elevated card.
        return message.role == .user ? ZeroChatTheme.accent : ZeroChatTheme.bubbleAi
    }

    private var messageForeground: Color {
        message.role == .user ? ZeroChatTheme.bubbleUserText : .primary
    }
}

private struct MessagePreviewCard: View {
    let message: ChatMessage
    let i18n: NativeI18n

    var body: some View {
        let isStreamingAssistant = message.role == .assistant && message.status == "streaming"
        let content = (message.content.isEmpty && isStreamingAssistant) ? i18n.t("message.generating") : message.content

        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: message.role == .user ? "person.crop.circle.fill" : "sparkles")
                    .foregroundStyle(message.role == .user ? ZeroChatTheme.accent : Color.secondary)
                    .accessibilityHidden(true)
                Text(Date(milliseconds: message.createdAt).formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(content)
                .font(.body)
                .lineLimit(12)
                .frame(maxWidth: .infinity, alignment: .leading)

            ForEach((message.attachments ?? []).prefix(2)) { attachment in
                AttachmentPreview(attachment: attachment, i18n: i18n)
            }

            if let error = message.error, !error.isEmpty {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(3)
            }
        }
        .padding(14)
        .frame(minWidth: 260, idealWidth: 320, maxWidth: 360, alignment: .leading)
    }
}

private struct AttachmentPreview: View {
    let attachment: MessageAttachment
    let i18n: NativeI18n

    var body: some View {
        if let dataUrl = safeImageAttachmentDataURL(attachment.dataUrl)?.dataURL,
           let image = platformImage(dataUrl: dataUrl) {
            PlatformImageView(image: image)
                .scaledToFit()
                .frame(maxHeight: 220)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        } else if let alt = attachment.alt, !alt.isEmpty {
            Text(alt)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        } else {
            Text(i18n.t("message.imageAttached"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct AttachmentView: View {
    let attachment: MessageAttachment
    let i18n: NativeI18n
    @State private var imageExportPresented = false
    @State private var imageExportFailed = false
    @State private var imageExportDocument = ZeroChatImageDocument()
    @State private var imageExportContentType: UTType = .png
    @State private var imageExportFileName = "zerochat-image.png"

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let safeData = safeImageAttachmentDataURL(attachment.dataUrl),
               let image = platformImage(dataUrl: safeData.dataURL) {
                PlatformImageView(image: image)
                    .scaledToFit()
                    .frame(maxHeight: 360)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Button {
                    beginImageExport(dataURL: safeData.dataURL, mimeType: safeData.mimeType)
                } label: {
                    Label(i18n.t("action.downloadImage"), systemImage: "square.and.arrow.down")
                }
            } else if let url = safeRemoteImageAttachmentURL(attachment.url) {
                Link(i18n.t("action.openGeneratedImage"), destination: url)
            } else {
                Text(i18n.t("message.imageAttached"))
                    .foregroundStyle(.secondary)
            }

            if imageExportFailed {
                Text(i18n.t("notice.imageDownloadFailed"))
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .fileExporter(
            isPresented: $imageExportPresented,
            document: imageExportDocument,
            contentType: imageExportContentType,
            defaultFilename: imageExportFileName
        ) { result in
            guard case .failure(let error) = result else { return }
            if let cocoaError = error as? CocoaError, cocoaError.code == .userCancelled {
                return
            }
            imageExportFailed = true
        }
    }

    private func beginImageExport(dataURL: String, mimeType: String) {
        guard let data = decodedImageData(dataURL: dataURL) else {
            imageExportFailed = true
            return
        }

        imageExportDocument = ZeroChatImageDocument(data: data)
        imageExportContentType = UTType(mimeType: mimeType) ?? .data
        let extensionName = imageExportContentType.preferredFilenameExtension ?? "img"
        imageExportFileName = "zerochat-image.\(extensionName)"
        imageExportFailed = false
        imageExportPresented = true
    }
}

#if os(iOS)
private typealias PlatformImage = UIImage
private struct PlatformImageView: View {
    let image: PlatformImage
    var body: some View { Image(uiImage: image).resizable() }
}
#elseif os(macOS)
private typealias PlatformImage = NSImage
private struct PlatformImageView: View {
    let image: PlatformImage
    var body: some View { Image(nsImage: image).resizable() }
}
#endif

private func platformImage(dataUrl: String) -> PlatformImage? {
    guard let data = decodedImageData(dataURL: dataUrl) else { return nil }
    return PlatformImage(data: data)
}

private func decodedImageData(dataURL: String) -> Data? {
    guard let range = dataURL.range(of: "base64,") else { return nil }
    return Data(base64Encoded: String(dataURL[range.upperBound...]))
}
