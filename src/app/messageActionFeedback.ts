import { writeClipboardText } from '../services/clipboard'

type MessageActionNotifier = (message: string, tone: 'error') => void

export interface MessageCopyFeedbackOwner {
  generation: number
}

export function notifyContained(
  notify: MessageActionNotifier,
  message: string,
): void {
  try {
    notify(message, 'error')
  } catch {
    // A broken toast channel must not escape a UI event boundary.
  }
}

export async function copyMessageText(
  value: string,
  failureMessage: string,
  notify: MessageActionNotifier,
  canNotify: () => boolean = () => true,
): Promise<boolean> {
  try {
    await writeClipboardText(value)
    return true
  } catch {
    console.error('[app] message copy failed')
    if (!canNotify()) return false
    notifyContained(notify, failureMessage)
    return false
  }
}

export function invalidateMessageCopyFeedback(
  owner: MessageCopyFeedbackOwner,
): void {
  owner.generation += 1
}

export async function runMessageCopyFeedbackAction(
  owner: MessageCopyFeedbackOwner,
  copy: (generation: number) => Promise<boolean>,
  publish: (generation: number) => void,
  beforeCopy: () => void = () => undefined,
): Promise<boolean> {
  const generation = ++owner.generation
  beforeCopy()
  const copied = await copy(generation)
  if (!copied || owner.generation !== generation) return false

  try {
    publish(generation)
    return true
  } catch {
    console.error('[app] message copy feedback failed')
    return false
  }
}
