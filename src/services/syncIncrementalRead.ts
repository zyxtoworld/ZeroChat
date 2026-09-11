import type { SyncVault } from '../types'
import { rt } from '../i18n'
import { decryptObject } from './crypto'
import { safeImageAttachmentDataUrl } from './imageAttachmentSafety'
import { isChatMessageShape, isSyncVaultShape } from './syncShared'
import {
  attachmentChunkFingerprint,
  attachmentRefKey,
  type AttachmentContentChunk,
  chunkFingerprint,
  type ConversationChunk,
  type IncrementalAttachmentRef,
  type IncrementalChunkRef,
  type IncrementalManifest,
  type IncrementalSkillRef,
  type SkillContentChunk,
  hasValidIncrementalManifestReferences,
  skillChunkFingerprint,
  skillRefKey,
} from './syncIncrementalHelpers'
import { readIncrementalObject } from './syncIncrementalRemote'

async function readIncrementalAttachmentChunk(
  endpoint: string,
  token: string,
  passphrase: string,
  ref: IncrementalAttachmentRef,
  signal?: AbortSignal,
): Promise<string> {
  const envelope = await readIncrementalObject(endpoint, token, ref.key, signal)
  const chunk = await decryptObject<AttachmentContentChunk>(
    envelope,
    passphrase,
    ref.objectType,
  )
  const fingerprint =
    typeof chunk.content === 'string'
      ? await attachmentChunkFingerprint(
          ref.conversationId,
          ref.messageId,
          ref.attachmentId,
          ref.index,
          chunk.content,
        )
      : ''

  if (
    chunk.kind !== 'zerochat.attachmentChunk' ||
    chunk.version !== 1 ||
    chunk.conversationId !== ref.conversationId ||
    chunk.messageId !== ref.messageId ||
    chunk.attachmentId !== ref.attachmentId ||
    chunk.index !== ref.index ||
    chunk.chunkCount !== ref.chunkCount ||
    chunk.updatedAt !== ref.updatedAt ||
    chunk.fingerprint !== ref.fingerprint ||
    fingerprint !== ref.fingerprint ||
    typeof chunk.content !== 'string' ||
    chunk.content.length === 0
  ) {
    throw new Error(rt('error.remoteMessageChunkFormat'))
  }

  return chunk.content
}

async function readIncrementalSkillChunk(
  endpoint: string,
  token: string,
  passphrase: string,
  ref: IncrementalSkillRef,
  signal?: AbortSignal,
): Promise<string> {
  const envelope = await readIncrementalObject(endpoint, token, ref.key, signal)
  const chunk = await decryptObject<SkillContentChunk>(
    envelope,
    passphrase,
    ref.objectType,
  )
  const fingerprint =
    typeof chunk.content === 'string'
      ? await skillChunkFingerprint(ref.skillId, ref.chunkId, chunk.content)
      : ''

  if (
    chunk.kind !== 'zerochat.skillChunk' ||
    chunk.version !== 1 ||
    chunk.skillId !== ref.skillId ||
    chunk.chunkId !== ref.chunkId ||
    chunk.updatedAt !== ref.updatedAt ||
    chunk.fingerprint !== ref.fingerprint ||
    fingerprint !== ref.fingerprint ||
    typeof chunk.content !== 'string' ||
    chunk.content.length === 0
  ) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  return chunk.content
}

