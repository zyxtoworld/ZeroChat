import type {
  DragEvent,
  KeyboardEvent,
  ReactElement,
  ReactNode,
} from 'react'
import type { Translator } from '../i18n'
import type { ModelCheckKind } from '../services/providerStatus'
import type { ProviderConfig } from '../types'
import { ModelCatalogEditor } from './ModelCatalogEditor'
import { ModelDefaultsPanel } from './ModelDefaultsPanel'
import { ModelProviderList } from './ModelProviderList'

interface ModelSettingsPanelProps {
  t: Translator
  visibleProviders: ProviderConfig[]
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
  loadingModelsProviderId: string
  editingModelProviderId: string
  editingModelSource: string
  editingModelDraft: string
  modelDraftProviderId: string
  modelDraft: string
  renderFieldNotice: (
    target:
      | 'model-audio'
      | 'model-audio-speech'
      | 'model-chat'
      | 'model-embedding'
      | 'model-image'
      | 'model-moderation'
      | 'model-realtime',
  ) => ReactNode
  renderNotice: (target: 'models') => ReactNode
  onSelectProvider: (providerId: string) => void
  onSelectAudioTranscriptionModel: (
    providerId: string,
    value: string,
  ) => void
  onSelectAudioSpeechModel: (
    providerId: string,
    value: string,
  ) => void
  onSelectChatModel: (providerId: string, value: string) => void
  onSelectEmbeddingModel: (
    providerId: string,
    value: string,
  ) => void
  onSelectImageModel: (providerId: string, value: string) => void
  onSelectModerationModel: (
    providerId: string,
    value: string,
  ) => void
  onSelectRealtimeModel: (
    providerId: string,
    value: string,
  ) => void
  onCheckModel: (
    providerId: string,
    kind: ModelCheckKind,
  ) => void | Promise<void>
  onChangeChatContextMessageLimit: (value: number) => void
  onRefreshModels: (providerId: string) => void | Promise<void>
  onBeginEditProviderModel: (providerId: string, model: string) => void
  onEditingModelDraftChange: (value: string) => void
  onCommitProviderModelRename: (providerId: string, sourceModel: string) => void
  onModelRenameKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    providerId: string,
    sourceModel: string,
  ) => void
  onClearModelRenameDraft: () => void
  onRemoveProviderModel: (
    providerId: string,
    model: string,
  ) => void | Promise<void>
  onModelDragStart: (event: DragEvent<HTMLElement>, model: string) => void
  onModelDrop: (
    event: DragEvent<HTMLElement>,
    providerId: string,
    targetModel: string,
  ) => void
  onMoveProviderModel: (
    providerId: string,
    model: string,
    direction: 'up' | 'down',
  ) => void
  onModelDraftChange: (providerId: string, value: string) => void
  onModelDraftKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    providerId: string,
  ) => void
  onCommitModelDraft: (providerId: string) => void
  onCommitEditsOnBlur: () => void
}

export function ModelSettingsPanel({
  t,
  visibleProviders,
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
  loadingModelsProviderId,
  editingModelProviderId,
  editingModelSource,
  editingModelDraft,
  modelDraftProviderId,
  modelDraft,
  renderFieldNotice,
  renderNotice,
  onSelectProvider,
  onSelectAudioSpeechModel,
  onSelectAudioTranscriptionModel,
  onSelectChatModel,
  onSelectEmbeddingModel,
  onSelectImageModel,
  onSelectModerationModel,
  onSelectRealtimeModel,
  onCheckModel,
  onChangeChatContextMessageLimit,
  onRefreshModels,
  onBeginEditProviderModel,
  onEditingModelDraftChange,
  onCommitProviderModelRename,
  onModelRenameKeyDown,
  onClearModelRenameDraft,
  onRemoveProviderModel,
  onModelDragStart,
  onModelDrop,
  onMoveProviderModel,
  onModelDraftChange,
  onModelDraftKeyDown,
  onCommitModelDraft,
  onCommitEditsOnBlur,
}: ModelSettingsPanelProps): ReactElement {
  return (
    <div
      id="settings-panel-models"
      className="settings-grid"
      role="tabpanel"
      aria-labelledby="settings-tab-models"
    >
      <ModelProviderList
        t={t}
        visibleProviders={visibleProviders}
        selectedProviderId={selectedProvider.id}
        onSelectProvider={onSelectProvider}
      />

      <div className="form-stack">
        <ModelDefaultsPanel
          t={t}
          selectedProvider={selectedProvider}
          selectedProviderModels={selectedProviderModels}
          selectedProviderAudioSpeechModels={selectedProviderAudioSpeechModels}
          selectedProviderAudioTranscriptionModels={
            selectedProviderAudioTranscriptionModels
          }
          selectedProviderChatModels={selectedProviderChatModels}
          selectedProviderEmbeddingModels={selectedProviderEmbeddingModels}
          selectedProviderImageModels={selectedProviderImageModels}
          selectedProviderModerationModels={selectedProviderModerationModels}
          selectedProviderRealtimeModels={selectedProviderRealtimeModels}
          chatContextMessageLimit={chatContextMessageLimit}
          checkingProviderId={checkingProviderId}
          renderFieldNotice={renderFieldNotice}
          onSelectAudioSpeechModel={onSelectAudioSpeechModel}
          onSelectAudioTranscriptionModel={onSelectAudioTranscriptionModel}
          onSelectChatModel={onSelectChatModel}
          onSelectEmbeddingModel={onSelectEmbeddingModel}
          onSelectImageModel={onSelectImageModel}
          onSelectModerationModel={onSelectModerationModel}
          onSelectRealtimeModel={onSelectRealtimeModel}
          onCheckModel={onCheckModel}
          onChangeChatContextMessageLimit={onChangeChatContextMessageLimit}
          onCommitEditsOnBlur={onCommitEditsOnBlur}
        />

        <ModelCatalogEditor
          t={t}
          selectedProvider={selectedProvider}
          selectedProviderModels={selectedProviderModels}
          loadingModelsProviderId={loadingModelsProviderId}
          editingModelProviderId={editingModelProviderId}
          editingModelSource={editingModelSource}
          editingModelDraft={editingModelDraft}
          modelDraftProviderId={modelDraftProviderId}
          modelDraft={modelDraft}
          renderNotice={renderNotice}
          onRefreshModels={onRefreshModels}
          onBeginEditProviderModel={onBeginEditProviderModel}
          onEditingModelDraftChange={onEditingModelDraftChange}
          onCommitProviderModelRename={onCommitProviderModelRename}
          onModelRenameKeyDown={onModelRenameKeyDown}
          onClearModelRenameDraft={onClearModelRenameDraft}
          onRemoveProviderModel={onRemoveProviderModel}
          onModelDragStart={onModelDragStart}
          onModelDrop={onModelDrop}
          onMoveModel={onMoveProviderModel}
          onModelDraftChange={onModelDraftChange}
          onModelDraftKeyDown={onModelDraftKeyDown}
          onCommitModelDraft={onCommitModelDraft}
          onCommitEditsOnBlur={onCommitEditsOnBlur}
        />
      </div>
    </div>
  )
}
