import { useCallback } from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type {
  AppData,
  SyncMode,
} from '../types'
import {
  updateSyncAutoSync,
  updateSyncGistFile,
  updateSyncGistId,
  updateSyncMode,
  updateSyncWorkerEndpoint,
} from './appData'
import { writeClipboardText as writeClipboardTextDefault } from './clipboard'
import type { NoticeTone } from './uiRuntime'
import { reportDetachedNotice } from './detachedFailureReporting'
import { setGithubToken as persistGithubTokenDefault } from '../storage/secrets'

interface SyncSettingsNotice {
  message: string
  target?: NoticeTarget
  tone?: NoticeTone
}

export interface SyncSettingsActionContext {
  currentSyncMode: SyncMode
  githubTokenRef: { current: string }
  requestSyncConfigScroll: (nextMode: SyncMode, previousMode: SyncMode) => void
  reportSecretWrite: (promise: Promise<void>, target?: NoticeTarget) => void
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  setGithubTokenValue: (value: string) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  t: Translator
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

export interface SyncSettingsActionServices {
  persistGithubToken: (value: string) => Promise<void>
  writeClipboardText: (value: string) => Promise<void>
}

export interface SyncSettingsActions {
  changeSyncMode: (mode: SyncMode) => void
  copyCloudflareAccessKey: (accessKey: string) => Promise<void>
  updateGithubTokenSecret: (value: string) => void
  updateSyncAutoSync: (value: boolean) => void
  updateSyncGistFile: (value: string) => void
  updateSyncGistId: (value: string) => void
  updateSyncWorkerEndpoint: (value: string) => void
}

const defaultSyncSettingsActionServices: SyncSettingsActionServices = {
  persistGithubToken: persistGithubTokenDefault,
  writeClipboardText: writeClipboardTextDefault,
}

export function reportSyncSaveUnavailable(
  context: Pick<SyncSettingsActionContext, 'setNotice' | 't'>,
): void {
  reportSyncSettingsNotice(context, {
    message: context.t('notice.syncSaveUnavailable'),
    target: 'sync',
    tone: 'error',
  })
}

export function accessKeyCopyNotice(
  accessKey: string,
  t: Translator,
): SyncSettingsNotice {
  if (!accessKey) {
    return {
      message: t('notice.accessKeyMissing'),
      target: 'sync',
      tone: 'warning',
    }
  }

  return {
    message: t('notice.accessKeyCopied'),
    target: 'sync',
    tone: 'success',
  }
}

export function reportSyncSettingsNotice(
  context: Pick<SyncSettingsActionContext, 'setNotice'>,
  notice: SyncSettingsNotice,
): void {
  reportDetachedNotice(
    context.setNotice,
    () => notice.message,
    notice.tone,
    notice.tone === undefined ? undefined : notice.target,
  )
}

export function reportCloudflareAccessKeyCopyFailure(
  context: Pick<SyncSettingsActionContext, 'setNotice' | 't'>,
): void {
  reportSyncSettingsNotice(context, {
    message: context.t('button.copyFailed'),
    target: 'sync',
    tone: 'error',
  })
}

export function createSyncSettingsActions(
  context: SyncSettingsActionContext,
  services: SyncSettingsActionServices = defaultSyncSettingsActionServices,
): SyncSettingsActions {
  function commitSyncSettingsUpdate(
    updater: (current: AppData) => AppData,
  ): AppData | null {
    const saved = context.updateData(updater, { autoSync: false })

    if (!saved) {
      reportSyncSaveUnavailable(context)
      return null
    }

    context.scheduleAutoSync(saved, 0)
    return saved
  }

  function changeSyncMode(mode: SyncMode): void {
    const saved = commitSyncSettingsUpdate((current) =>
      updateSyncMode(current, mode),
    )

    if (!saved) {
      return
    }

    reportSyncSettingsNotice(context, { message: '' })
    context.requestSyncConfigScroll(mode, context.currentSyncMode)
  }

  function updateSyncGistIdValue(value: string): void {
    commitSyncSettingsUpdate((current) => updateSyncGistId(current, value))
  }

  function updateSyncGistFileValue(value: string): void {
    commitSyncSettingsUpdate((current) => updateSyncGistFile(current, value))
  }

  function updateSyncWorkerEndpointValue(value: string): void {
    commitSyncSettingsUpdate((current) =>
      updateSyncWorkerEndpoint(current, value),
    )
  }

  function updateSyncAutoSyncValue(value: boolean): void {
    commitSyncSettingsUpdate((current) => updateSyncAutoSync(current, value))
  }

  function updateGithubTokenSecret(value: string): void {
    const previousValue = context.githubTokenRef.current
    context.setGithubTokenValue(value)
    context.githubTokenRef.current = value
    context.reportSecretWrite(
      services.persistGithubToken(value).catch(async (error: unknown) => {
        if (context.githubTokenRef.current === value) {
          context.githubTokenRef.current = previousValue
          context.setGithubTokenValue(previousValue)

          try {
            await services.persistGithubToken(previousValue)
          } catch {
            // Preserve the original failed edit; a newer edit still wins in storage order.
          }
        }

        throw error
      }),
      'sync',
    )
  }

  async function copyCloudflareAccessKey(accessKey: string): Promise<void> {
    const notice = accessKeyCopyNotice(accessKey, context.t)

    if (!accessKey) {
      reportSyncSettingsNotice(context, notice)
      return
    }

    try {
      await services.writeClipboardText(accessKey)
      reportSyncSettingsNotice(context, notice)
    } catch {
      reportCloudflareAccessKeyCopyFailure(context)
    }
  }

  return {
    changeSyncMode,
    copyCloudflareAccessKey,
    updateGithubTokenSecret,
    updateSyncAutoSync: updateSyncAutoSyncValue,
    updateSyncGistFile: updateSyncGistFileValue,
    updateSyncGistId: updateSyncGistIdValue,
    updateSyncWorkerEndpoint: updateSyncWorkerEndpointValue,
  }
}

export function useSyncSettingsController(
  context: SyncSettingsActionContext,
  services: SyncSettingsActionServices = defaultSyncSettingsActionServices,
): SyncSettingsActions {
  const changeSyncMode = useCallback(
    (mode: SyncMode) => {
      createSyncSettingsActions(context, services).changeSyncMode(mode)
    },
    [context, services],
  )
  const updateSyncGistIdValue = useCallback(
    (value: string) => {
      createSyncSettingsActions(context, services).updateSyncGistId(value)
    },
    [context, services],
  )
  const updateSyncGistFileValue = useCallback(
    (value: string) => {
      createSyncSettingsActions(context, services).updateSyncGistFile(value)
    },
    [context, services],
  )
  const updateSyncWorkerEndpointValue = useCallback(
    (value: string) => {
      createSyncSettingsActions(context, services).updateSyncWorkerEndpoint(value)
    },
    [context, services],
  )
  const updateSyncAutoSyncValue = useCallback(
    (value: boolean) => {
      createSyncSettingsActions(context, services).updateSyncAutoSync(value)
    },
    [context, services],
  )
  const updateGithubTokenSecret = useCallback(
    (value: string) => {
      createSyncSettingsActions(context, services).updateGithubTokenSecret(value)
    },
    [context, services],
  )
  const copyCloudflareAccessKey = useCallback(
    (accessKey: string) =>
      createSyncSettingsActions(context, services).copyCloudflareAccessKey(accessKey),
    [context, services],
  )

  return {
    changeSyncMode,
    copyCloudflareAccessKey,
    updateGithubTokenSecret,
    updateSyncAutoSync: updateSyncAutoSyncValue,
    updateSyncGistFile: updateSyncGistFileValue,
    updateSyncGistId: updateSyncGistIdValue,
    updateSyncWorkerEndpoint: updateSyncWorkerEndpointValue,
  }
}
