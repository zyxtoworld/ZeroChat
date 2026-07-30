import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  ChatMessage,
  Conversation,
  ProviderConfig,
} from '../../types'
import {
  commitRootEditsOnBlur,
  deriveRootReadinessState,
  deriveRootSessionBridgeState,
  dismissRootDangerWarning,
  isRootDangerWarningDismissed,
  messageForContextMenu,
  reportRootDangerWarningNotice,
  reportRootLocalizedNotice,
  reportRootNotice,
  reportUnsupportedImageSourceNotice,
  rootGuideVisible,
  rootPromptOpen,
} from '../appRootBridgeController'

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    role: 'user',
    content: 'hello',
    createdAt: 1,
    status: 'done',
    ...patch,
  }
}

function conversation(messages: ChatMessage[] = [message()]): Conversation {
  return {
    id: 'conversation-1',
    title: 'Chat',
    providerId: 'provider-1',
    model: 'model-1',
    messages,
    createdAt: 1,
    updatedAt: 1,
  }
}

function provider(): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-1',
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
  }
}

function appData(messages: ChatMessage[] = [message()]): AppData {
  return {
    conversations: [conversation(messages)],
    preferences: {
      activeConversationId: 'conversation-1',
      chatContextMessageLimit: 12,
      compactMode: false,
      firstRunDone: true,
      language: 'zh-CN',
      theme: 'system',
    },
    providers: [],
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
    version: 1,
  }
}

