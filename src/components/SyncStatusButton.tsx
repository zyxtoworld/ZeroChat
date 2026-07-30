import {
  Cloud,
  GitBranch,
  HardDrive,
} from 'lucide-react'
import type {
  MouseEvent,
  ReactElement,
} from 'react'
import type { SyncChromeState } from '../services/syncChrome'
import type { SyncMode } from '../types'

interface SyncModeIconProps {
  mode: SyncMode
  size?: number
  syncing: boolean
}

interface SyncStatusButtonProps {
  syncChrome: SyncChromeState
  syncing: boolean
  tabIndex?: number
  variant: 'sidebar' | 'header'
  onOpenSyncSettings: (event: MouseEvent<HTMLButtonElement>) => void
}

export function SyncModeIcon({
  mode,
  size = 15,
  syncing,
}: SyncModeIconProps): ReactElement {
  if (mode === 'local') {
    return <HardDrive size={size} className={syncing ? 'spin' : ''} />
  }

  if (mode === 'gist') {
    return <GitBranch size={size} className={syncing ? 'spin' : ''} />
  }

  return <Cloud size={size} className={syncing ? 'spin' : ''} />
}

export function SyncStatusButton({
  syncChrome,
  syncing,
  tabIndex,
  variant,
  onOpenSyncSettings,
}: SyncStatusButtonProps): ReactElement {
  const className =
    variant === 'sidebar'
      ? 'sync-pill ghost-button'
      : 'chat-sync-strip ghost-button'

  return (
    <button
      className={className}
      type="button"
      data-settings-opener="true"
      data-tooltip={syncChrome.pillLabel}
      tabIndex={tabIndex}
      aria-label={syncChrome.pillLabel}
      onClick={onOpenSyncSettings}
    >
      <span
        className="sync-pill-status"
        role="status"
        aria-live="polite"
        aria-busy={syncing}
      >
        <SyncModeIcon mode={syncChrome.mode} syncing={syncing} />
        <span className="sync-pill-text">{syncChrome.pillText}</span>
      </span>
    </button>
  )
}
