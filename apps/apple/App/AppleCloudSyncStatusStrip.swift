import SwiftUI
import ZeroChatCore

struct AppleCloudSyncStatusStrip: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n
    let openSyncSettings: () -> Void
    @State private var syncNowRunning = false

    private var canSyncNow: Bool {
        model.snapshot.sync.mode != "local" && model.manualSyncBlockedMessage() == nil
    }

    var body: some View {
        let localMode = model.snapshot.sync.mode == "local"
        let actionTitle = localMode ? i18n.t("action.startCloudSync") : i18n.t("button.syncNow")
        let blockedMessage = model.manualSyncBlockedMessage()

        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: cloudSyncSystemImage(model.snapshot.sync.mode))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(i18n.t("setting.sync"))
                        .font(.headline)
                    Text(model.cloudSyncSummary(i18n))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            HStack(spacing: 8) {
                Button {
                    if canSyncNow {
                        syncNowRunning = true
                        Task {
                            await model.pullToRefreshSync()
                            await MainActor.run {
                                syncNowRunning = false
                            }
                        }
                    } else {
                        openSyncSettings()
                    }
                } label: {
                    Label(actionTitle, systemImage: localMode ? "cloud.badge.plus" : "arrow.clockwise")
                        .lineLimit(1)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!localMode && (syncNowRunning || !canSyncNow))

                Button {
                    openSyncSettings()
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .buttonStyle(.bordered)
                .accessibilityLabel(i18n.t("setting.sync"))
            }

            if !localMode, !canSyncNow, let blockedMessage {
                Text(blockedMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func cloudSyncSystemImage(_ mode: String) -> String {
        switch mode {
        case "cloudflare":
            return "cloud.fill"
        case "gist":
            return "arrow.triangle.branch"
        default:
            return "externaldrive"
        }
    }
}
