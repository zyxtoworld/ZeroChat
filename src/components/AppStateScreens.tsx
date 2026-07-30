import {
  KeyRound,
  MessageSquarePlus,
} from 'lucide-react'
import type { ReactElement } from 'react'
import type { Translator } from '../i18n'
import type { RootReadinessState } from '../services/appRootBridgeController'
import { AppLogo } from './AppLogo'

interface AppLoadErrorStateProps {
  error: string
  t: Translator
  onReload: () => void
}

interface AppLoadingStateProps {
  t: Translator
}

interface ProviderEmptyStateProps {
  t: Translator
  onAddFirstProvider: () => void
}

interface ConversationEmptyStateProps {
  t: Translator
  onCreateConversation: () => void
}

type PendingRootReadinessState = Exclude<RootReadinessState, { kind: 'ready' }>

interface RootReadinessScreenProps {
  readiness: PendingRootReadinessState
  t: Translator
  onAddFirstProvider: () => void
  onCreateConversation: () => void
  onReload: () => void
}

export function RootReadinessScreen({
  readiness,
  t,
  onAddFirstProvider,
  onCreateConversation,
  onReload,
}: RootReadinessScreenProps): ReactElement {
  if (readiness.kind === 'load-error') {
    return (
      <AppLoadErrorState error={readiness.error} t={t} onReload={onReload} />
    )
  }

  if (readiness.kind === 'loading') {
    return <AppLoadingState t={t} />
  }

  if (readiness.kind === 'provider-empty') {
    return (
      <ProviderEmptyState t={t} onAddFirstProvider={onAddFirstProvider} />
    )
  }

  return (
    <ConversationEmptyState
      t={t}
      onCreateConversation={onCreateConversation}
    />
  )
}

export function AppLoadErrorState({
  error,
  t,
  onReload,
}: AppLoadErrorStateProps): ReactElement {
  return (
    <main className="empty-state">
      <AppLogo size="empty" />
      <h1>{t('ui.loadFailed')}</h1>
      <p>{error}</p>
      <button className="primary-button" type="button" onClick={onReload}>
        {t('button.reload')}
      </button>
    </main>
  )
}

export function AppLoadingState({ t }: AppLoadingStateProps): ReactElement {
  return (
    <main className="empty-state">
      <AppLogo size="empty" />
      <h1>ZeroChat</h1>
      <p>{t('ui.loading')}</p>
    </main>
  )
}

export function ProviderEmptyState({
  t,
  onAddFirstProvider,
}: ProviderEmptyStateProps): ReactElement {
  return (
    <main className="empty-state provider-empty-state">
      <AppLogo size="empty" />
      <h1>{t('provider.emptyTitle')}</h1>
      <p>{t('provider.emptyBody')}</p>
      <button
        className="primary-button"
        type="button"
        data-add-first-provider="true"
        onClick={onAddFirstProvider}
      >
        <KeyRound size={16} />
        {t('button.addFirstProvider')}
      </button>
    </main>
  )
}

export function ConversationEmptyState({
  t,
  onCreateConversation,
}: ConversationEmptyStateProps): ReactElement {
  return (
    <main className="empty-state conversation-empty-state">
      <AppLogo size="empty" />
      <h1>{t('welcome.title')}</h1>
      <p>{t('conversation.emptyBody')}</p>
      <button
        className="primary-button"
        type="button"
        onClick={onCreateConversation}
      >
        <MessageSquarePlus size={16} />
        {t('button.newChat')}
      </button>
    </main>
  )
}
