import XCTest
@testable import ZeroChatCore

final class SyncIncrementalCancellationTests: XCTestCase {
    private enum TestFailure: Error, Equatable {
        case upload
    }

    func testIncrementalUploadCancellationSkipsRollbackAndPreservesSignal() async {
        var rollbackCalls = 0

        do {
            let _: Void = try await runWithIncrementalRollbackOnFailure(
                operation: { throw CancellationError() },
                rollback: { rollbackCalls += 1 }
            )
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            XCTAssertEqual(rollbackCalls, 0)
        } catch {
            XCTFail("Expected CancellationError, received \(error)")
        }
    }

    func testIncrementalUploadOrdinaryFailureRollsBackAndPreservesError() async {
        var rollbackCalls = 0

        // This helper is intentionally limited to object writes that happen before
        // publishing starts. Head-write failures have separate reachability rules.
        do {
            let _: Void = try await runWithIncrementalRollbackOnFailure(
                operation: { throw TestFailure.upload },
                rollback: { rollbackCalls += 1 }
            )
            XCTFail("Expected upload failure")
        } catch let error as TestFailure {
            XCTAssertEqual(error, .upload)
            XCTAssertEqual(rollbackCalls, 1)
        } catch {
            XCTFail("Expected TestFailure.upload, received \(error)")
        }
    }
}
