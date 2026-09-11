import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import {
  cancelProviderConnectivityCheckRuns,
  clearProviderConnectivityResult,
  createProviderConnectivityCheckActions,
  type ProviderConnectivityCheckContext,
  type ProviderConnectivityCheckServices,
} from '../providerConnectivityChecks'
import { ProviderRequestError } from '../providerErrors'
import type { ProviderConnectivityResult } from '../providerStatus'

const testTranslations: Record<string, string> = {
  error: 'error',
  'error.providerCapabilityEndpointRouteHealth':
    'If this uses a ZeroChat Worker proxy, verify the Worker deployment, hosted provider key, and proxy action path; if it calls a third-party relay directly, that relay must expose this capability route.',
  'error.providerCapabilityServiceHealth':
    'If this capability returns a service error through a ZeroChat Worker proxy, check the proxy action, hosted provider key, model/service availability, and upstream quota; if it calls a third-party relay directly, that relay or upstream provider must return a healthy capability response.',
}

const t = ((key: string, values?: Record<string, unknown>) => {
  const translation = testTranslations[key] ?? key

  return values ? `${translation}:${JSON.stringify(values)}` : translation
}) as Translator

function provider(
  id: string,
  patch: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    id,
    baseUrl: `https://${id}.example.com/v1`,
    createdAt: 1,
    enabled: true,
    kind: 'openai-compatible',
    model: `${id}-chat`,
    models: [`${id}-chat`, `${id}-vision`, `${id}-image`],
    imageModel: `${id}-image`,
    name: id.toUpperCase(),
    needsApiKey: true,
    updatedAt: 1,
    ...patch,
  }
}

function appData(providers = [provider('p1')]): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers,
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: true,
      encryptionEnabled: true,
      mode: 'cloudflare',
    },
    updatedAt: 1,
  }
}

