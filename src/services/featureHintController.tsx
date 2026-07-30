import { useCallback, type ReactNode } from 'react'

import { FeatureHint } from '../components/FeatureHint'
import type { Translator } from '../i18n'
import type { AppData, FeatureHintId } from '../types'
import { bump } from './appData'
import {
  dismissFeatureHintId,
  shouldShowFeatureHint,
  type FeatureHintPlacement,
} from './featureHints'
import type { NoticeTone } from './uiRuntime'

export interface FeatureHintDismissContext {
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  setNotice: (message: string, tone?: NoticeTone) => void
  t: Translator
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

interface FeatureHintControllerOptions {
  dangerPromptOpen: boolean
  dismissedFeatureHints?: readonly FeatureHintId[]
  guideVisible: boolean
  setNotice: FeatureHintDismissContext['setNotice']
  settingsOpen: boolean
  scheduleAutoSync: FeatureHintDismissContext['scheduleAutoSync']
  syncFirstConflictPromptOpen: boolean
  t: Translator
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

export type RenderFeatureHint = (
  id: FeatureHintId,
  placement: FeatureHintPlacement,
) => ReactNode

export function reportFeatureHintNotice(
  context: Pick<FeatureHintDismissContext, 'setNotice'>,
  getMessage: () => string,
  tone?: NoticeTone,
): string | null {
  try {
    const message = getMessage()
    if (tone) {
      context.setNotice(message, tone)
    } else {
      context.setNotice(message)
    }
    return message
  } catch {
    return null
  }
}

export function dismissFeatureHintPreference(
  context: FeatureHintDismissContext,
  id: FeatureHintId,
): AppData | null {
  const saved = context.updateData(
    (current) => {
      const dismissed = dismissFeatureHintId(
        current.preferences.dismissedFeatureHints,
        id,
      )

      if (!dismissed.changed) {
        return current
      }

      return bump({
        ...current,
        preferences: {
          ...current.preferences,
          dismissedFeatureHints: dismissed.dismissedFeatureHints,
        },
      })
    },
    { autoSync: false },
  )

  if (!saved) {
    reportFeatureHintNotice(
      context,
      () => context.t('notice.settingsSaveUnavailable'),
      'error',
    )
    return null
  }

  context.scheduleAutoSync(saved, 0)
  return saved
}

export function useFeatureHintController({
  dangerPromptOpen,
  dismissedFeatureHints,
  guideVisible,
  scheduleAutoSync,
  setNotice,
  settingsOpen,
  syncFirstConflictPromptOpen,
  t,
  updateData,
}: FeatureHintControllerOptions): RenderFeatureHint {
  const dismissFeatureHint = useCallback(
    (id: FeatureHintId): void => {
      dismissFeatureHintPreference(
        {
          scheduleAutoSync,
          setNotice,
          t,
          updateData,
        },
        id,
      )
    },
    [scheduleAutoSync, setNotice, t, updateData],
  )

  return useCallback(
    (id: FeatureHintId, placement: FeatureHintPlacement) => {
      if (
        !shouldShowFeatureHint({
          dangerPromptOpen,
          dismissedFeatureHints,
          guideVisible,
          id,
          placement,
          settingsOpen,
          syncFirstConflictPromptOpen,
        })
      ) {
        return null
      }

      return (
        <FeatureHint
          id={id}
          placement={placement}
          t={t}
          onDismiss={dismissFeatureHint}
        />
      )
    },
    [
      dangerPromptOpen,
      dismissedFeatureHints,
      dismissFeatureHint,
      guideVisible,
      settingsOpen,
      syncFirstConflictPromptOpen,
      t,
    ],
  )
}
