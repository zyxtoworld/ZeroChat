import {
  Bot,
  Download,
  Pencil,
  RefreshCw,
  Send,
  Square,
  Trash2,
  User,
  Volume2,
  X,
} from 'lucide-react'
import type {
  MouseEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
} from 'react'
import type { Translator } from '../i18n'
import {
  imageAttachmentSrc,
  isGeneratedImageNotice,
} from '../services/imageAttachments'
import {
  assistantMessageClass,
  downloadableMessageAttachment,
  messageActionAccessibleName,
  messageCanSpeak,
  messageAccessibleName,
  messageStatusText,
} from '../services/messageRendering'
import type {
  ChatMessage,
  MessageAttachment,
} from '../types'
import {
  runMessageAction,
  type MessageActionResult,
} from './MessageActionBoundary'
import {
  MessageContent,
  StreamingTypingIndicator,
} from './MessageContent'

export type { MessageActionResult } from './MessageActionBoundary'

interface MessageBubbleProps {
  editingContent: string
  formatMessageTime: (value: number) => string
  isEditing: boolean
  message: ChatMessage
  renderMessageNotice: (messageId: string) => ReactNode
  sending: boolean
  speakingMessageId: string
  t: Translator
  onCancelEditingMessage: () => void
  onDeleteMessage: (messageId: string) => MessageActionResult
  onDownloadAttachment: (
    message: ChatMessage,
    attachment: MessageAttachment,
  ) => void
  onEditContentChange: (value: string) => void
  onFinishLongPress: (event: PointerEvent<HTMLElement>) => void
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
  onRegenerateAssistantMessage: (messageId: string) => MessageActionResult
  onSpeakMessage: (message: ChatMessage) => MessageActionResult
  onStartEditingMessage: (message: ChatMessage) => void
  onStopSpeakingMessage: () => void
  onSubmitEditedUserMessage: () => MessageActionResult
}

