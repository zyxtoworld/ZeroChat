import type {
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react'

import { clearNoticeSafely as clearSettingsOverlayNotice } from './NoticeClearReporter'
import { SettingsPage } from './SettingsPage'
import { settingsPagePropsFromOverlay } from './SettingsOverlayPageProps'
import type { SettingsOverlayProps } from './SettingsOverlayTypes'

export type { SettingsOverlayProps } from './SettingsOverlayTypes'

export function SettingsOverlay(props: SettingsOverlayProps): ReactElement {
  const {
    selectedProvider,
    commitModelDraft,
    setNotice,
    setSelectedProviderId,
    setSettingsOpen,
    suppressSettingsReturnFocus,
  } = props

  function closeSettingsFromButton(
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    if (event.detail > 0) {
      suppressSettingsReturnFocus()
      event.currentTarget.blur()
    }

    setSettingsOpen(false)
    clearSettingsOverlayNotice(setNotice)
  }

  function selectModelProvider(providerId: string): void {
    setSelectedProviderId(providerId)
    clearSettingsOverlayNotice(setNotice)
  }

  function selectProvider(providerId: string): void {
    if (selectedProvider) {
      commitModelDraft(selectedProvider.id)
    }

    setSelectedProviderId(providerId)
    clearSettingsOverlayNotice(setNotice)
  }

  const pageProps = settingsPagePropsFromOverlay(props, {
    onCloseSettings: closeSettingsFromButton,
    onSelectModelProvider: selectModelProvider,
    onSelectProvider: selectProvider,
  })

  return (
    <SettingsPage {...pageProps} />
  )
}
