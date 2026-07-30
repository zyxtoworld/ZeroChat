import type { Translator } from '../i18n'
import type {
  SyncConfig,
  SyncMode,
} from '../types'
import { syncRequirementKey } from './syncFlow'

export interface SyncChromeState {
  mode: SyncMode
  modeLabel: string
  pillLabel: string
  pillText: string
  requirement: string
  statusText: string
}

interface SyncChromeOptions {
  githubTokenValue: string
  sync: SyncConfig
  syncMessage: (message: string) => string
  syncPassphraseValue: string
  t: Translator
}

export function deriveSyncChrome({
  githubTokenValue,
  sync,
  syncMessage,
  syncPassphraseValue,
  t,
}: SyncChromeOptions): SyncChromeState {
  const mode = sync.mode
  const requirementKey = syncRequirementKey(sync, {
    githubTokenValue,
    syncPassphraseValue,
  })
  const requirement = requirementKey ? t(requirementKey) : ''
  const modeLabel =
    mode === 'gist'
      ? t('mode.gist')
      : mode === 'cloudflare'
        ? t('mode.cloudflare')
        : t('mode.local')
  const statusText =
    mode === 'local'
      ? t('sync.status.localMode')
      : requirement ||
        (sync.lastSyncStatus
          ? syncMessage(sync.lastSyncStatus)
          : t('status.localSaved'))
  const pillText =
    mode === 'local'
      ? `${modeLabel} · ${t('action.startCloudSync')}`
      : `${modeLabel} · ${statusText}`
  const pillLabel =
    mode === 'local'
      ? `${t('setting.sync')}: ${pillText} · ${statusText}`
      : `${t('setting.sync')}: ${pillText}`

  return {
    mode,
    modeLabel,
    pillLabel,
    pillText,
    requirement,
    statusText,
  }
}
