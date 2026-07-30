import { createStore } from 'zustand/vanilla'

import type { SettingsTab } from '../components/SettingsNav'
import { providerPresets } from '../data/presets'
import type { DangerPrompt } from '../services/dangerConfirmation'
import type {
  ComposerMode,
  ImageTaskMode,
} from '../services/imageComposerChrome'
import { initialSidebarDocked } from '../services/sidebarChrome'

export interface SidebarUiState {
  sidebarDocked: boolean
  sidebarOpen: boolean
  sidebarOpenedByPointer: boolean
}

export interface ChatModelMenuUiState {
  chatModelMenuOpen: boolean
  expandedChatProviderId: string
}

export interface ComposerModeUiState {
  composerMode: ComposerMode
  imageTaskMode: ImageTaskMode
}

export interface ConversationTitleEditUiState {
  conversationTitleDraft: string
  editingConversationTitleId: string
}

export interface ConversationSearchUiState {
  conversationSearch: string
}

export interface ProviderSelectionUiState {
  selectedProviderId: string
}

export interface FirstRunGuideUiState {
  guideSuccessPending: boolean
  selectedPresetId: string
}

export interface SettingsOverlayUiState {
  guideOpen: boolean
  settingsOpen: boolean
  settingsTab: SettingsTab
}

export interface DangerConfirmationUiState {
  dangerPrompt: DangerPrompt | null
  dangerSkipChecked: boolean
}

export interface MessageListUiState {
  showNewMessagesButton: boolean
}

interface AppUiStore
  extends ChatModelMenuUiState,
    ComposerModeUiState,
    ConversationSearchUiState,
    ConversationTitleEditUiState,
    DangerConfirmationUiState,
    FirstRunGuideUiState,
    MessageListUiState,
    ProviderSelectionUiState,
    SettingsOverlayUiState,
    SidebarUiState {
  closeChatModelMenuState: () => void
  clearConversationSearchState: () => void
  clearConversationTitleEditState: (draft?: string) => void
  clearDangerPromptState: () => void
  clearGuideSuccessPendingState: () => void
  closeSidebarState: () => void
  hideNewMessagesButtonState: () => void
  openSidebarState: (openedByPointer?: boolean) => void
  selectChatModelMenuOptionState: (providerId: string) => void
  setConversationSearchState: (search: string) => void
  setConversationTitleDraftState: (draft: string) => void
  setDangerSkipCheckedState: (checked: boolean) => void
  setComposerModeState: (mode: ComposerMode) => void
  setExpandedChatProviderState: (providerId: string) => void
  setGuideOpenState: (open: boolean) => void
  setGuideSuccessPendingState: (pending: boolean) => void
  setImageTaskModeState: (mode: ImageTaskMode) => void
  setSelectedProviderIdState: (providerId: string) => void
  setSelectedPresetIdState: (presetId: string) => void
  setSettingsOpenState: (open: boolean) => void
  setSettingsTabState: (tab: SettingsTab) => void
  setSidebarDockedState: (sidebarDocked: boolean) => void
  startConversationTitleEditState: (
    conversationId: string,
    title: string,
  ) => void
  showDangerPromptState: (prompt: DangerPrompt) => void
  showNewMessagesButtonState: () => void
  toggleChatModelMenuState: (defaultExpandedProviderId: string) => void
}

export function initialSidebarUiState(
  sidebarDocked = initialSidebarDocked(),
): SidebarUiState {
  return {
    sidebarDocked,
    sidebarOpen: false,
    sidebarOpenedByPointer: false,
  }
}

export function initialChatModelMenuUiState(): ChatModelMenuUiState {
  return {
    chatModelMenuOpen: false,
    expandedChatProviderId: '',
  }
}

export function initialComposerModeUiState(): ComposerModeUiState {
  return {
    composerMode: 'chat',
    imageTaskMode: 'generate',
  }
}

export function initialConversationTitleEditUiState(): ConversationTitleEditUiState {
  return {
    conversationTitleDraft: '',
    editingConversationTitleId: '',
  }
}

export function initialConversationSearchUiState(): ConversationSearchUiState {
  return {
    conversationSearch: '',
  }
}

export function initialProviderSelectionUiState(): ProviderSelectionUiState {
  return {
    selectedProviderId: '',
  }
}

export function initialFirstRunGuideUiState(): FirstRunGuideUiState {
  return {
    guideSuccessPending: false,
    selectedPresetId: providerPresets[0].id,
  }
}

export function initialSettingsOverlayUiState(): SettingsOverlayUiState {
  return {
    guideOpen: false,
    settingsOpen: false,
    settingsTab: 'providers',
  }
}

export function initialDangerConfirmationUiState(): DangerConfirmationUiState {
  return {
    dangerPrompt: null,
    dangerSkipChecked: false,
  }
}

export function initialMessageListUiState(): MessageListUiState {
  return {
    showNewMessagesButton: false,
  }
}

