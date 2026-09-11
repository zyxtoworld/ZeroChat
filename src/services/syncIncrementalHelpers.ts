import type {
  AppData,
  ChatMessage,
  Conversation,
  EncryptedObjectEnvelope,
  IncrementalSyncHead,
  ProviderSecrets,
  UserSkill,
  UserSkillChunk,
} from '../types'
import { isStringRecord } from './syncShared'

export const INCREMENTAL_CHUNK_SIZE = 60
export const INCREMENTAL_ATTACHMENT_CONTENT_CHARS = 1_500_000

const OBJECT_KEY_PATTERN = /^(manifest|chunk|skill|attachment)-[0-9a-f-]+\.json$/i
const SKILL_CHUNK_PREVIEW_CHARS = 180

export interface IncrementalChunkRef {
  conversationId: string
  index: number
  key: string
  objectType: string
  fingerprint: string
  messageCount: number
  updatedAt: number
}

export interface IncrementalSkillRef {
  skillId: string
  chunkId: string
  key: string
  objectType: string
  fingerprint: string
  updatedAt: number
}

export interface IncrementalAttachmentRef {
  conversationId: string
  messageId: string
  attachmentId: string
  index: number
  chunkCount: number
  key: string
  objectType: string
  fingerprint: string
  updatedAt: number
}

export interface IncrementalManifest {
  kind: 'zerochat.incrementalManifest'
  version: 1
  updatedAt: number
  data: AppData
  secrets: ProviderSecrets
  chunks: IncrementalChunkRef[]
  skillChunks?: IncrementalSkillRef[]
  attachmentChunks?: IncrementalAttachmentRef[]
}

export interface ConversationChunk {
  kind: 'zerochat.conversationChunk'
  version: 1
  conversationId: string
  index: number
  messages: ChatMessage[]
  updatedAt: number
  fingerprint: string
}

export interface SkillContentChunk {
  kind: 'zerochat.skillChunk'
  version: 1
  skillId: string
  chunkId: string
  content: string
  updatedAt: number
  fingerprint: string
}

export interface AttachmentContentChunk {
  kind: 'zerochat.attachmentChunk'
  version: 1
  conversationId: string
  messageId: string
  attachmentId: string
  index: number
  chunkCount: number
  content: string
  updatedAt: number
  fingerprint: string
}

export interface IncrementalRemoteState {
  head: IncrementalSyncHead
  manifest: IncrementalManifest
}

export interface PendingChunkUpload {
  key: string
  envelope: EncryptedObjectEnvelope
}

export interface BuiltIncrementalUpload {
  head: IncrementalSyncHead
  manifest: IncrementalManifest
  manifestEnvelope: EncryptedObjectEnvelope
  chunks: PendingChunkUpload[]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function addUniqueNonEmptyIdentity(
  identities: Set<string>,
  value: unknown,
): value is string {
  if (typeof value !== 'string' || value.length === 0 || identities.has(value)) {
    return false
  }

  identities.add(value)
  return true
}

export function isSafeObjectKey(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_KEY_PATTERN.test(value)
}

export function isIncrementalHead(value: unknown): value is IncrementalSyncHead {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as IncrementalSyncHead).kind === 'zerochat.incrementalHead' &&
    (value as IncrementalSyncHead).version === 1 &&
    isSafeObjectKey((value as IncrementalSyncHead).manifestKey) &&
    (value as IncrementalSyncHead).manifestKey.startsWith('manifest-') &&
    isSafeTimestamp((value as IncrementalSyncHead).updatedAt)
  )
}

function indexesAreContiguous(indexes: readonly number[]): boolean {
  return [...indexes]
    .sort((left, right) => left - right)
    .every((index, expected) => index === expected)
}

function isIncrementalChunkRef(value: unknown): value is IncrementalChunkRef {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const ref = value as IncrementalChunkRef

  return (
    typeof ref.conversationId === 'string' &&
    ref.conversationId.length > 0 &&
    Number.isSafeInteger(ref.index) &&
    ref.index >= 0 &&
    isSafeObjectKey(ref.key) &&
    ref.key.startsWith('chunk-') &&
    ref.objectType === chunkObjectType(ref.conversationId, ref.index) &&
    typeof ref.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/i.test(ref.fingerprint) &&
    Number.isSafeInteger(ref.messageCount) &&
    ref.messageCount >= 0 &&
    ref.messageCount <= INCREMENTAL_CHUNK_SIZE &&
    isSafeTimestamp(ref.updatedAt)
  )
}

