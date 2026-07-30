import {
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

import {
  createTranslator,
  resolveLocale,
  type Locale,
  type Translator,
} from '../i18n'
import type {
  AppData,
  LanguageMode,
  ProviderConfig,
  SyncMode,
} from '../types'
import {
  hasStreamingMessage,
  normalizeChatContextMessageLimit,
} from './appData'
import {
  deriveChatSessionState,
  type ChatSessionState,
} from './chatSessionState'
import {
  deriveComposerChrome,
  type ComposerChromeState,
} from './composerChrome'
import {
  deriveComposerReadiness,
  type ComposerReadinessState,
} from './composerReadiness'
import type {
  ComposerMode,
  ImageTaskMode,
} from './imageComposerChrome'
import { deriveSyncChrome, type SyncChromeState } from './syncChrome'
import {
  keyboardNewConversationShortcut,
  keyboardSendShortcut,
} from './uiRuntime'

export interface AppLocaleControllerState {
  locale: Locale
  setLocale: Dispatch<SetStateAction<Locale>>
  systemDateLocales: string[]
  t: Translator
  targetLocale: Locale
}

interface AppLocaleControllerOptions {
  languageMode: LanguageMode
  systemLanguagesKey: string
}

interface AppDataChromeOptions {
  data: AppData | null
  sending: boolean
}

export interface AppDataChromeState {
  chatContextMessageLimit: number
  dataLoaded: boolean
  generationActive: boolean
  hasEnabledSkills: boolean
  syncMode: SyncMode
}

interface AppChatSessionControllerOptions {
  conversationSearch: string
  data: AppData | null
  selectedProviderId: string
  t: Translator
}

export interface AppComposerChromeOptions {
  activeSyncPassphraseAvailable: boolean
  activeImageModel: string
  activeModel: string
  activeProvider: ProviderConfig | null
  audioSourceFile: File | null
  composerMode: ComposerMode
  data: AppData
  draft: string
  enabledChatProviders: ProviderConfig[]
  generationActive: boolean
  githubTokenValue: string
  imageSourceFile: File | null
  imageTaskMode: ImageTaskMode
  maskTouched: boolean
  providerKeys: Record<string, string>
  syncMessage: (message: string) => string
  syncPassphraseValue: string
  t: Translator
}

export interface AppComposerChromeState {
  composerChrome: ComposerChromeState
  composerReadiness: ComposerReadinessState
  newConversationShortcut: string
  newConversationTitle: string
  syncChrome: SyncChromeState
}

export function systemDateLocalesFromKey(systemLanguagesKey: string): string[] {
  return systemLanguagesKey.split('|').filter(Boolean)
}

export function displayLocalesForLanguageMode(
  languageMode: LanguageMode,
  systemLanguagesKey: string,
): string[] {
  if (languageMode !== 'system') {
    return [targetLocaleForLanguageMode(languageMode, systemLanguagesKey)]
  }

  return systemDateLocalesFromKey(systemLanguagesKey)
}

export function targetLocaleForLanguageMode(
  languageMode: LanguageMode,
  systemLanguagesKey: string,
): Locale {
  return resolveLocale(languageMode, systemDateLocalesFromKey(systemLanguagesKey))
}

export function deriveAppDataChrome({
  data,
  sending,
}: AppDataChromeOptions): AppDataChromeState {
  return {
    chatContextMessageLimit: normalizeChatContextMessageLimit(
      data?.preferences.chatContextMessageLimit,
    ),
    dataLoaded: Boolean(data),
    generationActive: sending || Boolean(data && hasStreamingMessage(data)),
    hasEnabledSkills: Boolean(data?.skills.some((skill) => skill.enabled)),
    syncMode: data?.sync.mode ?? 'local',
  }
}

export function useAppLocaleController({
  languageMode,
  systemLanguagesKey,
}: AppLocaleControllerOptions): AppLocaleControllerState {
  const [locale, setLocale] = useState<Locale>(() => resolveLocale('system'))
  const systemDateLocales = useMemo(
    () => displayLocalesForLanguageMode(languageMode, systemLanguagesKey),
    [languageMode, systemLanguagesKey],
  )
  const targetLocale = useMemo(
    () => targetLocaleForLanguageMode(languageMode, systemLanguagesKey),
    [languageMode, systemLanguagesKey],
  )
  const t = useMemo(() => createTranslator(locale), [locale])

  return {
    locale,
    setLocale,
    systemDateLocales,
    t,
    targetLocale,
  }
}

export function useAppChatSessionController({
  conversationSearch,
  data,
  selectedProviderId,
  t,
}: AppChatSessionControllerOptions): ChatSessionState {
  return useMemo(
    () =>
      deriveChatSessionState({
        conversationSearch,
        data,
        selectedProviderId,
        t,
      }),
    [conversationSearch, data, selectedProviderId, t],
  )
}

export function deriveAppComposerChromeState({
  activeSyncPassphraseAvailable,
  activeImageModel,
  activeModel,
  activeProvider,
  audioSourceFile,
  composerMode,
  data,
  draft,
  enabledChatProviders,
  generationActive,
  githubTokenValue,
  imageSourceFile,
  imageTaskMode,
  maskTouched,
  providerKeys,
  syncMessage,
  syncPassphraseValue,
  t,
}: AppComposerChromeOptions): AppComposerChromeState {
  const sendShortcut = keyboardSendShortcut()
  const composerReadiness = deriveComposerReadiness({
    activeImageModel,
    activeModel,
    activeProvider,
    composerMode,
    data,
    enabledChatProviders,
    imageTaskMode,
    providerKeys,
    proxyTokenAvailable: activeSyncPassphraseAvailable,
    t,
  })
  const composerChrome = deriveComposerChrome({
    activeAudioRequirement: composerReadiness.activeAudioRequirement,
    activeChatRequirement: composerReadiness.activeChatRequirement,
    activeImageRequirement: composerReadiness.activeImageRequirement,
    activeProviderAvailable: composerReadiness.activeProviderAvailable,
    composerMode,
    draft,
    generationActive,
    audioSourceAvailable: Boolean(audioSourceFile),
    imageSourceAvailable: Boolean(imageSourceFile),
    imageTaskMode,
    maskTouched,
    sendShortcut,
    t,
    welcomeGenerationRequirement:
      composerReadiness.welcomeGenerationRequirement,
    welcomeModel: composerReadiness.welcomeModel,
    welcomeNeedsProviderKey: composerReadiness.welcomeNeedsProviderKey,
    welcomeProviderAvailable: composerReadiness.welcomeProviderAvailable,
    welcomeProviderEnabled: composerReadiness.welcomeProviderEnabled,
    welcomeProviderKey: composerReadiness.welcomeProviderKey,
  })
  const syncChrome = deriveSyncChrome({
    githubTokenValue,
    sync: data.sync,
    syncMessage,
    syncPassphraseValue,
    t,
  })

  return {
    composerChrome,
    composerReadiness,
    newConversationShortcut: keyboardNewConversationShortcut(true),
    newConversationTitle: t('button.actionWithShortcut', {
      action: t('button.newChat'),
      shortcut: keyboardNewConversationShortcut(),
    }),
    syncChrome,
  }
}
