import { Check } from 'lucide-react'
import type { ReactElement } from 'react'
import { providerPresets } from '../data/presets'
import {
  providerPresetLabel,
  type Translator,
} from '../i18n'
import {
  providerAccentIdForPresetId,
  providerPresetBadgeText,
  providerPresetMeta,
} from '../services/providerConfig'
import type { ProviderPreset } from '../types'

interface FirstRunGuideProviderPickerProps {
  t: Translator
  guideProviderCardPresets: ProviderPreset[]
  selectedPresetId: string
  onApplyGuidePreset: (presetId: string) => void
  onCommitEditsOnBlur: () => void
}

export function FirstRunGuideProviderPicker({
  t,
  guideProviderCardPresets,
  selectedPresetId,
  onApplyGuidePreset,
  onCommitEditsOnBlur,
}: FirstRunGuideProviderPickerProps): ReactElement {
  return (
    <div
      className="guide-provider-picker"
      role="group"
      aria-label={t('field.provider')}
    >
      <div className="guide-provider-grid">
        {guideProviderCardPresets.map((preset) => {
          const active = selectedPresetId === preset.id
          const providerLabel = providerPresetLabel(preset.id, preset.name, t)
          const providerMeta = providerPresetMeta(preset, t)
          const providerTooltip = `${providerLabel} · ${providerMeta}`

          return (
            <button
              key={preset.id}
              className={`guide-provider-card ${active ? 'active' : ''}`}
              type="button"
              data-guide-provider-card={preset.id}
              data-tooltip={providerTooltip}
              aria-label={providerTooltip}
              aria-pressed={active}
              onClick={() => onApplyGuidePreset(preset.id)}
            >
              <span
                className="provider-avatar guide-provider-avatar"
                data-provider-accent={providerAccentIdForPresetId(preset.id)}
                aria-hidden="true"
              >
                {providerPresetBadgeText(preset, t)}
              </span>
              <span className="guide-provider-copy">
                <strong>{providerLabel}</strong>
                <small>{providerMeta}</small>
              </span>
              {active ? (
                <Check
                  className="guide-provider-check"
                  size={15}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          )
        })}
      </div>
      <label className="guide-provider-select-row">
        <span>{t('field.provider')}</span>
        <select
          value={selectedPresetId}
          onChange={(event) => onApplyGuidePreset(event.target.value)}
          onBlur={onCommitEditsOnBlur}
        >
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
      </label>
    </div>
  )
}
