import { describe, expect, it, vi } from 'vitest'

import type {
  AppData,
  ChatMessage,
  UserSkill,
} from '../../types'
import { requestMessagesWithSkills } from '../chatGenerationSkillContext'

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'user-1',
    role: 'user',
    content: 'Explain local sync',
    createdAt: 1,
    status: 'done',
    ...patch,
  }
}

function skill(patch: Partial<UserSkill> = {}): UserSkill {
  return {
    id: 'skill-1',
    name: 'Support tone',
    description: 'Answer in a patient, practical tone.',
    contentType: 'markdown',
    sourceSize: 120,
    contentHash: 'hash-1',
    keywords: ['sync'],
    chunks: [
      {
        id: 'chunk-1',
        heading: 'Tone',
        keywords: ['sync'],
        tokenEstimate: 12,
      },
    ],
    fixed: true,
    enabled: true,
    autoMatch: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function appData(skills: UserSkill[]): AppData {
  return {
    version: 1,
    providers: [],
    conversations: [],
    skills,
    skillSettings: {
      autoMatch: true,
      contextBudget: 800,
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

describe('chat generation Skill context', () => {
  it('returns original messages without loading Skill service when no enabled Skills are active', async () => {
    const messages = [message()]
    const loadSkillService = vi.fn()

    const result = await requestMessagesWithSkills({
      snapshot: appData([skill({ enabled: false })]),
      messages,
      latestInput: 'sync help',
      loadSkillService,
    })

    expect(result).toBe(messages)
    expect(loadSkillService).not.toHaveBeenCalled()
  })

  it('returns original messages when enabled Skills produce no relevant context', async () => {
    const messages = [message()]
    const loadSkillChunkContent = vi.fn(async () => 'ignored chunk')
    const buildSkillSystemMessage = vi.fn(async () => '')

    const result = await requestMessagesWithSkills({
      snapshot: appData([skill()]),
      messages,
      latestInput: 'unrelated',
      loadSkillChunkContent,
      loadSkillService: async () => ({ buildSkillSystemMessage }),
    })

    expect(result).toBe(messages)
    expect(buildSkillSystemMessage).toHaveBeenCalledWith(
      appData([skill()]).skills,
      appData([skill()]).skillSettings,
      'unrelated',
      loadSkillChunkContent,
    )
  })

  it('prepends a deterministic Skill system message before user turns', async () => {
    const messages = [message()]
    const loadSkillChunkContent = vi.fn(async () => 'Please be concise.')
    const buildSkillSystemMessage = vi.fn(
      async () => 'Use these user-provided skills only when relevant.',
    )

    const result = await requestMessagesWithSkills({
      snapshot: appData([skill()]),
      messages,
      latestInput: 'sync help',
      loadSkillChunkContent,
      loadSkillService: async () => ({ buildSkillSystemMessage }),
      now: () => 42,
    })

    expect(result).toEqual([
      {
        id: 'skill-context-42',
        role: 'system',
        content: 'Use these user-provided skills only when relevant.',
        createdAt: 42,
      },
      messages[0],
    ])
    expect(messages).toEqual([message()])
  })
})
