import { describe, expect, it, vi } from 'vitest'

import type { SettingsTab } from '../../components/SettingsNav'
import type { Translator } from '../../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../../types'
import {
  createAppNavigationActions,
  focusComposerTextareaToEnd,
  reportAppNavigationNotice,
  type AppNavigationControllerContext,
  type AppNavigationControllerServices,
} from '../appNavigationController'

const t = ((key: string) => key) as Translator

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    baseUrl: 'https://api.example.com/v1',
    createdAt: 1,
    enabled: true,
    kind: 'openai-compatible',
    model: 'chat-model',
    models: ['chat-model'],
    name: 'Provider',
    needsApiKey: true,
    updatedAt: 1,
    ...patch,
  }
}

function appData(): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      activeConversationId: undefined,
      chatContextMessageLimit: 20,
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [provider()],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt: 1,
  }
}

function createHarness(
  overrides: Partial<AppNavigationControllerContext> = {},
  initialData = appData(),
) {
  let guideReturnSettingsTab: SettingsTab | null = null
  const dataRef = { current: initialData }
  const context: AppNavigationControllerContext = {
    activeProvider: provider(),
    allowSettingsReturnFocus: vi.fn(),
    closeChatModelMenu: vi.fn(),
    closeSidebar: vi.fn(),
    focusComposerToEnd: vi.fn(),
    getGuideReturnSettingsTab: vi.fn(() => guideReturnSettingsTab),
    getSidebarOpenButton: vi.fn(() => null),
    hasActiveModal: vi.fn(() => false),
    rememberSettingsReturnFocusTarget: vi.fn(),
    resetRenderedSkillList: vi.fn(),
    setComposerMode: vi.fn(),
    setDraft: vi.fn(),
    setGuideOpen: vi.fn(),
    setGuideReturnSettingsTab: vi.fn((tab) => {
      guideReturnSettingsTab = tab
    }),
    setGuideSuccessPending: vi.fn(),
    setNotice: vi.fn(),
    setSelectedPresetId: vi.fn(),
    setSelectedProviderId: vi.fn(),
    setSettingsOpen: vi.fn(),
    setSettingsTab: vi.fn(),
    settingsOpen: false,
    settingsTab: 'providers',
    sidebarDocked: false,
    sidebarOpen: false,
    scheduleAutoSync: vi.fn(),
    t,
    updateData: vi.fn((updater) => {
      const next = updater(dataRef.current)
      dataRef.current = next
      return next
    }),
    ...overrides,
  }
  const services: AppNavigationControllerServices = {
    activeElement: vi.fn(() => null),
    isHTMLElement: (value: unknown): value is HTMLElement => Boolean(value),
    presetIdForProvider: vi.fn(() => 'openai'),
  }

  return {
    actions: createAppNavigationActions(context, services),
    context,
    dataRef,
    get guideReturnSettingsTab() {
      return guideReturnSettingsTab
    },
    services,
  }
}

