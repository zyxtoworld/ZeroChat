import type { ProviderConfig } from '../types'

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
