import type {
  AppData,
  Conversation,
  Preferences,
  ProviderConfig,
  ProviderSecrets,
  SkillSettings,
  SyncConfig,
  SyncVault,
  UserSkill,
} from '../types'
import { rt } from '../i18n'
import {
  defaultSkillSettings,
  normalizeChatContextMessageLimit,
} from './appData'

export type FirstSyncStrategy = 'ask' | 'use-local' | 'use-remote' | 'merge'

function compareUtf16CodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareUpdatedAtDescendingThenId(
  left: { id: string; updatedAt: number },
  right: { id: string; updatedAt: number },
): number {
  return (
    right.updatedAt - left.updatedAt ||
    compareUtf16CodeUnits(left.id, right.id)
  )
}

function mergeSyncConfig(remote: SyncConfig, local: SyncConfig): SyncConfig {
  return {
    mode: remote.mode ?? local.mode,
    autoSync: remote.autoSync ?? local.autoSync,
    encryptionEnabled: true,
    gistId: remote.gistId ?? local.gistId,
    gistFile: remote.gistFile ?? local.gistFile,
    workerEndpoint: remote.workerEndpoint ?? local.workerEndpoint,
    lastSyncAt: Date.now(),
    lastSyncStatus: rt('sync.status.remoteAccepted'),
  }
}

