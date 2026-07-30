import {
  useCallback,
  useRef,
  useState,
  type RefObject,
} from 'react'

import type { Translator } from '../i18n'
import type { NoticeTarget } from '../components/Notice'
import type { AppData, SyncMode } from '../types'
import { bump } from './appData'
import {
  resetSyncPassphraseDangerPrompt,
  rotateSyncPassphraseDangerPrompt,
  type DangerPrompt,
} from './dangerConfirmation'
import {
  resetSyncPassphraseState,
  revertedSyncPassphraseState,
  syncPassphraseCommitPlan,
  type SyncPassphraseCommitPlan,
  type SyncPassphraseState,
} from './syncFlow'
import type { NoticeTone } from './uiRuntime'
import { reportDetachedNotice } from './detachedFailureReporting'

type SetNotice = (
  message: string,
  tone?: NoticeTone,
  target?: NoticeTarget,
) => void

interface SyncPassphraseControllerOptions {
  commitEditsOnBlur: () => void
  dataRef: RefObject<AppData | null>
  persistSyncPassphrase: (value: string) => Promise<void>
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  setNotice: SetNotice
  t: Translator
  updateData: (updater: (current: AppData) => AppData) => AppData | null
}

export interface ClearSyncPassphraseOptions {
  persist?: boolean
}

interface SyncPassphraseController {
  activeSyncPassphraseAvailable: boolean
  activeSyncPassphraseRevision: number
  clearSyncPassphrase: (
    options?: ClearSyncPassphraseOptions,
  ) => Promise<boolean>
  commitSyncPassphraseOnBlur: () => Promise<void>
  hydrateSyncPassphrase: (value: string) => void
  markSyncPassphraseSynced: () => void
  passphraseRotationPendingRef: RefObject<boolean>
  resetSyncPassphrase: () => Promise<void>
  syncPassphraseRef: RefObject<string>
  syncPassphraseValue: string
  updateSyncPassphraseDraft: (value: string) => void
}

export interface ActiveSyncPassphraseStatus {
  available: boolean
  revision: number
}

export function nextActiveSyncPassphraseStatus(
  current: ActiveSyncPassphraseStatus,
  previousValue: string,
  nextValue: string,
): ActiveSyncPassphraseStatus {
  if (previousValue === nextValue) {
    return current
  }

  return {
    available: Boolean(nextValue.trim()),
    revision: current.revision + 1,
  }
}

export function committedSyncPassphraseState(
  value: string,
): SyncPassphraseState {
  return {
    value,
    committedValue: value,
    draftValue: value,
    rotationPending: false,
  }
}

