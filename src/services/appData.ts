import type {
  AppData,
  Conversation,
  DangerWarningId,
  LanguageMode,
  ProviderConfig,
  SkillSettings,
  SyncMode,
  ThemeMode,
  UserSkill,
  UserSkillChunk,
} from '../types'
import { DEFAULT_GIST_FILE } from './syncDefaults'
import {
  createRuntimeId,
  isUsableRuntimeId,
  reserveRuntimeIds,
} from './runtimeId'

export { createRuntimeId } from './runtimeId'

export const DEFAULT_SKILL_CONTEXT_BUDGET = 2400
export const MIN_SKILL_CONTEXT_BUDGET = 600
export const MAX_SKILL_CONTEXT_BUDGET = 8000
export const DEFAULT_MAX_AUTO_SKILLS = 3
export const DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT = 24
export const MIN_CHAT_CONTEXT_MESSAGE_LIMIT = 4
export const MAX_CHAT_CONTEXT_MESSAGE_LIMIT = 200

export function defaultSkillSettings(): SkillSettings {
  return {
    autoMatch: true,
    contextBudget: DEFAULT_SKILL_CONTEXT_BUDGET,
    maxAutoSkills: DEFAULT_MAX_AUTO_SKILLS,
  }
}

export function normalizeChatContextMessageLimit(value: unknown): number {
  return clampInteger(
    value,
    DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
    MIN_CHAT_CONTEXT_MESSAGE_LIMIT,
    MAX_CHAT_CONTEXT_MESSAGE_LIMIT,
  )
}

export function now(): number {
  return Date.now()
}

export function bump(data: AppData): AppData {
  return {
    ...data,
    updatedAt: now(),
  }
}

export function updateConversation(
  data: AppData,
  conversationId: string,
  updater: (conversation: Conversation) => Conversation,
): AppData {
  return bump({
    ...data,
    conversations: data.conversations.map((conversation) =>
      conversation.id === conversationId
        ? { ...updater(conversation), updatedAt: now() }
        : conversation,
    ),
  })
}

function orderedProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return [
    ...providers.filter((provider) => provider.enabled),
    ...providers.filter((provider) => !provider.enabled),
  ]
}

export function reorderProviders(
  providers: ProviderConfig[],
  sourceId: string,
  targetId: string,
): ProviderConfig[] {
  if (!sourceId || sourceId === targetId) {
    return providers
  }

  const sourceIndex = providers.findIndex((provider) => provider.id === sourceId)
  const targetIndex = providers.findIndex((provider) => provider.id === targetId)

  if (sourceIndex < 0 || targetIndex < 0) {
    return providers
  }

  const nextProviders = [...providers]
  const [movedProvider] = nextProviders.splice(sourceIndex, 1)

  if (!movedProvider) {
    return providers
  }

  nextProviders.splice(targetIndex, 0, movedProvider)
  return orderedProviders(nextProviders)
}

export function hasStreamingMessage(data: AppData): boolean {
  return data.conversations.some((conversation) =>
    conversation.messages.some((message) => message.status === 'streaming'),
  )
}

export function hasPendingGenerationMessage(data: AppData): boolean {
  return data.conversations.some((conversation) =>
    conversation.messages.some((message) =>
      message.status === 'streaming' || message.status === 'queued',
    ),
  )
}

export function mergeSyncIdentifiers(current: AppData, synced: AppData): AppData {
  const sameMode = current.sync.mode === synced.sync.mode

  return {
    ...current,
    sync: {
      ...current.sync,
      encryptionEnabled: true,
      gistId: sameMode
        ? synced.sync.gistId ?? current.sync.gistId
        : current.sync.gistId,
      gistFile: sameMode
        ? synced.sync.gistFile ?? current.sync.gistFile
        : current.sync.gistFile,
      workerEndpoint: sameMode
        ? synced.sync.workerEndpoint ?? current.sync.workerEndpoint
        : current.sync.workerEndpoint,
    },
  }
}

export function dangerWarningDismissed(
  data: AppData | null | undefined,
  id: DangerWarningId,
): boolean {
  return Boolean(data?.preferences.dismissedDangerWarnings?.includes(id))
}

