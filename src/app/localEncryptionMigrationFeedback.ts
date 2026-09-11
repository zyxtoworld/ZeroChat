import {
  loadLocale,
  resolveLocale,
  translate,
  type TranslationKey,
} from '../i18n'
import {
  subscribeLegacyAppDataMigrationFailures,
  subscribeLegacySkillContentMigrationFailures,
  type LegacyAppDataMigrationFailure,
  type LegacySkillContentMigrationFailure,
} from '../storage/db'
import type { LanguageMode } from '../types'

type FailureSubscription<T> = (listener: (failure: T) => void) => () => void

interface LocalEncryptionMigrationFeedbackOptions {
  getLanguage: () => LanguageMode | undefined
  notify: (message: string, tone: 'error') => void
  subscribeAppDataFailures?: FailureSubscription<LegacyAppDataMigrationFailure>
  subscribeSkillContentFailures?: FailureSubscription<LegacySkillContentMigrationFailure>
}

export function installLocalEncryptionMigrationFeedback({
  getLanguage,
  notify,
  subscribeAppDataFailures = subscribeLegacyAppDataMigrationFailures,
  subscribeSkillContentFailures = subscribeLegacySkillContentMigrationFailures,
}: LocalEncryptionMigrationFeedbackOptions): () => void {
  let active = true
  const unsubscribers: Array<() => void> = []

  const dispose = () => {
    active = false
    for (const unsubscribe of unsubscribers.splice(0)) {
      try {
        unsubscribe()
      } catch {
        // Cleanup failures must not escape React effect teardown.
      }
    }
  }

  const report = (key: TranslationKey) => {
    void (async () => {
      try {
        for (;;) {
          const locale = resolveLocale(getLanguage())
          await loadLocale(locale)
          if (!active) return
          if (resolveLocale(getLanguage()) !== locale) continue
          notify(translate(locale, key), 'error')
          return
        }
      } catch {
        // Migration is best effort; its feedback path must not break startup.
      }
    })()
  }

  try {
    unsubscribers.push(
      subscribeAppDataFailures(() => {
        report('notice.appDataMigrationFailed')
      }),
    )
    unsubscribers.push(
      subscribeSkillContentFailures(() => {
        report('notice.skillContentMigrationFailed')
      }),
    )
  } catch {
    dispose()
  }

  return dispose
}
