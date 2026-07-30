import type {
  AppData,
  ProviderSecrets,
  SyncVault,
} from '../types'
import { rt } from '../i18n'
import {
  decryptObject,
  encryptObject,
  isEncryptedObject,
} from './crypto'
import { mergeConcurrentAppData } from './concurrentAppDataMerge'
import { isSyncVaultShape } from './syncShared'
import {
  MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
  assertSyncTextSize,
} from './syncHttpBody'

const GIST_OPERATION_KIND = 'zerochat.gistOperation'
const GIST_OPERATION_OBJECT_TYPE = 'gist-operation-v2'
const GIST_CURSOR_VERSION = 1
const GIST_CURSOR_STORAGE_PREFIX = 'zerochat:gist-sync-cursor:v2:'
const operationIdPattern = /^[a-f0-9]{64}$/
const GIST_DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT = 24
const GIST_DEFAULT_SKILL_SETTINGS = {
  autoMatch: true,
  contextBudget: 2400,
  maxAutoSkills: 3,
} as const

type TombstoneKind =
  | 'conversation'
  | 'message'
  | 'provider'
  | 'provider-secret'
  | 'skill'

export interface GistTombstone {
  fingerprint: string
  id: string
  kind: TombstoneKind
  parentId?: string
}

interface GistStateOperationCore {
  kind: typeof GIST_OPERATION_KIND
  operation: 'state'
  parents: string[]
  tombstones: GistTombstone[]
  vault: SyncVault
  version: 2
}

interface GistClearOperationCore {
  kind: typeof GIST_OPERATION_KIND
  operation: 'clear'
  parents: string[]
  tombstones: []
  version: 2
}

type GistOperationCore = GistStateOperationCore | GistClearOperationCore

export type GistStateOperation = GistStateOperationCore & { id: string }
export type GistClearOperation = GistClearOperationCore & { id: string }
export type GistOperation = GistStateOperation | GistClearOperation

interface BaselineConversation {
  fingerprint: string
  messages: Record<string, string>
}

interface GistBaseline {
  conversations: Record<string, BaselineConversation>
  providerSecrets: Record<string, string>
  providers: Record<string, string>
  skills: Record<string, string>
}

interface GistCursor {
  baseline: GistBaseline
  heads: string[]
  localSyncAt: number
  version: typeof GIST_CURSOR_VERSION
}

export interface MaterializedGistOperations {
  heads: string[]
  tombstones: GistTombstone[]
  vault: SyncVault | null
}

const memoryCursors = new Map<string, string>()

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }

  if (!isPlainRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(compareCanonicalStrings)
      .map((key) => [key, stableValue(value[key])]),
  )
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return bytesToHex(new Uint8Array(digest))
}

async function fingerprint(value: unknown): Promise<string> {
  return sha256(stableStringify(value))
}

function normalizedParents(parents: readonly string[]): string[] {
  return [...new Set(parents)].sort(compareCanonicalStrings)
}

function tombstoneKey(tombstone: GistTombstone): string {
  return [
    tombstone.kind,
    tombstone.parentId ?? '',
    tombstone.id,
    tombstone.fingerprint,
  ].join('\u0000')
}

function normalizedTombstones(
  tombstones: readonly GistTombstone[],
): GistTombstone[] {
  const unique = new Map<string, GistTombstone>()

  for (const tombstone of tombstones) {
    unique.set(tombstoneKey(tombstone), tombstone)
  }

  return [...unique.values()].sort((left, right) =>
    compareCanonicalStrings(tombstoneKey(left), tombstoneKey(right)),
  )
}

function operationCore(operation: GistOperation): GistOperationCore {
  if (operation.operation === 'clear') {
    return {
      kind: GIST_OPERATION_KIND,
      version: 2,
      operation: 'clear',
      parents: normalizedParents(operation.parents),
      tombstones: [],
    }
  }

  return {
    kind: GIST_OPERATION_KIND,
    version: 2,
    operation: 'state',
    parents: normalizedParents(operation.parents),
    tombstones: normalizedTombstones(operation.tombstones),
    vault: normalizeGistVault(operation.vault),
  }
}

async function operationId(core: GistOperationCore): Promise<string> {
  return sha256(stableStringify(core))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value)
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  )
}

