import type {
  KeyboardEvent,
  RefObject,
} from 'react'
import { useEffect, useRef } from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { SettingsTab } from '../components/SettingsNav'
import { providerPresets } from '../data/presets'
import type { Translator } from '../i18n'
import { createConversation } from '../storage/db'
import type {
  AppData,
  ProviderConfig,
} from '../types'
import {
  bump,
  updateConversation,
} from './appData'
import {
  scheduleComposerTextareaFocusToEnd,
} from './composerFocus'
import {
  deleteConversationDangerPrompt,
  type DangerPrompt,
} from './dangerConfirmation'
import { reportDetachedNotice } from './detachedFailureReporting'
import { generationOwnership } from './generationOwnership'
import {
  displayConversationTitle,
  normalizeConversationTitleDraft,
} from './conversations'
import { useConversationTitleEditController } from './conversationTitleEditController'
import {
  defaultModelForProvider,
} from './providerModels'
import {
  presetIdForProvider,
} from './providerConfig'
import {
  isApplePlatform,
  type NoticeTone,
} from './uiRuntime'

type AddProviderFromPresetOptions = {
  createConversationIfMissing?: boolean
  useForEmptyActiveConversation?: boolean
}

export interface ConversationLifecycleControllerContext {
  activeConversationId: string
  activeConversationTitle: string
  addProviderFromPresetId: (
    presetId: string,
    options?: AddProviderFromPresetOptions,
  ) => ProviderConfig | null
  closeSidebar: () => void
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>
  data: AppData | null
  dataRef: { current: AppData | null }
  dangerPromptOpen: boolean
  guideOpen: boolean
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  setConversationSearch: (search: string) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  setSelectedPresetId: (presetId: string) => void
  setSelectedProviderId: (providerId: string) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsTab: (tab: SettingsTab) => void
  settingsOpen: boolean
  syncFirstConflictPromptOpen: boolean
  t: Translator
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

export interface ConversationLifecycleControllerServices {
  focusComposer: () => void
}

export interface ConversationLifecycleControllerActions {
  commitConversationTitle: (
    conversationId: string,
    nextTitle: string,
  ) => AppData | null
  createNewConversation: () => AppData | null
  deleteConversation: (conversationId: string) => Promise<AppData | null>
  openFirstProviderSetup: () => ProviderConfig | null
  setActiveConversation: (conversationId: string) => AppData | null
}

export interface ConversationLifecycleController
  extends ConversationLifecycleControllerActions {
  conversationTitleButtonRef: RefObject<HTMLButtonElement | null>
  conversationTitleDraft: string
  conversationTitleInputRef: RefObject<HTMLInputElement | null>
  editingConversationTitle: boolean
  handleConversationTitleBlur: () => void
  handleConversationTitleKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
  ) => void
  setConversationTitleDraft: (value: string) => void
  startConversationTitleEdit: () => void
}

const noopServices: ConversationLifecycleControllerServices = {
  focusComposer: () => undefined,
}

export function createConversationLifecycleServices(
  context: Pick<
    ConversationLifecycleControllerContext,
    'composerTextareaRef'
  >,
): ConversationLifecycleControllerServices {
  return {
    focusComposer: () => {
      scheduleComposerTextareaFocusToEnd(context.composerTextareaRef)
    },
  }
}

export function reportConversationLifecycleNotice(
  context: Pick<ConversationLifecycleControllerContext, 'setNotice'>,
  getMessage: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): void {
  reportDetachedNotice(context.setNotice, getMessage, tone, target)
}

