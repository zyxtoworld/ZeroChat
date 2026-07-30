import type {
  AppData,
  ProviderSecrets,
  SyncResult,
  SyncVault,
} from '../types'
import { rt } from '../i18n'
import { mergeConcurrentAppData } from './concurrentAppDataMerge'
import {
  acceptRemoteVault,
  prepareMergedFirstSyncVault,
  shouldAcceptRemoteVault,
  shouldMergeFirstSync,
} from './syncMerge'
import {
  DEFAULT_GIST_FILE,
  assertRemoteWriteAllowed,
  isPassphraseDecryptionError,
  markRemoteCleared,
  markSynced,
  parseRemoteVault,
  readError,
  type SyncContext,
} from './syncShared'
import {
  MAX_SYNC_GIST_RESPONSE_BYTES,
  MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
  fetchSync,
  readSyncResponseJson,
  readSyncResponseText,
} from './syncHttpBody'
import {
  clearGistCursor,
  createGistClearOperation,
  createGistStateOperation,
  gistOperationFileName,
  gistOperationIdFromFileName,
  gistVaultsEqual,
  isManagedGistFile,
  loadGistCursor,
  materializeGistOperations,
  normalizeGistVault,
  parseGistOperation,
  serializeGistOperation,
  storeGistCursor,
  tombstonesBetweenVaults,
  tombstonesFromCursor,
  type GistOperation,
  type GistStateOperation,
  type GistTombstone,
} from './syncGistProtocol'

interface GithubGistFile {
  content?: string
  raw_url?: string
  truncated?: boolean
}

interface GithubGistResponse {
  id?: string
  files?: Record<string, GithubGistFile>
}

const GITHUB_GIST_RAW_HOST = 'gist.githubusercontent.com'

interface RemoteGistState {
  heads: string[]
  legacy: boolean
  managedFiles: string[]
  operations: Map<string, GistOperation>
  tombstones: GistTombstone[]
  vault: SyncVault | null
}

type GistFileChanges = Record<string, { content: string } | null>

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
  }
}

async function patchGistFiles(
  gistId: string,
  token: string,
  files: GistFileChanges,
  signal?: AbortSignal,
): Promise<void> {
  await fetchSync(
    `https://api.github.com/gists/${gistId}`,
    {
      method: 'PATCH',
      headers: {
        ...githubHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ files }),
      signal,
    },
    async (response, responseSignal) => {
      if (!response.ok) {
        throw new Error(await readError(response, responseSignal))
      }
    },
  )
}

async function readGist(
  gistId: string,
  token: string,
  signal?: AbortSignal,
  allowMissing = false,
): Promise<GithubGistResponse | null> {
  return fetchSync(
    `https://api.github.com/gists/${gistId}`,
    {
      headers: githubHeaders(token),
      signal,
    },
    async (response, responseSignal) => {
      if (allowMissing && response.status === 404) {
        return null
      }

      if (!response.ok) {
        throw new Error(await readError(response, responseSignal))
      }

      return readSyncResponseJson<GithubGistResponse>(
        response,
        MAX_SYNC_GIST_RESPONSE_BYTES,
        'GitHub Gist sync response',
        responseSignal,
      )
    },
  )
}

async function readGistFileContent(
  file: GithubGistFile | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!file) {
    return undefined
  }

  if (!file.truncated && typeof file.content === 'string') {
    return file.content
  }

  if (!file.raw_url) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  return fetchSync(
    validatedGithubGistRawUrl(file.raw_url),
    {
      headers: githubHeaders(token),
      signal,
    },
    async (response, responseSignal) => {
      if (!response.ok) {
        throw new Error(await readError(response, responseSignal))
      }

      return readSyncResponseText(
        response,
        MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
        'GitHub Gist sync file',
        responseSignal,
      )
    },
  )
}

