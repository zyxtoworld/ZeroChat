import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  DEFAULT_SKILL_CONTEXT_BUDGET,
  MAX_CHAT_CONTEXT_MESSAGE_LIMIT,
  MIN_CHAT_CONTEXT_MESSAGE_LIMIT,
  bump,
  dangerWarningDismissed,
  defaultSkillSettings,
  dismissDangerWarningInData,
  hasPendingGenerationMessage,
  hasStreamingMessage,
  mergeSyncIdentifiers,
  normalizeAppData,
  normalizeChatContextMessageLimit,
  normalizeSkillSettings,
  updateChatContextMessageLimitPreference,
  updateCompactModePreference,
  updateConversation,
  updateLanguagePreference,
  updateSyncGistFile,
  updateSyncGistId,
  updateSyncMode,
  updateSyncWorkerEndpoint,
  updateThemePreference,
} from '../appData'
import { providerFromPreset, providerPresets } from '../../data/presets'
import type { AppData } from '../../types'

declare const process: {
  getBuiltinModule(name: 'node:fs'): {
    readFileSync(path: string, encoding: 'utf8'): string
  }
}

const { readFileSync } = process.getBuiltinModule('node:fs')

const snapshotSchema = JSON.parse(
  readFileSync('shared/snapshot.schema.json', 'utf8'),
) as {
  required: string[]
  properties: Record<string, unknown>
  $defs: {
    provider: {
      required: string[]
      properties: Record<string, unknown>
    }
    conversation: {
      required: string[]
      properties: Record<string, unknown>
    }
    message: {
      required: string[]
      properties: Record<string, unknown>
    }
    queuedTextRequest: {
      required: string[]
      properties: Record<string, unknown>
    }
    offlineReplayClaim: {
      additionalProperties: boolean
      required: string[]
      properties: Record<string, unknown>
    }
    skill: {
      required: string[]
      properties: Record<string, unknown>
    }
    skillChunk: {
      required: string[]
      properties: Record<string, unknown>
    }
  }
}
const syncVaultSchema = JSON.parse(
  readFileSync('shared/sync-vault.schema.json', 'utf8'),
) as {
  required: string[]
  properties: {
    secrets: {
      required: string[]
      properties: Record<string, unknown>
    }
  } & Record<string, unknown>
}
const providerCapabilityModelFields = [
  'audioSpeechModel',
  'audioTranscriptionModel',
  'embeddingModel',
  'moderationModel',
  'realtimeModel',
] as const

function expectOnlySchemaKeys(
  value: Record<string, unknown>,
  properties: Record<string, unknown>,
) {
  expect(Object.keys(value).sort()).toEqual(
    expect.arrayContaining(Object.keys(value)),
  )

  for (const key of Object.keys(value)) {
    expect(Object.hasOwn(properties, key), `unexpected schema key ${key}`).toBe(
      true,
    )
  }
}

function expectRequiredKeys(value: Record<string, unknown>, required: string[]) {
  for (const key of required) {
    expect(Object.hasOwn(value, key), `missing required schema key ${key}`).toBe(
      true,
    )
  }
}

