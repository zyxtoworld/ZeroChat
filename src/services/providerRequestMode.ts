import type { AppData, ProviderConfig } from '../types'

export function activeProviderProxyUrl(provider: ProviderConfig): string {
  return provider.clientRequestMode ? '' : provider.proxyUrl?.trim() ?? ''
}

export function providerUsesProxy(provider: ProviderConfig): boolean {
  return Boolean(activeProviderProxyUrl(provider))
}

export function providerNeedsBrowserKey(provider: ProviderConfig): boolean {
  return (
    provider.clientRequestMode ||
    provider.needsApiKey !== false ||
    !providerUsesProxy(provider)
  )
}

export function workerProxyUrlFromSync(data: AppData | null): string {
  const endpoint = data?.sync.workerEndpoint?.trim() ?? ''

  if (data?.sync.mode !== 'cloudflare' || !endpoint.startsWith('https://')) {
    return ''
  }

  return endpoint
}

export function providerForAiRequest(
  provider: ProviderConfig,
  data: AppData | null,
): ProviderConfig {
  if (provider.clientRequestMode) {
    return provider.proxyUrl ? { ...provider, proxyUrl: undefined } : provider
  }

  if (provider.proxyUrl?.trim()) {
    return provider
  }

  const proxyUrl = workerProxyUrlFromSync(data)

  return proxyUrl ? { ...provider, proxyUrl } : provider
}

export function shouldUseBrowserProviderKey(
  provider: ProviderConfig | null,
): boolean {
  return Boolean(provider && providerNeedsBrowserKey(provider))
}

export function browserProviderKey(
  provider: ProviderConfig,
  keys: Record<string, string>,
): string {
  return shouldUseBrowserProviderKey(provider) ? keys[provider.id] ?? '' : ''
}
