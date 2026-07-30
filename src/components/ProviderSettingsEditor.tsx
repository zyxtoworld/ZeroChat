import { Check, RotateCcw, Trash2 } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import { providerKindLabel, type Translator } from '../i18n'
import {
  capabilityLabel,
  displayProviderName,
  endpointLabelsForProvider,
  fallbackCapabilitiesForProvider,
  providerForAiRequest,
  shouldUseBrowserProviderKey,
} from '../services/providerConfig'
import {
  providerCheckKey,
  type ProviderConnectivityResult,
} from '../services/providerStatus'
import {
  providerCapabilityCheckDisplay,
  providerCapabilityCheckReadiness,
  providerCapabilityChecksForProviderCapabilities,
  providerCapabilityCheckKey,
  providerFullCapabilityCheckKey,
  type ProviderCapabilityCheckKind,
} from '../services/providerCapabilityChecks'
import type { AppData, ProviderConfig } from '../types'
import type { SecretInputOptions } from './SecretInput'
import { runLeafAction, type LeafActionResult } from './MessageActionBoundary'
import type { ProviderNoticeRenderer } from './ProviderSettingsTypes'

interface ProviderSettingsEditorProps {
  data: AppData
  t: Translator
  selectedProvider: ProviderConfig
  providerKeys: Record<string, string>
  providerConnectivityResults: Record<string, ProviderConnectivityResult>
  checkingProviderId: string
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  renderNotice: ProviderNoticeRenderer
  onUpdateProvider: (providerId: string, patch: Partial<ProviderConfig>) => void
  onUpdateProviderKey: (providerId: string, value: string) => void
  onCheckProviderCapability: (
    providerId: string,
    capability: ProviderCapabilityCheckKind,
  ) => LeafActionResult
  onCheckProviderFullCapabilities: (providerId: string) => LeafActionResult
  onCheckProviderConnectivity: (providerId: string) => LeafActionResult
  onRemoveProvider: (providerId: string) => LeafActionResult
  onCommitEditsOnBlur: () => void
}

