import type { UserSkill } from '../types'
import type { AppStringKey } from './strings'

type StateSetter<T> = (value: T | ((current: T) => T)) => void

export interface SkillEditorLoadOwner {
  begin: () => number
  current: () => number
  invalidate: () => void
}

export function createSkillEditorLoadOwner(): SkillEditorLoadOwner {
  let generation = 0
  return {
    begin: () => {
      generation += 1
      return generation
    },
    current: () => generation,
    invalidate: () => {
      generation += 1
    },
  }
}

export interface SkillEditorLoadActions {
  isCurrent?: () => boolean
  isTargetDeleted?: () => boolean
  setEditingId: (value: string | null) => void
  setNameDraft: (value: string) => void
  setContentDraft: (value: string) => void
  setLoadingId: StateSetter<string | null>
  resetDraft: () => void
  notify: (message: string, tone: 'error') => void
  translate: (key: AppStringKey) => string
}

export interface SkillEditorSubmitActions {
  addSkill: (name: string, content: string) => Promise<boolean>
  saveSkillContent: (
    id: string,
    name: string,
    content: string,
  ) => Promise<boolean>
}

export interface SkillEditorDraftResetActions {
  invalidateLoad: () => void
  setEditingId: (value: string | null) => void
  setNameDraft: (value: string) => void
  setContentDraft: (value: string) => void
  setLoadingId: (value: string | null) => void
}

export function finishSkillEditorDeletion({
  accepted,
  deletedSkillId,
  editingId,
  resetDraft,
  restoreFocus,
}: {
  accepted: boolean
  deletedSkillId: string
  editingId: string | null
  resetDraft: () => void
  restoreFocus: () => void
}): boolean {
  if (!accepted) return false
  if (editingId === deletedSkillId) resetDraft()
  restoreFocus()
  return true
}

export function resetSkillEditorDraft(
  actions: SkillEditorDraftResetActions,
): void {
  actions.invalidateLoad()
  actions.setEditingId(null)
  actions.setNameDraft('')
  actions.setContentDraft('')
  actions.setLoadingId(null)
}

export function isCurrentSkillEditorLoad(
  skill: Pick<UserSkill, 'id' | 'contentHash'>,
  generation: number,
  currentGeneration: number,
  currentSkills:
    | readonly Pick<UserSkill, 'id' | 'contentHash'>[]
    | undefined,
): boolean {
  if (currentGeneration !== generation) return false
  return (
    currentSkills?.some(
      (candidate) =>
        candidate.id === skill.id && candidate.contentHash === skill.contentHash,
    ) === true
  )
}

export async function submitSkillEditorDraft(
  editingId: string | null,
  nameDraft: string,
  contentDraft: string,
  actions: SkillEditorSubmitActions,
): Promise<boolean> {
  const name = nameDraft.trim()
  const content = contentDraft.trim()
  return editingId
    ? actions.saveSkillContent(editingId, name, content)
    : actions.addSkill(name, content)
}

export async function loadSkillEditorDraft(
  skill: Pick<UserSkill, 'id' | 'name'>,
  loadSkillContent: (id: string) => Promise<string>,
  actions: SkillEditorLoadActions,
): Promise<void> {
  const isCurrent = actions.isCurrent ?? (() => true)
  let targetDeleted = false
  const isLoadCurrent = (): boolean => {
    const current = isCurrent()
    if (!current && !targetDeleted && actions.isTargetDeleted?.()) {
      targetDeleted = true
      actions.resetDraft()
    }
    return current
  }
  actions.setEditingId(skill.id)
  actions.setNameDraft(skill.name)
  actions.setContentDraft('')
  actions.setLoadingId(skill.id)
  try {
    const content = await loadSkillContent(skill.id)
    if (!isLoadCurrent()) return
    actions.setContentDraft(content)
  } catch {
    if (!isLoadCurrent()) return
    console.error('[app] skill content load failed')
    try {
      actions.notify(actions.translate('skills.loadFailed'), 'error')
    } catch {
      console.error('[app] skill content load failure notification failed')
    }
    actions.resetDraft()
  } finally {
    if (isLoadCurrent()) {
      actions.setLoadingId((current) => (current === skill.id ? null : current))
    }
  }
}
