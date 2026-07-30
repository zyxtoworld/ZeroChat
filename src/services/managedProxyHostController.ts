import {
  useEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type { AppData } from '../types'
import { accessKeyFromPassword } from './accessKey'
import {
  managedProxyHostGroups,
  managedProxyHostSignature,
  replaceManagedProxyHosts,
  type ManagedProxyHostGroup,
} from './providerConfig'
import type { NoticeTone } from './uiRuntime'

export const MANAGED_PROXY_HOST_SYNC_DELAY_MS = 900

type ManagedProxyHostTimer = number | ReturnType<typeof setTimeout>

export interface ManagedProxyHostScheduler {
  clearTimeout: (timer: ManagedProxyHostTimer) => void
  setTimeout: (
    callback: () => void,
    delayMs: number,
  ) => ManagedProxyHostTimer
}

export interface ManagedProxyHostController {
  dispose: () => void
  scheduleManagedProxyHostSync: (hasCurrentGroups: boolean) => void
}

interface ManagedProxyHostControllerOptions {
  deriveGroups?: (
    snapshot: AppData | null,
    accessKey: string,
  ) => ManagedProxyHostGroup[]
  delayMs?: number
  getAccessKey: () => Promise<string>
  getSnapshot: () => AppData | null
  onError?: (error: unknown) => void
  replaceHosts?: (
    currentGroups: ManagedProxyHostGroup[],
    previousGroups: ManagedProxyHostGroup[],
  ) => Promise<void> | void
  scheduler?: ManagedProxyHostScheduler
  previousGroupsRef?: {
    current: ManagedProxyHostGroup[]
  }
}

interface RunManagedProxyHostReplacementOptions {
  deriveGroups: NonNullable<ManagedProxyHostControllerOptions['deriveGroups']>
  getAccessKey: () => Promise<string>
  getSnapshot: () => AppData | null
  onError?: (error: unknown) => void
  rememberedGroupsRef: {
    current: ManagedProxyHostGroup[]
  }
  replaceHosts: NonNullable<ManagedProxyHostControllerOptions['replaceHosts']>
}

interface ManagedProxyHostHookOptions {
  activeSyncPassphraseAvailable: boolean
  activeSyncPassphraseRevision: number
  data: AppData | null
  dataRef: RefObject<AppData | null>
  formatErrorMessage: (error: unknown) => string
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  syncPassphraseRef: RefObject<string>
  t: Translator
}

export interface ManagedProxyHostScheduleState {
  hasCurrentGroups: boolean
  signature: string
}

const availableCredentialMarker = 'active-credential-available'

export function managedProxyHostScheduleState(
  data: AppData | null,
  activeSyncPassphraseAvailable: boolean,
): ManagedProxyHostScheduleState {
  const groups = managedProxyHostGroups(
    data,
    activeSyncPassphraseAvailable ? availableCredentialMarker : '',
  )

  return {
    hasCurrentGroups: groups.length > 0,
    signature: managedProxyHostSignature(groups),
  }
}

const defaultScheduler: ManagedProxyHostScheduler = {
  clearTimeout: (timer) => window.clearTimeout(Number(timer)),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
}

export function reportManagedProxyHostSyncFailure(
  onError: ((error: unknown) => void) | undefined,
  error: unknown,
): void {
  try {
    onError?.(error)
  } catch {
    // The managed proxy host sync is detached from a timer; reporter failures
    // must not reject that abandoned Promise.
  }
}

export async function runManagedProxyHostReplacement({
  deriveGroups,
  getAccessKey,
  getSnapshot,
  onError,
  rememberedGroupsRef,
  replaceHosts,
}: RunManagedProxyHostReplacementOptions): Promise<void> {
  try {
    const accessKey = await getAccessKey()
    const nextGroups = deriveGroups(getSnapshot(), accessKey)
    const lastGroups = rememberedGroupsRef.current

    await replaceHosts(nextGroups, lastGroups)
    rememberedGroupsRef.current = nextGroups
  } catch (error: unknown) {
    reportManagedProxyHostSyncFailure(onError, error)
  }
}

export function createManagedProxyHostController({
  delayMs = MANAGED_PROXY_HOST_SYNC_DELAY_MS,
  deriveGroups = managedProxyHostGroups,
  getAccessKey,
  getSnapshot,
  onError,
  replaceHosts = replaceManagedProxyHosts,
  scheduler = defaultScheduler,
  previousGroupsRef,
}: ManagedProxyHostControllerOptions): ManagedProxyHostController {
  let syncTimer: ManagedProxyHostTimer | null = null
  const rememberedGroupsRef =
    previousGroupsRef ?? { current: [] as ManagedProxyHostGroup[] }

  function clearTimer(): void {
    if (syncTimer === null) {
      return
    }

    scheduler.clearTimeout(syncTimer)
    syncTimer = null
  }

  function scheduleManagedProxyHostSync(
    hasCurrentGroups: boolean,
  ): void {
    if (
      !hasCurrentGroups &&
      rememberedGroupsRef.current.length === 0
    ) {
      return
    }

    clearTimer()

    syncTimer = scheduler.setTimeout(() => {
      syncTimer = null

      void runManagedProxyHostReplacement({
        deriveGroups,
        getAccessKey,
        getSnapshot,
        onError,
        rememberedGroupsRef,
        replaceHosts,
      })
    }, delayMs)
  }

  return {
    dispose: clearTimer,
    scheduleManagedProxyHostSync,
  }
}

export function useManagedProxyHostController({
  activeSyncPassphraseAvailable,
  activeSyncPassphraseRevision,
  data,
  dataRef,
  formatErrorMessage,
  setNotice,
  syncPassphraseRef,
  t,
}: ManagedProxyHostHookOptions): void {
  const currentManagedProxyHostState = useMemo(
    () =>
      managedProxyHostScheduleState(data, activeSyncPassphraseAvailable),
    [activeSyncPassphraseAvailable, data],
  )
  const rememberedManagedProxyHostGroupsRef = useRef<ManagedProxyHostGroup[]>(
    [],
  )
  const controllerRef = useRef<ManagedProxyHostController | null>(null)

  useEffect(() => {
    const controller = createManagedProxyHostController({
      getAccessKey: () => accessKeyFromPassword(syncPassphraseRef.current),
      getSnapshot: () => dataRef.current,
      previousGroupsRef: rememberedManagedProxyHostGroupsRef,
      onError: (error) => {
        setNotice(
          t('notice.proxyHostSyncFailed', {
            message: formatErrorMessage(error),
          }),
          'error',
          'sync',
        )
      },
    })

    controllerRef.current = controller

    return () => {
      controller.dispose()

      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [dataRef, formatErrorMessage, setNotice, syncPassphraseRef, t])

  useEffect(() => {
    controllerRef.current?.scheduleManagedProxyHostSync(
      currentManagedProxyHostState.hasCurrentGroups,
    )
  }, [
    activeSyncPassphraseRevision,
    currentManagedProxyHostState.hasCurrentGroups,
    currentManagedProxyHostState.signature,
  ])
}