export function ProviderSettingsEditor({
  data,
  t,
  selectedProvider,
  providerKeys,
  providerConnectivityResults,
  checkingProviderId,
  renderSecretInput,
  renderNotice,
  onUpdateProvider,
  onUpdateProviderKey,
  onCheckProviderCapability,
  onCheckProviderFullCapabilities,
  onCheckProviderConnectivity,
  onRemoveProvider,
  onCommitEditsOnBlur,
}: ProviderSettingsEditorProps): ReactElement {
  const selectedProviderRequest = providerForAiRequest(selectedProvider, data)
  const selectedProviderRequestUsesProxy = Boolean(
    selectedProviderRequest.proxyUrl?.trim(),
  )
  const selectedProviderConnectivityResult =
    providerConnectivityResults[selectedProvider.id]
  const selectedProviderConnectivityStatusId = `provider-connectivity-status-${selectedProvider.id}`
  const providerNameHintId = `provider-name-hint-${selectedProvider.id}`
  const providerKeyHintId = `provider-key-hint-${selectedProvider.id}`
  const providerBaseUrlHintId = `provider-base-url-hint-${selectedProvider.id}`
  const providerProxyUrlHintId = `provider-proxy-url-hint-${selectedProvider.id}`
  const providerClientRequestModeHintId = `provider-client-request-mode-hint-${selectedProvider.id}`
  const providerBrowserOriginDirectHintId =
    `provider-browser-origin-direct-hint-${selectedProvider.id}`
  const providerWorkerHostedKeyHintId = `provider-worker-hosted-key-hint-${selectedProvider.id}`
  const providerConnectivityCheckHintId = `provider-connectivity-check-hint-${selectedProvider.id}`
  const providerCapabilityCheckHintId = `provider-capability-check-hint-${selectedProvider.id}`
  const providerCapabilityReadinessId = `provider-capability-readiness-${selectedProvider.id}`
  const providerCapabilityBusyHintId = `provider-capability-check-busy-${selectedProvider.id}`
  const providerCapabilitiesLabelId = `provider-capabilities-label-${selectedProvider.id}`
  const providerInterfacesLabelId = `provider-interfaces-label-${selectedProvider.id}`
  const selectedProviderName = displayProviderName(selectedProvider, t)
  const deleteProviderLabel = `${t('button.deleteProvider')}: ${selectedProviderName}`
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
  const selectedProviderConnectivityField =
    selectedProviderConnectivityResult?.tone === 'error'
      ? selectedProviderConnectivityResult.field
      : 'none'
  const providerKeyHasError =
    selectedProviderConnectivityField === 'providerKey'
  const providerBaseUrlHasError =
    selectedProviderConnectivityField === 'baseUrl'
  const providerProxyUrlHasError =
    selectedProviderConnectivityField === 'proxyUrl'
  const providerKeyDescriptionIds = [
    providerKeyHintId,
    providerKeyHasError ? selectedProviderConnectivityStatusId : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  const providerBaseUrlDescriptionIds = [
    providerBaseUrlHintId,
    providerBaseUrlHasError ? selectedProviderConnectivityStatusId : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  const providerProxyUrlDescriptionIds = [
    providerProxyUrlHintId,
    selectedProviderRequestUsesProxy
      ? undefined
      : providerBrowserOriginDirectHintId,
    providerProxyUrlHasError ? selectedProviderConnectivityStatusId : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  const providerConnectivityActionDescriptionIds = [
    providerConnectivityCheckHintId,
    selectedProviderConnectivityResult
      ? selectedProviderConnectivityStatusId
      : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  const providerChecking = Boolean(checkingProviderId)
  const fullCapabilityChecking =
    checkingProviderId === providerFullCapabilityCheckKey(selectedProvider.id)
  const providerConnectivityChecking =
    checkingProviderId === providerCheckKey(selectedProvider.id)
  const providerRetryAction =
    selectedProviderConnectivityResult?.retryAction === 'fullCapabilities'
      ? 'fullCapabilities'
      : 'connectivity'
  const providerRetryChecking =
    providerRetryAction === 'fullCapabilities'
      ? fullCapabilityChecking
      : providerConnectivityChecking
  const providerCheckBlockedByOtherCheck =
    providerChecking && !providerConnectivityChecking
  const providerRetryBlockedByOtherCheck =
    providerChecking && !providerRetryChecking
  const providerCheckLabel = providerConnectivityChecking
    ? t('button.checking')
    : t('button.checkConnectivity')
  const providerCheckTooltip = providerConnectivityChecking
    ? t('button.checking')
    : providerCheckBlockedByOtherCheck
      ? t('settings.waitForCheck')
      : t('settings.connectivityCheckNote')
  const providerRetryTooltip = providerRetryChecking
    ? t('button.checking')
    : providerRetryBlockedByOtherCheck
      ? t('settings.waitForCheck')
      : t('button.retry')
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
    <div className="form-stack">
      <label>
        {t('field.name')}
        <input
          value={selectedProviderName}
          onChange={(event) =>
            onUpdateProvider(selectedProvider.id, {
              name: event.target.value,
            })
          }
          onBlur={onCommitEditsOnBlur}
          aria-describedby={providerNameHintId}
        />
      </label>
      <p id={providerNameHintId} className="settings-note">
        {t('settings.providerNameHint')}
      </p>
      <label>
        {t('field.interfaceType')}
        <div className="readonly-field">
          {providerKindLabel(selectedProvider.kind, t)}
        </div>
      </label>
      <p className="settings-note">
        {selectedProvider.custom
          ? t('settings.interfaceTypeNoteCustom')
          : t('settings.interfaceTypeNoteAuto')}
      </p>
      <label
        className={
          providerKeyHasError ? 'field-has-error' : undefined
        }
        data-provider-api-key-field="true"
      >
        {t('field.providerKey')}
        {renderSecretInput({
          id: `provider:${selectedProvider.id}`,
          ariaLabel: t('field.providerKey'),
          value: providerKeys[selectedProvider.id] ?? '',
          onChange: (event) =>
            onUpdateProviderKey(selectedProvider.id, event.target.value),
          placeholder: t('placeholder.providerKey'),
          disabled: !shouldUseBrowserProviderKey(selectedProviderRequest),
          invalid: providerKeyHasError,
          describedBy: providerKeyDescriptionIds,
        })}
      </label>
      <p id={providerKeyHintId} className="settings-note">
        {t('settings.providerKeyHint')}
      </p>
      <label
        className={
          providerBaseUrlHasError ? 'field-has-error' : undefined
        }
      >
        {t('field.baseUrl')}
        <input
          dir="auto"
          spellCheck={false}
          value={selectedProvider.baseUrl}
          data-provider-base-url-field="true"
          aria-invalid={providerBaseUrlHasError || undefined}
          aria-describedby={providerBaseUrlDescriptionIds}
          onChange={(event) =>
            onUpdateProvider(selectedProvider.id, {
              baseUrl: event.target.value,
            })
          }
          onBlur={onCommitEditsOnBlur}
          placeholder={t('placeholder.baseUrl')}
        />
      </label>
      <p id={providerBaseUrlHintId} className="settings-note">
        {t('settings.providerBaseUrlHint')}
      </p>
      <label
        className={
          providerProxyUrlHasError ? 'field-has-error' : undefined
        }
      >
        {t(
          !selectedProviderRequestUsesProxy && providerProxyUrlHasError
            ? 'field.workerEndpoint'
            : 'field.proxyUrl',
        )}
        <input
          dir="auto"
          spellCheck={false}
          value={selectedProvider.proxyUrl ?? ''}
          data-provider-proxy-url-field="true"
          aria-invalid={providerProxyUrlHasError || undefined}
          aria-describedby={providerProxyUrlDescriptionIds}
          onChange={(event) =>
            onUpdateProvider(selectedProvider.id, {
              proxyUrl: event.target.value.trim() || undefined,
            })
          }
          onBlur={onCommitEditsOnBlur}
          placeholder={t('placeholder.workerEndpoint')}
        />
      </label>
      <p id={providerProxyUrlHintId} className="settings-note">
        {t('settings.proxyUrlNote')}
      </p>
      {providerProxyUrlHasError ? (
        <p
          className="provider-connectivity-inline-error"
          data-provider-connectivity-inline-error="proxyUrl"
        >
          {selectedProviderConnectivityResult!.message}
        </p>
      ) : null}
      <label className="switch-row">
        <input
          type="checkbox"
          checked={Boolean(selectedProvider.clientRequestMode)}
          aria-describedby={providerClientRequestModeHintId}
          onChange={(event) =>
            onUpdateProvider(selectedProvider.id, {
              clientRequestMode: event.target.checked,
            })
          }
          onBlur={onCommitEditsOnBlur}
        />
        {t('label.clientRequestMode')}
      </label>
      <p id={providerClientRequestModeHintId} className="settings-note">
        {t('settings.clientRequestModeNote')}
      </p>
      {selectedProviderRequestUsesProxy ? null : (
        <p
          id={providerBrowserOriginDirectHintId}
          className="settings-note"
          data-provider-browser-origin-guidance="true"
        >
          {t('settings.browserOriginDirectNote')}
        </p>
      )}
      {selectedProviderRequestUsesProxy ? (
        <>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={selectedProvider.needsApiKey === false}
              aria-describedby={providerWorkerHostedKeyHintId}
              onChange={(event) =>
                onUpdateProvider(selectedProvider.id, {
                  needsApiKey: event.target.checked ? false : true,
                })
              }
              onBlur={onCommitEditsOnBlur}
            />
            {t('label.workerHostsProviderKey')}
          </label>
          <p id={providerWorkerHostedKeyHintId} className="settings-note">
            {t('settings.workerHostedKeyNote')}
          </p>
        </>
      ) : null}
      <p id={providerConnectivityCheckHintId} className="settings-note">
        {t('settings.connectivityCheckNote')}
      </p>
      <div className="provider-connectivity-actions">
        <span
          className="provider-connectivity-tooltip-target"
          data-tooltip={providerCheckTooltip}
        >
          <button
            type="button"
            className="primary-button"
            data-provider-connectivity-check="true"
            onClick={() =>
              runLeafAction(onCheckProviderConnectivity, selectedProvider.id)
            }
            disabled={providerChecking}
            aria-describedby={providerConnectivityActionDescriptionIds}
          >
            <Check />
            {providerCheckLabel}
          </button>
        </span>
        {selectedProviderConnectivityResult?.tone === 'error' &&
        selectedProviderConnectivityResult.retryable ? (
          <span
            className="provider-connectivity-tooltip-target"
            data-tooltip={providerRetryTooltip}
          >
            <button
              type="button"
              className="ghost-button compact-button"
              data-provider-connectivity-retry="true"
              data-provider-connectivity-retry-action={providerRetryAction}
              onClick={() =>
                providerRetryAction === 'fullCapabilities'
                  ? runLeafAction(
                      onCheckProviderFullCapabilities,
                      selectedProvider.id,
                    )
                  : runLeafAction(
                      onCheckProviderConnectivity,
                      selectedProvider.id,
                    )
              }
              disabled={providerChecking}
              aria-describedby={providerConnectivityActionDescriptionIds}
            >
              <RotateCcw />
              {t('button.retry')}
            </button>
          </span>
        ) : null}
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
      {renderNotice('providers')}
      <div className="provider-capability-panel">
        <div className="field-label-row">
          <span id={providerCapabilitiesLabelId}>
            {t('settings.capabilities')}
          </span>
        </div>
        <div
          className="capability-list"
          role="list"
          aria-labelledby={providerCapabilitiesLabelId}
        >
          {providerCapabilities.map((capability) => (
            <span className="capability-chip" role="listitem" key={capability}>
              {capabilityLabel(capability, t)}
            </span>
          ))}
        </div>
        <div className="field-label-row">
          <span id={providerInterfacesLabelId}>{t('settings.interfaces')}</span>
        </div>
        <div
          className="capability-list"
          role="list"
          aria-labelledby={providerInterfacesLabelId}
        >
          {endpointLabelsForProvider(selectedProvider).map((endpoint) => (
            <span className="endpoint-chip" role="listitem" key={endpoint}>
              {endpoint}
            </span>
          ))}
        </div>
        <p className="settings-note">{t('settings.capabilityNote')}</p>
        {providerCapabilityChecks.length ? (
          <>
            <div
              id={providerCapabilityReadinessId}
              className={`provider-capability-readiness ${
                providerCapabilityReadinessState === 'ready'
                  ? 'success'
                  : 'warning'
              }`}
              data-provider-capability-readiness={providerCapabilityReadinessState}
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
                type="button"
                className="ghost-button compact-button"
                data-provider-full-capability-check="true"
                onClick={() =>
                  runLeafAction(
                    onCheckProviderFullCapabilities,
                    selectedProvider.id,
                  )
                }
                disabled={fullCapabilityCheckDisabled}
                aria-describedby={fullCapabilityCheckDescriptionIds}
                data-tooltip={fullCapabilityCheckTooltip}
              >
                <Check />
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
                const capabilityChecking =
                  checkingProviderId ===
                  providerCapabilityCheckKey(selectedProvider.id, capability)
                const capabilityDisplay = providerCapabilityCheckDisplay(
                  selectedProvider,
                  capability,
                  t,
                )
                const capabilityProbeResult =
                  selectedProviderConnectivityResult?.capabilityResults?.[capability]
                const capabilityCheckDescriptionId =
                  `provider-capability-check-description-${selectedProvider.id}-${capability}`
                const capabilityProbeResultId = capabilityProbeResult
                  ? `provider-capability-check-result-${selectedProvider.id}-${capability}`
                  : undefined
                const capabilityDisabledByReadiness =
                  !capabilityDisplay.modelName || !capabilityDisplay.runsInBrowser
                const capabilityBlockedByOtherCheck =
                  providerChecking && !capabilityChecking
                const capabilityBusyDescriptionId =
                  capabilityBlockedByOtherCheck && !capabilityDisabledByReadiness
                    ? providerCapabilityBusyHintId
                    : undefined
                const capabilityCheckDescriptionIds = [
                  providerCapabilityCheckHintId,
                  capabilityCheckDescriptionId,
                  capabilityProbeResultId,
                  capabilityBusyDescriptionId,
                ]
                  .filter(Boolean)
                  .join(' ')
                const capabilityCheckTooltip = capabilityChecking
                  ? t('button.checking')
                  : capabilityBusyDescriptionId
                    ? t('settings.waitForCheck')
                    : capabilityDisplay.tooltip

                return (
                  <span
                    className="capability-check-chip"
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
                      <span
                        id={capabilityCheckDescriptionId}
                        className="sr-only"
                      >
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
                    <button
                      type="button"
                      className="ghost-button compact-button"
                      data-provider-capability-check={capability}
                      onClick={() =>
                        runLeafAction(
                          onCheckProviderCapability,
                          selectedProvider.id,
                          capability,
                        )
                      }
                      disabled={providerChecking || capabilityDisabledByReadiness}
                      aria-describedby={capabilityCheckDescriptionIds}
                      data-tooltip={capabilityCheckTooltip}
                    >
                      <Check />
                      {capabilityChecking
                        ? t('button.checking')
                        : t('button.checkModel')}
                    </button>
                  </span>
                )
              })}
            </div>
            <span id={providerCapabilityBusyHintId} className="sr-only">
              {t('settings.waitForCheck')}
            </span>
            <p id={providerCapabilityCheckHintId} className="settings-note">
              {t('settings.capabilityCheckNote')}
            </p>
            {renderNotice('provider-capabilities')}
          </>
        ) : null}
      </div>
      <button
        type="button"
        className="danger-button"
        data-provider-delete-action="true"
        onClick={() => runLeafAction(onRemoveProvider, selectedProvider.id)}
        aria-label={deleteProviderLabel}
        data-tooltip={deleteProviderLabel}
      >
        <Trash2 />
        {t('button.deleteProvider')}
      </button>
      {renderNotice('providers-danger')}
    </div>
  )
}