export async function manifestToVault(
  endpoint: string,
  token: string,
  passphrase: string,
  manifest: IncrementalManifest,
  signal?: AbortSignal,
): Promise<SyncVault> {
  if (!hasValidIncrementalManifestReferences(manifest)) {
    throw new Error(rt('error.remoteIncrementalManifestFormat'))
  }

  const refsByConversation = new Map<string, IncrementalChunkRef[]>()
  const refsBySkillChunk = new Map<string, IncrementalSkillRef>()
  const refsByAttachment = new Map<string, IncrementalAttachmentRef[]>()
  const consumedAttachmentRefs = new Set<string>()

  for (const ref of manifest.chunks) {
    const refs = refsByConversation.get(ref.conversationId) ?? []
    refs.push(ref)
    refsByConversation.set(ref.conversationId, refs)
  }

  for (const ref of manifest.skillChunks ?? []) {
    refsBySkillChunk.set(skillRefKey(ref.skillId, ref.chunkId), ref)
  }

  for (const ref of manifest.attachmentChunks ?? []) {
    const key = attachmentRefKey(
      ref.conversationId,
      ref.messageId,
      ref.attachmentId,
    )
    const refs = refsByAttachment.get(key) ?? []
    refs.push(ref)
    refsByAttachment.set(key, refs)
  }

  const conversations = await Promise.all(
    manifest.data.conversations.map(async (conversation) => {
      const refs = (refsByConversation.get(conversation.id) ?? []).sort(
        (left, right) => left.index - right.index,
      )
      const chunks = await Promise.all(
        refs.map(async (ref) => {
          const envelope = await readIncrementalObject(
            endpoint,
            token,
            ref.key,
            signal,
          )
          const chunk = await decryptObject<ConversationChunk>(
            envelope,
            passphrase,
            ref.objectType,
          )
          const fingerprint = Array.isArray(chunk.messages)
            ? await chunkFingerprint(
                ref.conversationId,
                ref.index,
                chunk.messages,
                chunk.updatedAt,
              )
            : ''

          if (
            chunk.kind !== 'zerochat.conversationChunk' ||
            chunk.version !== 1 ||
            chunk.conversationId !== ref.conversationId ||
            chunk.index !== ref.index ||
            chunk.updatedAt !== ref.updatedAt ||
            chunk.fingerprint !== ref.fingerprint ||
            fingerprint !== ref.fingerprint ||
            !Array.isArray(chunk.messages) ||
            chunk.messages.length !== ref.messageCount ||
            !chunk.messages.every((message) => isChatMessageShape(message))
          ) {
            throw new Error(rt('error.remoteMessageChunkFormat'))
          }

          return chunk
        }),
      )

      const messages = chunks.flatMap((chunk) => chunk.messages)
      const materializedMessages = await Promise.all(
        messages.map(async (message) => ({
          ...message,
          ...(message.attachments
            ? {
                attachments: await Promise.all(
                  message.attachments.map(async (attachment) => {
                    const key = attachmentRefKey(
                      conversation.id,
                      message.id,
                      attachment.id,
                    )
                    const refs = (refsByAttachment.get(key) ?? []).sort(
                      (left, right) => left.index - right.index,
                    )

                    if (refs.length === 0) {
                      return attachment
                    }
                    if (
                      attachment.dataUrl ||
                      refs.some(
                        (ref, index) =>
                          ref.index !== index ||
                          ref.chunkCount !== refs.length,
                      )
                    ) {
                      throw new Error(rt('error.remoteMessageChunkFormat'))
                    }

                    const dataUrl = (
                      await Promise.all(
                        refs.map((ref) =>
                          readIncrementalAttachmentChunk(
                            endpoint,
                            token,
                            passphrase,
                            ref,
                            signal,
                          ),
                        ),
                      )
                    ).join('')
                    const safeDataUrl = safeImageAttachmentDataUrl(dataUrl)
                    if (!safeDataUrl) {
                      throw new Error(rt('error.remoteMessageChunkFormat'))
                    }
                    consumedAttachmentRefs.add(key)

                    return {
                      ...attachment,
                      dataUrl: safeDataUrl.dataUrl,
                    }
                  }),
                ),
              }
            : {}),
        })),
      )

      return {
        ...conversation,
        messages: materializedMessages,
      }
    }),
  )

  const manifestSkills = Array.isArray(manifest.data.skills)
    ? manifest.data.skills
    : []
  const skills = await Promise.all(
    manifestSkills.map(async (skill) => ({
      ...skill,
      chunks: await Promise.all(
        skill.chunks.map(async (skillChunk) => {
          const ref = refsBySkillChunk.get(skillRefKey(skill.id, skillChunk.id))
          const content = ref
            ? await readIncrementalSkillChunk(
                endpoint,
                token,
                passphrase,
                ref,
                signal,
              )
            : skillChunk.content?.trim()

          if (!content) {
            throw new Error(rt('error.remoteDataBadFormat'))
          }

          return {
            id: skillChunk.id,
            heading: skillChunk.heading,
            content,
            keywords: skillChunk.keywords,
            tokenEstimate: skillChunk.tokenEstimate,
          }
        }),
      ),
    })),
  )

  if (consumedAttachmentRefs.size !== refsByAttachment.size) {
    throw new Error(rt('error.remoteMessageChunkFormat'))
  }

  const vault = {
    data: {
      ...manifest.data,
      conversations,
      skills,
    },
    secrets: {
      providerKeys: manifest.secrets?.providerKeys ?? {},
    },
  }

  if (!isSyncVaultShape(vault)) {
    throw new Error(rt('error.remoteDataBadFormat'))
  }

  return vault
}
