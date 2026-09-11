import type { AppData, ProviderConfig } from '../types'
import { now } from '../services/appData'
import { defaultModelForProvider } from '../services/providerModelCore'

const connectivityInvalidatingFields = new Set<keyof ProviderConfig>([
  'audioSpeechModel',
  'audioTranscriptionModel',
  'baseUrl',
  'capabilities',
  'clientRequestMode',
  'embeddingModel',
  'enabled',
  'imageModel',
  'kind',
  'model',
  'models',
  'moderationModel',
  'needsApiKey',
  'proxyUrl',
  'realtimeModel',
])

export function ensureLocalMutationTimestamp(
  current: AppData,
  next: AppData,
): AppData {
  if (next === current || next.updatedAt > current.updatedAt) return next
  return { ...next, updatedAt: current.updatedAt + 1 }
}

export function providerPatchInvalidatesConnectivity(
  patch: Partial<ProviderConfig>,
): boolean {
  return (Object.keys(patch) as Array<keyof ProviderConfig>).some((key) =>
    connectivityInvalidatingFields.has(key),
  )
}

export function markProviderCredentialChanged(
  current: AppData,
  providerId: string,
): AppData {
  const target = current.providers.find(({ id }) => id === providerId)
  if (!target) return current
  const updatedAt = Math.max(
    now(),
    current.updatedAt + 1,
    target.updatedAt + 1,
  )
  return {
    ...current,
    providers: current.providers.map((provider) =>
      provider.id === providerId ? { ...provider, updatedAt } : provider,
    ),
    updatedAt,
  }
}

export function deleteProviderFromAppData(
  current: AppData,
  providerId: string,
): AppData {
  const target = current.providers.find(({ id }) => id === providerId)
  if (!target) return current

  const providers = current.providers.filter(({ id }) => id !== providerId)
  const fallback = providers.find(({ enabled }) => enabled) ?? providers[0]
  const updatedAt = Math.max(now(), current.updatedAt + 1, target.updatedAt + 1)

  return {
    ...current,
    providers,
    conversations: current.conversations.map((conversation) =>
      conversation.providerId === providerId
        ? {
            ...conversation,
            model: fallback ? defaultModelForProvider(fallback) : '',
            providerId: fallback?.id ?? '',
            updatedAt,
          }
        : conversation,
    ),
    updatedAt,
  }
}

function normalizedProviderAfterPatch(
  provider: ProviderConfig,
  patch: Partial<ProviderConfig>,
): ProviderConfig {
  const normalized = { ...provider, ...patch }
  if (patch.clientRequestMode === true) {
    normalized.proxyUrl = undefined
  } else if (Object.hasOwn(patch, 'proxyUrl') && patch.proxyUrl?.trim()) {
    normalized.clientRequestMode = undefined
  } else if (normalized.clientRequestMode && normalized.proxyUrl?.trim()) {
    normalized.clientRequestMode = undefined
  }
  return normalized
}

export function updateProviderInAppData(
  current: AppData,
  providerId: string,
  patch: Partial<ProviderConfig>,
): AppData {
  const target = current.providers.find(({ id }) => id === providerId)
  if (!target) return current
  const disabling = target.enabled && patch.enabled === false
  const fallback = disabling
    ? current.providers.find(
        ({ enabled, id }) => enabled && id !== providerId,
      )
    : undefined
  if (disabling && !fallback) return current

  const updatedAt = Math.max(now(), current.updatedAt + 1, target.updatedAt + 1)
  const modelChanged = Object.hasOwn(patch, 'model')
  const conversations = disabling
    ? current.conversations.map((conversation) =>
        conversation.providerId === providerId
          ? {
              ...conversation,
              model: defaultModelForProvider(fallback!),
              providerId: fallback!.id,
              updatedAt,
            }
          : conversation,
      )
    : modelChanged
      ? current.conversations.map((conversation) =>
          conversation.id === current.preferences.activeConversationId &&
          conversation.providerId === providerId &&
          conversation.messages.length === 0
            ? {
                ...conversation,
                model: patch.model ?? conversation.model,
                updatedAt,
              }
            : conversation,
        )
      : current.conversations

  return {
    ...current,
    providers: current.providers.map((provider) =>
      provider.id === providerId
        ? {
            ...normalizedProviderAfterPatch(provider, patch),
            updatedAt,
          }
        : provider,
    ),
    conversations,
    updatedAt,
  }
}