function isTombstone(value: unknown): value is GistTombstone {
  if (!isPlainRecord(value)) {
    return false
  }

  const kindValid =
    (value.kind === 'conversation' ||
      value.kind === 'message' ||
      value.kind === 'provider' ||
      value.kind === 'provider-secret' ||
      value.kind === 'skill')
  const parentValid = value.kind === 'message'
    ? typeof value.parentId === 'string' && value.parentId.length > 0
    : value.parentId === undefined
  const shapeValid = value.kind === 'message'
    ? hasExactKeys(value, ['kind', 'parentId', 'id', 'fingerprint'])
    : hasExactKeys(value, ['kind', 'id', 'fingerprint'])

  return (
    kindValid &&
    shapeValid &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.fingerprint === 'string' &&
    operationIdPattern.test(value.fingerprint) &&
    parentValid
  )
}

function isOperationShape(value: unknown): value is GistOperation {
  if (!isPlainRecord(value)) {
    return false
  }

  const shapeValid = value.operation === 'state'
    ? hasExactKeys(value, [
        'kind',
        'version',
        'operation',
        'parents',
        'tombstones',
        'vault',
        'id',
      ])
    : value.operation === 'clear'
      ? hasExactKeys(value, [
          'kind',
          'version',
          'operation',
          'parents',
          'tombstones',
          'id',
        ])
      : false

  if (
    !shapeValid ||
    value.kind !== GIST_OPERATION_KIND ||
    value.version !== 2 ||
    typeof value.id !== 'string' ||
    !operationIdPattern.test(value.id) ||
    !isStringArray(value.parents) ||
    !value.parents.every((parent) => operationIdPattern.test(parent)) ||
    new Set(value.parents).size !== value.parents.length ||
    !Array.isArray(value.tombstones) ||
    !value.tombstones.every(isTombstone)
  ) {
    return false
  }

  if (value.operation === 'clear') {
    return value.tombstones.length === 0
  }

  return value.operation === 'state' && normalizedGistVault(value.vault) !== null
}

export function gistOperationFilePrefix(fileName: string): string {
  return `${fileName}.zerochat-op-`
}

export function gistOperationFileName(fileName: string, id: string): string {
  return `${gistOperationFilePrefix(fileName)}${id}.json`
}

export function gistOperationIdFromFileName(
  fileName: string,
  candidate: string,
): string | null {
  const prefix = gistOperationFilePrefix(fileName)

  if (!candidate.startsWith(prefix) || !candidate.endsWith('.json')) {
    return null
  }

  const id = candidate.slice(prefix.length, -'.json'.length)
  return operationIdPattern.test(id) ? id : null
}

export function isManagedGistFile(fileName: string, candidate: string): boolean {
  return candidate === fileName || gistOperationIdFromFileName(fileName, candidate) !== null
}

function normalizeProvider(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value
  }

  const provider = { ...value }
  if (provider.clientRequestMode === false) {
    delete provider.clientRequestMode
  }
  if (provider.custom === false) {
    delete provider.custom
  }
  if (Array.isArray(provider.models) && provider.models.length === 0) {
    delete provider.models
  }
  if (Array.isArray(provider.capabilities) && provider.capabilities.length === 0) {
    delete provider.capabilities
  }
  return provider
}

function normalizeMessage(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value
  }

  const message = { ...value }
  if (message.status === 'done') {
    delete message.status
  }
  if (Array.isArray(message.attachments) && message.attachments.length === 0) {
    delete message.attachments
  }
  return message
}

function normalizeConversation(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value
  }

  return {
    ...value,
    ...(Array.isArray(value.messages)
      ? { messages: value.messages.map(normalizeMessage) }
      : {}),
  }
}

function normalizeSkillChunk(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value
  }

  const chunk = { ...value }
  if (chunk.content === '') {
    delete chunk.content
  }
  return chunk
}

function normalizeSkill(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value
  }

  return {
    ...value,
    ...(Array.isArray(value.chunks)
      ? { chunks: value.chunks.map(normalizeSkillChunk) }
      : {}),
  }
}

