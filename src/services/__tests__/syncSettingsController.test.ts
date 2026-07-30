import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  SyncMode,
} from '../../types'
import {
  accessKeyCopyNotice,
  createSyncSettingsActions,
  reportSyncSettingsNotice,
  type SyncSettingsActionContext,
  type SyncSettingsActionServices,
} from '../syncSettingsController'

const t = ((key: string) => key) as Translator

function appData(mode: SyncMode = 'local'): AppData {
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
    providers: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: mode !== 'local',
      encryptionEnabled: true,
      mode,
    },
    updatedAt: 10,
  }
}

function createHarness(mode: SyncMode = 'local') {
  const dataRef = { current: appData(mode) }
  const githubTokenRef = { current: '' }
  const services: SyncSettingsActionServices = {
    persistGithubToken: vi.fn(async () => undefined),
    writeClipboardText: vi.fn(async () => undefined),
  }
  const context: SyncSettingsActionContext = {
    currentSyncMode: mode,
    githubTokenRef,
    requestSyncConfigScroll: vi.fn(),
    reportSecretWrite: vi.fn((promise) => {
      void promise.catch(() => undefined)
    }),
    scheduleAutoSync: vi.fn(),
    setGithubTokenValue: vi.fn(),
    setNotice: vi.fn(),
    t,
    updateData: vi.fn((updater) => {
      dataRef.current = updater(dataRef.current)
      return dataRef.current
    }),
  }

  return {
    actions: createSyncSettingsActions(context, services),
    context,
    dataRef,
    githubTokenRef,
    services,
  }
}

function expectSyncUpdateDataSingleQueue(
  context: SyncSettingsActionContext,
): void {
  expect(context.updateData).toHaveBeenLastCalledWith(
    expect.any(Function),
    { autoSync: false },
  )
}

