import { providerFromPreset, providerPresets } from '../data/presets'
import { normalizeLanguageMode, rt } from '../i18n'
import type { AppData, ProviderConfig, ProviderSecrets } from '../types'
import { normalizeAppData } from './appData'

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

function isDisallowedIpv4(octets: number[]): boolean {
  const [first, second, third] = octets

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  )
}

function parseIpv6Hextets(value: string): number[] | null {
  const parsePart = (part: string): number[] | null => {
    if (!part) {
      return null
    }

    if (part.includes('.')) {
      const ipv4 = parseIpv4(part)

      return ipv4
        ? [ipv4[0] * 256 + ipv4[1], ipv4[2] * 256 + ipv4[3]]
        : null
    }

    if (!/^[0-9a-f]{1,4}$/iu.test(part)) {
      return null
    }

    return [Number.parseInt(part, 16)]
  }

  const parseSide = (side: string): number[] | null => {
    if (!side) {
      return []
    }

    const hextets: number[] = []

    for (const part of side.split(':')) {
      const parsed = parsePart(part)

      if (!parsed) {
        return null
      }

      hextets.push(...parsed)
    }

    return hextets
  }

  const sections = value.split('::')

  if (sections.length > 2) {
    return null
  }

  const left = parseSide(sections[0])
  const right = sections.length === 2 ? parseSide(sections[1]) : []

  if (!left || !right) {
    return null
  }

  if (sections.length === 1) {
    return left.length === 8 ? left : null
  }

  const zeros = 8 - left.length - right.length

  if (zeros < 1) {
    return null
  }

  return [...left, ...Array.from({ length: zeros }, () => 0), ...right]
}

function embeddedIpv4FromIpv6(value: string): number[] | null {
  const hextets = parseIpv6Hextets(value)

  if (!hextets) {
    return null
  }

  const fromWords = (firstWord: number, secondWord: number): number[] => [
    firstWord >> 8,
    firstWord & 255,
    secondWord >> 8,
    secondWord & 255,
  ]

  if (
    hextets.slice(0, 5).every((part) => part === 0) &&
    (hextets[5] === 0 || hextets[5] === 0xffff)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    hextets.slice(2, 6).every((part) => part === 0)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    hextets[2] === 1 &&
    hextets.slice(3, 6).every((part) => part === 0)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (hextets[0] === 0x2002) {
    return fromWords(hextets[1], hextets[2])
  }

  return null
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
    return normalized !== ipv4.join('.') || isDisallowedIpv4(ipv4)
  }

  if (!normalized.includes(':')) {
    return (
      !normalized.includes('.') ||
      normalized.split('.').every((label) => /^(?:[0-9]+|0x[0-9a-f]+)$/iu.test(label))
    )
  }

  const ipv6 = parseIpv6Hextets(normalized)
  const embeddedIpv4 = embeddedIpv4FromIpv6(normalized)

  if (embeddedIpv4 && isDisallowedIpv4(embeddedIpv4)) {
    return true
  }

  if (ipv6) {
    const first = ipv6[0]

    return (
      normalized === '::' ||
      normalized === '::1' ||
      (first === 0x100 && ipv6.slice(1, 4).every((part) => part === 0)) ||
      (first === 0x2001 && ipv6[1] === 0x0db8) ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00
    )
  }

  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  )
}

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
    Boolean(url.search || url.hash) ||
    isDisallowedRemoteHost(url.hostname)
  )
}

function isUnsafeProviderEndpoint(provider: ProviderConfig): boolean {
  return (
    isExplicitlyUnsafeProviderUrl(provider.baseUrl) ||
    isExplicitlyUnsafeProviderUrl(provider.proxyUrl ?? '')
  )
}

function allowedProviderKinds(): Set<ProviderConfig['kind']> {
  return new Set(['openai-compatible', 'openai-responses', 'anthropic'])
}

export function sanitizeRemoteOnlyAppData(data: AppData): SanitizedAppData {
  const shapedData = normalizeAppData(data)
  const language = normalizeLanguageMode(
    (shapedData.preferences as { language?: unknown }).language,
  )
  const preferencesChanged = shapedData.preferences.language !== language
  const normalizedData = preferencesChanged
    ? {
        ...shapedData,
        preferences: {
          ...shapedData.preferences,
          language,
        },
        updatedAt: Date.now(),
      }
    : shapedData
  const allowedKinds = allowedProviderKinds()
  const safeProviders = normalizedData.providers.filter(
    (provider) =>
      allowedKinds.has(provider.kind) &&
      !isUnsafeProviderEndpoint(provider),
  )
  const removedProviderIds = normalizedData.providers
    .filter((provider) => !safeProviders.some((safe) => safe.id === provider.id))
    .map((provider) => provider.id)

  if (removedProviderIds.length === 0) {
    return {
      data: normalizedData,
      removedProviderIds: [],
      changed: preferencesChanged,
    }
  }

  const providers =
    safeProviders.length > 0 ? safeProviders : [providerFromPreset(providerPresets[0])]
  const providerIds = new Set(providers.map((provider) => provider.id))
  const fallback = providers[0]
  const conversations = normalizedData.conversations.map((conversation) =>
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
      ...normalizedData,
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
  }
}
