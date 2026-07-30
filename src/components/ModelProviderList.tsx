import type { ReactElement } from 'react'

import type { Translator } from '../i18n'
import type { TranslationKey } from '../i18nTypes'
import { displayProviderName } from '../services/providerConfig'
import {
  configuredModelsForProvider,
  modelCapabilitiesForModels,
} from '../services/providerModels'
import type { ProviderConfig } from '../types'

interface ModelProviderListProps {
  t: Translator
  visibleProviders: ProviderConfig[]
  selectedProviderId: string
  onSelectProvider: (providerId: string) => void
}

export function ModelProviderList({
  t,
  visibleProviders,
  selectedProviderId,
  onSelectProvider,
}: ModelProviderListProps): ReactElement {
  return (
    <div className="provider-list">
      {visibleProviders.map((provider) => {
        const providerModels = configuredModelsForProvider(provider)
        const modelCount = providerModels.length
        const providerModelCapabilities =
          modelCapabilitiesForModels(providerModels)
        const capabilityLabels = providerModelCapabilities.map((capability) =>
          t(`capability.${capability}` as TranslationKey),
        )
        const capabilitySummary = capabilityLabels.join(' / ')
        const providerName = displayProviderName(provider, t)

        return (
          <button
            type="button"
            key={provider.id}
            className={`provider-list-select model-provider-row ${
              provider.id === selectedProviderId ? 'active' : ''
            }`}
            aria-pressed={provider.id === selectedProviderId}
            onClick={() => onSelectProvider(provider.id)}
          >
            <span className="model-provider-summary">
              <span>{providerName}</span>
              <small>
                {t('settings.modelCount', { count: modelCount })}
              </small>
            </span>
            {providerModelCapabilities.length > 0 ? (
              <span
                className="model-provider-capabilities"
                role="list"
                aria-label={`${providerName}: ${capabilitySummary}`}
              >
                {providerModelCapabilities.map((capability, index) => {
                  const label = capabilityLabels[index] ?? capability

                  return (
                    <span
                      className="model-provider-capability"
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
          </button>
        )
      })}
    </div>
  )
}
