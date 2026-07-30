import { describe, expect, it } from 'vitest'

import type {
  AppData,
  Conversation,
  ProviderConfig,
  SyncVault,
  UserSkill,
} from '../../types'
import { prepareMergedFirstSyncVault } from '../syncMerge'

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider',
    kind: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    model: 'model-1',
    enabled: true,
    needsApiKey: true,
    createdAt: 10,
    updatedAt: 10,
    ...patch,
  }
}

function conversation(id: string, updatedAt = 10): Conversation {
  return {
    id,
    title: id,
    providerId: 'provider-1',
    model: 'model-1',
    messages: [],
    createdAt: 10,
    updatedAt,
  }
}

function skill(id: string, updatedAt = 10): UserSkill {
  return {
    id,
    name: id,
    description: '',
    contentType: 'markdown',
    sourceSize: 1,
    contentHash: `hash-${id}`,
    keywords: [id],
    chunks: [
      {
        id: `chunk-${id}`,
        heading: id,
        content: id,
        keywords: [id],
        tokenEstimate: 1,
      },
    ],
    fixed: false,
    enabled: true,
    autoMatch: true,
    createdAt: 10,
    updatedAt,
  }
}

function appData(patch: Partial<AppData> = {}): AppData {
  return {
    version: 1,
    providers: [provider()],
    conversations: [],
    skills: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    sync: {
      mode: 'gist',
      autoSync: true,
      encryptionEnabled: true,
    },
    preferences: {
      firstRunDone: false,
      theme: 'system',
      language: 'system',
      compactMode: false,
    },
    updatedAt: 10,
    ...patch,
  }
}

describe('prepareMergedFirstSyncVault', () => {
  it('preserves field merge semantics and uses UTF-16 IDs for equal-time ordering', () => {
    const remoteData = appData({
      providers: [
        provider({
          name: 'Remote provider',
          model: 'remote-model',
          models: ['remote-model'],
          capabilities: ['chat'],
          createdAt: 5,
          updatedAt: 15,
        }),
      ],
      conversations: [conversation('\uE000')],
      skills: [skill('\uE000')],
      skillSettings: {
        autoMatch: false,
        contextBudget: 3200,
        maxAutoSkills: 5,
      },
      preferences: {
        firstRunDone: false,
        theme: 'dark',
        language: 'zh-CN',
        compactMode: false,
        activeConversationId: '\uE000',
        dismissedDangerWarnings: ['delete-message'],
        dismissedFeatureHints: ['chat'],
      },
    })
    const remote: SyncVault = {
      data: remoteData,
      secrets: {
        providerKeys: {
          'provider-1': 'remote-secret',
          'remote-only': 'remote-only-secret',
        },
      },
    }
    const local = appData({
      providers: [
        provider({
          name: 'Local provider',
          model: 'local-model',
          models: ['local-model'],
          capabilities: ['vision'],
          createdAt: 8,
          updatedAt: 20,
        }),
      ],
      conversations: [conversation('\u{10000}')],
      skills: [skill('\u{10000}')],
      preferences: {
        firstRunDone: true,
        theme: 'system',
        language: 'en-US',
        compactMode: true,
        activeConversationId: '\u{10000}',
        dismissedDangerWarnings: ['delete-provider'],
        dismissedFeatureHints: ['providers'],
      },
    })

    const merged = prepareMergedFirstSyncVault(remote, local, {
      providerKeys: { 'provider-1': 'local-secret' },
    })

    expect(merged.data.providers[0]).toMatchObject({
      name: 'Local provider',
      createdAt: 5,
      updatedAt: 20,
      models: ['local-model', 'remote-model'],
      capabilities: ['vision', 'chat'],
    })
    expect(merged.data.conversations.map((item) => item.id)).toEqual([
      '\u{10000}',
      '\uE000',
    ])
    expect(merged.data.skills.map((item) => item.id)).toEqual([
      '\u{10000}',
      '\uE000',
    ])
    expect(merged.data.skillSettings).toEqual(remoteData.skillSettings)
    expect(merged.data.preferences).toMatchObject({
      firstRunDone: true,
      theme: 'dark',
      language: 'en-US',
      compactMode: true,
      activeConversationId: '\u{10000}',
    })
    expect(merged.data.preferences.dismissedDangerWarnings).toEqual([
      'delete-message',
      'delete-provider',
    ])
    expect(merged.data.preferences.dismissedFeatureHints).toEqual([
      'chat',
      'providers',
    ])
    expect(merged.secrets.providerKeys).toEqual({
      'provider-1': 'local-secret',
      'remote-only': 'remote-only-secret',
    })
  })
})
