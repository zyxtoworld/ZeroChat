import {
  Cloud,
  GitBranch,
  HardDrive,
} from 'lucide-react'
import type {
  ReactElement,
  ReactNode,
} from 'react'
import type { Translator } from '../i18n'
import type {
  AppData,
  SyncMode,
} from '../types'
import {
  runLeafAction,
  type LeafActionResult,
} from './MessageActionBoundary'
import type { SecretInputOptions } from './SecretInput'

interface FirstRunGuideSyncPanelProps {
  data: AppData
  t: Translator
  guideSyncNote: string
  syncPassphraseValue: string
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  onChangeSyncMode: (mode: SyncMode) => void
  onUpdateSyncPassphrase: (value: string) => void
  onCommitSyncPassphraseOnBlur: () => LeafActionResult
}

export function FirstRunGuideSyncPanel({
  data,
  t,
  guideSyncNote,
  syncPassphraseValue,
  renderSecretInput,
  onChangeSyncMode,
  onUpdateSyncPassphrase,
  onCommitSyncPassphraseOnBlur,
}: FirstRunGuideSyncPanelProps): ReactElement {
  const guideSyncNoteId = 'guide-sync-note'
  const guideSyncPassphraseHintId = 'guide-sync-passphrase-hint'

  return (
    <div className="guide-sync-panel">
      <div className="guide-sync-heading">
        <Cloud size={18} />
        <div>
          <h3>{t('setting.sync')}</h3>
          <p className="settings-note guide-sync-note" id={guideSyncNoteId}>
            {guideSyncNote}
          </p>
        </div>
      </div>
      <div
        className="mode-grid"
        role="group"
        aria-label={t('setting.sync')}
        aria-describedby={guideSyncNoteId}
      >
        <button
          type="button"
          className={data.sync.mode === 'local' ? 'active' : ''}
          aria-pressed={data.sync.mode === 'local'}
          onClick={() => onChangeSyncMode('local')}
        >
          <HardDrive size={18} />
          {t('mode.local')}
        </button>
        <button
          type="button"
          className={data.sync.mode === 'gist' ? 'active' : ''}
          aria-pressed={data.sync.mode === 'gist'}
          onClick={() => onChangeSyncMode('gist')}
        >
          <GitBranch size={18} />
          {t('mode.gistShort')}
        </button>
        <button
          type="button"
          className={data.sync.mode === 'cloudflare' ? 'active' : ''}
          aria-pressed={data.sync.mode === 'cloudflare'}
          onClick={() => onChangeSyncMode('cloudflare')}
        >
          <Cloud size={18} />
          {t('mode.workerShort')}
        </button>
      </div>
      <label className="guide-sync-passphrase">
        {t('field.syncPassphrase')}
        {renderSecretInput({
          id: 'guide-sync-passphrase',
          ariaLabel: t('field.syncPassphrase'),
          value: syncPassphraseValue,
          onChange: (event) => onUpdateSyncPassphrase(event.target.value),
          onBlur: () => {
            void runLeafAction(onCommitSyncPassphraseOnBlur)
          },
          placeholder: t('placeholder.syncPassphrase'),
          describedBy: guideSyncPassphraseHintId,
        })}
      </label>
      <p className="settings-note" id={guideSyncPassphraseHintId}>
        {t('settings.syncEncryptedNote')}
      </p>
    </div>
  )
}
