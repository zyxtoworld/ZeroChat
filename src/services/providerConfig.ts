import {
  ANTHROPIC_CAPABILITIES,
  OPENAI_DEFAULT_CHAT_MODEL,
  OPENAI_COMPATIBLE_CAPABILITIES,
  OPENAI_FULL_CAPABILITIES,
  OPENAI_RESPONSES_CAPABILITIES,
  presetCapabilities,
  providerPresets,
} from '../data/presets'
import {
  providerKindLabel,
  providerPresetLabel,
  type TranslationKey,
  type Translator,
} from '../i18n'
import type {
  AppData,
  Conversation,
  ProviderCapability,
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
  clearerCustomProviderName as clearerCustomProviderNameFromAliases,
  defaultCustomPresetIdForName,
} from './providerCustomNames'
import { workerProxyUrlFromSync } from './providerProxyHosts'
import { providerNeedsBrowserKey } from './providerRequestMode'

export { normalizeProviderName } from './providerCustomNames'
export {
  managedProxyHostGroups,
  managedProxyHostSignature,
  replaceManagedProxyHosts,
  safeRemoteUrlForProxyHostManagement,
  workerProxyUrlFromSync,
} from './providerProxyHosts'
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

export function clearerCustomProviderName(provider: ProviderConfig): string {
  return clearerCustomProviderNameFromAliases(provider)
}

export function sameCapabilities(
  left: ProviderCapability[] | undefined,
  right: ProviderCapability[],
): boolean {
  return (
    (left ?? []).length === right.length &&
    right.every((capability, index) => left?.[index] === capability)
  )
}

export function sameStringArray(
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

export function capabilityLabel(
  capability: ProviderCapability,
  t: Translator,
): string {
  return t(`capability.${capability}` as TranslationKey)
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

export function orderedProviders(
  providers: ProviderConfig[],
): ProviderConfig[] {
  return [
    ...providers.filter((provider) => provider.enabled),
    ...providers.filter((provider) => !provider.enabled),
  ]
}

export function reorderProviders(
  providers: ProviderConfig[],
  sourceId: string,
  targetId: string,
): ProviderConfig[] {
  if (!sourceId || sourceId === targetId) {
    return providers
  }

  const sourceIndex = providers.findIndex((provider) => provider.id === sourceId)
  const targetIndex = providers.findIndex((provider) => provider.id === targetId)

  if (sourceIndex < 0 || targetIndex < 0) {
    return providers
  }

  const nextProviders = [...providers]
  const [movedProvider] = nextProviders.splice(sourceIndex, 1)

  if (!movedProvider) {
    return providers
  }

  nextProviders.splice(targetIndex, 0, movedProvider)
  return orderedProviders(nextProviders)
}
