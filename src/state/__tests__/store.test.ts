import { beforeEach, describe, expect, it } from 'vitest'

import { providerPresets } from '../../data/presets'
import type { DangerPrompt } from '../../services/dangerConfirmation'
import {
  appUiStore,
  chatModelMenuStateForToggle,
  initialChatModelMenuUiState,
  initialComposerModeUiState,
  initialConversationSearchUiState,
  initialConversationTitleEditUiState,
  initialDangerConfirmationUiState,
  initialFirstRunGuideUiState,
  initialMessageListUiState,
  initialProviderSelectionUiState,
  initialSettingsOverlayUiState,
  initialSidebarUiState,
  resetAppUiStoreForTests,
  sidebarStateForDockChange,
} from '../store'

const dangerPrompt: DangerPrompt = {
  id: 'delete-message',
  title: 'Delete message',
  body: 'Delete this assistant message?',
  details: ['This cannot be undone.'],
  confirmLabel: 'Delete',
}

beforeEach(() => {
  resetAppUiStoreForTests()
})

describe('initialSidebarUiState', () => {
  it('creates a closed sidebar state with deterministic docking', () => {
    expect(initialSidebarUiState(true)).toEqual({
      sidebarDocked: true,
      sidebarOpen: false,
      sidebarOpenedByPointer: false,
    })
  })
})

describe('initialChatModelMenuUiState', () => {
  it('creates a closed provider/model menu state', () => {
    expect(initialChatModelMenuUiState()).toEqual({
      chatModelMenuOpen: false,
      expandedChatProviderId: '',
    })
  })
})

describe('initialComposerModeUiState', () => {
  it('creates the default chat composer mode state', () => {
    expect(initialComposerModeUiState()).toEqual({
      composerMode: 'chat',
      imageTaskMode: 'generate',
    })
  })
})

describe('initialConversationTitleEditUiState', () => {
  it('creates an inactive conversation title edit state', () => {
    expect(initialConversationTitleEditUiState()).toEqual({
      conversationTitleDraft: '',
      editingConversationTitleId: '',
    })
  })
})

describe('initialConversationSearchUiState', () => {
  it('creates an empty sidebar conversation search state', () => {
    expect(initialConversationSearchUiState()).toEqual({
      conversationSearch: '',
    })
  })
})

describe('initialProviderSelectionUiState', () => {
  it('creates an empty Settings provider selection state', () => {
    expect(initialProviderSelectionUiState()).toEqual({
      selectedProviderId: '',
    })
  })
})

describe('initialDangerConfirmationUiState', () => {
  it('creates a closed danger confirmation state', () => {
    expect(initialDangerConfirmationUiState()).toEqual({
      dangerPrompt: null,
      dangerSkipChecked: false,
    })
  })
})

describe('initialFirstRunGuideUiState', () => {
  it('creates an idle first-run guide success transition state', () => {
    expect(initialFirstRunGuideUiState()).toEqual({
      guideSuccessPending: false,
      selectedPresetId: providerPresets[0].id,
    })
  })
})

describe('initialMessageListUiState', () => {
  it('creates a hidden new-messages affordance state', () => {
    expect(initialMessageListUiState()).toEqual({
      showNewMessagesButton: false,
    })
  })
})

describe('initialSettingsOverlayUiState', () => {
  it('creates a closed Settings and first-run guide overlay state', () => {
    expect(initialSettingsOverlayUiState()).toEqual({
      guideOpen: false,
      settingsOpen: false,
      settingsTab: 'providers',
    })
  })
})

describe('chatModelMenuStateForToggle', () => {
  it('opens with the default expanded provider and closes without losing it', () => {
    expect(
      chatModelMenuStateForToggle(
        {
          chatModelMenuOpen: false,
          expandedChatProviderId: '',
        },
        'openai',
      ),
    ).toEqual({
      chatModelMenuOpen: true,
      expandedChatProviderId: 'openai',
    })

    expect(
      chatModelMenuStateForToggle(
        {
          chatModelMenuOpen: true,
          expandedChatProviderId: 'openai',
        },
        'anthropic',
      ),
    ).toEqual({
      chatModelMenuOpen: false,
      expandedChatProviderId: 'openai',
    })
  })
})

