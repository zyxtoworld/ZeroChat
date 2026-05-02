import { providerFromPreset, providerPresets } from '../data/presets'
import type { AppData, ProviderConfig, ProviderSecrets } from '../types'

export interface SanitizedAppData {
  data: AppData
  removedProviderIds: string[]
  changed: boolean
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function hostnameWithoutBrackets(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.')

  if (parts.length !== 4) {
    return null
  }

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return Number.NaN
    }

    return Number(part)
  })

  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null
}

export function isDisallowedRemoteHost(hostname: string): boolean {
  const normalized = hostnameWithoutBrackets(hostname)
  const ipv4 = parseIpv4(normalized)

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true
  }

  if (ipv4) {
    const [first, second] = ipv4

    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    )
  }

  if (!normalized.includes(':')) {
    return false
  }

  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  )
}

export function assertSafeRemoteBaseUrl(value: string, label: string): string {
  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`${label} 格式不正确`)
  }

  if (url.username || url.password) {
    throw new Error(`${label} 不能包含用户名或密码`)
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${label} 必须使用 HTTPS 远程地址`)
  }

  if (isDisallowedRemoteHost(url.hostname)) {
    throw new Error(`${label} 不能使用 localhost、本机、内网或局域网地址`)
  }

  url.hash = ''
  url.search = ''
  return trimSlash(url.toString())
}

function isExplicitlyUnsafeProviderUrl(value: string): boolean {
  if (!value.trim()) {
    return false
  }

  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    return false
  }

  return (
    url.protocol !== 'https:' ||
    Boolean(url.username || url.password) ||
    isDisallowedRemoteHost(url.hostname)
  )
}

function allowedProviderKinds(): Set<ProviderConfig['kind']> {
  return new Set(['openai-compatible', 'openai-responses', 'anthropic'])
}

export function sanitizeRemoteOnlyAppData(data: AppData): SanitizedAppData {
  const allowedKinds = allowedProviderKinds()
  const safeProviders = data.providers.filter(
    (provider) =>
      allowedKinds.has(provider.kind) &&
      !isExplicitlyUnsafeProviderUrl(provider.baseUrl),
  )
  const removedProviderIds = data.providers
    .filter((provider) => !safeProviders.some((safe) => safe.id === provider.id))
    .map((provider) => provider.id)

  if (removedProviderIds.length === 0) {
    return { data, removedProviderIds: [], changed: false }
  }

  const providers =
    safeProviders.length > 0 ? safeProviders : [providerFromPreset(providerPresets[0])]
  const providerIds = new Set(providers.map((provider) => provider.id))
  const fallback = providers[0]
  const conversations = data.conversations.map((conversation) =>
    providerIds.has(conversation.providerId)
      ? conversation
      : {
          ...conversation,
          providerId: fallback.id,
          model: fallback.model,
          updatedAt: Date.now(),
        },
  )

  return {
    data: {
      ...data,
      providers,
      conversations,
      updatedAt: Date.now(),
    },
    removedProviderIds,
    changed: true,
  }
}

export function pruneProviderSecrets(
  secrets: ProviderSecrets,
  providerIds: string[],
): ProviderSecrets {
  const allowed = new Set(providerIds)

  return {
    providerKeys: Object.fromEntries(
      Object.entries(secrets.providerKeys).filter(([providerId]) =>
        allowed.has(providerId),
      ),
    ),
    providerProxyTokens: Object.fromEntries(
      Object.entries(secrets.providerProxyTokens).filter(([providerId]) =>
        allowed.has(providerId),
      ),
    ),
  }
}
