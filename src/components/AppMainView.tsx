import type {
  ReactElement,
  RefObject,
} from 'react'

import type { Translator } from '../i18n'
import type { SyncChromeState } from '../services/syncChrome'
import { timeLabel } from '../services/uiRuntime'
import type { Conversation } from '../types'
import {
  ChatPaneView,
  type ChatPaneViewProps,
} from './ChatPaneView'
import {
  TargetNotice,
  type NoticeState,
} from './Notice'
import { Sidebar } from './Sidebar'

export interface AppMainViewProps extends ChatPaneViewProps {
  conversationSearch: string
  conversationSearchActive: boolean
  currentNotice: NoticeState
  filteredConversations: Conversation[]
  newConversationShortcut: string
  newConversationTitle: string
  sidebarCloseButtonRef: RefObject<HTMLButtonElement | null>
  sidebarHiddenFromAssistiveTech: boolean
  sidebarOpen: boolean
  sidebarOpenedByPointer: boolean
  sidebarTabIndex: number | undefined
  syncChrome: SyncChromeState
  syncing: boolean
  systemDateLocales: string[]
  t: Translator
  closeSidebar: (restoreFocus?: boolean) => void
  createNewConversation: () => void
  deleteConversation: (conversationId: string) => Promise<unknown>
  setActiveConversation: (conversationId: string) => void
  setConversationSearch: (value: string) => void
}

function reportSidebarDeleteFailure(
  context: Pick<AppMainViewProps, 'setNotice' | 't'>,
): void {
  try {
    context.setNotice(
      context.t('notice.conversationSaveUnavailable'),
      'error',
      'sidebar',
    )
  } catch {
    // Sidebar delete actions are fire-and-forget from the UI event boundary.
  }
}

export function AppMainView(props: AppMainViewProps): ReactElement {
  const {
    activeConversation,
    closeSidebar,
    conversationSearch,
    conversationSearchActive,
    createNewConversation,
  currentNotice,
  deleteConversation,
  filteredConversations,
  newConversationShortcut,
  newConversationTitle,
    openSettings,
  setActiveConversation,
  setConversationSearch,
  setNotice,
  sidebarCloseButtonRef,
  sidebarHiddenFromAssistiveTech,
  sidebarOpen,
    sidebarOpenedByPointer,
    sidebarTabIndex,
    syncChrome,
    syncing,
    systemDateLocales,
    t,
  } = props
  const handleDeleteConversation = (conversationId: string): void => {
    void (async () => {
      await deleteConversation(conversationId)
    })().catch(() => {
      reportSidebarDeleteFailure({ setNotice, t })
    })
  }

  return (
    <>
      <Sidebar
        activeConversationId={activeConversation.id}
        closeButtonRef={sidebarCloseButtonRef}
        conversationSearch={conversationSearch}
        conversationSearchActive={conversationSearchActive}
        conversations={filteredConversations}
        hiddenFromAssistiveTech={sidebarHiddenFromAssistiveTech}
        isOpen={sidebarOpen}
        newConversationShortcut={newConversationShortcut}
        newConversationTitle={newConversationTitle}
        notice={<TargetNotice notice={currentNotice} targets={['sidebar']} />}
        openedByPointer={sidebarOpenedByPointer}
        sidebarTabIndex={sidebarTabIndex}
        syncChrome={syncChrome}
        syncing={syncing}
        t={t}
        timeLabel={(timestamp) =>
          timeLabel(timestamp, systemDateLocales, t('time.neverSynced'))
        }
        onCloseSidebar={closeSidebar}
        onConversationSearchChange={setConversationSearch}
        onCreateConversation={createNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onOpenSettings={openSettings}
        onSelectConversation={setActiveConversation}
      />

      <ChatPaneView {...props} />
    </>
  )
}
