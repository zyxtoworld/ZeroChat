import type { TranslationKey } from '../i18n'
import type {
  AppData,
  SyncConfig,
  SyncMode,
} from '../types'

export type SyncFirstSyncStrategy = 'ask' | 'merge' | 'use-remote' | 'use-local'

export interface RunSyncOptions {
  silent?: boolean
  pullOnly?: boolean
  firstSyncStrategy?: SyncFirstSyncStrategy
}

export interface PendingSyncRun {
  snapshot: AppData
  options: RunSyncOptions
}

export interface SyncCredentialState {
  githubTokenValue: string
  syncPassphraseValue: string
}

export type SyncPassphraseCommitAction =
  | 'unchanged'
  | 'local-commit'
  | 'confirm-rotation'
  | 'cloud-commit'
  | 'revert'

export interface SyncPassphraseCommitPlan {
  action: SyncPassphraseCommitAction
  value: string
  committedValue: string
  draftValue: string
  rotationPending: boolean
  shouldPersistSecret: boolean
  shouldBumpData: boolean
  shouldCommitEdits: boolean
}

export interface SyncPassphraseCommitOptions {
  syncMode: SyncMode | null
  committedValue: string
  draftValue: string
  confirmedRotation?: boolean
}

export interface SyncPassphraseState {
  value: string
  committedValue: string
  draftValue: string
  rotationPending: boolean
}

export type SyncRequirementKey = Extract<
  TranslationKey,
  | 'sync.requirement.local'
  | 'sync.requirement.passphrase'
  | 'sync.requirement.githubToken'
  | 'sync.requirement.cloudflareEndpoint'
>

export function syncRequirementKey(
  sync: SyncConfig,
  credentials: SyncCredentialState,
): SyncRequirementKey | '' {
  if (sync.mode === 'local') {
    return 'sync.requirement.local'
  }

  if (!credentials.syncPassphraseValue.trim()) {
    return 'sync.requirement.passphrase'
  }

  if (sync.mode === 'gist' && !credentials.githubTokenValue.trim()) {
    return 'sync.requirement.githubToken'
  }

  if (sync.mode === 'cloudflare' && !sync.workerEndpoint?.trim()) {
    return 'sync.requirement.cloudflareEndpoint'
  }

  return ''
}

export function missingSyncConfigRequirementKey(
  sync: SyncConfig,
  credentials: SyncCredentialState,
): Exclude<SyncRequirementKey, 'sync.requirement.local'> | null {
  const requirement = syncRequirementKey(sync, credentials)

  return requirement && requirement !== 'sync.requirement.local'
    ? requirement
    : null
}

export function hasConfiguredSyncCredentials(
  sync: SyncConfig,
  credentials: SyncCredentialState,
): boolean {
  if (sync.mode === 'local') {
    return false
  }

  if (!credentials.syncPassphraseValue.trim()) {
    return false
  }

  if (sync.mode === 'gist') {
    return Boolean(credentials.githubTokenValue.trim())
  }

  return Boolean(sync.workerEndpoint?.trim())
}

export function canPullRemoteSync(
  sync: SyncConfig,
  credentials: SyncCredentialState,
): boolean {
  if (!hasConfiguredSyncCredentials(sync, credentials)) {
    return false
  }

  return sync.mode !== 'gist' || Boolean(sync.gistId?.trim())
}

export function hasUnsyncedLocalChanges(snapshot: AppData): boolean {
  return snapshot.updatedAt > (snapshot.sync.lastSyncAt ?? 0)
}

export function shouldConfirmSyncPassphraseRotation({
  syncMode,
  committedValue,
  draftValue,
}: Omit<SyncPassphraseCommitOptions, 'confirmedRotation'>): boolean {
  return Boolean(
    syncMode &&
      syncMode !== 'local' &&
      committedValue &&
      draftValue &&
      draftValue !== committedValue,
  )
}

export function syncPassphraseCommitPlan({
  syncMode,
  committedValue,
  draftValue,
  confirmedRotation,
}: SyncPassphraseCommitOptions): SyncPassphraseCommitPlan {
  if (draftValue === committedValue) {
    return {
      action: 'unchanged',
      value: draftValue,
      committedValue,
      draftValue,
      rotationPending: false,
      shouldPersistSecret: false,
      shouldBumpData: false,
      shouldCommitEdits: true,
    }
  }

  if (syncMode === 'local') {
    return {
      action: 'local-commit',
      value: draftValue,
      committedValue: draftValue,
      draftValue,
      rotationPending: false,
      shouldPersistSecret: true,
      shouldBumpData: false,
      shouldCommitEdits: true,
    }
  }

  if (
    shouldConfirmSyncPassphraseRotation({
      syncMode,
      committedValue,
      draftValue,
    })
  ) {
    if (confirmedRotation === false) {
      return {
        ...revertedSyncPassphraseState(committedValue),
        action: 'revert',
        shouldPersistSecret: true,
        shouldBumpData: false,
        shouldCommitEdits: false,
      }
    }

    if (confirmedRotation !== true) {
      return {
        action: 'confirm-rotation',
        value: draftValue,
        committedValue,
        draftValue,
        rotationPending: false,
        shouldPersistSecret: false,
        shouldBumpData: false,
        shouldCommitEdits: false,
      }
    }
  }

  return {
    action: 'cloud-commit',
    value: draftValue,
    committedValue,
    draftValue,
    rotationPending: Boolean(committedValue && draftValue),
    shouldPersistSecret: true,
    shouldBumpData: true,
    shouldCommitEdits: true,
  }
}

export function revertedSyncPassphraseState(
  committedValue: string,
): SyncPassphraseState {
  return {
    value: committedValue,
    committedValue,
    draftValue: committedValue,
    rotationPending: false,
  }
}

export function resetSyncPassphraseState(): SyncPassphraseState {
  return {
    value: '',
    committedValue: '',
    draftValue: '',
    rotationPending: false,
  }
}

export function isFirstSyncConflictMessage(
  message: string,
  firstSyncConflictMessage: string,
): boolean {
  return message === firstSyncConflictMessage
}

export function pendingSyncRunFor(
  pending: PendingSyncRun | null,
  snapshot: AppData,
  options: RunSyncOptions,
): PendingSyncRun {
  const pullOnly = Boolean(options.pullOnly)

  if (pending && !pending.options.pullOnly && pullOnly) {
    return {
      snapshot,
      options: pending.options,
    }
  }

  return {
    snapshot,
    options: {
      pullOnly,
      silent: options.silent ?? true,
      firstSyncStrategy: options.firstSyncStrategy,
    },
  }
}
