import type { AppStringKey } from './strings'

type DraftSetter = (value: string | ((current: string) => string)) => void

export function appendAudioTranscript(currentDraft: string, transcript: string): string {
  const current = currentDraft.trimEnd()
  const next = transcript.trim()
  return current ? `${current}\n${next}` : next
}

export interface ComposerSubmissionActions {
  mode: 'message' | 'image'
  setDraft: DraftSetter
  setSubmitting: (value: boolean) => void
  notify: (message: string, tone: 'error') => void
  onAccepted?: () => void
  translate: (key: AppStringKey) => string
}

export function clearSubmittedImageSourceIfCurrent(
  submittedSource: File | null,
  currentSource: File | null,
  clearSource: () => void,
): boolean {
  if (!submittedSource || currentSource !== submittedSource) return false
  clearSource()
  return true
}

export interface ImageSubmissionOwner {
  conversationId: string | null
  resetGeneration: number
  source: File | null
}

export function imageSubmissionOwnerMatches(
  submitted: ImageSubmissionOwner,
  current: ImageSubmissionOwner,
): boolean {
  return (
    submitted.conversationId === current.conversationId &&
    submitted.resetGeneration === current.resetGeneration &&
    submitted.source === current.source
  )
}

export function resetComposerImageSourceForGeneration(
  owner: { current: number },
  generation: number,
  clearSource: () => void,
): void {
  if (owner.current === generation) return
  owner.current = generation
  clearSource()
}

export async function runImageSubmissionAfterPreparation<T>(
  prepare: () => Promise<T>,
  isCurrent: () => boolean,
  submit: (prepared: T) => Promise<boolean>,
): Promise<boolean> {
  let prepared: T
  try {
    prepared = await prepare()
  } catch (error) {
    if (!isCurrent()) return false
    throw error
  }
  if (!isCurrent()) return false
  return submit(prepared)
}

export async function runComposerSubmission(
  text: string,
  execute: () => Promise<boolean>,
  actions: ComposerSubmissionActions,
): Promise<boolean> {
  actions.setSubmitting(true)
  try {
    const accepted = await execute()
    if (accepted) {
      actions.setDraft((current) => (current === text ? '' : current))
      try {
        actions.onAccepted?.()
      } catch {
        console.error(`[app] accepted ${actions.mode} submission cleanup failed`)
      }
    }
    return accepted
  } catch {
    console.error(`[app] ${actions.mode === 'image' ? 'image' : 'message'} submission failed`)
    try {
      actions.notify(actions.translate('toast.sendFailed'), 'error')
    } catch {
      console.error(
        `[app] ${actions.mode === 'image' ? 'image' : 'message'} submission failure notification failed`,
      )
    }
    return false
  } finally {
    actions.setSubmitting(false)
  }
}
