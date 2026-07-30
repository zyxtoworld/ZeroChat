import { useEffect } from 'react'

export type AppEscapeAction =
  | 'none'
  | 'danger'
  | 'sync-conflict'
  | 'guide'
  | 'settings'
  | 'sidebar'

interface AppEscapeState {
  firstRunDone: boolean
  guideOpen: boolean
  hasDangerModal: boolean
  hasDangerPrompt: boolean
  hasGuideModal: boolean
  hasSettingsModal: boolean
  settingsOpen: boolean
  sidebarOpen: boolean
  syncFirstConflictPromptOpen: boolean
}

interface AppEscapeControllerContext {
  cancelDangerPrompt: () => void
  clearNotice: () => void
  closeGuide: () => void
  closeSidebar: () => void
  dangerPromptOpen: boolean
  firstRunDone: boolean
  guideOpen: boolean
  setSettingsOpen: (open: boolean) => void
  setSyncFirstConflictPrompt: (open: null) => void
  settingsOpen: boolean
  sidebarOpen: boolean
  syncFirstConflictPromptOpen: boolean
}

type AppEscapeActionContext = Pick<
  AppEscapeControllerContext,
  | 'cancelDangerPrompt'
  | 'clearNotice'
  | 'closeGuide'
  | 'closeSidebar'
  | 'setSettingsOpen'
  | 'setSyncFirstConflictPrompt'
>

export function escapeActionForState({
  firstRunDone,
  guideOpen,
  hasDangerModal,
  hasDangerPrompt,
  hasGuideModal,
  hasSettingsModal,
  settingsOpen,
  sidebarOpen,
  syncFirstConflictPromptOpen,
}: AppEscapeState): AppEscapeAction {
  if (hasDangerPrompt || hasDangerModal) {
    return 'danger'
  }

  if (syncFirstConflictPromptOpen) {
    return 'sync-conflict'
  }

  if (firstRunDone && (guideOpen || hasGuideModal)) {
    return 'guide'
  }

  if (settingsOpen || hasSettingsModal) {
    return 'settings'
  }

  if (sidebarOpen) {
    return 'sidebar'
  }

  return 'none'
}

export function clearAppEscapeNotice(clearNotice: () => void): boolean {
  try {
    clearNotice()
    return true
  } catch {
    // Escape already committed the close action; notice cleanup is secondary.
    return false
  }
}

export function performAppEscapeAction(
  action: AppEscapeAction,
  {
    cancelDangerPrompt,
    clearNotice,
    closeGuide,
    closeSidebar,
    setSettingsOpen,
    setSyncFirstConflictPrompt,
  }: AppEscapeActionContext,
): void {
  if (action === 'danger') {
    cancelDangerPrompt()
    return
  }

  if (action === 'sync-conflict') {
    setSyncFirstConflictPrompt(null)
    return
  }

  if (action === 'guide') {
    closeGuide()
    return
  }

  if (action === 'settings') {
    setSettingsOpen(false)
    clearAppEscapeNotice(clearNotice)
    return
  }

  if (action === 'sidebar') {
    closeSidebar()
  }
}

export function useAppEscapeController({
  cancelDangerPrompt,
  clearNotice,
  closeGuide,
  closeSidebar,
  dangerPromptOpen,
  firstRunDone,
  guideOpen,
  setSettingsOpen,
  setSyncFirstConflictPrompt,
  settingsOpen,
  sidebarOpen,
  syncFirstConflictPromptOpen,
}: AppEscapeControllerContext): void {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      const action = escapeActionForState({
        firstRunDone,
        guideOpen,
        hasDangerModal: Boolean(document.querySelector('.danger-modal')),
        hasDangerPrompt: dangerPromptOpen,
        hasGuideModal: Boolean(document.querySelector('.guide-modal')),
        hasSettingsModal: Boolean(document.querySelector('.settings-modal')),
        settingsOpen,
        sidebarOpen,
        syncFirstConflictPromptOpen,
      })

      performAppEscapeAction(action, {
        cancelDangerPrompt,
        clearNotice,
        closeGuide,
        closeSidebar,
        setSettingsOpen,
        setSyncFirstConflictPrompt,
      })
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    cancelDangerPrompt,
    clearNotice,
    closeGuide,
    closeSidebar,
    dangerPromptOpen,
    firstRunDone,
    guideOpen,
    setSettingsOpen,
    setSyncFirstConflictPrompt,
    settingsOpen,
    sidebarOpen,
    syncFirstConflictPromptOpen,
  ])
}
