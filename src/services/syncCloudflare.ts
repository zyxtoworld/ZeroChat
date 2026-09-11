import type {
  AppData,
  ProviderSecrets,
  SyncResult,
  SyncVault,
} from '../types'
import { rt } from '../i18n'
import { accessKeyFromPassword } from './accessKey'
import {
  acceptRemoteVault,
  prepareMergedFirstSyncVault,
  shouldAcceptRemoteUpdatedAt,
  shouldAcceptRemoteVault,
  shouldMergeFirstSync,
} from './syncMerge'
import {
  type IncrementalManifest,
  type IncrementalRemoteState,
} from './syncIncrementalHelpers'
import {
  IncrementalHeadConflictError,
  deleteIncrementalObject,
  deleteLegacySnapshot,
  isIncrementalGenerationConflictError,
  isIncrementalHeadConflictError,
  readIncrementalHead,
  readIncrementalRemoteState,
  readSyncGeneration,
  writeIncrementalHead,
  writeIncrementalObject,
} from './syncIncrementalRemote'
import { manifestToVault } from './syncIncrementalRead'
import { buildIncrementalUpload } from './syncIncrementalUpload'
import { normalizeWorkerEndpoint } from './syncEndpoint'
import {
  MAX_SYNC_ERROR_BODY_BYTES,
  MAX_SYNC_SNAPSHOT_BYTES,
  fetchSync,
  readSyncResponseText,
} from './syncHttpBody'
import {
  assertCloudflareCleanupCompleted,
  clearCloudflareViaBulkEndpoint,
} from './syncCloudflareClear'
import {
  assertRemoteWriteAllowed,
  isSyncRemoteWriteDeferredError,
  isPassphraseDecryptionError,
  markSynced,
  parseRemoteVault,
  readError,
  serializeVault,
  type SyncContext,
} from './syncShared'

export { clearWithCloudflare } from './syncCloudflareClear'

interface CloudflareSnapshotState {
  etag: string
  vault: SyncVault
}

interface CloudflareSnapshotRead {
  generation: string
  state: CloudflareSnapshotState | null
}

interface CloudflareSnapshotEnvelopeState {
  etag: string
  serialized: string
}

interface CloudflareSnapshotEnvelopeRead {
  generation: string
  state: CloudflareSnapshotEnvelopeState | null
}

function incrementalCleanupTasks(
  endpoint: string,
  token: string,
  previous: IncrementalRemoteState | null,
  next: IncrementalManifest,
  generation: string,
  signal?: AbortSignal,
  shouldDeferRemoteWrite?: () => boolean,
): Promise<void>[] {
  if (!previous) {
    return []
  }

  const keep = new Set([
    ...next.chunks.map((chunk) => chunk.key),
    ...(next.skillChunks ?? []).map((chunk) => chunk.key),
    ...(next.attachmentChunks ?? []).map((chunk) => chunk.key),
  ])
  const stale = new Set<string>([previous.head.manifestKey])

  for (const chunk of previous.manifest.chunks) {
    if (!keep.has(chunk.key)) {
      stale.add(chunk.key)
    }
  }

  for (const chunk of previous.manifest.skillChunks ?? []) {
    if (!keep.has(chunk.key)) {
      stale.add(chunk.key)
    }
  }

  for (const chunk of previous.manifest.attachmentChunks ?? []) {
    if (!keep.has(chunk.key)) {
      stale.add(chunk.key)
    }
  }

  return Array.from(stale).map((key) =>
    deleteIncrementalObject(
      endpoint,
      token,
      key,
      generation,
      signal,
      shouldDeferRemoteWrite,
    ),
  )
}

async function readCloudflareSnapshot(
  endpoint: string,
  token: string,
  signal?: AbortSignal,
): Promise<CloudflareSnapshotEnvelopeRead> {
  const snapshot = await fetchSync(
    `${endpoint}/snapshot`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      signal,
    },
    async (response, signal) => {
      if (!response.ok && response.status !== 404) {
        throw new Error(await readError(response, signal))
      }

      if (response.status === 404) {
        await readSyncResponseText(
          response,
          MAX_SYNC_ERROR_BODY_BYTES,
          'Cloud sync snapshot not-found response',
          signal,
        )
        return {
          generation: readSyncGeneration(response),
          serialized: null,
        }
      }

      const etag = response.headers.get('etag')
      if (!/^"snapshot-sha256-[0-9a-f]{64}"$/iu.test(etag ?? '')) {
        throw new Error(rt('error.remoteUpdated'))
      }
      return {
        etag: etag as string,
        generation: readSyncGeneration(response),
        serialized: await readSyncResponseText(
          response,
          MAX_SYNC_SNAPSHOT_BYTES,
          'Cloud sync snapshot response',
          signal,
        ),
      }
    },
  )

  if (snapshot.serialized === null) {
    return { generation: snapshot.generation, state: null }
  }
  return {
    generation: snapshot.generation,
    state: { etag: snapshot.etag, serialized: snapshot.serialized },
  }
}

