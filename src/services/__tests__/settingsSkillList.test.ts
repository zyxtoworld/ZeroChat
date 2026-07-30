import { describe, expect, it } from 'vitest'
import type { UserSkill } from '../../types'
import {
  INITIAL_SKILL_RENDER_COUNT,
  SKILL_RENDER_BATCH_SIZE,
  deriveRenderedSkillList,
  nextSkillRenderCount,
  skillRenderCountForTargetIndex,
} from '../settingsSkillList'

function skill(id: string): UserSkill {
  return {
    id,
    name: id,
    description: '',
    contentType: 'markdown',
    sourceSize: 10,
    contentHash: id,
    keywords: [],
    chunks: [],
    fixed: false,
    enabled: true,
    autoMatch: true,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('settings skill list', () => {
  it('advances in bounded batches', () => {
    expect(nextSkillRenderCount(20, 60)).toBe(INITIAL_SKILL_RENDER_COUNT)
    expect(nextSkillRenderCount(80, 241)).toBe(
      INITIAL_SKILL_RENDER_COUNT + SKILL_RENDER_BATCH_SIZE,
    )
    expect(nextSkillRenderCount(240, 241)).toBe(241)
  })

  it('expands just enough to reveal a target skill', () => {
    expect(skillRenderCountForTargetIndex(80, 200, 120)).toBe(121)
    expect(skillRenderCountForTargetIndex(140, 200, 120)).toBe(140)
    expect(skillRenderCountForTargetIndex(80, 200, -1)).toBe(80)
  })

  it('only materializes visible skills while inactive tabs stay light', () => {
    const skills = Array.from({ length: 120 }, (_, index) =>
      skill(`skill-${index}`),
    )

    expect(deriveRenderedSkillList(skills, 80, false)).toMatchObject({
      hasMoreRenderedSkills: true,
      renderedSkillLimit: 80,
      renderedSkills: [],
      skillCount: 120,
    })
    expect(deriveRenderedSkillList(skills, 80, true).renderedSkills).toHaveLength(80)
  })
})
