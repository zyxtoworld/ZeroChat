import SwiftUI
import Foundation
import ZeroChatCore

struct ProviderEditor: View {
    @ObservedObject var model: ZeroChatViewModel
    let provider: ProviderConfig
    let i18n: NativeI18n
    @State private var connectivityTask: Task<Void, Never>?
    @State private var connectivityRequestId: UUID?
    @State private var isDeletingProvider = false

    var body: some View {
        Section(providerDisplayName(provider, i18n)) {
            TextField(
                i18n.t("field.name"),
                text: Binding(
                    get: { providerDisplayName(provider, i18n) },
                    set: { value in
                        setProvider { item in
                            item.name = value
                        }
                    }
                )
            )
            Text(i18n.t("settings.providerNameHint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Toggle(i18n.t("field.enabled"), isOn: Binding(
                get: { provider.enabled },
                set: { value in
                    setProviderEnabled(value)
                }
            ))
            Text(protocolLabel)
                .foregroundStyle(.secondary)
            Text(i18n.t("settings.interfaceTypeNoteCustom"))
                .foregroundStyle(.secondary)
            ProviderCapabilitySummary(provider: provider, i18n: i18n)
            Toggle(i18n.t("field.clientProvidesKey"), isOn: Binding(
                get: { provider.needsApiKey },
                set: { value in
                    setProvider { item in
                        item.needsApiKey = value
                    }
                }
            ))
            Text(i18n.t("settings.providerKeyToggleNote"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            if provider.needsApiKey {
                SecureField(i18n.t("field.providerKey"), text: Binding(
                    get: { model.providerKey(provider.id) },
                    set: { model.setProviderKey(provider.id, $0) }
                ))
                Text(i18n.t("settings.providerKeyHint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            TextField(i18n.t("field.baseUrl"), text: binding(\.baseUrl))
            Text(i18n.t("settings.providerBaseUrlHint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            TextField(i18n.t("field.proxyUrl"), text: bindingOptional(\.proxyUrl))
            Text(i18n.t("settings.proxyUrlNote"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Toggle(i18n.t("field.clientDirectRequest"), isOn: Binding(
                get: { provider.clientRequestMode == true },
                set: { value in
                    setProvider { item in
                        item.clientRequestMode = value ? true : nil
                    }
                }
            ))
            Text(i18n.t("settings.directRequestNote"))
                .foregroundStyle(.secondary)
            Button {
                startConnectivityCheck()
            } label: {
                Label(i18n.t("button.checkConnectivity"), systemImage: "checkmark.circle")
            }
            .disabled(connectivityRequestId != nil)
            Text(i18n.t("settings.providerConnectivityPrivacy"))
                .foregroundStyle(.secondary)
            Button(i18n.t("button.deleteProvider"), role: .destructive) {
                guard !isDeletingProvider else { return }
                isDeletingProvider = true
                Task {
                    defer { isDeletingProvider = false }
                    await model.deleteProviderTransaction(provider.id)
                }
            }
            .disabled(isDeletingProvider)
        }
        .onDisappear(perform: cancelConnectivityCheck)
    }

    private var protocolLabel: String {
        switch provider.kind {
        case .openAICompatible: i18n.t("provider.protocol.openaiCompatible")
        case .openAIResponses: i18n.t("provider.protocol.openaiResponses")
        case .anthropic: i18n.t("provider.protocol.anthropic")
        }
    }

    private func binding(_ keyPath: WritableKeyPath<ProviderConfig, String>) -> Binding<String> {
        Binding(
            get: { provider[keyPath: keyPath] },
            set: { value in
                setProvider { item in
                    item[keyPath: keyPath] = value
                }
            }
        )
    }

    private func bindingOptional(_ keyPath: WritableKeyPath<ProviderConfig, String?>) -> Binding<String> {
        Binding(
            get: { provider[keyPath: keyPath] ?? "" },
            set: { value in
                setProvider { item in
                    item[keyPath: keyPath] = value.isEmpty ? nil : value
                }
            }
        )
    }

    private func setProvider(_ mutate: (inout ProviderConfig) -> Void) {
        var next = model.snapshot
        guard let index = next.providers.firstIndex(where: { $0.id == provider.id }) else { return }
        mutate(&next.providers[index])
        next.providers[index].updatedAt = nowMillis()
        model.commit(next)
    }

    private func setProviderEnabled(_ value: Bool) {
        if value || !provider.enabled {
            setProvider { item in
                item.enabled = value
            }
            return
        }

        var next = model.snapshot
        guard let index = next.providers.firstIndex(where: { $0.id == provider.id }) else { return }
        guard next.providers.filter({ $0.enabled }).count > 1 else {
            model.settingsNotice = AppNotice(message: i18n.t("notice.providerMinimum"), kind: .warning)
            return
        }
        guard let fallbackProvider = next.providers.first(where: { $0.id != provider.id && $0.enabled }) else {
            model.settingsNotice = AppNotice(message: i18n.t("notice.providerMinimum"), kind: .warning)
            return
        }

        let updatedAt = nowMillis()
        let fallbackModel = fallbackChatModel(for: fallbackProvider)
        next.providers[index].enabled = false
        next.providers[index].updatedAt = updatedAt
        next.conversations = next.conversations.map { conversation in
            guard conversation.providerId == provider.id else { return conversation }
            var updated = conversation
            updated.providerId = fallbackProvider.id
            updated.model = fallbackModel
            updated.updatedAt = updatedAt
            return updated
        }
        model.commit(next)
    }

    private func startConnectivityCheck() {
        guard model.localSnapshotIssue == nil, !model.recoveringLocalSnapshot else {
            return
        }
        if model.providerKeyMissing(provider) {
            model.settingsNotice = AppNotice(message: i18n.t("error.providerKeyRequired"), kind: .warning)
            return
        }

        cancelConnectivityCheck()
        let requestId = UUID()
        let requestProvider = model.providerRequest(provider)
        let apiKey = model.providerKey(provider.id)
        let proxyToken = model.providerProxyToken(for: requestProvider)
        connectivityRequestId = requestId
        connectivityTask = Task {
            await checkConnectivity(
                requestId: requestId,
                requestProvider: requestProvider,
                apiKey: apiKey,
                proxyToken: proxyToken
            )
        }
    }

    private func cancelConnectivityCheck() {
        connectivityRequestId = nil
        connectivityTask?.cancel()
        connectivityTask = nil
    }

    private func ownsConnectivityRequest(
        _ requestId: UUID,
        requestProvider: ProviderConfig,
        apiKey: String,
        proxyToken: String
    ) -> Bool {
        guard connectivityRequestId == requestId,
              let currentProvider = model.snapshot.providers.first(where: { $0.id == requestProvider.id }) else {
            return false
        }
        let currentRequestProvider = model.providerRequest(currentProvider)
        return appleProviderModelRequestStillCurrent(
            expected: requestProvider,
            current: currentRequestProvider
        ) && model.providerKey(currentProvider.id) == apiKey &&
            model.providerProxyToken(for: currentRequestProvider) == proxyToken
    }

    private func checkConnectivity(
        requestId: UUID,
        requestProvider: ProviderConfig,
        apiKey: String,
        proxyToken: String
    ) async {
        defer {
            if connectivityRequestId == requestId {
                connectivityRequestId = nil
                connectivityTask = nil
            }
        }

        do {
            let fetched = try await AiClient().listModels(
                provider: requestProvider,
                apiKey: apiKey,
                proxyToken: proxyToken
            )
            try Task.checkCancellation()
            guard ownsConnectivityRequest(
                requestId,
                requestProvider: requestProvider,
                apiKey: apiKey,
                proxyToken: proxyToken
            ) else { return }
            setProvider { item in
                applyFetchedProviderModels(&item, models: fetched)
            }
            model.settingsNotice = AppNotice(
                message: i18n.t("notice.providerConnectivityPassed")
                    .replacingOccurrences(of: "{count}", with: "\(fetched.count)"),
                kind: .success
            )
        } catch is CancellationError {
            return
        } catch {
            guard ownsConnectivityRequest(
                requestId,
                requestProvider: requestProvider,
                apiKey: apiKey,
                proxyToken: proxyToken
            ) else { return }
            model.settingsNotice = AppNotice(
                message: i18n.t("notice.providerConnectivityFailed")
                    .replacingOccurrences(of: "{message}", with: i18n.errorMessage(error)),
                kind: .error
            )
        }
    }

}

func appleProviderDeletionCandidate(
    snapshot: AppSnapshot,
    providerId: String,
    now: Int64
) -> AppSnapshot? {
    guard snapshot.providers.count > 1 else { return nil }
    guard snapshot.providers.contains(where: { $0.id == providerId }) else { return nil }
    guard let fallbackProvider = snapshot.providers.first(where: { $0.id != providerId && $0.enabled })
        ?? snapshot.providers.first(where: { $0.id != providerId }) else {
        return nil
    }

    var candidate = snapshot
    let nextMonotonicTimestamp = snapshot.updatedAt == Int64.max ? Int64.max : snapshot.updatedAt + 1
    let updatedAt = max(now, nextMonotonicTimestamp)
    let fallbackModel = fallbackChatModel(for: fallbackProvider)
    candidate.providers.removeAll { $0.id == providerId }
    candidate.conversations = candidate.conversations.map { conversation in
        guard conversation.providerId == providerId else { return conversation }
        var updated = conversation
        updated.providerId = fallbackProvider.id
        updated.model = fallbackModel
        updated.updatedAt = updatedAt
        return updated
    }
    candidate.updatedAt = updatedAt
    return candidate
}

func customProvider(named name: String) -> ProviderConfig {
    let now = nowMillis()
    return ProviderConfig(
        id: UUID().uuidString,
        name: name,
        kind: .openAICompatible,
        baseUrl: "https://relay.example.com/v1",
        model: "",
        models: [],
        capabilities: customOpenAiRelayCapabilities,
        enabled: true,
        needsApiKey: true,
        custom: true,
        createdAt: now,
        updatedAt: now
    )
}

private struct ProviderCapabilitySummary: View {
    let provider: ProviderConfig
    let i18n: NativeI18n

    var body: some View {
        let capabilityChecks = providerSettingsCapabilityChecks(provider)

        VStack(alignment: .leading, spacing: 4) {
            Text(i18n.t("settings.capabilities"))
                .font(.footnote)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
            Text(providerSettingsCapabilitySummary(provider, i18n: i18n))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(i18n.t("settings.interfaces"))
                .font(.footnote)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
            Text(providerSettingsEndpointSummary(provider))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if !capabilityChecks.isEmpty {
                Text(i18n.t("settings.capabilityReadiness"))
                    .font(.footnote)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                Text(providerSettingsCapabilityReadinessSummary(provider, i18n: i18n))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(i18n.t("settings.capabilityReadinessNote"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(i18n.t("settings.capabilityNote"))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private let providerSettingsCapabilityOrder = [
    "chat",
    "vision",
    "tools",
    "image-generation",
    "image-editing",
    "audio",
    "realtime",
    "embeddings",
    "moderation",
    "model-list",
]

private let providerSettingsFullCapabilityChecks = [
    "embeddings",
    "moderation",
    "audio-speech",
    "audio-transcription",
    "realtime",
]

private func providerSettingsCapabilities(_ provider: ProviderConfig) -> [String] {
    let configured = provider.capabilities ?? []
    let source = configured.isEmpty ? providerSettingsDefaultCapabilities(provider.kind) : configured
    var seen = Set<String>()
    var capabilities: [String] = []

    for capability in source {
        let trimmed = capability.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty && !seen.contains(trimmed) {
            seen.insert(trimmed)
            capabilities.append(trimmed)
        }
    }

    return capabilities.sorted {
        let leftIndex = providerSettingsCapabilityOrder.firstIndex(of: $0) ?? Int.max
        let rightIndex = providerSettingsCapabilityOrder.firstIndex(of: $1) ?? Int.max
        return leftIndex == rightIndex ? $0 < $1 : leftIndex < rightIndex
    }
}

private func providerSettingsDefaultCapabilities(_ kind: ProviderKind) -> [String] {
    switch kind {
    case .anthropic:
        return ["chat", "vision", "tools", "model-list"]
    case .openAIResponses:
        return ["chat", "vision", "tools", "image-generation", "image-editing", "model-list"]
    case .openAICompatible:
        return ["chat", "vision", "tools", "embeddings", "model-list"]
    }
}

private func providerSettingsCapabilitySummary(_ provider: ProviderConfig, i18n: NativeI18n) -> String {
    providerSettingsCapabilities(provider)
        .map { capability in
            let key = "capability.\(capability)"
            let label = i18n.t(key)
            return label == key ? capability : label
        }
        .joined(separator: " / ")
}

private func providerSettingsCapabilityChecks(_ provider: ProviderConfig) -> [String] {
    let capabilities = Set(providerSettingsCapabilities(provider))
    return providerSettingsFullCapabilityChecks.filter { capability in
        switch capability {
        case "audio-speech", "audio-transcription":
            return capabilities.contains("audio")
        case "embeddings", "moderation", "realtime":
            return capabilities.contains(capability)
        default:
            return false
        }
    }
}

private func providerSettingsMissingCapabilityModelKeys(_ provider: ProviderConfig) -> [String] {
    providerSettingsCapabilityChecks(provider).filter { capability in
        switch capability {
        case "audio-speech":
            return modelForProviderAudioSpeech(provider).isEmpty
        case "audio-transcription":
            return modelForProviderAudioTranscription(provider).isEmpty
        case "embeddings":
            return modelForProviderCapability(provider, capability: .embeddings).isEmpty
        case "moderation":
            return modelForProviderCapability(provider, capability: .moderation).isEmpty
        case "realtime":
            return modelForProviderCapability(provider, capability: .realtime).isEmpty
        default:
            return false
        }
    }
}

private func providerSettingsCapabilityReadinessSummary(_ provider: ProviderConfig, i18n: NativeI18n) -> String {
    let missingCapabilityLabels = providerSettingsMissingCapabilityModelKeys(provider)
        .map { capability in
            let key = "capability.\(capability)"
            let label = i18n.t(key)
            return label == key ? capability : label
        }
        .joined(separator: " / ")

    if missingCapabilityLabels.isEmpty {
        return i18n.t("settings.capabilityReadinessReady")
    }

    return i18n.t("settings.capabilityReadinessMissing")
        .replacingOccurrences(of: "{capabilities}", with: missingCapabilityLabels)
}

private func providerSettingsEndpointSummary(_ provider: ProviderConfig) -> String {
    providerSettingsEndpointLabels(provider).joined(separator: " / ")
}

private func providerSettingsEndpointLabels(_ provider: ProviderConfig) -> [String] {
    let capabilities = Set(providerSettingsCapabilities(provider))
    var endpoints: [String] = []

    switch provider.kind {
    case .anthropic:
        addProviderSettingsEndpoint("/messages", to: &endpoints)
        addProviderSettingsEndpoint("/models", to: &endpoints)
    case .openAIResponses:
        addProviderSettingsEndpoint("/responses", to: &endpoints)
        addProviderSettingsEndpoint("/models", to: &endpoints)
    case .openAICompatible:
        addProviderSettingsEndpoint("/chat/completions", to: &endpoints)
        addProviderSettingsEndpoint("/models", to: &endpoints)
    }

    if capabilities.contains("image-generation"),
       !modelForProviderCapability(provider, capability: .imageGeneration).isEmpty {
        addProviderSettingsEndpoint("/images/generations", to: &endpoints)
    }
    if capabilities.contains("image-editing"),
       !modelForProviderCapability(provider, capability: .imageEditing).isEmpty {
        addProviderSettingsEndpoint("/images/edits", to: &endpoints)
    }
    if capabilities.contains("audio"), !modelForProviderAudioSpeech(provider).isEmpty {
        addProviderSettingsEndpoint("/audio/speech", to: &endpoints)
    }
    if capabilities.contains("audio"), !modelForProviderAudioTranscription(provider).isEmpty {
        addProviderSettingsEndpoint("/audio/transcriptions", to: &endpoints)
    }
    if capabilities.contains("realtime"),
       !modelForProviderCapability(provider, capability: .realtime).isEmpty {
        addProviderSettingsEndpoint("/realtime", to: &endpoints)
        addProviderSettingsEndpoint("/realtime/client_secrets", to: &endpoints)
    }
    if capabilities.contains("embeddings"),
       !modelForProviderCapability(provider, capability: .embeddings).isEmpty {
        addProviderSettingsEndpoint("/embeddings", to: &endpoints)
    }
    if capabilities.contains("moderation"),
       !modelForProviderCapability(provider, capability: .moderation).isEmpty {
        addProviderSettingsEndpoint("/moderations", to: &endpoints)
    }

    return endpoints
}

private func addProviderSettingsEndpoint(_ endpoint: String, to endpoints: inout [String]) {
    if !endpoints.contains(endpoint) {
        endpoints.append(endpoint)
    }
}