export function dismissDangerWarningInData(
  data: AppData,
  id: DangerWarningId,
): AppData {
  const dismissed = data.preferences.dismissedDangerWarnings ?? []

  if (dismissed.includes(id)) {
    return data
  }

  return updatePreferences(data, {
    dismissedDangerWarnings: [...dismissed, id],
  })
}

export function updateSyncMode(data: AppData, mode: SyncMode): AppData {
  return updateSyncConfig(data, {
    mode,
    autoSync: mode !== 'local',
    encryptionEnabled: true,
  })
}

export function updateSyncAutoSync(
  data: AppData,
  autoSync: boolean,
): AppData {
  return updateSyncConfig(data, {
    autoSync: data.sync.mode !== 'local' && autoSync,
    encryptionEnabled: true,
  })
}

export function updateSyncGistId(data: AppData, value: string): AppData {
  return updateSyncConfig(data, {
    gistId: value.trim() || undefined,
  })
}

export function updateSyncGistFile(data: AppData, value: string): AppData {
  return updateSyncConfig(data, {
    gistFile: value.trim() || DEFAULT_GIST_FILE,
  })
}

export function updateSyncWorkerEndpoint(
  data: AppData,
  value: string,
): AppData {
  return updateSyncConfig(data, {
    workerEndpoint: value.trim() || undefined,
  })
}

export function updateThemePreference(
  data: AppData,
  theme: ThemeMode,
): AppData {
  return updatePreferences(data, { theme })
}

export function updateLanguagePreference(
  data: AppData,
  language: LanguageMode,
): AppData {
  return updatePreferences(data, { language })
}

export function updateCompactModePreference(
  data: AppData,
  compactMode: boolean,
): AppData {
  return updatePreferences(data, { compactMode })
}

export function updateChatContextMessageLimitPreference(
  data: AppData,
  value: number,
): AppData {
  return updatePreferences(data, {
    chatContextMessageLimit: normalizeChatContextMessageLimit(value),
  })
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.min(Math.max(Math.round(numeric), min), max)
}

function updateSyncConfig(
  data: AppData,
  patch: Partial<AppData['sync']>,
): AppData {
  return bump({
    ...data,
    sync: {
      ...data.sync,
      ...patch,
    },
  })
}

function updatePreferences(
  data: AppData,
  patch: Partial<AppData['preferences']>,
): AppData {
  return bump({
    ...data,
    preferences: {
      ...data.preferences,
      ...patch,
    },
  })
}

function stringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (item): item is string => typeof item === 'string' && Boolean(item.trim()),
    )
    .map((item) => item.trim())
    .slice(0, limit)
}

function normalizeSkillChunk(value: unknown, index: number): UserSkillChunk | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const chunk = value as Partial<UserSkillChunk>
  const content = typeof chunk.content === 'string' ? chunk.content.trim() : ''
  const contentRef =
    typeof chunk.contentRef === 'string' && chunk.contentRef.trim()
      ? chunk.contentRef.trim()
      : undefined
  const contentPreview =
    typeof chunk.contentPreview === 'string' && chunk.contentPreview.trim()
      ? chunk.contentPreview.trim()
      : content.slice(0, 180)

  if (!content && !contentRef) {
    return null
  }

  return {
    id: typeof chunk.id === 'string' && chunk.id ? chunk.id : `chunk-${index + 1}`,
    heading:
      typeof chunk.heading === 'string' && chunk.heading.trim()
        ? chunk.heading.trim()
        : `Part ${index + 1}`,
    ...(content ? { content } : {}),
    ...(contentRef ? { contentRef } : {}),
    ...(contentPreview ? { contentPreview } : {}),
    keywords: stringArray(chunk.keywords, 32),
    tokenEstimate: clampInteger(
      chunk.tokenEstimate,
      Math.max(1, Math.ceil((content.length || contentPreview.length || 4) / 4)),
      1,
      100_000,
    ),
  }
}

