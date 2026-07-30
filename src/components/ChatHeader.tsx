import {
  Menu,
  Settings,
} from 'lucide-react'
import type {
  KeyboardEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'
import type { Translator } from '../i18n'
import type {
  ComposerMode,
  ImageTaskMode,
} from '../services/imageComposerChrome'
import type { SyncChromeState } from '../services/syncChrome'
import type { ProviderConfig } from '../types'
import { AppLogo } from './AppLogo'
import { ChatHeaderTitle } from './ChatHeaderTitle'
import { ChatProviderModelMenu } from './ChatProviderModelMenu'
import type { SettingsTab } from './SettingsNav'
import { SyncStatusButton } from './SyncStatusButton'

interface ChatHeaderProps {
  activeConversationTitle: string
  activeImageModel: string
  activeModel: string
  activeModelLabel: string
  activeProvider: ProviderConfig | null
  activeProviderLabel: string
  chatModelMenuOpen: boolean
  chatModelMenuRef: RefObject<HTMLDivElement | null>
  chatModelProviders: ProviderConfig[]
  chatModelTriggerRef: RefObject<HTMLButtonElement | null>
  composerMode: ComposerMode
  imageTaskMode: ImageTaskMode
  sidebarOpenButtonRef: RefObject<HTMLButtonElement | null>
  conversationTitleButtonRef: RefObject<HTMLButtonElement | null>
  conversationTitleDraft: string
  conversationTitleInputRef: RefObject<HTMLInputElement | null>
  editingConversationTitle: boolean
  expandedChatProviderId: string
  isOnline: boolean
  providerModelHint: ReactNode
  syncChrome: SyncChromeState
  syncing: boolean
  t: Translator
  onConversationTitleBlur: () => void
  onConversationTitleDraftChange: (value: string) => void
  onConversationTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onOpenSettings: (
    event?: { currentTarget: EventTarget | null },
    initialTab?: SettingsTab,
  ) => void
  onSelectAudioTranscriptionModel: (
    providerId: string,
    model: string,
  ) => void
  onOpenSidebar: (openedByPointer?: boolean) => void
  onSelectChatModel: (providerId: string, model: string) => void
  onSelectImageModel: (providerId: string, model: string) => void
  onStartConversationTitleEdit: () => void
  onToggleModelMenu: () => void
  onToggleProviderExpanded: (providerId: string, expanded: boolean) => void
}

export function ChatHeader({
  activeConversationTitle,
  activeImageModel,
  activeModel,
  activeModelLabel,
  activeProvider,
  activeProviderLabel,
  chatModelMenuOpen,
  chatModelMenuRef,
  chatModelProviders,
  chatModelTriggerRef,
  composerMode,
  imageTaskMode,
  sidebarOpenButtonRef,
  conversationTitleButtonRef,
  conversationTitleDraft,
  conversationTitleInputRef,
  editingConversationTitle,
  expandedChatProviderId,
  isOnline,
  providerModelHint,
  syncChrome,
  syncing,
  t,
  onConversationTitleBlur,
  onConversationTitleDraftChange,
  onConversationTitleKeyDown,
  onOpenSettings,
  onOpenSidebar,
  onSelectAudioTranscriptionModel,
  onSelectChatModel,
  onSelectImageModel,
  onStartConversationTitleEdit,
  onToggleModelMenu,
  onToggleProviderExpanded,
}: ChatHeaderProps): ReactElement {
  const openSidebarLabel = t('button.openSidebar')
  const openSettingsLabel = t('button.openSettings')

  return (
    <>
      <header className="chat-header">
        <button
          ref={sidebarOpenButtonRef}
          className="icon-button mobile-only"
          type="button"
          aria-label={openSidebarLabel}
          data-tooltip={openSidebarLabel}
          onClick={(event) => onOpenSidebar(event.detail > 0)}
        >
          <Menu size={18} />
        </button>
        <span className="chat-header-logo" aria-hidden="true">
          <AppLogo size="brand" />
        </span>
        <ChatHeaderTitle
          activeConversationTitle={activeConversationTitle}
          conversationTitleButtonRef={conversationTitleButtonRef}
          conversationTitleDraft={conversationTitleDraft}
          conversationTitleInputRef={conversationTitleInputRef}
          editingConversationTitle={editingConversationTitle}
          t={t}
          onConversationTitleBlur={onConversationTitleBlur}
          onConversationTitleDraftChange={onConversationTitleDraftChange}
          onConversationTitleKeyDown={onConversationTitleKeyDown}
          onStartConversationTitleEdit={onStartConversationTitleEdit}
        />
        <button
          className="icon-button mobile-only"
          type="button"
          data-settings-opener="true"
          aria-label={openSettingsLabel}
          data-tooltip={openSettingsLabel}
          onClick={onOpenSettings}
        >
          <Settings size={18} />
        </button>
        <ChatProviderModelMenu
          activeImageModel={activeImageModel}
          activeModel={activeModel}
          activeModelLabel={activeModelLabel}
          activeProvider={activeProvider}
          activeProviderLabel={activeProviderLabel}
          chatModelMenuOpen={chatModelMenuOpen}
          chatModelMenuRef={chatModelMenuRef}
          chatModelProviders={chatModelProviders}
          chatModelTriggerRef={chatModelTriggerRef}
          composerMode={composerMode}
          expandedChatProviderId={expandedChatProviderId}
          imageTaskMode={imageTaskMode}
          providerModelHint={providerModelHint}
          t={t}
          onSelectAudioTranscriptionModel={onSelectAudioTranscriptionModel}
          onSelectChatModel={onSelectChatModel}
          onSelectImageModel={onSelectImageModel}
          onToggleModelMenu={onToggleModelMenu}
          onToggleProviderExpanded={onToggleProviderExpanded}
        />
        <SyncStatusButton
          syncChrome={syncChrome}
          syncing={syncing}
          variant="header"
          onOpenSyncSettings={(event) => onOpenSettings(event, 'sync')}
        />
      </header>

      {!isOnline ? (
        <div className="offline-banner" role="status" aria-live="polite">
          {t('notice.offlineBanner')}
        </div>
      ) : null}
    </>
  )
}
