import type { Translator } from '../i18n'
import {
  deriveImageComposerChrome,
  type ComposerMode,
  type ImageComposerChrome,
  type ImageTaskMode,
} from './imageComposerChrome'

export type ComposerWelcomeSettingsTab = 'providers' | 'models'

export interface ComposerChromeState {
  activeAudioInputRequirement: string
  activeComposerRequirement: string
  activeImageInputRequirement: string
  composerCanSubmit: boolean
  composerUnavailableReason: string
  image: ImageComposerChrome
  inputPlaceholder: string
  submitAccessibleLabel: string
  submitButtonLabel: string
  submitTitle: string
  welcomeHint: string
  welcomeSettingsTab: ComposerWelcomeSettingsTab
  welcomeSetupRequired: boolean
  welcomeSetupRequirement: string
  welcomeTitle: string
}

interface ComposerChromeOptions {
  activeAudioRequirement: string
  activeChatRequirement: string
  activeImageRequirement: string
  activeProviderAvailable: boolean
  composerMode: ComposerMode
  draft: string
  generationActive: boolean
  audioSourceAvailable: boolean
  imageSourceAvailable: boolean
  imageTaskMode: ImageTaskMode
  maskTouched: boolean
  sendShortcut: string
  t: Translator
  welcomeGenerationRequirement: string
  welcomeModel: string
  welcomeNeedsProviderKey: boolean
  welcomeProviderAvailable: boolean
  welcomeProviderEnabled: boolean
  welcomeProviderKey: string
}

export function deriveComposerChrome({
  activeAudioRequirement,
  activeChatRequirement,
  activeImageRequirement,
  activeProviderAvailable,
  composerMode,
  draft,
  generationActive,
  audioSourceAvailable,
  imageSourceAvailable,
  imageTaskMode,
  maskTouched,
  sendShortcut,
  t,
  welcomeGenerationRequirement,
  welcomeModel,
  welcomeNeedsProviderKey,
  welcomeProviderAvailable,
  welcomeProviderEnabled,
  welcomeProviderKey,
}: ComposerChromeOptions): ComposerChromeState {
  const image = deriveImageComposerChrome({
    imageTaskMode,
    t,
  })
  const activeImageInputRequirement =
    composerMode === 'image' &&
    imageTaskMode !== 'generate' &&
    !imageSourceAvailable
      ? t('notice.imageRequired')
      : composerMode === 'image' &&
          imageTaskMode === 'inpaint' &&
          imageSourceAvailable &&
          !maskTouched
        ? t('notice.maskRequired')
        : ''
  const activeAudioInputRequirement =
    composerMode === 'audio' && !audioSourceAvailable
      ? t('notice.audioRequired')
      : ''
  const activeComposerRequirement =
    composerMode === 'image'
      ? activeImageInputRequirement || activeImageRequirement
      : composerMode === 'audio'
        ? activeAudioInputRequirement || activeAudioRequirement
        : activeChatRequirement
  const inputPlaceholder =
    composerMode === 'image'
      ? image.inputPlaceholder
      : composerMode === 'audio'
        ? t('message.audioTranscriptionPlaceholder')
        : t('message.placeholder')
  const submitActionLabel =
    composerMode === 'image'
      ? image.submitLabel
      : composerMode === 'audio'
        ? t('button.transcribeAudio')
        : t('button.sendMessage')
  const submitTitle = t('button.actionWithShortcut', {
    action: submitActionLabel,
    shortcut: sendShortcut,
  })
  const welcomeSetupRequirement =
    composerMode === 'image'
      ? activeImageRequirement ||
        (!activeProviderAvailable ? welcomeGenerationRequirement : '')
      : composerMode === 'audio'
        ? activeAudioRequirement ||
          (!activeProviderAvailable ? welcomeGenerationRequirement : '')
        : activeChatRequirement ||
          (!activeProviderAvailable ? welcomeGenerationRequirement : '')
  const welcomeSettingsTab: ComposerWelcomeSettingsTab =
    !welcomeProviderAvailable || !welcomeProviderEnabled
      ? 'providers'
      : welcomeNeedsProviderKey && !welcomeProviderKey.trim()
        ? 'providers'
        : !welcomeModel.trim()
          ? 'models'
          : 'providers'

  const composerCanSubmit =
    !generationActive &&
    (composerMode === 'audio' || Boolean(draft.trim())) &&
    !activeComposerRequirement
  const composerUnavailableReason = activeComposerRequirement || inputPlaceholder

  return {
    activeAudioInputRequirement,
    activeComposerRequirement,
    activeImageInputRequirement,
    composerCanSubmit,
    composerUnavailableReason,
    image,
    inputPlaceholder,
    submitAccessibleLabel: composerCanSubmit
      ? submitTitle
      : `${submitTitle}: ${composerUnavailableReason}`,
    submitButtonLabel:
      composerMode === 'image'
        ? image.submitLabel
        : composerMode === 'audio'
          ? t('button.transcribe')
          : t('button.send'),
    submitTitle,
    welcomeHint:
      composerMode === 'image'
        ? welcomeSetupRequirement ||
          activeImageInputRequirement ||
          image.inputPlaceholder
        : composerMode === 'audio'
          ? welcomeSetupRequirement ||
            activeAudioInputRequirement ||
            t('hint.audioTranscription')
        : welcomeSetupRequirement || t('hint.emptyCanSend'),
    welcomeSettingsTab,
    welcomeSetupRequired: Boolean(welcomeSetupRequirement),
    welcomeSetupRequirement,
    welcomeTitle:
      composerMode === 'image'
        ? image.welcomeTitle
        : composerMode === 'audio'
          ? t('welcome.audioTitle')
          : t('welcome.title'),
  }
}