export function acceptRemoteVault(remote: SyncVault, local: AppData): SyncVault {
  return {
    data: {
      ...remote.data,
      sync: mergeSyncConfig(remote.data.sync, local.sync),
    },
    secrets: {
      providerKeys: remote.secrets?.providerKeys ?? {},
    },
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const trimmed = value?.trim()

    if (!trimmed || seen.has(trimmed)) {
      continue
    }

    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function mergeProvider(remote: ProviderConfig, local: ProviderConfig): ProviderConfig {
  const localIsNewer = local.updatedAt >= remote.updatedAt
  const base = localIsNewer ? local : remote
  const other = localIsNewer ? remote : local
  const models = uniqueStrings([
    ...(base.models ?? []),
    ...(other.models ?? []),
    base.model,
    other.model,
    base.imageModel,
    other.imageModel,
  ])
  const capabilities = uniqueStrings([
    ...(base.capabilities ?? []),
    ...(other.capabilities ?? []),
  ]) as ProviderConfig['capabilities']

  return {
    ...base,
    model: base.model || other.model,
    imageModel: base.imageModel || other.imageModel,
    models,
    capabilities,
    custom: Boolean(base.custom || other.custom) || undefined,
    createdAt: Math.min(base.createdAt, other.createdAt),
    updatedAt: Math.max(base.updatedAt, other.updatedAt),
  }
}

function mergeRecordsById<T extends { id: string; updatedAt: number }>(
  remoteItems: T[],
  localItems: T[],
  mergeSameId?: (remote: T, local: T) => T,
): T[] {
  const merged = new Map<string, T>()

  for (const item of remoteItems) {
    merged.set(item.id, item)
  }

  for (const item of localItems) {
    const existing = merged.get(item.id)

    if (!existing) {
      merged.set(item.id, item)
      continue
    }

    merged.set(
      item.id,
      mergeSameId
        ? mergeSameId(existing, item)
        : item.updatedAt >= existing.updatedAt
          ? item
          : existing,
    )
  }

  return Array.from(merged.values())
}

function mergeSkillSettings(
  remote: SkillSettings,
  local: SkillSettings,
): SkillSettings {
  const defaults = defaultSkillSettings()

  return {
    autoMatch:
      local.autoMatch !== defaults.autoMatch ? local.autoMatch : remote.autoMatch,
    contextBudget:
      local.contextBudget !== defaults.contextBudget
        ? local.contextBudget
        : remote.contextBudget,
    maxAutoSkills:
      local.maxAutoSkills !== defaults.maxAutoSkills
        ? local.maxAutoSkills
        : remote.maxAutoSkills,
  }
}

function mergePreferences(
  remote: Preferences,
  local: Preferences,
  conversations: Conversation[],
): Preferences {
  const conversationIds = new Set(conversations.map((conversation) => conversation.id))
  const activeConversationId = local.activeConversationId &&
    conversationIds.has(local.activeConversationId)
    ? local.activeConversationId
    : remote.activeConversationId &&
        conversationIds.has(remote.activeConversationId)
      ? remote.activeConversationId
      : undefined

  return {
    firstRunDone: local.firstRunDone || remote.firstRunDone,
    theme: local.theme !== 'system' ? local.theme : remote.theme,
    language: local.language !== 'system' ? local.language : remote.language,
    compactMode: local.compactMode || remote.compactMode,
    chatContextMessageLimit: normalizeChatContextMessageLimit(
      local.chatContextMessageLimit ?? remote.chatContextMessageLimit,
    ),
    activeConversationId,
    dismissedDangerWarnings: uniqueStrings([
      ...(remote.dismissedDangerWarnings ?? []),
      ...(local.dismissedDangerWarnings ?? []),
    ]) as Preferences['dismissedDangerWarnings'],
    dismissedFeatureHints: uniqueStrings([
      ...(remote.dismissedFeatureHints ?? []),
      ...(local.dismissedFeatureHints ?? []),
    ]) as Preferences['dismissedFeatureHints'],
  }
}

function mergeFirstSyncVault(
  remote: SyncVault,
  local: AppData,
  localSecrets: ProviderSecrets,
): SyncVault {
  const conversations = mergeRecordsById(
    remote.data.conversations,
    local.conversations,
  ).sort(compareUpdatedAtDescendingThenId)
  const providers = mergeRecordsById<ProviderConfig>(
    remote.data.providers,
    local.providers,
    mergeProvider,
  )
  const skills = mergeRecordsById<UserSkill>(
    remote.data.skills,
    local.skills,
  ).sort(compareUpdatedAtDescendingThenId)
  const now = Date.now()

  return {
    data: {
      version: 1,
      providers,
      conversations,
      skills,
      skillSettings: mergeSkillSettings(
        remote.data.skillSettings,
        local.skillSettings,
      ),
      sync: {
        ...local.sync,
        encryptionEnabled: true,
      },
      preferences: mergePreferences(remote.data.preferences, local.preferences, conversations),
      updatedAt: Math.max(remote.data.updatedAt, local.updatedAt, now),
    },
    secrets: {
      providerKeys: {
        ...(remote.secrets?.providerKeys ?? {}),
        ...localSecrets.providerKeys,
      },
    },
  }
}

function markMerged(data: AppData): AppData {
  return {
    ...data,
    sync: {
      ...data.sync,
      encryptionEnabled: true,
      lastSyncAt: Date.now(),
      lastSyncStatus: rt('sync.status.merged'),
    },
  }
}

export function prepareMergedFirstSyncVault(
  remote: SyncVault,
  local: AppData,
  localSecrets: ProviderSecrets,
): SyncVault {
  const merged = mergeFirstSyncVault(remote, local, localSecrets)

  return {
    ...merged,
    data: markMerged(merged.data),
  }
}

function hasLocalUserContent(data: AppData): boolean {
  const defaultSkills = defaultSkillSettings()

  return (
    data.conversations.some((conversation) => conversation.messages.length > 0) ||
    data.providers.length > 1 ||
    data.skills.length > 0 ||
    data.providers.some((provider) => provider.updatedAt !== provider.createdAt) ||
    data.skillSettings.autoMatch !== defaultSkills.autoMatch ||
    data.skillSettings.contextBudget !== defaultSkills.contextBudget ||
    data.skillSettings.maxAutoSkills !== defaultSkills.maxAutoSkills ||
    data.preferences.theme !== 'system' ||
    data.preferences.language !== 'system' ||
    data.preferences.compactMode
  )
}

export function shouldMergeFirstSync(
  local: AppData,
  firstSyncStrategy: FirstSyncStrategy | undefined,
): boolean {
  return (
    firstSyncStrategy === 'merge' &&
    !local.sync.lastSyncAt &&
    hasLocalUserContent(local)
  )
}

export function shouldAcceptRemoteUpdatedAt(
  remoteUpdatedAt: number,
  local: AppData,
  firstSyncStrategy: FirstSyncStrategy | undefined = 'ask',
): boolean {
  if (!local.sync.lastSyncAt && hasLocalUserContent(local)) {
    if (firstSyncStrategy === 'use-remote') {
      return true
    }

    if (firstSyncStrategy === 'use-local') {
      return false
    }

    throw new Error(rt('error.syncFirstSyncConflict'))
  }

  if (remoteUpdatedAt > local.updatedAt) {
    return true
  }

  return !local.sync.lastSyncAt && !hasLocalUserContent(local)
}

export function shouldAcceptRemoteVault(
  remote: SyncVault,
  local: AppData,
  firstSyncStrategy?: FirstSyncStrategy,
): boolean {
  return shouldAcceptRemoteUpdatedAt(
    remote.data.updatedAt,
    local,
    firstSyncStrategy,
  )
}