describe('sync settings controller', () => {
  it('contains sync settings notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportSyncSettingsNotice(
        { setNotice },
        {
          message: 'notice.syncSaveUnavailable',
          target: 'sync',
          tone: 'error',
        },
      ),
    ).not.toThrow()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.syncSaveUnavailable',
      'error',
      'sync',
    )

    const clearNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportSyncSettingsNotice({ setNotice: clearNotice }, { message: '' }),
    ).not.toThrow()
    expect(clearNotice).toHaveBeenCalledWith('')
  })

  it('changes sync mode with config scrolling and encrypted auto-sync defaults', () => {
    const harness = createHarness('local')

    harness.actions.changeSyncMode('cloudflare')

    expect(harness.context.setNotice).toHaveBeenCalledWith('')
    expect(harness.context.requestSyncConfigScroll).toHaveBeenCalledWith(
      'cloudflare',
      'local',
    )
    expect(harness.dataRef.current.sync).toMatchObject({
      autoSync: true,
      encryptionEnabled: true,
      mode: 'cloudflare',
    })
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectSyncUpdateDataSingleQueue(harness.context)
  })

  it('contains sync mode clear-notice reporter failures after commit and sync scheduling', () => {
    const harness = createHarness('local')
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() => harness.actions.changeSyncMode('cloudflare')).not.toThrow()

    expect(harness.context.setNotice).toHaveBeenCalledWith('')
    expect(harness.context.requestSyncConfigScroll).toHaveBeenCalledWith(
      'cloudflare',
      'local',
    )
    expect(harness.dataRef.current.sync).toMatchObject({
      autoSync: true,
      encryptionEnabled: true,
      mode: 'cloudflare',
    })
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
  })

  it('reports sync mode commit failures before scrolling or clearing notices', () => {
    const harness = createHarness('local')
    harness.context.updateData = vi.fn(() => null)

    harness.actions.changeSyncMode('cloudflare')

    expect(harness.dataRef.current.sync).toMatchObject({
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    })
    expect(harness.context.requestSyncConfigScroll).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.syncSaveUnavailable',
      'error',
      'sync',
    )
  })

  it('contains sync mode save-failure notice reporter failures without scrolling or scheduling sync', () => {
    const harness = createHarness('local')
    harness.context.updateData = vi.fn(() => null)
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() => harness.actions.changeSyncMode('cloudflare')).not.toThrow()

    expect(harness.dataRef.current.sync).toMatchObject({
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    })
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.syncSaveUnavailable',
      'error',
      'sync',
    )
    expect(harness.context.requestSyncConfigScroll).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('normalizes Gist and Worker fields through AppData updaters', () => {
    const harness = createHarness('gist')

    harness.actions.updateSyncGistId('  gist-id  ')
    harness.actions.updateSyncGistFile('zerochat.json')
    harness.actions.updateSyncWorkerEndpoint('  https://sync.example.workers.dev  ')

    expect(harness.dataRef.current.sync).toMatchObject({
      gistFile: 'zerochat.json',
      gistId: 'gist-id',
      workerEndpoint: 'https://sync.example.workers.dev',
    })

    harness.actions.updateSyncGistId('   ')
    harness.actions.updateSyncWorkerEndpoint('')

    expect(harness.dataRef.current.sync.gistId).toBeUndefined()
    expect(harness.dataRef.current.sync.workerEndpoint).toBeUndefined()
    expect(harness.context.scheduleAutoSync).toHaveBeenLastCalledWith(
      harness.dataRef.current,
      0,
    )
    expectSyncUpdateDataSingleQueue(harness.context)
  })

  it('reports sync field commit failures without changing cloud configuration', () => {
    const harness = createHarness('cloudflare')
    harness.dataRef.current = {
      ...harness.dataRef.current,
      sync: {
        ...harness.dataRef.current.sync,
        workerEndpoint: 'https://sync.example.workers.dev',
      },
    }
    harness.context.updateData = vi.fn(() => null)

    harness.actions.updateSyncWorkerEndpoint('https://broken.example.dev')

    expect(harness.dataRef.current.sync).toMatchObject({
      mode: 'cloudflare',
      workerEndpoint: 'https://sync.example.workers.dev',
    })
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.syncSaveUnavailable',
      'error',
      'sync',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('toggles automatic sync without clearing cloud configuration', () => {
    const harness = createHarness('cloudflare')

    harness.dataRef.current = {
      ...harness.dataRef.current,
      sync: {
        ...harness.dataRef.current.sync,
        gistFile: 'zerochat.json',
        gistId: 'gist-id',
        workerEndpoint: 'https://sync.example.workers.dev',
      },
    }

    harness.actions.updateSyncAutoSync(false)

    expect(harness.dataRef.current.sync).toMatchObject({
      autoSync: false,
      encryptionEnabled: true,
      gistFile: 'zerochat.json',
      gistId: 'gist-id',
      mode: 'cloudflare',
      workerEndpoint: 'https://sync.example.workers.dev',
    })

    harness.actions.updateSyncAutoSync(true)

    expect(harness.dataRef.current.sync).toMatchObject({
      autoSync: true,
      encryptionEnabled: true,
      gistFile: 'zerochat.json',
      gistId: 'gist-id',
      mode: 'cloudflare',
      workerEndpoint: 'https://sync.example.workers.dev',
    })
    expectSyncUpdateDataSingleQueue(harness.context)
  })

  it('keeps automatic sync disabled for local mode', () => {
    const harness = createHarness('local')

    harness.actions.updateSyncAutoSync(true)

    expect(harness.dataRef.current.sync).toMatchObject({
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    })
    expectSyncUpdateDataSingleQueue(harness.context)
  })

  it('keeps GitHub token draft, ref, and secret persistence together', () => {
    const harness = createHarness('gist')

    harness.actions.updateGithubTokenSecret('token-123')

    expect(harness.context.setGithubTokenValue).toHaveBeenCalledWith('token-123')
    expect(harness.githubTokenRef.current).toBe('token-123')
    expect(harness.services.persistGithubToken).toHaveBeenCalledWith('token-123')
    expect(harness.context.reportSecretWrite).toHaveBeenCalledWith(
      expect.any(Promise),
      'sync',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('reverts the GitHub token draft and compensates durable state when persistence fails', async () => {
    const harness = createHarness('gist')
    const failure = new Error('secret store unavailable')
    harness.githubTokenRef.current = 'old-token'
    harness.services.persistGithubToken = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)

    harness.actions.updateGithubTokenSecret('new-token')

    await expect(
      vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0],
    ).rejects.toBe(failure)
    expect(harness.githubTokenRef.current).toBe('old-token')
    expect(harness.context.setGithubTokenValue).toHaveBeenLastCalledWith(
      'old-token',
    )
    expect(harness.services.persistGithubToken).toHaveBeenNthCalledWith(
      1,
      'new-token',
    )
    expect(harness.services.persistGithubToken).toHaveBeenNthCalledWith(
      2,
      'old-token',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('preserves the original GitHub token failure when durable compensation also fails', async () => {
    const harness = createHarness('gist')
    const failure = new Error('secret store unavailable')
    harness.githubTokenRef.current = 'old-token'
    harness.services.persistGithubToken = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(new Error('compensation unavailable'))

    harness.actions.updateGithubTokenSecret('new-token')

    await expect(
      vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0],
    ).rejects.toBe(failure)
    expect(harness.githubTokenRef.current).toBe('old-token')
    expect(harness.services.persistGithubToken).toHaveBeenNthCalledWith(
      2,
      'old-token',
    )
  })

  it('keeps a newer GitHub token draft when an older secret write fails', async () => {
    const harness = createHarness('gist')
    let rejectFirstWrite: ((error: Error) => void) | undefined
    harness.services.persistGithubToken = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectFirstWrite = reject
          }),
      )
      .mockResolvedValueOnce(undefined)

    harness.actions.updateGithubTokenSecret('older-token')
    harness.actions.updateGithubTokenSecret('newer-token')
    rejectFirstWrite?.(new Error('old write failed'))

    await expect(
      vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0],
    ).rejects.toThrow('old write failed')
    expect(harness.githubTokenRef.current).toBe('newer-token')
    expect(harness.context.setGithubTokenValue).toHaveBeenLastCalledWith(
      'newer-token',
    )
    expect(harness.services.persistGithubToken).toHaveBeenCalledTimes(2)
  })

  it('copies Cloudflare access keys only when a key is available', async () => {
    expect(accessKeyCopyNotice('', t)).toMatchObject({
      message: 'notice.accessKeyMissing',
      target: 'sync',
      tone: 'warning',
    })
    expect(accessKeyCopyNotice('access-key', t)).toMatchObject({
      message: 'notice.accessKeyCopied',
      target: 'sync',
      tone: 'success',
    })

    const harness = createHarness('cloudflare')

    await harness.actions.copyCloudflareAccessKey('')
    expect(harness.services.writeClipboardText).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.accessKeyMissing',
      'warning',
      'sync',
    )

    await harness.actions.copyCloudflareAccessKey('access-key')
    expect(harness.services.writeClipboardText).toHaveBeenCalledWith('access-key')
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.accessKeyCopied',
      'success',
      'sync',
    )
  })

  it('reports Cloudflare access-key clipboard failures with localized sync errors', async () => {
    const harness = createHarness('cloudflare')
    harness.services.writeClipboardText = vi.fn(async () => {
      throw new Error('NotAllowedError: access key text rejected')
    })
    harness.actions = createSyncSettingsActions(
      harness.context,
      harness.services,
    )

    await harness.actions.copyCloudflareAccessKey('access-key')

    expect(harness.services.writeClipboardText).toHaveBeenCalledWith('access-key')
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'button.copyFailed',
      'error',
      'sync',
    )
  })

  it('contains Cloudflare access-key clipboard failure reporter failures', async () => {
    const harness = createHarness('cloudflare')
    harness.services.writeClipboardText = vi.fn(async () => {
      throw new Error('NotAllowedError: access key text rejected')
    })
    vi.mocked(harness.context.setNotice).mockImplementation((message) => {
      if (message === 'button.copyFailed') {
        throw new Error('notice unavailable')
      }
    })
    harness.actions = createSyncSettingsActions(
      harness.context,
      harness.services,
    )

    await expect(
      harness.actions.copyCloudflareAccessKey('access-key'),
    ).resolves.toBeUndefined()

    expect(harness.services.writeClipboardText).toHaveBeenCalledWith('access-key')
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'button.copyFailed',
      'error',
      'sync',
    )
  })
})
