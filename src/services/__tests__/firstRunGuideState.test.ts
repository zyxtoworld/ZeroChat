import { describe, expect, it } from 'vitest'

import {
  providerFromPreset,
  providerPresets,
} from '../../data/presets'
import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import { deriveFirstRunGuideState } from '../firstRunGuideState'

const labels: Record<string, string> = {
  'field.providerKey': 'Provider key',
  'guide.localSyncNote': 'Local sync note',
  'guide.requirement.baseUrl': 'Base URL required',
  'guide.requirement.key': 'Key required',
  'guide.requirement.model': 'Model required',
  'guide.requirement.modelAndKey': 'Model and key required',
  'sync.compare.cloudflare.pro': 'Cloudflare sync note',
  'sync.compare.gist.pro': 'Gist sync note',
}

const t: Translator = (key, values) => {
  if (key === 'guide.providerKeyTitle') {
    return `Key for ${values?.provider ?? ''}`
  }

  return labels[key] ?? key
}

function preset(id: string) {
  const item = providerPresets.find((preset) => preset.id === id)

  if (!item) {
    throw new Error(`Missing preset: ${id}`)
  }

  return item
}

function provider(
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    ...providerFromPreset(preset('openai')),
    ...overrides,
  }
}

function data(
  selectedProvider: ProviderConfig = provider(),
  overrides: Partial<AppData> = {},
): AppData {
  return {
    version: 1,
    providers: [selectedProvider],
    conversations: [],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 8000,
      maxAutoSkills: 4,
    },
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
      gistFile: 'zerochat-sync.json',
    },
    preferences: {
      firstRunDone: false,
      theme: 'system',
      language: 'system',
      compactMode: false,
      activeConversationId: undefined,
      chatContextMessageLimit: 20,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
    },
    updatedAt: 1,
    ...overrides,
  }
}

function derive(
  selectedProvider: ProviderConfig | null,
  options: Partial<Parameters<typeof deriveFirstRunGuideState>[0]> = {},
) {
  return deriveFirstRunGuideState({
    checkingProviderId: '',
    data: selectedProvider ? data(selectedProvider) : null,
    providerConnectivityResults: {},
    providerKeys: {},
    selectedPresetId: 'openai',
    selectedProvider,
    t,
    ...options,
  })
}

describe('first-run guide state', () => {
  it('keeps featured provider cards while adding the selected non-featured preset', () => {
    const mistral = providerFromPreset(preset('mistral'))
    const state = derive(mistral, { selectedPresetId: 'mistral' })
    const cardIds = state.guideProviderCardPresets.map((item) => item.id)

    expect(cardIds).toContain('openai')
    expect(cardIds).toContain('anthropic')
    expect(cardIds).toContain('mistral')
    expect(state.guideUsesCustomProvider).toBe(false)
  })

  it('marks custom relays without replacing the mainstream provider cards', () => {
    const custom = providerFromPreset(preset('custom-openai-relay'))
    const state = derive(custom, { selectedPresetId: 'custom-openai-relay' })

    expect(state.guideUsesCustomProvider).toBe(true)
    expect(state.guideProviderCardPresets.map((item) => item.id)).not.toContain(
      'custom-openai-relay',
    )
  })

  it('prioritizes setup requirements in the order users can act on them', () => {
    const missingBaseUrl = provider({ baseUrl: '', model: '', models: [] })
    const missingModelAndKey = provider({ model: '', models: [] })
    const missingModel = provider({ model: '', models: [] })
    const missingKey = provider()
    const ready = provider()

    expect(derive(missingBaseUrl).guideRequirement).toBe('Base URL required')
    expect(derive(missingModelAndKey).guideRequirement).toBe(
      'Model and key required',
    )
    expect(
      derive(missingModel, {
        providerKeys: { [missingModel.id]: 'sk-test' },
      }).guideRequirement,
    ).toBe('Model required')
    expect(derive(missingKey).guideRequirement).toBe('Key required')

    const readyState = derive(ready, {
      providerKeys: { [ready.id]: 'sk-test' },
    })

    expect(readyState.guideRequirement).toBe('')
    expect(readyState.guideCanFinish).toBe(true)
  })

  it('allows custom relay setup when a proxy or Worker owns the provider key', () => {
    const relay = provider({
      custom: true,
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    const state = derive(relay, {
      selectedPresetId: 'custom-openai-relay',
    })

    expect(state.guideUsesCustomProvider).toBe(true)
    expect(state.selectedProviderKey).toBe('')
    expect(state.guideRequirement).toBe('')
    expect(state.guideCanFinish).toBe(true)
  })

  it('treats the Cloudflare Worker fallback as the first-run request proxy', () => {
    const relay = provider({
      custom: true,
      needsApiKey: false,
      proxyUrl: undefined,
    })
    const state = derive(relay, {
      selectedPresetId: 'custom-openai-relay',
      data: data(relay, {
        sync: {
          mode: 'cloudflare',
          autoSync: true,
          encryptionEnabled: true,
          workerEndpoint: 'https://sync.example.workers.dev',
        },
      }),
    })

    expect(state.selectedProviderRequest?.proxyUrl).toBe(
      'https://sync.example.workers.dev',
    )
    expect(state.selectedProviderKey).toBe('')
    expect(state.guideRequirement).toBe('')
    expect(state.guideCanFinish).toBe(true)
  })

  it('derives connectivity, model, key, and sync copy for the visible guide', () => {
    const selected = provider()
    const state = derive(selected, {
      checkingProviderId: `provider:${selected.id}`,
      data: data(selected, {
        sync: {
          mode: 'gist',
          autoSync: true,
          encryptionEnabled: true,
          gistFile: 'zerochat-sync.json',
        },
      }),
      providerConnectivityResults: {
        [selected.id]: {
          field: 'providerKey',
          message: 'Bad key',
          retryable: false,
          tone: 'error',
        },
      },
      providerKeys: { [selected.id]: 'sk-test' },
    })

    expect(state.selectedProviderModels.length).toBeGreaterThan(0)
    expect(state.selectedProviderChatModels.length).toBeGreaterThan(0)
    expect(state.selectedProviderKey).toBe('sk-test')
    expect(state.selectedProviderConnectivityField).toBe('providerKey')
    expect(state.selectedProviderConnectivityStatusId).toBe(
      `provider-connectivity-status-${selected.id}`,
    )
    expect(state.guideProviderKeyTitle).toBe('Key for OpenAI')
    expect(state.guideSyncNote).toBe('Gist sync note')
    expect(state.guideCheckingProvider).toBe(true)
  })
})
