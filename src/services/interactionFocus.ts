export interface InteractionFocusServices {
  contains: (target: HTMLElement) => boolean
}

const defaultInteractionFocusServices: InteractionFocusServices = {
  contains: (target) =>
    typeof document === 'undefined' || document.contains(target),
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

export function scheduleInteractionFocus(
  resolveTarget: () => HTMLElement | null | undefined,
  requestFrame: (callback: FrameRequestCallback) => number = defaultRequestFrame,
  services: InteractionFocusServices = defaultInteractionFocusServices,
): void {
  requestFrame(() => {
    focusInteractionElement(resolveTarget(), services)
  })
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
