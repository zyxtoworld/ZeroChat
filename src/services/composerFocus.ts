export interface ComposerTextareaRef {
  current: HTMLTextAreaElement | null
}

type RequestAnimationFrame = (callback: FrameRequestCallback) => number

export function focusComposerTextareaToEnd(
  textarea: HTMLTextAreaElement | null,
): boolean {
  if (!textarea) {
    return false
  }

  try {
    textarea.focus({ preventScroll: true })
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    return true
  } catch {
    return false
  }
}

export function scheduleComposerTextareaFocusToEnd(
  composerTextareaRef: ComposerTextareaRef,
  requestFrame: RequestAnimationFrame = window.requestAnimationFrame.bind(
    window,
  ),
): number {
  return requestFrame(() => {
    focusComposerTextareaToEnd(composerTextareaRef.current)
  })
}
