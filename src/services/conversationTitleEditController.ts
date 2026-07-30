import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useStore } from 'zustand'

import { appUiStore } from '../state/store'
import {
  conversationTitleEditIsActive,
  conversationTitleEditKeyAction,
} from './conversationTitleEdit'

interface ConversationTitleEditControllerOptions {
  activeConversationId: string
  activeConversationTitle: string
  normalizeTitleDraft: (value: string) => string
  onCommitTitle: (conversationId: string, nextTitle: string) => unknown
}

interface ConversationTitleEditController {
  conversationTitleButtonRef: RefObject<HTMLButtonElement | null>
  conversationTitleDraft: string
  conversationTitleInputRef: RefObject<HTMLInputElement | null>
  editingConversationTitle: boolean
  handleConversationTitleBlur: () => void
  handleConversationTitleKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
  ) => void
  setConversationTitleDraft: (value: string) => void
  startConversationTitleEdit: () => void
}

interface ConversationTitleFocusOptions {
  select?: boolean
}

interface ImeKeyboardEventLike {
  isComposing?: boolean
  key: string
  keyCode?: number
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
  }
}

export function conversationTitleEditKeyActionForEvent(
  event: ImeKeyboardEventLike,
): ReturnType<typeof conversationTitleEditKeyAction> | null {
  if (
    event.isComposing ||
    event.nativeEvent?.isComposing ||
    event.keyCode === 229 ||
    event.nativeEvent?.keyCode === 229
  ) {
    return null
  }

  return conversationTitleEditKeyAction(event.key)
}

export function focusConversationTitleElement(
  element: (HTMLElement & { select?: () => void }) | null,
  options: ConversationTitleFocusOptions = {},
): boolean {
  if (!element) {
    return false
  }

  try {
    element.focus({ preventScroll: true })

    if (options.select && element.select) {
      element.select()
    }

    return true
  } catch {
    return false
  }
}

export function useConversationTitleEditController({
  activeConversationId,
  activeConversationTitle,
  normalizeTitleDraft,
  onCommitTitle,
}: ConversationTitleEditControllerOptions): ConversationTitleEditController {
  const editingConversationTitleId = useStore(
    appUiStore,
    (state) => state.editingConversationTitleId,
  )
  const conversationTitleDraft = useStore(
    appUiStore,
    (state) => state.conversationTitleDraft,
  )
  const clearConversationTitleEditState = useStore(
    appUiStore,
    (state) => state.clearConversationTitleEditState,
  )
  const setConversationTitleDraft = useStore(
    appUiStore,
    (state) => state.setConversationTitleDraftState,
  )
  const startConversationTitleEditState = useStore(
    appUiStore,
    (state) => state.startConversationTitleEditState,
  )
  const conversationTitleButtonRef = useRef<HTMLButtonElement | null>(null)
  const conversationTitleInputRef = useRef<HTMLInputElement | null>(null)
  const conversationTitleCancelledRef = useRef(false)
  const editingConversationTitle = conversationTitleEditIsActive(
    activeConversationId,
    editingConversationTitleId,
  )

  const focusConversationTitleButton = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusConversationTitleElement(conversationTitleButtonRef.current)
    })
  }, [])

  const startConversationTitleEdit = useCallback(() => {
    if (!activeConversationId) {
      return
    }

    conversationTitleCancelledRef.current = false
    startConversationTitleEditState(activeConversationId, activeConversationTitle)
  }, [
    activeConversationId,
    activeConversationTitle,
    startConversationTitleEditState,
  ])

  const cancelConversationTitleEdit = useCallback(() => {
    conversationTitleCancelledRef.current = true
    clearConversationTitleEditState(activeConversationTitle)
    focusConversationTitleButton()
  }, [
    activeConversationTitle,
    clearConversationTitleEditState,
    focusConversationTitleButton,
  ])

  const commitConversationTitleEdit = useCallback(
    (restoreFocus = false) => {
      if (conversationTitleCancelledRef.current) {
        conversationTitleCancelledRef.current = false
        clearConversationTitleEditState(activeConversationTitle)

        if (restoreFocus) {
          focusConversationTitleButton()
        }
        return
      }

      const nextTitle = normalizeTitleDraft(conversationTitleDraft)

      if (!activeConversationId || nextTitle === activeConversationTitle) {
        clearConversationTitleEditState(nextTitle)

        if (restoreFocus) {
          focusConversationTitleButton()
        }
        return
      }

      const saved = onCommitTitle(activeConversationId, nextTitle)

      if (!saved) {
        if (restoreFocus) {
          window.requestAnimationFrame(() => {
            focusConversationTitleElement(conversationTitleInputRef.current, {
              select: true,
            })
          })
        }
        return
      }

      clearConversationTitleEditState(nextTitle)

      if (restoreFocus) {
        focusConversationTitleButton()
      }
    },
    [
      activeConversationId,
      activeConversationTitle,
      clearConversationTitleEditState,
      conversationTitleDraft,
      focusConversationTitleButton,
      normalizeTitleDraft,
      onCommitTitle,
    ],
  )

  const handleConversationTitleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const action = conversationTitleEditKeyActionForEvent(event)

      if (action === 'commit') {
        event.preventDefault()
        commitConversationTitleEdit(true)
        return
      }

      if (action === 'cancel') {
        event.preventDefault()
        cancelConversationTitleEdit()
      }
    },
    [cancelConversationTitleEdit, commitConversationTitleEdit],
  )

  const handleConversationTitleBlur = useCallback(() => {
    commitConversationTitleEdit()
  }, [commitConversationTitleEdit])

  useEffect(() => {
    if (!editingConversationTitle) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      focusConversationTitleElement(conversationTitleInputRef.current, {
        select: true,
      })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [activeConversationId, editingConversationTitle])

  return {
    conversationTitleButtonRef,
    conversationTitleDraft,
    conversationTitleInputRef,
    editingConversationTitle,
    handleConversationTitleBlur,
    handleConversationTitleKeyDown,
    setConversationTitleDraft,
    startConversationTitleEdit,
  }
}
