import { describe, expect, it, vi } from 'vitest'

import {
  dismissFeatureHintId,
  featureHintDismissed,
  shouldShowFeatureHint,
} from '../featureHints'
import {
  dismissFeatureHintPreference,
  reportFeatureHintNotice,
} from '../featureHintController'
import type { Translator } from '../../i18n'
import type { AppData, FeatureHintId } from '../../types'

const baseOptions = {
  dangerPromptOpen: false,
  dismissedFeatureHints: [] as FeatureHintId[],
  guideVisible: false,
  id: 'chat' as FeatureHintId,
  placement: 'chat' as const,
  settingsOpen: false,
  syncFirstConflictPromptOpen: false,
}
const t = ((key: string) => key) as Translator

function appData(): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt: 1,
  }
}

describe('feature hint rules', () => {
  it('shows first-entry hints until they are dismissed', () => {
    expect(shouldShowFeatureHint(baseOptions)).toBe(true)
    expect(
      shouldShowFeatureHint({
        ...baseOptions,
        dismissedFeatureHints: ['chat'],
      }),
    ).toBe(false)
    expect(featureHintDismissed(['chat'], 'chat')).toBe(true)
  })

  it('hides non-settings hints while settings or blocking overlays are open', () => {
    expect(
      shouldShowFeatureHint({
        ...baseOptions,
        settingsOpen: true,
      }),
    ).toBe(false)
    expect(
      shouldShowFeatureHint({
        ...baseOptions,
        id: 'providers',
        placement: 'settings',
        settingsOpen: true,
      }),
    ).toBe(true)
    expect(
      shouldShowFeatureHint({
        ...baseOptions,
        guideVisible: true,
      }),
    ).toBe(false)
    expect(
      shouldShowFeatureHint({
        ...baseOptions,
        dangerPromptOpen: true,
      }),
    ).toBe(false)
    expect(
      shouldShowFeatureHint({
        ...baseOptions,
        syncFirstConflictPromptOpen: true,
      }),
    ).toBe(false)
  })

  it('adds a dismissed hint once without mutating the existing preference list', () => {
    const dismissed: FeatureHintId[] = ['chat']
    const added = dismissFeatureHintId(dismissed, 'image')

    expect(added).toEqual({
      changed: true,
      dismissedFeatureHints: ['chat', 'image'],
    })
    expect(dismissed).toEqual(['chat'])

    const duplicate = dismissFeatureHintId(added.dismissedFeatureHints, 'image')
    expect(duplicate).toEqual({
      changed: false,
      dismissedFeatureHints: ['chat', 'image'],
    })
  })

  it('persists feature-hint dismissals through AppData without showing errors', () => {
    let data = appData()
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()
    const updateData = vi.fn((updater: (current: AppData) => AppData) => {
      data = updater(data)
      return data
    })

    const saved = dismissFeatureHintPreference(
      {
        scheduleAutoSync,
        setNotice,
        t,
        updateData,
      },
      'chat',
    )

    expect(saved?.preferences.dismissedFeatureHints).toEqual(['chat'])
    expect(data.preferences.dismissedFeatureHints).toEqual(['chat'])
    expect(updateData).toHaveBeenCalledWith(expect.any(Function), {
      autoSync: false,
    })
    expect(scheduleAutoSync).toHaveBeenCalledWith(data, 0)
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('queues immediate sync after feature-hint dismissal commits locally', () => {
    let data = appData()
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()
    const updateData = vi.fn((updater: (current: AppData) => AppData) => {
      data = updater(data)
      return data
    })

    const saved = dismissFeatureHintPreference(
      {
        scheduleAutoSync,
        setNotice,
        t,
        updateData,
      },
      'providers',
    )

    expect(saved).toBe(data)
    expect(updateData).toHaveBeenCalledWith(expect.any(Function), {
      autoSync: false,
    })
    expect(scheduleAutoSync).toHaveBeenCalledWith(saved, 0)
    expect(setNotice).not.toHaveBeenCalled()
  })

  it('reports feature-hint dismissal save failures instead of silently claiming success', () => {
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn()
    const updateData = vi.fn(() => null)

    const saved = dismissFeatureHintPreference(
      {
        scheduleAutoSync,
        setNotice,
        t,
        updateData,
      },
      'chat',
    )

    expect(saved).toBeNull()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.settingsSaveUnavailable',
      'error',
    )
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('contains feature-hint dismissal save-failure notice reporter failures', () => {
    const scheduleAutoSync = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })
    const updateData = vi.fn(() => null)

    const saved = dismissFeatureHintPreference(
      {
        scheduleAutoSync,
        setNotice,
        t,
        updateData,
      },
      'chat',
    )

    expect(saved).toBeNull()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.settingsSaveUnavailable',
      'error',
    )
    expect(scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('contains standalone feature-hint notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(
      reportFeatureHintNotice(
        { setNotice },
        () => 'notice.settingsSaveUnavailable',
        'error',
      ),
    ).toBeNull()
    expect(setNotice).toHaveBeenCalledWith(
      'notice.settingsSaveUnavailable',
      'error',
    )
  })
})
