export const MESSAGE_AUTO_SCROLL_THRESHOLD_PX = 100
export const COMPOSER_MIN_ROWS = 1
export const COMPOSER_MAX_ROWS = 5

export interface ScrollMetrics {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export interface TextareaBoxMetrics {
  fontSize: number
  lineHeight: number
  paddingTop: number
  paddingBottom: number
  borderTopWidth: number
  borderBottomWidth: number
}

export interface ComposerTextareaLayout {
  height: number
  overflowY: 'auto' | 'hidden'
}

export function isMessageListNearBottom(
  messageList: ScrollMetrics,
  thresholdPx = MESSAGE_AUTO_SCROLL_THRESHOLD_PX,
): boolean {
  return (
    messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight <=
    thresholdPx
  )
}

export function composerTextareaLayout(
  scrollHeight: number,
  metrics: TextareaBoxMetrics,
  minRows = COMPOSER_MIN_ROWS,
  maxRows = COMPOSER_MAX_ROWS,
): ComposerTextareaLayout {
  const fallbackLineHeight =
    (Number.isFinite(metrics.fontSize) ? metrics.fontSize : 15) * 1.45
  const lineHeight = Number.isFinite(metrics.lineHeight)
    ? metrics.lineHeight
    : fallbackLineHeight
  const chrome =
    numericCssPixels(metrics.paddingTop) +
    numericCssPixels(metrics.paddingBottom) +
    numericCssPixels(metrics.borderTopWidth) +
    numericCssPixels(metrics.borderBottomWidth)
  const minHeight = Math.ceil(lineHeight * minRows + chrome)
  const maxHeight = Math.ceil(lineHeight * maxRows + chrome)
  const height = Math.min(Math.max(scrollHeight, minHeight), maxHeight)

  return {
    height,
    overflowY: scrollHeight > maxHeight + 1 ? 'auto' : 'hidden',
  }
}

export function resizeComposerTextarea(
  textarea: HTMLTextAreaElement | null,
): void {
  if (!textarea) {
    return
  }

  textarea.style.height = 'auto'
  const styles = window.getComputedStyle(textarea)
  const layout = composerTextareaLayout(textarea.scrollHeight, {
    fontSize: Number.parseFloat(styles.fontSize),
    lineHeight: Number.parseFloat(styles.lineHeight),
    paddingTop: Number.parseFloat(styles.paddingTop),
    paddingBottom: Number.parseFloat(styles.paddingBottom),
    borderTopWidth: Number.parseFloat(styles.borderTopWidth),
    borderBottomWidth: Number.parseFloat(styles.borderBottomWidth),
  })

  textarea.style.height = `${layout.height}px`
  textarea.style.overflowY = layout.overflowY
}

function numericCssPixels(value: number): number {
  return Number.isFinite(value) ? value : 0
}
