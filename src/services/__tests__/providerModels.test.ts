import { describe, expect, it } from 'vitest'

import type { ProviderConfig } from '../../types'
import {
  audioSpeechModelsForProvider,
  audioTranscriptionModelsForProvider,
  capabilitiesForModelList,
  chatModelPreferenceScore,
  chatModelsForProvider,
  configuredModelsForProvider,
  defaultModelForProvider,
  isLikelyAudioModel,
  isLikelyAudioSpeechModel,
  isLikelyAudioTranscriptionModel,
  imageEditingModelsForProvider,
  imageModelForProvider,
  imageModelsForProvider,
  isLikelyChatModel,
  isLikelyEmbeddingModel,
  isLikelyImageEditingModel,
  isLikelyImageModel,
  isLikelyModerationModel,
  isLikelyRealtimeModel,
  modelCapabilitiesForModels,
  modelForProviderAudioSpeech,
  modelForProviderAudioTranscription,
  modelCapabilitiesForModel,
  modelForProviderCapability,
  modelsForProviderCapability,
  preferredAudioModel,
  preferredAudioSpeechModel,
  preferredAudioTranscriptionModel,
  parseModelListInput,
  preferredEmbeddingModel,
  preferredChatModel,
  preferredImageModel,
  preferredModelForCapability,
  preferredModerationModel,
  preferredRealtimeModel,
  providerCapabilityUsesStandardFallbackModels,
  providerModelPatchFromFetchedModels,
  providerModelPatchFromModels,
  uniqueModels,
} from '../providerModels'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2',
    models: ['gpt-5.4-mini', 'gpt-image-2'],
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('provider model helpers', () => {
  it('normalizes model lists while preserving first-seen order', () => {
    expect(uniqueModels([' gpt-5 ', '', 'gpt-image-2', 'gpt-5'])).toEqual([
      'gpt-5',
      'gpt-image-2',
    ])
    expect(parseModelListInput('gpt-5\n  gpt-image-2  gpt-5')).toEqual([
      'gpt-5',
      'gpt-image-2',
    ])
  })

  it('treats a non-empty model catalog as authoritative over stale fields', () => {
    const fields = {
      model: 'gpt-5',
      imageModel: 'dall-e-3',
      audioSpeechModel: 'tts-1',
      audioTranscriptionModel: 'whisper-1',
      embeddingModel: 'text-embedding-3-large',
      moderationModel: 'omni-moderation-latest',
      realtimeModel: 'gpt-realtime',
    }

    expect(
      configuredModelsForProvider(
        provider({
          ...fields,
          models: ['gpt-4.1', 'gpt-5'],
        }),
      ),
    ).toEqual(['gpt-4.1', 'gpt-5'])
    expect(configuredModelsForProvider(provider({ ...fields, models: [] }))).toEqual([
      'gpt-5',
      'dall-e-3',
      'tts-1',
      'whisper-1',
      'text-embedding-3-large',
      'omni-moderation-latest',
      'gpt-realtime',
    ])
    expect(configuredModelsForProvider(null)).toEqual([])
  })

  it('keeps image-only model names out of chat choices', () => {
    expect(isLikelyChatModel('gpt-5')).toBe(true)
    expect(isLikelyChatModel('gpt-image-2')).toBe(false)
    expect(isLikelyChatModel('gpt-4o-audio-preview')).toBe(true)
    expect(isLikelyImageModel('imagen-4')).toBe(true)
    expect(
      chatModelsForProvider(
        provider({
          model: 'gpt-5',
          models: [
            'gpt-5',
            'gpt-4o-audio-preview',
            'gpt-image-2',
            'text-embedding-3-small',
          ],
        }),
      ),
    ).toEqual(['gpt-5', 'gpt-4o-audio-preview'])
  })

  it('prefers explicit image models and blocks Anthropic image choices', () => {
    expect(
      imageModelsForProvider(
        provider({ imageModel: 'dall-e-3', models: ['gpt-5', 'imagen-4'] }),
      ),
    ).toEqual(['imagen-4'])
    expect(
      imageModelsForProvider(provider({ imageModel: 'dall-e-3', models: [] })),
    ).toEqual(['dall-e-3'])
    expect(
      imageModelsForProvider(provider({ kind: 'anthropic', name: 'Anthropic' })),
    ).toEqual([])
    expect(preferredImageModel(['flux-pro', 'gpt-image-2'])).toBe('gpt-image-2')
  })

  it('keeps DALL-E 3 generation-only while resolving compatible editing models', () => {
    const configured = provider({
      imageModel: 'dall-e-3',
      models: ['gpt-5', 'dall-e-3', 'gpt-image-1'],
    })

    expect(isLikelyImageModel('dall-e-3')).toBe(true)
    expect(isLikelyImageEditingModel('dall-e-3')).toBe(false)
    expect(isLikelyImageEditingModel('gpt-image-1')).toBe(true)
    expect(imageEditingModelsForProvider(configured)).toEqual(['gpt-image-1'])
    expect(
      modelForProviderCapability(configured, 'image-generation'),
    ).toBe('dall-e-3')
    expect(modelForProviderCapability(configured, 'image-editing')).toBe(
      'gpt-image-1',
    )
    expect(modelCapabilitiesForModel('dall-e-3')).toEqual([
      'image-generation',
    ])
    expect(
      capabilitiesForModelList(
        provider({ capabilities: ['chat'], models: [] }),
        ['dall-e-3'],
      ),
    ).not.toContain('image-editing')
  })

  it('falls back to the first valid chat model when the saved default is stale', () => {
    expect(
      defaultModelForProvider(
        provider({ model: 'gpt-image-2', models: ['gpt-4.1-mini'] }),
      ),
    ).toBe('gpt-4.1-mini')
    expect(
      defaultModelForProvider(
        provider({
          model: 'missing-default',
          models: ['gpt-5.2', 'gpt-5.5', 'gpt-image-2'],
        }),
      ),
    ).toBe('gpt-5.5')
    expect(defaultModelForProvider(null)).toBe('')
  })

  it('prefers the strongest general chat model from fetched relay lists', () => {
    const models = [
      'codex-auto-review',
      'gpt-5.2',
      'gpt-5.5-openai-compact',
      'gpt-5.4-mini',
      'gpt-5.5',
      'gpt-image-2',
    ]

    expect(preferredChatModel(models)).toBe('gpt-5.5')
    expect(chatModelPreferenceScore('gpt-5.5')).toBeGreaterThan(
      chatModelPreferenceScore('gpt-5.2'),
    )
    expect(chatModelPreferenceScore('gpt-5.5')).toBeGreaterThan(
      chatModelPreferenceScore('gpt-5.5-openai-compact'),
    )
  })

  it('treats relay-style hyphenated GPT versions as newer model revisions', () => {
    const models = [
      'auto',
      'gpt-5',
      'gpt-5-1',
      'gpt-5-2',
      'gpt-5-3',
      'gpt-5-3-mini',
      'gpt-5-5',
      'gpt-5-mini',
      'gpt-5.3-codex-spark',
      'gpt-image-2',
    ]

    expect(preferredChatModel(models)).toBe('gpt-5-5')
    expect(chatModelPreferenceScore('gpt-5-5')).toBeGreaterThan(
      chatModelPreferenceScore('gpt-5-3'),
    )
    expect(chatModelPreferenceScore('gpt-5-5')).toBeGreaterThan(
      chatModelPreferenceScore('gpt-5'),
    )
  })

  it('prefers high-capability variants without treating date suffixes as newer revisions', () => {
    const models = [
      'gpt-5.5-mini',
      'gpt-5.5',
      'gpt-5.5-reasoning',
      'gpt-5.5-pro',
    ]

    expect(preferredChatModel(models)).toBe('gpt-5.5-pro')
    expect(chatModelPreferenceScore('gpt-5.5-pro')).toBeGreaterThan(
      chatModelPreferenceScore('gpt-5.5-reasoning'),
    )
    expect(chatModelPreferenceScore('gpt-5.5-reasoning')).toBeGreaterThan(
      chatModelPreferenceScore('gpt-5.5'),
    )
    expect(chatModelPreferenceScore('gpt-4.2')).toBeGreaterThan(
      chatModelPreferenceScore('gpt-4.1-2025-04-14'),
    )
    expect(
      preferredChatModel(['gpt-5.5', 'gpt-5-2025-08-07']),
    ).toBe('gpt-5.5')
  })

  it('prefers frontier relay variants when numeric revisions tie', () => {
    const models = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']

    expect(preferredChatModel(models)).toBe('gpt-5.6-sol')
    expect(chatModelPreferenceScore('gpt-5.6-sol')).toBeGreaterThan(
      chatModelPreferenceScore('gpt-5.6-terra'),
    )
    expect(chatModelPreferenceScore('gpt-5.6-terra')).toBeGreaterThan(
      chatModelPreferenceScore('gpt-5.6-luna'),
    )
  })

  it('falls back to the best available image model when the saved one is stale', () => {
    expect(
      imageModelForProvider(
        provider({ imageModel: 'gpt-5', models: ['flux-pro', 'dall-e-3'] }),
      ),
    ).toBe('dall-e-3')
    expect(imageModelForProvider(null)).toBe('')
  })

  it('prefers the configured audio transcription model when it is valid', () => {
    const configured = provider({
      audioTranscriptionModel: 'whisper-1',
      models: ['gpt-5', 'gpt-4o-transcribe', 'whisper-1'],
    })

    expect(modelForProviderAudioTranscription(configured)).toBe('whisper-1')
    expect(modelForProviderCapability(configured, 'audio-transcription')).toBe(
      'whisper-1',
    )
  })

  it('prefers configured low-cost and realtime capability models when valid', () => {
    const configured = provider({
      audioSpeechModel: 'tts-1',
      embeddingModel: 'text-embedding-3-small',
      moderationModel: 'moderation-latest',
      realtimeModel: 'gpt-4o-realtime-preview',
      models: [
        'gpt-5',
        'gpt-4o-mini-tts',
        'tts-1',
        'text-embedding-3-large',
        'text-embedding-3-small',
        'omni-moderation-latest',
        'moderation-latest',
        'gpt-realtime',
        'gpt-4o-realtime-preview',
      ],
    })

    expect(modelForProviderAudioSpeech(configured)).toBe('tts-1')
    expect(modelForProviderCapability(configured, 'audio-speech')).toBe('tts-1')
    expect(modelForProviderCapability(configured, 'embeddings')).toBe(
      'text-embedding-3-small',
    )
    expect(modelForProviderCapability(configured, 'moderation')).toBe(
      'moderation-latest',
    )
    expect(modelForProviderCapability(configured, 'realtime')).toBe(
      'gpt-4o-realtime-preview',
    )
  })

  it('builds safe provider patches from refreshed model lists', () => {
    expect(
      providerModelPatchFromModels(
        provider({
          imageModel: 'old-image',
          audioSpeechModel: 'old-tts',
          audioTranscriptionModel: 'old-transcribe',
          embeddingModel: 'old-embedding',
          moderationModel: 'old-moderation',
          realtimeModel: 'old-realtime',
        }),
        [
          'gpt-image-2',
          'gpt-5',
          'gpt-4o-mini-tts',
          'gpt-4o-transcribe',
          'text-embedding-3-large',
          'omni-moderation-latest',
          'gpt-realtime-2',
          'gpt-5',
        ],
        'gpt-image-2',
      ),
    ).toEqual({
      audioSpeechModel: 'gpt-4o-mini-tts',
      audioTranscriptionModel: 'gpt-4o-transcribe',
      capabilities: [
        'chat',
        'vision',
        'tools',
        'embeddings',
        'model-list',
        'image-generation',
        'image-editing',
        'audio',
        'moderation',
        'realtime',
      ],
      embeddingModel: 'text-embedding-3-large',
      imageModel: 'gpt-image-2',
      model: 'gpt-5',
      models: [
        'gpt-image-2',
        'gpt-5',
        'gpt-4o-mini-tts',
        'gpt-4o-transcribe',
        'text-embedding-3-large',
        'omni-moderation-latest',
        'gpt-realtime-2',
      ],
      moderationModel: 'omni-moderation-latest',
      realtimeModel: 'gpt-realtime-2',
    })
  })

  it('upgrades fetched automatic defaults to the strongest chat and image models', () => {
    expect(
      providerModelPatchFromFetchedModels(
        provider({
          model: 'gpt-5.4-mini',
          imageModel: 'gpt-image-1',
          audioTranscriptionModel: 'gpt-4o-transcribe',
          models: ['gpt-5.4-mini', 'gpt-image-1', 'gpt-4o-transcribe'],
        }),
        [
          'gpt-5.4-mini',
          'gpt-5.5',
          'gpt-image-1',
          'gpt-image-2',
          'gpt-4o-transcribe',
          'gpt-4o-mini-transcribe',
        ],
      ),
    ).toEqual({
      audioTranscriptionModel: 'gpt-4o-transcribe',
      capabilities: [
        'chat',
        'vision',
        'tools',
        'embeddings',
        'model-list',
        'image-generation',
        'image-editing',
        'audio',
      ],
      imageModel: 'gpt-image-2',
      model: 'gpt-5.5',
      models: [
        'gpt-5.4-mini',
        'gpt-5.5',
        'gpt-image-1',
        'gpt-image-2',
        'gpt-4o-transcribe',
        'gpt-4o-mini-transcribe',
      ],
    })
  })

  it('preserves explicit lightweight selections when fetched models refresh', () => {
    expect(
      providerModelPatchFromFetchedModels(
        provider({
          model: 'gpt-5.4-mini',
          imageModel: 'gpt-image-1',
          audioTranscriptionModel: 'whisper-1',
          models: [
            'gpt-5.5',
            'gpt-5.4-mini',
            'gpt-image-2',
            'gpt-image-1',
            'gpt-4o-transcribe',
            'whisper-1',
          ],
        }),
        [
          'gpt-5.6',
          'gpt-5.4-mini',
          'gpt-image-2',
          'gpt-image-1',
          'gpt-4o-transcribe',
          'whisper-1',
        ],
      ),
    ).toEqual({
      audioTranscriptionModel: 'whisper-1',
      capabilities: [
        'chat',
        'vision',
        'tools',
        'embeddings',
        'model-list',
        'image-generation',
        'image-editing',
        'audio',
      ],
      imageModel: 'gpt-image-1',
      model: 'gpt-5.4-mini',
      models: [
        'gpt-5.6',
        'gpt-5.4-mini',
        'gpt-image-2',
        'gpt-image-1',
        'gpt-4o-transcribe',
        'whisper-1',
      ],
    })
  })

  it('infers provider capabilities from fetched model families', () => {
    expect(
      capabilitiesForModelList(provider({ capabilities: undefined }), [
        'gpt-5.5',
        'gpt-image-2',
        'text-embedding-3-large',
        'gpt-4o-realtime-preview',
        'tts-1',
        'omni-moderation-latest',
      ]),
    ).toEqual([
      'chat',
      'vision',
      'tools',
      'embeddings',
      'model-list',
      'image-generation',
      'image-editing',
      'realtime',
      'audio',
      'moderation',
    ])
  })

  it('prefers model ids for non-chat provider capabilities', () => {
    const models = [
      'embedding-lite',
      'text-embedding-3-large',
      'tts-1',
      'gpt-4o-transcribe',
      'gpt-audio-1.5',
      'gpt-4o-realtime-preview',
      'gpt-realtime-2',
      'gpt-realtime',
      'moderation-latest',
      'omni-moderation-latest',
    ]

    expect(isLikelyEmbeddingModel('text-embedding-3-large')).toBe(true)
    expect(isLikelyAudioModel('gpt-4o-transcribe')).toBe(true)
    expect(isLikelyAudioModel('gpt-4o-audio-preview')).toBe(true)
    expect(isLikelyChatModel('gpt-4o-audio-preview')).toBe(true)
    expect(isLikelyAudioSpeechModel('tts-1')).toBe(true)
    expect(isLikelyAudioSpeechModel('gpt-4o-transcribe')).toBe(false)
    expect(isLikelyAudioSpeechModel('gpt-4o-audio-preview')).toBe(false)
    expect(isLikelyAudioTranscriptionModel('gpt-4o-transcribe')).toBe(true)
    expect(isLikelyAudioTranscriptionModel('tts-1')).toBe(false)
    expect(isLikelyAudioTranscriptionModel('gpt-4o-audio-preview')).toBe(false)
    expect(isLikelyRealtimeModel('gpt-realtime')).toBe(true)
    expect(isLikelyRealtimeModel('gpt-realtime-2')).toBe(true)
    expect(isLikelyRealtimeModel('gpt-audio-1.5')).toBe(true)
    expect(isLikelyRealtimeModel('gpt-4o-audio-preview')).toBe(false)
    expect(isLikelyModerationModel('omni-moderation-latest')).toBe(true)
    expect(preferredEmbeddingModel(models)).toBe('text-embedding-3-large')
    expect(preferredAudioModel(models)).toBe('gpt-4o-transcribe')
    expect(preferredAudioSpeechModel(models)).toBe('tts-1')
    expect(preferredAudioTranscriptionModel(models)).toBe('gpt-4o-transcribe')
    expect(preferredAudioModel(['gpt-4o-audio-preview'])).toBe(
      'gpt-4o-audio-preview',
    )
    expect(preferredAudioSpeechModel(['gpt-4o-audio-preview'])).toBe('')
    expect(preferredAudioTranscriptionModel(['gpt-4o-audio-preview'])).toBe('')
    expect(preferredRealtimeModel(models)).toBe('gpt-realtime-2')
    expect(preferredModerationModel(models)).toBe('omni-moderation-latest')
  })

  it('resolves provider models by endpoint capability', () => {
    const configuredProvider = provider({
      model: 'gpt-5.4-mini',
      imageModel: 'gpt-image-1',
      models: [
        'gpt-5.5',
        'gpt-5.4-mini',
        'gpt-image-2',
        'gpt-image-1',
        'embedding-lite',
        'text-embedding-3-large',
        'tts-1',
        'gpt-4o-transcribe',
        'gpt-4o-audio-preview',
        'gpt-audio-1.5',
        'gpt-4o-realtime-preview',
        'gpt-realtime-2',
        'gpt-realtime',
        'moderation-latest',
        'omni-moderation-latest',
      ],
    })

    expect(modelForProviderCapability(configuredProvider, 'chat')).toBe(
      'gpt-5.4-mini',
    )
    expect(
      modelForProviderCapability(configuredProvider, 'image-generation'),
    ).toBe('gpt-image-1')
    expect(
      modelForProviderCapability(configuredProvider, 'embeddings'),
    ).toBe('text-embedding-3-large')
    expect(modelForProviderCapability(configuredProvider, 'audio')).toBe(
      'gpt-4o-transcribe',
    )
    expect(
      modelForProviderCapability(configuredProvider, 'audio-speech'),
    ).toBe('tts-1')
    expect(
      modelForProviderCapability(configuredProvider, 'audio-transcription'),
    ).toBe('gpt-4o-transcribe')
    expect(modelForProviderAudioSpeech(configuredProvider)).toBe('tts-1')
    expect(modelForProviderAudioTranscription(configuredProvider)).toBe(
      'gpt-4o-transcribe',
    )
    expect(audioSpeechModelsForProvider(configuredProvider)).toEqual(['tts-1'])
    expect(audioTranscriptionModelsForProvider(configuredProvider)).toEqual([
      'gpt-4o-transcribe',
    ])
    expect(modelForProviderCapability(configuredProvider, 'realtime')).toBe(
      'gpt-realtime-2',
    )
    expect(modelForProviderCapability(configuredProvider, 'moderation')).toBe(
      'omni-moderation-latest',
    )
    expect(modelsForProviderCapability(configuredProvider, 'embeddings')).toEqual([
      'embedding-lite',
      'text-embedding-3-large',
    ])
    expect(
      preferredModelForCapability(
        modelsForProviderCapability(configuredProvider, 'audio'),
        'audio',
      ),
    ).toBe('gpt-4o-transcribe')
    expect(modelsForProviderCapability(configuredProvider, 'audio')).toEqual([
      'tts-1',
      'gpt-4o-transcribe',
      'gpt-4o-audio-preview',
      'gpt-audio-1.5',
    ])
    expect(
      preferredModelForCapability(
        modelsForProviderCapability(configuredProvider, 'audio-speech'),
        'audio-speech',
      ),
    ).toBe('tts-1')
    expect(
      preferredModelForCapability(
        modelsForProviderCapability(configuredProvider, 'audio-transcription'),
        'audio-transcription',
      ),
    ).toBe('gpt-4o-transcribe')
  })

  it('uses standard fallback models only when declared capabilities have no explicit catalog', () => {
    const declaredCapabilityProvider = provider({
      capabilities: [
        'chat',
        'audio',
        'embeddings',
        'moderation',
        'realtime',
        'model-list',
      ],
      model: 'gpt-5.5',
      imageModel: '',
      models: [],
    })

    expect(
      modelsForProviderCapability(declaredCapabilityProvider, 'embeddings'),
    ).toEqual(['text-embedding-3-large', 'text-embedding-3-small'])
    expect(
      providerCapabilityUsesStandardFallbackModels(
        declaredCapabilityProvider,
        'embeddings',
      ),
    ).toBe(true)
    expect(
      modelsForProviderCapability(declaredCapabilityProvider, 'audio-speech'),
    ).toEqual(['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'])
    expect(
      providerCapabilityUsesStandardFallbackModels(
        declaredCapabilityProvider,
        'audio-speech',
      ),
    ).toBe(true)
    expect(
      modelsForProviderCapability(
        declaredCapabilityProvider,
        'audio-transcription',
      ),
    ).toEqual(['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'])
    expect(modelsForProviderCapability(declaredCapabilityProvider, 'audio')).toEqual([
      'gpt-4o-transcribe',
      'gpt-4o-mini-transcribe',
      'whisper-1',
      'gpt-4o-mini-tts',
      'tts-1-hd',
      'tts-1',
    ])
    expect(
      modelsForProviderCapability(declaredCapabilityProvider, 'moderation'),
    ).toEqual(['omni-moderation-latest', 'omni-moderation', 'moderation-latest'])
    expect(
      modelsForProviderCapability(declaredCapabilityProvider, 'realtime'),
    ).toEqual([
      'gpt-realtime-2',
      'gpt-audio-1.5',
      'gpt-realtime',
      'gpt-audio-mini',
      'gpt-realtime-mini',
      'gpt-4o-realtime-preview',
      'gpt-4o-realtime',
    ])
    expect(
      modelForProviderCapability(declaredCapabilityProvider, 'embeddings'),
    ).toBe('text-embedding-3-large')
    expect(modelForProviderAudioSpeech(declaredCapabilityProvider)).toBe(
      'gpt-4o-mini-tts',
    )
    expect(modelForProviderAudioTranscription(declaredCapabilityProvider)).toBe(
      'gpt-4o-transcribe',
    )
    expect(
      modelForProviderCapability(declaredCapabilityProvider, 'moderation'),
    ).toBe('omni-moderation-latest')
    expect(modelForProviderCapability(declaredCapabilityProvider, 'realtime')).toBe(
      'gpt-realtime-2',
    )

    const explicitCatalogProvider = provider({
      capabilities: [
        'chat',
        'audio',
        'embeddings',
        'moderation',
        'realtime',
        'model-list',
      ],
      model: 'gpt-5.5',
      imageModel: '',
      audioSpeechModel: 'removed-tts',
      audioTranscriptionModel: 'removed-transcription',
      embeddingModel: 'removed-embedding',
      moderationModel: 'removed-moderation',
      realtimeModel: 'removed-realtime',
      models: ['gpt-5.5'],
    })

    expect(
      modelsForProviderCapability(explicitCatalogProvider, 'embeddings'),
    ).toEqual(['gpt-5.5'])
    expect(
      modelsForProviderCapability(explicitCatalogProvider, 'audio-speech'),
    ).toEqual(['gpt-5.5'])
    expect(
      modelsForProviderCapability(
        explicitCatalogProvider,
        'audio-transcription',
      ),
    ).toEqual(['gpt-5.5'])
    expect(
      modelsForProviderCapability(explicitCatalogProvider, 'moderation'),
    ).toEqual(['gpt-5.5'])
    expect(
      modelsForProviderCapability(explicitCatalogProvider, 'realtime'),
    ).toEqual(['gpt-5.5'])
    expect(
      providerCapabilityUsesStandardFallbackModels(
        explicitCatalogProvider,
        'embeddings',
      ),
    ).toBe(false)
    expect(modelForProviderAudioSpeech(explicitCatalogProvider)).toBe('')
    expect(modelForProviderAudioTranscription(explicitCatalogProvider)).toBe('')
    expect(modelForProviderCapability(explicitCatalogProvider, 'embeddings')).toBe(
      '',
    )
    expect(modelForProviderCapability(explicitCatalogProvider, 'moderation')).toBe(
      '',
    )
    expect(modelForProviderCapability(explicitCatalogProvider, 'realtime')).toBe(
      '',
    )

    const defaultCompatibleProvider = provider({
      capabilities: undefined,
      model: 'gpt-5.5',
      imageModel: '',
      models: [],
    })

    expect(
      modelsForProviderCapability(defaultCompatibleProvider, 'embeddings'),
    ).toEqual(['text-embedding-3-large', 'text-embedding-3-small'])
    expect(
      modelsForProviderCapability(defaultCompatibleProvider, 'moderation'),
    ).toEqual([])
    expect(
      modelsForProviderCapability(defaultCompatibleProvider, 'realtime'),
    ).toEqual([])
    expect(
      modelsForProviderCapability(defaultCompatibleProvider, 'audio-speech'),
    ).toEqual([])
    expect(
      modelsForProviderCapability(
        defaultCompatibleProvider,
        'audio-transcription',
      ),
    ).toEqual([])

    const matchingModelProvider = provider({
      capabilities: ['chat', 'embeddings', 'model-list'],
      models: ['embedding-lite'],
    })

    expect(
      modelsForProviderCapability(matchingModelProvider, 'embeddings'),
    ).toEqual(['embedding-lite'])
    expect(
      providerCapabilityUsesStandardFallbackModels(
        matchingModelProvider,
        'embeddings',
      ),
    ).toBe(false)

    const anthropicProvider = provider({
      capabilities: ['chat', 'embeddings', 'model-list'],
      kind: 'anthropic',
      models: ['claude-4'],
    })

    expect(
      modelsForProviderCapability(anthropicProvider, 'embeddings'),
    ).toEqual([])
    expect(
      providerCapabilityUsesStandardFallbackModels(
        anthropicProvider,
        'embeddings',
      ),
    ).toBe(false)
  })

  it('keeps opaque catalog IDs selectable for explicitly declared capabilities', () => {
    const opaqueCatalogProvider = provider({
      capabilities: ['chat', 'audio', 'embeddings', 'image-generation'],
      embeddingModel: 'vendor-vector-v7',
      imageModel: 'vendor-vision-v2',
      models: ['vendor-chat-v4', 'vendor-vector-v7', 'vendor-vision-v2'],
    })
    const unconfiguredOpaqueCatalogProvider = provider({
      capabilities: ['chat', 'embeddings'],
      embeddingModel: '',
      models: ['vendor-chat-v4', 'vendor-vector-v7'],
    })

    expect(
      modelsForProviderCapability(opaqueCatalogProvider, 'embeddings'),
    ).toEqual(['vendor-chat-v4', 'vendor-vector-v7', 'vendor-vision-v2'])
    expect(modelForProviderCapability(opaqueCatalogProvider, 'embeddings')).toBe(
      'vendor-vector-v7',
    )
    expect(
      modelForProviderCapability(
        unconfiguredOpaqueCatalogProvider,
        'embeddings',
      ),
    ).toBe('')
    expect(
      modelsForProviderCapability(opaqueCatalogProvider, 'image-generation'),
    ).toEqual(['vendor-chat-v4', 'vendor-vector-v7', 'vendor-vision-v2'])
    expect(modelForProviderCapability(opaqueCatalogProvider, 'image-generation')).toBe(
      'vendor-vision-v2',
    )
  })

  it('summarizes per-model capabilities for model-list badges', () => {
    expect(modelCapabilitiesForModel('gpt-5.5')).toEqual(['chat'])
    expect(modelCapabilitiesForModel('gpt-image-2')).toEqual([
      'image-generation',
      'image-editing',
    ])
    expect(modelCapabilitiesForModel('gpt-4o-transcribe')).toEqual([
      'audio-transcription',
    ])
    expect(modelCapabilitiesForModel('gpt-4o-audio-preview')).toEqual([
      'chat',
      'audio',
    ])
    expect(modelCapabilitiesForModel('gpt-audio-1.5')).toEqual([
      'audio',
      'realtime',
    ])
    expect(modelCapabilitiesForModel('text-embedding-3-large')).toEqual([
      'embeddings',
    ])
    expect(modelCapabilitiesForModel('gpt-realtime')).toEqual(['realtime'])
    expect(modelCapabilitiesForModel('omni-moderation-latest')).toEqual([
      'moderation',
    ])
    expect(
      modelCapabilitiesForModels([
        'gpt-image-2',
        'gpt-5.5',
        'text-embedding-3-large',
        'tts-1',
        'gpt-4o-transcribe',
        'gpt-realtime-2',
        'omni-moderation-latest',
        'gpt-image-2',
      ]),
    ).toEqual([
      'chat',
      'image-generation',
      'image-editing',
      'audio-speech',
      'audio-transcription',
      'embeddings',
      'moderation',
      'realtime',
    ])
  })
})
