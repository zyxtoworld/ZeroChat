import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import {
  MODAL_FOCUSABLE_SELECTOR,
  deriveModalFocusState,
  shouldUseSettingsFallbackReturnTarget,
} from './modalFocus'

interface ModalFocusControllerOptions {
  dangerPromptOpen: boolean
  guideVisible: boolean
  settingsOpen: boolean
  syncFirstConflictPromptOpen: boolean
}

interface ModalFocusController {
  allowSettingsReturnFocus: () => void
  hasActiveModal: () => boolean
  rememberSettingsReturnFocusTarget: (target: HTMLElement | null) => void
  suppressSettingsReturnFocus: () => void
}

function elementIsVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden'
  )
}

function canUseReturnFocusTarget(
  target: HTMLElement | null,
): target is HTMLElement {
  return Boolean(
    target &&
      target !== document.body &&
      document.contains(target) &&
      elementIsVisible(target) &&
      !target.closest('[inert]'),
  )
}

function visibleSettingsOpener(): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-settings-opener="true"]'),
    ).find((element) => elementIsVisible(element) && !element.closest('[inert]')) ??
    null
  )
}

function focusElement(target: HTMLElement | null): void {
  if (target) {
    window.requestAnimationFrame(() => {
      focusModalElement(target)
    })
  }
}

export function focusModalElement(target: HTMLElement | null): boolean {
  if (
    !target ||
    !document.contains(target) ||
    Boolean(target.closest('[inert]'))
  ) {
    return false
  }

  try {
    target.focus({ preventScroll: true })
    return true
  } catch {
    return false
  }
}

export function useModalFocusController({
  dangerPromptOpen,
  guideVisible,
  settingsOpen,
  syncFirstConflictPromptOpen,
}: ModalFocusControllerOptions): ModalFocusController {
  const modalReturnFocusRef = useRef<HTMLElement | null>(null)
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null)
  const settingsReturnFocusSuppressedRef = useRef(false)
  const activeModalKeyRef = useRef('')
  const modalState = useMemo(
    () =>
      deriveModalFocusState({
        dangerPromptOpen,
        guideVisible,
        settingsOpen,
        syncFirstConflictPromptOpen,
      }),
    [
      dangerPromptOpen,
      guideVisible,
      settingsOpen,
      syncFirstConflictPromptOpen,
    ],
  )

  const allowSettingsReturnFocus = useCallback((): void => {
    settingsReturnFocusSuppressedRef.current = false
  }, [])

  const rememberSettingsReturnFocusTarget = useCallback(
    (target: HTMLElement | null): void => {
      modalReturnFocusRef.current = target
      settingsReturnFocusRef.current = target
    },
    [],
  )

  const suppressSettingsReturnFocus = useCallback((): void => {
    modalReturnFocusRef.current = null
    settingsReturnFocusRef.current = null
    settingsReturnFocusSuppressedRef.current = true
  }, [])

  const hasActiveModal = useCallback(
    (): boolean => Boolean(activeModalKeyRef.current),
    [],
  )

  useEffect(() => {
    if (!modalState) {
      const closingModalKey = activeModalKeyRef.current
      const storedReturnTarget =
        modalReturnFocusRef.current ?? settingsReturnFocusRef.current
      const returnTarget = canUseReturnFocusTarget(storedReturnTarget)
        ? storedReturnTarget
        : shouldUseSettingsFallbackReturnTarget(
              closingModalKey,
              settingsReturnFocusSuppressedRef.current,
            )
          ? visibleSettingsOpener()
          : null

      activeModalKeyRef.current = ''
      modalReturnFocusRef.current = null
      settingsReturnFocusRef.current = null
      settingsReturnFocusSuppressedRef.current = false
      focusElement(returnTarget)
      return
    }

    const { key: modalKey, selector: modalSelector } = modalState

    if (!activeModalKeyRef.current && !modalReturnFocusRef.current) {
      modalReturnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    }

    activeModalKeyRef.current = modalKey

    const modalElement = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(modalSelector)

    const focusableElements = (): HTMLElement[] => {
      const modal = modalElement()

      if (!modal) {
        return []
      }

      return Array.from(
        modal.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR),
      ).filter(
        (element) => elementIsVisible(element) && !element.closest('[inert]'),
      )
    }

    const handleTabKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Tab') {
        return
      }

      const modal = modalElement()

      if (!modal) {
        return
      }

      const focusable = focusableElements()

      if (!focusable.length) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement

      if (!(activeElement instanceof HTMLElement) || !modal.contains(activeElement)) {
        event.preventDefault()
        focusModalElement(first)
        return
      }

      if (event.shiftKey && activeElement === first) {
        event.preventDefault()
        focusModalElement(last)
        return
      }

      if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        focusModalElement(first)
      }
    }

    document.addEventListener('keydown', handleTabKey)

    const animationFrame = window.requestAnimationFrame(() => {
      const modal = modalElement()
      const activeElement = document.activeElement

      if (
        !modal ||
        (activeElement instanceof HTMLElement && modal.contains(activeElement))
      ) {
        return
      }

      focusModalElement(
        modal.querySelector<HTMLElement>('[data-modal-initial-focus="true"]') ??
          modal,
      )
    })

    return () => {
      document.removeEventListener('keydown', handleTabKey)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [modalState])

  return {
    allowSettingsReturnFocus,
    hasActiveModal,
    rememberSettingsReturnFocusTarget,
    suppressSettingsReturnFocus,
  }
}
