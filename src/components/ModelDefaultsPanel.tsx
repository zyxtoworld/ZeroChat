import { Check } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import type { Translator } from '../i18n'
import {
  MAX_CHAT_CONTEXT_MESSAGE_LIMIT,
  MIN_CHAT_CONTEXT_MESSAGE_LIMIT,
} from '../services/appData'
import type { ModelCheckKind } from '../services/providerStatus'
import { modelCheckKey } from '../services/providerStatus'
import type { ProviderConfig } from '../types'
import { runLeafAction, type LeafActionResult } from './MessageActionBoundary'

type ModelNoticeTarget =
  | 'model-audio'
  | 'model-audio-speech'
  | 'model-chat'
  | 'model-embedding'
  | 'model-image'
  | 'model-moderation'
  | 'model-realtime'
type TranslationKey = Parameters<Translator>[0]

interface ModelDefaultsPanelProps {
  t: Translator
  selectedProvider: ProviderConfig
  selectedProviderModels: string[]
  selectedProviderAudioSpeechModels: string[]
  selectedProviderAudioTranscriptionModels: string[]
  selectedProviderChatModels: string[]
  selectedProviderEmbeddingModels: string[]
  selectedProviderImageModels: string[]
  selectedProviderModerationModels: string[]
  selectedProviderRealtimeModels: string[]
  chatContextMessageLimit: number
  checkingProviderId: string
  renderFieldNotice: (target: ModelNoticeTarget) => ReactNode
  onSelectAudioSpeechModel: (
    providerId: string,
    value: string,
  ) => void
  onSelectAudioTranscriptionModel: (
    providerId: string,
    value: string,
  ) => void
  onSelectChatModel: (providerId: string, value: string) => void
  onSelectEmbeddingModel: (providerId: string, value: string) => void
  onSelectImageModel: (providerId: string, value: string) => void
  onSelectModerationModel: (providerId: string, value: string) => void
  onSelectRealtimeModel: (providerId: string, value: string) => void
  onCheckModel: (
    providerId: string,
    kind: ModelCheckKind,
  ) => LeafActionResult
  onChangeChatContextMessageLimit: (value: number) => void
  onCommitEditsOnBlur: () => void
}

interface ModelFieldConfig {
  fieldKey: TranslationKey
  hintId: string
  hintKey: TranslationKey
  kind: ModelCheckKind
  models: string[]
  noModelsKey: TranslationKey
  noticeTarget: ModelNoticeTarget
  onSelect: (providerId: string, value: string) => void
  value: string | undefined
}

