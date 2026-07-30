import { Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import type {
  ChangeEvent,
  ReactElement,
  ReactNode,
} from 'react'
import type { Translator } from '../i18n'
import { runLeafAction, type LeafActionResult } from './MessageActionBoundary'
import type { SecretInputOptions } from './SecretInput'

interface DataSettingsPanelProps {
  t: Translator
  syncPassphraseValue: string
  syncing: boolean
  settingsDataPending: boolean
  dataNotice: ReactNode
  backupNotice: ReactNode
  dangerNotice: ReactNode
  cloudNotice: ReactNode
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  onSyncPassphraseChange: (value: string) => void
  onSyncPassphraseBlur: () => LeafActionResult
  onResetSyncPassphrase: () => LeafActionResult
  onExportData: () => LeafActionResult
  onImportData: (event: ChangeEvent<HTMLInputElement>) => LeafActionResult
  onOpenGuide: () => void
  onResetLocalData: () => LeafActionResult
  onClearCloudData: () => LeafActionResult
}

export function DataSettingsPanel({
  t,
  syncPassphraseValue,
  syncing,
  settingsDataPending,
  dataNotice,
  backupNotice,
  dangerNotice,
  cloudNotice,
  renderSecretInput,
  onSyncPassphraseChange,
  onSyncPassphraseBlur,
  onResetSyncPassphrase,
  onExportData,
  onImportData,
  onOpenGuide,
  onResetLocalData,
  onClearCloudData,
}: DataSettingsPanelProps): ReactElement {
  const syncPassphraseHintId = 'data-sync-passphrase-hint'
  const backupActionsTitleId = 'data-backup-actions-title'
  const backupActionsDescriptionId = 'data-backup-actions-description'
  const dangerActionsTitleId = 'data-danger-actions-title'
  const dangerActionsDescriptionId = 'data-danger-actions-description'
  const resetLocalDataDescriptionId = 'data-reset-local-description'
  const clearCloudDataDescriptionId = 'data-clear-cloud-description'

  return (
    <div
      id="settings-panel-data"
      className="form-stack"
      role="tabpanel"
      aria-labelledby="settings-tab-data"
    >
      <label>
        {t('field.syncPassphrase')}
        {renderSecretInput({
          id: 'sync-passphrase',
          ariaLabel: t('field.syncPassphrase'),
          value: syncPassphraseValue,
          onChange: (event) => onSyncPassphraseChange(event.target.value),
          onBlur: () => runLeafAction(onSyncPassphraseBlur),
          placeholder: t('placeholder.syncPassphrase'),
          describedBy: syncPassphraseHintId,
          disabled: syncing || settingsDataPending,
        })}
      </label>
      <p className="settings-note" id={syncPassphraseHintId}>
        {t('settings.syncEncryptedNote')}
      </p>
      <div className="button-row">
        <button
          className="ghost-button compact-button"
          type="button"
          onClick={() => runLeafAction(onResetSyncPassphrase)}
          disabled={syncing || settingsDataPending}
        >
          <RotateCcw />
          {t('button.resetSyncPassword')}
        </button>
      </div>
      {dataNotice}
      <section
        className="data-backup-actions"
        role="group"
        aria-labelledby={backupActionsTitleId}
        aria-describedby={backupActionsDescriptionId}
      >
        <h4 className="sr-only" id={backupActionsTitleId}>
          {t('button.exportBackup')} / {t('button.importBackup')}
        </h4>
        <p className="sr-only" id={backupActionsDescriptionId}>
          {t('settings.syncEncryptedNote')}
        </p>
        <div className="button-row backup-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => runLeafAction(onExportData)}
            disabled={syncing || settingsDataPending}
          >
            <Download />
            {t('button.exportBackup')}
          </button>
          <label
            className="ghost-button file-button"
            aria-disabled={syncing || settingsDataPending}
          >
            <Upload />
            {t('button.importBackup')}
            <input
              type="file"
              accept="application/json"
              disabled={syncing || settingsDataPending}
              onChange={(event) => runLeafAction(onImportData, event)}
            />
          </label>
        </div>
      </section>
      {backupNotice}
      <button
        className="ghost-button"
        type="button"
        onClick={onOpenGuide}
      >
        <RotateCcw />
        {t('button.openGuide')}
      </button>
      <section
        className="data-danger-actions"
        role="group"
        aria-labelledby={dangerActionsTitleId}
        aria-describedby={dangerActionsDescriptionId}
      >
        <h4 className="sr-only" id={dangerActionsTitleId}>
          {t('button.resetLocalData')} / {t('button.clearCloudData')}
        </h4>
        <p className="sr-only" id={dangerActionsDescriptionId}>
          {t('danger.review')}
        </p>
        <p className="sr-only" id={resetLocalDataDescriptionId}>
          {t('danger.reset.body')}
        </p>
        <button
          className="danger-button"
          type="button"
          data-settings-data-action="reset-local"
          onClick={() => runLeafAction(onResetLocalData)}
          disabled={syncing || settingsDataPending}
          aria-describedby={resetLocalDataDescriptionId}
        >
          <Trash2 />
          {t('button.resetLocalData')}
        </button>
        {dangerNotice}
        <div className="data-cloud-danger">
          <button
            className="danger-button"
            type="button"
            onClick={() => runLeafAction(onClearCloudData)}
            disabled={syncing || settingsDataPending}
            aria-describedby={clearCloudDataDescriptionId}
          >
            <Trash2 />
            {t('button.clearCloudData')}
          </button>
          <p className="settings-note" id={clearCloudDataDescriptionId}>
            {t('settings.clearCloudNote')}
          </p>
          {cloudNotice}
        </div>
      </section>
    </div>
  )
}