function normalizeGistVaultValue(value: unknown): unknown {
  if (!isPlainRecord(value) || !isPlainRecord(value.data)) {
    return value
  }

  const data = value.data
  const sync = isPlainRecord(data.sync) ? { ...data.sync } : data.sync
  const preferences = isPlainRecord(data.preferences)
    ? { ...data.preferences }
    : data.preferences

  if (isPlainRecord(sync)) {
    delete sync.gistId
    delete sync.gistFile
    delete sync.lastSyncAt
    delete sync.lastSyncStatus
    sync.encryptionEnabled = true
  }

  if (isPlainRecord(preferences)) {
    if (
      preferences.chatContextMessageLimit ===
      GIST_DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT
    ) {
      delete preferences.chatContextMessageLimit
    }
    if (
      Array.isArray(preferences.dismissedDangerWarnings) &&
      preferences.dismissedDangerWarnings.length === 0
    ) {
      delete preferences.dismissedDangerWarnings
    }
    if (
      Array.isArray(preferences.dismissedFeatureHints) &&
      preferences.dismissedFeatureHints.length === 0
    ) {
      delete preferences.dismissedFeatureHints
    }
  }

  const secrets = isPlainRecord(value.secrets)
    ? {
        ...value.secrets,
        ...(isPlainRecord(value.secrets.providerKeys)
          ? { providerKeys: { ...value.secrets.providerKeys } }
          : {}),
      }
    : value.secrets

  return {
    ...value,
    data: {
      ...data,
      ...(Array.isArray(data.providers)
        ? { providers: data.providers.map(normalizeProvider) }
        : {}),
      ...(Array.isArray(data.conversations)
        ? { conversations: data.conversations.map(normalizeConversation) }
        : {}),
      skills: Array.isArray(data.skills)
        ? data.skills.map(normalizeSkill)
        : data.skills === undefined
          ? []
          : data.skills,
      skillSettings:
        data.skillSettings === undefined
          ? { ...GIST_DEFAULT_SKILL_SETTINGS }
          : data.skillSettings,
      sync,
      preferences,
    },
    secrets,
  }
}

function normalizedGistVault(value: unknown): SyncVault | null {
  const normalized = normalizeGistVaultValue(value)
  return isSyncVaultShape(normalized) ? normalized : null
}

export function normalizeGistVault(vault: SyncVault): SyncVault {
  return normalizeGistVaultValue(vault) as SyncVault
}

export function gistVaultsEqual(left: SyncVault, right: SyncVault): boolean {
  return stableStringify(normalizeGistVault(left)) ===
    stableStringify(normalizeGistVault(right))
}

export async function createGistStateOperation(
  parents: readonly string[],
  vault: SyncVault,
  tombstones: readonly GistTombstone[],
): Promise<GistStateOperation> {
  const normalizedParentIds = normalizedParents(parents)
  const normalizedDeletionMarkers = normalizedTombstones(tombstones)

  if (
    !normalizedParentIds.every((parent) => operationIdPattern.test(parent)) ||
    !normalizedDeletionMarkers.every(isTombstone)
  ) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  const core: GistStateOperationCore = {
    kind: GIST_OPERATION_KIND,
    version: 2,
    operation: 'state',
    parents: normalizedParentIds,
    tombstones: normalizedDeletionMarkers,
    vault: normalizeGistVault(vault),
  }

  return {
    ...core,
    id: await operationId(core),
  }
}

export async function createGistClearOperation(
  parents: readonly string[],
): Promise<GistClearOperation> {
  const normalizedParentIds = normalizedParents(parents)

  if (!normalizedParentIds.every((parent) => operationIdPattern.test(parent))) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  const core: GistClearOperationCore = {
    kind: GIST_OPERATION_KIND,
    version: 2,
    operation: 'clear',
    parents: normalizedParentIds,
    tombstones: [],
  }

  return {
    ...core,
    id: await operationId(core),
  }
}

export async function serializeGistOperation(
  operation: GistOperation,
  passphrase: string,
  updatedAt: number,
): Promise<string> {
  const serialized = JSON.stringify(
    await encryptObject(
      operation,
      passphrase,
      GIST_OPERATION_OBJECT_TYPE,
      updatedAt,
    ),
    null,
    2,
  )
  assertSyncTextSize(
    serialized,
    MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
    'Encrypted Gist sync operation',
  )
  return serialized
}

