import type { AppData, ChatMessage, ProviderSecrets } from '../types'
import { rt } from '../i18n'
import { encryptObject } from './crypto'
import {
  INCREMENTAL_CHUNK_SIZE,
  type AttachmentContentChunk,
  type BuiltIncrementalUpload,
  type ConversationChunk,
  type IncrementalChunkRef,
  type IncrementalManifest,
  type IncrementalAttachmentRef,
  type IncrementalSkillRef,
  type PendingChunkUpload,
  type SkillContentChunk,
  attachmentChunkFingerprint,
  attachmentChunkObjectType,
  attachmentContentParts,
  chunkFingerprint,
  chunkObjectType,
  chunkUpdatedAt,
  emptyConversationMessages,
  emptySkillContent,
  objectKey,
  skillChunkFingerprint,
  skillChunkObjectType,
} from './syncIncrementalHelpers'
import {
  safeProviderImageAttachmentSource,
} from './imageAttachmentSafety'

export async function buildIncrementalUpload(
  data: AppData,
  secrets: ProviderSecrets,
  passphrase: string,
  remoteManifest: IncrementalManifest | null,
): Promise<BuiltIncrementalUpload> {
  const reusableChunks = new Map(
    remoteManifest?.chunks.map((chunk) => [chunk.fingerprint, chunk]) ?? [],
  )
  const reusableSkillChunks = new Map(
    remoteManifest?.skillChunks?.map((chunk) => [chunk.fingerprint, chunk]) ??
      [],
  )
  const reusableAttachmentChunks = new Map(
    remoteManifest?.attachmentChunks?.map((chunk) => [chunk.fingerprint, chunk]) ??
      [],
  )
  const chunks: PendingChunkUpload[] = []
  const refs: IncrementalChunkRef[] = []
  const skillRefs: IncrementalSkillRef[] = []
  const attachmentRefs: IncrementalAttachmentRef[] = []

  for (const conversation of data.conversations) {
    const messages: ChatMessage[] = []
    for (const message of conversation.messages) {
      const attachments: NonNullable<ChatMessage['attachments']> = []
      for (const attachment of message.attachments ?? []) {
        const source = safeProviderImageAttachmentSource(attachment)
        if (!source) {
          throw new Error(rt('error.remoteMessageChunkFormat'))
        }

        if (!source.startsWith('data:')) {
          attachments.push({
            ...attachment,
            dataUrl: undefined,
            url: source,
          })
          continue
        }
        const safeDataUrl = source

        const parts = attachmentContentParts(safeDataUrl)
        for (const [index, content] of parts.entries()) {
          const fingerprint = await attachmentChunkFingerprint(
            conversation.id,
            message.id,
            attachment.id,
            index,
            content,
          )
          const objectType = attachmentChunkObjectType(
            conversation.id,
            message.id,
            attachment.id,
            index,
          )
          const reusableCandidate = reusableAttachmentChunks.get(fingerprint)
          const reusable =
            reusableCandidate?.chunkCount === parts.length
              ? reusableCandidate
              : undefined
          const key = reusable?.key ?? objectKey('attachment')
          const updatedAt =
            reusable?.updatedAt ?? Math.max(1, attachment.createdAt)
          const ref: IncrementalAttachmentRef = {
            attachmentId: attachment.id,
            chunkCount: parts.length,
            conversationId: conversation.id,
            fingerprint,
            index,
            key,
            messageId: message.id,
            objectType,
            updatedAt,
          }
          attachmentRefs.push(ref)

          if (!reusable) {
            const chunk: AttachmentContentChunk = {
              attachmentId: attachment.id,
              chunkCount: parts.length,
              content,
              conversationId: conversation.id,
              fingerprint,
              index,
              kind: 'zerochat.attachmentChunk',
              messageId: message.id,
              updatedAt,
              version: 1,
            }
            chunks.push({
              key,
              envelope: await encryptObject(
                chunk,
                passphrase,
                objectType,
                updatedAt,
              ),
            })
          }
        }

        attachments.push({
          ...attachment,
          dataUrl: undefined,
          url: undefined,
        })
      }

      messages.push({
        ...message,
        ...(message.attachments ? { attachments } : {}),
      })
    }

    for (
      let index = 0;
      index < messages.length;
      index += INCREMENTAL_CHUNK_SIZE
    ) {
      const chunkIndex = Math.floor(index / INCREMENTAL_CHUNK_SIZE)
      const chunkMessages = messages.slice(
        index,
        index + INCREMENTAL_CHUNK_SIZE,
      )
      const updatedAt = chunkUpdatedAt(conversation, chunkMessages)
      const fingerprint = await chunkFingerprint(
        conversation.id,
        chunkIndex,
        chunkMessages,
        updatedAt,
      )
      const objectType = chunkObjectType(conversation.id, chunkIndex)
      const reusable = reusableChunks.get(fingerprint)
      const key = reusable?.key ?? objectKey('chunk')
      const ref: IncrementalChunkRef = {
        conversationId: conversation.id,
        index: chunkIndex,
        key,
        objectType,
        fingerprint,
        messageCount: chunkMessages.length,
        updatedAt,
      }

      refs.push(ref)

      if (!reusable) {
        const chunk: ConversationChunk = {
          kind: 'zerochat.conversationChunk',
          version: 1,
          conversationId: conversation.id,
          index: chunkIndex,
          messages: chunkMessages,
          updatedAt,
          fingerprint,
        }

        chunks.push({
          key,
          envelope: await encryptObject(
            chunk,
            passphrase,
            objectType,
            updatedAt,
          ),
        })
      }
    }
  }

  for (const skill of data.skills) {
    for (const skillChunk of skill.chunks) {
      const content = skillChunk.content?.trim()

      if (!content) {
        throw new Error(rt('error.skillContentMissing'))
      }

      const fingerprint = await skillChunkFingerprint(
        skill.id,
        skillChunk.id,
        content,
      )
      const objectType = skillChunkObjectType(skill.id, skillChunk.id)
      const reusable = reusableSkillChunks.get(fingerprint)
      const key = reusable?.key ?? objectKey('skill')
      const updatedAt = reusable?.updatedAt ?? skill.updatedAt
      const ref: IncrementalSkillRef = {
        skillId: skill.id,
        chunkId: skillChunk.id,
        key,
        objectType,
        fingerprint,
        updatedAt,
      }

      skillRefs.push(ref)

      if (!reusable) {
        const chunk: SkillContentChunk = {
          kind: 'zerochat.skillChunk',
          version: 1,
          skillId: skill.id,
          chunkId: skillChunk.id,
          content,
          updatedAt,
          fingerprint,
        }

        chunks.push({
          key,
          envelope: await encryptObject(
            chunk,
            passphrase,
            objectType,
            updatedAt,
          ),
        })
      }
    }
  }

  const manifest: IncrementalManifest = {
    kind: 'zerochat.incrementalManifest',
    version: 1,
    updatedAt: data.updatedAt,
    data: {
      ...data,
      conversations: data.conversations.map(emptyConversationMessages),
      skills: data.skills.map(emptySkillContent),
    },
    secrets,
    chunks: refs,
    skillChunks: skillRefs,
    attachmentChunks: attachmentRefs,
  }
  const manifestKey = objectKey('manifest')
  const manifestEnvelope = await encryptObject(
    manifest,
    passphrase,
    'manifest',
    manifest.updatedAt,
  )

  return {
    head: {
      kind: 'zerochat.incrementalHead',
      version: 1,
      manifestKey,
      updatedAt: manifest.updatedAt,
    },
    manifest,
    manifestEnvelope,
    chunks,
  }
}
