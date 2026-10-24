import type {
  AppData,
  ChatMessage,
  MessageAttachment,
  ProviderSecrets,
  SyncVault,
} from '../types'
import { rt } from '../i18n'
import type { FirstSyncStrategy } from './syncMerge'
import { safeProviderImageAttachmentSource } from './imageAttachmentSafety'

export { DEFAULT_GIST_FILE } from './syncDefaults'
export {
  assertRemoteWriteAllowed,
  isSyncRemoteWriteDeferredError,
  SyncRemoteWriteDeferredError,
} from './syncRemoteWriteGuard'

export interface SyncContext {
  encryptionPassphrase: string
  githubToken: string
  providerKeys: Record<string, string>
  allowPassphraseRotation?: boolean
  firstSyncStrategy?: FirstSyncStrategy
  signal?: AbortSignal
  shouldDeferRemoteWrite?: () => boolean
}

export function markSynced(data: AppData, message: string): AppData {
  return {
    ...data,
    sync: {
      ...data.sync,
      encryptionEnabled: true,
      lastSyncAt: Date.now(),
      lastSyncStatus: message,
    },
  }
}

export function isPassphraseDecryptionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.message === rt('error.crypto.badDecryption') ||
    error.message === rt('error.crypto.badIncrementalDecryption')
  )
}

export function markRemoteCleared(data: AppData, message: string): AppData {
  return {
    ...data,
    sync: {
      ...data.sync,
      encryptionEnabled: true,
      lastSyncAt: Date.now(),
      lastSyncStatus: message,
    },
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

function isSafeNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || isSafeNonNegativeInteger(value)
}

function isStringArray(value: unknown, requireNonEmpty = false): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) =>
      requireNonEmpty ? isNonEmptyString(entry) : typeof entry === 'string',
    )
  )
}

function hasUniqueIds<T extends { id: string }>(items: readonly T[]): boolean {
  const ids = new Set<string>()

  for (const item of items) {
    if (ids.has(item.id)) {
      return false
    }
    ids.add(item.id)
  }

  return true
}

const providerCapabilities = new Set([
  'chat',
  'vision',
  'tools',
  'image-generation',
  'image-editing',
  'audio',
  'realtime',
  'embeddings',
  'moderation',
  'video',
  'model-list',
])

function isUniqueNonEmptyStringArray(
  value: unknown,
  allowed?: ReadonlySet<string>,
): boolean {
  return (
    isStringArray(value, true) &&
    new Set(value).size === value.length &&
    (allowed === undefined || value.every((entry) => allowed.has(entry)))
  )
}

function isModelMetadataRecord(value: unknown): boolean {
  if (!isPlainRecord(value)) return false

  return (
    hasOnlyKeys(value, [
      'id',
      'displayName',
      'contextWindowTokens',
      'maxInputTokens',
      'maxOutputTokens',
      'capabilities',
      'source',
      'verifiedAt',
    ]) &&
    isNonEmptyString(value.id) &&
    isOptionalString(value.displayName) &&
    isOptionalNumber(value.contextWindowTokens) &&
    isOptionalNumber(value.maxInputTokens) &&
    isOptionalNumber(value.maxOutputTokens) &&
    (value.capabilities === undefined ||
      isUniqueNonEmptyStringArray(value.capabilities, providerCapabilities)) &&
    (value.source === 'models-dev' ||
      value.source === 'provider-api' ||
      value.source === 'provider-docs' ||
      value.source === 'manual' ||
      value.source === 'heuristic') &&
    isOptionalNumber(value.verifiedAt)
  )
}

function isModelMetadataMap(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    Object.values(value).every(isModelMetadataRecord)
  )
}

function isConversationContextCompaction(value: unknown): boolean {
  if (!isPlainRecord(value)) return false

  return (
    hasOnlyKeys(value, [
      'source',
      'summary',
      'items',
      'compactedThroughMessageId',
      'model',
      'inputTokens',
      'createdAt',
    ]) &&
    (value.source === 'remote-compaction' || value.source === 'local-summary') &&
    isOptionalString(value.summary) &&
    (value.items === undefined || Array.isArray(value.items)) &&
    isNonEmptyString(value.compactedThroughMessageId) &&
    isNonEmptyString(value.model) &&
    isOptionalNumber(value.inputTokens) &&
    isSafeNonNegativeInteger(value.createdAt)
  )
}

