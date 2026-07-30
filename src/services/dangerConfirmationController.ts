import {
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { useStore } from 'zustand'

import { appUiStore } from '../state/store'
import {
  shouldBypassDangerConfirmation,
  shouldRememberDangerConfirmationSkip,
  type DangerPrompt,
} from './dangerConfirmation'

interface DangerConfirmationRequestOptions {
  returnFocusTarget?: HTMLElement | null
}

interface DangerConfirmationControllerOptions {
  isWarningDismissed: (id: DangerPrompt['id']) => boolean
  onDismissWarning: (id: DangerPrompt['id']) => void
}

interface DangerConfirmationController {
  cancelDangerPrompt: () => void
  closeDangerPrompt: (confirmed: boolean) => void
  dangerPrompt: DangerPrompt | null
  dangerSkipChecked: boolean
  requestDangerConfirmation: (
    prompt: DangerPrompt,
    options?: DangerConfirmationRequestOptions,
  ) => Promise<boolean>
  setDangerSkipChecked: (checked: boolean) => void
  showDangerPrompt: (
    prompt: DangerPrompt,
    options?: DangerConfirmationRequestOptions,
  ) => void
}

interface DangerReturnFocusServices {
  contains: (target: HTMLElement) => boolean
}

type DangerConfirmationResolver = (confirmed: boolean) => void

interface DangerConfirmationResolverRef {
  current: DangerConfirmationResolver | null
}

const defaultDangerReturnFocusServices: DangerReturnFocusServices = {
  contains: (target) => document.contains(target),
}

function currentActiveElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
}

export function focusDangerConfirmationReturnTarget(
  target: HTMLElement | null,
  services: DangerReturnFocusServices = defaultDangerReturnFocusServices,
): boolean {
  if (!target || !services.contains(target)) {
    return false
  }

  try {
    target.focus({ preventScroll: true })
    return true
  } catch {
    return false
  }
}

function restoreFocusTo(target: HTMLElement | null): void {
  if (!target) {
    return
  }

  window.requestAnimationFrame(() => {
    focusDangerConfirmationReturnTarget(target)
  })
}

export function replaceDangerConfirmationResolver(
  resolverRef: DangerConfirmationResolverRef,
  nextResolver: DangerConfirmationResolver | null,
  previousResult = false,
): void {
  const previousResolver = resolverRef.current
  resolverRef.current = nextResolver
  previousResolver?.(previousResult)
}

export function useDangerConfirmationController({
  isWarningDismissed,
  onDismissWarning,
}: DangerConfirmationControllerOptions): DangerConfirmationController {
  const dangerPrompt = useStore(appUiStore, (state) => state.dangerPrompt)
  const dangerSkipChecked = useStore(
    appUiStore,
    (state) => state.dangerSkipChecked,
  )
  const clearDangerPromptState = useStore(
    appUiStore,
    (state) => state.clearDangerPromptState,
  )
  const setDangerSkipChecked = useStore(
    appUiStore,
    (state) => state.setDangerSkipCheckedState,
  )
  const showDangerPromptState = useStore(
    appUiStore,
    (state) => state.showDangerPromptState,
  )
  const dangerResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const dangerReturnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(
    () => () => {
      replaceDangerConfirmationResolver(dangerResolverRef, null)
      dangerReturnFocusRef.current = null
      clearDangerPromptState()
    },
    [clearDangerPromptState],
  )

  const showDangerPrompt = useCallback(
    (
      prompt: DangerPrompt,
      options: DangerConfirmationRequestOptions = {},
    ): void => {
      replaceDangerConfirmationResolver(dangerResolverRef, null)
      dangerReturnFocusRef.current =
        options.returnFocusTarget === undefined
          ? currentActiveElement()
          : options.returnFocusTarget
      showDangerPromptState(prompt)
    },
    [showDangerPromptState],
  )

  const requestDangerConfirmation = useCallback(
    (
      prompt: DangerPrompt,
      options: DangerConfirmationRequestOptions = {},
    ): Promise<boolean> => {
      if (shouldBypassDangerConfirmation(prompt, isWarningDismissed(prompt.id))) {
        return Promise.resolve(true)
      }

      return new Promise((resolve) => {
        replaceDangerConfirmationResolver(dangerResolverRef, resolve)
        dangerReturnFocusRef.current =
          options.returnFocusTarget === undefined
            ? currentActiveElement()
            : options.returnFocusTarget
        showDangerPromptState(prompt)
      })
    },
    [isWarningDismissed, showDangerPromptState],
  )

  const closeDangerPrompt = useCallback(
    (confirmed: boolean): void => {
      const prompt = dangerPrompt

      if (
        prompt &&
        shouldRememberDangerConfirmationSkip(
          prompt,
          confirmed,
          dangerSkipChecked,
        )
      ) {
        onDismissWarning(prompt.id)
      }

      replaceDangerConfirmationResolver(dangerResolverRef, null, confirmed)
      clearDangerPromptState()

      const returnTarget = dangerReturnFocusRef.current
      dangerReturnFocusRef.current = null
      restoreFocusTo(returnTarget)
    },
    [clearDangerPromptState, dangerPrompt, dangerSkipChecked, onDismissWarning],
  )

  const cancelDangerPrompt = useCallback((): void => {
    replaceDangerConfirmationResolver(dangerResolverRef, null)
    clearDangerPromptState()

    const returnTarget = dangerReturnFocusRef.current
    dangerReturnFocusRef.current = null
    restoreFocusTo(returnTarget)
  }, [clearDangerPromptState])

  return {
    cancelDangerPrompt,
    closeDangerPrompt,
    dangerPrompt,
    dangerSkipChecked,
    requestDangerConfirmation,
    setDangerSkipChecked,
    showDangerPrompt,
  }
}
