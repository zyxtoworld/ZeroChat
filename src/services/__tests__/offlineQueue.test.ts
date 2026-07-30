import { describe, expect, it } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type {
  AppData,
  ChatMessage,
  Conversation,
  ProviderConfig,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import {
  appendOfflineQueuedTextTurn,
  completeQueuedTextAssistant,
  enabledProviderForQueuedText,
  findFirstQueuedTextAssistant,
  queuedTextAssistantFailurePatch,
  startQueuedTextAssistant,
  updateQueuedTextAssistant,
} from '../offlineQueue'

function conversation(messages: ChatMessage[] = []): Conversation {
  return {
    id: 'conversation-1',
    title: 'Chat',
    providerId: 'provider-1',
    model: 'chat-model',
    messages,
    createdAt: 1,
    updatedAt: 1,
  }
}

function provider(id: string, enabled = true): ProviderConfig {
  return {
    ...providerFromPreset(providerPresets[0]),
    id,
    enabled,
  }
}

function appData(
  conversations: Conversation[],
  providers: ProviderConfig[] = [provider('provider-1')],
): AppData {
  return {
    version: 1,
    providers,
    conversations,
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

describe('offline queue helpers', () => {
  it('appends a local queued text turn without changing unrelated messages', () => {
    const existing: ChatMessage = {
      id: 'existing',
      role: 'assistant',
      content: 'Hi',
      createdAt: 1,
      status: 'done',
    }
    const updated = appendOfflineQueuedTextTurn({
      conversation: conversation([existing]),
      providerId: 'provider-2',
      model: 'model-2',
      content: 'Offline prompt',
      title: 'Offline prompt',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      createdAt: 10,
      queuedAssistantContent: 'Queued while offline',
    })

    expect(updated.providerId).toBe('provider-2')
    expect(updated.model).toBe('model-2')
    expect(updated.title).toBe('Offline prompt')
    expect(updated.messages).toEqual([
      existing,
      {
        id: 'user-1',
        role: 'user',
        content: 'Offline prompt',
        createdAt: 10,
        status: 'done',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Queued while offline',
        createdAt: 10,
        status: 'queued',
        queuedTextRequest: {
          providerId: 'provider-2',
          model: 'model-2',
          promptMessageId: 'user-1',
        },
      },
    ])
  })

  it('finds a queued text prompt only by its persisted message id', () => {
    const imageUser: ChatMessage = {
      id: 'image-user',
      role: 'user',
      content: 'Draw',
      createdAt: 1,
      status: 'done',
      attachments: [
        {
          id: 'image',
          kind: 'image',
          mimeType: 'image/png',
          createdAt: 1,
        },
      ],
    }
    const textUser: ChatMessage = {
      id: 'text-user',
      role: 'user',
      content: 'Hello offline',
      createdAt: 2,
      status: 'done',
    }
    const newerTextUser: ChatMessage = {
      id: 'newer-text-user',
      role: 'user',
      content: 'Do not replay this message',
      createdAt: 3,
      status: 'done',
    }
    const queuedAssistant: ChatMessage = {
      id: 'assistant-queued',
      role: 'assistant',
      content: 'Queued',
      createdAt: 4,
      status: 'queued',
      queuedTextRequest: {
        providerId: 'provider-1',
        model: 'chat-model',
        promptMessageId: 'text-user',
      },
    }
    const result = findFirstQueuedTextAssistant(
      appData([
        conversation([imageUser, textUser, newerTextUser, queuedAssistant]),
      ]),
    )

    expect(result?.conversation.id).toBe('conversation-1')
    expect(result?.assistant.id).toBe('assistant-queued')
    expect(result?.assistantIndex).toBe(3)
    expect(result?.prompt.id).toBe('text-user')
    expect(result?.request).toEqual({
      providerId: 'provider-1',
      model: 'chat-model',
      promptMessageId: 'text-user',
    })
  })

  it('does not fall back to an older user when the queued prompt is missing', () => {
    const oldUser: ChatMessage = {
      id: 'old-user',
      role: 'user',
      content: 'Old prompt',
      createdAt: 1,
      status: 'done',
    }
    const orphanedAssistant: ChatMessage = {
      id: 'assistant-queued',
      role: 'assistant',
      content: 'Queued',
      createdAt: 3,
      status: 'queued',
      queuedTextRequest: {
        providerId: 'provider-1',
        model: 'chat-model',
        promptMessageId: 'deleted-user',
      },
    }

    expect(
      findFirstQueuedTextAssistant(
        appData([conversation([oldUser, orphanedAssistant])]),
      ),
    ).toBeNull()
  })

  it('skips an orphaned queue without blocking a later exact prompt', () => {
    const oldUser: ChatMessage = {
      id: 'old-user',
      role: 'user',
      content: 'Old prompt',
      createdAt: 1,
      status: 'done',
    }
    const orphanedAssistant: ChatMessage = {
      id: 'assistant-orphaned',
      role: 'assistant',
      content: 'Queued',
      createdAt: 2,
      status: 'queued',
      queuedTextRequest: {
        providerId: 'provider-1',
        model: 'chat-model',
        promptMessageId: 'deleted-user',
      },
    }
    const validUser: ChatMessage = {
      id: 'valid-user',
      role: 'user',
      content: 'Valid prompt',
      createdAt: 3,
      status: 'done',
    }
    const validAssistant: ChatMessage = {
      id: 'assistant-valid',
      role: 'assistant',
      content: 'Queued',
      createdAt: 4,
      status: 'queued',
      queuedTextRequest: {
        providerId: 'provider-1',
        model: 'chat-model',
        promptMessageId: 'valid-user',
      },
    }

    const result = findFirstQueuedTextAssistant(
      appData([
        conversation([
          oldUser,
          orphanedAssistant,
          validUser,
          validAssistant,
        ]),
      ]),
    )

    expect(result?.assistant.id).toBe('assistant-valid')
    expect(result?.prompt.id).toBe('valid-user')
  })

  it('ignores queued image assistants and text queues without a prompt', () => {
    const queuedImageAssistant: ChatMessage = {
      id: 'assistant-image',
      role: 'assistant',
      content: 'Queued image',
      createdAt: 1,
      status: 'queued',
      attachments: [
        {
          id: 'image',
          kind: 'image',
          mimeType: 'image/png',
          createdAt: 1,
        },
      ],
    }
    const queuedTextAssistant: ChatMessage = {
      id: 'assistant-text',
      role: 'assistant',
      content: 'Queued',
      createdAt: 1,
      status: 'queued',
    }

    expect(
      findFirstQueuedTextAssistant(
        appData([conversation([queuedImageAssistant, queuedTextAssistant])]),
      ),
    ).toBeNull()
  })

  it('uses only the provider captured by the queued request', () => {
    const current = appData(
      [conversation()],
      [provider('provider-1', false), provider('provider-2', true)],
    )

    expect(
      enabledProviderForQueuedText(
        appData([conversation()], [provider('provider-1', true)]),
        { providerId: 'provider-1', model: 'chat-model' },
      )?.id,
    ).toBe('provider-1')
    expect(
      enabledProviderForQueuedText(current, {
        providerId: 'provider-1',
        model: 'chat-model',
      }),
    ).toBeUndefined()
    expect(
      enabledProviderForQueuedText(current, {
        providerId: 'provider-2',
        model: 'chat-model',
      })?.id,
    ).toBe('provider-2')
    expect(
      enabledProviderForQueuedText(
        appData([conversation()], [provider('provider-1', false)]),
        { providerId: 'provider-1', model: 'chat-model' },
      ),
    ).toBeUndefined()
  })

  it('keeps queued request metadata while streaming and removes it at terminal states', () => {
    const queued: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Queued',
      createdAt: 1,
      status: 'queued',
      queuedTextRequest: {
        providerId: 'provider-2',
        model: 'model-2',
      },
    }
    const base = conversation([queued])
    const streaming = startQueuedTextAssistant(base, 'assistant-1')

    expect(streaming.providerId).toBe('provider-1')
    expect(streaming.model).toBe('chat-model')
    expect(streaming.messages[0]).toMatchObject({
      content: '',
      status: 'streaming',
      error: undefined,
      queuedTextRequest: {
        providerId: 'provider-2',
        model: 'model-2',
      },
    })

    const completed = completeQueuedTextAssistant(
      streaming,
      'assistant-1',
      'Done',
    )
    expect(completed.messages[0]).toMatchObject({
      content: 'Done',
      status: 'done',
      error: undefined,
    })
    expect(completed.messages[0].queuedTextRequest).toBeUndefined()

    const failed = updateQueuedTextAssistant(base, 'assistant-1', {
      content: 'No providers',
      status: 'error',
      error: 'No providers',
    })
    expect(failed.messages[0]).toMatchObject({
      content: 'No providers',
      status: 'error',
      error: 'No providers',
    })
    expect(failed.messages[0].queuedTextRequest).toBeUndefined()
  })

  it('derives failure patches for offline, aborted, and provider errors', () => {
    expect(
      queuedTextAssistantFailurePatch({
        aborted: false,
        online: false,
        assistantContent: '',
        queuedContent: 'Queued',
        stoppedContent: 'Stopped',
        errorContent: 'Provider failed',
      }),
    ).toEqual({
      patch: {
        content: 'Queued',
        status: 'queued',
        error: undefined,
      },
      shouldStayQueued: true,
    })

    expect(
      queuedTextAssistantFailurePatch({
        aborted: true,
        online: true,
        assistantContent: 'Partial',
        queuedContent: 'Queued',
        stoppedContent: 'Stopped',
        errorContent: 'Provider failed',
      }).patch,
    ).toEqual({
      content: 'Partial',
      status: 'done',
      error: undefined,
    })

    expect(
      queuedTextAssistantFailurePatch({
        aborted: false,
        online: true,
        assistantContent: '',
        queuedContent: 'Queued',
        stoppedContent: 'Stopped',
        errorContent: 'Provider failed',
      }).patch,
    ).toEqual({
      content: 'Provider failed',
      status: 'error',
      error: 'Provider failed',
    })
  })
})
