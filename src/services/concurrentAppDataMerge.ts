import type {
  AppData,
  ChatMessage,
  Conversation,
  MessageAttachment,
  OfflineReplayClaim,
  Preferences,
  ProviderConfig,
  UserSkill,
  UserSkillChunk,
} from '../types'

function compareUtf16CodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareCreatedAtThenId(
  left: { createdAt: number; id: string },
  right: { createdAt: number; id: string },
): number {
  return (
    left.createdAt - right.createdAt ||
    compareUtf16CodeUnits(left.id, right.id)
  )
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    )
  }

  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).filter(
    (key) => leftRecord[key] !== undefined,
  )
  const rightKeys = Object.keys(rightRecord).filter(
    (key) => rightRecord[key] !== undefined,
  )

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        valuesEqual(leftRecord[key], rightRecord[key]),
    )
  )
}

function validOfflineReplayClaim(
  claim: OfflineReplayClaim | undefined,
): OfflineReplayClaim | undefined {
  return claim &&
    typeof claim.claimId === 'string' &&
    claim.claimId.trim() &&
    typeof claim.owner === 'string' &&
    claim.owner.trim()
    ? claim
    : undefined
}

function offlineReplayClaimsEqual(
  left: OfflineReplayClaim | undefined,
  right: OfflineReplayClaim | undefined,
): boolean {
  return (
    left?.claimId === right?.claimId &&
    left?.owner === right?.owner
  )
}

function resolveOfflineReplayClaim(
  base: OfflineReplayClaim | undefined,
  remote: OfflineReplayClaim | undefined,
  local: OfflineReplayClaim | undefined,
): OfflineReplayClaim | undefined {
  const validBase = validOfflineReplayClaim(base)
  const validRemote = validOfflineReplayClaim(remote)
  const validLocal = validOfflineReplayClaim(local)

  if (offlineReplayClaimsEqual(validLocal, validBase)) {
    return validRemote
  }

  if (
    offlineReplayClaimsEqual(validRemote, validBase) ||
    offlineReplayClaimsEqual(validLocal, validRemote)
  ) {
    return validLocal
  }

  // Remote is the already-persisted branch, so its valid claim won the race.
  return validRemote ?? validLocal
}

function resolveValue<T>(
  base: T | undefined,
  remote: T | undefined,
  local: T | undefined,
  preferLocal: boolean,
): T | undefined {
  if (valuesEqual(local, base)) {
    return remote
  }

  if (valuesEqual(remote, base) || valuesEqual(local, remote)) {
    return local
  }

  return preferLocal ? local : remote
}

function mergeObjectFields<T extends object>(
  base: T | undefined,
  remote: T,
  local: T,
  preferLocal: boolean,
): T {
  const baseRecord = (base ?? {}) as Record<string, unknown>
  const remoteRecord = remote as Record<string, unknown>
  const localRecord = local as Record<string, unknown>
  const merged: Record<string, unknown> = {}
  const keys = new Set([
    ...Object.keys(baseRecord),
    ...Object.keys(remoteRecord),
    ...Object.keys(localRecord),
  ])

  for (const key of keys) {
    const value = resolveValue(
      baseRecord[key],
      remoteRecord[key],
      localRecord[key],
      preferLocal,
    )

    if (value !== undefined) {
      merged[key] = value
    }
  }

  return merged as T
}

function mergeStringSet(
  base: readonly string[] | undefined,
  remote: readonly string[] | undefined,
  local: readonly string[] | undefined,
  preferLocal: boolean,
): string[] {
  const baseSet = new Set(base ?? [])
  const remoteSet = new Set(remote ?? [])
  const localSet = new Set(local ?? [])
  const ordered = [...(local ?? []), ...(remote ?? []), ...(base ?? [])]
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of ordered) {
    if (seen.has(value)) {
      continue
    }

    seen.add(value)
    if (
      resolveValue(
        baseSet.has(value),
        remoteSet.has(value),
        localSet.has(value),
        preferLocal,
      )
    ) {
      result.push(value)
    }
  }

  return result
}

interface IdentifiedRecord {
  id: string
}

