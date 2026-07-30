import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { TranslationKey, Translator } from '../i18n'
import type {
  AppData,
  ChatMessage,
  Conversation,
  DangerWarningId,
  ProviderConfig,
  SyncMode,
} from '../types'
import {
  dangerWarningDismissed,
  dismissDangerWarningInData,
  hasStreamingMessage,
} from './appData'
import {
  clearProviderConnectivityResult,
  type UpdateAppData,
} from './appDataMutationController'
import type { MessageContextMenuState } from './messageContextMenu'
import type { ProviderConnectivityResult } from './providerStatus'
import type { NoticeTone } from './uiRuntime'
import {
  localFileTooLargeMessage,
  MAX_AUDIO_FILE_BYTES,
} from './localFileLimits'

type SetNotice = (
  message: string,
  tone?: NoticeTone,
  target?: NoticeTarget,
) => void

type QueueLocalSave = (snapshot: AppData, delayMs?: number) => void
type ScheduleAutoSync = (snapshot: AppData, delayMs?: number) => void

interface CommitRootEditsOptions {
  queueLocalSave: QueueLocalSave
  scheduleAutoSync: ScheduleAutoSync
  snapshot: AppData | null
}

interface CommitEditsOnBlurOptions {
  dataRef: RefObject<AppData | null>
  queueLocalSave: QueueLocalSave
  scheduleAutoSyncRef: RefObject<ScheduleAutoSync>
}

interface UnsupportedImageSourceNoticeOptions {
  setNotice: SetNotice
  t: Translator
}

interface RootLocalizedNoticeOptions {
  setNotice: SetNotice
  t: Translator
}

interface AudioSourceNotices {
  onAudioSourceTooLarge: () => void
  onUnsupportedAudioSource: () => void
}

interface DangerWarningBridgeOptions {
  dataRef: RefObject<AppData | null>
  setNotice: SetNotice
  t: Translator
  updateData: UpdateAppData
}

export interface RootDangerWarningDismissContext {
  setNotice: SetNotice
  t: Translator
  updateData: UpdateAppData
}

interface SyncControllerRefOptions {
  clearScheduledSync: () => void
  clearScheduledSyncRef: MutableRefObject<() => void>
  scheduleAutoSync: ScheduleAutoSync
  scheduleAutoSyncRef: MutableRefObject<ScheduleAutoSync>
}

interface OfflineQueueRefOptions {
  flushOfflineQueue: () => void
  flushOfflineQueueRef: MutableRefObject<() => void>
}

type SetProviderConnectivityResults = Dispatch<
  SetStateAction<Record<string, ProviderConnectivityResult>>
>

interface RootSessionBridgeStateOptions {
  activeConversation: Conversation | null | undefined
  data: AppData | null | undefined
}

interface RootSessionBridgeState {
  activeConversationId: string
  currentSyncMode: SyncMode
  firstRunDone: boolean
}

interface RootReadinessStateOptions {
  activeConversation: Conversation | null | undefined
  activeProvider: ProviderConfig | null | undefined
  data: AppData | null | undefined
  loadError: string
}

export type RootReadinessState =
  | { kind: 'load-error'; error: string }
  | { kind: 'loading' }
  | { kind: 'provider-empty' }
  | { kind: 'conversation-empty' }
  | {
      kind: 'ready'
      activeConversation: Conversation
      activeProvider: ProviderConfig
      data: AppData
    }

export function messageForContextMenu(
  conversation: Conversation | null | undefined,
  menu: MessageContextMenuState | null | undefined,
): ChatMessage | null {
  if (!conversation || !menu) {
    return null
  }

  return conversation.messages.find((message) => message.id === menu.messageId) ?? null
}

export function commitRootEditsOnBlur({
  queueLocalSave,
  scheduleAutoSync,
  snapshot,
}: CommitRootEditsOptions): boolean {
  if (!snapshot || hasStreamingMessage(snapshot)) {
    return false
  }

  queueLocalSave(snapshot, 0)
  scheduleAutoSync(snapshot, 0)
  return true
}

export function rootGuideVisible(
  data: AppData | null | undefined,
  guideOpen: boolean,
  guideSuccessPending = false,
): boolean {
  return Boolean(
    data &&
      (!data.preferences.firstRunDone || guideOpen || guideSuccessPending),
  )
}

export function rootPromptOpen(prompt: unknown): boolean {
  return Boolean(prompt)
}

export function deriveRootSessionBridgeState({
  activeConversation,
  data,
}: RootSessionBridgeStateOptions): RootSessionBridgeState {
  return {
    activeConversationId: activeConversation?.id ?? '',
    currentSyncMode: data?.sync.mode ?? 'local',
    firstRunDone: Boolean(data?.preferences.firstRunDone),
  }
}

export function deriveRootReadinessState({
  activeConversation,
  activeProvider,
  data,
  loadError,
}: RootReadinessStateOptions): RootReadinessState {
  if (loadError) {
    return {
      kind: 'load-error',
      error: loadError,
    }
  }

  if (!data) {
    return { kind: 'loading' }
  }

  if (data.providers.length === 0 || !activeProvider) {
    return { kind: 'provider-empty' }
  }

  if (!activeConversation) {
    return { kind: 'conversation-empty' }
  }

  return {
    kind: 'ready',
    activeConversation,
    activeProvider,
    data,
  }
}

