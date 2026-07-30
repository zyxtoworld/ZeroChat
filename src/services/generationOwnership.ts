import type { AppData, ChatMessage } from '../types'
import type { LocalSaveCommitPrecondition } from './localSaveQueueController'

export interface GenerationIncarnation {
  conversationCreatedAt: number
  conversationId: string
  messageCreatedAt: number
  messageId: string
  messageRole: ChatMessage['role']
}

export interface GenerationCommitObservation {
  precondition: LocalSaveCommitPrecondition
  result: () => AppData | null | undefined
}

export const generationOwnership = {
  active: false,
}

export function captureGenerationIncarnation(
  snapshot: AppData | null,
  conversationId: string,
  messageId: string,
): GenerationIncarnation | null {
  const conversation = snapshot?.conversations.find(
    (candidate) => candidate.id === conversationId,
  )
  const message = conversation?.messages.find(
    (candidate) => candidate.id === messageId,
  )

  if (!conversation || !message) {
    return null
  }

  return {
    conversationCreatedAt: conversation.createdAt,
    conversationId,
    messageCreatedAt: message.createdAt,
    messageId,
    messageRole: message.role,
  }
}

export function generationIncarnationExists(
  snapshot: AppData | null,
  incarnation: GenerationIncarnation,
): boolean {
  const conversation = snapshot?.conversations.find(
    (candidate) =>
      candidate.id === incarnation.conversationId &&
      candidate.createdAt === incarnation.conversationCreatedAt,
  )
  const message = conversation?.messages.find(
    (candidate) => candidate.id === incarnation.messageId,
  )

  return Boolean(
    message &&
      message.createdAt === incarnation.messageCreatedAt &&
      message.role === incarnation.messageRole,
  )
}

export function updateGenerationMessage(
  snapshot: AppData,
  incarnation: GenerationIncarnation,
  updater: (message: ChatMessage) => ChatMessage,
): AppData {
  if (!generationIncarnationExists(snapshot, incarnation)) {
    return snapshot
  }

  return {
    ...snapshot,
    conversations: snapshot.conversations.map((conversation) =>
      conversation.id === incarnation.conversationId &&
      conversation.createdAt === incarnation.conversationCreatedAt
        ? {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === incarnation.messageId &&
              message.createdAt === incarnation.messageCreatedAt &&
              message.role === incarnation.messageRole
                ? updater(message)
                : message,
            ),
            updatedAt: Date.now(),
          }
        : conversation,
    ),
    updatedAt: Date.now(),
  }
}

export function observeGenerationCommit(
  incarnation: GenerationIncarnation,
): GenerationCommitObservation {
  let observed = false
  let committedSnapshot: AppData | null = null

  return {
    precondition: {
      isSatisfied: (snapshot) =>
        generationIncarnationExists(snapshot, incarnation),
      onOutcome: (snapshot) => {
        observed = true
        committedSnapshot = snapshot
      },
    },
    result: () => (observed ? committedSnapshot : undefined),
  }
}