function recordMap<T extends IdentifiedRecord>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function orderedRecordIds<T extends IdentifiedRecord>(
  base: readonly T[],
  remote: readonly T[],
  local: readonly T[],
): string[] {
  return [...new Set([
    ...local.map((item) => item.id),
    ...remote.map((item) => item.id),
    ...base.map((item) => item.id),
  ])]
}

interface RecordMergePolicy<T> {
  deletionWins?: boolean
  sameIncarnation?: (left: T, right: T) => boolean
}

function mergeRecordList<T extends IdentifiedRecord>(
  baseItems: readonly T[],
  remoteItems: readonly T[],
  localItems: readonly T[],
  remoteBranchUpdatedAt: number,
  localBranchUpdatedAt: number,
  itemUpdatedAt: (item: T, branchUpdatedAt: number) => number,
  mergeSameId: (base: T | undefined, remote: T, local: T) => T,
  policy: RecordMergePolicy<T> = {},
): T[] {
  const baseById = recordMap(baseItems)
  const remoteById = recordMap(remoteItems)
  const localById = recordMap(localItems)
  const merged: T[] = []

  for (const id of orderedRecordIds(baseItems, remoteItems, localItems)) {
    const base = baseById.get(id)
    const remote = remoteById.get(id)
    const local = localById.get(id)

    if (!base) {
      if (remote && local) {
        if (
          policy.sameIncarnation &&
          !policy.sameIncarnation(remote, local)
        ) {
          merged.push(
            itemUpdatedAt(local, localBranchUpdatedAt) >=
              itemUpdatedAt(remote, remoteBranchUpdatedAt)
              ? local
              : remote,
          )
        } else {
          merged.push(mergeSameId(undefined, remote, local))
        }
      } else if (local ?? remote) {
        merged.push((local ?? remote) as T)
      }
      continue
    }

    if (!remote && !local) {
      continue
    }

    if (!remote && local) {
      if (policy.deletionWins) {
        continue
      }

      if (
        !valuesEqual(local, base) &&
        itemUpdatedAt(local, localBranchUpdatedAt) > remoteBranchUpdatedAt
      ) {
        merged.push(local)
      }
      continue
    }

    if (remote && !local) {
      if (policy.deletionWins) {
        continue
      }

      if (
        !valuesEqual(remote, base) &&
        itemUpdatedAt(remote, remoteBranchUpdatedAt) > localBranchUpdatedAt
      ) {
        merged.push(remote)
      }
      continue
    }

    if (remote && local) {
      if (
        policy.sameIncarnation &&
        (!policy.sameIncarnation(base, remote) ||
          !policy.sameIncarnation(base, local) ||
          !policy.sameIncarnation(remote, local))
      ) {
        const remoteReplaced = !policy.sameIncarnation(base, remote)
        const localReplaced = !policy.sameIncarnation(base, local)

        if (remoteReplaced !== localReplaced) {
          merged.push(remoteReplaced ? remote : local)
        } else {
          merged.push(
            itemUpdatedAt(local, localBranchUpdatedAt) >=
              itemUpdatedAt(remote, remoteBranchUpdatedAt)
              ? local
              : remote,
          )
        }
      } else {
        merged.push(mergeSameId(base, remote, local))
      }
    }
  }

  return merged
}

function mergeAttachments(
  base: readonly MessageAttachment[] | undefined,
  remote: readonly MessageAttachment[] | undefined,
  local: readonly MessageAttachment[] | undefined,
  remoteUpdatedAt: number,
  localUpdatedAt: number,
): MessageAttachment[] {
  const preferLocal = localUpdatedAt >= remoteUpdatedAt

  return mergeRecordList(
    base ?? [],
    remote ?? [],
    local ?? [],
    remoteUpdatedAt,
    localUpdatedAt,
    (attachment) => attachment.createdAt,
    (baseAttachment, remoteAttachment, localAttachment) =>
      mergeObjectFields(
        baseAttachment,
        remoteAttachment,
        localAttachment,
        preferLocal,
      ),
  ).sort(compareCreatedAtThenId)
}