async function decryptCloudflareSnapshot(
  snapshot: CloudflareSnapshotEnvelopeRead,
  passphrase: string,
): Promise<CloudflareSnapshotRead> {
  if (!snapshot.state) {
    return { generation: snapshot.generation, state: null }
  }
  const vault = await parseRemoteVault(snapshot.state.serialized, passphrase)
  if (!vault) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }
  return {
    generation: snapshot.generation,
    state: { etag: snapshot.state.etag, vault },
  }
}

async function assertCloudflareSnapshotCurrent(
  endpoint: string,
  token: string,
  expected: CloudflareSnapshotEnvelopeRead,
  signal?: AbortSignal,
): Promise<void> {
  const current = await readCloudflareSnapshot(endpoint, token, signal)
  if (
    current.generation !== expected.generation ||
    current.state?.etag !== expected.state?.etag
  ) {
    throw new Error(rt('error.remoteUpdated'))
  }
}

async function assertIncrementalRemoteCurrent(
  endpoint: string,
  token: string,
  generation: string,
  expectedHead: IncrementalRemoteState['head'],
  signal?: AbortSignal,
): Promise<void> {
  const current = await readIncrementalHead(endpoint, token, signal)
  if (
    current === 'unsupported' ||
    current.generation !== generation ||
    current.head?.manifestKey !== expectedHead.manifestKey ||
    current.head?.updatedAt !== expectedHead.updatedAt
  ) {
    throw new IncrementalHeadConflictError()
  }
}

async function writeCloudflareSnapshot(
  endpoint: string,
  token: string,
  body: string,
  expectedEtag: string | null,
  generation: string,
  signal?: AbortSignal,
  shouldDeferRemoteWrite?: () => boolean,
): Promise<void> {
  assertRemoteWriteAllowed({ shouldDeferRemoteWrite })
  await fetchSync(
    `${endpoint}/snapshot`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-zerochat-sync-generation': generation,
        ...(expectedEtag
          ? { 'if-match': expectedEtag }
          : { 'if-none-match': '*' }),
      },
      body,
      signal,
    },
    async (response, signal) => {
      if (
        response.status === 409 ||
        response.status === 412 ||
        response.status === 428
      ) {
        throw new Error(rt('error.remoteUpdated'))
      }
      if (!response.ok) {
        throw new Error(await readError(response, signal))
      }
    },
  )
}

async function syncWithCloudflareSnapshot(
  data: AppData,
  context: SyncContext,
  endpoint: string,
  token: string,
  secrets: ProviderSecrets,
): Promise<SyncResult> {
  const snapshot = await readCloudflareSnapshot(
    endpoint,
    token,
    context.signal,
  )
  let remoteState: CloudflareSnapshotState | null = null

  try {
    remoteState = (
      await decryptCloudflareSnapshot(
        snapshot,
        context.encryptionPassphrase,
      )
    ).state
  } catch (error: unknown) {
    if (!context.allowPassphraseRotation || !isPassphraseDecryptionError(error)) {
      throw error
    }
  }
  const remote = remoteState?.vault ?? null

  if (remote && shouldMergeFirstSync(data, context.firstSyncStrategy)) {
    const merged = prepareMergedFirstSyncVault(remote, data, secrets)
    assertRemoteWriteAllowed(context)
    await writeCloudflareSnapshot(
      endpoint,
      token,
      await serializeVault(
        merged.data,
        merged.secrets,
        context.encryptionPassphrase,
      ),
      snapshot.state?.etag ?? null,
      snapshot.generation,
      context.signal,
      context.shouldDeferRemoteWrite,
    )

    return {
      data: merged.data,
      secrets: merged.secrets,
      remoteAccepted: true,
      message: merged.data.sync.lastSyncStatus ?? rt('sync.status.merged'),
    }
  }

  if (remote && shouldAcceptRemoteVault(remote, data, context.firstSyncStrategy)) {
    const accepted = acceptRemoteVault(remote, data)
    await assertCloudflareSnapshotCurrent(
      endpoint,
      token,
      snapshot,
      context.signal,
    )
    return {
      data: accepted.data,
      secrets: accepted.secrets,
      remoteAccepted: true,
      message: accepted.data.sync.lastSyncStatus ?? rt('sync.status.complete'),
    }
  }

  const synced = markSynced(data, rt('sync.status.complete'))
  assertRemoteWriteAllowed(context)
  await writeCloudflareSnapshot(
    endpoint,
    token,
    await serializeVault(synced, secrets, context.encryptionPassphrase),
    snapshot.state?.etag ?? null,
    snapshot.generation,
    context.signal,
    context.shouldDeferRemoteWrite,
  )

  return {
    data: synced,
    secrets,
    remoteAccepted: false,
    message: synced.sync.lastSyncStatus ?? rt('sync.status.complete'),
  }
}

