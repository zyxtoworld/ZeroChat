import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type { AppData } from '../../types'
import { defaultSkillSettings } from '../appData'
import {
  clearProviderConnectivityResult,
  consumeDetachedSecretWriteFailure,
  ensureLocalWriteTimestamp,
  reportAppDataMutationNotice,
  reportSecretWriteFailure,
  updateProviderInAppData,
} from '../appDataMutationController'

function appData(patch: Partial<AppData> = {}): AppData {
  const provider = providerFromPreset(providerPresets[0])

  return {
    version: 1,
    providers: [provider],
    conversations: [
      {
        id: 'conversation-1',
        title: 'Chat',
        providerId: provider.id,
        model: provider.model,
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    skills: [],
    skillSettings: defaultSkillSettings(),
    sync: {
      mode: 'cloudflare',
      autoSync: true,
      encryptionEnabled: true,
      workerEndpoint: 'https://sync.example.dev',
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
      activeConversationId: 'conversation-1',
    },
    updatedAt: 10,
    ...patch,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ensureLocalWriteTimestamp', () => {
  it('advances local writes that did not already bump updatedAt', () => {
    vi.spyOn(Date, 'now').mockReturnValue(20)
    const current = appData()
    const nextRaw = {
      ...current,
      preferences: {
        ...current.preferences,
        compactMode: true,
      },
    }

    expect(ensureLocalWriteTimestamp(current, nextRaw).updatedAt).toBe(20)
  })

  it('preserves remote or explicit timestamps that are newer than current data', () => {
    const current = appData()
    const nextRaw = {
      ...current,
      updatedAt: 30,
    }

    expect(ensureLocalWriteTimestamp(current, nextRaw)).toBe(nextRaw)
  })
})

describe('clearProviderConnectivityResult', () => {
  it('only clears stale connectivity state for the edited provider', () => {
    const current = {
      p1: {
        field: 'none' as const,
        message: 'ok',
        retryable: false,
        tone: 'success' as const,
      },
      p2: {
        field: 'baseUrl' as const,
        message: 'bad',
        retryable: true,
        tone: 'error' as const,
      },
    }

    expect(clearProviderConnectivityResult(current, 'p1')).toEqual({
      p2: current.p2,
    })
    expect(clearProviderConnectivityResult(current, 'missing')).toBe(current)
  })
})

describe('reportSecretWriteFailure', () => {
  it('contains app data mutation notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportAppDataMutationNotice(
        setNotice,
        () => 'Disk full while saving provider key',
        'error',
        'providers-list',
      ),
    ).not.toThrow()

    expect(setNotice).toHaveBeenCalledWith(
      'Disk full while saving provider key',
      'error',
      'providers-list',
    )

    const clearNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportAppDataMutationNotice(clearNotice, () => ''),
    ).not.toThrow()

    expect(clearNotice).toHaveBeenCalledWith('')
  })

  it('reports secret write failures as explicit error notices', () => {
    const error = new Error('Disk full while saving provider key')
    const formatErrorMessage = vi.fn(() => 'Disk full while saving provider key')
    const setNotice = vi.fn()

    reportSecretWriteFailure(error, formatErrorMessage, setNotice)

    expect(formatErrorMessage).toHaveBeenCalledWith(error)
    expect(setNotice).toHaveBeenCalledWith(
      'Disk full while saving provider key',
      'error',
    )
  })

  it('reports secret write failures against the active settings section', () => {
    const error = new Error('Disk full while saving sync token')
    const formatErrorMessage = vi.fn(() => 'Disk full while saving sync token')
    const setNotice = vi.fn()

    reportSecretWriteFailure(error, formatErrorMessage, setNotice, 'sync')

    expect(formatErrorMessage).toHaveBeenCalledWith(error)
    expect(setNotice).toHaveBeenCalledWith(
      'Disk full while saving sync token',
      'error',
      'sync',
    )
  })

  it('contains detached secret write reporter failures', async () => {
    const error = new Error('Disk full while saving provider key')
    const formatErrorMessage = vi.fn(() => 'Disk full while saving provider key')
    const setNotice = vi.fn(() => {
      throw new Error('notice failed')
    })

    await expect(
      consumeDetachedSecretWriteFailure(
        Promise.reject(error),
        formatErrorMessage,
        setNotice,
        'providers-list',
      ),
    ).resolves.toBeUndefined()

    expect(formatErrorMessage).toHaveBeenCalledWith(error)
    expect(setNotice).toHaveBeenCalledWith(
      'Disk full while saving provider key',
      'error',
      'providers-list',
    )
  })
})

describe('updateProviderInAppData', () => {
  it('updates providers and keeps the active empty conversation model aligned', () => {
    vi.spyOn(Date, 'now').mockReturnValue(40)
    const current = appData()
    const provider = current.providers[0]
    const next = updateProviderInAppData(current, provider.id, {
      model: 'gpt-new',
    })

    expect(next.providers[0]).toMatchObject({
      id: provider.id,
      model: 'gpt-new',
      updatedAt: 40,
    })
    expect(next.conversations[0]).toMatchObject({
      model: 'gpt-new',
      updatedAt: 40,
    })
    expect(next.updatedAt).toBe(40)
  })

  it('does not rewrite a conversation that already contains messages', () => {
    const current = appData({
      conversations: [
        {
          id: 'conversation-1',
          title: 'Chat',
          providerId: providerPresets[0].id,
          model: 'old-model',
          messages: [
            {
              id: 'message-1',
              role: 'user',
              content: 'hello',
              createdAt: 1,
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const next = updateProviderInAppData(current, current.providers[0].id, {
      model: 'gpt-new',
    })

    expect(next.conversations[0].model).toBe('old-model')
  })

  it('clears the proxy URL when browser direct request mode is enabled', () => {
    const current = appData({
      providers: [
        {
          ...providerFromPreset(providerPresets[0]),
          proxyUrl: 'https://worker.example.com',
          clientRequestMode: undefined,
        },
      ],
    })

    const next = updateProviderInAppData(current, current.providers[0].id, {
      clientRequestMode: true,
    })

    expect(next.providers[0]).toMatchObject({
      clientRequestMode: true,
    })
    expect(next.providers[0].proxyUrl).toBeUndefined()
  })

  it('clears browser direct request mode when a proxy URL is configured', () => {
    const current = appData({
      providers: [
        {
          ...providerFromPreset(providerPresets[0]),
          proxyUrl: undefined,
          clientRequestMode: true,
        },
      ],
    })

    const next = updateProviderInAppData(current, current.providers[0].id, {
      proxyUrl: 'https://worker.example.com',
    })

    expect(next.providers[0]).toMatchObject({
      proxyUrl: 'https://worker.example.com',
    })
    expect(next.providers[0].clientRequestMode).toBeUndefined()
  })

  it('normalizes legacy providers that already contain both transport modes', () => {
    const current = appData({
      providers: [
        {
          ...providerFromPreset(providerPresets[0]),
          proxyUrl: 'https://worker.example.com',
          clientRequestMode: true,
        },
      ],
    })

    const next = updateProviderInAppData(current, current.providers[0].id, {
      model: 'gpt-new',
    })

    expect(next.providers[0]).toMatchObject({
      model: 'gpt-new',
      proxyUrl: 'https://worker.example.com',
    })
    expect(next.providers[0].clientRequestMode).toBeUndefined()
  })
})
