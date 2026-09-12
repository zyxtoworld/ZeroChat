import SwiftUI
import Foundation
import ZeroChatCore

struct ModelSettingsView: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n
    @State private var selectedProviderId = ""
    @State private var manualModel = ""
    @State private var modelFetchTask: Task<Void, Never>?
    @State private var modelFetchRequestId: UUID?

    var body: some View {
        Section(i18n.t("setting.models")) {
            Picker(i18n.t("field.provider"), selection: $selectedProviderId) {
                ForEach(model.snapshot.providers) {
                    Text(providerDisplayName($0, i18n)).tag($0.id)
                }
            }
            if !selectedProviderCapabilitySummary.isEmpty {
                Text(selectedProviderCapabilitySummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(selectedProviderCapabilitySummary)
            }

            if let provider = selectedProvider {
                Button {
                    startModelFetch(provider)
                } label: {
                    Label(i18n.t("button.fetchModels"), systemImage: "arrow.down.circle")
                }
                .disabled(modelFetchRequestId != nil)

                TextField(i18n.t("placeholder.modelList"), text: $manualModel)
                    .onSubmit { addManualModels(provider) }
                    .onChange(of: manualModel) {
                        if manualModel.last?.isWhitespace == true {
                            addManualModels(provider)
                        }
                    }
                Button(i18n.t("action.addModel")) {
                    addManualModels(provider)
                }
                .disabled(manualModel.split(whereSeparator: \.isWhitespace).isEmpty)

                ForEach(Array((provider.models ?? []).enumerated()), id: \.element) { index, item in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item)
                                .lineLimit(1)
                            if !modelCapabilitySummary(item).isEmpty {
                                Text(modelCapabilitySummary(item))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                        Spacer()
                        Button(i18n.t("action.moveUp")) { moveModel(provider, from: index, by: -1) }
                            .disabled(index == 0)
                        Button(i18n.t("action.moveDown")) { moveModel(provider, from: index, by: 1) }
                            .disabled(index == (provider.models ?? []).count - 1)
                        Button(role: .destructive) {
                            removeModel(provider, item)
                        } label: {
                            Image(systemName: "xmark")
                        }
                    }
                }

                Picker(i18n.t("field.defaultModel"), selection: bindingProvider(provider.id, \.model)) {
                    Text(i18n.t("option.emptyModel")).tag("")
                    ForEach(chatModels(for: provider), id: \.self) { Text($0).tag($0) }
                }
                Picker(i18n.t("field.imageModel"), selection: bindingProvider(provider.id, \.imageModel, nilValue: "")) {
                    Text(i18n.t("option.emptyModel")).tag("")
                    ForEach(imageModels(for: provider), id: \.self) { Text($0).tag($0) }
                }
            } else {
                Text(i18n.t("message.addProviderFirst"))
            }
        }
        .onAppear(perform: repairSelectedProvider)
        .onChange(of: model.snapshot.providers.map(\.id)) {
            repairSelectedProvider()
        }
        .onChange(of: selectedProviderId) {
            cancelModelFetch()
        }
        .onDisappear(perform: cancelModelFetch)
    }

    private var selectedProvider: ProviderConfig? {
        model.snapshot.providers.first { $0.id == selectedProviderId } ?? model.snapshot.providers.first
    }

    private var selectedProviderCapabilitySummary: String {
        providerModelCapabilitySummary(for: selectedProvider, i18n: i18n)
    }

    private func modelCapabilitySummary(_ modelName: String) -> String {
        modelCapabilityKeysForModel(modelName)
            .map { i18n.t($0) }
            .joined(separator: " / ")
    }

    private func repairSelectedProvider() {
        guard !model.snapshot.providers.isEmpty else {
            selectedProviderId = ""
            return
        }

        if !model.snapshot.providers.contains(where: { $0.id == selectedProviderId }) {
            selectedProviderId = model.snapshot.providers.first?.id ?? ""
        }
    }

    private func bindingProvider(
        _ providerId: String,
        _ keyPath: WritableKeyPath<ProviderConfig, String>
    ) -> Binding<String> {
        Binding(
            get: {
                model.snapshot.providers.first { $0.id == providerId }?[keyPath: keyPath] ?? ""
            },
            set: { value in
                mutateProvider(providerId) {
                    $0[keyPath: keyPath] = value
                }
            }
        )
    }

    private func bindingProvider(
        _ providerId: String,
        _ keyPath: WritableKeyPath<ProviderConfig, String?>,
        nilValue: String
    ) -> Binding<String> {
        Binding(
            get: {
                model.snapshot.providers.first { $0.id == providerId }?[keyPath: keyPath] ?? nilValue
            },
            set: { value in
                mutateProvider(providerId) {
                    $0[keyPath: keyPath] = value.isEmpty ? nil : value
                }
            }
        )
    }

    private func startModelFetch(_ provider: ProviderConfig) {
        guard model.localSnapshotIssue == nil, !model.recoveringLocalSnapshot else {
            return
        }
        if model.providerKeyMissing(provider) {
            model.settingsNotice = AppNotice(message: i18n.t("error.providerKeyRequired"), kind: .warning)
            return
        }

        cancelModelFetch()
        let requestId = UUID()
        let requestProvider = model.providerRequest(provider)
        let apiKey = model.providerKey(provider.id)
        let proxyToken = model.providerProxyToken(for: requestProvider)
        modelFetchRequestId = requestId
        modelFetchTask = Task {
            await fetchModels(
                requestId: requestId,
                requestProvider: requestProvider,
                apiKey: apiKey,
                proxyToken: proxyToken
            )
        }
    }

    private func cancelModelFetch() {
        modelFetchRequestId = nil
        modelFetchTask?.cancel()
        modelFetchTask = nil
    }

    private func ownsModelFetch(
        _ requestId: UUID,
        requestProvider: ProviderConfig,
        apiKey: String,
        proxyToken: String
    ) -> Bool {
        guard modelFetchRequestId == requestId,
              selectedProviderId == requestProvider.id,
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

    private func fetchModels(
        requestId: UUID,
        requestProvider: ProviderConfig,
        apiKey: String,
        proxyToken: String
    ) async {
        defer {
            if modelFetchRequestId == requestId {
                modelFetchRequestId = nil
                modelFetchTask = nil
            }
        }

        do {
            let fetched = try await AiClient().listModels(
                provider: requestProvider,
                apiKey: apiKey,
                proxyToken: proxyToken
            )
            try Task.checkCancellation()
            guard ownsModelFetch(
                requestId,
                requestProvider: requestProvider,
                apiKey: apiKey,
                proxyToken: proxyToken
            ) else { return }
            mutateProvider(requestProvider.id) {
                applyFetchedProviderModels(&$0, models: fetched)
            }
            model.settingsNotice = AppNotice(
                message: i18n.t("notice.modelsFetched")
                    .replacingOccurrences(of: "{count}", with: "\(fetched.count)"),
                kind: .success
            )
        } catch is CancellationError {
            return
        } catch {
            guard ownsModelFetch(
                requestId,
                requestProvider: requestProvider,
                apiKey: apiKey,
                proxyToken: proxyToken
            ) else { return }
            model.settingsNotice = AppNotice(
                message: i18n.t("notice.modelsFetchFailed")
                    .replacingOccurrences(of: "{message}", with: i18n.errorMessage(error)),
                kind: .error
            )
        }
    }

    private func addManualModels(_ provider: ProviderConfig) {
        let values = manualModel.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !values.isEmpty else { return }
        mutateProvider(provider.id) {
            applyConfiguredProviderModels(&$0, models: ($0.models ?? []) + values)
        }
        manualModel = ""
    }

    private func moveModel(_ provider: ProviderConfig, from index: Int, by offset: Int) {
        var values = provider.models ?? []
        let target = index + offset
        guard values.indices.contains(index), values.indices.contains(target) else { return }
        values.swapAt(index, target)
        mutateProvider(provider.id) {
            applyConfiguredProviderModels(&$0, models: values)
        }
    }

    private func removeModel(_ provider: ProviderConfig, _ item: String) {
        var values = provider.models ?? []
        values.removeAll { $0 == item }
        mutateProvider(provider.id) {
            applyConfiguredProviderModels(&$0, models: values)
        }
    }

    private func mutateProvider(_ id: String, _ mutate: (inout ProviderConfig) -> Void) {
        var next = model.snapshot
        guard let index = next.providers.firstIndex(where: { $0.id == id }) else { return }
        mutate(&next.providers[index])
        next.providers[index].updatedAt = nowMillis()
        model.commit(next)
    }
}
