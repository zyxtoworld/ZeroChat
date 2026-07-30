import { ChevronDown } from 'lucide-react'
import type {
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'

import type { Translator } from '../i18n'
import { displayProviderName } from '../services/providerConfig'
import type {
  ComposerMode,
  ImageTaskMode,
} from '../services/imageComposerChrome'
import {
  audioTranscriptionModelsForProvider,
  chatModelsForProvider,
  configuredModelsForProvider,
  imageEditingModelsForProvider,
  imageModelsForProvider,
  modelForProviderCapability,
  modelForProviderAudioTranscription,
} from '../services/providerModels'
import type { ProviderConfig } from '../types'

interface ChatProviderModelMenuProps {
  activeImageModel: string
  activeModel: string
  activeModelLabel: string
  activeProvider: ProviderConfig | null
  activeProviderLabel: string
  chatModelMenuOpen: boolean
  chatModelMenuRef: RefObject<HTMLDivElement | null>
  chatModelProviders: ProviderConfig[]
  chatModelTriggerRef: RefObject<HTMLButtonElement | null>
  composerMode: ComposerMode
  expandedChatProviderId: string
  imageTaskMode: ImageTaskMode
  providerModelHint: ReactNode
  t: Translator
  onSelectAudioTranscriptionModel: (providerId: string, model: string) => void
  onSelectChatModel: (providerId: string, model: string) => void
  onSelectImageModel: (providerId: string, model: string) => void
  onToggleModelMenu: () => void
  onToggleProviderExpanded: (providerId: string, expanded: boolean) => void
}

export function ChatProviderModelMenu({
  activeImageModel,
  activeModel,
  activeModelLabel,
  activeProvider,
  activeProviderLabel,
  chatModelMenuOpen,
  chatModelMenuRef,
  chatModelProviders,
  chatModelTriggerRef,
  composerMode,
  expandedChatProviderId,
  imageTaskMode,
  providerModelHint,
  t,
  onSelectAudioTranscriptionModel,
  onSelectChatModel,
  onSelectImageModel,
  onToggleModelMenu,
  onToggleProviderExpanded,
}: ChatProviderModelMenuProps): ReactElement {
  const imageMode = composerMode === 'image'
  const imageEditingMode = imageMode && imageTaskMode !== 'generate'
  const audioMode = composerMode === 'audio'
  const activeSelectableModel =
    imageMode
      ? imageEditingMode
        ? modelForProviderCapability(activeProvider, 'image-editing')
        : activeImageModel
      : audioMode
        ? modelForProviderAudioTranscription(activeProvider)
        : activeModel
  const selectModel =
    imageMode
      ? onSelectImageModel
      : audioMode
        ? onSelectAudioTranscriptionModel
        : onSelectChatModel
  const menuId = 'pm'

  return (
    <div className="header-controls" ref={chatModelMenuRef}>
      <button
        ref={chatModelTriggerRef}
        className="provider-model-trigger"
        type="button"
        aria-label={t('field.providerModel')}
        aria-controls={menuId}
        aria-expanded={chatModelMenuOpen}
        aria-haspopup="menu"
        onClick={onToggleModelMenu}
      >
        <span className="provider-model-trigger-text">
          <strong>{activeProviderLabel}</strong>
          <span>{activeModelLabel}</span>
        </span>
        <ChevronDown size={17} />
      </button>
      {chatModelMenuOpen ? (
        <div className="provider-model-menu" id={menuId} role="menu">
          {providerModelHint}
          {chatModelProviders.length ? (
            chatModelProviders.map((provider) => {
              const providerId = provider.id
              const providerName = displayProviderName(provider, t)
              const providerModels =
                imageMode
                  ? imageEditingMode
                    ? imageEditingModelsForProvider(provider)
                    : imageModelsForProvider(provider)
                  : audioMode
                    ? audioTranscriptionModelsForProvider(provider)
                    : chatModelsForProvider(provider)
              const configuredModelCount =
                configuredModelsForProvider(provider).length
              const expanded = expandedChatProviderId === providerId
              const providerOptionsId = `pm-${providerId}`
              const emptyModelLabel = configuredModelCount
                ? imageMode
                  ? t('option.noImageModels')
                  : audioMode
                    ? t('option.noAudioModels')
                    : t('option.noChatModels')
                : t('option.noConfiguredModels')

              return (
                <div className="provider-model-group" key={providerId}>
                  <button
                    className="provider-model-provider"
                    type="button"
                    role="menuitem"
                    aria-controls={providerOptionsId}
                    aria-expanded={expanded}
                    onClick={() =>
                      onToggleProviderExpanded(providerId, expanded)
                    }
                  >
                    <span>
                      <strong>{providerName}</strong>
                      <small>
                        {providerModels.length
                          ? t('settings.modelCount', {
                              count: providerModels.length,
                            })
                          : emptyModelLabel}
                      </small>
                    </span>
                    <ChevronDown size={16} />
                  </button>
                  {expanded ? (
                    <div className="provider-model-options" id={providerOptionsId}>
                      {providerModels.length ? (
                        providerModels.map((model) => {
                          const selected =
                            providerId === activeProvider?.id &&
                            model === activeSelectableModel
                          const label = providerName + ': ' + model

                          return (
                            <button
                              className={`provider-model-option${
                                selected ? ' active' : ''
                              }`}
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              aria-label={label}
                              data-tooltip={label}
                              key={model}
                              onClick={() => selectModel(providerId, model)}
                            >
                              {model}
                            </button>
                          )
                        })
                      ) : (
                        <p>{emptyModelLabel}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })
          ) : (
            <p className="provider-model-empty">
              {t('option.noEnabledProviders')}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
