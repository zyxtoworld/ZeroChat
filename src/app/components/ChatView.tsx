import { Check, PanelLeft, PanelRight, Pencil, Settings, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { AppData, Conversation, ProviderConfig } from '../../types'
import { restoreInteractionFocusTarget } from '../../services/interactionFocus'
import { scheduleInteractionFocus } from '../../services/interactionFocus'
import {
  commitConversationTitle,
  reportConversationTitleFailure,
} from '../conversationTitleSubmission'
import { conversationModelFocusTarget } from '../conversationModelFocus'
import { localizedConversationTitle } from '../i18n'
import {
  activeConversationOf,
  providerOfConversation,
  useAppStore,
  appT,
} from '../store'
import type { AppStringKey } from '../strings'
import { Composer } from './Composer'
import { FeatureHint } from './FeatureHint'
import { MessageList } from './MessageList'

interface ModelGroup {
  provider: ProviderConfig
  models: string[]
}

function choiceValue(providerId: string, model: string): string {
  return JSON.stringify([providerId, model])
}

function modelGroups(
  providers: ProviderConfig[],
  conversation: Conversation,
): ModelGroup[] {
  const orderedProviders = [...providers].sort((left, right) => {
    if (left.id === conversation.providerId) return -1
    if (right.id === conversation.providerId) return 1
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1
    return left.name.localeCompare(right.name)
  })

  return orderedProviders
    .map((provider) => {
      const values = new Set<string>()
      const add = (value: string | undefined) => {
        const trimmed = value?.trim() ?? ''
        if (trimmed) values.add(trimmed)
      }
      if (provider.id === conversation.providerId) add(conversation.model)
      add(provider.model)
      for (const model of provider.models ?? []) add(model)
      return { provider, models: [...values] }
    })
    .filter((group) => group.models.length > 0)
}

function ConversationTitle({
  conversation,
  data,
  onRename,
  t,
}: {
  conversation: Conversation
  data: AppData | null
  onRename: (id: string, title: string) => Promise<boolean>
  t: (key: AppStringKey) => string
}) {
  const title =
    localizedConversationTitle(data, conversation.title).trim() ||
    t('app.untitled')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [commitPending, setCommitPending] = useState(false)
  const commitPendingRef = useRef(false)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const titleButtonRef = useRef<HTMLButtonElement | null>(null)
  const notify = useAppStore((state) => state.notify)
  const conversationMutationPending = useAppStore(
    (state) => state.conversationMutationPending,
  )

  const closeEditor = (
    focusOwner: Element | null = document.activeElement,
  ) => {
    setEditing(false)
    scheduleInteractionFocus(() => {
      const state = useAppStore.getState()
      return restoreInteractionFocusTarget({
        activeElement: document.activeElement,
        blocked: state.settingsOpen,
        body: document.body,
        owner: focusOwner,
        target: titleButtonRef.current,
      })
    })
  }

  const openEditor = () => {
    if (conversationMutationPending) return
    setDraft(title)
    setEditing(true)
    scheduleInteractionFocus(() => titleInputRef.current)
  }

  const commit = () => {
    if (commitPendingRef.current) return
    if (conversationMutationPending) return
    const titleCommitFocusOwner = document.activeElement
    commitPendingRef.current = true
    setCommitPending(true)
    void commitConversationTitle(
      { draft, id: conversation.id },
      onRename,
      () => closeEditor(titleCommitFocusOwner),
      (error) => reportConversationTitleFailure(error, t, notify),
    ).finally(() => {
      commitPendingRef.current = false
      setCommitPending(false)
    })
  }

  if (editing) {
    return (
      <div
        className="zc-chat-title-edit"
        aria-busy={
          commitPending || conversationMutationPending || undefined
        }
      >
        <input
          ref={titleInputRef}
          value={draft}
          aria-label={t('app.editConversationTitle')}
          autoFocus
          disabled={commitPending || conversationMutationPending}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              if (!commitPendingRef.current) closeEditor()
            }
          }}
        />
        <button
          type="button"
          className="zc-icon-btn"
          aria-label={t('app.saveConversationTitle')}
          data-tooltip={t('app.saveConversationTitle')}
          disabled={commitPending || conversationMutationPending}
          onClick={commit}
        >
          <Check size={15} />
        </button>
        <button
          type="button"
          className="zc-icon-btn"
          aria-label={t('app.cancelConversationTitle')}
          data-tooltip={t('app.cancelConversationTitle')}
          disabled={commitPending}
          onClick={() => closeEditor()}
        >
          <X size={15} />
        </button>
      </div>
    )
  }

  return (
    <button
      ref={titleButtonRef}
      type="button"
      className="zc-chat-title"
      aria-label={`${t('app.editConversationTitle')}: ${title}`}
      data-tooltip={t('app.editConversationTitle')}
      disabled={conversationMutationPending}
      onClick={openEditor}
    >
      <span>{title}</span>
      <Pencil size={13} aria-hidden="true" />
    </button>
  )
}

