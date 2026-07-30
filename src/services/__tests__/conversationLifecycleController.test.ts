import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import {
  createConversationLifecycleActions,
  createConversationLifecycleServices,
  reportConversationLifecycleNotice,
  type ConversationLifecycleControllerContext,
} from '../conversationLifecycleController'
import { focusConversationTitleElement } from '../conversationTitleEditController'
import { generationOwnership } from '../generationOwnership'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function provider(
  id = 'provider-1',
  patch: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    id,
    baseUrl: `https://${id}.example.com/v1`,
    createdAt: 1,
    enabled: true,
    imageModel: `${id}-image`,
    kind: 'openai-compatible',
    model: `${id}-chat`,
    models: [`${id}-chat`, `${id}-image`],
    name: id,
    needsApiKey: true,
    updatedAt: 1,
    ...patch,
  }
}

function appData(providers = [provider()]): AppData {
  return {
    version: 1,
    conversations: providers.length
      ? [
          {
            id: 'conversation-1',
            createdAt: 1,
            messages: [],
            model: providers[0].model,
            providerId: providers[0].id,
            title: 'Original',
            updatedAt: 1,
          },
        ]
      : [],
    preferences: {
      activeConversationId: providers.length ? 'conversation-1' : undefined,
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

function appDataWithTwoConversations(): AppData {
  const data = appData()
  const primaryProvider = data.providers[0]
  data.conversations = [
    ...data.conversations,
    {
      id: 'conversation-2',
      createdAt: 2,
      messages: [],
      model: primaryProvider.model,
      providerId: primaryProvider.id,
      title: 'Second',
      updatedAt: 2,
    },
  ]
  return data
}

function createHarness(initialData: AppData | null = appData()) {
  const dataRef = { current: initialData }
  generationOwnership.active = false
  const context: ConversationLifecycleControllerContext = {
    activeConversationId: initialData?.preferences.activeConversationId ?? '',
    activeConversationTitle: initialData?.conversations[0]?.title ?? '',
    addProviderFromPresetId: vi.fn(() => provider('added-provider')),
    closeSidebar: vi.fn(),
    composerTextareaRef: { current: null },
    data: initialData,
    dataRef,
    dangerPromptOpen: false,
    guideOpen: false,
    requestDangerConfirmation: vi.fn(async () => true),
    scheduleAutoSync: vi.fn(),
    setConversationSearch: vi.fn(),
    setNotice: vi.fn(),
    setSelectedPresetId: vi.fn(),
    setSelectedProviderId: vi.fn(),
    setSettingsOpen: vi.fn(),
    setSettingsTab: vi.fn(),
    settingsOpen: false,
    syncFirstConflictPromptOpen: false,
    t,
    updateData: vi.fn((updater) => {
      if (!dataRef.current) {
        return null
      }

      const next = updater(dataRef.current)
      dataRef.current = next
      return next
    }),
  }
  const focusComposer = vi.fn()

  return {
    actions: createConversationLifecycleActions(context, { focusComposer }),
    context,
    dataRef,
    focusComposer,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('focusConversationTitleElement', () => {
  it('focuses conversation title controls without scrolling', () => {
    const button = {
      focus: vi.fn(),
    } as unknown as HTMLButtonElement

    expect(focusConversationTitleElement(button)).toBe(true)

    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('selects conversation title inputs after focus succeeds', () => {
    const input = {
      focus: vi.fn(),
      select: vi.fn(),
    } as unknown as HTMLInputElement

    expect(focusConversationTitleElement(input, { select: true })).toBe(true)

    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(input.select).toHaveBeenCalledTimes(1)
  })

  it('contains conversation title focus failures', () => {
    const input = {
      focus: vi.fn(() => {
        throw new Error('focus blocked')
      }),
      select: vi.fn(),
    } as unknown as HTMLInputElement

    const result = focusConversationTitleElement(input, { select: true })

    expect(result).toBe(false)
    expect(input.select).not.toHaveBeenCalled()
  })

  it('contains conversation title selection failures after focus succeeds', () => {
    const input = {
      focus: vi.fn(),
      select: vi.fn(() => {
        throw new Error('selection blocked')
      }),
    } as unknown as HTMLInputElement

    const result = focusConversationTitleElement(input, { select: true })

    expect(result).toBe(false)
    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})

describe('createConversationLifecycleActions', () => {
  it('schedules new-conversation composer focus through the contained helper', () => {
    const harness = createHarness()
    const textarea = {
      focus: vi.fn(),
      setSelectionRange: vi.fn(),
      value: 'New chat',
    } as unknown as HTMLTextAreaElement
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('window', { requestAnimationFrame })
    harness.context.composerTextareaRef.current = textarea

    createConversationLifecycleServices(harness.context).focusComposer()

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(textarea.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(textarea.setSelectionRange).toHaveBeenCalledWith(8, 8)
  })

  it('contains new-conversation composer focus failures after save', () => {
    const harness = createHarness()
    const textarea = {
      focus: vi.fn(() => {
        throw new Error('focus blocked')
      }),
      setSelectionRange: vi.fn(),
      value: 'New chat',
    } as unknown as HTMLTextAreaElement
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('window', { requestAnimationFrame })
    harness.context.composerTextareaRef.current = textarea

    expect(() =>
      createConversationLifecycleServices(harness.context).focusComposer(),
    ).not.toThrow()

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(textarea.setSelectionRange).not.toHaveBeenCalled()
  })

  it('contains conversation lifecycle notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportConversationLifecycleNotice(
        { setNotice },
        () => 'notice.firstProviderAdded',
        'success',
        'providers-list',
      ),
    ).not.toThrow()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.firstProviderAdded',
      'success',
      'providers-list',
    )
  })

  it('creates a new conversation, activates it, closes the sidebar, and focuses the composer', () => {
    const harness = createHarness()

    harness.actions.createNewConversation()

    expect(harness.context.setConversationSearch).toHaveBeenCalledWith('')
    expect(harness.dataRef.current?.conversations).toHaveLength(2)
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      harness.dataRef.current?.conversations[0]?.id,
    )
    expect(harness.context.closeSidebar).toHaveBeenCalledTimes(1)
    expect(harness.focusComposer).toHaveBeenCalledTimes(1)
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
  })

  it('keeps search, sidebar, and composer state when a new conversation cannot be saved', () => {
    const harness = createHarness()
    vi.mocked(harness.context.updateData).mockReturnValueOnce(null)

    const saved = harness.actions.createNewConversation()

    expect(saved).toBeNull()
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      'conversation-1',
    )
    expect(harness.context.setConversationSearch).not.toHaveBeenCalled()
    expect(harness.context.closeSidebar).not.toHaveBeenCalled()
    expect(harness.focusComposer).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.conversationSaveUnavailable',
      'error',
      'sidebar',
    )
  })

  it('contains new-conversation save-failure notice reporter failures without clearing search/sidebar/composer', () => {
    const harness = createHarness()
    vi.mocked(harness.context.updateData).mockReturnValueOnce(null)
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })
    let saved: AppData | null | undefined

    expect(() => {
      saved = harness.actions.createNewConversation()
    }).not.toThrow()

    expect(saved).toBeNull()
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      'conversation-1',
    )
    expect(harness.context.setConversationSearch).not.toHaveBeenCalled()
    expect(harness.context.closeSidebar).not.toHaveBeenCalled()
    expect(harness.focusComposer).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('opens provider setup instead of creating an unusable chat when no provider exists', () => {
    const harness = createHarness(appData([]))

    const saved = harness.actions.createNewConversation()

    expect(saved).toBeNull()
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('providers')
    expect(harness.context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.addProviderFirst',
      'warning',
      'providers-list',
    )
    expect(harness.focusComposer).not.toHaveBeenCalled()
  })

  it('contains no-provider notice reporter failures while opening provider setup', () => {
    const harness = createHarness(appData([]))
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })
    let saved: AppData | null | undefined

    expect(() => {
      saved = harness.actions.createNewConversation()
    }).not.toThrow()

    expect(saved).toBeNull()
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('providers')
    expect(harness.context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(harness.context.closeSidebar).toHaveBeenCalledTimes(1)
    expect(harness.focusComposer).not.toHaveBeenCalled()
  })

  it('does not show first-provider success when provider setup cannot be committed', () => {
    const harness = createHarness(appData([]))
    vi.mocked(harness.context.addProviderFromPresetId).mockReturnValueOnce(null)

    const provider = harness.actions.openFirstProviderSetup()

    expect(provider).toBeNull()
    expect(harness.context.setSelectedProviderId).not.toHaveBeenCalled()
    expect(harness.context.setSelectedPresetId).not.toHaveBeenCalled()
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('providers')
    expect(harness.context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(harness.context.closeSidebar).toHaveBeenCalledTimes(1)
    expect(harness.context.setNotice).not.toHaveBeenCalledWith(
      'notice.firstProviderAdded',
      'success',
      'providers-list',
    )
  })

  it('contains first-provider success notice reporter failures after committing provider setup', () => {
    const harness = createHarness(appData([]))
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })
    let addedProvider: ProviderConfig | null | undefined

    expect(() => {
      addedProvider = harness.actions.openFirstProviderSetup()
    }).not.toThrow()

    expect(addedProvider?.id).toBe('added-provider')
    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith(
      'added-provider',
    )
    expect(harness.context.setSelectedPresetId).toHaveBeenCalledTimes(1)
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('providers')
    expect(harness.context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(harness.context.closeSidebar).toHaveBeenCalledTimes(1)
  })

  it('keeps the sidebar open when active conversation selection cannot be saved', () => {
    const harness = createHarness(appDataWithTwoConversations())
    vi.mocked(harness.context.updateData).mockReturnValueOnce(null)

    const saved = harness.actions.setActiveConversation('conversation-2')

    expect(saved).toBeNull()
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      'conversation-1',
    )
    expect(harness.context.closeSidebar).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.conversationSaveUnavailable',
      'error',
      'sidebar',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('contains active-conversation save-failure notice reporter failures without closing sidebar', () => {
    const harness = createHarness(appDataWithTwoConversations())
    vi.mocked(harness.context.updateData).mockReturnValueOnce(null)
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })
    let saved: AppData | null | undefined

    expect(() => {
      saved = harness.actions.setActiveConversation('conversation-2')
    }).not.toThrow()

    expect(saved).toBeNull()
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      'conversation-1',
    )
    expect(harness.context.closeSidebar).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('switches the active conversation and queues immediate sync after save', () => {
    const harness = createHarness(appDataWithTwoConversations())

    const saved = harness.actions.setActiveConversation('conversation-2')

    expect(saved?.preferences.activeConversationId).toBe('conversation-2')
    expect(harness.context.closeSidebar).toHaveBeenCalledTimes(1)
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      saved,
      0,
    )
    expect(harness.context.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
  })

  it('renames conversations through updateData and schedules immediate sync without default auto-sync', () => {
    const harness = createHarness()

    harness.actions.commitConversationTitle('conversation-1', 'Renamed')

    expect(harness.dataRef.current?.conversations[0]?.title).toBe('Renamed')
    expect(harness.context.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )

    vi.mocked(harness.context.scheduleAutoSync).mockClear()
    harness.actions.commitConversationTitle('conversation-1', 'Renamed')
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('reports title save failures without scheduling sync', () => {
    const harness = createHarness()
    vi.mocked(harness.context.updateData).mockReturnValueOnce(null)

    const saved = harness.actions.commitConversationTitle(
      'conversation-1',
      'Renamed',
    )

    expect(saved).toBeNull()
    expect(harness.dataRef.current?.conversations[0]?.title).toBe('Original')
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.conversationSaveUnavailable',
      'error',
      'sidebar',
    )
  })

  it('contains title save-failure notice reporter failures without scheduling sync', () => {
    const harness = createHarness()
    vi.mocked(harness.context.updateData).mockReturnValueOnce(null)
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })
    let saved: AppData | null | undefined

    expect(() => {
      saved = harness.actions.commitConversationTitle(
        'conversation-1',
        'Renamed',
      )
    }).not.toThrow()

    expect(saved).toBeNull()
    expect(harness.dataRef.current?.conversations[0]?.title).toBe('Original')
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('deletes a confirmed final conversation and creates a usable fallback chat', async () => {
    const harness = createHarness()

    await harness.actions.deleteConversation('conversation-1')

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'danger.deleteConversation.title',
      }),
    )
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
    expect(harness.dataRef.current?.conversations[0]?.id).not.toBe(
      'conversation-1',
    )
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      harness.dataRef.current?.conversations[0]?.id,
    )
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
  })

  it('uses the current enabled provider for a final-conversation fallback', async () => {
    const disabled = provider('disabled-provider', { enabled: false })
    const enabled = provider('enabled-provider')
    const harness = createHarness(appData([disabled, enabled]))

    const saved = await harness.actions.deleteConversation('conversation-1')

    expect(saved?.conversations).toEqual([
      expect.objectContaining({
        providerId: enabled.id,
        model: enabled.model,
      }),
    ])
  })

  it('stops confirmed conversation deletion when generation starts during confirmation', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.requestDangerConfirmation).mockImplementationOnce(
      async () => {
        generationOwnership.active = true
        return true
      },
    )

    const saved = await harness.actions.deleteConversation('conversation-1')

    expect(saved).toBeNull()
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.stopOrWaitBeforeDelete',
      undefined,
      'sidebar',
    )
  })

  it('stops confirmed conversation deletion when the target changed remotely', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.requestDangerConfirmation).mockImplementationOnce(
      async () => {
        const latest = harness.dataRef.current

        if (latest) {
          harness.dataRef.current = {
            ...latest,
            conversations: [],
          }
        }
        return true
      },
    )

    const saved = await harness.actions.deleteConversation('conversation-1')

    expect(saved).toBeNull()
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('reports delete conversation save failures without syncing', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.updateData).mockReturnValueOnce(null)

    const saved = await harness.actions.deleteConversation('conversation-1')

    expect(saved).toBeNull()
    expect(harness.context.requestDangerConfirmation).toHaveBeenCalledTimes(1)
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      'conversation-1',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.conversationSaveUnavailable',
      'error',
      'sidebar',
    )
  })

  it('contains delete save-failure notice reporter failures without syncing', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.updateData).mockReturnValueOnce(null)
    vi.mocked(harness.context.setNotice).mockImplementation(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      harness.actions.deleteConversation('conversation-1'),
    ).resolves.toBeNull()

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalledTimes(1)
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      'conversation-1',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('reports rejected delete confirmations without leaking the promise', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.requestDangerConfirmation).mockRejectedValueOnce(
      new Error('confirmation closed unexpectedly'),
    )

    const saved = await harness.actions.deleteConversation('conversation-1')

    expect(saved).toBeNull()
    expect(harness.context.requestDangerConfirmation).toHaveBeenCalledTimes(1)
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      'conversation-1',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.conversationSaveUnavailable',
      'error',
      'sidebar',
    )
  })

  it('contains delete confirmation failure notice reporter failures without leaking the promise', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.requestDangerConfirmation).mockRejectedValueOnce(
      new Error('confirmation closed unexpectedly'),
    )
    vi.mocked(harness.context.setNotice).mockImplementation(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      harness.actions.deleteConversation('conversation-1'),
    ).resolves.toBeNull()

    expect(harness.context.requestDangerConfirmation).toHaveBeenCalledTimes(1)
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
    expect(harness.dataRef.current?.preferences.activeConversationId).toBe(
      'conversation-1',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('blocks deletion while generation is active', async () => {
    const harness = createHarness()
    generationOwnership.active = true

    await harness.actions.deleteConversation('conversation-1')

    expect(harness.context.setNotice).toHaveBeenCalledWith(
      'notice.stopOrWaitBeforeDelete',
      undefined,
      'sidebar',
    )
    expect(harness.context.requestDangerConfirmation).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
  })

  it('contains delete blocked notice reporter failures without opening confirmation', async () => {
    const harness = createHarness()
    generationOwnership.active = true
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    await expect(
      harness.actions.deleteConversation('conversation-1'),
    ).resolves.toBeNull()

    expect(harness.context.requestDangerConfirmation).not.toHaveBeenCalled()
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
  })

  it('contains delete clear-notice reporter failures while still asking for confirmation', async () => {
    const harness = createHarness()
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    const saved = await harness.actions.deleteConversation('conversation-1')

    expect(saved).toBe(harness.dataRef.current)
    expect(harness.context.requestDangerConfirmation).toHaveBeenCalledTimes(1)
    expect(harness.context.updateData).toHaveBeenCalledTimes(1)
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.dataRef.current?.conversations).toHaveLength(1)
    expect(harness.dataRef.current?.conversations[0]?.id).not.toBe(
      'conversation-1',
    )
  })
})
