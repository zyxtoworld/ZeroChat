import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import {
  cancelFirstRunGuideCompletion,
  createFirstRunGuideActions,
  type FirstRunGuideActionContext,
} from '../firstRunGuideController'
import type { ProviderConnectivityResult } from '../providerStatus'

const t = ((key: string) => key) as Translator

function provider(
  patch: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    id: 'provider-1',
    baseUrl: 'https://api.example.com/v1',
    capabilities: ['chat', 'image-generation', 'model-list'],
    createdAt: 1,
    enabled: true,
    imageModel: 'old-image',
    kind: 'openai-compatible',
    model: 'old-chat',
    models: ['old-chat', 'old-image'],
    name: 'Provider',
    needsApiKey: true,
    updatedAt: 1,
    ...patch,
  }
}

function appData(selectedProvider = provider()): AppData {
  return {
    version: 1,
    conversations: [
      {
        id: 'conversation-1',
        createdAt: 1,
        messages: [],
        model: 'old-chat',
        providerId: selectedProvider.id,
        title: 'First chat',
        updatedAt: 1,
      },
    ],
    preferences: {
      activeConversationId: 'conversation-1',
      chatContextMessageLimit: 20,
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: false,
      language: 'system',
      theme: 'system',
    },
    providers: [selectedProvider],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: true,
      encryptionEnabled: true,
      gistFile: 'zerochat-sync.json',
      mode: 'gist',
    },
    updatedAt: 1,
  }
}

function createHarness(
  overrides: Partial<FirstRunGuideActionContext> = {},
  initialData: AppData | null = appData(),
) {
  const dataRef = { current: initialData }
  const successResult: ProviderConnectivityResult = {
    field: 'none',
    message: 'Connected',
    models: ['fresh-chat', 'gpt-image-2'],
    retryable: false,
    tone: 'success',
  }
  const context: FirstRunGuideActionContext = {
    closeGuide: vi.fn(),
    commitSyncPassphraseOnBlur: vi.fn(async () => undefined),
    data: initialData,
    dataRef,
    guideState: {
      guideCanFinish: true,
      guideRequirement: '',
    },
    formatErrorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    runProviderConnectivityCheck: vi.fn(async () => successResult),
    scheduleAutoSync: vi.fn(),
    selectedProvider: initialData?.providers[0] ?? null,
    setGuideSuccessPending: vi.fn(),
    setNotice: vi.fn(),
    t,
    updateData: vi.fn((updater) => {
      if (!dataRef.current) {
        return null
      }

      const next = updater(dataRef.current)
      dataRef.current = next
      return next
    }),
    ...overrides,
  }
  const waitForGuideSuccessClose = vi.fn(async () => undefined)
  const actions = createFirstRunGuideActions(context, {
    now: () => 99,
    waitForGuideSuccessClose,
  })

  return {
    actions,
    context,
    dataRef,
    waitForGuideSuccessClose,
  }
}

