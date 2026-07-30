import { describe, expect, it } from 'vitest'

import type { AppData } from '../../types'
import {
  deriveAppOverlayChrome,
  shouldCloseMobileSidebarForDanger,
} from '../appInteractionController'

function appData(firstRunDone: boolean): AppData {
  return {
    conversations: [],
    preferences: {
      activeConversationId: '',
      chatContextMessageLimit: 20,
      compactMode: false,
      firstRunDone,
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
    version: 1,
  }
}

describe('app interaction controller derivation', () => {
  it('keeps first-run guide visibility and modal isolation out of App.tsx', () => {
    expect(
      deriveAppOverlayChrome({
        dangerPromptOpen: false,
        data: null,
        guideOpen: false,
        settingsOpen: false,
        syncFirstConflictPromptOpen: false,
      }),
    ).toEqual({
      guideVisible: false,
      modalOpen: false,
    })

    expect(
      deriveAppOverlayChrome({
        dangerPromptOpen: false,
        data: appData(false),
        guideOpen: false,
        settingsOpen: false,
        syncFirstConflictPromptOpen: false,
      }),
    ).toEqual({
      guideVisible: true,
      modalOpen: true,
    })

    expect(
      deriveAppOverlayChrome({
        dangerPromptOpen: false,
        data: appData(true),
        guideOpen: false,
        guideSuccessPending: true,
        settingsOpen: false,
        syncFirstConflictPromptOpen: false,
      }),
    ).toEqual({
      guideVisible: true,
      modalOpen: true,
    })

    expect(
      deriveAppOverlayChrome({
        dangerPromptOpen: false,
        data: appData(true),
        guideOpen: false,
        settingsOpen: true,
        syncFirstConflictPromptOpen: false,
      }),
    ).toEqual({
      guideVisible: false,
      modalOpen: true,
    })
  })

  it('only closes the sidebar before danger prompts on mobile overlay state', () => {
    expect(
      shouldCloseMobileSidebarForDanger({
        sidebarDocked: false,
        sidebarOpen: true,
      }),
    ).toBe(true)
    expect(
      shouldCloseMobileSidebarForDanger({
        sidebarDocked: true,
        sidebarOpen: true,
      }),
    ).toBe(false)
    expect(
      shouldCloseMobileSidebarForDanger({
        sidebarDocked: false,
        sidebarOpen: false,
      }),
    ).toBe(false)
  })
})
