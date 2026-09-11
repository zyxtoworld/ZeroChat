import type { AppData, ProviderSecrets, SyncResult } from '../types'
import { rt } from '../i18n'
import { accessKeyFromPassword } from './accessKey'
import { normalizeWorkerEndpoint } from './syncEndpoint'
import { fetchSync } from './syncHttpBody'
import { readSyncGeneration } from './syncIncrementalRemote'
import {
  assertRemoteWriteAllowed,
  markRemoteCleared,
  readError,
  type SyncContext,
} from './syncShared'

const SYNC_CLEAR_PATH = '/sync/clear'

function cleanupFailureText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  return rt('error.networkRequestFailed')
}

function cleanupFailureSummary(errors: readonly unknown[]): string {
  const first = cleanupFailureText(errors[0])

  return errors.length > 1
    ? `${first} (${errors.length} cleanup requests failed)`
    : first
}

export async function assertCloudflareCleanupCompleted(
  cleanupTasks: readonly Promise<void>[],
): Promise<void> {
  if (cleanupTasks.length === 0) {
    return
  }

  const settled = await Promise.allSettled(cleanupTasks)
  const failures = settled.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )

  if (failures.length > 0) {
    throw new Error(
      rt('error.syncCloudflareCleanupFailed', {
        message: cleanupFailureSummary(failures),
      }),
    )
  }
}

export async function clearCloudflareViaBulkEndpoint(
  endpoint: string,
  token: string,
  signal?: AbortSignal,
  shouldDeferRemoteWrite?: () => boolean,
): Promise<void> {
  assertRemoteWriteAllowed({ shouldDeferRemoteWrite })
  return fetchSync(
    `${endpoint}${SYNC_CLEAR_PATH}`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
      },
      signal,
    },
    async (response, signal) => {
      if (response.ok) {
        readSyncGeneration(response)
        return
      }

      if (
        response.status === 404 ||
        response.status === 405 ||
        response.status === 501
      ) {
        throw new Error(rt('error.clearCloudUpdateWorker'))
      }

      throw new Error(await readError(response, signal))
    },
  )
}

export async function clearWithCloudflare(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  const token = await accessKeyFromPassword(context.encryptionPassphrase)
  const endpoint = normalizeWorkerEndpoint(data.sync.workerEndpoint)
  const secrets: ProviderSecrets = {
    providerKeys: context.providerKeys,
  }

  if (!token) {
    throw new Error(rt('error.syncPassphraseRequired'))
  }

  assertRemoteWriteAllowed(context)
  await clearCloudflareViaBulkEndpoint(
    endpoint,
    token,
    context.signal,
    context.shouldDeferRemoteWrite,
  )

  const cleared = markRemoteCleared(data, rt('sync.status.remoteCleared'))

  return {
    data: cleared,
    secrets,
    remoteAccepted: false,
    message: cleared.sync.lastSyncStatus ?? rt('sync.status.remoteCleared'),
  }
}
