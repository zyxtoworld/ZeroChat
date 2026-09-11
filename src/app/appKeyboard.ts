export type AppKeyboardAction = 'none' | 'blocked' | 'new-conversation'

interface AppKeyboardEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat: boolean
  defaultPrevented: boolean
}

interface PreventableKeyboardEvent {
  preventDefault: () => void
}

interface AppKeyboardState {
  settingsOpen: boolean
}

interface AppKeyboardActions {
  createNewConversation: () => void
}

export interface AppGlobalEventTarget {
  addEventListener: (type: string, listener: EventListener) => void
  removeEventListener: (type: string, listener: EventListener) => void
}

export interface AppGlobalListenerHandlers {
  onLanguageChange: () => void
  onKeyDown: (event: KeyboardEvent) => void
}

export function installAppGlobalListeners(
  target: AppGlobalEventTarget,
  handlers: AppGlobalListenerHandlers,
): () => void {
  const languageListener: EventListener = () => handlers.onLanguageChange()
  const keydownListener: EventListener = (event) =>
    handlers.onKeyDown(event as KeyboardEvent)
  const registered: Array<[string, EventListener]> = []

  const cleanup = () => {
    while (registered.length > 0) {
      const [type, listener] = registered.pop()!
      try {
        target.removeEventListener(type, listener)
      } catch {
        // Teardown can race an embedded document/window being destroyed.
      }
    }
  }

  try {
    target.addEventListener('languagechange', languageListener)
    registered.push(['languagechange', languageListener])
    target.addEventListener('keydown', keydownListener)
    registered.push(['keydown', keydownListener])
  } catch {
    cleanup()
  }

  return cleanup
}

export function appKeyboardActionForEvent(
  event: AppKeyboardEvent,
  state: AppKeyboardState,
): AppKeyboardAction {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.altKey ||
    event.shiftKey ||
    (!event.ctrlKey && !event.metaKey) ||
    event.key.toLowerCase() !== 'n'
  ) {
    return 'none'
  }

  return state.settingsOpen ? 'blocked' : 'new-conversation'
}

export function performAppKeyboardAction(
  action: AppKeyboardAction,
  event: PreventableKeyboardEvent,
  actions: AppKeyboardActions,
): boolean {
  if (action === 'none') return false

  event.preventDefault()
  if (action === 'new-conversation') actions.createNewConversation()
  return true
}
