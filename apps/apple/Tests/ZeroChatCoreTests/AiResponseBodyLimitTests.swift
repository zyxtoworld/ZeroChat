import XCTest
@testable import ZeroChatCore

final class AiResponseBodyLimitTests: XCTestCase {
    func testProviderResponseBudgetsMatchTheCrossPlatformContract() {
        XCTAssertEqual(aiProviderErrorResponseMaxBytes, 16_384)
        XCTAssertEqual(aiProviderTextResponseMaxBytes, 8_000_000)
        XCTAssertEqual(aiProviderImageResponseMaxBytes, 32_000_000)
        XCTAssertEqual(aiProviderAudioResponseMaxBytes, 32_000_000)
        XCTAssertEqual(aiProviderStreamResponseMaxBytes, 8_000_000)
    }

    func testResponseByteAccumulatorAcceptsBoundaryAndRejectsOverflow() throws {
        XCTAssertEqual(
            try accumulateResponseBodyBytes(
                currentBytes: 2,
                nextBytes: 2,
                maxBytes: 4,
                label: "AI test response"
            ),
            4
        )

        XCTAssertThrowsError(
            try accumulateResponseBodyBytes(
                currentBytes: 4,
                nextBytes: 1,
                maxBytes: 4,
                label: "AI test response"
            )
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "AI test response exceeded the 4-byte safety limit."
            )
        }
    }

    func testAudioResponseValidationRejectsTextualBodiesEvenWithAudioMime() {
        XCTAssertFalse(
            providerAudioResponseLooksValid(
                Data(#"{"error":"upstream"}"#.utf8),
                contentType: "audio/mpeg"
            )
        )
        XCTAssertFalse(
            providerAudioResponseLooksValid(
                Data("<html>upstream failure</html>".utf8),
                contentType: "application/octet-stream"
            )
        )
        XCTAssertFalse(providerAudioResponseLooksValid(Data("audio-bytes".utf8), contentType: ""))
        XCTAssertTrue(
            providerAudioResponseLooksValid(
                Data([0x49, 0x44, 0x33, 0x04]),
                contentType: "application/octet-stream"
            )
        )
        XCTAssertTrue(
            providerAudioResponseLooksValid(
                Data([0x00, 0x01, 0x02, 0x03]),
                contentType: "audio/mpeg"
            )
        )
    }
}
