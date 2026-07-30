import type { ReactElement } from 'react'

import { useProviderModelEditorController } from '../services/providerModelEditorController'
import { loadSettingsDataActionService } from '../services/settingsDataControllerLoader'
import type { AppOverlaysViewProps } from './AppOverlaysView'
import { runLeafAction } from './MessageActionBoundary'
import { SettingsOverlay } from './SettingsOverlay'
import type { SettingsTab } from './SettingsNav'

type ProviderModelEditorController = ReturnType<
  typeof useProviderModelEditorController
>
type SettingsOverlayHostProps = Omit<
  AppOverlaysViewProps,
  'providerModelEditorOptions'
> & ProviderModelEditorController

export function SettingsOverlayHost(
  props: SettingsOverlayHostProps,
): ReactElement | null {
  const {
    changeCompactMode,
    resetSyncPassphrase,
    selectSettingsTab,
    settingsOpen,
    settingsTab,
    ...settingsOverlayProps
  } = props

  function selectSettingsTabWithDataPrewarm(tab: SettingsTab): void {
    if (tab === 'data') {
      void loadSettingsDataActionService().catch(() => undefined)
    }

    selectSettingsTab(tab)
  }

  if (!settingsOpen) {
    return null
  }

  return (
    <SettingsOverlay
      {...settingsOverlayProps}
      onCompactModeChange={changeCompactMode}
      onResetSyncPassphrase={() => runLeafAction(resetSyncPassphrase)}
      onSelectTab={selectSettingsTabWithDataPrewarm}
      settingsTab={settingsTab}
    />
  )
}

export function SettingsOverlayRuntimeHost(
  props: AppOverlaysViewProps,
): ReactElement | null {
  const {
    providerModelEditorOptions,
    ...settingsOverlayProps
  } = props
  const providerModelEditor = useProviderModelEditorController(
    providerModelEditorOptions,
  )

  return (
    <SettingsOverlayHost
      {...settingsOverlayProps}
      {...providerModelEditor}
    />
  )
}
