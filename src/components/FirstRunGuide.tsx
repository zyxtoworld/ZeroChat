import {
  X,
} from 'lucide-react'
import type {
  ReactElement,
  ReactNode,
} from 'react'
import type { Translator } from '../i18n'
import type {
  ProviderConnectivityField,
  ProviderConnectivityResult,
} from '../services/providerStatus'
import type {
  AppData,
  ProviderConfig,
  ProviderPreset,
  SyncMode,
} from '../types'
import { AppLogo } from './AppLogo'
import { FirstRunGuideActions } from './FirstRunGuideActions'
import { FirstRunGuideProviderFields } from './FirstRunGuideProviderFields'
import { FirstRunGuideProviderPicker } from './FirstRunGuideProviderPicker'
import { FirstRunGuideSyncPanel } from './FirstRunGuideSyncPanel'
import type { SecretInputOptions } from './SecretInput'

export interface FirstRunGuideProps {
  data: AppData
  t: Translator
  guideProviderCardPresets: ProviderPreset[]
  selectedPresetId: string
  guideUsesCustomProvider: boolean
  selectedProvider: ProviderConfig | null
  selectedProviderRequest: ProviderConfig | null
  selectedProviderChatModels: string[]
  selectedProviderConnectivityField: ProviderConnectivityField
  selectedProviderConnectivityStatusId?: string
  selectedProviderConnectivityResult?: ProviderConnectivityResult
  providerKeys: Record<string, string>
  guideProviderKeyTitle: string
  guideProviderKeyHelpUrl?: string
  guideModelChoicesVisible: boolean
  loadingModelsProviderId: string
  guideSyncNote: string
  syncPassphraseValue: string
  guideRequirement: string
  checkingProviderId: string
  guideCanFinish: boolean
  guideCheckingProvider: boolean
  guideSuccessPending: boolean
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  renderNotice: (
    target: 'guide' | 'guide-models' | 'provider-capabilities',
  ) => ReactNode
  onCloseGuide: () => void
  onApplyGuidePreset: (presetId: string) => void
  onUpdateProvider: (providerId: string, patch: Partial<ProviderConfig>) => void
  onUpdateProviderKey: (providerId: string, value: string) => void
  onSelectProviderModel: (providerId: string, value: string) => void
  onRefreshProviderModels: (providerId: string) => void | Promise<void>
  onCheckProviderFullCapabilities: (providerId: string) => void | Promise<void>
  onChangeSyncMode: (mode: SyncMode) => void
  onUpdateSyncPassphrase: (value: string) => void
  onCommitSyncPassphraseOnBlur: () => void | Promise<void>
  onFinishGuide: (localOnly?: boolean) => void | Promise<void>
  onCommitEditsOnBlur: () => void
}

export function FirstRunGuide({
  data,
  t,
  guideProviderCardPresets,
  selectedPresetId,
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
  guideSyncNote,
  syncPassphraseValue,
  guideRequirement,
  checkingProviderId,
  guideCanFinish,
  guideCheckingProvider,
  guideSuccessPending,
  renderSecretInput,
  renderNotice,
  onCloseGuide,
  onApplyGuidePreset,
  onUpdateProvider,
  onUpdateProviderKey,
  onSelectProviderModel,
  onRefreshProviderModels,
  onCheckProviderFullCapabilities,
  onChangeSyncMode,
  onUpdateSyncPassphrase,
  onCommitSyncPassphraseOnBlur,
  onFinishGuide,
  onCommitEditsOnBlur,
}: FirstRunGuideProps): ReactElement {
  const guideRequirementId = 'guide-requirement'

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      aria-describedby="guide-description"
    >
      <section className="modal guide-modal" tabIndex={-1}>
        <div className="modal-header">
          <div className="guide-brand-heading">
            <AppLogo size="brand" />
            <div className="guide-brand-copy">
              <span className="guide-brand-name">ZeroChat</span>
              <h2 id="guide-title">{t('guide.title')}</h2>
              <p id="guide-description">{t('guide.intro')}</p>
            </div>
          </div>
          {data.preferences.firstRunDone ? (
            <button
              className="icon-button"
              type="button"
              aria-label={t('button.closeGuide')}
              onClick={onCloseGuide}
            >
              <X size={18} />
            </button>
          ) : null}
        </div>

        <div className="guide-layout">
          {/* Keep Provider setup before optional sync so mobile visual and focus order match. */}
          <div className="form-stack">
            <FirstRunGuideProviderPicker
              t={t}
              guideProviderCardPresets={guideProviderCardPresets}
              selectedPresetId={selectedPresetId}
              onApplyGuidePreset={onApplyGuidePreset}
              onCommitEditsOnBlur={onCommitEditsOnBlur}
            />
            {guideUsesCustomProvider ? (
              <p className="settings-note custom-relay-help">
                {t('settings.customRelayHelp')}
              </p>
            ) : null}
            {selectedProvider && selectedProviderRequest ? (
              <FirstRunGuideProviderFields
                t={t}
                guideUsesCustomProvider={guideUsesCustomProvider}
                selectedProvider={selectedProvider}
                selectedProviderRequest={selectedProviderRequest}
                selectedProviderChatModels={selectedProviderChatModels}
                selectedProviderConnectivityField={selectedProviderConnectivityField}
                selectedProviderConnectivityStatusId={
                  selectedProviderConnectivityStatusId
                }
                selectedProviderConnectivityResult={
                  selectedProviderConnectivityResult
                }
                providerKeys={providerKeys}
                guideProviderKeyTitle={guideProviderKeyTitle}
                guideProviderKeyHelpUrl={guideProviderKeyHelpUrl}
                guideModelChoicesVisible={guideModelChoicesVisible}
                loadingModelsProviderId={loadingModelsProviderId}
                checkingProviderId={checkingProviderId}
                renderSecretInput={renderSecretInput}
                renderNotice={renderNotice}
                onUpdateProvider={onUpdateProvider}
                onUpdateProviderKey={onUpdateProviderKey}
                onSelectProviderModel={onSelectProviderModel}
                onRefreshProviderModels={onRefreshProviderModels}
                onCheckProviderFullCapabilities={
                  onCheckProviderFullCapabilities
                }
                onCommitEditsOnBlur={onCommitEditsOnBlur}
              />
            ) : null}
          </div>

          <div className="form-stack">
            <FirstRunGuideSyncPanel
              data={data}
              t={t}
              guideSyncNote={guideSyncNote}
              syncPassphraseValue={syncPassphraseValue}
              renderSecretInput={renderSecretInput}
              onChangeSyncMode={onChangeSyncMode}
              onUpdateSyncPassphrase={onUpdateSyncPassphrase}
              onCommitSyncPassphraseOnBlur={onCommitSyncPassphraseOnBlur}
            />
          </div>
        </div>

        {guideRequirement ? (
          <p className="settings-note guide-requirement" id={guideRequirementId}>
            {guideRequirement}
          </p>
        ) : null}

        {renderNotice('guide')}

        <FirstRunGuideActions
          data={data}
          t={t}
          checkingProviderId={checkingProviderId}
          guideCanFinish={guideCanFinish}
          guideRequirement={guideRequirement}
          guideRequirementId={guideRequirement ? guideRequirementId : undefined}
          guideCheckingProvider={guideCheckingProvider}
          guideSuccessPending={guideSuccessPending}
          onCloseGuide={onCloseGuide}
          onFinishGuide={onFinishGuide}
        />
      </section>
    </div>
  )
}
