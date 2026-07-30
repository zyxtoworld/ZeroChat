import { describe, expect, it } from 'vitest'

import { loadSettingsDataActionService } from '../settingsDataControllerLoader'

describe('settingsDataControllerLoader', () => {
  it('shares one retryable action-module load across Data-tab prewarm and user actions', async () => {
    const prewarm = loadSettingsDataActionService()
    const userAction = loadSettingsDataActionService()

    expect(userAction).toBe(prewarm)

    const createSettingsDataActions = await prewarm

    expect(typeof createSettingsDataActions).toBe('function')
    expect(await loadSettingsDataActionService()).toBe(createSettingsDataActions)
  }, 15000)
})
