import { describe, expect, it } from 'vitest'

import { loadSettingsSkillActionService } from '../settingsSkillActionsLoader'

describe('settingsSkillActionsLoader', () => {
  it('shares one retryable action-module load across prewarm and user actions', async () => {
    const prewarm = loadSettingsSkillActionService()
    const userAction = loadSettingsSkillActionService()

    expect(userAction).toBe(prewarm)

    const service = await prewarm

    expect(typeof service.createSettingsSkillActions).toBe('function')
    expect(await loadSettingsSkillActionService()).toBe(service)
  }, 15000)
})
