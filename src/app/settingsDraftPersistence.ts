import { AppDataWriteConflictError } from '../storage/appDataWriteConflict'
import type { AppStringKey } from './strings'

type ClearSettingsDraft = (committedDraft?: string) => void

export function settingsDraftFailureKey(error: unknown): AppStringKey {
  return error instanceof AppDataWriteConflictError
    ? 'error.localDataWriteConflict'
    : 'settings.saveFailed'
}

function reportSettingsDraftFailure(
  onError: (error: unknown) => void,
  error: unknown,
): void {
  try {
    onError(error)
  } catch {
    // The persistence boundary already contains the failure; notices are best effort.
  }
}

export async function commitSettingsDraft(
  draft: string | null,
  save: (value: string) => Promise<boolean | void>,
  clear: ClearSettingsDraft,
  onError: (error: unknown) => void,
): Promise<boolean> {
  if (draft === null) return false
  try {
    const accepted = await save(draft)
    if (accepted === false) return false
    clear(draft)
    return true
  } catch (error) {
    reportSettingsDraftFailure(onError, error)
    return false
  }
}

export async function commitProviderKeyDraft({
  clear,
  draft,
  onError,
  save,
}: {
  clear: (committedDraft: string) => void
  draft: string | null
  onError: (error: unknown) => void
  save: (value: string) => Promise<boolean | void>
}): Promise<boolean> {
  if (draft === null) return false
  const committedDraft = draft
  return commitSettingsDraft(
    committedDraft.trim(),
    save,
    () => clear(committedDraft),
    onError,
  )
}

export type SettingsPassphraseCommitOutcome =
  | 'idle'
  | 'saved'
  | 'cancelled'
  | 'failed'

export async function commitSettingsPassphraseDraft({
  clear,
  committedValue,
  confirmRotation,
  draft,
  onCancel,
  onError,
  save,
}: {
  clear: ClearSettingsDraft
  committedValue: string
  confirmRotation: () => boolean
  draft: string | null
  onCancel: () => void
  onError: (error: unknown) => void
  save: (value: string) => Promise<boolean | void>
}): Promise<SettingsPassphraseCommitOutcome> {
  if (draft === null) return 'idle'

  if (committedValue.trim() && draft !== committedValue) {
    let confirmed: boolean
    try {
      confirmed = confirmRotation()
    } catch (error) {
      reportSettingsDraftFailure(onError, error)
      return 'failed'
    }

    if (!confirmed) {
      clear()
      try {
        onCancel()
      } catch {
        // Cancellation already restored the committed value; notices are best effort.
      }
      return 'cancelled'
    }
  }

  return await commitSettingsDraft(draft, save, clear, onError)
    ? 'saved'
    : 'failed'
}

export async function runSettingsAction(
  action: () => Promise<void>,
  onError: () => void,
): Promise<void> {
  try {
    await action()
  } catch {
    try {
      onError()
    } catch {
      // A detached action has no safer fallback when its notice channel fails.
    }
  }
}

export async function runConfirmedSettingsAction(
  confirm: () => boolean,
  action: () => boolean | void | Promise<boolean | void>,
  onError: () => void,
  runAction?: (
    action: () => unknown | Promise<unknown>,
  ) => Promise<boolean>,
  isPending?: () => boolean,
): Promise<boolean> {
  try {
    if (isPending?.()) return false
    if (!confirm()) return false
    let accepted = true
    const run = async () => {
      accepted = (await action()) !== false
    }
    if (runAction) {
      const admitted = await runAction(run)
      return admitted && accepted
    }
    await run()
    return accepted
  } catch {
    try {
      onError()
    } catch {
      // The action boundary already contained the failure; notices are best effort.
    }
    return false
  }
}
