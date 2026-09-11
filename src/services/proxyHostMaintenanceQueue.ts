import type { AppData } from '../types'
import { accessKeyFromPassword } from './accessKey'
import {
  managedProxyHostGroups,
  replaceManagedProxyHosts,
  type ManagedProxyHostGroup,
} from './providerProxyHosts'

export const PROXY_HOST_MAINTENANCE_DELAY_MS = 900

type MaintenanceTimer = number | ReturnType<typeof setTimeout>

interface MaintenanceTimerOwner {
  generation: number
  handle?: MaintenanceTimer
}

export interface ProxyHostMaintenanceScheduler {
  clearTimeout: (timer: MaintenanceTimer) => void
  setTimeout: (
    callback: () => void | Promise<void>,
    delayMs: number,
  ) => MaintenanceTimer
}

interface ProxyHostMaintenanceQueueOptions<Input, Group> {
  delayMs?: number
  getInput: () => Input
  maintain: (
    input: Input,
    previousGroups: Group[],
    signal: AbortSignal,
  ) => Promise<Group[]>
  onError: (error: unknown) => void
  previousGroupsRef?: { current: Group[] }
  scheduler?: ProxyHostMaintenanceScheduler
}

export interface ProxyHostMaintenanceQueue {
  dispose: () => void
  schedule: () => void
}

export interface ProxyHostMaintenanceInput {
  data: AppData | null
  passphrase: string
}

const defaultScheduler: ProxyHostMaintenanceScheduler = {
  clearTimeout: (timer) => window.clearTimeout(Number(timer)),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
}

function reportMaintenanceFailure(
  onError: (error: unknown) => void,
  error: unknown,
): void {
  try {
    onError(error)
  } catch {
    // Detached maintenance cannot recover through a second notification path.
  }
}

export function createProxyHostMaintenanceQueue<Input, Group = Input>({
  delayMs = PROXY_HOST_MAINTENANCE_DELAY_MS,
  getInput,
  maintain,
  onError,
  previousGroupsRef = { current: [] },
  scheduler = defaultScheduler,
}: ProxyHostMaintenanceQueueOptions<Input, Group>): ProxyHostMaintenanceQueue {
  let activeAbortController: AbortController | null = null
  let disposed = false
  let requested = false
  let running = false
  let timer: MaintenanceTimerOwner | null = null
  let nextTimerGeneration = 0

  const clearTimer = (): void => {
    const ownedTimer = timer
    timer = null
    if (ownedTimer?.handle === undefined) return

    try {
      scheduler.clearTimeout(ownedTimer.handle)
    } catch (error: unknown) {
      reportMaintenanceFailure(onError, error)
    }
  }

  const drain = async (timerGeneration: number): Promise<void> => {
    if (timer?.generation !== timerGeneration) return
    timer = null
    if (disposed || running) return

    running = true
    try {
      while (requested && !disposed) {
        requested = false
        const abortController = new AbortController()
        activeAbortController = abortController
        try {
          const nextGroups = await maintain(
            getInput(),
            [...previousGroupsRef.current],
            abortController.signal,
          )
          // Abort cannot undo a replacement that already resolved successfully.
          if (!disposed) {
            previousGroupsRef.current = [...nextGroups]
          }
        } catch (error: unknown) {
          if (!abortController.signal.aborted) {
            reportMaintenanceFailure(onError, error)
          }
        } finally {
          if (activeAbortController === abortController) {
            activeAbortController = null
          }
        }
      }
    } finally {
      running = false
    }
  }

  const arm = (): void => {
    clearTimer()
    const owner: MaintenanceTimerOwner = {
      generation: nextTimerGeneration + 1,
    }
    nextTimerGeneration = owner.generation
    timer = owner

    try {
      const handle = scheduler.setTimeout(
        () => drain(owner.generation),
        delayMs,
      )

      if (timer !== owner) {
        try {
          scheduler.clearTimeout(handle)
        } catch (error: unknown) {
          reportMaintenanceFailure(onError, error)
        }
        return
      }

      owner.handle = handle
    } catch (error: unknown) {
      if (timer === owner) {
        timer = null
        requested = false
      }
      reportMaintenanceFailure(onError, error)
    }
  }

  return {
    dispose: () => {
      disposed = true
      requested = false
      clearTimer()
      activeAbortController?.abort()
    },
    schedule: () => {
      if (disposed) return
      requested = true
      activeAbortController?.abort()
      if (!running) arm()
    },
  }
}

export async function maintainProxyHosts(
  { data, passphrase }: ProxyHostMaintenanceInput,
  previousGroups: ManagedProxyHostGroup[],
  signal: AbortSignal,
): Promise<ManagedProxyHostGroup[]> {
  const accessKey = passphrase.trim()
    ? await accessKeyFromPassword(passphrase)
    : ''
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  const currentGroups = managedProxyHostGroups(data, accessKey)
  if (currentGroups.length === 0 && previousGroups.length === 0) return []

  await replaceManagedProxyHosts(currentGroups, previousGroups, { signal })
  return currentGroups
}
