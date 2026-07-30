import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import type { ProviderConnectivityResult } from '../providerStatus'
import {
  cancelProviderConnectivityLifecycle,
  createProviderSettingsActions,
  type ProviderSettingsControllerContext,
  type ProviderSettingsControllerServices,
} from '../providerSettingsController'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

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

function appData(providers = [provider('p1'), provider('p2')]): AppData {
  return {
    version: 1,
    conversations: [
      {
        id: 'c1',
        createdAt: 1,
        messages: [],
        model: providers[0]?.model ?? '',
        providerId: providers[0]?.id ?? '',
        title: 'Chat',
        updatedAt: 1,
      },
    ],
    preferences: {
      activeConversationId: 'c1',
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

function applyState<T>(
  ref: { current: T },
  value: T | ((current: T) => T),
): void {
  ref.current = typeof value === 'function'
    ? (value as (current: T) => T)(ref.current)
    : value
}

function createHarness(initialData = appData()) {
  const dataRef = { current: initialData }
  const providerKeysRef: { current: Record<string, string> } = {
    current: { p1: 'key-1', p2: 'key-2' },
  }
  const providerKeysState: { current: Record<string, string> } = {
    current: providerKeysRef.current,
  }
  const providerResultsRef: {
    current: Record<string, ProviderConnectivityResult>
  } = {
    current: {
      p1: {
        field: 'baseUrl',
        message: 'old result',
        retryable: true,
        tone: 'error',
      },
    },
  }
  const modelLoadProviderIdRef = { current: '' }
  const syncPassphraseRef = { current: 'sync-passphrase' }

  const services: ProviderSettingsControllerServices = {
    accessKeyFromPassword: vi.fn(async () => 'proxy-token'),
    clearPendingProviderSecretCleanupById: vi.fn(),
    clearProviderSecretsById: vi.fn(async () => undefined),
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
    listProviderModels: vi.fn(async () => ['p1-chat', 'p1-image']),
    persistPublishedLocalSnapshot: vi.fn(async (snapshot) => snapshot),
    queueProviderSecretCleanupById: vi.fn(),
    replaceManagedProxyHosts: vi.fn(async () => undefined),
    setProviderKey: vi.fn(async () => undefined),
    streamChat: vi.fn(async ({ onToken }) => {
      onToken('OK')
    }),
  }

  const context: ProviderSettingsControllerContext = {
    activeConversationId: 'c1',
    checkingProviderId: '',
    dataRef,
    formatErrorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    guideVisible: false,
    modelLoadProviderIdRef,
    providerKeysRef,
    reportSecretWrite: vi.fn((promise) => {
      void promise.catch(() => undefined)
    }),
    requestDangerConfirmation: vi.fn(async () => true),
    scheduleAutoSync: vi.fn(),
    selectedProviderId: 'p1',
    selectChatModelMenuOption: vi.fn(),
    setCheckingProviderId: vi.fn(),
    setLoadingModelsProviderId: vi.fn(),
    setNotice: vi.fn(),
    setProviderConnectivityResults: vi.fn((updater) => {
      applyState(providerResultsRef, updater)
    }),
    setProviderKeys: vi.fn((updater) => {
      applyState(providerKeysState, updater)
    }),
    setProviderModels: vi.fn((providerId, models) => {
      dataRef.current = {
        ...dataRef.current,
        providers: dataRef.current.providers.map((item) =>
          item.id === providerId ? { ...item, models } : item,
        ),
      }
    }),
    setSelectedPresetId: vi.fn(),
    setSelectedProviderId: vi.fn(),
    syncPassphraseRef,
    t,
    updateData: vi.fn((updater) => {
      dataRef.current = updater(dataRef.current)
      return dataRef.current
    }),
    updateProvider: vi.fn((providerId, patch) => {
      dataRef.current = {
        ...dataRef.current,
        providers: dataRef.current.providers.map((item) =>
          item.id === providerId
            ? { ...item, ...patch, updatedAt: Date.now() }
            : item,
        ),
        updatedAt: Date.now(),
      }
      return dataRef.current
    }),
  }

  return {
    actions: createProviderSettingsActions(context, services),
    context,
    dataRef,
    modelLoadProviderIdRef,
    providerKeysRef,
    providerKeysState,
    providerResultsRef,
    services,
  }
}

function expectProviderUpdateDataSingleQueue(
  context: ProviderSettingsControllerContext,
): void {
  expect(context.updateData).toHaveBeenLastCalledWith(
    expect.any(Function),
    { autoSync: false },
  )
}

describe('provider settings controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T00:00:01Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists provider keys, clears stale connectivity state, and queues immediate sync after secret persistence', async () => {
    const harness = createHarness()

    harness.actions.updateProviderKey('p1', 'new-key')

    expect(harness.providerKeysRef.current.p1).toBe('new-key')
    expect(harness.providerKeysState.current.p1).toBe('new-key')
    expect(harness.providerResultsRef.current.p1).toBeUndefined()
    expect(harness.services.setProviderKey).toHaveBeenCalledWith('p1', 'new-key')
    expect(harness.context.reportSecretWrite).toHaveBeenCalledWith(
      expect.any(Promise),
      'providers-list',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()

    await vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0]

    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
  })

  it('reverts provider key draft when secret persistence fails without a newer edit', async () => {
    const harness = createHarness()
    harness.services.setProviderKey = vi.fn(async () => {
      throw new Error('secret store unavailable')
    })

    harness.actions.updateProviderKey('p1', 'new-key')

    await expect(
      vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0],
    ).rejects.toThrow('secret store unavailable')
    expect(harness.services.setProviderKey).toHaveBeenNthCalledWith(
      2,
      'p1',
      'key-1',
    )
    expect(harness.providerKeysRef.current.p1).toBe('key-1')
    expect(harness.providerKeysState.current.p1).toBe('key-1')
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('keeps a newer provider key draft when an older secret write fails', async () => {
    const harness = createHarness()
    let rejectFirstWrite: ((error: Error) => void) | undefined
    harness.services.setProviderKey = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectFirstWrite = reject
          }),
      )
      .mockResolvedValueOnce(undefined)

    harness.actions.updateProviderKey('p1', 'older-key')
    harness.actions.updateProviderKey('p1', 'newer-key')
    await vi.mocked(harness.context.reportSecretWrite).mock.calls[1]?.[0]
    rejectFirstWrite?.(new Error('old write failed'))

    await expect(
      vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0],
    ).rejects.toThrow('old write failed')
    expect(harness.providerKeysRef.current.p1).toBe('newer-key')
    expect(harness.providerKeysState.current.p1).toBe('newer-key')
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledTimes(1)
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
  })

  it('does not commit Provider key timestamps when an older secret write succeeds after a newer edit', async () => {
    const harness = createHarness()
    let resolveFirstWrite: (() => void) | undefined
    harness.services.setProviderKey = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstWrite = resolve
          }),
      )
      .mockResolvedValueOnce(undefined)

    harness.actions.updateProviderKey('p1', 'older-key')
    harness.actions.updateProviderKey('p1', 'newer-key')
    await vi.mocked(harness.context.reportSecretWrite).mock.calls[1]?.[0]
    resolveFirstWrite?.()
    await vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0]

    expect(harness.providerKeysRef.current.p1).toBe('newer-key')
    expect(harness.context.updateData).toHaveBeenCalledTimes(1)
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledTimes(1)
  })

  it('keeps persisted Provider keys visible when timestamp commit fails after secret persistence', async () => {
    const harness = createHarness()
    harness.context.updateData = vi.fn(() => null)

    harness.actions.updateProviderKey('p1', 'new-key')
    await vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0]

    expect(harness.providerKeysRef.current.p1).toBe('new-key')
    expect(harness.providerKeysState.current.p1).toBe('new-key')
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-list',
    )
  })

  it('protects the final enabled provider and reorders disabled providers', () => {
    const single = createHarness(appData([provider('p1')]))

    single.actions.setProviderEnabled('p1', false)

    expect(single.dataRef.current.providers[0]?.enabled).toBe(true)
    expect(single.context.setNotice).toHaveBeenCalledWith(
      'notice.providerMinimum',
      'warning',
      'providers-list',
    )

    const harness = createHarness()

    harness.actions.setProviderEnabled('p1', false)

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
      'p1',
    ])
    expect(harness.dataRef.current.providers[1]?.enabled).toBe(false)
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
  })

  it('contains final-enabled provider notice reporter failures', () => {
    const single = createHarness(appData([provider('p1')]))
    vi.mocked(single.context.setNotice).mockImplementation((message) => {
      if (message === 'notice.providerMinimum') {
        throw new Error('notice unavailable')
      }
    })

    expect(() =>
      single.actions.setProviderEnabled('p1', false),
    ).not.toThrow()

    expect(single.dataRef.current.providers[0]?.enabled).toBe(true)
    expect(single.context.updateData).not.toHaveBeenCalled()
    expect(single.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(single.context.setNotice).toHaveBeenCalledWith(
      'notice.providerMinimum',
      'warning',
      'providers-list',
    )
  })

  it('migrates conversations to an enabled fallback provider when disabling a provider', () => {
    const disabledFallback = provider('disabled', {
      enabled: false,
      model: 'disabled-chat',
    })
    const enabledFallback = provider('enabled', {
      enabled: true,
      model: 'enabled-chat',
    })
    const harness = createHarness(appData([
      provider('p1'),
      disabledFallback,
      enabledFallback,
    ]))

    harness.actions.setProviderEnabled('p1', false)

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'enabled',
      'p1',
      'disabled',
    ])
    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'enabled',
      model: 'enabled-chat',
      updatedAt: Date.now(),
    })
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith('enabled')
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
  })

  it('keeps provider state when enable toggles cannot be committed locally', () => {
    const harness = createHarness()
    harness.context.updateData = vi.fn(() => null)

    harness.actions.setProviderEnabled('p1', false)

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p1',
      'p2',
    ])
    expect(harness.dataRef.current.providers[0]?.enabled).toBe(true)
    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p1',
      model: 'p1-chat',
    })
    expect(harness.context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-list',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('keeps provider ordering when drag reorders cannot be committed locally', () => {
    const harness = createHarness()
    const preventDefault = vi.fn()
    const event = {
      dataTransfer: {
        getData: vi.fn(() => 'p2'),
      },
      preventDefault,
    } as unknown as Parameters<typeof harness.actions.handleProviderDrop>[0]
    harness.context.updateData = vi.fn(() => null)

    harness.actions.handleProviderDrop(event, 'p1')

    expect(preventDefault).toHaveBeenCalled()
    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p1',
      'p2',
    ])
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-list',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('queues immediate sync after provider drag reorder commits locally', () => {
    const harness = createHarness()
    const preventDefault = vi.fn()
    const event = {
      dataTransfer: {
        getData: vi.fn(() => 'p2'),
      },
      preventDefault,
    } as unknown as Parameters<typeof harness.actions.handleProviderDrop>[0]

    harness.actions.handleProviderDrop(event, 'p1')

    expect(preventDefault).toHaveBeenCalled()
    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
      'p1',
    ])
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')
  })

  it('contains provider reorder success notice reporter failures after commit', () => {
    const harness = createHarness()
    vi.mocked(harness.context.setNotice).mockImplementation((message) => {
      if (message === '') {
        throw new Error('notice unavailable')
      }
    })

    expect(() => harness.actions.moveProvider('p2', 'p1')).not.toThrow()

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
      'p1',
    ])
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')
  })

  it('queues immediate sync after provider keyboard reorder commits locally', () => {
    const harness = createHarness(appData([
      provider('p1'),
      provider('p2'),
      provider('p3', { enabled: false }),
      provider('p4', { enabled: false }),
    ]))

    harness.actions.moveProvider('p2', 'p1')

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
      'p1',
      'p3',
      'p4',
    ])
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')

    vi.mocked(harness.context.scheduleAutoSync).mockClear()
    vi.mocked(harness.context.updateData).mockClear()
    vi.mocked(harness.context.setNotice).mockClear()

    harness.actions.moveProvider('p4', 'p3')

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
      'p1',
      'p4',
      'p3',
    ])
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')
  })

  it('keeps provider ordering when keyboard reorders cannot be committed locally', () => {
    const harness = createHarness()
    harness.context.updateData = vi.fn(() => null)

    harness.actions.moveProvider('p2', 'p1')

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p1',
      'p2',
    ])
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-list',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('keeps conversation chat model state when model selection cannot be committed locally', () => {
    const harness = createHarness()
    harness.context.updateData = vi.fn(() => null)

    harness.actions.selectConversationProviderModel('p2', 'p2-chat')

    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p1',
      model: 'p1-chat',
    })
    expect(harness.context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(harness.context.selectChatModelMenuOption).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'chat',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('keeps conversation image model state when image selection cannot be committed locally', () => {
    const harness = createHarness()
    harness.context.updateData = vi.fn(() => null)

    harness.actions.selectConversationImageModel('p2', 'p2-image')

    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p1',
      model: 'p1-chat',
    })
    expect(harness.context.updateProvider).not.toHaveBeenCalled()
    expect(harness.context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(harness.context.selectChatModelMenuOption).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'chat',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('keeps conversation audio transcription model state when selection cannot be committed locally', () => {
    const harness = createHarness(appData([
      provider('p1'),
      provider('p2', {
        audioTranscriptionModel: 'old-transcribe',
        models: ['p2-chat', 'gpt-4o-transcribe'],
      }),
    ]))
    harness.context.updateData = vi.fn(() => null)

    harness.actions.selectConversationAudioTranscriptionModel(
      'p2',
      'gpt-4o-transcribe',
    )

    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p1',
      model: 'p1-chat',
    })
    expect(harness.context.updateProvider).not.toHaveBeenCalled()
    expect(harness.context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(harness.context.selectChatModelMenuOption).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'chat',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('queues immediate sync after conversation chat model selection commits locally', () => {
    const harness = createHarness()
    harness.providerResultsRef.current.p2 = {
      field: 'baseUrl',
      message: 'old chat-model result',
      retryable: true,
      tone: 'error',
    }

    harness.actions.selectConversationProviderModel('p2', 'p2-chat')

    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p2',
      model: 'p2-chat',
    })
    expect(harness.providerResultsRef.current.p2).toBeUndefined()
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith('p2')
    expect(harness.context.selectChatModelMenuOption).toHaveBeenCalledWith('p2')
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')
  })

  it('saves conversation image-model selection and provider default in one local commit', () => {
    const harness = createHarness(appData([
      provider('p1'),
      provider('p2', {
        imageModel: 'old-image',
        models: ['p2-chat', 'p2-image'],
      }),
    ]))
    harness.providerResultsRef.current.p2 = {
      field: 'baseUrl',
      message: 'old image-model result',
      retryable: true,
      tone: 'error',
    }

    harness.actions.selectConversationImageModel('p2', 'p2-image')

    expect(harness.context.updateData).toHaveBeenCalledTimes(1)
    expect(harness.context.updateProvider).not.toHaveBeenCalled()
    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p2',
      model: 'p2-chat',
    })
    expect(
      harness.dataRef.current.providers.find((item) => item.id === 'p2'),
    ).toMatchObject({
      imageModel: 'p2-image',
    })
    expect(harness.providerResultsRef.current.p2).toBeUndefined()
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith('p2')
    expect(harness.context.selectChatModelMenuOption).toHaveBeenCalledWith('p2')
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')
  })

  it('saves conversation audio-transcription selection and provider default in one local commit', () => {
    const harness = createHarness(appData([
      provider('p1'),
      provider('p2', {
        audioTranscriptionModel: 'old-transcribe',
        models: ['p2-chat', 'gpt-4o-transcribe'],
      }),
    ]))
    harness.providerResultsRef.current.p2 = {
      field: 'baseUrl',
      message: 'old audio-model result',
      retryable: true,
      tone: 'error',
    }

    harness.actions.selectConversationAudioTranscriptionModel(
      'p2',
      'gpt-4o-transcribe',
    )

    expect(harness.context.updateData).toHaveBeenCalledTimes(1)
    expect(harness.context.updateProvider).not.toHaveBeenCalled()
    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p2',
      model: 'p2-chat',
    })
    expect(
      harness.dataRef.current.providers.find((item) => item.id === 'p2'),
    ).toMatchObject({
      audioTranscriptionModel: 'gpt-4o-transcribe',
    })
    expect(harness.providerResultsRef.current.p2).toBeUndefined()
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith('p2')
    expect(harness.context.selectChatModelMenuOption).toHaveBeenCalledWith('p2')
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')
  })

  it('keeps provider default chat model when default selection cannot be committed locally', () => {
    const harness = createHarness()
    harness.context.updateProvider = vi.fn(() => null)

    harness.actions.selectProviderModel('p1', 'p1-vision')

    expect(harness.dataRef.current.providers[0]?.model).toBe('p1-chat')
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-list',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('keeps provider default image model when default selection cannot be committed locally', () => {
    const harness = createHarness(appData([
      provider('p1', {
        imageModel: 'old-image',
        models: ['p1-chat', 'p1-image'],
      }),
      provider('p2'),
    ]))
    harness.context.updateProvider = vi.fn(() => null)

    harness.actions.selectProviderImageModel('p1', 'p1-image')

    expect(harness.dataRef.current.providers[0]?.imageModel).toBe('old-image')
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-list',
    )
  })

  it('keeps provider default audio transcription model when default selection cannot be committed locally', () => {
    const harness = createHarness(appData([
      provider('p1', {
        audioTranscriptionModel: 'old-transcribe',
        models: ['p1-chat', 'gpt-4o-transcribe'],
      }),
      provider('p2'),
    ]))
    harness.context.updateProvider = vi.fn(() => null)

    harness.actions.selectProviderAudioTranscriptionModel(
      'p1',
      'gpt-4o-transcribe',
    )

    expect(
      harness.dataRef.current.providers[0]?.audioTranscriptionModel,
    ).toBe('old-transcribe')
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-list',
    )
  })

  it('keeps provider default capability model when default selection cannot be committed locally', () => {
    const harness = createHarness(appData([
      provider('p1', {
        embeddingModel: 'old-embedding',
        models: ['p1-chat', 'text-embedding-3-large'],
      }),
      provider('p2'),
    ]))
    harness.context.updateProvider = vi.fn(() => null)

    harness.actions.selectProviderEmbeddingModel(
      'p1',
      'text-embedding-3-large',
    )

    expect(harness.dataRef.current.providers[0]?.embeddingModel).toBe(
      'old-embedding',
    )
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-list',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('queues immediate sync after provider default model selections commit locally', () => {
    const harness = createHarness(appData([
      provider('p1', {
        imageModel: 'old-image',
        models: [
          'p1-chat',
          'p1-vision',
          'p1-image',
          'text-embedding-3-large',
        ],
      }),
      provider('p2'),
    ]))

    harness.actions.selectProviderModel('p1', 'p1-vision')
    harness.actions.selectProviderImageModel('p1', 'p1-image')
    harness.actions.selectProviderEmbeddingModel(
      'p1',
      'text-embedding-3-large',
    )

    expect(harness.dataRef.current.providers[0]).toMatchObject({
      embeddingModel: 'text-embedding-3-large',
      imageModel: 'p1-image',
      model: 'p1-vision',
    })
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledTimes(3)
    expect(harness.context.scheduleAutoSync).toHaveBeenLastCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.updateProvider).toHaveBeenNthCalledWith(
      1,
      'p1',
      { model: 'p1-vision' },
      { autoSync: false },
    )
    expect(harness.context.updateProvider).toHaveBeenNthCalledWith(
      2,
      'p1',
      { imageModel: 'p1-image' },
      { autoSync: false },
    )
    expect(harness.context.updateProvider).toHaveBeenNthCalledWith(
      3,
      'p1',
      { embeddingModel: 'text-embedding-3-large' },
      { autoSync: false },
    )
  })

  it('saves provider default capability model selections and rejects stale choices', () => {
    const harness = createHarness(appData([
      provider('p1', {
        audioSpeechModel: 'old-tts',
        embeddingModel: 'old-embedding',
        moderationModel: 'old-moderation',
        realtimeModel: 'old-realtime',
        models: [
          'p1-chat',
          'tts-1',
          'text-embedding-3-large',
          'omni-moderation-latest',
          'gpt-realtime',
        ],
      }),
      provider('p2'),
    ]))

    harness.actions.selectProviderAudioSpeechModel('p1', 'tts-1')
    harness.actions.selectProviderEmbeddingModel(
      'p1',
      'text-embedding-3-large',
    )
    harness.actions.selectProviderModerationModel(
      'p1',
      'omni-moderation-latest',
    )
    harness.actions.selectProviderRealtimeModel('p1', 'gpt-realtime')
    harness.actions.selectProviderEmbeddingModel('p1', 'p1-chat')

    expect(harness.dataRef.current.providers[0]).toMatchObject({
      audioSpeechModel: 'tts-1',
      embeddingModel: 'text-embedding-3-large',
      moderationModel: 'omni-moderation-latest',
      realtimeModel: 'gpt-realtime',
    })
    expect(harness.context.updateProvider).toHaveBeenCalledTimes(4)
    expect(harness.context.updateProvider).toHaveBeenNthCalledWith(
      1,
      'p1',
      { audioSpeechModel: 'tts-1' },
      { autoSync: false },
    )
    expect(harness.context.updateProvider).toHaveBeenNthCalledWith(
      2,
      'p1',
      { embeddingModel: 'text-embedding-3-large' },
      { autoSync: false },
    )
    expect(harness.context.updateProvider).toHaveBeenNthCalledWith(
      3,
      'p1',
      { moderationModel: 'omni-moderation-latest' },
      { autoSync: false },
    )
    expect(harness.context.updateProvider).toHaveBeenNthCalledWith(
      4,
      'p1',
      { realtimeModel: 'gpt-realtime' },
      { autoSync: false },
    )
  })

  it('reports Provider settings field patch failures without changing provider data', () => {
    const harness = createHarness()
    harness.context.updateProvider = vi.fn(() => null)

    harness.actions.updateProviderSettings('p1', {
      baseUrl: 'https://broken.example.com/v1',
    })

    expect(harness.dataRef.current.providers[0]?.baseUrl).toBe(
      'https://p1.example.com/v1',
    )
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers',
    )
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'baseUrl',
      message: 'old result',
    })
  })

  it('keeps stale connectivity results after non-connectivity provider patches commit', () => {
    const harness = createHarness()

    harness.actions.updateProviderSettings('p1', {
      name: 'Renamed provider',
    })

    expect(harness.dataRef.current.providers[0]?.name).toBe(
      'Renamed provider',
    )
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'baseUrl',
      message: 'old result',
    })
  })

  it('clears stale connectivity results after provider transport patches commit', () => {
    const harness = createHarness()

    harness.actions.updateProviderSettings('p1', {
      baseUrl: 'https://fixed.example.com/v1',
    })

    expect(harness.dataRef.current.providers[0]?.baseUrl).toBe(
      'https://fixed.example.com/v1',
    )
    expect(harness.providerResultsRef.current.p1).toBeUndefined()
  })

  it('clears stale connectivity results after provider capability model changes commit', () => {
    const harness = createHarness(appData([
      provider('p1', {
        embeddingModel: 'old-embedding',
        models: ['p1-chat', 'text-embedding-3-large'],
      }),
      provider('p2'),
    ]))

    harness.actions.selectProviderEmbeddingModel(
      'p1',
      'text-embedding-3-large',
    )

    expect(harness.dataRef.current.providers[0]?.embeddingModel).toBe(
      'text-embedding-3-large',
    )
    expect(harness.providerResultsRef.current.p1).toBeUndefined()
  })

  it('reports guide Provider field patch failures without changing provider data', () => {
    const harness = createHarness()
    harness.context.updateProvider = vi.fn(() => null)

    harness.actions.updateGuideProvider('p1', {
      baseUrl: 'https://guide-broken.example.com/v1',
    })

    expect(harness.dataRef.current.providers[0]?.baseUrl).toBe(
      'https://p1.example.com/v1',
    )
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'guide',
    )
  })

  it('clears custom relay transport state when the setup guide switches back to an official preset', () => {
    const harness = createHarness(appData([
      provider('p1', {
        baseUrl: 'https://relay.example.com/v1',
        clientRequestMode: true,
        custom: true,
        kind: 'openai-compatible',
        name: 'Custom relay',
        needsApiKey: false,
        proxyUrl: 'https://worker.example.com',
      }),
    ]))

    harness.actions.applyGuidePreset('openai')

    expect(harness.context.setSelectedPresetId).toHaveBeenCalledWith('openai')
    expect(harness.dataRef.current.providers[0]).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      imageModel: 'gpt-image-2',
      kind: 'openai-responses',
      name: 'OpenAI',
      needsApiKey: true,
    })
    expect(harness.dataRef.current.providers[0]?.custom).toBeUndefined()
    expect(harness.dataRef.current.providers[0]?.clientRequestMode).toBeUndefined()
    expect(harness.dataRef.current.providers[0]?.proxyUrl).toBeUndefined()
  })

  it('keeps guide preset state when preset patches cannot be committed locally', () => {
    const harness = createHarness(appData([
      provider('p1', {
        baseUrl: 'https://relay.example.com/v1',
        clientRequestMode: true,
        custom: true,
        kind: 'openai-compatible',
        name: 'Custom relay',
        needsApiKey: false,
        proxyUrl: 'https://worker.example.com',
      }),
    ]))
    harness.context.updateProvider = vi.fn(() => null)

    harness.actions.applyGuidePreset('openai')

    expect(harness.context.updateProvider).toHaveBeenCalled()
    expect(harness.context.setSelectedPresetId).not.toHaveBeenCalled()
    expect(harness.context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(harness.dataRef.current.providers[0]).toMatchObject({
      baseUrl: 'https://relay.example.com/v1',
      clientRequestMode: true,
      custom: true,
      kind: 'openai-compatible',
      name: 'Custom relay',
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'guide',
    )
  })

  it('does not select a new provider when adding a preset cannot be committed locally', () => {
    const harness = createHarness()
    harness.context.updateData = vi.fn(() => null)

    const added = harness.actions.addProviderFromPresetId('openai')

    expect(added).toBeNull()
    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p1',
      'p2',
    ])
    expect(harness.context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-list',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('queues immediate sync after adding a provider preset commits locally', () => {
    const harness = createHarness()

    const added = harness.actions.addProviderFromPresetId('openai')

    expect(added).not.toBeNull()
    expect(harness.dataRef.current.providers[0]?.id).toBe(added?.id)
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith(added?.id)
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')
  })

  it('contains provider add success notice reporter failures after commit', () => {
    const harness = createHarness()
    vi.mocked(harness.context.setNotice).mockImplementation((message) => {
      if (message === '') {
        throw new Error('notice unavailable')
      }
    })

    const added = harness.actions.addProviderFromPresetId('openai')

    expect(added).not.toBeNull()
    expect(harness.dataRef.current.providers[0]?.id).toBe(added?.id)
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith(added?.id)
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')
  })

  it('removes providers only after confirmation, migrates conversations, and clears local secrets', async () => {
    const harness = createHarness()

    await harness.actions.removeProvider('p1')

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalled()
    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
    ])
    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p2',
      model: 'p2-chat',
    })
    expect(harness.providerKeysRef.current.p1).toBeUndefined()
    expect(harness.providerResultsRef.current.p1).toBeUndefined()
    expect(harness.services.queueProviderSecretCleanupById).toHaveBeenCalledWith([
      'p1',
    ])
    expect(harness.services.clearProviderSecretsById).toHaveBeenCalledWith(['p1'])
    expect(harness.context.reportSecretWrite).toHaveBeenCalledWith(
      expect.any(Promise),
      'providers-danger',
    )
    await vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0]
    expect(
      harness.services.clearPendingProviderSecretCleanupById,
    ).toHaveBeenCalledWith(['p1'])
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith('p2')
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
  })

  it('keeps provider removal cleanup successful when pending tombstone cleanup fails', async () => {
    const harness = createHarness()
    harness.services.clearPendingProviderSecretCleanupById = vi.fn(() => {
      throw new Error('pending tombstone cleanup blocked')
    })

    await harness.actions.removeProvider('p1')

    await expect(
      vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0],
    ).resolves.toBeUndefined()
    expect(harness.services.clearProviderSecretsById).toHaveBeenCalledWith(['p1'])
    expect(
      harness.services.clearPendingProviderSecretCleanupById,
    ).toHaveBeenCalledWith(['p1'])
    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
    ])
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
  })

  it('contains provider removal pre-confirmation clear notice reporter failures', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.setNotice).mockImplementation((message) => {
      if (message === '') {
        throw new Error('notice unavailable')
      }
    })

    await expect(harness.actions.removeProvider('p1')).resolves.toBeUndefined()

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalled()
    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
    ])
    expect(harness.providerKeysRef.current.p1).toBeUndefined()
    expect(harness.providerResultsRef.current.p1).toBeUndefined()
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expectProviderUpdateDataSingleQueue(harness.context)
    expect(harness.context.setNotice).toHaveBeenCalledWith('')
  })

  it('reports rejected provider deletion confirmations without leaking the promise', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.requestDangerConfirmation).mockRejectedValueOnce(
      new Error('dialog unavailable'),
    )

    await expect(harness.actions.removeProvider('p1')).resolves.toBeUndefined()

    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.services.queueProviderSecretCleanupById).not.toHaveBeenCalled()
    expect(harness.context.reportSecretWrite).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-danger',
    )
  })

  it('contains provider deletion confirmation reporter failures', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.requestDangerConfirmation).mockRejectedValueOnce(
      new Error('dialog unavailable'),
    )
    vi.mocked(harness.context.setNotice).mockImplementation((message) => {
      if (message === 'notice.providerSaveUnavailable') {
        throw new Error('notice unavailable')
      }
    })

    await expect(harness.actions.removeProvider('p1')).resolves.toBeUndefined()

    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.services.queueProviderSecretCleanupById).not.toHaveBeenCalled()
    expect(harness.context.reportSecretWrite).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-danger',
    )
  })

  it('keeps provider secrets and clears the tombstone when provider removal cannot be committed locally', async () => {
    const harness = createHarness()
    harness.context.updateData = vi.fn(() => null)

    await harness.actions.removeProvider('p1')

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalled()
    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p1',
      'p2',
    ])
    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p1',
      model: 'p1-chat',
    })
    expect(harness.providerKeysRef.current.p1).toBe('key-1')
    expect(harness.providerKeysState.current.p1).toBe('key-1')
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'baseUrl',
      message: 'old result',
    })
    expect(harness.services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(harness.services.queueProviderSecretCleanupById).toHaveBeenCalledWith([
      'p1',
    ])
    expect(
      harness.services.clearPendingProviderSecretCleanupById,
    ).toHaveBeenCalledWith(['p1'])
    expect(harness.context.reportSecretWrite).not.toHaveBeenCalled()
    expect(harness.context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerSaveUnavailable',
      'error',
      'providers-danger',
    )
  })

  it('keeps provider secrets when the durable provider deletion commit fails', async () => {
    const harness = createHarness()
    harness.services.persistPublishedLocalSnapshot = vi.fn(async () => {
      throw new Error('app data write blocked')
    })

    await harness.actions.removeProvider('p1')

    expect(harness.services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(harness.providerKeysRef.current.p1).toBe('key-1')
    expect(
      harness.services.clearPendingProviderSecretCleanupById,
    ).toHaveBeenCalledWith(['p1'])
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'app data write blocked',
      'error',
      'providers-danger',
    )
  })

  it('keeps provider secrets when conflict recovery retains the provider', async () => {
    const harness = createHarness()
    harness.services.persistPublishedLocalSnapshot = vi.fn(async () => appData())

    await harness.actions.removeProvider('p1')

    expect(harness.services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(harness.providerKeysRef.current.p1).toBe('key-1')
    expect(
      harness.services.clearPendingProviderSecretCleanupById,
    ).toHaveBeenCalledWith(['p1'])
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('does not remove a provider when deletion cleanup tombstone cannot be queued', async () => {
    const harness = createHarness()
    harness.services.queueProviderSecretCleanupById = vi.fn(() => {
      throw new Error('tombstone unavailable')
    })

    await harness.actions.removeProvider('p1')

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalled()
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p1',
      'p2',
    ])
    expect(harness.providerKeysRef.current.p1).toBe('key-1')
    expect(harness.services.clearProviderSecretsById).not.toHaveBeenCalled()
    expect(harness.context.reportSecretWrite).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'tombstone unavailable',
      'error',
      'providers-danger',
    )
  })

  it('contains provider deletion tombstone reporter failures', async () => {
    const harness = createHarness()
    harness.services.queueProviderSecretCleanupById = vi.fn(() => {
      throw new Error('tombstone unavailable')
    })
    vi.mocked(harness.context.setNotice).mockImplementation((message) => {
      if (message === 'tombstone unavailable') {
        throw new Error('notice unavailable')
      }
    })

    await expect(harness.actions.removeProvider('p1')).resolves.toBeUndefined()

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalled()
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p1',
      'p2',
    ])
    expect(harness.providerKeysRef.current.p1).toBe('key-1')
    expect(harness.context.reportSecretWrite).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'tombstone unavailable',
      'error',
      'providers-danger',
    )
  })

  it('keeps provider secret cleanup retryable when deletion cleanup fails after commit', async () => {
    const harness = createHarness()
    harness.services.clearProviderSecretsById = vi.fn(async () => {
      throw new Error('secret store blocked')
    })

    await harness.actions.removeProvider('p1')
    await expect(
      vi.mocked(harness.context.reportSecretWrite).mock.calls[0]?.[0],
    ).rejects.toThrow('secret store blocked')

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
    ])
    expect(harness.providerKeysRef.current.p1).toBeUndefined()
    expect(harness.services.queueProviderSecretCleanupById).toHaveBeenCalledWith([
      'p1',
    ])
    expect(
      harness.services.clearPendingProviderSecretCleanupById,
    ).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
  })

  it('prefers an enabled fallback provider when removing a provider', async () => {
    const disabledFallback = provider('disabled', {
      enabled: false,
      model: 'disabled-chat',
    })
    const enabledFallback = provider('enabled', {
      enabled: true,
      model: 'enabled-chat',
    })
    const harness = createHarness(appData([
      provider('p1'),
      disabledFallback,
      enabledFallback,
    ]))

    await harness.actions.removeProvider('p1')

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'disabled',
      'enabled',
    ])
    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'enabled',
      model: 'enabled-chat',
    })
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith('enabled')
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
  })

  it('reselects the current enabled fallback after provider deletion confirmation', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.requestDangerConfirmation).mockImplementationOnce(
      async () => {
        harness.dataRef.current = appData([
          provider('p1'),
          provider('p2', { enabled: false }),
          provider('p3', { model: 'p3-chat' }),
        ])
        return true
      },
    )

    await harness.actions.removeProvider('p1')

    expect(harness.dataRef.current.providers.map((item) => item.id)).toEqual([
      'p2',
      'p3',
    ])
    expect(harness.dataRef.current.conversations[0]).toMatchObject({
      providerId: 'p3',
      model: 'p3-chat',
    })
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith('p3')
  })

  it('surfaces provider-key requirements before network checks', async () => {
    const harness = createHarness()
    harness.providerKeysRef.current = {}

    const result = await harness.actions.runProviderConnectivityCheck('p1')

    expect(result).toMatchObject({
      field: 'providerKey',
      message: 'error.providerKeyRequired',
      retryable: false,
      tone: 'error',
    })
    expect(harness.services.listProviderModels).not.toHaveBeenCalled()
    expect(harness.providerResultsRef.current.p1).toMatchObject({
      field: 'providerKey',
    })
  })

  it('refreshes provider models through the guarded model-loading state', async () => {
    const harness = createHarness()

    await harness.actions.refreshProviderModels('p1')

    expect(harness.context.setLoadingModelsProviderId).toHaveBeenCalledWith('p1')
    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(harness.services.listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyToken: '',
      }),
    )
    expect(harness.context.setProviderModels).toHaveBeenCalledWith('p1', [
      'p1-chat',
      'p1-image',
    ])
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.modelsFetched:{"count":2}',
      'success',
      'models',
    )
    expect(harness.context.setLoadingModelsProviderId).toHaveBeenLastCalledWith('')
  })

  it('derives access keys when refreshing proxied provider models', async () => {
    const harness = createHarness(appData([
      provider('p1', {
        capabilities: [
          'chat',
          'audio',
          'embeddings',
          'moderation',
          'realtime',
        ],
        models: [
          'p1-chat',
          'text-embedding-3-large',
          'omni-moderation-latest',
          'gpt-4o-mini-tts',
          'whisper-1',
          'gpt-realtime',
        ],
        needsApiKey: false,
        proxyUrl: 'https://proxy.example.com/zerochat',
      }),
    ]))
    harness.providerKeysRef.current = {}

    await harness.actions.refreshProviderModels('p1')

    expect(harness.services.accessKeyFromPassword).toHaveBeenCalledWith(
      'sync-passphrase',
    )
    expect(harness.services.listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyToken: 'proxy-token',
      }),
    )
  })

  it('surfaces provider-key requirements before refreshing provider models', async () => {
    const harness = createHarness()
    harness.providerKeysRef.current = {}

    await harness.actions.refreshProviderModels('p1')

    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(harness.services.listProviderModels).not.toHaveBeenCalled()
    expect(harness.context.setLoadingModelsProviderId).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'error.providerKeyRequired',
      'warning',
      'models',
    )
  })

  it('surfaces provider-key requirements before model connectivity checks', async () => {
    const harness = createHarness()
    harness.providerKeysRef.current = {}

    await harness.actions.checkSelectedModel('p1', 'chat')

    expect(harness.services.accessKeyFromPassword).not.toHaveBeenCalled()
    expect(harness.services.streamChat).not.toHaveBeenCalled()
    expect(harness.services.generateImage).not.toHaveBeenCalled()
    expect(harness.context.setCheckingProviderId).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'error.providerKeyRequired',
      'warning',
      'model-chat',
    )
  })

  it('reports rejected lazy model checks without leaking the promise', async () => {
    const harness = createHarness()
    harness.services.loadProviderConnectivityChecks = vi.fn(async () => {
      throw new Error('model checker chunk unavailable')
    })

    await expect(
      harness.actions.checkSelectedModel('p1', 'chat'),
    ).resolves.toBeUndefined()

    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'model checker chunk unavailable',
      'error',
      'model-chat',
    )
  })

  it('retries provider connectivity actions after a rejected lazy import', async () => {
    const harness = createHarness()
    const realModule = await import('../providerConnectivityChecks')
    harness.services.loadProviderConnectivityChecks = vi
      .fn<() => Promise<typeof realModule>>()
      .mockRejectedValueOnce(new Error('provider checker chunk unavailable'))
      .mockResolvedValueOnce(realModule)

    await harness.actions.refreshProviderModels('p1')

    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'provider checker chunk unavailable',
      'error',
      'models',
    )
    expect(harness.services.listProviderModels).not.toHaveBeenCalled()

    await harness.actions.refreshProviderModels('p1')

    expect(harness.services.loadProviderConnectivityChecks).toHaveBeenCalledTimes(2)
    expect(harness.services.listProviderModels).toHaveBeenCalledOnce()
    expect(harness.context.setProviderModels).toHaveBeenCalledWith('p1', [
      'p1-chat',
      'p1-image',
    ])
  })

  it('drops provider checks when lifecycle cleanup wins the lazy-load race', async () => {
    const harness = createHarness()
    const realModule = await import('../providerConnectivityChecks')
    const createActions = vi.fn(realModule.createProviderConnectivityCheckActions)
    let releaseModule: (module: typeof realModule) => void = () => undefined
    harness.services.loadProviderConnectivityChecks = vi.fn(
      () =>
        new Promise<typeof realModule>((resolve) => {
          releaseModule = resolve
        }),
    )

    const run = harness.actions.runProviderConnectivityCheck('p1')
    cancelProviderConnectivityLifecycle(harness.modelLoadProviderIdRef)
    releaseModule({
      ...realModule,
      createProviderConnectivityCheckActions: createActions,
    })

    await expect(run).resolves.toBeNull()
    expect(createActions).toHaveBeenCalledOnce()
    expect(harness.services.listProviderModels).not.toHaveBeenCalled()
    expect(harness.context.setNotice).not.toHaveBeenCalled()
  })

  it('contains rejected lazy provider action reporter failures', async () => {
    const harness = createHarness()
    harness.services.loadProviderConnectivityChecks = vi.fn(async () => {
      throw new Error('provider checker chunk unavailable')
    })
    vi.mocked(harness.context.setNotice).mockImplementation((message) => {
      if (message === 'provider checker chunk unavailable') {
        throw new Error('notice unavailable')
      }
    })

    await expect(
      harness.actions.checkProviderConnectivity('p1'),
    ).resolves.toBeUndefined()

    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'provider checker chunk unavailable',
      'error',
      'providers',
    )
  })

  it('reports rejected guide model refresh lazy loads without leaking the promise', async () => {
    const harness = createHarness()
    harness.context.guideVisible = true
    harness.services.loadProviderConnectivityChecks = vi.fn(async () => {
      throw new Error('model fetcher chunk unavailable')
    })

    await expect(
      harness.actions.refreshProviderModels('p1'),
    ).resolves.toBeUndefined()

    expect(harness.context.setLoadingModelsProviderId).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'model fetcher chunk unavailable',
      'error',
      'guide-models',
    )
  })

  it('blocks Realtime capability checks before executing browser HTTP requests', async () => {
    const harness = createHarness(appData([
      provider('p1', {
        capabilities: [
          'chat',
          'audio',
          'embeddings',
          'moderation',
          'realtime',
        ],
        models: [
          'p1-chat',
          'text-embedding-3-large',
          'omni-moderation-latest',
          'gpt-4o-mini-tts',
          'whisper-1',
          'gpt-realtime',
        ],
      }),
    ]))

    await harness.actions.checkProviderCapability('p1', 'realtime')

    expect(harness.services.executeProviderCapabilityRequestPlan).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'error.realtimeServerDrill · settings.capabilityCheckModel:{"model":"gpt-realtime"}',
      'warning',
      'provider-capabilities',
    )
  })

  it('runs proxied Realtime capability checks through client-secret requests', async () => {
    const harness = createHarness(appData([
      provider('p1', {
        models: ['p1-chat', 'gpt-realtime'],
        needsApiKey: false,
        proxyUrl: 'https://proxy.example.com/zerochat',
      }),
    ]))
    harness.providerKeysRef.current = {}

    await harness.actions.checkProviderCapability('p1', 'realtime')

    expect(harness.services.accessKeyFromPassword).toHaveBeenCalledWith(
      'sync-passphrase',
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
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.providerCapabilityCheckPassed:{"capability":"capability.realtime","model":"gpt-realtime"}',
      'success',
      'provider-capabilities',
    )
  })

  it('runs all browser-safe provider capability checks as one release-grade action', async () => {
    const harness = createHarness(appData([
      provider('p1', {
        capabilities: [
          'chat',
          'audio',
          'embeddings',
          'moderation',
          'realtime',
        ],
        models: [
          'p1-chat',
          'text-embedding-3-large',
          'omni-moderation-latest',
          'gpt-4o-mini-tts',
          'whisper-1',
          'gpt-realtime',
        ],
        needsApiKey: false,
        proxyUrl: 'https://proxy.example.com/zerochat',
      }),
    ]))
    harness.providerKeysRef.current = {}

    await harness.actions.checkProviderFullCapabilities('p1')

    expect(harness.services.accessKeyFromPassword).toHaveBeenCalledTimes(5)
    expect(harness.services.executeProviderCapabilityRequestPlan).toHaveBeenCalledTimes(5)
    expect(
      vi.mocked(harness.services.executeProviderCapabilityRequestPlan).mock.calls.map(
        ([options]) => options.plan.kind,
      ),
    ).toEqual([
      'embeddings',
      'moderation',
      'audio-speech',
      'audio-transcription',
      'realtime',
    ])
    expect(harness.context.setCheckingProviderId).toHaveBeenCalledWith(
      'p1:capabilities',
    )
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.providerFullCapabilityCheckPassed:{"count":5}',
      'success',
      'provider-capabilities',
    )
  })

  it('summarizes mixed full capability failures without running blocked Realtime in the browser', async () => {
    const harness = createHarness(appData([
      provider('p1', {
        capabilities: [
          'chat',
          'audio',
          'embeddings',
          'moderation',
          'realtime',
        ],
        models: [
          'p1-chat',
          'text-embedding-3-large',
          'omni-moderation-latest',
          'gpt-4o-mini-tts',
          'whisper-1',
          'gpt-realtime',
        ],
      }),
    ]))
    vi.mocked(
      harness.services.executeProviderCapabilityRequestPlan,
    ).mockImplementation(async ({ plan }) => {
      if (plan.kind === 'embeddings') {
        throw new Error('upstream 503')
      }

      return {
        capability:
          plan.kind === 'moderation' ||
          plan.kind === 'audio-speech' ||
          plan.kind === 'audio-transcription'
            ? plan.kind
            : 'audio',
        model: plan.model,
        status: 200,
      }
    })

    await harness.actions.checkProviderFullCapabilities('p1')

    expect(
      vi.mocked(harness.services.executeProviderCapabilityRequestPlan).mock.calls.map(
        ([options]) => options.plan.kind,
      ),
    ).toEqual([
      'embeddings',
      'moderation',
      'audio-speech',
      'audio-transcription',
    ])
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      expect.stringContaining(
        'notice.providerFullCapabilityCheckFailed:{"details":"capability.embeddings: /embeddings · upstream 503 · capability.realtime: error.realtimeServerDrill',
      ),
      'error',
      'provider-capabilities',
    )
  })
})
