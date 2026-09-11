import { Check, Pencil, Plus, Settings, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  focusInteractionElement,
  restoreInteractionFocusTarget,
  scheduleInteractionFocus,
} from '../../services/interactionFocus'
import type { Conversation } from '../../types'
import { filterConversations } from '../conversationSearch'
import {
  commitConversationTitle,
  reportConversationTitleFailure,
} from '../conversationTitleSubmission'
import {
  reportConversationDeletionFailure,
  runConversationDeletionAction,
} from '../conversationDeletionAction'
import {
  formatDateGroup,
  localizedConversationTitle,
  resolveAppLocale,
} from '../i18n'
import { useOnline } from '../theme'
import { useAppStore, appT } from '../store'
import type { AppStringKey } from '../strings'

function conversationDateGroup(conversation: Conversation): number {
  const d = new Date(conversation.updatedAt)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

interface RenameState {
  id: string
  draft: string
}

interface RenameFocusIntent {
  accepted: boolean
  conversationId: string
  focusOwner: Element | null
}

export function Sidebar({
  onCreateNewConversation,
  onSelectConversation,
}: {
  onCreateNewConversation: () => void
  onSelectConversation: (conversationId: string) => void
}) {
  const data = useAppStore((s) => s.data)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const conversationMutationPending = useAppStore(
    (s) => s.conversationMutationPending,
  )
  const rename = useAppStore((s) => s.renameConversation)
  const remove = useAppStore((s) => s.deleteConversation)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const notify = useAppStore((s) => s.notify)
  const online = useOnline()

  const [query, setQuery] = useState('')
  const [renameState, setRenameState] = useState<RenameState | null>(null)
  const [renamePending, setRenamePending] = useState(false)
  const [renameFocusIntentVersion, setRenameFocusIntentVersion] = useState(0)
  const renamePendingRef = useRef(false)
  const renameFocusIntentRef = useRef<RenameFocusIntent | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const newConversationButtonRef = useRef<HTMLButtonElement | null>(null)
  const conversationItemRefs = useRef(new Map<string, HTMLDivElement>())
  const renameButtonRefs = useRef(new Map<string, HTMLButtonElement>())

  const t = (key: AppStringKey) => appT(data, key)
  const locale = resolveAppLocale(data)
  const untitledTitle = t('app.untitled')

  const groups = useMemo(() => {
    const conversations = (data?.conversations ?? []).map((conversation) => ({
      ...conversation,
      title:
        localizedConversationTitle(data, conversation.title).trim() ||
        untitledTitle,
    }))
    const filtered = filterConversations(conversations, query)

    const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt)
    const map = new Map<number, Conversation[]>()
    for (const c of sorted) {
      const key = conversationDateGroup(c)
      const list = map.get(key)
      if (list) list.push(c)
      else map.set(key, [c])
    }
    return [...map.entries()]
  }, [data, query, untitledTitle])

  const openRename = (conversation: Conversation) => {
    setRenameState({ id: conversation.id, draft: conversation.title })
    scheduleInteractionFocus(() => renameInputRef.current)
  }

  const clearRename = (conversationId: string) => {
    setRenameState((current) =>
      current?.id === conversationId ? null : current,
    )
  }

  const restoreRenameButtonFocus = (
    conversationId: string,
    focusOwner: Element | null = document.activeElement,
  ) => {
    scheduleInteractionFocus(() =>
      restoreInteractionFocusTarget({
        activeElement: document.activeElement,
        blocked: useAppStore.getState().settingsOpen,
        body: document.body,
        owner: focusOwner,
        target:
          renameButtonRefs.current.get(conversationId) ??
          conversationItemRefs.current.get(conversationId) ??
          null,
      }),
    )
  }

  const cancelRename = (conversationId: string) => {
    clearRename(conversationId)
    restoreRenameButtonFocus(conversationId)
  }

  useEffect(() => {
    if (renamePending) return
    const intent = renameFocusIntentRef.current
    if (!intent) return
    renameFocusIntentRef.current = null
    if (!intent.accepted) {
      scheduleInteractionFocus(() =>
        restoreInteractionFocusTarget({
          activeElement: document.activeElement,
          blocked: useAppStore.getState().settingsOpen,
          body: document.body,
          owner: intent.focusOwner,
          target: renameInputRef.current,
        }),
      )
      return
    }

    scheduleInteractionFocus(() => {
      const restorableRow = restoreInteractionFocusTarget({
        activeElement: document.activeElement,
        blocked: useAppStore.getState().settingsOpen,
        body: document.body,
        owner: intent.focusOwner,
        target:
          conversationItemRefs.current.get(intent.conversationId) ?? null,
      })
      if (!focusInteractionElement(restorableRow)) return null
      scheduleInteractionFocus(() =>
        restoreInteractionFocusTarget({
          activeElement: document.activeElement,
          blocked: useAppStore.getState().settingsOpen,
          body: document.body,
          owner: restorableRow,
          target:
            renameButtonRefs.current.get(intent.conversationId) ?? null,
        }),
      )
      return null
    })
  }, [renameFocusIntentVersion, renamePending])

  const commitRename = () => {
    if (!renameState || renamePendingRef.current) return
    const submitted = renameState
    const focusOwner = document.activeElement
    let renameAccepted = false
    renamePendingRef.current = true
    setRenamePending(true)
    void commitConversationTitle(
      submitted,
      rename,
      () => clearRename(submitted.id),
      (error) => reportConversationTitleFailure(error, t, notify),
    )
      .then((accepted) => {
        renameAccepted = accepted
      })
      .finally(() => {
        renamePendingRef.current = false
        renameFocusIntentRef.current = {
          accepted: renameAccepted,
          conversationId: submitted.id,
          focusOwner,
        }
        setRenamePending(false)
        setRenameFocusIntentVersion((version) => version + 1)
      })
  }

  const deleteConversationAndRestoreFocus = async (conversationId: string) => {
    const deletionFocusOwner = document.activeElement
    const accepted = await runConversationDeletionAction(
      () => remove(conversationId),
      (error) =>
        reportConversationDeletionFailure(error, t, notify),
    )
    if (!accepted) return
    scheduleInteractionFocus(() => {
      const state = useAppStore.getState()
      const activeConversationId = state.data?.preferences.activeConversationId
      const target = activeConversationId
        ? conversationItemRefs.current.get(activeConversationId) ?? null
        : newConversationButtonRef.current
      return restoreInteractionFocusTarget({
        activeElement: document.activeElement,
        blocked: state.settingsOpen || state.sidebarCollapsed,
        body: document.body,
        owner: deletionFocusOwner,
        target,
      })
    })
  }

  return (
    <aside
      className={`zc-sidebar${collapsed ? ' collapsed' : ''}`}
      aria-hidden={collapsed || settingsOpen}
      aria-busy={conversationMutationPending || undefined}
      inert={collapsed || settingsOpen}
    >
      <div className="zc-sidebar-header">
        <img className="zc-logo app-logo" src="./favicon.svg" alt="" />
        <div className="zc-brand">
          <div className="zc-brand-name">ZeroChat</div>
          <div className="zc-brand-tagline">{t('app.tagline')}</div>
        </div>
      </div>

      <div className="zc-sidebar-search">
        <input
          type="search"
          value={query}
          placeholder={t('app.search')}
          aria-label={t('app.search')}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>

      <button
        ref={newConversationButtonRef}
        type="button"
        className="zc-new-chat"
        aria-keyshortcuts="Control+N Meta+N"
        disabled={conversationMutationPending}
        onClick={onCreateNewConversation}
      >
        <Plus size={16} />
        {t('app.newChat')}
      </button>

      <div className="zc-conversation-list" role="list">
        {groups.length === 0 && (
          <div
            className="zc-conv-empty"
            role={query ? 'status' : undefined}
            data-conversation-search-empty={query ? 'true' : undefined}
          >
            <strong>
              {query ? t('empty.searchNoResult') : t('empty.noConversationBody')}
            </strong>
            {query && (
              <>
                <p>{t('empty.searchNoResultHint')}</p>
                <button
                  type="button"
                  className="zc-btn"
                  data-conversation-search-clear="true"
                  onClick={() => setQuery('')}
                >
                  {t('empty.clearSearch')}
                </button>
              </>
            )}
          </div>
        )}
        {groups.map(([day, conversations]) => (
          <div key={day}>
            <div className="zc-conv-group-label">
              {formatDateGroup(day, locale)}
            </div>
            {conversations.map((c) => {
              const active = c.id === data?.preferences.activeConversationId
              const title = c.title
              const deleteLabel = `${t('app.deleteConversation')}: ${title}`

              if (renameState?.id === c.id) {
                return (
                  <div
                    key={c.id}
                    className="zc-conv-item active"
                    role="listitem"
                    aria-busy={renamePending || undefined}
                  >
                    <input
                      ref={renameInputRef}
                      value={renameState.draft}
                      autoFocus
                      aria-label={t('app.renameConversation')}
                      disabled={conversationMutationPending || renamePending}
                      onChange={(e) =>
                        setRenameState({ id: c.id, draft: e.currentTarget.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape' && !renamePendingRef.current) {
                          cancelRename(c.id)
                        }
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: 'none',
                        background: 'transparent',
                      }}
                    />
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button
                        type="button"
                        className="zc-icon-btn"
                        aria-label={t('common.save')}
                        disabled={conversationMutationPending || renamePending}
                        onClick={commitRename}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className="zc-icon-btn"
                        aria-label={t('common.cancel')}
                        disabled={renamePending}
                        onClick={() => cancelRename(c.id)}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  </div>
                )
              }

              return (
                <div
                  key={c.id}
                  role="listitem"
                >
                  <div
                    ref={(element) => {
                      if (element) conversationItemRefs.current.set(c.id, element)
                      else conversationItemRefs.current.delete(c.id)
                    }}
                    role="button"
                    className={`zc-conv-item${active ? ' active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    aria-disabled={conversationMutationPending || undefined}
                    aria-label={title}
                    tabIndex={conversationMutationPending ? -1 : 0}
                    onClick={() => {
                      if (!conversationMutationPending) onSelectConversation(c.id)
                    }}
                    onKeyDown={(e) => {
                      if (
                        (e.key === 'Enter' || e.key === ' ') &&
                        !conversationMutationPending &&
                        e.target === e.currentTarget
                      ) {
                        e.preventDefault()
                        onSelectConversation(c.id)
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="zc-conv-title">{title}</span>
                    <span className="zc-conv-actions">
                      <button
                        type="button"
                        ref={(element) => {
                          if (element) renameButtonRefs.current.set(c.id, element)
                          else renameButtonRefs.current.delete(c.id)
                        }}
                        aria-label={t('app.renameConversation')}
                        disabled={conversationMutationPending || renamePending}
                        onClick={(e) => {
                          e.stopPropagation()
                          openRename(c)
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label={deleteLabel}
                        disabled={conversationMutationPending}
                        onClick={(e) => {
                          e.stopPropagation()
                          void deleteConversationAndRestoreFocus(c.id)
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="zc-sidebar-footer">
        <span className="zc-net-status">
          <span className={`zc-net-dot${online ? '' : ' offline'}`} />
          {t(online ? 'toast.online' : 'toast.offline')}
        </span>
        <button
          type="button"
          className="zc-icon-btn"
          aria-label={t('app.settings')}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={17} />
        </button>
      </div>
    </aside>
  )
}
