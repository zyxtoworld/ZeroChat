import type {
  AppData,
  ChatMessage,
  Conversation,
  EncryptedObjectEnvelope,
  IncrementalSyncHead,
  ProviderSecrets,
  SyncConfig,
  SyncResult,
  SyncVault,
} from '../types'
import {
  decryptObject,
  decryptVault,
  encryptObject,
  encryptVault,
  isEncryptedObject,
  isEncryptedSnapshot,
} from './crypto'

const DEFAULT_GIST_FILE = 'zerochat-sync.json'
const INCREMENTAL_CHUNK_SIZE = 60
const INCREMENTAL_HEAD_PATH = '/sync/head'
const INCREMENTAL_OBJECT_PATH = '/sync/object'

interface SyncContext {
  encryptionPassphrase: string
  githubToken: string
  providerKeys: Record<string, string>
  providerProxyTokens: Record<string, string>
  workerToken: string
}

interface IncrementalChunkRef {
  conversationId: string
  index: number
  key: string
  objectType: string
  fingerprint: string
  messageCount: number
  updatedAt: number
}

interface IncrementalManifest {
  kind: 'zerochat.incrementalManifest'
  version: 1
  updatedAt: number
  data: AppData
  secrets: ProviderSecrets
  chunks: IncrementalChunkRef[]
}

interface ConversationChunk {
  kind: 'zerochat.conversationChunk'
  version: 1
  conversationId: string
  index: number
  messages: ChatMessage[]
  updatedAt: number
  fingerprint: string
}

interface IncrementalRemoteState {
  head: IncrementalSyncHead
  manifest: IncrementalManifest
}

interface PendingChunkUpload {
  key: string
  envelope: EncryptedObjectEnvelope
}

interface BuiltIncrementalUpload {
  head: IncrementalSyncHead
  manifest: IncrementalManifest
  manifestEnvelope: EncryptedObjectEnvelope
  chunks: PendingChunkUpload[]
}

function markSynced(data: AppData, message: string): AppData {
  return {
    ...data,
    sync: {
      ...data.sync,
      encryptionEnabled: true,
      lastSyncAt: Date.now(),
      lastSyncStatus: message,
    },
  }
}

function mergeSyncConfig(remote: SyncConfig, local: SyncConfig): SyncConfig {
  return {
    mode: remote.mode ?? local.mode,
    autoSync: remote.autoSync ?? local.autoSync,
    encryptionEnabled: true,
    gistId: remote.gistId ?? local.gistId,
    gistFile: remote.gistFile ?? local.gistFile,
    workerEndpoint: remote.workerEndpoint ?? local.workerEndpoint,
    lastSyncAt: Date.now(),
    lastSyncStatus: '已采用远端加密数据',
  }
}

function acceptRemoteVault(remote: SyncVault, local: AppData): SyncVault {
  return {
    data: {
      ...remote.data,
      sync: mergeSyncConfig(remote.data.sync, local.sync),
    },
    secrets: {
      providerKeys: remote.secrets?.providerKeys ?? {},
      providerProxyTokens: remote.secrets?.providerProxyTokens ?? {},
    },
  }
}

function hasLocalUserContent(data: AppData): boolean {
  return (
    data.conversations.some((conversation) => conversation.messages.length > 0) ||
    data.providers.length > 1 ||
    data.providers.some((provider) => provider.updatedAt !== provider.createdAt) ||
    data.preferences.theme !== 'system' ||
    data.preferences.compactMode
  )
}

function shouldAcceptRemoteVault(remote: SyncVault, local: AppData): boolean {
  if (remote.data.updatedAt > local.updatedAt) {
    return true
  }

  return !local.sync.lastSyncAt && !hasLocalUserContent(local)
}

function isPlainRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIncrementalHead(value: unknown): value is IncrementalSyncHead {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as IncrementalSyncHead).kind === 'zerochat.incrementalHead' &&
    (value as IncrementalSyncHead).version === 1 &&
    typeof (value as IncrementalSyncHead).manifestKey === 'string' &&
    Number.isSafeInteger((value as IncrementalSyncHead).updatedAt)
  )
}

function isIncrementalManifest(value: unknown): value is IncrementalManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as IncrementalManifest).kind === 'zerochat.incrementalManifest' &&
    (value as IncrementalManifest).version === 1 &&
    Number.isSafeInteger((value as IncrementalManifest).updatedAt) &&
    Array.isArray((value as IncrementalManifest).chunks)
  )
}

