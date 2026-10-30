import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import type { ChatMessage, Conversation, MessageAttachment } from '../../types'
import { isMessageListNearBottom } from '../../services/composerLayout'
import {
  downloadImageAttachment,
  imageAttachmentSrc,
} from '../../services/imageAttachments'
import {
  restoreInteractionFocusTarget,
  scheduleInteractionFocus,
} from '../../services/interactionFocus'
import { redactSensitiveText } from '../../services/uiRuntime'
import { useMessageContextMenuController } from '../../services/messageContextMenuController'
import {
  calculateMessageVirtualRange,
  deriveResolvedMessageVirtualRange,
  emptyMessageVirtualRange,
  installMessageVirtualResizeObserver,
  MESSAGE_VIRTUALIZATION_THRESHOLD,
  scrollMessagesElementToLatest,
  virtualizedLatestAssistantAnnouncement,
} from '../../services/messageVirtualization'
import { messageCopyText, messageDisplayContent } from '../../services/messageRendering'
import { prefersReducedMotion } from '../../services/prefersReducedMotion'
import {
  createMarkdownLabels,
  formatTime,
  resolveAppLocale,
  type AppLocale,
} from '../i18n'
import { useAppStore, appT } from '../store'
import type { AppStringKey } from '../strings'
import {
  commitMessageEdit,
  reportMessageEditFailure,
} from '../messageEditSubmission'
import {
  copyMessageText,
  invalidateMessageCopyFeedback,
  notifyContained,
  runMessageCopyFeedbackAction,
  type MessageCopyFeedbackOwner,
} from '../messageActionFeedback'
import { Markdown } from './Markdown'
import { MessageContextMenu } from './MessageContextMenu'

interface MessageListProps {
  conversation: Conversation
  streaming: boolean
  onRegenerate: () => void
  onRetry: (messageId: string) => void
  onDelete: (messageId: string) => Promise<boolean>
  onEdit: (messageId: string, content: string) => Promise<boolean>
}

interface EditingState {
  id: string
  draft: string
}

type Translate = (key: AppStringKey) => string

// Mutable height cache lives outside React so render never touches refs.
const rowHeightCache = new Map<string, number>()

function CopyButton({ content, label }: { content: string; label: Translate }) {
  const [copiedContent, setCopiedContent] = useState<string | null>(null)
  const copyFeedbackOwnerRef = useRef<MessageCopyFeedbackOwner>({ generation: 0 })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copied = copiedContent === content

  useLayoutEffect(
    () => () => {
      invalidateMessageCopyFeedback(copyFeedbackOwnerRef.current)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
    },
    [content],
  )

  const copy = async () => {
    await runMessageCopyFeedbackAction(
      copyFeedbackOwnerRef.current,
      (generation) =>
        copyMessageText(
          content,
          label('message.copyFailed'),
          (message, tone) => useAppStore.getState().notify(message, tone),
          () => copyFeedbackOwnerRef.current.generation === generation,
        ),
      (generation) => {
        setCopiedContent(content)
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          if (copyFeedbackOwnerRef.current.generation !== generation) return
          setCopiedContent((current) => (current === content ? null : current))
          timerRef.current = null
        }, 1600)
      },
      () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = null
        setCopiedContent(null)
      },
    )
  }

  return (
    <button
      type="button"
      aria-label={label(copied ? 'message.copied' : 'message.copy')}
      data-tooltip={label(copied ? 'message.copied' : 'message.copy')}
      onClick={() => void copy()}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

const MessageImages = memo(function MessageImages({
  message,
  label,
}: {
  message: ChatMessage
  label: Translate
}) {
  const images = (message.attachments ?? []).filter(
    (a) => a.kind === 'image' && a.purpose !== 'mask',
  )
  if (images.length === 0) return null
  return (
    <div className="zc-msg-images">
      {images.map((attachment) => {
        const src = imageAttachmentSrc(attachment)
        if (!src) return null
        return (
          <figure className="zc-msg-image" key={attachment.id}>
            <img
              src={src}
              alt={attachment.alt?.trim() || attachment.mimeType}
              loading="lazy"
              decoding="async"
            />
            <button
              type="button"
              className="zc-image-download"
              aria-label={label('message.downloadImage')}
              data-tooltip={label('message.downloadImage')}
              onClick={() => {
                if (!downloadImageAttachment(attachment)) {
                  notifyContained(
                    (message, tone) =>
                      useAppStore.getState().notify(message, tone),
                    label('message.downloadFailed'),
                  )
                }
              }}
            >
              <Download size={14} />
            </button>
          </figure>
        )
      })}
    </div>
  )
})

interface MessageRowProps {
  message: ChatMessage
  isLastAssistant: boolean
  sending: boolean
  streaming: boolean
  conversationMutationPending: boolean
  editing: EditingState | null
  locale: AppLocale
  t: Translate
  onRegenerate: () => void
  onRetry: (messageId: string) => void
  onDelete: (messageId: string) => Promise<boolean>
  onStartEdit: (state: EditingState) => void
  onChangeEdit: (state: EditingState) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onOpenContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    message: ChatMessage,
  ) => void
  onStartLongPress: (
    event: ReactPointerEvent<HTMLElement>,
    message: ChatMessage,
  ) => void
  onMoveLongPress: (event: ReactPointerEvent<HTMLElement>) => void
  onFinishLongPress: (event: ReactPointerEvent<HTMLElement>) => void
  registerRow: (id: string, el: HTMLDivElement | null) => void
}

