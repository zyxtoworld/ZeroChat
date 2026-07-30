import { ChevronDown } from 'lucide-react'
import type { DragEvent, ReactElement } from 'react'

import { providerPresets } from '../data/presets'
import { providerPresetLabel, type Translator } from '../i18n'
import { setDataTransferDropEffect } from '../services/dragDropEffects'
import {
  browserProviderKey,
  displayProviderName,
  providerAccentId,
  providerBadgeText,
  providerForAiRequest,
  providerListMeta,
  providerListStatus,
} from '../services/providerConfig'
import type { ProviderConnectivityResult } from '../services/providerStatus'
import type { AppData, ProviderConfig } from '../types'
import type { ProviderNoticeRenderer } from './ProviderSettingsTypes'

interface ProviderSettingsListProps {
  data: AppData
  t: Translator
  visibleProviders: ProviderConfig[]
  selectedProviderId: string
  providerKeys: Record<string, string>
  providerConnectivityResults: Record<string, ProviderConnectivityResult>
  renderNotice: ProviderNoticeRenderer
  onAddProviderFromPreset: (presetId: string) => void
  onSelectProvider: (providerId: string) => void
  onSetProviderEnabled: (providerId: string, enabled: boolean) => void
  onProviderDragStart: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
  ) => void
  onProviderDrop: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
  ) => void
  onMove: (sourceProviderId: string, targetProviderId: string) => void
  onCommitEditsOnBlur: () => void
}

export function ProviderSettingsList({
  data,
  t,
  visibleProviders,
  selectedProviderId,
  providerKeys,
  providerConnectivityResults,
  renderNotice,
  onAddProviderFromPreset,
  onSelectProvider,
  onSetProviderEnabled,
  onProviderDragStart,
  onProviderDrop,
  onMove,
  onCommitEditsOnBlur,
}: ProviderSettingsListProps): ReactElement {
  return (
    <div className="provider-list">
      <div className="add-provider add-provider-top">
        <select
          value=""
          onChange={(event) => onAddProviderFromPreset(event.target.value)}
          onBlur={onCommitEditsOnBlur}
          aria-label={t('button.addProvider')}
        >
          <option value="" disabled>
            {t('button.addProvider')}
          </option>
          <optgroup label={t('settings.providerGroupOfficial')}>
            {providerPresets
              .filter((preset) => !preset.custom)
              .map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {providerPresetLabel(preset.id, preset.name, t)}
                </option>
              ))}
          </optgroup>
          <optgroup label={t('settings.providerGroupCustom')}>
            {providerPresets
              .filter((preset) => preset.custom)
              .map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {providerPresetLabel(preset.id, preset.name, t)}
                </option>
              ))}
          </optgroup>
        </select>
        <p className="settings-note custom-relay-help">
          {t('settings.customRelayHelp')}
        </p>
      </div>

      {visibleProviders.map((provider, index) => {
        const providerName = displayProviderName(provider, t)
        const requestProvider = providerForAiRequest(provider, data)
        const providerStatus = providerListStatus(
          provider,
          requestProvider,
          browserProviderKey(requestProvider, providerKeys),
          providerConnectivityResults[provider.id],
          t,
        )
        const providerEnabledLabel = `${providerName}: ${t('label.enabled')}`
        const providerDragLabel = `${providerName}: ${t('settings.dragProviderHint')}`
        const providerIsSelected = provider.id === selectedProviderId
        const previousProvider = visibleProviders[index - 1]
        const nextProvider = visibleProviders[index + 1]
        const canMoveProviderUp = previousProvider?.enabled === provider.enabled
        const canMoveProviderDown = nextProvider?.enabled === provider.enabled

        return (
                <div
                  key={provider.id}
                  className={`provider-list-row ${providerIsSelected ? 'active' : ''}`}
                  role="group"
                  aria-label={providerDragLabel}
                  draggable
            onDragStart={(event) => onProviderDragStart(event, provider.id)}
            onDragOver={(event) => {
              event.preventDefault()
              setDataTransferDropEffect(event.dataTransfer, 'move')
            }}
            onDrop={(event) => onProviderDrop(event, provider.id)}
          >
            <button
              type="button"
              className="provider-list-select"
              aria-pressed={providerIsSelected}
              onClick={() => onSelectProvider(provider.id)}
            >
              <span
                className="provider-avatar"
                data-provider-accent={providerAccentId(provider)}
                aria-hidden="true"
              >
                {providerBadgeText(provider, t)}
              </span>
              <span className="provider-list-summary">
                <span>{providerName}</span>
                <small>{providerListMeta(provider, t)}</small>
              </span>
              <span
                className={`provider-status provider-status-${providerStatus.tone}`}
                data-provider-list-status="true"
                data-provider-list-status-tone={providerStatus.tone}
              >
                <span className="provider-status-dot" aria-hidden="true" />
                <span>{providerStatus.label}</span>
              </span>
            </button>
            <div className="provider-list-move-actions">
              <button
                type="button"
                className="provider-list-move"
                aria-label={`${t('button.up')}: ${providerName}`}
                disabled={!canMoveProviderUp}
                onClick={() => {
                  if (previousProvider) {
                    onMove(provider.id, previousProvider.id)
                  }
                }}
              >
                <ChevronDown />
              </button>
              <button
                type="button"
                className="provider-list-move"
                aria-label={`${t('button.down')}: ${providerName}`}
                disabled={!canMoveProviderDown}
                onClick={() => {
                  if (nextProvider) {
                    onMove(provider.id, nextProvider.id)
                  }
                }}
              >
                <ChevronDown />
              </button>
            </div>
            <label className="provider-list-toggle">
              <input
                type="checkbox"
                checked={provider.enabled}
                aria-label={providerEnabledLabel}
                onChange={(event) =>
                  onSetProviderEnabled(provider.id, event.target.checked)
                }
                onBlur={onCommitEditsOnBlur}
              />
              <span>{t('label.enabled')}</span>
            </label>
          </div>
        )
      })}

      {renderNotice('providers-list')}
    </div>
  )
}
