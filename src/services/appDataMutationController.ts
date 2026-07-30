import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'

import type { NoticeTarget } from '../components/Notice'
import type {
  AppData,
  ProviderConfig,
} from '../types'
import {
  bump,
  now,
} from './appData'
import type { ProviderConnectivityResult } from './providerStatus'
import {
  reportDetachedNotice as reportAppDataMutationNotice,
} from './detachedFailureReporting'
import type { NoticeTone } from './uiRuntime'

export interface AppDataUpdateOptions {
  autoSync?: boolean
}

export type AppDataUpdater = (current: AppData) => AppData

export type UpdateAppData = (
  updater: AppDataUpdater,
  options?: AppDataUpdateOptions,
) => AppData | null

type SetNotice = (
  message: string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
) => void

export interface AppDataMutationController {
  reportSecretWrite: (promise: Promise<void>, target?: NoticeTarget) => void
  updateData: UpdateAppData
  updateProvider: (
    providerId: string,
    patch: Partial<ProviderConfig>,
    options?: AppDataUpdateOptions,
  ) => AppData | null
}

interface AppDataMutationControllerContext {
  dataRef: MutableRefObject<AppData | null>
  formatErrorMessage: (error: unknown) => string
  scheduleAutoSyncRef: MutableRefObject<(snapshot: AppData, delayMs?: number) => void>
  setData: Dispatch<SetStateAction<AppData | null>>
  setNotice: SetNotice
}

export { reportAppDataMutationNotice }

export function reportSecretWriteFailure(
  error: unknown,
  formatErrorMessage: (error: unknown) => string,
  setNotice: AppDataMutationControllerContext['setNotice'],
  target?: NoticeTarget,
): void {
  reportAppDataMutationNotice(
    setNotice,
    () => formatErrorMessage(error),
    'error',
    target,
  )
}

export function consumeDetachedSecretWriteFailure(
  promise: Promise<void>,
  formatErrorMessage: (error: unknown) => string,
  setNotice: AppDataMutationControllerContext['setNotice'],
  target?: NoticeTarget,
): Promise<void> {
  return promise.catch((error: unknown) => {
    try {
      reportSecretWriteFailure(error, formatErrorMessage, setNotice, target)
    } catch {
      // A broken notice path must not turn a detached secret write failure into an unhandled rejection.
    }
  })
}

export function ensureLocalWriteTimestamp(
  current: AppData,
  nextRaw: AppData,
): AppData {
  if (nextRaw === current || nextRaw.updatedAt > current.updatedAt) {
    return nextRaw
  }

  return bump(nextRaw)
}

export function clearProviderConnectivityResult(
  current: Record<string, ProviderConnectivityResult>,
  providerId: string,
): Record<string, ProviderConnectivityResult> {
  if (!current[providerId]) {
    return current
  }

  const next = { ...current }
  delete next[providerId]
  return next
}

function normalizeProviderTransportUpdate(
  provider: ProviderConfig,
  patch: Partial<ProviderConfig>,
): ProviderConfig {
  const normalized = {
    ...provider,
    ...patch,
  }

  if (patch.clientRequestMode === true) {
    normalized.proxyUrl = undefined
    return normalized
  }

  if (Object.hasOwn(patch, 'proxyUrl') && patch.proxyUrl?.trim()) {
    normalized.clientRequestMode = undefined
    return normalized
  }

  if (normalized.clientRequestMode && normalized.proxyUrl?.trim()) {
    normalized.clientRequestMode = undefined
  }

  return normalized
}

export function updateProviderInAppData(
  current: AppData,
  providerId: string,
  patch: Partial<ProviderConfig>,
): AppData {
  const modelChanged = Object.hasOwn(patch, 'model')
  const updatedAt = now()

  return bump({
    ...current,
    providers: current.providers.map((provider) =>
      provider.id === providerId
        ? {
            ...normalizeProviderTransportUpdate(provider, patch),
            updatedAt,
          }
        : provider,
    ),
    conversations: modelChanged
      ? current.conversations.map((conversation) =>
          conversation.id === current.preferences.activeConversationId &&
          conversation.providerId === providerId &&
          conversation.messages.length === 0
            ? {
                ...conversation,
                model: patch.model ?? conversation.model,
                updatedAt,
              }
            : conversation,
        )
      : current.conversations,
  })
}

export function useAppDataMutationController({
  dataRef,
  formatErrorMessage,
  scheduleAutoSyncRef,
  setData,
  setNotice,
}: AppDataMutationControllerContext): AppDataMutationController {
  const updateData = useCallback<UpdateAppData>(
    (updater, options = {}) => {
      const current = dataRef.current

      if (!current) {
        return null
      }

      const next = ensureLocalWriteTimestamp(current, updater(current))
      // Local writes must advance updatedAt so auto-sync sees every edit.
      dataRef.current = next
      setData(next)

      if (options.autoSync !== false) {
        scheduleAutoSyncRef.current(next)
      }

      return next
    },
    [dataRef, scheduleAutoSyncRef, setData],
  )

  const reportSecretWrite = useCallback(
    (promise: Promise<void>, target?: NoticeTarget): void => {
      void consumeDetachedSecretWriteFailure(
        promise,
        formatErrorMessage,
        setNotice,
        target,
      )
    },
    [formatErrorMessage, setNotice],
  )

  const updateProvider = useCallback(
    (
      providerId: string,
      patch: Partial<ProviderConfig>,
      options?: AppDataUpdateOptions,
    ): AppData | null => {
      const saved = updateData(
        (current) => updateProviderInAppData(current, providerId, patch),
        options,
      )

      if (!saved) {
        return null
      }

      reportAppDataMutationNotice(setNotice, () => '')
      return saved
    },
    [setNotice, updateData],
  )

  return useMemo(
    () => ({
      reportSecretWrite,
      updateData,
      updateProvider,
    }),
    [reportSecretWrite, updateData, updateProvider],
  )
}
