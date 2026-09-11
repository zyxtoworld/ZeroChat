import { normalizeLanguageMode } from '../i18n'
import type {
  AppData,
  ProviderConfig,
  ProviderSecrets,
} from '../types'
import { createRuntimeId, normalizeAppData } from './appData'
import { isDisallowedRemoteHost } from './providerUrlSafety'

export interface SanitizedAppData {
  data: AppData
  removedProviderIds: string[]
  changed: boolean
}

const ALLOWED_PROVIDER_KINDS: ProviderConfig['kind'][] = [
  'openai-compatible',
  'openai-responses',
  'anthropic',
]

function createFallbackSafeProvider(): ProviderConfig {
  const now = Date.now()

  return {
    id: createRuntimeId('provider'),
    name: 'OpenAI',
    kind: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    imageModel: 'gpt-image-2',
    audioSpeechModel: 'gpt-4o-mini-tts',
    audioTranscriptionModel: 'gpt-4o-transcribe',
    embeddingModel: 'text-embedding-3-large',
    moderationModel: 'omni-moderation-latest',
    realtimeModel: 'gpt-realtime-2',
    enabled: true,
    needsApiKey: true,
    createdAt: now,
    updatedAt: now,
  }
}

function isExplicitlyUnsafeProviderUrl(value: string): boolean {
  const trimmed = value.trim()

  if (!trimmed) {
    return false
  }

  let url: URL

  try {
    url = new URL(trimmed)
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
  const dataChanged = preferencesChanged
  const safeProviders: ProviderConfig[] = []
  const removedProviderIds: string[] = []

  for (const provider of normalizedData.providers) {
    if (
      ALLOWED_PROVIDER_KINDS.includes(provider.kind) &&
      !isExplicitlyUnsafeProviderUrl(provider.baseUrl) &&
      !isExplicitlyUnsafeProviderUrl(provider.proxyUrl ?? '')
    ) {
      safeProviders.push(provider)
    } else {
      removedProviderIds.push(provider.id)
    }
  }

  if (removedProviderIds.length === 0) {
    return {
      data: normalizedData,
      removedProviderIds: [],
      changed: dataChanged,
    }
  }

  const providers =
    safeProviders.length > 0 ? safeProviders : [createFallbackSafeProvider()]
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
