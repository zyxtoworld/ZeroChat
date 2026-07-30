import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
  SyncMode,
  SyncResult,
  UserSkill,
} from '../../types'
import {
  createSyncRuntimeControllerActions,
  createSyncRuntimeControllerRuntime,
  runDetachedSyncRuntime,
  type SyncRuntimeControllerContext,
  type SyncRuntimeControllerServices,
} from '../syncRuntimeController'
import { SyncRemoteWriteDeferredError } from '../syncShared'

const t = ((key: string, values?: Record<string, unknown>) =>
  values?.message ? `${key}:${values.message}` : key) as Translator

function provider(id = 'provider-1'): ProviderConfig {
  return {
    baseUrl: 'https://api.example.com/v1',
    clientRequestMode: true,
    createdAt: 1,
    enabled: true,
    id,
    imageModel: 'gpt-image-1',
    kind: 'openai-compatible',
    model: 'gpt-5',
    models: ['gpt-5'],
    needsApiKey: true,
    name: 'Example',
    updatedAt: 1,
  }
}

function skill(id: string, contentRef: string): UserSkill {
  return {
    autoMatch: true,
    chunks: [
      {
        contentRef,
        heading: 'Intro',
        id: 'chunk-1',
        keywords: [],
        tokenEstimate: 4,
      },
    ],
    contentHash: `${id}-hash`,
    contentType: 'markdown',
    createdAt: 1,
    description: 'Helpful context',
    enabled: true,
    fileName: `${id}.md`,
    fixed: false,
    id,
    keywords: [],
    name: id,
    sourceSize: 12,
    updatedAt: 1,
  }
}

function appData(mode: SyncMode = 'cloudflare', patch: Partial<AppData> = {}): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [provider()],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: mode !== 'local',
      encryptionEnabled: true,
      lastSyncAt: 1,
      mode,
      workerEndpoint: mode === 'cloudflare' ? 'https://sync.example.dev' : undefined,
    },
    updatedAt: 10,
    ...patch,
  }
}

function withStreamingAssistant(data: AppData): AppData {
  return {
    ...data,
    conversations: [
      {
        createdAt: 1,
        id: 'conversation-streaming',
        messages: [
          {
            content: 'partial',
            createdAt: 1,
            id: 'assistant-streaming',
            role: 'assistant',
            status: 'streaming',
          },
        ],
        model: 'gpt-5',
        providerId: 'provider-1',
        title: 'Streaming',
        updatedAt: data.updatedAt + 1,
      },
    ],
    updatedAt: data.updatedAt + 1,
  }
}

function createHarness(options: {
  data?: AppData
  settingsOpen?: boolean
  settingsTab?: SyncRuntimeControllerContext['settingsTab']
} = {}) {
  const current = options.data ?? appData()
  const dataRef = { current }
  const githubTokenRef = { current: '' }
  const providerKeysRef = { current: { [current.providers[0]?.id ?? 'provider-1']: 'key' } }
  const syncPassphraseRef = { current: 'passphrase' }
  const passphraseRotationPendingRef = { current: false }
  const pendingSyncRef: SyncRuntimeControllerContext['pendingSyncRef'] = {
    current: null,
  }
  const syncingRef = { current: false }
  const syncService = {
    clearRemoteSyncData: vi.fn(),
    performSync: vi.fn(),
    pullRemoteChanges: vi.fn(),
  }
  const context: SyncRuntimeControllerContext = {
    clearScheduledSync: vi.fn(),
    dataRef,
    formatErrorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    githubTokenRef,
    localizeSyncMessage: (message) => `localized:${message}`,
    markSyncPassphraseSynced: vi.fn(),
    passphraseRotationPendingRef,
    pendingSyncRef,
    persistLocalSnapshot: vi.fn(async (snapshot) => snapshot),
    providerKeysRef,
    requestDangerConfirmation: vi.fn(async () => true),
    setData: vi.fn((next) => {
      dataRef.current = next
    }),
    setNotice: vi.fn(),
    setProviderKeys: vi.fn(),
    setSettingsOpen: vi.fn(),
    setSettingsTab: vi.fn(),
    setSyncFirstConflictPrompt: vi.fn((prompt) => {
      context.syncFirstConflictPrompt = prompt
    }),
    setSyncing: vi.fn(),
    settingsOpen: options.settingsOpen ?? false,
    settingsTab: options.settingsTab ?? 'providers',
    syncFirstConflictPrompt: null,
    syncingRef,
    syncPassphraseRef,
    t,
  }
  const commitProviderSecretSnapshotWithAppData = vi.fn(
    async (
      _previousKeys: Record<string, string>,
      _nextKeys: Record<string, string>,
      target: AppData,
      persist: (snapshot: AppData) => Promise<AppData>,
    ) => persist(target),
  )
  const services: SyncRuntimeControllerServices = {
    clearSkillChunkContents: vi.fn(async () => undefined),
    commitProviderSecretSnapshotWithAppData,
    deleteSkillContentRefs: vi.fn(async () => undefined),
    loadSyncService: vi.fn(async () => syncService),
    materializeAppDataSkillContents: vi.fn(async (value) => value),
    persistExternalAppDataSkillContents: vi.fn(async (value) => value),
    postWindowsSyncStatus: vi.fn(),
    pruneProviderSecrets: vi.fn((secrets) => secrets),
    sanitizeRemoteOnlyAppData: vi.fn((value) => ({
      changed: false,
      data: value,
      removedProviderIds: [],
    })),
    setTimeout: vi.fn((callback) => {
      callback()
      return 1
    }),
  }

  return {
    actions: createSyncRuntimeControllerActions(context, services),
    context,
    dataRef,
    services,
    syncService,
  }
}

