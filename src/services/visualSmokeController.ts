import {
  useEffect,
  type MutableRefObject,
} from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { SettingsTab } from '../components/SettingsNav'
import {
  localeDirection,
  setRuntimeLocale,
  supportedLanguageModes,
  type Locale,
  type Translator,
} from '../i18n'
import type {
  AppData,
  LanguageMode,
  UserSkill,
} from '../types'
import { bump } from './appData'
import {
  importBackupDangerPrompt,
  type DangerPrompt,
} from './dangerConfirmation'
import { INITIAL_SKILL_RENDER_COUNT } from './settingsSkillList'
import type {
  RunSyncOptions,
} from './syncFlow'
import type { NoticeTone } from './uiRuntime'

export interface SyncFirstConflictPrompt {
  snapshot: AppData
  options: RunSyncOptions
}

export interface VisualSmokeControllerContext {
  cancelEditingSkill: () => void
  clearNotice: () => void
  dataRef: MutableRefObject<AppData | null>
  resetRenderedSkillList: () => void
  setData: (data: AppData) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsTab: (tab: SettingsTab) => void
  setSyncFirstConflictPrompt: (prompt: SyncFirstConflictPrompt) => void
  showDangerPrompt: (
    prompt: DangerPrompt,
    options?: { returnFocusTarget?: HTMLElement | null },
  ) => void
  t: Translator
}

const VISUAL_SMOKE_QUERY_PARAM = 'zerochat-visual-smoke'
const localVisualSmokeHosts = new Set(['127.0.0.1', 'localhost', '::1'])

interface VisualSmokeHandlers {
  openSmokeImportBackupDanger: () => void
  openSmokeSyncConflict: () => void
  openSmokeLargeSkillLibrary: (event: Event) => void
  setSmokeLanguage: (event: Event) => void
}

interface VisualSmokeNoticeOptions {
  getMessage: () => string
  setNotice: VisualSmokeControllerContext['setNotice']
  target: NoticeTarget
  tone: NoticeTone
}

export function isLocalVisualSmokeUrl(value: string): boolean {
  try {
    const url = new URL(value)

    return (
      ['http:', 'https:'].includes(url.protocol) &&
      localVisualSmokeHosts.has(url.hostname) &&
      url.searchParams.get(VISUAL_SMOKE_QUERY_PARAM) === '1'
    )
  } catch {
    return false
  }
}

export function shouldEnableVisualSmokeController(): boolean {
  if (import.meta.env.DEV) {
    return true
  }

  return typeof window !== 'undefined' && isLocalVisualSmokeUrl(window.location.href)
}

export function reportVisualSmokeNotice({
  getMessage,
  setNotice,
  target,
  tone,
}: VisualSmokeNoticeOptions): string | null {
  try {
    const message = getMessage()
    setNotice(message, tone, target)
    return message
  } catch {
    return null
  }
}

export function clearVisualSmokeNotice(clearNotice: () => void): boolean {
  try {
    clearNotice()
    return true
  } catch {
    return false
  }
}

function visualLargeSkillContent(ordinal: string): string {
  return (
    `# Visual bulk skill ${ordinal}\n` +
    'Lightweight audit item for large library rendering, show-more controls, and compact settings density.'
  )
}

function requestedLargeSkillCount(event: Event): number {
  const requestedCount =
    (event as CustomEvent<{ count?: unknown }>).detail?.count

  return typeof requestedCount === 'number' && Number.isFinite(requestedCount)
    ? Math.max(INITIAL_SKILL_RENDER_COUNT + 1, Math.round(requestedCount))
    : 241
}

export function createVisualLargeSkillLibraryData(
  current: AppData,
  totalCount: number,
  generatedAt = Date.now(),
): AppData {
  const targetCount = Math.max(0, Math.round(totalCount))
  const preservedSkills = current.skills.filter(
    (skill) => !skill.id.startsWith('visual-large-skill-'),
  )
  const minimumVisibleGeneratedCount =
    targetCount > INITIAL_SKILL_RENDER_COUNT
      ? Math.min(targetCount, INITIAL_SKILL_RENDER_COUNT + 1)
      : Math.max(0, targetCount - preservedSkills.length)
  const generatedCount = Math.min(
    targetCount,
    Math.max(minimumVisibleGeneratedCount, targetCount - preservedSkills.length),
  )
  const preservedSkillSlice = preservedSkills.slice(
    0,
    Math.max(0, targetCount - generatedCount),
  )
  const generatedSkills: UserSkill[] = Array.from(
    { length: generatedCount },
    (_, index) => {
      const ordinal = String(index + 1).padStart(3, '0')
      const content = visualLargeSkillContent(ordinal)

      return {
        id: `visual-large-skill-${ordinal}`,
        name: `Visual bulk skill ${ordinal}`,
        description:
          'Lightweight audit item for large library rendering.',
        contentType: 'markdown',
        sourceSize: content.length,
        contentHash: `visual-large-skill-${ordinal}`,
        keywords: ['visual', 'bulk', 'skill', ordinal],
        chunks: [
          {
            id: 'chunk-1',
            heading: `Visual bulk skill ${ordinal}`,
            content,
            contentPreview: content.slice(0, 180),
            keywords: ['visual', 'bulk', 'skill', ordinal],
            tokenEstimate: Math.max(1, Math.ceil(content.length / 3.8)),
          },
        ],
        fixed: false,
        enabled: true,
        autoMatch: true,
        createdAt: generatedAt - index,
        updatedAt: generatedAt - index,
      }
    },
  )

  return bump({
    ...current,
    skills: [...generatedSkills, ...preservedSkillSlice],
  })
}