describe('app root bridge controller helpers', () => {
  it('derives guide visibility for notice routing without interaction state', () => {
    expect(rootGuideVisible(null, true)).toBe(false)
    expect(rootGuideVisible(appData(), false)).toBe(false)
    expect(rootGuideVisible(appData(), false, true)).toBe(true)
    expect(
      rootGuideVisible(
        {
          ...appData(),
          preferences: {
            ...appData().preferences,
            firstRunDone: false,
          },
        },
        false,
      ),
    ).toBe(true)
    expect(rootGuideVisible(appData(), true)).toBe(true)
  })

  it('normalizes root prompt visibility for shared overlay consumers', () => {
    expect(rootPromptOpen(null)).toBe(false)
    expect(rootPromptOpen(undefined)).toBe(false)
    expect(rootPromptOpen({ id: 'prompt' })).toBe(true)
  })

  it('derives root session bridge fallbacks for controllers that need stable ids and modes', () => {
    expect(
      deriveRootSessionBridgeState({
        activeConversation: null,
        data: null,
      }),
    ).toEqual({
      activeConversationId: '',
      currentSyncMode: 'local',
      firstRunDone: false,
    })

    expect(
      deriveRootSessionBridgeState({
        activeConversation: {
          ...conversation(),
          id: 'active-conversation',
        },
        data: {
          ...appData(),
          sync: {
            ...appData().sync,
            mode: 'cloudflare',
          },
        },
      }),
    ).toEqual({
      activeConversationId: 'active-conversation',
      currentSyncMode: 'cloudflare',
      firstRunDone: true,
    })
  })

  it('derives root readiness states for loading, empty, and ready screens', () => {
    const activeConversation = conversation()
    const activeProvider = provider()
    const readyData = {
      ...appData(),
      providers: [activeProvider],
    }

    expect(
      deriveRootReadinessState({
        activeConversation: null,
        activeProvider: null,
        data: null,
        loadError: 'broken database',
      }),
    ).toEqual({
      kind: 'load-error',
      error: 'broken database',
    })
    expect(
      deriveRootReadinessState({
        activeConversation: null,
        activeProvider: null,
        data: null,
        loadError: '',
      }),
    ).toEqual({ kind: 'loading' })
    expect(
      deriveRootReadinessState({
        activeConversation: null,
        activeProvider: null,
        data: appData(),
        loadError: '',
      }),
    ).toEqual({ kind: 'provider-empty' })
    expect(
      deriveRootReadinessState({
        activeConversation: null,
        activeProvider,
        data: readyData,
        loadError: '',
      }),
    ).toEqual({ kind: 'conversation-empty' })

    expect(
      deriveRootReadinessState({
        activeConversation,
        activeProvider,
        data: readyData,
        loadError: '',
      }),
    ).toEqual({
      kind: 'ready',
      activeConversation,
      activeProvider,
      data: readyData,
    })
  })

  it('reads and writes dismissed danger warnings through focused helpers', () => {
    const snapshot = appData()
    const setNotice = vi.fn()
    const t: Translator = (key) => key
    const updateData = vi.fn((updater) => updater(snapshot))

    expect(
      isRootDangerWarningDismissed(snapshot, 'reset-local-data'),
    ).toBe(false)

    const next = dismissRootDangerWarning(
      {
        setNotice,
        t,
        updateData,
      },
      'reset-local-data',
    )

    expect(updateData).toHaveBeenCalledTimes(1)
    expect(setNotice).not.toHaveBeenCalled()
    expect(
      isRootDangerWarningDismissed(next, 'reset-local-data'),
    ).toBe(true)
  })

  it('reports danger-warning dismissal save failures instead of silently claiming success', () => {
    const setNotice = vi.fn()
    const t: Translator = (key) => key
    const updateData = vi.fn(() => null)

    const saved = dismissRootDangerWarning(
      {
        setNotice,
        t,
        updateData,
      },
      'reset-local-data',
    )

    expect(saved).toBeNull()
    expect(updateData).toHaveBeenCalledTimes(1)
    expect(setNotice).toHaveBeenCalledWith(
      'notice.settingsSaveUnavailable',
      'error',
    )
  })

  it('contains danger-warning dismissal save-failure notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })
    const t: Translator = (key) => key
    const updateData = vi.fn(() => null)

    const saved = dismissRootDangerWarning(
      {
        setNotice,
        t,
        updateData,
      },
      'reset-local-data',
    )

    expect(saved).toBeNull()
    expect(updateData).toHaveBeenCalledTimes(1)
    expect(setNotice).toHaveBeenCalledWith(
      'notice.settingsSaveUnavailable',
      'error',
    )
  })

  it('contains standalone danger-warning notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(
      reportRootDangerWarningNotice(
        { setNotice },
        () => 'notice.settingsSaveUnavailable',
        'error',
      ),
    ).toBeNull()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.settingsSaveUnavailable',
      'error',
    )
  })

  it('contains root notice message formatter failures', () => {
    const setNotice = vi.fn()

    expect(
      reportRootNotice(
        { setNotice },
        () => {
          throw new Error('formatter unavailable')
        },
        'error',
        'sync',
      ),
    ).toBeNull()
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('contains root localized notice reporter failures', () => {
    const setNotice = vi.fn()
    const t: Translator = (key) => key

    expect(
      reportRootLocalizedNotice(
        {
          setNotice,
          t,
        },
        'notice.audioSourceUnsupported',
        'warning',
        'chat',
      ),
    ).toBe('notice.audioSourceUnsupported')
    expect(setNotice).toHaveBeenCalledWith(
      'notice.audioSourceUnsupported',
      'warning',
      'chat',
    )

    const failingNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })
    expect(
      reportRootLocalizedNotice(
        {
          setNotice: failingNotice,
          t,
        },
        'notice.imagePreviewFailed',
        'error',
        'chat',
      ),
    ).toBeNull()
    expect(failingNotice).toHaveBeenCalledWith(
      'notice.imagePreviewFailed',
      'error',
      'chat',
    )

    const unusedNotice = vi.fn()
    const failingTranslator: Translator = () => {
      throw new Error('locale unavailable')
    }
    expect(
      reportRootLocalizedNotice(
        {
          setNotice: unusedNotice,
          t: failingTranslator,
        },
        'notice.localeLoadFailed',
        'error',
      ),
    ).toBeNull()
    expect(unusedNotice).not.toHaveBeenCalled()
  })

  it('contains unsupported image source notice reporter failures', () => {
    const setNotice = vi.fn()
    const t: Translator = (key) => key

    expect(
      reportUnsupportedImageSourceNotice({
        setNotice,
        t,
      }),
    ).toBe('notice.imageSourceUnsupported')
    expect(setNotice).toHaveBeenCalledWith(
      'notice.imageSourceUnsupported',
      'warning',
      'chat',
    )

    const failingNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })
    expect(
      reportUnsupportedImageSourceNotice({
        setNotice: failingNotice,
        t,
      }),
    ).toBeNull()
    expect(failingNotice).toHaveBeenCalledWith(
      'notice.imageSourceUnsupported',
      'warning',
      'chat',
    )

    const unusedNotice = vi.fn()
    const failingTranslator: Translator = () => {
      throw new Error('locale unavailable')
    }
    expect(
      reportUnsupportedImageSourceNotice({
        setNotice: unusedNotice,
        t: failingTranslator,
      }),
    ).toBeNull()
    expect(unusedNotice).not.toHaveBeenCalled()
  })

  it('resolves the current context-menu message from the active conversation', () => {
    const target = message({ id: 'target-message', content: 'copy me' })

    expect(
      messageForContextMenu(conversation([message(), target]), {
        messageId: 'target-message',
        x: 10,
        y: 20,
      }),
    ).toBe(target)
    expect(messageForContextMenu(null, { messageId: 'target-message', x: 0, y: 0 })).toBeNull()
    expect(messageForContextMenu(conversation(), null)).toBeNull()
  })

  it('commits blur edits through immediate local save and auto-sync only when safe', () => {
    const snapshot = appData()
    const queueLocalSave = vi.fn()
    const scheduleAutoSync = vi.fn()

    expect(
      commitRootEditsOnBlur({
        queueLocalSave,
        scheduleAutoSync,
        snapshot,
      }),
    ).toBe(true)
    expect(queueLocalSave).toHaveBeenCalledWith(snapshot, 0)
    expect(scheduleAutoSync).toHaveBeenCalledWith(snapshot, 0)

    queueLocalSave.mockClear()
    scheduleAutoSync.mockClear()

    expect(
      commitRootEditsOnBlur({
        queueLocalSave,
        scheduleAutoSync,
        snapshot: appData([message({ status: 'streaming' })]),
      }),
    ).toBe(false)
    expect(
      commitRootEditsOnBlur({
        queueLocalSave,
        scheduleAutoSync,
        snapshot: null,
      }),
    ).toBe(false)
    expect(queueLocalSave).not.toHaveBeenCalled()
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })
})
