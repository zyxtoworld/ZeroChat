import type { ChangeEvent } from 'react'
import {
  useCallback,
  useMemo,
  useState,
} from 'react'

import type { NoticeTarget } from '../components/Notice'
import { createActionGate } from './actionGate'
import { reportDetachedFormattedFailure } from './detachedFailureReporting'
import { scheduleInteractionFocus } from './interactionFocus'
import type {
  SettingsDataActions,
  SettingsDataControllerContext,
} from './settingsDataController'
import { loadSettingsDataActionService } from './settingsDataControllerLoader'

interface SettingsDataController {
  exportData: () => Promise<void>
  importData: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  resetLocalData: () => Promise<void>
  settingsDataPending: boolean
}

export { createActionGate as createSettingsDataActionGate } from './actionGate'

export function useSettingsDataController(
  context: SettingsDataControllerContext,
): SettingsDataController {
  const actionGate = useMemo(() => createActionGate(), [])
  const [settingsDataPending, setSettingsDataPending] = useState(false)
  const runSettingsDataAction = useCallback(
    async (
      target: NoticeTarget,
      run: (
        actions: SettingsDataActions,
      ) => Promise<void> | void,
      returnFocusSelector?: string,
    ): Promise<void> => {
      const release = actionGate.claim()

      if (!release) {
        return
      }

      const returnFocusTarget =
        typeof document !== 'undefined' &&
        typeof HTMLElement !== 'undefined' &&
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null

      setSettingsDataPending(true)
      try {
        const createSettingsDataActions = await loadSettingsDataActionService()
        await run(createSettingsDataActions(context))
      } catch (error: unknown) {
        reportDetachedFormattedFailure(context, error, target)
      } finally {
        release()
        setSettingsDataPending(false)
        scheduleInteractionFocus(() =>
          returnFocusSelector && typeof document !== 'undefined'
            ? document.querySelector<HTMLElement>(returnFocusSelector) ??
              returnFocusTarget
            : returnFocusTarget,
        )
      }
    },
    [actionGate, context],
  )

  const exportData = useCallback(
    () =>
      runSettingsDataAction(
        'data-backup',
        (actions) => actions.exportData(),
      ),
    [runSettingsDataAction],
  )
  const importData = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget
      const file = input.files?.[0] ?? null

      return runSettingsDataAction(
        'data-backup',
        (actions) => actions.importData(file),
      ).finally(() => {
        try {
          input.value = ''
        } catch {
          // The import result is settled; a detached input needs no cleanup.
        }
      })
    },
    [runSettingsDataAction],
  )
  const resetLocalData = useCallback(
    () =>
      runSettingsDataAction(
        'data-danger',
        (actions) => actions.resetLocalData(),
        '[data-settings-data-action="reset-local"]',
      ),
    [runSettingsDataAction],
  )

  return {
    exportData,
    importData,
    resetLocalData,
    settingsDataPending,
  }
}
