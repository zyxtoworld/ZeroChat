import { describe, expect, it } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import { deriveComposerReadiness } from '../composerReadiness'

const t: Translator = (key, values) =>
  values ? `${key}:${JSON.stringify(values)}` : key

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    ...providerFromPreset(providerPresets[0]),
    id: 'provider-1',
    name: 'OpenAI',
    model: 'gpt-5-mini',
    imageModel: 'gpt-image-1',
    models: ['gpt-5-mini', 'gpt-image-1'],
    ...patch,
  }
}

function appData(providers: ProviderConfig[]): AppData {
  return {
    version: 1,
    providers,
    conversations: [],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    preferences: {
      compactMode: false,
      firstRunDone: true,
      language: 'zh-CN',
      theme: 'system',
    },
    updatedAt: 1,
  }
}

describe('composer readiness derivation', () => {
  it('derives visible chat header labels and ready chat state', () => {
    const active = provider()
    const state = deriveComposerReadiness({
      activeImageModel: 'gpt-image-1',
      activeModel: 'gpt-5-mini',
      activeProvider: active,
      composerMode: 'chat',
      data: appData([active]),
      enabledChatProviders: [active],
      providerKeys: { [active.id]: 'key' },
      proxyTokenAvailable: false,
      t,
    })

    expect(state.activeProviderAvailable).toBe(true)
    expect(state.activeProviderLabel).toBe('OpenAI')
    expect(state.activeModelLabel).toBe('gpt-5-mini')
    expect(state.activeChatRequirement).toBe('')
    expect(state.welcomeModel).toBe('gpt-5-mini')
    expect(state.welcomeGenerationRequirement).toBe('')
    expect(state.welcomeNeedsProviderKey).toBe(true)
  })

  it('uses image model labels and input setup requirements for image mode', () => {
    const active = provider({ imageModel: '', models: ['gpt-5-mini'] })
    const state = deriveComposerReadiness({
      activeImageModel: '',
      activeModel: 'gpt-5-mini',
      activeProvider: active,
      composerMode: 'image',
      data: appData([active]),
      enabledChatProviders: [active],
      providerKeys: { [active.id]: 'key' },
      proxyTokenAvailable: false,
      t,
    })

    expect(state.activeModelLabel).toBe('option.noImageModels')
    expect(state.activeImageRequirement).toBe('notice.sendMissingModel')
    expect(state.welcomeModel).toBe('')
    expect(state.welcomeGenerationRequirement).toBe('notice.sendMissingModel')
  })

  it('uses editing-capable models for image edit and inpaint readiness', () => {
    const active = provider({
      imageModel: 'dall-e-3',
      models: ['gpt-5-mini', 'dall-e-3', 'gpt-image-1'],
    })

    for (const imageTaskMode of ['edit', 'inpaint'] as const) {
      const state = deriveComposerReadiness({
        activeImageModel: 'dall-e-3',
        activeModel: 'gpt-5-mini',
        activeProvider: active,
        composerMode: 'image',
        data: appData([active]),
        enabledChatProviders: [active],
        imageTaskMode,
        providerKeys: { [active.id]: 'key' },
        proxyTokenAvailable: false,
        t,
      })

      expect(state.activeModelLabel).toBe('gpt-image-1')
      expect(state.activeImageRequirement).toBe('')
      expect(state.welcomeModel).toBe('gpt-image-1')
    }

    const noEditor = provider({
      imageModel: 'dall-e-3',
      models: ['gpt-5-mini', 'dall-e-3'],
    })
    const blocked = deriveComposerReadiness({
      activeImageModel: 'dall-e-3',
      activeModel: 'gpt-5-mini',
      activeProvider: noEditor,
      composerMode: 'image',
      data: appData([noEditor]),
      enabledChatProviders: [noEditor],
      imageTaskMode: 'edit',
      providerKeys: { [noEditor.id]: 'key' },
      proxyTokenAvailable: false,
      t,
    })

    expect(blocked.activeModelLabel).toBe('option.noImageModels')
    expect(blocked.activeImageRequirement).toBe('notice.sendMissingModel')
  })

  it('uses audio models and setup requirements for audio mode', () => {
    const active = provider({
      audioTranscriptionModel: 'whisper-1',
      models: ['gpt-5-mini', 'gpt-4o-transcribe', 'whisper-1'],
    })
    const ready = deriveComposerReadiness({
      activeImageModel: 'gpt-image-1',
      activeModel: 'gpt-5-mini',
      activeProvider: active,
      composerMode: 'audio',
      data: appData([active]),
      enabledChatProviders: [active],
      providerKeys: { [active.id]: 'key' },
      proxyTokenAvailable: false,
      t,
    })

    expect(ready.activeModelLabel).toBe('whisper-1')
    expect(ready.activeAudioRequirement).toBe('')
    expect(ready.welcomeModel).toBe('whisper-1')
    expect(ready.welcomeGenerationRequirement).toBe('')

    const missingAudio = provider({
      capabilities: ['chat', 'model-list'],
      models: ['gpt-5-mini'],
    })
    const blocked = deriveComposerReadiness({
      activeImageModel: '',
      activeModel: 'gpt-5-mini',
      activeProvider: missingAudio,
      composerMode: 'audio',
      data: appData([missingAudio]),
      enabledChatProviders: [missingAudio],
      providerKeys: { [missingAudio.id]: 'key' },
      proxyTokenAvailable: false,
      t,
    })

    expect(blocked.activeModelLabel).toBe('option.noAudioModels')
    expect(blocked.activeAudioRequirement).toBe('notice.sendMissingModel')
    expect(blocked.welcomeModel).toBe('')
    expect(blocked.welcomeGenerationRequirement).toBe('notice.sendMissingModel')

    const previewOnly = provider({
      models: ['gpt-5-mini', 'gpt-4o-audio-preview'],
    })
    const previewOnlyAudio = deriveComposerReadiness({
      activeImageModel: '',
      activeModel: 'gpt-5-mini',
      activeProvider: previewOnly,
      composerMode: 'audio',
      data: appData([previewOnly]),
      enabledChatProviders: [previewOnly],
      providerKeys: { [previewOnly.id]: 'key' },
      proxyTokenAvailable: false,
      t,
    })

    expect(previewOnlyAudio.activeModelLabel).toBe('option.noAudioModels')
    expect(previewOnlyAudio.activeAudioRequirement).toBe('notice.sendMissingModel')
    expect(previewOnlyAudio.welcomeModel).toBe('')
    expect(previewOnlyAudio.welcomeGenerationRequirement).toBe(
      'notice.sendMissingModel',
    )
  })

  it('falls back to the first enabled provider for empty-state setup guidance', () => {
    const fallback = provider({
      id: 'provider-2',
      model: 'fallback-model',
      models: ['gpt-5.2', 'gpt-5.5', 'gpt-image-2'],
    })
    const state = deriveComposerReadiness({
      activeImageModel: '',
      activeModel: '',
      activeProvider: null,
      composerMode: 'chat',
      data: appData([fallback]),
      enabledChatProviders: [fallback],
      providerKeys: { [fallback.id]: 'key' },
      proxyTokenAvailable: false,
      t,
    })

    expect(state.activeProviderAvailable).toBe(false)
    expect(state.activeProviderLabel).toBe('field.provider')
    expect(state.activeModelLabel).toBe('option.emptyModel')
    expect(state.welcomeProviderAvailable).toBe(true)
    expect(state.welcomeModel).toBe('gpt-5.5')
    expect(state.welcomeGenerationRequirement).toBe('')
  })

  it('uses only active Cloudflare credential availability for proxied readiness', () => {
    const active = provider({
      needsApiKey: false,
      proxyUrl: 'https://sync.example.workers.dev',
    })
    const options = {
      activeImageModel: 'gpt-image-1',
      activeModel: 'gpt-5-mini',
      activeProvider: active,
      composerMode: 'chat' as const,
      data: appData([active]),
      enabledChatProviders: [active],
      providerKeys: {},
      t,
    }
    const blocked = deriveComposerReadiness({
      ...options,
      proxyTokenAvailable: false,
    })
    const ready = deriveComposerReadiness({
      ...options,
      proxyTokenAvailable: true,
    })

    expect(blocked.activeChatRequirement).toBe(
      'error.cloudflareAccessKeyRequired',
    )
    expect(blocked.welcomeGenerationRequirement).toBe(
      'error.cloudflareAccessKeyRequired',
    )
    expect(blocked.welcomeNeedsProviderKey).toBe(false)
    expect(ready.activeChatRequirement).toBe('')
    expect(ready.welcomeGenerationRequirement).toBe('')
  })

  it('keeps the no-enabled-provider empty state explicit', () => {
    const state = deriveComposerReadiness({
      activeImageModel: '',
      activeModel: '',
      activeProvider: null,
      composerMode: 'chat',
      data: appData([]),
      enabledChatProviders: [],
      providerKeys: {},
      proxyTokenAvailable: false,
      t,
    })

    expect(state.welcomeProviderAvailable).toBe(false)
    expect(state.welcomeProviderEnabled).toBe(false)
    expect(state.welcomeGenerationRequirement).toBe('option.noEnabledProviders')
  })
})
