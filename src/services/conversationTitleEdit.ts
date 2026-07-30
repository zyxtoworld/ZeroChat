export type ConversationTitleEditKeyAction = 'cancel' | 'commit' | 'none'

export function conversationTitleEditIsActive(
  activeConversationId: string,
  editingConversationTitleId: string,
): boolean {
  return Boolean(
    activeConversationId &&
      editingConversationTitleId &&
      activeConversationId === editingConversationTitleId,
  )
}

export function conversationTitleEditKeyAction(
  key: string,
): ConversationTitleEditKeyAction {
  if (key === 'Enter') {
    return 'commit'
  }

  if (key === 'Escape') {
    return 'cancel'
  }

  return 'none'
}
