import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { Menu, RefreshCw } from 'lucide-react'

import { resolveLocale, translate } from '../i18n'
import { missingSyncConfigRequirementKey } from '../services/syncFlow'
import { ChatView } from './components/ChatView'
import { AppTooltip } from './components/AppTooltip'
import { Onboarding } from './components/Onboarding'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toast'
import { activeConversationOf, useAppStore, appT } from './store'
import { useAutomaticSync } from './automaticSync'
import { useProxyHostMaintenance } from './proxyHostMaintenance'
import { formatUserFacingError } from './errorPresentation'
import { scheduleInteractionFocus } from '../services/interactionFocus'
import { reloadRuntimePage } from '../services/startupFatalError'
import { runtimeFailureCopy } from '../services/startupFatalError'
import { matchesMediaQuery } from '../services/prefersReducedMotion'
import type { AppData } from '../types'
import { useAppServiceWarmup } from './runtimeWarmup'
import { installLocalEncryptionMigrationFeedback } from './localEncryptionMigrationFeedback'
import {
  installMediaQueryChangeSubscription,
  useOnline,
  useTheme,
} from './theme'
import {
  appEscapeActionForEvent,
  performAppEscapeAction,
} from './appEscape'
import {
  appKeyboardActionForEvent,
  installAppGlobalListeners,
  performAppKeyboardAction,
} from './appKeyboard'

const SettingsView = lazy(async () => {
  const module = await import('./components/SettingsView')
  return { default: module.SettingsView }
})

export function SettingsLoadingFallback({ data }: { data: AppData | null }) {
  const locale = resolveLocale(data?.preferences.language)
  return (
    <div className="zc-settings-overlay zc-settings-loading-overlay">
      <div
        className="zc-settings-loading-status"
        role="status"
        aria-atomic="true"
        aria-busy="true"
        aria-live="polite"
      >
        <RefreshCw className="zc-sync-spinner" aria-hidden="true" />
        <span>{translate(locale, 'ui.loading')}</span>
      </div>
    </div>
  )
}

interface SettingsOverlayBoundaryProps {
  children: ReactNode
  data: AppData | null
  onClose: () => void
  onReload: () => void
}

interface SettingsOverlayBoundaryState {
  failed: boolean
}

export class SettingsOverlayBoundary extends Component<
  SettingsOverlayBoundaryProps,
  SettingsOverlayBoundaryState
> {
  state: SettingsOverlayBoundaryState = { failed: false }

  static getDerivedStateFromError(): SettingsOverlayBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void error
    void info
    try {
      console.error('[app] lazy interface load failed')
    } catch {
      // Overlay recovery must not depend on a working diagnostic logger.
    }
  }

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children
    }

    const { description, reloadLabel, title } = runtimeFailureCopy()
    const locale = resolveLocale(this.props.data?.preferences.language)
    return (
      <div className="zc-settings-overlay zc-settings-load-failure-overlay">
        <div
          className="zc-settings-load-failure-status"
          role="alert"
          aria-atomic="true"
          aria-busy="false"
          aria-live="assertive"
        >
          <h2>{title}</h2>
          <p>{description}</p>
          <div className="zc-settings-load-failure-actions">
            <button
              type="button"
              className="zc-btn"
              onClick={this.props.onClose}
            >
              {translate(locale, 'button.closeSettings')}
            </button>
            <button
              type="button"
              className="zc-btn primary"
              autoFocus
              onClick={this.props.onReload}
            >
              {reloadLabel}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

const SIDEBAR_OVERLAY_MEDIA_QUERY = '(max-width: 860px)'

function useSidebarOverlayViewport(): boolean {
  const [overlayViewport, setOverlayViewport] = useState(
    () => matchesMediaQuery(SIDEBAR_OVERLAY_MEDIA_QUERY),
  )

  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return
    try {
      const mediaQuery = globalThis.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY)
      const update = () => setOverlayViewport(mediaQuery.matches)
      return installMediaQueryChangeSubscription(mediaQuery, update)
    } catch {
      return
    }
  }, [])

  return overlayViewport
}