async function pullWithCloudflareSnapshot(
  data: AppData,
  context: SyncContext,
  endpoint: string,
  token: string,
  secrets: ProviderSecrets,
): Promise<SyncResult> {
  const snapshot = await readCloudflareSnapshot(
    endpoint,
    token,
    context.signal,
  )
  const remoteState = (
    await decryptCloudflareSnapshot(snapshot, context.encryptionPassphrase)
  ).state
  const remote = remoteState?.vault ?? null

  if (remote && shouldMergeFirstSync(data, context.firstSyncStrategy)) {
    const merged = prepareMergedFirstSyncVault(remote, data, secrets)
    assertRemoteWriteAllowed(context)
    await writeCloudflareSnapshot(
      endpoint,
      token,
      await serializeVault(
        merged.data,
        merged.secrets,
        context.encryptionPassphrase,
      ),
      remoteState?.etag ?? null,
      snapshot.generation,
      context.signal,
      context.shouldDeferRemoteWrite,
    )

    return {
      data: merged.data,
      secrets: merged.secrets,
      remoteAccepted: true,
      message: merged.data.sync.lastSyncStatus ?? rt('sync.status.merged'),
    }
  }

  if (remote && shouldAcceptRemoteVault(remote, data, context.firstSyncStrategy)) {
    const accepted = acceptRemoteVault(remote, data)
    await assertCloudflareSnapshotCurrent(
      endpoint,
      token,
      snapshot,
      context.signal,
    )

    return {
      data: accepted.data,
      secrets: accepted.secrets,
      remoteAccepted: true,
      message: accepted.data.sync.lastSyncStatus ?? rt('sync.status.remoteAccepted'),
    }
  }

  await assertCloudflareSnapshotCurrent(
    endpoint,
    token,
    snapshot,
    context.signal,
  )
  const checked = markSynced(data, rt('sync.status.upToDate'))

  return {
    data: checked,
    secrets,
    remoteAccepted: false,
    message: checked.sync.lastSyncStatus ?? rt('sync.status.upToDate'),
  }
}