export function chatModelMenuStateForToggle(
  current: ChatModelMenuUiState,
  defaultExpandedProviderId: string,
): ChatModelMenuUiState {
  if (current.chatModelMenuOpen) {
    return {
      ...current,
      chatModelMenuOpen: false,
    }
  }

  return {
    chatModelMenuOpen: true,
    expandedChatProviderId: defaultExpandedProviderId,
  }
}

export function sidebarStateForDockChange(
  current: SidebarUiState,
  sidebarDocked: boolean,
): SidebarUiState {
  if (sidebarDocked) {
    return {
      sidebarDocked: true,
      sidebarOpen: false,
      sidebarOpenedByPointer: false,
    }
  }

  return {
    ...current,
    sidebarDocked: false,
  }
}

export const appUiStore = createStore<AppUiStore>()((set) => ({
  ...initialChatModelMenuUiState(),
  ...initialComposerModeUiState(),
  ...initialConversationSearchUiState(),
  ...initialConversationTitleEditUiState(),
  ...initialDangerConfirmationUiState(),
  ...initialFirstRunGuideUiState(),
  ...initialMessageListUiState(),
  ...initialProviderSelectionUiState(),
  ...initialSettingsOverlayUiState(),
  ...initialSidebarUiState(),
  closeChatModelMenuState: () => {
    set({ chatModelMenuOpen: false })
  },
  clearConversationSearchState: () => {
    set(initialConversationSearchUiState())
  },
  clearConversationTitleEditState: (draft = '') => {
    set({
      conversationTitleDraft: draft,
      editingConversationTitleId: '',
    })
  },
  clearDangerPromptState: () => {
    set(initialDangerConfirmationUiState())
  },
  clearGuideSuccessPendingState: () => {
    set({ guideSuccessPending: false })
  },
  closeSidebarState: () => {
    set({
      sidebarOpen: false,
      sidebarOpenedByPointer: false,
    })
  },
  hideNewMessagesButtonState: () => {
    set({ showNewMessagesButton: false })
  },
  openSidebarState: (openedByPointer = false) => {
    set({
      sidebarOpen: true,
      sidebarOpenedByPointer: openedByPointer,
    })
  },
  selectChatModelMenuOptionState: (providerId) => {
    set({
      chatModelMenuOpen: false,
      expandedChatProviderId: providerId,
    })
  },
  setConversationSearchState: (search) => {
    set({ conversationSearch: search })
  },
  setConversationTitleDraftState: (draft) => {
    set({ conversationTitleDraft: draft })
  },
  setDangerSkipCheckedState: (checked) => {
    set({ dangerSkipChecked: checked })
  },
  setComposerModeState: (mode) => {
    set({ composerMode: mode })
  },
  setExpandedChatProviderState: (providerId) => {
    set({ expandedChatProviderId: providerId })
  },
  setGuideOpenState: (open) => {
    set({ guideOpen: open })
  },
  setGuideSuccessPendingState: (pending) => {
    set({ guideSuccessPending: pending })
  },
  setImageTaskModeState: (mode) => {
    set({ imageTaskMode: mode })
  },
  setSelectedProviderIdState: (providerId) => {
    set({ selectedProviderId: providerId })
  },
  setSelectedPresetIdState: (presetId) => {
    set({ selectedPresetId: presetId })
  },
  setSettingsOpenState: (open) => {
    set({ settingsOpen: open })
  },
  setSettingsTabState: (tab) => {
    set({ settingsTab: tab })
  },
  setSidebarDockedState: (sidebarDocked) => {
    set((state) => sidebarStateForDockChange(state, sidebarDocked))
  },
  startConversationTitleEditState: (conversationId, title) => {
    set({
      conversationTitleDraft: title,
      editingConversationTitleId: conversationId,
    })
  },
  showDangerPromptState: (prompt) => {
    set({
      dangerPrompt: prompt,
      dangerSkipChecked: false,
    })
  },
  showNewMessagesButtonState: () => {
    set({ showNewMessagesButton: true })
  },
  toggleChatModelMenuState: (defaultExpandedProviderId) => {
    set((state) => chatModelMenuStateForToggle(state, defaultExpandedProviderId))
  },
}))

export function resetAppUiStoreForTests(
  state: Partial<
    ChatModelMenuUiState &
      ComposerModeUiState &
      ConversationSearchUiState &
      ConversationTitleEditUiState &
      DangerConfirmationUiState &
      FirstRunGuideUiState &
      MessageListUiState &
      ProviderSelectionUiState &
      SettingsOverlayUiState &
      SidebarUiState
  > = {},
): void {
  appUiStore.setState({
    ...initialChatModelMenuUiState(),
    ...initialComposerModeUiState(),
    ...initialConversationSearchUiState(),
    ...initialConversationTitleEditUiState(),
    ...initialDangerConfirmationUiState(),
    ...initialFirstRunGuideUiState(),
    ...initialMessageListUiState(),
    ...initialProviderSelectionUiState(),
    ...initialSettingsOverlayUiState(),
    ...initialSidebarUiState(false),
    ...state,
  })
}
