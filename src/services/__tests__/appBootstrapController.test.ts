import { describe, expect, it, vi } from 'vitest'

import type { Locale } from '../../i18n'
import type { AppData, ProviderConfig } from '../../types'
import {
  applyAppBootstrapResult,
  formatAppBootstrapError,
  hydrateAppBootstrap,
  resolveInitialBootstrapLocale,
  type AppBootstrapServices,
} from '../appBootstrapController'

function provider(id: string): ProviderConfig {
  return {
    id,
    baseUrl: 'https://api.example.com/v1',
    createdAt: 1,
    enabled: true,
    kind: 'openai-compatible',
    model: `${id}-model`,
    models: [`${id}-model`],
    name: id,
    needsApiKey: true,
    updatedAt: 1,
  }
}

function appData(providerId = 'provider-1'): AppData {
  return {
    version: 1,
    conversations: [
      {
        id: 'conversation-1',
        createdAt: 1,
        messages: [],
        model: `${providerId}-model`,
        providerId,
        title: 'Chat',
        updatedAt: 1,
      },
    ],
    preferences: {
      activeConversationId: 'conversation-1',
      chatContextMessageLimit: 24,
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [provider(providerId)],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt: 1,
  }
}

function createServices(
  overrides: Partial<AppBootstrapServices> = {},
): AppBootstrapServices {
  const data = appData()

  return {
    clearPendingProviderSecretCleanupById: vi.fn(),
    clearProviderSecretsById: vi.fn(async () => undefined),
    createDefaultData: vi.fn(() => data),
    getPendingProviderSecretCleanupIds: vi.fn(() => []),
    getSyncPassphrase: vi.fn(async () => 'sync-passphrase'),
    loadAppData: vi.fn(async () => data),
    loadLocale: vi.fn(async () => undefined),
    loadZeroChatSecrets: vi.fn(async (providerIds: string[]) => ({
      githubToken: 'github-token',
      providerKeys: Object.fromEntries(
        providerIds.map((providerId) => [providerId, `${providerId}-key`]),
      ),
    })),
    normalizeOfficialProviderContracts: vi.fn((value) => value),
    persistAppDataSkillContents: vi.fn(async (value) => value),
    preferredProviderId: vi.fn((value) => value.providers[0]?.id ?? ''),
    queueProviderSecretCleanupById: vi.fn(),
    resolveInitialLocale: vi.fn((): Locale => 'zh-CN'),
    sanitizeRemoteOnlyAppData: vi.fn((value) => ({
      changed: false,
      data: value,
      removedProviderIds: [],
    })),
    saveAppData: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('hydrateAppBootstrap', () => {
  it('hydrates missing storage through the default data and secret pipeline', async () => {
    const fresh = appData('fresh-provider')
    const services = createServices({
      createDefaultData: vi.fn(() => fresh),
      loadAppData: vi.fn(async () => null),
      preferredProviderId: vi.fn(() => 'fresh-provider'),
    })

    const result = await hydrateAppBootstrap(services)

    expect(services.createDefaultData).toHaveBeenCalledTimes(1)
    expect(services.persistAppDataSkillContents).toHaveBeenCalledWith(fresh)
    expect(services.sanitizeRemoteOnlyAppData).toHaveBeenCalledWith(fresh)
    expect(services.normalizeOfficialProviderContracts).toHaveBeenCalledWith(fresh)
    expect(services.loadLocale).toHaveBeenCalledWith('zh-CN')
    expect(services.saveAppData).toHaveBeenCalledWith(fresh)
    expect(services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(services.loadZeroChatSecrets).toHaveBeenCalledWith(['fresh-provider'])
    expect(result).toMatchObject({
      data: fresh,
      githubToken: 'github-token',
      locale: 'zh-CN',
      providerKeys: {
        'fresh-provider': 'fresh-provider-key',
      },
      selectedProviderId: 'fresh-provider',
      syncPassphrase: 'sync-passphrase',
    })
  })

  it('journals removed provider cleanup before saving repaired startup data', async () => {
    const calls: string[] = []
    const stored = appData('unsafe-provider')
    const sanitized = appData('safe-provider')
    const normalized = {
      ...sanitized,
      updatedAt: 2,
    }
    const services = createServices({
      clearPendingProviderSecretCleanupById: vi.fn(() => {
        calls.push('clear-pending')
      }),
      clearProviderSecretsById: vi.fn(async () => {
        calls.push('clear')
      }),
      loadAppData: vi.fn(async () => stored),
      loadZeroChatSecrets: vi.fn(async (providerIds: string[]) => {
        calls.push('load-secrets')
        return {
          githubToken: 'github-token',
          providerKeys: Object.fromEntries(
            providerIds.map((providerId) => [providerId, `${providerId}-key`]),
          ),
        }
      }),
      normalizeOfficialProviderContracts: vi.fn(() => normalized),
      preferredProviderId: vi.fn(() => 'safe-provider'),
      queueProviderSecretCleanupById: vi.fn(() => {
        calls.push('queue')
      }),
      saveAppData: vi.fn(async () => {
        calls.push('save')
      }),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: true,
        data: sanitized,
        removedProviderIds: ['unsafe-provider'],
      })),
    })

    const result = await hydrateAppBootstrap(services)

    expect(services.saveAppData).toHaveBeenCalledWith(normalized)
    expect(services.clearProviderSecretsById).toHaveBeenCalledWith([
      'unsafe-provider',
    ])
    expect(services.queueProviderSecretCleanupById).toHaveBeenCalledWith([
      'unsafe-provider',
    ])
    expect(services.clearPendingProviderSecretCleanupById).toHaveBeenCalledWith([
      'unsafe-provider',
    ])
    expect(services.loadZeroChatSecrets).toHaveBeenCalledWith(['safe-provider'])
    expect(calls).toEqual([
      'queue',
      'save',
      'clear',
      'clear-pending',
      'load-secrets',
    ])
    expect(result.data).toBe(normalized)
    expect(result.selectedProviderId).toBe('safe-provider')
  })

  it('keeps removed-provider cleanup journaled when repaired AppData save fails', async () => {
    const calls: string[] = []
    const stored = appData('unsafe-provider')
    const sanitized = appData('safe-provider')
    const normalized = {
      ...sanitized,
      updatedAt: 2,
    }
    const services = createServices({
      clearProviderSecretsById: vi.fn(async () => {
        calls.push('clear')
      }),
      loadAppData: vi.fn(async () => stored),
      normalizeOfficialProviderContracts: vi.fn(() => normalized),
      queueProviderSecretCleanupById: vi.fn(() => {
        calls.push('queue')
      }),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: true,
        data: sanitized,
        removedProviderIds: ['unsafe-provider'],
      })),
      saveAppData: vi.fn(async () => {
        calls.push('save')
        throw new Error('repaired app data write blocked')
      }),
    })

    await expect(hydrateAppBootstrap(services)).rejects.toThrow(
      'repaired app data write blocked',
    )

    expect(services.queueProviderSecretCleanupById).toHaveBeenCalledWith([
      'unsafe-provider',
    ])
    expect(services.saveAppData).toHaveBeenCalledWith(normalized)
    expect(services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(services.clearPendingProviderSecretCleanupById).not.toHaveBeenCalled()
    expect(services.loadZeroChatSecrets).not.toHaveBeenCalled()
    expect(calls).toEqual(['queue', 'save'])
  })

  it('keeps startup repair retryable when removed-provider secret cleanup fails', async () => {
    const calls: string[] = []
    const stored = appData('unsafe-provider')
    const sanitized = appData('safe-provider')
    const normalized = {
      ...sanitized,
      updatedAt: 2,
    }
    const services = createServices({
      clearProviderSecretsById: vi.fn(async () => {
        calls.push('clear')
        throw new Error('removed provider cleanup blocked')
      }),
      loadAppData: vi.fn(async () => stored),
      normalizeOfficialProviderContracts: vi.fn(() => normalized),
      queueProviderSecretCleanupById: vi.fn(() => {
        calls.push('queue')
      }),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: true,
        data: sanitized,
        removedProviderIds: ['unsafe-provider'],
      })),
      saveAppData: vi.fn(async () => {
        calls.push('save')
      }),
    })

    await expect(hydrateAppBootstrap(services)).rejects.toThrow(
      'removed provider cleanup blocked',
    )

    expect(services.clearProviderSecretsById).toHaveBeenCalledWith([
      'unsafe-provider',
    ])
    expect(services.queueProviderSecretCleanupById).toHaveBeenCalledWith([
      'unsafe-provider',
    ])
    expect(services.saveAppData).toHaveBeenCalledWith(normalized)
    expect(services.loadZeroChatSecrets).not.toHaveBeenCalled()
    expect(services.clearPendingProviderSecretCleanupById).not.toHaveBeenCalled()
    expect(calls).toEqual(['queue', 'save', 'clear'])
  })

  it('fails before repairing AppData when removed-provider cleanup cannot be journaled', async () => {
    const stored = appData('unsafe-provider')
    const sanitized = appData('safe-provider')
    const normalized = {
      ...sanitized,
      updatedAt: 2,
    }
    const services = createServices({
      loadAppData: vi.fn(async () => stored),
      normalizeOfficialProviderContracts: vi.fn(() => normalized),
      queueProviderSecretCleanupById: vi.fn(() => {
        throw new Error('cleanup journal blocked')
      }),
      sanitizeRemoteOnlyAppData: vi.fn(() => ({
        changed: true,
        data: sanitized,
        removedProviderIds: ['unsafe-provider'],
      })),
    })

    await expect(hydrateAppBootstrap(services)).rejects.toThrow(
      'cleanup journal blocked',
    )

    expect(services.saveAppData).not.toHaveBeenCalled()
    expect(services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(services.loadZeroChatSecrets).not.toHaveBeenCalled()
  })

  it('retries pending provider deletion secret cleanup before loading secrets', async () => {
    const calls: string[] = []
    const services = createServices({
      clearPendingProviderSecretCleanupById: vi.fn(() => {
        calls.push('clear-pending')
      }),
      clearProviderSecretsById: vi.fn(async () => {
        calls.push('clear')
      }),
      getPendingProviderSecretCleanupIds: vi.fn(() => ['deleted-provider']),
      loadZeroChatSecrets: vi.fn(async (providerIds: string[]) => {
        calls.push('load-secrets')
        return {
          githubToken: 'github-token',
          providerKeys: Object.fromEntries(
            providerIds.map((providerId) => [providerId, `${providerId}-key`]),
          ),
        }
      }),
    })

    await expect(hydrateAppBootstrap(services)).resolves.toMatchObject({
      providerKeys: {
        'provider-1': 'provider-1-key',
      },
    })

    expect(services.clearProviderSecretsById).toHaveBeenCalledWith([
      'deleted-provider',
    ])
    expect(services.clearPendingProviderSecretCleanupById).toHaveBeenCalledWith([
      'deleted-provider',
    ])
    expect(calls).toEqual(['clear', 'clear-pending', 'load-secrets'])
  })

  it('keeps startup usable when retryable pending tombstone cleanup fails after canonical cleanup', async () => {
    const services = createServices({
      clearPendingProviderSecretCleanupById: vi.fn(() => {
        throw new Error('pending tombstone cleanup blocked')
      }),
      clearProviderSecretsById: vi.fn(async () => undefined),
      getPendingProviderSecretCleanupIds: vi.fn(() => ['deleted-provider']),
    })

    await expect(hydrateAppBootstrap(services)).resolves.toMatchObject({
      providerKeys: {
        'provider-1': 'provider-1-key',
      },
    })

    expect(services.clearProviderSecretsById).toHaveBeenCalledWith([
      'deleted-provider',
    ])
    expect(services.clearPendingProviderSecretCleanupById).toHaveBeenCalledWith([
      'deleted-provider',
    ])
    expect(services.loadZeroChatSecrets).toHaveBeenCalledWith(['provider-1'])
  })

  it('clears active-provider pending cleanup tombstones without clearing live secrets', async () => {
    const services = createServices({
      clearProviderSecretsById: vi.fn(async () => {
        throw new Error('active provider secret should not be cleared')
      }),
      getPendingProviderSecretCleanupIds: vi.fn(() => ['provider-1']),
    })

    await expect(hydrateAppBootstrap(services)).resolves.toMatchObject({
      providerKeys: {
        'provider-1': 'provider-1-key',
      },
    })

    expect(services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(services.clearPendingProviderSecretCleanupById).toHaveBeenCalledWith([
      'provider-1',
    ])
    expect(services.loadZeroChatSecrets).toHaveBeenCalledWith(['provider-1'])
  })

  it('keeps startup usable when active-provider pending tombstone cleanup fails', async () => {
    const services = createServices({
      clearPendingProviderSecretCleanupById: vi.fn(() => {
        throw new Error('active tombstone cleanup blocked')
      }),
      clearProviderSecretsById: vi.fn(async () => {
        throw new Error('active provider secret should not be cleared')
      }),
      getPendingProviderSecretCleanupIds: vi.fn(() => ['provider-1']),
    })

    await expect(hydrateAppBootstrap(services)).resolves.toMatchObject({
      providerKeys: {
        'provider-1': 'provider-1-key',
      },
    })

    expect(services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(services.clearPendingProviderSecretCleanupById).toHaveBeenCalledWith([
      'provider-1',
    ])
    expect(services.loadZeroChatSecrets).toHaveBeenCalledWith(['provider-1'])
  })

  it('keeps pending provider deletion secret cleanup retryable when retry fails', async () => {
    const services = createServices({
      clearProviderSecretsById: vi.fn(async () => {
        throw new Error('pending cleanup blocked')
      }),
      getPendingProviderSecretCleanupIds: vi.fn(() => ['deleted-provider']),
    })

    await expect(hydrateAppBootstrap(services)).rejects.toThrow(
      'pending cleanup blocked',
    )

    expect(services.clearProviderSecretsById).toHaveBeenCalledWith([
      'deleted-provider',
    ])
    expect(services.clearPendingProviderSecretCleanupById).not.toHaveBeenCalled()
    expect(services.saveAppData).not.toHaveBeenCalled()
    expect(services.loadZeroChatSecrets).not.toHaveBeenCalled()
  })

  it('blocks startup secrets loading when pending provider deletion tombstones are corrupted', async () => {
    const services = createServices({
      getPendingProviderSecretCleanupIds: vi.fn(() => {
        throw new Error('provider cleanup queue is corrupted')
      }),
    })

    await expect(hydrateAppBootstrap(services)).rejects.toThrow(
      'provider cleanup queue is corrupted',
    )

    expect(services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(services.clearPendingProviderSecretCleanupById).not.toHaveBeenCalled()
    expect(services.saveAppData).not.toHaveBeenCalled()
    expect(services.loadZeroChatSecrets).not.toHaveBeenCalled()
  })

  it('skips empty removed-provider secret cleanup during startup repair', async () => {
    const repaired = {
      ...appData('provider-1'),
      updatedAt: 2,
    }
    const services = createServices({
      clearProviderSecretsById: vi.fn(async () => {
        throw new Error('empty secret cleanup should not run')
      }),
      normalizeOfficialProviderContracts: vi.fn(() => repaired),
      sanitizeRemoteOnlyAppData: vi.fn((value) => ({
        changed: true,
        data: value,
        removedProviderIds: [],
      })),
    })

    await expect(hydrateAppBootstrap(services)).resolves.toMatchObject({
      data: repaired,
    })

    expect(services.saveAppData).toHaveBeenCalledWith(repaired)
    expect(services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(services.loadZeroChatSecrets).toHaveBeenCalledWith(['provider-1'])
  })

  it('keeps startup usable when the initial locale chunk fails to preload', async () => {
    const services = createServices({
      loadLocale: vi.fn(async () => {
        throw new Error('chunk unavailable')
      }),
      resolveInitialLocale: vi.fn((): Locale => 'fr-FR'),
    })

    await expect(hydrateAppBootstrap(services)).resolves.toMatchObject({
      locale: 'fr-FR',
    })
  })
})

describe('applyAppBootstrapResult', () => {
  it('hydrates refs and UI state from the startup result in one focused path', () => {
    const data = appData('provider-2')
    const dataRef = { current: null as AppData | null }
    const githubTokenRef = { current: '' }
    const providerKeysRef = { current: {} as Record<string, string> }
    const hydrateSyncPassphrase = vi.fn()
    const setData = vi.fn()
    const setGithubTokenValue = vi.fn()
    const setI18nRevision = vi.fn()
    const setLocale = vi.fn()
    const setProviderKeys = vi.fn()
    const setSelectedProviderId = vi.fn()
    const result = {
      data,
      githubToken: 'github-token',
      locale: 'fr-FR' as const,
      providerKeys: {
        'provider-2': 'provider-key',
      },
      selectedProviderId: 'provider-2',
      syncPassphrase: 'passphrase',
    }

    applyAppBootstrapResult(result, {
      dataRef,
      githubTokenRef,
      hydrateSyncPassphrase,
      providerKeysRef,
      setData,
      setGithubTokenValue,
      setI18nRevision,
      setLocale,
      setProviderKeys,
      setSelectedProviderId,
    })

    expect(dataRef.current).toBe(data)
    expect(githubTokenRef.current).toBe('github-token')
    expect(providerKeysRef.current).toEqual({ 'provider-2': 'provider-key' })
    expect(hydrateSyncPassphrase).toHaveBeenCalledWith('passphrase')
    expect(setLocale).toHaveBeenCalledWith('fr-FR')
    expect(setI18nRevision).toHaveBeenCalledWith(expect.any(Function))
    expect(setData).toHaveBeenCalledWith(data)
    expect(setSelectedProviderId).toHaveBeenCalledWith('provider-2')
    expect(setProviderKeys).toHaveBeenCalledWith({ 'provider-2': 'provider-key' })
    expect(setGithubTokenValue).toHaveBeenCalledWith('github-token')
  })

  it('does not let a stale startup result overwrite newer in-memory data', () => {
    const stale = {
      ...appData('provider-1'),
      preferences: {
        ...appData('provider-1').preferences,
        firstRunDone: false,
      },
      updatedAt: 10,
    }
    const newer = {
      ...appData('provider-1'),
      preferences: {
        ...appData('provider-1').preferences,
        firstRunDone: true,
      },
      updatedAt: 20,
    }
    const dataRef = { current: newer as AppData | null }
    const githubTokenRef = { current: '' }
    const providerKeysRef = { current: {} as Record<string, string> }
    const hydrateSyncPassphrase = vi.fn()
    const setData = vi.fn()
    const setGithubTokenValue = vi.fn()
    const setI18nRevision = vi.fn()
    const setLocale = vi.fn()
    const setProviderKeys = vi.fn()
    const setSelectedProviderId = vi.fn()

    applyAppBootstrapResult(
      {
        data: stale,
        githubToken: 'github-token',
        locale: 'zh-CN',
        providerKeys: {
          'provider-1': 'provider-key',
        },
        selectedProviderId: 'provider-1',
        syncPassphrase: 'passphrase',
      },
      {
        dataRef,
        githubTokenRef,
        hydrateSyncPassphrase,
        providerKeysRef,
        setData,
        setGithubTokenValue,
        setI18nRevision,
        setLocale,
        setProviderKeys,
        setSelectedProviderId,
      },
    )

    expect(dataRef.current).toBe(newer)
    expect(dataRef.current?.preferences.firstRunDone).toBe(true)
    expect(setData).not.toHaveBeenCalled()
    expect(setSelectedProviderId).not.toHaveBeenCalled()
    expect(providerKeysRef.current).toEqual({ 'provider-1': 'provider-key' })
    expect(setProviderKeys).toHaveBeenCalledWith({ 'provider-1': 'provider-key' })
    expect(setGithubTokenValue).toHaveBeenCalledWith('github-token')
  })
})

describe('formatAppBootstrapError', () => {
  it('redacts secrets before surfacing startup load failures', () => {
    expect(
      formatAppBootstrapError(new Error('startup failed: api_key=sk-secret123456')),
    ).toBe('startup failed: api_key: [redacted]')
  })
})

describe('resolveInitialBootstrapLocale', () => {
  it('uses system languages for system mode and respects explicit choices', () => {
    expect(
      resolveInitialBootstrapLocale(appData(), () => ['fr-FR', 'en-US']),
    ).toBe('fr-FR')

    const explicit = {
      ...appData(),
      preferences: {
        ...appData().preferences,
        language: 'ja-JP' as const,
      },
    }

    expect(
      resolveInitialBootstrapLocale(explicit, () => ['fr-FR', 'en-US']),
    ).toBe('ja-JP')
  })
})
