import type { ReactElement } from 'react'

import { SettingsDialogChrome } from './SettingsDialogChrome'
import { SettingsPanelRouter } from './SettingsPanelRouter'
import type { SettingsPageProps } from './SettingsPageTypes'

export function SettingsPage(props: SettingsPageProps): ReactElement {
  const {
    settingsModalRef,
    settingsDataPending,
    settingsTab,
    t,
    renderFeatureHint,
    onCloseSettings,
    onSelectTab,
  } = props

  return (
    <SettingsDialogChrome
      settingsModalRef={settingsModalRef}
      settingsDataPending={settingsDataPending}
      settingsTab={settingsTab}
      t={t}
      renderFeatureHint={renderFeatureHint}
      onCloseSettings={onCloseSettings}
      onSelectTab={onSelectTab}
    >
      <SettingsPanelRouter {...props} />
    </SettingsDialogChrome>
  )
}
