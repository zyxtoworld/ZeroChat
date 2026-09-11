import {
  presetCapabilities,
  providerPresets,
} from '../data/presets'
import {
  providerKindLabel,
  providerPresetLabel,
  type Translator,
} from '../i18n'
import type {
  Conversation,
  ProviderConfig,
  ProviderPreset,
} from '../types'
import {
  chatModelsForProvider,
  configuredModelsForProvider,
  isLikelyAudioSpeechModel,
  isLikelyAudioTranscriptionModel,
  isLikelyEmbeddingModel,
  isLikelyImageEditingModel,
  isLikelyImageModel,
  isLikelyModerationModel,
  isLikelyRealtimeModel,
  preferredChatModel,
  uniqueModels,
} from './providerModels'
import {
  fallbackCapabilitiesForProvider,
  defaultPresetIdForProviderName,
  presetById,
  shouldUseBrowserProviderKey,
} from './providerConfigCore'

export {
  browserProviderKey,
  capabilityLabel,
  clearerCustomProviderName,
  defaultCustomPresetIdForProvider,
  defaultPresetIdForProviderName,
  fallbackCapabilitiesForProvider,
  normalizeOfficialProviderContracts,
  officialPresetForProvider,
  preferredProviderId,
  presetById,
  presetIdForProvider,
  providerDefaultsFromPreset,
  providerForAiRequest,
  reorderProviders,
  shouldUseBrowserProviderKey,
  workerProxyUrlFromSync,
} from './providerConfigCore'

export { normalizeProviderName } from './providerCustomNames'
export type { ManagedProxyHostGroup } from './providerProxyHosts'

export type ProviderStatusTone = 'success' | 'warning' | 'error' | 'muted'

export interface ProviderListStatus {
  label: string
  tone: ProviderStatusTone
}

export interface ProviderConnectivitySummary {
  tone: 'success' | 'warning' | 'error'
}

export const GUIDE_FEATURED_PROVIDER_IDS = new Set([
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'xai',
  'openrouter',
])

export function displayProviderName(
  provider: ProviderConfig,
  t: Translator,
): string {
  const presetId = defaultPresetIdForProviderName(provider)

  if (!presetId) {
    return provider.name
  }

  const preset = presetById(presetId)
  return providerPresetLabel(preset.id, preset.name, t)
}

export function providerAccentIdForPresetId(presetId: string): string {
  return presetId === 'cloudflare-ai-gateway-openai'
    ? 'cloudflare-ai-gateway'
    : presetId
}

export function providerAccentId(provider: ProviderConfig): string {
  const presetId = defaultPresetIdForProviderName(provider)

  if (presetId) {
    return providerAccentIdForPresetId(presetId)
  }

  const matchingPreset = providerPresets.find(
    (preset) => !preset.custom && preset.baseUrl === provider.baseUrl,
  )

  if (matchingPreset) {
    return providerAccentIdForPresetId(matchingPreset.id)
  }

  if (provider.kind === 'anthropic') {
    return 'custom-anthropic-relay'
  }

  if (provider.kind === 'openai-responses') {
    return 'custom-responses-relay'
  }

  return 'custom-openai-relay'
}

export function providerPresetBadgeText(
  preset: ProviderPreset,
  t: Translator,
): string {
  const label = providerPresetLabel(preset.id, preset.name, t).trim()
  const asciiInitial = label.match(/[A-Za-z0-9]/)?.[0]
  const firstCharacter = Array.from(label)[0] ?? '?'

  return (asciiInitial ?? firstCharacter).toLocaleUpperCase()
}

export function providerPresetMeta(
  preset: ProviderPreset,
  t: Translator,
): string {
  const modelCount = uniqueModels([
    preset.model,
    preset.imageModel ?? '',
    preset.audioSpeechModel ?? '',
    preset.audioTranscriptionModel ?? '',
    preset.embeddingModel ?? '',
    preset.moderationModel ?? '',
    preset.realtimeModel ?? '',
  ]).length
  const modelLabel = modelCount
    ? t('settings.modelCount', { count: modelCount })
    : t('option.noConfiguredModels')

  return `${providerKindLabel(preset.kind, t)} · ${modelLabel}`
}

export function providerBadgeText(
  provider: ProviderConfig,
  t: Translator,
): string {
  const label = displayProviderName(provider, t).trim()
  const asciiInitial = label.match(/[A-Za-z0-9]/)?.[0]
  const firstCharacter = Array.from(label)[0] ?? '?'

  return (asciiInitial ?? firstCharacter).toLocaleUpperCase()
}

