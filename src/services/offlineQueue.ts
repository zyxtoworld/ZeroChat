import type {
  AppData,
  ChatMessage,
  Conversation,
  OfflineReplayClaim,
  ProviderConfig,
  QueuedTextRequest,
} from '../types'
import { hasImageAttachment } from './imageAttachments'

export interface QueuedTextAssistant {
  conversation: Conversation
  assistant: ChatMessage
  assistantIndex: number
  prompt: ChatMessage
  request: QueuedTextRequest
}

export interface OrphanedQueuedTextAssistant {
  conversation: Conversation
  assistant: ChatMessage
}

export interface OfflineQueuedTextTurnOptions {
  conversation: Conversation
  providerId: string
  model: string
  content: string
  title: string
  userMessageId: string
  assistantMessageId: string
  createdAt: number
  queuedAssistantContent: string
}

export function appendOfflineQueuedTextTurn({
  conversation,
  providerId,
  model,
  content,
  title,
  userMessageId,
  assistantMessageId,
  createdAt,
  queuedAssistantContent,
}: OfflineQueuedTextTurnOptions): Conversation {
  const userMessage: ChatMessage = {
    id: userMessageId,
    role: 'user',
    content,
    createdAt,
    status: 'done',
  }
  const assistantMessage: ChatMessage = {
    id: assistantMessageId,
    role: 'assistant',
    content: queuedAssistantContent,
    createdAt,
    status: 'queued',
    queuedTextRequest: {
      providerId,
      model,
      promptMessageId: userMessageId,
    },
  }

  return {
    ...conversation,
    title,
    providerId,
    model,
    messages: [...conversation.messages, userMessage, assistantMessage],
  }
}

function isQueuedTextAssistant(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.status === 'queued' &&
    !hasImageAttachment(message)
  )
}

function promptForQueuedTextAssistant(
  conversation: Conversation,
  assistantIndex: number,
  request: QueuedTextRequest | undefined,
): ChatMessage | undefined {
  if (!request?.promptMessageId) {
    return undefined
  }

  return conversation.messages.slice(0, assistantIndex).find(
    (message) =>
      message.id === request.promptMessageId &&
      message.role === 'user' &&
      message.status !== 'streaming' &&
      !hasImageAttachment(message),
  )
}

export function findFirstQueuedTextAssistant(
  snapshot: AppData,
): QueuedTextAssistant | null {
  for (const conversation of snapshot.conversations) {
    for (const [assistantIndex, assistant] of conversation.messages.entries()) {
      if (!isQueuedTextAssistant(assistant)) {
        continue
      }

      const request = assistant.queuedTextRequest
      const prompt = promptForQueuedTextAssistant(
        conversation,
        assistantIndex,
        request,
      )

      if (prompt && request) {
        return {
          conversation,
          assistant,
          assistantIndex,
          prompt,
          request,
        }
      }
    }
  }

  return null
}

export function findFirstOrphanedQueuedTextAssistant(
  snapshot: AppData,
): OrphanedQueuedTextAssistant | null {
  for (const conversation of snapshot.conversations) {
    for (const [assistantIndex, assistant] of conversation.messages.entries()) {
      if (
        isQueuedTextAssistant(assistant) &&
        !promptForQueuedTextAssistant(
          conversation,
          assistantIndex,
          assistant.queuedTextRequest,
        )
      ) {
        return { conversation, assistant }
      }
    }
  }

  return null
}

export function removeOfflineQueuedTextTurn(
  conversation: Conversation,
  promptMessageId: string,
  assistantMessageId: string,
): Conversation {
  const assistant = conversation.messages.find(
    (message) => message.id === assistantMessageId,
  )

  if (
    assistant?.role !== 'assistant' ||
    assistant.status !== 'queued' ||
    assistant.queuedTextRequest?.promptMessageId !== promptMessageId
  ) {
    return conversation
  }

  return {
    ...conversation,
    messages: conversation.messages.filter(
      (message) =>
        message.id !== promptMessageId && message.id !== assistantMessageId,
    ),
  }
}

export function enabledProviderForQueuedText(
  snapshot: AppData,
  request: QueuedTextRequest,
): ProviderConfig | undefined {
  return snapshot.providers.find(
    (provider) => provider.id === request.providerId && provider.enabled,
  )
}

export function ownsOfflineReplayClaim(
  snapshot: AppData | null,
  conversationId: string,
  assistantId: string,
  claim: OfflineReplayClaim,
): boolean {
  const assistant = snapshot?.conversations
    .find((conversation) => conversation.id === conversationId)
    ?.messages.find((message) => message.id === assistantId)

  return (
    assistant?.status === 'streaming' &&
    assistant.offlineReplayClaim?.claimId === claim.claimId &&
    assistant.offlineReplayClaim.owner === claim.owner
  )
}

export function patchQueuedTextAssistant(
  message: ChatMessage,
  patch: Partial<ChatMessage>,
): ChatMessage {
  const updated = { ...message, ...patch }
  if (updated.offlineReplayClaim === undefined) {
    delete updated.offlineReplayClaim
  }

  if (updated.status === 'queued' || updated.status === 'streaming') {
    return updated
  }

  const terminal = { ...updated }
  delete terminal.queuedTextRequest
  delete terminal.offlineReplayClaim
  return terminal
}

export function updateQueuedTextAssistant(
  conversation: Conversation,
  assistantId: string,
  patch: Partial<ChatMessage>,
): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.id === assistantId
        ? patchQueuedTextAssistant(message, patch)
        : message,
    ),
  }
}

export function startQueuedTextAssistant(
  conversation: Conversation,
  assistantId: string,
  claim?: OfflineReplayClaim,
  generationId?: string,
): Conversation {
  return updateQueuedTextAssistant(conversation, assistantId, {
    content: '',
    status: 'streaming',
    error: undefined,
    ...(claim ? { offlineReplayClaim: claim } : {}),
    ...(generationId ? { generationId } : {}),
  })
}

export function completeQueuedTextAssistant(
  conversation: Conversation,
  assistantId: string,
  content: string,
): Conversation {
  return updateQueuedTextAssistant(conversation, assistantId, {
    content,
    status: 'done',
    error: undefined,
  })
}

export interface QueuedTextAssistantFailureOptions {
  aborted: boolean
  online: boolean
  assistantContent: string
  queuedContent: string
  stoppedContent: string
  errorContent: string
}

export function queuedTextAssistantFailurePatch({
  aborted,
  online,
  assistantContent,
  queuedContent,
  stoppedContent,
  errorContent,
}: QueuedTextAssistantFailureOptions): {
  patch: Partial<ChatMessage>
  shouldStayQueued: boolean
} {
  const shouldStayQueued = !aborted && !online
  const message = shouldStayQueued
    ? queuedContent
    : aborted
      ? stoppedContent
      : errorContent

  return {
    patch: {
      content: assistantContent || message,
      status: shouldStayQueued ? 'queued' : aborted ? 'done' : 'error',
      error: shouldStayQueued || aborted ? undefined : message,
    },
    shouldStayQueued,
  }
}
