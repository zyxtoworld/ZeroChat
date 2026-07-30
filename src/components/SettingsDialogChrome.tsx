import { LoaderCircle, X } from 'lucide-react'
import type {
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'

import type { Translator } from '../i18n'
import { scheduleInteractionFocus } from '../services/interactionFocus'
import { SettingsNav, type SettingsTab } from './SettingsNav'

interface SettingsDialogChromeProps {
  children: ReactNode
  settingsDataPending: boolean
  settingsModalRef: RefObject<HTMLElement | null>
  settingsTab: SettingsTab
  t: Translator
  renderFeatureHint: (
    id: SettingsTab,
    placement: 'settings',
  ) => ReactNode
  onCloseSettings: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onSelectTab: (tab: SettingsTab) => void
}

export function SettingsDialogChrome({
  children,
  settingsDataPending,
  settingsModalRef,
  settingsTab,
  t,
  renderFeatureHint,
  onCloseSettings,
  onSelectTab,
}: SettingsDialogChromeProps): ReactElement {
  return (
    <div
      className="modal-backdrop compact-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      aria-describedby="settings-description"
    >
      <section
        className={`modal settings-modal settings-modal-${settingsTab}`}
        ref={settingsModalRef}
        tabIndex={-1}
      >
        <div className="settings-sticky">
          <div className="modal-header">
            <div>
              <h2 id="settings-title">{t('settings.title')}</h2>
              <p id="settings-description">{t('settings.providerKeySyncNote')}</p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={t('button.closeSettings')}
              disabled={settingsDataPending}
              onClick={onCloseSettings}
            >
              <X size={18} />
            </button>
          </div>

          <div
            className="settings-modal-navigation"
            inert={settingsDataPending}
            aria-busy={settingsDataPending}
          >
            <SettingsNav
              t={t}
              settingsTab={settingsTab}
              onSelectTab={onSelectTab}
            />
            {renderFeatureHint(settingsTab, 'settings')}
          </div>
          {settingsDataPending ? (
            <div
              className="settings-data-progress"
              data-modal-initial-focus="true"
              data-settings-data-pending="true"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              tabIndex={0}
              ref={(element) => {
                if (element) {
                  scheduleInteractionFocus(() => element)
                }
              }}
            >
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
              <span>{t('ui.loading')}</span>
            </div>
          ) : null}
        </div>

        <div
          className="settings-modal-content"
          inert={settingsDataPending}
          aria-busy={settingsDataPending}
        >
          {children}
        </div>
      </section>
    </div>
  )
}