function isIncrementalSkillRef(value: unknown): value is IncrementalSkillRef {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const ref = value as IncrementalSkillRef

  return (
    typeof ref.skillId === 'string' &&
    ref.skillId.length > 0 &&
    typeof ref.chunkId === 'string' &&
    ref.chunkId.length > 0 &&
    isSafeObjectKey(ref.key) &&
    ref.key.startsWith('skill-') &&
    ref.objectType === skillChunkObjectType(ref.skillId, ref.chunkId) &&
    typeof ref.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/i.test(ref.fingerprint) &&
    isSafeTimestamp(ref.updatedAt)
  )
}

function isIncrementalAttachmentRef(
  value: unknown,
): value is IncrementalAttachmentRef {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const ref = value as IncrementalAttachmentRef

  return (
    typeof ref.conversationId === 'string' &&
    ref.conversationId.length > 0 &&
    typeof ref.messageId === 'string' &&
    ref.messageId.length > 0 &&
    typeof ref.attachmentId === 'string' &&
    ref.attachmentId.length > 0 &&
    Number.isSafeInteger(ref.index) &&
    ref.index >= 0 &&
    Number.isSafeInteger(ref.chunkCount) &&
    ref.chunkCount > 0 &&
    ref.index < ref.chunkCount &&
    isSafeObjectKey(ref.key) &&
    ref.key.startsWith('attachment-') &&
    ref.objectType ===
      attachmentChunkObjectType(
        ref.conversationId,
        ref.messageId,
        ref.attachmentId,
        ref.index,
      ) &&
    typeof ref.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/i.test(ref.fingerprint) &&
    isSafeTimestamp(ref.updatedAt)
  )
}

export function hasValidIncrementalManifestReferences(
  value: unknown,
): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value.data)) {
    return false
  }

  const conversations = value.data.conversations
  const providers = value.data.providers
  const skills = value.data.skills
  const chunks = value.chunks
  const skillChunks = value.skillChunks
  const attachmentChunks = value.attachmentChunks
  const manifestUpdatedAt = value.updatedAt
  if (
    !isSafeTimestamp(manifestUpdatedAt) ||
    !Number.isSafeInteger(value.data.updatedAt) ||
    Number(value.data.updatedAt) < 0 ||
    value.data.updatedAt !== manifestUpdatedAt ||
    !Array.isArray(providers) ||
    !Array.isArray(conversations) ||
    !Array.isArray(skills) ||
    !Array.isArray(chunks) ||
    !chunks.every(isIncrementalChunkRef) ||
    (skillChunks !== undefined &&
      (!Array.isArray(skillChunks) ||
        !skillChunks.every(isIncrementalSkillRef))) ||
    (attachmentChunks !== undefined &&
      (!Array.isArray(attachmentChunks) ||
        !attachmentChunks.every(isIncrementalAttachmentRef)))
  ) {
    return false
  }

  const providerIds = new Set<string>()
  for (const provider of providers) {
    if (
      !isPlainRecord(provider) ||
      !addUniqueNonEmptyIdentity(providerIds, provider.id)
    ) {
      return false
    }
  }

  const conversationIds = new Set<string>()
  for (const conversation of conversations) {
    if (
      !isPlainRecord(conversation) ||
      !addUniqueNonEmptyIdentity(conversationIds, conversation.id)
    ) {
      return false
    }
  }

  const skillIds = new Set<string>()
  const skillChunkIds = new Set<string>()
  for (const skill of skills) {
    if (
      !isPlainRecord(skill) ||
      !Array.isArray(skill.chunks) ||
      !addUniqueNonEmptyIdentity(skillIds, skill.id)
    ) {
      return false
    }
    const skillChunkIdentityIds = new Set<string>()
    for (const chunk of skill.chunks) {
      if (
        !isPlainRecord(chunk) ||
        !addUniqueNonEmptyIdentity(skillChunkIdentityIds, chunk.id)
      ) {
        return false
      }
      const identity = skillRefKey(skill.id, chunk.id)
      if (skillChunkIds.has(identity)) {
        return false
      }
      skillChunkIds.add(identity)
    }
  }

  const objectKeys = new Set<string>()
  const conversationIndexes = new Map<string, number[]>()
  for (const ref of chunks) {
    if (
      !conversationIds.has(ref.conversationId) ||
      objectKeys.has(ref.key)
    ) {
      return false
    }
    objectKeys.add(ref.key)
    const indexes = conversationIndexes.get(ref.conversationId) ?? []
    indexes.push(ref.index)
    conversationIndexes.set(ref.conversationId, indexes)
  }

  if (
    [...conversationIndexes.values()].some(
      (indexes) => !indexesAreContiguous(indexes),
    )
  ) {
    return false
  }

  const skillReferences = new Set<string>()
  for (const ref of skillChunks ?? []) {
    const identity = skillRefKey(ref.skillId, ref.chunkId)
    if (
      !skillChunkIds.has(identity) ||
      skillReferences.has(identity) ||
      objectKeys.has(ref.key)
    ) {
      return false
    }
    skillReferences.add(identity)
    objectKeys.add(ref.key)
  }

  const attachmentIndexes = new Map<string, number[]>()
  const attachmentChunkCounts = new Map<string, number>()
  for (const ref of attachmentChunks ?? []) {
    if (
      !conversationIds.has(ref.conversationId) ||
      objectKeys.has(ref.key)
    ) {
      return false
    }
    objectKeys.add(ref.key)
    const identity = attachmentRefKey(
      ref.conversationId,
      ref.messageId,
      ref.attachmentId,
    )
    const previousCount = attachmentChunkCounts.get(identity)
    if (previousCount !== undefined && previousCount !== ref.chunkCount) {
      return false
    }
    attachmentChunkCounts.set(identity, ref.chunkCount)
    const indexes = attachmentIndexes.get(identity) ?? []
    indexes.push(ref.index)
    attachmentIndexes.set(identity, indexes)
  }

  for (const [identity, indexes] of attachmentIndexes) {
    if (
      attachmentChunkCounts.get(identity) !== indexes.length ||
      !indexesAreContiguous(indexes)
    ) {
      return false
    }
  }

  return true
}