function isProviderShape(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    hasOnlyKeys(value, [
      'id',
      'name',
      'kind',
      'baseUrl',
      'proxyUrl',
      'clientRequestMode',
      'model',
      'imageModel',
      'audioSpeechModel',
      'audioTranscriptionModel',
      'embeddingModel',
      'moderationModel',
      'realtimeModel',
      'models',
      'modelMetadata',
      'capabilities',
      'enabled',
      'needsApiKey',
      'custom',
      'createdAt',
      'updatedAt',
    ]) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    (value.kind === 'openai-compatible' ||
      value.kind === 'openai-responses' ||
      value.kind === 'anthropic') &&
    isNonEmptyString(value.baseUrl) &&
    isOptionalString(value.proxyUrl) &&
    (value.clientRequestMode === undefined ||
      typeof value.clientRequestMode === 'boolean') &&
    typeof value.model === 'string' &&
    isOptionalString(value.imageModel) &&
    isOptionalString(value.audioSpeechModel) &&
    isOptionalString(value.audioTranscriptionModel) &&
    isOptionalString(value.embeddingModel) &&
    isOptionalString(value.moderationModel) &&
    (value.models === undefined || isUniqueNonEmptyStringArray(value.models)) &&
    (value.modelMetadata === undefined || isModelMetadataMap(value.modelMetadata)) &&
(value.capabilities === undefined ||
      isUniqueNonEmptyStringArray(value.capabilities, providerCapabilities)) &&
    typeof value.enabled === 'boolean' &&
    typeof value.needsApiKey === 'boolean' &&
    (value.custom === undefined || typeof value.custom === 'boolean') &&
    isSafeNonNegativeInteger(value.createdAt) &&
    isSafeNonNegativeInteger(value.updatedAt)
  )
}

function isMessageAttachmentShape(
  value: unknown,
  strict = false,
): value is MessageAttachment {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    hasOnlyKeys(value, [
      'id',
      'kind',
      'purpose',
      'mimeType',
      'dataUrl',
      'url',
      'alt',
      'model',
      'createdAt',
    ]) &&
    isNonEmptyString(value.id) &&
    value.kind === 'image' &&
    (value.purpose === undefined ||
      value.purpose === 'generated' ||
      value.purpose === 'source' ||
      value.purpose === 'mask') &&
    isNonEmptyString(value.mimeType) &&
    isOptionalString(value.dataUrl) &&
    isOptionalString(value.url) &&
    isOptionalString(value.alt) &&
    isOptionalString(value.model) &&
    isSafeNonNegativeInteger(value.createdAt) &&
    (!strict ||
      safeProviderImageAttachmentSource(
        value as unknown as MessageAttachment,
      ) !== '')
  )
}

export function isChatMessageShape(
  value: unknown,
  strict = false,
): value is ChatMessage {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    hasOnlyKeys(value, [
      'id',
      'role',
      'content',
      'createdAt',
      'generationId',
      'status',
      'error',
      'attachments',
      'queuedTextRequest',
      'offlineReplayClaim',
    ]) &&
    isNonEmptyString(value.id) &&
    (value.role === 'system' ||
      value.role === 'user' ||
      value.role === 'assistant') &&
    typeof value.content === 'string' &&
    isSafeNonNegativeInteger(value.createdAt) &&
    (value.generationId === undefined || isNonEmptyString(value.generationId)) &&
    (value.status === undefined ||
      value.status === 'queued' ||
      value.status === 'streaming' ||
      value.status === 'done' ||
      value.status === 'error') &&
    isOptionalString(value.error) &&
    (value.attachments === undefined ||
      (Array.isArray(value.attachments) &&
        value.attachments.every((attachment) =>
          isMessageAttachmentShape(attachment, strict),
        ))) &&
    (value.queuedTextRequest === undefined ||
      (isPlainRecord(value.queuedTextRequest) &&
        hasOnlyKeys(value.queuedTextRequest, [
          'providerId',
          'model',
          'promptMessageId',
        ]) &&
        isNonEmptyString(value.queuedTextRequest.providerId) &&
        isNonEmptyString(value.queuedTextRequest.model) &&
        (value.queuedTextRequest.promptMessageId === undefined ||
          isNonEmptyString(value.queuedTextRequest.promptMessageId)))) &&
    (value.offlineReplayClaim === undefined ||
      (isPlainRecord(value.offlineReplayClaim) &&
        hasOnlyKeys(value.offlineReplayClaim, ['claimId', 'owner']) &&
        isNonEmptyString(value.offlineReplayClaim.claimId) &&
        isNonEmptyString(value.offlineReplayClaim.owner)))
  )
}

