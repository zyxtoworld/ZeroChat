import { beforeAll, describe, expect, it, vi } from 'vitest'

import { loadLocale, translate } from '../../i18n'
import type {
  LegacyAppDataMigrationFailure,
  LegacySkillContentMigrationFailure,
} from '../../storage/db'
import { installLocalEncryptionMigrationFeedback } from '../localEncryptionMigrationFeedback'

function subscriptionHarness<T>() {
  const listeners = new Set<(event: T) => void>()
  return {
    emit(event: T) {
      for (const listener of listeners) listener(event)
    },
    listenerCount: () => listeners.size,
    subscribe(listener: (event: T) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

beforeAll(async () => {
  await Promise.all([loadLocale('en-US'), loadLocale('fr-FR')])
})

describe('local encryption migration feedback', () => {
  it('reports stable localized failures without exposing the original error', async () => {
    const appData = subscriptionHarness<LegacyAppDataMigrationFailure>()
    const skillContent = subscriptionHarness<LegacySkillContentMigrationFailure>()
    const notify = vi.fn()
    const sentinel = 'C:\\Users\\private\\vault sk-secret-shaped-sentinel'
    const dispose = installLocalEncryptionMigrationFeedback({
      getLanguage: () => 'en-US',
      notify,
      subscribeAppDataFailures: appData.subscribe,
      subscribeSkillContentFailures: skillContent.subscribe,
    })

    appData.emit({ error: new Error(sentinel) })
    skillContent.emit({
      error: { message: sentinel, secret: sentinel },
      records: [{ key: sentinel, namespace: sentinel }],
    })

    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2))

    expect(notify).toHaveBeenNthCalledWith(
      1,
      translate('en-US', 'notice.appDataMigrationFailed'),
      'error',
    )
    expect(notify).toHaveBeenNthCalledWith(
      2,
      translate('en-US', 'notice.skillContentMigrationFailed'),
      'error',
    )
    for (const [message] of notify.mock.calls) {
      expect(message).not.toContain(sentinel)
      expect(message).not.toContain('{message}')
      expect(message).not.toContain('[object Object]')
    }

    expect(appData.listenerCount()).toBe(1)
    expect(skillContent.listenerCount()).toBe(1)
    dispose()
    expect(appData.listenerCount()).toBe(0)
    expect(skillContent.listenerCount()).toBe(0)

    appData.emit({ error: new Error(sentinel) })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('contains formatter and notification channel failures', async () => {
    const appData = subscriptionHarness<LegacyAppDataMigrationFailure>()
    const skillContent = subscriptionHarness<LegacySkillContentMigrationFailure>()
    const notify = vi.fn(() => {
      throw new Error('notification channel unavailable')
    })
    const dispose = installLocalEncryptionMigrationFeedback({
      getLanguage: () => {
        throw new Error('locale unavailable')
      },
      notify,
      subscribeAppDataFailures: appData.subscribe,
      subscribeSkillContentFailures: skillContent.subscribe,
    })

    expect(() => appData.emit({ error: new Error('private') })).not.toThrow()
    await Promise.resolve()
    expect(notify).not.toHaveBeenCalled()
    dispose()

    const secondDispose = installLocalEncryptionMigrationFeedback({
      getLanguage: () => 'en-US',
      notify,
      subscribeAppDataFailures: appData.subscribe,
      subscribeSkillContentFailures: skillContent.subscribe,
    })
    expect(() =>
      skillContent.emit({ error: new Error('private'), records: [] }),
    ).not.toThrow()
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
    expect(notify).toHaveBeenCalledWith(
      translate('en-US', 'notice.skillContentMigrationFailed'),
      'error',
    )
    secondDispose()
  })

  it('cleans up a partial subscription when the next migration subscription fails', () => {
    const appData = subscriptionHarness<LegacyAppDataMigrationFailure>()
    const subscribeSkillContentFailures = vi.fn(() => {
      throw new Error('skill migration subscription unavailable')
    })

    expect(() =>
      installLocalEncryptionMigrationFeedback({
        getLanguage: () => 'en-US',
        notify: vi.fn(),
        subscribeAppDataFailures: appData.subscribe,
        subscribeSkillContentFailures,
      }),
    ).not.toThrow()

    expect(subscribeSkillContentFailures).toHaveBeenCalledOnce()
    expect(appData.listenerCount()).toBe(0)
  })

  it('makes repeated teardown idempotent for both migration subscriptions', () => {
    const appUnsubscribe = vi.fn()
    const skillUnsubscribe = vi.fn()
    const dispose = installLocalEncryptionMigrationFeedback({
      getLanguage: () => 'en-US',
      notify: vi.fn(),
      subscribeAppDataFailures: () => appUnsubscribe,
      subscribeSkillContentFailures: () => skillUnsubscribe,
    })

    dispose()
    dispose()

    expect(appUnsubscribe).toHaveBeenCalledOnce()
    expect(skillUnsubscribe).toHaveBeenCalledOnce()
  })

  it('uses the latest locale when a migration notice resumes after language changes', async () => {
    const appData = subscriptionHarness<LegacyAppDataMigrationFailure>()
    const skillContent = subscriptionHarness<LegacySkillContentMigrationFailure>()
    const notify = vi.fn()
    let language: 'en-US' | 'fr-FR' = 'en-US'
    const dispose = installLocalEncryptionMigrationFeedback({
      getLanguage: () => language,
      notify,
      subscribeAppDataFailures: appData.subscribe,
      subscribeSkillContentFailures: skillContent.subscribe,
    })

    appData.emit({ error: new Error('contained migration failure') })
    language = 'fr-FR'

    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce())
    expect(notify).toHaveBeenCalledWith(
      translate('fr-FR', 'notice.appDataMigrationFailed'),
      'error',
    )
    dispose()
  })
})