describe('appData normalization', () => {
  function appData(patch: Partial<AppData> = {}): AppData {
    const provider = providerFromPreset(providerPresets[0])

    return {
      version: 1,
      providers: [provider],
      conversations: [
        {
          id: 'conversation-1',
          title: 'Chat',
          providerId: provider.id,
          model: provider.model,
          messages: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
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
        activeConversationId: 'conversation-1',
      },
      updatedAt: 1,
      ...patch,
    }
  }

  it('normalizes configurable chat context message limits', () => {
    expect(normalizeChatContextMessageLimit(undefined)).toBe(
      DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
    )
    expect(normalizeChatContextMessageLimit(1)).toBe(
      MIN_CHAT_CONTEXT_MESSAGE_LIMIT,
    )
    expect(normalizeChatContextMessageLimit(999)).toBe(
      MAX_CHAT_CONTEXT_MESSAGE_LIMIT,
    )
    expect(normalizeChatContextMessageLimit(12.6)).toBe(13)
  })

  it('updates conversation timestamps and detects active generation states', () => {
    const data = appData()
    const updated = updateConversation(data, 'conversation-1', (conversation) => ({
      ...conversation,
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          content: 'Streaming',
          status: 'streaming',
          createdAt: 1,
        },
      ],
    }))

    expect(updated.updatedAt).toBeGreaterThanOrEqual(data.updatedAt)
    expect(updated.conversations[0].updatedAt).toBeGreaterThanOrEqual(
      data.conversations[0].updatedAt,
    )
    expect(hasStreamingMessage(updated)).toBe(true)
    expect(hasPendingGenerationMessage(updated)).toBe(true)
    expect(
      hasPendingGenerationMessage(
        updateConversation(updated, 'conversation-1', (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => ({
            ...message,
            status: 'queued',
          })),
        })),
      ),
    ).toBe(true)
    expect(
      updateConversation(data, 'missing-conversation', () => {
        throw new Error('missing conversations must not call the updater')
      }).conversations[0],
    ).toBe(data.conversations[0])
  })

  it('preserves sync identifiers only when synced data uses the same mode', () => {
    const current = appData({
      sync: {
        mode: 'cloudflare',
        autoSync: true,
        encryptionEnabled: false,
        workerEndpoint: 'https://local.example',
        gistId: 'local-gist',
        gistFile: 'local.json',
      },
    })
    const sameMode = appData({
      sync: {
        mode: 'cloudflare',
        autoSync: true,
        encryptionEnabled: false,
        workerEndpoint: 'https://remote.example',
        gistId: 'remote-gist',
        gistFile: 'remote.json',
      },
    })
    const differentMode = appData({
      sync: {
        mode: 'gist',
        autoSync: true,
        encryptionEnabled: false,
        workerEndpoint: 'https://other.example',
        gistId: 'other-gist',
        gistFile: 'other.json',
      },
    })

    expect(mergeSyncIdentifiers(current, sameMode).sync).toMatchObject({
      encryptionEnabled: true,
      workerEndpoint: 'https://remote.example',
      gistId: 'remote-gist',
      gistFile: 'remote.json',
    })
    expect(mergeSyncIdentifiers(current, differentMode).sync).toMatchObject({
      encryptionEnabled: true,
      workerEndpoint: 'https://local.example',
      gistId: 'local-gist',
      gistFile: 'local.json',
    })
    expect(bump(current).updatedAt).toBeGreaterThanOrEqual(current.updatedAt)
  })

  it('keeps current sync identifiers when same-mode synced data omits them', () => {
    const current = appData({
      sync: {
        mode: 'cloudflare',
        autoSync: true,
        encryptionEnabled: false,
        workerEndpoint: 'https://local.example',
        gistId: 'local-gist',
        gistFile: 'local.json',
      },
    })
    const sparseSynced = appData({
      sync: {
        mode: 'cloudflare',
        autoSync: true,
        encryptionEnabled: false,
      },
    })

    expect(mergeSyncIdentifiers(current, sparseSynced).sync).toMatchObject({
      encryptionEnabled: true,
      workerEndpoint: 'https://local.example',
      gistId: 'local-gist',
      gistFile: 'local.json',
    })
  })

  it('updates sync settings through focused AppData helpers', () => {
    const data = appData({
      sync: {
        mode: 'local',
        autoSync: false,
        encryptionEnabled: false,
      },
    })
    const cloudflare = updateSyncMode(data, 'cloudflare')

    expect(cloudflare.sync).toMatchObject({
      autoSync: true,
      encryptionEnabled: true,
      mode: 'cloudflare',
    })
    expect(updateSyncMode(cloudflare, 'local').sync.autoSync).toBe(false)
    expect(updateSyncGistId(cloudflare, ' gist-123 ').sync.gistId).toBe(
      'gist-123',
    )
    expect(updateSyncGistId(cloudflare, '   ').sync.gistId).toBeUndefined()
    expect(updateSyncGistFile(cloudflare, ' zerochat.json ').sync.gistFile).toBe(
      'zerochat.json',
    )
    expect(updateSyncGistFile(cloudflare, '   ').sync.gistFile).toBe(
      'zerochat-sync.json',
    )
    expect(
      updateSyncWorkerEndpoint(
        cloudflare,
        ' https://zerochat.example.workers.dev ',
      ).sync.workerEndpoint,
    ).toBe('https://zerochat.example.workers.dev')
    expect(
      updateSyncWorkerEndpoint(cloudflare, '').sync.workerEndpoint,
    ).toBeUndefined()
  })

  it('updates preferences and danger-warning dismissal without duplicating ids', () => {
    const data = appData()
    const dismissed = dismissDangerWarningInData(data, 'reset-local-data')
    const dismissedAgain = dismissDangerWarningInData(dismissed, 'reset-local-data')

    expect(dangerWarningDismissed(data, 'reset-local-data')).toBe(false)
    expect(dangerWarningDismissed(dismissed, 'reset-local-data')).toBe(true)
    expect(dismissedAgain).toBe(dismissed)
    expect(
      updateThemePreference(data, 'dark').preferences.theme,
    ).toBe('dark')
    expect(
      updateLanguagePreference(data, 'en-US').preferences.language,
    ).toBe('en-US')
    expect(
      updateCompactModePreference(data, true).preferences.compactMode,
    ).toBe(true)
    expect(
      updateChatContextMessageLimitPreference(data, 999).preferences
        .chatContextMessageLimit,
    ).toBe(MAX_CHAT_CONTEXT_MESSAGE_LIMIT)
  })

  it('clamps Skill settings to safe runtime bounds', () => {
    expect(normalizeSkillSettings({ autoMatch: false, contextBudget: 12, maxAutoSkills: 99 })).toEqual({
      autoMatch: false,
      contextBudget: 600,
      maxAutoSkills: 8,
    })

    expect(normalizeSkillSettings({ contextBudget: Number.NaN, maxAutoSkills: 0 })).toEqual({
      ...defaultSkillSettings(),
      maxAutoSkills: 1,
    })

    expect(defaultSkillSettings().contextBudget).toBe(DEFAULT_SKILL_CONTEXT_BUDGET)
    expect(normalizeSkillSettings(null)).toEqual(defaultSkillSettings())
  })

  it('drops malformed Skills while preserving indexed chunk references', () => {
    const normalized = normalizeAppData({
      version: 1,
      providers: [],
      conversations: [],
      skills: [
        {
          id: 'indexed-skill',
          name: ' Indexed Skill ',
          description: '  kept  ',
          contentType: 'markdown',
          sourceSize: 10,
          contentHash: 'hash',
          keywords: [' sync ', '', 'cloud'],
          fixed: true,
          enabled: true,
          autoMatch: true,
          createdAt: -10,
          updatedAt: Number.NaN,
          chunks: [
            {
              id: '',
              heading: '',
              contentRef: ' skill:indexed-skill:chunk-1 ',
              contentPreview: '  preview text  ',
              keywords: ['worker', ''],
              tokenEstimate: 0,
            },
          ],
        },
        {
          id: 'empty-skill',
          name: 'Empty',
          chunks: [],
        },
      ],
      skillSettings: {
        autoMatch: true,
        contextBudget: 20_000,
        maxAutoSkills: 2,
      },
      sync: {
        mode: 'local',
        autoSync: false,
        encryptionEnabled: true,
      },
      preferences: {
        firstRunDone: false,
        theme: 'system',
        language: 'system',
        compactMode: false,
      },
      updatedAt: 1,
    } as unknown as AppData)

    expect(normalized.skills).toHaveLength(1)
    expect(normalized.skills[0].name).toBe('Indexed Skill')
    expect(normalized.skills[0].description).toBe('kept')
    expect(normalized.skills[0].keywords).toEqual(['sync', 'cloud'])
    expect(normalized.skills[0].chunks[0]).toMatchObject({
      id: 'chunk-1',
      heading: 'Part 1',
      contentRef: 'skill:indexed-skill:chunk-1',
      contentPreview: 'preview text',
      keywords: ['worker'],
      tokenEstimate: 1,
    })
    expect(normalized.skillSettings.contextBudget).toBe(8000)
    expect(normalized.preferences.chatContextMessageLimit).toBe(
      DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
    )
  })

  it('normalizes inline Skill content and empty legacy fields safely', () => {
    const normalized = normalizeAppData({
      version: 1,
      providers: [],
      conversations: [],
      skills: [
        null,
        {
          chunks: [
            null,
            {
              content: '  keep inline content  ',
              tokenEstimate: '5.4',
            },
            {
              content: '   ',
            },
          ],
        },
      ],
      skillSettings: 'legacy',
      sync: {
        mode: 'local',
        autoSync: false,
        encryptionEnabled: true,
      },
      preferences: {
        firstRunDone: false,
        theme: 'system',
        language: 'system',
        compactMode: false,
      },
      updatedAt: 1,
    } as unknown as AppData)

    expect(normalized.skills).toHaveLength(1)
    expect(normalized.skills[0]).toMatchObject({
      name: 'Skill',
      description: '',
      contentType: 'text',
      sourceSize: 'keep inline content'.length,
      enabled: true,
      autoMatch: true,
    })
    expect(normalized.skills[0].chunks[0]).toMatchObject({
      content: 'keep inline content',
      contentPreview: 'keep inline content',
      tokenEstimate: 5,
    })
    expect(normalized.skillSettings).toEqual(defaultSkillSettings())
  })

  it('drops non-array legacy Skill chunks while keeping ref-only chunks', () => {
    const normalized = normalizeAppData({
      version: 1,
      providers: [],
      conversations: [],
      skills: [
        {
          name: 'Bad chunks',
          chunks: 'legacy',
        },
        {
          id: 'ref-skill',
          name: 'Ref Skill',
          chunks: [
            {
              contentRef: ' skill:ref-skill:chunk-1 ',
            },
          ],
        },
      ],
      skillSettings: defaultSkillSettings(),
      sync: {
        mode: 'local',
        autoSync: false,
        encryptionEnabled: true,
      },
      preferences: {
        firstRunDone: false,
        theme: 'system',
        language: 'system',
        compactMode: false,
      },
      updatedAt: 1,
    } as unknown as AppData)

    expect(normalized.skills).toHaveLength(1)
    expect(normalized.skills[0].name).toBe('Ref Skill')
    expect(normalized.skills[0].chunks[0]).toMatchObject({
      id: 'chunk-1',
      heading: 'Part 1',
      contentRef: 'skill:ref-skill:chunk-1',
      tokenEstimate: 1,
    })
    expect(normalized.skills[0].chunks[0].content).toBeUndefined()
    expect(normalized.skills[0].chunks[0].contentPreview).toBeUndefined()
  })

  it('normalizes legacy Skill metadata fallbacks without losing disabled state', () => {
    const longSkillKeywords = Array.from(
      { length: 60 },
      (_, index) => ` skill-${index} `,
    )
    const longChunkKeywords = Array.from(
      { length: 40 },
      (_, index) => ` chunk-${index} `,
    )
    const normalized = normalizeAppData({
      version: 1,
      providers: [],
      conversations: [],
      skills: [
        {
          id: '',
          name: '   ',
          description: 42,
          fileName: ' fallback-name.md ',
          contentType: 'pdf',
          sourceSize: Number.NaN,
          contentHash: '',
          keywords: [' keep ', 42, '', ...longSkillKeywords],
          fixed: 'legacy-fixed',
          enabled: false,
          autoMatch: false,
          createdAt: 0,
          updatedAt: 'bad',
          chunks: [
            {
              id: '',
              heading: '',
              content: '  content body  ',
              contentPreview: '',
              keywords: [' chunk-keep ', null, ...longChunkKeywords],
              tokenEstimate: Number.NaN,
            },
          ],
        },
      ],
      skillSettings: defaultSkillSettings(),
      sync: {
        mode: 'local',
        autoSync: false,
        encryptionEnabled: true,
      },
      preferences: {
        firstRunDone: false,
        theme: 'system',
        language: 'system',
        compactMode: false,
      },
      updatedAt: 1,
    } as unknown as AppData)

    const skill = normalized.skills[0]

    expect(skill.id).toMatch(/^skill-/)
    expect(skill).toMatchObject({
      name: 'fallback-name.md',
      description: '',
      fileName: 'fallback-name.md',
      contentType: 'text',
      sourceSize: 'content body'.length,
      contentHash: `${'content body'.length}:1`,
      fixed: true,
      enabled: false,
      autoMatch: false,
    })
    expect(skill.keywords).toHaveLength(48)
    expect(skill.keywords[0]).toBe('keep')
    expect(skill.chunks[0]).toMatchObject({
      id: 'chunk-1',
      heading: 'Part 1',
      content: 'content body',
      contentPreview: 'content body',
      tokenEstimate: 3,
    })
    expect(skill.chunks[0].keywords).toHaveLength(32)
    expect(skill.chunks[0].keywords[0]).toBe('chunk-keep')
  })

  it('creates a safe empty chat when a provider-backed snapshot has no conversations', () => {
    const provider = providerFromPreset(providerPresets[0])
    const normalized = normalizeAppData({
      version: 1,
      providers: [provider],
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
        compactMode: false,
        activeConversationId: 'missing-conversation',
      },
      updatedAt: 1,
    })

    expect(normalized.conversations).toHaveLength(1)
    expect(normalized.conversations[0]).toMatchObject({
      providerId: provider.id,
      model: provider.model,
      messages: [],
    })
    expect(normalized.preferences.activeConversationId).toBe(
      normalized.conversations[0].id,
    )
  })

  it('keeps fallback conversation ids unique when WebCrypto is unavailable', () => {
    const provider = providerFromPreset(providerPresets[0])
    vi.spyOn(Date, 'now').mockReturnValue(123_456)
    vi.stubGlobal('crypto', undefined)

    try {
      const input = {
        version: 1,
        providers: [provider],
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
          compactMode: false,
        },
        updatedAt: 1,
      } satisfies AppData
      const first = normalizeAppData(input)
      const second = normalizeAppData(input)

      expect(first.conversations[0]).toMatchObject({
        createdAt: 123_456,
        updatedAt: 123_456,
      })
      expect(first.conversations[0].id).toMatch(
        /^conversation-[a-z0-9]+-123456-[0-9]+$/,
      )
      expect(second.conversations[0].id).not.toBe(first.conversations[0].id)
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })

  it('keeps providerless snapshots providerless for the first-provider empty state', () => {
    const normalized = normalizeAppData({
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
        compactMode: false,
      },
      updatedAt: 1,
    })

    expect(normalized.providers).toEqual([])
    expect(normalized.conversations).toEqual([])
    expect(normalized.skills).toEqual([])
    expect(normalized.preferences.activeConversationId).toBeUndefined()
  })

  it('clears stale active conversation ids when no fallback chat can be created', () => {
    const normalized = normalizeAppData({
      version: 1,
      providers: 'legacy',
      conversations: [],
      skills: 'legacy',
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
        activeConversationId: 'missing-conversation',
      },
      updatedAt: 1,
    } as unknown as AppData)

    expect(normalized.conversations).toEqual([])
    expect(normalized.preferences.activeConversationId).toBeUndefined()
  })

  it('keeps normalized Web AppData compatible with the shared snapshot and sync-vault schemas', () => {
    const provider = providerFromPreset(providerPresets[0])
    const normalized = normalizeAppData(
      appData({
        providers: [provider],
        conversations: [
          {
            id: 'conversation-contract',
            title: 'Contract',
            providerId: provider.id,
            model: provider.model,
            messages: [
              {
                id: 'message-queued',
                role: 'assistant',
                content: 'Queued offline',
                status: 'queued',
                createdAt: 1,
                queuedTextRequest: {
                  providerId: provider.id,
                  model: provider.model,
                },
                offlineReplayClaim: {
                  claimId: 'claim-1',
                  owner: 'tab-1',
                },
              },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        skills: [
          {
            id: 'skill-contract',
            name: 'Contract Skill',
            description: 'Schema guard',
            fileName: 'contract.md',
            contentType: 'markdown',
            sourceSize: 16,
            contentHash: 'contract-hash',
            keywords: ['schema'],
            chunks: [
              {
                id: 'chunk-1',
                heading: 'Contract',
                contentRef: 'skill:contract:chunk-1',
                contentPreview: 'Keep schema tight',
                keywords: ['schema'],
                tokenEstimate: 4,
              },
            ],
            fixed: false,
            enabled: true,
            autoMatch: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        sync: {
          mode: 'cloudflare',
          autoSync: true,
          encryptionEnabled: true,
          workerEndpoint: 'https://zerochat.example.workers.dev',
        },
      }),
    )
    const vault = {
      data: normalized,
      secrets: {
        providerKeys: {
          [provider.id]: 'example-provider-key',
        },
      },
    }

    expectOnlySchemaKeys(
      normalized as unknown as Record<string, unknown>,
      snapshotSchema.properties,
    )
    expectRequiredKeys(
      normalized as unknown as Record<string, unknown>,
      snapshotSchema.required,
    )
    expectOnlySchemaKeys(
      normalized.providers[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.provider.properties,
    )
    expectRequiredKeys(
      normalized.providers[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.provider.required,
    )
    expectOnlySchemaKeys(
      normalized.conversations[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.conversation.properties,
    )
    expectRequiredKeys(
      normalized.conversations[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.conversation.required,
    )
    expectOnlySchemaKeys(
      normalized.conversations[0].messages[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.message.properties,
    )
    expectRequiredKeys(
      normalized.conversations[0].messages[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.message.required,
    )
    expect(normalized.conversations[0].messages[0].status).toBe('queued')
    expectOnlySchemaKeys(
      normalized.conversations[0].messages[0]
        .queuedTextRequest as unknown as Record<string, unknown>,
      snapshotSchema.$defs.queuedTextRequest.properties,
    )
    expectRequiredKeys(
      normalized.conversations[0].messages[0]
        .queuedTextRequest as unknown as Record<string, unknown>,
      snapshotSchema.$defs.queuedTextRequest.required,
    )
    expectOnlySchemaKeys(
      normalized.conversations[0].messages[0]
        .offlineReplayClaim as unknown as Record<string, unknown>,
      snapshotSchema.$defs.offlineReplayClaim.properties,
    )
    expectRequiredKeys(
      normalized.conversations[0].messages[0]
        .offlineReplayClaim as unknown as Record<string, unknown>,
      snapshotSchema.$defs.offlineReplayClaim.required,
    )
    expect(snapshotSchema.$defs.offlineReplayClaim).toMatchObject({
      additionalProperties: false,
      required: ['claimId', 'owner'],
      properties: {
        claimId: { type: 'string', minLength: 1 },
        owner: { type: 'string', minLength: 1 },
      },
    })
    expectOnlySchemaKeys(
      normalized.skills[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.skill.properties,
    )
    expectRequiredKeys(
      normalized.skills[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.skill.required,
    )
    expectOnlySchemaKeys(
      normalized.skills[0].chunks[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.skillChunk.properties,
    )
    expectRequiredKeys(
      normalized.skills[0].chunks[0] as unknown as Record<string, unknown>,
      snapshotSchema.$defs.skillChunk.required,
    )
    expect(normalized.skills[0].chunks[0].contentRef).toBe(
      'skill:contract:chunk-1',
    )

    for (const field of providerCapabilityModelFields) {
      expect(normalized.providers[0][field]).toBeTruthy()
      expect(normalized.providers[0].models).toContain(normalized.providers[0][field])
    }

    expectOnlySchemaKeys(vault, syncVaultSchema.properties)
    expectRequiredKeys(vault, syncVaultSchema.required)
    expectOnlySchemaKeys(vault.secrets, syncVaultSchema.properties.secrets.properties)
    expectRequiredKeys(vault.secrets, syncVaultSchema.properties.secrets.required)
    expect(vault.secrets.providerKeys[provider.id]).toBe('example-provider-key')
  })
})