function objectKey(prefix: 'manifest' | 'chunk'): string {
  return `${prefix}-${crypto.randomUUID()}.json`
}

function chunkObjectType(conversationId: string, index: number): string {
  return `conversationChunk:${conversationId}:${index}`
}

function emptyConversationMessages(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: [],
  }
}

function chunkUpdatedAt(conversation: Conversation, messages: ChatMessage[]): number {
  return Math.max(
    conversation.updatedAt,
    ...messages.map((message) => message.createdAt),
  )
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function chunkFingerprint(
  conversationId: string,
  index: number,
  messages: ChatMessage[],
  updatedAt: number,
): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      conversationId,
      index,
      messages,
      updatedAt,
    }),
  )
}

async function parseRemoteVault(
  content: string | undefined,
  passphrase: string,
): Promise<SyncVault | null> {
  if (!content) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('远端同步数据不是有效 JSON')
  }

  if (isEncryptedSnapshot(parsed)) {
    const vault = await decryptVault(parsed, passphrase)

    if (
      vault.data?.version !== 1 ||
      !Array.isArray(vault.data.providers) ||
      !Array.isArray(vault.data.conversations) ||
      !isPlainRecord(vault.secrets?.providerKeys) ||
      !isPlainRecord(vault.secrets?.providerProxyTokens)
    ) {
      throw new Error('远端加密数据格式不正确')
    }

    return vault
  }

  throw new Error('远端同步数据不是加密快照，已拒绝导入')
}

async function serializeVault(
  data: AppData,
  secrets: ProviderSecrets,
  passphrase: string,
): Promise<string> {
  const envelope = await encryptVault(
    {
      data,
      secrets,
    },
    passphrase,
  )

  return JSON.stringify(envelope, null, 2)
}

async function buildIncrementalUpload(
  data: AppData,
  secrets: ProviderSecrets,
  passphrase: string,
  remoteManifest: IncrementalManifest | null,
): Promise<BuiltIncrementalUpload> {
  const reusableChunks = new Map(
    remoteManifest?.chunks.map((chunk) => [chunk.fingerprint, chunk]) ?? [],
  )
  const chunks: PendingChunkUpload[] = []
  const refs: IncrementalChunkRef[] = []

  for (const conversation of data.conversations) {
    for (
      let index = 0;
      index < conversation.messages.length;
      index += INCREMENTAL_CHUNK_SIZE
    ) {
      const chunkIndex = Math.floor(index / INCREMENTAL_CHUNK_SIZE)
      const messages = conversation.messages.slice(
        index,
        index + INCREMENTAL_CHUNK_SIZE,
      )
      const updatedAt = chunkUpdatedAt(conversation, messages)
      const fingerprint = await chunkFingerprint(
        conversation.id,
        chunkIndex,
        messages,
        updatedAt,
      )
      const objectType = chunkObjectType(conversation.id, chunkIndex)
      const reusable = reusableChunks.get(fingerprint)
      const key = reusable?.key ?? objectKey('chunk')
      const ref: IncrementalChunkRef = {
        conversationId: conversation.id,
        index: chunkIndex,
        key,
        objectType,
        fingerprint,
        messageCount: messages.length,
        updatedAt,
      }

      refs.push(ref)

      if (!reusable) {
        const chunk: ConversationChunk = {
          kind: 'zerochat.conversationChunk',
          version: 1,
          conversationId: conversation.id,
          index: chunkIndex,
          messages,
          updatedAt,
          fingerprint,
        }

        chunks.push({
          key,
          envelope: await encryptObject(
            chunk,
            passphrase,
            objectType,
            updatedAt,
          ),
        })
      }
    }
  }

  const manifest: IncrementalManifest = {
    kind: 'zerochat.incrementalManifest',
    version: 1,
    updatedAt: data.updatedAt,
    data: {
      ...data,
      conversations: data.conversations.map(emptyConversationMessages),
    },
    secrets,
    chunks: refs,
  }
  const manifestKey = objectKey('manifest')
  const manifestEnvelope = await encryptObject(
    manifest,
    passphrase,
    'manifest',
    manifest.updatedAt,
  )

  return {
    head: {
      kind: 'zerochat.incrementalHead',
      version: 1,
      manifestKey,
      updatedAt: manifest.updatedAt,
    },
    manifest,
    manifestEnvelope,
    chunks,
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text()
  return text || `HTTP ${response.status}`
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

function normalizeWorkerEndpoint(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? ''

  if (!trimmed) {
    throw new Error('请先填写 Cloudflare Worker 地址')
  }

  let url: URL

  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Cloudflare Worker 地址格式不正确')
  }

  if (url.username || url.password) {
    throw new Error('Cloudflare Worker 地址不能包含用户名或密码')
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new Error('Cloudflare Worker 地址必须使用 HTTPS，本机调试地址除外')
  }

  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/+$/, '')
}

