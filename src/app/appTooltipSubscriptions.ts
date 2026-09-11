interface AppTooltipEventTarget {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void
}

interface AppTooltipListenerOptions {
  documentTarget: AppTooltipEventTarget
  windowTarget: AppTooltipEventTarget
  onPointerOver: EventListener
  onPointerOut: EventListener
  onFocusIn: EventListener
  onFocusOut: EventListener
  onKeyDown: EventListener
  reposition: EventListener
}

export function installAppTooltipListeners({
  documentTarget,
  windowTarget,
  onPointerOver,
  onPointerOut,
  onFocusIn,
  onFocusOut,
  onKeyDown,
  reposition,
}: AppTooltipListenerOptions): () => void {
  const removers: Array<() => void> = []

  const cleanup = () => {
    for (const remove of removers.splice(0).reverse()) {
      try {
        remove()
      } catch {
        // Teardown is best effort when an embedded document is closing.
      }
    }
  }

  const register = (
    target: AppTooltipEventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) => {
    target.addEventListener(type, listener, options)
    removers.push(() => target.removeEventListener(type, listener, options))
  }

  try {
    register(documentTarget, 'pointerover', onPointerOver)
    register(documentTarget, 'pointerout', onPointerOut)
    register(documentTarget, 'focus', onFocusIn, true)
    register(documentTarget, 'blur', onFocusOut, true)
    register(documentTarget, 'keydown', onKeyDown)
    register(windowTarget, 'resize', reposition)
    register(windowTarget, 'scroll', reposition, true)
  } catch {
    cleanup()
  }

  return cleanup
}
