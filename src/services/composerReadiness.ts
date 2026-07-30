import type { Translator } from '../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../types'
import { generationRequirementForAvailability } from './generationRequirements'
import type { ComposerMode, ImageTaskMode } from './imageComposerChrome'
import {
  defaultModelForProvider,
  imageModelForProvider,
  modelForProviderCapability,
  modelForProviderAudioTranscription,
} from './providerModels'
import {
  browserProviderKey,
  displayProviderName,
  providerForAiRequest,
  shouldUseBrowserProviderKey,
} from './providerConfig'

export interface ComposerReadinessState {
  activeAudioRequirement: string
  activeChatRequirement: string
  activeImageRequirement: string
  activeModelLabel: string
  activeProviderAvailable: boolean
  activeProviderLabel: string
  welcomeGenerationRequirement: string
  welcomeModel: string
  welcomeNeedsProviderKey: boolean
  welcomeProviderAvailable: boolean
  welcomeProviderEnabled: boolean
  welcomeProviderKey: string
}

interface ComposerReadinessOptions {
  activeImageModel: string
  activeModel: string
  activeProvider: ProviderConfig | null
  composerMode: ComposerMode
  data: AppData
  enabledChatProviders: ProviderConfig[]
  imageTaskMode?: ImageTaskMode
  providerKeys: Record<string, string>
  proxyTokenAvailable: boolean
  t: Translator
}

export function deriveComposerReadiness({
  activeImageModel,
  activeModel,
  activeProvider,
  composerMode,
  data,
  enabledChatProviders,
  imageTaskMode,
  providerKeys,
  proxyTokenAvailable,
  t,
}: ComposerReadinessOptions): ComposerReadinessState {
  const imageCapability =
    imageTaskMode && imageTaskMode !== 'generate'
      ? 'image-editing'
      : 'image-generation'
  const activeProviderRequest = activeProvider
    ? providerForAiRequest(activeProvider, data)
    : null
  const activeProviderKey = activeProviderRequest
    ? browserProviderKey(activeProviderRequest, providerKeys)
    : ''
  const activeProviderLabel = activeProvider
    ? displayProviderName(activeProvider, t)
    : t('field.provider')
  const activeTaskImageModel = activeProvider
    ? modelForProviderCapability(activeProvider, imageCapability)
    : activeImageModel
  const activeModelLabel =
    composerMode === 'image'
      ? activeTaskImageModel || t('option.noImageModels')
      : composerMode === 'audio'
        ? activeProvider
          ? modelForProviderAudioTranscription(activeProvider) ||
            t('option.noAudioModels')
          : t('option.noAudioModels')
        : activeModel || t('option.emptyModel')
  const activeChatRequirement = activeProviderRequest
    ? generationRequirementForAvailability({
        provider: activeProviderRequest,
        model: activeModel,
        providerKey: activeProviderKey,
        proxyTokenAvailable,
        t,
      })
    : ''
  const activeAudioRequirement = activeProviderRequest
    ? generationRequirementForAvailability({
        provider: activeProviderRequest,
        model: activeProvider
          ? modelForProviderAudioTranscription(activeProvider)
          : '',
        providerKey: activeProviderKey,
        proxyTokenAvailable,
        t,
      })
    : ''
  const activeImageRequirement = activeProviderRequest
    ? generationRequirementForAvailability({
        provider: activeProviderRequest,
        model: activeTaskImageModel,
        providerKey: activeProviderKey,
        proxyTokenAvailable,
        t,
      })
    : ''
  const welcomeProvider = activeProvider ?? enabledChatProviders[0] ?? null
  const welcomeProviderRequest = welcomeProvider
    ? providerForAiRequest(welcomeProvider, data)
    : null
  const welcomeProviderKey = welcomeProviderRequest
    ? browserProviderKey(welcomeProviderRequest, providerKeys)
    : ''
  const welcomeModel =
    composerMode === 'image'
      ? imageCapability === 'image-editing'
        ? modelForProviderCapability(welcomeProvider, 'image-editing')
        : imageModelForProvider(welcomeProvider)
      : composerMode === 'audio'
        ? modelForProviderAudioTranscription(welcomeProvider)
        : activeProvider
          ? activeModel
          : defaultModelForProvider(welcomeProvider)
  const welcomeGenerationRequirement = welcomeProviderRequest
    ? generationRequirementForAvailability({
        provider: welcomeProviderRequest,
        model: welcomeModel,
        providerKey: welcomeProviderKey,
        proxyTokenAvailable,
        t,
      })
    : t('option.noEnabledProviders')

  return {
    activeChatRequirement,
    activeAudioRequirement,
    activeImageRequirement,
    activeModelLabel,
    activeProviderAvailable: Boolean(activeProvider),
    activeProviderLabel,
    welcomeGenerationRequirement,
    welcomeModel,
    welcomeNeedsProviderKey: shouldUseBrowserProviderKey(welcomeProviderRequest),
    welcomeProviderAvailable: Boolean(welcomeProvider),
    welcomeProviderEnabled: Boolean(welcomeProvider?.enabled),
    welcomeProviderKey,
  }
}
