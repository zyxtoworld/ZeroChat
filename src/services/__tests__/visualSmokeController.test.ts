import { describe, expect, it, vi } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type { Translator } from '../../i18n'
import type { AppData, UserSkill } from '../../types'
import { defaultSkillSettings } from '../appData'
import {
  applyVisualSmokeDocumentLanguage,
  clearVisualSmokeNotice,
  createVisualLargeSkillLibraryData,
  createVisualSmokeHandlers,
  isLocalVisualSmokeUrl,
  reportVisualSmokeNotice,
  type VisualSmokeControllerContext,
} from '../visualSmokeController'

const t = ((key: string) => key) as Translator

function skill(id: string): UserSkill {
  return {
    id,
    name: id,
    description: '',
    contentType: 'markdown',
    sourceSize: 10,
    contentHash: id,
    keywords: [],
    chunks: [
      {
        id: 'chunk-1',
        heading: id,
        content: id,
        keywords: [],
        tokenEstimate: 1,
      },
    ],
    fixed: false,
    enabled: true,
    autoMatch: true,
    createdAt: 1,
    updatedAt: 1,
  }
}

function appData(): AppData {
  const provider = providerFromPreset(providerPresets[0])

  return {
    version: 1,
    providers: [provider],
    conversations: [
      {
        id: 'conversation-1',
        title: 'Chat',
        providerId: provider.id,
        model: provider.model,
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    skills: [],
    skillSettings: defaultSkillSettings(),
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      gistFile: 'zerochat-sync.json',
      mode: 'local',
    },
    preferences: {
      activeConversationId: 'conversation-1',
      chatContextMessageLimit: 24,
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    updatedAt: 10,
  }
}

function eventWithDetail(detail: unknown): Event {
  return { detail } as unknown as Event
}

function createContext(data: AppData | null): VisualSmokeControllerContext {
  return {
    cancelEditingSkill: vi.fn(),
    clearNotice: vi.fn(),
    dataRef: { current: data },
    resetRenderedSkillList: vi.fn(),
    setData: vi.fn(),
    setNotice: vi.fn(),
    setSettingsOpen: vi.fn(),
    setSettingsTab: vi.fn(),
    setSyncFirstConflictPrompt: vi.fn(),
    showDangerPrompt: vi.fn(),
    t,
  }
}

describe('visual smoke controller', () => {
  it('only enables production visual hooks for explicit local QA URLs', () => {
    expect(isLocalVisualSmokeUrl('http://127.0.0.1:5208/?zerochat-visual-smoke=1')).toBe(
      true,
    )
    expect(isLocalVisualSmokeUrl('http://localhost:5208/?zerochat-visual-smoke=1')).toBe(
      true,
    )
    expect(isLocalVisualSmokeUrl('https://app.example.com/?zerochat-visual-smoke=1')).toBe(
      false,
    )
    expect(isLocalVisualSmokeUrl('http://127.0.0.1:5208/')).toBe(false)
  })

  it('builds bounded visual large-skill data while preserving user skills', () => {
    const current = {
      ...appData(),
      skills: [
        skill('user-skill'),
        skill('visual-large-skill-old'),
      ],
    }

    const next = createVisualLargeSkillLibraryData(current, 3, 100)

    expect(next.skills.map((item) => item.id)).toEqual([
      'visual-large-skill-001',
      'visual-large-skill-002',
      'user-skill',
    ])
    expect(next.skills[0]?.chunks[0]?.content).toContain(
      'Visual bulk skill 001',
    )
    expect(next.updatedAt).toBeGreaterThanOrEqual(current.updatedAt)
  })

  it('keeps generated large-skill rows in the first visual page', () => {
    const current = {
      ...appData(),
      skills: [
        ...Array.from({ length: 220 }, (_, index) =>
          skill(`user-skill-${index}`),
        ),
        skill('visual-large-skill-old'),
      ],
    }

    const next = createVisualLargeSkillLibraryData(current, 241, 100)

    expect(next.skills).toHaveLength(241)
    expect(next.skills[0]?.id).toBe('visual-large-skill-001')
    expect(next.skills[79]?.id).toBe('visual-large-skill-080')
    expect(next.skills[80]?.id).toBe('visual-large-skill-081')
    expect(next.skills[81]?.id).toBe('user-skill-0')
    expect(next.skills.some((item) => item.id === 'visual-large-skill-old')).toBe(
      false,
    )
  })

  it('opens the sync-conflict smoke state through settings sync', () => {
    const data = appData()
    const context = createContext(data)
    const handlers = createVisualSmokeHandlers(context)

    handlers.openSmokeSyncConflict()

    expect(context.setSyncFirstConflictPrompt).toHaveBeenCalledWith({
      snapshot: data,
      options: {
        silent: false,
      },
    })
    expect(context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(context.setSettingsTab).toHaveBeenCalledWith('sync')
    expect(context.setNotice).toHaveBeenCalledWith(
      'notice.syncFirstConflict',
      'warning',
      'sync',
    )
  })

  it('contains visual-smoke notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice failed')
    }) as VisualSmokeControllerContext['setNotice']

    expect(
      reportVisualSmokeNotice({
        getMessage: () => 'visual smoke notice',
        setNotice,
        target: 'sync',
        tone: 'warning',
      }),
    ).toBeNull()
    expect(setNotice).toHaveBeenCalledWith(
      'visual smoke notice',
      'warning',
      'sync',
    )
  })

  it('contains visual-smoke notice message formatter failures', () => {
    const setNotice = vi.fn()

    expect(
      reportVisualSmokeNotice({
        getMessage: () => {
          throw new Error('message failed')
        },
        setNotice,
        target: 'sync',
        tone: 'warning',
      }),
    ).toBeNull()
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('contains visual-smoke clear-notice reporter failures', () => {
    const clearNotice = vi.fn(() => {
      throw new Error('clear failed')
    })

    expect(clearVisualSmokeNotice(clearNotice)).toBe(false)
    expect(clearNotice).toHaveBeenCalledTimes(1)
  })

  it('keeps sync-conflict smoke state changes when notice reporting fails', () => {
    const data = appData()
    const context = {
      ...createContext(data),
      setNotice: vi.fn(() => {
        throw new Error('notice failed')
      }) as VisualSmokeControllerContext['setNotice'],
    }
    const handlers = createVisualSmokeHandlers(context)

    expect(() => handlers.openSmokeSyncConflict()).not.toThrow()
    expect(context.setSyncFirstConflictPrompt).toHaveBeenCalledWith({
      snapshot: data,
      options: {
        silent: false,
      },
    })
    expect(context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(context.setSettingsTab).toHaveBeenCalledWith('sync')
  })

  it('opens the import-backup danger smoke dialog on the Data tab', () => {
    const context = createContext(appData())
    const handlers = createVisualSmokeHandlers(context)

    handlers.openSmokeImportBackupDanger()

    expect(context.showDangerPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'import-backup-overwrite' }),
      { returnFocusTarget: null },
    )
    expect(context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(context.setSettingsTab).toHaveBeenCalledWith('data')
    expect(context.setNotice).toHaveBeenCalledWith('', 'success', 'data-backup')
  })

  it('switches smoke language only for supported language modes', () => {
    const data = appData()
    const context = createContext(data)
    const handlers = createVisualSmokeHandlers(context)

    handlers.setSmokeLanguage(eventWithDetail({ language: 'zz-ZZ' }))
    expect(context.setData).not.toHaveBeenCalled()

    handlers.setSmokeLanguage(eventWithDetail({ language: 'fr-FR' }))

    expect(context.dataRef.current?.preferences.language).toBe('fr-FR')
    expect(context.setData).toHaveBeenCalledWith(context.dataRef.current)
    expect(context.clearNotice).toHaveBeenCalledTimes(1)
  })

  it('applies visual smoke language to document metadata immediately', () => {
    const documentStub = {
      documentElement: {
        dir: '',
        lang: '',
      },
    }
    vi.stubGlobal('document', documentStub)

    try {
      applyVisualSmokeDocumentLanguage('fr-FR')
      expect(documentStub.documentElement.lang).toBe('fr-FR')
      expect(documentStub.documentElement.dir).toBe('ltr')

      applyVisualSmokeDocumentLanguage('ar-SA')
      expect(documentStub.documentElement.lang).toBe('ar-SA')
      expect(documentStub.documentElement.dir).toBe('rtl')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens the large Skill library visual state without rendering every item first', () => {
    const data = appData()
    const context = createContext(data)
    const handlers = createVisualSmokeHandlers(context)

    handlers.openSmokeLargeSkillLibrary(eventWithDetail({ count: 85 }))

    expect(context.dataRef.current?.skills).toHaveLength(85)
    expect(context.setSettingsOpen).toHaveBeenCalledWith(true)
    expect(context.setSettingsTab).toHaveBeenCalledWith('skills')
    expect(context.cancelEditingSkill).toHaveBeenCalledTimes(1)
    expect(context.resetRenderedSkillList).toHaveBeenCalledTimes(1)
    expect(context.clearNotice).toHaveBeenCalledTimes(1)
  })
})
