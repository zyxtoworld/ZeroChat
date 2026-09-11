import { describe, expect, it } from 'vitest'

import type {
  AppData,
  ChatMessage,
  ProviderConfig,
  UserSkill,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import { mergeConcurrentAppData } from '../concurrentAppDataMerge'

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider',
    kind: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    model: 'model-1',
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function skill(patch: Partial<UserSkill> = {}): UserSkill {
  return {
    id: 'skill-1',
    name: 'Skill',
    description: 'Base skill',
    contentType: 'markdown',
    sourceSize: 4,
    contentHash: 'hash-1',
    keywords: ['base'],
    chunks: [
      {
        id: 'chunk-1',
        heading: 'Skill',
        content: 'base',
        keywords: ['base'],
        tokenEstimate: 1,
      },
    ],
    fixed: false,
    enabled: true,
    autoMatch: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function message(id: string, createdAt: number): ChatMessage {
  return {
    id,
    role: 'user',
    content: id,
    createdAt,
    status: 'done',
  }
}

function appData(patch: Partial<AppData> = {}): AppData {
  const item = provider()

  return {
    version: 1,
    providers: [item],
    conversations: [
      {
        id: 'conversation-1',
        title: 'Base title',
        providerId: item.id,
        model: item.model,
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    skills: [skill()],
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

describe('mergeConcurrentAppData', () => {
  it('preserves disjoint provider and conversation edits from separate tabs', () => {
    const base = appData()
    const remote = appData({
      providers: [
        provider({
          name: 'Remote provider',
          baseUrl: 'https://remote-provider.invalid/v2',
          updatedAt: 20,
        }),
      ],
      updatedAt: 20,
    })
    const local = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          title: 'Local title',
          updatedAt: 30,
        },
      ],
      updatedAt: 30,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 40)

    expect(merged.providers[0]?.name).toBe('Remote provider')
    expect(merged.providers[0]?.baseUrl).toBe(
      'https://remote-provider.invalid/v2',
    )
    expect(merged.conversations[0]?.title).toBe('Local title')
    expect(merged.updatedAt).toBe(40)
  })

  it('keeps a deletion when the other tab left the record unchanged', () => {
    const base = appData()
    const remote = appData({ updatedAt: 20 })
    const local = appData({ skills: [], updatedAt: 30 })

    expect(mergeConcurrentAppData(base, remote, local, 40).skills).toEqual([])
  })

  it('keeps an edit that is newer than a concurrent deletion', () => {
    const base = appData()
    const remote = appData({
      skills: [skill({ description: 'New remote edit', updatedAt: 40 })],
      updatedAt: 40,
    })
    const local = appData({ skills: [], updatedAt: 30 })

    const merged = mergeConcurrentAppData(base, remote, local, 50)

    expect(merged.skills).toHaveLength(1)
    expect(merged.skills[0]?.description).toBe('New remote edit')
  })

  it('merges distinct messages appended to the same conversation', () => {
    const base = appData()
    const remote = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [message('remote-message', 20)],
          updatedAt: 20,
        },
      ],
      updatedAt: 20,
    })
    const local = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [message('local-message', 30)],
          updatedAt: 30,
        },
      ],
      updatedAt: 30,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 40)

    expect(merged.conversations[0]?.messages.map((item) => item.id)).toEqual([
      'remote-message',
      'local-message',
    ])
  })

  it('keeps a concurrent message deletion over a later stale completion', () => {
    const assistant = {
      ...message('assistant-1', 10),
      role: 'assistant' as const,
      content: '',
      status: 'streaming' as const,
    }
    const base = appData({
      conversations: [
        { ...appData().conversations[0]!, messages: [assistant], updatedAt: 10 },
      ],
      updatedAt: 10,
    })
    const remote = appData({
      conversations: [
        { ...base.conversations[0]!, messages: [], updatedAt: 30 },
      ],
      updatedAt: 30,
    })
    const local = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [
            { ...assistant, content: 'Late answer', status: 'done' },
          ],
          updatedAt: 50,
        },
      ],
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.conversations[0]?.messages).toEqual([])
  })

  it('keeps a concurrent conversation deletion over a later stale completion', () => {
    const base = appData({
      conversations: [
        ...appData().conversations,
        {
          ...appData().conversations[0]!,
          id: 'conversation-fallback',
          createdAt: 2,
        },
      ],
      updatedAt: 10,
    })
    const remote = appData({
      conversations: base.conversations.filter(
        (conversation) => conversation.id !== 'conversation-1',
      ),
      updatedAt: 30,
    })
    const local = appData({
      conversations: base.conversations.map((conversation) =>
        conversation.id === 'conversation-1'
          ? {
              ...conversation,
              messages: [message('late-completion', 40)],
              updatedAt: 50,
            }
          : conversation,
      ),
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(
      merged.conversations.some(
        (conversation) => conversation.id === 'conversation-1',
      ),
    ).toBe(false)
  })

  it('does not resurrect the last conversation after a concurrent deletion', () => {
    const base = appData({ updatedAt: 10 })
    const remote = appData({ conversations: [], updatedAt: 30 })
    const local = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          title: 'Late stale title',
          updatedAt: 50,
        },
      ],
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.conversations).toEqual([])
    expect(merged.preferences.activeConversationId).toBeUndefined()
  })

  it('keeps a same-id conversation recreation after the old incarnation is deleted', () => {
    const base = appData({ updatedAt: 10 })
    const remote = appData({ conversations: [], updatedAt: 30 })
    const local = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          title: 'Recreated conversation',
          createdAt: 100,
          updatedAt: 50,
        },
      ],
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.conversations).toEqual([
      expect.objectContaining({
        id: 'conversation-1',
        title: 'Recreated conversation',
        createdAt: 100,
      }),
    ])
    expect(merged.preferences.activeConversationId).toBe('conversation-1')
  })

  it('keeps a same-id remote conversation recreation after local deletion', () => {
    const base = appData({ updatedAt: 10 })
    const remote = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          title: 'Recreated remotely',
          createdAt: 100,
          updatedAt: 50,
        },
      ],
      updatedAt: 50,
    })
    const local = appData({ conversations: [], updatedAt: 30 })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.conversations).toEqual([
      expect.objectContaining({
        id: 'conversation-1',
        title: 'Recreated remotely',
        createdAt: 100,
      }),
    ])
    expect(merged.preferences.activeConversationId).toBe('conversation-1')
  })

  it('does not resurrect the last Provider after a concurrent deletion', () => {
    const base = appData({ updatedAt: 10 })
    const remote = appData({ providers: [], updatedAt: 30 })
    const local = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          title: 'Late stale title',
          updatedAt: 50,
        },
      ],
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.providers).toEqual([])
  })

  it('keeps a same-id Provider recreation after the old incarnation is deleted', () => {
    const base = appData({ updatedAt: 10 })
    const remote = appData({ providers: [], updatedAt: 30 })
    const local = appData({
      providers: [
        provider({
          name: 'Recreated provider',
          createdAt: 100,
          updatedAt: 50,
        }),
      ],
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.providers).toEqual([
      expect.objectContaining({
        id: 'provider-1',
        name: 'Recreated provider',
        createdAt: 100,
      }),
    ])
  })

  it('keeps a newer same-id Provider incarnation over a stale local edit', () => {
    const base = appData({ updatedAt: 10 })
    const remote = appData({
      providers: [
        provider({
          createdAt: 100,
          name: 'Recreated remotely',
          updatedAt: 20,
        }),
      ],
      updatedAt: 20,
    })
    const local = appData({
      providers: [provider({ name: 'Stale local edit', updatedAt: 50 })],
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.providers).toEqual([
      expect.objectContaining({
        createdAt: 100,
        name: 'Recreated remotely',
      }),
    ])
  })

  it('keeps a newer same-id Skill incarnation over a stale local edit', () => {
    const base = appData({ updatedAt: 10 })
    const remote = appData({
      skills: [
        skill({
          createdAt: 100,
          name: 'Recreated remotely',
          contentHash: 'remote-hash',
          chunks: [
            {
              id: 'remote-chunk',
              heading: 'Recreated remotely',
              content: 'remote content',
              keywords: ['remote'],
              tokenEstimate: 2,
            },
          ],
          updatedAt: 20,
        }),
      ],
      updatedAt: 20,
    })
    const local = appData({
      skills: [
        skill({
          name: 'Stale local edit',
          contentHash: 'stale-local-hash',
          chunks: [
            {
              id: 'stale-local-chunk',
              heading: 'Stale local edit',
              content: 'late stale content',
              keywords: ['stale'],
              tokenEstimate: 3,
            },
          ],
          updatedAt: 50,
        }),
      ],
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.skills).toEqual([
      expect.objectContaining({
        createdAt: 100,
        name: 'Recreated remotely',
        contentHash: 'remote-hash',
        chunks: [
          expect.objectContaining({
            id: 'remote-chunk',
            content: 'remote content',
          }),
        ],
      }),
    ])
  })

  it('keeps a newer same-id attachment incarnation over a stale local edit', () => {
    const baseAttachment = {
      id: 'attachment-1',
      kind: 'image' as const,
      mimeType: 'image/png',
      url: 'https://old.example.invalid/image.png',
      alt: 'old image',
      createdAt: 1,
    }
    const baseMessage = {
      ...message('message-1', 10),
      attachments: [baseAttachment],
    }
    const baseConversation = {
      ...appData().conversations[0]!,
      messages: [baseMessage],
      updatedAt: 10,
    }
    const base = appData({ conversations: [baseConversation], updatedAt: 10 })
    const remote = appData({
      conversations: [
        {
          ...baseConversation,
          messages: [
            {
              ...baseMessage,
              attachments: [
                {
                  ...baseAttachment,
                  createdAt: 100,
                  url: 'https://remote.example.invalid/image.png',
                  alt: 'remote image',
                },
              ],
            },
          ],
          updatedAt: 20,
        },
      ],
      updatedAt: 20,
    })
    const local = appData({
      conversations: [
        {
          ...baseConversation,
          messages: [
            {
              ...baseMessage,
              attachments: [
                {
                  ...baseAttachment,
                  alt: 'late stale image edit',
                },
              ],
            },
          ],
          updatedAt: 50,
        },
      ],
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.conversations[0]?.messages[0]?.attachments).toEqual([
      expect.objectContaining({
        id: 'attachment-1',
        createdAt: 100,
        url: 'https://remote.example.invalid/image.png',
        alt: 'remote image',
      }),
    ])
  })

  it('does not merge an old completion into a same-id recreated message', () => {
    const oldAssistant = {
      ...message('assistant-1', 10),
      role: 'assistant' as const,
      content: '',
      status: 'streaming' as const,
    }
    const base = appData({
      conversations: [
        {
          ...appData().conversations[0]!,
          messages: [oldAssistant],
          updatedAt: 10,
        },
      ],
      updatedAt: 10,
    })
    const remote = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [
            {
              ...oldAssistant,
              content: 'New incarnation',
              createdAt: 100,
              status: 'done',
            },
          ],
          updatedAt: 30,
        },
      ],
      updatedAt: 30,
    })
    const local = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [
            { ...oldAssistant, content: 'Late answer', status: 'done' },
          ],
          updatedAt: 50,
        },
      ],
      updatedAt: 50,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 60)

    expect(merged.conversations[0]?.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        content: 'New incarnation',
        createdAt: 100,
      }),
    ])
  })

  it('does not merge same-timestamp message incarnations with different generations', () => {
    const oldAssistant: ChatMessage = {
      ...message('assistant-1', 10),
      role: 'assistant',
      content: 'old stream',
      status: 'streaming',
      generationId: 'old-generation',
    }
    const base = appData({
      conversations: [
        {
          ...appData().conversations[0]!,
          messages: [oldAssistant],
          updatedAt: 10,
        },
      ],
      updatedAt: 10,
    })
    const remote = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [
            {
              ...oldAssistant,
              content: 'new stream',
              generationId: 'new-generation',
            },
          ],
          updatedAt: 20,
        },
      ],
      updatedAt: 20,
    })
    const local = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [
            { ...oldAssistant, content: 'late old completion', status: 'done' },
          ],
          updatedAt: 30,
        },
      ],
      updatedAt: 30,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 40)

    expect(merged.conversations[0]?.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        content: 'new stream',
        status: 'streaming',
        generationId: 'new-generation',
      }),
    ])
    expect(
      merged.conversations[0]?.messages.some(
        (item) => item.content === 'late old completion',
      ),
    ).toBe(false)
  })

  it('orders equal-time messages and attachments by UTF-16 code units', () => {
    const base = appData()
    const remoteMessage: ChatMessage = {
      ...message('shared-message', 10),
      attachments: [
        {
          id: '\uE000',
          kind: 'image',
          mimeType: 'image/png',
          url: 'https://example.invalid/remote.png',
          createdAt: 10,
        },
      ],
    }
    const localMessage: ChatMessage = {
      ...message('shared-message', 10),
      attachments: [
        {
          id: '\u{10000}',
          kind: 'image',
          mimeType: 'image/png',
          url: 'https://example.invalid/local.png',
          createdAt: 10,
        },
      ],
    }
    const remote = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [message('\uE000', 10), remoteMessage],
          updatedAt: 20,
        },
      ],
      updatedAt: 20,
    })
    const local = appData({
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [message('\u{10000}', 10), localMessage],
          updatedAt: 20,
        },
      ],
      updatedAt: 20,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 30)

    expect(merged.conversations[0]?.messages.map((item) => item.id)).toEqual([
      'shared-message',
      '\u{10000}',
      '\uE000',
    ])
    expect(
      merged.conversations[0]?.messages
        .find((item) => item.id === 'shared-message')
        ?.attachments?.map((item) => item.id),
    ).toEqual(['\u{10000}', '\uE000'])
  })

  it('merges object fields independently and resolves same-field conflicts by recency', () => {
    const base = appData()
    const remote = appData({
      preferences: {
        ...base.preferences,
        theme: 'dark',
      },
      sync: {
        ...base.sync,
        workerEndpoint: 'https://sync.example.invalid',
      },
      updatedAt: 20,
    })
    const local = appData({
      preferences: {
        ...base.preferences,
        theme: 'light',
        compactMode: true,
      },
      updatedAt: 30,
    })

    const merged = mergeConcurrentAppData(base, remote, local, 40)

    expect(merged.preferences.theme).toBe('light')
    expect(merged.preferences.compactMode).toBe(true)
    expect(merged.sync.workerEndpoint).toBe('https://sync.example.invalid')
  })
})
