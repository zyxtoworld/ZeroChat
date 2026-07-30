import { describe, expect, it } from 'vitest'

import type { ProviderConfig } from '../../types'
import {
  buildProviderCapabilityRequestPlan,
  modelCapabilityForProviderCapabilityRequest,
  providerCapabilityRequestEndpointPath,
  type ProviderCapabilityRequest,
  type ProviderCapabilityRequestPlan,
  type ProviderCapabilityReadyRequestPlan,
} from '../providerCapabilityRequests'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider One',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1/chat/completions',
    model: 'gpt-5.4-mini',
    imageModel: 'gpt-image-2',
    models: [
      'gpt-5.4-mini',
      'gpt-image-2',
      'text-embedding-3-large',
      'tts-1',
      'gpt-4o-transcribe',
      'gpt-realtime-2',
      'gpt-realtime',
      'omni-moderation-latest',
    ],
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function expectReady(
  plan: ProviderCapabilityRequestPlan,
): asserts plan is ProviderCapabilityReadyRequestPlan {
  expect(plan.status).toBe('ready')
}

function jsonBody(plan: ProviderCapabilityReadyRequestPlan): unknown {
  return JSON.parse(String(plan.init.body))
}

describe('provider capability request planning', () => {
  it('maps capability request kinds to endpoint model capabilities', () => {
    expect(modelCapabilityForProviderCapabilityRequest('audio-speech')).toBe(
      'audio-speech',
    )
    expect(
      modelCapabilityForProviderCapabilityRequest('audio-transcription'),
    ).toBe('audio-transcription')
    expect(modelCapabilityForProviderCapabilityRequest('embeddings')).toBe(
      'embeddings',
    )
    expect(modelCapabilityForProviderCapabilityRequest('moderation')).toBe(
      'moderation',
    )
    expect(modelCapabilityForProviderCapabilityRequest('realtime')).toBe(
      'realtime',
    )
    expect(providerCapabilityRequestEndpointPath('audio-speech')).toBe(
      '/audio/speech',
    )
    expect(providerCapabilityRequestEndpointPath('audio-transcription')).toBe(
      '/audio/transcriptions',
    )
    expect(providerCapabilityRequestEndpointPath('embeddings')).toBe(
      '/embeddings',
    )
    expect(providerCapabilityRequestEndpointPath('moderation')).toBe(
      '/moderations',
    )
    expect(providerCapabilityRequestEndpointPath('realtime')).toBe(
      '/realtime/client_secrets',
    )
  })

  it('plans embeddings and moderation with capability-specific models', () => {
    const requestProvider = provider()
    const embeddings = buildProviderCapabilityRequestPlan({
      provider: requestProvider,
      apiKey: 'provider-key',
      proxyToken: '',
      request: {
        kind: 'embeddings',
        input: [' keep spaces ', 'second item'],
      },
    })
    const moderation = buildProviderCapabilityRequestPlan({
      provider: requestProvider,
      apiKey: 'provider-key',
      proxyToken: '',
      request: {
        kind: 'moderation',
        input: ' inspect this text ',
      },
    })

    expectReady(embeddings)
    expect(embeddings.endpoint).toBe('https://api.example.test/v1/embeddings')
    expect(embeddings.model).toBe('text-embedding-3-large')
    expect(embeddings.modelCapability).toBe('embeddings')
    expect(embeddings.init.method).toBe('POST')
    expect(embeddings.init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer provider-key',
    })
    expect(jsonBody(embeddings)).toEqual({
      model: 'text-embedding-3-large',
      input: [' keep spaces ', 'second item'],
    })

    expectReady(moderation)
    expect(moderation.endpoint).toBe('https://api.example.test/v1/moderations')
    expect(moderation.model).toBe('omni-moderation-latest')
    expect(moderation.modelCapability).toBe('moderation')
    expect(jsonBody(moderation)).toEqual({
      model: 'omni-moderation-latest',
      input: ' inspect this text ',
    })
  })

  it('plans audio requests with endpoint-specific builders', () => {
    const requestProvider = provider({
      baseUrl: 'https://api.example.test/v1/embeddings',
    })
    const speech = buildProviderCapabilityRequestPlan({
      provider: requestProvider,
      apiKey: 'provider-key',
      proxyToken: '',
      request: {
        kind: 'audio-speech',
        input: '  speak this exactly  ',
        voice: ' nova ',
        responseFormat: ' wav ',
        speed: 1.1,
      },
    })
    const audioFile = new File(['audio-bytes'], ' voice.wav ', { type: '' })
    const transcription = buildProviderCapabilityRequestPlan({
      provider: requestProvider,
      apiKey: 'provider-key',
      proxyToken: '',
      request: {
        kind: 'audio-transcription',
        file: audioFile,
        prompt: ' ZeroChat names ',
        language: ' en ',
        responseFormat: ' verbose_json ',
        temperature: 0,
      },
    })
    expectReady(speech)
    expect(speech.endpoint).toBe('https://api.example.test/v1/audio/speech')
    expect(speech.model).toBe('tts-1')
    expect(speech.modelCapability).toBe('audio-speech')
    expect(jsonBody(speech)).toEqual({
      model: 'tts-1',
      input: '  speak this exactly  ',
      voice: 'nova',
      response_format: 'wav',
      speed: 1.1,
    })

    expectReady(transcription)
    expect(transcription.endpoint).toBe(
      'https://api.example.test/v1/audio/transcriptions',
    )
    expect(transcription.model).toBe('gpt-4o-transcribe')
    expect(transcription.modelCapability).toBe('audio-transcription')
    expect(transcription.init.headers).toEqual({
      authorization: 'Bearer provider-key',
    })
    const transcriptionBody = transcription.init.body as FormData
    expect(transcriptionBody.get('model')).toBe('gpt-4o-transcribe')
    expect((transcriptionBody.get('file') as File).type).toBe('audio/wav')
    expect(transcriptionBody.get('prompt')).toBe('ZeroChat names')
    expect(transcriptionBody.get('language')).toBe('en')
    expect(transcriptionBody.get('response_format')).toBe('verbose_json')
    expect(transcriptionBody.get('temperature')).toBe('0')

  })

  it('blocks browser realtime checks instead of planning a fake JSON POST', () => {
    expect(
      buildProviderCapabilityRequestPlan({
        provider: provider({
          baseUrl: 'https://api.example.test/v1/embeddings',
        }),
        apiKey: 'provider-key',
        proxyToken: '',
        request: {
          kind: 'realtime',
          modalities: [' text ', 'audio', ' '],
          instructions: ' stay brief ',
          voice: ' alloy ',
          inputAudioFormat: ' pcm16 ',
          outputAudioFormat: ' opus ',
        },
      }),
    ).toMatchObject({
      blocker: 'realtime-server-transport-required',
      kind: 'realtime',
      model: 'gpt-realtime-2',
      modelCapability: 'realtime',
      status: 'blocked',
    })
  })

  it('plans proxied realtime checks through the client-secret session route', () => {
    const plan = buildProviderCapabilityRequestPlan({
      provider: provider({
        needsApiKey: false,
        proxyUrl: ' https://proxy.example.test ',
      }),
      apiKey: '',
      proxyToken: 'proxy-token',
      request: {
        kind: 'realtime',
        modalities: [' text ', 'audio', ' '],
        instructions: ' stay brief ',
        voice: ' alloy ',
        inputAudioFormat: ' pcm16 ',
        outputAudioFormat: ' opus ',
      },
    })

    expectReady(plan)
    expect(plan.endpoint).toBe('https://proxy.example.test/proxy')
    expect(plan.model).toBe('gpt-realtime-2')
    expect(plan.modelCapability).toBe('realtime')
    expect(plan.init.method).toBe('POST')
    expect(plan.init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-zerochat-access-key': 'proxy-token',
      'x-zerochat-base-url': 'https://api.example.test/v1',
      'x-zerochat-provider-kind': 'openai-compatible',
      'x-zerochat-proxy-action': 'realtime-client-secrets',
    })
    expect(jsonBody(plan)).toEqual({
      expires_after: {
        anchor: 'created_at',
        seconds: 600,
      },
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2',
        output_modalities: ['text'],
        instructions: 'stay brief',
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: 24000,
            },
          },
        },
      },
    })
  })

  it('keeps managed proxy routing and action headers for every capability without browser provider keys', () => {
    const proxiedProvider = provider({
      proxyUrl: ' https://proxy.example.test ',
      needsApiKey: false,
    })
    const audioFile = new File(['audio-bytes'], 'sample.webm', {
      type: 'audio/webm',
    })
    const cases: Array<{
      action: string
      model: string
      request: ProviderCapabilityRequest
    }> = [
      {
        action: 'audio-speech',
        model: 'tts-1',
        request: {
          kind: 'audio-speech',
          input: 'ZeroChat speech check',
        },
      },
      {
        action: 'audio-transcriptions',
        model: 'gpt-4o-transcribe',
        request: {
          kind: 'audio-transcription',
          file: audioFile,
        },
      },
      {
        action: 'embeddings',
        model: 'text-embedding-3-large',
        request: {
          kind: 'embeddings',
          input: 'ZeroChat capability check',
        },
      },
      {
        action: 'moderations',
        model: 'omni-moderation-latest',
        request: {
          kind: 'moderation',
          input: 'ZeroChat moderation check',
        },
      },
      {
        action: 'realtime-client-secrets',
        model: 'gpt-realtime-2',
        request: {
          kind: 'realtime',
          modalities: ['text'],
        },
      },
    ]

    for (const testCase of cases) {
      const plan = buildProviderCapabilityRequestPlan({
        provider: proxiedProvider,
        apiKey: '',
        proxyToken: 'proxy-token',
        request: testCase.request,
      })
      expectReady(plan)
      expect(plan.endpoint).toBe('https://proxy.example.test/proxy')
      expect(plan.model).toBe(testCase.model)
      expect(plan.init.method).toBe('POST')
      expect(plan.init.headers).toMatchObject({
        'x-zerochat-access-key': 'proxy-token',
        'x-zerochat-base-url': 'https://api.example.test/v1',
        'x-zerochat-provider-kind': 'openai-compatible',
        'x-zerochat-proxy-action': testCase.action,
      })
      expect(plan.init.headers).not.toHaveProperty('authorization')
      expect(plan.init.headers).not.toHaveProperty('x-api-key')
    }
  })

  it('blocks capability plans before building unusable requests', () => {
    expect(
      buildProviderCapabilityRequestPlan({
        provider: null,
        apiKey: '',
        proxyToken: '',
        request: { kind: 'embeddings', input: 'hello' },
      }),
    ).toMatchObject({
      blocker: 'provider-required',
      kind: 'embeddings',
      model: '',
      modelCapability: 'embeddings',
      status: 'blocked',
    })

    expect(
      buildProviderCapabilityRequestPlan({
        provider: provider({ enabled: false }),
        apiKey: 'provider-key',
        proxyToken: '',
        request: { kind: 'embeddings', input: 'hello' },
      }),
    ).toMatchObject({
      blocker: 'provider-disabled',
      modelCapability: 'embeddings',
      status: 'blocked',
    })

    expect(
      buildProviderCapabilityRequestPlan({
        provider: provider({
          capabilities: ['chat', 'model-list'],
          models: ['gpt-5.4-mini'],
        }),
        apiKey: 'provider-key',
        proxyToken: '',
        request: { kind: 'embeddings', input: 'hello' },
      }),
    ).toMatchObject({
      blocker: 'model-required',
      model: '',
      modelCapability: 'embeddings',
      status: 'blocked',
    })

    expect(
      buildProviderCapabilityRequestPlan({
        provider: provider({
          capabilities: ['chat', 'embeddings', 'model-list'],
          models: ['gpt-5.4-mini'],
        }),
        apiKey: 'provider-key',
        proxyToken: '',
        request: { kind: 'embeddings', input: 'hello' },
      }),
    ).toMatchObject({
      blocker: 'model-required',
      model: '',
      modelCapability: 'embeddings',
      status: 'blocked',
    })

    const fallbackEmbeddingPlan = buildProviderCapabilityRequestPlan({
      provider: provider({
        capabilities: ['chat', 'embeddings', 'model-list'],
        models: [],
      }),
      apiKey: 'provider-key',
      proxyToken: '',
      request: { kind: 'embeddings', input: 'hello' },
    })

    expectReady(fallbackEmbeddingPlan)
    expect(fallbackEmbeddingPlan.model).toBe('text-embedding-3-large')

    expect(
      buildProviderCapabilityRequestPlan({
        provider: provider(),
        apiKey: '',
        proxyToken: '',
        request: { kind: 'moderation', input: 'hello' },
      }),
    ).toMatchObject({
      blocker: 'provider-key-required',
      model: 'omni-moderation-latest',
      modelCapability: 'moderation',
      status: 'blocked',
    })

    expect(
      buildProviderCapabilityRequestPlan({
        provider: provider({ proxyUrl: 'https://proxy.example.test' }),
        apiKey: 'provider-key',
        proxyToken: '',
        request: { kind: 'realtime' },
      }),
    ).toMatchObject({
      blocker: 'proxy-token-required',
      model: 'gpt-realtime-2',
      modelCapability: 'realtime',
      status: 'blocked',
    })

    expect(
      buildProviderCapabilityRequestPlan({
        provider: provider(),
        apiKey: 'provider-key',
        proxyToken: '',
        request: { kind: 'audio-speech', input: '   ' },
      }),
    ).toMatchObject({
      blocker: 'input-required',
      model: 'tts-1',
      modelCapability: 'audio-speech',
      status: 'blocked',
    })

    expect(
      buildProviderCapabilityRequestPlan({
        provider: provider(),
        apiKey: 'provider-key',
        proxyToken: '',
        request: { kind: 'audio-transcription', file: null },
      }),
    ).toMatchObject({
      blocker: 'file-required',
      model: 'gpt-4o-transcribe',
      modelCapability: 'audio-transcription',
      status: 'blocked',
    })
  })
})
