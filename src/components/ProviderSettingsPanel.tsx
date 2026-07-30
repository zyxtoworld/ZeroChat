import { KeyRound } from 'lucide-react'
import type { DragEvent, ReactElement, ReactNode } from 'react'

import type { Translator } from '../i18n'
import type { ProviderCapabilityCheckKind } from '../services/providerCapabilityChecks'
import type { ProviderConnectivityResult } from '../services/providerStatus'
import type { AppData, ProviderConfig } from '../types'
import { ProviderSettingsEditor } from './ProviderSettingsEditor'
import { ProviderSettingsList } from './ProviderSettingsList'
import type { ProviderNoticeRenderer } from './ProviderSettingsTypes'
import type { SecretInputOptions } from './SecretInput'

interface ProviderSettingsPanelProps {
  data: AppData
  t: Translator
  visibleProviders: ProviderConfig[]
  selectedProvider: ProviderConfig | null
  providerKeys: Record<string, string>
  providerConnectivityResults: Record<string, ProviderConnectivityResult>
  checkingProviderId: string
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  renderNotice: ProviderNoticeRenderer
  onAddProviderFromPreset: (presetId: string) => void
  onSelectProvider: (providerId: string) => void
  onSetProviderEnabled: (providerId: string, enabled: boolean) => void
  onUpdateProvider: (providerId: string, patch: Partial<ProviderConfig>) => void
  onUpdateProviderKey: (providerId: string, value: string) => void
  onCheckProviderCapability: (
    providerId: string,
    capability: ProviderCapabilityCheckKind,
  ) => void | Promise<void>
  onCheckProviderFullCapabilities: (providerId: string) => void | Promise<void>
  onCheckProviderConnectivity: (providerId: string) => void | Promise<void>
  onRemoveProvider: (providerId: string) => void | Promise<void>
  onOpenFirstProviderSetup: () => void
  onProviderDragStart: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
  ) => void
  onProviderDrop: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
  ) => void
  onMoveProvider: (sourceProviderId: string, targetProviderId: string) => void
  onCommitEditsOnBlur: () => void
}

export function ProviderSettingsPanel({
  data,
  t,
  visibleProviders,
  selectedProvider,
  providerKeys,
  providerConnectivityResults,
  checkingProviderId,
  renderSecretInput,
  renderNotice,
  onAddProviderFromPreset,
  onSelectProvider,
  onSetProviderEnabled,
  onUpdateProvider,
  onUpdateProviderKey,
  onCheckProviderCapability,
  onCheckProviderFullCapabilities,
  onCheckProviderConnectivity,
  onRemoveProvider,
  onOpenFirstProviderSetup,
  onProviderDragStart,
  onProviderDrop,
  onMoveProvider,
  onCommitEditsOnBlur,
}: ProviderSettingsPanelProps): ReactElement {
  if (!selectedProvider) {
    return (
      <div
        id="settings-panel-providers"
        className="settings-empty-panel"
        role="tabpanel"
        aria-labelledby="settings-tab-providers"
      >
        <div className="settings-empty-icon" aria-hidden="true">
          <KeyRound size={20} />
        </div>
        <h3>{t('provider.emptyTitle')}</h3>
        <p>{t('provider.emptyBody')}</p>
        <button
          type="button"
          className="primary-button"
          data-add-first-provider="true"
          onClick={onOpenFirstProviderSetup}
        >
          <KeyRound />
          {t('button.addFirstProvider')}
        </button>
      </div>
    )
  }

  return (
    <div
      id="settings-panel-providers"
      className="settings-grid"
      role="tabpanel"
      aria-labelledby="settings-tab-providers"
    >
      <ProviderSettingsList
        data={data}
        t={t}
        visibleProviders={visibleProviders}
        selectedProviderId={selectedProvider.id}
        providerKeys={providerKeys}
        providerConnectivityResults={providerConnectivityResults}
        renderNotice={renderNotice}
        onAddProviderFromPreset={onAddProviderFromPreset}
        onSelectProvider={onSelectProvider}
        onSetProviderEnabled={onSetProviderEnabled}
        onProviderDragStart={onProviderDragStart}
        onProviderDrop={onProviderDrop}
        onMove={onMoveProvider}
        onCommitEditsOnBlur={onCommitEditsOnBlur}
      />

      <ProviderSettingsEditor
        data={data}
        t={t}
        selectedProvider={selectedProvider}
        providerKeys={providerKeys}
        providerConnectivityResults={providerConnectivityResults}
        checkingProviderId={checkingProviderId}
        renderSecretInput={renderSecretInput}
        renderNotice={renderNotice}
        onUpdateProvider={onUpdateProvider}
        onUpdateProviderKey={onUpdateProviderKey}
        onCheckProviderCapability={onCheckProviderCapability}
        onCheckProviderFullCapabilities={onCheckProviderFullCapabilities}
        onCheckProviderConnectivity={onCheckProviderConnectivity}
        onRemoveProvider={onRemoveProvider}
        onCommitEditsOnBlur={onCommitEditsOnBlur}
      />
    </div>
  )
}