export async function parseGistOperation(
  content: string,
  passphrase: string,
  expectedId: string,
): Promise<GistOperation> {
  assertSyncTextSize(
    content,
    MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
    'Encrypted Gist sync operation',
  )

  let envelope: unknown

  try {
    envelope = JSON.parse(content)
  } catch {
    throw new Error(rt('error.remoteDataInvalidJson'))
  }

  if (!isEncryptedObject(envelope)) {
    throw new Error(rt('error.remoteDataEncryptedOnly'))
  }

  const operation = await decryptObject<unknown>(
    envelope,
    passphrase,
    GIST_OPERATION_OBJECT_TYPE,
  )

  if (!isOperationShape(operation)) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  const normalizedOperation = operation.operation === 'state'
    ? {
        ...operation,
        vault: normalizedGistVault(operation.vault)!,
      }
    : operation

  const normalizedCore = operationCore(normalizedOperation)
  const computedId = await operationId(normalizedCore)

  if (normalizedOperation.id !== computedId || normalizedOperation.id !== expectedId) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  return {
    ...normalizedOperation,
    parents: normalizedCore.parents,
    tombstones: normalizedCore.tombstones,
    ...(normalizedOperation.operation === 'state'
      ? { vault: normalizeGistVault(normalizedOperation.vault) }
      : {}),
  } as GistOperation
}

function operationAncestors(
  id: string,
  operations: ReadonlyMap<string, GistOperation>,
  memo: Map<string, Set<string>>,
  visiting = new Set<string>(),
): Set<string> {
  const cached = memo.get(id)

  if (cached) {
    return cached
  }

  if (visiting.has(id)) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  visiting.add(id)
  const ancestors = new Set<string>([id])
  const operation = operations.get(id)

  for (const parent of operation?.parents ?? []) {
    if (!operations.has(parent)) {
      continue
    }

    for (const ancestor of operationAncestors(parent, operations, memo, visiting)) {
      ancestors.add(ancestor)
    }
  }

  visiting.delete(id)
  memo.set(id, ancestors)
  return ancestors
}

function activeOperationIds(
  ids: readonly string[],
  operations: ReadonlyMap<string, GistOperation>,
  ancestorMemo: Map<string, Set<string>>,
): string[] {
  const existing = [...new Set(ids)].filter((id) => operations.has(id)).sort()

  return existing.filter(
    (candidate) =>
      !existing.some(
        (other) =>
          other !== candidate &&
          operationAncestors(other, operations, ancestorMemo).has(candidate),
      ),
  )
}

function commonAncestorIds(
  ids: readonly string[],
  operations: ReadonlyMap<string, GistOperation>,
  ancestorMemo: Map<string, Set<string>>,
): string[] {
  const sets = ids.map((id) => operationAncestors(id, operations, ancestorMemo))

  if (sets.length === 0) {
    return []
  }

  const common = [...sets[0]!].filter((id) =>
    sets.slice(1).every((set) => set.has(id)),
  )

  return activeOperationIds(common, operations, ancestorMemo)
}

function valuesEqual(left: string | undefined, right: string | undefined): boolean {
  return left === right
}

function mergeProviderSecrets(
  base: ProviderSecrets | undefined,
  left: ProviderSecrets,
  right: ProviderSecrets,
): ProviderSecrets {
  const keys = new Set([
    ...Object.keys(base?.providerKeys ?? {}),
    ...Object.keys(left.providerKeys),
    ...Object.keys(right.providerKeys),
  ])
  const providerKeys: Record<string, string> = {}

  for (const key of keys) {
    const baseValue = base?.providerKeys[key]
    const leftValue = left.providerKeys[key]
    const rightValue = right.providerKeys[key]
    const value = valuesEqual(rightValue, baseValue)
      ? leftValue
      : valuesEqual(leftValue, baseValue) || valuesEqual(leftValue, rightValue)
        ? rightValue
        : rightValue

    if (value !== undefined) {
      providerKeys[key] = value
    }
  }

  return { providerKeys }
}

function mergeVaults(
  base: SyncVault | null,
  left: SyncVault,
  right: SyncVault,
): SyncVault {
  const data = mergeConcurrentAppData(
    base?.data ?? null,
    left.data,
    right.data,
    Math.max(left.data.updatedAt, right.data.updatedAt),
  )
  const secrets = mergeProviderSecrets(base?.secrets, left.secrets, right.secrets)

  return normalizeGistVault({
    data,
    secrets,
  })
}

