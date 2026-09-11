export interface MessageEditState {
  id: string
  draft: string
}

export function reportMessageEditFailure(
  _error: unknown,
  translate: (key: 'toast.sendFailed') => string,
  notify: (message: string, tone: 'error') => void,
): void {
  console.error('[app] edited message submission failed')
  try {
    notify(translate('toast.sendFailed'), 'error')
  } catch {
    // A broken notification channel must not escape the edit event.
  }
}

export async function commitMessageEdit(
  editing: MessageEditState | null,
  onEdit: (messageId: string, content: string) => Promise<boolean>,
  clearEditing: () => void,
  onFailure: (error: unknown) => void,
): Promise<boolean> {
  if (!editing) return false

  const draft = editing.draft.trim()

  let accepted: boolean
  try {
    accepted = await onEdit(editing.id, draft)
  } catch (error) {
    try {
      onFailure(error)
    } catch {
      // The UI failure reporter is contained so the event boundary never rejects.
    }
    return false
  }
  if (!accepted) return false

  clearEditing()
  return true
}
