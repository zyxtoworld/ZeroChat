import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ANTHROPIC_CAPABILITIES,
  OPENAI_DEFAULT_AUDIO_SPEECH_MODEL,
  OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
  OPENAI_DEFAULT_CHAT_MODEL,
  OPENAI_DEFAULT_EMBEDDING_MODEL,
  OPENAI_DEFAULT_IMAGE_MODEL,
  OPENAI_DEFAULT_MODERATION_MODEL,
  OPENAI_DEFAULT_REALTIME_MODEL,
  OPENAI_FULL_CAPABILITIES,
  providerFromPreset,
} from '../../data/presets'
import type {
  AppData,
  Conversation,
  ProviderConfig,
} from '../../types'
import type { Translator } from '../../i18n'
import {
  browserProviderKey,
  clearerCustomProviderName,
  defaultCustomPresetIdForProvider,
  displayProviderName,
  endpointLabelsForProvider,
  fallbackCapabilitiesForProvider,
  modelForConversation,
  normalizeProviderName,
  normalizeOfficialProviderContracts,
  presetById,
  presetIdForProvider,
  preferredProviderId,
  providerAccentId,
  providerAccentIdForPresetId,
  providerDefaultsFromPreset,
  providerForAiRequest,
  providerListStatus,
  reorderProviders,
  shouldUseBrowserProviderKey,
} from '../providerConfig'
import { customOpenAiRelayNames } from '../providerCustomOpenAiNames'
import { isDefaultCustomOpenAiRelayName } from '../providerModelCore'

const t: Translator = (key, values) => {
  const translations: Record<string, string> = {
    'provider.preset.custom-openai-relay': 'Custom relay',
    'provider.kind.openaiCompatible': 'OpenAI compatible',
    'provider.kind.openaiResponses': 'OpenAI Responses',
    'provider.kind.anthropic': 'Anthropic',
    'option.noConfiguredModels': 'No models',
  }

  if (key === 'settings.modelCount') {
    return `${values?.count ?? 0} models`
  }

  return translations[key] ?? key
}

const OPENAI_DEFAULT_MODELS = [
  OPENAI_DEFAULT_CHAT_MODEL,
  OPENAI_DEFAULT_IMAGE_MODEL,
  OPENAI_DEFAULT_AUDIO_SPEECH_MODEL,
  OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
  OPENAI_DEFAULT_EMBEDDING_MODEL,
  OPENAI_DEFAULT_MODERATION_MODEL,
  OPENAI_DEFAULT_REALTIME_MODEL,
]

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    kind: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2',
    models: ['gpt-5.4-mini', 'gpt-image-2'],
    capabilities: OPENAI_FULL_CAPABILITIES,
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function appData(overrides: Partial<AppData> = {}): AppData {
  return {
    version: 1,
    providers: [provider()],
    conversations: [],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 6000,
      maxAutoSkills: 4,
    },
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'zh-CN',
      compactMode: false,
    },
    updatedAt: 1,
    ...overrides,
  }
}

