import Foundation
import Testing
@testable import ZeroChatCore

@Test func sharePayloadFreshnessAcceptsOnlyRecentTimestamps() {
    let now: TimeInterval = 10_000

    #expect(SharePayloadFreshness.isFresh(createdAt: now, now: now))
    #expect(SharePayloadFreshness.isFresh(createdAt: now - SharePayloadFreshness.maximumAge, now: now))
    #expect(!SharePayloadFreshness.isFresh(createdAt: now - SharePayloadFreshness.maximumAge - 0.001, now: now))
    #expect(!SharePayloadFreshness.isFresh(createdAt: nil, now: now))
}

@Test func sharePayloadFreshnessRejectsImplausibleFutureTimestamps() {
    let now: TimeInterval = 10_000

    #expect(SharePayloadFreshness.isFresh(
        createdAt: now + SharePayloadFreshness.futureClockSkewTolerance,
        now: now
    ))
    #expect(!SharePayloadFreshness.isFresh(
        createdAt: now + SharePayloadFreshness.futureClockSkewTolerance + 0.001,
        now: now
    ))
}
