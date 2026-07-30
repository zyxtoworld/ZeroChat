import { describe, expect, it, vi } from 'vitest'

import type { AppData } from '../../types'
import { defaultSkillSettings } from '../../services/appData'
import {
  captureGenerationIncarnation,
  generationIncarnationExists,
} from '../../services/generationOwnership'
import { AppDataWriteConflictError } from '../appDataWriteConflict'
import { recoverAppDataWriteConflict } from '../appDataConflictRecovery'

function appData(updatedAt: number, compactMode = false): AppData {
  return {
    version: 1,
    providers: [],
    conversations: [],
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
      compactMode,
    },
    updatedAt,
  }
}

function generationData(updatedAt: number): AppData {
  const data = appData(updatedAt)

  return {
    ...data,
    conversations: [
      {
        id: 'conversation-1',
        title: 'Generation',
        providerId: 'provider-1',
        model: 'model-1',
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            createdAt: 2,
            status: 'streaming',
          },
        ],
        createdAt: 1,
        updatedAt,
      },
      {
        id: 'conversation-fallback',
        title: 'Fallback',
        providerId: 'provider-1',
        model: 'model-1',
        messages: [],
        createdAt: 3,
        updatedAt: 3,
      },
    ],
  }
}

describe('recoverAppDataWriteConflict', () => {
  it('rethrows failures that are not revision conflicts', async () => {
    const failure = new Error('storage unavailable')

    await expect(
      recoverAppDataWriteConflict(failure, appData(1), appData(2), {
        load: vi.fn(),
        save: vi.fn(),
      }),
    ).rejects.toBe(failure)
  })

  it('loads the winning revision, merges local edits, and rebases later edits', async () => {
    const base = appData(1)
    const remote = {
      ...appData(20),
      preferences: { ...base.preferences, theme: 'dark' as const },
    }
    const local = appData(30, true)
    const pending = {
      ...local,
      preferences: { ...local.preferences, language: 'zh-CN' as const },
      updatedAt: 40,
    }
    const save = vi.fn(async () => undefined)

    const result = await recoverAppDataWriteConflict(
      new AppDataWriteConflictError(),
      base,
      local,
      {
        load: vi.fn(async () => remote),
        save,
      },
    )

    expect(result.persistedSnapshot.preferences).toMatchObject({
      compactMode: true,
      theme: 'dark',
    })
    expect(save).toHaveBeenCalledWith(result.persistedSnapshot)
    expect(result.rebaseSnapshot(pending).preferences).toMatchObject({
      compactMode: true,
      language: 'zh-CN',
      theme: 'dark',
    })
  })

  it('retries against a newer revision without discarding the first merge', async () => {
    const base = appData(1)
    const firstRemote = {
      ...appData(20),
      preferences: { ...base.preferences, theme: 'dark' as const },
    }
    const secondRemote = {
      ...firstRemote,
      sync: { ...firstRemote.sync, workerEndpoint: 'https://sync.example.invalid' },
      updatedAt: 40,
    }
    const local = appData(30, true)
    const save = vi
      .fn<(snapshot: AppData) => Promise<void>>()
      .mockRejectedValueOnce(new AppDataWriteConflictError())
      .mockResolvedValue(undefined)

    const result = await recoverAppDataWriteConflict(
      new AppDataWriteConflictError(),
      base,
      local,
      {
        load: vi
          .fn<() => Promise<AppData | null>>()
          .mockResolvedValueOnce(firstRemote)
          .mockResolvedValueOnce(secondRemote),
        save,
      },
    )

    expect(save).toHaveBeenCalledTimes(2)
    expect(result.persistedSnapshot.preferences).toMatchObject({
      compactMode: true,
      theme: 'dark',
    })
    expect(result.persistedSnapshot.sync.workerEndpoint).toBe(
      'https://sync.example.invalid',
    )
  })

  it.each([
    {
      name: 'message deletion',
      remote: (base: AppData) => ({
        ...base,
        conversations: base.conversations.map((conversation) =>
          conversation.id === 'conversation-1'
            ? { ...conversation, messages: [], updatedAt: 40 }
            : conversation,
        ),
        updatedAt: 40,
      }),
    },
    {
      name: 'conversation deletion',
      remote: (base: AppData) => ({
        ...base,
        conversations: base.conversations.filter(
          (conversation) => conversation.id !== 'conversation-1',
        ),
        updatedAt: 40,
      }),
    },
    {
      name: 'same-id generation recreation',
      remote: (base: AppData) => ({
        ...base,
        conversations: base.conversations.map((conversation) =>
          conversation.id === 'conversation-1'
            ? {
                ...conversation,
                createdAt: 100,
                messages: [
                  {
                    id: 'assistant-1',
                    role: 'assistant' as const,
                    content: 'New incarnation',
                    createdAt: 101,
                    status: 'done' as const,
                  },
                ],
                updatedAt: 40,
              }
            : conversation,
        ),
        updatedAt: 40,
      }),
    },
  ])(
    'rejects a stale generation commit after remote $name without saving it',
    async ({ remote: createRemote }) => {
      const base = generationData(10)
      const incarnation = captureGenerationIncarnation(
        base,
        'conversation-1',
        'assistant-1',
      )
      const local = {
        ...base,
        conversations: base.conversations.map((conversation) =>
          conversation.id === 'conversation-1'
            ? {
                ...conversation,
                messages: conversation.messages.map((message) => ({
                  ...message,
                  content: 'Late completion',
                  status: 'done' as const,
                })),
                updatedAt: 50,
              }
            : conversation,
        ),
        updatedAt: 50,
      }
      const remote = createRemote(base)
      const save = vi.fn(async () => undefined)

      expect(incarnation).not.toBeNull()
      const result = await recoverAppDataWriteConflict(
        new AppDataWriteConflictError(),
        base,
        local,
        {
          load: vi.fn(async () => remote),
          save,
        },
        (snapshot) =>
          incarnation !== null &&
          generationIncarnationExists(snapshot, incarnation),
      )

      expect(result.commitPreconditionSatisfied).toBe(false)
      expect(result.persistedSnapshot).toBe(remote)
      expect(save).not.toHaveBeenCalled()
      expect(
        result.rebaseSnapshot({
          ...local,
          preferences: { ...local.preferences, compactMode: true },
          updatedAt: 60,
        }).preferences.compactMode,
      ).toBe(true)
      expect(
        incarnation &&
          generationIncarnationExists(
            result.rebaseSnapshot(local),
            incarnation,
          ),
      ).toBe(false)
    },
  )
})
