import Foundation
import ZeroChatCore

@MainActor
extension ZeroChatViewModel {
    func updateSpotlightIndex(previousIds: Set<String>, snapshot: AppSnapshot) {
#if canImport(CoreSpotlight)
        AppleSpotlightIndexer.update(
            previousIds: previousIds,
            snapshot: snapshot,
            i18n: NativeI18n(mode: snapshot.preferences.language)
        )
#endif
    }
}