describe('sidebarStateForDockChange', () => {
  it('closes transient mobile state when the sidebar becomes docked', () => {
    expect(
      sidebarStateForDockChange(
        {
          sidebarDocked: false,
          sidebarOpen: true,
          sidebarOpenedByPointer: true,
        },
        true,
      ),
    ).toEqual({
      sidebarDocked: true,
      sidebarOpen: false,
      sidebarOpenedByPointer: false,
    })
  })

  it('preserves the current open state when returning to mobile layout', () => {
    expect(
      sidebarStateForDockChange(
        {
          sidebarDocked: true,
          sidebarOpen: true,
          sidebarOpenedByPointer: false,
        },
        false,
      ),
    ).toEqual({
      sidebarDocked: false,
      sidebarOpen: true,
      sidebarOpenedByPointer: false,
    })
  })
})

describe('appUiStore', () => {
  it('keeps sidebar conversation search in the shared Zustand UI store', () => {
    appUiStore.getState().setConversationSearchState('deployment notes')

    expect(appUiStore.getState()).toMatchObject({
      conversationSearch: 'deployment notes',
    })

    appUiStore.getState().clearConversationSearchState()

    expect(appUiStore.getState()).toMatchObject({
      conversationSearch: '',
    })
  })

  it('keeps conversation title edit drafts in the shared Zustand UI store', () => {
    appUiStore
      .getState()
      .startConversationTitleEditState('conversation-1', 'First draft')

    expect(appUiStore.getState()).toMatchObject({
      conversationTitleDraft: 'First draft',
      editingConversationTitleId: 'conversation-1',
    })

    appUiStore.getState().setConversationTitleDraftState('Renamed chat')

    expect(appUiStore.getState()).toMatchObject({
      conversationTitleDraft: 'Renamed chat',
      editingConversationTitleId: 'conversation-1',
    })

    appUiStore.getState().clearConversationTitleEditState('Renamed chat')

    expect(appUiStore.getState()).toMatchObject({
      conversationTitleDraft: 'Renamed chat',
      editingConversationTitleId: '',
    })
  })

  it('keeps the new messages affordance in the shared Zustand UI store', () => {
    appUiStore.getState().showNewMessagesButtonState()

    expect(appUiStore.getState()).toMatchObject({
      showNewMessagesButton: true,
    })

    appUiStore.getState().hideNewMessagesButtonState()

    expect(appUiStore.getState()).toMatchObject({
      showNewMessagesButton: false,
    })
  })

  it('keeps first-run guide success transitions in the shared Zustand UI store', () => {
    appUiStore.getState().setGuideSuccessPendingState(true)

    expect(appUiStore.getState()).toMatchObject({
      guideSuccessPending: true,
    })

    appUiStore.getState().clearGuideSuccessPendingState()

    expect(appUiStore.getState()).toMatchObject({
      guideSuccessPending: false,
    })
  })

  it('keeps first-run guide provider preset selection in the shared Zustand UI store', () => {
    expect(appUiStore.getState()).toMatchObject({
      selectedPresetId: providerPresets[0].id,
    })

    appUiStore.getState().setSelectedPresetIdState('custom-openai-relay')

    expect(appUiStore.getState()).toMatchObject({
      selectedPresetId: 'custom-openai-relay',
    })

    appUiStore.getState().clearGuideSuccessPendingState()

    expect(appUiStore.getState()).toMatchObject({
      guideSuccessPending: false,
      selectedPresetId: 'custom-openai-relay',
    })
  })

  it('keeps Settings provider selection in the shared Zustand UI store', () => {
    expect(appUiStore.getState()).toMatchObject({
      selectedProviderId: '',
    })

    appUiStore.getState().setSelectedProviderIdState('provider-2')

    expect(appUiStore.getState()).toMatchObject({
      selectedProviderId: 'provider-2',
    })

    appUiStore.getState().setSelectedProviderIdState('')

    expect(appUiStore.getState()).toMatchObject({
      selectedProviderId: '',
    })
  })

  it('keeps Settings and first-run guide overlay state in the shared Zustand UI store', () => {
    appUiStore.getState().setSettingsOpenState(true)
    appUiStore.getState().setSettingsTabState('sync')
    appUiStore.getState().setGuideOpenState(true)

    expect(appUiStore.getState()).toMatchObject({
      guideOpen: true,
      settingsOpen: true,
      settingsTab: 'sync',
    })

    appUiStore.getState().setSettingsOpenState(false)
    appUiStore.getState().setGuideOpenState(false)

    expect(appUiStore.getState()).toMatchObject({
      guideOpen: false,
      settingsOpen: false,
      settingsTab: 'sync',
    })
  })

  it('keeps danger prompt visibility and skip choice in the shared Zustand UI store', () => {
    appUiStore.getState().showDangerPromptState(dangerPrompt)

    expect(appUiStore.getState()).toMatchObject({
      dangerPrompt,
      dangerSkipChecked: false,
    })

    appUiStore.getState().setDangerSkipCheckedState(true)

    expect(appUiStore.getState()).toMatchObject({
      dangerPrompt,
      dangerSkipChecked: true,
    })

    appUiStore.getState().clearDangerPromptState()

    expect(appUiStore.getState()).toMatchObject({
      dangerPrompt: null,
      dangerSkipChecked: false,
    })
  })

  it('keeps provider/model menu updates in the shared Zustand UI store', () => {
    appUiStore.getState().toggleChatModelMenuState('openai')

    expect(appUiStore.getState()).toMatchObject({
      chatModelMenuOpen: true,
      expandedChatProviderId: 'openai',
    })

    appUiStore.getState().setExpandedChatProviderState('anthropic')

    expect(appUiStore.getState()).toMatchObject({
      chatModelMenuOpen: true,
      expandedChatProviderId: 'anthropic',
    })

    appUiStore.getState().selectChatModelMenuOptionState('local')

    expect(appUiStore.getState()).toMatchObject({
      chatModelMenuOpen: false,
      expandedChatProviderId: 'local',
    })
  })

  it('keeps chat, image, and audio composer mode in the shared Zustand UI store', () => {
    expect(appUiStore.getState()).toMatchObject({
      composerMode: 'chat',
      imageTaskMode: 'generate',
    })

    appUiStore.getState().setComposerModeState('image')
    appUiStore.getState().setImageTaskModeState('edit')

    expect(appUiStore.getState()).toMatchObject({
      composerMode: 'image',
      imageTaskMode: 'edit',
    })

    appUiStore.getState().setImageTaskModeState('inpaint')

    expect(appUiStore.getState()).toMatchObject({
      composerMode: 'image',
      imageTaskMode: 'inpaint',
    })

    appUiStore.getState().setComposerModeState('chat')

    expect(appUiStore.getState()).toMatchObject({
      composerMode: 'chat',
      imageTaskMode: 'inpaint',
    })

    appUiStore.getState().setComposerModeState('audio')

    expect(appUiStore.getState()).toMatchObject({
      composerMode: 'audio',
      imageTaskMode: 'inpaint',
    })

    resetAppUiStoreForTests()

    expect(appUiStore.getState()).toMatchObject({
      composerMode: 'chat',
      imageTaskMode: 'generate',
    })
  })

  it('keeps sidebar open and close updates in the shared Zustand UI store', () => {
    appUiStore.getState().openSidebarState(true)

    expect(appUiStore.getState()).toMatchObject({
      sidebarDocked: false,
      sidebarOpen: true,
      sidebarOpenedByPointer: true,
    })

    appUiStore.getState().closeSidebarState()

    expect(appUiStore.getState()).toMatchObject({
      sidebarDocked: false,
      sidebarOpen: false,
      sidebarOpenedByPointer: false,
    })
  })

  it('resets pointer-open state when desktop docking takes over', () => {
    appUiStore.getState().openSidebarState(true)
    appUiStore.getState().setSidebarDockedState(true)

    expect(appUiStore.getState()).toMatchObject({
      sidebarDocked: true,
      sidebarOpen: false,
      sidebarOpenedByPointer: false,
    })
  })
})