function validatedGithubGistRawUrl(rawUrl: string): string {
  let endpoint: URL
  try {
    endpoint = new URL(rawUrl)
  } catch {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  if (
    endpoint.protocol !== 'https:' ||
    endpoint.hostname !== GITHUB_GIST_RAW_HOST ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.pathname === '/'
  ) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  return endpoint.toString()
}

async function decodeRemoteGist(
  json: GithubGistResponse,
  fileName: string,
  token: string,
  passphrase: string,
  signal?: AbortSignal,
): Promise<RemoteGistState> {
  const files = json.files ?? {}
  const managedFiles = Object.keys(files).filter((candidate) =>
    isManagedGistFile(fileName, candidate),
  )
  const operations = new Map<string, GistOperation>()

  for (const candidate of managedFiles) {
    if (candidate === fileName) {
      continue
    }

    const expectedId = gistOperationIdFromFileName(fileName, candidate)

    if (!expectedId) {
      throw new Error(rt('error.remoteDataBadFormat'))
    }

    const content = await readGistFileContent(files[candidate], token, signal)

    if (!content) {
      throw new Error(rt('error.remoteDataBadFormat'))
    }

    operations.set(
      expectedId,
      await parseGistOperation(content, passphrase, expectedId),
    )
  }

  if (operations.size > 0) {
    const materialized = await materializeGistOperations(operations)

    return {
      heads: materialized.heads,
      legacy: false,
      managedFiles,
      operations,
      tombstones: materialized.tombstones,
      vault: materialized.vault,
    }
  }

  const legacyContent = await readGistFileContent(files[fileName], token, signal)
  const legacyVault = await parseRemoteVault(legacyContent, passphrase)

  if (!legacyVault) {
    return {
      heads: [],
      legacy: false,
      managedFiles,
      operations,
      tombstones: [],
      vault: null,
    }
  }

  const legacyOperation = await createGistStateOperation(
    [],
    legacyVault,
    [],
  )
  operations.set(legacyOperation.id, legacyOperation)

  return {
    heads: [legacyOperation.id],
    legacy: true,
    managedFiles,
    operations,
    tombstones: [],
    vault: normalizeGistVault(legacyVault),
  }
}

function localVault(
  data: AppData,
  secrets: ProviderSecrets,
  gistId: string | undefined,
  fileName: string,
): SyncVault {
  return normalizeGistVault({
    data: {
      ...data,
      sync: {
        ...data.sync,
        mode: 'gist',
        encryptionEnabled: true,
        ...(gistId ? { gistId } : {}),
        gistFile: fileName,
      },
    },
    secrets,
  })
}

function mergeVaultWithoutBaseline(remote: SyncVault, local: SyncVault): SyncVault {
  const data = mergeConcurrentAppData(
    null,
    remote.data,
    local.data,
    Math.max(remote.data.updatedAt, local.data.updatedAt),
  )

  return normalizeGistVault({
    data,
    secrets: {
      providerKeys: {
        ...remote.secrets.providerKeys,
        ...local.secrets.providerKeys,
      },
    },
  })
}

function withSyncResultMetadata(
  vault: SyncVault,
  local: AppData,
  gistId: string,
  fileName: string,
  message: string,
): SyncVault {
  return {
    data: markSynced(
      {
        ...vault.data,
        sync: {
          ...vault.data.sync,
          ...local.sync,
          mode: 'gist',
          encryptionEnabled: true,
          gistId,
          gistFile: fileName,
        },
      },
      message,
    ),
    secrets: vault.secrets,
  }
}

async function publishStateOperation(
  gistId: string,
  token: string,
  fileName: string,
  passphrase: string,
  parents: readonly string[],
  vault: SyncVault,
  tombstones: readonly GistTombstone[],
  deleteFiles: readonly string[],
  context: SyncContext,
): Promise<GistStateOperation> {
  const operation = await createGistStateOperation(parents, vault, tombstones)
  const operationFile = gistOperationFileName(fileName, operation.id)
  const content = await serializeGistOperation(
    operation,
    passphrase,
    operation.vault.data.updatedAt,
  )
  const files: GistFileChanges = {
    [operationFile]: { content },
  }

  for (const candidate of deleteFiles) {
    if (candidate !== operationFile) {
      files[candidate] = null
    }
  }

  assertRemoteWriteAllowed(context)
  await patchGistFiles(gistId, token, files, context.signal)
  return operation
}

async function createGist(
  data: AppData,
  secrets: ProviderSecrets,
  token: string,
  fileName: string,
  context: SyncContext,
): Promise<SyncResult> {
  assertRemoteWriteAllowed(context)
  const vault = localVault(data, secrets, undefined, fileName)
  const operation = await createGistStateOperation([], vault, [])
  const content = await serializeGistOperation(
    operation,
    context.encryptionPassphrase,
    operation.vault.data.updatedAt,
  )
  assertRemoteWriteAllowed(context)
  const json = await fetchSync(
    'https://api.github.com/gists',
    {
      method: 'POST',
      headers: {
        ...githubHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        description: 'ZeroChat encrypted sync vault',
        public: false,
        files: {
          [gistOperationFileName(fileName, operation.id)]: { content },
        },
      }),
      signal: context.signal,
    },
    async (response, responseSignal) => {
      if (!response.ok) {
        throw new Error(await readError(response, responseSignal))
      }

      return readSyncResponseJson<GithubGistResponse>(
        response,
        MAX_SYNC_GIST_RESPONSE_BYTES,
        'GitHub Gist create response',
        responseSignal,
      )
    },
  )
  const gistId = json.id

  if (!gistId) {
    throw new Error(rt('error.syncGistIdMissing'))
  }

  const resultVault = withSyncResultMetadata(
    operation.vault,
    data,
    gistId,
    fileName,
    rt('sync.status.complete'),
  )
  await storeGistCursor(
    gistId,
    fileName,
    [operation.id],
    resultVault.data,
    resultVault,
  )

  return {
    data: resultVault.data,
    secrets: resultVault.secrets,
    remoteAccepted: false,
    message: resultVault.data.sync.lastSyncStatus ?? rt('sync.status.complete'),
  }
}

