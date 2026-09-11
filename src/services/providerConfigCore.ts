import {
  ANTHROPIC_CAPABILITIES,
  OPENAI_COMPATIBLE_CAPABILITIES,
  OPENAI_DEFAULT_CHAT_MODEL,
  OPENAI_FULL_CAPABILITIES,
  OPENAI_RESPONSES_CAPABILITIES,
  presetCapabilities,
  providerPresets,
} from '../data/presets'
import type {
  AppData,
  ProviderCapability,
  ProviderConfig,
  ProviderPreset,
} from '../types'
import type { TranslationKey, Translator } from '../i18n'
import {
  isLikelyAudioSpeechModel,
  isLikelyAudioTranscriptionModel,
  isLikelyEmbeddingModel,
  isLikelyImageModel,
  isLikelyModerationModel,
  isLikelyRealtimeModel,
  uniqueModels,
} from './providerModels'
import {
  clearerCustomProviderName as clearerCustomProviderNameFromAliases,
  defaultCustomPresetIdForName,
} from './providerCustomNames'
import { providerNeedsBrowserKey } from './providerRequestMode'

export { reorderProviders } from './appData'

export function capabilityLabel(
  capability: ProviderCapability,
  t: Translator,
): string {
  return t(`capability.${capability}` as TranslationKey)
}

export function workerProxyUrlFromSync(data: AppData | null): string {
  const endpoint = data?.sync.workerEndpoint?.trim() ?? ''

  if (data?.sync.mode !== 'cloudflare' || !endpoint.startsWith('https://')) {
    return ''
  }

  return endpoint
}

export function preferredProviderId(data: AppData): string {
  const active =
    data.conversations.find(
      (conversation) =>
        conversation.id === data.preferences.activeConversationId,
    ) ?? data.conversations[0]

  return active?.providerId ?? data.providers[0]?.id ?? ''
}

export function presetIdForProvider(provider: ProviderConfig): string {
  const exact = providerPresets.find(
    (preset) =>
      preset.kind === provider.kind &&
      preset.name === provider.name &&
      preset.baseUrl === provider.baseUrl,
  )

  if (exact) {
    return exact.id
  }

  if (provider.kind === 'anthropic') {
    return 'custom-anthropic-relay'
  }

  if (provider.kind === 'openai-responses') {
    return 'custom-responses-relay'
  }

  return 'custom-openai-relay'
}

export function presetById(presetId: string): ProviderPreset {
  return (
    providerPresets.find((item) => item.id === presetId) ?? providerPresets[0]
  )
}

export function officialPresetForProvider(
  provider: ProviderConfig,
): ProviderPreset | undefined {
  if (provider.custom) {
    return undefined
  }

  return providerPresets.find(
    (preset) =>
      !preset.custom &&
      preset.name === provider.name &&
      preset.baseUrl === provider.baseUrl,
  )
}

export function defaultCustomPresetIdForProvider(
  provider: ProviderConfig,
): string | undefined {
  if (!provider.custom) {
    return undefined
  }

  const presetId = defaultCustomPresetIdForName(provider.name)
  const preset = presetId ? presetById(presetId) : undefined

  return preset?.kind === provider.kind ? preset.id : undefined
}

export function defaultPresetIdForProviderName(
  provider: ProviderConfig,
): string | undefined {
  return officialPresetForProvider(provider)?.id ?? defaultCustomPresetIdForProvider(provider)
}

export function clearerCustomProviderName(provider: ProviderConfig): string {
  return clearerCustomProviderNameFromAliases(provider)
}

function sameCapabilities(
  left: ProviderCapability[] | undefined,
  right: ProviderCapability[],
): boolean {
  return (
    (left ?? []).length === right.length &&
    right.every((capability, index) => left?.[index] === capability)
  )
}

function sameStringArray(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  const leftItems = left ?? []
  const rightItems = right ?? []

  return (
    leftItems.length === rightItems.length &&
    rightItems.every((item, index) => leftItems[index] === item)
  )
}

export function providerDefaultsFromPreset(
  provider: ProviderConfig,
  preset: ProviderPreset,
): Pick<
  ProviderConfig,
  | 'audioSpeechModel'
  | 'audioTranscriptionModel'
  | 'embeddingModel'
  | 'imageModel'
  | 'model'
  | 'models'
  | 'moderationModel'
  | 'realtimeModel'