export function createConversationLifecycleActions(
  context: ConversationLifecycleControllerContext,
  services: ConversationLifecycleControllerServices = noopServices,
): ConversationLifecycleControllerActions {
  function reportConversationSaveFailure(): void {
    reportConversationLifecycleNotice(
      context,
      () => context.t('notice.conversationSaveUnavailable'),
      'error',
      'sidebar',
    )
  }

  function commitConversationTitle(
    conversationId: string,
    nextTitle: string,
  ): AppData | null {
    const current = context.dataRef.current

    if (!current) {
      return null
    }

    const target = current.conversations.find(
      (conversation) => conversation.id === conversationId,
    )

    if (
      !target ||
      displayConversationTitle(target.title, context.t) === nextTitle
    ) {
      return null
    }

    const saved = context.updateData(
      (snapshot) =>
        updateConversation(snapshot, conversationId, (conversation) => ({
          ...conversation,
          title: nextTitle,
        })),
      { autoSync: false },
    )

    if (!saved) {
      reportConversationSaveFailure()
      return null
    }

    context.scheduleAutoSync(saved, 0)
    return saved
  }

  function setActiveConversation(conversationId: string): AppData | null {
    const saved = context.updateData(
      (current) =>
        bump({
          ...current,
          preferences: {
            ...current.preferences,
            activeConversationId: conversationId,
          },
        }),
      { autoSync: false },
    )

    if (!saved) {
      reportConversationSaveFailure()
      return null
    }

    context.scheduleAutoSync(saved, 0)
    context.closeSidebar()
    return saved
  }

  function openFirstProviderSetup(): ProviderConfig | null {
    const provider = context.addProviderFromPresetId(providerPresets[0].id, {
      createConversationIfMissing: true,
      useForEmptyActiveConversation: true,
    })

    if (!provider) {
      context.setSettingsTab('providers')
      context.setSettingsOpen(true)
      context.closeSidebar()
      return null
    }

    context.setSelectedProviderId(provider.id)
    context.setSelectedPresetId(presetIdForProvider(provider))
    context.setSettingsTab('providers')
    context.setSettingsOpen(true)
    context.closeSidebar()
    reportConversationLifecycleNotice(
      context,
      () => context.t('notice.firstProviderAdded'),
      'success',
      'providers-list',
    )

    return provider
  }

  function createNewConversation(): AppData | null {
    const current = context.dataRef.current ?? context.data

    if (!current) {
      return null
    }

    const provider = current.providers[0]

    if (!provider) {
      context.setSettingsTab('providers')
      context.setSettingsOpen(true)
      context.closeSidebar()
      reportConversationLifecycleNotice(
        context,
        () => context.t('notice.addProviderFirst'),
        'warning',
        'providers-list',
      )
      return null
    }

    const conversation = createConversation(
      provider.id,
      defaultModelForProvider(provider),
      context.t('conversation.newTitle'),
    )

    const saved = context.updateData(
      (snapshot) =>
        bump({
          ...snapshot,
          conversations: [conversation, ...snapshot.conversations],
          preferences: {
            ...snapshot.preferences,
            activeConversationId: conversation.id,
          },
        }),
      { autoSync: false },
    )

    if (!saved) {
      reportConversationSaveFailure()
      return null
    }

    context.scheduleAutoSync(saved, 0)
    context.setConversationSearch('')
    context.closeSidebar()
    services.focusComposer()

    return saved
  }

  async function deleteConversation(
    conversationId: string,
  ): Promise<AppData | null> {
    const current = context.dataRef.current

    if (!current) {
      return null
    }

    if (generationOwnership.active) {
      reportConversationLifecycleNotice(
        context,
        () => context.t('notice.stopOrWaitBeforeDelete'),
        undefined,
        'sidebar',
      )
      return null
    }

    const target = current.conversations.find(
      (conversation) => conversation.id === conversationId,
    )

    if (!target) {
      return null
    }

    reportConversationLifecycleNotice(context, () => '')
    let confirmed: boolean

    try {
      confirmed = await context.requestDangerConfirmation(
        deleteConversationDangerPrompt(
          context.t,
          displayConversationTitle(target.title, context.t),
        ),
      )
    } catch {
      reportConversationSaveFailure()
      return null
    }

    if (!confirmed) {
      return null
    }

    if (generationOwnership.active) {
      reportConversationLifecycleNotice(
        context,
        () => context.t('notice.stopOrWaitBeforeDelete'),
        undefined,
        'sidebar',
      )
      return null
    }

    const latest = context.dataRef.current

    if (
      !latest ||
      !latest.conversations.some(
        (conversation) => conversation.id === conversationId,
      )
    ) {
      return null
    }

    const remaining = latest.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    )
    const fallbackProvider =
      latest.providers.find((provider) => provider.enabled) ?? latest.providers[0]
    const nextConversations =
      remaining.length > 0
        ? remaining
        : fallbackProvider
          ? [
              createConversation(
                fallbackProvider.id,
                defaultModelForProvider(fallbackProvider),
                context.t('conversation.newTitle'),
              ),
            ]
          : []
    const nextActive = nextConversations[0]?.id

    const saved = context.updateData(
      (snapshot) =>
        bump({
          ...snapshot,
          conversations: nextConversations,
          preferences: {
            ...snapshot.preferences,
            activeConversationId: nextActive,
          },
        }),
      { autoSync: false },
    )

    if (!saved) {
      reportConversationSaveFailure()
      return null
    }

    context.scheduleAutoSync(saved, 0)
    return saved
  }

  return {
    commitConversationTitle,
    createNewConversation,
    deleteConversation,
    openFirstProviderSetup,
    setActiveConversation,
  }
}

export function useConversationLifecycleController(
  context: ConversationLifecycleControllerContext,
): ConversationLifecycleController {
  const createNewConversationRef = useRef<(() => void) | null>(null)
  const actions = createConversationLifecycleActions(
    context,
    createConversationLifecycleServices(context),
  )
  const titleEdit = useConversationTitleEditController({
    activeConversationId: context.activeConversationId,
    activeConversationTitle: context.activeConversationTitle,
    normalizeTitleDraft: (value) =>
      normalizeConversationTitleDraft(value, context.t),
    onCommitTitle: actions.commitConversationTitle,
  })
  const {
    dangerPromptOpen,
    guideOpen,
    settingsOpen,
    syncFirstConflictPromptOpen,
  } = context

  useEffect(() => {
    createNewConversationRef.current = actions.createNewConversation
  })

  useEffect(() => {
    const handleGlobalNewConversationShortcut = (
      event: globalThis.KeyboardEvent,
    ): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        (event.key !== 'n' && event.key !== 'N') ||
        !(isApplePlatform()
          ? event.metaKey && !event.ctrlKey
          : event.ctrlKey && !event.metaKey) ||
        dangerPromptOpen ||
        syncFirstConflictPromptOpen ||
        settingsOpen ||
        guideOpen
      ) {
        return
      }

      event.preventDefault()
      createNewConversationRef.current?.()
    }

    document.addEventListener('keydown', handleGlobalNewConversationShortcut)

    return () => {
      document.removeEventListener('keydown', handleGlobalNewConversationShortcut)
    }
  }, [
    dangerPromptOpen,
    guideOpen,
    settingsOpen,
    syncFirstConflictPromptOpen,
  ])

  return {
    ...actions,
    ...titleEdit,
  }
}