describe('provider config helpers', () => {
  it('keeps the static custom OpenAI relay matcher exact across locales', () => {
    expect(customOpenAiRelayNames.every(isDefaultCustomOpenAiRelayName)).toBe(true)
    expect(
      [
        'Custom relay (OpenAI Responses)',
        'Custom OpenAI relay',
        'Custom relay (OpenAI compatible) extra',
        'OpenAI compatible relay',
        'カスタムリレー (OpenAI compatible)',
        'カスタム リレー（OpenAI 互換）',
        '맞춤형 릴레이(OpenAI 호환)',
        '사용자 지정 릴레이(OpenAI compatible)',
      ].some(isDefaultCustomOpenAiRelayName),
    ).toBe(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('localizes known default custom provider names', () => {
    expect(
      displayProviderName(
        provider({
          name: '自定OpenAI 兼容中转',
          kind: 'openai-compatible',
          baseUrl: 'https://relay.example.com/v1',
          custom: true,
        }),
        t,
      ),
    ).toBe('Custom relay')
  })

  it('normalizes custom relay aliases outside the broad provider config table', () => {
    expect(normalizeProviderName('  Custom   relay (OpenAI compatible)  ')).toBe(
      'custom relay (openai compatible)',
    )
    expect(
      defaultCustomPresetIdForProvider(
        provider({
          name: 'カスタムリレー（OpenAI Responses）',
          kind: 'openai-responses',
          baseUrl: 'https://relay.example.com/v1',
          custom: true,
        }),
      ),
    ).toBe('custom-responses-relay')
    expect(
      defaultCustomPresetIdForProvider(
        provider({
          name: 'Custom relay (Anthropic / Claude)',
          kind: 'openai-compatible',
          baseUrl: 'https://relay.example.com/v1',
          custom: true,
        }),
      ),
    ).toBeUndefined()
  })

  it('keeps custom preset identity stable across host locale casing rules', () => {
    const originalToLocaleLowerCase = String.prototype.toLocaleLowerCase
    const localeSensitiveLowerCase = vi
      .spyOn(String.prototype, 'toLocaleLowerCase')
      .mockImplementation(function (this: string) {
        return originalToLocaleLowerCase.call(this).replaceAll('i', 'ı')
      })

    try {
      expect(
        defaultCustomPresetIdForProvider(
          provider({
            name: 'Custom relay (OpenAI compatible)',
            kind: 'openai-compatible',
            baseUrl: 'https://relay.example.com/v1',
            custom: true,
          }),
        ),
      ).toBe('custom-openai-relay')
    } finally {
      localeSensitiveLowerCase.mockRestore()
    }
  })

  it('resolves the active provider with deterministic conversation and provider fallbacks', () => {
    const activeConversation: Conversation = {
      id: 'active-conversation',
      title: 'Active',
      providerId: 'active-provider',
      model: 'model',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const firstConversation = { ...activeConversation, id: 'first-conversation' }

    expect(
      preferredProviderId(
        appData({
          providers: [provider({ id: 'fallback-provider' })],
          conversations: [firstConversation, activeConversation],
          preferences: {
            ...appData().preferences,
            activeConversationId: activeConversation.id,
          },
        }),
      ),
    ).toBe('active-provider')
    expect(
      preferredProviderId(
        appData({
          providers: [provider({ id: 'fallback-provider' })],
          conversations: [firstConversation],
        }),
      ),
    ).toBe('active-provider')
    expect(
      preferredProviderId(
        appData({ providers: [], conversations: [] }),
      ),
    ).toBe('')
  })

  it('selects exact and kind-specific custom preset ids', () => {
    expect(presetIdForProvider(providerFromPreset(presetById('openai')))).toBe(
      'openai',
    )
    expect(
      presetIdForProvider(
        provider({
          name: 'Anthropic relay',
          kind: 'anthropic',
          baseUrl: 'https://relay.example.com/v1',
        }),
      ),
    ).toBe('custom-anthropic-relay')
    expect(
      presetIdForProvider(
        provider({
          name: 'Responses relay',
          kind: 'openai-responses',
          baseUrl: 'https://relay.example.com/v1',
        }),
      ),
    ).toBe('custom-responses-relay')
    expect(
      presetIdForProvider(
        provider({
          name: 'Compatible relay',
          kind: 'openai-compatible',
          baseUrl: 'https://relay.example.com/v1',
        }),
      ),
    ).toBe('custom-openai-relay')
    expect(presetById('missing-preset').id).toBe(presetById('openai').id)
  })

  it('keeps stale localized custom relay names readable during migration', () => {
    expect(
      clearerCustomProviderName(
        provider({
          name: '自定Responses 中转',
          custom: true,
        }),
      ),
    ).toBe('自定义中转（OpenAI Responses）')
    expect(
      clearerCustomProviderName(
        provider({
          name: '自定Responses 中转',
          custom: false,
        }),
      ),
    ).toBe('自定Responses 中转')
  })

  it('creates official OpenAI providers with the current full-capability defaults', () => {
    expect(providerFromPreset(presetById('openai'))).toMatchObject({
      name: 'OpenAI',
      kind: 'openai-responses',
      model: OPENAI_DEFAULT_CHAT_MODEL,
      imageModel: OPENAI_DEFAULT_IMAGE_MODEL,
      audioSpeechModel: OPENAI_DEFAULT_AUDIO_SPEECH_MODEL,
      audioTranscriptionModel: OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
      embeddingModel: OPENAI_DEFAULT_EMBEDDING_MODEL,
      moderationModel: OPENAI_DEFAULT_MODERATION_MODEL,
      realtimeModel: OPENAI_DEFAULT_REALTIME_MODEL,
      models: OPENAI_DEFAULT_MODELS,
      capabilities: OPENAI_FULL_CAPABILITIES,
    })
  })

  it('uses the runtime id fallback when WebCrypto cannot create a Provider id', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('randomUUID unavailable')
      },
    })

    expect(providerFromPreset(presetById('openai')).id).toMatch(
      /^provider-[A-Za-z0-9_-]+$/,
    )
  })

  it('backfills official full-capability defaults when saved models are blank or mismatched', () => {
    const defaults = providerDefaultsFromPreset(
      provider({
        imageModel: 'gpt-5.4-mini',
        models: ['gpt-5.4-mini'],
      }),
      presetById('openai'),
    )

    expect(defaults.model).toBe(OPENAI_DEFAULT_CHAT_MODEL)
    expect(defaults.imageModel).toBe(OPENAI_DEFAULT_IMAGE_MODEL)
    expect(defaults.audioSpeechModel).toBe(OPENAI_DEFAULT_AUDIO_SPEECH_MODEL)
    expect(defaults.audioTranscriptionModel).toBe(
      OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
    )
    expect(defaults.embeddingModel).toBe(OPENAI_DEFAULT_EMBEDDING_MODEL)
    expect(defaults.moderationModel).toBe(OPENAI_DEFAULT_MODERATION_MODEL)
    expect(defaults.realtimeModel).toBe(OPENAI_DEFAULT_REALTIME_MODEL)
    expect(defaults.models).toEqual([
      'gpt-5.4-mini',
      ...OPENAI_DEFAULT_MODELS,
    ])
  })

  it('normalizes stale official provider contracts with capabilities and image defaults', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)

    const normalized = normalizeOfficialProviderContracts(
      appData({
        providers: [
          provider({
            needsApiKey: false,
            imageModel: '',
            models: ['gpt-5.4-mini'],
            capabilities: ['chat'],
          }),
        ],
      }),
    )

    expect(normalized.providers[0]).toMatchObject({
      model: OPENAI_DEFAULT_CHAT_MODEL,
      imageModel: OPENAI_DEFAULT_IMAGE_MODEL,
      audioSpeechModel: OPENAI_DEFAULT_AUDIO_SPEECH_MODEL,
      audioTranscriptionModel: OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
      embeddingModel: OPENAI_DEFAULT_EMBEDDING_MODEL,
      moderationModel: OPENAI_DEFAULT_MODERATION_MODEL,
      realtimeModel: OPENAI_DEFAULT_REALTIME_MODEL,
      models: ['gpt-5.4-mini', ...OPENAI_DEFAULT_MODELS],
      capabilities: OPENAI_FULL_CAPABILITIES,
      needsApiKey: true,
      updatedAt: 1234,
    })
    expect(normalized.updatedAt).toBe(1234)
  })

  it('does not lower app or provider timestamps while normalizing official providers', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)

    const normalized = normalizeOfficialProviderContracts(
      appData({
        updatedAt: 9000,
        providers: [
          provider({
            needsApiKey: false,
            imageModel: '',
            models: ['gpt-5.4-mini'],
            capabilities: ['chat'],
            updatedAt: 8000,
          }),
        ],
      }),
    )

    expect(normalized.updatedAt).toBe(9000)
    expect(normalized.providers[0].updatedAt).toBe(8000)
    expect(normalized.providers[0]).toMatchObject({
      imageModel: 'gpt-image-2',
      capabilities: OPENAI_FULL_CAPABILITIES,
      needsApiKey: true,
    })
  })

  it('injects the Cloudflare Worker proxy only for eligible browser AI requests', () => {
    const syncData = appData({
      sync: {
        mode: 'cloudflare',
        autoSync: true,
        encryptionEnabled: true,
        workerEndpoint: 'https://sync.example.workers.dev',
      },
    })

    expect(providerForAiRequest(provider({ proxyUrl: undefined }), syncData)).toMatchObject({
      proxyUrl: 'https://sync.example.workers.dev',
    })
    expect(
      providerForAiRequest(
        provider({ proxyUrl: 'https://provider-proxy.example' }),
        syncData,
      ).proxyUrl,
    ).toBe('https://provider-proxy.example')
    expect(
      providerForAiRequest(provider({ proxyUrl: undefined }), {
        ...syncData,
        sync: { ...syncData.sync, mode: 'gist' },
      }).proxyUrl,
    ).toBeUndefined()
  })

  it('strips proxy URLs from direct client request providers', () => {
    expect(
      providerForAiRequest(
        provider({
          clientRequestMode: true,
          proxyUrl: 'https://sync.example.workers.dev',
        }),
        appData(),
      ).proxyUrl,
    ).toBeUndefined()
  })

  it('keeps browser key policy aligned with Worker-hosted proxy mode', () => {
    const hostedByWorker = provider({
      needsApiKey: false,
      proxyUrl: 'https://sync.example.workers.dev',
    })
    const browserKeyByProvider = {
      [hostedByWorker.id]: 'stale-browser-key',
    }

    expect(shouldUseBrowserProviderKey(hostedByWorker)).toBe(false)
    expect(browserProviderKey(hostedByWorker, browserKeyByProvider)).toBe('')
    expect(
      shouldUseBrowserProviderKey(
        provider({ needsApiKey: false, proxyUrl: undefined }),
      ),
    ).toBe(true)
    expect(
      shouldUseBrowserProviderKey(
        provider({
          clientRequestMode: true,
          needsApiKey: false,
          proxyUrl: 'https://sync.example.workers.dev',
        }),
      ),
    ).toBe(true)
  })

  it('derives provider accents and status labels for every visible state', () => {
    expect(providerAccentIdForPresetId('cloudflare-ai-gateway-openai')).toBe(
      'cloudflare-ai-gateway',
    )
    expect(
      providerAccentId(
        provider({
          name: 'Unknown relay',
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          custom: true,
        }),
      ),
    ).toBe('openai')
    expect(
      providerAccentId(
        provider({
          name: 'Anthropic relay',
          kind: 'anthropic',
          baseUrl: 'https://relay.example.com/v1',
          custom: true,
        }),
      ),
    ).toBe('custom-anthropic-relay')
    expect(
      providerAccentId(
        provider({
          name: 'Responses relay',
          kind: 'openai-responses',
          baseUrl: 'https://relay.example.com/v1',
          custom: true,
        }),
      ),
    ).toBe('custom-responses-relay')

    const disabled = providerListStatus(
      provider({ enabled: false }),
      provider(),
      '',
      undefined,
      t,
    )
    expect(disabled.tone).toBe('muted')
    expect(
      providerListStatus(provider(), provider(), '', { tone: 'success' }, t).tone,
    ).toBe('success')
    expect(
      providerListStatus(provider(), provider(), '', { tone: 'error' }, t).tone,
    ).toBe('error')
    expect(
      providerListStatus(provider(), provider(), '', undefined, t).tone,
    ).toBe('warning')
    expect(
      providerListStatus(
        provider({ needsApiKey: false, proxyUrl: 'https://proxy.example.com' }),
        provider({ needsApiKey: false, proxyUrl: 'https://proxy.example.com' }),
        '',
        undefined,
        t,
      ).tone,
    ).toBe('muted')
  })

  it('uses the strongest available fetched chat model when conversation and provider defaults are stale', () => {
    expect(
      modelForConversation(
        {
          id: 'conversation-1',
          title: 'Relay chat',
          providerId: 'provider-1',
          model: 'missing-model',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
        },
        provider({
          model: 'missing-default',
          models: [
            'codex-auto-review',
            'gpt-5.2',
            'gpt-5.5-openai-compact',
            'gpt-5.4-mini',
            'gpt-5.5',
            'gpt-image-2',
          ],
        }),
      ),
    ).toBe('gpt-5.5')

    expect(
      modelForConversation(
        null,
        provider({
          model: 'missing-default',
          models: ['gpt-4o-audio-preview'],
        }),
      ),
    ).toBe('gpt-4o-audio-preview')
  })

  it('selects an existing conversation model, provider model, or no-model fallback', () => {
    const available = provider({
      model: 'gpt-5.4-mini',
      models: ['gpt-5.4-mini', 'gpt-5.5'],
    })
    const conversation: Conversation = {
      id: 'conversation-1',
      title: 'Conversation',
      providerId: available.id,
      model: 'gpt-5.5',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    }

    expect(modelForConversation(conversation, available)).toBe('gpt-5.5')
    expect(
      modelForConversation(
        { ...conversation, model: 'missing-model' },
        available,
      ),
    ).toBe('gpt-5.4-mini')
    expect(
      modelForConversation(null, provider({ model: '', models: [] })),
    ).toBe('')
  })

  it('falls back to capability families when a provider has no explicit capabilities', () => {
    expect(
      fallbackCapabilitiesForProvider(
        provider({
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          capabilities: undefined,
        }),
      ),
    ).toEqual(OPENAI_FULL_CAPABILITIES)
    expect(
      fallbackCapabilitiesForProvider(
        provider({
          name: 'Anthropic relay',
          kind: 'anthropic',
          baseUrl: 'https://relay.example.com/v1',
          capabilities: undefined,
        }),
      ),
    ).toEqual(ANTHROPIC_CAPABILITIES)
    expect(
      fallbackCapabilitiesForProvider(
        provider({
          name: 'Responses relay',
          kind: 'openai-responses',
          baseUrl: 'https://relay.example.com/v1',
          capabilities: undefined,
        }),
      ).length,
    ).toBeGreaterThan(0)
    expect(
      fallbackCapabilitiesForProvider(
        provider({
          name: 'Compatible relay',
          kind: 'openai-compatible',
          baseUrl: 'https://relay.example.com/v1',
          capabilities: undefined,
        }),
      ).length,
    ).toBeGreaterThan(0)
  })

  it('keeps enabled providers before disabled providers after reordering', () => {
    expect(
      reorderProviders(
        [
          provider({ id: 'a', enabled: true }),
          provider({ id: 'b', enabled: false }),
          provider({ id: 'c', enabled: true }),
        ],
        'b',
        'a',
      ).map((item) => item.id),
    ).toEqual(['a', 'c', 'b'])
  })

  it('derives endpoint labels from fallback capabilities', () => {
    expect(
      endpointLabelsForProvider(
        provider({
          models: [
            'gpt-5.4-mini',
            'gpt-image-2',
            'tts-1',
            'gpt-4o-transcribe',
            'text-embedding-3-large',
            'omni-moderation-latest',
            'gpt-realtime',
          ],
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        '/images/generations',
        '/images/edits',
        '/audio/speech',
        '/audio/transcriptions',
        '/embeddings',
        '/moderations',
        '/realtime',
        '/realtime/client_secrets',
      ]),
    )
    const chatOnlyEndpointLabels = endpointLabelsForProvider(
      provider({
        capabilities: [
          'chat',
          'image-generation',
          'image-editing',
          'embeddings',
          'moderation',
          'realtime',
          'model-list',
        ],
        models: ['gpt-5.4-mini'],
      }),
    )

    expect(chatOnlyEndpointLabels).not.toEqual(
      expect.arrayContaining([
        '/images/generations',
        '/images/edits',
        '/embeddings',
        '/moderations',
        '/realtime',
        '/realtime/client_secrets',
      ]),
    )
    expect(chatOnlyEndpointLabels).not.toEqual(
      expect.arrayContaining(['/embeddings']),
    )
    expect(chatOnlyEndpointLabels).not.toEqual(
      expect.arrayContaining(['/moderations']),
    )
    expect(chatOnlyEndpointLabels).not.toEqual(
      expect.arrayContaining(['/realtime']),
    )
    expect(
      endpointLabelsForProvider(
        provider({
          capabilities: ['chat', 'image-generation', 'image-editing', 'model-list'],
          models: ['gpt-5.4-mini', 'gpt-image-2'],
        }),
      ),
    ).toEqual(expect.arrayContaining(['/images/generations', '/images/edits']))
    expect(
      endpointLabelsForProvider(
        provider({
          capabilities: ['chat', 'audio', 'model-list'],
          models: ['gpt-5.4-mini', 'gpt-4o-audio-preview'],
        }),
      ),
    ).not.toEqual(expect.arrayContaining(['/audio/speech']))
    expect(
      endpointLabelsForProvider(
        provider({
          capabilities: ['chat', 'audio', 'model-list'],
          models: ['gpt-5.4-mini', 'gpt-4o-audio-preview'],
        }),
      ),
    ).not.toEqual(expect.arrayContaining(['/audio/transcriptions']))
    expect(
      endpointLabelsForProvider(
        provider({
          capabilities: ['chat', 'audio', 'model-list'],
          models: ['gpt-5.4-mini', 'tts-1'],
        }),
      ),
    ).toEqual(expect.arrayContaining(['/audio/speech']))
    expect(
      endpointLabelsForProvider(
        provider({
          capabilities: ['chat', 'audio', 'model-list'],
          models: ['gpt-5.4-mini', 'gpt-4o-transcribe'],
        }),
      ),
    ).toEqual(expect.arrayContaining(['/audio/transcriptions']))
    expect(
      endpointLabelsForProvider(
        provider({
          name: 'Anthropic',
          kind: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          capabilities: ANTHROPIC_CAPABILITIES,
        }),
      ),
    ).not.toEqual(expect.arrayContaining(['/images/generations']))
  })

  it('treats the custom OpenAI-compatible relay as full-capability but model-gated', () => {
    const customPresetProvider = providerFromPreset(
      presetById('custom-openai-relay'),
    )

    expect(customPresetProvider.capabilities).toEqual(OPENAI_FULL_CAPABILITIES)
    expect(
      fallbackCapabilitiesForProvider(
        provider({
          name: 'Custom relay (OpenAI compatible)',
          kind: 'openai-compatible',
          baseUrl: 'https://relay.example.com/v1',
          custom: true,
          capabilities: ['chat', 'embeddings', 'model-list'],
        }),
      ),
    ).toEqual(OPENAI_FULL_CAPABILITIES)
    expect(
      endpointLabelsForProvider(
        provider({
          name: 'Custom relay (OpenAI compatible)',
          kind: 'openai-compatible',
          baseUrl: 'https://relay.example.com/v1',
          custom: true,
          capabilities: ['chat', 'embeddings', 'model-list'],
          models: [
            'gpt-5.4-mini',
            'gpt-image-2',
            'tts-1',
            'gpt-4o-transcribe',
            'text-embedding-3-large',
            'omni-moderation-latest',
            'gpt-realtime',
          ],
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        '/images/generations',
        '/images/edits',
        '/audio/speech',
        '/audio/transcriptions',
        '/embeddings',
        '/moderations',
        '/realtime',
        '/realtime/client_secrets',
      ]),
    )
  })
})
