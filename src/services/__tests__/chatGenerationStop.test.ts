import { describe, expect, it, vi } from 'vitest'

import type {
  AppData,
  ChatMessage,
  Conversation,
} from '../../types'
import {
  stoppedStreamingGenerationData,
  stopStaleStreamingGeneration,
} from '../chatGenerationStop'

function message(patch: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    status: 'done',
    ...patch,
  }
}

function conversation(messages: ChatMessage[]): Conversation {
  return {
    id: 'conversation-1',
    title: 'Chat',
    providerId: 'openai',
    model: 'gpt-5.4-mini',
    messages,
    createdAt: 1,
    updatedAt: 1,
  }
}

function appData(messages: ChatMessage[]): AppData {
  return {
    version: 1,
    providers: [],
    conversations: [conversation(messages)],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 6000,
      maxAutoSkills: 4,
    },
    sync: {
      mode: 'local',
      autoSync: false,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'zh-CN',
      compactMode: false,
    },
    updatedAt: 1,
  }
}

describe('chat generation stop helpers', () => {
  it('does not rewrite data when no streaming message exists', () => {
    expect(
      stoppedStreamingGenerationData(
        appData([message({ id: 'done', status: 'done', content: 'final' })]),
        'Stopped',
      ),
    ).toBeNull()
  })

  it('terminalizes stale streaming messages with safe stopped content', () => {
    const stopped = stoppedStreamingGenerationData(
      appData([
        message({
          id: 'partial',
          status: 'streaming',
          content: 'partial answer',
          error: 'previous error',
          queuedTextRequest: {
            providerId: 'provider-1',
            model: 'chat-model',
          },
          offlineReplayClaim: {
            claimId: 'claim-1',
            owner: 'tab-1',
          },
        }),
        message({
          id: 'empty',
          status: 'streaming',
          content: '',
          error: 'provider details',
        }),
        message({ id: 'done', status: 'done', content: 'already done' }),
      ]),
      'Stopped',
    )

    expect(stopped?.conversations[0].messages).toEqual([
      expect.objectContaining({
        id: 'partial',
        content: 'partial answer',
        error: undefined,
        status: 'done',
      }),
      expect.objectContaining({
        id: 'empty',
        content: 'Stopped',
        error: undefined,
        status: 'done',
      }),
      expect.objectContaining({
        id: 'done',
        content: 'already done',
        status: 'done',
      }),
    ])
    expect(stopped?.conversations[0].messages[0].queuedTextRequest).toBeUndefined()
    expect(stopped?.conversations[0].messages[0].offlineReplayClaim).toBeUndefined()
  })

  it('surfaces stale streaming stop save failures without clearing sending or syncing', () => {
    const source = appData([
      message({
        id: 'streaming-1',
        status: 'streaming',
        content: 'partial answer',
      }),
    ])
    const notices: string[] = []
    const sendingStates: boolean[] = []
    const syncs: AppData[] = []
    const updateData = vi.fn(() => null)

    const handled = stopStaleStreamingGeneration({
      data: source,
      stoppedContent: 'Stopped',
      updateData,
      scheduleAutoSync: (snapshot) => syncs.push(snapshot),
      setSending: (sending) => sendingStates.push(sending),
      onSaveFailure: (messageId) => notices.push(`save-failed:${messageId}`),
    })

    expect(handled).toBe(true)
    expect(notices).toEqual(['save-failed:streaming-1'])
    expect(sendingStates).toEqual([])
    expect(syncs).toEqual([])
    expect(updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
  })

  it('clears sending and schedules sync only after stale streaming stop is saved', () => {
    const source = appData([
      message({
        id: 'streaming-1',
        status: 'streaming',
        content: '',
      }),
    ])
    const savedSnapshots: AppData[] = []
    const notices: string[] = []
    const sendingStates: boolean[] = []
    const syncs: Array<{ snapshot: AppData; delay: number | undefined }> = []
    const updateData = vi.fn((updater: (current: AppData) => AppData) => {
      const saved = updater(source)
      savedSnapshots.push(saved)
      return saved
    })

    const handled = stopStaleStreamingGeneration({
      data: source,
      stoppedContent: 'Stopped',
      updateData,
      scheduleAutoSync: (snapshot, delay) => syncs.push({ snapshot, delay }),
      setSending: (sending) => sendingStates.push(sending),
      onSaveFailure: (messageId) => notices.push(`save-failed:${messageId}`),
    })

    const saved = savedSnapshots[0]
    expect(handled).toBe(true)
    expect(saved.conversations[0].messages[0]).toEqual(
      expect.objectContaining({
        id: 'streaming-1',
        content: 'Stopped',
        status: 'done',
      }),
    )
    expect(notices).toEqual([])
    expect(sendingStates).toEqual([false])
    expect(syncs).toEqual([{ snapshot: saved, delay: 0 }])
    expect(updateData).toHaveBeenCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
  })
})
