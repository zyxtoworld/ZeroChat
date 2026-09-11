import XCTest
@testable import ZeroChatCore

final class SyncIncrementalAttachmentTests: XCTestCase {
    func testAttachmentFingerprintMatchesCrossPlatformVector() throws {
        XCTAssertEqual(
            try attachmentChunkFingerprint(
                conversationId: "conversation-1",
                messageId: "message-1",
                attachmentId: "attachment-1",
                index: 0,
                content: "data:image/png;base64,iVBORw0KGgo="
            ),
            "64631e8acc0858a7da34a542e62b9df48525a1b6ae53d2529a0bff177ee6c749"
        )
    }

    func testAttachmentContentUsesBoundedChunks() {
        let dataURL = "data:image/png;base64," + String(repeating: "A", count: 1_500_018)
        let parts = attachmentContentParts(dataURL)

        XCTAssertEqual(parts.count, 2)
        XCTAssertEqual(parts.joined(), dataURL)
    }

    func testManifestLookupRejectsDuplicateKeys() {
        XCTAssertThrowsError(
            try uniqueIncrementalManifestDictionary(
                ["first", "second"],
                keyedBy: { _ in "duplicate" }
            )
        ) { error in
            guard let syncError = error as? SyncError,
                  case .badIncrementalManifest = syncError else {
                XCTFail("Expected badIncrementalManifest, got \(error)")
                return
            }
        }
    }

    func testIncrementalAttachmentAssemblyRejectsOversizedDataURLBeforeAppending() throws {
        XCTAssertEqual(
            try nextIncrementalAttachmentDataURLByteCount(
                currentBytes: maxImageAttachmentDataURLBytes - 2,
                nextContent: "AA"
            ),
            maxImageAttachmentDataURLBytes
        )

        XCTAssertThrowsError(
            try nextIncrementalAttachmentDataURLByteCount(
                currentBytes: maxImageAttachmentDataURLBytes - 1,
                nextContent: "AA"
            )
        ) { error in
            guard let syncError = error as? SyncError,
                  case .badMessageChunk = syncError else {
                XCTFail("Expected badMessageChunk, got \(error)")
                return
            }
        }
    }
}
