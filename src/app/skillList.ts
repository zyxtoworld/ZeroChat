import type { UserSkill } from '../types'

export const INITIAL_SKILL_RENDER_COUNT = 80
export const SKILL_RENDER_BATCH_SIZE = 80

export interface RenderedSkillList {
  hasMoreRenderedSkills: boolean
  renderedSkillLimit: number
  renderedSkills: UserSkill[]
  skillCount: number
}

export function nextSkillRenderCount(
  currentCount: number,
  skillCount: number,
): number {
  return Math.max(
    INITIAL_SKILL_RENDER_COUNT,
    Math.min(skillCount, currentCount + SKILL_RENDER_BATCH_SIZE),
  )
}

export function skillRenderCountForTargetIndex(
  currentCount: number,
  skillCount: number,
  targetIndex: number,
): number {
  if (targetIndex < 0) return currentCount
  return Math.max(currentCount, Math.min(skillCount, targetIndex + 1))
}

export function deriveRenderedSkillList(
  skills: UserSkill[],
  renderedSkillCount: number,
  active: boolean,
): RenderedSkillList {
  const skillCount = skills.length
  const renderedSkillLimit = Math.min(skillCount, renderedSkillCount)

  return {
    hasMoreRenderedSkills: renderedSkillLimit < skillCount,
    renderedSkillLimit,
    renderedSkills: active ? skills.slice(0, renderedSkillLimit) : [],
    skillCount,
  }
}
