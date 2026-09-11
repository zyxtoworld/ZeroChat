import { beforeAll, describe, expect, it, vi } from 'vitest'

import { loadLocale, rt, setRuntimeLocale } from '../../i18n'
import type { AppData, SyncResult } from '../../types'
import type { SyncContext } from '../syncShared'

const gistMock = vi.hoisted(() => ({
  clearWithGist: vi.fn(),
  pullWithGist: vi.fn(),
  syncWithGist: vi.fn(),
}))
const cloudflareMock = vi.hoisted(() => ({
  clearWithCloudflare: vi.fn(),
  pullWithCloudflare: vi.fn(),
  syncWithCloudflare: vi.fn(),
}))

vi.mock('../syncGist', () => gistMock)
vi.mock('../syncCloudflare', () => cloudflareMock)

import {
  clearRemoteSyncData,
  performSync,
  pullRemoteChanges,
} from '../sync'

function data(mode: 'local' | 'gist' | 'cloudflare'): AppData {
  return {
    conversations: [],
    preferences: {
      compactMode: false,
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: true,
      encryptionEnabled: true,
      mode,
    },
    updatedAt: 1,
    version: 1,
  }
}

function context(patch: Partial<SyncContext> = {}): SyncContext {
  return {
    encryptionPassphrase: 'passphrase',
    githubToken: 'token',
    providerKeys: { provider: 'key' },
    ...patch,
  }
}

function result(message: string): SyncResult {
  return {
    data: data('local'),
    message,
    remoteAccepted: false,
    secrets: { providerKeys: {} },
  }
}

describe('sync service routing', () => {
  beforeAll(async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')
  })

  it('marks local perform and pull operations without touching a remote service', async () => {
    const local = data('local')
    const syncContext = context()

    await expect(performSync(local, syncContext)).resolves.toMatchObject({
      remoteAccepted: false,
    })
    await expect(pullRemoteChanges(local, syncContext)).resolves.toMatchObject({
      remoteAccepted: false,
    })

    expect(cloudflareMock.syncWithCloudflare).not.toHaveBeenCalled()
    expect(gistMock.syncWithGist).not.toHaveBeenCalled()
  })

  it('routes gist and Cloudflare perform, pull, and clear operations', async () => {
    const gistResult = result('gist')
    const cloudflareResult = result('cloudflare')
    gistMock.syncWithGist.mockResolvedValue(gistResult)
    gistMock.pullWithGist.mockResolvedValue(gistResult)
    gistMock.clearWithGist.mockResolvedValue(gistResult)
    cloudflareMock.syncWithCloudflare.mockResolvedValue(cloudflareResult)
    cloudflareMock.pullWithCloudflare.mockResolvedValue(cloudflareResult)
    cloudflareMock.clearWithCloudflare.mockResolvedValue(cloudflareResult)

    await expect(performSync(data('gist'), context())).resolves.toBe(gistResult)
    await expect(pullRemoteChanges(data('gist'), context())).resolves.toBe(gistResult)
    await expect(clearRemoteSyncData(data('gist'), context())).resolves.toBe(gistResult)
    await expect(performSync(data('cloudflare'), context())).resolves.toBe(
      cloudflareResult,
    )
    await expect(pullRemoteChanges(data('cloudflare'), context())).resolves.toBe(
      cloudflareResult,
    )
    await expect(clearRemoteSyncData(data('cloudflare'), context())).resolves.toBe(
      cloudflareResult,
    )
  })

  it('rejects remote perform and pull without an encryption passphrase', async () => {
    const syncContext = context({ encryptionPassphrase: '' })

    await expect(performSync(data('cloudflare'), syncContext)).rejects.toThrow(
      'Enter the data encryption password first',
    )
    await expect(
      pullRemoteChanges(data('gist'), syncContext),
    ).rejects.toThrow('Enter the data encryption password first')
    await expect(clearRemoteSyncData(data('local'), context())).rejects.toThrow(
      'Local mode has no cloud data to clear',
    )
  })

  it('rejects an unknown runtime sync mode before dispatching any remote action', async () => {
    vi.clearAllMocks()
    const invalid = data('cloudflare')
    invalid.sync.mode = 'unsupported' as typeof invalid.sync.mode

    await expect(performSync(invalid, context())).rejects.toThrow(
      rt('error.remoteDataBadFormat'),
    )
    await expect(pullRemoteChanges(invalid, context())).rejects.toThrow(
      rt('error.remoteDataBadFormat'),
    )
    await expect(clearRemoteSyncData(invalid, context())).rejects.toThrow(
      rt('error.remoteDataBadFormat'),
    )

    expect(cloudflareMock.syncWithCloudflare).not.toHaveBeenCalled()
    expect(cloudflareMock.pullWithCloudflare).not.toHaveBeenCalled()
    expect(cloudflareMock.clearWithCloudflare).not.toHaveBeenCalled()
    expect(gistMock.syncWithGist).not.toHaveBeenCalled()
    expect(gistMock.pullWithGist).not.toHaveBeenCalled()
    expect(gistMock.clearWithGist).not.toHaveBeenCalled()
  })
})
