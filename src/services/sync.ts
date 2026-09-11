import type {
  AppData,
  SyncResult,
} from '../types'
import { rt } from '../i18n'
import {
  clearWithCloudflare,
  pullWithCloudflare,
  syncWithCloudflare,
} from './syncCloudflare'
import {
  markSynced,
  type SyncContext,
} from './syncShared'

export { isSyncVaultShape } from './syncShared'

type RemoteSyncMode = 'gist' | 'cloudflare'

function assertSupportedRemoteSyncMode(
  mode: unknown,
): asserts mode is RemoteSyncMode {
  if (mode !== 'gist' && mode !== 'cloudflare') {
    throw new Error(rt('error.remoteDataBadFormat'))
  }
}

export async function performSync(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  if (data.sync.mode === 'local') {
    const local = markSynced(data, rt('sync.status.localMode'))

    return {
      data: local,
      secrets: {
        providerKeys: context.providerKeys,
      },
      remoteAccepted: false,
      message: local.sync.lastSyncStatus ?? rt('sync.status.localMode'),
    }
  }

  assertSupportedRemoteSyncMode(data.sync.mode)

  if (!context.encryptionPassphrase) {
    throw new Error(rt('error.syncPassphraseRequired'))
  }

  if (data.sync.mode === 'gist') {
    const { syncWithGist } = await import('./syncGist')
    return syncWithGist(data, context)
  }

  return syncWithCloudflare(data, context)
}

export async function pullRemoteChanges(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  if (data.sync.mode === 'local') {
    const local = markSynced(data, rt('sync.status.localMode'))

    return {
      data: local,
      secrets: {
        providerKeys: context.providerKeys,
      },
      remoteAccepted: false,
      message: local.sync.lastSyncStatus ?? rt('sync.status.localMode'),
    }
  }

  assertSupportedRemoteSyncMode(data.sync.mode)

  if (!context.encryptionPassphrase) {
    throw new Error(rt('error.syncPassphraseRequired'))
  }

  if (data.sync.mode === 'gist') {
    const { pullWithGist } = await import('./syncGist')
    return pullWithGist(data, context)
  }

  return pullWithCloudflare(data, context)
}

export async function clearRemoteSyncData(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  if (data.sync.mode === 'local') {
    throw new Error(rt('error.clearCloudLocalMode'))
  }

  assertSupportedRemoteSyncMode(data.sync.mode)

  if (data.sync.mode === 'gist') {
    const { clearWithGist } = await import('./syncGist')
    return clearWithGist(data, context)
  }

  return clearWithCloudflare(data, context)
}
