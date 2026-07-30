import { ChevronDown, RefreshCw, X } from 'lucide-react'
import type {
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
} from 'react'

import type { Translator } from '../i18n'
import type { TranslationKey } from '../i18nTypes'
import { setDataTransferDropEffect } from '../services/dragDropEffects'
import { modelCapabilitiesForModel } from '../services/providerModels'
import type { ProviderConfig } from '../types'
import { runLeafAction, type LeafActionResult } from './MessageActionBoundary'

interface ModelCatalogEditorProps {
  t: Translator
  selectedProvider: ProviderConfig
  selectedProviderModels: string[]
  loadingModelsProviderId: string
  editingModelProviderId: string
  editingModelSource: string
  editingModelDraft: string
  modelDraftProviderId: string
  modelDraft: string
  renderNotice: (target: 'models') => ReactNode
  onRefreshModels: (providerId: string) => LeafActionResult
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
  ) => LeafActionResult
  onModelDragStart: (event: DragEvent<HTMLElement>, model: string) => void
  onModelDrop: (
    event: DragEvent<HTMLElement>,
    providerId: string,
    targetModel: string,
  ) => void
  onMoveModel: (
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

export function ModelCatalogEditor({
  t,
  selectedProvider,
  selectedProviderModels,
  loadingModelsProviderId,
  editingModelProviderId,
  editingModelSource,
  editingModelDraft,
  modelDraftProviderId,
  modelDraft,
  renderNotice,
  onRefreshModels,
  onBeginEditProviderModel,
  onEditingModelDraftChange,
  onCommitProviderModelRename,
  onModelRenameKeyDown,
  onClearModelRenameDraft,
  onRemoveProviderModel,
  onModelDragStart,
  onModelDrop,
  onMoveModel,
  onModelDraftChange,
  onModelDraftKeyDown,
  onCommitModelDraft,
  onCommitEditsOnBlur,
}: ModelCatalogEditorProps): ReactElement {
  const currentModelDraft =
    modelDraftProviderId === selectedProvider.id ? modelDraft : ''
  const canCommitModelDraft = currentModelDraft.trim().length > 0
  const modelListHintId = `model-list-hint-${selectedProvider.id}`
  const modelFetchInProgress = Boolean(loadingModelsProviderId)
  const modelFetchCurrent = loadingModelsProviderId === selectedProvider.id
  const modelAddTooltip = canCommitModelDraft
    ? t('button.addModel')
    : t('settings.modelListNote')
  const modelFetchTooltip = modelFetchCurrent
    ? t('button.fetchingModels')
    : t('button.fetchModels')
  const preventModelButtonBlur = (
    event: MouseEvent<HTMLButtonElement>,
  ): void => {
    event.preventDefault()
  }
  const commitModelMove = (model: string, direction: 'up' | 'down'): void => {
    onClearModelRenameDraft()
    onMoveModel(selectedProvider.id, model, direction)
    onCommitEditsOnBlur()
  }

  return (
    <>
      <div className="field-label-row">
        <span>{t('field.models')}</span>
        <span
          className="model-fetch-tooltip-target"
          data-tooltip={modelFetchTooltip}
        >
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={() => runLeafAction(onRefreshModels, selectedProvider.id)}
            aria-describedby={modelListHintId}
            data-model-fetch-button="settings"
            disabled={modelFetchInProgress}
          >
            <RefreshCw
              className={modelFetchCurrent ? 'spin' : ''}
            />
            {modelFetchTooltip}
          </button>
        </span>
      </div>
      {renderNotice('models')}

      <div className="model-list-editor">
        <div className="model-list-editor-box">
          <div
            className="model-chip-list"
            role="group"
            aria-label={`${selectedProvider.name}: ${t('field.models')}`}
            aria-describedby={modelListHintId}
          >
            {selectedProviderModels.map((model, index) => {
              const editing =
                editingModelProviderId === selectedProvider.id &&
                editingModelSource === model
              const editValue = editing ? editingModelDraft : model
              const modelCapabilities = modelCapabilitiesForModel(model)
              const capabilityLabels = modelCapabilities.map((capability) =>
                t(`capability.${capability}` as TranslationKey),
              )
              const capabilitySummary = capabilityLabels.join(' / ')
              const modelDragLabel = `${model}: ${t('settings.dragModelHint')}`
              const modelNameLabel = `${t('field.modelName')}: ${model}`
              const deleteModelLabel = `${t('button.deleteModel')}: ${model}`
              return (
                <div
                  key={model}
                  className={`model-chip ${
                    model === selectedProvider.model ||
                    model === selectedProvider.imageModel
                      ? 'active'
                      : ''
                  }`}
                  role="group"
                  aria-label={modelDragLabel}
                  draggable
                  data-model-capabilities={modelCapabilities.join(' ')}
                  onDragStart={(event) => onModelDragStart(event, model)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDataTransferDropEffect(event.dataTransfer, 'move')
                  }}
                  onDrop={(event) =>
                    onModelDrop(event, selectedProvider.id, model)
                  }
                >
                  <input
                    className="model-chip-edit"
                    dir="auto"
                    spellCheck={false}
                    value={editValue}
                    onFocus={() =>
                      onBeginEditProviderModel(selectedProvider.id, model)
                    }
                    onChange={(event) =>
                      onEditingModelDraftChange(event.target.value)
                    }
                    onBlur={() => {
                      onCommitProviderModelRename(selectedProvider.id, model)
                      onCommitEditsOnBlur()
                    }}
                    onKeyDown={(event) =>
                      onModelRenameKeyDown(event, selectedProvider.id, model)
                    }
                    aria-label={modelNameLabel}
                    aria-describedby={modelListHintId}
                    style={{
                      width: `${Math.min(
                        Math.max(editValue.length + 1, 8),
                        38,
                      )}ch`,
                    }}
                  />
                  {modelCapabilities.length > 0 ? (
                    <span
                      className="model-chip-capabilities"
                      role="list"
                      aria-label={`${model}: ${capabilitySummary}`}
                    >
                      {modelCapabilities.map((capability, index) => {
                        const label = capabilityLabels[index] ?? capability

                        return (
                          <span
                            className="model-chip-capability"
                            key={capability}
                            role="listitem"
                            data-tooltip={label}
                          >
                            {label}
                          </span>
                        )
                      })}
                    </span>
                  ) : null}
                  <button
                    className="model-chip-move"
                    type="button"
                    aria-label={`${t('button.up')}: ${model}`}
                    disabled={index === 0}
                    onMouseDown={preventModelButtonBlur}
                    onClick={() => commitModelMove(model, 'up')}
                  >
                    <ChevronDown />
                  </button>
                  <button
                    className="model-chip-move"
                    type="button"
                    aria-label={`${t('button.down')}: ${model}`}
                    disabled={index === selectedProviderModels.length - 1}
                    onMouseDown={preventModelButtonBlur}
                    onClick={() => commitModelMove(model, 'down')}
                  >
                    <ChevronDown />
                  </button>
                  <button
                    className="model-chip-delete"
                    type="button"
                    aria-label={deleteModelLabel}
                    onMouseDown={preventModelButtonBlur}
                    onClick={() => {
                      onClearModelRenameDraft()
                      const removal = runLeafAction(
                        onRemoveProviderModel,
                        selectedProvider.id,
                        model,
                      )
                      onCommitEditsOnBlur()
                      return removal
                    }}
                  >
                    <X />
                  </button>
                </div>
              )
            })}
            <input
              className="model-chip-input"
              dir="auto"
              spellCheck={false}
              value={currentModelDraft}
              onChange={(event) =>
                onModelDraftChange(selectedProvider.id, event.target.value)
              }
              onKeyDown={(event) =>
                onModelDraftKeyDown(event, selectedProvider.id)
              }
              onBlur={() => {
                onCommitModelDraft(selectedProvider.id)
                onCommitEditsOnBlur()
              }}
              placeholder={
                selectedProviderModels.length ? '' : t('placeholder.modelList')
              }
              aria-label={t('placeholder.modelList')}
              aria-describedby={modelListHintId}
            />
          </div>
        </div>
      </div>
      <div className="model-list-actions">
        <span
          className="model-add-tooltip-target"
          data-tooltip={modelAddTooltip}
        >
          <button
            className="ghost-button compact-button"
            type="button"
            onMouseDown={preventModelButtonBlur}
            onClick={() => {
              onCommitModelDraft(selectedProvider.id)
              onCommitEditsOnBlur()
            }}
            aria-describedby={modelListHintId}
            disabled={!canCommitModelDraft}
          >
            {t('button.addModel')}
          </button>
        </span>
      </div>
      <p className="settings-note" id={modelListHintId}>
        {t('settings.modelListNote')}
      </p>
    </>
  )
}
