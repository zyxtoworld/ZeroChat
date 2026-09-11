import { describe, expect, it } from 'vitest'

import type { ChatMessage, ProviderConfig } from '../../types'
import {
  buildProviderAnthropicChatBody,
  buildProviderAudioSpeechBody,
  buildProviderAudioSpeechEndpoint,
  buildProviderAudioSpeechHeaders,
  buildProviderAudioTranscriptionBody,
  buildProviderAudioTranscriptionEndpoint,
  buildProviderAudioTranscriptionHeaders,
  buildProviderChatEndpoint,
  buildProviderChatHeaders,
  buildProviderEmbeddingsBody,
  buildProviderEmbeddingsEndpoint,
  buildProviderEmbeddingsHeaders,
  buildProviderImageEditBody,
  buildProviderImageEditEndpoint,
  buildProviderImageEditHeaders,
  buildProviderImageGenerationBody,
  buildProviderImageGenerationEndpoint,
  buildProviderImageGenerationHeaders,
  buildProviderModelListEndpoint,
  buildProviderModelListHeaders,
  buildProviderModerationsBody,
  buildProviderModerationsEndpoint,
  buildProviderModerationsHeaders,
  buildProviderOpenAIChatBody,
  buildProviderRealtimeBody,
  buildProviderRealtimeClientSecretsBody,
  buildProviderRealtimeClientSecretsEndpoint,
  buildProviderRealtimeClientSecretsHeaders,
  buildProviderRealtimeEndpoint,
  buildProviderRealtimeHeaders,
  buildProviderResponsesImageEditBody,
  buildProviderResponsesImageGenerationBody,
  buildProviderResponsesImageGenerationEndpoint,
  buildProviderResponsesImageGenerationHeaders,
  buildProviderResponsesChatBody,
} from '../providerRequests'
import {
  activeProviderProxyUrl,
  providerNeedsBrowserKey,
  providerUsesProxy,
} from '../providerRequestMode'

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider One',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-1',
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function message(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: `${role}-${content}`,
    role,
    content,
    createdAt: 1,
    status: 'done',
  }
}