async function readIncrementalHead(
  endpoint: string,
  token: string,
): Promise<IncrementalSyncHead | null | 'unsupported'> {
  const response = await fetch(`${endpoint}${INCREMENTAL_HEAD_PATH}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  if (response.status === 501) {
    return 'unsupported'
  }

  if (response.status === 404) {
    const text = await response.text()
    return text.trim() === 'Not found' ? 'unsupported' : null
  }

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const head = await readJson<unknown>(response)

  if (!isIncrementalHead(head)) {
    throw new Error('远端增量同步指针格式不正确')
  }

  return head
}

async function readIncrementalObject(
  endpoint: string,
  token: string,
  key: string,
): Promise<EncryptedObjectEnvelope> {
  const response = await fetch(
    `${endpoint}${INCREMENTAL_OBJECT_PATH}/${encodeURIComponent(key)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  const envelope = await readJson<unknown>(response)

  if (!isEncryptedObject(envelope)) {
    throw new Error('远端增量对象不是加密对象')
  }

  return envelope
}

async function writeIncrementalObject(
  endpoint: string,
  token: string,
  key: string,
  envelope: EncryptedObjectEnvelope,
): Promise<void> {
  const response = await fetch(
    `${endpoint}${INCREMENTAL_OBJECT_PATH}/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(envelope),
    },
  )

  if (!response.ok) {
    throw new Error(await readError(response))
  }
}

async function deleteIncrementalObject(
  endpoint: string,
  token: string,
  key: string,
): Promise<void> {
  const response = await fetch(
    `${endpoint}${INCREMENTAL_OBJECT_PATH}/${encodeURIComponent(key)}`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  )

  if (!response.ok && response.status !== 404) {
    throw new Error(await readError(response))
  }
}

async function writeIncrementalHead(
  endpoint: string,
  token: string,
  head: IncrementalSyncHead,
): Promise<void> {
  const response = await fetch(`${endpoint}${INCREMENTAL_HEAD_PATH}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(head),
  })

  if (response.status === 409) {
    throw new Error('远端已有更新，请重新同步一次')
  }

  if (!response.ok) {
    throw new Error(await readError(response))
  }
}

async function deleteLegacySnapshot(
  endpoint: string,
  token: string,
): Promise<void> {
  const response = await fetch(`${endpoint}/snapshot`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok && response.status !== 404 && response.status !== 405) {
    throw new Error(await readError(response))
  }
}

async function readIncrementalManifest(
  endpoint: string,
  token: string,
  passphrase: string,
  head: IncrementalSyncHead,
): Promise<IncrementalManifest> {
  const envelope = await readIncrementalObject(endpoint, token, head.manifestKey)
  const manifest = await decryptObject<IncrementalManifest>(
    envelope,
    passphrase,
    'manifest',
  )

  if (!isIncrementalManifest(manifest) || manifest.updatedAt !== head.updatedAt) {
    throw new Error('远端增量 manifest 格式不正确')
  }

  return manifest
}

async function readIncrementalRemoteState(
  endpoint: string,
  token: string,
  passphrase: string,
  head: IncrementalSyncHead,
): Promise<IncrementalRemoteState> {
  return {
    head,
    manifest: await readIncrementalManifest(endpoint, token, passphrase, head),
  }
}

async function manifestToVault(
  endpoint: string,
  token: string,
  passphrase: string,
  manifest: IncrementalManifest,
): Promise<SyncVault> {
  const refsByConversation = new Map<string, IncrementalChunkRef[]>()

  for (const ref of manifest.chunks) {
    const refs = refsByConversation.get(ref.conversationId) ?? []
    refs.push(ref)
    refsByConversation.set(ref.conversationId, refs)
  }

  const conversations = await Promise.all(
    manifest.data.conversations.map(async (conversation) => {
      const refs = (refsByConversation.get(conversation.id) ?? []).sort(
        (left, right) => left.index - right.index,
      )
      const chunks = await Promise.all(
        refs.map(async (ref) => {
          const envelope = await readIncrementalObject(endpoint, token, ref.key)
          const chunk = await decryptObject<ConversationChunk>(
            envelope,
            passphrase,
            ref.objectType,
          )

          if (
            chunk.kind !== 'zerochat.conversationChunk' ||
            chunk.version !== 1 ||
            chunk.conversationId !== ref.conversationId ||
            chunk.index !== ref.index ||
            chunk.fingerprint !== ref.fingerprint ||
            chunk.messages.length !== ref.messageCount
          ) {
            throw new Error('远端消息分块格式不正确')
          }

          return chunk
        }),
      )

      return {
        ...conversation,
        messages: chunks.flatMap((chunk) => chunk.messages),
      }
    }),
  )

  return {
    data: {
      ...manifest.data,
      conversations,
    },
    secrets: {
      providerKeys: manifest.secrets?.providerKeys ?? {},
      providerProxyTokens: manifest.secrets?.providerProxyTokens ?? {},
    },
  }
}

async function cleanupIncrementalObjects(
  endpoint: string,
  token: string,
  previous: IncrementalRemoteState | null,
  next: IncrementalManifest,
): Promise<void> {
  if (!previous) {
    return
  }

  const keep = new Set(next.chunks.map((chunk) => chunk.key))
  const stale = new Set<string>([previous.head.manifestKey])

  for (const chunk of previous.manifest.chunks) {
    if (!keep.has(chunk.key)) {
      stale.add(chunk.key)
    }
  }

  await Promise.all(
    Array.from(stale).map((key) =>
      deleteIncrementalObject(endpoint, token, key).catch(() => undefined),
    ),
  )
}

async function patchGist(
  gistId: string,
  token: string,
  fileName: string,
  content: string,
): Promise<void> {
  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      files: {
        [fileName]: {
          content,
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }
}

async function readCloudflareSnapshotVault(
  endpoint: string,
  token: string,
  passphrase: string,
): Promise<SyncVault | null> {
  const readResponse = await fetch(`${endpoint}/snapshot`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  if (!readResponse.ok && readResponse.status !== 404) {
    throw new Error(await readError(readResponse))
  }

  return readResponse.ok
    ? await parseRemoteVault(await readResponse.text(), passphrase)
    : null
}

async function syncWithGist(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  const token = context.githubToken.trim()
  const fileName = data.sync.gistFile || DEFAULT_GIST_FILE
  const secrets: ProviderSecrets = {
    providerKeys: context.providerKeys,
    providerProxyTokens: context.providerProxyTokens,
  }

  if (!token) {
    throw new Error('请先填写 GitHub Token')
  }

  let gistId = data.sync.gistId
  let remote: SyncVault | null = null

  if (gistId) {
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(await readError(response))
    }

    const json = await response.json()
    remote = await parseRemoteVault(
      json?.files?.[fileName]?.content,
      context.encryptionPassphrase,
    )
  }

  if (remote && shouldAcceptRemoteVault(remote, data)) {
    const accepted = acceptRemoteVault(remote, data)
    return {
      data: accepted.data,
      secrets: accepted.secrets,
      remoteAccepted: true,
      message: accepted.data.sync.lastSyncStatus ?? '同步完成',
    }
  }

  if (!gistId) {
    const initial = markSynced(data, '同步完成')
    const response = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        description: 'ZeroChat encrypted sync vault',
        public: false,
        files: {
          [fileName]: {
            content: await serializeVault(
              initial,
              secrets,
              context.encryptionPassphrase,
            ),
          },
        },
      }),
    })

    if (!response.ok) {
      throw new Error(await readError(response))
    }

    const json = await response.json()
    gistId = json.id
  }

  if (!gistId) {
    throw new Error('没有拿到 Gist ID')
  }

  const synced = markSynced(
    {
      ...data,
      sync: {
        ...data.sync,
        encryptionEnabled: true,
        gistId,
        gistFile: fileName,
      },
    },
    '同步完成',
  )

  await patchGist(
    gistId,
    token,
    fileName,
    await serializeVault(synced, secrets, context.encryptionPassphrase),
  )

  return {
    data: synced,
    secrets,
    remoteAccepted: false,
    message: synced.sync.lastSyncStatus ?? '同步完成',
  }
}