function mergeMessage(
  base: ChatMessage | undefined,
  remote: ChatMessage,
  local: ChatMessage,
  remoteUpdatedAt: number,
  localUpdatedAt: number,
): ChatMessage {
  const preferLocal = localUpdatedAt >= remoteUpdatedAt
  const merged = mergeObjectFields(base, remote, local, preferLocal)
  const offlineReplayClaim = resolveOfflineReplayClaim(
    base?.offlineReplayClaim,
    remote.offlineReplayClaim,
    local.offlineReplayClaim,
  )
  const attachments = mergeAttachments(
    base?.attachments,
    remote.attachments,
    local.attachments,
    remoteUpdatedAt,
    localUpdatedAt,
  )

  const result: ChatMessage = {
    ...merged,
    id: local.id,
    createdAt: Math.min(remote.createdAt, local.createdAt),
    ...(attachments.length > 0 ? { attachments } : { attachments: undefined }),
  }

  if (
    result.role === 'assistant' &&
    result.status === 'streaming' &&
    offlineReplayClaim
  ) {
    result.offlineReplayClaim = offlineReplayClaim
  } else {
    delete result.offlineReplayClaim
  }

  return result
}

function mergeConversation(
  base: Conversation | undefined,
  remote: Conversation,
  local: Conversation,
): Conversation {
  const preferLocal = local.updatedAt >= remote.updatedAt
  const merged = mergeObjectFields(base, remote, local, preferLocal)
  const messages = mergeRecordList(
    base?.messages ?? [],
    remote.messages,
    local.messages,
    remote.updatedAt,
    local.updatedAt,
    (_message, branchUpdatedAt) => branchUpdatedAt,
    (baseMessage, remoteMessage, localMessage) =>
      mergeMessage(
        baseMessage,
        remoteMessage,
        localMessage,
        remote.updatedAt,
        local.updatedAt,
      ),
    {
      deletionWins: true,
      sameIncarnation: (left, right) =>
        left.createdAt === right.createdAt && left.role === right.role,
    },
  ).sort(compareCreatedAtThenId)

  return {
    ...merged,
    id: local.id,
    messages,
    createdAt: Math.min(remote.createdAt, local.createdAt),
    updatedAt: Math.max(remote.updatedAt, local.updatedAt),
  }
}

function mergeProvider(
  base: ProviderConfig | undefined,
  remote: ProviderConfig,
  local: ProviderConfig,
): ProviderConfig {
  const preferLocal = local.updatedAt >= remote.updatedAt
  const merged = mergeObjectFields(base, remote, local, preferLocal)
  const models = mergeStringSet(base?.models, remote.models, local.models, preferLocal)
  const capabilities = mergeStringSet(
    base?.capabilities,
    remote.capabilities,
    local.capabilities,
    preferLocal,
  )

  return {
    ...merged,
    id: local.id,
    ...(models.length > 0 ? { models } : { models: undefined }),
    ...(capabilities.length > 0
      ? { capabilities: capabilities as ProviderConfig['capabilities'] }
      : { capabilities: undefined }),
    createdAt: Math.min(remote.createdAt, local.createdAt),
    updatedAt: Math.max(remote.updatedAt, local.updatedAt),
  }
}

function mergeSkillChunk(
  base: UserSkillChunk | undefined,
  remote: UserSkillChunk,
  local: UserSkillChunk,
  preferLocal: boolean,
): UserSkillChunk {
  const merged = mergeObjectFields(base, remote, local, preferLocal)

  return {
    ...merged,
    id: local.id,
    keywords: mergeStringSet(
      base?.keywords,
      remote.keywords,
      local.keywords,
      preferLocal,
    ),
  }
}

