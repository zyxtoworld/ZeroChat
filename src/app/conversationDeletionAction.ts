export function reportConversationDeletionFailure(
  _error: unknown,
  translate: (key: 'settings.saveFailed') => string,
  notify: (message: string, tone: 'error') => void,
): void {
  console.error('[app] conversation deletion UI action failed')
  try {
    notify(translate('settings.saveFailed'), 'error')
  } catch {
    // A broken notification channel must not escape the deletion event.
  }
}

export async function runConversationDeletionAction(
  remove: () => Promise<boolean>,
  onFailure: (error: unknown) => void,
): Promise<boolean> {
  try {
    return await remove()
  } catch (error) {
    try {
      onFailure(error)
    } catch {
      // The UI failure reporter is contained so the event boundary never rejects.
    }
    return false
  }
}