export interface SyncPassphraseDataCommitContext {
  setNotice: SetNotice
  t: Translator
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

export interface SyncPassphraseStateCommitContext {
  applyState: (state: SyncPassphraseState) => void
  persistSyncPassphrase: (value: string) => Promise<void>
  setNotice: SetNotice
  t: Translator
}

interface SyncPassphraseNoticeContext {
  setNotice: SetNotice
}

export function reportSyncPassphraseNotice(
  context: SyncPassphraseNoticeContext,
  getMessage: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): void {
  reportDetachedNotice(context.setNotice, getMessage, tone, target)
}

export function reportSyncPasswordSaveUnavailable(
  context: Pick<SyncPassphraseDataCommitContext, 'setNotice' | 't'>,
): void {
  reportSyncPassphraseNotice(
    context,
    () => context.t('notice.syncPasswordSaveUnavailable'),
    'error',
    'data',
  )
}

export interface SyncPassphraseDangerConfirmationContext {
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  setNotice: SetNotice
  t: Translator
}

export async function confirmSyncPassphraseDangerAction(
  prompt: DangerPrompt,
  context: SyncPassphraseDangerConfirmationContext,
): Promise<boolean> {
  try {
    return await context.requestDangerConfirmation(prompt)
  } catch {
    reportSyncPasswordSaveUnavailable(context)
    return false
  }
}

export function commitSyncPassphraseDataBump(
  context: SyncPassphraseDataCommitContext,
): AppData | null {
  const saved = context.updateData((current) => bump(current), {
    autoSync: false,
  })

  if (!saved) {
    reportSyncPasswordSaveUnavailable(context)
    return null
  }

  return saved
}

export interface SyncPassphrasePlanCommitContext {
  commitDataBump: () => AppData | null
  commitEdits: () => void
  commitState: (state: SyncPassphraseState) => Promise<boolean>
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
}

export async function commitSyncPassphrasePlan(
  plan: SyncPassphraseCommitPlan,
  context: SyncPassphrasePlanCommitContext,
): Promise<boolean> {
  let syncSnapshot: AppData | null = null

  if (plan.shouldBumpData) {
    syncSnapshot = context.commitDataBump()

    if (!syncSnapshot) {
      return false
    }
  }

  if (plan.shouldPersistSecret && !await context.commitState(plan)) {
    return false
  }

  if (syncSnapshot) {
    context.scheduleAutoSync(syncSnapshot, 0)
  }

  if (plan.shouldCommitEdits) {
    context.commitEdits()
  }

  return true
}

export async function commitSyncPassphraseState(
  state: SyncPassphraseState,
  persist: boolean,
  context: SyncPassphraseStateCommitContext,
): Promise<boolean> {
  if (persist) {
    try {
      await context.persistSyncPassphrase(state.value)
    } catch {
      reportSyncPasswordSaveUnavailable(context)
      return false
    }
  }

  context.applyState(state)
  return true
}

export function useSyncPassphraseController({
  commitEditsOnBlur,
  dataRef,
  persistSyncPassphrase,
  requestDangerConfirmation,
  scheduleAutoSync,
  setNotice,
  t,
  updateData,
}: SyncPassphraseControllerOptions): SyncPassphraseController {
  const [syncPassphraseValue, setSyncPassphraseValue] = useState('')
  const [activeSyncPassphraseStatus, setActiveSyncPassphraseStatus] = useState<
    ActiveSyncPassphraseStatus
  >({
    available: false,
    revision: 0,
  })
  const syncPassphraseRef = useRef('')
  const syncPassphraseDraftRef = useRef('')
  const committedSyncPassphraseRef = useRef('')
  const passphraseRotationPendingRef = useRef(false)

  const applyCommittedSyncPassphraseState = useCallback(
    (state: SyncPassphraseState): void => {
      const previousActiveValue = syncPassphraseRef.current

      syncPassphraseRef.current = state.value
      syncPassphraseDraftRef.current = state.draftValue
      committedSyncPassphraseRef.current = state.committedValue
      passphraseRotationPendingRef.current = state.rotationPending
      setSyncPassphraseValue(state.draftValue)
      setActiveSyncPassphraseStatus((current) =>
        nextActiveSyncPassphraseStatus(
          current,
          previousActiveValue,
          state.value,
        ),
      )
    },
    [],
  )
  const applySyncPassphraseState = useCallback(
    (state: SyncPassphraseState, persist = true): Promise<boolean> =>
      commitSyncPassphraseState(state, persist, {
        applyState: applyCommittedSyncPassphraseState,
        persistSyncPassphrase,
        setNotice,
        t,
      }),
    [applyCommittedSyncPassphraseState, persistSyncPassphrase, setNotice, t],
  )
  const hydrateSyncPassphrase = useCallback(
    (value: string): void => {
      applyCommittedSyncPassphraseState(committedSyncPassphraseState(value))
    },
    [applyCommittedSyncPassphraseState],
  )
  const clearSyncPassphrase = useCallback(
    (options: ClearSyncPassphraseOptions = {}): Promise<boolean> =>
      applySyncPassphraseState(
        resetSyncPassphraseState(),
        options.persist ?? true,
      ),
    [applySyncPassphraseState],
  )
  const updateSyncPassphraseDraft = useCallback(
    (value: string): void => {
      syncPassphraseDraftRef.current = value
      setSyncPassphraseValue(value)
      passphraseRotationPendingRef.current = false
      reportSyncPassphraseNotice({ setNotice }, () => '')
    },
    [setNotice],
  )
  const markSyncPassphraseSynced = useCallback((): void => {
    applyCommittedSyncPassphraseState(
      committedSyncPassphraseState(syncPassphraseRef.current),
    )
  }, [applyCommittedSyncPassphraseState])
  const commitSyncPassphraseOnBlur = useCallback(async (): Promise<void> => {
    const syncMode: SyncMode | null = dataRef.current?.sync.mode ?? null
    let plan = syncPassphraseCommitPlan({
      syncMode,
      committedValue: committedSyncPassphraseRef.current,
      draftValue: syncPassphraseDraftRef.current,
    })

    if (plan.action === 'confirm-rotation') {
      const confirmed = await confirmSyncPassphraseDangerAction(
        rotateSyncPassphraseDangerPrompt(t),
        {
          requestDangerConfirmation,
          setNotice,
          t,
        },
      )

      plan = syncPassphraseCommitPlan({
        syncMode: dataRef.current?.sync.mode ?? null,
        committedValue: committedSyncPassphraseRef.current,
        draftValue: syncPassphraseDraftRef.current,
        confirmedRotation: confirmed,
      })
    }

    if (plan.action === 'revert') {
      await applySyncPassphraseState(
        revertedSyncPassphraseState(plan.committedValue),
      )
      reportSyncPassphraseNotice(
        { setNotice },
        () => t('notice.syncPasswordChangeCanceled'),
        'warning',
        'data',
      )
      return
    }

    await commitSyncPassphrasePlan(plan, {
      commitDataBump: () =>
        commitSyncPassphraseDataBump({
          setNotice,
          t,
          updateData,
        }),
      commitEdits: commitEditsOnBlur,
      commitState: applySyncPassphraseState,
      scheduleAutoSync,
    })
  }, [
    applySyncPassphraseState,
    commitEditsOnBlur,
    dataRef,
    requestDangerConfirmation,
    scheduleAutoSync,
    setNotice,
    t,
    updateData,
  ])
  const resetSyncPassphrase = useCallback(async (): Promise<void> => {
    const confirmed = await confirmSyncPassphraseDangerAction(
      resetSyncPassphraseDangerPrompt(t),
      {
        requestDangerConfirmation,
        setNotice,
        t,
      },
    )

    if (!confirmed) {
      return
    }

    if (!await clearSyncPassphrase()) {
      return
    }
    reportSyncPassphraseNotice(
      { setNotice },
      () => t('notice.syncPasswordReset'),
      'warning',
      'data',
    )
  }, [clearSyncPassphrase, requestDangerConfirmation, setNotice, t])

  return {
    activeSyncPassphraseAvailable: activeSyncPassphraseStatus.available,
    activeSyncPassphraseRevision: activeSyncPassphraseStatus.revision,
    clearSyncPassphrase,
    commitSyncPassphraseOnBlur,
    hydrateSyncPassphrase,
    markSyncPassphraseSynced,
    passphraseRotationPendingRef,
    resetSyncPassphrase,
    syncPassphraseRef,
    syncPassphraseValue,
    updateSyncPassphraseDraft,
  }
}