describe('focusComposerTextareaToEnd', () => {
  it('focuses composer textareas at the end without scrolling', () => {
    const textarea = {
      focus: vi.fn(),
      setSelectionRange: vi.fn(),
      value: 'Hello ZeroChat',
    } as unknown as HTMLTextAreaElement

    expect(focusComposerTextareaToEnd(textarea)).toBe(true)

    expect(textarea.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(textarea.setSelectionRange).toHaveBeenCalledWith(14, 14)
  })

  it('contains composer focus failures after welcome prompts are applied', () => {
    const textarea = {
      focus: vi.fn(() => {
        throw new Error('focus blocked')
      }),
      setSelectionRange: vi.fn(),
      value: 'Prompt',
    } as unknown as HTMLTextAreaElement

    const result = focusComposerTextareaToEnd(textarea)

    expect(result).toBe(false)
    expect(textarea.setSelectionRange).not.toHaveBeenCalled()
  })

  it('contains composer selection failures after focus succeeds', () => {
    const textarea = {
      focus: vi.fn(),
      setSelectionRange: vi.fn(() => {
        throw new Error('selection blocked')
      }),
      value: 'Prompt',
    } as unknown as HTMLTextAreaElement

    const result = focusComposerTextareaToEnd(textarea)

    expect(result).toBe(false)
    expect(textarea.focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})

describe('createAppNavigationActions', () => {
  it('contains app navigation notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      reportAppNavigationNotice(
        { setNotice },
        () => 'notice.settingsSaveUnavailable',
        'error',
        'appearance',
      ),
    ).not.toThrow()

    expect(setNotice).toHaveBeenCalledWith(
      'notice.settingsSaveUnavailable',
      'error',
      'appearance',
    )
  })

  it('opens settings from the mobile sidebar, resets Skill rows, and preserves return focus', () => {
    const sidebarButton = {} as HTMLButtonElement
    const harness = createHarness({
      sidebarOpen: true,
      getSidebarOpenButton: vi.fn(() => sidebarButton),
    })

    harness.actions.openSettings(undefined, 'skills')

    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith(
      'provider-1',
    )
    expect(harness.context.resetRenderedSkillList).toHaveBeenCalledTimes(1)
    expect(harness.context.allowSettingsReturnFocus).toHaveBeenCalledTimes(1)
    expect(harness.context.rememberSettingsReturnFocusTarget).toHaveBeenCalledWith(
      sidebarButton,
    )
    expect(harness.context.closeSidebar).toHaveBeenCalledWith(false)
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('skills')
    expect(harness.context.setSettingsOpen).toHaveBeenCalledWith(true)
  })

  it('remembers a direct opener when settings opens outside the sidebar', () => {
    const opener = {} as HTMLElement
    const harness = createHarness()

    harness.actions.openSettings({ currentTarget: opener }, 'data')

    expect(harness.context.rememberSettingsReturnFocusTarget).toHaveBeenCalledWith(
      opener,
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith('')
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('data')
  })

  it('contains settings-open clear-notice reporter failures while opening the target tab', () => {
    const harness = createHarness()
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      harness.actions.openSettings(undefined, 'data'),
    ).not.toThrow()

    expect(harness.context.allowSettingsReturnFocus).toHaveBeenCalledTimes(1)
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('data')
    expect(harness.context.setSettingsOpen).toHaveBeenCalledWith(true)
  })

  it('switches to the Skills tab with a fresh rendered list', () => {
    const harness = createHarness({
      settingsTab: 'sync',
    })

    harness.actions.selectSettingsTab('skills')

    expect(harness.context.resetRenderedSkillList).toHaveBeenCalledTimes(1)
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('skills')
    expect(harness.context.setNotice).toHaveBeenCalledWith('')
  })

  it('contains settings-tab clear-notice reporter failures after selecting the tab', () => {
    const harness = createHarness({
      settingsTab: 'sync',
    })
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() => harness.actions.selectSettingsTab('skills')).not.toThrow()

    expect(harness.context.resetRenderedSkillList).toHaveBeenCalledTimes(1)
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('skills')
  })

  it('opens setup from settings and returns to the original tab when closed', () => {
    const harness = createHarness({
      settingsOpen: true,
      settingsTab: 'data',
    })

    harness.actions.openGuide()

    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith(
      'provider-1',
    )
    expect(harness.context.setSelectedPresetId).toHaveBeenCalledWith('openai')
    expect(harness.guideReturnSettingsTab).toBe('data')
    expect(harness.context.setSettingsOpen).toHaveBeenCalledWith(false)
    expect(harness.context.setGuideOpen).toHaveBeenCalledWith(true)

    harness.actions.closeGuide()

    expect(harness.context.setGuideSuccessPending).toHaveBeenCalledWith(false)
    expect(harness.context.setGuideOpen).toHaveBeenCalledWith(false)
    expect(harness.context.setSettingsTab).toHaveBeenCalledWith('data')
    expect(harness.context.setSettingsOpen).toHaveBeenLastCalledWith(true)
  })

  it('contains guide-open clear-notice reporter failures while opening setup', () => {
    const harness = createHarness({
      settingsOpen: true,
      settingsTab: 'data',
    })
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() => harness.actions.openGuide()).not.toThrow()

    expect(harness.context.setSelectedProviderId).toHaveBeenCalledWith(
      'provider-1',
    )
    expect(harness.guideReturnSettingsTab).toBe('data')
    expect(harness.context.setSettingsOpen).toHaveBeenCalledWith(false)
    expect(harness.context.setGuideOpen).toHaveBeenCalledWith(true)
  })

  it('keeps the guide return tab available to a close handler that fires immediately', () => {
    let guideReturnSettingsTab: SettingsTab | null = null
    const sharedContext = {
      getGuideReturnSettingsTab: vi.fn(() => guideReturnSettingsTab),
      setGuideReturnSettingsTab: vi.fn((tab: SettingsTab | null) => {
        guideReturnSettingsTab = tab
      }),
    }
    const harness = createHarness({
      ...sharedContext,
      settingsOpen: true,
      settingsTab: 'data',
    })
    const staleCloseHarness = createHarness({
      ...sharedContext,
      settingsOpen: false,
      settingsTab: 'providers',
    })

    harness.actions.openGuide()
    staleCloseHarness.actions.closeGuide()

    expect(staleCloseHarness.context.setGuideSuccessPending).toHaveBeenCalledWith(
      false,
    )
    expect(staleCloseHarness.context.setGuideOpen).toHaveBeenCalledWith(false)
    expect(staleCloseHarness.context.setSettingsTab).toHaveBeenCalledWith('data')
    expect(staleCloseHarness.context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(guideReturnSettingsTab).toBeNull()
  })

  it('writes appearance preferences through the shared AppData update path', () => {
    const harness = createHarness()

    harness.actions.changeTheme('dark')
    harness.actions.changeLanguage('zh-CN')
    harness.actions.changeCompactMode(true)
    harness.actions.changeChatContextMessageLimit(42)

    expect(harness.dataRef.current.preferences).toMatchObject({
      chatContextMessageLimit: 42,
      compactMode: true,
      language: 'zh-CN',
      theme: 'dark',
    })
    expect(harness.context.updateData).toHaveBeenCalledTimes(4)
    expect(harness.context.setNotice).toHaveBeenCalledWith('')
  })

  it('contains appearance success clear-notice reporter failures after commit and sync scheduling', () => {
    const harness = createHarness()
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() => harness.actions.changeTheme('dark')).not.toThrow()

    expect(harness.dataRef.current.preferences.theme).toBe('dark')
    expect(harness.context.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
  })

  it('queues immediate sync after Appearance preference commits locally', () => {
    const harness = createHarness()

    harness.actions.changeTheme('dark')

    expect(harness.context.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(harness.context.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.setNotice).toHaveBeenCalledWith('')
  })

  it('reports appearance preference commit failures without clearing the current notice', () => {
    const harness = createHarness({
      updateData: vi.fn(() => null),
    })

    harness.actions.changeTheme('dark')
    harness.actions.changeChatContextMessageLimit(42)

    expect(harness.dataRef.current.preferences).toMatchObject({
      chatContextMessageLimit: 20,
      theme: 'system',
    })
    expect(harness.context.setNotice).not.toHaveBeenCalledWith('')
    expect(harness.context.setNotice).toHaveBeenLastCalledWith(
      'notice.settingsSaveUnavailable',
      'error',
      'appearance',
    )
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('contains appearance save-failure notice reporter failures without scheduling sync', () => {
    const harness = createHarness({
      updateData: vi.fn(() => null),
    })
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() => harness.actions.changeTheme('dark')).not.toThrow()

    expect(harness.dataRef.current.preferences.theme).toBe('system')
    expect(harness.context.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('applies a welcome prompt and focuses the composer at the end', () => {
    const harness = createHarness()

    harness.actions.applyWelcomePrompt('Draft me a plan')

    expect(harness.context.setComposerMode).toHaveBeenCalledWith('chat')
    expect(harness.context.closeChatModelMenu).toHaveBeenCalledTimes(1)
    expect(harness.context.setDraft).toHaveBeenCalledWith('Draft me a plan')
    expect(harness.context.focusComposerToEnd).toHaveBeenCalledTimes(1)
  })

  it('contains welcome-prompt clear-notice reporter failures while applying the prompt', () => {
    const harness = createHarness()
    vi.mocked(harness.context.setNotice).mockImplementationOnce(() => {
      throw new Error('notice channel unavailable')
    })

    expect(() =>
      harness.actions.applyWelcomePrompt('Draft me a plan'),
    ).not.toThrow()

    expect(harness.context.setComposerMode).toHaveBeenCalledWith('chat')
    expect(harness.context.closeChatModelMenu).toHaveBeenCalledTimes(1)
    expect(harness.context.setDraft).toHaveBeenCalledWith('Draft me a plan')
    expect(harness.context.focusComposerToEnd).toHaveBeenCalledTimes(1)
  })
})
