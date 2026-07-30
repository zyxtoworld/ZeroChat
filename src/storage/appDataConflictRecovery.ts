import { mergeConcurrentAppData } from '../services/concurrentAppDataMerge'
import type { LocalSaveCommitPrecondition } from '../services/localSaveQueueController'
import type { AppData } from '../types'
import { AppDataWriteConflictError } from './appDataWriteConflict'
import { loadAppData, saveAppData } from './db'

const MAX_CONCURRENT_SAVE_ATTEMPTS = 5

export interface AppDataConflictRecoveryResult {
  commitPreconditionSatisfied?: boolean
  persistedSnapshot: AppData
  rebaseSnapshot: (snapshot: AppData) => AppData
}

interface AppDataConflictRecoveryServices {
  load: () => Promise<AppData | null>
  save: (snapshot: AppData) => Promise<void>
}

const defaultServices: AppDataConflictRecoveryServices = {
  load: loadAppData,
  save: saveAppData,
}

export async function recoverAppDataWriteConflict(
  error: unknown,
  base: AppData | null,
  local: AppData,
  servicesOrPrecondition:
    | AppDataConflictRecoveryServices
    | LocalSaveCommitPrecondition['isSatisfied'] = defaultServices,
  preconditionWithServices?: LocalSaveCommitPrecondition['isSatisfied'],
): Promise<AppDataConflictRecoveryResult> {
  if (!(error instanceof AppDataWriteConflictError)) {
    throw error
  }

  const services =
    typeof servicesOrPrecondition === 'function'
      ? defaultServices
      : servicesOrPrecondition
  const precondition =
    typeof servicesOrPrecondition === 'function'
      ? servicesOrPrecondition
      : preconditionWithServices
  let mergeBase = base
  let desired = local
  let lastConflict: unknown = error

  for (let attempt = 0; attempt < MAX_CONCURRENT_SAVE_ATTEMPTS; attempt += 1) {
    const remote = await services.load()

    if (precondition && !precondition(remote)) {
      if (!remote) {
        throw lastConflict
      }

      return {
        commitPreconditionSatisfied: false,
        persistedSnapshot: remote,
        rebaseSnapshot: (snapshot) =>
          mergeConcurrentAppData(local, remote, snapshot),
      }
    }

    if (remote) {
      desired = mergeConcurrentAppData(mergeBase, remote, desired)
    }
    mergeBase = remote

    if (precondition && !precondition(desired)) {
      if (!remote) {
        throw lastConflict
      }

      return {
        commitPreconditionSatisfied: false,
        persistedSnapshot: remote,
        rebaseSnapshot: (snapshot) =>
          mergeConcurrentAppData(local, remote, snapshot),
      }
    }

    try {
      await services.save(desired)
      const persistedSnapshot = desired

      return {
        persistedSnapshot,
        rebaseSnapshot: (snapshot) =>
          snapshot === local
            ? persistedSnapshot
            : mergeConcurrentAppData(local, persistedSnapshot, snapshot),
      }
    } catch (saveError: unknown) {
      if (!(saveError instanceof AppDataWriteConflictError)) {
        throw saveError
      }
      lastConflict = saveError
    }
  }

  throw lastConflict
}
