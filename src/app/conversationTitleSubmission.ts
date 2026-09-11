export interface ConversationTitleDraft {
  id: string
  draft: string
}

export function reportConversationTitleFailure(
  _error: unknown,
  translate: (key: 'settings.saveFailed') => string,
  notify: (message: string, tone: 'error') => void,
): void {
  console.error('[app] conversation rename failed')
  try {
    notify(translate('settings.saveFailed'), 'error')
  } catch {
    // A broken notification channel must not escape the title event boundary.
  }
}

export async function commitConversationTitle(
  editing: ConversationTitleDraft | null,
  rename: (id: string, title: string) => Promise<boolean>,
  close: () => void,
  onFailure: (error: unknown) => void,
): Promise<boolean> {
  if (!editing) return false

  let accepted: boolean
  try {
    accepted = await rename(editing.id, editing.draft)
  } catch (error) {
    try {
      onFailure(error)
    } catch {
      // The UI failure reporter is contained so the event boundary never rejects.
    }
    return false
  }
  if (!accepted) return false

  close()
  return true
}
