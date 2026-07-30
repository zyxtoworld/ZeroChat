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