> {
  const providerModel = provider.model.trim()
  const model =
    preset.id === 'openai' &&
    (!providerModel || providerModel === 'gpt-5.4-mini')
      ? OPENAI_DEFAULT_CHAT_MODEL
      : provider.model
  const models = preset.imageModel
    ? uniqueModels([
        ...(provider.models ?? []),
        provider.model,
        preset.model,
        provider.imageModel ?? '',
        preset.imageModel,
        provider.audioSpeechModel ?? '',
        preset.audioSpeechModel ?? '',
        provider.audioTranscriptionModel ?? '',
        preset.audioTranscriptionModel ?? '',
        provider.embeddingModel ?? '',
        preset.embeddingModel ?? '',
        provider.moderationModel ?? '',
        preset.moderationModel ?? '',
        provider.realtimeModel ?? '',
        preset.realtimeModel ?? '',
      ])
    : uniqueModels([
        ...(provider.models ?? []),
        provider.model,
        preset.model,
        provider.audioSpeechModel ?? '',
        preset.audioSpeechModel ?? '',
        provider.audioTranscriptionModel ?? '',
        preset.audioTranscriptionModel ?? '',
        provider.embeddingModel ?? '',
        preset.embeddingModel ?? '',
        provider.moderationModel ?? '',
        preset.moderationModel ?? '',
        provider.realtimeModel ?? '',
        preset.realtimeModel ?? '',
      ])
  const imageModel =
    preset.imageModel &&
    (!provider.imageModel?.trim() || !isLikelyImageModel(provider.imageModel))
      ? preset.imageModel
      : provider.imageModel
  const audioTranscriptionModel =
    preset.audioTranscriptionModel &&
    (!provider.audioTranscriptionModel?.trim() ||
      !isLikelyAudioTranscriptionModel(provider.audioTranscriptionModel))
      ? preset.audioTranscriptionModel
      : provider.audioTranscriptionModel
  const audioSpeechModel =
    preset.audioSpeechModel &&
    (!provider.audioSpeechModel?.trim() ||
      !isLikelyAudioSpeechModel(provider.audioSpeechModel))
      ? preset.audioSpeechModel
      : provider.audioSpeechModel
  const embeddingModel =
    preset.embeddingModel &&
    (!provider.embeddingModel?.trim() ||
      !isLikelyEmbeddingModel(provider.embeddingModel))
      ? preset.embeddingModel
      : provider.embeddingModel
  const moderationModel =
    preset.moderationModel &&
    (!provider.moderationModel?.trim() ||
      !isLikelyModerationModel(provider.moderationModel))
      ? preset.moderationModel
      : provider.moderationModel
  const realtimeModel =
    preset.realtimeModel &&
    (!provider.realtimeModel?.trim() ||
      !isLikelyRealtimeModel(provider.realtimeModel))
      ? preset.realtimeModel
      : provider.realtimeModel

  return {
    audioSpeechModel,
    audioTranscriptionModel,
    embeddingModel,
    imageModel,
    model,
    models,
    moderationModel,
    realtimeModel,
  }
}

export function normalizeOfficialProviderContracts(data: AppData): AppData {
  let changed = false
  const updatedAt = Date.now()
  const normalizedDataUpdatedAt = Math.max(data.updatedAt, updatedAt)
  const providers = data.providers.map((provider) => {
    const normalizedProviderUpdatedAt = Math.max(provider.updatedAt, updatedAt)
    const preset = officialPresetForProvider(provider)
    const customName = clearerCustomProviderName(provider)

    if (!preset) {
      if (customName !== provider.name) {
        changed = true
        return {
          ...provider,
          name: customName,
          updatedAt: normalizedProviderUpdatedAt,
        }
      }

      return provider
    }

    const capabilities = presetCapabilities(preset)
    const needsApiKey = preset.needsApiKey
    const defaults = providerDefaultsFromPreset(provider, preset)
    const providerChanged =
      provider.kind !== preset.kind ||
      provider.model !== defaults.model ||
      provider.needsApiKey !== needsApiKey ||
      provider.audioSpeechModel !== defaults.audioSpeechModel ||
      provider.audioTranscriptionModel !== defaults.audioTranscriptionModel ||
      provider.embeddingModel !== defaults.embeddingModel ||
      provider.imageModel !== defaults.imageModel ||
      provider.moderationModel !== defaults.moderationModel ||
      provider.realtimeModel !== defaults.realtimeModel ||
      !sameStringArray(provider.models, defaults.models) ||
      !sameCapabilities(provider.capabilities, capabilities)

    if (!providerChanged && customName === provider.name) {
      return provider
    }

    changed = true
    return {
      ...provider,
      name: customName,
      kind: preset.kind,
      model: defaults.model,
      audioSpeechModel: defaults.audioSpeechModel,
      audioTranscriptionModel: defaults.audioTranscriptionModel,
      embeddingModel: defaults.embeddingModel,
      capabilities,
      needsApiKey,
      imageModel: defaults.imageModel,
      moderationModel: defaults.moderationModel,
      models: defaults.models,
      realtimeModel: defaults.realtimeModel,
      updatedAt: normalizedProviderUpdatedAt,
    }
  })

  return changed ? { ...data, providers, updatedAt: normalizedDataUpdatedAt } : data
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

export function fallbackCapabilitiesForProvider(
  provider: ProviderConfig,
): ProviderCapability[] {
  if (
    provider.kind === 'openai-compatible' &&
    defaultCustomPresetIdForProvider(provider) === 'custom-openai-relay'
  ) {
    return OPENAI_FULL_CAPABILITIES
  }

  if (provider.capabilities?.length) {
    return provider.capabilities
  }

  const providerName = provider.name.toLowerCase()
  const providerBaseUrl = provider.baseUrl.toLowerCase()

  if (
    providerName === 'openai' ||
    providerBaseUrl.includes('api.openai.com') ||
    providerName.includes('azure openai') ||
    providerName.includes('cloudflare ai gateway')
  ) {
    return OPENAI_FULL_CAPABILITIES
  }

  if (provider.kind === 'anthropic') {
    return ANTHROPIC_CAPABILITIES
  }

  if (provider.kind === 'openai-responses') {
    return OPENAI_RESPONSES_CAPABILITIES
  }

  return OPENAI_COMPATIBLE_CAPABILITIES
}
