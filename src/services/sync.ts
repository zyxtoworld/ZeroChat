import { getGithubToken, getWorkerToken } from '../storage/secrets'
import type {
  AppData,
  ProviderSecrets,
  SyncConfig,
  SyncResult,
  SyncVault,
} from '../types'
import { decryptVault, encryptVault, isEncryptedSnapshot } from './crypto'

const DEFAULT_GIST_FILE = 'zerochat-sync.json'

interface SyncContext {
  encryptionPassphrase: string
  providerKeys: Record<string, string>
  providerProxyTokens: Record<string, string>
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
    lastSyncStatus: '已采用远端较新的加密数据',
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
    return decryptVault(parsed, passphrase)
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

async function readError(response: Response): Promise<string> {
  const text = await response.text()
  return text || `HTTP ${response.status}`
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

async function syncWithGist(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  const token = getGithubToken()
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

  if (remote && remote.data.updatedAt > data.updatedAt) {
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

async function syncWithCloudflare(
  data: AppData,
  context: SyncContext,
): Promise<SyncResult> {
  const token = getWorkerToken()
  const endpoint = data.sync.workerEndpoint?.replace(/\/+$/, '')
  const secrets: ProviderSecrets = {
    providerKeys: context.providerKeys,
    providerProxyTokens: context.providerProxyTokens,
  }

  if (!endpoint) {
    throw new Error('请先填写 Cloudflare Worker 地址')
  }

  if (!token) {
    throw new Error('请先填写同步访问密钥')
  }

  const readResponse = await fetch(`${endpoint}/snapshot`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  if (!readResponse.ok && readResponse.status !== 404) {
    throw new Error(await readError(readResponse))
  }

  const remote = readResponse.ok
    ? await parseRemoteVault(await readResponse.text(), context.encryptionPassphrase)
    : null

  if (remote && remote.data.updatedAt > data.updatedAt) {
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