async function uploadCloudflareIncrementalVault(
  data: AppData,
  context: SyncContext,
  endpoint: string,
  token: string,
  secrets: ProviderSecrets,
  remote: IncrementalRemoteState | null,
  generation: string,
  status: string,
  remoteAccepted: boolean,
): Promise<SyncResult> {
  const synced = markSynced(data, status)
  const upload = await buildIncrementalUpload(
    synced,
    secrets,
    context.encryptionPassphrase,
    remote?.manifest ?? null,
  )
  assertRemoteWriteAllowed(context)
  let headPublishAttempted = false
  let chunkUploadSucceeded = false
  const chunkUploadController = new AbortController()
  const abortChunkUploads = (): void => {
    chunkUploadController.abort()
  }

  if (context.signal?.aborted) {
    abortChunkUploads()
  } else {
    context.signal?.addEventListener('abort', abortChunkUploads, { once: true })
  }

  try {
    let chunkUploadFailed = false
    let firstChunkUploadError: unknown
    const chunkPromises = upload.chunks.map((chunk) =>
      writeIncrementalObject(
        endpoint,
        token,
        chunk.key,
        chunk.envelope,
        generation,
        chunkUploadController.signal,
        context.shouldDeferRemoteWrite,
      ).then(() => {
        chunkUploadSucceeded = true
      }).catch((error: unknown) => {
        if (!chunkUploadFailed) {
          chunkUploadFailed = true
          firstChunkUploadError = error
        }
        abortChunkUploads()
        throw error
      }),
    )
    await Promise.allSettled(chunkPromises)
    if (chunkUploadFailed) {
      throw firstChunkUploadError
    }
    await writeIncrementalObject(
      endpoint,
      token,
      upload.head.manifestKey,
      upload.manifestEnvelope,
      generation,
      context.signal,
      context.shouldDeferRemoteWrite,
    )
    headPublishAttempted = true
    await writeIncrementalHead(
      endpoint,
      token,
      upload.head,
      remote?.head ?? null,
      generation,
      context.signal,
      context.shouldDeferRemoteWrite,
    )
  } catch (error) {
    if (
      context.signal?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error
    }

    if (isIncrementalGenerationConflictError(error)) {
      throw error
    }

    if (
      isSyncRemoteWriteDeferredError(error) &&
      !chunkUploadSucceeded &&
      !headPublishAttempted
    ) {
      throw error
    }

    if (!headPublishAttempted || isIncrementalHeadConflictError(error)) {
      await assertCloudflareCleanupCompleted([
        ...upload.chunks.map((chunk) =>
          deleteIncrementalObject(
            endpoint,
            token,
            chunk.key,
            generation,
            context.signal,
            context.shouldDeferRemoteWrite,
          ),
        ),
        deleteIncrementalObject(
          endpoint,
          token,
          upload.head.manifestKey,
          generation,
          context.signal,
          context.shouldDeferRemoteWrite,
        ),
      ])
    }
    throw error
  } finally {
    context.signal?.removeEventListener('abort', abortChunkUploads)
  }

  await assertCloudflareCleanupCompleted([
    ...incrementalCleanupTasks(
      endpoint,
      token,
      remote,
      upload.manifest,
      generation,
      context.signal,
      context.shouldDeferRemoteWrite,
    ),
    deleteLegacySnapshot(
      endpoint,
      token,
      generation,
      context.signal,
      context.shouldDeferRemoteWrite,
    ),
  ])

  return {
    data: synced,
    secrets,
    remoteAccepted,
    message: synced.sync.lastSyncStatus ?? status,
  }
}

async function syncWithCloudflareIncremental(
  data: AppData,
  context: SyncContext,
  endpoint: string,
  token: string,
  secrets: ProviderSecrets,
): Promise<SyncResult | null> {
  const observation = await readIncrementalHead(endpoint, token, context.signal)

  if (observation === 'unsupported') {
    return null
  }
  const { generation, head } = observation

  let remote: IncrementalRemoteState | null = null

  try {
    remote = head
      ? await readIncrementalRemoteState(
          endpoint,
          token,
          context.encryptionPassphrase,
          head,
          context.signal,
        )
      : null
  } catch (error: unknown) {
    if (!context.allowPassphraseRotation || !isPassphraseDecryptionError(error)) {
      throw error
    }
  }

  if (!remote) {
    let legacySnapshot: CloudflareSnapshotEnvelopeRead | null = null
    let legacyRemoteState: CloudflareSnapshotState | null = null

    try {
      legacySnapshot = await readCloudflareSnapshot(
        endpoint,
        token,
        context.signal,
      )
      if (legacySnapshot.generation !== generation) {
        throw new IncrementalHeadConflictError()
      }
      legacyRemoteState = (
        await decryptCloudflareSnapshot(
          legacySnapshot,
          context.encryptionPassphrase,
        )
      ).state
    } catch (error: unknown) {
      if (!context.allowPassphraseRotation || !isPassphraseDecryptionError(error)) {
        throw error
      }
    }
    const legacyRemote = legacyRemoteState?.vault ?? null

    if (legacyRemote && shouldMergeFirstSync(data, context.firstSyncStrategy)) {
      const merged = prepareMergedFirstSyncVault(legacyRemote, data, secrets)

      return uploadCloudflareIncrementalVault(
        merged.data,
        context,
        endpoint,
        token,
        merged.secrets,
        remote,
        generation,
        rt('sync.status.merged'),
        true,
      )
    }

    if (
      legacyRemote &&
      shouldAcceptRemoteVault(legacyRemote, data, context.firstSyncStrategy)
    ) {
      const accepted = acceptRemoteVault(legacyRemote, data)
      if (!legacySnapshot) {
        throw new IncrementalHeadConflictError()
      }
      await assertCloudflareSnapshotCurrent(
        endpoint,
        token,
        legacySnapshot,
        context.signal,
      )

      return {
        data: accepted.data,
        secrets: accepted.secrets,
        remoteAccepted: true,
        message: accepted.data.sync.lastSyncStatus ?? rt('sync.status.complete'),
      }
    }
  }

  if (remote && shouldMergeFirstSync(data, context.firstSyncStrategy)) {
    const remoteVault = await manifestToVault(
      endpoint,
      token,
      context.encryptionPassphrase,
      remote.manifest,
      context.signal,
    )
    const merged = prepareMergedFirstSyncVault(remoteVault, data, secrets)

    return uploadCloudflareIncrementalVault(
      merged.data,
      context,
      endpoint,
      token,
      merged.secrets,
      remote,
      generation,
      rt('sync.status.merged'),
      true,
    )
  }

  if (
    remote &&
    shouldAcceptRemoteUpdatedAt(
      remote.manifest.updatedAt,
      data,
      context.firstSyncStrategy,
    )
  ) {
    const remoteVault = await manifestToVault(
      endpoint,
      token,
      context.encryptionPassphrase,
      remote.manifest,
      context.signal,
    )
    const accepted = acceptRemoteVault(remoteVault, data)
    await assertIncrementalRemoteCurrent(
      endpoint,
      token,
      generation,
      remote.head,
      context.signal,
    )

    return {
      data: accepted.data,
      secrets: accepted.secrets,
      remoteAccepted: true,
      message:
        accepted.data.sync.lastSyncStatus ?? rt('sync.status.incrementalComplete'),
    }
  }

  return uploadCloudflareIncrementalVault(
    data,
    context,
    endpoint,
    token,
    secrets,
    remote,
    generation,
    rt('sync.status.incrementalComplete'),
    false,
  )
}