function normalizeSkill(value: unknown): UserSkill | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const skill = value as Partial<UserSkill>
  const chunks = Array.isArray(skill.chunks)
    ? skill.chunks
        .map((chunk, index) => normalizeSkillChunk(chunk, index))
        .filter((chunk): chunk is UserSkillChunk => Boolean(chunk))
    : []

  if (chunks.length === 0) {
    return null
  }

  const now = Date.now()
  const name =
    typeof skill.name === 'string' && skill.name.trim()
      ? skill.name.trim()
      : typeof skill.fileName === 'string' && skill.fileName.trim()
        ? skill.fileName.trim()
        : 'Skill'
  const contentType =
    skill.contentType === 'json' || skill.contentType === 'markdown'
      ? skill.contentType
      : 'text'
  const sourceSize = clampInteger(
    skill.sourceSize,
    chunks.reduce((sum, chunk) => sum + (chunk.content?.length ?? 0), 0),
    0,
    Number.MAX_SAFE_INTEGER,
  )

  return {
    id:
      isUsableRuntimeId(skill.id)
        ? skill.id
        : createRuntimeId('skill'),
    name,
    description:
      typeof skill.description === 'string' ? skill.description.trim() : '',
    fileName:
      typeof skill.fileName === 'string' && skill.fileName.trim()
        ? skill.fileName.trim()
        : undefined,
    contentType,
    sourceSize,
    contentHash:
      typeof skill.contentHash === 'string' && skill.contentHash
        ? skill.contentHash
        : `${sourceSize}:${chunks.length}`,
    keywords: stringArray(skill.keywords, 48),
    chunks,
    fixed: Boolean(skill.fixed),
    enabled: skill.enabled !== false,
    autoMatch: skill.autoMatch !== false,
    createdAt: clampInteger(skill.createdAt, now, 1, Number.MAX_SAFE_INTEGER),
    updatedAt: clampInteger(skill.updatedAt, now, 1, Number.MAX_SAFE_INTEGER),
  }
}

function createFallbackConversation(provider: ProviderConfig): Conversation {
  const timestamp = Date.now()

  return {
    id: createRuntimeId('conversation'),
    title: '',
    providerId: provider.id,
    model: provider.model,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function normalizeConversations(data: AppData): Conversation[] {
  if (Array.isArray(data.conversations) && data.conversations.length > 0) {
    return data.conversations
  }

  const provider = Array.isArray(data.providers) ? data.providers[0] : undefined

  return provider ? [createFallbackConversation(provider)] : []
}

export function normalizeSkillSettings(value: unknown): SkillSettings {
  const defaults = defaultSkillSettings()

  if (typeof value !== 'object' || value === null) {
    return defaults
  }

  const settings = value as Partial<SkillSettings>

  return {
    autoMatch: settings.autoMatch !== false,
    contextBudget: clampInteger(
      settings.contextBudget,
      defaults.contextBudget,
      MIN_SKILL_CONTEXT_BUDGET,
      MAX_SKILL_CONTEXT_BUDGET,
    ),
    maxAutoSkills: clampInteger(
      settings.maxAutoSkills,
      defaults.maxAutoSkills,
      1,
      8,
    ),
  }
}

export function normalizeAppData(data: AppData): AppData {
  const raw = data as AppData & {
    skills?: unknown
    skillSettings?: unknown
  }
  reserveRuntimeIds(data.providers)
  reserveRuntimeIds(data.conversations)
  reserveRuntimeIds(raw.skills)
  const skills = Array.isArray(raw.skills)
    ? raw.skills
        .map((skill) => normalizeSkill(skill))
        .filter((skill): skill is UserSkill => Boolean(skill))
    : []
  const conversations = normalizeConversations(data)
  const activeConversationId = conversations.some(
    (conversation) => conversation.id === data.preferences.activeConversationId,
  )
    ? data.preferences.activeConversationId
    : conversations[0]?.id
  const preferencesWithoutActiveConversationId = { ...data.preferences }
  delete preferencesWithoutActiveConversationId.activeConversationId

  return {
    ...data,
    conversations,
    skills,
    skillSettings: normalizeSkillSettings(raw.skillSettings),
    preferences: {
      ...preferencesWithoutActiveConversationId,
      chatContextMessageLimit: normalizeChatContextMessageLimit(
        data.preferences.chatContextMessageLimit,
      ),
      ...(activeConversationId ? { activeConversationId } : {}),
    },
  }
}