function isConversationShape(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    hasOnlyKeys(value, [
      'id',
      'title',
      'providerId',
      'model',
      'messages',
      'contextCompaction',
      'createdAt',
      'updatedAt',
    ]) &&
    isNonEmptyString(value.id) &&
    typeof value.title === 'string' &&
    isNonEmptyString(value.providerId) &&
    typeof value.model === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every((message) => isChatMessageShape(message, true)) &&
    hasUniqueIds(value.messages as Array<{ id: string }>) &&
    (value.contextCompaction === undefined ||
      isConversationContextCompaction(value.contextCompaction)) &&
    isSafeNonNegativeInteger(value.createdAt) &&
    isSafeNonNegativeInteger(value.updatedAt)
  )
}

function isSkillChunkShape(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    hasOnlyKeys(value, [
      'id',
      'heading',
      'content',
      'contentRef',
      'contentPreview',
      'keywords',
      'tokenEstimate',
    ]) &&
    isNonEmptyString(value.id) &&
    typeof value.heading === 'string' &&
    (isNonEmptyString(value.content) || isNonEmptyString(value.contentRef)) &&
    isOptionalString(value.content) &&
    isOptionalString(value.contentRef) &&
    isOptionalString(value.contentPreview) &&
    isStringArray(value.keywords, true) &&
    Number.isSafeInteger(value.tokenEstimate) &&
    Number(value.tokenEstimate) >= 1
  )
}

function isSkillShape(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    hasOnlyKeys(value, [
      'id',
      'name',
      'description',
      'fileName',
      'contentType',
      'sourceSize',
      'contentHash',
      'keywords',
      'chunks',
      'fixed',
      'enabled',
      'autoMatch',
      'createdAt',
      'updatedAt',
    ]) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    typeof value.description === 'string' &&
    isOptionalString(value.fileName) &&
    (value.contentType === 'markdown' ||
      value.contentType === 'text' ||
      value.contentType === 'json') &&
    isSafeNonNegativeInteger(value.sourceSize) &&
    isNonEmptyString(value.contentHash) &&
    isStringArray(value.keywords, true) &&
    Array.isArray(value.chunks) &&
    value.chunks.length > 0 &&
    value.chunks.every(isSkillChunkShape) &&
    hasUniqueIds(value.chunks as Array<{ id: string }>) &&
    typeof value.fixed === 'boolean' &&
    typeof value.enabled === 'boolean' &&
    typeof value.autoMatch === 'boolean' &&
    isSafeNonNegativeInteger(value.createdAt) &&
    isSafeNonNegativeInteger(value.updatedAt)
  )
}

function isSyncConfigShape(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    (value.mode === 'local' ||
      value.mode === 'gist' ||
      value.mode === 'cloudflare') &&
    typeof value.autoSync === 'boolean' &&
    typeof value.encryptionEnabled === 'boolean' &&
    isOptionalString(value.gistId) &&
    isOptionalString(value.gistFile) &&
    isOptionalString(value.workerEndpoint) &&
    isOptionalNumber(value.lastSyncAt) &&
    isOptionalString(value.lastSyncStatus)
  )
}

function isSkillSettingsShape(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.autoMatch === 'boolean' &&
    Number.isSafeInteger(value.contextBudget) &&
    Number(value.contextBudget) >= 600 &&
    Number(value.contextBudget) <= 8000 &&
    Number.isSafeInteger(value.maxAutoSkills) &&
    Number(value.maxAutoSkills) >= 1 &&
    Number(value.maxAutoSkills) <= 8
  )
}