export function isIncrementalManifest(value: unknown): value is IncrementalManifest {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const manifest = value as IncrementalManifest
  return (
    manifest.kind === 'zerochat.incrementalManifest' &&
    manifest.version === 1 &&
    isSafeTimestamp(manifest.updatedAt) &&
    isPlainRecord(manifest.data) &&
    manifest.data.version === 1 &&
    Array.isArray(manifest.data.providers) &&
    Array.isArray(manifest.data.conversations) &&
    Array.isArray(manifest.data.skills) &&
    isPlainRecord(manifest.secrets) &&
    isStringRecord(manifest.secrets.providerKeys) &&
    hasValidIncrementalManifestReferences(manifest)
  )
}

export function objectKey(
  prefix: 'manifest' | 'chunk' | 'skill' | 'attachment',
): string {
  return `${prefix}-${crypto.randomUUID()}.json`
}

export function chunkObjectType(conversationId: string, index: number): string {
  return `conversationChunk:${conversationId}:${index}`
}

export function skillChunkObjectType(skillId: string, chunkId: string): string {
  return `skillChunk:${skillId}:${chunkId}`
}

export function attachmentChunkObjectType(
  conversationId: string,
  messageId: string,
  attachmentId: string,
  index: number,
): string {
  return `attachmentChunk:${conversationId}:${messageId}:${attachmentId}:${index}`
}

export function attachmentRefKey(
  conversationId: string,
  messageId: string,
  attachmentId: string,
): string {
  return `${conversationId}\u0000${messageId}\u0000${attachmentId}`
}

export function attachmentContentParts(dataUrl: string): string[] {
  const parts: string[] = []
  for (
    let offset = 0;
    offset < dataUrl.length;
    offset += INCREMENTAL_ATTACHMENT_CONTENT_CHARS
  ) {
    parts.push(dataUrl.slice(offset, offset + INCREMENTAL_ATTACHMENT_CONTENT_CHARS))
  }
  return parts
}

export function emptyConversationMessages(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: [],
  }
}

function previewSkillContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, SKILL_CHUNK_PREVIEW_CHARS)
}

function emptySkillChunkContent(chunk: UserSkillChunk): UserSkillChunk {
  const content = chunk.content?.trim()
  const contentPreview =
    chunk.contentPreview?.trim() || (content ? previewSkillContent(content) : undefined)

  return {
    id: chunk.id,
    heading: chunk.heading,
    ...(contentPreview ? { contentPreview } : {}),
    keywords: chunk.keywords,
    tokenEstimate: chunk.tokenEstimate,
  }
}

export function emptySkillContent(skill: UserSkill): UserSkill {
  return {
    ...skill,
    chunks: skill.chunks.map(emptySkillChunkContent),
  }
}

export function chunkUpdatedAt(
  conversation: Conversation,
  messages: ChatMessage[],
): number {
  return Math.max(
    conversation.updatedAt,
    ...messages.map((message) => message.createdAt),
  )
}

export function skillRefKey(skillId: string, chunkId: string): string {
  return `${skillId}\u0000${chunkId}`
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function chunkFingerprint(
  conversationId: string,
  index: number,
  messages: ChatMessage[],
  updatedAt: number,
): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      conversationId,
      index,
      messages,
      updatedAt,
    }),
  )
}

export async function skillChunkFingerprint(
  skillId: string,
  chunkId: string,
  content: string,
): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      skillId,
      chunkId,
      content,
    }),
  )
}

export async function attachmentChunkFingerprint(
  conversationId: string,
  messageId: string,
  attachmentId: string,
  index: number,
  content: string,
): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      conversationId,
      messageId,
      attachmentId,
      index,
      content,
    }),
  )
}