describe('provider request construction', () => {
  it('normalizes direct provider endpoints from configured API roots', () => {
    const openAI = provider({
      baseUrl: 'https://api.example.test/v1/chat/completions',
    })
    const responses = provider({
      kind: 'openai-responses',
      baseUrl: 'https://api.example.test/v1/responses',
    })
    const anthropic = provider({
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.test/v1/messages',
    })

    expect(buildProviderChatEndpoint(openAI)).toBe(
      'https://api.example.test/v1/chat/completions',
    )
    expect(buildProviderModelListEndpoint(openAI)).toBe(
      'https://api.example.test/v1/models',
    )
    expect(buildProviderImageGenerationEndpoint(openAI)).toBe(
      'https://api.example.test/v1/images/generations',
    )
    expect(buildProviderResponsesImageGenerationEndpoint(openAI)).toBe(
      'https://api.example.test/v1/responses',
    )
    expect(buildProviderImageEditEndpoint(openAI)).toBe(
      'https://api.example.test/v1/images/edits',
    )
    expect(buildProviderAudioSpeechEndpoint(openAI)).toBe(
      'https://api.example.test/v1/audio/speech',
    )
    expect(buildProviderAudioTranscriptionEndpoint(openAI)).toBe(
      'https://api.example.test/v1/audio/transcriptions',
    )
    expect(buildProviderEmbeddingsEndpoint(openAI)).toBe(
      'https://api.example.test/v1/embeddings',
    )
    expect(buildProviderModerationsEndpoint(openAI)).toBe(
      'https://api.example.test/v1/moderations',
    )
    expect(buildProviderRealtimeEndpoint(openAI)).toBe(
      'https://api.example.test/v1/realtime',
    )
    expect(buildProviderRealtimeClientSecretsEndpoint(openAI)).toBe(
      'https://api.example.test/v1/realtime/client_secrets',
    )
    expect(buildProviderChatEndpoint(responses)).toBe(
      'https://api.example.test/v1/responses',
    )
    expect(buildProviderChatEndpoint(anthropic)).toBe(
      'https://api.anthropic.test/v1/messages',
    )
    expect(
      buildProviderModerationsEndpoint(
        provider({ baseUrl: 'https://api.example.test/v1/embeddings' }),
      ),
    ).toBe('https://api.example.test/v1/moderations')
    expect(
      buildProviderRealtimeClientSecretsEndpoint(
        provider({
          baseUrl: 'https://api.example.test/v1/realtime/client_secrets',
        }),
      ),
    ).toBe('https://api.example.test/v1/realtime/client_secrets')
  })

  it('routes proxy providers through the managed proxy with zerochat headers', () => {
    const proxied = provider({
      id: '服务商-1',
      name: '自定义中转',
      baseUrl: 'https://api.vendor.test/v1/chat/completions',
      proxyUrl: ' https://proxy.example.test ',
      needsApiKey: false,
    })

    expect(activeProviderProxyUrl(proxied)).toBe('https://proxy.example.test')
    expect(providerUsesProxy(proxied)).toBe(true)
    expect(providerNeedsBrowserKey(proxied)).toBe(false)
    expect(buildProviderChatEndpoint(proxied)).toBe(
      'https://proxy.example.test/proxy',
    )
    expect(buildProviderModelListEndpoint(proxied)).toBe(
      'https://proxy.example.test/proxy',
    )
    expect(buildProviderResponsesImageGenerationEndpoint(proxied)).toBe(
      'https://proxy.example.test/proxy',
    )
    expect(buildProviderEmbeddingsEndpoint(proxied)).toBe(
      'https://proxy.example.test/proxy',
    )

    const modelListHeaders = buildProviderModelListHeaders({
      provider: proxied,
      apiKey: '',
      proxyToken: 'proxy-secret',
    })
    expect(modelListHeaders).toMatchObject({
      'x-zerochat-access-key': 'proxy-secret',
      'x-zerochat-base-url': 'https://api.vendor.test/v1',
      'x-zerochat-provider-kind': 'openai-compatible',
      'x-zerochat-proxy-action': 'models',
    })
    expect(modelListHeaders).not.toHaveProperty('x-zerochat-provider-id')
    expect(modelListHeaders).not.toHaveProperty('x-zerochat-provider-name')
    expect(() => new Headers(modelListHeaders)).not.toThrow()
    expect(
      buildProviderResponsesImageGenerationHeaders({
        provider: proxied,
        apiKey: '',
        proxyToken: 'proxy-secret',
      }),
    ).toMatchObject({
      'x-zerochat-access-key': 'proxy-secret',
      'x-zerochat-base-url': 'https://api.vendor.test/v1',
      'x-zerochat-provider-kind': 'openai-compatible',
      'x-zerochat-proxy-action': 'image-responses',
    })
    expect(
      buildProviderChatHeaders({
        provider: proxied,
        apiKey: '',
        proxyToken: 'proxy-secret',
      }),
    ).toMatchObject({
      'x-zerochat-access-key': 'proxy-secret',
      'x-zerochat-base-url': 'https://api.vendor.test/v1',
      'x-zerochat-provider-kind': 'openai-compatible',
      'x-zerochat-proxy-action': 'chat',
    })
    expect(
      buildProviderAudioSpeechHeaders({
        provider: proxied,
        apiKey: '',
        proxyToken: 'proxy-secret',
      }),
    ).toMatchObject({
      'x-zerochat-base-url': 'https://api.vendor.test/v1',
      'x-zerochat-proxy-action': 'audio-speech',
    })
    expect(
      buildProviderAudioTranscriptionHeaders({
        provider: proxied,
        apiKey: '',
        proxyToken: 'proxy-secret',
      }),
    ).toMatchObject({
      'x-zerochat-base-url': 'https://api.vendor.test/v1',
      'x-zerochat-proxy-action': 'audio-transcriptions',
    })
    expect(
      buildProviderEmbeddingsHeaders({
        provider: proxied,
        apiKey: '',
        proxyToken: 'proxy-secret',
      }),
    ).toMatchObject({
      'x-zerochat-base-url': 'https://api.vendor.test/v1',
      'x-zerochat-proxy-action': 'embeddings',
    })
    expect(
      buildProviderModerationsHeaders({
        provider: proxied,
        apiKey: '',
        proxyToken: 'proxy-secret',
      }),
    ).toMatchObject({
      'x-zerochat-base-url': 'https://api.vendor.test/v1',
      'x-zerochat-proxy-action': 'moderations',
    })
    expect(
      buildProviderRealtimeHeaders({
        provider: proxied,
        apiKey: '',
        proxyToken: 'proxy-secret',
      }),
    ).toMatchObject({
      'x-zerochat-base-url': 'https://api.vendor.test/v1',
      'x-zerochat-proxy-action': 'realtime',
    })
    expect(
      buildProviderRealtimeClientSecretsHeaders({
        provider: proxied,
        apiKey: '',
        proxyToken: 'proxy-secret',
      }),
    ).toMatchObject({
      'x-zerochat-base-url': 'https://api.vendor.test/v1',
      'x-zerochat-proxy-action': 'realtime-client-secrets',
    })
  })

  it('normalizes proxy endpoint suffixes while preserving deployment base paths', () => {
    const proxyEndpoint = provider({
      baseUrl: 'https://api.vendor.test/v1',
      proxyUrl: 'https://proxy.example.test/zerochat/proxy',
      needsApiKey: false,
    })
    const hostManagementEndpoint = provider({
      baseUrl: 'https://api.vendor.test/v1',
      proxyUrl: 'https://proxy.example.test/zerochat/proxy/hosts',
      needsApiKey: false,
    })

    expect(buildProviderChatEndpoint(proxyEndpoint)).toBe(
      'https://proxy.example.test/zerochat/proxy',
    )
    expect(buildProviderModelListEndpoint(proxyEndpoint)).toBe(
      'https://proxy.example.test/zerochat/proxy',
    )
    expect(buildProviderAudioSpeechEndpoint(proxyEndpoint)).toBe(
      'https://proxy.example.test/zerochat/proxy',
    )
    expect(buildProviderImageEditEndpoint(hostManagementEndpoint)).toBe(
      'https://proxy.example.test/zerochat/proxy',
    )
  })

  it('does not forward stale browser keys when the Worker hosts provider credentials', () => {
    const hostedOpenAI = provider({
      baseUrl: 'https://api.vendor.test/v1',
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.test',
    })
    const hostedOpenAIAuth = {
      provider: hostedOpenAI,
      apiKey: 'stale-browser-key',
      proxyToken: 'proxy-secret',
    }
    const openAIHeaders = [
      buildProviderModelListHeaders(hostedOpenAIAuth),
      buildProviderImageGenerationHeaders(hostedOpenAIAuth),
      buildProviderResponsesImageGenerationHeaders(hostedOpenAIAuth),
      buildProviderImageEditHeaders(hostedOpenAIAuth),
      buildProviderAudioSpeechHeaders(hostedOpenAIAuth),
      buildProviderAudioTranscriptionHeaders(hostedOpenAIAuth),
      buildProviderEmbeddingsHeaders(hostedOpenAIAuth),
      buildProviderModerationsHeaders(hostedOpenAIAuth),
      buildProviderRealtimeHeaders(hostedOpenAIAuth),
      buildProviderRealtimeClientSecretsHeaders(hostedOpenAIAuth),
      buildProviderChatHeaders(hostedOpenAIAuth),
    ]

    for (const headers of openAIHeaders) {
      expect(headers).toMatchObject({
        'x-zerochat-access-key': 'proxy-secret',
        'x-zerochat-base-url': 'https://api.vendor.test/v1',
      })
      expect(headers).not.toHaveProperty('authorization')
      expect(headers).not.toHaveProperty('x-api-key')
    }

    const hostedAnthropicAuth = {
      provider: provider({
        baseUrl: 'https://api.anthropic.test/v1',
        kind: 'anthropic',
        needsApiKey: false,
        proxyUrl: 'https://proxy.example.test',
      }),
      apiKey: 'stale-browser-key',
      proxyToken: 'proxy-secret',
    }

    for (const headers of [
      buildProviderModelListHeaders(hostedAnthropicAuth),
      buildProviderChatHeaders(hostedAnthropicAuth),
    ]) {
      expect(headers).toMatchObject({
        'x-zerochat-access-key': 'proxy-secret',
      })
      expect(headers).not.toHaveProperty('authorization')
      expect(headers).not.toHaveProperty('x-api-key')
    }
  })

  it('preserves provider-specific auth headers for model, chat, and image requests', () => {
    const openAI = provider()
    const anthropic = provider({ kind: 'anthropic' })

    expect(
      buildProviderChatHeaders({
        provider: openAI,
        apiKey: 'openai-key',
        proxyToken: '',
      }),
    ).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer openai-key',
    })
    expect(
      buildProviderChatHeaders({
        provider: anthropic,
        apiKey: 'anthropic-key',
        proxyToken: '',
      }),
    ).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
    expect(
      buildProviderModelListHeaders({
        provider: anthropic,
        apiKey: 'anthropic-key',
        proxyToken: '',
      }),
    ).toMatchObject({
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01',
    })
    expect(
      buildProviderImageGenerationHeaders({
        provider: openAI,
        apiKey: 'image-key',
        proxyToken: '',
      }),
    ).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer image-key',
    })
    expect(
      buildProviderImageEditHeaders({
        provider: openAI,
        apiKey: 'image-key',
        proxyToken: '',
      }),
    ).toEqual({
      authorization: 'Bearer image-key',
    })
    expect(
      buildProviderResponsesImageGenerationHeaders({
        provider: openAI,
        apiKey: 'image-key',
        proxyToken: '',
      }),
    ).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer image-key',
    })
    expect(
      buildProviderEmbeddingsHeaders({
        provider: openAI,
        apiKey: 'embedding-key',
        proxyToken: '',
      }),
    ).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer embedding-key',
    })
    expect(
      buildProviderModerationsHeaders({
        provider: openAI,
        apiKey: 'moderation-key',
        proxyToken: '',
      }),
    ).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer moderation-key',
    })
    expect(
      buildProviderAudioSpeechHeaders({
        provider: openAI,
        apiKey: 'audio-key',
        proxyToken: '',
      }),
    ).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer audio-key',
    })
    expect(
      buildProviderAudioTranscriptionHeaders({
        provider: openAI,
        apiKey: 'audio-key',
        proxyToken: '',
      }),
    ).toEqual({
      authorization: 'Bearer audio-key',
    })
    expect(
      buildProviderRealtimeHeaders({
        provider: openAI,
        apiKey: 'realtime-key',
        proxyToken: '',
      }),
    ).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer realtime-key',
    })
  })

  it('builds chat request bodies for OpenAI Chat, Responses, and Anthropic', () => {
    const messages = [
      message('system', 'system one'),
      message('user', 'hello'),
      message('assistant', 'hi'),
      message('system', ' system two '),
    ]

    expect(
      buildProviderOpenAIChatBody({
        model: ' gpt-5 ',
        messages,
      }),
    ).toEqual({
      model: 'gpt-5',
      messages: messages.map(({ role, content }) => ({ role, content })),
      stream: true,
      temperature: 0.7,
    })
    expect(
      buildProviderResponsesChatBody({
        model: ' gpt-5-responses ',
        messages,
      }),
    ).toEqual({
      model: 'gpt-5-responses',
      input: messages.map(({ role, content }) => ({ role, content })),
      stream: true,
      store: false,
      temperature: 0.7,
    })
    expect(
      buildProviderAnthropicChatBody({
        model: ' claude-sonnet-4-5 ',
        messages,
      }),
    ).toEqual({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      stream: true,
      system: 'system one\n\nsystem two',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    })
  })

  it('builds multimodal chat content from user image attachments', () => {
    const imageUser: ChatMessage = {
      ...message('user', 'describe this image'),
      attachments: [
        {
          id: 'source',
          kind: 'image',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AA==',
          createdAt: 1,
        },
        {
          id: 'mask',
          kind: 'image',
          purpose: 'mask',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,MASK',
          createdAt: 1,
        },
      ],
    }
    const assistantWithGeneratedImage: ChatMessage = {
      ...message('assistant', 'generated'),
      attachments: [
        {
          id: 'generated',
          kind: 'image',
          purpose: 'generated',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,GENERATED',
          createdAt: 1,
        },
      ],
    }
    const messages = [imageUser, assistantWithGeneratedImage]

    expect(
      buildProviderOpenAIChatBody({
        model: 'gpt-5',
        messages,
      }).messages,
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this image' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,AA==' },
          },
        ],
      },
      { role: 'assistant', content: 'generated' },
    ])
    expect(
      buildProviderResponsesChatBody({
        model: 'gpt-5',
        messages,
      }).input,
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'describe this image' },
          { type: 'input_image', image_url: 'data:image/png;base64,AA==' },
        ],
      },
      { role: 'assistant', content: 'generated' },
    ])
    expect(
      buildProviderAnthropicChatBody({
        model: 'claude-sonnet-4-5',
        messages,
      }).messages,
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this image' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'AA==',
            },
          },
        ],
      },
      { role: 'assistant', content: 'generated' },
    ])
  })

  it('filters unsafe imported image sources before provider payloads', () => {
    const messages: ChatMessage[] = [
      {
        ...message('user', 'inspect safe sources'),
        attachments: [
          {
            id: 'safe-data',
            kind: 'image',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,AA==',
            createdAt: 1,
          },
          {
            id: 'active-data',
            kind: 'image',
            mimeType: 'image/svg+xml',
            dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
            createdAt: 1,
          },
          {
            id: 'credentials',
            kind: 'image',
            mimeType: 'image/png',
            url: 'https://user:secret@cdn.example/image.png',
            createdAt: 1,
          },
          {
            id: 'loopback',
            kind: 'image',
            mimeType: 'image/png',
            url: 'https://127.0.0.1/image.png',
            createdAt: 1,
          },
          {
            id: 'encoded-loopback',
            kind: 'image',
            mimeType: 'image/png',
            url: 'https://0x7f000001/image.png',
            createdAt: 1,
          },
          {
            id: 'mapped-loopback',
            kind: 'image',
            mimeType: 'image/png',
            url: 'https://[::ffff:127.0.0.1]/image.png',
            createdAt: 1,
          },
          {
            id: 'control-url',
            kind: 'image',
            mimeType: 'image/png',
            url: '\nhttps://cdn.example/image.png',
            createdAt: 1,
          },
          {
            id: 'runtime-blob',
            kind: 'image',
            mimeType: 'image/png',
            url: 'blob:zerochat-image',
            createdAt: 1,
          },
          {
            id: 'safe-remote',
            kind: 'image',
            mimeType: 'image/webp',
            url: 'https://cdn.example.test/image.webp?size=1024',
            createdAt: 1,
          },
        ],
      },
    ]
    const openAi = JSON.stringify(
      buildProviderOpenAIChatBody({ model: 'gpt-5', messages }),
    )
    const responses = JSON.stringify(
      buildProviderResponsesChatBody({ model: 'gpt-5', messages }),
    )
    const anthropic = JSON.stringify(
      buildProviderAnthropicChatBody({ model: 'claude-sonnet-4-5', messages }),
    )

    for (const payload of [openAi, responses]) {
      expect(payload).toContain('data:image/png;base64,AA==')
      expect(payload).toContain('https://cdn.example.test/image.webp?size=1024')
      expect(payload).not.toContain('image/svg+xml')
      expect(payload).not.toContain('user:secret')
      expect(payload).not.toContain('127.0.0.1')
      expect(payload).not.toContain('0x7f000001')
      expect(payload).not.toContain('::ffff:127.0.0.1')
      expect(payload).not.toContain('cdn.example/image.png')
      expect(payload).not.toContain('blob:zerochat-image')
    }

    expect(anthropic).toContain('"media_type":"image/png"')
    expect(anthropic).not.toContain('cdn.example.test')
    expect(anthropic).not.toContain('image/svg+xml')
  })

  it('builds low-cost capability request bodies without rewriting input text', () => {
    expect(
      buildProviderEmbeddingsBody({
        model: ' text-embedding-3-large ',
        input: [' keep spaces ', 'second item'],
      }),
    ).toEqual({
      model: 'text-embedding-3-large',
      input: [' keep spaces ', 'second item'],
    })
    expect(
      buildProviderModerationsBody({
        model: ' omni-moderation-latest ',
        input: ' inspect this text ',
      }),
    ).toEqual({
      model: 'omni-moderation-latest',
      input: ' inspect this text ',
    })
  })

  it('builds audio and realtime capability request bodies', () => {
    expect(
      buildProviderAudioSpeechBody({
        model: ' tts-1 ',
        input: '  speak this exactly  ',
        voice: ' nova ',
        responseFormat: ' wav ',
        speed: 1.1,
      }),
    ).toEqual({
      model: 'tts-1',
      input: '  speak this exactly  ',
      voice: 'nova',
      response_format: 'wav',
      speed: 1.1,
    })

    const audio = new File(['audio-bytes'], ' ', { type: '' })
    const transcriptionBody = buildProviderAudioTranscriptionBody({
      model: ' whisper-1 ',
      file: audio,
      prompt: ' ZeroChat names ',
      language: ' en ',
      responseFormat: ' verbose_json ',
      temperature: 0,
    })

    expect(transcriptionBody.get('model')).toBe('whisper-1')
    const transcriptionFile = transcriptionBody.get('file') as File
    expect(transcriptionFile.name).toBe('audio.webm')
    expect(transcriptionFile.type).toBe('audio/webm')
    expect(transcriptionBody.get('prompt')).toBe('ZeroChat names')
    expect(transcriptionBody.get('language')).toBe('en')
    expect(transcriptionBody.get('response_format')).toBe('verbose_json')
    expect(transcriptionBody.get('temperature')).toBe('0')

    const wavBody = buildProviderAudioTranscriptionBody({
      model: 'whisper-1',
      file: new File(['wav-bytes'], ' voice.wav ', { type: '' }),
    })
    const wavFile = wavBody.get('file') as File
    expect(wavFile.name).toBe('voice.wav')
    expect(wavFile.type).toBe('audio/wav')

    const opusBody = buildProviderAudioTranscriptionBody({
      model: 'whisper-1',
      file: new File(['opus-bytes'], ' meeting.opus ', { type: '' }),
    })
    const opusFile = opusBody.get('file') as File
    expect(opusFile.name).toBe('meeting.opus')
    expect(opusFile.type).toBe('audio/opus')

    expect(
      buildProviderRealtimeBody({
        model: ' gpt-realtime-2 ',
        modalities: [' text ', 'audio', ' '],
        instructions: ' stay brief ',
        voice: ' alloy ',
        inputAudioFormat: ' pcm16 ',
        outputAudioFormat: ' opus ',
      }),
    ).toEqual({
      model: 'gpt-realtime-2',
      modalities: ['text'],
      instructions: 'stay brief',
      input_audio_format: 'pcm16',
    })

    expect(
      buildProviderRealtimeClientSecretsBody({
        model: ' gpt-realtime-2 ',
        modalities: [' text ', 'audio', ' '],
        instructions: ' stay brief ',
        voice: ' alloy ',
        inputAudioFormat: ' pcm16 ',
        outputAudioFormat: ' g711_ulaw ',
      }),
    ).toEqual({
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

    expect(
      buildProviderRealtimeClientSecretsBody({
        model: ' gpt-realtime-2 ',
        modalities: [' audio '],
        voice: ' alloy ',
        outputAudioFormat: ' g711_ulaw ',
      }),
    ).toMatchObject({
      session: {
        output_modalities: ['audio'],
        audio: {
          output: {
            format: {
              type: 'audio/pcmu',
            },
            voice: 'alloy',
          },
        },
      },
    })
  })

  it('builds generated image JSON and edit FormData without losing filenames', () => {
    expect(
      buildProviderImageGenerationBody({
        model: ' image-model ',
        prompt: ' draw this ',
        size: '512x512',
      }),
    ).toEqual({
      model: 'image-model',
      prompt: 'draw this',
      n: 1,
      size: '512x512',
      response_format: 'b64_json',
    })
    expect(
      buildProviderResponsesImageGenerationBody({
        model: ' chat-model ',
        prompt: ' draw this ',
        size: '512x512',
      }),
    ).toEqual({
      model: 'chat-model',
      input: 'draw this',
      tools: [
        {
          type: 'image_generation',
          action: 'generate',
          size: '512x512',
        },
      ],
      store: false,
    })
    expect(
      buildProviderResponsesImageEditBody({
        imageDataUrl: 'data:image/png;base64,AA==',
        model: ' chat-model ',
        prompt: ' edit this ',
      }),
    ).toEqual({
      model: 'chat-model',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'edit this',
            },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,AA==',
            },
          ],
        },
      ],
      tools: [
        {
          type: 'image_generation',
          action: 'edit',
          size: '1024x1024',
        },
      ],
      store: false,
    })

    const image = new File(['image-bytes'], ' ', { type: '' })
    const mask = new File(['mask-bytes'], ' mask.webp ', { type: '' })
    const body = buildProviderImageEditBody({
      model: ' edit-model ',
      prompt: ' edit this ',
      image,
      mask,
    })

    expect(body.get('model')).toBe('edit-model')
    expect(body.get('prompt')).toBe('edit this')
    expect(body.get('size')).toBe('1024x1024')
    const imageFile = body.get('image') as File
    const maskFile = body.get('mask') as File
    expect(imageFile.name).toBe('image.png')
    expect(imageFile.type).toBe('image/png')
    expect(maskFile.name).toBe('mask.webp')
    expect(maskFile.type).toBe('image/webp')
  })
})
