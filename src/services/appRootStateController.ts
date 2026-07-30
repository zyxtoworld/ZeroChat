import {
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from 'react'
import { useStore } from 'zustand'

import { getSystemLanguages } from '../i18n'
import { appUiStore } from '../state/store'
import type { AppData } from '../types'
import type { ProviderConnectivityResult } from './providerStatus'
import type { PendingSyncRun } from './syncFlow'
import type { SyncFirstConflictPrompt } from './visualSmokeController'
import { generationOwnership } from './generationOwnership'

export function useAppRootStateController() {
  const [data, setData] = useState<AppData | null>(null)
  const [draft, setDraftState] = useState('')
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({})
  const [githubTokenValue, setGithubTokenValue] = useState('')
  const [cloudflareAccessKey, setCloudflareAccessKey] = useState('')
  const [loadingModelsProviderId, setLoadingModelsProviderId] = useState('')
  const [checkingProviderId, setCheckingProviderId] = useState('')
  const [providerConnectivityResults, setProviderConnectivityResults] =
    useState<Record<string, ProviderConnectivityResult>>({})
  const selectedProviderId = useStore(
    appUiStore,
    (state) => state.selectedProviderId,
  )
  const setSelectedProviderId = useStore(
    appUiStore,
    (state) => state.setSelectedProviderIdState,
  )
  const selectedPresetId = useStore(
    appUiStore,
    (state) => state.selectedPresetId,
  )
  const setSelectedPresetId = useStore(
    appUiStore,
    (state) => state.setSelectedPresetIdState,
  )
  const settingsOpen = useStore(
    appUiStore,
    (state) => state.settingsOpen,
  )
  const setSettingsOpen = useStore(
    appUiStore,
    (state) => state.setSettingsOpenState,
  )
  const settingsTab = useStore(
    appUiStore,
    (state) => state.settingsTab,
  )
  const setSettingsTab = useStore(
    appUiStore,
    (state) => state.setSettingsTabState,
  )
  const guideOpen = useStore(
    appUiStore,
    (state) => state.guideOpen,
  )
  const setGuideOpen = useStore(
    appUiStore,
    (state) => state.setGuideOpenState,
  )
  const guideSuccessPending = useStore(
    appUiStore,
    (state) => state.guideSuccessPending,
  )
  const setGuideSuccessPending = useStore(
    appUiStore,
    (state) => state.setGuideSuccessPendingState,
  )
  const conversationSearch = useStore(
    appUiStore,
    (state) => state.conversationSearch,
  )
  const setConversationSearch = useStore(
    appUiStore,
    (state) => state.setConversationSearchState,
  )
  const [syncFirstConflictPrompt, setSyncFirstConflictPrompt] =
    useState<SyncFirstConflictPrompt | null>(null)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine !== false)
  const [sending, setSendingState] = useState(false)
  const composerMode = useStore(
    appUiStore,
    (state) => state.composerMode,
  )
  const setComposerMode = useStore(
    appUiStore,
    (state) => state.setComposerModeState,
  )
  const imageTaskMode = useStore(
    appUiStore,
    (state) => state.imageTaskMode,
  )
  const setImageTaskMode = useStore(
    appUiStore,
    (state) => state.setImageTaskModeState,
  )
  const [syncing, setSyncing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [systemLanguagesKey, setSystemLanguagesKey] = useState(() =>
    getSystemLanguages().join('|'),
  )
  const [, setI18nRevision] = useState(0)
  const isOnlineRef = useRef(navigator.onLine !== false)
  const dataRef = useRef<AppData | null>(null)
  const draftRef = useRef('')
  const draftRevisionRef = useRef(0)
  const providerKeysRef = useRef<Record<string, string>>({})
  const githubTokenRef = useRef('')
  const syncingRef = useRef(false)
  const pendingSyncRef = useRef<PendingSyncRun | null>(null)
  const clearScheduledSyncRef = useRef<() => void>(() => undefined)
  const scheduleAutoSyncRef = useRef<
    (snapshot: AppData, delayMs?: number) => void
  >(() => undefined)
  const flushOfflineQueueRef = useRef<() => void>(() => undefined)
  const modelLoadProviderIdRef = useRef('')
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const setDraft = useCallback((value: SetStateAction<string>): void => {
    const nextValue =
      typeof value === 'function' ? value(draftRef.current) : value
    draftRef.current = nextValue
    draftRevisionRef.current += 1
    setDraftState(nextValue)
  }, [])
  const setSending = useCallback((active: boolean): void => {
    generationOwnership.active = active
    setSendingState(active)
  }, [])
  return {
    checkingProviderId,
    clearScheduledSyncRef,
    cloudflareAccessKey,
    composerMode,
    composerTextareaRef,
    conversationSearch,
    data,
    dataRef,
    draft,
    draftRef,
    draftRevisionRef,
    flushOfflineQueueRef,
    githubTokenRef,
    githubTokenValue,
    guideOpen,
    guideSuccessPending,
    imageTaskMode,
    isOnline,
    isOnlineRef,
    loadError,
    loadingModelsProviderId,
    modelLoadProviderIdRef,
    pendingSyncRef,
    providerConnectivityResults,
    providerKeys,
    providerKeysRef,
    scheduleAutoSyncRef,
    selectedPresetId,
    selectedProviderId,
    sending,
    setCheckingProviderId,
    setCloudflareAccessKey,
    setComposerMode,
    setConversationSearch,
    setData,
    setDraft,
    setGithubTokenValue,
    setGuideOpen,
    setGuideSuccessPending,
    setI18nRevision,
    setImageTaskMode,
    setIsOnline,
    setLoadError,
    setLoadingModelsProviderId,
    setProviderConnectivityResults,
    setProviderKeys,
    setSelectedPresetId,
    setSelectedProviderId,
    setSending,
    setSettingsOpen,
    setSettingsTab,
    setSyncFirstConflictPrompt,
    setSyncing,
    setSystemLanguagesKey,
    settingsOpen,
    settingsTab,
    syncFirstConflictPrompt,
    syncing,
    syncingRef,
    systemLanguagesKey,
  }
}
