import { useEffect } from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import {
  subscribeLegacyAppDataMigrationFailures,
  subscribeLegacySkillContentMigrationFailures,
} from '../storage/db'
import type { NoticeTone } from './uiRuntime'

interface LegacyMigrationNoticeControllerOptions {
  errorMessage: (error: unknown) => string
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
    anchorId?: string,
  ) => void
  t: Translator
}

interface LegacyMigrationNoticeOptions {
  getMessage: () => string
  setNotice: LegacyMigrationNoticeControllerOptions['setNotice']
  target: NoticeTarget
}

export function reportLegacyMigrationNotice({
  getMessage,
  setNotice,
  target,
}: LegacyMigrationNoticeOptions): string | null {
  try {
    const message = getMessage()
    setNotice(message, 'error', target)
    return message
  } catch {
    return null
  }
}

export function useLegacyMigrationNoticeController({
  errorMessage,
  setNotice,
  t,
}: LegacyMigrationNoticeControllerOptions): void {
  useEffect(() => {
    const unsubscribeAppData = subscribeLegacyAppDataMigrationFailures(({ error }) => {
      reportLegacyMigrationNotice({
        getMessage: () =>
          t('notice.appDataMigrationFailed', {
            message: errorMessage(error),
          }),
        setNotice,
        target: 'data-backup',
      })
    })
    const unsubscribeSkillContent = subscribeLegacySkillContentMigrationFailures(
      ({ error }) => {
        reportLegacyMigrationNotice({
          getMessage: () =>
            t('notice.skillContentMigrationFailed', {
              message: errorMessage(error),
            }),
          setNotice,
          target: 'skills',
        })
      },
    )

    return () => {
      unsubscribeAppData()
      unsubscribeSkillContent()
    }
  }, [errorMessage, setNotice, t])
}
