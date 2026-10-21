import {
  Check,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'

import { providerPresets } from '../../data/presets'
import {
  providerPresetLabel,
  resolveLocale as resolveRuntimeLocale,
  translate,
  type Translator,
} from '../../i18n'
import {
  fallbackCapabilitiesForProvider,
  providerForAiRequest,
} from '../../services/providerConfig'
import {
  providerCapabilityCheckKey,
  providerCapabilityCheckDisplay,
  providerCapabilityCheckReadiness,
  providerCapabilityChecksForProviderCapabilities,
  providerFullCapabilityCheckKey,
} from '../../services/providerCapabilityChecks'
import { providerNeedsBrowserKey } from '../../services/providerRequestMode'
import { providerCheckKey } from '../../services/providerStatusKey'
import {
  DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  MAX_CHAT_CONTEXT_MESSAGE_LIMIT,
  MIN_CHAT_CONTEXT_MESSAGE_LIMIT,
  normalizeChatContextMessageLimit,
} from '../../services/appData'
import {
  focusInteractionElement,
  restoreInteractionFocusTarget,
  scheduleInteractionFocus,
  scheduleInteractionFocusRetry,
  scrollInteractionElementIntoView,
} from '../../services/interactionFocus'
import { setDataTransferDropEffect } from '../../services/dragDropEffects'
import type {
  LanguageMode,
  ProviderConfig,
  SyncMode,
  ThemeMode,
  UserSkill,
  FeatureHintId,
} from '../../types'
import {
  commitProviderKeyDraft,
  commitSettingsPassphraseDraft,
  commitSettingsDraft,
  runConfirmedSettingsAction,
  runSettingsAction,
  settingsDraftFailureKey,
} from '../settingsDraftPersistence'
import {
  createSkillEditorLoadOwner,
  finishSkillEditorDeletion,
  isCurrentSkillEditorLoad,
  loadSkillEditorDraft,
  resetSkillEditorDraft,
  submitSkillEditorDraft,
} from '../skillEditor'
import {
  INITIAL_SKILL_RENDER_COUNT,
  deriveRenderedSkillList,
  nextSkillRenderCount,
  skillRenderCountForTargetIndex,
} from '../skillList'
import { useDataCryptoWarmup } from '../runtimeWarmup'
import {
  createSettingsActionOwner,
  createSettingsDataActionFocusCoordinator,
} from '../settingsDataAction'
import { localizeSyncStatus } from '../errorPresentation'
import {
  finishProviderModelRemoval,
  providerModelDraftKeyShouldCommit,
  providerModelRenameActionTarget,
} from '../providerModelCatalog'
import {
  currentSettingsFocusOwner,
  createSettingsUserInteractionGuard,
  resolveSettingsActionFocusOwner,
  settingsFocusOwnerIsCurrent,
  type SettingsActionFocusOwner,
} from '../settingsFocusOwnership'
import { settingsDialogTabWrapTarget } from '../settingsDialogFocus'
import { useAppStore, appT, type SyncConflictStrategy } from '../store'
import { formatSyncTimestamp, resolveAppLocale } from '../i18n'
import type { AppStringKey } from '../strings'
import { FeatureHint } from './FeatureHint'
import { SecretInput } from './SecretInput'

type Tab = 'providers' | 'models' | 'skills' | 'sync' | 'general' | 'data'
type SyncActionFocusOwner = SettingsActionFocusOwner & {
  fallbackTarget?: () => HTMLButtonElement | null
}
type SyncFocusSchedule = {
  owner: SyncActionFocusOwner
  generation: number
  attempt: number
  stableFrames: number
  pending: boolean
}
const EMPTY_SKILLS: UserSkill[] = []
const SETTINGS_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const MAX_SYNC_FOCUS_ATTEMPTS = 12

function syncActionFocusWasAbandoned(owner: SyncActionFocusOwner): boolean {
  const activeElement = document.activeElement
  const fallback = owner.fallbackTarget?.()
  if (
    !activeElement ||
    activeElement === document.body ||
    activeElement === owner.focusOwner ||
    activeElement === owner.target ||
    activeElement === fallback
  ) {
    return false
  }
  if (!(activeElement instanceof HTMLElement) || !activeElement.isConnected) {
    return false
  }
  if (
    activeElement.hidden ||
    activeElement.closest('[inert]') ||
    activeElement.getClientRects().length === 0
  ) {
    return false
  }
  return activeElement.matches(SETTINGS_FOCUSABLE_SELECTOR)
}

function syncActionFocusWaitsForState(owner: SyncActionFocusOwner): boolean {
  if (!owner.target.disabled && owner.target.isConnected) return false
  const fallback = owner.fallbackTarget?.()
  return !fallback || !fallback.isConnected || fallback.disabled
}

function settingsFocusTargets(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(SETTINGS_FOCUSABLE_SELECTOR)].filter(
    (element) =>
      !element.hidden &&
      !element.closest('[inert]') &&
      element.getClientRects().length > 0,
  )
}

function restoreSettingsActionFocus(
  resolveTarget: () => HTMLElement | null,
  owner: Element | null,
): void {
  scheduleInteractionFocus(() =>
    restoreInteractionFocusTarget({
      activeElement: document.activeElement,
      blocked: !document.querySelector('.settings-modal'),
      body: document.body,
      owner,
      target: resolveTarget(),
    }),
  )
}

const settingsFeatureHint: Record<Tab, FeatureHintId> = {
  providers: 'providers',
  models: 'models',
  skills: 'skills',
  sync: 'sync',
  general: 'appearance',
  data: 'data',
}

function Switch({
  checked,
  disabled = false,
  label,
  onChange,
  ...dataAttributes
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (next: boolean) => void | Promise<unknown>
  'data-zc-compact-toggle'?: 'true'
}) {
  const commitChange = (target: HTMLButtonElement) => {
    const switchFocusOwner = document.activeElement
    let pending: void | Promise<unknown>
    try {
      pending = onChange(!checked)
    } catch {
      console.error('[app] settings switch action failed')
      return
    }
    if (!pending) return
    void Promise.resolve(pending)
      .catch(() => {
        console.error('[app] settings switch action failed')
      })
      .finally(() => {
        restoreSettingsActionFocus(() => target, switchFocusOwner)
      })
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="zc-switch"
      disabled={disabled}
      {...dataAttributes}
      onClick={(event) => commitChange(event.currentTarget)}
    />
  )
}

function providerOrderFocusTarget(
  returnTarget: HTMLButtonElement,
): HTMLElement | null {
  if (returnTarget.isConnected && !returnTarget.disabled) return returnTarget
  const alternate = returnTarget.parentElement?.querySelector<HTMLButtonElement>(
    'button:not(:disabled)',
  )
  if (alternate) return alternate
  return (
    returnTarget
      .closest('.zc-provider-card')
      ?.querySelector<HTMLElement>('strong[tabindex="0"]') ?? null
  )
}

function modelOrderFocusTarget(
  returnTarget: HTMLButtonElement,
): HTMLElement | null {
  if (returnTarget.isConnected && !returnTarget.disabled) return returnTarget
  for (const sibling of [
    returnTarget.nextElementSibling,
    returnTarget.previousElementSibling,
  ]) {
    if (sibling instanceof HTMLButtonElement && !sibling.disabled) return sibling
  }
  return (
    returnTarget
      .closest('.zc-model-chip')
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? null
  )
}

type ProviderCardProps = {
  provider: ProviderConfig
  providerDeletionDisabled: boolean
  providerGenerationActive: boolean
  providerListMutationPending: boolean
  onDelete: () => void
  onSetEnabled: (enabled: boolean) => void | Promise<unknown>
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: (returnTarget: HTMLButtonElement) => void
  onMoveDown: (returnTarget: HTMLButtonElement) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}