export function presetProviderPatch(
  preset: ProviderPreset,
  name = preset.name,
): Partial<ProviderConfig> {
  return {
    name,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    model: preset.model,
    imageModel: preset.imageModel,
    audioSpeechModel: preset.audioSpeechModel,
    audioTranscriptionModel: preset.audioTranscriptionModel,
    embeddingModel: preset.embeddingModel,
    moderationModel: preset.moderationModel,
    realtimeModel: preset.realtimeModel,
    models: uniqueModels([
      preset.model,
      preset.imageModel ?? '',
      preset.audioSpeechModel ?? '',
      preset.audioTranscriptionModel ?? '',
      preset.embeddingModel ?? '',
      preset.moderationModel ?? '',
      preset.realtimeModel ?? '',
    ]),
    capabilities: presetCapabilities(preset),
    needsApiKey: preset.needsApiKey,
    custom: preset.custom,
    proxyUrl: undefined,
    clientRequestMode: undefined,
  }
}

export function providerListMeta(
  provider: ProviderConfig,
  t: Translator,
): string {
  const modelCount = configuredModelsForProvider(provider).length
  const modelLabel = modelCount
    ? t('settings.modelCount', { count: modelCount })
    : t('option.noConfiguredModels')

  return `${providerKindLabel(provider.kind, t)} · ${modelLabel}`
}

export function providerListStatus(
  provider: ProviderConfig,
  requestProvider: ProviderConfig,
  providerKey: string,
  result: ProviderConnectivitySummary | undefined,
  t: Translator,
): ProviderListStatus {
  if (!provider.enabled) {
    return { label: t('status.providerDisabled'), tone: 'muted' }
  }

  if (result?.tone === 'success') {
    return { label: t('status.providerConnected'), tone: 'success' }
  }

  if (result?.tone === 'error') {
    return { label: t('status.providerCheckFailed'), tone: 'error' }
  }

  if (shouldUseBrowserProviderKey(requestProvider) && !providerKey.trim()) {
    return { label: t('status.providerNeedsKey'), tone: 'warning' }
  }

  return { label: t('status.providerNotChecked'), tone: 'muted' }
}

export function modelForConversation(
  conversation: Conversation | null,
  provider: ProviderConfig | null,
): string {
  const models = chatModelsForProvider(provider)

  if (!models.length) {
    return ''
  }

  if (conversation?.model && models.includes(conversation.model)) {
    return conversation.model
  }

  if (provider?.model && models.includes(provider.model)) {
    return provider.model
  }

  return preferredChatModel(models)
}

function hasConfiguredEndpointModel(
  provider: ProviderConfig,
  isLikelyModel: (model: string) => boolean,
): boolean {
  return configuredModelsForProvider(provider).some(isLikelyModel)
}

export function endpointLabelsForProvider(provider: ProviderConfig): string[] {
  const endpoints =
    provider.kind === 'anthropic'
      ? ['/messages', '/models']
      : provider.kind === 'openai-responses'
        ? ['/responses', '/models']
        : ['/chat/completions', '/models']
  const capabilities = new Set(fallbackCapabilitiesForProvider(provider))

  if (
    capabilities.has('image-generation') &&
    hasConfiguredEndpointModel(provider, isLikelyImageModel)
  ) {
    endpoints.push('/images/generations')
  }

  if (
    capabilities.has('image-editing') &&
    hasConfiguredEndpointModel(provider, isLikelyImageEditingModel)
  ) {
    endpoints.push('/images/edits')
  }

  if (
    capabilities.has('audio') &&
    hasConfiguredEndpointModel(provider, isLikelyAudioSpeechModel)
  ) {
    endpoints.push('/audio/speech')
  }

  if (
    capabilities.has('audio') &&
    hasConfiguredEndpointModel(provider, isLikelyAudioTranscriptionModel)
  ) {
    endpoints.push('/audio/transcriptions')
  }

  if (
    capabilities.has('realtime') &&
    hasConfiguredEndpointModel(provider, isLikelyRealtimeModel)
  ) {
    endpoints.push('/realtime')
    endpoints.push('/realtime/client_secrets')
  }

  if (
    capabilities.has('embeddings') &&
    hasConfiguredEndpointModel(provider, isLikelyEmbeddingModel)
  ) {
    endpoints.push('/embeddings')
  }

  if (
    capabilities.has('moderation') &&
    hasConfiguredEndpointModel(provider, isLikelyModerationModel)
  ) {
    endpoints.push('/moderations')
  }

  return uniqueModels(endpoints)
}