export function applyVisualSmokeDocumentLanguage(language: LanguageMode): void {
  if (language === 'system' || typeof document === 'undefined') {
    return
  }

  document.documentElement.lang = language
  document.documentElement.dir = localeDirection(language as Locale)
  setRuntimeLocale(language as Locale)
}

export function createVisualSmokeHandlers({
  cancelEditingSkill,
  clearNotice,
  dataRef,
  resetRenderedSkillList,
  setData,
  setNotice,
  setSettingsOpen,
  setSettingsTab,
  setSyncFirstConflictPrompt,
  showDangerPrompt,
  t,
}: VisualSmokeControllerContext): VisualSmokeHandlers {
  function openSmokeSyncConflict(): void {
    const snapshot = dataRef.current

    if (!snapshot) {
      return
    }

    setSyncFirstConflictPrompt({
      snapshot,
      options: {
        silent: false,
      },
    })
    setSettingsOpen(true)
    setSettingsTab('sync')
    reportVisualSmokeNotice({
      getMessage: () => t('notice.syncFirstConflict'),
      setNotice,
      target: 'sync',
      tone: 'warning',
    })
  }

  function openSmokeImportBackupDanger(): void {
    showDangerPrompt(importBackupDangerPrompt(t), { returnFocusTarget: null })
    setSettingsOpen(true)
    setSettingsTab('data')
    reportVisualSmokeNotice({
      getMessage: () => '',
      setNotice,
      target: 'data-backup',
      tone: 'success',
    })
  }

  function openSmokeLargeSkillLibrary(event: Event): void {
    const current = dataRef.current

    if (!current) {
      return
    }

    const next = createVisualLargeSkillLibraryData(
      current,
      requestedLargeSkillCount(event),
    )

    cancelEditingSkill()
    dataRef.current = next
    setData(next)
    resetRenderedSkillList()
    setSettingsOpen(true)
    setSettingsTab('skills')
    clearVisualSmokeNotice(clearNotice)
  }

  function setSmokeLanguage(event: Event): void {
    const language = (event as CustomEvent<{ language?: unknown }>).detail
      ?.language

    if (!supportedLanguageModes().includes(language as LanguageMode)) {
      return
    }

    const current = dataRef.current

    if (!current) {
      return
    }

    const next = bump({
      ...current,
      preferences: {
        ...current.preferences,
        language: language as LanguageMode,
      },
    })

    applyVisualSmokeDocumentLanguage(language as LanguageMode)
    dataRef.current = next
    setData(next)
    clearVisualSmokeNotice(clearNotice)
  }

  return {
    openSmokeImportBackupDanger,
    openSmokeSyncConflict,
    openSmokeLargeSkillLibrary,
    setSmokeLanguage,
  }
}

export function registerVisualSmokeController(
  context: VisualSmokeControllerContext,
): () => void {
  const {
    openSmokeImportBackupDanger,
    openSmokeSyncConflict,
    openSmokeLargeSkillLibrary,
    setSmokeLanguage,
  } = createVisualSmokeHandlers(context)

  window.addEventListener('zerochat:smoke-sync-conflict', openSmokeSyncConflict)
  window.addEventListener(
    'zerochat:smoke-import-backup-danger',
    openSmokeImportBackupDanger,
  )
  window.addEventListener(
    'zerochat:smoke-large-skills',
    openSmokeLargeSkillLibrary,
  )
  window.addEventListener('zerochat:smoke-language', setSmokeLanguage)

  return () => {
    window.removeEventListener(
      'zerochat:smoke-sync-conflict',
      openSmokeSyncConflict,
    )
    window.removeEventListener(
      'zerochat:smoke-import-backup-danger',
      openSmokeImportBackupDanger,
    )
    window.removeEventListener(
      'zerochat:smoke-large-skills',
      openSmokeLargeSkillLibrary,
    )
    window.removeEventListener('zerochat:smoke-language', setSmokeLanguage)
  }
}

export function useVisualSmokeController(
  context: VisualSmokeControllerContext,
): void {
  const {
    cancelEditingSkill,
    clearNotice,
    dataRef,
    resetRenderedSkillList,
    setData,
    setNotice,
    setSettingsOpen,
    setSettingsTab,
    setSyncFirstConflictPrompt,
    showDangerPrompt,
    t,
  } = context

  useEffect(() => {
    if (!shouldEnableVisualSmokeController()) {
      return undefined
    }

    return registerVisualSmokeController({
      cancelEditingSkill,
      clearNotice,
      dataRef,
      resetRenderedSkillList,
      setData,
      setNotice,
      setSettingsOpen,
      setSettingsTab,
      setSyncFirstConflictPrompt,
      showDangerPrompt,
      t,
    })
  }, [
    cancelEditingSkill,
    clearNotice,
    dataRef,
    resetRenderedSkillList,
    setData,
    setNotice,
    setSettingsOpen,
    setSettingsTab,
    setSyncFirstConflictPrompt,
    showDangerPrompt,
    t,
  ])
}