async function pullWithCloudflareIncremental(
  data: AppData,
  context: SyncContext,
  endpoint: string,
  token: string,
  secrets: ProviderSecrets,
): Promise<SyncResult | null> {
  const observation = await readIncrementalHead(endpoint, token, context.signal)

  if (observation === 'unsupported') {
    return null
  }
  const { generation, head } = observation

  if (!head) {
    return pullWithCloudflareSnapshot(data, context, endpoint, token, secrets)
  }

  const remote = await readIncrementalRemoteState(
    endpoint,
    token,
    context.encryptionPassphrase,
    head,
    context.signal,
  )

  if (shouldMergeFirstSync(data, context.firstSyncStrategy)) {
    const remoteVault = await manifestToVault(
      endpoint,
      token,
      context.encryptionPassphrase,
      remote.manifest,
      context.signal,
    )
    const merged = prepareMergedFirstSyncVault(remoteVault, data, secrets)

    return uploadCloudflareIncrementalVault(
      merged.data,
      context,
      endpoint,
      token,
      merged.secrets,
      remote,
      generation,
      rt('sync.status.merged'),
      true,
    )
  }

  if (
    shouldAcceptRemoteUpdatedAt(
      remote.manifest.updatedAt,
      data,
      context.firstSyncStrategy,
    )
  ) {
    const remoteVault = await manifestToVault(
      endpoint,
      token,
      context.encryptionPassphrase,
      remote.manifest,
      context.signal,
    )
    const accepted = acceptRemoteVault(remoteVault, data)
    await assertIncrementalRemoteCurrent(
      endpoint,
      token,
      generation,
      remote.head,
      context.signal,
    )

    return {
      data: accepted.data,
      secrets: accepted.secrets,
      remoteAccepted: true,
      message:
        accepted.data.sync.lastSyncStatus ??
        rt('sync.status.remoteIncrementalAccepted'),
    }
  }

  await assertIncrementalRemoteCurrent(
    endpoint,
    token,
    generation,
    remote.head,
    context.signal,
  )
  const checked = markSynced(data, rt('sync.status.upToDate'))

  return {
    data: checked,
    secrets,
    remoteAccepted: false,
    message: checked.sync.lastSyncStatus ?? rt('sync.status.upToDate'),
  }
}

export async function syncWithCloudflare(
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

  if (context.allowPassphraseRotation) {
    await clearCloudflareViaBulkEndpoint(
      endpoint,
      token,
      context.signal,
      context.shouldDeferRemoteWrite,
    )
  }

  const incremental = await syncWithCloudflareIncremental(
    data,
    context,
    endpoint,
    token,
    secrets,
  )

  if (incremental) {
    return incremental
  }

  return syncWithCloudflareSnapshot(data, context, endpoint, token, secrets)
}

export async function pullWithCloudflare(
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

  const incremental = await pullWithCloudflareIncremental(
    data,
    context,
    endpoint,
    token,
    secrets,
  )

  if (incremental) {
    return incremental
  }

  return pullWithCloudflareSnapshot(data, context, endpoint, token, secrets)
}
