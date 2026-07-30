import { Cloud, GitBranch, KeyRound, Trash2, Upload, X } from 'lucide-react'
import type { ReactElement } from 'react'

import type { Translator } from '../i18n'
import type { DangerPrompt } from '../services/dangerConfirmation'
import {
  runLeafAction,
  type LeafActionResult,
} from './MessageActionBoundary'

export type SyncFirstConflictResolution = 'merge' | 'use-remote' | 'use-local'

interface SyncFirstConflictDialogProps {
  t: Translator
  onCancel: () => void
  onResolve: (resolution: SyncFirstConflictResolution) => LeafActionResult
}

export function SyncFirstConflictDialog({
  t,
  onCancel,
  onResolve,
}: SyncFirstConflictDialogProps): ReactElement {
  return (
    <div
      className="modal-backdrop compact-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-conflict-title"
      aria-describedby="sync-conflict-description"
    >
      <section className="modal sync-conflict-modal" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="sync-conflict-title">{t('sync.firstConflict.title')}</h2>
            <p id="sync-conflict-description">{t('sync.firstConflict.body')}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={t('button.cancel')}
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <div className="danger-copy">
          <ul>
            <li>{t('sync.firstConflict.detail1')}</li>
            <li>{t('sync.firstConflict.detail2')}</li>
            <li>{t('sync.firstConflict.detailMerge')}</li>
            <li>{t('sync.firstConflict.detail3')}</li>
          </ul>
        </div>
        <div className="modal-actions sync-conflict-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            {t('button.cancel')}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => runLeafAction(onResolve, 'merge')}
          >
            <GitBranch size={16} />
            {t('button.mergeData')}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => runLeafAction(onResolve, 'use-remote')}
          >
            <Cloud size={16} />
            {t('button.useCloudData')}
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={() => runLeafAction(onResolve, 'use-local')}
          >
            <Upload size={16} />
            {t('button.uploadThisDevice')}
          </button>
        </div>
      </section>
    </div>
  )
}

interface DangerPromptDialogProps {
  prompt: DangerPrompt
  dangerSkipChecked: boolean
  t: Translator
  onSkipChange: (checked: boolean) => void
  onClose: (confirmed: boolean) => void
}

export function DangerPromptDialog({
  prompt,
  dangerSkipChecked,
  t,
  onSkipChange,
  onClose,
}: DangerPromptDialogProps): ReactElement {
  return (
    <div
      className="modal-backdrop danger-backdrop compact-dialog-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="danger-title"
      aria-describedby="danger-description"
    >
      <section className="modal danger-modal" tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 id="danger-title">{prompt.title}</h2>
            <p>{t('danger.review')}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={t('button.cancel')}
            onClick={() => onClose(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="danger-copy" id="danger-description">
          <p>{prompt.body}</p>
          <ul>
            {prompt.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </div>
        {prompt.allowSkip !== false ? (
          <label className="switch-row danger-skip">
            <input
              type="checkbox"
              checked={dangerSkipChecked}
              onChange={(event) => onSkipChange(event.target.checked)}
            />
            <span>{t('danger.skip')}</span>
          </label>
        ) : null}
        <div className="modal-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => onClose(false)}
          >
            {t('button.cancel')}
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={() => onClose(true)}
          >
            {prompt.confirmIcon === 'key' ? (
              <KeyRound size={16} />
            ) : (
              <Trash2 size={16} />
            )}
            {prompt.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