interface ReconciledVault {
  remoteAccepted: boolean
  shouldWrite: boolean
  tombstones: GistTombstone[]
  vault: SyncVault
}

async function reconcileVault(
  data: AppData,
  local: SyncVault,
  remote: RemoteGistState,
  context: SyncContext,
): Promise<ReconciledVault> {
  if (!remote.vault) {
    return {
      remoteAccepted: false,
      shouldWrite: true,
      tombstones: [],
      vault: local,
    }
  }

  const cursor = data.sync.gistId
    ? loadGistCursor(data.sync.gistId, data.sync.gistFile || DEFAULT_GIST_FILE, data)
    : null

  if (cursor) {
    const localTombstones = await tombstonesFromCursor(cursor, local)
    const localOperation = await createGistStateOperation(
      cursor.heads,
      local,
      localTombstones,
    )
    const combined = new Map(remote.operations)
    combined.set(localOperation.id, localOperation)
    const materialized = await materializeGistOperations(combined)
    const vault = materialized.vault ?? local

    return {
      remoteAccepted: !gistVaultsEqual(vault, local),
      shouldWrite: !gistVaultsEqual(vault, remote.vault),
      tombstones: materialized.tombstones,
      vault,
    }
  }

  if (data.sync.lastSyncAt !== undefined) {
    const vault = mergeVaultWithoutBaseline(remote.vault, local)

    return {
      remoteAccepted: !gistVaultsEqual(vault, local),
      shouldWrite: !gistVaultsEqual(vault, remote.vault),
      tombstones: [],
      vault,
    }
  }

  if (shouldMergeFirstSync(data, context.firstSyncStrategy)) {
    const merged = prepareMergedFirstSyncVault(
      remote.vault,
      local.data,
      local.secrets,
    )

    return {
      remoteAccepted: true,
      shouldWrite: true,
      tombstones: [],
      vault: normalizeGistVault(merged),
    }
  }

  if (shouldAcceptRemoteVault(remote.vault, data, context.firstSyncStrategy)) {
    return {
      remoteAccepted: true,
      shouldWrite: false,
      tombstones: remote.tombstones,
      vault: normalizeGistVault(acceptRemoteVault(remote.vault, data)),
    }
  }

  return {
    remoteAccepted: false,
    shouldWrite: true,
    tombstones: await tombstonesBetweenVaults(remote.vault, local),
    vault: local,
  }
}

async function syncExistingGist(
  data: AppData,
  context: SyncContext,
  mode: 'pull' | 'sync',
): Promise<SyncResult> {
  const token = context.githubToken.trim()
  const gistId = data.sync.gistId!
  const fileName = data.sync.gistFile || DEFAULT_GIST_FILE
  const secrets: ProviderSecrets = { providerKeys: context.providerKeys }
  const json = await readGist(gistId, token, context.signal)

  if (!json) {
    throw new Error(rt('error.syncGistIdMissing'))
  }

  let remote: RemoteGistState

  try {
    remote = await decodeRemoteGist(
      json,
      fileName,
      token,
      context.encryptionPassphrase,
      context.signal,
    )
  } catch (error: unknown) {
    if (
      mode !== 'sync' ||
      !context.allowPassphraseRotation ||
      !isPassphraseDecryptionError(error)
    ) {
      throw error
    }

    const rotated = await createGist(
      {
        ...data,
        sync: {
          ...data.sync,
          gistId: undefined,
        },
      },
      secrets,
      token,
      fileName,
      context,
    )
    clearGistCursor(gistId, fileName)
    return rotated
  }

  if (!remote.vault && mode === 'pull') {
    const checked = markSynced(data, rt('sync.status.upToDate'))
    clearGistCursor(gistId, fileName)

    return {
      data: checked,
      secrets,
      remoteAccepted: false,
      message: checked.sync.lastSyncStatus ?? rt('sync.status.upToDate'),
    }
  }

  const local = localVault(data, secrets, gistId, fileName)
  const reconciled = await reconcileVault(data, local, remote, context)
  const migrateLegacy = remote.legacy && mode === 'sync'
  const shouldWrite = reconciled.shouldWrite || migrateLegacy
  let heads = remote.heads

  if (shouldWrite) {
    const operation = await publishStateOperation(
      gistId,
      token,
      fileName,
      context.encryptionPassphrase,
      remote.heads,
      reconciled.vault,
      reconciled.tombstones,
      migrateLegacy
        ? remote.managedFiles
        : remote.managedFiles.filter((candidate) => candidate !== fileName),
      context,
    )
    heads = [operation.id]
  }

  const message = reconciled.remoteAccepted
    ? shouldWrite
      ? rt('sync.status.merged')
      : rt('sync.status.remoteAccepted')
    : mode === 'pull'
      ? rt('sync.status.upToDate')
      : rt('sync.status.complete')
  const resultVault = withSyncResultMetadata(
    reconciled.vault,
    data,
    gistId,
    fileName,
    message,
  )
  await storeGistCursor(
    gistId,
    fileName,
    heads,
    resultVault.data,
    resultVault,
  )

  return {
    data: resultVault.data,
    secrets: resultVault.secrets,
    remoteAccepted: reconciled.remoteAccepted,
    message: resultVault.data.sync.lastSyncStatus ?? message,
  }
}

