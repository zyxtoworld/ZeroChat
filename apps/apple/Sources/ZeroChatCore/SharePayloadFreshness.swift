import Foundation

public enum SharePayloadFreshness {
    public static let maximumAge: TimeInterval = 5 * 60
    public static let futureClockSkewTolerance: TimeInterval = 30

    public static func isFresh(
        createdAt: TimeInterval?,
        now: TimeInterval = Date().timeIntervalSince1970
    ) -> Bool {
        guard let createdAt, createdAt.isFinite, now.isFinite else {
            return false
        }

        let age = now - createdAt
        return age >= -futureClockSkewTolerance && age <= maximumAge
    }
}
