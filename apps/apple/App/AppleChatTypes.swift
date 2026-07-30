import Foundation
import ZeroChatCore

enum ComposerMode: String, Hashable {
    case chat
    case image
}

enum ImageTaskMode: String, Hashable {
    case generate
    case edit
    case inpaint
}

struct PreparedImageRequest {
    enum Kind {
        case generate
        case edit(source: ImageUpload)
        case inpaint(source: ImageUpload, mask: ImageUpload)
    }

    let provider: ProviderConfig
    let imageModel: String
    let responsesModel: String
    let prompt: String
    let kind: Kind
}

enum ImageUploadTarget {
    case source
    case mask
}

struct PendingAutoSync {
    var snapshot: AppSnapshot
    var firstSyncStrategy: FirstSyncStrategy
}

enum BackupImportError: LocalizedError {
    case invalidFormat

    var errorDescription: String? {
        switch self {
        case .invalidFormat:
            return "File format is invalid"
        }
    }
}

enum AppError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        if case let .message(value) = self {
            return value
        }
        return nil
    }
}
