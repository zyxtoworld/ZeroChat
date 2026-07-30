import {
  ListChecks,
  RefreshCw,
} from 'lucide-react'
import type {
  ReactElement,
  ReactNode,
} from 'react'
import {
  providerKindLabel,
  type Translator,
} from '../i18n'
import {
  displayProviderName,
  fallbackCapabilitiesForProvider,
  shouldUseBrowserProviderKey,
} from '../services/providerConfig'
import {
  providerCapabilityCheckDisplay,
  providerCapabilityCheckReadiness,
  providerCapabilityChecksForProviderCapabilities,
  providerFullCapabilityCheckKey,
} from '../services/providerCapabilityChecks'
import type {
  ProviderConnectivityField,
  ProviderConnectivityResult,
} from '../services/providerStatus'
import type { ProviderConfig } from '../types'
import type { SecretInputOptions } from './SecretInput'

interface FirstRunGuideProviderFieldsProps {
  t: Translator
  guideUsesCustomProvider: boolean
  selectedProvider: ProviderConfig
  selectedProviderRequest: ProviderConfig
  selectedProviderChatModels: string[]
  selectedProviderConnectivityField: ProviderConnectivityField
  selectedProviderConnectivityStatusId?: string
  selectedProviderConnectivityResult?: ProviderConnectivityResult
  providerKeys: Record<string, string>
  guideProviderKeyTitle: string
  guideProviderKeyHelpUrl?: string
  guideModelChoicesVisible: boolean
  loadingModelsProviderId: string
  checkingProviderId: string
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  renderNotice: (
    target: 'guide' | 'guide-models' | 'provider-capabilities',
  ) => ReactNode
  onUpdateProvider: (providerId: string, patch: Partial<ProviderConfig>) => void
  onUpdateProviderKey: (providerId: string, value: string) => void
  onSelectProviderModel: (providerId: string, value: string) => void
  onRefreshProviderModels: (providerId: string) => void | Promise<void>
  onCheckProviderFullCapabilities: (providerId: string) => void | Promise<void>
  onCommitEditsOnBlur: () => void
}

async function runFirstRunGuideProviderAction(
  action: () => void | Promise<void>,
): Promise<void> {
  try {
    await action()
  } catch {
    // The controller owns guide provider action reporting; this leaf boundary prevents leaks.
  }
}

function revealGuideConnectionEssentials(input: HTMLInputElement): void {
  const layout = input.closest<HTMLElement>('.guide-layout')
  const model = layout?.querySelector<HTMLInputElement>(
    '[data-provider-default-model-field="true"]',
  )

  if (!layout || !model) return

  const layoutBox = layout.getBoundingClientRect()
  const inputBox = input.getBoundingClientRect()
  const modelBox = model.getBoundingClientRect()
  const essentialsHeight = modelBox.bottom - inputBox.top

  if (essentialsHeight > layout.clientHeight - 16) return

  layout.scrollTop = Math.max(
    0,
    layout.scrollTop + inputBox.top - layoutBox.top - 8,
  )
}

