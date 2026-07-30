import type { NoticeTarget } from '../components/Notice'
import type { NoticeTone } from './uiRuntime'

export type DetachedNoticeWriter = (
  message: string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
) => void

export function reportDetachedNotice(
  setNotice: DetachedNoticeWriter,
  getMessage: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
): string | null {
  let message: string | null = null

  try {
    message = getMessage()

    if (anchorId !== undefined) {
      setNotice(message, tone, target, anchorId)
    } else if (target !== undefined) {
      setNotice(message, tone, target)
    } else if (tone !== undefined) {
      setNotice(message, tone)
    } else {
      setNotice(message)
    }
  } catch {
    // Detached notice boundaries have no safer fallback UI channel.
  }

  return message
}

export interface DetachedFormattedFailureContext {
  formatErrorMessage: (error: unknown) => string
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
}

export function reportDetachedFormattedFailure(
  context: DetachedFormattedFailureContext,
  error: unknown,
  target: NoticeTarget,
): void {
  reportDetachedNotice(
    context.setNotice,
    () => context.formatErrorMessage(error),
    'error',
    target,
  )
}
