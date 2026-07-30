import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  ChatMessage,
  Conversation,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import { generationOwnership } from '../generationOwnership'
import {
  createChatGenerationMessageActions,
  type ChatGenerationMessageActionContext,
} from '../chatGenerationMessageActions'

const t: Translator = (key, values) =>
  values && typeof values === 'object'
    ? `${key}:${JSON.stringify(values)}`
    : key

function message(
  id: string,
  role: ChatMessage['role'],
  content: string,
  patch: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: 1,
    status: 'done',
    ...patch,
  }
}

function conversation(messages: ChatMessage[]): Conversation {
  return {
    id: 'conversation-1',
    title: 'Old title',
    providerId: 'provider-1',
    model: 'model-1',
    messages,
    createdAt: 1,
    updatedAt: 1,
  }
}

function appData(activeConversation: Conversation): AppData {
  return {
    version: 1,
    providers: [],
    conversations: [activeConversation],
    skills: [],
    skillSettings: defaultSkillSettings(),
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
    },
    updatedAt: 1,
  }
}

function harness(
  activeConversation: Conversation | null,
  options: {
    confirmed?: boolean
    editingMessageId?: string
    sending?: boolean
    setNotice?: ChatGenerationMessageActionContext['setNotice']
  } = {},
) {
  const dataRef = {
    current: activeConversation ? appData(activeConversation) : null,
  }
  generationOwnership.active = options.sending ?? false
  const notices: string[] = []
  const setEditingMessageId = vi.fn()
  const setEditingContent = vi.fn()
  const scheduleAutoSync = vi.fn()
  const requestDangerConfirmation = vi.fn(
    async () => options.confirmed ?? true,
  )
  const updateData = vi.fn((
    updater: (current: AppData) => AppData,
    _options?: { autoSync?: boolean },
  ) => {
    void _options

    if (!dataRef.current) {
      return null
    }

    dataRef.current = updater(dataRef.current)
    return dataRef.current
  })
  const services = {
    messageCopyText: vi.fn((item: ChatMessage) => `copy:${item.content}`),
    writeClipboardText: vi.fn(async () => undefined),
  }
  const actions = createChatGenerationMessageActions(
    {
      activeConversation,
      dataRef,
      editingMessageId: options.editingMessageId ?? '',
      errorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      requestDangerConfirmation,
      scheduleAutoSync,
      setEditingContent,
      setEditingMessageId,
      setNotice:
        options.setNotice ??
        ((message, tone, target, anchorId) => {
          notices.push(
            `${message}|${tone ?? ''}|${target ?? ''}|${anchorId ?? ''}`,
          )
        }),
      t,
      updateData,
    },
    services,
  )

  return {
    actions,
    dataRef,
    notices,
    requestDangerConfirmation,
    scheduleAutoSync,
    services,
    setEditingContent,
    setEditingMessageId,
    updateData,
  }
}