export function FirstRunGuideProviderFields({
  t,
  guideUsesCustomProvider,
  selectedProvider,
  selectedProviderRequest,
  selectedProviderChatModels,
  selectedProviderConnectivityField,
  selectedProviderConnectivityStatusId,
  selectedProviderConnectivityResult,
  providerKeys,
  guideProviderKeyTitle,
  guideProviderKeyHelpUrl,
  guideModelChoicesVisible,
  loadingModelsProviderId,
  checkingProviderId,
  renderSecretInput,
  renderNotice,
  onUpdateProvider,
  onUpdateProviderKey,
  onSelectProviderModel,
  onRefreshProviderModels,
  onCheckProviderFullCapabilities,
  onCommitEditsOnBlur,
}: FirstRunGuideProviderFieldsProps): ReactElement {
  const requestUsesProxy = Boolean(selectedProviderRequest.proxyUrl?.trim())
  const guideProviderKeyHelpId = `guide-provider-key-help-${selectedProvider.id}`
  const guideProviderKeyLocalNoteId = `guide-provider-key-local-note-${selectedProvider.id}`
  const providerKeyStatusDescriptionId =
    selectedProviderConnectivityField === 'providerKey'
      ? selectedProviderConnectivityStatusId
      : undefined
  const providerKeyDescriptionIds = [
    guideProviderKeyHelpUrl ? guideProviderKeyHelpId : undefined,
    guideProviderKeyLocalNoteId,
    providerKeyStatusDescriptionId,
  ]
    .filter(Boolean)
    .join(' ')
  const guideBaseUrlHintId = `guide-base-url-hint-${selectedProvider.id}`
  const baseUrlStatusDescriptionId =
    selectedProviderConnectivityField === 'baseUrl'
      ? selectedProviderConnectivityStatusId
      : undefined
  const baseUrlDescriptionIds = [
    guideBaseUrlHintId,
    baseUrlStatusDescriptionId,
  ]
    .filter(Boolean)
    .join(' ')
  const guideProxyUrlHintId = `guide-proxy-url-hint-${selectedProvider.id}`
  const guideClientRequestModeHintId = `guide-client-request-mode-hint-${selectedProvider.id}`
  const guideBrowserOriginDirectHintId =
    `guide-browser-origin-direct-hint-${selectedProvider.id}`
  const guideWorkerHostedKeyHintId = `guide-worker-hosted-key-hint-${selectedProvider.id}`
  const proxyUrlStatusDescriptionId =
    selectedProviderConnectivityField === 'proxyUrl'
      ? selectedProviderConnectivityStatusId
      : undefined
  const proxyUrlRequiredByBrowserFailure =
    !requestUsesProxy &&
    selectedProviderConnectivityField === 'proxyUrl'
  const proxyUrlDescriptionIds = [
    guideProxyUrlHintId,
    requestUsesProxy ? undefined : guideBrowserOriginDirectHintId,
    proxyUrlStatusDescriptionId,
  ]
    .filter(Boolean)
    .join(' ')
  const guideProviderNameHintId = `guide-provider-name-hint-${selectedProvider.id}`
  const guideInterfaceTypeLabelId = `guide-interface-type-label-${selectedProvider.id}`
  const guideInterfaceTypeHintId = `guide-interface-type-hint-${selectedProvider.id}`
  const guideDefaultModelHintId = `guide-default-model-hint-${selectedProvider.id}`
  const guideDefaultModelManualLabel =
    `${t('field.defaultModel')}: ${t('placeholder.manualOrFetchModel')}`
  const guideDefaultModelSelectLabel =
    `${t('field.defaultModel')}: ${t('option.emptyModel')}`
  const guideModelFetchInProgress = Boolean(loadingModelsProviderId)
  const guideModelFetchCurrent =
    loadingModelsProviderId === selectedProvider.id
  const guideModelFetchTooltip = guideModelFetchCurrent
    ? t('button.fetchingModels')
    : t('button.fetchModels')
  const providerCapabilityCheckHintId =
    `guide-provider-capability-check-hint-${selectedProvider.id}`
  const providerCapabilityReadinessId =
    `guide-provider-capability-readiness-${selectedProvider.id}`
  const providerCapabilities = fallbackCapabilitiesForProvider(selectedProvider)
  const providerCapabilityChecks =
    providerCapabilityChecksForProviderCapabilities(providerCapabilities)
  const providerCapabilityReadiness = providerCapabilityCheckReadiness(
    selectedProvider,
    providerCapabilities,
    t,
  )
  const providerCapabilityReadinessState = providerCapabilityReadiness.state
  const providerCapabilityReadinessText = providerCapabilityReadiness.text
  const guideProviderAccessConfigured =
    selectedProvider.needsApiKey === false ||
    Boolean(providerKeys[selectedProvider.id]?.trim())
  const showGuideCapabilityChecks =
    providerCapabilityChecks.length > 0 &&
    guideProviderAccessConfigured &&
    Boolean(selectedProvider.model.trim())
  const providerChecking = Boolean(checkingProviderId)
  const fullCapabilityChecking =
    checkingProviderId === providerFullCapabilityCheckKey(selectedProvider.id)
  const fullCapabilityCheckDisabled =
    providerChecking || providerCapabilityReadinessState !== 'ready'
  const fullCapabilityCheckTooltip = fullCapabilityChecking
    ? t('button.checking')
    : providerCapabilityReadinessState !== 'ready'
      ? providerCapabilityReadinessText
      : t('settings.capabilityFullCheckNote')
  const fullCapabilityCheckDescriptionIds = [
    providerCapabilityCheckHintId,
    providerCapabilityReadinessId,
  ].join(' ')

  return (
    <div className="guide-provider-fields">
      {guideUsesCustomProvider ? (
        <>
          <label
            className={
              selectedProviderConnectivityField === 'baseUrl'
                ? 'field-has-error'
                : undefined
            }
          >
            {t('field.baseUrl')}
            <span className="sr-only" id={guideBaseUrlHintId}>
              {t('settings.providerBaseUrlHint')}
            </span>
            <input
              dir="auto"
              spellCheck={false}
              autoFocus
              value={selectedProvider.baseUrl}
              data-provider-base-url-field="true"
              aria-invalid={
                selectedProviderConnectivityField === 'baseUrl' || undefined
              }
              aria-describedby={baseUrlDescriptionIds}
              onFocus={(event) =>
                revealGuideConnectionEssentials(event.currentTarget)
              }
              onChange={(event) =>
                onUpdateProvider(selectedProvider.id, {
                  baseUrl: event.target.value,
                })
              }
              onBlur={onCommitEditsOnBlur}
              placeholder={t('placeholder.baseUrl')}
            />
          </label>
        </>
      ) : null}
      <div className="guide-key-field">
        <h3 className="guide-key-heading">{guideProviderKeyTitle}</h3>
        <label
          className={
            selectedProviderConnectivityField === 'providerKey'
              ? 'field-has-error'
              : undefined
          }
          data-provider-api-key-field="true"
        >
          {t('field.providerKey')}
          {renderSecretInput({
            id: `guide-provider:${selectedProvider.id}`,
            ariaLabel: t('field.providerKey'),
            value: providerKeys[selectedProvider.id] ?? '',
            onChange: (event) =>
              onUpdateProviderKey(selectedProvider.id, event.target.value),
            placeholder: t('placeholder.providerKey'),
            disabled: !shouldUseBrowserProviderKey(selectedProviderRequest),
            invalid: selectedProviderConnectivityField === 'providerKey',
            describedBy: providerKeyDescriptionIds,
          })}
        </label>
        <div className="guide-key-help">
          {guideProviderKeyHelpUrl ? (
            <a
              id={guideProviderKeyHelpId}
              href={guideProviderKeyHelpUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t('guide.providerKeyHelpLink')}
            </a>
          ) : null}
          <span
            className="guide-key-local-note"
            id={guideProviderKeyLocalNoteId}
          >
            {t('guide.providerKeyLocalOnly')}
          </span>
        </div>
        {selectedProviderConnectivityResult ? (
          <div
            id={selectedProviderConnectivityStatusId}
            className={`provider-connectivity-status ${selectedProviderConnectivityResult.tone}`}
            data-provider-connectivity-status="true"
            data-provider-connectivity-field={
              selectedProviderConnectivityResult.field
            }
            role={
              selectedProviderConnectivityResult.tone === 'error'
                ? 'alert'
                : 'status'
            }
            aria-live={
              selectedProviderConnectivityResult.tone === 'error'
                ? 'assertive'
                : 'polite'
            }
            aria-atomic="true"
          >
            {selectedProviderConnectivityResult.message}
          </div>
        ) : null}
      </div>
      <label>
        {t('field.defaultModel')}
        <div className="model-picker">
          <span className="sr-only" id={guideDefaultModelHintId}>
            {t('placeholder.manualOrFetchModel')}
          </span>
          <div
            className={`model-row ${
              guideModelChoicesVisible ? 'with-select' : ''
            }`}
          >
            <input
              aria-label={guideDefaultModelManualLabel}
              aria-describedby={guideDefaultModelHintId}
              dir="auto"
              spellCheck={false}
              value={selectedProvider.model}
              data-provider-default-model-field="true"
              onChange={(event) =>
                onUpdateProvider(selectedProvider.id, {
                  model: event.target.value,
                })
              }
              onBlur={onCommitEditsOnBlur}
              placeholder={t('placeholder.manualOrFetchModel')}
            />
            {guideModelChoicesVisible ? (
              <select
                className="model-list-select"
                aria-label={guideDefaultModelSelectLabel}
                aria-describedby={guideDefaultModelHintId}
                value={
                  selectedProviderChatModels.includes(selectedProvider.model)
                    ? selectedProvider.model
                    : ''
                }
                onChange={(event) =>
                  onSelectProviderModel(selectedProvider.id, event.target.value)
                }
                onBlur={onCommitEditsOnBlur}
                disabled={Boolean(loadingModelsProviderId)}
              >
                <option value="">{t('option.emptyModel')}</option>
                {selectedProviderChatModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <span
            className="model-fetch-tooltip-target"
            data-tooltip={guideModelFetchTooltip}
          >
            <button
              className="ghost-button"
              type="button"
              aria-describedby={guideDefaultModelHintId}
              data-model-fetch-button="guide"
              data-tooltip={guideModelFetchTooltip}
              onClick={() =>
                void runFirstRunGuideProviderAction(() =>
                  onRefreshProviderModels(selectedProvider.id),
                )
              }
              disabled={guideModelFetchInProgress}
            >
              <RefreshCw
                size={16}
                className={guideModelFetchCurrent ? 'spin' : ''}
              />
              {guideModelFetchTooltip}
            </button>
          </span>
        </div>
        {renderNotice('guide-models')}
      </label>
      {guideUsesCustomProvider ? (
        <>
          <label>
            {t('field.name')}
            <input
              value={displayProviderName(selectedProvider, t)}
              onChange={(event) =>
                onUpdateProvider(selectedProvider.id, {
                  name: event.target.value,
                })
              }
              onBlur={onCommitEditsOnBlur}
              aria-describedby={guideProviderNameHintId}
            />
          </label>
          <span className="sr-only" id={guideProviderNameHintId}>
            {t('settings.providerNameHint')}
          </span>
          <label>
            <span id={guideInterfaceTypeLabelId}>
              {t('field.interfaceType')}
            </span>
            <div
              className="readonly-field"
              role="note"
              aria-labelledby={guideInterfaceTypeLabelId}
              aria-describedby={guideInterfaceTypeHintId}
            >
              {providerKindLabel(selectedProvider.kind, t)}
            </div>
          </label>
          <span className="sr-only" id={guideInterfaceTypeHintId}>
            {t('settings.interfaceTypeNoteCustom')}
          </span>
          <label
            className={
              selectedProviderConnectivityField === 'proxyUrl'
                ? 'field-has-error'
                : undefined
            }
          >
            {t(
              proxyUrlRequiredByBrowserFailure
                ? 'field.workerEndpoint'
                : 'field.proxyUrl',
            )}
            <input
              dir="auto"
              spellCheck={false}
              value={selectedProvider.proxyUrl ?? ''}
              data-provider-proxy-url-field="true"
              aria-invalid={
                selectedProviderConnectivityField === 'proxyUrl' || undefined
              }
              aria-required={proxyUrlRequiredByBrowserFailure || undefined}
              aria-describedby={proxyUrlDescriptionIds}
              onChange={(event) =>
                onUpdateProvider(selectedProvider.id, {
                  proxyUrl: event.target.value.trim() || undefined,
                })
              }
              onBlur={onCommitEditsOnBlur}
              placeholder={t(
                proxyUrlRequiredByBrowserFailure
                  ? 'placeholder.workerEndpoint'
                  : 'placeholder.optionalProxy',
              )}
            />
          </label>
          <p id={guideProxyUrlHintId} className="settings-note">
            {t('settings.proxyUrlNote')}
          </p>
          {selectedProviderConnectivityField === 'proxyUrl' &&
          selectedProviderConnectivityResult?.tone === 'error' ? (
            <p
              className="provider-connectivity-inline-error"
              data-provider-connectivity-inline-error="proxyUrl"
            >
              {selectedProviderConnectivityResult.message}
            </p>
          ) : null}
          <label className="switch-row">
            <input
              type="checkbox"
              checked={Boolean(selectedProvider.clientRequestMode)}
              aria-describedby={guideClientRequestModeHintId}
              onChange={(event) =>
                onUpdateProvider(selectedProvider.id, {
                  clientRequestMode: event.target.checked,
                })
              }
              onBlur={onCommitEditsOnBlur}
            />
            {t('label.clientRequestMode')}
          </label>
          <p id={guideClientRequestModeHintId} className="settings-note">
            {t('settings.clientRequestModeNote')}
          </p>
          {requestUsesProxy ? null : (
            <p
              id={guideBrowserOriginDirectHintId}
              className="settings-note"
              data-guide-provider-browser-origin-guidance="true"
            >
              {t('settings.browserOriginDirectNote')}
            </p>
          )}
          {requestUsesProxy ? (
            <>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={selectedProvider.needsApiKey === false}
                  aria-describedby={guideWorkerHostedKeyHintId}
                  onChange={(event) =>
                    onUpdateProvider(selectedProvider.id, {
                      needsApiKey: event.target.checked ? false : true,
                    })
                  }
                  onBlur={onCommitEditsOnBlur}
                />
                {t('label.workerHostsProviderKey')}
              </label>
              <p id={guideWorkerHostedKeyHintId} className="settings-note">
                {t('settings.workerHostedKeyNote')}
              </p>
            </>
          ) : null}
        </>
      ) : null}
      {showGuideCapabilityChecks ? (
        <div className="provider-capability-panel guide-provider-capability-panel">
          <div
            id={providerCapabilityReadinessId}
            className={`provider-capability-readiness ${
              providerCapabilityReadinessState === 'ready'
                ? 'success'
                : 'warning'
            }`}
            data-guide-provider-capability-readiness={
              providerCapabilityReadinessState
            }
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="provider-capability-readiness-title">
              {t('settings.capabilityReadiness')}
            </span>
            <span>{providerCapabilityReadinessText}</span>
            <span className="provider-capability-readiness-note">
              {t('settings.capabilityReadinessNote')}
            </span>
          </div>
          <div className="field-label-row capability-check-heading">
            <span>{t('settings.capabilityChecks')}</span>
            <button
              className="ghost-button compact-button"
              type="button"
              data-guide-provider-full-capability-check="true"
              onClick={() =>
                void runFirstRunGuideProviderAction(() =>
                  onCheckProviderFullCapabilities(selectedProvider.id),
                )
              }
              disabled={fullCapabilityCheckDisabled}
              aria-describedby={fullCapabilityCheckDescriptionIds}
              data-tooltip={fullCapabilityCheckTooltip}
            >
              <ListChecks size={16} />
              {fullCapabilityChecking
                ? t('button.checking')
                : t('button.checkAllCapabilities')}
            </button>
          </div>
          <div
            className="capability-check-list"
            role="list"
            aria-describedby={providerCapabilityCheckHintId}
          >
            {providerCapabilityChecks.map((capability) => {
              const capabilityDisplay = providerCapabilityCheckDisplay(
                selectedProvider,
                capability,
                t,
              )
              const capabilityProbeResult =
                selectedProviderConnectivityResult?.capabilityResults?.[capability]
              const capabilityCheckDescriptionId =
                `guide-provider-capability-check-description-${selectedProvider.id}-${capability}`
              const capabilityProbeResultId = capabilityProbeResult
                ? `guide-provider-capability-check-result-${selectedProvider.id}-${capability}`
                : undefined
              const capabilityCheckDescriptionIds = [
                providerCapabilityCheckHintId,
                capabilityCheckDescriptionId,
                capabilityProbeResultId,
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <span
                  className="capability-check-chip"
                  data-guide-provider-capability-check={capability}
                  data-provider-capability-check-state={
                    capabilityDisplay.state
                  }
                  data-provider-capability-check-result={
                    capabilityProbeResult?.status ?? 'unverified'
                  }
                  role="listitem"
                  aria-describedby={capabilityCheckDescriptionIds}
                  key={capability}
                >
                  <span className="capability-check-copy">
                    <span className="capability-check-label">
                      {capabilityDisplay.label}
                    </span>
                    <span
                      className="capability-check-model"
                      data-tooltip={capabilityDisplay.tooltip}
                      aria-label={capabilityDisplay.tooltip}
                    >
                      {capabilityDisplay.modelText}
                    </span>
                    <span id={capabilityCheckDescriptionId} className="sr-only">
                      {capabilityDisplay.tooltip}
                    </span>
                    {capabilityProbeResult ? (
                      <span
                        id={capabilityProbeResultId}
                        className={`capability-check-status ${capabilityProbeResult.tone}`}
                        data-tooltip={capabilityProbeResult.message}
                      >
                        {capabilityProbeResult.message}
                      </span>
                    ) : capabilityDisplay.state === 'server-drill' ? (
                      <span
                        className="capability-check-status warning"
                        data-tooltip={capabilityDisplay.tooltip}
                      >
                        {capabilityDisplay.serverDrillText}
                      </span>
                    ) : null}
                  </span>
                </span>
              )
            })}
          </div>
          <p id={providerCapabilityCheckHintId} className="settings-note">
            {t('settings.capabilityCheckNote')}
          </p>
          {renderNotice('provider-capabilities')}
        </div>
      ) : null}
    </div>
  )
}
