import Foundation
import XCTest
@testable import ZeroChatCore

final class AiImageFallbackPolicyTests: XCTestCase {
    func testResponsesModelFallbackOnlyAdvancesForValidationStatus() {
        XCTAssertTrue(
            shouldTryNextResponsesImageModel(
                after: AiError.httpFailed(statusCode: 400, message: "invalid request")
            )
        )
        XCTAssertTrue(
            shouldTryNextResponsesImageModel(
                after: AiError.httpFailed(statusCode: 422, message: "invalid model")
            )
        )

        for statusCode in 100...599 where statusCode != 400 && statusCode != 422 {
            XCTAssertFalse(
                shouldTryNextResponsesImageModel(
                    after: AiError.httpFailed(statusCode: statusCode, message: "stop")
                ),
                "HTTP \(statusCode) must stop Responses image model fallback"
            )
        }
    }

    func testResponsesModelFallbackStopsForNonHTTPFailures() {
        XCTAssertFalse(shouldTryNextResponsesImageModel(after: URLError(.timedOut)))
        XCTAssertFalse(shouldTryNextResponsesImageModel(after: CancellationError()))
        XCTAssertFalse(shouldTryNextResponsesImageModel(after: AiError.imageResponseEmpty))
        XCTAssertFalse(shouldTryNextResponsesImageModel(after: CocoaError(.fileReadCorruptFile)))
        XCTAssertFalse(shouldTryNextResponsesImageModel(after: DecodingError.dataCorrupted(
            .init(codingPath: [], debugDescription: "invalid response")
        )))
    }

    func testDirectImageRouteFallbackRemainsExplicit() {
        for statusCode in [404, 405] + Array(500...599) {
            XCTAssertTrue(
                shouldTryResponsesImageFallback(statusCode: statusCode),
                "HTTP \(statusCode) must retain the direct-route compatibility fallback"
            )
        }

        for statusCode in [400, 401, 403, 408, 409, 422, 425, 429, 499, 600] {
            XCTAssertFalse(
                shouldTryResponsesImageFallback(statusCode: statusCode),
                "HTTP \(statusCode) must not trigger direct-route fallback"
            )
        }
    }

    func testHTTPFailureRetainsNumericStatus() {
        let error = AiError.httpFailed(statusCode: 429, message: "rate limited")

        guard case let .httpFailed(statusCode, message) = error else {
            XCTFail("Expected typed HTTP failure")
            return
        }

        XCTAssertEqual(statusCode, 429)
        XCTAssertEqual(message, "rate limited")
        XCTAssertTrue(error.localizedDescription.contains("HTTP 429"))
    }
}