describe('chatGenerationMessageActions', () => {
  it('starts editing only editable user messages', () => {
    const editable = message('user-1', 'user', 'hello')
    const streaming = message('user-2', 'user', 'wait', {
      status: 'streaming',
    })
    const assistant = message('assistant-1', 'assistant', 'answer')
    const { actions, setEditingContent, setEditingMessageId } = harness(
      conversation([editable, streaming, assistant]),
    )

    actions.startEditingMessage(streaming)
    actions.startEditingMessage(assistant)

    expect(setEditingMessageId).not.toHaveBeenCalled()
    expect(setEditingContent).not.toHaveBeenCalled()

    actions.startEditingMessage(editable)

    expect(setEditingMessageId).toHaveBeenCalledWith('user-1')
    expect(setEditingContent).toHaveBeenCalledWith('hello')
  })

  it('copies messages and anchors success or localized error notices to the message', async () => {
    const target = message('assistant-1', 'assistant', 'answer')
    const successHarness = harness(conversation([target]))

    await successHarness.actions.copyMessage(target)

    expect(successHarness.services.writeClipboardText).toHaveBeenCalledWith(
      'copy:answer',
    )
    expect(successHarness.notices).toEqual([
      'button.copied|success|message|assistant-1',
    ])

    const failureHarness = harness(conversation([target]))
    failureHarness.services.writeClipboardText.mockRejectedValueOnce(
      new Error('clipboard denied'),
    )

    await failureHarness.actions.copyMessage(target)

    expect(failureHarness.notices).toEqual([
      'button.copyFailed|error|message|assistant-1',
    ])
  })

  it('contains message copy reporter failures', async () => {
    const target = message('assistant-1', 'assistant', 'answer')
    const current = harness(conversation([target]), {
      setNotice: () => {
        throw new Error('notice unavailable')
      },
    })

    await expect(current.actions.copyMessage(target)).resolves.toBeUndefined()

    current.services.writeClipboardText.mockRejectedValueOnce(
      new Error('clipboard denied'),
    )

    await expect(current.actions.copyMessage(target)).resolves.toBeUndefined()
  })

  it('deletes a confirmed message, repairs the conversation title, clears editing, and syncs immediately', async () => {
    const activeConversation = conversation([
      message('assistant-0', 'assistant', 'old answer'),
      message('user-1', 'user', '  keep this title  '),
      message('assistant-1', 'assistant', 'delete me'),
    ])
    const current = harness(activeConversation, {
      confirmed: true,
      editingMessageId: 'assistant-1',
    })

    await expect(current.actions.deleteMessage('assistant-1')).resolves.toBe(true)

    expect(current.requestDangerConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delete-message',
        title: 'danger.deleteMessage.title',
      }),
    )
    expect(current.dataRef.current?.conversations[0]).toMatchObject({
      title: 'keep this title',
      messages: [
        expect.objectContaining({ id: 'assistant-0' }),
        expect.objectContaining({ id: 'user-1' }),
      ],
    })
    expect(current.setEditingMessageId).toHaveBeenCalledWith('')
    expect(current.setEditingContent).toHaveBeenCalledWith('')
    expect(current.scheduleAutoSync).toHaveBeenCalledWith(
      current.dataRef.current,
      0,
    )
    expect(current.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
  })

  it('deletes a queued prompt and its paired assistant as one turn', async () => {
    const activeConversation = conversation([
      message('user-keep', 'user', 'Keep this title'),
      message('assistant-keep', 'assistant', 'Keep this answer'),
      message('user-queued', 'user', 'Queued prompt'),
      message('assistant-queued', 'assistant', 'Queued offline', {
        queuedTextRequest: {
          providerId: 'provider-1',
          model: 'model-1',
          promptMessageId: 'user-queued',
        },
        status: 'queued',
      }),
    ])
    const current = harness(activeConversation, { confirmed: true })

    await expect(current.actions.deleteMessage('user-queued')).resolves.toBe(true)

    expect(current.dataRef.current?.conversations[0].messages).toEqual([
      expect.objectContaining({ id: 'user-keep' }),
      expect.objectContaining({ id: 'assistant-keep' }),
    ])
    expect(current.scheduleAutoSync).toHaveBeenCalledWith(
      current.dataRef.current,
      0,
    )
  })

  it('returns delete success only after the message is saved', async () => {
    const activeConversation = conversation([
      message('user-1', 'user', 'keep title'),
      message('assistant-1', 'assistant', 'speaking answer'),
    ])
    const saved = harness(activeConversation, {
      confirmed: true,
    })

    await expect(saved.actions.deleteMessage('assistant-1')).resolves.toBe(true)

    const failed = harness(activeConversation, {
      confirmed: true,
    })
    failed.updateData.mockImplementationOnce(() => null)

    await expect(failed.actions.deleteMessage('assistant-1')).resolves.toBe(false)

    const cancelled = harness(activeConversation, {
      confirmed: false,
    })

    await expect(cancelled.actions.deleteMessage('assistant-1')).resolves.toBe(false)
  })

  it('stops confirmed message deletion when generation starts during confirmation', async () => {
    const target = message('assistant-1', 'assistant', 'keep while sending')
    const current = harness(conversation([target]))
    current.requestDangerConfirmation.mockImplementationOnce(async () => {
      generationOwnership.active = true
      return true
    })

    await expect(current.actions.deleteMessage(target.id)).resolves.toBe(false)

    expect(current.updateData).not.toHaveBeenCalled()
    expect(current.scheduleAutoSync).not.toHaveBeenCalled()
    expect(current.dataRef.current?.conversations[0]?.messages).toEqual([target])
  })

  it('stops confirmed message deletion when the target changed remotely', async () => {
    const target = message('assistant-1', 'assistant', 'already removed')
    const current = harness(conversation([target]))
    current.requestDangerConfirmation.mockImplementationOnce(async () => {
      const latest = current.dataRef.current

      if (latest) {
        current.dataRef.current = {
          ...latest,
          conversations: latest.conversations.map((item) => ({
            ...item,
            messages: [],
          })),
        }
      }
      return true
    })

    await expect(current.actions.deleteMessage(target.id)).resolves.toBe(false)

    expect(current.updateData).not.toHaveBeenCalled()
    expect(current.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('keeps editing state when confirmed message deletion cannot be saved', async () => {
    const activeConversation = conversation([
      message('user-1', 'user', 'delete draft'),
      message('assistant-1', 'assistant', 'answer'),
    ])
    const current = harness(activeConversation, {
      confirmed: true,
      editingMessageId: 'user-1',
    })
    current.updateData.mockImplementationOnce(() => null)

    await expect(current.actions.deleteMessage('user-1')).resolves.toBe(false)

    expect(current.requestDangerConfirmation).toHaveBeenCalled()
    expect(current.updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(current.notices).toEqual([
      '|||',
      'notice.messageSaveUnavailable|error|message|user-1',
    ])
    expect(current.setEditingMessageId).not.toHaveBeenCalled()
    expect(current.setEditingContent).not.toHaveBeenCalled()
    expect(current.scheduleAutoSync).not.toHaveBeenCalled()
    expect(current.dataRef.current?.conversations[0].messages).toEqual(
      activeConversation.messages,
    )
  })

  it('contains message delete reporter failures', async () => {
    const activeConversation = conversation([
      message('user-1', 'user', 'delete draft'),
      message('assistant-1', 'assistant', 'answer'),
    ])
    const saveFailure = harness(activeConversation, {
      confirmed: true,
      editingMessageId: 'user-1',
      setNotice: () => {
        throw new Error('notice unavailable')
      },
    })
    saveFailure.updateData.mockImplementationOnce(() => null)

    await expect(saveFailure.actions.deleteMessage('user-1')).resolves.toBe(false)

    expect(saveFailure.requestDangerConfirmation).toHaveBeenCalled()
    expect(saveFailure.scheduleAutoSync).not.toHaveBeenCalled()
    expect(saveFailure.setEditingMessageId).not.toHaveBeenCalled()
    expect(saveFailure.setEditingContent).not.toHaveBeenCalled()
    expect(saveFailure.dataRef.current?.conversations[0].messages).toEqual(
      activeConversation.messages,
    )

    const confirmationFailure = harness(activeConversation, {
      setNotice: () => {
        throw new Error('notice unavailable')
      },
    })
    confirmationFailure.requestDangerConfirmation.mockRejectedValueOnce(
      new Error('dialog unavailable'),
    )

    await expect(
      confirmationFailure.actions.deleteMessage('user-1'),
    ).resolves.toBe(false)

    expect(confirmationFailure.updateData).not.toHaveBeenCalled()
    expect(confirmationFailure.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('reports rejected delete confirmations without leaking the promise', async () => {
    const activeConversation = conversation([
      message('user-1', 'user', 'keep me'),
    ])
    const current = harness(activeConversation)
    current.requestDangerConfirmation.mockRejectedValueOnce(
      new Error('dialog unavailable'),
    )

    await expect(current.actions.deleteMessage('user-1')).resolves.toBe(false)

    expect(current.requestDangerConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'delete-message' }),
    )
    expect(current.updateData).not.toHaveBeenCalled()
    expect(current.scheduleAutoSync).not.toHaveBeenCalled()
    expect(current.setEditingMessageId).not.toHaveBeenCalled()
    expect(current.setEditingContent).not.toHaveBeenCalled()
    expect(current.notices).toEqual([
      '|||',
      'notice.messageSaveUnavailable|error|message|user-1',
    ])
    expect(current.dataRef.current?.conversations[0].messages).toEqual(
      activeConversation.messages,
    )
  })

  it('leaves data untouched when delete is cancelled or blocked by sending state', async () => {
    const activeConversation = conversation([
      message('user-1', 'user', 'keep me'),
    ])
    const cancelled = harness(activeConversation, { confirmed: false })

    await expect(cancelled.actions.deleteMessage('user-1')).resolves.toBe(false)

    expect(cancelled.updateData).not.toHaveBeenCalled()
    expect(cancelled.scheduleAutoSync).not.toHaveBeenCalled()

    const sending = harness(activeConversation, { sending: true })

    await expect(sending.actions.deleteMessage('user-1')).resolves.toBe(false)

    expect(sending.requestDangerConfirmation).not.toHaveBeenCalled()
    expect(sending.updateData).not.toHaveBeenCalled()
  })
})