function mergeSkill(
  base: UserSkill | undefined,
  remote: UserSkill,
  local: UserSkill,
): UserSkill {
  const preferLocal = local.updatedAt >= remote.updatedAt
  const merged = mergeObjectFields(base, remote, local, preferLocal)
  const chunks = mergeRecordList(
    base?.chunks ?? [],
    remote.chunks,
    local.chunks,
    remote.updatedAt,
    local.updatedAt,
    (_chunk, branchUpdatedAt) => branchUpdatedAt,
    (baseChunk, remoteChunk, localChunk) =>
      mergeSkillChunk(baseChunk, remoteChunk, localChunk, preferLocal),
  )

  return {
    ...merged,
    id: local.id,
    keywords: mergeStringSet(
      base?.keywords,
      remote.keywords,
      local.keywords,
      preferLocal,
    ),
    chunks,
    createdAt: Math.min(remote.createdAt, local.createdAt),
    updatedAt: Math.max(remote.updatedAt, local.updatedAt),
  }
}

function mergePreferences(
  base: Preferences | undefined,
  remote: Preferences,
  local: Preferences,
  preferLocal: boolean,
): Preferences {
  const merged = mergeObjectFields(base, remote, local, preferLocal)

  return {
    ...merged,
    dismissedDangerWarnings: mergeStringSet(
      base?.dismissedDangerWarnings,
      remote.dismissedDangerWarnings,
      local.dismissedDangerWarnings,
      preferLocal,
    ) as Preferences['dismissedDangerWarnings'],
    dismissedFeatureHints: mergeStringSet(
      base?.dismissedFeatureHints,
      remote.dismissedFeatureHints,
      local.dismissedFeatureHints,
      preferLocal,
    ) as Preferences['dismissedFeatureHints'],
  }
}

export function mergeConcurrentAppData(
  base: AppData | null,
  remote: AppData,
  local: AppData,
  mergedAt = Date.now(),
): AppData {
  const preferLocal = local.updatedAt >= remote.updatedAt
  let providers = mergeRecordList(
    base?.providers ?? [],
    remote.providers,
    local.providers,
    remote.updatedAt,
    local.updatedAt,
    (provider) => provider.updatedAt,
    mergeProvider,
  )
  let conversations = mergeRecordList(
    base?.conversations ?? [],
    remote.conversations,
    local.conversations,
    remote.updatedAt,
    local.updatedAt,
    (conversation) => conversation.updatedAt,
    mergeConversation,
    {
      deletionWins: true,
      sameIncarnation: (left, right) => left.createdAt === right.createdAt,
    },
  )
  const skills = mergeRecordList(
    base?.skills ?? [],
    remote.skills,
    local.skills,
    remote.updatedAt,
    local.updatedAt,
    (skill) => skill.updatedAt,
    mergeSkill,
  )

  if (providers.length === 0) {
    providers = [...(preferLocal ? local.providers : remote.providers)].slice(0, 1)
  }

  if (conversations.length === 0) {
    conversations = [
      ...(preferLocal ? local.conversations : remote.conversations),
    ].slice(0, 1)
  }

  const providerById = recordMap(providers)
  conversations = conversations.map((conversation) => {
    if (providerById.has(conversation.providerId)) {
      return conversation
    }

    const fallback = providers[0]
    return fallback
      ? {
          ...conversation,
          providerId: fallback.id,
          model: fallback.model,
          updatedAt: Math.max(conversation.updatedAt, mergedAt),
        }
      : conversation
  })

  const conversationIds = new Set(conversations.map((conversation) => conversation.id))
  const preferences = mergePreferences(
    base?.preferences,
    remote.preferences,
    local.preferences,
    preferLocal,
  )
  const activeConversationId = [
    preferences.activeConversationId,
    local.preferences.activeConversationId,
    remote.preferences.activeConversationId,
    conversations[0]?.id,
  ].find((id) => id !== undefined && conversationIds.has(id))

  return {
    version: 1,
    providers,
    conversations,
    skills,
    skillSettings: mergeObjectFields(
      base?.skillSettings,
      remote.skillSettings,
      local.skillSettings,
      preferLocal,
    ),
    sync: mergeObjectFields(base?.sync, remote.sync, local.sync, preferLocal),
    preferences: {
      ...preferences,
      ...(activeConversationId
        ? { activeConversationId }
        : { activeConversationId: undefined }),
    },
    updatedAt: Math.max(remote.updatedAt, local.updatedAt, mergedAt),
  }
}