describe('sync runtime controller', () => {
  it('cancels active and queued sync ownership immediately', async () => {
    const harness = createHarness()
    harness.context.syncingRef.current = true
    harness.context.pendingSyncRef.current = {
      snapshot: appData(),
      options: { silent: true },
    }

    await harness.actions.cancelSyncRuntime()

    expect(harness.context.syncingRef.current).toBe(false)
    expect(harness.context.pendingSyncRef.current).toBeNull()
    expect(harness.context.clearScheduledSync).toHaveBeenCalledTimes(1)
    expect(harness.context.setSyncing).toHaveBeenCalledWith(false)
  })

  it('warns about missing sync configuration without blocking local saves on the sync tab', () => {
    const gistData = appData('gist', {
      sync: {
        autoSync: true,
        encryptionEnabled: true,
        lastSyncAt: 1,
        mode: 'gist',
      },
      updatedAt: 20,
    })
    const harness = createHarness({ data: gistData })

    expect(harness.actions.warnSyncConfigLocalSaved(gistData)).toBe(true)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConfigErrorLocalSaved:sync.requirement.githubToken',
      'error',
      'sync',
    )

    const quietHarness = createHarness({
      data: gistData,
      settingsOpen: true,
      settingsTab: 'sync',
    })

    expect(quietHarness.actions.warnSyncConfigLocalSaved(gistData)).toBe(true)
    expect(quietHarness.context.setNotice).not.toHaveBeenCalled()
  })

  it('persists the local baseline before any remote sync work', async () => {
    const current = appData('cloudflare')
    const remote = appData('cloudflare', { updatedAt: 30 })
    const harness = createHarness({ data: current })
    const order: string[] = []
    harness.context.persistLocalSnapshot = vi.fn(async (snapshot) => {
      order.push(snapshot === current ? 'persist-current' : 'persist-result')
      return snapshot
    })
    harness.services.materializeAppDataSkillContents = vi.fn(async (value) => {
      order.push('materialize')
      return value
    })
    harness.services.loadSyncService = vi.fn(async () => {
      order.push('load-service')
      return harness.syncService
    })
    harness.syncService.performSync.mockImplementation(async () => {
      order.push('remote-sync')
      return {
        data: remote,
        message: 'remote accepted',
        remoteAccepted: true,
      }
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current, { silent: true })

    expect(order.slice(0, 4)).toEqual([
      'persist-current',
      'materialize',
      'load-service',
      'remote-sync',
    ])
  })

  it('does not contact the remote when local baseline persistence fails', async () => {
    const current = appData('cloudflare')
    const writeError = new Error('AppData storage blocked')
    const harness = createHarness({ data: current })
    harness.context.persistLocalSnapshot = vi.fn(async () => {
      throw writeError
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current)

    expect(harness.services.materializeAppDataSkillContents).not.toHaveBeenCalled()
    expect(harness.services.loadSyncService).not.toHaveBeenCalled()
    expect(harness.syncService.performSync).not.toHaveBeenCalled()
    expect(harness.syncService.pullRemoteChanges).not.toHaveBeenCalled()
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.markSyncPassphraseSynced).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConfigErrorLocalSaved:AppData storage blocked',
      'error',
      'sync',
    )
    expect(harness.services.postWindowsSyncStatus).toHaveBeenCalledWith(
      'failed',
      'notice.syncConfigErrorLocalSaved:AppData storage blocked',
    )
  })

  it('requeues the latest owner when local baseline persistence loses ownership', async () => {
    const current = appData('cloudflare')
    const latest = appData('cloudflare', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    const scheduled: Array<() => void> = []
    harness.context.persistLocalSnapshot = vi.fn(async (snapshot) => {
      if (snapshot === current) {
        harness.dataRef.current = latest
      }
      return snapshot
    })
    harness.services.setTimeout = vi.fn((callback) => {
      scheduled.push(callback)
      return 1
    })
    harness.syncService.performSync.mockResolvedValue({
      data: latest,
      message: 'latest accepted',
      remoteAccepted: true,
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current, { silent: true })

    expect(harness.services.materializeAppDataSkillContents).not.toHaveBeenCalled()
    expect(harness.services.loadSyncService).not.toHaveBeenCalled()
    expect(harness.syncService.performSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1)

    scheduled.shift()?.()
    await vi.waitFor(() =>
      expect(harness.syncService.performSync).toHaveBeenCalledTimes(1),
    )
    expect(harness.syncService.performSync).toHaveBeenCalledWith(
      latest,
      expect.objectContaining({ firstSyncStrategy: 'ask' }),
    )
  })

  it('runs remote-accepted sync, persists materialized data, applies secrets, and reports Windows status', async () => {
    const current = appData('cloudflare', {
      skills: [skill('local-skill', 'skill-chunk:local-skill:chunk-1')],
    })
    const remote = appData('cloudflare', {
      providers: [provider('provider-1')],
      skills: [skill('remote-skill', 'skill-chunk:remote-skill:chunk-1')],
      updatedAt: 30,
    })
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
      secrets: {
        providerKeys: {
          'provider-1': 'remote-key',
          stale: 'stale-key',
        },
      },
    })
    harness.services.sanitizeRemoteOnlyAppData = vi.fn(() => ({
      changed: false,
      data: remote,
      removedProviderIds: ['removed-provider'],
    }))
    harness.services.pruneProviderSecrets = vi.fn(() => ({
      providerKeys: {
        'provider-1': 'remote-key',
      },
    }))
    harness.context.providerKeysRef.current = {
      'provider-1': 'key',
      'removed-provider': 'removed-key',
    }
    let releaseAtomicCommit = (): void => undefined
    harness.services.commitProviderSecretSnapshotWithAppData = vi.fn(
      async (_previousKeys, _nextKeys, target, persist) => {
        const persisted = await persist(target)
        await new Promise<void>((resolve) => {
          releaseAtomicCommit = resolve
        })
        return persisted
      },
    )
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    const syncRun = harness.actions.runSync(current, { silent: true })
    await vi.waitFor(() =>
      expect(
        harness.services.commitProviderSecretSnapshotWithAppData,
      ).toHaveBeenCalledTimes(1),
    )
    await vi.waitFor(() =>
      expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(remote),
    )
    expect(harness.context.setProviderKeys).not.toHaveBeenCalled()
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.providerKeysRef.current).toEqual({
      'provider-1': 'key',
      'removed-provider': 'removed-key',
    })

    releaseAtomicCommit()
    await syncRun

    expect(harness.context.clearScheduledSync).toHaveBeenCalledTimes(1)
    expect(harness.context.setSyncing).toHaveBeenNthCalledWith(1, true)
    expect(harness.context.setSyncing).toHaveBeenLastCalledWith(false)
    expect(harness.services.materializeAppDataSkillContents).toHaveBeenCalledWith(
      current,
    )
    expect(harness.syncService.performSync).toHaveBeenCalledWith(
      current,
      expect.objectContaining({
        encryptionPassphrase: 'passphrase',
        firstSyncStrategy: 'ask',
        providerKeys: {
          'provider-1': 'key',
          'removed-provider': 'removed-key',
        },
      }),
    )
    expect(harness.services.clearSkillChunkContents).not.toHaveBeenCalled()
    expect(harness.services.persistExternalAppDataSkillContents).toHaveBeenCalledWith(remote)
    expect(harness.context.persistLocalSnapshot).toHaveBeenNthCalledWith(1, current)
    expect(harness.context.persistLocalSnapshot).toHaveBeenNthCalledWith(2, remote)
    expect(harness.context.setData).toHaveBeenCalledWith(remote)
    expect(
      vi.mocked(harness.context.persistLocalSnapshot).mock.invocationCallOrder[1],
    ).toBeLessThan(
      vi.mocked(harness.context.setData).mock.invocationCallOrder[0],
    )
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:local-skill:chunk-1',
    ])
    expect(
      harness.services.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalledWith(
      {
        'provider-1': 'key',
        'removed-provider': 'removed-key',
      },
      { 'provider-1': 'remote-key' },
      remote,
      expect.any(Function),
    )
    expect(harness.context.setProviderKeys).toHaveBeenCalledWith({
      'provider-1': 'remote-key',
    })
    expect(
      vi.mocked(harness.context.setProviderKeys).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(harness.context.setData).mock.invocationCallOrder[0],
    )
    expect(harness.context.markSyncPassphraseSynced).toHaveBeenCalledTimes(1)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'localized:remote accepted',
      undefined,
      'sync',
    )
    expect(harness.services.postWindowsSyncStatus).toHaveBeenCalledWith(
      'complete',
      'localized:remote accepted',
    )
  })

  it('contains sync success notice reporter failures after publish', async () => {
    const current = appData('cloudflare')
    const remote = appData('cloudflare', { updatedAt: 30 })
    const harness = createHarness({ data: current })
    harness.context.setNotice = vi.fn((message) => {
      if (message === 'localized:remote accepted') {
        throw new Error('notice unavailable')
      }
    })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await expect(
      harness.actions.runSync(current, { silent: true }),
    ).resolves.toBeUndefined()

    expect(harness.context.setData).toHaveBeenCalledWith(remote)
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(remote)
    expect(harness.context.markSyncPassphraseSynced).toHaveBeenCalledTimes(1)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'localized:remote accepted',
      undefined,
      'sync',
    )
    expect(harness.services.postWindowsSyncStatus).toHaveBeenCalledWith(
      'complete',
      'localized:remote accepted',
    )
    expect(harness.services.postWindowsSyncStatus).not.toHaveBeenCalledWith(
      'failed',
      expect.any(String),
    )
  })

  it('keeps published sync complete when stale Skill cleanup fails after publish', async () => {
    const current = appData('cloudflare', {
      skills: [skill('local-skill', 'skill-chunk:local-skill:chunk-1')],
    })
    const remote = appData('cloudflare', {
      providers: [provider('provider-1')],
      skills: [skill('remote-skill', 'skill-chunk:remote-skill:chunk-1')],
      updatedAt: 30,
    })
    const cleanupError = new Error('stale cleanup blocked')
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
    })
    harness.services.deleteSkillContentRefs = vi.fn(async (refs) => {
      if (refs.includes('skill-chunk:local-skill:chunk-1')) {
        throw cleanupError
      }
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current, { silent: true })
    await vi.waitFor(() =>
      expect(harness.context.setNotice).toHaveBeenCalledWith(
        'stale cleanup blocked',
        'error',
        'sync',
      ),
    )

    expect(harness.context.setData).toHaveBeenCalledWith(remote)
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(remote)
    expect(harness.context.markSyncPassphraseSynced).toHaveBeenCalledTimes(1)
    expect(harness.services.postWindowsSyncStatus).toHaveBeenCalledWith(
      'complete',
      'localized:remote accepted',
    )
    expect(harness.services.postWindowsSyncStatus).not.toHaveBeenCalledWith(
      'failed',
      expect.any(String),
    )
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:local-skill:chunk-1',
    ])
  })

  it('contains published sync stale Skill cleanup reporter failures', async () => {
    const current = appData('cloudflare', {
      skills: [skill('local-skill', 'skill-chunk:local-skill:chunk-1')],
    })
    const remote = appData('cloudflare', {
      providers: [provider('provider-1')],
      skills: [skill('remote-skill', 'skill-chunk:remote-skill:chunk-1')],
      updatedAt: 30,
    })
    const cleanupError = new Error('stale cleanup blocked')
    const harness = createHarness({ data: current })
    harness.context.setNotice = vi.fn((_message, tone) => {
      if (tone === 'error') {
        throw new Error('notice unavailable')
      }
    })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
    })
    harness.services.deleteSkillContentRefs = vi.fn(async (refs) => {
      if (refs.includes('skill-chunk:local-skill:chunk-1')) {
        throw cleanupError
      }
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await expect(
      harness.actions.runSync(current, { silent: true }),
    ).resolves.toBeUndefined()
    await vi.waitFor(() =>
      expect(harness.context.setNotice).toHaveBeenCalledWith(
        'stale cleanup blocked',
        'error',
        'sync',
      ),
    )

    expect(harness.context.setData).toHaveBeenCalledWith(remote)
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(remote)
    expect(harness.context.markSyncPassphraseSynced).toHaveBeenCalledTimes(1)
    expect(harness.services.postWindowsSyncStatus).toHaveBeenCalledWith(
      'complete',
      'localized:remote accepted',
    )
    expect(harness.services.postWindowsSyncStatus).not.toHaveBeenCalledWith(
      'failed',
      expect.any(String),
    )
  })

  it('keeps the provider secret snapshot unchanged when atomic sync staging fails', async () => {
    const current = appData('cloudflare', {
      skills: [skill('local-skill', 'skill-chunk:local-skill:chunk-1')],
    })
    const remote = appData('cloudflare', {
      providers: [provider('provider-1')],
      skills: [skill('remote-skill', 'skill-chunk:remote-skill:chunk-1')],
      updatedAt: 30,
    })
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
      secrets: {
        providerKeys: {
          'provider-1': 'remote-key',
        },
      },
    })
    harness.services.sanitizeRemoteOnlyAppData = vi.fn(() => ({
      changed: true,
      data: remote,
      removedProviderIds: ['removed-provider'],
    }))
    harness.services.commitProviderSecretSnapshotWithAppData = vi.fn(
      async () => {
        throw new Error('secret cleanup blocked')
      },
    )
    harness.context.providerKeysRef.current = {
      'provider-1': 'key',
    }
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current)

    expect(harness.services.persistExternalAppDataSkillContents).toHaveBeenCalledWith(remote)
    expect(
      harness.services.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalledWith(
      { 'provider-1': 'key' },
      { 'provider-1': 'remote-key' },
      remote,
      expect.any(Function),
    )
    expect(harness.services.clearSkillChunkContents).not.toHaveBeenCalled()
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:remote-skill:chunk-1',
    ])
    expect(harness.services.deleteSkillContentRefs).not.toHaveBeenCalledWith([
      'skill-chunk:local-skill:chunk-1',
    ])
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(current)
    expect(harness.context.persistLocalSnapshot).not.toHaveBeenCalledWith(remote)
    expect(harness.dataRef.current).toBe(current)
    expect(harness.context.setProviderKeys).not.toHaveBeenCalled()
    expect(harness.context.providerKeysRef.current).toEqual({
      'provider-1': 'key',
    })
    expect(harness.context.markSyncPassphraseSynced).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConfigErrorLocalSaved:secret cleanup blocked',
      'error',
      'sync',
    )
    expect(harness.services.postWindowsSyncStatus).toHaveBeenCalledWith(
      'failed',
      'notice.syncConfigErrorLocalSaved:secret cleanup blocked',
    )
  })

  it('contains sync failure notice reporter failures without rejecting the runner', async () => {
    const current = appData('cloudflare')
    const harness = createHarness({ data: current })
    harness.context.setNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })
    harness.syncService.performSync.mockRejectedValue(new Error('remote down'))
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await expect(harness.actions.runSync(current)).resolves.toBeUndefined()

    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledTimes(1)
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(current)
    expect(harness.context.setSyncing).toHaveBeenLastCalledWith(false)
    expect(harness.context.setNotice).toHaveBeenCalledWith('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConfigErrorLocalSaved:remote down',
      'error',
      'sync',
    )
    expect(harness.services.postWindowsSyncStatus).toHaveBeenCalledWith(
      'failed',
      'notice.syncConfigErrorLocalSaved:remote down',
    )
  })

  it('keeps secrets unpublished and cleans Skill refs when the atomic AppData commit fails', async () => {
    const current = appData('cloudflare', {
      skills: [skill('local-skill', 'skill-chunk:local-skill:chunk-1')],
    })
    const remote = appData('cloudflare', {
      skills: [skill('remote-skill', 'skill-chunk:remote-skill:chunk-1')],
      updatedAt: 30,
    })
    const writeError = new Error('AppData storage blocked')
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
      secrets: {
        providerKeys: {
          'provider-1': 'remote-key',
        },
      },
    })
    harness.context.persistLocalSnapshot = vi.fn(async (snapshot) => {
      if (snapshot === remote) {
        throw writeError
      }
      return snapshot
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current)

    expect(harness.context.persistLocalSnapshot).toHaveBeenNthCalledWith(1, current)
    expect(harness.context.persistLocalSnapshot).toHaveBeenNthCalledWith(2, remote)
    expect(
      harness.services.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalledWith(
      { 'provider-1': 'key' },
      { 'provider-1': 'remote-key' },
      remote,
      expect.any(Function),
    )
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:remote-skill:chunk-1',
    ])
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.dataRef.current).toBe(current)
    expect(harness.context.providerKeysRef.current).toEqual({
      'provider-1': 'key',
    })
    expect(harness.context.markSyncPassphraseSynced).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConfigErrorLocalSaved:AppData storage blocked',
      'error',
      'sync',
    )
  })

  it('keeps newer local AppData and leaves secrets unpublished when atomic persistence loses ownership', async () => {
    const current = appData('cloudflare', {
      skills: [skill('local-skill', 'skill-chunk:local-skill:chunk-1')],
    })
    const latest = appData('cloudflare', {
      skills: [skill('latest-skill', 'skill-chunk:latest-skill:chunk-1')],
      updatedAt: 40,
    })
    const remote = appData('cloudflare', {
      skills: [skill('remote-skill', 'skill-chunk:remote-skill:chunk-1')],
      updatedAt: 30,
    })
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
      secrets: {
        providerKeys: {
          'provider-1': 'remote-key',
        },
      },
    })
    harness.context.persistLocalSnapshot = vi.fn(async (snapshot) => {
      if (snapshot === remote) {
        harness.dataRef.current = latest
      }
      return snapshot
    })
    harness.services.setTimeout = vi.fn(() => 1)
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current, { silent: true })

    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(latest)
    expect(
      harness.services.commitProviderSecretSnapshotWithAppData,
    ).toHaveBeenCalledWith(
      { 'provider-1': 'key' },
      { 'provider-1': 'remote-key' },
      remote,
      expect.any(Function),
    )
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:remote-skill:chunk-1',
    ])
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.dataRef.current).toBe(latest)
    expect(harness.context.providerKeysRef.current).toEqual({
      'provider-1': 'key',
    })
    expect(harness.context.markSyncPassphraseSynced).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConflictLocalKept',
      'warning',
      'sync',
    )
    expect(harness.services.setTimeout).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite a provider key edited while the synced secret snapshot is persisting', async () => {
    const current = appData('cloudflare')
    const remote = appData('cloudflare', { updatedAt: 30 })
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
      secrets: {
        providerKeys: {
          'provider-1': 'remote-key',
        },
      },
    })
    harness.services.commitProviderSecretSnapshotWithAppData = vi.fn(
      async (_previousKeys, _nextKeys, target, persist) => {
        harness.context.providerKeysRef.current = {
          'provider-1': 'newer-local-key',
        }
        return persist(target)
      },
    )
    harness.services.setTimeout = vi.fn(() => 1)
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current, { silent: true })

    expect(harness.context.providerKeysRef.current).toEqual({
      'provider-1': 'newer-local-key',
    })
    expect(harness.context.setProviderKeys).not.toHaveBeenCalled()
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConflictLocalKept',
      'warning',
      'sync',
    )
  })

  it('does not publish a stale sync result after AppData commits while the secret journal is completing', async () => {
    const current = appData('cloudflare')
    const latest = appData('cloudflare', {
      preferences: {
        ...current.preferences,
        compactMode: true,
      },
      updatedAt: 40,
    })
    const remote = appData('cloudflare', { updatedAt: 30 })
    const newerProviderKeys = {
      'provider-1': 'newer-local-key',
    }
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
      secrets: {
        providerKeys: {
          'provider-1': 'remote-key',
        },
      },
    })
    harness.services.commitProviderSecretSnapshotWithAppData = vi.fn(
      async (_previousKeys, _nextKeys, target, persist) => {
        const persisted = await persist(target)
        harness.dataRef.current = latest
        harness.context.providerKeysRef.current = newerProviderKeys
        return persisted
      },
    )
    harness.services.setTimeout = vi.fn(() => 1)
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current, { silent: true })

    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(latest)
    expect(harness.context.providerKeysRef.current).toBe(newerProviderKeys)
    expect(harness.context.setProviderKeys).not.toHaveBeenCalled()
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.dataRef.current).toBe(latest)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConflictLocalKept',
      'warning',
      'sync',
    )
  })

  it('does not delete a newly persisted Skill ref adopted by newer local data', async () => {
    const current = appData('cloudflare')
    const remoteSkill = skill('shared-skill', 'skill-chunk:shared-skill:chunk-1')
    const latest = appData('cloudflare', {
      skills: [remoteSkill],
      updatedAt: 40,
    })
    const remote = appData('cloudflare', {
      skills: [remoteSkill],
      updatedAt: 30,
    })
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
    })
    harness.context.persistLocalSnapshot = vi.fn(async (snapshot) => {
      if (snapshot === remote) {
        harness.dataRef.current = latest
      }
      return snapshot
    })
    harness.services.setTimeout = vi.fn(() => 1)
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current, { silent: true })

    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(latest)
    expect(harness.services.deleteSkillContentRefs).not.toHaveBeenCalledWith([
      'skill-chunk:shared-skill:chunk-1',
    ])
    expect(harness.dataRef.current).toBe(latest)
  })

  it('keeps the original sync failure when unpublished Skill ref cleanup fails', async () => {
    const current = appData('cloudflare', {
      skills: [skill('local-skill', 'skill-chunk:local-skill:chunk-1')],
    })
    const remote = appData('cloudflare', {
      providers: [provider('provider-1')],
      skills: [skill('remote-skill', 'skill-chunk:remote-skill:chunk-1')],
      updatedAt: 30,
    })
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: remote,
      message: 'remote accepted',
      remoteAccepted: true,
      secrets: {
        providerKeys: {
          'provider-1': 'remote-key',
        },
      },
    })
    harness.services.commitProviderSecretSnapshotWithAppData = vi.fn(
      async () => {
        throw new Error('secret storage blocked')
      },
    )
    harness.services.deleteSkillContentRefs = vi.fn(async () => {
      throw new Error('cleanup blocked')
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current)

    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-chunk:remote-skill:chunk-1',
    ])
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(current)
    expect(harness.context.persistLocalSnapshot).not.toHaveBeenCalledWith(remote)
    expect(harness.dataRef.current).toBe(current)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConfigErrorLocalSaved:secret storage blocked',
      'error',
      'sync',
    )
    expect(harness.services.postWindowsSyncStatus).toHaveBeenCalledWith(
      'failed',
      'notice.syncConfigErrorLocalSaved:secret storage blocked',
    )
  })

  it('queues a pending sync instead of starting another run while syncing', async () => {
    const current = appData('cloudflare')
    const harness = createHarness({ data: current })
    harness.context.syncingRef.current = true

    await harness.actions.runSync(current, { pullOnly: true, silent: false })

    expect(harness.context.pendingSyncRef.current).toEqual({
      snapshot: current,
      options: {
        firstSyncStrategy: undefined,
        pullOnly: true,
        silent: false,
      },
    })
    expect(harness.services.loadSyncService).not.toHaveBeenCalled()
    expect(harness.context.setSyncing).not.toHaveBeenCalled()
  })

  it('does not queue silent remote uploads while a generation is pending', async () => {
    const streaming = withStreamingAssistant(appData('cloudflare'))
    const harness = createHarness({ data: streaming })
    harness.context.syncingRef.current = true

    await harness.actions.runSync(streaming, { silent: true })

    expect(harness.context.pendingSyncRef.current).toBeNull()
    expect(harness.services.loadSyncService).not.toHaveBeenCalled()
    expect(harness.context.setSyncing).not.toHaveBeenCalled()
  })

  it('silently defers an automatic remote write when generation starts mid-sync', async () => {
    const current = appData('cloudflare')
    const streaming = withStreamingAssistant(current)
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockImplementation(async (_data, syncContext) => {
      harness.dataRef.current = streaming
      expect(syncContext.shouldDeferRemoteWrite?.()).toBe(true)
      throw new SyncRemoteWriteDeferredError()
    })

    await harness.actions.runSync(current, { silent: true })

    expect(harness.syncService.performSync).toHaveBeenCalledTimes(1)
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.setNotice).not.toHaveBeenCalled()
    expect(harness.context.markSyncPassphraseSynced).not.toHaveBeenCalled()
    expect(harness.services.postWindowsSyncStatus).not.toHaveBeenCalled()
    expect(harness.context.setSyncing).toHaveBeenLastCalledWith(false)
  })

  it('durably persists sync identifiers before publishing newer local data', async () => {
    const current = appData('cloudflare')
    const latest = appData('cloudflare', { updatedAt: 40 })
    const remote = appData('cloudflare', {
      sync: {
        ...current.sync,
        lastSyncAt: 30,
      },
      updatedAt: 30,
    })
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockImplementation(async () => {
      harness.dataRef.current = latest
      return {
        data: remote,
        message: 'local changed',
        remoteAccepted: false,
      }
    })

    await harness.actions.runSync(current, { silent: true })

    expect(harness.context.setData).toHaveBeenCalledTimes(1)
    const merged = vi.mocked(harness.context.setData).mock.calls[0]?.[0]
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(merged)
    expect(
      vi.mocked(harness.context.persistLocalSnapshot).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(harness.context.setData).mock.invocationCallOrder[0],
    )
    expect(harness.context.markSyncPassphraseSynced).not.toHaveBeenCalled()
  })

  it('revalidates local ownership after final persistence and durably publishes the latest identifier merge', async () => {
    const current = appData('cloudflare')
    const latest = appData('cloudflare', {
      preferences: {
        ...appData().preferences,
        compactMode: true,
      },
      updatedAt: 40,
    })
    const synced = appData('cloudflare', {
      sync: {
        ...current.sync,
        workerEndpoint: 'https://new-sync.example.dev',
      },
      updatedAt: 30,
    })
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockResolvedValue({
      data: synced,
      message: 'local accepted',
      remoteAccepted: false,
    })
    harness.context.persistLocalSnapshot = vi.fn(async (snapshot) => {
      if (snapshot === synced) {
        harness.dataRef.current = latest
      }
      return snapshot
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.runSync(current, { silent: true })

    const merged = vi.mocked(harness.context.setData).mock.calls[0]?.[0]
    expect(merged).toMatchObject({
      preferences: expect.objectContaining({ compactMode: true }),
      updatedAt: 40,
      sync: expect.objectContaining({
        workerEndpoint: 'https://new-sync.example.dev',
      }),
    })
    expect(harness.context.persistLocalSnapshot).toHaveBeenNthCalledWith(1, current)
    expect(harness.context.persistLocalSnapshot).toHaveBeenNthCalledWith(2, synced)
    expect(harness.context.persistLocalSnapshot).toHaveBeenNthCalledWith(3, merged)
    expect(harness.context.markSyncPassphraseSynced).not.toHaveBeenCalled()
  })

  it('queues the latest local snapshot after remote accepts an older in-flight sync', async () => {
    const current = appData('cloudflare')
    const latest = appData('cloudflare', { updatedAt: 40 })
    const remoteAcceptedOld = appData('cloudflare', { updatedAt: 30 })
    const harness = createHarness({ data: current })
    harness.syncService.performSync
      .mockImplementationOnce(async () => {
        harness.dataRef.current = latest
        return {
          data: remoteAcceptedOld,
          message: 'old accepted',
          remoteAccepted: true,
        }
      })
      .mockResolvedValueOnce({
        data: latest,
        message: 'latest accepted',
        remoteAccepted: true,
      })

    await harness.actions.runSync(current, { silent: true })

    await vi.waitFor(() =>
      expect(harness.syncService.performSync).toHaveBeenCalledTimes(2),
    )
    expect(harness.syncService.performSync).toHaveBeenNthCalledWith(
      2,
      latest,
      expect.objectContaining({
        firstSyncStrategy: 'ask',
      }),
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConflictLocalKept',
      'warning',
      'sync',
    )
    expect(harness.context.pendingSyncRef.current).toBeNull()
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(latest)
  })

  it('drains pending sync with the latest dataRef snapshot', async () => {
    const current = appData('cloudflare')
    const published = appData('cloudflare', { updatedAt: 30 })
    const olderPending = appData('cloudflare', { updatedAt: 40 })
    const latest = appData('cloudflare', { updatedAt: 50 })
    const harness = createHarness({ data: current })
    const setData = harness.context.setData
    harness.context.setData = vi.fn((next) => {
      setData(next)

      if (next === published) {
        harness.context.pendingSyncRef.current = {
          options: { silent: true },
          snapshot: olderPending,
        }
        harness.dataRef.current = latest
      }
    })
    harness.syncService.performSync
      .mockResolvedValueOnce({
        data: published,
        message: 'published',
        remoteAccepted: true,
      })
      .mockResolvedValueOnce({
        data: latest,
        message: 'latest accepted',
        remoteAccepted: true,
      })

    await harness.actions.runSync(current, { silent: true })

    await vi.waitFor(() =>
      expect(harness.syncService.performSync).toHaveBeenCalledTimes(2),
    )
    expect(harness.syncService.performSync).toHaveBeenNthCalledWith(
      2,
      latest,
      expect.objectContaining({
        firstSyncStrategy: 'ask',
      }),
    )
    expect(harness.syncService.performSync).not.toHaveBeenNthCalledWith(
      2,
      olderPending,
      expect.anything(),
    )
    expect(harness.context.pendingSyncRef.current).toBeNull()
  })

  it('drops stale sync completion and pending drain after lifecycle disposal', async () => {
    const current = appData('cloudflare')
    const remote = appData('cloudflare', { updatedAt: 40 })
    let resolveSync!: (result: SyncResult) => void
    let activeSignal: AbortSignal | undefined
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockImplementation(
      (_data, syncContext) => {
        activeSignal = syncContext.signal
        return new Promise<SyncResult>((resolve) => {
          resolveSync = resolve
        })
      },
    )

    const running = harness.actions.runSync(current, { silent: true })
    await vi.waitFor(() =>
      expect(harness.syncService.performSync).toHaveBeenCalledTimes(1),
    )

    harness.context.pendingSyncRef.current = {
      snapshot: remote,
      options: { silent: true },
    }
    const cancellation = harness.actions.cancelSyncRuntime()
    expect(activeSignal?.aborted).toBe(true)
    resolveSync({
      data: remote,
      message: 'remote complete',
      remoteAccepted: true,
    })
    await Promise.all([running, cancellation])

    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledTimes(1)
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(current)
    expect(harness.context.setNotice).not.toHaveBeenCalled()
    expect(harness.context.setSyncing).toHaveBeenCalledTimes(2)
    expect(harness.context.setSyncing).toHaveBeenNthCalledWith(1, true)
    expect(harness.context.setSyncing).toHaveBeenNthCalledWith(2, false)
    expect(harness.services.setTimeout).not.toHaveBeenCalled()
    expect(harness.context.pendingSyncRef.current).toBeNull()
  })

  it('aborts the active sync transport before waiting for its drain', async () => {
    const current = appData('cloudflare')
    const harness = createHarness({ data: current })
    let activeSignal: AbortSignal | undefined
    harness.syncService.performSync.mockImplementation(
      (_data, syncContext) => {
        activeSignal = syncContext.signal
        return new Promise<SyncResult>((_resolve, reject) => {
          syncContext.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        })
      },
    )

    const running = harness.actions.runSync(current, { silent: true })
    await vi.waitFor(() =>
      expect(harness.syncService.performSync).toHaveBeenCalledTimes(1),
    )

    await Promise.all([running, harness.actions.cancelSyncRuntime()])

    expect(activeSignal?.aborted).toBe(true)
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.setNotice).not.toHaveBeenCalled()
  })

  it('cancels an in-flight sync through a newly-created action set', async () => {
    const current = appData('cloudflare')
    const harness = createHarness({ data: current })
    const runtime = createSyncRuntimeControllerRuntime()
    let activeSignal: AbortSignal | undefined
    let resolveSync!: (result: SyncResult) => void
    harness.syncService.performSync.mockImplementation(
      (_data, syncContext) => {
        activeSignal = syncContext.signal
        return new Promise<SyncResult>((resolve) => {
          resolveSync = resolve
        })
      },
    )
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
      runtime,
    )

    const running = harness.actions.runSync(current, { silent: true })
    await vi.waitFor(() =>
      expect(harness.syncService.performSync).toHaveBeenCalledTimes(1),
    )

    const replacementActions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
      runtime,
    )
    let cancellationSettled = false
    const cancellation = replacementActions.cancelSyncRuntime().then(() => {
      cancellationSettled = true
    })

    expect(activeSignal?.aborted).toBe(true)
    await Promise.resolve()
    expect(cancellationSettled).toBe(false)

    resolveSync({
      data: current,
      message: 'cancelled',
      remoteAccepted: false,
    })
    await Promise.all([running, cancellation])

    expect(cancellationSettled).toBe(true)
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.setSyncing).toHaveBeenLastCalledWith(false)
  })

  it('opens the first-sync conflict prompt instead of overwriting remote data', async () => {
    const current = appData('cloudflare')
    const harness = createHarness({ data: current })
    harness.syncService.performSync.mockRejectedValue(
      new Error('error.syncFirstSyncConflict'),
    )

    await harness.actions.runSync(current)

    expect(harness.context.setSyncFirstConflictPrompt).toHaveBeenCalledWith({
      snapshot: current,
      options: {
        silent: false,
      },
    })
    expect(harness.context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('sync')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncFirstConflict',
      'warning',
      'sync',
    )
    expect(harness.services.postWindowsSyncStatus).not.toHaveBeenCalledWith(
      'failed',
      expect.any(String),
    )
  })

  it('resolves first-sync conflicts against the latest local snapshot', async () => {
    const prompted = appData('cloudflare', { updatedAt: 10 })
    const latest = appData('cloudflare', { updatedAt: 20 })
    const harness = createHarness({ data: prompted })
    harness.context.syncFirstConflictPrompt = {
      options: { silent: true },
      snapshot: prompted,
    }
    harness.dataRef.current = latest
    harness.syncService.performSync.mockResolvedValue({
      data: latest,
      message: 'merged',
      remoteAccepted: false,
    })

    harness.actions.resolveFirstSyncConflict('merge')

    await vi.waitFor(() =>
      expect(harness.syncService.performSync).toHaveBeenCalledWith(
        latest,
        expect.objectContaining({
          firstSyncStrategy: 'merge',
        }),
      ),
    )
    expect(harness.context.setSyncFirstConflictPrompt).toHaveBeenCalledWith(null)
    expect(harness.context.setNotice).toHaveBeenCalledWith('')
  })

  it('blocks clear-cloud before confirmation in local mode or during active sync', async () => {
    const localHarness = createHarness({ data: appData('local') })

    await localHarness.actions.clearCloudData()

    expect(localHarness.context.setNotice).toHaveBeenCalledWith(
      'notice.clearCloudLocalMode',
      'warning',
      'data-cloud',
    )
    expect(localHarness.context.requestDangerConfirmation).not.toHaveBeenCalled()
    expect(localHarness.services.loadSyncService).not.toHaveBeenCalled()

    const syncingHarness = createHarness({ data: appData('cloudflare') })
    syncingHarness.context.syncingRef.current = true

    await syncingHarness.actions.clearCloudData()

    expect(syncingHarness.context.setNotice).toHaveBeenCalledWith(
      'notice.clearCloudWaitForSync',
      'warning',
      'data-cloud',
    )
    expect(syncingHarness.context.requestDangerConfirmation).not.toHaveBeenCalled()
    expect(syncingHarness.services.loadSyncService).not.toHaveBeenCalled()
  })

  it('clears cloud data only after confirmation and reports failures in the Data panel', async () => {
    const current = appData('cloudflare')
    const cleared = appData('cloudflare', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    harness.syncService.clearRemoteSyncData.mockResolvedValue({
      data: cleared,
      message: 'cleared',
      remoteAccepted: false,
    })

    await harness.actions.clearCloudData()

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalledTimes(1)
    expect(harness.context.clearScheduledSync).toHaveBeenCalledTimes(1)
    expect(harness.syncService.clearRemoteSyncData).toHaveBeenCalledWith(
      current,
      expect.objectContaining({
        encryptionPassphrase: 'passphrase',
        providerKeys: {
          'provider-1': 'key',
        },
      }),
    )
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(cleared)
    expect(harness.context.setData).toHaveBeenCalledWith(cleared)
    expect(
      vi.mocked(harness.context.persistLocalSnapshot).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(harness.context.setData).mock.invocationCallOrder[0],
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'localized:cleared',
      'success',
      'data-cloud',
    )

    const failingHarness = createHarness({ data: current })
    failingHarness.syncService.clearRemoteSyncData.mockRejectedValue(
      new Error('remote boom'),
    )

    await failingHarness.actions.clearCloudData()

    expect(failingHarness.context.setNotice).toHaveBeenCalledWith(
      'notice.clearCloudFailed:remote boom',
      'error',
      'data-cloud',
    )
    expect(failingHarness.context.setSyncing).toHaveBeenLastCalledWith(false)
  })

  it('cancels and drains an auto-sync started while danger confirmation is open', async () => {
    const current = appData('cloudflare')
    const cleared = appData('cloudflare', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    let activeSignal: AbortSignal | undefined
    let resolveSync!: (result: SyncResult) => void
    let runningSync: Promise<void> | undefined

    harness.syncService.performSync.mockImplementation(
      (_data, syncContext) => {
        activeSignal = syncContext.signal
        return new Promise<SyncResult>((resolve) => {
          resolveSync = resolve
        })
      },
    )
    harness.context.requestDangerConfirmation = vi.fn(async () => {
      runningSync = harness.actions.runSync(current, { silent: true })
      await vi.waitFor(() =>
        expect(harness.syncService.performSync).toHaveBeenCalledTimes(1),
      )
      return true
    })
    harness.syncService.clearRemoteSyncData.mockResolvedValue({
      data: cleared,
      message: 'cleared',
      remoteAccepted: false,
    })

    const clearing = harness.actions.clearCloudData()
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    resolveSync({
      data: current,
      message: 'aborted',
      remoteAccepted: false,
    })
    await clearing
    await runningSync

    expect(activeSignal?.aborted).toBe(true)
    expect(harness.syncService.clearRemoteSyncData).toHaveBeenCalledWith(
      current,
      expect.any(Object),
    )
    expect(harness.context.setData).toHaveBeenCalledWith(cleared)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'localized:cleared',
      'success',
      'data-cloud',
    )
  })

  it('does not publish clear-cloud success when durable AppData commit fails', async () => {
    const current = appData('cloudflare')
    const cleared = appData('cloudflare', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    harness.syncService.clearRemoteSyncData.mockResolvedValue({
      data: cleared,
      message: 'cleared',
      remoteAccepted: false,
    })
    harness.context.persistLocalSnapshot = vi.fn(async () => {
      throw new Error('AppData storage blocked')
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.clearCloudData()

    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.dataRef.current).toBe(current)
    expect(harness.context.setNotice).not.toHaveBeenCalledWith(
      'localized:cleared',
      'success',
      'data-cloud',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.clearCloudFailed:AppData storage blocked',
      'error',
      'data-cloud',
    )
  })

  it('keeps and durably persists newer local data changed during clear-cloud commit', async () => {
    const current = appData('cloudflare')
    const latest = appData('cloudflare', {
      preferences: {
        ...current.preferences,
        compactMode: true,
      },
      updatedAt: 50,
    })
    const cleared = appData('cloudflare', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    harness.syncService.clearRemoteSyncData.mockResolvedValue({
      data: cleared,
      message: 'cleared',
      remoteAccepted: false,
    })
    harness.context.persistLocalSnapshot = vi.fn(async (snapshot) => {
      if (snapshot === cleared) {
        harness.dataRef.current = latest
      }
      return snapshot
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await harness.actions.clearCloudData()

    expect(harness.context.persistLocalSnapshot).toHaveBeenNthCalledWith(1, cleared)
    expect(harness.context.persistLocalSnapshot).toHaveBeenNthCalledWith(2, latest)
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.dataRef.current).toBe(latest)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'localized:cleared',
      'success',
      'data-cloud',
    )
  })

  it('waits for active clear-cloud ownership to drain before cancellation completes', async () => {
    const current = appData('cloudflare')
    const cleared = appData('cloudflare', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    let resolveClear!: (result: SyncResult) => void
    let activeSignal: AbortSignal | undefined
    harness.syncService.clearRemoteSyncData.mockImplementation(
      (_data, syncContext) => {
        activeSignal = syncContext.signal
        return new Promise<SyncResult>((resolve) => {
          resolveClear = resolve
        })
      },
    )

    const clearing = harness.actions.clearCloudData()
    await vi.waitFor(() =>
      expect(harness.syncService.clearRemoteSyncData).toHaveBeenCalledTimes(1),
    )
    let cancellationSettled = false
    const cancellation = harness.actions.cancelSyncRuntime().then(() => {
      cancellationSettled = true
    })
    await Promise.resolve()

    expect(activeSignal?.aborted).toBe(true)
    expect(cancellationSettled).toBe(false)
    resolveClear({
      data: cleared,
      message: 'cleared',
      remoteAccepted: false,
    })
    await Promise.all([clearing, cancellation])

    expect(cancellationSettled).toBe(true)
    expect(harness.context.persistLocalSnapshot).not.toHaveBeenCalled()
    expect(harness.context.setData).not.toHaveBeenCalled()
    expect(harness.context.setNotice).not.toHaveBeenCalledWith(
      'localized:cleared',
      'success',
      'data-cloud',
    )
  })

  it('clears the latest cloud snapshot after danger confirmation', async () => {
    const current = appData('cloudflare')
    const latest = appData('gist', { updatedAt: 25 })
    const cleared = appData('gist', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    vi.mocked(harness.context.requestDangerConfirmation).mockImplementationOnce(
      async () => {
        harness.context.dataRef.current = latest
        return true
      },
    )
    harness.syncService.clearRemoteSyncData.mockResolvedValue({
      data: cleared,
      message: 'cleared latest',
      remoteAccepted: false,
    })

    await harness.actions.clearCloudData()

    expect(harness.syncService.clearRemoteSyncData).toHaveBeenCalledWith(
      latest,
      expect.objectContaining({ firstSyncStrategy: 'ask' }),
    )
    expect(harness.context.setData).toHaveBeenCalledWith(cleared)
  })

  it('refreshes the cloud snapshot after lazy sync service loading', async () => {
    const current = appData('cloudflare')
    const latest = appData('gist', { updatedAt: 25 })
    const cleared = appData('gist', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    let resolveServiceLoad: (service: typeof harness.syncService) => void = () => {
      throw new Error('sync service load did not start')
    }

    vi.mocked(harness.services.loadSyncService).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveServiceLoad = resolve
        }),
    )
    harness.syncService.clearRemoteSyncData.mockResolvedValue({
      data: cleared,
      message: 'cleared latest',
      remoteAccepted: false,
    })

    const clearPromise = harness.actions.clearCloudData()
    await vi.waitFor(() => {
      expect(harness.services.loadSyncService).toHaveBeenCalledTimes(1)
    })
    harness.context.dataRef.current = latest
    resolveServiceLoad(harness.syncService)
    await clearPromise

    expect(harness.syncService.clearRemoteSyncData).toHaveBeenCalledWith(
      latest,
      expect.objectContaining({ firstSyncStrategy: 'ask' }),
    )
  })

  it('stops clear-cloud when mode changes to local during service loading', async () => {
    const current = appData('cloudflare')
    const local = appData('local', { updatedAt: 25 })
    const harness = createHarness({ data: current })
    let resolveServiceLoad: (service: typeof harness.syncService) => void = () => {
      throw new Error('sync service load did not start')
    }

    vi.mocked(harness.services.loadSyncService).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveServiceLoad = resolve
        }),
    )

    const clearPromise = harness.actions.clearCloudData()
    await vi.waitFor(() => {
      expect(harness.services.loadSyncService).toHaveBeenCalledTimes(1)
    })
    harness.dataRef.current = local
    resolveServiceLoad(harness.syncService)
    await clearPromise

    expect(harness.syncService.clearRemoteSyncData).not.toHaveBeenCalled()
    expect(harness.context.persistLocalSnapshot).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.clearCloudLocalMode',
      'warning',
      'data-cloud',
    )
    expect(harness.context.setSyncing).toHaveBeenLastCalledWith(false)
  })

  it('contains clear-cloud pre-confirmation notice reporter failures', async () => {
    const current = appData('cloudflare')
    const cleared = appData('cloudflare', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    harness.context.setNotice = vi.fn((message) => {
      if (message === '') {
        throw new Error('notice unavailable')
      }
    })
    harness.syncService.clearRemoteSyncData.mockResolvedValue({
      data: cleared,
      message: 'cleared',
      remoteAccepted: false,
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await expect(harness.actions.clearCloudData()).resolves.toBeUndefined()

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalledTimes(1)
    expect(harness.context.clearScheduledSync).toHaveBeenCalledTimes(1)
    expect(harness.syncService.clearRemoteSyncData).toHaveBeenCalledWith(
      current,
      expect.objectContaining({
        encryptionPassphrase: 'passphrase',
      }),
    )
    expect(harness.context.setData).toHaveBeenCalledWith(cleared)
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(cleared)
    expect(harness.context.setNotice).toHaveBeenCalledWith('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'localized:cleared',
      'success',
      'data-cloud',
    )
  })

  it('contains clear-cloud success notice reporter failures after commit', async () => {
    const current = appData('cloudflare')
    const cleared = appData('cloudflare', { updatedAt: 40 })
    const harness = createHarness({ data: current })
    harness.context.setNotice = vi.fn((_message, tone) => {
      if (tone === 'success') {
        throw new Error('notice unavailable')
      }
    })
    harness.syncService.clearRemoteSyncData.mockResolvedValue({
      data: cleared,
      message: 'cleared',
      remoteAccepted: false,
    })
    harness.actions = createSyncRuntimeControllerActions(
      harness.context,
      harness.services,
    )

    await expect(harness.actions.clearCloudData()).resolves.toBeUndefined()

    expect(harness.context.setData).toHaveBeenCalledWith(cleared)
    expect(harness.context.persistLocalSnapshot).toHaveBeenCalledWith(cleared)
    expect(harness.context.setSyncing).toHaveBeenLastCalledWith(false)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'localized:cleared',
      'success',
      'data-cloud',
    )
  })

  it('reports rejected clear-cloud confirmations without leaking the promise', async () => {
    const current = appData('cloudflare')
    const harness = createHarness({ data: current })
    vi.mocked(harness.context.requestDangerConfirmation).mockRejectedValueOnce(
      new Error('dialog unavailable'),
    )

    await expect(harness.actions.clearCloudData()).resolves.toBeUndefined()

    expect(harness.context.clearScheduledSync).not.toHaveBeenCalled()
    expect(harness.services.loadSyncService).not.toHaveBeenCalled()
    expect(harness.syncService.clearRemoteSyncData).not.toHaveBeenCalled()
    expect(harness.context.syncingRef.current).toBe(false)
    expect(harness.context.setSyncing).not.toHaveBeenCalledWith(true)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.clearCloudFailed:dialog unavailable',
      'error',
      'data-cloud',
    )
  })

  it('reports rejected detached sync runtime runners without leaking the promise', async () => {
    const current = appData('cloudflare')
    const harness = createHarness({ data: current })
    const failure = new Error('sync runner failed')

    runDetachedSyncRuntime(
      () => Promise.reject(failure),
      current,
      { silent: false },
      harness.context,
      harness.services,
    )

    await vi.waitFor(() =>
      expect(harness.context.setNotice).toHaveBeenCalledWith(
        'notice.syncConfigErrorLocalSaved:sync runner failed',
        'error',
        'sync',
      ),
    )
    expect(harness.services.postWindowsSyncStatus).toHaveBeenCalledWith(
      'failed',
      'notice.syncConfigErrorLocalSaved:sync runner failed',
    )
  })

  it('reports thrown detached sync runtime runners without leaving the scheduler broken', () => {
    const current = appData('cloudflare')
    const harness = createHarness({ data: current })
    const failure = new Error('sync runner failed')

    expect(() => {
      runDetachedSyncRuntime(
        () => {
          throw failure
        },
        current,
        { silent: true },
        harness.context,
        harness.services,
      )
    }).not.toThrow()

    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncConfigErrorLocalSaved:sync runner failed',
      'error',
      'sync',
    )
    expect(harness.services.postWindowsSyncStatus).not.toHaveBeenCalled()
  })
})
