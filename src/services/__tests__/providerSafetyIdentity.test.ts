import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppData, ProviderConfig } from '../../types'

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function unsafeProvider(): ProviderConfig {
  return {
    id: 'provider-unsafe',
    name: 'Unsafe provider',
    kind: 'openai-compatible',
    baseUrl: 'https://192.168.1.10/v1',
    model: 'unsafe-model',
    enabled: true,
    needsApiKey: true,
    createdAt: 1000,
    updatedAt: 1000,
  }
}

function importedData(): AppData {
  return {
    version: 1,
    providers: [unsafeProvider()],
    conversations: [
      {
        id: 'conversation-1',
        title: 'Imported conversation',
        providerId: 'provider-unsafe',
        model: 'unsafe-model',
        messages: [],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
    },
    updatedAt: 1000,
  }
}

describe('provider safety identity boundaries', () => {
  it('does not reuse a removed provider id or retain its secret for the fallback', async () => {
    vi.resetModules()
    const randomUUID = vi.fn(() => 'provider-unsafe')
    vi.stubGlobal('crypto', { randomUUID })

    const { pruneProviderSecrets, sanitizeRemoteOnlyAppData } = await import(
      '../providerSafety'
    )
    const sanitized = sanitizeRemoteOnlyAppData(importedData())
    const fallbackId = sanitized.data.providers[0]?.id

    expect(fallbackId).toBeDefined()
    expect(fallbackId).not.toBe('provider-unsafe')
    expect(
      pruneProviderSecrets(
        { providerKeys: { 'provider-unsafe': 'legacy-secret' } },
        sanitized.data.providers.map((provider) => provider.id),
      ),
    ).toEqual({ providerKeys: {} })
    expect(randomUUID).toHaveBeenCalledOnce()
  })
})
