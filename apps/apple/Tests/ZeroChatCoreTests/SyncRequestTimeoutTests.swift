import Foundation
import XCTest
@testable import ZeroChatCore

final class SyncRequestTimeoutTests: XCTestCase {
    func testSyncSessionCapsRequestAndResourceTransfersAtSixtySeconds() {
        let sourceConfiguration = URLSessionConfiguration.ephemeral
        sourceConfiguration.timeoutIntervalForRequest = 300
        sourceConfiguration.timeoutIntervalForResource = 900
        let sourceSession = URLSession(configuration: sourceConfiguration)
        defer { sourceSession.invalidateAndCancel() }

        let configuration = syncURLSessionConfiguration(from: sourceSession)

        XCTAssertEqual(
            configuration.timeoutIntervalForRequest,
            syncRequestTimeoutSeconds,
            accuracy: 0.001
        )
        XCTAssertEqual(
            configuration.timeoutIntervalForResource,
            syncRequestTimeoutSeconds,
            accuracy: 0.001
        )
        XCTAssertNil(configuration.httpCookieStorage)
        XCTAssertFalse(configuration.httpShouldSetCookies)
        XCTAssertNil(configuration.urlCredentialStorage)
        XCTAssertNil(configuration.urlCache)
        XCTAssertEqual(
            configuration.requestCachePolicy,
            .reloadIgnoringLocalAndRemoteCacheData
        )
    }
}