function removeTombstonedRecords(
  vault: SyncVault,
  tombstones: readonly GistTombstone[],
): Promise<SyncVault> {
  return (async () => {
    const providerTombstones = new Map<string, GistTombstone[]>()
    const conversationTombstones = new Map<string, GistTombstone[]>()
    const skillTombstones = new Map<string, GistTombstone[]>()
    const messageTombstones = new Map<string, GistTombstone[]>()
    const secretTombstones = new Map<string, GistTombstone[]>()

    for (const tombstone of tombstones) {
      const target =
        tombstone.kind === 'provider'
          ? providerTombstones
          : tombstone.kind === 'conversation'
            ? conversationTombstones
            : tombstone.kind === 'skill'
              ? skillTombstones
              : tombstone.kind === 'message'
                ? messageTombstones
                : secretTombstones
      const key = tombstone.parentId
        ? `${tombstone.parentId}\u0000${tombstone.id}`
        : tombstone.id
      const current = target.get(key) ?? []
      current.push(tombstone)
      target.set(key, current)
    }

    const matches = async (
      value: unknown,
      candidates: readonly GistTombstone[] | undefined,
    ): Promise<boolean> => {
      if (!candidates?.length) {
        return false
      }

      const valueFingerprint = await fingerprint(value)
      return candidates.some(
        (candidate) => candidate.fingerprint === valueFingerprint,
      )
    }

    const providers = []
    for (const provider of vault.data.providers) {
      if (!(await matches(provider, providerTombstones.get(provider.id)))) {
        providers.push(provider)
      }
    }

    const conversations = []
    for (const conversation of vault.data.conversations) {
      if (
        await matches(
          conversation,
          conversationTombstones.get(conversation.id),
        )
      ) {
        continue
      }

      const messages = []
      for (const message of conversation.messages) {
        if (
          !(await matches(
            message,
            messageTombstones.get(`${conversation.id}\u0000${message.id}`),
          ))
        ) {
          messages.push(message)
        }
      }

      conversations.push({ ...conversation, messages })
    }

    const skills = []
    for (const skill of vault.data.skills) {
      if (!(await matches(skill, skillTombstones.get(skill.id)))) {
        skills.push(skill)
      }
    }

    const providerKeys: Record<string, string> = {}
    for (const [providerId, value] of Object.entries(vault.secrets.providerKeys)) {
      if (!(await matches(value, secretTombstones.get(providerId)))) {
        providerKeys[providerId] = value
      }
    }

    return normalizeGistVault({
      data: {
        ...vault.data,
        providers,
        conversations,
        skills,
      },
      secrets: { providerKeys },
    })
  })()
}

function tombstoneStillActive(vault: SyncVault, tombstone: GistTombstone): boolean {
  if (tombstone.kind === 'provider') {
    return !vault.data.providers.some((provider) => provider.id === tombstone.id)
  }

  if (tombstone.kind === 'conversation') {
    return !vault.data.conversations.some(
      (conversation) => conversation.id === tombstone.id,
    )
  }

  if (tombstone.kind === 'skill') {
    return !vault.data.skills.some((skill) => skill.id === tombstone.id)
  }

  if (tombstone.kind === 'provider-secret') {
    return vault.secrets.providerKeys[tombstone.id] === undefined
  }

  const conversation = vault.data.conversations.find(
    (item) => item.id === tombstone.parentId,
  )
  return !conversation?.messages.some((message) => message.id === tombstone.id)
}

