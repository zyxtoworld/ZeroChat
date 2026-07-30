import type {
  RefObject,
  SetStateAction,
} from 'react'
import { useCallback, useRef } from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type { SettingsTab } from '../components/SettingsNav'
import type {
  AppData,
  LanguageMode,
  ProviderConfig,
  ThemeMode,
} from '../types'
import {
  updateChatContextMessageLimitPreference,
  updateCompactModePreference,
  updateLanguagePreference,
  updateThemePreference,
} from './appData'
import {
  scheduleComposerTextareaFocusToEnd,
} from './composerFocus'
import { reportDetachedNotice } from './detachedFailureReporting'
import { cancelFirstRunGuideCompletion } from './firstRunGuideController'
import type { ComposerMode } from './imageComposerChrome'
import { presetIdForProvider as presetIdForProviderService } from './providerConfig'
import type { NoticeTone } from './uiRuntime'

export { focusComposerTextareaToEnd } from './composerFocus'

type SetState<T> = (value: SetStateAction<T>) => void
type SettingsOpenEvent = { currentTarget: EventTarget | null }

export interface AppNavigationControllerContext {
  activeProvider: ProviderConfig | null
  allowSettingsReturnFocus: () => void
  closeChatModelMenu: () => void
  closeSidebar: (restoreFocus?: boolean) => void
  focusComposerToEnd: () => void
  getGuideReturnSettingsTab: () => SettingsTab | null
  getSidebarOpenButton: () => HTMLButtonElement | null
  hasActiveModal: () => boolean
  rememberSettingsReturnFocusTarget: (target: HTMLElement) => void
  resetRenderedSkillList: () => void
  setComposerMode: (mode: ComposerMode) => void
  setDraft: SetState<string>
  setGuideOpen: (open: boolean) => void
  setGuideReturnSettingsTab: (tab: SettingsTab | null) => void
  setGuideSuccessPending: (pending: boolean) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  t: Translator
  setSelectedPresetId: (presetId: string) => void
  setSelectedProviderId: (providerId: string) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsTab: (tab: SettingsTab) => void
  settingsOpen: boolean
  settingsTab: SettingsTab
  sidebarDocked: boolean
  sidebarOpen: boolean
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

export interface AppNavigationControllerServices {
  activeElement: () => Element | null
  isHTMLElement: (value: unknown) => value is HTMLElement
  presetIdForProvider: (provider: ProviderConfig) => string
}

export interface AppNavigationController {
  applyWelcomePrompt: (prompt: string) => void
  changeChatContextMessageLimit: (value: number) => void
  changeCompactMode: (compactMode: boolean) => void
  changeLanguage: (language: LanguageMode) => void
  changeTheme: (theme: ThemeMode) => void
  closeGuide: () => void
  openGuide: () => void
  openSettings: (
    event?: SettingsOpenEvent,
    initialTab?: SettingsTab,
  ) => void
  selectSettingsTab: (tab: SettingsTab) => void
}

const defaultAppNavigationControllerServices: AppNavigationControllerServices = {
  activeElement: () => document.activeElement,
  isHTMLElement: (value): value is HTMLElement =>
    typeof HTMLElement !== 'undefined' && value instanceof HTMLElement,
  presetIdForProvider: presetIdForProviderService,
}

export function reportSettingsSaveUnavailable(
  context: Pick<AppNavigationControllerContext, 'setNotice' | 't'>,
): void {
  reportAppNavigationNotice(
    context,
    () => context.t('notice.settingsSaveUnavailable'),
    'error',
    'appearance',
  )
}

export function reportAppNavigationNotice(
  context: Pick<AppNavigationControllerContext, 'setNotice'>,
  getMessage: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): void {
  reportDetachedNotice(context.setNotice, getMessage, tone, target)
}

export function createAppNavigationActions(
  context: AppNavigationControllerContext,
  services: Partial<AppNavigationControllerServices> = {},
): AppNavigationController {
  const navigationServices = {
    ...defaultAppNavigationControllerServices,
    ...services,
  }

  function closeGuide(): void {
    const returnSettingsTab = context.getGuideReturnSettingsTab()
    context.setGuideReturnSettingsTab(null)

    cancelFirstRunGuideCompletion()
    context.setGuideSuccessPending(false)
    context.setGuideOpen(false)

    if (returnSettingsTab) {
      context.setSettingsTab(returnSettingsTab)
      context.setSettingsOpen(true)
    }
  }

  function openSettings(
    event?: SettingsOpenEvent,
    initialTab?: SettingsTab,
  ): void {
    if (context.activeProvider) {
      context.setSelectedProviderId(context.activeProvider.id)
    }

    const nextSettingsTab = initialTab ?? context.settingsTab

    if (nextSettingsTab === 'skills') {
      context.resetRenderedSkillList()
    }

    const opener = navigationServices.isHTMLElement(event?.currentTarget)
      ? event.currentTarget
      : null

    context.allowSettingsReturnFocus()

    if (context.sidebarOpen && !context.sidebarDocked) {
      const sidebarButton = context.getSidebarOpenButton()

      if (sidebarButton) {
        context.rememberSettingsReturnFocusTarget(sidebarButton)
      }

      context.closeSidebar(false)
    } else if (opener) {
      context.rememberSettingsReturnFocusTarget(opener)
    } else {
      const activeElement = navigationServices.activeElement()

      if (
        !context.hasActiveModal() &&
        navigationServices.isHTMLElement(activeElement)
      ) {
        context.rememberSettingsReturnFocusTarget(activeElement)
      }
    }

    reportAppNavigationNotice(context, () => '')
    if (initialTab) {
      context.setSettingsTab(initialTab)
    }
    context.setSettingsOpen(true)
  }

  function selectSettingsTab(tab: SettingsTab): void {
    if (tab === 'skills' && context.settingsTab !== 'skills') {
      context.resetRenderedSkillList()
    }

    context.setSettingsTab(tab)
    reportAppNavigationNotice(context, () => '')
  }

  function openGuide(): void {
    if (context.activeProvider) {
      context.setSelectedProviderId(context.activeProvider.id)
      context.setSelectedPresetId(
        navigationServices.presetIdForProvider(context.activeProvider),
      )
    }

    reportAppNavigationNotice(context, () => '')
    context.setGuideReturnSettingsTab(
      context.settingsOpen ? context.settingsTab : null,
    )
    context.setSettingsOpen(false)
    context.setGuideOpen(true)
  }

  function commitAppearancePreferenceUpdate(
    updater: (current: AppData) => AppData,
  ): AppData | null {
    const saved = context.updateData(updater, { autoSync: false })

    if (!saved) {
      reportSettingsSaveUnavailable(context)
      return null
    }

    context.scheduleAutoSync(saved, 0)
    reportAppNavigationNotice(context, () => '')
    return saved
  }

  function changeTheme(theme: ThemeMode): void {
    commitAppearancePreferenceUpdate((current) =>
      updateThemePreference(current, theme),
    )
  }

  function changeLanguage(language: LanguageMode): void {
    commitAppearancePreferenceUpdate((current) =>
      updateLanguagePreference(current, language),
    )
  }

  function changeCompactMode(compactMode: boolean): void {
    commitAppearancePreferenceUpdate((current) =>
      updateCompactModePreference(current, compactMode),
    )
  }

  function changeChatContextMessageLimit(value: number): void {
    commitAppearancePreferenceUpdate((current) =>
      updateChatContextMessageLimitPreference(current, value),
    )
  }

  function applyWelcomePrompt(prompt: string): void {
    context.setComposerMode('chat')
    context.closeChatModelMenu()
    reportAppNavigationNotice(context, () => '')
    context.setDraft(prompt)
    context.focusComposerToEnd()
  }

  return {
    applyWelcomePrompt,
    changeChatContextMessageLimit,
    changeCompactMode,
    changeLanguage,
    changeTheme,
    closeGuide,
    openGuide,
    openSettings,
    selectSettingsTab,
  }
}

export function useAppNavigationController(
  context: Omit<
    AppNavigationControllerContext,
    | 'focusComposerToEnd'
    | 'getGuideReturnSettingsTab'
    | 'getSidebarOpenButton'
    | 'setGuideReturnSettingsTab'
  > & {
    composerTextareaRef: RefObject<HTMLTextAreaElement | null>
    sidebarOpenButtonRef: RefObject<HTMLButtonElement | null>
  },
): AppNavigationController {
  const {
    composerTextareaRef,
    sidebarOpenButtonRef,
    ...actionContext
  } = context
  const guideReturnSettingsTabRef = useRef<SettingsTab | null>(null)
  const getGuideReturnSettingsTab = useCallback(
    () => guideReturnSettingsTabRef.current,
    [],
  )
  const setGuideReturnSettingsTab = useCallback((tab: SettingsTab | null) => {
    guideReturnSettingsTabRef.current = tab
  }, [])
  const focusComposerToEnd = useCallback(() => {
    scheduleComposerTextareaFocusToEnd(composerTextareaRef)
  }, [composerTextareaRef])
  const getSidebarOpenButton = useCallback(
    () => sidebarOpenButtonRef.current,
    [sidebarOpenButtonRef],
  )

  const createActionsForEvent = (): AppNavigationController =>
    createAppNavigationActions({
      ...actionContext,
      focusComposerToEnd,
      getGuideReturnSettingsTab,
      getSidebarOpenButton,
      setGuideReturnSettingsTab,
    })

  return {
    applyWelcomePrompt: (prompt) =>
      createActionsForEvent().applyWelcomePrompt(prompt),
    changeChatContextMessageLimit: (value) =>
      createActionsForEvent().changeChatContextMessageLimit(value),
    changeCompactMode: (compactMode) =>
      createActionsForEvent().changeCompactMode(compactMode),
    changeLanguage: (language) =>
      createActionsForEvent().changeLanguage(language),
    changeTheme: (theme) => createActionsForEvent().changeTheme(theme),
    closeGuide: () => createActionsForEvent().closeGuide(),
    openGuide: () => createActionsForEvent().openGuide(),
    openSettings: (event, initialTab) =>
      createActionsForEvent().openSettings(event, initialTab),
    selectSettingsTab: (tab) => createActionsForEvent().selectSettingsTab(tab),
  }
}
