import Foundation
import ZeroChatCore

enum AppleImageRequestPreflightResult {
    case ready(PreparedImageRequest)
    case blocked(AppNotice)
}

func applePrepareImageRequest(
    isGenerating: Bool,
    provider: ProviderConfig?,
    providerKeyMissing: Bool,
    imageModel: String,
    responsesModel: String,
    input: String,
    imageTaskMode: ImageTaskMode,
    sourceImage: ImageUpload?,
    maskImage: ImageUpload?,
    i18n: NativeI18n
) -> AppleImageRequestPreflightResult {
    guard !isGenerating else {
        return .blocked(AppNotice(message: i18n.t("message.generating"), kind: .warning))
    }
    guard let provider else {
        return .blocked(AppNotice(message: i18n.t("message.noEnabledProvider"), kind: .warning))
    }
    guard provider.kind != .anthropic else {
        return .blocked(AppNotice(message: i18n.t("message.imageProviderRequired"), kind: .warning))
    }
    guard !providerKeyMissing else {
        return .blocked(AppNotice(message: i18n.t("error.providerKeyRequired"), kind: .warning))
    }
    guard !imageModel.isEmpty else {
        return .blocked(AppNotice(message: i18n.t("message.imageModelRequired"), kind: .warning))
    }

    let prompt = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !prompt.isEmpty else {
        return .blocked(AppNotice(message: i18n.t("message.imagePromptRequired"), kind: .warning))
    }

    let kind: PreparedImageRequest.Kind
    switch imageTaskMode {
    case .generate:
        kind = .generate
    case .edit:
        guard let sourceImage else {
            return .blocked(AppNotice(message: i18n.t("message.sourceImageRequired"), kind: .warning))
        }
        kind = .edit(source: sourceImage)
    case .inpaint:
        guard let sourceImage else {
            return .blocked(AppNotice(message: i18n.t("message.sourceImageRequired"), kind: .warning))
        }
        guard let maskImage else {
            return .blocked(AppNotice(message: i18n.t("message.maskImageRequired"), kind: .warning))
        }
        kind = .inpaint(source: sourceImage, mask: maskImage)
    }

    return .ready(PreparedImageRequest(
        provider: provider,
        imageModel: imageModel,
        responsesModel: responsesModel,
        prompt: prompt,
        kind: kind
    ))
}