describe('createFirstRunGuideActions', () => {
  beforeEach(() => cancelFirstRunGuideCompletion())
  it('validates the selected provider, stores returned models, and enters chat', async () => {
    const harness = createHarness()

    await harness.actions.finishGuide()

    expect(harness.context.runProviderConnectivityCheck).toHaveBeenCalledWith(
      'provider-1',
    )
    expect(harness.context.commitSyncPassphraseOnBlur).toHaveBeenCalledTimes(1)
    expect(harness.context.setGuideSuccessPending).toHaveBeenCalledWith(true)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.guideConnectivityPassed',
      'success',
      'guide',
    )
    expect(harness.waitForGuideSuccessClose).toHaveBeenCalledTimes(1)
    expect(harness.dataRef.current?.providers[0]).toMatchObject({
      model: 'fresh-chat',
      imageModel: 'gpt-image-2',
      models: ['fresh-chat', 'gpt-image-2'],
      updatedAt: 99,
    })
    expect(harness.dataRef.current?.conversations[0]).toMatchObject({
      model: 'fresh-chat',
      providerId: 'provider-1',
      updatedAt: 99,
    })
    expect(harness.dataRef.current?.preferences.firstRunDone).toBe(true)
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.setGuideSuccessPending).toHaveBeenLastCalledWith(
      false,
    )
    expect(harness.context.closeGuide).toHaveBeenCalledTimes(1)
  })

  it('commits the sync passphrase before provider validation', async () => {
    let resolveCommit!: () => void
    const commit = new Promise<void>((resolve) => {
      resolveCommit = resolve
    })
    const harness = createHarness({
      commitSyncPassphraseOnBlur: vi.fn(() => commit),
    })

    const completion = harness.actions.finishGuide()

    expect(harness.context.runProviderConnectivityCheck).not.toHaveBeenCalled()
    resolveCommit()
    await completion

    expect(harness.context.runProviderConnectivityCheck).toHaveBeenCalledWith(
      'provider-1',
    )
  })

  it('keeps the guide open when the sync passphrase commit rejects', async () => {
    const harness = createHarness({
      commitSyncPassphraseOnBlur: vi.fn(async () => {
        throw new Error('secret store unavailable')
      }),
    })

    await expect(harness.actions.finishGuide()).resolves.toBeUndefined()

    expect(harness.context.runProviderConnectivityCheck).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.guideSaveUnavailable',
      'error',
      'guide',
    )
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.context.closeGuide).not.toHaveBeenCalled()
  })

  it('clears pending success state when the success close delay rejects', async () => {
    const harness = createHarness()
    harness.waitForGuideSuccessClose.mockRejectedValueOnce(
      new Error('close delay failed'),
    )

    await expect(harness.actions.finishGuide()).resolves.toBeUndefined()

    expect(harness.waitForGuideSuccessClose).toHaveBeenCalledTimes(1)
    expect(harness.context.setGuideSuccessPending).toHaveBeenCalledWith(true)
    expect(harness.context.setGuideSuccessPending).toHaveBeenLastCalledWith(
      false,
    )
    expect(harness.context.setNotice).toHaveBeenLastCalledWith('')
    expect(harness.context.closeGuide).toHaveBeenCalledTimes(1)
  })

  it('keeps the guide open and targets the guide notice when validation fails', async () => {
    const errorResult: ProviderConnectivityResult = {
      field: 'providerKey',
      message: 'Bad key',
      retryable: false,
      tone: 'error',
    }
    const focusProviderConnectivityField = vi.fn()
    const harness = createHarness({
      focusProviderConnectivityField,
      runProviderConnectivityCheck: vi.fn(async () => errorResult),
    })

    await harness.actions.finishGuide()

    expect(focusProviderConnectivityField).toHaveBeenCalledWith('providerKey')
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'Bad key',
      'error',
      'guide',
    )
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.context.setGuideSuccessPending).not.toHaveBeenCalled()
    expect(harness.context.closeGuide).not.toHaveBeenCalled()
  })

  it('reports rejected provider validation without leaking the promise', async () => {
    const harness = createHarness({
      runProviderConnectivityCheck: vi.fn(async () => {
        throw new Error('provider check unavailable')
      }),
    })

    await expect(harness.actions.finishGuide()).resolves.toBeUndefined()

    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'provider check unavailable',
      'error',
      'guide',
    )
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.context.setGuideSuccessPending).not.toHaveBeenCalled()
    expect(harness.context.closeGuide).not.toHaveBeenCalled()
  })

  it('contains rejected provider validation reporter failures', async () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })
    const harness = createHarness({
      runProviderConnectivityCheck: vi.fn(async () => {
        throw new Error('provider check unavailable')
      }),
      setNotice,
    })

    await expect(harness.actions.finishGuide()).resolves.toBeUndefined()

    expect(setNotice).toHaveBeenCalledWith(
      'provider check unavailable',
      'error',
      'guide',
    )
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.context.setGuideSuccessPending).not.toHaveBeenCalled()
    expect(harness.context.closeGuide).not.toHaveBeenCalled()
  })

  it('does not focus a provider field for fieldless validation failures', async () => {
    const errorResult: ProviderConnectivityResult = {
      field: 'none',
      message: 'Provider unavailable',
      retryable: true,
      tone: 'error',
    }
    const focusProviderConnectivityField = vi.fn()
    const harness = createHarness({
      focusProviderConnectivityField,
      runProviderConnectivityCheck: vi.fn(async () => errorResult),
    })

    await harness.actions.finishGuide()

    expect(focusProviderConnectivityField).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'Provider unavailable',
      'error',
      'guide',
    )
  })

  it('keeps the guide open when completion cannot be saved', async () => {
    const harness = createHarness({
      updateData: vi.fn(() => null),
    })

    await harness.actions.finishGuide()

    expect(harness.context.runProviderConnectivityCheck).toHaveBeenCalledWith(
      'provider-1',
    )
    expect(harness.context.setGuideSuccessPending).not.toHaveBeenCalledWith(
      true,
    )
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.guideSaveUnavailable',
      'error',
      'guide',
    )
    expect(harness.waitForGuideSuccessClose).not.toHaveBeenCalled()
    expect(harness.context.closeGuide).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.preferences.firstRunDone).toBe(false)
    expect(harness.dataRef.current?.providers[0]).toMatchObject({
      model: 'old-chat',
      imageModel: 'old-image',
    })
  })

  it('contains first-run save-unavailable reporter failures', async () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })
    const harness = createHarness({
      setNotice,
      updateData: vi.fn(() => null),
    })

    await expect(harness.actions.finishGuide()).resolves.toBeUndefined()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.guideSaveUnavailable',
      'error',
      'guide',
    )
    expect(harness.context.setGuideSuccessPending).not.toHaveBeenCalledWith(
      true,
    )
    expect(harness.waitForGuideSuccessClose).not.toHaveBeenCalled()
    expect(harness.context.closeGuide).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('shows the first unmet requirement without calling provider validation', async () => {
    const harness = createHarness({
      guideState: {
        guideCanFinish: false,
        guideRequirement: 'Key required',
      },
    })

    await harness.actions.finishGuide()

    expect(harness.context.setNotice).toHaveBeenCalledWith('Key required')
    expect(harness.context.runProviderConnectivityCheck).not.toHaveBeenCalled()
    expect(harness.context.updateData).not.toHaveBeenCalled()
  })

  it('allows local-only completion without provider validation', async () => {
    const harness = createHarness({
      guideState: {
        guideCanFinish: false,
        guideRequirement: 'Key required',
      },
      selectedProvider: null,
    })

    await harness.actions.finishGuide(true)

    expect(harness.context.runProviderConnectivityCheck).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.sync).toMatchObject({
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    })
    expect(harness.dataRef.current?.preferences.firstRunDone).toBe(true)
    expect(harness.context.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.closeGuide).toHaveBeenCalledTimes(1)
  })

  it('uses visible data as a fallback when the guide data ref is stale during local-only completion', async () => {
    const visible = appData()
    const harness = createHarness(
      {
        data: visible,
        guideState: {
          guideCanFinish: false,
          guideRequirement: 'Key required',
        },
      },
      null,
    )

    await harness.actions.finishGuide(true)

    expect(harness.context.runProviderConnectivityCheck).not.toHaveBeenCalled()
    expect(harness.context.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(harness.context.dataRef.current?.preferences.firstRunDone).toBe(true)
    expect(harness.context.closeGuide).toHaveBeenCalledTimes(1)
  })

  it('claims completion ownership before async provider validation', async () => {
    let resolveConnectivity!: (value: ProviderConnectivityResult) => void
    const connectivity = new Promise<ProviderConnectivityResult>((resolve) => {
      resolveConnectivity = resolve
    })
    const harness = createHarness({
      runProviderConnectivityCheck: vi.fn(() => connectivity),
    })

    const first = harness.actions.finishGuide()
    const repeated = harness.actions.finishGuide()

    await vi.waitFor(() =>
      expect(harness.context.runProviderConnectivityCheck).toHaveBeenCalledTimes(1),
    )

    resolveConnectivity({
      field: 'none',
      message: 'Connected',
      models: ['gpt-5-5'],
      retryable: false,
      tone: 'success',
    })
    await Promise.all([first, repeated])

    expect(harness.context.updateData).toHaveBeenCalledTimes(1)
    expect(harness.context.closeGuide).toHaveBeenCalledTimes(1)
  })

  it('ignores stale provider validation after guide close cancels ownership', async () => {
    let resolveConnectivity!: (value: ProviderConnectivityResult) => void
    const connectivity = new Promise<ProviderConnectivityResult>((resolve) => {
      resolveConnectivity = resolve
    })
    const harness = createHarness({
      runProviderConnectivityCheck: vi.fn(() => connectivity),
    })

    const completion = harness.actions.finishGuide()
    cancelFirstRunGuideCompletion()
    resolveConnectivity({
      field: 'none',
      message: 'Connected',
      models: ['gpt-5-5'],
      retryable: false,
      tone: 'success',
    })
    await completion

    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setGuideSuccessPending).not.toHaveBeenCalled()
    expect(harness.context.closeGuide).not.toHaveBeenCalled()
  })

  it('does not close a reopened guide after a stale success delay settles', async () => {
    let resolveSuccessDelay!: () => void
    const successDelay = new Promise<undefined>((resolve) => {
      resolveSuccessDelay = () => resolve(undefined)
    })
    const harness = createHarness()
    harness.waitForGuideSuccessClose.mockImplementationOnce(() => successDelay)

    const completion = harness.actions.finishGuide()
    await vi.waitFor(() =>
      expect(harness.waitForGuideSuccessClose).toHaveBeenCalledTimes(1),
    )

    cancelFirstRunGuideCompletion()
    resolveSuccessDelay()
    await completion

    expect(harness.context.updateData).toHaveBeenCalledTimes(1)
    expect(harness.context.setGuideSuccessPending).toHaveBeenCalledTimes(1)
    expect(harness.context.setGuideSuccessPending).toHaveBeenCalledWith(true)
    expect(harness.context.closeGuide).not.toHaveBeenCalled()
  })
})