export async function materializeGistOperations(
  operations: ReadonlyMap<string, GistOperation>,
): Promise<MaterializedGistOperations> {
  if (operations.size === 0) {
    return { heads: [], tombstones: [], vault: null }
  }

  const ancestorMemo = new Map<string, Set<string>>()
  const heads = activeOperationIds(
    [...operations.keys()],
    operations,
    ancestorMemo,
  )
  const materializedMemo = new Map<string, SyncVault | null>()
  const groupMemo = new Map<string, SyncVault | null>()

  const materializeGroup = async (ids: readonly string[]): Promise<SyncVault | null> => {
    const active = activeOperationIds(ids, operations, ancestorMemo)
    const key = active.join(',')
    const cached = groupMemo.get(key)

    if (cached !== undefined || groupMemo.has(key)) {
      return cached ?? null
    }

    if (active.length === 0) {
      groupMemo.set(key, null)
      return null
    }

    if (active.length === 1) {
      const id = active[0]!
      const memoized = materializedMemo.get(id)

      if (memoized !== undefined || materializedMemo.has(id)) {
        return memoized ?? null
      }

      const operation = operations.get(id)!
      const value =
        operation.operation === 'clear' ? null : normalizeGistVault(operation.vault)
      materializedMemo.set(id, value)
      groupMemo.set(key, value)
      return value
    }

    let merged: SyncVault | null = null
    const mergedIds: string[] = []

    for (const id of active) {
      const operation = operations.get(id)!
      const current =
        operation.operation === 'clear' ? null : normalizeGistVault(operation.vault)

      if (!current) {
        continue
      }

      if (!merged) {
        merged = current
        mergedIds.push(id)
        continue
      }

      const common = commonAncestorIds(
        [...mergedIds, id],
        operations,
        ancestorMemo,
      )
      const base = common.length > 0 ? await materializeGroup(common) : null
      merged = mergeVaults(base, merged, current)
      mergedIds.push(id)
    }

    groupMemo.set(key, merged)
    return merged
  }

  const stateHeads = heads.filter(
    (id) => operations.get(id)?.operation === 'state',
  )
  let vault = await materializeGroup(stateHeads)
  const tombstones = normalizedTombstones(
    stateHeads.flatMap((id) => {
      const operation = operations.get(id)
      return operation?.operation === 'state' ? operation.tombstones : []
    }),
  )

  if (vault) {
    vault = await removeTombstonedRecords(vault, tombstones)
  }

  return {
    heads,
    tombstones: vault
      ? tombstones.filter((tombstone) => tombstoneStillActive(vault!, tombstone))
      : [],
    vault,
  }
}

function storageKey(gistId: string, fileName: string): string {
  return `${GIST_CURSOR_STORAGE_PREFIX}${encodeURIComponent(gistId)}:${encodeURIComponent(fileName)}`
}

function readCursorValue(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key)
    }
  } catch {
    // The in-memory fallback preserves correctness for the current runtime.
  }

  return memoryCursors.get(key) ?? null
}

function writeCursorValue(key: string, value: string): void {
  memoryCursors.set(key, value)

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value)
    }
  } catch {
    // A storage quota failure degrades to conservative merge after reload.
  }
}

function deleteCursorValue(key: string): void {
  memoryCursors.delete(key)

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key)
    }
  } catch {
    // Best-effort local metadata cleanup only.
  }
}

function isFingerprintRecord(value: unknown): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every(
      (item) => typeof item === 'string' && operationIdPattern.test(item),
    )
  )
}

function isBaseline(value: unknown): value is GistBaseline {
  if (!isPlainRecord(value)) {
    return false
  }

  if (
    !isFingerprintRecord(value.providers) ||
    !isFingerprintRecord(value.skills) ||
    !isFingerprintRecord(value.providerSecrets) ||
    !isPlainRecord(value.conversations)
  ) {
    return false
  }

  return Object.values(value.conversations).every(
    (conversation) =>
      isPlainRecord(conversation) &&
      typeof conversation.fingerprint === 'string' &&
      operationIdPattern.test(conversation.fingerprint) &&
      isFingerprintRecord(conversation.messages),
  )
}

function isCursor(value: unknown): value is GistCursor {
  return (
    isPlainRecord(value) &&
    value.version === GIST_CURSOR_VERSION &&
    Number.isSafeInteger(value.localSyncAt) &&
    Number(value.localSyncAt) >= 0 &&
    isStringArray(value.heads) &&
    value.heads.every((head) => operationIdPattern.test(head)) &&
    new Set(value.heads).size === value.heads.length &&
    isBaseline(value.baseline)
  )
}

export function loadGistCursor(
  gistId: string,
  fileName: string,
  data: AppData,
): GistCursor | null {
  if (data.sync.lastSyncAt === undefined) {
    return null
  }

  const raw = readCursorValue(storageKey(gistId, fileName))

  if (!raw) {
    return null
  }

  try {
    const cursor: unknown = JSON.parse(raw)

    return isCursor(cursor) && cursor.localSyncAt === data.sync.lastSyncAt
      ? cursor
      : null
  } catch {
    return null
  }
}