export async function syncWithGist(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  const token = context.githubToken.trim()
  const fileName = data.sync.gistFile || DEFAULT_GIST_FILE
  const secrets: ProviderSecrets = { providerKeys: context.providerKeys }

  if (!token) {
    throw new Error(rt('error.syncGithubTokenRequired'))
  }

  if (!data.sync.gistId) {
    return createGist(data, secrets, token, fileName, context)
  }

  return syncExistingGist(data, context, 'sync')
}

export async function clearWithGist(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  const token = context.githubToken.trim()
  const fileName = data.sync.gistFile || DEFAULT_GIST_FILE
  const secrets: ProviderSecrets = { providerKeys: context.providerKeys }

  if (!token) {
    throw new Error(rt('error.syncGithubTokenRequired'))
  }

  if (!data.sync.gistId) {
    const cleared = markRemoteCleared(data, rt('sync.status.remoteAlreadyEmpty'))

    return {
      data: cleared,
      secrets,
      remoteAccepted: false,
      message: cleared.sync.lastSyncStatus ?? rt('sync.status.remoteAlreadyEmpty'),
    }
  }

  const json = await readGist(
    data.sync.gistId,
    token,
    context.signal,
    true,
  )

  if (!json) {
    clearGistCursor(data.sync.gistId, fileName)
    const cleared = markRemoteCleared(
      {
        ...data,
        sync: { ...data.sync, gistId: undefined },
      },
      rt('sync.status.remoteAlreadyEmpty'),
    )

    return {
      data: cleared,
      secrets,
      remoteAccepted: false,
      message: cleared.sync.lastSyncStatus ?? rt('sync.status.remoteAlreadyEmpty'),
    }
  }

  let remote: RemoteGistState

  try {
    remote = await decodeRemoteGist(
      json,
      fileName,
      token,
      context.encryptionPassphrase,
      context.signal,
    )
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }

    remote = {
      heads: [],
      legacy: false,
      managedFiles: Object.keys(json.files ?? {}).filter(
        (candidate) => isManagedGistFile(fileName, candidate),
      ),
      operations: new Map(),
      tombstones: [],
      vault: null,
    }
  }

  const clearOperation = await createGistClearOperation(remote.heads)
  const clearFile = gistOperationFileName(fileName, clearOperation.id)
  const content = await serializeGistOperation(
    clearOperation,
    context.encryptionPassphrase,
    data.updatedAt,
  )
  const files: GistFileChanges = { [clearFile]: { content } }

  for (const candidate of remote.managedFiles) {
    if (candidate !== clearFile) {
      files[candidate] = null
    }
  }

  assertRemoteWriteAllowed(context)
  await patchGistFiles(data.sync.gistId, token, files, context.signal)
  clearGistCursor(data.sync.gistId, fileName)
  const cleared = markRemoteCleared(data, rt('sync.status.remoteCleared'))

  return {
    data: cleared,
    secrets,
    remoteAccepted: false,
    message: cleared.sync.lastSyncStatus ?? rt('sync.status.remoteCleared'),
  }
}

export async function pullWithGist(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  const token = context.githubToken.trim()

  if (!token) {
    throw new Error(rt('error.syncGithubTokenRequired'))
  }

  if (!data.sync.gistId) {
    const checked = markSynced(data, rt('sync.status.remoteNotCreated'))

    return {
      data: checked,
      secrets: { providerKeys: context.providerKeys },
      remoteAccepted: false,
      message: checked.sync.lastSyncStatus ?? rt('sync.status.remoteNotCreated'),
    }
  }

  return syncExistingGist(data, context, 'pull')
}
