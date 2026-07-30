import type { ReactElement } from 'react'

import { ChatPaneComposerSection } from './ChatPaneComposerSection'
import { ChatPaneMessageSection } from './ChatPaneMessageSection'
import type { ChatPaneViewProps } from './ChatPaneTypes'
import { ChatHeader } from './ChatHeader'

export type {
  ChatPaneViewProps,
  OpenSettingsHandler,
} from './ChatPaneTypes'

export function ChatPaneView(props: ChatPaneViewProps): ReactElement {
  const {
    activeConversationTitle,
    activeImageModel,
    activeModel,
    activeProvider,
    chatModelMenuOpen,
    chatModelMenuRef,
    chatModelProviders,
    chatModelTriggerRef,
    chatPaneHiddenFromAssistiveTech,
    composerMode,
    composerReadiness,
    conversationTitleButtonRef,
    conversationTitleDraft,
    conversationTitleInputRef,
    editingConversationTitle,
    expandedChatProviderId,
    imageTaskMode,
    isOnline,
    renderFeatureHint,
    sidebarOpenButtonRef,
    syncChrome,
    syncing,
    t,
    handleConversationTitleBlur,
    handleConversationTitleKeyDown,
    openSettings,
    openSidebar,
    selectConversationAudioTranscriptionModel,
    selectConversationImageModel,
    selectConversationProviderModel,
    setConversationTitleDraft,
    startConversationTitleEdit,
    toggleChatModelMenu,
    toggleChatModelProviderExpanded,
  } = props

  return (
    <main
      className={`chat-pane ${
        composerMode === 'image'
          ? 'chat-pane-image'
          : composerMode === 'audio'
            ? 'chat-pane-audio'
            : 'chat-pane-chat'
      } ${
        composerMode === 'image' && imageTaskMode !== 'generate'
          ? 'chat-pane-image-tools'
          : ''
      }`}
      aria-hidden={chatPaneHiddenFromAssistiveTech ? true : undefined}
      inert={chatPaneHiddenFromAssistiveTech ? true : undefined}
    >
      <ChatHeader
        activeConversationTitle={activeConversationTitle}
        activeImageModel={activeImageModel}
        activeModel={activeModel}
        activeModelLabel={composerReadiness.activeModelLabel}
        activeProvider={activeProvider}
        activeProviderLabel={composerReadiness.activeProviderLabel}
        chatModelMenuOpen={chatModelMenuOpen}
        chatModelMenuRef={chatModelMenuRef}
        chatModelProviders={chatModelProviders}
        chatModelTriggerRef={chatModelTriggerRef}
        composerMode={composerMode}
        conversationTitleButtonRef={conversationTitleButtonRef}
        conversationTitleDraft={conversationTitleDraft}
        conversationTitleInputRef={conversationTitleInputRef}
        editingConversationTitle={editingConversationTitle}
        expandedChatProviderId={expandedChatProviderId}
        imageTaskMode={imageTaskMode}
        isOnline={isOnline}
        providerModelHint={renderFeatureHint('provider-model', 'menu')}
        syncChrome={syncChrome}
        sidebarOpenButtonRef={sidebarOpenButtonRef}
        syncing={syncing}
        t={t}
        onConversationTitleBlur={handleConversationTitleBlur}
        onConversationTitleDraftChange={setConversationTitleDraft}
        onConversationTitleKeyDown={handleConversationTitleKeyDown}
        onOpenSettings={openSettings}
        onOpenSidebar={openSidebar}
        onSelectAudioTranscriptionModel={
          selectConversationAudioTranscriptionModel
        }
        onSelectChatModel={selectConversationProviderModel}
        onSelectImageModel={selectConversationImageModel}
        onStartConversationTitleEdit={startConversationTitleEdit}
        onToggleModelMenu={() =>
          toggleChatModelMenu(activeProvider, chatModelProviders)
        }
        onToggleProviderExpanded={toggleChatModelProviderExpanded}
      />

      {!chatModelMenuOpen && composerMode !== 'audio'
        ? renderFeatureHint(
            composerMode === 'image' ? 'image' : 'chat',
            'chat',
          )
        : null}

      <ChatPaneMessageSection {...props} />

      <ChatPaneComposerSection {...props} />
    </main>
  )
}
