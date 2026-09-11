import { describe, expect, it } from 'vitest'

import type { UserSkill } from '../../types'
import {
  INITIAL_SKILL_RENDER_COUNT,
  SKILL_RENDER_BATCH_SIZE,
  deriveRenderedSkillList,
  nextSkillRenderCount,
  skillRenderCountForTargetIndex,
} from '../skillList'

function skill(id: string): UserSkill {
  return {
    autoMatch: true,
    chunks: [],
    contentHash: id,
    contentType: 'markdown',
    createdAt: 1,
    description: '',
    enabled: true,
    fixed: false,
    id,
    keywords: [],
    name: id,
    sourceSize: 10,
    updatedAt: 1,
  }
}

describe('app Skill list', () => {
  it('advances in bounded batches', () => {
    expect(nextSkillRenderCount(20, 60)).toBe(INITIAL_SKILL_RENDER_COUNT)
    expect(nextSkillRenderCount(80, 241)).toBe(
      INITIAL_SKILL_RENDER_COUNT + SKILL_RENDER_BATCH_SIZE,
    )
    expect(nextSkillRenderCount(240, 241)).toBe(241)
  })

  it('expands only far enough to reveal the requested row', () => {
    expect(skillRenderCountForTargetIndex(80, 200, 120)).toBe(121)
    expect(skillRenderCountForTargetIndex(140, 200, 120)).toBe(140)
    expect(skillRenderCountForTargetIndex(80, 200, -1)).toBe(80)
  })

  it('materializes only the visible rows while an inactive view stays light', () => {
    const skills = Array.from({ length: 120 }, (_, index) =>
      skill(`skill-${index}`),
    )

    expect(deriveRenderedSkillList(skills, 80, false)).toMatchObject({
      hasMoreRenderedSkills: true,
      renderedSkillLimit: 80,
      renderedSkills: [],
      skillCount: 120,
    })
    expect(deriveRenderedSkillList(skills, 80, true).renderedSkills).toHaveLength(
      80,
    )
  })
})
