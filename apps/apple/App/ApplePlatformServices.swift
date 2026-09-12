import Foundation
import UniformTypeIdentifiers
import ZeroChatCore

#if canImport(CoreSpotlight)
import CoreSpotlight
#endif

#if canImport(UserNotifications)
@preconcurrency import UserNotifications
#endif

func displayConversationTitle(_ conversation: Conversation, _ i18n: NativeI18n) -> String {
    let title = conversation.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return title.isEmpty || i18n.isDefaultConversationTitle(title) ? i18n.t("title.newChat") : title
}

enum AppleHandoffActivity {
    static let activityType = "app.zerochat.client.conversation"
    private static let conversationIdKey = "conversationId"

    static func update(_ activity: NSUserActivity, conversation: Conversation?, i18n: NativeI18n) {
        guard let conversation else {
            activity.invalidate()
            return
        }

        let title = displayConversationTitle(conversation, i18n)
        activity.title = title
        activity.isEligibleForHandoff = true
        activity.isEligibleForSearch = false
        activity.userInfo = [
            conversationIdKey: conversation.id,
            "title": title,
            "providerId": conversation.providerId,
            "model": conversation.model,
        ]
    }

    static func conversationId(from activity: NSUserActivity) -> String? {
        activity.userInfo?[conversationIdKey] as? String
    }
}

#if canImport(CoreSpotlight)
enum AppleSpotlightIndexer {
    private static let domainIdentifier = "app.zerochat.client.conversations"

    static func update(previousIds: Set<String>, snapshot: AppSnapshot, i18n: NativeI18n) {
        guard CSSearchableIndex.isIndexingAvailable() else {
            return
        }

        let currentIds = Set(snapshot.conversations.map(\.id))
        let removedIds = previousIds.subtracting(currentIds).map(spotlightIdentifier)
        if !removedIds.isEmpty {
            CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: removedIds)
        }

        let items = snapshot.conversations.map { conversation in
            let title = displayConversationTitle(conversation, i18n)
            let attributeSet = CSSearchableItemAttributeSet(contentType: .text)
            attributeSet.title = title
            attributeSet.contentDescription = conversation.model
            attributeSet.keywords = [title, conversation.model, conversation.providerId]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }

            let item = CSSearchableItem(
                uniqueIdentifier: spotlightIdentifier(conversation.id),
                domainIdentifier: domainIdentifier,
                attributeSet: attributeSet
            )
            item.expirationDate = .distantFuture
            return item
        }

        CSSearchableIndex.default().indexSearchableItems(items)
    }

    private static func spotlightIdentifier(_ conversationId: String) -> String {
        "zerochat-conversation-\(conversationId)"
    }
}
#endif

enum AppleSharedTextIntake {
    private static let appGroupIdentifier = "group.app.zerochat.client"
    private static let pendingTextKey = "pendingShareText.v1"
    private static let pendingTextCreatedAtKey = "pendingShareTextCreatedAt.v1"

    static func isShareOpenURL(_ url: URL) -> Bool {
        url.scheme == "zerochat" && url.host == "share"
    }

    static func consumePendingText() -> String? {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
            return nil
        }

        let text = defaults.string(forKey: pendingTextKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let createdAt = (defaults.object(forKey: pendingTextCreatedAtKey) as? NSNumber)?.doubleValue
        defaults.removeObject(forKey: pendingTextKey)
        defaults.removeObject(forKey: pendingTextCreatedAtKey)
        defaults.synchronize()

        guard let text, !text.isEmpty,
              SharePayloadFreshness.isFresh(createdAt: createdAt) else {
            return nil
        }
        return text
    }
}

enum AppleQuickAskRoute {
    static func isQuickAskOpenURL(_ url: URL) -> Bool {
        url.scheme == "zerochat" && url.host == "quick-ask"
    }
}

#if canImport(UserNotifications)
enum AppleSyncNotificationCenter {
    static func notifySyncComplete(title: String, body: String) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .notDetermined:
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { granted, _ in
                    if granted {
                        post(title: title, body: body)
                    }
                }
            case .authorized, .provisional:
                post(title: title, body: body)
            default:
                break
            }
        }
    }

    private static func post(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body

        let request = UNNotificationRequest(
            identifier: "zerochat-sync-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
}
#endif