async function recordFingerprints<T extends { id: string }>(
  values: readonly T[],
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      values.map(async (value) => [value.id, await fingerprint(value)] as const),
    ),
  )
}

async function createBaseline(vault: SyncVault): Promise<GistBaseline> {
  const normalizedVault = normalizeGistVault(vault)
  const conversations = Object.fromEntries(
    await Promise.all(
      normalizedVault.data.conversations.map(async (conversation) => [
        conversation.id,
        {
          fingerprint: await fingerprint(conversation),
          messages: await recordFingerprints(conversation.messages),
        },
      ] as const),
    ),
  )

  return {
    providers: await recordFingerprints(normalizedVault.data.providers),
    conversations,
    skills: await recordFingerprints(normalizedVault.data.skills),
    providerSecrets: Object.fromEntries(
      await Promise.all(
        Object.entries(normalizedVault.secrets.providerKeys).map(
          async ([providerId, value]) => [providerId, await fingerprint(value)] as const,
        ),
      ),
    ),
  }
}

export async function storeGistCursor(
  gistId: string,
  fileName: string,
  heads: readonly string[],
  localData: AppData,
  vault: SyncVault,
): Promise<void> {
  const localSyncAt = localData.sync.lastSyncAt

  if (localSyncAt === undefined) {
    return
  }

  const cursor: GistCursor = {
    version: GIST_CURSOR_VERSION,
    localSyncAt,
    heads: normalizedParents(heads),
    baseline: await createBaseline(vault),
  }

  writeCursorValue(storageKey(gistId, fileName), JSON.stringify(cursor))
}

export function clearGistCursor(gistId: string, fileName: string): void {
  deleteCursorValue(storageKey(gistId, fileName))
}

function missingTombstones(
  kind: Exclude<TombstoneKind, 'message'>,
  baseline: Record<string, string>,
  currentIds: ReadonlySet<string>,
): GistTombstone[] {
  return Object.entries(baseline)
    .filter(([id]) => !currentIds.has(id))
    .map(([id, valueFingerprint]) => ({
      kind,
      id,
      fingerprint: valueFingerprint,
    }))
}

export async function tombstonesFromCursor(
  cursor: GistCursor,
  vault: SyncVault,
): Promise<GistTombstone[]> {
  const providers = new Set(vault.data.providers.map((provider) => provider.id))
  const conversations = new Set(
    vault.data.conversations.map((conversation) => conversation.id),
  )
  const skills = new Set(vault.data.skills.map((skill) => skill.id))
  const providerSecrets = new Set(Object.keys(vault.secrets.providerKeys))
  const tombstones = [
    ...missingTombstones('provider', cursor.baseline.providers, providers),
    ...missingTombstones(
      'conversation',
      Object.fromEntries(
        Object.entries(cursor.baseline.conversations).map(([id, value]) => [
          id,
          value.fingerprint,
        ]),
      ),
      conversations,
    ),
    ...missingTombstones('skill', cursor.baseline.skills, skills),
    ...missingTombstones(
      'provider-secret',
      cursor.baseline.providerSecrets,
      providerSecrets,
    ),
  ]

  for (const conversation of vault.data.conversations) {
    const baseline = cursor.baseline.conversations[conversation.id]

    if (!baseline) {
      continue
    }

    const messageIds = new Set(conversation.messages.map((message) => message.id))
    for (const [id, messageFingerprint] of Object.entries(baseline.messages)) {
      if (!messageIds.has(id)) {
        tombstones.push({
          kind: 'message',
          parentId: conversation.id,
          id,
          fingerprint: messageFingerprint,
        })
      }
    }
  }

  return normalizedTombstones(tombstones)
}

export async function tombstonesBetweenVaults(
  baseline: SyncVault,
  current: SyncVault,
): Promise<GistTombstone[]> {
  const cursor: GistCursor = {
    version: GIST_CURSOR_VERSION,
    localSyncAt: 0,
    heads: [],
    baseline: await createBaseline(baseline),
  }

  return tombstonesFromCursor(cursor, current)
}
