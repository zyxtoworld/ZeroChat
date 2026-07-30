import {
  MessageSquarePlus,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import type {
  MouseEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'
import type { Translator } from '../i18n'
import { displayConversationTitle } from '../services/conversations'
import type { SyncChromeState } from '../services/syncChrome'
import type { Conversation } from '../types'
import { AppLogo } from './AppLogo'
import type { SettingsTab } from './SettingsNav'
import { SyncStatusButton } from './SyncStatusButton'

interface SidebarProps {
  activeConversationId: string
  closeButtonRef: RefObject<HTMLButtonElement | null>
  conversationSearch: string
  conversationSearchActive: boolean
  conversations: Conversation[]
  hiddenFromAssistiveTech: boolean
  isOpen: boolean
  newConversationShortcut: string
  newConversationTitle: string
  notice: ReactNode
  openedByPointer: boolean
  sidebarTabIndex: number | undefined
  syncChrome: SyncChromeState
  syncing: boolean
  t: Translator
  timeLabel: (timestamp: number) => string
  onCloseSidebar: (restoreFocus?: boolean) => void
  onConversationSearchChange: (value: string) => void
  onCreateConversation: () => void
  onDeleteConversation: (conversationId: string) => void
  onOpenSettings: (
    event?: { currentTarget: EventTarget | null },
    initialTab?: SettingsTab,
  ) => void
  onSelectConversation: (conversationId: string) => void
}

export function Sidebar({
  activeConversationId,
  closeButtonRef,
  conversationSearch,
  conversationSearchActive,
  conversations,
  hiddenFromAssistiveTech,
  isOpen,
  newConversationShortcut,
  newConversationTitle,
  notice,
  openedByPointer,
  sidebarTabIndex,
  syncChrome,
  syncing,
  t,
  timeLabel,
  onCloseSidebar,
  onConversationSearchChange,
  onCreateConversation,
  onDeleteConversation,
  onOpenSettings,
  onSelectConversation,
}: SidebarProps): ReactElement {
  function closeFromEvent(event: MouseEvent<HTMLButtonElement>): void {
    if (event.detail > 0) {
      onCloseSidebar(false)
      event.currentTarget.blur()
      return
    }

    onCloseSidebar()
  }

  return (
    <>
      <aside
        className={`sidebar ${isOpen ? 'open' : ''}`}
        data-pointer-open={openedByPointer ? 'true' : undefined}
        aria-hidden={hiddenFromAssistiveTech ? true : undefined}
        inert={hiddenFromAssistiveTech ? true : undefined}
      >
        <div className="brand-row">
          <button
            ref={closeButtonRef}
            className="icon-button mobile-only"
            type="button"
            tabIndex={sidebarTabIndex}
            aria-label={t('button.closeSidebar')}
            onClick={closeFromEvent}
          >
            <X size={18} />
          </button>
          <div className="brand-lockup">
            <AppLogo size="brand" />
            <div className="brand-copy">
              <strong>ZeroChat</strong>
              <span>{t('app.localFirst')}</span>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            tabIndex={sidebarTabIndex}
            aria-keyshortcuts={newConversationShortcut}
            aria-label={newConversationTitle}
            onClick={onCreateConversation}
          >
            <MessageSquarePlus size={18} />
          </button>
        </div>

        <SyncStatusButton
          syncChrome={syncChrome}
          syncing={syncing}
          tabIndex={sidebarTabIndex}
          variant="sidebar"
          onOpenSyncSettings={(event) => onOpenSettings(event, 'sync')}
        />

        <div className="conversation-search" role="search">
          <Search className="conversation-search-icon" size={16} />
          <input
            type="text"
            tabIndex={sidebarTabIndex}
            aria-label={t('conversation.searchLabel')}
            placeholder={t('conversation.searchPlaceholder')}
            value={conversationSearch}
            onChange={(event) =>
              onConversationSearchChange(event.target.value)
            }
          />
          {conversationSearchActive ? (
            <button
              className="icon-button conversation-search-clear"
              type="button"
              tabIndex={sidebarTabIndex}
              aria-label={t('conversation.searchClear')}
              onClick={() => onConversationSearchChange('')}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        <nav className="conversation-list" aria-label={t('conversation.list')}>
          {conversations.length > 0 ? (
            conversations.map((conversation) => {
              const conversationTitle = displayConversationTitle(
                conversation.title,
                t,
              )
              const conversationIsActive =
                conversation.id === activeConversationId
              const deleteConversationLabel = `${t('button.deleteConversation')}: ${conversationTitle}`

              return (
                <div
                  className={`conversation-row ${
                    conversationIsActive ? 'active' : ''
                  }`}
                  key={conversation.id}
                >
                  <button
                    className="conversation-select"
                    type="button"
                    tabIndex={sidebarTabIndex}
                    aria-current={conversationIsActive ? 'page' : undefined}
                    onClick={() => onSelectConversation(conversation.id)}
                  >
                    <span>{conversationTitle}</span>
                    <small>{timeLabel(conversation.updatedAt)}</small>
                  </button>
                  <button
                    className="icon-button conversation-delete"
                    type="button"
                    tabIndex={sidebarTabIndex}
                    aria-label={deleteConversationLabel}
                    onClick={() => onDeleteConversation(conversation.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })
          ) : (
            <div className="conversation-empty" role="status" aria-live="polite">
              <div className="conversation-empty-icon" aria-hidden="true">
                <Search size={18} />
              </div>
              <strong>{t('conversation.searchNoResultsTitle')}</strong>
              <p>{t('conversation.searchNoResultsBody')}</p>
            </div>
          )}
        </nav>
        {notice}

        <div className="sidebar-actions">
          <button
            className="ghost-button"
            type="button"
            data-settings-opener="true"
            tabIndex={sidebarTabIndex}
            onClick={onOpenSettings}
          >
            <Settings size={16} />
            {t('settings.title')}
          </button>
        </div>
      </aside>

      {isOpen ? (
        <button
          className="sidebar-backdrop mobile-only"
          type="button"
          aria-label={t('button.closeSidebar')}
          onClick={closeFromEvent}
        />
      ) : null}
    </>
  )
}
