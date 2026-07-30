const markdownCopyFeedbackTimers = new WeakMap<HTMLButtonElement, number>()

export type MarkdownCopyFeedbackState = 'copied' | 'failed'

function runMarkdownCopyFeedbackTask(
  button: HTMLButtonElement,
  task: () => void,
): boolean {
  try {
    task()
    return true
  } catch {
    // The clipboard result already settled; inline button feedback is cosmetic.
    markdownCopyFeedbackTimers.delete(button)
    return false
  }
}

function resetMarkdownCopyButton(button: HTMLButtonElement): void {
  const copyLabel = button.dataset.copyLabel || button.textContent || ''
  const copyCodeLabel = button.dataset.copyCodeLabel || copyLabel

  button.textContent = copyLabel
  button.setAttribute('aria-label', copyCodeLabel)
  button.setAttribute('data-tooltip', copyCodeLabel)
  button.dataset.copied = 'false'
  button.dataset.copyFailed = 'false'
  markdownCopyFeedbackTimers.delete(button)
}

function setMarkdownCopyFeedbackTimer(button: HTMLButtonElement): void {
  const timer = globalThis.setTimeout(() => {
    runMarkdownCopyFeedbackTask(button, () => resetMarkdownCopyButton(button))
  }, 1600)

  markdownCopyFeedbackTimers.set(button, timer)
}

function showMarkdownCopyFeedback(button: HTMLButtonElement): void {
  const copiedLabel = button.dataset.copiedLabel || button.dataset.copyLabel || ''
  const existingTimer = markdownCopyFeedbackTimers.get(button)

  if (existingTimer) {
    globalThis.clearTimeout(existingTimer)
  }

  button.textContent = copiedLabel
  button.setAttribute('aria-label', copiedLabel)
  button.setAttribute('data-tooltip', copiedLabel)
  button.dataset.copied = 'true'
  button.dataset.copyFailed = 'false'

  setMarkdownCopyFeedbackTimer(button)
}

function showMarkdownCopyFailureFeedback(button: HTMLButtonElement): void {
  const failedLabel =
    button.dataset.copyFailedLabel || button.dataset.copyCodeLabel || ''
  const existingTimer = markdownCopyFeedbackTimers.get(button)

  if (existingTimer) {
    globalThis.clearTimeout(existingTimer)
  }

  button.textContent = failedLabel
  button.setAttribute('aria-label', failedLabel)
  button.setAttribute('data-tooltip', failedLabel)
  button.dataset.copied = 'false'
  button.dataset.copyFailed = 'true'

  setMarkdownCopyFeedbackTimer(button)
}

export function applyMarkdownCopyFeedback(
  button: HTMLButtonElement,
  state: MarkdownCopyFeedbackState,
): boolean {
  return runMarkdownCopyFeedbackTask(button, () => {
    if (state === 'copied') {
      showMarkdownCopyFeedback(button)
      return
    }

    showMarkdownCopyFailureFeedback(button)
  })
}