function createHarness({
  checkingProviderId = '',
  initialData = appData(),
  providerKeys = { p1: 'key-1' },
}: {
  checkingProviderId?: string
  initialData?: AppData
  providerKeys?: Record<string, string>
} = {}) {
  const dataRef = { current: initialData }
  const providerResultsRef: {
    current: Record<string, ProviderConnectivityResult>
  } = { current: {} }
  const modelLoadProviderIdRef = { current: '' }

  const services: ProviderConnectivityCheckServices = {
    accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
    executeProviderCapabilityRequestPlan: vi.fn(async ({ plan }) => ({
      capability:
        plan.kind === 'embeddings' ||
        plan.kind === 'moderation' ||
        plan.kind === 'realtime' ||
        plan.kind === 'audio-speech' ||
        plan.kind === 'audio-transcription'
          ? plan.kind
          : 'audio',
      model: plan.model,
      status: 200,
    })),
    generateImage: vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,AA==',
      mimeType: 'image/png',
    })),
    editImage: vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,AA==',
      mimeType: 'image/png',
    })),
    listProviderModels: vi.fn(async () => ['p1-chat', 'p1-image', 'p1-chat']),
    replaceManagedProxyHosts: vi.fn(async () => undefined),
    streamChat: vi.fn(async ({ onToken }) => {
      onToken('OK')
    }),
  }

  const context: ProviderConnectivityCheckContext = {
    checkingProviderId,
    dataRef,
    formatErrorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    guideVisible: false,
    modelLoadProviderIdRef,
    providerKeysRef: { current: providerKeys },
    setCheckingProviderId: vi.fn(),
    setLoadingModelsProviderId: vi.fn(),
    setNotice: vi.fn(),
    setProviderConnectivityResults: vi.fn((updater) => {
      providerResultsRef.current = updater(providerResultsRef.current)
    }),
    setProviderModels: vi.fn((providerId, models, preferredModel) => {
      dataRef.current = {
        ...dataRef.current,
        providers: dataRef.current.providers.map((item) =>
          item.id === providerId
            ? {
                ...item,
                models,
                model: preferredModel ?? item.model,
              }
            : item,
        ),
      }
    }),
    syncPassphraseRef: { current: 'sync-passphrase' },
    t,
  }

  return {
    actions: createProviderConnectivityCheckActions(context, services),
    context,
    dataRef,
    modelLoadProviderIdRef,
    providerResultsRef,
    services,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

describe('provider connectivity check helpers', () => {
  beforeEach(() => {
    cancelProviderConnectivityCheckRuns()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T00:00:01Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears stale Provider results without disturbing other providers', () => {
    let current = {
      p1: { field: 'baseUrl' } as ProviderConnectivityResult,
      p2: { field: 'providerKey' } as ProviderConnectivityResult,
    }
    const setProviderConnectivityResults = vi.fn((updater) => {
      current = updater(current)
    })

    clearProviderConnectivityResult(
      { setProviderConnectivityResults },
      'missing',
    )
    expect(current).toMatchObject({ p1: { field: 'baseUrl' }, p2: { field: 'providerKey' } })

    clearProviderConnectivityResult(
      { setProviderConnectivityResults },
      'p1',
    )
    expect(current).toEqual({ p2: { field: 'providerKey' } })
  })

  it('reports missing selected models and empty model refreshes before network work', async () => {
    const missing = createHarness({
      initialData: appData([
        provider('p1', {
          audioSpeechModel: '',
          audioTranscriptionModel: '',
          embeddingModel: '',
          imageModel: '',
          moderationModel: '',
          realtimeModel: '',
        }),
      ]),
    })

    for (const kind of [
      'audio-speech',
      'audio-transcription',
      'embeddings',
      'moderation',
      'realtime',
      'image',
    ] as const) {
      await missing.actions.checkSelectedModel('p1', kind)
    }
    expect(missing.context.setNotice).toHaveBeenCalled()

    vi.mocked(missing.services.listProviderModels).mockResolvedValueOnce([])
    await missing.actions.refreshProviderModels('p1')
    expect(missing.context.setNotice).toHaveBeenCalledWith(
      'notice.modelsFetched:{"count":0}',
      'success',
      'models',
    )
  })

  it('keeps capability checks fail-closed for missing providers, models, keys, and disabled providers', async () => {
    const harness = createHarness()
    await harness.actions.checkProviderCapability('missing', 'audio-speech')

    const missingModel = createHarness({
      initialData: appData([
        provider('p1', {
          audioSpeechModel: '',
          capabilities: ['chat', 'audio'],
        }),
      ]),
    })
    await missingModel.actions.checkProviderCapability('p1', 'audio-speech')

    const disabledImage = createHarness({
      initialData: appData([
        provider('p1', {
          enabled: false,
          capabilities: ['chat', 'image-generation'],
        }),
      ]),
    })
    await disabledImage.actions.checkProviderCapability('p1', 'image-generation')

    const missingImageModel = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['chat', 'image-generation'],
          imageModel: '',
          models: ['p1-chat'],
        }),
      ]),
    })
    await missingImageModel.actions.checkProviderCapability('p1', 'image-generation')

    const missingImageKey = createHarness({
      providerKeys: {},
      initialData: appData([
        provider('p1', {
          capabilities: ['chat', 'image-generation'],
        }),
      ]),
    })
    await missingImageKey.actions.checkProviderCapability('p1', 'image-generation')
    expect(missingImageKey.context.setNotice).toHaveBeenCalled()
  })

  it('ignores missing providers and busy provider operations before network work', async () => {
    const missing = createHarness()

    await expect(
      missing.actions.runProviderConnectivityCheck('missing'),
    ).resolves.toBeNull()
    await missing.actions.checkSelectedModel('missing', 'chat')
    await missing.actions.checkProviderCapability('missing', 'image-generation')
    await missing.actions.checkProviderFullCapabilities('missing')
    await missing.actions.refreshProviderModels('missing')

    const busy = createHarness({ checkingProviderId: 'provider:p2' })
    await busy.actions.checkProviderFullCapabilities('p1')

    expect(missing.services.listProviderModels).not.toHaveBeenCalled()
    busy.modelLoadProviderIdRef.current = 'p2'
    await busy.actions.refreshProviderModels('p1')

    expect(busy.services.listProviderModels).not.toHaveBeenCalled()
    expect(busy.services.executeProviderCapabilityRequestPlan).not.toHaveBeenCalled()
  })

  it('reports model-list failures and empty configured catalogs without probing a model', async () => {
    const failedCatalog = createHarness()
    vi.mocked(failedCatalog.services.listProviderModels).mockRejectedValueOnce(
      new ProviderRequestError('auth', 'catalog authentication failed', {
        retryable: false,
        status: 401,
      }),
    )

    const failedResult = await failedCatalog.actions.runProviderConnectivityCheck('p1')

    expect(failedResult).toMatchObject({
      field: 'providerKey',
      tone: 'error',
    })
    expect(failedCatalog.services.streamChat).not.toHaveBeenCalled()

    const emptyCatalog = createHarness({
      initialData: appData([
        provider('p1', {
          audioSpeechModel: '',
          audioTranscriptionModel: '',
          embeddingModel: '',
          imageModel: '',
          model: '',
          models: [],
          moderationModel: '',
          realtimeModel: '',
        }),
      ]),
    })
    vi.mocked(emptyCatalog.services.listProviderModels).mockResolvedValueOnce([])

    const emptyResult = await emptyCatalog.actions.runProviderConnectivityCheck('p1')

    expect(emptyResult).toMatchObject({
      field: 'baseUrl',
      message: 'notice.providerConnectivityFailed:{"message":"error.modelRequired"}',
      tone: 'error',
    })
    expect(emptyCatalog.services.streamChat).not.toHaveBeenCalled()
  })

  it('fails closed when a proxied capability has no derived access key', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['embeddings'],
          embeddingModel: 'text-embedding-3-large',
          models: ['p1-chat', 'text-embedding-3-large'],
          needsApiKey: false,
          proxyUrl: 'https://proxy.example.com/zerochat',
        }),
      ]),
      providerKeys: {},
    })
    vi.mocked(harness.services.accessKeyFromPassword).mockResolvedValue('')

    await harness.actions.checkProviderCapability('p1', 'embeddings')
    await harness.actions.checkSelectedModel('p1', 'embeddings')

    expect(harness.services.executeProviderCapabilityRequestPlan).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'error.cloudflareAccessKeyRequired',
      'warning',
      'provider-capabilities',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityFailed:{"message":"error.cloudflareAccessKeyRequired"}',
      'error',
      'model-embedding',
    )
  })

  it('reports image proxy derivation failures and full-capability provider-key blockers', async () => {
    const imageHarness = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['image-generation'],
          models: ['p1-chat', 'p1-image'],
          needsApiKey: false,
          proxyUrl: 'https://proxy.example.com/zerochat',
        }),
      ]),
      providerKeys: {},
    })
    vi.mocked(imageHarness.services.accessKeyFromPassword).mockRejectedValueOnce(
      new Error('proxy access key failed'),
    )

    await imageHarness.actions.checkProviderCapability('p1', 'image-generation')

    expect(imageHarness.context.setNotice).toHaveBeenCalledWith(
      expect.stringContaining('proxy access key failed'),
      'error',
      'provider-capabilities',
    )

    const fullHarness = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['embeddings'],
          embeddingModel: 'text-embedding-3-large',
          models: ['p1-chat', 'text-embedding-3-large'],
        }),
      ]),
      providerKeys: {},
    })

    await fullHarness.actions.checkProviderFullCapabilities('p1')

    expect(fullHarness.providerResultsRef.current.p1).toMatchObject({
      field: 'providerKey',
      tone: 'warning',
    })
    expect(fullHarness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerFullCapabilityCheckFailed:{"failed":1,"total":1}',
      'warning',
      'provider-capabilities',
    )
  })

  it('handles disabled and capability-less providers without starting full checks', async () => {
    const disabled = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['embeddings'],
          embeddingModel: 'text-embedding-3-large',
          enabled: false,
          models: ['p1-chat', 'text-embedding-3-large'],
        }),
      ]),
    })
    await disabled.actions.checkProviderCapability('p1', 'embeddings')

    expect(disabled.context.setNotice).toHaveBeenCalledWith(
      'notice.providerDisabled:{"provider":"P1"}',
      'error',
      'provider-capabilities',
    )

    const noChecks = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['chat'],
        }),
      ]),
    })
    await noChecks.actions.checkProviderFullCapabilities('p1')

    expect(noChecks.context.setCheckingProviderId).not.toHaveBeenCalledWith(
      'p1:capabilities',
    )
  })

  it.each([
    ['anthropic', '/messages'],
    ['openai-responses', '/responses'],
  ] as const)('reports the %s chat endpoint when its probe fails', async (kind, endpoint) => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          kind,
        }),
      ]),
    })
    vi.mocked(harness.services.streamChat).mockRejectedValueOnce(
      new Error('chat probe failed'),
    )

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(result?.message).toContain(`${endpoint} · p1-chat · chat probe failed`)
  })

  it('formats non-object provider failures and rethrows state-write failures', async () => {
    const nonObjectFailure = createHarness()
    vi.mocked(nonObjectFailure.services.streamChat).mockRejectedValueOnce(
      'provider returned a string error',
    )

    const result = await nonObjectFailure.actions.runProviderConnectivityCheck('p1')

    expect(result?.message).toContain('provider returned a string error')

    const stateFailure = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['embeddings'],
          embeddingModel: 'text-embedding-3-large',
          models: ['p1-chat', 'text-embedding-3-large'],
        }),
      ]),
    })
    stateFailure.context.setProviderConnectivityResults = vi.fn(() => {
      throw new Error('state write failed')
    })

    await expect(
      stateFailure.actions.checkProviderCapability('p1', 'embeddings'),
    ).rejects.toThrow('state write failed')
  })

  it('surfaces provider-key requirements before provider connectivity checks', async () => {
    const harness = createHarness({ providerKeys: {} })

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(result).toMatchObject({
      field: 'providerKey',
      message: 'error.providerKeyRequired',
      retryable: false,
      tone: 'error',
    })
    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(harness.services.listProviderModels).not.toHaveBeenCalled()
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'providerKey',
    })
  })

  it('proves provider connectivity with the fetched model list and a chat probe', async () => {
    const harness = createHarness()

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key-1',
        proxyToken: '',
      }),
    )
    expect(harness.services.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key-1',
        contextMessageLimit: expect.any(Number),
        model: 'p1-chat',
        proxyToken: '',
        provider: expect.objectContaining({
          model: 'p1-chat',
          models: ['p1-chat', 'p1-image'],
        }),
      }),
    )
    expect(result).toMatchObject({
      field: 'none',
      message:
        'notice.providerConnectivityPassed:{"count":2,"model":"p1-chat"}',
      models: ['p1-chat', 'p1-image'],
      retryable: false,
      tone: 'success',
    })
    expect(harness.providerResultsRef.current.p1).toMatchObject({ field: 'none' })
    expect(harness.context.setProviderModels).toHaveBeenCalledWith(
      'p1',
      ['p1-chat', 'p1-image'],
      'p1-chat',
    )
    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
  })

  it('probes and preserves an explicit chat model omitted by the provider catalog', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          model: 'gpt-manual-alias',
          models: ['old-chat', 'p1-image'],
        }),
      ]),
    })
    vi.mocked(harness.services.listProviderModels).mockResolvedValueOnce([
      'gpt-5.6-catalog',
      'p1-image',
    ])
    vi.mocked(harness.services.streamChat).mockImplementationOnce(
      async ({ model, onToken }) => {
        if (model !== 'gpt-manual-alias') {
          throw new ProviderRequestError(
            'server',
            'catalog model temporarily unavailable',
            { retryable: true, status: 503 },
          )
        }

        onToken('OK')
      },
    )

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.streamChat).toHaveBeenCalledTimes(1)
    expect(harness.services.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-manual-alias',
        provider: expect.objectContaining({
          model: 'gpt-manual-alias',
          models: ['gpt-manual-alias', 'gpt-5.6-catalog', 'p1-image'],
        }),
      }),
    )
    expect(result).toMatchObject({
      field: 'none',
      models: ['gpt-manual-alias', 'gpt-5.6-catalog', 'p1-image'],
      tone: 'success',
    })
    expect(harness.context.setProviderModels).toHaveBeenCalledWith(
      'p1',
      ['gpt-manual-alias', 'gpt-5.6-catalog', 'p1-image'],
      'gpt-manual-alias',
    )
  })

  it('probes a newly configured explicit model before a stronger fetched catalog model', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          model: 'gpt-5-6-pro',
          models: ['gpt-5-5', 'p1-image'],
        }),
      ]),
    })
    vi.mocked(harness.services.listProviderModels).mockResolvedValueOnce([
      'gpt-5-6-pro',
      'gpt-5.6-sol-wm',
      'p1-image',
    ])
    vi.mocked(harness.services.streamChat).mockImplementationOnce(
      async ({ model, onToken }) => {
        if (model !== 'gpt-5-6-pro') {
          throw new ProviderRequestError(
            'server',
            'auto-preferred catalog model temporarily unavailable',
            { retryable: true, status: 503 },
          )
        }

        onToken('OK')
      },
    )

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.streamChat).toHaveBeenCalledTimes(1)
    expect(harness.services.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5-6-pro' }),
    )
    expect(result).toMatchObject({
      field: 'none',
      models: ['gpt-5-6-pro', 'gpt-5.6-sol-wm', 'p1-image'],
      tone: 'success',
    })
    expect(harness.context.setProviderModels).toHaveBeenCalledWith(
      'p1',
      ['gpt-5-6-pro', 'gpt-5.6-sol-wm', 'p1-image'],
      'gpt-5-6-pro',
    )
  })

  it('derives proxy access keys for proxied provider connectivity checks', async () => {
    const proxied = provider('p1', {
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.com/zerochat/proxy',
    })
    const harness = createHarness({
      initialData: appData([proxied]),
      providerKeys: {},
    })

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.accessKeyFromPassword).toHaveBeenCalledWith(
      'sync-passphrase',
    )
    expect(harness.services.replaceManagedProxyHosts).toHaveBeenCalledWith(
      [
        {
          baseUrls: ['https://p1.example.com/v1'],
          endpoint: 'https://proxy.example.com/zerochat',
          token: 'proxy-token',
        },
      ],
      [],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(
      vi.mocked(harness.services.replaceManagedProxyHosts).mock
        .invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      vi.mocked(harness.services.listProviderModels).mock
        .invocationCallOrder[0] ?? 0,
    )
    expect(harness.services.listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyToken: 'proxy-token',
      }),
    )
    expect(harness.services.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyToken: 'proxy-token',
      }),
    )
    expect(result).toMatchObject({
      field: 'none',
      tone: 'success',
    })
  })

  it('prepares managed sync-worker proxy hosts before first-run provider connectivity checks', async () => {
    const customRelay = provider('p1', {
      baseUrl: 'https://custom-relay.example.test/v1',
      needsApiKey: false,
    })
    const data = appData([customRelay])
    data.sync = {
      ...data.sync,
      workerEndpoint: 'https://sync.example.workers.dev',
    }
    const harness = createHarness({
      initialData: data,
      providerKeys: {},
    })

    await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.replaceManagedProxyHosts).toHaveBeenCalledWith(
      [
        {
          baseUrls: ['https://custom-relay.example.test/v1'],
          endpoint: 'https://sync.example.workers.dev',
          token: 'proxy-token',
        },
      ],
      [],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(harness.services.listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          proxyUrl: 'https://sync.example.workers.dev',
        }),
        proxyToken: 'proxy-token',
      }),
    )
  })

  it('stops provider connectivity when managed proxy host preparation fails', async () => {
    const proxied = provider('p1', {
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.com/zerochat',
    })
    const harness = createHarness({
      initialData: appData([proxied]),
      providerKeys: {},
    })
    vi.mocked(harness.services.replaceManagedProxyHosts).mockRejectedValueOnce(
      new Error('host-list refused'),
    )

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(result).toMatchObject({
      field: 'proxyUrl',
      message:
        'notice.providerConnectivityFailed:{"message":"/proxy/hosts · host-list refused"}',
      retryable: true,
      tone: 'error',
    })
    expect(harness.services.listProviderModels).not.toHaveBeenCalled()
    expect(harness.services.streamChat).not.toHaveBeenCalled()
  })

  it('skips managed proxy host preparation for built-in provider hosts', async () => {
    const proxiedOfficialHost = provider('p1', {
      baseUrl: 'https://api.openai.com/v1',
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.com/zerochat',
    })
    const harness = createHarness({
      initialData: appData([proxiedOfficialHost]),
      providerKeys: {},
    })

    await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.replaceManagedProxyHosts).not.toHaveBeenCalled()
    expect(harness.services.listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyToken: 'proxy-token',
      }),
    )
  })

  it('keeps model-list failure context when no configured chat model can be probed', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          imageModel: '',
          model: '',
          models: [],
        }),
      ]),
    })
    vi.mocked(harness.services.listProviderModels).mockRejectedValueOnce(
      new ProviderRequestError(
        'endpoint',
        'This provider or relay does not expose that endpoint.',
        { retryable: false, status: 404 },
      ),
    )

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.streamChat).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      field: 'baseUrl',
      message:
        'notice.providerConnectivityFailed:{"message":"/models · HTTP 404 · This provider or relay does not expose that endpoint. · If this uses a ZeroChat Worker proxy, verify the Worker deployment, hosted provider key, and proxy action path; if it calls a third-party relay directly, that relay must expose this capability route."}',
      retryable: false,
      tone: 'error',
    })
  })

  it('falls back to the configured chat model when the provider model list is unavailable', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.listProviderModels).mockRejectedValueOnce(
      new ProviderRequestError(
        'endpoint',
        'This provider or relay does not expose that endpoint.',
        { retryable: false, status: 404 },
      ),
    )

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'p1-chat',
        provider: expect.objectContaining({
          model: 'p1-chat',
        }),
      }),
    )
    expect(result).toMatchObject({
      field: 'none',
      message:
        'notice.providerConnectivityPassedWithConfiguredModel:{"message":"/models · HTTP 404 · This provider or relay does not expose that endpoint. · If this uses a ZeroChat Worker proxy, verify the Worker deployment, hosted provider key, and proxy action path; if it calls a third-party relay directly, that relay must expose this capability route.","model":"p1-chat"}',
      retryable: false,
      tone: 'success',
    })
    expect(result?.models).toBeUndefined()
    expect(harness.context.setProviderModels).toHaveBeenCalledWith(
      'p1',
      ['p1-chat', 'p1-vision', 'p1-image'],
      'p1-chat',
    )
  })

  it('points direct browser chat network failures at the proxy URL field', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          imageModel: '',
          models: ['p1-chat'],
        }),
      ]),
    })
    vi.mocked(harness.services.listProviderModels).mockRejectedValueOnce(
      new ProviderRequestError(
        'network',
        'Cannot connect to Model list API. If native or terminal tools work but the browser does not, the browser path is blocked by CORS/preflight; enter a Cloudflare Worker URL in AI proxy URL and rerun the check.',
        { retryable: true },
      ),
    )
    vi.mocked(harness.services.streamChat).mockRejectedValueOnce(
      new ProviderRequestError(
        'network',
        'Cannot connect to Chat API. If native or terminal tools work but the browser does not, the browser path is blocked by CORS/preflight; enter a Cloudflare Worker URL in AI proxy URL and rerun the check.',
        { retryable: true },
      ),
    )

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.streamChat).toHaveBeenCalled()
    expect(result).toMatchObject({
      field: 'proxyUrl',
      message:
        'notice.providerConnectivityFailed:{"message":"/chat/completions · p1-chat · Cannot connect to Chat API. If native or terminal tools work but the browser does not, the browser path is blocked by CORS/preflight; enter a Cloudflare Worker URL in AI proxy URL and rerun the check."}',
      retryable: true,
      tone: 'error',
    })
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'proxyUrl',
      tone: 'error',
    })
  })

  it('falls back to the next fetched chat model when the preferred probe returns empty', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          model: 'gpt-5-3',
          models: ['gpt-5-5', 'gpt-5-3', 'gpt-image-2'],
        }),
      ]),
    })
    vi.mocked(harness.services.listProviderModels).mockResolvedValueOnce([
      'gpt-5-5',
      'gpt-5-3',
      'gpt-image-2',
    ])
    vi.mocked(harness.services.streamChat)
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async ({ onToken }) => {
        onToken('OK')
      })

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.streamChat).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: 'gpt-5-5' }),
    )
    expect(harness.services.streamChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'gpt-5-3' }),
    )
    expect(result).toMatchObject({
      field: 'none',
      message:
        'notice.providerConnectivityPassed:{"count":3,"model":"gpt-5-3"}',
      models: ['gpt-5-5', 'gpt-5-3', 'gpt-image-2'],
      retryable: false,
      tone: 'success',
    })
    expect(harness.context.setProviderModels).toHaveBeenCalledWith(
      'p1',
      ['gpt-5-5', 'gpt-5-3', 'gpt-image-2'],
      'gpt-5-3',
    )
    expect(harness.dataRef.current.providers[0].model).toBe('gpt-5-3')
  })

  it.each([
    [
      'authentication',
      () =>
        new ProviderRequestError('auth', 'authentication failed', {
          retryable: false,
          status: 401,
        }),
    ],
    [
      'quota',
      () =>
        new ProviderRequestError('quota', 'quota exhausted', {
          retryable: false,
          status: 402,
        }),
    ],
    [
      'rate limit',
      () =>
        new ProviderRequestError('rate-limit', 'rate limited', {
          retryable: true,
          status: 429,
        }),
    ],
    [
      'endpoint',
      () =>
        new ProviderRequestError('endpoint', 'route missing', {
          retryable: false,
          status: 404,
        }),
    ],
    [
      'network',
      () =>
        new ProviderRequestError('network', 'network unavailable', {
          retryable: true,
        }),
    ],
    [
      'timeout',
      () =>
        new ProviderRequestError('timeout', 'request timed out', {
          retryable: true,
          status: 504,
        }),
    ],
    [
      'server',
      () =>
        new ProviderRequestError('server', 'service unavailable', {
          retryable: true,
          status: 503,
        }),
    ],
    [
      'non-model request',
      () =>
        new ProviderRequestError('request', 'request conflict', {
          retryable: false,
          status: 409,
        }),
    ],
    ['unknown', () => new Error('unexpected probe failure')],
  ])(
    'stops probing chat models after a provider-wide %s failure',
    async (_label, createError) => {
      const harness = createHarness({
        initialData: appData([
          provider('p1', {
            model: 'gpt-5-3',
            models: ['gpt-5-5', 'gpt-5-3'],
          }),
        ]),
      })
      vi.mocked(harness.services.listProviderModels).mockResolvedValueOnce([
        'gpt-5-5',
        'gpt-5-3',
      ])
      vi.mocked(harness.services.streamChat).mockRejectedValue(createError())

      const result = await harness.actions.runProviderConnectivityCheck('p1')

      expect(harness.services.streamChat).toHaveBeenCalledTimes(1)
      expect(harness.services.streamChat).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-5-5' }),
      )
      expect(result).toMatchObject({
        tone: 'error',
      })
    },
  )

  it.each([400, 404, 422])(
    'tries the next fetched chat model after a model-level HTTP %i request failure',
    async (status) => {
      const harness = createHarness({
        initialData: appData([
          provider('p1', {
            model: 'gpt-5-3',
            models: ['gpt-5-5', 'gpt-5-3'],
          }),
        ]),
      })
      vi.mocked(harness.services.listProviderModels).mockResolvedValueOnce([
        'gpt-5-5',
        'gpt-5-3',
      ])
      vi.mocked(harness.services.streamChat)
        .mockRejectedValueOnce(
          new ProviderRequestError('request', 'model unavailable', {
            retryable: false,
            status,
          }),
        )
        .mockImplementationOnce(async ({ onToken }) => {
          onToken('OK')
        })

      const result = await harness.actions.runProviderConnectivityCheck('p1')

      expect(harness.services.streamChat).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ model: 'gpt-5-5' }),
      )
      expect(harness.services.streamChat).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ model: 'gpt-5-3' }),
      )
      expect(result).toMatchObject({
        field: 'none',
        retryable: false,
        tone: 'success',
      })
    },
  )

  it('fails provider connectivity when models load but chat generation fails', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.streamChat).mockRejectedValueOnce(
      new Error('upstream 502'),
    )

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(harness.services.listProviderModels).toHaveBeenCalled()
    expect(harness.services.streamChat).toHaveBeenCalled()
    expect(result).toMatchObject({
      field: 'baseUrl',
      message:
        'notice.providerConnectivityFailed:{"message":"/chat/completions · p1-chat · upstream 502"}',
      retryable: true,
      tone: 'error',
    })
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'baseUrl',
      tone: 'error',
    })
  })

  it('fails provider connectivity when the chat probe returns no text', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.streamChat).mockResolvedValueOnce(undefined)

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(result).toMatchObject({
      field: 'baseUrl',
      message:
        'notice.providerConnectivityFailed:{"message":"/chat/completions · p1-chat · error.providerConnectivityEmptyReply"}',
      retryable: true,
      tone: 'error',
    })
  })

  it('runs chat and image selected-model checks through provider services', async () => {
    const harness = createHarness()

    await harness.actions.checkSelectedModel('p1', 'chat')
    await harness.actions.checkSelectedModel('p1', 'image')

    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(harness.services.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key-1',
        contextMessageLimit: expect.any(Number),
        model: 'p1-chat',
        proxyToken: '',
      }),
    )
    expect(harness.services.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key-1',
        model: 'p1-image',
        prompt: 'ZeroChat connectivity check',
        proxyToken: '',
      }),
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityPassed:{"model":"p1-chat"}',
      'success',
      'model-chat',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityPassed:{"model":"p1-image"}',
      'success',
      'model-image',
    )
  })

  it('runs audio transcription selected-model checks through capability plans', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          audioTranscriptionModel: 'gpt-4o-transcribe',
          models: ['p1-chat', 'p1-image', 'gpt-4o-transcribe'],
        }),
      ]),
    })

    await harness.actions.checkSelectedModel('p1', 'audio-transcription')

    expect(
      harness.services.executeProviderCapabilityRequestPlan,
    ).toHaveBeenCalledWith({
      plan: expect.objectContaining({
        kind: 'audio-transcription',
        model: 'gpt-4o-transcribe',
      }),
    })
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityPassed:{"model":"gpt-4o-transcribe"}',
      'success',
      'model-audio',
    )
  })

  it('runs selected capability model checks through capability plans', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          audioSpeechModel: 'tts-1',
          embeddingModel: 'text-embedding-3-large',
          moderationModel: 'omni-moderation-latest',
          needsApiKey: false,
          proxyUrl: 'https://proxy.example.com/zerochat',
          realtimeModel: 'gpt-realtime',
          models: [
            'p1-chat',
            'tts-1',
            'text-embedding-3-large',
            'omni-moderation-latest',
            'gpt-realtime',
          ],
        }),
      ]),
      providerKeys: {},
    })

    await harness.actions.checkSelectedModel('p1', 'audio-speech')
    await harness.actions.checkSelectedModel('p1', 'embeddings')
    await harness.actions.checkSelectedModel('p1', 'moderation')
    await harness.actions.checkSelectedModel('p1', 'realtime')

    expect(harness.services.streamChat).not.toHaveBeenCalled()
    expect(harness.services.generateImage).not.toHaveBeenCalled()
    expect(
      harness.services.executeProviderCapabilityRequestPlan,
    ).toHaveBeenNthCalledWith(1, {
      plan: expect.objectContaining({
        kind: 'audio-speech',
        model: 'tts-1',
        modelCapability: 'audio-speech',
      }),
    })
    expect(
      harness.services.executeProviderCapabilityRequestPlan,
    ).toHaveBeenNthCalledWith(2, {
      plan: expect.objectContaining({
        kind: 'embeddings',
        model: 'text-embedding-3-large',
        modelCapability: 'embeddings',
      }),
    })
    expect(
      harness.services.executeProviderCapabilityRequestPlan,
    ).toHaveBeenNthCalledWith(3, {
      plan: expect.objectContaining({
        kind: 'moderation',
        model: 'omni-moderation-latest',
        modelCapability: 'moderation',
      }),
    })
    expect(
      harness.services.executeProviderCapabilityRequestPlan,
    ).toHaveBeenNthCalledWith(4, {
      plan: expect.objectContaining({
        kind: 'realtime',
        model: 'gpt-realtime',
        modelCapability: 'realtime',
      }),
    })
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityPassed:{"model":"tts-1"}',
      'success',
      'model-audio-speech',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityPassed:{"model":"text-embedding-3-large"}',
      'success',
      'model-embedding',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityPassed:{"model":"omni-moderation-latest"}',
      'success',
      'model-moderation',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityPassed:{"model":"gpt-realtime"}',
      'success',
      'model-realtime',
    )
  })

  it('derives proxy access keys for proxied selected-model checks', async () => {
    const proxied = provider('p1', {
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.com/zerochat',
    })
    const harness = createHarness({
      initialData: appData([proxied]),
      providerKeys: {},
    })

    await harness.actions.checkSelectedModel('p1', 'chat')

    expect(harness.services.accessKeyFromPassword).toHaveBeenCalledWith(
      'sync-passphrase',
    )
    expect(harness.services.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyToken: 'proxy-token',
      }),
    )
  })

  it('fails selected chat model checks when the probe returns no text', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.streamChat).mockResolvedValueOnce(undefined)

    await harness.actions.checkSelectedModel('p1', 'chat')

    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityFailed:{"message":"error.providerConnectivityEmptyReply"}',
      'error',
      'model-chat',
    )
  })

  it('runs provider capability checks through capability request plans', async () => {
    const capable = provider('p1', {
      models: [
        'p1-chat',
        'text-embedding-3-large',
        'omni-moderation-latest',
        'gpt-4o-transcribe',
      ],
    })
    const harness = createHarness({ initialData: appData([capable]) })

    await harness.actions.checkProviderCapability('p1', 'embeddings')
    await harness.actions.checkProviderCapability('p1', 'audio-transcription')

    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          endpoint: 'https://p1.example.com/v1/embeddings',
          kind: 'embeddings',
          model: 'text-embedding-3-large',
          modelCapability: 'embeddings',
        }),
      }),
    )
    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          endpoint: 'https://p1.example.com/v1/audio/transcriptions',
          kind: 'audio-transcription',
          model: 'gpt-4o-transcribe',
          modelCapability: 'audio-transcription',
        }),
      }),
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenCalledWith(
      'p1:capability:embeddings',
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenCalledWith(
      'p1:capability:audio-transcription',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckPassed:{"capability":"capability.embeddings","model":"text-embedding-3-large"}',
      'success',
      'provider-capabilities',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckPassed:{"capability":"capability.audio-transcription","model":"gpt-4o-transcribe"}',
      'success',
      'provider-capabilities',
    )
    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
  })

  it('uses standard fallback models only when a declared provider has no catalog', async () => {
    const capable = provider('p1', {
      capabilities: ['chat', 'embeddings', 'model-list'],
      models: [],
    })
    const harness = createHarness({ initialData: appData([capable]) })

    await harness.actions.checkProviderCapability('p1', 'embeddings')

    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          endpoint: 'https://p1.example.com/v1/embeddings',
          kind: 'embeddings',
          model: 'text-embedding-3-large',
          modelCapability: 'embeddings',
        }),
      }),
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckPassed:{"capability":"capability.embeddings","model":"text-embedding-3-large"}',
      'success',
      'provider-capabilities',
    )
  })

  it('does not issue a fallback request outside a listed provider catalog', async () => {
    const catalogProvider = provider('p1', {
      capabilities: ['chat', 'embeddings', 'model-list'],
      models: ['p1-chat'],
    })
    const harness = createHarness({ initialData: appData([catalogProvider]) })

    await harness.actions.checkProviderCapability('p1', 'embeddings')

    expect(
      harness.services.executeProviderCapabilityRequestPlan,
    ).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'error.capabilityModelRequired:{"capability":"capability.embeddings"}',
      'warning',
      'provider-capabilities',
    )
  })

  it('runs proxied Realtime capability checks through client-secret request plans', async () => {
    const proxied = provider('p1', {
      models: ['p1-chat', 'gpt-realtime'],
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.com/zerochat',
    })
    const harness = createHarness({
      initialData: appData([proxied]),
      providerKeys: {},
    })

    await harness.actions.checkProviderCapability('p1', 'realtime')

    expect(harness.services.accessKeyFromPassword).toHaveBeenCalledWith(
      'sync-passphrase',
    )
    expect(harness.services.replaceManagedProxyHosts).toHaveBeenCalledWith(
      [
        {
          baseUrls: ['https://p1.example.com/v1'],
          endpoint: 'https://proxy.example.com/zerochat',
          token: 'proxy-token',
        },
      ],
      [],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(
      vi.mocked(harness.services.replaceManagedProxyHosts).mock
        .invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      vi.mocked(harness.services.executeProviderCapabilityRequestPlan).mock
        .invocationCallOrder[0] ?? 0,
    )
    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          endpoint: 'https://proxy.example.com/zerochat/proxy',
          init: expect.objectContaining({
            headers: expect.objectContaining({
              'x-zerochat-access-key': 'proxy-token',
              'x-zerochat-proxy-action': 'realtime-client-secrets',
            }),
          }),
          kind: 'realtime',
          model: 'gpt-realtime',
          modelCapability: 'realtime',
        }),
      }),
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenCalledWith(
      'p1:capability:realtime',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckPassed:{"capability":"capability.realtime","model":"gpt-realtime"}',
      'success',
      'provider-capabilities',
    )
  })

  it('clears single image generation capability checks after success', async () => {
    const harness = createHarness()

    await harness.actions.checkProviderCapability('p1', 'image-generation')

    expect(harness.services.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key-1',
        model: 'p1-image',
        prompt: 'ZeroChat connectivity check',
        proxyToken: '',
      }),
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenNthCalledWith(
      1,
      'p1:capability:image-generation',
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
    expect(harness.modelLoadProviderIdRef.current).toBe('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckPassed:{"capability":"capability.image-generation","model":"p1-image"}',
      'success',
      'provider-capabilities',
    )
  })

  it('clears single image generation capability checks after endpoint failures', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.generateImage).mockRejectedValueOnce(
      new ProviderRequestError(
        'endpoint',
        'This provider or relay does not expose that endpoint.',
        { retryable: false, status: 404 },
      ),
    )

    await harness.actions.checkProviderCapability('p1', 'image-generation')

    expect(harness.context.setCheckingProviderId).toHaveBeenNthCalledWith(
      1,
      'p1:capability:image-generation',
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
    expect(harness.modelLoadProviderIdRef.current).toBe('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckFailed:{"capability":"capability.image-generation","message":"/images/generations · HTTP 404 · This provider or relay does not expose that endpoint. · If this uses a ZeroChat Worker proxy, verify the Worker deployment, hosted provider key, and proxy action path; if it calls a third-party relay directly, that relay must expose this capability route.","model":"p1-image"}',
      'error',
      'provider-capabilities',
    )
  })

  it('does not retry non-idempotent image generation capability checks after server failures', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.generateImage).mockRejectedValue(
      new ProviderRequestError('server', 'Image service unavailable.', {
        retryable: true,
        status: 503,
      }),
    )

    await harness.actions.checkProviderCapability('p1', 'image-generation')

    expect(harness.services.generateImage).toHaveBeenCalledTimes(1)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckFailed:{"capability":"capability.image-generation","message":"/images/generations · HTTP 503 · Image service unavailable. · If this capability returns a service error through a ZeroChat Worker proxy, check the proxy action, hosted provider key, model/service availability, and upstream quota; if it calls a third-party relay directly, that relay or upstream provider must return a healthy capability response.","model":"p1-image"}',
      'error',
      'provider-capabilities',
    )
  })

  it('runs single image edit and inpaint capability checks through image edits', async () => {
    const harness = createHarness()

    await harness.actions.checkProviderCapability('p1', 'image-edit')
    await harness.actions.checkProviderCapability('p1', 'image-inpaint')

    expect(harness.services.generateImage).not.toHaveBeenCalled()
    expect(harness.services.editImage).toHaveBeenCalledTimes(2)

    const editOptions = vi.mocked(harness.services.editImage).mock.calls[0]?.[0]
    const inpaintOptions =
      vi.mocked(harness.services.editImage).mock.calls[1]?.[0]

    expect(editOptions).toEqual(
      expect.objectContaining({
        apiKey: 'key-1',
        model: 'p1-image',
        prompt: 'ZeroChat connectivity check',
        proxyToken: '',
      }),
    )
    expect(editOptions?.image).toBeInstanceOf(File)
    expect('mask' in (editOptions ?? {})).toBe(false)
    expect(inpaintOptions).toEqual(
      expect.objectContaining({
        apiKey: 'key-1',
        model: 'p1-image',
        prompt: 'ZeroChat connectivity check',
        proxyToken: '',
      }),
    )
    expect(inpaintOptions?.image).toBeInstanceOf(File)
    expect(inpaintOptions?.mask).toBeInstanceOf(File)
    expect(harness.context.setCheckingProviderId).toHaveBeenCalledWith(
      'p1:capability:image-edit',
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenCalledWith(
      'p1:capability:image-inpaint',
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckPassed:{"capability":"capability.image-editing","model":"p1-image"}',
      'success',
      'provider-capabilities',
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckPassed:{"capability":"mode.imageInpaint","model":"p1-image"}',
      'success',
      'provider-capabilities',
    )
  })

  it('clears single image edit capability checks after endpoint failures', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.editImage).mockRejectedValueOnce(
      new ProviderRequestError(
        'endpoint',
        'This provider or relay does not expose that endpoint.',
        { retryable: false, status: 404 },
      ),
    )

    await harness.actions.checkProviderCapability('p1', 'image-inpaint')

    expect(harness.context.setCheckingProviderId).toHaveBeenNthCalledWith(
      1,
      'p1:capability:image-inpaint',
    )
    expect(harness.services.editImage).toHaveBeenCalledTimes(1)
    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
    expect(harness.modelLoadProviderIdRef.current).toBe('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckFailed:{"capability":"mode.imageInpaint","message":"/images/edits · HTTP 404 · This provider or relay does not expose that endpoint. · If this uses a ZeroChat Worker proxy, verify the Worker deployment, hosted provider key, and proxy action path; if it calls a third-party relay directly, that relay must expose this capability route.","model":"p1-image"}',
      'error',
      'provider-capabilities',
    )
  })

  it('does not retry non-idempotent image inpaint capability checks after network failures', async () => {
    const harness = createHarness()
    vi.mocked(harness.services.editImage).mockRejectedValueOnce(
      new ProviderRequestError(
        'network',
        'Cannot connect to Image Editing.',
        { retryable: true },
      ),
    )

    await harness.actions.checkProviderCapability('p1', 'image-inpaint')

    expect(harness.services.editImage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(harness.services.editImage).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        apiKey: 'key-1',
        mask: expect.any(File),
        model: 'p1-image',
        prompt: 'ZeroChat connectivity check',
        proxyToken: '',
      }),
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckFailed:{"capability":"mode.imageInpaint","message":"/images/edits · Cannot connect to Image Editing.","model":"p1-image"}',
      'error',
      'provider-capabilities',
    )
  })

  it('includes image generation, edit, and inpaint in full provider capability checks', async () => {
    const capable = provider('p1', {
      capabilities: [
        'chat',
        'image-editing',
        'image-generation',
        'embeddings',
        'model-list',
      ],
      models: ['p1-chat', 'p1-image', 'text-embedding-3-large'],
    })
    const harness = createHarness({ initialData: appData([capable]) })

    await harness.actions.checkProviderFullCapabilities('p1')

    expect(harness.services.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key-1',
        model: 'p1-image',
        prompt: 'ZeroChat connectivity check',
        proxyToken: '',
      }),
    )
    expect(harness.services.editImage).toHaveBeenCalledTimes(2)
    expect(vi.mocked(harness.services.editImage).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        apiKey: 'key-1',
        model: 'p1-image',
        prompt: 'ZeroChat connectivity check',
        proxyToken: '',
      }),
    )
    expect(vi.mocked(harness.services.editImage).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        apiKey: 'key-1',
        mask: expect.any(File),
        model: 'p1-image',
        prompt: 'ZeroChat connectivity check',
        proxyToken: '',
      }),
    )
    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          kind: 'embeddings',
          model: 'text-embedding-3-large',
        }),
      }),
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenCalledWith(
      'p1:capabilities',
    )
    expect(harness.context.setCheckingProviderId).not.toHaveBeenCalledWith(
      'p1:capability:image-generation',
    )
    expect(harness.context.setCheckingProviderId).not.toHaveBeenCalledWith(
      'p1:capability:image-edit',
    )
    expect(harness.context.setCheckingProviderId).not.toHaveBeenCalledWith(
      'p1:capability:image-inpaint',
    )
    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerFullCapabilityCheckPassed:{"count":4}',
      'success',
      'provider-capabilities',
    )
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      capabilityResults: {
        embeddings: {
          model: 'text-embedding-3-large',
          status: 'passed',
          tone: 'success',
        },
        'image-edit': {
          model: 'p1-image',
          status: 'passed',
          tone: 'success',
        },
        'image-generation': {
          model: 'p1-image',
          status: 'passed',
          tone: 'success',
        },
        'image-inpaint': {
          model: 'p1-image',
          status: 'passed',
          tone: 'success',
        },
      },
      field: 'none',
      message: 'notice.providerFullCapabilityCheckPassed:{"count":4}',
      retryable: false,
      tone: 'success',
    })
  })

  it('keeps the full capability busy identifier while a child request is pending', async () => {
    const capable = provider('p1', {
      capabilities: ['chat', 'embeddings', 'model-list'],
      models: ['p1-chat', 'text-embedding-3-large'],
    })
    const harness = createHarness({ initialData: appData([capable]) })
    const pendingResult = deferred<{
      capability: 'embeddings'
      model: string
      status: number
    }>()
    let markRequestStarted!: () => void
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve
    })

    vi.mocked(harness.services.executeProviderCapabilityRequestPlan)
      .mockImplementationOnce(async () => {
        markRequestStarted()
        return pendingResult.promise
      })

    const check = harness.actions.checkProviderFullCapabilities('p1')
    await requestStarted

    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith(
      'p1:capabilities',
    )
    expect(harness.context.setCheckingProviderId).not.toHaveBeenCalledWith(
      'p1:capability:embeddings',
    )

    pendingResult.resolve({
      capability: 'embeddings',
      model: 'text-embedding-3-large',
      status: 200,
    })
    await check

    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
  })

  it('counts image route failures in full provider capability checks', async () => {
    const capable = provider('p1', {
      capabilities: [
        'chat',
        'image-editing',
        'image-generation',
        'embeddings',
        'model-list',
      ],
      models: ['p1-chat', 'p1-image', 'text-embedding-3-large'],
    })
    const harness = createHarness({ initialData: appData([capable]) })
    vi.mocked(harness.services.editImage).mockRejectedValueOnce(
      new ProviderRequestError(
        'endpoint',
        'This provider or relay does not expose that endpoint.',
        { retryable: false, status: 404 },
      ),
    )

    await harness.actions.checkProviderFullCapabilities('p1')

    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerFullCapabilityCheckFailed:{"failed":1,"total":4}',
      'error',
      'provider-capabilities',
    )
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      capabilityResults: {
        'image-edit': {
          model: 'p1-image',
          status: 'failed',
          tone: 'error',
        },
      },
      field: 'baseUrl',
      message:
        'notice.providerFullCapabilityCheckFailed:{"failed":1,"total":4}',
      retryable: true,
      retryAction: 'fullCapabilities',
      tone: 'error',
    })
  })

  it('records proxied full provider capability failures on the proxy URL field', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['embeddings'],
          models: ['p1-chat', 'text-embedding-3-large'],
          needsApiKey: false,
          proxyUrl: 'https://proxy.example.com/zerochat',
        }),
      ]),
      providerKeys: {},
    })
    vi.mocked(
      harness.services.executeProviderCapabilityRequestPlan,
    ).mockRejectedValueOnce(new Error('upstream 503'))

    await harness.actions.checkProviderFullCapabilities('p1')

    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'proxyUrl',
      message:
        'notice.providerFullCapabilityCheckFailed:{"failed":1,"total":1}',
      retryable: true,
      retryAction: 'fullCapabilities',
      tone: 'error',
    })
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerFullCapabilityCheckFailed:{"failed":1,"total":1}',
      'error',
      'provider-capabilities',
    )
  })

  it('keeps partial server-drill full capability blockers as warnings', async () => {
    const capable = provider('p1', {
      capabilities: ['chat', 'embeddings', 'realtime', 'model-list'],
      models: ['p1-chat', 'text-embedding-3-large', 'gpt-realtime'],
      realtimeModel: 'gpt-realtime',
    })
    const harness = createHarness({ initialData: appData([capable]) })

    await harness.actions.checkProviderFullCapabilities('p1')

    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalledTimes(1)
    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          kind: 'embeddings',
          model: 'text-embedding-3-large',
        }),
      }),
    )
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'none',
      message:
        'notice.providerFullCapabilityCheckFailed:{"failed":1,"total":2}',
      retryable: false,
      retryAction: 'fullCapabilities',
      tone: 'warning',
    })
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerFullCapabilityCheckFailed:{"failed":1,"total":2}',
      'warning',
      'provider-capabilities',
    )
  })

  it('blocks full provider capability checks when a capability needs a server drill', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['chat', 'realtime', 'model-list'],
          models: ['p1-chat', 'gpt-realtime'],
          realtimeModel: 'gpt-realtime',
        }),
      ]),
    })

    await harness.actions.checkProviderFullCapabilities('p1')

    expect(harness.services.executeProviderCapabilityRequestPlan).not.toHaveBeenCalled()
    expect(harness.services.generateImage).not.toHaveBeenCalled()
    expect(harness.services.editImage).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'error.realtimeServerDrill · capability.realtime',
      'warning',
      'provider-capabilities',
    )
    expect(harness.context.setCheckingProviderId).not.toHaveBeenCalledWith(
      'p1:capabilities',
    )
  })

  it('skips proxy-token derivation for client-mode capability checks', async () => {
    const clientMode = provider('p1', {
      clientRequestMode: true,
      models: ['p1-chat', 'text-embedding-3-large'],
      proxyUrl: 'https://proxy.example.com/zerochat',
    })
    const harness = createHarness({ initialData: appData([clientMode]) })

    await harness.actions.checkProviderCapability('p1', 'embeddings')

    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          endpoint: 'https://p1.example.com/v1/embeddings',
          init: expect.objectContaining({
            headers: expect.not.objectContaining({
              'x-zerochat-access-key': expect.any(String),
              'x-zerochat-proxy-action': expect.any(String),
            }),
          }),
          kind: 'embeddings',
          model: 'text-embedding-3-large',
          modelCapability: 'embeddings',
        }),
      }),
    )
  })

  it('includes capability and model context in provider capability check failures', async () => {
    const capable = provider('p1', {
      models: ['p1-chat', 'omni-moderation-latest'],
    })
    const harness = createHarness({ initialData: appData([capable]) })
    vi.mocked(harness.services.executeProviderCapabilityRequestPlan)
      .mockRejectedValueOnce(
        new ProviderRequestError(
          'endpoint',
          'This provider or relay does not expose that endpoint.',
          { retryable: false, status: 404 },
        ),
      )

    await harness.actions.checkProviderCapability('p1', 'moderation')

    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckFailed:{"capability":"capability.moderation","message":"/moderations · HTTP 404 · This provider or relay does not expose that endpoint. · If this uses a ZeroChat Worker proxy, verify the Worker deployment, hosted provider key, and proxy action path; if it calls a third-party relay directly, that relay must expose this capability route.","model":"omni-moderation-latest"}',
      'error',
      'provider-capabilities',
    )
  })

  it('adds upstream HTTP status and service guidance to provider capability server failures', async () => {
    const capable = provider('p1', {
      models: ['p1-chat', 'text-embedding-3-large'],
    })
    const harness = createHarness({ initialData: appData([capable]) })
    vi.mocked(harness.services.executeProviderCapabilityRequestPlan)
      .mockRejectedValueOnce(
        new ProviderRequestError(
          'server',
          'The provider is temporarily unavailable.',
          { retryable: true, status: 503 },
        ),
      )

    await harness.actions.checkProviderCapability('p1', 'embeddings')

    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckFailed:{"capability":"capability.embeddings","message":"/embeddings · HTTP 503 · The provider is temporarily unavailable. · If this capability returns a service error through a ZeroChat Worker proxy, check the proxy action, hosted provider key, model/service availability, and upstream quota; if it calls a third-party relay directly, that relay or upstream provider must return a healthy capability response.","model":"text-embedding-3-large"}',
      'error',
      'provider-capabilities',
    )
  })

  it('keeps browser CORS and AI proxy guidance in capability network failures', async () => {
    const capable = provider('p1', {
      models: ['p1-chat', 'omni-moderation-latest'],
    })
    const harness = createHarness({ initialData: appData([capable]) })
    vi.mocked(harness.services.executeProviderCapabilityRequestPlan)
      .mockRejectedValueOnce(
        new ProviderRequestError(
          'network',
          'Cannot connect to Moderation. If native or terminal tools work but the browser does not, the browser path is blocked by CORS/preflight; enter a Cloudflare Worker URL in AI proxy URL and rerun the check.',
          { retryable: true },
        ),
      )

    await harness.actions.checkProviderCapability('p1', 'moderation')

    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckFailed:{"capability":"capability.moderation","message":"/moderations · Cannot connect to Moderation. If native or terminal tools work but the browser does not, the browser path is blocked by CORS/preflight; enter a Cloudflare Worker URL in AI proxy URL and rerun the check.","model":"omni-moderation-latest"}',
      'error',
      'provider-capabilities',
    )
  })

  it('surfaces capability access-key derivation failures before starting a proxy check', async () => {
    const proxied = provider('p1', {
      models: ['p1-chat', 'omni-moderation-latest'],
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.com/zerochat',
    })
    const harness = createHarness({
      initialData: appData([proxied]),
      providerKeys: {},
    })
    vi.mocked(harness.services.accessKeyFromPassword).mockRejectedValueOnce(
      new Error('crypto unavailable'),
    )

    await harness.actions.checkProviderCapability('p1', 'moderation')

    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckFailed:{"capability":"capability.moderation","message":"crypto unavailable","model":"omni-moderation-latest"}',
      'error',
      'provider-capabilities',
    )
    expect(harness.services.executeProviderCapabilityRequestPlan).not.toHaveBeenCalled()
    expect(harness.context.setCheckingProviderId).not.toHaveBeenCalled()
    expect(harness.context.modelLoadProviderIdRef.current).toBe('')
  })

  it('blocks provider capability checks with no matching capability model', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['chat', 'model-list'],
          models: ['p1-chat'],
        }),
      ]),
    })

    await harness.actions.checkProviderCapability('p1', 'embeddings')

    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(harness.services.executeProviderCapabilityRequestPlan).not.toHaveBeenCalled()
    expect(harness.context.setCheckingProviderId).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'error.capabilityModelRequired:{"capability":"capability.embeddings"}',
      'warning',
      'provider-capabilities',
    )
  })

  it('refreshes provider models through the guarded loading state', async () => {
    const harness = createHarness()

    await harness.actions.refreshProviderModels('p1')

    expect(harness.context.setLoadingModelsProviderId).toHaveBeenCalledWith('p1')
    expect(harness.services.listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key-1',
        proxyToken: '',
      }),
    )
    expect(harness.context.setProviderModels).toHaveBeenCalledWith('p1', [
      'p1-chat',
      'p1-image',
      'p1-chat',
    ])
    expect(harness.context.setLoadingModelsProviderId).toHaveBeenLastCalledWith('')
    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
  })

  it('derives proxy access keys when refreshing proxied provider models', async () => {
    const proxied = provider('p1', {
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.com/zerochat',
    })
    const harness = createHarness({
      initialData: appData([proxied]),
      providerKeys: {},
    })

    await harness.actions.refreshProviderModels('p1')

    expect(harness.services.accessKeyFromPassword).toHaveBeenCalledWith(
      'sync-passphrase',
    )
    expect(harness.services.replaceManagedProxyHosts).toHaveBeenCalledWith(
      [
        {
          baseUrls: ['https://p1.example.com/v1'],
          endpoint: 'https://proxy.example.com/zerochat',
          token: 'proxy-token',
        },
      ],
      [],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(
      vi.mocked(harness.services.replaceManagedProxyHosts).mock
        .invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      vi.mocked(harness.services.listProviderModels).mock
        .invocationCallOrder[0] ?? 0,
    )
    expect(harness.services.listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyToken: 'proxy-token',
      }),
    )
  })

  it('contains provider connectivity clear-notice reporter failures', async () => {
    const harness = createHarness()
    harness.context.setNotice = vi.fn((message) => {
      if (message === '') {
        throw new Error('notice unavailable')
      }
    })

    await expect(
      harness.actions.checkProviderConnectivity('p1'),
    ).resolves.toBeUndefined()

    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'none',
      retryable: false,
      tone: 'success',
    })
    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
  })

  it('contains selected model check reporter failures without false failures', async () => {
    const harness = createHarness()
    harness.context.setNotice = vi.fn((_message, tone) => {
      if (tone === 'success') {
        throw new Error('notice unavailable')
      }
    })

    await expect(
      harness.actions.checkSelectedModel('p1', 'chat'),
    ).resolves.toBeUndefined()

    expect(harness.services.streamChat).toHaveBeenCalled()
    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelConnectivityPassed:{"model":"p1-chat"}',
      'success',
      'model-chat',
    )
    expect(harness.context.setNotice).not.toHaveBeenCalledWith(
      'notice.modelConnectivityFailed:{"message":"notice unavailable"}',
      'error',
      'model-chat',
    )
  })

  it('contains provider capability check reporter failures without leaking the promise', async () => {
    const capable = provider('p1', {
      models: ['p1-chat', 'text-embedding-3-large'],
    })
    const harness = createHarness({ initialData: appData([capable]) })
    harness.context.setNotice = vi.fn((_message, tone) => {
      if (tone === 'success') {
        throw new Error('notice unavailable')
      }
    })

    await expect(
      harness.actions.checkProviderCapability('p1', 'embeddings'),
    ).resolves.toBeUndefined()

    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalled()
    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckPassed:{"capability":"capability.embeddings","model":"text-embedding-3-large"}',
      'success',
      'provider-capabilities',
    )
  })

  it('contains provider full capability reporter failures without leaking the promise', async () => {
    const capable = provider('p1', {
      capabilities: [
        'chat',
        'image-editing',
        'image-generation',
        'embeddings',
        'model-list',
      ],
      models: ['p1-chat', 'p1-image', 'text-embedding-3-large'],
    })
    const harness = createHarness({ initialData: appData([capable]) })
    harness.context.setNotice = vi.fn((_message, tone) => {
      if (tone === 'success') {
        throw new Error('notice unavailable')
      }
    })

    await expect(
      harness.actions.checkProviderFullCapabilities('p1'),
    ).resolves.toBeUndefined()

    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'none',
      message: 'notice.providerFullCapabilityCheckPassed:{"count":4}',
      retryable: false,
      tone: 'success',
    })
    expect(harness.context.setCheckingProviderId).toHaveBeenLastCalledWith('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerFullCapabilityCheckPassed:{"count":4}',
      'success',
      'provider-capabilities',
    )
  })

  it('contains provider model refresh reporter failures without false fetch errors', async () => {
    const harness = createHarness()
    harness.context.setNotice = vi.fn((_message, tone) => {
      if (tone === 'success') {
        throw new Error('notice unavailable')
      }
    })

    await expect(
      harness.actions.refreshProviderModels('p1'),
    ).resolves.toBeUndefined()

    expect(harness.context.setProviderModels).toHaveBeenCalledWith('p1', [
      'p1-chat',
      'p1-image',
      'p1-chat',
    ])
    expect(harness.context.setLoadingModelsProviderId).toHaveBeenLastCalledWith('')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelsFetched:{"count":3}',
      'success',
      'models',
    )
    expect(harness.context.setNotice).not.toHaveBeenCalledWith(
      'notice.modelsFetchFailed:{"message":"notice unavailable"}',
      'error',
      'models',
    )
  })

  it('skips provider checks while another provider operation is active', async () => {
    const harness = createHarness({ checkingProviderId: 'provider:p2' })

    await expect(
      harness.actions.runProviderConnectivityCheck('p1'),
    ).resolves.toBeNull()
    await harness.actions.checkSelectedModel('p1', 'chat')

    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(harness.services.listProviderModels).not.toHaveBeenCalled()
    expect(harness.services.streamChat).not.toHaveBeenCalled()
    expect(harness.context.setNotice).not.toHaveBeenCalled()
  })

  it('claims the provider operation before connectivity awaits can overlap', async () => {
    const harness = createHarness()
    let releaseModels: (models: string[]) => void = () => undefined
    vi.mocked(harness.services.listProviderModels).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseModels = resolve
        }),
    )

    const first = harness.actions.runProviderConnectivityCheck('p1')
    const second = harness.actions.runProviderConnectivityCheck('p1')

    await expect(second).resolves.toBeNull()
    expect(harness.services.listProviderModels).toHaveBeenCalledTimes(1)
    expect(harness.modelLoadProviderIdRef.current).toBe('p1')

    releaseModels(['p1-chat'])
    await expect(first).resolves.toMatchObject({ tone: 'success' })
    expect(harness.modelLoadProviderIdRef.current).toBe('')
  })

  it('drops stale provider completion without clearing a newer lifecycle operation', async () => {
    const harness = createHarness()
    let releaseFirstModels: (models: string[]) => void = () => undefined
    let releaseSecondModels: (models: string[]) => void = () => undefined
    vi.mocked(harness.services.listProviderModels)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstModels = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSecondModels = resolve
          }),
      )

    const first = harness.actions.runProviderConnectivityCheck('p1')
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve()
    }
    expect(harness.services.listProviderModels).toHaveBeenCalledTimes(1)
    const firstSignal = vi.mocked(harness.services.listProviderModels).mock
      .calls[0]?.[0].signal

    cancelProviderConnectivityCheckRuns()
    harness.modelLoadProviderIdRef.current = ''
    const second = harness.actions.runProviderConnectivityCheck('p1')
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve()
    }

    expect(firstSignal?.aborted).toBe(true)
    expect(harness.services.listProviderModels).toHaveBeenCalledTimes(2)

    releaseFirstModels(['stale-model'])
    await expect(first).resolves.toBeNull()

    expect(harness.modelLoadProviderIdRef.current).toBe('p1')
    expect(harness.context.setProviderModels).not.toHaveBeenCalled()
    expect(harness.providerResultsRef.current).toEqual({})
    expect(harness.context.setCheckingProviderId).not.toHaveBeenLastCalledWith('')

    releaseSecondModels(['p1-chat'])
    await expect(second).resolves.toMatchObject({ tone: 'success' })

    expect(harness.context.setProviderModels).toHaveBeenCalledTimes(1)
    expect(harness.modelLoadProviderIdRef.current).toBe('')
  })

  it('cancels managed proxy host preparation without publishing a failure', async () => {
    const proxied = provider('p1', {
      baseUrl: 'https://custom-relay.example.test/v1',
      needsApiKey: false,
      proxyUrl: 'https://proxy.example.com/zerochat',
    })
    const harness = createHarness({
      initialData: appData([proxied]),
      providerKeys: {},
    })
    vi.mocked(harness.services.replaceManagedProxyHosts).mockImplementationOnce(
      (_current, _previous, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )

    const run = harness.actions.runProviderConnectivityCheck('p1')
    await vi.waitFor(() =>
      expect(harness.services.replaceManagedProxyHosts).toHaveBeenCalledTimes(1),
    )
    const signal = vi.mocked(harness.services.replaceManagedProxyHosts).mock
      .calls[0]?.[2]?.signal

    cancelProviderConnectivityCheckRuns()

    expect(signal?.aborted).toBe(true)
    await expect(run).resolves.toBeNull()
    expect(harness.providerResultsRef.current).toEqual({})
  })

  it('drops capability results when cleanup wins the helper handoff microtask', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          capabilities: ['chat', 'embeddings', 'model-list'],
          models: ['p1-chat', 'text-embedding-3-large'],
        }),
      ]),
    })
    let releaseCapability: () => void = () => undefined
    vi.mocked(
      harness.services.executeProviderCapabilityRequestPlan,
    ).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCapability = () => resolve({
            capability: 'embeddings',
            model: 'text-embedding-3-large',
            status: 200,
          })
        }),
    )

    const run = harness.actions.checkProviderCapability('p1', 'embeddings')
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve()
    }
    expect(
      harness.services.executeProviderCapabilityRequestPlan,
    ).toHaveBeenCalledTimes(1)
    vi.mocked(harness.context.setCheckingProviderId).mockClear()
    vi.mocked(harness.context.setNotice).mockClear()

    releaseCapability()
    queueMicrotask(() => {
      cancelProviderConnectivityCheckRuns()
      harness.modelLoadProviderIdRef.current = 'replacement-lifecycle'
    })
    await expect(run).resolves.toBeUndefined()

    expect(harness.context.setCheckingProviderId).not.toHaveBeenCalled()
    expect(harness.context.setNotice).not.toHaveBeenCalled()
    expect(harness.modelLoadProviderIdRef.current).toBe('replacement-lifecycle')
  })

  it('claims capability checks before async proxy preflight can overlap', async () => {
    const harness = createHarness({
      initialData: appData([
        provider('p1', {
          models: ['p1-chat', 'omni-moderation-latest'],
          needsApiKey: false,
          proxyUrl: 'https://proxy.example.com/zerochat',
        }),
      ]),
      providerKeys: {},
    })
    let releaseAccessKey: (value: string) => void = () => undefined
    vi.mocked(harness.services.accessKeyFromPassword).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAccessKey = resolve
        }),
    )

    const first = harness.actions.checkProviderCapability('p1', 'moderation')
    const second = harness.actions.checkProviderCapability('p1', 'moderation')

    await expect(second).resolves.toBeUndefined()
    expect(harness.services.accessKeyFromPassword).toHaveBeenCalledTimes(1)
    expect(harness.modelLoadProviderIdRef.current).toBe('p1')

    releaseAccessKey('proxy-token')
    await expect(first).resolves.toBeUndefined()
    expect(
      harness.services.executeProviderCapabilityRequestPlan,
    ).toHaveBeenCalledTimes(1)
    expect(harness.modelLoadProviderIdRef.current).toBe('')
  })
})
