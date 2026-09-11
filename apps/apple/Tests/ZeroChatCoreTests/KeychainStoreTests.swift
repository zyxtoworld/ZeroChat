import Foundation
import Security
import Testing
@testable import ZeroChatCore

@Test func keychainSetUpdatesExistingItemWithoutDeletingOrAdding() throws {
    var calls: [String] = []

    try performKeychainSet(
        "secret",
        update: { _ in calls.append("update"); return errSecSuccess },
        add: { _ in calls.append("add"); return errSecSuccess },
        delete: { calls.append("delete"); return errSecSuccess }
    )

    #expect(calls == ["update"])
}

@Test func keychainSetAddsOnlyAfterUpdateReportsMissingItem() throws {
    var calls: [String] = []

    try performKeychainSet(
        "secret",
        update: { _ in calls.append("update"); return errSecItemNotFound },
        add: { _ in calls.append("add"); return errSecSuccess },
        delete: { calls.append("delete"); return errSecSuccess }
    )

    #expect(calls == ["update", "add"])
}

@Test func keychainSetDoesNotClaimSuccessWhenUpdateFails() {
    var addCalled = false
    var didThrow = false

    do {
        try performKeychainSet(
            "secret",
            update: { _ in errSecAuthFailed },
            add: { _ in addCalled = true; return errSecSuccess },
            delete: { errSecSuccess }
        )
    } catch {
        didThrow = true
    }

    #expect(didThrow)
    #expect(!addCalled)
}

@Test func clearingKeychainValueUsesDeleteOnly() throws {
    var calls: [String] = []

    try performKeychainSet(
        "   ",
        update: { _ in calls.append("update"); return errSecSuccess },
        add: { _ in calls.append("add"); return errSecSuccess },
        delete: { calls.append("delete"); return errSecItemNotFound }
    )

    #expect(calls == ["delete"])
}

@Test func keychainReadReturnsMissingOnlyForItemNotFound() throws {
    let missing = try decodeKeychainRead(status: errSecItemNotFound, item: nil)
    let value = try decodeKeychainRead(
        status: errSecSuccess,
        item: Data("secret".utf8) as CFData
    )

    #expect(missing == nil)
    #expect(value == "secret")
}

@Test func keychainReadPropagatesNonMissingStatus() {
    var capturedStatus: OSStatus?

    do {
        _ = try decodeKeychainRead(status: errSecAuthFailed, item: nil)
    } catch KeychainError.status(let status) {
        capturedStatus = status
    } catch {
        Issue.record("Unexpected Keychain read error: \(error)")
    }

    #expect(capturedStatus == errSecAuthFailed)
}
