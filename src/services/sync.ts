import { getGithubToken, getWorkerToken } from '../storage/secrets'
import type { AppData, SyncConfig, SyncResult } from '../types'

const DEFAULT_GIST_FILE = 'zerochat-sync.json'

function markSynced(data: AppData, message: string): AppData {
  return {
    ...data,
    sync: {
      ...data.sync,
      lastSyncAt: Date.now(),
      lastSyncStatus: message,
    },
  }
}

function mergeSyncConfig(remote: SyncConfig, local: SyncConfig): SyncConfig {
  return {
    mode: remote.mode ?? local.mode,
    autoSync: remote.autoSync ?? local.autoSync,
    gistId: remote.gistId ?? local.gistId,
    gistFile: remote.gistFile ?? local.gistFile,
    workerEndpoint: remote.workerEndpoint ?? local.workerEndpoint,
    lastSyncAt: Date.now(),
    lastSyncStatus: '已采用远端较新的数据',
  }
}

function acceptRemoteData(remote: AppData, local: AppData): AppData {
  return {
    ...remote,
    sync: mergeSyncConfig(remote.sync, local.sync),
  }
}

function parseRemoteData(content?: string): AppData | null {
  if (!content) {
    return null
  }

  try {
    const data = JSON.parse(content) as AppData
    return data?.version === 1 ? data : null
  } catch {
    return null
  }
}

function serializeSnapshot(data: AppData, message = '同步完成'): string {
  return JSON.stringify(markSynced(data, message), null, 2)
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

async function syncWithGist(data: AppData): Promise<SyncResult> {
  const token = getGithubToken()
  const fileName = data.sync.gistFile || DEFAULT_GIST_FILE

  if (!token) {
    throw new Error('请先填写 GitHub Token')
  }

  let gistId = data.sync.gistId
  let remote: AppData | null = null

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
    remote = parseRemoteData(json?.files?.[fileName]?.content)
  }

  if (remote && remote.updatedAt > data.updatedAt) {
    const accepted = acceptRemoteData(remote, data)
    return {
      data: accepted,
      remoteAccepted: true,
      message: accepted.sync.lastSyncStatus ?? '同步完成',
    }
  }

  if (!gistId) {
    const response = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        description: 'ZeroChat sync snapshot',
        public: false,
        files: {
          [fileName]: {
            content: serializeSnapshot(data),
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
        gistId,
        gistFile: fileName,
      },
    },
    '同步完成',
  )

  await patchGist(gistId, token, fileName, JSON.stringify(synced, null, 2))

  return {
    data: synced,
    remoteAccepted: false,
    message: synced.sync.lastSyncStatus ?? '同步完成',
  }
}

async function syncWithCloudflare(data: AppData): Promise<SyncResult> {
  const token = getWorkerToken()
  const endpoint = data.sync.workerEndpoint?.replace(/\/+$/, '')

  if (!endpoint) {
    throw new Error('请先填写 Cloudflare Worker 地址')
  }

  if (!token) {
    throw new Error('请先填写同步密钥')
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
    ? parseRemoteData(await readResponse.text())
    : null

  if (remote && remote.updatedAt > data.updatedAt) {
    const accepted = acceptRemoteData(remote, data)
    return {
      data: accepted,
      remoteAccepted: true,
      message: accepted.sync.lastSyncStatus ?? '同步完成',
    }
  }

  const synced = markSynced(data, '同步完成')
  const writeResponse = await fetch(`${endpoint}/snapshot`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(synced, null, 2),
  })

  if (!writeResponse.ok) {
    throw new Error(await readError(writeResponse))
  }

  return {
    data: synced,
    remoteAccepted: false,
    message: synced.sync.lastSyncStatus ?? '同步完成',
  }
}

export async function performSync(data: AppData): Promise<SyncResult> {
  if (data.sync.mode === 'local') {
    const local = markSynced(data, '当前使用本地模式')

    return {
      data: local,
      remoteAccepted: false,
      message: local.sync.lastSyncStatus ?? '当前使用本地模式',
    }
  }

  if (data.sync.mode === 'gist') {
    return syncWithGist(data)
  }

  return syncWithCloudflare(data)
}
