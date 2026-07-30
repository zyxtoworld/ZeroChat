import type { RefObject } from 'react'
import {
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { useStore } from 'zustand'

import { appUiStore } from '../state/store'
import {
  CHAT_MODEL_MENU_ITEM_SELECTOR,
  defaultChatModelMenuExpandedProviderId,
  nextChatModelMenuExpandedProviderId,
  type ChatModelMenuProvider,
} from './chatModelMenu'
import {
  messageContextMenuNavigationIndex as chatModelMenuNavigationIndex,
} from './messageContextMenu'
import {
  focusInteractionElement,
  scheduleInteractionFocus,
} from './interactionFocus'
import type { ProviderConfig } from '../types'

interface ChatModelMenuController {
  chatModelMenuOpen: boolean
  chatModelMenuRef: RefObject<HTMLDivElement | null>
  chatModelTriggerRef: RefObject<HTMLButtonElement | null>
  closeChatModelMenu: (restoreFocus?: boolean) => void
  expandedChatProviderId: string
  selectChatModelMenuOption: (providerId: string) => void
  toggleChatModelMenu: (
    activeProvider: ChatModelMenuProvider | null,
    providers: readonly Pick<ProviderConfig, 'id'>[],
  ) => void
  toggleChatModelProviderExpanded: (
    providerId: string,
    expanded: boolean,
  ) => void
}

export function useChatModelMenuController(): ChatModelMenuController {
  const chatModelMenuOpen = useStore(
    appUiStore,
    (state) => state.chatModelMenuOpen,
  )
  const expandedChatProviderId = useStore(
    appUiStore,
    (state) => state.expandedChatProviderId,
  )
  const closeChatModelMenuState = useStore(
    appUiStore,
    (state) => state.closeChatModelMenuState,
  )
  const selectChatModelMenuOptionState = useStore(
    appUiStore,
    (state) => state.selectChatModelMenuOptionState,
  )
  const setExpandedChatProviderState = useStore(
    appUiStore,
    (state) => state.setExpandedChatProviderState,
  )
  const toggleChatModelMenuState = useStore(
    appUiStore,
    (state) => state.toggleChatModelMenuState,
  )
  const chatModelMenuRef = useRef<HTMLDivElement | null>(null)
  const chatModelTriggerRef = useRef<HTMLButtonElement | null>(null)

  const closeChatModelMenu = useCallback(
    (restoreFocus = false): void => {
      closeChatModelMenuState()

      if (!restoreFocus) {
        return
      }

      focusInteractionElement(chatModelTriggerRef.current)
    },
    [closeChatModelMenuState],
  )

  const toggleChatModelMenu = useCallback(
    (
      activeProvider: ChatModelMenuProvider | null,
      providers: readonly Pick<ProviderConfig, 'id'>[],
    ): void => {
      toggleChatModelMenuState(
        defaultChatModelMenuExpandedProviderId(activeProvider, providers),
      )
    },
    [toggleChatModelMenuState],
  )

  const toggleChatModelProviderExpanded = useCallback(
    (providerId: string, expanded: boolean): void => {
      setExpandedChatProviderState(
        nextChatModelMenuExpandedProviderId(providerId, expanded),
      )
    },
    [setExpandedChatProviderState],
  )

  const selectChatModelMenuOption = useCallback(
    (providerId: string): void => {
      selectChatModelMenuOptionState(providerId)
      closeChatModelMenu(true)
    },
    [closeChatModelMenu, selectChatModelMenuOptionState],
  )

  const handleChatModelMenuKeyDown = useCallback(
    (event: globalThis.KeyboardEvent): void => {
      const restoreFocus = event.key === 'Escape'
      if (restoreFocus || event.key === 'Tab') {
        if (restoreFocus) {
          event.preventDefault()
        }
        closeChatModelMenu(restoreFocus)
        return
      }

      const items = Array.from(
        chatModelMenuRef.current?.querySelectorAll<HTMLButtonElement>(
          CHAT_MODEL_MENU_ITEM_SELECTOR,
        ) ?? [],
      )

      const activeIndex = items.indexOf(
        document.activeElement as HTMLButtonElement,
      )
      const currentIndex = activeIndex >= 0 ? activeIndex : 0
      const nextIndex = chatModelMenuNavigationIndex(
        event.key,
        currentIndex,
        items.length,
      )

      if (nextIndex !== null) {
        event.preventDefault()
        focusInteractionElement(items[nextIndex])
      }
    },
    [closeChatModelMenu],
  )

  useEffect(() => {
    if (!chatModelMenuOpen) {
      return
    }

    scheduleInteractionFocus(() =>
      chatModelMenuRef.current?.querySelector<HTMLButtonElement>(
        CHAT_MODEL_MENU_ITEM_SELECTOR,
      ),
    )
    const menuRoot = chatModelMenuRef.current

    const handlePointerDown = (event: globalThis.MouseEvent): void => {
      const target = event.target

      if (
        target instanceof Node &&
        chatModelMenuRef.current &&
        !chatModelMenuRef.current.contains(target)
      ) {
        closeChatModelMenu()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    menuRoot?.addEventListener('keydown', handleChatModelMenuKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      menuRoot?.removeEventListener('keydown', handleChatModelMenuKeyDown)
    }
  }, [
    chatModelMenuOpen,
    closeChatModelMenu,
    handleChatModelMenuKeyDown,
  ])

  return {
    chatModelMenuOpen,
    chatModelMenuRef,
    chatModelTriggerRef,
    closeChatModelMenu,
    expandedChatProviderId,
    selectChatModelMenuOption,
    toggleChatModelMenu,
    toggleChatModelProviderExpanded,
  }
}
