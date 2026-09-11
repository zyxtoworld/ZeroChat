export function cleanupClipboardFallbackTextarea(
  textarea: HTMLTextAreaElement | null,
): boolean {
  if (!textarea) {
    return true
  }

  try {
    textarea.remove()
    return true
  } catch {
    // Clipboard copy result already settled; textarea cleanup is best-effort.
    return false
  }
}

function textareaClipboardFallback(value: string): boolean {
  if (!document.body || typeof document.execCommand !== 'function') {
    return false
  }

  const activeElement =
    typeof HTMLElement !== 'undefined' &&
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.setAttribute('readonly', 'true')
  document.body.append(textarea)

  try {
    textarea.select()
    return document.execCommand('copy')
  } finally {
    cleanupClipboardFallbackTextarea(textarea)
    if (activeElement && document.contains(activeElement)) {
      try {
        activeElement.focus({ preventScroll: true })
      } catch {
        // Clipboard fallback must not turn a focus restoration failure into a copy failure.
      }
    }
  }
}

let clipboardWriteTail: Promise<void> = Promise.resolve()

async function writeClipboardTextNow(value: string): Promise<void> {
  let clipboardError: unknown = null

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch (error: unknown) {
      clipboardError = error
    }
  }

  if (textareaClipboardFallback(value)) {
    return
  }

  if (clipboardError instanceof Error) {
    throw clipboardError
  }

  throw new Error('Clipboard write failed')
}

export async function writeClipboardText(value: string): Promise<void> {
  const operation = clipboardWriteTail.then(() => writeClipboardTextNow(value))
  clipboardWriteTail = operation.catch(() => undefined)
  await operation
}