export function isRootDangerWarningDismissed(
  snapshot: AppData | null | undefined,
  id: DangerWarningId,
): boolean {
  return dangerWarningDismissed(snapshot, id)
}

export function reportRootNotice(
  context: { setNotice: SetNotice },
  getMessage: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): string | null {
  try {
    const message = getMessage()
    if (tone && target) {
      context.setNotice(message, tone, target)
    } else if (tone) {
      context.setNotice(message, tone)
    } else {
      context.setNotice(message)
    }
    return message
  } catch {
    return null
  }
}

export function reportRootDangerWarningNotice(
  context: Pick<RootDangerWarningDismissContext, 'setNotice'>,
  getMessage: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): string | null {
  return reportRootNotice(context, getMessage, tone, target)
}

export function reportRootLocalizedNotice(
  { setNotice, t }: RootLocalizedNoticeOptions,
  key: TranslationKey,
  tone?: NoticeTone,
  target?: NoticeTarget,
): string | null {
  return reportRootNotice({ setNotice }, () => t(key), tone, target)
}

export function dismissRootDangerWarning(
  context: RootDangerWarningDismissContext,
  id: DangerWarningId,
): AppData | null {
  const saved = context.updateData((current) =>
    dismissDangerWarningInData(current, id),
  )

  if (!saved) {
    reportRootDangerWarningNotice(
      context,
      () => context.t('notice.settingsSaveUnavailable'),
      'error',
    )
    return null
  }

  return saved
}

export function reportUnsupportedImageSourceNotice({
  setNotice,
  t,
}: UnsupportedImageSourceNoticeOptions): string | null {
  try {
    const message = t('notice.imageSourceUnsupported')
    setNotice(message, 'warning', 'chat')
    return message
  } catch {
    return null
  }
}

export function useCommitEditsOnBlur({
  dataRef,
  queueLocalSave,
  scheduleAutoSyncRef,
}: CommitEditsOnBlurOptions): () => void {
  return useCallback(() => {
    commitRootEditsOnBlur({
      queueLocalSave,
      scheduleAutoSync: scheduleAutoSyncRef.current,
      snapshot: dataRef.current,
    })
  }, [dataRef, queueLocalSave, scheduleAutoSyncRef])
}

export function useProviderConnectivityResultClearer(
  setProviderConnectivityResults: SetProviderConnectivityResults,
): (providerId: string) => void {
  return useCallback(
    (providerId: string): void => {
      setProviderConnectivityResults((current) =>
        clearProviderConnectivityResult(current, providerId),
      )
    },
    [setProviderConnectivityResults],
  )
}

export function useDangerWarningBridge({
  dataRef,
  setNotice,
  t,
  updateData,
}: DangerWarningBridgeOptions): {
  dismissDangerWarning: (id: DangerWarningId) => void
  isDangerWarningDismissed: (id: DangerWarningId) => boolean
} {
  const isDangerWarningDismissed = useCallback(
    (id: DangerWarningId): boolean =>
      isRootDangerWarningDismissed(dataRef.current, id),
    [dataRef],
  )
  const dismissDangerWarning = useCallback(
    (id: DangerWarningId): void => {
      dismissRootDangerWarning(
        {
          setNotice,
          t,
          updateData,
        },
        id,
      )
    },
    [setNotice, t, updateData],
  )

  return {
    dismissDangerWarning,
    isDangerWarningDismissed,
  }
}

export function useUnsupportedImageSourceNotice({
  setNotice,
  t,
}: UnsupportedImageSourceNoticeOptions): () => void {
  return useCallback(() => {
    reportUnsupportedImageSourceNotice({ setNotice, t })
  }, [setNotice, t])
}

export function useAudioSourceNotices({
  setNotice,
  t,
}: RootLocalizedNoticeOptions): AudioSourceNotices {
  const onAudioSourceTooLarge = useCallback((): void => {
    reportRootNotice(
      { setNotice },
      () => localFileTooLargeMessage(t, MAX_AUDIO_FILE_BYTES),
      'warning',
      'chat',
    )
  }, [setNotice, t])
  const onUnsupportedAudioSource = useCallback((): void => {
    reportRootLocalizedNotice(
      { setNotice, t },
      'notice.audioSourceUnsupported',
      'warning',
      'chat',
    )
  }, [setNotice, t])

  return { onAudioSourceTooLarge, onUnsupportedAudioSource }
}

export function useSyncControllerRefs({
  clearScheduledSync,
  clearScheduledSyncRef,
  scheduleAutoSync,
  scheduleAutoSyncRef,
}: SyncControllerRefOptions): void {
  useEffect(() => {
    clearScheduledSyncRef.current = clearScheduledSync
    scheduleAutoSyncRef.current = scheduleAutoSync
  }, [
    clearScheduledSync,
    clearScheduledSyncRef,
    scheduleAutoSync,
    scheduleAutoSyncRef,
  ])
}

export function useOfflineQueueFlushRef({
  flushOfflineQueue,
  flushOfflineQueueRef,
}: OfflineQueueRefOptions): void {
  useEffect(() => {
    flushOfflineQueueRef.current = flushOfflineQueue
  }, [flushOfflineQueue, flushOfflineQueueRef])
}
