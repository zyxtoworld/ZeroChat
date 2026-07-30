import { useCallback } from 'react'

import type { AppData } from '../types'
import { useChatModelMenuController } from './chatModelMenuController'
import type { DangerPrompt } from './dangerConfirmation'
import { useDangerConfirmationController } from './dangerConfirmationController'
import { useMessageContextMenuController } from './messageContextMenuController'
import { useModalFocusController } from './modalFocusController'
import { useSidebarController } from './sidebarController'

interface AppOverlayChromeOptions {
  dangerPromptOpen: boolean
  data: AppData | null
  guideOpen: boolean
  guideSuccessPending?: boolean
  settingsOpen: boolean
  syncFirstConflictPromptOpen: boolean
}

interface AppOverlayChromeState {
  guideVisible: boolean
  modalOpen: boolean
}

interface MobileSidebarDangerOptions {
  sidebarDocked: boolean
  sidebarOpen: boolean
}

interface AppInteractionControllerOptions {
  data: AppData | null
  guideOpen: boolean
  guideSuccessPending: boolean
  isWarningDismissed: (id: DangerPrompt['id']) => boolean
  onDismissWarning: (id: DangerPrompt['id']) => void
  settingsOpen: boolean
  syncFirstConflictPromptOpen: boolean
}

export function deriveAppOverlayChrome({
  dangerPromptOpen,
  data,
  guideOpen,
  guideSuccessPending = false,
  settingsOpen,
  syncFirstConflictPromptOpen,
}: AppOverlayChromeOptions): AppOverlayChromeState {
  const guideVisible = Boolean(
    data &&
      (!data.preferences.firstRunDone || guideOpen || guideSuccessPending),
  )

  return {
    guideVisible,
    modalOpen: Boolean(
      settingsOpen ||
        guideVisible ||
        dangerPromptOpen ||
        syncFirstConflictPromptOpen,
    ),
  }
}

export function shouldCloseMobileSidebarForDanger({
  sidebarDocked,
  sidebarOpen,
}: MobileSidebarDangerOptions): boolean {
  return sidebarOpen && !sidebarDocked
}

export function useAppInteractionController({
  data,
  guideOpen,
  guideSuccessPending,
  isWarningDismissed,
  onDismissWarning,
  settingsOpen,
  syncFirstConflictPromptOpen,
}: AppInteractionControllerOptions) {
  const messageContextMenu = useMessageContextMenuController()
  const chatModelMenu = useChatModelMenuController()
  const {
    cancelDangerPrompt,
    closeDangerPrompt,
    dangerPrompt,
    dangerSkipChecked,
    requestDangerConfirmation: requestDangerConfirmationBase,
    setDangerSkipChecked,
    showDangerPrompt,
  } = useDangerConfirmationController({
    isWarningDismissed,
    onDismissWarning,
  })
  const { guideVisible, modalOpen } = deriveAppOverlayChrome({
    dangerPromptOpen: Boolean(dangerPrompt),
    data,
    guideOpen,
    guideSuccessPending,
    settingsOpen,
    syncFirstConflictPromptOpen,
  })
  const modalFocus = useModalFocusController({
    dangerPromptOpen: Boolean(dangerPrompt),
    guideVisible,
    settingsOpen,
    syncFirstConflictPromptOpen,
  })
  const sidebar = useSidebarController({ modalOpen })
  const {
    closeSidebar,
    sidebarDocked,
    sidebarOpen,
    sidebarOpenButtonRef,
  } = sidebar
  const requestDangerConfirmation = useCallback(
    (prompt: DangerPrompt): Promise<boolean> => {
      const shouldCloseMobileSidebar = shouldCloseMobileSidebarForDanger({
        sidebarDocked,
        sidebarOpen,
      })

      if (shouldCloseMobileSidebar) {
        closeSidebar(false)
      }

      return requestDangerConfirmationBase(prompt, {
        returnFocusTarget: shouldCloseMobileSidebar
          ? sidebarOpenButtonRef.current
          : undefined,
      })
    },
    [
      closeSidebar,
      requestDangerConfirmationBase,
      sidebarDocked,
      sidebarOpen,
      sidebarOpenButtonRef,
    ],
  )

  return {
    ...messageContextMenu,
    ...chatModelMenu,
    ...modalFocus,
    ...sidebar,
    cancelDangerPrompt,
    closeDangerPrompt,
    dangerPrompt,
    dangerSkipChecked,
    guideVisible,
    modalOpen,
    requestDangerConfirmation,
    setDangerSkipChecked,
    showDangerPrompt,
  }
}
