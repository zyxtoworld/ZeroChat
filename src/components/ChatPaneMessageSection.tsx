import type { ReactElement } from 'react'

import { downloadMessageImageAttachment } from '../services/imageAttachments'
import { messageTimeLabel } from '../services/uiRuntime'
import type {
  ChatMessage,
  MessageAttachment,
} from '../types'
import { MessageContextMenu } from './MessageContextMenu'
import { MessageList } from './MessageList'
import {
  MessageNotice,
  TargetNotice,
} from './Notice'
import type { ChatPaneViewProps } from './ChatPaneTypes'

type ChatPaneMessageSectionProps = Pick<
  ChatPaneViewProps,
  | 'activeConversation'
  | 'composerMode'
  | 'editingContent'
  | 'editingMessageId'
  | 'systemDateLocales'
  | 'messageListRef'
  | 'messageVirtualizationEnabled'
  | 'renderedMessages'
  | 'resolvedMessageVirtualRange'
  | 'sending'
  | 'showNewMessagesButton'
  | 't'
  | 'composerChrome'
  | 'currentNotice'
  | 'settingsOpen'
  | 'setNotice'
  | 'speakMessage'
  | 'speakingMessageId'
  | 'guideVisible'
  | 'applyWelcomePrompt'
  | 'cancelEditingMessage'
  | 'deleteMessage'
  | 'finishMessageLongPress'
  | 'jumpToLatestMessages'
  | 'openMessageContextMenu'
  | 'cancelMessageLongPress'
  | 'moveMessageLongPress'
  | 'startMessageLongPress'
  | 'openSettings'
  | 'regenerateAssistantMessage'
  | 'handleMessageListScroll'
  | 'startEditingMessage'
  | 'stopSpeakingMessage'
  | 'submitEditedUserMessage'
  | 'messageContextMenu'
  | 'messageContextMenuMessage'
  | 'messageContextMenuRef'
  | 'closeMessageContextMenu'
  | 'copyMessage'
  | 'handleMessageContextMenuKeyDown'
  | 'setEditingContent'
>

export function ChatPaneMessageSection({
  activeConversation,
  composerMode,
  editingContent,
  editingMessageId,
  systemDateLocales,
  messageListRef,
  messageVirtualizationEnabled,
  renderedMessages,
  resolvedMessageVirtualRange,
  sending,
  showNewMessagesButton,
  t,
  composerChrome,
  currentNotice,
  settingsOpen,
  setNotice,
  speakMessage,
  speakingMessageId,
  guideVisible,
  applyWelcomePrompt,
  cancelEditingMessage,
  deleteMessage,
  finishMessageLongPress,
  jumpToLatestMessages,
  openMessageContextMenu,
  cancelMessageLongPress,
  moveMessageLongPress,
  startMessageLongPress,
  openSettings,
  regenerateAssistantMessage,
  handleMessageListScroll,
  startEditingMessage,
  stopSpeakingMessage,
  submitEditedUserMessage,
  messageContextMenu,
  messageContextMenuMessage,
  messageContextMenuRef,
  closeMessageContextMenu,
  copyMessage,
  handleMessageContextMenuKeyDown,
  setEditingContent,
}: ChatPaneMessageSectionProps): ReactElement {
  const formatMessageTime = (value: number): string =>
    messageTimeLabel(value, systemDateLocales)
  const downloadMessageAttachment = (
    message: ChatMessage,
    attachment: MessageAttachment,
  ): void => {
    downloadMessageImageAttachment({
      attachment,
      message,
      setNotice,
      t,
    })
  }

  return (
    <>
      <MessageList
        activeConversation={activeConversation}
        composerMode={composerMode}
        editingContent={editingContent}
        editingMessageId={editingMessageId}
        formatMessageTime={formatMessageTime}
        messageListRef={messageListRef}
        messageVirtualizationEnabled={messageVirtualizationEnabled}
        renderedMessages={renderedMessages}
        renderMessageNotice={(messageId) => (
          <MessageNotice
            notice={currentNotice}
            messageId={messageId}
            hidden={settingsOpen || guideVisible}
          />
        )}
        resolvedMessageVirtualRange={resolvedMessageVirtualRange}
        sending={sending}
        showNewMessagesButton={showNewMessagesButton}
        t={t}
        welcomeHint={composerChrome.welcomeHint}
        welcomeSetupRequired={composerChrome.welcomeSetupRequired}
        welcomeTitle={composerChrome.welcomeTitle}
        onApplyWelcomePrompt={applyWelcomePrompt}
        onCancelEditingMessage={cancelEditingMessage}
        onDeleteMessage={deleteMessage}
        onDownloadAttachment={downloadMessageAttachment}
        onEditContentChange={setEditingContent}
        onFinishLongPress={finishMessageLongPress}
        onJumpToLatestMessages={jumpToLatestMessages}
        onMessageContextMenu={openMessageContextMenu}
        onMessageLongPressCancel={cancelMessageLongPress}
        onMessageLongPressMove={moveMessageLongPress}
        onMessageLongPressStart={startMessageLongPress}
        onOpenWelcomeSettings={(event) =>
          openSettings(event, composerChrome.welcomeSettingsTab)
        }
        onRegenerateAssistantMessage={regenerateAssistantMessage}
        onScroll={handleMessageListScroll}
        onSpeakMessage={speakMessage}
        onStartEditingMessage={startEditingMessage}
        onStopSpeakingMessage={stopSpeakingMessage}
        onSubmitEditedUserMessage={submitEditedUserMessage}
        speakingMessageId={speakingMessageId}
      />

      {messageContextMenu && messageContextMenuMessage ? (
        <MessageContextMenu
          formatMessageTime={formatMessageTime}
          menu={messageContextMenu}
          menuRef={messageContextMenuRef}
          message={messageContextMenuMessage}
          sending={sending}
          t={t}
          onClose={closeMessageContextMenu}
          onCopyMessage={copyMessage}
          onDeleteMessage={deleteMessage}
          onDownloadAttachment={downloadMessageAttachment}
          onKeyDown={handleMessageContextMenuKeyDown}
          onRegenerateAssistantMessage={regenerateAssistantMessage}
          onSpeakMessage={speakMessage}
          onStartEditingMessage={startEditingMessage}
          onStopSpeakingMessage={stopSpeakingMessage}
          speakingMessageId={speakingMessageId}
        />
      ) : null}

      <TargetNotice
        notice={currentNotice}
        targets={['chat']}
        variant="plain"
        hidden={settingsOpen || guideVisible}
      />
    </>
  )
}