function isPreferencesShape(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.firstRunDone === 'boolean' &&
    (value.theme === 'system' || value.theme === 'light' || value.theme === 'dark') &&
    (value.language === 'system' ||
      value.language === 'zh-CN' ||
      value.language === 'en-US' ||
      value.language === 'es-ES' ||
      value.language === 'hi-IN' ||
      value.language === 'ar-SA' ||
      value.language === 'pt-BR' ||
      value.language === 'ru-RU' ||
      value.language === 'ja-JP' ||
      value.language === 'ko-KR' ||
      value.language === 'fr-FR') &&
    typeof value.compactMode === 'boolean' &&
    (value.chatContextMessageLimit === undefined ||
      (Number.isSafeInteger(value.chatContextMessageLimit) &&
        Number(value.chatContextMessageLimit) >= 4 &&
        Number(value.chatContextMessageLimit) <= 200)) &&
    isOptionalString(value.activeConversationId) &&
    (value.dismissedDangerWarnings === undefined ||
      isStringArray(value.dismissedDangerWarnings, true)) &&
    (value.dismissedFeatureHints === undefined ||
      isStringArray(value.dismissedFeatureHints, true))
  )
}

function isAppDataShape(value: unknown): value is AppData {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, [
      'version',
      'providers',
      'conversations',
      'skills',
      'skillSettings',
      'sync',
      'preferences',
      'updatedAt',
    ]) &&
    value.version === 1 &&
    Array.isArray(value.providers) &&
    value.providers.every(isProviderShape) &&
    hasUniqueIds(value.providers as Array<{ id: string }>) &&
    Array.isArray(value.conversations) &&
    value.conversations.every(isConversationShape) &&
    hasUniqueIds(value.conversations as Array<{ id: string }>) &&
    Array.isArray(value.skills) &&
    value.skills.every(isSkillShape) &&
    hasUniqueIds(value.skills) &&
    isSkillSettingsShape(value.skillSettings) &&
    isSyncConfigShape(value.sync) &&
    isPreferencesShape(value.preferences) &&
    isSafeNonNegativeInteger(value.updatedAt)
  )
}

export function isSyncVaultShape(value: unknown): value is SyncVault {
  return (
    isPlainRecord(value) &&
    isAppDataShape(value.data) &&
    isPlainRecord(value.secrets) &&
    isStringRecord(value.secrets.providerKeys)
  )
}

export async function parseRemoteVault(
  content: string | undefined,
  passphrase: string,
): Promise<SyncVault | null> {
  if (!content) {
    return null
  }

  const { MAX_SYNC_SNAPSHOT_BYTES, assertSyncTextSize } = await import(
    './syncHttpBody'
  )

  assertSyncTextSize(content, MAX_SYNC_SNAPSHOT_BYTES, 'Remote sync snapshot')

  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(rt('error.remoteDataInvalidJson'))
  }

  const { decryptVault, isEncryptedSnapshot } = await import('./crypto')

  if (isEncryptedSnapshot(parsed)) {
    const vault = await decryptVault(parsed, passphrase)

    if (!isSyncVaultShape(vault)) {
      throw new Error(rt('error.remoteDataBadFormat'))
    }

    return vault
  }

  throw new Error(rt('error.remoteDataEncryptedOnly'))
}

export async function serializeVault(
  data: AppData,
  secrets: ProviderSecrets,
  passphrase: string,
): Promise<string> {
  if (!isSyncVaultShape({ data, secrets })) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  const { MAX_SYNC_SNAPSHOT_BYTES, assertSyncTextSize } = await import(
    './syncHttpBody'
  )
  const { encryptVault } = await import('./crypto')

  const envelope = await encryptVault(
    {
      data,
      secrets,
    },
    passphrase,
  )

  const serialized = JSON.stringify(envelope, null, 2)
  assertSyncTextSize(serialized, MAX_SYNC_SNAPSHOT_BYTES, 'Encrypted sync snapshot')
  return serialized
}

export async function readError(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  const { readSyncError } = await import('./syncHttpBody')
  return readSyncError(response, signal)
}
