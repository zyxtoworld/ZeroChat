import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react'
import { useStore } from 'zustand'

import { appUiStore } from '../state/store'
import {
  SIDEBAR_DOCKED_MEDIA_QUERY,
  deriveSidebarChrome,
} from './sidebarChrome'
import { scheduleInteractionFocus } from './interactionFocus'

interface SidebarControllerOptions {
  modalOpen: boolean
}

export interface SidebarController {
  chatPaneHiddenFromAssistiveTech: boolean
  closeSidebar: (restoreFocus?: boolean) => void
  mobileSidebarOpen: boolean
  openSidebar: (openedByPointer?: boolean) => void
  sidebarCloseButtonRef: RefObject<HTMLButtonElement | null>
  sidebarDocked: boolean
  sidebarHiddenFromAssistiveTech: boolean
  sidebarInteractive: boolean
  sidebarOpen: boolean
  sidebarOpenButtonRef: RefObject<HTMLButtonElement | null>
  sidebarOpenedByPointer: boolean
  sidebarTabIndex: number | undefined
}

export function useSidebarController({
  modalOpen,
}: SidebarControllerOptions): SidebarController {
  const sidebarOpen = useStore(appUiStore, (state) => state.sidebarOpen)
  const sidebarOpenedByPointer = useStore(
    appUiStore,
    (state) => state.sidebarOpenedByPointer,
  )
  const sidebarDocked = useStore(appUiStore, (state) => state.sidebarDocked)
  const openSidebarState = useStore(appUiStore, (state) => state.openSidebarState)
  const closeSidebarState = useStore(
    appUiStore,
    (state) => state.closeSidebarState,
  )
  const setSidebarDockedState = useStore(
    appUiStore,
    (state) => state.setSidebarDockedState,
  )
  const sidebarOpenButtonRef = useRef<HTMLButtonElement | null>(null)
  const sidebarCloseButtonRef = useRef<HTMLButtonElement | null>(null)
  const sidebarReturnFocusRef = useRef<HTMLElement | null>(null)

  const openSidebar = useCallback(
    (openedByPointer = false) => {
      if (!sidebarDocked) {
        sidebarReturnFocusRef.current =
          sidebarOpenButtonRef.current ??
          (document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null)
      }

      openSidebarState(openedByPointer)
    },
    [openSidebarState, sidebarDocked],
  )

  const closeSidebar = useCallback(
    (restoreFocus = true) => {
      if (!restoreFocus) {
        sidebarReturnFocusRef.current = null
      } else if (!sidebarDocked && !sidebarReturnFocusRef.current) {
        sidebarReturnFocusRef.current = sidebarOpenButtonRef.current
      }

      closeSidebarState()
    },
    [closeSidebarState, sidebarDocked],
  )

  useEffect(() => {
    if (sidebarDocked) {
      sidebarReturnFocusRef.current = null
      return
    }

    if (sidebarOpen) {
      scheduleInteractionFocus(() => sidebarCloseButtonRef.current)
      return
    }

    const returnTarget = sidebarReturnFocusRef.current
    sidebarReturnFocusRef.current = null

    if (returnTarget) {
      scheduleInteractionFocus(() => returnTarget)
    }
  }, [sidebarDocked, sidebarOpen])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const sidebarDockedQuery = window.matchMedia(SIDEBAR_DOCKED_MEDIA_QUERY)
    const syncSidebarDocked = (matches: boolean): void => {
      setSidebarDockedState(matches)
    }
    const updateSidebarDocked = (event: MediaQueryListEvent): void => {
      syncSidebarDocked(event.matches)
    }

    syncSidebarDocked(sidebarDockedQuery.matches)
    sidebarDockedQuery.addEventListener('change', updateSidebarDocked)

    return () => {
      sidebarDockedQuery.removeEventListener('change', updateSidebarDocked)
    }
  }, [setSidebarDockedState])

  const chrome = useMemo(
    () =>
      deriveSidebarChrome({
        modalOpen,
        sidebarDocked,
        sidebarOpen,
      }),
    [modalOpen, sidebarDocked, sidebarOpen],
  )

  return {
    ...chrome,
    closeSidebar,
    openSidebar,
    sidebarCloseButtonRef,
    sidebarDocked,
    sidebarOpen,
    sidebarOpenButtonRef,
    sidebarOpenedByPointer,
  }
}
