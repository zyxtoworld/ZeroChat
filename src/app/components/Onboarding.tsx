import { useAppStore, appT } from '../store'
import type { AppStringKey } from '../strings'

export function Onboarding({
  onCreateNewConversation,
  onSkipOnboarding,
}: {
  onCreateNewConversation: () => void
  onSkipOnboarding: () => void
}) {
  const data = useAppStore((s) => s.data)
  const conversationMutationPending = useAppStore(
    (s) => s.conversationMutationPending,
  )
  const openProviderSettings = useAppStore((s) => s.openProviderSettings)
  const hasProviders = (data?.providers.length ?? 0) > 0
  const firstRunDone = data?.preferences.firstRunDone ?? false

  const t = (key: AppStringKey) => appT(data, key)
  return (
    <main className="zc-main">
      <div className={`zc-empty${firstRunDone && !hasProviders ? ' provider-empty-state' : ''}`}>
        <div className="zc-empty-card guide-modal">
            <img src="./favicon.svg" alt="" />
            <h1>{t(firstRunDone ? 'empty.noConversationTitle' : 'onboarding.title')}</h1>
            <p>{t(firstRunDone ? 'empty.noConversationBody' : 'onboarding.body')}</p>
            <div className="zc-row" style={{ justifyContent: 'center' }}>
              {hasProviders && (
                <button
                type="button"
                className="zc-btn primary"
                disabled={conversationMutationPending}
                onClick={onCreateNewConversation}
              >
                {t(firstRunDone ? 'app.newChat' : 'onboarding.start')}
                </button>
              )}
              <button
                type="button"
                className={hasProviders ? 'zc-btn' : 'zc-btn primary'}
                data-zc-provider-settings-entry="true"
                onClick={openProviderSettings}
              >
                {t('onboarding.addProvider')}
              </button>
              {!firstRunDone && (
                <button
                  type="button"
                  className="zc-btn"
                  disabled={conversationMutationPending}
                  onClick={onSkipOnboarding}
                >
                  {t('onboarding.skip')}
                </button>
              )}
            </div>
        </div>
      </div>
    </main>
  )
}