function ProviderCard({
  provider,
  providerDeletionDisabled,
  providerGenerationActive,
  providerListMutationPending,
  onDelete,
  onSetEnabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: ProviderCardProps) {
  const data = useAppStore((s) => s.data)
  const keys = useAppStore((s) => s.keys)
  const fetchingModelsFor = useAppStore((s) => s.fetchingModelsFor)
  const updateProvider = useAppStore((s) => s.updateProvider)
  const appendProviderModels = useAppStore((s) => s.appendProviderModels)
  const renameProviderModel = useAppStore((s) => s.renameProviderModel)
  const removeProviderModel = useAppStore((s) => s.removeProviderModel)
  const reorderProviderModel = useAppStore((s) => s.reorderProviderModel)
  const saveProviderKey = useAppStore((s) => s.saveProviderKey)
  const fetchModels = useAppStore((s) => s.fetchModels)
  const checkProviderConnectivity = useAppStore(
    (s) => s.checkProviderConnectivity,
  )
  const checkProviderCapability = useAppStore((s) => s.checkProviderCapability)
  const checkProviderFullCapabilities = useAppStore(
    (s) => s.checkProviderFullCapabilities,
  )
  const checkingProviderId = useAppStore((s) => s.checkingProviderId)
  const providerConnectivityResult = useAppStore(
    (s) => s.providerConnectivityResults[provider.id],
  )
  const notify = useAppStore((s) => s.notify)

  const [keyDraft, setKeyDraft] = useState<string | null>(null)
  const [keyCommitPending, setKeyCommitPending] = useState(false)
  const [keyCommitOwner] = useState(createSettingsActionOwner)
  const keyInputRef = useRef<HTMLInputElement | null>(null)
  const fullCapabilityCheckButtonRef = useRef<HTMLButtonElement | null>(null)
  const [modelDraft, setModelDraft] = useState('')
  const modelDraftInputRef = useRef<HTMLInputElement | null>(null)
  const [modelMutationPending, setModelMutationPending] = useState(false)
  const [modelMutationOwner] = useState(createSettingsActionOwner)
  const [draggingModel, setDraggingModel] = useState('')
  const [renamingModel, setRenamingModel] = useState('')
  const [renameModelDraft, setRenameModelDraft] = useState('')

  const t = (key: AppStringKey) => appT(data, key)
  const hasKey = Boolean((keys[provider.id] ?? '').trim())
  const needsKey = providerNeedsBrowserKey(provider)
  const fetching = fetchingModelsFor === provider.id
  const fetchModelsDisabled = Boolean(fetchingModelsFor) || modelMutationPending
  const preset = providerPresets.find((p) => p.id === provider.id)
  const runtimeT: Translator = (key, values) =>
    translate(
      resolveRuntimeLocale(data?.preferences.language),
      key,
      values,
    )
  const requestProvider = providerForAiRequest(provider, data)
  const providerCapabilities = fallbackCapabilitiesForProvider(requestProvider)
  const providerCapabilityChecks =
    providerCapabilityChecksForProviderCapabilities(providerCapabilities)
  const providerCapabilityReadiness = providerCapabilityCheckReadiness(
    requestProvider,
    providerCapabilities,
    runtimeT,
  )
  const providerCapabilityReadinessState = providerCapabilityReadiness.state
  const connectivityChecking =
    checkingProviderId === providerCheckKey(provider.id)
  const connectivityCheckDescriptionId =
    `provider-connectivity-check-description-${provider.id}`
  const connectivityCheckLabel = runtimeT(
    connectivityChecking ? 'button.checking' : 'button.checkConnectivity',
  )
  const connectivityCheckTooltip = checkingProviderId
    ? runtimeT('settings.waitForCheck')
    : connectivityCheckLabel
  const fullCapabilityChecking =
    checkingProviderId === providerFullCapabilityCheckKey(provider.id)
  const fullCapabilityCheckDisabled =
    Boolean(checkingProviderId) || providerCapabilityReadinessState !== 'ready'
  const providerCapabilityCostId = `provider-capability-cost-${provider.id}`
  const providerCapabilityReadinessId =
    `provider-capability-readiness-${provider.id}`
  const fullCapabilityCheckDescriptionIds = [
    providerCapabilityCostId,
    providerCapabilityReadinessId,
  ].join(' ')
  const fullCapabilityCheckTooltip = fullCapabilityChecking
    ? t('settings.capabilityChecking')
    : providerCapabilityReadiness.text
  const runProviderActionWithFocus = async (
    action: () => Promise<void>,
    returnTarget: HTMLButtonElement,
    fallbackTarget?: () => HTMLElement | null,
  ) => {
    const focusOwner = document.activeElement
    const interactionGuard = createSettingsUserInteractionGuard(document)
    interactionGuard.start()
    try {
      await action()
    } catch {
      console.error('[app] Provider UI action failed')
    } finally {
      const userInteracted = interactionGuard.wasInteracted()
      interactionGuard.stop()
      scheduleInteractionFocusRetry(() =>
        userInteracted
          ? restoreInteractionFocusTarget({
              activeElement: document.activeElement,
              blocked: false,
              body: document.body,
              owner: focusOwner,
              target: returnTarget.isConnected
                ? returnTarget
                : fallbackTarget?.() ?? null,
            })
          : returnTarget.isConnected
            ? returnTarget
            : fallbackTarget?.() ?? null,
      )
    }
  }
  const dragLabel = `${t('settings.dragProvider')}: ${provider.name}`
  const moveUpLabel = `${t('settings.moveProviderUp')}: ${provider.name}`
  const moveDownLabel = `${t('settings.moveProviderDown')}: ${provider.name}`
  const addModelDisabled = modelMutationPending || !modelDraft.trim()
  const addModelTooltip = addModelDisabled
    ? t('error.modelRequired')
    : t('settings.addModel')
  const fetchModelsLabel = t(
    fetching ? 'settings.fetching' : 'settings.fetchModels',
  )
  const fetchModelsTooltip = fetching
    ? fetchModelsLabel
    : fetchModelsDisabled
      ? t('settings.waitForModelFetch')
      : fetchModelsLabel

  const commitKey = async () => {
    const keyFocusOwner = document.activeElement
    try {
      await keyCommitOwner.run(
        () =>
          commitProviderKeyDraft({
            clear: (committedDraft) =>
              setKeyDraft((current) =>
                current === committedDraft ? null : current,
              ),
            draft: keyDraft,
            onError: (error) =>
              notify(t(settingsDraftFailureKey(error)), 'error'),
            save: (value) => saveProviderKey(provider.id, value),
          }),
        setKeyCommitPending,
      )
    } catch {
      console.error('[app] Provider key UI action failed')
    } finally {
      restoreSettingsActionFocus(() => keyInputRef.current, keyFocusOwner)
    }
  }

  const clearKey = async () => {
    const draftOwner = keyDraft
    const keyFocusOwner = document.activeElement
    await keyCommitOwner.run(
      () =>
        commitProviderKeyDraft({
          clear: () => {
            let shouldRestoreFocus = false
            setKeyDraft((current) => {
              if (current !== draftOwner) return current
              shouldRestoreFocus = true
              return null
            })
            if (shouldRestoreFocus) {
              restoreSettingsActionFocus(
                () => keyInputRef.current,
                keyFocusOwner,
              )
            }
          },
          draft: '',
          onError: (error) => notify(t(settingsDraftFailureKey(error)), 'error'),
          save: (value) => saveProviderKey(provider.id, value),
        }),
      setKeyCommitPending,
    )
  }

  const runModelMutation = async (
    action: () => Promise<boolean>,
  ): Promise<boolean | null> => {
    let accepted = false
    try {
      const admitted = await modelMutationOwner.run(async () => {
        accepted = await action()
      }, setModelMutationPending)
      return admitted ? accepted : null
    } catch {
      console.error('[app] Provider model UI action failed')
      return false
    }
  }

  const notifyModelMutationFailure = () => {
    try {
      notify(t('settings.saveFailed'), 'error')
    } catch {
      // The durable action result must not be replaced by a notice failure.
    }
  }

  const restoreModelDraftFocus = (focusOwner: Element | null) => {
    restoreSettingsActionFocus(() => modelDraftInputRef.current, focusOwner)
  }

  const addModel = async () => {
    const modelAddFocusOwner = document.activeElement
    const submittedDraft = modelDraft
    const accepted = await runModelMutation(() =>
      appendProviderModels(provider.id, submittedDraft),
    )
    if (accepted === null) return
    if (!accepted) {
      notifyModelMutationFailure()
      return
    }
    setModelDraft((current) => (current === submittedDraft ? '' : current))
    restoreModelDraftFocus(modelAddFocusOwner)
  }

  const restoreModelRenameFocus = (
    model: string,
    focusOwner: Element | null,
  ) => {
    restoreSettingsActionFocus(
      () =>
        providerModelRenameActionTarget(
          document.querySelectorAll<HTMLElement>(
            '[data-provider-model-rename-action]',
          ),
          provider.id,
          model,
        ),
      focusOwner,
    )
  }

  const commitModelRename = async (model: string) => {
    const modelRenameFocusOwner = document.activeElement
    if (renameModelDraft.trim() === model) {
      setRenamingModel('')
      setRenameModelDraft('')
      restoreModelRenameFocus(model, modelRenameFocusOwner)
      return
    }
    const submittedDraft = renameModelDraft
    const accepted = await runModelMutation(() =>
      renameProviderModel(provider.id, model, submittedDraft),
    )
    if (accepted === null) return
    if (!accepted) {
      notifyModelMutationFailure()
      return
    }
    const renamedModel = submittedDraft.trim()
    setRenamingModel('')
    setRenameModelDraft('')
    restoreModelRenameFocus(renamedModel, modelRenameFocusOwner)
  }

  const cancelModelRename = () => {
    const modelRenameFocusOwner = document.activeElement
    const model = renamingModel
    setRenamingModel('')
    setRenameModelDraft('')
    if (model) restoreModelRenameFocus(model, modelRenameFocusOwner)
  }

  const removeModel = async (model: string) => {
    const modelRemovalFocusOwner = document.activeElement
    let removed = false
    const accepted = await runConfirmedSettingsAction(
      () =>
        window.confirm(`${t('settings.deleteModelConfirm')}\n\n${model}`),
      async () => {
        const removal = await runModelMutation(() =>
          removeProviderModel(provider.id, model),
        )
        if (removal === false) {
          throw new Error('stale Provider model removal')
        }
        removed = removal === true
      },
      notifyModelMutationFailure,
      undefined,
      () => modelMutationOwner.pending(),
    )
    finishProviderModelRemoval({
      accepted: accepted && removed,
      removedModel: model,
      renamingModel,
      clearRename: () => {
        setRenamingModel('')
        setRenameModelDraft('')
      },
      restoreFocus: () => restoreModelDraftFocus(modelRemovalFocusOwner),
    })
  }

  const kindKey = `kind.${provider.kind}` as AppStringKey

  return (
    <div
      className="zc-provider-card"
      data-provider-id={provider.id}
      role="group"
      aria-label={provider.name}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="zc-provider-head">
        <span
          className="zc-provider-drag-handle"
          draggable={!providerListMutationPending}
          role="img"
          aria-label={dragLabel}
          data-tooltip={dragLabel}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <GripVertical size={16} aria-hidden="true" />
        </span>
        <strong
          aria-label={provider.name}
          data-tooltip={provider.name}
          tabIndex={0}
        >
          {provider.name}
        </strong>
        <span className="zc-badge">{t(kindKey)}</span>
        {needsKey && !hasKey && (
          <span className="zc-badge">{t('settings.needsApiKey')}</span>
        )}
        <span className={`zc-badge${provider.enabled ? ' on' : ''}`}>
          {t(provider.enabled ? 'settings.enabled' : 'settings.disabled')}
        </span>
        <Switch
          checked={provider.enabled}
          disabled={
            providerListMutationPending ||
            (provider.enabled && providerGenerationActive)
          }
          label={t(provider.enabled ? 'settings.enabled' : 'settings.disabled')}
          onChange={onSetEnabled}
        />
        <div className="zc-provider-order-actions">
          <button
            type="button"
            className="zc-icon-btn"
            aria-label={moveUpLabel}
            data-tooltip={moveUpLabel}
            disabled={providerListMutationPending || !canMoveUp}
            onClick={(event) => onMoveUp(event.currentTarget)}
          >
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="zc-icon-btn"
            aria-label={moveDownLabel}
            data-tooltip={moveDownLabel}
            disabled={providerListMutationPending || !canMoveDown}
            onClick={(event) => onMoveDown(event.currentTarget)}
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <label className="zc-field">
        <span>{t('settings.providerName')}</span>
        <input
          value={provider.name}
          onChange={(e) =>
            updateProvider(provider.id, { name: e.currentTarget.value })
          }
        />
      </label>

      <label className="zc-field">
        <span>{t('settings.baseUrl')}</span>
        <input
          value={provider.baseUrl}
          placeholder={t('settings.baseUrlPlaceholder')}
          onChange={(e) =>
            updateProvider(provider.id, { baseUrl: e.currentTarget.value })
          }
        />
      </label>

      <label className="zc-field">
        <span>{t('settings.model')}</span>
        <input
          value={provider.model}
          onChange={(e) =>
            updateProvider(provider.id, { model: e.currentTarget.value })
          }
        />
      </label>

      {needsKey && (
        <label className="zc-field">
          <span>{t('settings.apiKey')}</span>
          <div className="zc-row zc-credential-row">
            <SecretInput
              key={`${provider.id}:${provider.createdAt}:${provider.updatedAt}:${hasKey ? 'has-key' : 'no-key'}`}
              data-provider-key-input="true"
              inputRef={keyInputRef}
              style={{ flex: 1, minWidth: 0 }}
              value={keyDraft ?? ''}
              placeholder={
                hasKey
                  ? t('settings.apiKeySaved')
                  : t('settings.apiKeyPlaceholder')
              }
              autoComplete="off"
              onChange={(e) => setKeyDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitKey()
              }}
              revealLabel={t('settings.showKey')}
              hideLabel={t('settings.hideKey')}
            />
            <button
              type="button"
              className="zc-btn"
              data-provider-key-save="true"
              disabled={keyCommitPending || !(keyDraft ?? '').trim()}
              onClick={() => void commitKey()}
            >
              {t('common.save')}
            </button>
            {hasKey && (
              <button
                type="button"
                className="zc-btn"
                data-provider-key-clear="true"
                disabled={keyCommitPending}
                onClick={() => void clearKey()}
              >
                {runtimeT('button.clearProviderKey')}
              </button>
            )}
          </div>
          {preset?.apiKeyUrl && (
            <p className="zc-help">
              <a
                className="zc-link"
                href={preset.apiKeyUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('settings.apiKeyUrl')}
              </a>
            </p>
          )}
        </label>
      )}

      <div className="zc-field">
        <span>{t('settings.modelList')}</span>
        <div className="zc-row zc-provider-model-entry">
          <input
            ref={modelDraftInputRef}
            style={{ flex: 1, minWidth: 0 }}
            value={modelDraft}
            disabled={modelMutationPending}
            placeholder={t('settings.newModelPlaceholder')}
            onChange={(e) => setModelDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (providerModelDraftKeyShouldCommit(e)) void addModel()
            }}
          />
          <span
            className="zc-provider-model-action"
            aria-label={addModelDisabled ? addModelTooltip : undefined}
            data-tooltip={addModelTooltip}
            tabIndex={addModelDisabled ? 0 : -1}
          >
            <button
              type="button"
              className="zc-btn"
              aria-label={t('settings.addModel')}
              data-provider-model-add-action="true"
              disabled={addModelDisabled}
              onClick={() => void addModel()}
            >
              {t('settings.addModel')}
            </button>
          </span>
          <span
            className="zc-provider-model-action"
            aria-label={fetchModelsDisabled ? fetchModelsTooltip : undefined}
            data-tooltip={fetchModelsTooltip}
            tabIndex={fetchModelsDisabled ? 0 : -1}
          >
            <button
              type="button"
              className="zc-btn"
              aria-label={fetchModelsLabel}
              data-provider-model-fetch-action="true"
              disabled={fetchModelsDisabled}
              onClick={(event) =>
                void runProviderActionWithFocus(
                  () => fetchModels(provider.id),
                  event.currentTarget,
                )
              }
            >
              <RefreshCw size={13} />
              {fetchModelsLabel}
            </button>
          </span>
        </div>
        {(provider.models ?? []).length > 0 && (
          <div className="zc-chip-list">
            {(provider.models ?? []).map((model, index, models) => {
              const previous = models[index - 1]
              const next = models[index + 1]
              const dragModelLabel = `${t('settings.dragModel')}: ${model}`
              const moveModelUpLabel = `${t('settings.moveModelUp')}: ${model}`
              const moveModelDownLabel = `${t('settings.moveModelDown')}: ${model}`
              const move = async (
                target: string | undefined,
                returnTarget?: HTMLButtonElement,
              ) => {
                if (!target) return
                const modelOrderFocusOwner = document.activeElement
                const accepted = await runModelMutation(() =>
                  reorderProviderModel(provider.id, model, target),
                )
                if (accepted === false) {
                  notifyModelMutationFailure()
                }
                if (accepted !== null && returnTarget) {
                  restoreSettingsActionFocus(
                    () => modelOrderFocusTarget(returnTarget),
                    modelOrderFocusOwner,
                  )
                }
              }

              return (
                <span
                  key={model}
                  className="zc-chip zc-model-chip"
                  onDragOver={(event) => {
                    if (!draggingModel || draggingModel === model) return
                    event.preventDefault()
                    setDataTransferDropEffect(event.dataTransfer, 'move')
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (draggingModel) {
                      void runModelMutation(() =>
                        reorderProviderModel(provider.id, draggingModel, model),
                      ).then((accepted) => {
                        if (accepted === false) {
                          notifyModelMutationFailure()
                        }
                      })
                    }
                    setDraggingModel('')
                  }}
                >
                  <span
                    className="zc-model-drag-handle"
                    draggable={!modelMutationPending}
                    role="img"
                    aria-label={dragModelLabel}
                    data-tooltip={dragModelLabel}
                    data-provider-model-drag={model}
                    onDragStart={(event) => {
                      setDraggingModel(model)
                      try {
                        event.dataTransfer.setData('text/plain', model)
                        event.dataTransfer.effectAllowed = 'move'
                      } catch {
                        // The in-page drag owner remains sufficient for this gesture.
                      }
                    }}
                    onDragEnd={() => setDraggingModel('')}
                  >
                    <GripVertical size={12} aria-hidden="true" />
                  </span>
                  {renamingModel === model ? (
                    <input
                      autoFocus
                      className="zc-model-rename-input"
                      data-provider-model-rename={model}
                      aria-label={`${t('settings.renameModel')}: ${model}`}
                      value={renameModelDraft}
                      disabled={modelMutationPending}
                      onChange={(event) =>
                        setRenameModelDraft(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelModelRename()
                        } else if (providerModelDraftKeyShouldCommit(event)) {
                          event.preventDefault()
                          void commitModelRename(model)
                        }
                      }}
                    />
                  ) : (
                    <span className="zc-model-chip-name">{model}</span>
                  )}
                  <span className="zc-model-order-actions">
                    {renamingModel === model ? (
                      <>
                        <button
                          type="button"
                          className="zc-icon-btn zc-model-rename-save"
                          aria-label={`${t('common.save')}: ${model}`}
                          disabled={modelMutationPending || !renameModelDraft.trim()}
                          onClick={() => void commitModelRename(model)}
                        >
                          <Check size={12} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="zc-icon-btn"
                          aria-label={`${t('common.cancel')}: ${model}`}
                          disabled={modelMutationPending}
                          onClick={cancelModelRename}
                        >
                          <X size={12} aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="zc-icon-btn"
                        aria-label={`${t('settings.renameModel')}: ${model}`}
                        data-tooltip={`${t('settings.renameModel')}: ${model}`}
                        data-provider-model-rename-action={model}
                        disabled={modelMutationPending}
                        onClick={() => {
                          setRenamingModel(model)
                          setRenameModelDraft(model)
                        }}
                      >
                        <Pencil size={12} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="zc-icon-btn"
                      aria-label={moveModelUpLabel}
                      data-tooltip={moveModelUpLabel}
                      disabled={modelMutationPending || !previous}
                      onClick={(event) => void move(previous, event.currentTarget)}
                    >
                      <ChevronUp size={12} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="zc-icon-btn"
                      aria-label={moveModelDownLabel}
                      data-tooltip={moveModelDownLabel}
                      disabled={modelMutationPending || !next}
                      onClick={(event) => void move(next, event.currentTarget)}
                    >
                      <ChevronDown size={12} aria-hidden="true" />
                    </button>
                  </span>
                  <button
                    type="button"
                    aria-label={`${t('common.delete')} ${model}`}
                    data-tooltip={`${t('common.delete')} ${model}`}
                    disabled={modelMutationPending}
                    onClick={() => void removeModel(model)}
                  >
                    <X size={12} />
                  </button>
                </span>
              )
            })}
          </div>
        )}
      </div>

      <section className="zc-field">
        <p id={connectivityCheckDescriptionId} className="zc-help">
          {runtimeT('settings.connectivityCheckNote')}
        </p>
        <button
          type="button"
          className="zc-btn"
          data-provider-connectivity-check="true"
          aria-describedby={connectivityCheckDescriptionId}
          disabled={Boolean(checkingProviderId)}
          data-tooltip={connectivityCheckTooltip}
          onClick={(event) =>
            void runProviderActionWithFocus(
              () => checkProviderConnectivity(provider.id),
              event.currentTarget,
            )
          }
        >
          <RefreshCw size={13} aria-hidden="true" />
          {connectivityCheckLabel}
        </button>
      </section>

      {providerCapabilityChecks.length > 0 && (
        <section className="zc-field">
          <span>{t('settings.capabilityChecks')}</span>
          <p id={providerCapabilityCostId} className="zc-help">
            {t('settings.capabilityCheckCost')}
          </p>
          <p
            id={providerCapabilityReadinessId}
            className="zc-help"
            data-provider-capability-readiness={
              providerCapabilityReadinessState
            }
          >
            {providerCapabilityReadiness.text}
          </p>
          {providerConnectivityResult?.message && (
            <div className="zc-provider-connectivity-result">
              <p
                className="zc-help"
                role="status"
                data-provider-capability-notice="true"
              >
                {providerConnectivityResult.message}
              </p>
              {providerConnectivityResult.retryable &&
                providerConnectivityResult.retryAction === 'fullCapabilities' && (
                  <button
                    type="button"
                    className="zc-btn"
                    aria-label={`${t('common.retry')}: ${provider.name}`}
                    data-provider-connectivity-retry-action="fullCapabilities"
                    onClick={(event) =>
                      void runProviderActionWithFocus(
                        () => checkProviderFullCapabilities(provider.id),
                        event.currentTarget,
                        () => fullCapabilityCheckButtonRef.current,
                      )
                    }
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    {t('common.retry')}
                  </button>
                )}
            </div>
          )}
          <button
            ref={fullCapabilityCheckButtonRef}
            type="button"
            className="zc-btn"
            data-provider-full-capability-check="true"
            aria-describedby={fullCapabilityCheckDescriptionIds}
            disabled={fullCapabilityCheckDisabled}
            data-tooltip={fullCapabilityCheckTooltip}
            onClick={(event) =>
              void runProviderActionWithFocus(
                () => checkProviderFullCapabilities(provider.id),
                event.currentTarget,
              )
            }
          >
            {fullCapabilityChecking
              ? t('settings.capabilityChecking')
              : t('settings.capabilityCheckAll')}
          </button>
          <div
            role="list"
            aria-label={t('settings.capabilityResults')}
            className="zc-chip-list"
          >
            {providerCapabilityChecks.map((capability) => {
              const display = providerCapabilityCheckDisplay(
                requestProvider,
                capability,
                runtimeT,
              )
              const result =
                providerConnectivityResult?.capabilityResults?.[capability]
              const reasonId =
                `provider-capability-check-description-${provider.id}-${capability}`
              const capabilityCheckDescriptionIds = [
                providerCapabilityCostId,
                providerCapabilityReadinessId,
                reasonId,
              ].join(' ')
              const capabilityChecking =
                checkingProviderId ===
                providerCapabilityCheckKey(provider.id, capability)
              const capabilityCheckDisabled =
                Boolean(checkingProviderId) || display.state !== 'ready'
              const capabilityActionLabel = `${t(
                capabilityChecking
                  ? 'settings.capabilityChecking'
                  : 'settings.checkCapability',
              )}: ${display.label}`
              const capabilityActionTooltip =
                display.state === 'ready'
                  ? capabilityActionLabel
                  : display.tooltip

              return (
                <div
                  key={capability}
                  role="listitem"
                  className="zc-chip"
                  aria-describedby={capabilityCheckDescriptionIds}
                >
                  <strong>{display.label}</strong>
                  <span id={reasonId}>
                    {result?.message ?? display.endpointModelText}
                  </span>
                  <span
                    className="zc-provider-capability-action"
                    data-tooltip={capabilityActionTooltip}
                    tabIndex={capabilityCheckDisabled ? 0 : -1}
                  >
                    <button
                      type="button"
                      className="zc-icon-btn"
                      aria-label={capabilityActionTooltip}
                      aria-describedby={capabilityCheckDescriptionIds}
                      data-provider-capability-action={capability}
                      disabled={capabilityCheckDisabled}
                      onClick={(event) =>
                        void runProviderActionWithFocus(
                          () => checkProviderCapability(provider.id, capability),
                          event.currentTarget,
                        )
                      }
                    >
                      <RefreshCw size={13} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div className="zc-row between">
        <span />
        <button
          type="button"
          className="zc-btn danger"
          disabled={providerDeletionDisabled}
          onClick={onDelete}
        >
          <Trash2 size={13} />
          {t('settings.deleteProvider')}
        </button>
      </div>
    </div>
  )
}

function ProvidersTab() {
  const data = useAppStore((s) => s.data)
  const sending = useAppStore((s) => s.sending)
  const speakingMessageId = useAppStore((s) => s.speakingMessageId)
  const streaming = useAppStore((s) => s.streaming)
  const transcribingAudio = useAppStore((s) => s.transcribingAudio)
  const addProvider = useAppStore((s) => s.addProvider)
  const setProviderEnabled = useAppStore((s) => s.setProviderEnabled)
  const reorderProvider = useAppStore((s) => s.reorderProvider)
  const deleteProvider = useAppStore((s) => s.deleteProvider)
  const notify = useAppStore((s) => s.notify)
  const [presetId, setPresetId] = useState(providerPresets[0]?.id ?? '')
  const [providerListMutationPending, setProviderListMutationPending] =
    useState(false)
  const [providerListMutationOwner] = useState(createSettingsActionOwner)
  const [draggingProviderId, setDraggingProviderId] = useState('')
  const addProviderButtonRef = useRef<HTMLButtonElement | null>(null)

  const t = (key: AppStringKey) => appT(data, key)
  const runtimeT: Translator = (key, values) =>
    translate(
      resolveRuntimeLocale(data?.preferences.language),
      key,
      values,
    )
  const presetLabel = (preset: (typeof providerPresets)[number]) =>
    providerPresetLabel(preset.id, preset.name, runtimeT)
  const presetOptionLabel = (preset: (typeof providerPresets)[number]) =>
    preset.id === 'cloudflare-ai-gateway-openai'
      ? runtimeT('provider.presetOption.cloudflareGateway')
      : preset.id === 'custom-anthropic-relay'
        ? runtimeT('provider.presetOption.customAnthropic')
        : preset.id === 'custom-openai-relay'
          ? runtimeT('provider.presetOption.customOpenAI')
          : preset.id === 'custom-responses-relay'
            ? runtimeT('provider.presetOption.customResponses')
            : presetLabel(preset)
  const providers = data?.providers ?? []
  const providerGenerationActive =
    sending ||
    streaming ||
    transcribingAudio ||
    Boolean(speakingMessageId)
  const providerDeletionDisabled =
    providerListMutationPending ||
    providerGenerationActive
  const runProviderListAction = (
    action: () => unknown | Promise<unknown>,
  ): Promise<boolean> =>
    providerListMutationOwner.run(action, setProviderListMutationPending)
  const runProviderListMutation = async (
    action: () => Promise<boolean>,
  ): Promise<boolean | null> => {
    let accepted = false
    try {
      const admitted = await runProviderListAction(
        async () => {
          accepted = await action()
        },
      )
      return admitted ? accepted : null
    } catch {
      console.error('[app] Provider list UI action failed')
      try {
        notify(t('settings.saveFailed'), 'error')
      } catch {
        // Notification failures must not escape the UI event boundary.
      }
      return null
    }
  }
  const restoreProviderAddFocus = (focusOwner: Element | null) => {
    restoreSettingsActionFocus(() => addProviderButtonRef.current, focusOwner)
  }
  const runProviderAdd = async () => {
    const providerAddFocusOwner = document.activeElement
    const accepted = await runProviderListMutation(() => addProvider(presetId))
    if (accepted) restoreProviderAddFocus(providerAddFocusOwner)
  }
  const deleteProviderAndRestoreFocus = async (providerId: string) => {
    const providerDeleteFocusOwner = document.activeElement
    const accepted = await runConfirmedSettingsAction(
      () => window.confirm(t('settings.deleteProvider')),
      () => deleteProvider(providerId),
      () => notify(t('settings.saveFailed'), 'error'),
      runProviderListAction,
      () => providerListMutationOwner.pending(),
    )
    if (accepted) {
      restoreProviderAddFocus(providerDeleteFocusOwner)
    }
  }

  return (
    <div>
      <div className="zc-row" style={{ marginBottom: 16 }}>
        <select
          value={presetId}
          disabled={providerListMutationPending}
          aria-busy={providerListMutationPending}
          aria-label={t('settings.addProvider')}
          data-tooltip={presetLabel(
            providerPresets.find((preset) => preset.id === presetId) ?? providerPresets[0],
          )}
          style={{
            flex: '1 0 190px',
            minWidth: 0,
            maxWidth: '100%',
            padding: '9px 12px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg)',
          }}
          onChange={(e) => setPresetId(e.currentTarget.value)}
        >
          {providerPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {presetOptionLabel(preset)}
            </option>
          ))}
        </select>
        <button
          ref={addProviderButtonRef}
          type="button"
          className="zc-btn primary"
          disabled={providerListMutationPending}
          aria-busy={providerListMutationPending}
          onClick={() => void runProviderAdd()}
        >
          <Plus size={14} />
          {t('settings.addProvider')}
        </button>
      </div>

      {providers.map((provider) => {
        const group = providers.filter((item) => item.enabled === provider.enabled)
        const groupIndex = group.findIndex((item) => item.id === provider.id)
        const previous = group[groupIndex - 1]
        const next = group[groupIndex + 1]
        const move = async (
          target: ProviderConfig | undefined,
          returnTarget: HTMLButtonElement,
        ) => {
          if (!target || providerListMutationPending) return
          const providerOrderFocusOwner = document.activeElement
          const accepted = await runProviderListMutation(() =>
            reorderProvider(provider.id, target.id),
          )
          if (accepted !== null) {
            restoreSettingsActionFocus(
              () => providerOrderFocusTarget(returnTarget),
              providerOrderFocusOwner,
            )
          }
        }
        return (
          <ProviderCard
            key={provider.id}
            provider={provider}
            providerDeletionDisabled={providerDeletionDisabled}
            providerGenerationActive={providerGenerationActive}
            providerListMutationPending={providerListMutationPending}
            onDelete={() => {
              void deleteProviderAndRestoreFocus(provider.id)
            }}
            onSetEnabled={(enabled) => {
              if (providerListMutationPending) return
              return runProviderListMutation(() =>
                setProviderEnabled(provider.id, enabled),
              )
            }}
            canMoveUp={Boolean(previous)}
            canMoveDown={Boolean(next)}
            onMoveUp={(returnTarget) => void move(previous, returnTarget)}
            onMoveDown={(returnTarget) => void move(next, returnTarget)}
            onDragStart={(event) => {
              if (providerListMutationPending) return
              setDraggingProviderId(provider.id)
              try {
                event.dataTransfer.setData('text/plain', provider.id)
                event.dataTransfer.effectAllowed = 'move'
              } catch {
                // The in-page drag owner remains sufficient for this gesture.
              }
            }}
            onDragEnd={() => setDraggingProviderId('')}
            onDragOver={(event) => {
              if (providerListMutationPending) return
              const source = providers.find(
                (item) => item.id === draggingProviderId,
              )
              if (!source || source.enabled !== provider.enabled) return
              event.preventDefault()
              setDataTransferDropEffect(event.dataTransfer, 'move')
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (draggingProviderId && !providerListMutationPending) {
                void runProviderListMutation(() =>
                  reorderProvider(draggingProviderId, provider.id),
                )
              }
              setDraggingProviderId('')
            }}
          />
        )
      })}
    </div>
  )
}

type CapabilityModelKey =
  | 'imageModel'
  | 'audioSpeechModel'
  | 'audioTranscriptionModel'
  | 'embeddingModel'
  | 'moderationModel'
  | 'realtimeModel'

const capabilityModelFields: Array<{
  key: CapabilityModelKey
  label: AppStringKey
}> = [
  { key: 'imageModel', label: 'settings.imageGenerationModel' },
  { key: 'audioSpeechModel', label: 'settings.audioSpeechModel' },
  { key: 'audioTranscriptionModel', label: 'settings.audioTranscriptionModel' },
  { key: 'embeddingModel', label: 'settings.embeddingModel' },
  { key: 'moderationModel', label: 'settings.moderationModel' },
  { key: 'realtimeModel', label: 'settings.realtimeModel' },
]

function ModelsTab() {
  const data = useAppStore((s) => s.data)
  const updateProvider = useAppStore((s) => s.updateProvider)
  const providers = data?.providers ?? []
  const t = (key: AppStringKey) => appT(data, key)

  if (providers.length === 0) {
    return <p className="zc-help">{t('composer.addProviderFirst')}</p>
  }

  return (
    <div>
      <p className="zc-help zc-section-help">{t('settings.capabilityModels')}</p>
      {providers.map((provider) => (
        <section className="zc-provider-card" key={provider.id}>
          <div className="zc-provider-head">
            <strong>{provider.name}</strong>
            <span className={`zc-badge${provider.enabled ? ' on' : ''}`}>
              {t(provider.enabled ? 'settings.enabled' : 'settings.disabled')}
            </span>
          </div>
          <div className="zc-model-grid">
            {capabilityModelFields.map((field) => (
              <label className="zc-field" key={field.key}>
                <span>{t(field.label)}</span>
                <input
                  value={provider[field.key] ?? ''}
                  placeholder={provider.model || t('settings.model')}
                  onChange={(event) =>
                    updateProvider(provider.id, {
                      [field.key]: event.currentTarget.value,
                    } as Partial<ProviderConfig>)
                  }
                />
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function SkillsTab() {
  const data = useAppStore((s) => s.data)
  const skillMutationPending = useAppStore((s) => s.skillMutationPending)
  const addSkill = useAppStore((s) => s.addSkill)
  const importSkills = useAppStore((s) => s.importSkills)
  const setSkillToggle = useAppStore((s) => s.setSkillToggle)
  const setGlobalSkillAutoMatch = useAppStore(
    (s) => s.setGlobalSkillAutoMatch,
  )
  const updateSkillSettings = useAppStore((s) => s.updateSkillSettings)
  const loadSkillContent = useAppStore((s) => s.loadSkillContent)
  const saveSkillContent = useAppStore((s) => s.saveSkillContent)
  const deleteSkill = useAppStore((s) => s.deleteSkill)
  const notify = useAppStore((s) => s.notify)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const skillNameInputRef = useRef<HTMLInputElement | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [skillLoadOwner] = useState(createSkillEditorLoadOwner)
  const [revealSkillId, setRevealSkillId] = useState<string | null>(null)
  const [renderedSkillCount, setRenderedSkillCount] = useState(
    INITIAL_SKILL_RENDER_COUNT,
  )
  const skillRowRefs = useRef(new Map<string, HTMLElement>())
  const skillListMoreRef = useRef<HTMLDivElement | null>(null)
  const t = (key: AppStringKey) => appT(data, key)
  const skills = data?.skills ?? EMPTY_SKILLS
  const {
    hasMoreRenderedSkills,
    renderedSkillLimit,
    renderedSkills,
    skillCount,
  } = deriveRenderedSkillList(skills, renderedSkillCount, true)
  const showMoreSkills = () => {
    setRenderedSkillCount((current) =>
      nextSkillRenderCount(current, skillCount),
    )
  }

  useEffect(
    () => () => {
      skillLoadOwner.invalidate()
    },
    [skillLoadOwner],
  )

  useEffect(() => {
    if (!revealSkillId) return
    const row = skillRowRefs.current.get(revealSkillId)
    if (!row) {
      const targetIndex = skills.findIndex((skill) => skill.id === revealSkillId)
      setRenderedSkillCount((current) =>
        skillRenderCountForTargetIndex(current, skillCount, targetIndex),
      )
      return
    }
    scrollInteractionElementIntoView(row, {
      block: 'nearest',
      inline: 'nearest',
      behavior: 'auto',
    })
    setRevealSkillId(null)
  }, [renderedSkillLimit, revealSkillId, skillCount, skills])

  useEffect(() => {
    if (!hasMoreRenderedSkills || typeof IntersectionObserver === 'undefined') {
      return
    }
    const target = skillListMoreRef.current
    if (!target) return
    let active = true
    const observer = new IntersectionObserver(
      (entries) => {
        if (active && entries.some((entry) => entry.isIntersecting)) {
          setRenderedSkillCount((current) =>
            nextSkillRenderCount(current, skillCount),
          )
        }
      },
      {
        root: target.closest('.zc-settings-scroll'),
        rootMargin: '240px 0px',
      },
    )
    observer.observe(target)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [hasMoreRenderedSkills, renderedSkillLimit, skillCount])

  const resetDraft = () => {
    resetSkillEditorDraft({
      invalidateLoad: skillLoadOwner.invalidate,
      setEditingId,
      setNameDraft,
      setContentDraft,
      setLoadingId,
    })
  }

  const restoreSkillEditorFocus = (focusOwner: Element | null) => {
    restoreSettingsActionFocus(() => skillNameInputRef.current, focusOwner)
  }

  const cancelSkillEdit = () => {
    const skillEditFocusOwner = document.activeElement
    resetDraft()
    restoreSkillEditorFocus(skillEditFocusOwner)
  }

  const editSkill = async (skill: UserSkill) => {
    const skillEditFocusOwner = document.activeElement
    const generation = skillLoadOwner.begin()
    await loadSkillEditorDraft(skill, loadSkillContent, {
      isCurrent: () =>
        isCurrentSkillEditorLoad(
          skill,
          generation,
          skillLoadOwner.current(),
          useAppStore.getState().data?.skills,
        ),
      isTargetDeleted: () =>
        skillLoadOwner.current() === generation &&
        useAppStore.getState().data?.skills.some(
          (candidate) => candidate.id === skill.id,
        ) !== true,
      setEditingId,
      setNameDraft,
      setContentDraft,
      setLoadingId,
      resetDraft,
      notify: (message, tone) => useAppStore.getState().notify(message, tone),
      translate: t,
    })
    if (
      isCurrentSkillEditorLoad(
        skill,
        generation,
        skillLoadOwner.current(),
      useAppStore.getState().data?.skills,
      )
    ) {
      restoreSkillEditorFocus(skillEditFocusOwner)
    }
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const skillSubmitFocusOwner = document.activeElement
    const previousSkillIds = new Set(
      useAppStore.getState().data?.skills.map((skill) => skill.id),
    )
    const accepted = await submitSkillEditorDraft(
      editingId,
      nameDraft,
      contentDraft,
      { addSkill, saveSkillContent },
    )
    if (!accepted) return
    if (editingId) {
      setRevealSkillId(editingId)
    } else {
      const nextSkill = useAppStore
        .getState()
        .data?.skills.find(
          (skill) => !previousSkillIds.has(skill.id),
        )
      if (nextSkill) setRevealSkillId(nextSkill.id)
    }
    resetDraft()
    restoreSkillEditorFocus(skillSubmitFocusOwner)
  }

  const importSkillFiles = async (files: File[]) => {
    const previousSkillIds = new Set(
      useAppStore.getState().data?.skills.map((skill) => skill.id),
    )
    await importSkills(files)
    const importedSkillIds = (useAppStore.getState().data?.skills ?? [])
      .map((skill) => skill.id)
      .filter((skillId) => !previousSkillIds.has(skillId))
    const lastImportedSkillId = importedSkillIds[importedSkillIds.length - 1]
    if (lastImportedSkillId) setRevealSkillId(lastImportedSkillId)
  }

  const deleteSkillAndRestoreFocus = async (skillId: string) => {
    const skillDeletionFocusOwner = document.activeElement
    const accepted = await runConfirmedSettingsAction(
      () => window.confirm(t('skills.deleteConfirm')),
      () => deleteSkill(skillId),
      () => notify(t('skills.deleteFailed'), 'error'),
      undefined,
      () => useAppStore.getState().skillMutationPending,
    )
    finishSkillEditorDeletion({
      accepted,
      deletedSkillId: skillId,
      editingId,
      resetDraft,
      restoreFocus: () => restoreSkillEditorFocus(skillDeletionFocusOwner),
    })
  }

  return (
    <div aria-busy={skillMutationPending}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json"
        multiple
        hidden
        disabled={skillMutationPending}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (files.length > 0) void importSkillFiles(files)
        }}
      />

      <div className="zc-row" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="zc-btn"
          disabled={skillMutationPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={14} />
          {t('skills.import')}
        </button>
      </div>

      {data && (
        <div className="zc-skill-settings">
          <div className="zc-row between">
            <span>{t('skills.defaultAutoMatch')}</span>
            <Switch
              checked={data.skillSettings.autoMatch}
              disabled={skillMutationPending}
              label={t('skills.defaultAutoMatch')}
              onChange={(autoMatch) =>
                setGlobalSkillAutoMatch(autoMatch)
              }
            />
          </div>
          <label className="zc-field">
            <span>{t('skills.contextBudget')}</span>
            <input
              type="number"
              min={600}
              max={8000}
              step={100}
              value={data.skillSettings.contextBudget}
              disabled={skillMutationPending}
              onChange={(event) => {
                const contextBudget = event.currentTarget.valueAsNumber
                if (Number.isFinite(contextBudget)) {
                  updateSkillSettings({ contextBudget })
                }
              }}
            />
          </label>
          <label className="zc-field">
            <span>{t('skills.maxAutoSkills')}</span>
            <input
              type="number"
              min={1}
              max={8}
              step={1}
              value={data.skillSettings.maxAutoSkills}
              disabled={skillMutationPending}
              onChange={(event) => {
                const maxAutoSkills = event.currentTarget.valueAsNumber
                if (Number.isFinite(maxAutoSkills)) {
                  updateSkillSettings({ maxAutoSkills })
                }
              }}
            />
          </label>
        </div>
      )}

      <form className="zc-skill-editor" onSubmit={(event) => void submit(event)}>
        <div className="zc-row between">
          <strong>{editingId ? t('skills.edit') : t('skills.add')}</strong>
          {editingId && (
            <button
              type="button"
              className="zc-icon-btn"
              aria-label={t('skills.cancel')}
              data-tooltip={t('skills.cancel')}
              disabled={skillMutationPending}
              onClick={cancelSkillEdit}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <label className="zc-field">
          <span>{t('skills.name')}</span>
          <input
            ref={skillNameInputRef}
            value={nameDraft}
            placeholder={t('skills.namePlaceholder')}
            readOnly={skillMutationPending}
            onChange={(event) => setNameDraft(event.currentTarget.value)}
          />
        </label>
        <label className="zc-field">
          <span>{t('skills.content')}</span>
          <textarea
            value={contentDraft}
            placeholder={
              loadingId ? t('skills.loading') : t('skills.contentPlaceholder')
            }
            disabled={loadingId !== null}
            readOnly={skillMutationPending}
            rows={8}
            onChange={(event) => setContentDraft(event.currentTarget.value)}
          />
        </label>
        <button
          type="submit"
          className="zc-btn primary"
          disabled={loadingId !== null || skillMutationPending}
        >
          {editingId ? t('skills.save') : t('skills.add')}
        </button>
      </form>

      <div className="zc-divider" />
      {skills.length === 0 ? (
        <p className="zc-help">{t('skills.empty')}</p>
      ) : (
        <div className="zc-skill-list">
          {renderedSkills.map((skill) => (
            <article
              className="zc-skill-item"
              key={skill.id}
              ref={(element) => {
                if (element) {
                  skillRowRefs.current.set(skill.id, element)
                } else {
                  skillRowRefs.current.delete(skill.id)
                }
              }}
            >
              <div className="zc-row between">
                <div className="zc-skill-copy">
                  <strong>{skill.name}</strong>
                  <span>
                    {skill.fileName ?? skill.contentType} · {skill.sourceSize} B
                  </span>
                </div>
                <div className="zc-row">
                  <button
                    type="button"
                    className="zc-icon-btn"
                    aria-label={t('skills.edit')}
                    data-tooltip={t('skills.edit')}
                    disabled={skillMutationPending}
                    onClick={() => void editSkill(skill)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="zc-icon-btn danger"
                    aria-label={t('skills.delete')}
                    data-tooltip={t('skills.delete')}
                    disabled={skillMutationPending}
                    onClick={() => void deleteSkillAndRestoreFocus(skill.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="zc-row between zc-skill-switches">
                <Switch
                  checked={skill.enabled}
                  disabled={skillMutationPending}
                  label={`${skill.name}: ${t('skills.enabled')}`}
                  onChange={(enabled) =>
                    setSkillToggle(skill.id, 'enabled', enabled)
                  }
                />
                <span>{t('skills.enabled')}</span>
                <Switch
                  checked={skill.autoMatch}
                  disabled={skillMutationPending}
                  label={`${skill.name}: ${t('skills.autoMatch')}`}
                  onChange={(autoMatch) =>
                    setSkillToggle(skill.id, 'autoMatch', autoMatch)
                  }
                />
                <span>{t('skills.autoMatch')}</span>
              </div>
            </article>
          ))}
          {hasMoreRenderedSkills && (
            <div ref={skillListMoreRef} className="zc-skill-list-more">
              <button
                type="button"
                className="zc-btn"
                data-zc-skill-list-more="true"
                onClick={showMoreSkills}
              >
                {translate(
                  resolveRuntimeLocale(data?.preferences.language),
                  'button.showMoreSkills',
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SyncTab() {
  const data = useAppStore((s) => s.data)
  const githubToken = useAppStore((s) => s.githubToken)
  const syncPassphrase = useAppStore((s) => s.syncPassphrase)
  const syncing = useAppStore((s) => s.syncing)
  const syncConflict = useAppStore((s) => s.syncConflict)
  const setSyncMode = useAppStore((s) => s.setSyncMode)
  const setSyncAutoSync = useAppStore((s) => s.setSyncAutoSync)
  const setSyncGistId = useAppStore((s) => s.setSyncGistId)
  const setSyncGistFile = useAppStore((s) => s.setSyncGistFile)
  const setSyncWorkerEndpoint = useAppStore((s) => s.setSyncWorkerEndpoint)
  const saveGithubToken = useAppStore((s) => s.saveGithubToken)
  const copySyncAccessKey = useAppStore((s) => s.copySyncAccessKey)
  const notify = useAppStore((s) => s.notify)
  const syncNow = useAppStore((s) => s.syncNow)
  const clearRemoteSync = useAppStore((s) => s.clearRemoteSync)
  const resolveSyncConflict = useAppStore((s) => s.resolveSyncConflict)
  const [tokenDraft, setTokenDraft] = useState<string | null>(null)
  const [tokenCommitPending, setTokenCommitPending] = useState(false)
  const [tokenCommitOwner] = useState(createSettingsActionOwner)
  const tokenInputRef = useRef<HTMLInputElement | null>(null)
  const [syncSettingPending, setSyncSettingPending] = useState(false)
  const [syncSettingOwner] = useState(createSettingsActionOwner)
  const syncActionFocusOwnerRef = useRef<SyncActionFocusOwner | null>(null)
  const syncNowButtonRef = useRef<HTMLButtonElement | null>(null)
  const syncFocusScheduleGenerationRef = useRef(0)
  const syncFocusScheduleRef = useRef<SyncFocusSchedule | null>(null)
  const t = (key: AppStringKey) => appT(data, key)
  const sync = data?.sync
  const mode = sync?.mode ?? 'local'
  const syncModeHelpId = 'settings-sync-mode-help'
  const hasToken = githubToken.trim().length > 0
  const hasPassphrase = (syncPassphrase ?? '').trim().length > 0
  const runtimeLocale = resolveRuntimeLocale(data?.preferences.language)
  const cloudflareAccessKeyLabel = translate(
    runtimeLocale,
    'field.cloudflareAccessKey',
  )
  const cloudflareAccessKeyHint = translate(
    runtimeLocale,
    'settings.cloudflareAccessKeyFieldHint',
  )
  const modes: Array<{ id: SyncMode; label: AppStringKey }> = [
    { id: 'local', label: 'sync.local' },
    { id: 'gist', label: 'sync.gist' },
    { id: 'cloudflare', label: 'sync.cloudflare' },
  ]

  const commitToken = async () => {
    const tokenFocusOwner = document.activeElement
    try {
      await tokenCommitOwner.run(
        () =>
          commitSettingsDraft(
            tokenDraft,
            saveGithubToken,
            () =>
              setTokenDraft((current) =>
                current === tokenDraft ? null : current,
              ),
            (error) => notify(t(settingsDraftFailureKey(error)), 'error'),
          ),
        setTokenCommitPending,
      )
    } catch {
      console.error('[app] GitHub token UI action failed')
    } finally {
      restoreSettingsActionFocus(() => tokenInputRef.current, tokenFocusOwner)
    }
  }

  const runSyncAction = (
    action: () => unknown | Promise<unknown>,
  ): Promise<boolean> =>
    syncSettingOwner.run(action, setSyncSettingPending)

  const resolveSyncActionFocus = useCallback(
    (owner: SyncActionFocusOwner): HTMLButtonElement | null => {
      if (syncActionFocusOwnerRef.current !== owner) return null
      if (syncActionFocusWasAbandoned(owner)) {
        syncActionFocusOwnerRef.current = null
        return null
      }
      if (owner.target.disabled || !owner.target.isConnected) {
        const fallback = owner.fallbackTarget?.()
        if (fallback && fallback.isConnected && !fallback.disabled) {
          return fallback
        }
        return null
      }
      const resolution = resolveSettingsActionFocusOwner(
        owner,
        owner,
        {
          activeElement: document.activeElement,
          blocked: !document.querySelector('.settings-modal'),
          body: document.body,
        },
      )
      if (!resolution.completed) {
        if (syncActionFocusWasAbandoned(owner)) {
          syncActionFocusOwnerRef.current = null
        }
        return null
      }
      if (resolution.target) {
        return resolution.target
      }
      if (syncActionFocusWasAbandoned(owner)) {
        syncActionFocusOwnerRef.current = null
        return null
      }
      const fallback = owner.fallbackTarget?.()
      if (fallback && fallback.isConnected && !fallback.disabled) {
        return fallback
      }
      return null
    },
    [],
  )

  const scheduleSyncActionFocus = useCallback(
    (owner: SyncActionFocusOwner): void => {
      let schedule = syncFocusScheduleRef.current
      if (!schedule || schedule.owner !== owner) {
        schedule = {
          owner,
          generation: syncFocusScheduleGenerationRef.current + 1,
          attempt: 0,
          stableFrames: 0,
          pending: false,
        }
        syncFocusScheduleGenerationRef.current = schedule.generation
        syncFocusScheduleRef.current = schedule
      }
      if (schedule.pending) return
      if (schedule.attempt >= MAX_SYNC_FOCUS_ATTEMPTS) {
        if (syncActionFocusWaitsForState(owner)) return
        schedule.attempt = 0
        schedule.stableFrames = 0
      }

      const queueAttempt = (): void => {
        if (
          schedule === null ||
          schedule.pending ||
          schedule.attempt >= MAX_SYNC_FOCUS_ATTEMPTS
        ) {
          return
        }
        schedule.pending = true
        void scheduleInteractionFocus(() => {
          if (
            syncFocusScheduleRef.current !== schedule ||
            syncFocusScheduleGenerationRef.current !== schedule.generation ||
            syncActionFocusOwnerRef.current !== owner
          ) {
            return null
          }
          if (syncActionFocusWaitsForState(owner)) {
            schedule.stableFrames = 0
            return null
          }
          schedule.attempt += 1
          const target = resolveSyncActionFocus(owner)
          if (!target) {
            schedule.stableFrames = 0
          } else {
            schedule.stableFrames += 1
          }
          return target && schedule.stableFrames >= 2 ? target : null
        }).then((focused) => {
          schedule.pending = false
          if (
            syncFocusScheduleRef.current !== schedule ||
            syncFocusScheduleGenerationRef.current !== schedule.generation ||
            syncActionFocusOwnerRef.current !== owner
          ) {
            return
          }
          if (focused && schedule.stableFrames >= 2) {
            return
          }
          if (schedule.attempt < MAX_SYNC_FOCUS_ATTEMPTS) queueAttempt()
        })
      }
      queueAttempt()
    },
    [resolveSyncActionFocus],
  )

  useEffect(() => {
    if (syncing || syncSettingPending) return
    const owner = syncActionFocusOwnerRef.current
    if (!owner) return
    scheduleSyncActionFocus(owner)
  }, [scheduleSyncActionFocus, syncing, syncSettingPending])

  useEffect(
    () => () => {
      syncFocusScheduleGenerationRef.current += 1
      syncFocusScheduleRef.current = null
      syncActionFocusOwnerRef.current = null
    },
    [],
  )

  const runSyncActionWithFocus = async <T,>(
    action: () => Promise<T>,
    returnTarget: HTMLButtonElement,
    fallbackTarget?: () => HTMLButtonElement | null,
  ): Promise<T> => {
    const owner = {
      focusOwner: document.activeElement,
      target: returnTarget,
      fallbackTarget,
    }
    syncActionFocusOwnerRef.current = owner
    try {
      return await action()
    } finally {
      scheduleSyncActionFocus(owner)
    }
  }

  const commitSyncSetting = (
    action: () => Promise<boolean>,
    returnTarget?: HTMLButtonElement,
  ): void => {
    const syncSettingFocusOwner = returnTarget ? document.activeElement : null
    void runSyncAction(action)
      .catch(() => console.error('[app] sync setting UI action failed'))
      .finally(() => {
        if (returnTarget) {
          restoreSettingsActionFocus(
            () => returnTarget,
            syncSettingFocusOwner,
          )
        }
      })
  }

  const resolveConflict = (
    strategy: SyncConflictStrategy,
    returnTarget: HTMLButtonElement,
  ): Promise<void> => {
    if (syncSettingOwner.pending()) return Promise.resolve()
    return runSettingsAction(
      async () => {
        await runSyncActionWithFocus(
          () => runSyncAction(() => resolveSyncConflict(strategy)),
          returnTarget,
          () => syncNowButtonRef.current,
        )
      },
      () => notify(t('sync.resolveFailed'), 'error'),
    )
  }

  const runManualSync = async (returnTarget: HTMLButtonElement) => {
    try {
      await runSyncActionWithFocus(syncNow, returnTarget)
    } catch {
      console.error('[app] manual Sync UI action failed')
    }
  }

  const lastSync = sync?.lastSyncAt
    ? formatSyncTimestamp(sync.lastSyncAt, resolveAppLocale(data))
    : t('sync.never')
  const localizedSyncStatus = sync?.lastSyncStatus
    ? localizeSyncStatus(sync.lastSyncStatus, data?.preferences.language)
    : ''

  return (
    <div
      className="zc-sync-settings"
      data-zc-sync-settings="true"
      aria-busy={syncSettingPending}
    >
      <div
        className="zc-segmented"
        role="group"
        aria-label={t('sync.title')}
        aria-describedby={syncModeHelpId}
      >
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={mode === item.id ? 'active' : ''}
            aria-pressed={mode === item.id}
            disabled={syncSettingPending}
            onClick={(event) =>
              commitSyncSetting(() => setSyncMode(item.id), event.currentTarget)
            }
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <p id={syncModeHelpId} className="zc-help zc-section-help">
        {mode === 'local' ? t('sync.localOnly') : t('sync.modeHelp')}
      </p>

      <div className="zc-row between zc-sync-toggle">
        <span>{t('sync.auto')}</span>
        <Switch
          checked={sync?.autoSync ?? false}
          disabled={syncSettingPending}
          label={t('sync.auto')}
          onChange={(enabled) =>
            commitSyncSetting(() => setSyncAutoSync(enabled))
          }
        />
      </div>

      {mode === 'gist' && (
        <>
          <label className="zc-field">
            <span>{t('sync.gistId')}</span>
            <input
              value={sync?.gistId ?? ''}
              onChange={(event) => setSyncGistId(event.currentTarget.value)}
            />
          </label>
          <label className="zc-field">
            <span>{t('sync.gistFile')}</span>
            <input
              value={sync?.gistFile ?? ''}
              onChange={(event) => setSyncGistFile(event.currentTarget.value)}
            />
          </label>
          <label className="zc-field">
            <span>{t('sync.githubToken')}</span>
            <div className="zc-row zc-credential-row">
              <SecretInput
                inputRef={tokenInputRef}
                style={{ flex: 1, minWidth: 0 }}
                value={tokenDraft ?? ''}
                placeholder={
                  hasToken
                    ? t('settings.apiKeySaved')
                    : t('sync.githubTokenPlaceholder')
                }
                autoComplete="off"
                onChange={(event) => setTokenDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void commitToken()
                }}
                revealLabel={t('settings.showKey')}
                hideLabel={t('settings.hideKey')}
              />
              <button
                type="button"
                className="zc-btn"
                disabled={tokenCommitPending || tokenDraft === null}
                onClick={() => void commitToken()}
              >
                {t('common.save')}
              </button>
            </div>
          </label>
        </>
      )}

      {mode === 'cloudflare' && (
        <>
          <label
            className="zc-field"
            data-zc-cloudflare-worker-endpoint="true"
          >
            <span>{t('sync.workerEndpoint')}</span>
            <input
              type="url"
              value={sync?.workerEndpoint ?? ''}
              placeholder={t('sync.workerEndpointPlaceholder')}
              onChange={(event) => setSyncWorkerEndpoint(event.currentTarget.value)}
            />
          </label>
          <label
            className="zc-field"
            data-zc-cloudflare-access-key="true"
          >
            <span>{cloudflareAccessKeyLabel}</span>
            <div className="zc-row zc-credential-row">
              <input
                readOnly
                type="password"
                value=""
                aria-describedby={
                  hasPassphrase
                    ? 'settings-cloudflare-access-key-help'
                    : 'settings-cloudflare-access-key-help settings-cloudflare-access-key-required'
                }
                placeholder={translate(
                  runtimeLocale,
                  'placeholder.cloudflareAccessKey',
                )}
              />
              <button
                type="button"
                className="zc-btn"
                aria-label={`${t('message.copy')}: ${cloudflareAccessKeyLabel}`}
                data-tooltip={`${t('message.copy')}: ${cloudflareAccessKeyLabel}`}
                disabled={!hasPassphrase}
                onClick={() => void copySyncAccessKey()}
              >
                <Copy size={14} aria-hidden="true" />
                {t('message.copy')}
              </button>
            </div>
            <p id="settings-cloudflare-access-key-help" className="zc-help">
              {cloudflareAccessKeyHint}
            </p>
            {!hasPassphrase && (
              <p
                id="settings-cloudflare-access-key-required"
                className="zc-help"
                role="status"
              >
                {t('sync.needsPassphrase')}
              </p>
            )}
          </label>
        </>
      )}

      <div className="zc-sync-status">
        <span>{t('sync.lastSync')}</span>
        <strong>{lastSync}</strong>
        {localizedSyncStatus && <small>{localizedSyncStatus}</small>}
      </div>

      {syncConflict && (
        <div className="zc-sync-conflict" role="alert">
          <strong>{t('sync.conflictTitle')}</strong>
          <p>{t('sync.conflictBody')}</p>
          <div className="zc-row">
            <button
              type="button"
              className="zc-btn"
              disabled={syncing || syncSettingPending}
              onClick={(event) =>
                void resolveConflict('use-local', event.currentTarget)
              }
            >
              {t('sync.useLocal')}
            </button>
            <button
              type="button"
              className="zc-btn"
              disabled={syncing || syncSettingPending}
              onClick={(event) =>
                void resolveConflict('use-remote', event.currentTarget)
              }
            >
              {t('sync.useRemote')}
            </button>
            <button
              type="button"
              className="zc-btn primary"
              disabled={syncing || syncSettingPending}
              onClick={(event) =>
                void resolveConflict('merge', event.currentTarget)
              }
            >
              {t('sync.merge')}
            </button>
          </div>
        </div>
      )}

      <div className="zc-row">
        <button
          type="button"
          className="zc-btn primary"
          ref={syncNowButtonRef}
          data-zc-sync-now="true"
          disabled={syncing || syncSettingPending || mode === 'local'}
          onClick={(event) => void runManualSync(event.currentTarget)}
        >
          <RefreshCw
            size={14}
            className={syncing ? 'zc-sync-spinner' : undefined}
            aria-hidden="true"
          />
          {syncing ? t('settings.fetching') : t('sync.syncNow')}
        </button>
        <button
          type="button"
          className="zc-btn danger"
          disabled={syncing || syncSettingPending || mode === 'local'}
          onClick={(event) =>
            void runConfirmedSettingsAction(
              () => window.confirm(t('sync.clearConfirm')),
              clearRemoteSync,
              () => notify(t('settings.saveFailed'), 'error'),
              (action) =>
                runSyncActionWithFocus(
                  () => runSyncAction(action),
                  event.currentTarget,
                ),
              () => syncSettingOwner.pending(),
            )
          }
        >
          <Trash2 size={14} />
          {t('sync.clearRemote')}
        </button>
      </div>
    </div>
  )
}

export function GeneralTab() {
  const data = useAppStore((s) => s.data)
  const setTheme = useAppStore((s) => s.setTheme)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const toggleCompact = useAppStore((s) => s.toggleCompact)
  const setChatContextMessageLimit = useAppStore(
    (s) => s.setChatContextMessageLimit,
  )

  const t = (key: AppStringKey) => appT(data, key)
  const theme = data?.preferences.theme ?? 'system'
  const language = data?.preferences.language ?? 'system'
  const compact = data?.preferences.compactMode ?? false
  const chatContextMessageLimit = normalizeChatContextMessageLimit(
    data?.preferences.chatContextMessageLimit ??
      DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  )
  const chatContextHelpId = 'settings-chat-context-help'

  return (
    <div>
      <label className="zc-field">
        <span>{t('settings.theme')}</span>
        <select
          value={theme}
          onChange={(e) => setTheme(e.currentTarget.value as ThemeMode)}
        >
          <option value="system">{t('settings.themeSystem')}</option>
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
        </select>
      </label>

      <label className="zc-field">
        <span>{t('settings.language')}</span>
        <select
          value={language}
          onChange={(e) => {
            void setLanguage(e.currentTarget.value as LanguageMode)
          }}
        >
          <option value="system">{t('language.system')}</option>
          <option value="zh-CN">{t('language.zh-CN')}</option>
          <option value="en-US">{t('language.en-US')}</option>
          <option value="es-ES">{t('language.es-ES')}</option>
          <option value="hi-IN">{t('language.hi-IN')}</option>
          <option value="ar-SA">{t('language.ar-SA')}</option>
          <option value="pt-BR">{t('language.pt-BR')}</option>
          <option value="ru-RU">{t('language.ru-RU')}</option>
          <option value="ja-JP">{t('language.ja-JP')}</option>
          <option value="ko-KR">{t('language.ko-KR')}</option>
          <option value="fr-FR">{t('language.fr-FR')}</option>
        </select>
      </label>

      <div className="zc-row between">
        <span>{t('settings.compact')}</span>
        <Switch
          checked={compact}
          data-zc-compact-toggle="true"
          label={t('settings.compact')}
          onChange={() => toggleCompact()}
        />
      </div>

      <label className="zc-field" data-chat-context-setting="true">
        <span>{t('settings.chatContextLimit')}</span>
        <input
          type="number"
          min={MIN_CHAT_CONTEXT_MESSAGE_LIMIT}
          max={MAX_CHAT_CONTEXT_MESSAGE_LIMIT}
          step={1}
          value={chatContextMessageLimit}
          aria-describedby={chatContextHelpId}
          onChange={(event) =>
            setChatContextMessageLimit(Number(event.currentTarget.value))
          }
        />
        <p id={chatContextHelpId} className="zc-help">
          {t('settings.chatContextHelp')}
        </p>
      </label>
    </div>
  )
}

type SettingsDataActionRunner = (
  action: () => unknown | Promise<unknown>,
  returnTarget?: HTMLElement | null,
) => Promise<boolean>

const runSettingsDataActionDirectly: SettingsDataActionRunner = async (action) => {
  await action()
  return true
}

export function DataTab({
  dataActionPending = false,
  runDataAction = runSettingsDataActionDirectly,
}: {
  dataActionPending?: boolean
  runDataAction?: SettingsDataActionRunner
} = {}) {
  const data = useAppStore((s) => s.data)
  const exportBackup = useAppStore((s) => s.exportBackup)
  const importBackup = useAppStore((s) => s.importBackup)
  const resetAll = useAppStore((s) => s.resetAll)
  const syncPassphrase = useAppStore((s) => s.syncPassphrase)
  const setSyncPassphrase = useAppStore((s) => s.setSyncPassphrase)
  const notify = useAppStore((s) => s.notify)
  useDataCryptoWarmup()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importButtonRef = useRef<HTMLButtonElement | null>(null)
  const syncPassphraseInputRef = useRef<HTMLInputElement | null>(null)
  const [passphraseDraft, setPassphraseDraft] = useState<string | null>(null)
  const [passphraseCommitPending, setPassphraseCommitPending] = useState(false)
  const [passphraseCommitOwner] = useState(createSettingsActionOwner)
  const syncPassphraseHelpId = 'settings-sync-passphrase-help'

  const t = (key: AppStringKey) => appT(data, key)
  const hasPassphrase = syncPassphrase.trim().length > 0
  const commitPassphrase = async () => {
    const passphraseFocusOwner = document.activeElement
    try {
      await passphraseCommitOwner.run(
        () =>
          commitSettingsPassphraseDraft({
            clear: () =>
              setPassphraseDraft((current) =>
                current === passphraseDraft ? null : current,
              ),
            committedValue: syncPassphrase,
            confirmRotation: () =>
              window.confirm(t('settings.syncPassphraseRotateConfirm')),
            draft: passphraseDraft,
            onCancel: () => {
              notify(t('settings.syncPassphraseChangeCanceled'), 'info')
            },
            onError: (error) =>
              notify(t(settingsDraftFailureKey(error)), 'error'),
            save: setSyncPassphrase,
          }),
        setPassphraseCommitPending,
      )
    } catch {
      console.error('[app] sync passphrase UI action failed')
    } finally {
      restoreSettingsActionFocus(
        () => syncPassphraseInputRef.current,
        passphraseFocusOwner,
      )
    }
  }

  return (
    <div className="zc-data-settings" data-zc-data-settings="true">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        aria-disabled={dataActionPending}
        disabled={dataActionPending}
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (!file) return
          void runConfirmedSettingsAction(
            () => window.confirm(t('settings.importConfirm')),
            () => importBackup(file),
            () => notify(t('settings.saveFailed'), 'error'),
            (action) => runDataAction(action, importButtonRef.current),
            () => useAppStore.getState().settingsDataActionPending,
          )
        }}
      />

      <label className="zc-field">
        <span>{t('settings.syncPassphrase')}</span>
        <div className="zc-row zc-credential-row">
          <SecretInput
            data-zc-sync-passphrase="true"
            inputRef={syncPassphraseInputRef}
            style={{ flex: 1, minWidth: 0 }}
            disabled={dataActionPending}
            value={passphraseDraft ?? ''}
            placeholder={
              hasPassphrase
                ? t('settings.apiKeySaved')
                : t('settings.passphrasePlaceholder')
            }
            autoComplete="off"
            aria-describedby={syncPassphraseHelpId}
            onChange={(e) => setPassphraseDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitPassphrase()
            }}
            revealLabel={t('settings.showKey')}
            hideLabel={t('settings.hideKey')}
          />
          <button
            type="button"
            className="zc-btn"
            disabled={
              dataActionPending ||
              passphraseCommitPending ||
              passphraseDraft === null
            }
            onClick={() => void commitPassphrase()}
          >
            {t('common.save')}
          </button>
        </div>
        <p id={syncPassphraseHelpId} className="zc-help">
          {t('settings.syncPassphraseHelp')}
        </p>
      </label>

      <div className="zc-divider" />

      <div className="zc-row">
        <button
          type="button"
          className="zc-btn"
          data-zc-export-backup="true"
          disabled={dataActionPending}
          onClick={() =>
            void runDataAction(() =>
              runSettingsAction(exportBackup, () =>
                notify(t('settings.exportFailed'), 'error'),
              ),
            )
          }
        >
          {t('settings.export')}
        </button>
        <button
          type="button"
          className="zc-btn"
          data-zc-import-backup="true"
          disabled={dataActionPending}
          ref={importButtonRef}
          onClick={(event) => {
            importButtonRef.current = event.currentTarget
            fileInputRef.current?.click()
          }}
        >
          {t('settings.import')}
        </button>
      </div>

      <div className="zc-divider" />

      <button
        type="button"
        className="zc-btn danger"
        data-zc-reset-local="true"
        disabled={dataActionPending}
        onClick={() =>
          void runConfirmedSettingsAction(
            () => window.confirm(t('settings.resetConfirm')),
            resetAll,
            () => notify(t('settings.saveFailed'), 'error'),
            runDataAction,
            () => useAppStore.getState().settingsDataActionPending,
          )
        }
      >
        {t('settings.reset')}
      </button>
    </div>
  )
}

export function SettingsView() {
  const data = useAppStore((s) => s.data)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const dataActionPending = useAppStore((s) => s.settingsDataActionPending)
  const skillMutationPending = useAppStore((s) => s.skillMutationPending)
  const settingsActionPending = dataActionPending || skillMutationPending
  const setSettingsDataActionPending = useAppStore(
    (s) => s.setSettingsDataActionPending,
  )
  const settingsEntryTarget = useAppStore((s) => s.settingsEntryTarget)
  const consumeSettingsEntryTarget = useAppStore(
    (s) => s.consumeSettingsEntryTarget,
  )
  const [tab, setTab] = useState<Tab>('providers')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const dataActionStatusRef = useRef<HTMLDivElement | null>(null)
  const [focusOwner] = useState(() => currentSettingsFocusOwner())
  const [dataActionOwner] = useState(createSettingsActionOwner)
  const [dataActionFocusCoordinator] = useState(
    createSettingsDataActionFocusCoordinator,
  )
  const [dataActionFocusRevision, setDataActionFocusRevision] = useState(0)

  const runDataAction: SettingsDataActionRunner = async (
    action,
    explicitReturnTarget,
  ) => {
    const returnTarget =
      explicitReturnTarget?.isConnected
        ? explicitReturnTarget
        : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const focusToken = dataActionOwner.pending()
      ? null
      : dataActionFocusCoordinator.begin(returnTarget)
    try {
      return await dataActionOwner.run(action, setSettingsDataActionPending)
    } finally {
      if (focusToken !== null) {
        dataActionFocusCoordinator.complete(focusToken)
        setDataActionFocusRevision((current) => current + 1)
      }
    }
  }

  useEffect(() => {
    scheduleInteractionFocus(
      () => settingsFocusTargets(dialogRef.current)[0] ?? dialogRef.current,
    )
    return () => {
      void scheduleInteractionFocus(() =>
        settingsFocusOwnerIsCurrent(focusOwner) &&
        !document.querySelector('.settings-modal')
          ? focusOwner.target
          : null,
      )
    }
  }, [focusOwner])

  useEffect(() => {
    if (dataActionPending) {
      scheduleInteractionFocus(() => dataActionStatusRef.current)
      return
    }

    const completed = dataActionFocusCoordinator.takeCompletedTarget(false)
    if (!completed) return
    scheduleInteractionFocus(() =>
      dataActionFocusCoordinator.isCurrent(completed.token) &&
      completed.target?.isConnected
        ? completed.target
        : null,
    )
  }, [dataActionFocusCoordinator, dataActionFocusRevision, dataActionPending])

  useEffect(() => {
    if (tab !== 'providers' || settingsEntryTarget !== 'provider-key') return

    scheduleInteractionFocus(() => {
      const target = document.querySelector<HTMLInputElement>(
        '[data-provider-key-input="true"]',
      )
      if (!target) return null

      scrollInteractionElementIntoView(target, {
        behavior: 'auto',
        block: 'center',
        inline: 'nearest',
      })
      consumeSettingsEntryTarget('provider-key')
      return target
    })
  }, [
    consumeSettingsEntryTarget,
    data?.providers.length,
    settingsEntryTarget,
    tab,
  ])

  const t = (key: AppStringKey) => appT(data, key)

  const tabs: { id: Tab; label: AppStringKey }[] = [
    { id: 'providers', label: 'settings.providers' },
    { id: 'models', label: 'settings.models' },
    { id: 'skills', label: 'settings.skills' },
    { id: 'sync', label: 'settings.sync' },
    { id: 'general', label: 'settings.general' },
    { id: 'data', label: 'settings.data' },
  ]

  return (
    <div
      className="zc-settings-overlay"
      onClick={(e) => {
        if (!settingsActionPending && e.target === e.currentTarget) {
          setSettingsOpen(false)
        }
      }}
    >
      <div
        ref={dialogRef}
        className="zc-settings settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        aria-describedby="settings-dialog-description"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const focusTargets = settingsFocusTargets(event.currentTarget)
          const first = focusTargets[0]
          const last = focusTargets.at(-1)
          if (!first || !last) {
            event.preventDefault()
            focusInteractionElement(event.currentTarget)
            return
          }

          const active =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
          const wrapTarget = settingsDialogTabWrapTarget(
            focusTargets,
            active,
            event.shiftKey,
          )
          if (wrapTarget) {
            event.preventDefault()
            focusInteractionElement(wrapTarget)
          }
        }}
      >
        <nav
          className="zc-settings-nav"
          aria-busy={dataActionPending}
          inert={dataActionPending}
        >
          <button
            type="button"
            className="zc-settings-back"
            aria-label={t('app.backToChat')}
            disabled={settingsActionPending}
            onClick={() => setSettingsOpen(false)}
          >
            <ArrowLeft size={15} />
            <span>{t('app.backToChat')}</span>
          </button>
          <h2 id="settings-dialog-title">{t('settings.title')}</h2>
          {tabs.map((item) => (
            <button
              key={item.id}
              id={`settings-tab-${item.id}`}
              type="button"
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              {t(item.label)}
            </button>
          ))}
        </nav>
        <div className="zc-settings-body">
          <div
            className="zc-settings-body-header"
            aria-busy={dataActionPending}
            inert={dataActionPending}
          >
            <h3 id="settings-dialog-description">
              {t(tabs.find((item) => item.id === tab)?.label ?? 'settings.title')}
            </h3>
            <button
              type="button"
              className="zc-icon-btn"
              aria-label={t('app.closeSettings')}
              disabled={settingsActionPending}
              onClick={() => setSettingsOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          {dataActionPending && (
            <div
              ref={dataActionStatusRef}
              className="zc-settings-data-status"
              role="status"
              aria-atomic="true"
              aria-busy="true"
              aria-live="polite"
              data-zc-settings-data-pending="true"
              tabIndex={0}
            >
              {t('settings.dataActionPending')}
            </div>
          )}
           <div
             className="zc-settings-scroll"
             aria-busy={dataActionPending}
             inert={dataActionPending}
           >
             <FeatureHint
               key={settingsFeatureHint[tab]}
               id={settingsFeatureHint[tab]}
               restoreFocus={() => {
                 const target = document.querySelector<HTMLButtonElement>(
                   `#settings-tab-${tab}`,
                 )
                 return target?.classList.contains('active') ? target : null
               }}
             />
             {tab === 'providers' && <ProvidersTab />}
             {tab === 'models' && <ModelsTab />}
             {tab === 'skills' && <SkillsTab />}
             {tab === 'sync' && <SyncTab />}
             {tab === 'general' && <GeneralTab />}
             {tab === 'data' && (
               <DataTab
                 dataActionPending={dataActionPending}
                 runDataAction={runDataAction}
               />
             )}
          </div>
        </div>
      </div>
    </div>
  )
}
