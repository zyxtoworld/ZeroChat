import {
  ChevronDown,
} from 'lucide-react'
import type {
  MouseEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'
import type { Translator } from '../i18n'
import type { ComposerMode } from '../services/imageComposerChrome'
import {
  type MessageVirtualRange,
  virtualizedLatestAssistantAnnouncement,
} from '../services/messageVirtualization'
import type {
  ChatMessage,
  Conversation,
  MessageAttachment,
} from '../types'
import {
  MessageBubble,
  type MessageActionResult,
} from './MessageBubble'
import { WelcomePanel } from './WelcomePanel'

interface MessageListProps {
  activeConversation: Conversation
  composerMode: ComposerMode
  editingContent: string
  editingMessageId: string
  formatMessageTime: (value: number) => string
  messageListRef: RefObject<HTMLElement | null>
  messageVirtualizationEnabled: boolean
  renderedMessages: ChatMessage[]
  renderMessageNotice: (messageId: string) => ReactNode
  resolvedMessageVirtualRange: MessageVirtualRange
  sending: boolean
  showNewMessagesButton: boolean
  speakingMessageId: string
  t: Translator
  welcomeHint: string
  welcomeSetupRequired: boolean
  welcomeTitle: string
  onApplyWelcomePrompt: (prompt: string) => void
  onCancelEditingMessage: () => void
  onDeleteMessage: (messageId: string) => MessageActionResult
  onDownloadAttachment: (
    message: ChatMessage,
    attachment: MessageAttachment,
  ) => void
  onEditContentChange: (value: string) => void
  onFinishLongPress: (event: PointerEvent<HTMLElement>) => void
  onJumpToLatestMessages: () => void
  onMessageContextMenu: (
    event: MouseEvent<HTMLElement>,
    message: ChatMessage,
  ) => void
  onMessageLongPressCancel: () => void
  onMessageLongPressMove: (event: PointerEvent<HTMLElement>) => void
  onMessageLongPressStart: (
    event: PointerEvent<HTMLElement>,
    message: ChatMessage,
  ) => void
  onOpenWelcomeSettings: (event: MouseEvent<HTMLButtonElement>) => void
  onRegenerateAssistantMessage: (messageId: string) => MessageActionResult
  onScroll: () => void
  onSpeakMessage: (message: ChatMessage) => MessageActionResult
  onStartEditingMessage: (message: ChatMessage) => void
  onStopSpeakingMessage: () => void
  onSubmitEditedUserMessage: () => MessageActionResult
}

export function MessageList({
  activeConversation,
  composerMode,
  editingContent,
  editingMessageId,
  formatMessageTime,
  messageListRef,
  messageVirtualizationEnabled,
  renderedMessages,
  renderMessageNotice,
  resolvedMessageVirtualRange,
  sending,
  showNewMessagesButton,
  speakingMessageId,
  t,
  welcomeHint,
  welcomeSetupRequired,
  welcomeTitle,
  onApplyWelcomePrompt,
  onCancelEditingMessage,
  onDeleteMessage,
  onDownloadAttachment,
  onEditContentChange,
  onFinishLongPress,
  onJumpToLatestMessages,
  onMessageContextMenu,
  onMessageLongPressCancel,
  onMessageLongPressMove,
  onMessageLongPressStart,
  onOpenWelcomeSettings,
  onRegenerateAssistantMessage,
  onScroll,
  onSpeakMessage,
  onStartEditingMessage,
  onStopSpeakingMessage,
  onSubmitEditedUserMessage,
}: MessageListProps): ReactElement {
  const virtualizedAnnouncement = virtualizedLatestAssistantAnnouncement(
    activeConversation.messages,
    messageVirtualizationEnabled,
  )

  return (
    <div className="message-scroll-region">
      <section
        className="message-list"
        role="log"
        aria-label={t('message.transcriptLabel')}
        aria-live={messageVirtualizationEnabled ? 'off' : 'polite'}
        aria-relevant="additions text"
        aria-atomic="false"
        tabIndex={-1}
        ref={messageListRef}
        onScroll={onScroll}
      >
        {activeConversation.messages.length === 0 ? (
          <WelcomePanel
            mode={composerMode}
            t={t}
            title={welcomeTitle}
            hint={welcomeHint}
            setupRequired={welcomeSetupRequired}
            onOpenSettings={onOpenWelcomeSettings}
            onApplyPrompt={onApplyWelcomePrompt}
          />
        ) : (
          <>
            {messageVirtualizationEnabled &&
            resolvedMessageVirtualRange.topSpacer > 0 ? (
              <div
                className="message-virtual-spacer"
                data-message-virtual-spacer="top"
                aria-hidden="true"
                style={{
                  blockSize: `${resolvedMessageVirtualRange.topSpacer}px`,
                }}
              />
            ) : null}
            {renderedMessages.map((message) => (
              <MessageBubble
                editingContent={editingContent}
                formatMessageTime={formatMessageTime}
                isEditing={editingMessageId === message.id}
                key={message.id}
                message={message}
                renderMessageNotice={renderMessageNotice}
                sending={sending}
                speakingMessageId={speakingMessageId}
                t={t}
                onCancelEditingMessage={onCancelEditingMessage}
                onDeleteMessage={onDeleteMessage}
                onDownloadAttachment={onDownloadAttachment}
                onEditContentChange={onEditContentChange}
                onFinishLongPress={onFinishLongPress}
                onMessageContextMenu={onMessageContextMenu}
                onMessageLongPressCancel={onMessageLongPressCancel}
                onMessageLongPressMove={onMessageLongPressMove}
                onMessageLongPressStart={onMessageLongPressStart}
                onRegenerateAssistantMessage={onRegenerateAssistantMessage}
                onSpeakMessage={onSpeakMessage}
                onStartEditingMessage={onStartEditingMessage}
                onStopSpeakingMessage={onStopSpeakingMessage}
                onSubmitEditedUserMessage={onSubmitEditedUserMessage}
              />
            ))}
            {messageVirtualizationEnabled &&
            resolvedMessageVirtualRange.bottomSpacer > 0 ? (
              <div
                className="message-virtual-spacer"
                data-message-virtual-spacer="bottom"
                aria-hidden="true"
                style={{
                  blockSize: `${resolvedMessageVirtualRange.bottomSpacer}px`,
                }}
              />
            ) : null}
          </>
        )}
      </section>
      {messageVirtualizationEnabled ? (
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {virtualizedAnnouncement}
        </div>
      ) : null}
      {showNewMessagesButton && activeConversation.messages.length > 0 ? (
        <button
          className="new-messages-button"
          type="button"
          aria-label={t('button.newMessages')}
          onClick={onJumpToLatestMessages}
        >
          <ChevronDown size={16} />
          {t('button.newMessages')}
        </button>
      ) : null}
    </div>
  )
}
