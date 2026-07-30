import { Pencil } from 'lucide-react'
import type {
  KeyboardEvent,
  ReactElement,
  RefObject,
} from 'react'

import type { Translator } from '../i18n'
import { CONVERSATION_TITLE_MAX_LENGTH } from '../services/conversations'

interface ChatHeaderTitleProps {
  activeConversationTitle: string
  conversationTitleButtonRef: RefObject<HTMLButtonElement | null>
  conversationTitleDraft: string
  conversationTitleInputRef: RefObject<HTMLInputElement | null>
  editingConversationTitle: boolean
  t: Translator
  onConversationTitleBlur: () => void
  onConversationTitleDraftChange: (value: string) => void
  onConversationTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onStartConversationTitleEdit: () => void
}

export function ChatHeaderTitle({
  activeConversationTitle,
  conversationTitleButtonRef,
  conversationTitleDraft,
  conversationTitleInputRef,
  editingConversationTitle,
  t,
  onConversationTitleBlur,
  onConversationTitleDraftChange,
  onConversationTitleKeyDown,
  onStartConversationTitleEdit,
}: ChatHeaderTitleProps): ReactElement {
  const renameLabel = t('conversation.renameLabel')
  const renameHint = t('conversation.renameHint')

  return (
    <div className="title-stack">
      <h1>
        {editingConversationTitle ? (
          <input
            ref={conversationTitleInputRef}
            className="conversation-title-input"
            type="text"
            aria-label={renameLabel}
            placeholder={t('conversation.renamePlaceholder')}
            data-tooltip={renameHint}
            maxLength={CONVERSATION_TITLE_MAX_LENGTH}
            value={conversationTitleDraft}
            onBlur={onConversationTitleBlur}
            onChange={(event) =>
              onConversationTitleDraftChange(event.target.value)
            }
            onKeyDown={onConversationTitleKeyDown}
          />
        ) : (
          <button
            ref={conversationTitleButtonRef}
            className="conversation-title-button"
            type="button"
            aria-label={renameLabel}
            data-tooltip={renameHint}
            onClick={onStartConversationTitleEdit}
          >
            <span>{activeConversationTitle}</span>
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
      </h1>
    </div>
  )
}
