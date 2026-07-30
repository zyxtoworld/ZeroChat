import { describe, expect, it, vi } from 'vitest'

import {
  loadLocale,
  setRuntimeLocale,
  type Translator,
} from '../../i18n'
import type { ProviderConfig } from '../../types'
import {
  executeProviderCapabilityRequestPlan,
  providerCapabilityCheckDisplay,
  providerCapabilityCheckReadiness,
  missingProviderCapabilityCheckModels,
  PROVIDER_FULL_CAPABILITY_CHECKS,
  providerCapabilityChecksRequiringServerDrill,
  providerCapabilityChecksForProviderCapabilities,
  providerCapabilityCheckEndpointPath,
  providerCapabilityCheckLabel,
  providerCapabilityCheckKey,
  providerCapabilityCheckModel,
  providerCapabilityCheckRunsInBrowser,
  providerCapabilityCheckSupportedByProviderCapabilities,
  providerCapabilityForRequestKind,
  providerCapabilityRequestForCheck,
} from '../providerCapabilityChecks'
import { buildProviderCapabilityRequestPlan } from '../providerCapabilityRequests'
import { ProviderRequestError } from '../providerErrors'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider One',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
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

const passthroughT = ((key: string) => key) as Translator
const interpolatingT = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function readyPlan(
  kind: ReturnType<typeof providerCapabilityRequestForCheck>['kind'],
) {
  const request =
    kind === 'audio-speech'
      ? providerCapabilityRequestForCheck('audio-speech')
      : kind === 'audio-transcription'
        ? providerCapabilityRequestForCheck('audio-transcription')
        : kind === 'embeddings'
          ? providerCapabilityRequestForCheck('embeddings')
          : kind === 'moderation'
            ? providerCapabilityRequestForCheck('moderation')
            : providerCapabilityRequestForCheck('realtime')
  const plan = buildProviderCapabilityRequestPlan({
    provider: provider(),
    apiKey: 'provider-key',
    proxyToken: '',
    request,
  })

  if (plan.status !== 'ready') {
    throw new Error(`Expected ready plan, got ${plan.status}`)
  }

  return plan
}

function readyProxiedRealtimePlan() {
  const plan = buildProviderCapabilityRequestPlan({
    provider: provider({
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.test',
    }),
    apiKey: '',
    proxyToken: 'proxy-token',
    request: providerCapabilityRequestForCheck('realtime'),
  })

  if (plan.status !== 'ready') {
    throw new Error(`Expected ready plan, got ${plan.status}`)
  }

  return plan
}