async function syncWithCloudflareSnapshot(
  data: AppData,
  context: SyncContext,
  endpoint: string,
  token: string,
  secrets: ProviderSecrets,
): Promise<SyncResult> {
  const remote = await readCloudflareSnapshotVault(
    endpoint,
    token,
    context.encryptionPassphrase,
  )

  if (remote && shouldAcceptRemoteVault(remote, data)) {
    const accepted = acceptRemoteVault(remote, data)
    return {
      data: accepted.data,
      secrets: accepted.secrets,
      remoteAccepted: true,
      message: accepted.data.sync.lastSyncStatus ?? '同步完成',
    }
  }

  const synced = markSynced(data, '同步完成')
  const writeResponse = await fetch(`${endpoint}/snapshot`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: await serializeVault(synced, secrets, context.encryptionPassphrase),
  })

  if (!writeResponse.ok) {
    throw new Error(await readError(writeResponse))
  }

  return {
    data: synced,
    secrets,
    remoteAccepted: false,
    message: synced.sync.lastSyncStatus ?? '同步完成',
  }
}

async function syncWithCloudflareIncremental(
  data: AppData,
  context: SyncContext,
  endpoint: string,
  token: string,
  secrets: ProviderSecrets,
): Promise<SyncResult | null> {
  const head = await readIncrementalHead(endpoint, token)

  if (head === 'unsupported') {
    return null
  }

  const remote = head
    ? await readIncrementalRemoteState(
        endpoint,
        token,
        context.encryptionPassphrase,
        head,
      )
    : null

  if (!remote) {
    const legacyRemote = await readCloudflareSnapshotVault(
      endpoint,
      token,
      context.encryptionPassphrase,
    )

    if (legacyRemote && shouldAcceptRemoteVault(legacyRemote, data)) {
      const accepted = acceptRemoteVault(legacyRemote, data)

      return {
        data: accepted.data,
        secrets: accepted.secrets,
        remoteAccepted: true,
        message: accepted.data.sync.lastSyncStatus ?? '同步完成',
      }
    }
  }

  if (
    remote &&
    (remote.manifest.updatedAt > data.updatedAt ||
      (!data.sync.lastSyncAt && !hasLocalUserContent(data)))
  ) {
    const remoteVault = await manifestToVault(
      endpoint,
      token,
      context.encryptionPassphrase,
      remote.manifest,
    )
    const accepted = acceptRemoteVault(remoteVault, data)

    return {
      data: accepted.data,
      secrets: accepted.secrets,
      remoteAccepted: true,
      message: accepted.data.sync.lastSyncStatus ?? '增量同步完成',
    }
  }

  const synced = markSynced(data, '增量同步完成')
  const upload = await buildIncrementalUpload(
    synced,
    secrets,
    context.encryptionPassphrase,
    remote?.manifest ?? null,
  )

  try {
    await Promise.all(
      upload.chunks.map((chunk) =>
        writeIncrementalObject(endpoint, token, chunk.key, chunk.envelope),
      ),
    )
    await writeIncrementalObject(
      endpoint,
      token,
      upload.head.manifestKey,
      upload.manifestEnvelope,
    )
    await writeIncrementalHead(endpoint, token, upload.head)
  } catch (error) {
    await Promise.all([
      ...upload.chunks.map((chunk) =>
        deleteIncrementalObject(endpoint, token, chunk.key).catch(() => undefined),
      ),
      deleteIncrementalObject(endpoint, token, upload.head.manifestKey).catch(
        () => undefined,
      ),
    ])
    throw error
  }

  await cleanupIncrementalObjects(endpoint, token, remote, upload.manifest)
  await deleteLegacySnapshot(endpoint, token).catch(() => undefined)

  return {
    data: synced,
    secrets,
    remoteAccepted: false,
    message: synced.sync.lastSyncStatus ?? '增量同步完成',
  }
}

async function syncWithCloudflare(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  const token = context.workerToken.trim()
  const endpoint = normalizeWorkerEndpoint(data.sync.workerEndpoint)
  const secrets: ProviderSecrets = {
    providerKeys: context.providerKeys,
    providerProxyTokens: context.providerProxyTokens,
  }

  if (!token) {
    throw new Error('请先填写同步访问密钥')
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

export async function performSync(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  if (data.sync.mode === 'local') {
    const local = markSynced(data, '当前使用本地模式')

    return {
      data: local,
      secrets: {
        providerKeys: context.providerKeys,
        providerProxyTokens: context.providerProxyTokens,
      },
      remoteAccepted: false,
      message: local.sync.lastSyncStatus ?? '当前使用本地模式',
    }
  }

  if (!context.encryptionPassphrase) {
    throw new Error('请先填写同步加密密码')
  }

  if (data.sync.mode === 'gist') {
    return syncWithGist(data, context)
  }

  return syncWithCloudflare(data, context)
}
