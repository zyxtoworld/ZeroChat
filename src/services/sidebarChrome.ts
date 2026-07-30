export const SIDEBAR_DOCKED_MEDIA_QUERY = '(min-width: 861px)'

interface SidebarChromeInput {
  modalOpen: boolean
  sidebarDocked: boolean
  sidebarOpen: boolean
}

export interface SidebarChromeState {
  chatPaneHiddenFromAssistiveTech: boolean
  mobileSidebarOpen: boolean
  sidebarHiddenFromAssistiveTech: boolean
  sidebarInteractive: boolean
  sidebarTabIndex: number | undefined
}

export function deriveSidebarChrome({
  modalOpen,
  sidebarDocked,
  sidebarOpen,
}: SidebarChromeInput): SidebarChromeState {
  const sidebarInteractive = sidebarDocked || sidebarOpen
  const mobileSidebarOpen = sidebarOpen && !sidebarDocked

  return {
    chatPaneHiddenFromAssistiveTech: modalOpen || mobileSidebarOpen,
    mobileSidebarOpen,
    sidebarHiddenFromAssistiveTech: !sidebarInteractive || modalOpen,
    sidebarInteractive,
    sidebarTabIndex: sidebarInteractive ? undefined : -1,
  }
}

export function initialSidebarDocked(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(SIDEBAR_DOCKED_MEDIA_QUERY).matches
  )
}
