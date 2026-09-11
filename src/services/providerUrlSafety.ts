import { rt } from '../i18n'
import { isDisallowedRemoteHost } from './remoteHostSafety'

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export { isDisallowedRemoteHost } from './remoteHostSafety'

export function assertSafeRemoteBaseUrl(value: string, label: string): string {
  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(rt('error.urlInvalid', { label }))
  }

  if (url.username || url.password) {
    throw new Error(rt('error.urlCredentials', { label }))
  }

  if (url.protocol !== 'https:') {
    throw new Error(rt('error.urlHttps', { label }))
  }

  if (url.search || url.hash) {
    throw new Error(rt('error.urlQuery', { label }))
  }

  if (isDisallowedRemoteHost(url.hostname)) {
    throw new Error(rt('error.urlLocalNetwork', { label }))
  }

  return trimSlash(url.toString())
}

export function normalizeProviderProxyRootUrl(
  value: string,
  label: string,
): string {
  const baseUrl = assertSafeRemoteBaseUrl(value, label)

  if (baseUrl.endsWith('/proxy/hosts')) {
    return baseUrl.slice(0, -'/proxy/hosts'.length)
  }

  if (baseUrl.endsWith('/proxy')) {
    return baseUrl.slice(0, -'/proxy'.length)
  }

  return baseUrl
}
