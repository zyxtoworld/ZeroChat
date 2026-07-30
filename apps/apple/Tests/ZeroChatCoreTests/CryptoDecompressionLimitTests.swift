import Foundation
import XCTest
@testable import ZeroChatCore

final class CryptoDecompressionLimitTests: XCTestCase {
    private let compressed12345 = Data([
        31, 139, 8, 0, 0, 0, 0, 0, 0, 10, 51, 52, 50,
        54, 49, 5, 0, 28, 58, 245, 203, 5, 0, 0, 0
    ])

    func testDecompressedSyncJSONBudgetMatchesTheCrossPlatformContract() {
        XCTAssertEqual(maxDecompressedSyncJSONBytes, 32_000_000)
    }

    func testGzipDecompressionAcceptsBoundaryAndRejectsOverflowBeforeAppend() throws {
        let payload = Data("12345".utf8)

        XCTAssertEqual(
            try decompressSyncJSONPayload(compressed12345, compression: "gzip", maxBytes: payload.count),
            payload
        )
        XCTAssertThrowsError(
            try decompressSyncJSONPayload(compressed12345, compression: "gzip", maxBytes: payload.count - 1)
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Encrypted sync data exceeded the 4-byte decompression safety limit."
            )
        }
    }

    func testUncompressedAuthenticatedObjectsUseTheSameBudget() throws {
        let payload = Data("12345".utf8)

        XCTAssertEqual(
            try decompressSyncJSONPayload(payload, compression: "none", maxBytes: payload.count),
            payload
        )
        XCTAssertThrowsError(
            try decompressSyncJSONPayload(payload, compression: "none", maxBytes: payload.count - 1)
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Encrypted sync data exceeded the 4-byte decompression safety limit."
            )
        }
    }
}