export function ModelDefaultsPanel({
  t,
  selectedProvider,
  selectedProviderModels,
  selectedProviderAudioSpeechModels,
  selectedProviderAudioTranscriptionModels,
  selectedProviderChatModels,
  selectedProviderEmbeddingModels,
  selectedProviderImageModels,
  selectedProviderModerationModels,
  selectedProviderRealtimeModels,
  chatContextMessageLimit,
  checkingProviderId,
  renderFieldNotice,
  onSelectAudioSpeechModel,
  onSelectAudioTranscriptionModel,
  onSelectChatModel,
  onSelectEmbeddingModel,
  onSelectImageModel,
  onSelectModerationModel,
  onSelectRealtimeModel,
  onCheckModel,
  onChangeChatContextMessageLimit,
  onCommitEditsOnBlur,
}: ModelDefaultsPanelProps): ReactElement {
  const defaultModelHintId = `default-model-hint-${selectedProvider.id}`
  const imageModelHintId = `image-model-hint-${selectedProvider.id}`
  const audioSpeechModelHintId =
    `audio-speech-model-hint-${selectedProvider.id}`
  const audioTranscriptionModelHintId =
    `audio-transcription-model-hint-${selectedProvider.id}`
  const embeddingModelHintId = `embedding-model-hint-${selectedProvider.id}`
  const moderationModelHintId = `moderation-model-hint-${selectedProvider.id}`
  const realtimeModelHintId = `realtime-model-hint-${selectedProvider.id}`
  const modelConnectivityHintId = `model-connectivity-check-hint-${selectedProvider.id}`
  const chatContextHintId = `chat-context-message-limit-hint-${selectedProvider.id}`
  const modelCheckInProgress = Boolean(checkingProviderId)
  const modelFields: ModelFieldConfig[] = [
    {
      fieldKey: 'field.defaultModel',
      hintId: defaultModelHintId,
      hintKey: 'settings.defaultModelHint',
      kind: 'chat',
      models: selectedProviderChatModels,
      noModelsKey: 'option.noChatModels',
      noticeTarget: 'model-chat',
      onSelect: onSelectChatModel,
      value: selectedProvider.model,
    },
    {
      fieldKey: 'field.imageModel',
      hintId: imageModelHintId,
      hintKey: 'settings.imageModelHint',
      kind: 'image',
      models: selectedProviderImageModels,
      noModelsKey: 'option.noImageModels',
      noticeTarget: 'model-image',
      onSelect: onSelectImageModel,
      value: selectedProvider.imageModel,
    },
    {
      fieldKey: 'field.audioSpeechModel',
      hintId: audioSpeechModelHintId,
      hintKey: 'settings.audioSpeechModelHint',
      kind: 'audio-speech',
      models: selectedProviderAudioSpeechModels,
      noModelsKey: 'option.noAudioModels',
      noticeTarget: 'model-audio-speech',
      onSelect: onSelectAudioSpeechModel,
      value: selectedProvider.audioSpeechModel,
    },
    {
      fieldKey: 'field.audioTranscriptionModel',
      hintId: audioTranscriptionModelHintId,
      hintKey: 'settings.audioTranscriptionModelHint',
      kind: 'audio-transcription',
      models: selectedProviderAudioTranscriptionModels,
      noModelsKey: 'option.noAudioModels',
      noticeTarget: 'model-audio',
      onSelect: onSelectAudioTranscriptionModel,
      value: selectedProvider.audioTranscriptionModel,
    },
    {
      fieldKey: 'field.embeddingModel',
      hintId: embeddingModelHintId,
      hintKey: 'settings.embeddingModelHint',
      kind: 'embeddings',
      models: selectedProviderEmbeddingModels,
      noModelsKey: 'option.noEmbeddingModels',
      noticeTarget: 'model-embedding',
      onSelect: onSelectEmbeddingModel,
      value: selectedProvider.embeddingModel,
    },
    {
      fieldKey: 'field.moderationModel',
      hintId: moderationModelHintId,
      hintKey: 'settings.moderationModelHint',
      kind: 'moderation',
      models: selectedProviderModerationModels,
      noModelsKey: 'option.noModerationModels',
      noticeTarget: 'model-moderation',
      onSelect: onSelectModerationModel,
      value: selectedProvider.moderationModel,
    },
    {
      fieldKey: 'field.realtimeModel',
      hintId: realtimeModelHintId,
      hintKey: 'settings.realtimeModelHint',
      kind: 'realtime',
      models: selectedProviderRealtimeModels,
      noModelsKey: 'option.noRealtimeModels',
      noticeTarget: 'model-realtime',
      onSelect: onSelectRealtimeModel,
      value: selectedProvider.realtimeModel,
    },
  ]

  function modelCheckTooltip(
    models: string[],
    noModelsKey: TranslationKey,
    modelChecking: boolean,
  ): string {
    if (modelChecking) {
      return t('button.checking')
    }

    if (models.length === 0) {
      return selectedProviderModels.length
        ? t(noModelsKey)
        : t('option.noConfiguredModels')
    }

    return t('settings.modelConnectivityCheckNote')
  }

  function renderModelField(field: ModelFieldConfig): ReactElement {
    const fieldLabel = t(field.fieldKey)
    const selectedValue =
      field.value && field.models.includes(field.value) ? field.value : ''
    const modelChecking =
      checkingProviderId === modelCheckKey(selectedProvider.id, field.kind)
    const modelCheckLabel = modelChecking
      ? t('button.checking')
      : t('button.checkModel')
    const tooltip = modelCheckTooltip(
      field.models,
      field.noModelsKey,
      modelChecking,
    )
    return (
      <div key={field.kind}>
        <label>
          <span>{fieldLabel}</span>
          <div className="select-action-row">
            <select
              aria-describedby={field.hintId}
              dir="auto"
              value={selectedValue}
              onChange={(event) =>
                field.onSelect(selectedProvider.id, event.target.value)
              }
              onBlur={onCommitEditsOnBlur}
              disabled={field.models.length === 0}
            >
              {field.models.length === 0 ? (
                <option value="">
                  {selectedProviderModels.length
                    ? t(field.noModelsKey)
                    : t('option.noConfiguredModels')}
                </option>
              ) : (
                <>
                  <option value="">{t('option.emptyModel')}</option>
                  {field.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </>
              )}
            </select>
            <span
              className="model-check-tooltip-target"
              data-tooltip={tooltip}
            >
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() =>
                  runLeafAction(onCheckModel, selectedProvider.id, field.kind)
                }
                aria-describedby={modelConnectivityHintId}
                aria-label={`${modelCheckLabel}: ${fieldLabel}`}
                data-model-check-kind={field.kind}
                disabled={field.models.length === 0 || modelCheckInProgress}
              >
                <Check />
                {modelCheckLabel}
              </button>
            </span>
          </div>
          {renderFieldNotice(field.noticeTarget)}
        </label>
        <p id={field.hintId} className="settings-note">
          {t(field.hintKey)}
        </p>
      </div>
    )
  }

  return (
    <>
      {modelFields.map(renderModelField)}

      <p id={modelConnectivityHintId} className="settings-note">
        {t('settings.modelConnectivityCheckNote')}
      </p>

      <label data-chat-context-setting="true">
        <span>{t('field.chatContextMessageLimit')}</span>
        <input
          type="number"
          min={MIN_CHAT_CONTEXT_MESSAGE_LIMIT}
          max={MAX_CHAT_CONTEXT_MESSAGE_LIMIT}
          step={1}
          value={chatContextMessageLimit}
          onChange={(event) =>
            onChangeChatContextMessageLimit(
              Number.parseInt(event.target.value, 10),
            )
          }
          onBlur={onCommitEditsOnBlur}
          inputMode="numeric"
          aria-describedby={chatContextHintId}
        />
      </label>
      <p
        id={chatContextHintId}
        className="settings-note"
        data-chat-context-window-note="true"
      >
        {t('settings.chatContextWindowNote', {
          count: chatContextMessageLimit,
        })}
      </p>
    </>
  )
}
