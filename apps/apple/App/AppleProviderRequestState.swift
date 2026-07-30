import Foundation
import ZeroChatCore

func appleProviderModelRequestStillCurrent(
    expected: ProviderConfig,
    current: ProviderConfig?
) -> Bool {
    guard let current else { return false }
    return current.id == expected.id &&
        current.kind == expected.kind &&
        current.baseUrl == expected.baseUrl &&
        current.proxyUrl == expected.proxyUrl &&
        current.clientRequestMode == expected.clientRequestMode &&
        current.needsApiKey == expected.needsApiKey &&
        current.enabled == expected.enabled
}

@MainActor
extension ZeroChatViewModel {
    func providerRequest(_ provider: ProviderConfig) -> ProviderConfig {
        normalizedProviderRequest(provider, sync: snapshot.sync)
    }

    func providerNeedsClientKey(_ provider: ProviderConfig) -> Bool {
        providerRequestNeedsClientKey(provider, sync: snapshot.sync)
    }

    func providerProxyToken(for requestProvider: ProviderConfig) -> String {
        providerRequestUsesProxy(requestProvider) ? cloudflareAccessKey() : ""
    }

    func providerKeyMissing(_ provider: ProviderConfig) -> Bool {
        providerNeedsClientKey(provider) &&
            providerKey(provider.id).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
