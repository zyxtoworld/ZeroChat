import SwiftUI
import Foundation
import UniformTypeIdentifiers
import ZeroChatCore
#if os(iOS) || os(tvOS) || os(visionOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

func dangerText(_ prefix: String, _ i18n: NativeI18n) -> String {
    ["body", "detail1", "detail2", "detail3", "detail4"]
        .map { i18n.t("\(prefix).\($0)") }
        .filter { !$0.hasPrefix(prefix) }
        .joined(separator: "\n\n")
}

extension SyncConfig {
    func isFirstSyncConflict(_ i18n: NativeI18n) -> Bool {
        let status = lastSyncStatus?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return status == "Local and cloud both have data. Choose local, cloud, or merge before syncing." ||
            i18n.syncStatusMessage(status) == i18n.t("error.firstSyncConflict")
    }
}

struct ZeroChatBackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }

    var data = Data()

    init(data: Data = Data()) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

func backupFileName() -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return "zerochat-encrypted-\(formatter.string(from: Date())).json"
}

func copyToPasteboard(_ text: String) {
#if os(iOS) || os(tvOS) || os(visionOS)
    UIPasteboard.general.string = text
#elseif os(macOS)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
#endif
}