export function App() {
  const status = useAppStore((s) => s.status)
  const data = useAppStore((s) => s.data)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const githubToken = useAppStore((s) => s.githubToken)
  const syncPassphrase = useAppStore((s) => s.syncPassphrase)
  const syncing = useAppStore((s) => s.syncing)
  const online = useOnline()
  const sidebarOverlayViewport = useSidebarOverlayViewport()
  const composerFocusRequestIdRef = useRef(0)
  const consumedComposerFocusRequestIdRef = useRef(0)
  const [composerFocusRequest, setComposerFocusRequest] = useState<{
    conversationId: string
    id: number
  } | null>(null)
  const dataRef = useRef(data)
  const isOnlineRef = useRef(online)
  const syncConfigurationWarningRef = useRef('')

  const requestActiveConversationComposerFocus = useCallback(() => {
    const current = useAppStore.getState()
    if (current.settingsOpen) return
    if (
      !current.sidebarCollapsed &&
      matchesMediaQuery(SIDEBAR_OVERLAY_MEDIA_QUERY)
    ) {
      current.setSidebarCollapsed(true)
    }
    const conversationId = activeConversationOf(current.data)?.id
    if (!conversationId) return
    const id = ++composerFocusRequestIdRef.current
    setComposerFocusRequest({ conversationId, id })
  }, [])

  const createNewConversationAndFocus = useCallback(() => {
    void useAppStore
      .getState()
      .createNewConversation()
      .then((accepted) => {
        if (!accepted) return
        requestActiveConversationComposerFocus()
      })
      .catch(() => {
        console.error('[app] conversation creation UI action failed')
      })
  }, [requestActiveConversationComposerFocus])

  const activateConversationAndFocus = useCallback(
    (conversationId: string) => {
      void useAppStore
        .getState()
        .setActiveConversation(conversationId)
        .then((accepted) => {
          if (!accepted) return
          requestActiveConversationComposerFocus()
        })
        .catch(() => {
          console.error('[app] conversation selection UI action failed')
        })
    },
    [requestActiveConversationComposerFocus],
  )

  const skipOnboardingAndFocus = useCallback(() => {
    void useAppStore
      .getState()
      .skipOnboarding()
      .then((accepted) => {
        if (!accepted) return
        requestActiveConversationComposerFocus()
      })
      .catch(() => {
        console.error('[app] onboarding skip UI action failed')
      })
  }, [requestActiveConversationComposerFocus])

  useEffect(() => {
    dataRef.current = data
    isOnlineRef.current = online
  }, [data, online])

  const theme = data?.preferences.theme ?? 'system'
  const compact = data?.preferences.compactMode ?? false
  const firstRunDone = data?.preferences.firstRunDone ?? true
  const activeConversationId = data?.preferences.activeConversationId
  const hasConversation = activeConversationOf(data) !== null
  const showChat = firstRunDone && hasConversation
  const appSurfaceBlocked =
    settingsOpen || (!sidebarCollapsed && sidebarOverlayViewport)

  useTheme(theme)
  useAutomaticSync({
    data,
    dataRef,
    getSyncCredentials: () => {
      const state = useAppStore.getState()
      return {
        githubTokenValue: state.githubToken,
        syncPassphraseValue: state.syncPassphrase,
      }
    },
    githubTokenValue: githubToken,
    isOnlineRef,
    isSyncing: () => useAppStore.getState().syncing,
    onDetachedSyncError: (error) => {
      const state = useAppStore.getState()
      const locale = resolveLocale(state.data?.preferences.language)
      state.notify(
        translate(locale, 'notice.syncConfigErrorLocalSaved', {
          message: formatUserFacingError(
            error,
            state.data?.preferences.language,
          ),
        }),
        'error',
      )
    },
    runSync: (_snapshot, options) =>
      useAppStore.getState().runAutomaticSync(Boolean(options.pullOnly)),
    syncing,
    syncPassphraseValue: syncPassphrase,
    warnSyncConfigLocalSaved: (snapshot) => {
      const state = useAppStore.getState()
      const requirementKey = missingSyncConfigRequirementKey(snapshot.sync, {
        githubTokenValue: state.githubToken,
        syncPassphraseValue: state.syncPassphrase,
      })
      if (!requirementKey) {
        syncConfigurationWarningRef.current = ''
        return false
      }
      if (syncConfigurationWarningRef.current !== requirementKey) {
        syncConfigurationWarningRef.current = requirementKey
        const locale = resolveLocale(state.data?.preferences.language)
        state.notify(
          translate(locale, 'notice.syncConfigErrorLocalSaved', {
            message: translate(locale, requirementKey),
          }),
          'error',
        )
      }
      return true
    },
  })
  useProxyHostMaintenance({
    data,
    syncPassphraseValue: syncPassphrase,
    onError: (error) => {
      const state = useAppStore.getState()
      const locale = resolveLocale(state.data?.preferences.language)
      state.notify(
        translate(locale, 'notice.proxyHostSyncFailed', {
          message: formatUserFacingError(
            error,
            state.data?.preferences.language,
          ),
        }),
        'error',
      )
    },
  })
  useAppServiceWarmup(
    status === 'ready',
    data?.skills.some((skill) => skill.enabled) ?? false,
    data?.sync.mode ?? 'local',
  )

  useEffect(
    () =>
      installLocalEncryptionMigrationFeedback({
        getLanguage: () =>
          useAppStore.getState().data?.preferences.language,
        notify: (message, tone) =>
          useAppStore.getState().notify(message, tone),
      }),
    [],
  )

  useEffect(() => {
    void useAppStore.getState().init()
  }, [])

  useEffect(() => {
    if (
      !composerFocusRequest ||
      consumedComposerFocusRequestIdRef.current === composerFocusRequest.id
    ) {
      return
    }

    if (
      composerFocusRequest.conversationId !== activeConversationId ||
      appSurfaceBlocked
    ) {
      consumedComposerFocusRequestIdRef.current = composerFocusRequest.id
      return
    }

    consumedComposerFocusRequestIdRef.current = composerFocusRequest.id
    scheduleInteractionFocus(() => {
      const state = useAppStore.getState()
      const sidebarBlocksApp =
        !state.sidebarCollapsed &&
        matchesMediaQuery(SIDEBAR_OVERLAY_MEDIA_QUERY)
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '.zc-composer textarea',
      )
      return composerFocusRequestIdRef.current === composerFocusRequest.id &&
        !state.settingsOpen &&
        !sidebarBlocksApp &&
        activeConversationOf(state.data)?.id ===
          composerFocusRequest.conversationId &&
        textarea?.isConnected &&
        !textarea.disabled
        ? textarea
        : null
    })
  }, [activeConversationId, appSurfaceBlocked, composerFocusRequest])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useAppStore.getState()
      const keyboardAction = appKeyboardActionForEvent(event, {
        settingsOpen: state.settingsOpen,
      })
      if (
        performAppKeyboardAction(keyboardAction, event, {
          createNewConversation: createNewConversationAndFocus,
        })
      ) {
        return
      }
      const action = appEscapeActionForEvent(event, {
        settingsOpen: state.settingsOpen,
        sidebarOverlayOpen:
          !state.sidebarCollapsed &&
          matchesMediaQuery(SIDEBAR_OVERLAY_MEDIA_QUERY),
      })
      performAppEscapeAction(action, event, {
        closeSettings: () => state.setSettingsOpen(false),
        closeSidebar: () => state.setSidebarCollapsed(true),
      })
    }

    const languageRefreshController = new AbortController()
    const cleanupGlobalListeners = installAppGlobalListeners(window, {
      onLanguageChange: () => {
        void useAppStore
          .getState()
          .refreshSystemLanguage(languageRefreshController.signal)
      },
      onKeyDown,
    })

    return () => {
      languageRefreshController.abort()
      cleanupGlobalListeners()
    }
  }, [createNewConversationAndFocus])

  if (status === 'loading') {
    return (
      <div className="zc-boot">
        <div className="zc-boot-card">
          <img src="./favicon.svg" alt="" />
          <div>ZeroChat</div>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="zc-boot">
        <div className="zc-boot-card">
          <img src="./favicon.svg" alt="" />
          <div>{appT(data, 'error.loadFailed')}</div>
          <button
            type="button"
            className="zc-btn primary"
            onClick={() => reloadRuntimePage(() => window.location.reload())}
          >
            {appT(data, 'common.reload')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`zc-app${compact ? ' zc-compact' : ''}`}>
      <Sidebar
        onCreateNewConversation={createNewConversationAndFocus}
        onSelectConversation={activateConversationAndFocus}
      />
      {!sidebarCollapsed && (
        <button
          type="button"
          className="zc-sidebar-backdrop"
          aria-label={appT(data, 'app.collapseSidebar')}
          onClick={() => setSidebarCollapsed(true)}
        />
      )}
      {sidebarCollapsed && !showChat && (
        <button
          type="button"
          className="zc-mobile-menu"
          aria-label={appT(data, 'app.expandSidebar')}
          data-tooltip={appT(data, 'app.expandSidebar')}
          onClick={() => setSidebarCollapsed(false)}
        >
          <Menu size={17} />
        </button>
      )}
      <div
        className="zc-app-surface"
        aria-hidden={appSurfaceBlocked}
        inert={appSurfaceBlocked}
      >
        {showChat ? (
          <ChatView key={activeConversationId ?? 'none'} />
        ) : (
          <Onboarding
            onCreateNewConversation={createNewConversationAndFocus}
            onSkipOnboarding={skipOnboardingAndFocus}
          />
        )}
      </div>
      {settingsOpen && (
        <SettingsOverlayBoundary
          data={data}
          onClose={() => useAppStore.getState().setSettingsOpen(false)}
          onReload={() => reloadRuntimePage(() => window.location.reload())}
        >
          <Suspense fallback={<SettingsLoadingFallback data={data} />}>
            <SettingsView />
          </Suspense>
        </SettingsOverlayBoundary>
      )}
      <Toasts />
      <AppTooltip />
    </div>
  )
}
