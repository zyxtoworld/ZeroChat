import { Cloud, RefreshCw } from 'lucide-react'
import type {
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'
import type { Translator } from '../i18n'
import type { AppData, SyncMode } from '../types'
import { runLeafAction, type LeafActionResult } from './MessageActionBoundary'
import type { SecretInputOptions } from './SecretInput'

interface SyncSettingsPanelProps {
  data: AppData
  t: Translator
  syncModeLabel: string
  syncStatusText: string
  syncRequirement: string
  syncConfigRef: RefObject<HTMLDivElement | null>
  githubTokenValue: string
  cloudflareAccessKey: string
  syncing: boolean
  recentSyncText: string
  notice: ReactNode
  renderSecretInput: (options: SecretInputOptions) => ReactNode
  onChangeSyncMode: (mode: SyncMode) => void
  onGistIdChange: (value: string) => void
  onGistFileChange: (value: string) => void
  onWorkerEndpointChange: (value: string) => void
  onGithubTokenChange: (value: string) => void
  onAutoSyncChange: (value: boolean) => void
  onCommitEditsOnBlur: () => void
  onCopyCloudflareAccessKey: () => LeafActionResult
  onRunSync: () => LeafActionResult
}

export function SyncSettingsPanel({
  data,
  t,
  syncModeLabel,
  syncStatusText,
  syncRequirement,
  syncConfigRef,
  githubTokenValue,
  cloudflareAccessKey,
  syncing,
  recentSyncText,
  notice,
  renderSecretInput,
  onChangeSyncMode,
  onGistIdChange,
  onGistFileChange,
  onWorkerEndpointChange,
  onGithubTokenChange,
  onAutoSyncChange,
  onCommitEditsOnBlur,
  onCopyCloudflareAccessKey,
  onRunSync,
}: SyncSettingsPanelProps): ReactElement {
  const syncCompareTitleId = 'sync-compare-title'
  const syncCompareDescriptionId = 'sync-compare-description'
  const syncRequirementId = 'sync-requirement'
  const syncRecentStatusId = 'sync-recent-status'
  const syncAutoSyncStatusId = 'sync-auto-sync-status'
  const syncConfigTitleId = 'sync-config-title'
  const syncConfigDescriptionId = 'sync-config-description'
  const gistIdHintId = 'sync-gist-id-hint'
  const gistFileHintId = 'sync-gist-file-hint'
  const githubTokenHintId = 'sync-github-token-hint'
  const cloudflareWorkerHintId = 'sync-cloudflare-worker-url-hint'
  const cloudflareAccessKeyHintId = 'sync-cloudflare-access-key-hint'
  const cloudflareAccessKeyNoteId = 'sync-cloudflare-access-key-note'
  const cloudflareAccessKeyDescriptionIds = `${cloudflareAccessKeyHintId} ${cloudflareAccessKeyNoteId}`
  const cloudflareAccessKeyCopyLabel = `${t('button.copy')}: ${t('field.cloudflareAccessKey')}`
  const syncNowDescriptionIds = [
    syncRequirement ? syncRequirementId : '',
    syncRecentStatusId,
  ].filter(Boolean).join(' ')
  const syncNowTooltip = syncRequirement || recentSyncText

  return (
    <div
      id="settings-panel-sync"
      className="form-stack sync-settings"
      role="tabpanel"
      aria-labelledby="settings-tab-sync"
    >
      <div className="sync-settings-header">
        <Cloud size={18} />
        <div>
          <h3>{t('setting.sync')}</h3>
          <p>{syncModeLabel} · {syncStatusText}</p>
        </div>
      </div>
      <section
        className="sync-compare"
        aria-labelledby={syncCompareTitleId}
        aria-describedby={syncCompareDescriptionId}
      >
        <h4 className="sr-only" id={syncCompareTitleId}>
          {t('sync.compare.title')}
        </h4>
        <div
          className="sync-compare-grid"
          role="group"
          aria-labelledby={syncCompareTitleId}
          aria-describedby={syncCompareDescriptionId}
        >
          <button
            type="button"
            className={`sync-compare-card ${
              data.sync.mode === 'local' ? 'active' : ''
            }`}
            aria-pressed={data.sync.mode === 'local'}
            onClick={() => onChangeSyncMode('local')}
          >
            <strong>{t('mode.local')}</strong>
            <p>{t('sync.compare.local.fit')}</p>
            <ul>
              <li>{t('sync.compare.local.pro')}</li>
              <li>{t('sync.compare.local.con')}</li>
            </ul>
          </button>
          <button
            type="button"
            className={`sync-compare-card ${
              data.sync.mode === 'gist' ? 'active' : ''
            }`}
            aria-pressed={data.sync.mode === 'gist'}
            onClick={() => onChangeSyncMode('gist')}
          >
            <strong>{t('mode.gist')}</strong>
            <p>{t('sync.compare.gist.fit')}</p>
            <ul>
              <li>{t('sync.compare.gist.pro')}</li>
              <li>{t('sync.compare.gist.con')}</li>
            </ul>
          </button>
          <button
            type="button"
            className={`sync-compare-card ${
              data.sync.mode === 'cloudflare' ? 'active' : ''
            }`}
            aria-pressed={data.sync.mode === 'cloudflare'}
            onClick={() => onChangeSyncMode('cloudflare')}
          >
            <strong>{t('mode.cloudflare')}</strong>
            <p>{t('sync.compare.cloudflare.fit')}</p>
            <ul>
              <li>{t('sync.compare.cloudflare.pro')}</li>
              <li>{t('sync.compare.cloudflare.con')}</li>
            </ul>
          </button>
        </div>
        <p
          className="settings-note sync-encryption-note"
          id={syncCompareDescriptionId}
        >
          {t('sync.compare.encrypted')}
        </p>
      </section>

      {syncRequirement ? (
        <p className="settings-note guide-requirement" id={syncRequirementId}>
          {syncRequirement}
        </p>
      ) : null}

      {data.sync.mode !== 'local' ? (
        <div
          className="sync-config-fields"
          ref={syncConfigRef}
          role="group"
          aria-labelledby={syncConfigTitleId}
          aria-describedby={syncConfigDescriptionId}
        >
          <h4 className="sr-only" id={syncConfigTitleId}>
            {syncModeLabel}
          </h4>
          <p className="sr-only" id={syncConfigDescriptionId}>
            {syncStatusText}
          </p>
          <label className="provider-list-toggle sync-auto-toggle">
            <input
              type="checkbox"
              checked={data.sync.autoSync}
              aria-describedby={syncAutoSyncStatusId}
              onChange={(event) => onAutoSyncChange(event.target.checked)}
            />
            <span>
              <strong>{t('field.autoSync')}</strong>
              <small id={syncAutoSyncStatusId}>
                {data.sync.autoSync
                  ? t('sync.autoSync.on')
                  : t('sync.autoSync.off')}
              </small>
            </span>
          </label>

          {data.sync.mode === 'gist' ? (
            <>
              <label>
                {t('field.gistId')}
                <input
                  dir="auto"
                  spellCheck={false}
                  value={data.sync.gistId ?? ''}
                  aria-describedby={gistIdHintId}
                  onChange={(event) => onGistIdChange(event.target.value)}
                  onBlur={onCommitEditsOnBlur}
                  placeholder={t('placeholder.gistFirstSyncEmpty')}
                />
              </label>
              <p className="settings-note" id={gistIdHintId}>
                {t('settings.gistIdHint')}
              </p>
              <label>
                {t('field.fileName')}
                <input
                  dir="auto"
                  spellCheck={false}
                  value={data.sync.gistFile ?? 'zerochat-sync.json'}
                  aria-describedby={gistFileHintId}
                  onChange={(event) => onGistFileChange(event.target.value)}
                  onBlur={onCommitEditsOnBlur}
                />
              </label>
              <p className="settings-note" id={gistFileHintId}>
                {t('settings.gistFileHint')}
              </p>
              <label>
                {t('field.githubToken')}
                {renderSecretInput({
                  id: 'github-token',
                  ariaLabel: t('field.githubToken'),
                  value: githubTokenValue,
                  onChange: (event) => onGithubTokenChange(event.target.value),
                  placeholder: t('placeholder.githubToken'),
                  describedBy: githubTokenHintId,
                })}
              </label>
              <p className="settings-note" id={githubTokenHintId}>
                {t('settings.githubTokenHint')}
              </p>
            </>
          ) : null}

          {data.sync.mode === 'cloudflare' ? (
            <>
              <label>
                {t('field.workerEndpoint')}
                <input
                  dir="auto"
                  spellCheck={false}
                  value={data.sync.workerEndpoint ?? ''}
                  aria-describedby={cloudflareWorkerHintId}
                  onChange={(event) => onWorkerEndpointChange(event.target.value)}
                  onBlur={onCommitEditsOnBlur}
                  placeholder={t('placeholder.workerEndpoint')}
                />
              </label>
              <p className="settings-note" id={cloudflareWorkerHintId}>
                {t('settings.cloudflareWorkerUrlHint')}
              </p>
              <p className="settings-note">
                {t('settings.cloudflarePasswordKeyNote')}
              </p>
              <label>
                {t('field.cloudflareAccessKey')}
                <div className="secret-copy-row">
                  {renderSecretInput({
                    id: 'cloudflare-access-key',
                    ariaLabel: t('field.cloudflareAccessKey'),
                    value: cloudflareAccessKey,
                    onChange: () => undefined,
                    placeholder: t('placeholder.cloudflareAccessKey'),
                    readOnly: true,
                    describedBy: cloudflareAccessKeyDescriptionIds,
                  })}
                  <button
                    type="button"
                    className="ghost-button"
                    aria-label={cloudflareAccessKeyCopyLabel}
                    data-tooltip={cloudflareAccessKeyCopyLabel}
                    onClick={() => runLeafAction(onCopyCloudflareAccessKey)}
                  >
                    {t('button.copy')}
                  </button>
                </div>
              </label>
              <p className="settings-note" id={cloudflareAccessKeyHintId}>
                {t('settings.cloudflareAccessKeyFieldHint')}
              </p>
              <p className="settings-note" id={cloudflareAccessKeyNoteId}>
                {t('settings.cloudflareAccessKeyNote')}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {notice}
      <span
        className="sync-now-tooltip-target"
        data-tooltip={syncNowTooltip}
      >
        <button
          type="button"
          className="primary-button"
          disabled={syncing || !!syncRequirement}
          aria-busy={syncing || undefined}
          aria-describedby={syncNowDescriptionIds}
          onClick={() => runLeafAction(onRunSync)}
        >
          <RefreshCw className={syncing ? 'spin' : ''} />
          {t('button.syncNow')}
        </button>
      </span>
      <p
        className="settings-note"
        id={syncRecentStatusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {recentSyncText}
      </p>
    </div>
  )
}
