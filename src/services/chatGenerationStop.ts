import type { AppData } from '../types'

type StopStaleStreamingGenerationOptions = {
  data: AppData | null
  stoppedContent: string
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
  scheduleAutoSync: (snapshot: AppData, delay?: number) => void
  setSending: (sending: boolean) => void
  onSaveFailure: (messageId: string) => void
}

export function streamingGenerationMessageId(data: AppData | null): string | null {
  if (!data) {
    return null
  }

  for (const conversation of data.conversations) {
    const streamingMessage = conversation.messages.find(
      (message) => message.status === 'streaming',
    )

    if (streamingMessage) {
      return streamingMessage.id
    }
  }

  return null
}

export function stoppedStreamingGenerationData(
  data: AppData | null,
  stoppedContent: string,
): AppData | null {
  if (!data) {
    return null
  }

  let changed = false
  const conversations = data.conversations.map((conversation) => {
    let conversationChanged = false
    const messages = conversation.messages.map((message) => {
      if (message.status !== 'streaming') {
        return message
      }

      changed = true
      conversationChanged = true
      const stopped = {
        ...message,
        content: message.content || stoppedContent,
        status: 'done' as const,
        error: undefined,
      }
      delete stopped.queuedTextRequest
      delete stopped.offlineReplayClaim
      return stopped
    })

    return conversationChanged ? { ...conversation, messages } : conversation
  })

  return changed ? { ...data, conversations } : null
}

export function stopStaleStreamingGeneration(
  options: StopStaleStreamingGenerationOptions,
): boolean {
  const streamingMessageId = streamingGenerationMessageId(options.data)

  if (!streamingMessageId) {
    return false
  }

  const saved = options.updateData(
    (latest) =>
      stoppedStreamingGenerationData(latest, options.stoppedContent) ?? latest,
    { autoSync: false },
  )

  if (!saved) {
    options.onSaveFailure(streamingMessageId)
    return true
  }

  options.scheduleAutoSync(saved, 0)
  options.setSending(false)
  return true
}