describe('provider capability checks', () => {
  it('maps check keys and request presets to executable capabilities', () => {
    expect(providerCapabilityCheckKey('provider-1', 'embeddings')).toBe(
      'provider-1:capability:embeddings',
    )
    expect(providerCapabilityRequestForCheck('audio')).toMatchObject({
      kind: 'audio-speech',
      input: 'ZeroChat capability check.',
    })
    expect(providerCapabilityRequestForCheck('audio-speech')).toMatchObject({
      kind: 'audio-speech',
      input: 'ZeroChat capability check.',
    })
    expect(
      providerCapabilityRequestForCheck('audio-transcription'),
    ).toMatchObject({
      kind: 'audio-transcription',
      language: 'en',
      responseFormat: 'json',
    })
    expect(providerCapabilityRequestForCheck('realtime')).toMatchObject({
      kind: 'realtime',
      modalities: ['text'],
    })
    expect(providerCapabilityForRequestKind('audio-speech')).toBe('audio-speech')
    expect(providerCapabilityForRequestKind('audio-transcription')).toBe(
      'audio-transcription',
    )
    expect(
      providerCapabilityCheckLabel('audio-transcription', passthroughT),
    ).toBe('capability.audio-transcription')
    expect(providerCapabilityCheckLabel('image-edit', passthroughT)).toBe(
      'capability.image-editing',
    )
    expect(providerCapabilityCheckLabel('image-inpaint', passthroughT)).toBe(
      'mode.imageInpaint',
    )
    expect(providerCapabilityCheckEndpointPath('audio')).toBe('/audio/speech')
    expect(providerCapabilityCheckEndpointPath('audio-speech')).toBe(
      '/audio/speech',
    )
    expect(providerCapabilityCheckEndpointPath('audio-transcription')).toBe(
      '/audio/transcriptions',
    )
    expect(providerCapabilityCheckEndpointPath('embeddings')).toBe('/embeddings')
    expect(providerCapabilityCheckEndpointPath('image-generation')).toBe(
      '/images/generations',
    )
    expect(providerCapabilityCheckEndpointPath('image-edit')).toBe(
      '/images/edits',
    )
    expect(providerCapabilityCheckEndpointPath('image-inpaint')).toBe(
      '/images/edits',
    )
    expect(providerCapabilityCheckEndpointPath('moderation')).toBe('/moderations')
    expect(providerCapabilityCheckEndpointPath('realtime')).toBe(
      '/realtime/client_secrets',
    )
    expect(
      providerCapabilityCheckSupportedByProviderCapabilities(
        'audio-transcription',
        ['audio'],
      ),
    ).toBe(true)
    expect(providerCapabilityCheckRunsInBrowser('embeddings')).toBe(true)
    expect(providerCapabilityCheckRunsInBrowser('image-generation')).toBe(true)
    expect(providerCapabilityCheckRunsInBrowser('image-edit')).toBe(true)
    expect(providerCapabilityCheckRunsInBrowser('image-inpaint')).toBe(true)
    expect(providerCapabilityCheckRunsInBrowser('realtime')).toBe(false)
    expect(
      providerCapabilityCheckRunsInBrowser(
        'realtime',
        provider({
          needsApiKey: false,
          proxyUrl: 'https://proxy.example.test',
        }),
      ),
    ).toBe(true)
    expect(providerCapabilityCheckModel(provider(), 'embeddings')).toBe(
      'text-embedding-3-large',
    )
    expect(providerCapabilityCheckModel(provider(), 'image-generation')).toBe(
      'gpt-image-2',
    )
    expect(providerCapabilityCheckModel(provider(), 'image-edit')).toBe(
      'gpt-image-2',
    )
    expect(providerCapabilityCheckModel(provider(), 'image-inpaint')).toBe(
      'gpt-image-2',
    )
    expect(providerCapabilityCheckModel(provider(), 'audio-speech')).toBe('tts-1')
    expect(providerCapabilityCheckModel(provider(), 'realtime')).toBe(
      'gpt-realtime-2',
    )
    expect(
      providerCapabilityCheckModel(provider({ models: [] }), 'embeddings'),
    ).toBe('text-embedding-3-large')
    expect(
      providerCapabilityCheckModel(
        provider({ models: ['gpt-5.4-mini'] }),
        'embeddings',
      ),
    ).toBe('')
    expect(PROVIDER_FULL_CAPABILITY_CHECKS).toEqual([
      'image-generation',
      'image-edit',
      'image-inpaint',
      'embeddings',
      'moderation',
      'audio-speech',
      'audio-transcription',
      'realtime',
    ])
    expect(
      providerCapabilityChecksForProviderCapabilities([
        'chat',
        'audio',
        'embeddings',
        'image-editing',
        'image-generation',
        'model-list',
      ]),
    ).toEqual([
      'image-generation',
      'image-edit',
      'image-inpaint',
      'embeddings',
      'audio-speech',
      'audio-transcription',
    ])
    expect(
      missingProviderCapabilityCheckModels(
        provider({
          models: ['gpt-5.4-mini', 'tts-1'],
        }),
        ['chat', 'audio', 'embeddings', 'moderation', 'realtime', 'model-list'],
      ),
    ).toEqual([
      'embeddings',
      'moderation',
      'audio-transcription',
      'realtime',
    ])
    expect(
      providerCapabilityChecksRequiringServerDrill(
        provider(),
        ['chat', 'audio', 'embeddings', 'moderation', 'realtime', 'model-list'],
      ),
    ).toEqual(['realtime'])
    expect(
      providerCapabilityChecksRequiringServerDrill(
        provider({
          needsApiKey: false,
          proxyUrl: 'https://proxy.example.test',
        }),
        ['chat', 'audio', 'embeddings', 'moderation', 'realtime', 'model-list'],
      ),
    ).toEqual([])
    expect(
      providerCapabilityChecksRequiringServerDrill(
        provider({
          models: ['gpt-5.4-mini'],
        }),
        ['chat', 'audio', 'embeddings', 'moderation', 'realtime', 'model-list'],
      ),
    ).toEqual([])
  })

  it('summarizes full-capability readiness from one shared state machine', () => {
    expect(
      providerCapabilityCheckReadiness(
        provider({
          models: ['gpt-5.4-mini', 'tts-1'],
        }),
        ['chat', 'audio', 'embeddings', 'moderation', 'realtime', 'model-list'],
        interpolatingT,
      ),
    ).toMatchObject({
      missingModelChecks: [
        'embeddings',
        'moderation',
        'audio-transcription',
        'realtime',
      ],
      serverDrillChecks: [],
      state: 'missing-models',
      text:
        'settings.capabilityReadinessMissing:{"capabilities":"capability.embeddings / capability.moderation / capability.audio-transcription / capability.realtime"}',
    })

    expect(
      providerCapabilityCheckReadiness(
        provider(),
        ['chat', 'audio', 'embeddings', 'moderation', 'realtime', 'model-list'],
        interpolatingT,
      ),
    ).toMatchObject({
      missingModelChecks: [],
      serverDrillChecks: ['realtime'],
      state: 'server-drill',
      text: 'error.realtimeServerDrill · capability.realtime',
    })

    expect(
      providerCapabilityCheckReadiness(
        provider({
          needsApiKey: false,
          proxyUrl: 'https://proxy.example.test',
        }),
        ['chat', 'audio', 'embeddings', 'moderation', 'realtime', 'model-list'],
        interpolatingT,
      ),
    ).toMatchObject({
      missingModelChecks: [],
      serverDrillChecks: [],
      state: 'ready',
      text: 'settings.capabilityReadinessReady',
    })
  })

  it('builds shared capability chip display state for Settings and first-run UI', () => {
    expect(
      providerCapabilityCheckDisplay(
        provider({
          imageModel: '',
          models: ['gpt-5.4-mini'],
        }),
        'image-generation',
        interpolatingT,
      ),
    ).toMatchObject({
      endpointPath: '/images/generations',
      label: 'capability.image-generation',
      missingModelGuidance:
        'error.capabilityModelRequired:{"capability":"capability.image-generation"}',
      modelName: '',
      modelText: 'settings.capabilityCheckModelMissing',
      runsInBrowser: true,
      state: 'missing-model',
      tooltip:
        'error.capabilityModelRequired:{"capability":"capability.image-generation"}',
    })

    expect(
      providerCapabilityCheckDisplay(provider(), 'embeddings', interpolatingT),
    ).toMatchObject({
      endpointModelText:
        '/embeddings · settings.capabilityCheckModel:{"model":"text-embedding-3-large"}',
      endpointPath: '/embeddings',
      label: 'capability.embeddings',
      modelName: 'text-embedding-3-large',
      modelText: 'settings.capabilityCheckModel:{"model":"text-embedding-3-large"}',
      runsInBrowser: true,
      state: 'ready',
      tooltip:
        '/embeddings · settings.capabilityCheckModel:{"model":"text-embedding-3-large"}',
    })

    expect(
      providerCapabilityCheckDisplay(provider(), 'realtime', interpolatingT),
    ).toMatchObject({
      endpointPath: '/realtime/client_secrets',
      label: 'capability.realtime',
      modelName: 'gpt-realtime-2',
      modelText: 'settings.capabilityCheckModel:{"model":"gpt-realtime-2"}',
      runsInBrowser: false,
      serverDrillText:
        'error.realtimeServerDrill · settings.capabilityCheckModel:{"model":"gpt-realtime-2"}',
      state: 'server-drill',
      tooltip:
        '/realtime/client_secrets · error.realtimeServerDrill · settings.capabilityCheckModel:{"model":"gpt-realtime-2"}',
    })
  })

  it('validates successful embeddings, moderation, audio speech, audio transcription, and realtime client-secret responses', async () => {
    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('embeddings'),
        fetcher: vi.fn(async () =>
          Response.json({ data: [{ embedding: [0.1, 0.2] }] }),
        ),
      }),
    ).resolves.toMatchObject({
      capability: 'embeddings',
      model: 'text-embedding-3-large',
      status: 200,
    })

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('moderation'),
        fetcher: vi.fn(async () =>
          Response.json({ results: [{ flagged: false }] }),
        ),
      }),
    ).resolves.toMatchObject({
      capability: 'moderation',
      model: 'omni-moderation-latest',
    })

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('audio-speech'),
        fetcher: vi.fn(async () =>
          new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), {
            headers: { 'content-type': 'audio/mpeg' },
          }),
        ),
      }),
    ).resolves.toMatchObject({
      capability: 'audio-speech',
      model: 'tts-1',
    })

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('audio-transcription'),
        fetcher: vi.fn(async () => Response.json({ text: 'ZeroChat OK' })),
      }),
    ).resolves.toMatchObject({
      capability: 'audio-transcription',
      model: 'gpt-4o-transcribe',
    })

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyProxiedRealtimePlan(),
        fetcher: vi.fn(async () =>
          Response.json({
            client_secret: {
              value: 'ek_zerochat_realtime_test',
              expires_at: 1_800_000_000,
            },
          }),
        ),
      }),
    ).resolves.toMatchObject({
      capability: 'realtime',
      model: 'gpt-realtime-2',
    })
  })

  it('accepts common successful audio transcription response shapes', async () => {
    const responses = [
      new Response('plain transcript'),
      Response.json({ output_text: 'ZeroChat OK' }),
      Response.json({ transcript: 'ZeroChat transcript' }),
      Response.json({ segments: [{ text: 'ZeroChat' }] }),
      Response.json({
        data: [
          {
            content: [{ text: 'ZeroChat from nested content' }],
          },
        ],
      }),
    ]

    for (const response of responses) {
      await expect(
        executeProviderCapabilityRequestPlan({
          plan: readyPlan('audio-transcription'),
          fetcher: vi.fn(async () => response),
        }),
      ).resolves.toMatchObject({
        capability: 'audio-transcription',
        model: 'gpt-4o-transcribe',
      })
    }
  })

  it('rejects malformed capability responses without hiding HTTP errors', async () => {
    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('embeddings'),
        fetcher: vi.fn(async () => Response.json({ data: [] })),
      }),
    ).rejects.toThrow('error.capabilityResponseInvalid')

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('moderation'),
        fetcher: vi.fn(async () =>
          Response.json({ error: { message: 'invalid api key' } }, { status: 401 }),
        ),
      }),
    ).rejects.toBeInstanceOf(ProviderRequestError)

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('audio-transcription'),
        fetcher: vi.fn(async () => Response.json({ data: [] })),
      }),
    ).rejects.toThrow('error.capabilityResponseInvalid')

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('audio-transcription'),
        fetcher: vi.fn(async () =>
          new Response('{not valid transcription json', {
            headers: { 'content-type': 'application/json' },
          }),
        ),
      }),
    ).rejects.toThrow('error.capabilityResponseInvalid')

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('audio-transcription'),
        fetcher: vi.fn(async () =>
          new Response('[not valid transcription json', {
            headers: { 'content-type': 'application/json' },
          }),
        ),
      }),
    ).rejects.toThrow('error.capabilityResponseInvalid')

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('audio-speech'),
        fetcher: vi.fn(async () =>
          Response.json({ error: { message: 'not an audio response' } }),
        ),
      }),
    ).rejects.toThrow('error.capabilityResponseInvalid')

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('audio-speech'),
        fetcher: vi.fn(async () =>
          new Response('upstream route returned text instead of speech audio', {
            headers: { 'content-type': 'text/plain' },
          }),
        ),
      }),
    ).rejects.toThrow('error.capabilityResponseInvalid')

    const unreadableAudioResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('body stream locked'))
        },
      }),
      {
        headers: { 'content-type': 'audio/mpeg' },
      },
    )

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('audio-speech'),
        fetcher: vi.fn(async () => unreadableAudioResponse),
      }),
    ).rejects.toThrow('error.capabilityResponseInvalid')

    const unreadableTranscriptionResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('body stream locked'))
        },
      }),
    )

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('audio-transcription'),
        fetcher: vi.fn(async () => unreadableTranscriptionResponse),
      }),
    ).rejects.toThrow('error.capabilityResponseInvalid')

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyProxiedRealtimePlan(),
        fetcher: vi.fn(async () =>
          Response.json({ client_secret: { expires_at: 1_800_000_000 } }),
        ),
      }),
    ).rejects.toThrow('error.capabilityResponseInvalid')
  })

  it('reports provider HTML capability responses without collapsing them to invalid shape', async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('embeddings'),
        fetcher: vi.fn(async () =>
          new Response('<!doctype html><html><body>proxy login</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        ),
      }),
    ).rejects.toMatchObject({
      code: 'server',
      retryable: true,
      status: 200,
      message:
        'The provider or relay returned a web page instead of API JSON. Check the Base URL path or AI proxy route.',
    })
  })

  it('turns stalled capability requests into retryable timeout errors', async () => {
    vi.useFakeTimers()

    try {
      const request = executeProviderCapabilityRequestPlan({
        plan: readyPlan('embeddings'),
        fetcher: vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          }),
        ),
        timeoutMs: 25,
      })
      const rejection = expect(request).rejects.toMatchObject({
        code: 'timeout',
        retryable: true,
      })

      await vi.advanceTimersByTimeAsync(25)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out a stalled capability body reader that ignores fetch abort', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => Promise.resolve(undefined))
    const read = vi.fn(
      () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
    )
    const response = {
      body: {
        getReader: () => ({ cancel, read }),
      },
      headers: new Headers({ 'content-type': 'application/json' }),
      ok: true,
      status: 200,
    } as unknown as Response

    try {
      const request = executeProviderCapabilityRequestPlan({
        plan: readyPlan('embeddings'),
        fetcher: vi.fn(async () => response),
        timeoutMs: 25,
      })
      const rejection = expect(request).rejects.toMatchObject({
        code: 'timeout',
        retryable: true,
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(25)
      await rejection
      expect(cancel).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps user-cancelled capability requests as AbortError', async () => {
    const controller = new AbortController()
    const plan = readyPlan('embeddings')
    const request = executeProviderCapabilityRequestPlan({
      plan: {
        ...plan,
        init: {
          ...plan.init,
          signal: controller.signal,
        },
      },
      fetcher: vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
      ),
    })
    const rejection = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    })

    controller.abort()
    await rejection
  })

  it('rejects a late capability result after source cancellation', async () => {
    const controller = new AbortController()
    const plan = readyPlan('embeddings')

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: {
          ...plan,
          init: {
            ...plan.init,
            signal: controller.signal,
          },
        },
        fetcher: vi.fn(async () => {
          controller.abort()
          return Response.json({ data: [{ embedding: [0.1, 0.2] }] })
        }),
      }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('wraps capability network failures with localized capability targets', async () => {
    await loadLocale('en-US')
    setRuntimeLocale('en-US')

    await expect(
      executeProviderCapabilityRequestPlan({
        plan: readyPlan('moderation'),
        fetcher: vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      }),
    ).rejects.toMatchObject({
      code: 'network',
      message: expect.stringContaining('Cannot connect to Moderation'),
      retryable: true,
    })
  })
})
