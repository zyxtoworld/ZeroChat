import { restoreInteractionFocusTarget } from '../services/interactionFocus'

interface ConversationModelFocusOptions {
  activeConversationId: string | undefined
  activeElement: Element | null
  body: HTMLElement | null
  currentRequestId: number
  requestConversationId: string
  requestId: number
  settingsOpen: boolean
  target: HTMLSelectElement | null
}

export function conversationModelFocusTarget({
  activeConversationId,
  activeElement,
  body,
  currentRequestId,
  requestConversationId,
  requestId,
  settingsOpen,
  target,
}: ConversationModelFocusOptions): HTMLSelectElement | null {
  if (
    currentRequestId !== requestId ||
    activeConversationId !== requestConversationId
  ) {
    return null
  }

  return restoreInteractionFocusTarget({
    activeElement,
    blocked: settingsOpen,
    body,
    target,
  })
}