// Memoized so a streaming token update only re-renders the streaming row.
const MessageRow = memo(function MessageRow({
  message,
  isLastAssistant,
  sending,
  streaming,
  conversationMutationPending,
  editing,
  locale,
  t,
  onRegenerate,
  onRetry,
  onDelete,
  onStartEdit,
  onChangeEdit,
  onCommitEdit,
  onCancelEdit,
  onOpenContextMenu,
  onStartLongPress,
  onMoveLongPress,
  onFinishLongPress,
  registerRow,
}: MessageRowProps) {
  const isUser = message.role === 'user'
  const displayContent = messageDisplayContent(message)
  const status = message.status ?? 'done'
  const isEditing = editing?.id === message.id
  const sender = isUser ? t('message.you') : t('message.assistant')
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (isEditing) {
      scheduleInteractionFocus(() => editTextareaRef.current)
    }
  }, [isEditing])

  const cancelEditAndRestoreFocus = () => {
    onCancelEdit()
    scheduleInteractionFocus(() => editButtonRef.current)
  }

  return (
    <div
      ref={(el) => registerRow(message.id, el)}
      data-message-id={message.id}
      className={`zc-msg message ${isUser ? 'user' : 'assistant'} ${status}`}
      onContextMenu={(event) => onOpenContextMenu(event, message)}
      onPointerDown={(event) => onStartLongPress(event, message)}
      onPointerMove={onMoveLongPress}
      onPointerUp={onFinishLongPress}
      onPointerCancel={onFinishLongPress}
    >
      <div className="zc-avatar" aria-hidden="true">
        {isUser ? sender.slice(0, 1) : 'AI'}
      </div>
      <div className="zc-msg-body">
        <div className="zc-msg-meta">
          <span className="zc-msg-sender">{sender}</span>
          <span>{formatTime(message.createdAt, locale)}</span>
          {status === 'queued' && <span>{t('message.queued')}</span>}
        </div>

        <div className="zc-bubble">
          <MessageImages message={message} label={t} />
          {isEditing ? (
            <textarea
              ref={editTextareaRef}
              value={editing.draft}
              autoFocus
              rows={3}
              aria-label={t('message.edit')}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                resize: 'vertical',
                color: 'inherit',
              }}
              onChange={(e) =>
                onChangeEdit({ id: message.id, draft: e.currentTarget.value })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (!conversationMutationPending) onCommitEdit()
                }
                if (e.key === 'Escape') cancelEditAndRestoreFocus()
              }}
            />
          ) : (
            <Markdown content={displayContent} labels={createMarkdownLabels(t)} />
          )}
          {status === 'streaming' && !displayContent && (
            <span>{t('message.streaming')}</span>
          )}
          {status === 'streaming' && (
            <span className="zc-cursor" aria-hidden="true" />
          )}
        </div>

        {status === 'error' && message.error && (
          <div className="zc-msg-error-text">
            {redactSensitiveText(message.error)}
          </div>
        )}

        <div className="zc-msg-actions">
          {isEditing ? (
            <>
              <button
                type="button"
                aria-label={t('message.sendEdited')}
                data-tooltip={t('message.sendEdited')}
                disabled={conversationMutationPending}
                onClick={() => void onCommitEdit()}
              >
                <Send size={14} />
              </button>
              <button
                type="button"
                aria-label={t('common.cancel')}
                data-tooltip={t('common.cancel')}
                onClick={cancelEditAndRestoreFocus}
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              {displayContent && (
                <CopyButton content={displayContent} label={t} />
              )}
              {isUser && (
                <button
                  ref={editButtonRef}
                  type="button"
                  aria-label={t('message.edit')}
                  data-tooltip={t('message.edit')}
                  disabled={conversationMutationPending}
                  onClick={() =>
                    onStartEdit({ id: message.id, draft: message.content })
                  }
                >
                  <Pencil size={14} />
                </button>
              )}
              {!isUser && status === 'error' && (
                <button
                  type="button"
                  aria-label={t('message.retry')}
                  data-tooltip={t('message.retry')}
                  disabled={
                    sending || streaming || conversationMutationPending
                  }
                  onClick={() => onRetry(message.id)}
                >
                  <RefreshCw size={14} />
                </button>
              )}
              {!isUser && status === 'done' && isLastAssistant && !streaming && (
                <button
                  type="button"
                  aria-label={t('message.regenerate')}
                  data-tooltip={t('message.regenerate')}
                  disabled={conversationMutationPending}
                  onClick={onRegenerate}
                >
                  <RefreshCw size={14} />
                </button>
              )}
              <button
                type="button"
                aria-label={t('message.delete')}
                data-tooltip={t('message.delete')}
                disabled={conversationMutationPending}
                onClick={() => void onDelete(message.id)}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

export function MessageList({
  conversation,
  streaming,
  onRegenerate,
  onRetry,
  onDelete,
  onEdit,
}: MessageListProps) {
  const data = useAppStore((s) => s.data)
  const sending = useAppStore((s) => s.sending)
  const conversationMutationPending = useAppStore(
    (s) => s.conversationMutationPending,
  )
  const speakingMessageId = useAppStore((s) => s.speakingMessageId)
  const speakMessage = useAppStore((s) => s.speakMessage)
  const t = (key: AppStringKey) => appT(data, key)
  const locale = resolveAppLocale(data)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rowElsRef = useRef(new Map<string, HTMLDivElement>())
  const messageListPinnedToBottomRef = useRef(true)
  const previousMessageConversationIdRef = useRef('')
  const previousMessageScrollKeyRef = useRef('')
  const previousContextMenuConversationIdRef = useRef(conversation.id)
  const messageScrollFrameGenerationRef = useRef(0)
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const messageContextMenuController = useMessageContextMenuController()
  const contextMenuState = messageContextMenuController.messageContextMenu
  const longPressMessageId =
    messageContextMenuController.messageLongPressMessageId
  const cancelContextMenuLongPress =
    messageContextMenuController.cancelMessageLongPress
  const closeContextMenu = messageContextMenuController.closeMessageContextMenu
  const [range, setRange] = useState(() =>
    deriveResolvedMessageVirtualRange({
      conversationId: conversation.id,
      currentRange: emptyMessageVirtualRange(),
      enabled: conversation.messages.length > MESSAGE_VIRTUALIZATION_THRESHOLD,
      heights: rowHeightCache,
      messages: conversation.messages,
    }),
  )
  const messages = conversation.messages
  const messageVirtualizationEnabled =
    messages.length > MESSAGE_VIRTUALIZATION_THRESHOLD
  const lastMessage = messages[messages.length - 1] ?? null
  const lastAssistantId =
    lastMessage && lastMessage.role === 'assistant' ? lastMessage.id : null
  const messageScrollKey = [
    conversation.id,
    messages.length,
    lastMessage?.id ?? '',
    lastMessage?.status ?? '',
    lastMessage?.content.length ?? 0,
    lastMessage?.attachments?.length ?? 0,
  ].join(':')
  const virtualizedAnnouncement = virtualizedLatestAssistantAnnouncement(
    messages,
    messageVirtualizationEnabled,
  )
  const contextMessage = contextMenuState
    ? messages.find(
        (message) =>
          message.id === contextMenuState.messageId,
      ) ?? null
    : null

  const contextCopyFeedbackOwnerRef = useRef<MessageCopyFeedbackOwner>({
    generation: 0,
  })
  const messageCopyOwnerKey = messages
    .map((message) => `${message.id}:${message.content}`)
    .join('\u0001')

  useLayoutEffect(
    () => () => {
      invalidateMessageCopyFeedback(contextCopyFeedbackOwnerRef.current)
    },
    [conversation.id, messageCopyOwnerKey],
  )

  const copyContextMessage = async (message: ChatMessage) => {
    const owner = contextCopyFeedbackOwnerRef.current
    await runMessageCopyFeedbackAction(
      owner,
      (generation) =>
        copyMessageText(
          messageCopyText(message, t('message.image')),
          t('message.copyFailed'),
          (messageText, tone) => useAppStore.getState().notify(messageText, tone),
          () => owner.generation === generation,
        ),
      () => undefined,
    )
  }

  const downloadContextAttachment = (
    _message: ChatMessage,
    attachment: MessageAttachment,
  ) => {
    if (!downloadImageAttachment(attachment)) {
      notifyContained(
        (message, tone) => useAppStore.getState().notify(message, tone),
        t('message.downloadFailed'),
      )
    }
  }

  // Derive the effective window during render; scrolling narrows it via state.
  const effectiveRange = messageVirtualizationEnabled
    ? deriveResolvedMessageVirtualRange({
        conversationId: conversation.id,
        currentRange: range,
        enabled: true,
        heights: rowHeightCache,
        messages,
      })
    : emptyMessageVirtualRange(conversation.id, messages.length)
  const visibleMessages = messageVirtualizationEnabled
    ? messages.slice(effectiveRange.start, effectiveRange.end)
    : messages
  const renderedMessageIdsKey = visibleMessages
    .map((message) => message.id)
    .join('\u0000')

  useEffect(() => {
    const conversationChanged =
      previousContextMenuConversationIdRef.current !== conversation.id
    previousContextMenuConversationIdRef.current = conversation.id

    const activeTargetMessageId = contextMenuState?.messageId ?? longPressMessageId
    if (!activeTargetMessageId) return

    const targetRow = rowElsRef.current.get(activeTargetMessageId)
    const targetIsConnectedToThisList = Boolean(
      targetRow?.isConnected && scrollRef.current?.contains(targetRow),
    )
    const targetMessageExists = messages.some(
      (message) => message.id === activeTargetMessageId,
    )
    const targetMessageGenerationIsCurrent =
      !contextMenuState || contextMessage === contextMenuState.message

    if (
      conversationChanged ||
      !targetMessageExists ||
      !targetIsConnectedToThisList ||
      !targetMessageGenerationIsCurrent
    ) {
      cancelContextMenuLongPress()
      if (contextMenuState) closeContextMenu()
    }
  }, [
    cancelContextMenuLongPress,
    closeContextMenu,
    contextMenuState,
    contextMessage,
    conversation.id,
    longPressMessageId,
    messages,
    renderedMessageIdsKey,
  ])

  const registerRow = (id: string, el: HTMLDivElement | null) => {
    const rows = rowElsRef.current
    if (el) {
      rows.set(id, el)
      // Measure immediately: content-visibility:auto can defer ResizeObserver.
      const height = el.getBoundingClientRect().height
      if (height > 0 && rowHeightCache.get(id) !== height) {
        rowHeightCache.set(id, height)
      }
    } else {
      rows.delete(id)
    }
  }

  // Observe the same border-box geometry used by virtual spacer calculations.
  useEffect(() => {
    if (!messageVirtualizationEnabled) return

    const measureAndRecompute = () => {
      for (const [id, row] of rowElsRef.current) {
        const height = row.getBoundingClientRect().height
        if (height > 0 && rowHeightCache.get(id) !== height) {
          rowHeightCache.set(id, height)
        }
      }

      const messageList = scrollRef.current
      if (messageList) {
        setRange(
          calculateMessageVirtualRange(
            conversation.id,
            messages,
            messageList.scrollTop,
            messageList.clientHeight,
            rowHeightCache,
          ),
        )
      }
    }

    let active = true
    let resizeFrame: number | null = null
    const scheduleMeasurement = () => {
      if (!active || resizeFrame !== null) return
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        if (!active) return
        measureAndRecompute()
      })
    }

    measureAndRecompute()
    const disconnectResizeObserver = installMessageVirtualResizeObserver(
      scrollRef.current,
      scheduleMeasurement,
    )

    return () => {
      active = false
      disconnectResizeObserver()
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
    }
  }, [
    conversation.id,
    messageVirtualizationEnabled,
    messages,
    renderedMessageIdsKey,
  ])

  const recomputeRange = useCallback(() => {
    const el = scrollRef.current
    if (!el || !messageVirtualizationEnabled) return
    setRange(
      calculateMessageVirtualRange(
        conversation.id,
        messages,
        el.scrollTop,
        el.clientHeight,
        rowHeightCache,
      ),
    )
  }, [conversation.id, messageVirtualizationEnabled, messages])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = isMessageListNearBottom(el)
    messageListPinnedToBottomRef.current = nearBottom
    if (nearBottom) setShowNewMessagesButton(false)
    recomputeRange()
  }, [recomputeRange])

  // Sync the window once rows have been measured (ref callback fills the
  // cache before effects run, so the first pass uses real heights).
  useEffect(() => {
    if (!messageVirtualizationEnabled) return
    recomputeRange()
  }, [
    conversation.id,
    messageVirtualizationEnabled,
    messages.length,
    recomputeRange,
  ])

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const messageList = scrollRef.current
    if (!messageList) {
      setShowNewMessagesButton(false)
      return false
    }

    if (!scrollMessagesElementToLatest(messageList, behavior)) return false

    messageListPinnedToBottomRef.current = true
    setShowNewMessagesButton(false)
    recomputeRange()
    return true
  }, [recomputeRange])

  const jumpToLatestMessages = useCallback(() => {
    const shouldRestoreTranscriptFocus =
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.classList.contains('new-messages-button')

    const scrolled = scrollToLatest(prefersReducedMotion() ? 'auto' : 'smooth')
    if (scrolled && shouldRestoreTranscriptFocus) {
      scheduleInteractionFocus(() => scrollRef.current)
    }
  }, [scrollToLatest])

  useEffect(() => {
    const messageList = scrollRef.current
    if (!messageList) {
      setShowNewMessagesButton(false)
      return
    }

    if (previousMessageScrollKeyRef.current === messageScrollKey) return
    previousMessageScrollKeyRef.current = messageScrollKey

    const conversationChanged =
      previousMessageConversationIdRef.current !== conversation.id
    previousMessageConversationIdRef.current = conversation.id
    const shouldAutoScroll =
      conversationChanged ||
      messageListPinnedToBottomRef.current ||
      isMessageListNearBottom(messageList)

    if (!shouldAutoScroll) {
      setShowNewMessagesButton(true)
      return
    }

    const generation = ++messageScrollFrameGenerationRef.current
    const frame = window.requestAnimationFrame(() => {
      if (messageScrollFrameGenerationRef.current !== generation) return
      scrollToLatest('auto')
    })
    return () => {
      if (messageScrollFrameGenerationRef.current === generation) {
        messageScrollFrameGenerationRef.current += 1
      }
      window.cancelAnimationFrame(frame)
    }
  }, [conversation.id, messageScrollKey, scrollToLatest])

  const commitEdit = () =>
    commitMessageEdit(
      editing,
      onEdit,
      () => setEditing(null),
      (error) => {
        const state = useAppStore.getState()
        reportMessageEditFailure(
          error,
          (key) => appT(state.data, key),
          (message, tone) => state.notify(message, tone),
        )
      },
    )

  const deleteMessageAndRestoreTranscriptFocus = useCallback(
    async (messageId: string): Promise<boolean> => {
      const deletionFocusOwner = document.activeElement
      try {
        const accepted = await onDelete(messageId)
        if (accepted) {
          scheduleInteractionFocus(() =>
            restoreInteractionFocusTarget({
              activeElement: document.activeElement,
              blocked: Boolean(
                document.querySelector('.zc-app-surface[inert]'),
              ),
              body: document.body,
              owner: deletionFocusOwner,
              target: scrollRef.current,
            }),
          )
        }
        return accepted
      } catch {
        console.error('[app] message delete UI action failed')
        return false
      }
    },
    [onDelete],
  )

  return (
    <div className="message-scroll-region">
      <div
        className="zc-chat-scroll message-list"
        role="log"
        aria-label={t('message.transcriptLabel')}
        aria-live={messageVirtualizationEnabled ? 'off' : 'polite'}
        aria-relevant="additions text"
        aria-atomic="false"
        tabIndex={-1}
        ref={scrollRef}
        onScroll={onScroll}
      >
        <div className="zc-chat-column">
        {messageVirtualizationEnabled && effectiveRange.topSpacer > 0 && (
          <div
            style={{ height: effectiveRange.topSpacer }}
            aria-hidden="true"
            data-message-virtual-spacer="top"
          />
        )}
        {visibleMessages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            isLastAssistant={message.id === lastAssistantId}
            sending={sending}
            streaming={streaming}
            conversationMutationPending={conversationMutationPending}
            editing={editing}
            locale={locale}
            t={t}
            onRegenerate={onRegenerate}
            onRetry={onRetry}
            onDelete={deleteMessageAndRestoreTranscriptFocus}
            onStartEdit={setEditing}
            onChangeEdit={setEditing}
            onCommitEdit={commitEdit}
            onCancelEdit={() => setEditing(null)}
            onOpenContextMenu={messageContextMenuController.openMessageContextMenu}
            onStartLongPress={messageContextMenuController.startMessageLongPress}
            onMoveLongPress={messageContextMenuController.moveMessageLongPress}
            onFinishLongPress={messageContextMenuController.finishMessageLongPress}
            registerRow={registerRow}
          />
        ))}
        {messageVirtualizationEnabled && effectiveRange.bottomSpacer > 0 && (
          <div
            style={{ height: effectiveRange.bottomSpacer }}
            aria-hidden="true"
            data-message-virtual-spacer="bottom"
          />
        )}
        </div>
      </div>
      {messageVirtualizationEnabled && (
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {virtualizedAnnouncement}
        </div>
      )}
      {contextMessage &&
        contextMenuState &&
        contextMessage === contextMenuState.message && (
        <MessageContextMenu
          conversationMutationPending={conversationMutationPending}
          lastAssistant={contextMessage.id === lastAssistantId}
          locale={locale}
          menu={contextMenuState}
          menuRef={messageContextMenuController.messageContextMenuRef}
          message={contextMessage}
          sending={sending}
          speakingMessageId={speakingMessageId}
          streaming={streaming}
          t={t}
          onClose={closeContextMenu}
          onCloseAndRestoreFocus={
            messageContextMenuController.closeMessageContextMenuAndRestoreFocus
          }
          onCloseForAsyncAction={
            messageContextMenuController.closeMessageContextMenuForAsyncAction
          }
          onCopyMessage={copyContextMessage}
          onDeleteMessage={deleteMessageAndRestoreTranscriptFocus}
          onDownloadAttachment={downloadContextAttachment}
          onKeyDown={messageContextMenuController.handleMessageContextMenuKeyDown}
          onRegenerate={onRegenerate}
          onRetry={onRetry}
          onSpeakMessage={speakMessage}
          onStartEditingMessage={(message) =>
            setEditing({ id: message.id, draft: message.content })
          }
        />
      )}
      {showNewMessagesButton && messages.length > 0 && (
        <button
          type="button"
          className="new-messages-button"
          aria-label={t('button.newMessages')}
          onClick={jumpToLatestMessages}
        >
          <ChevronDown size={16} aria-hidden="true" />
          {t('button.newMessages')}
        </button>
      )}
    </div>
  )
}
