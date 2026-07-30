import Foundation
import Testing
@testable import ZeroChatCore

@Test func localFileBudgetsMatchTheCrossPlatformContract() {
    #expect(maxEncryptedBackupFileBytes == 50_000_000)
    #expect(maxSkillFileBytes == 2_000_000)
    #expect(maxImageFileBytes == 20_000_000)
    #expect(maxLocalSnapshotFileBytes == 64_000_000)
}

@Test func boundedLocalFileReaderAcceptsBoundaryAndRejectsOverflow() throws {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-local-file-limit-\(UUID().uuidString)")
    let payload = Data("12345".utf8)
    try payload.write(to: url, options: .atomic)
    defer { try? FileManager.default.removeItem(at: url) }

    #expect(try readBoundedLocalFileData(at: url, maxBytes: payload.count) == payload)
    #expect(throws: LocalFileReadError.tooLarge(maxBytes: payload.count - 1)) {
        try readBoundedLocalFileData(at: url, maxBytes: payload.count - 1)
    }
}

@Test func boundedLocalFileReaderRejectsInvalidLimits() throws {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-local-file-invalid-limit-\(UUID().uuidString)")
    try Data().write(to: url, options: .atomic)
    defer { try? FileManager.default.removeItem(at: url) }

    #expect(throws: LocalFileReadError.invalidLimit) {
        try readBoundedLocalFileData(at: url, maxBytes: -1)
    }
}

@Test func byteCountCheckKeepsExportsInsideTheImportBudget() throws {
    try assertLocalFileByteCount(4, maxBytes: 4)
    #expect(throws: LocalFileReadError.tooLarge(maxBytes: 4)) {
        try assertLocalFileByteCount(5, maxBytes: 4)
    }
}
