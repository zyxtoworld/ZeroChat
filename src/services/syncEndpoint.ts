import { rt } from '../i18n'
import { isDisallowedRemoteHost } from './remoteHostSafety'

export function isLoopbackSyncHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

export function normalizeWorkerEndpoint(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? ''

  if (!trimmed) {
    throw new Error(rt('error.syncCloudflareEndpointRequired'))
  }

  let url: URL

  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(rt('error.syncCloudflareEndpointBadFormat'))
  }

  if (url.username || url.password) {
    throw new Error(rt('error.syncCloudflareEndpointCredentials'))
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackSyncHost(url.hostname))) {
    throw new Error(rt('error.syncCloudflareEndpointHttps'))
  }

  if (url.protocol === 'https:' && isDisallowedRemoteHost(url.hostname)) {
    throw new Error(
      rt('error.urlLocalNetwork', { label: rt('field.workerEndpoint') }),
    )
  }

  if (url.search || url.hash) {
    throw new Error(rt('error.urlQuery', { label: rt('field.workerEndpoint') }))
  }

  return url.toString().replace(/\/+$/, '')
}
