import {
  Bot,
  Check,
  Cloud,
  HardDrive,
  MessageSquarePlus,
  Settings,
} from 'lucide-react'
import type { KeyboardEvent, ReactElement } from 'react'
import type { TranslationKey, Translator } from '../i18n'
import { focusInteractionElement } from '../services/interactionFocus'

export type SettingsTab =
  | 'appearance'
  | 'providers'
  | 'models'
  | 'skills'
  | 'sync'
  | 'data'

const settingsTabs = [
  ['appearance', Settings],
  ['providers', Bot],
  ['models', MessageSquarePlus],
  ['skills', Check],
  ['sync', Cloud],
  ['data', HardDrive],
] as const satisfies ReadonlyArray<readonly [SettingsTab, typeof Settings]>

interface SettingsNavProps {
  t: Translator
  settingsTab: SettingsTab
  onSelectTab: (tab: SettingsTab) => void
}

export function SettingsNav({
  t,
  settingsTab,
  onSelectTab,
}: SettingsNavProps): ReactElement {
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const key = event.key
    const last = settingsTabs.length - 1
    const nextIndex =
      key[0] === 'H'
        ? 0
        : key === 'End'
          ? last
          : key.startsWith('Arrow')
            ? (index + (key.endsWith('Left') || key.endsWith('Up') ? last : 1)) %
              (last + 1)
              : -1

    if (nextIndex < 0) return

    event.preventDefault()
    onSelectTab(settingsTabs[nextIndex][0])

    const nextTabButton = event.currentTarget.parentElement?.children[
      nextIndex
    ] as HTMLButtonElement | undefined
    focusInteractionElement(nextTabButton)
  }

  return (
    <div className="segmented" role="tablist" aria-label={t('settings.title')}>
      {settingsTabs.map(([id, Icon], index) => (
        <button
          type="button"
          key={id}
          id={`settings-tab-${id}`}
          role="tab"
          aria-selected={settingsTab === id}
          aria-controls={`settings-panel-${id}`}
          tabIndex={settingsTab === id ? 0 : -1}
          onClick={() => onSelectTab(id)}
          onKeyDown={(event) => handleTabKeyDown(event, index)}
        >
          <Icon />
          <span className="segmented-label">
            {t(`setting.${id}` as TranslationKey)}
          </span>
        </button>
      ))}
    </div>
  )
}
