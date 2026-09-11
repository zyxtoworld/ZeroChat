export interface InteractionFocusServices {
  contains: (target: HTMLElement) => boolean
  isActiveElement?: (target: HTMLElement) => boolean
}

interface RestorableInteractionElement extends HTMLElement {
  disabled?: boolean
}

interface RestoreInteractionFocusOptions<T extends RestorableInteractionElement> {
  activeElement: Element | null
  blocked: boolean
  body: HTMLElement | null
  owner?: Element | null
  target: T | null
}

const MAX_INTERACTION_FOCUS_ATTEMPTS = 4

function interactionFocusBlocked(target: HTMLElement): boolean {
  const candidate = target as HTMLElement & { disabled?: boolean }
  if (candidate.disabled || target.hidden) return true

  if (
    typeof target.getAttribute === 'function' &&
    target.getAttribute('aria-hidden') === 'true'
  ) {
    return true
  }
  if (
    typeof target.hasAttribute === 'function' &&
    target.hasAttribute('inert')
  ) {
    return true
  }
  if (typeof target.closest === 'function') {
    return Boolean(
      target.closest('[inert]') || target.closest('[aria-hidden="true"]'),
    )
  }
  return false
}

const defaultInteractionFocusServices: InteractionFocusServices = {
  contains: (target) =>
    typeof document === 'undefined' || document.contains(target),
  isActiveElement: (target) =>
    typeof document === 'undefined' || document.activeElement === target,
}

function defaultRequestFrame(callback: FrameRequestCallback): number {
  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function'
  ) {
    return window.requestAnimationFrame(callback)
  }

  callback(0)
  return 0
}

export function focusInteractionElement(
  target: HTMLElement | null | undefined,
  services: InteractionFocusServices = defaultInteractionFocusServices,
): boolean {
  if (
    !target ||
    interactionFocusBlocked(target) ||
    !services.contains(target)
  ) {
    return false
  }

  try {
    target.focus({ preventScroll: true })
    return services.isActiveElement?.(target) ?? true
  } catch {
    return false
  }
}

export function restoreInteractionFocusTarget<
  T extends RestorableInteractionElement,
>({
  activeElement,
  blocked,
  body,
  owner,
  target,
}: RestoreInteractionFocusOptions<T>): T | null {
  if (
    blocked ||
    !target?.isConnected ||
    interactionFocusBlocked(target)
  ) {
    return null
  }
  const focusOwner = owner ?? target
  if (
    activeElement &&
    activeElement !== target &&
    activeElement !== focusOwner &&
    activeElement !== body
  ) {
    return null
  }
  return target
}

export function scheduleInteractionFocus(
  resolveTarget: () => HTMLElement | null | undefined,
  requestFrame: (callback: FrameRequestCallback) => number = defaultRequestFrame,
  services: InteractionFocusServices = defaultInteractionFocusServices,
): Promise<boolean> {
  return new Promise((resolve) => {
    const run = () => {
      try {
        resolve(focusInteractionElement(resolveTarget(), services))
      } catch {
        resolve(false)
      }
    }

    try {
      requestFrame(run)
    } catch {
      resolve(false)
    }
  })
}

export function scheduleInteractionFocusRetry(
  resolveTarget: () => HTMLElement | null | undefined,
  requestFrame: (callback: FrameRequestCallback) => number = defaultRequestFrame,
  services: InteractionFocusServices = defaultInteractionFocusServices,
): void {
  let attempts = 0

  const queueAttempt = (): void => {
    if (attempts >= MAX_INTERACTION_FOCUS_ATTEMPTS) return
    attempts += 1
    const run = () => {
      try {
        if (focusInteractionElement(resolveTarget(), services)) return
        queueAttempt()
      } catch {
        // A broken frame host or target resolver must not escape a detached UI action.
      }
    }
    try {
      requestFrame(run)
    } catch {
      // Scheduler failures end this focus attempt without leaking an exception.
    }
  }

  queueAttempt()
}

export function scrollInteractionElementIntoView(
  target: HTMLElement | null | undefined,
  options: ScrollIntoViewOptions,
  services: InteractionFocusServices = defaultInteractionFocusServices,
): boolean {
  if (!target || !services.contains(target)) {
    return false
  }

  try {
    target.scrollIntoView(options)
    return true
  } catch {
    return false
  }
}

export function scrollInteractionElementTo(
  target: HTMLElement | null | undefined,
  options: ScrollToOptions,
  services: InteractionFocusServices = defaultInteractionFocusServices,
): boolean {
  if (!target || !services.contains(target)) {
    return false
  }

  try {
    if (typeof target.scrollTo === 'function') {
      target.scrollTo(options)
    } else {
      target.scrollTop = options.top ?? target.scrollTop
    }

    return true
  } catch {
    return false
  }
}
