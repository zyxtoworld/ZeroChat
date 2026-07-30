import {
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react'

import {
  getSystemLanguages as getSystemLanguagesDefault,
  loadLocale as loadLocaleDefault,
  localeDirection as localeDirectionDefault,
  setRuntimeLocale as setRuntimeLocaleDefault,
  type Locale,
} from '../i18n'
import type { SettingsTab } from '../components/SettingsNav'
import type { ComposerMode, ImageTaskMode } from './imageComposerChrome'
import type {
  AppData,
  SyncMode,
  ThemeMode,
} from '../types'
import { accessKeyFromPassword as accessKeyFromPasswordDefault } from './accessKey'
import { resizeComposerTextarea as resizeComposerTextareaDefault } from './composerLayout'
import {
  loadChatService as loadChatServiceDefault,
  loadCryptoService as loadCryptoServiceDefault,
  loadSkillService as loadSkillServiceDefault,
  loadSyncService as loadSyncServiceDefault,
} from './lazy'
import {
  scheduleIdleTask as scheduleIdleTaskDefault,
  shouldWarmLazyServices as shouldWarmLazyServicesDefault,
} from './uiRuntime'

const LIGHT_THEME_COLOR = '#fafbfc'
const DARK_THEME_COLOR = '#0f1117'

interface AppRuntimeControllerContext {
  composerMode: ComposerMode
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>
  data: AppData | null
  dataLoaded: boolean
  dataRef: MutableRefObject<AppData | null>
  draft: string
  flushOfflineQueueRef: MutableRefObject<() => void>
  githubTokenRef: MutableRefObject<string>
  githubTokenValue: string
  hasEnabledSkills: boolean
  imageTaskMode: ImageTaskMode
  isOnline: boolean
  isOnlineRef: MutableRefObject<boolean>
  locale: Locale
  onCloudflareAccessKeyDerivationFailure: (error: unknown) => void
  providerKeys: Record<string, string>
  providerKeysRef: MutableRefObject<Record<string, string>>
  onLocaleLoadFailure: (locale: Locale, error: unknown) => void
  setCloudflareAccessKey: Dispatch<SetStateAction<string>>
  setI18nRevision: Dispatch<SetStateAction<number>>
  setIsOnline: Dispatch<SetStateAction<boolean>>
  setLocale: Dispatch<SetStateAction<Locale>>
  setSystemLanguagesKey: Dispatch<SetStateAction<string>>
  settingsOpen: boolean
  settingsTab: SettingsTab
  syncMode: SyncMode
  syncPassphraseValue: string
  targetLocale: Locale
}

export interface AppRuntimeControllerServices {
  accessKeyFromPassword: (password: string) => Promise<string>
  getSystemLanguages: () => string[]
  loadChatService: () => Promise<unknown>
  loadCryptoService: () => Promise<unknown>
  loadLocale: (locale: Locale) => Promise<void>
  loadSkillService: () => Promise<unknown>
  loadSyncService: () => Promise<unknown>
  localeDirection: (locale: Locale) => 'ltr' | 'rtl'
  resizeComposerTextarea: (textarea: HTMLTextAreaElement | null) => void
  scheduleIdleTask: (callback: () => void) => () => void
  shouldWarmLazyServices: () => boolean
  setRuntimeLocale: (locale: Locale) => void
}

const defaultAppRuntimeControllerServices: AppRuntimeControllerServices = {
  accessKeyFromPassword: accessKeyFromPasswordDefault,
  getSystemLanguages: getSystemLanguagesDefault,
  loadChatService: loadChatServiceDefault,
  loadCryptoService: loadCryptoServiceDefault,
  loadLocale: loadLocaleDefault,
  loadSkillService: loadSkillServiceDefault,
  loadSyncService: loadSyncServiceDefault,
  localeDirection: localeDirectionDefault,
  resizeComposerTextarea: resizeComposerTextareaDefault,
  scheduleIdleTask: scheduleIdleTaskDefault,
  shouldWarmLazyServices: shouldWarmLazyServicesDefault,
  setRuntimeLocale: setRuntimeLocaleDefault,
}

export function onlineStateFromEvent(
  eventType: string | undefined,
  navigatorOnline: boolean,
): boolean {
  if (eventType === 'offline') {
    return false
  }

  if (eventType === 'online') {
    return true
  }

  return navigatorOnline !== false
}

export function themeColorForPreference(
  theme: ThemeMode,
  systemPrefersDark: boolean,
): string {
  const resolvedTheme =
    theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme

  return resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR
}

export function shouldWarmCryptoService(
  settingsOpen: boolean,
  settingsTab: SettingsTab,
  alreadyWarmed: boolean,
  canWarm: boolean,
): boolean {
  return settingsOpen && settingsTab === 'data' && !alreadyWarmed && canWarm
}

export function warmRetryableLazyService({
  loadService,
  warmedRef,
}: {
  loadService: () => Promise<unknown>
  warmedRef: MutableRefObject<boolean>
}): Promise<boolean> {
  warmedRef.current = true

  return Promise.resolve()
    .then(() => loadService())
    .then(() => true)
    .catch(() => {
      warmedRef.current = false
      return false
    })
}

export function commitRuntimeLocaleLoadSuccess({
  cancelled,
  setI18nRevision,
  setLocale,
  targetLocale,
}: {
  cancelled: boolean
  setI18nRevision: Dispatch<SetStateAction<number>>
  setLocale: Dispatch<SetStateAction<Locale>>
  targetLocale: Locale
}): void {
  if (cancelled) {
    return
  }

  setLocale(targetLocale)
  setI18nRevision((current) => current + 1)
}

export function reportRuntimeLocaleLoadFailure({
  cancelled,
  error,
  onLocaleLoadFailure,
  targetLocale,
}: {
  cancelled: boolean
  error: unknown
  onLocaleLoadFailure: (locale: Locale, error: unknown) => void
  targetLocale: Locale
}): void {
  if (cancelled) {
    return
  }

  try {
    onLocaleLoadFailure(targetLocale, error)
  } catch {
    // Locale-load failure reporting must not leak out of the detached effect.
  }
}

export function commitCloudflareAccessKeyDerivationSuccess({
  cancelled,
  setCloudflareAccessKey,
  value,
}: {
  cancelled: boolean
  setCloudflareAccessKey: Dispatch<SetStateAction<string>>
  value: string
}): void {
  if (!cancelled) {
    setCloudflareAccessKey(value)
  }
}

export function beginCloudflareAccessKeyDerivation(
  setCloudflareAccessKey: Dispatch<SetStateAction<string>>,
): void {
  setCloudflareAccessKey('')
}

export function reportCloudflareAccessKeyDerivationFailure({
  cancelled,
  error,
  onCloudflareAccessKeyDerivationFailure,
  setCloudflareAccessKey,
}: {
  cancelled: boolean
  error: unknown
  onCloudflareAccessKeyDerivationFailure: (error: unknown) => void
  setCloudflareAccessKey: Dispatch<SetStateAction<string>>
}): void {
  if (cancelled) {
    return
  }

  setCloudflareAccessKey('')
  try {
    onCloudflareAccessKeyDerivationFailure(error)
  } catch {
    // Access-key derivation already failed; reporter failures must not leak.
  }
}

export function useAppRuntimeController(
  context: AppRuntimeControllerContext,
  services: AppRuntimeControllerServices = defaultAppRuntimeControllerServices,
): void {
  const {
    composerMode,
    composerTextareaRef,
    data,
    dataLoaded,
    dataRef,
    draft,
    flushOfflineQueueRef,
    githubTokenRef,
    githubTokenValue,
    hasEnabledSkills,
    imageTaskMode,
    isOnline,
    isOnlineRef,
    locale,
    onCloudflareAccessKeyDerivationFailure,
    onLocaleLoadFailure,
    providerKeys,
    providerKeysRef,
    setCloudflareAccessKey,
    setI18nRevision,
    setIsOnline,
    setLocale,
    setSystemLanguagesKey,
    settingsOpen,
    settingsTab,
    syncMode,
    syncPassphraseValue,
    targetLocale,
  } = context
  const {
    accessKeyFromPassword,
    getSystemLanguages,
    loadChatService,
    loadCryptoService,
    loadLocale,
    loadSkillService,
    loadSyncService,
    localeDirection,
    resizeComposerTextarea,
    scheduleIdleTask,
    shouldWarmLazyServices,
    setRuntimeLocale,
  } = services
  const chatServiceWarmedRef = useRef(false)
  const cryptoServiceWarmedRef = useRef(false)
  const skillServiceWarmedRef = useRef(false)
  const syncServiceWarmedRef = useRef(false)

  useLayoutEffect(() => {
    resizeComposerTextarea(composerTextareaRef.current)
  }, [
    composerMode,
    composerTextareaRef,
    draft,
    imageTaskMode,
    locale,
    resizeComposerTextarea,
  ])

  useEffect(() => {
    function resizeCurrentComposerTextarea() {
      resizeComposerTextarea(composerTextareaRef.current)
    }

    window.addEventListener('resize', resizeCurrentComposerTextarea)
    return () => {
      window.removeEventListener('resize', resizeCurrentComposerTextarea)
    }
  }, [composerTextareaRef, resizeComposerTextarea])

  useEffect(() => {
    const updateSystemLanguages = () => {
      setSystemLanguagesKey(getSystemLanguages().join('|'))
    }

    window.addEventListener('languagechange', updateSystemLanguages)
    return () => {
      window.removeEventListener('languagechange', updateSystemLanguages)
    }
  }, [getSystemLanguages, setSystemLanguagesKey])

  useEffect(() => {
    let flushTimer = 0
    const updateOnlineState = (event?: Event) => {
      const nextOnline = onlineStateFromEvent(
        event?.type,
        navigator.onLine !== false,
      )
      isOnlineRef.current = nextOnline
      setIsOnline(nextOnline)

      if (nextOnline) {
        window.clearTimeout(flushTimer)
        flushTimer = window.setTimeout(
          () => flushOfflineQueueRef.current(),
          0,
        )
      }
    }

    updateOnlineState()
    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)

    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
      window.clearTimeout(flushTimer)
    }
  }, [flushOfflineQueueRef, isOnlineRef, setIsOnline])

  useEffect(() => {
    if (!dataLoaded || !isOnline) {
      return
    }

    const id = window.setTimeout(
      () => flushOfflineQueueRef.current(),
      0,
    )
    return () => window.clearTimeout(id)
  }, [dataLoaded, flushOfflineQueueRef, isOnline])

  useEffect(() => {
    let cancelled = false

    loadLocale(targetLocale)
      .then(() => {
        commitRuntimeLocaleLoadSuccess({
          cancelled,
          setI18nRevision,
          setLocale,
          targetLocale,
        })
      })
      .catch((error: unknown) => {
        reportRuntimeLocaleLoadFailure({
          cancelled,
          error,
          onLocaleLoadFailure,
          targetLocale,
        })
      })

    return () => {
      cancelled = true
    }
  }, [loadLocale, onLocaleLoadFailure, setI18nRevision, setLocale, targetLocale])

  useLayoutEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = localeDirection(locale)
    setRuntimeLocale(locale)
  }, [locale, localeDirection, setRuntimeLocale])

  useEffect(() => {
    dataRef.current = data
  }, [data, dataRef])

  useEffect(() => {
    if (!dataLoaded || !shouldWarmLazyServices()) {
      return
    }

    return scheduleIdleTask(() => {
      if (!chatServiceWarmedRef.current) {
        void warmRetryableLazyService({
          loadService: loadChatService,
          warmedRef: chatServiceWarmedRef,
        })
      }

      if (hasEnabledSkills && !skillServiceWarmedRef.current) {
        void warmRetryableLazyService({
          loadService: loadSkillService,
          warmedRef: skillServiceWarmedRef,
        })
      }

      if (syncMode !== 'local' && !syncServiceWarmedRef.current) {
        void warmRetryableLazyService({
          loadService: loadSyncService,
          warmedRef: syncServiceWarmedRef,
        })
      }
    })
  }, [
    dataLoaded,
    hasEnabledSkills,
    loadChatService,
    loadSkillService,
    loadSyncService,
    scheduleIdleTask,
    shouldWarmLazyServices,
    syncMode,
  ])

  useEffect(() => {
    if (
      !shouldWarmCryptoService(
        settingsOpen,
        settingsTab,
        cryptoServiceWarmedRef.current,
        shouldWarmLazyServices(),
      )
    ) {
      return
    }

    return scheduleIdleTask(() => {
      void warmRetryableLazyService({
        loadService: loadCryptoService,
        warmedRef: cryptoServiceWarmedRef,
      })
    })
  }, [
    loadCryptoService,
    scheduleIdleTask,
    settingsOpen,
    settingsTab,
    shouldWarmLazyServices,
  ])

  useEffect(() => {
    providerKeysRef.current = providerKeys
  }, [providerKeys, providerKeysRef])

  useEffect(() => {
    githubTokenRef.current = githubTokenValue
  }, [githubTokenRef, githubTokenValue])

  useEffect(() => {
    let disposed = false

    beginCloudflareAccessKeyDerivation(setCloudflareAccessKey)
    accessKeyFromPassword(syncPassphraseValue)
      .then((value) => {
        commitCloudflareAccessKeyDerivationSuccess({
          cancelled: disposed,
          setCloudflareAccessKey,
          value,
        })
      })
      .catch((error: unknown) => {
        reportCloudflareAccessKeyDerivationFailure({
          cancelled: disposed,
          error,
          onCloudflareAccessKeyDerivationFailure,
          setCloudflareAccessKey,
        })
      })

    return () => {
      disposed = true
    }
  }, [
    accessKeyFromPassword,
    onCloudflareAccessKeyDerivationFailure,
    setCloudflareAccessKey,
    syncPassphraseValue,
  ])

  useEffect(() => {
    if (!data) {
      return
    }

    document.documentElement.dataset.theme = data.preferences.theme
    document.documentElement.dataset.compact = String(
      data.preferences.compactMode,
    )

    const themeColorMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyThemeColor = () => {
      themeColorMeta?.setAttribute(
        'content',
        themeColorForPreference(
          data.preferences.theme,
          systemTheme.matches,
        ),
      )
    }

    applyThemeColor()

    if (data.preferences.theme !== 'system') {
      return
    }

    systemTheme.addEventListener('change', applyThemeColor)

    return () => {
      systemTheme.removeEventListener('change', applyThemeColor)
    }
  }, [data])
}
