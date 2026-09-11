export type AppEscapeAction = 'none' | 'settings' | 'sidebar'

interface AppEscapeState {
  settingsOpen: boolean
  sidebarOverlayOpen: boolean
}

interface AppEscapeActions {
  closeSettings: () => void
  closeSidebar: () => void
}

export function appEscapeActionForEvent(
  event: Pick<KeyboardEvent, 'defaultPrevented' | 'key'>,
  state: AppEscapeState,
): AppEscapeAction {
  if (event.key !== 'Escape' || event.defaultPrevented) return 'none'
  if (state.settingsOpen) return 'settings'
  if (state.sidebarOverlayOpen) return 'sidebar'
  return 'none'
}

export function performAppEscapeAction(
  action: AppEscapeAction,
  event: Pick<KeyboardEvent, 'preventDefault'>,
  actions: AppEscapeActions,
): boolean {
  if (action === 'none') return false
  event.preventDefault()
  if (action === 'settings') {
    actions.closeSettings()
  } else {
    actions.closeSidebar()
  }
  return true
}
