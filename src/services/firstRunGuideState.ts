import { providerPresets } from '../data/presets'
import type { Translator } from '../i18n'
import type {
  AppData,
  ProviderConfig,
  ProviderPreset,
} from '../types'
import {
  GUIDE_FEATURED_PROVIDER_IDS,
  browserProviderKey,
  displayProviderName,
  presetById,
  providerForAiRequest,
  shouldUseBrowserProviderKey,
} from './providerConfig'
import {
  audioSpeechModelsForProvider,
  audioTranscriptionModelsForProvider,
  chatModelsForProvider,
  configuredModelsForProvider,
  defaultModelForProvider,
  imageModelsForProvider,
  modelsForProviderCapability,
} from './providerModels'
import {
  providerCheckKey,
  type ProviderConnectivityField,
  type ProviderConnectivityResult,
} from './providerStatus'

export interface FirstRunGuideState {
  guideCanFinish: boolean
  guideCheckingProvider: boolean
  guideModelChoicesVisible: boolean
  guideProviderCardPresets: ProviderPreset[]
  guideProviderKeyHelpUrl?: string
  guideProviderKeyTitle: string
  guideRequirement: string
  guideSyncNote: string
  guideUsesCustomProvider: boolean
  selectedProviderAudioSpeechModels: string[]
  selectedProviderAudioTranscriptionModels: string[]
  selectedProviderChatModels: string[]
  selectedProviderCheckKey: string
  selectedProviderConnectivityField: ProviderConnectivityField
  selectedProviderConnectivityResult?: ProviderConnectivityResult
  selectedProviderConnectivityStatusId?: string
  selectedProviderEmbeddingModels: string[]
  selectedProviderImageModels: string[]
  selectedProviderModerationModels: string[]
  selectedProviderKey: string
  selectedProviderModels: string[]
  selectedProviderRequest: ProviderConfig | null
  selectedProviderRealtimeModels: string[]
}

interface FirstRunGuideStateOptions {
  checkingProviderId: string
  data: AppData | null
  providerConnectivityResults: Record<string, ProviderConnectivityResult>
  providerKeys: Record<string, string>
  selectedPresetId: string
  selectedProvider: ProviderConfig | null
  t: Translator
}

export function deriveFirstRunGuideState({
  checkingProviderId,
  data,
  providerConnectivityResults,
  providerKeys,
  selectedPresetId,
  selectedProvider,
  t,
}: FirstRunGuideStateOptions): FirstRunGuideState {
  const guidePreset = presetById(selectedPresetId)
  const guideFeaturedProviderPresets = providerPresets.filter((preset) =>
    GUIDE_FEATURED_PROVIDER_IDS.has(preset.id),
  )
  const guideProviderCardPresets =
    guidePreset.custom || GUIDE_FEATURED_PROVIDER_IDS.has(guidePreset.id)
      ? guideFeaturedProviderPresets
      : [...guideFeaturedProviderPresets, guidePreset]
  const selectedProviderModels = configuredModelsForProvider(selectedProvider)
  const selectedProviderAudioSpeechModels =
    audioSpeechModelsForProvider(selectedProvider)
  const selectedProviderAudioTranscriptionModels =
    audioTranscriptionModelsForProvider(selectedProvider)
  const selectedProviderChatModels = chatModelsForProvider(selectedProvider)
  const selectedProviderEmbeddingModels = modelsForProviderCapability(
    selectedProvider,
    'embeddings',
  )
  const selectedProviderImageModels = imageModelsForProvider(selectedProvider)
  const selectedProviderModerationModels = modelsForProviderCapability(
    selectedProvider,
    'moderation',
  )
  const selectedProviderRealtimeModels = modelsForProviderCapability(
    selectedProvider,
    'realtime',
  )
  const selectedProviderRequest =
    selectedProvider && data ? providerForAiRequest(selectedProvider, data) : null
  const selectedProviderKey = selectedProviderRequest
    ? browserProviderKey(selectedProviderRequest, providerKeys)
    : ''
  const selectedProviderConnectivityResult = selectedProvider
    ? providerConnectivityResults[selectedProvider.id]
    : undefined
  const selectedProviderCheckKey = selectedProvider
    ? providerCheckKey(selectedProvider.id)
    : ''
  const guideMissingBaseUrl = Boolean(
    selectedProvider && !selectedProvider.baseUrl.trim(),
  )
  const guideMissingModel = Boolean(
    selectedProvider && !defaultModelForProvider(selectedProvider),
  )
  const guideMissingKey = Boolean(
    selectedProviderRequest &&
      shouldUseBrowserProviderKey(selectedProviderRequest) &&
      !selectedProviderKey.trim(),
  )
  const guideRequirement = guideMissingBaseUrl
    ? t('guide.requirement.baseUrl')
    : guideMissingModel
      ? guideMissingKey
        ? t('guide.requirement.modelAndKey')
        : t('guide.requirement.model')
      : guideMissingKey
        ? t('guide.requirement.key')
        : ''
  const guideCheckingProvider = Boolean(
    selectedProvider && checkingProviderId === selectedProviderCheckKey,
  )

  return {
    guideCanFinish: Boolean(
      selectedProvider &&
        !guideMissingBaseUrl &&
        !guideMissingModel &&
        !guideMissingKey,
    ),
    guideCheckingProvider,
    guideModelChoicesVisible: selectedProviderChatModels.length > 1,
    guideProviderCardPresets,
    guideProviderKeyHelpUrl: guidePreset.apiKeyUrl,
    guideProviderKeyTitle: selectedProvider
      ? t('guide.providerKeyTitle', {
          provider: displayProviderName(selectedProvider, t),
        })
      : t('field.providerKey'),
    guideRequirement,
    guideSyncNote:
      data?.sync.mode === 'gist'
        ? t('sync.compare.gist.pro')
        : data?.sync.mode === 'cloudflare'
          ? t('sync.compare.cloudflare.pro')
          : t('guide.localSyncNote'),
    guideUsesCustomProvider: Boolean(
      guidePreset.custom || selectedProvider?.custom,
    ),
    selectedProviderAudioSpeechModels,
    selectedProviderAudioTranscriptionModels,
    selectedProviderChatModels,
    selectedProviderCheckKey,
    selectedProviderConnectivityField:
      selectedProviderConnectivityResult?.tone === 'error'
        ? selectedProviderConnectivityResult.field
        : 'none',
    selectedProviderConnectivityResult,
    selectedProviderConnectivityStatusId: selectedProvider
      ? `provider-connectivity-status-${selectedProvider.id}`
      : undefined,
    selectedProviderEmbeddingModels,
    selectedProviderImageModels,
    selectedProviderModerationModels,
    selectedProviderKey,
    selectedProviderModels,
    selectedProviderRequest,
    selectedProviderRealtimeModels,
  }
}