export function ChatView() {
  const data = useAppStore((s) => s.data)
  const streaming = useAppStore((s) => s.streaming)
  const sending = useAppStore((s) => s.sending)
  const regenerate = useAppStore((s) => s.regenerate)
  const retryMessage = useAppStore((s) => s.retryMessage)
  const deleteMessage = useAppStore((s) => s.deleteMessage)
  const editAndResendMessage = useAppStore((s) => s.editAndResendMessage)
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setConversationModelChoice = useAppStore((s) => s.setConversationModelChoice)
  const renameConversation = useAppStore((s) => s.renameConversation)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const composerMode = useAppStore((s) => s.composerMode)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const conversationMutationPending = useAppStore(
    (s) => s.conversationMutationPending,
  )
  const modelFocusRequestIdRef = useRef(0)
  const consumedModelFocusRequestIdRef = useRef(0)
  const [modelFocusRequest, setModelFocusRequest] = useState<{
    conversationId: string
    id: number
  } | null>(null)
  const modelSelectRef = useRef<HTMLSelectElement | null>(null)

  const conversation = activeConversationOf(data)
  const provider = providerOfConversation(data, conversation)
  const t = (key: AppStringKey) => appT(data, key)

  useEffect(() => {
    if (
      !modelFocusRequest ||
      consumedModelFocusRequestIdRef.current === modelFocusRequest.id ||
      conversationMutationPending
    ) {
      return
    }

    consumedModelFocusRequestIdRef.current = modelFocusRequest.id
    if (conversation?.id !== modelFocusRequest.conversationId) return

    scheduleInteractionFocus(() => {
      const state = useAppStore.getState()
      return conversationModelFocusTarget({
        activeConversationId: activeConversationOf(state.data)?.id,
        activeElement: document.activeElement,
        body: document.body,
        currentRequestId: modelFocusRequestIdRef.current,
        requestConversationId: modelFocusRequest.conversationId,
        requestId: modelFocusRequest.id,
        settingsOpen: state.settingsOpen,
        target: modelSelectRef.current,
      })
    })
  }, [
    conversation?.id,
    conversationMutationPending,
    modelFocusRequest,
  ])

  const onSelectModel = (
    value: string,
    returnTarget: HTMLSelectElement,
  ) => {
    if (!conversation || !value) return
    if (conversationMutationPending) return
    const conversationId = conversation.id
    const restoreFocus = document.activeElement === returnTarget
    try {
      const [providerId, model] = JSON.parse(value) as [string, string]
      void setConversationModelChoice(conversationId, providerId, model)
        .catch(() => {
          console.error('[app] conversation model selection UI action failed')
        })
        .finally(() => {
          if (restoreFocus) {
            const id = ++modelFocusRequestIdRef.current
            setModelFocusRequest({ conversationId, id })
          }
        })
    } catch {
      return
    }
  }

  if (!conversation) {
    return null
  }

  const groups = modelGroups(data?.providers ?? [], conversation)
  return (
    <main className="zc-main">
      <header className="zc-chat-header">
        <button
          type="button"
          className="zc-icon-btn"
          aria-label={t(collapsed ? 'app.expandSidebar' : 'app.collapseSidebar')}
          onClick={() => setSidebarCollapsed(!collapsed)}
        >
          {collapsed ? <PanelRight size={17} /> : <PanelLeft size={17} />}
        </button>
        <ConversationTitle
          key={conversation.id}
          conversation={conversation}
          data={data}
          onRename={renameConversation}
          t={t}
        />
        <div className="zc-model-picker">
          <span className="zc-provider-label">{provider?.name ?? t('settings.providers')}</span>
          <select
            ref={modelSelectRef}
            className="zc-model-select"
            aria-label={t('settings.model')}
            aria-busy={conversationMutationPending || undefined}
            value={choiceValue(conversation.providerId, conversation.model)}
            onChange={(event) =>
              onSelectModel(event.currentTarget.value, event.currentTarget)
            }
            disabled={
              groups.length === 0 ||
              sending ||
              streaming ||
              conversationMutationPending
            }
          >
            {groups.length === 0 && <option value="">{t('settings.model')}</option>}
            {groups.map((group) => (
              <optgroup
                key={group.provider.id}
                label={group.provider.name}
                disabled={!group.provider.enabled}
              >
                {group.models.map((model) => (
                  <option
                    key={`${group.provider.id}:${model}`}
                    value={choiceValue(group.provider.id, model)}
                  >
                    {model}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="zc-icon-btn"
          aria-label={t('app.settings')}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={17} />
        </button>
      </header>

      <MessageList
        key={conversation.id}
        conversation={conversation}
        streaming={streaming}
        onRegenerate={regenerate}
        onRetry={retryMessage}
        onDelete={deleteMessage}
        onEdit={editAndResendMessage}
      />

      {!settingsOpen && (
        <FeatureHint
          key={composerMode === 'image' ? 'image' : 'chat'}
          id={composerMode === 'image' ? 'image' : 'chat'}
          restoreFocus={() =>
            useAppStore.getState().composerMode === composerMode
              ? document.querySelector<HTMLTextAreaElement>('.zc-composer textarea')
              : null
          }
        />
      )}

      <Composer
        key={conversation.id}
        disabled={sending || streaming || conversationMutationPending}
        streaming={streaming}
      />
    </main>
  )
}