export function MessageBubble({
  editingContent,
  formatMessageTime,
  isEditing,
  message,
  renderMessageNotice,
  sending,
  speakingMessageId,
  t,
  onCancelEditingMessage,
  onDeleteMessage,
  onDownloadAttachment,
  onEditContentChange,
  onFinishLongPress,
  onMessageContextMenu,
  onMessageLongPressCancel,
  onMessageLongPressMove,
  onMessageLongPressStart,
  onRegenerateAssistantMessage,
  onSpeakMessage,
  onStartEditingMessage,
  onStopSpeakingMessage,
  onSubmitEditedUserMessage,
}: MessageBubbleProps): ReactElement {
  const isStreaming = message.status === 'streaming'
  const isQueued = message.status === 'queued'
  const isError = message.status === 'error'
  const showErrorInMeta =
    Boolean(message.error) && message.error !== message.content
  const downloadableAttachment = downloadableMessageAttachment(message)
  const senderLabel =
    message.role === 'user'
      ? t('message.role.user')
      : t('message.role.assistant')
  const messageTime = formatMessageTime(message.createdAt)
  const messageStatus = messageStatusText(message, {
    error: t('message.error'),
    queued: t('message.queued'),
    streaming: t('message.streaming'),
  })
  const hideGeneratedImageNotice =
    Boolean(downloadableAttachment) &&
    isGeneratedImageNotice(message.content, t)
  const canSpeakMessage = messageCanSpeak(message)
  const isSpeaking = speakingMessageId === message.id
  const messageAccessibleLabel = messageAccessibleName({
    message,
    senderLabel,
    statusLabel: messageStatus,
    timeLabel: messageTime,
  })
  const messageActionLabel = (action: string, subject?: string): string => {
    return messageActionAccessibleName(action, messageAccessibleLabel, subject)
  }
  const speakMessageLabel = messageActionLabel(
    isSpeaking ? t('button.stopSpeaking') : t('button.speakMessage'),
  )
  const downloadMessageLabel = messageActionLabel(
    t('button.downloadImage'),
    downloadableAttachment?.alt?.trim() || t('message.imageGenerated'),
  )
  const editMessageLabel = messageActionLabel(t('button.editMessage'))
  const retryMessageLabel = messageActionLabel(
    isError ? t('button.retry') : t('button.regenerate'),
  )
  const deleteMessageLabel = messageActionLabel(t('button.deleteMessage'))
  const sendEditedMessageLabel = messageActionLabel(
    t('button.sendEditedMessage'),
  )
  const cancelEditMessageLabel = messageActionLabel(t('button.cancel'))

  return (
    <article
      className={assistantMessageClass(message)}
      data-message-id={message.id}
      aria-label={messageAccessibleLabel}
      tabIndex={-1}
      onContextMenu={(event) => onMessageContextMenu(event, message)}
      onPointerDown={(event) => onMessageLongPressStart(event, message)}
      onPointerMove={onMessageLongPressMove}
      onPointerUp={onFinishLongPress}
      onPointerCancel={onFinishLongPress}
      onPointerLeave={() => onMessageLongPressCancel()}
    >
      <div className="avatar">
        {message.role === 'user' ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div className="message-body">
        <div className="message-meta">
          <strong>{senderLabel}</strong>
          <span className="message-time">{messageTime}</span>
          {isStreaming ? <span>{t('message.streaming')}</span> : null}
          {isQueued ? <span>{t('message.queued')}</span> : null}
          {showErrorInMeta ? <span>{message.error}</span> : null}
          {!showErrorInMeta && isError ? (
            <span>{t('message.error')}</span>
          ) : null}
          {!isStreaming && !isQueued ? (
            <div className="message-actions">
              {canSpeakMessage ? (
                <button
                  type="button"
                  data-tooltip={speakMessageLabel}
                  aria-label={speakMessageLabel}
                  onClick={() =>
                    isSpeaking
                      ? onStopSpeakingMessage()
                      : runMessageAction(onSpeakMessage, message)
                  }
                  disabled={sending && !isSpeaking}
                >
                  {isSpeaking ? <Square size={14} /> : <Volume2 size={14} />}
                </button>
              ) : null}
              {downloadableAttachment ? (
                <button
                  type="button"
                  data-tooltip={downloadMessageLabel}
                  aria-label={downloadMessageLabel}
                  onClick={() =>
                    onDownloadAttachment(message, downloadableAttachment)
                  }
                  disabled={sending}
                >
                  <Download size={14} />
                </button>
              ) : null}
              {message.role === 'user' ? (
                <button
                  type="button"
                  data-tooltip={editMessageLabel}
                  aria-label={editMessageLabel}
                  onClick={() => onStartEditingMessage(message)}
                  disabled={sending}
                >
                  <Pencil size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  className={isError ? 'message-retry-button' : undefined}
                  data-message-retry-action={isError ? 'true' : undefined}
                  data-tooltip={retryMessageLabel}
                  aria-label={retryMessageLabel}
                  onClick={() =>
                    runMessageAction(onRegenerateAssistantMessage, message.id)
                  }
                  disabled={sending}
                >
                  <RefreshCw size={14} />
                  {isError ? <span>{t('button.retry')}</span> : null}
                </button>
              )}
              <button
                type="button"
                data-tooltip={deleteMessageLabel}
                aria-label={deleteMessageLabel}
                onClick={() => runMessageAction(onDeleteMessage, message.id)}
                disabled={sending}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : null}
        </div>
        {isEditing ? (
          <div className="message-editor">
            <textarea
              value={editingContent}
              onChange={(event) => onEditContentChange(event.target.value)}
              rows={Math.min(
                8,
                Math.max(3, editingContent.split('\n').length),
              )}
              aria-label={editMessageLabel}
            />
            <div className="message-editor-actions">
              <button
                type="button"
                aria-label={sendEditedMessageLabel}
                onClick={() => runMessageAction(onSubmitEditedUserMessage)}
              >
                <Send size={14} />
                {t('button.send')}
              </button>
              <button
                type="button"
                aria-label={cancelEditMessageLabel}
                onClick={onCancelEditingMessage}
              >
                <X size={14} />
                {t('button.cancel')}
              </button>
            </div>
            {renderMessageNotice(message.id)}
          </div>
        ) : (
          <>
            {renderMessageNotice(message.id)}
            {message.content && !hideGeneratedImageNotice ? (
              <MessageContent
                content={message.content}
                copiedLabel={t('button.copied')}
                copyCodeLabel={t('button.copyCode')}
                copyFailedLabel={t('button.copyFailed')}
                copyLabel={t('button.copy')}
                markdownFallbackLabel={t('message.markdownFallback')}
                streaming={isStreaming && message.role === 'assistant'}
              />
            ) : null}
            {message.attachments?.length ? (
              <div className="message-attachments">
                {message.attachments.map((attachment) => {
                  const src = imageAttachmentSrc(attachment)

                  if (!src || attachment.purpose === 'mask') {
                    return null
                  }

                  const isGenerated =
                    attachment.purpose === 'generated' || !attachment.purpose
                  const attachmentAlt =
                    attachment.alt?.trim() || t('message.imageGenerated')
                  const attachmentDownloadLabel = messageActionLabel(
                    t('button.downloadImage'),
                    attachmentAlt,
                  )

                  return (
                    <figure
                      key={attachment.id}
                      className={`attachment-frame ${
                        isGenerated ? 'generated' : 'source'
                      }`}
                    >
                      <img
                        className="generated-image"
                        src={src}
                        alt={attachmentAlt}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      <button
                        className="attachment-download-button"
                        type="button"
                        data-attachment-download="true"
                        data-tooltip={attachmentDownloadLabel}
                        aria-label={attachmentDownloadLabel}
                        onClick={() => onDownloadAttachment(message, attachment)}
                        disabled={sending}
                      >
                        <Download size={15} />
                      </button>
                    </figure>
                  )
                })}
              </div>
            ) : null}
            {!message.content && !message.attachments?.length ? (
              isStreaming && message.role === 'assistant' ? (
                <StreamingTypingIndicator label={t('message.streaming')} />
              ) : (
                <p>...</p>
              )
            ) : null}
          </>
        )}
      </div>
    </article>
  )
}
