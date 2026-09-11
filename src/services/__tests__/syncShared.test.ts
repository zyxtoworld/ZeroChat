import { beforeAll, describe, expect, it } from 'vitest'

import { loadLocale, rt, setRuntimeLocale } from '../../i18n'
import type { AppData, SyncVault } from '../../types'
import { defaultSkillSettings } from '../appData'
import { encryptVault } from '../crypto'
import {
  isChatMessageShape,
  parseRemoteVault,
  serializeVault,
} from '../syncShared'

declare const process: {
  getBuiltinModule(name: 'node:fs'): {
    readFileSync(path: string, encoding: 'utf8'): string
  }
}

const { readFileSync } = process.getBuiltinModule('node:fs')
const passphrase = 'shared sync test passphrase'
const queuedTextRequestSchema = (
  JSON.parse(readFileSync('shared/snapshot.schema.json', 'utf8')) as {
    $defs: {
      queuedTextRequest: {
        properties: Record<string, { minLength?: number; type?: string }>
        required: string[]
      }
    }
  }
).$defs.queuedTextRequest

beforeAll(async () => {
  await loadLocale('en-US')
  setRuntimeLocale('en-US')
})

function appData(patch: Partial<AppData> = {}): AppData {
  return {
    conversations: [],
    preferences: {
      compactMode: false,
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers: [],
    skillSettings: defaultSkillSettings(),
    skills: [],
    sync: {
      autoSync: true,
      encryptionEnabled: true,
      mode: 'gist',
    },
    updatedAt: 10,
    version: 1,
    ...patch,
  }
}

async function encryptedRemoteVault(vault: unknown): Promise<string> {
  return JSON.stringify(
    await encryptVault(vault as SyncVault, passphrase),
    null,
    2,
  )
}

describe('shared sync vault codec', () => {
  it('keeps promptMessageId optional but non-empty in the shared schema', () => {
    expect(queuedTextRequestSchema.required).toEqual(
      expect.arrayContaining(['providerId', 'model']),
    )
    expect(queuedTextRequestSchema.required).not.toContain('promptMessageId')
    expect(queuedTextRequestSchema.properties.promptMessageId).toEqual({
      minLength: 1,
      type: 'string',
    })
  })

  it('accepts a current encrypted sync vault', async () => {
    const remote = appData({
      conversations: [
        {
          createdAt: 20,
          id: 'conversation-remote',
          messages: [
            {
              content: 'Queued offline',
              createdAt: 21,
              id: 'message-queued',
              role: 'assistant',
              status: 'queued',
              queuedTextRequest: {
                providerId: 'provider-remote',
                model: 'gpt-5',
              },
              offlineReplayClaim: {
                claimId: 'claim-remote',
                owner: 'runtime-remote',
              },
            },
          ],
          model: 'gpt-5',
          providerId: 'provider-remote',
          title: 'Remote chat',
          updatedAt: 22,
        },
      ],
      providers: [
        {
          baseUrl: 'https://provider.example/v1',
          createdAt: 20,
          enabled: true,
          id: 'provider-remote',
          kind: 'openai-compatible',
          model: 'gpt-5',
          name: 'Remote provider',
          needsApiKey: true,
          updatedAt: 22,
        },
      ],
      skills: [
        {
          autoMatch: true,
          chunks: [
            {
              contentPreview: 'Indexed Skill preview',
              contentRef: 'skill:remote:chunk-1',
              heading: 'Indexed',
              id: 'chunk-1',
              keywords: ['indexed'],
              tokenEstimate: 8,
            },
          ],
          contentHash: 'hash-remote',
          contentType: 'markdown',
          createdAt: 20,
          description: 'Remote indexed Skill',
          enabled: true,
          fixed: false,
          id: 'skill-remote',
          keywords: ['indexed'],
          name: 'Remote Skill',
          sourceSize: 64,
          updatedAt: 22,
        },
      ],
      updatedAt: 30,
    })

    const parsed = await parseRemoteVault(
      await serializeVault(
        remote,
        {
          providerKeys: {
            providerRemote: 'remote-key',
          },
        },
        passphrase,
      ),
      passphrase,
    )

    expect(parsed?.data.updatedAt).toBe(30)
    expect(
      parsed?.data.conversations[0].messages[0].queuedTextRequest,
    ).toEqual({
      providerId: 'provider-remote',
      model: 'gpt-5',
    })
    expect(
      parsed?.data.conversations[0].messages[0].offlineReplayClaim,
    ).toEqual({
      claimId: 'claim-remote',
      owner: 'runtime-remote',
    })
    expect(parsed?.secrets.providerKeys).toEqual({
      providerRemote: 'remote-key',
    })
  })

  it('rejects a blank passphrase before serializing a sync vault', async () => {
    await expect(
      serializeVault(appData(), { providerKeys: {} }, '   '),
    ).rejects.toThrow(rt('error.syncPassphraseRequired'))
  })

  it('keeps incremental message placeholders loose for materialization', () => {
    expect(
      isChatMessageShape({
        content: '',
        createdAt: 1,
        id: 'placeholder-message',
        role: 'assistant',
        attachments: [
          {
            createdAt: 1,
            id: 'placeholder-attachment',
            kind: 'image',
            mimeType: 'image/png',
          },
        ],
      }),
    ).toBe(true)

  })

  it('round-trips queued text requests with a prompt message id', async () => {
    const remote = appData({
      conversations: [
        {
          createdAt: 20,
          id: 'conversation-prompt',
          messages: [
            {
              content: 'Queued offline',
              createdAt: 21,
              id: 'message-queued',
              queuedTextRequest: {
                model: 'gpt-5',
                promptMessageId: 'message-prompt',
                providerId: 'provider-remote',
              },
              role: 'assistant',
              status: 'queued',
            },
          ],
          model: 'gpt-5',
          providerId: 'provider-remote',
          title: 'Prompt-linked queue',
          updatedAt: 22,
        },
      ],
    })

    const parsed = await parseRemoteVault(
      await serializeVault(remote, { providerKeys: {} }, passphrase),
      passphrase,
    )

    expect(
      parsed?.data.conversations[0].messages[0].queuedTextRequest,
    ).toEqual({
      model: 'gpt-5',
      promptMessageId: 'message-prompt',
      providerId: 'provider-remote',
    })
  })

  it('rejects an empty queued prompt message id', async () => {
    const malformed = {
      data: appData({
        conversations: [
          {
            createdAt: 1,
            id: 'conversation-empty-prompt',
            messages: [
              {
                content: 'Queued offline',
                createdAt: 1,
                id: 'message-empty-prompt',
                queuedTextRequest: {
                  model: 'gpt-5',
                  promptMessageId: '',
                  providerId: 'provider-empty-prompt',
                },
                role: 'assistant',
                status: 'queued',
              },
            ],
            model: 'gpt-5',
            providerId: 'provider-empty-prompt',
            title: 'Empty prompt id',
            updatedAt: 1,
          },
        ],
      }),
      secrets: { providerKeys: {} },
    }

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects decrypted remote vaults that are missing current AppData fields', async () => {
    const malformed = {
      data: {
        conversations: [],
        preferences: {
          compactMode: false,
          firstRunDone: true,
          language: 'system',
          theme: 'system',
        },
        providers: [],
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          mode: 'gist',
        },
        updatedAt: 10,
        version: 1,
      },
      secrets: {
        providerKeys: {},
      },
    }

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects decrypted remote vaults with malformed sync settings', async () => {
    const malformed = {
      data: appData({
        sync: {
          autoSync: true,
          encryptionEnabled: true,
          mode: 'local',
        },
      }),
      secrets: {
        providerKeys: {},
      },
    }

    malformed.data.sync = {
      ...malformed.data.sync,
      mode: 'legacy-plain-text',
    } as unknown as AppData['sync']

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects decrypted remote vaults with non-string provider secrets', async () => {
    const malformed = {
      data: appData(),
      secrets: {
        providerKeys: {
          providerRemote: 42,
        },
      },
    }

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects decrypted remote vaults with malformed provider entries', async () => {
    const malformed = {
      data: appData({
        providers: [
          {
            baseUrl: 'https://provider.example/v1',
            createdAt: 1,
            enabled: true,
            id: 'provider-bad',
            kind: 'legacy-provider',
            model: 'gpt-5',
            name: 'Bad provider',
            needsApiKey: true,
            updatedAt: 1,
          },
        ] as unknown as AppData['providers'],
      }),
      secrets: {
        providerKeys: {},
      },
    }

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects duplicate provider models and unknown capabilities', async () => {
    const provider = {
      baseUrl: 'https://provider.example/v1',
      capabilities: ['chat'],
      createdAt: 1,
      enabled: true,
      id: 'provider-bad-contract',
      kind: 'openai-compatible' as const,
      model: 'gpt-5',
      models: ['gpt-5'],
      name: 'Bad provider contract',
      needsApiKey: true,
      updatedAt: 1,
    }
    const malformedProviders = [
      { ...provider, models: ['gpt-5', 'gpt-5'] },
      { ...provider, capabilities: ['chat', 'unknown-capability'] },
    ]

    for (const malformedProvider of malformedProviders) {
      const malformed = {
        data: appData({
          providers: [malformedProvider] as unknown as AppData['providers'],
        }),
        secrets: { providerKeys: {} },
      }
      await expect(
        parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
      ).rejects.toThrow(rt('error.remoteDataBadFormat'))
    }
  })

  it('rejects encrypted sync vaults with duplicate Provider identities', async () => {
    const provider = {
      baseUrl: 'https://provider.example/v1',
      createdAt: 1,
      enabled: true,
      id: 'provider-duplicate',
      kind: 'openai-compatible' as const,
      model: 'gpt-5',
      name: 'Duplicate provider',
      needsApiKey: true,
      updatedAt: 1,
    }
    const malformed = {
      data: appData({
        providers: [
          provider,
          { ...provider, name: 'Duplicate provider replacement' },
        ],
      }),
      secrets: { providerKeys: {} },
    }

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects decrypted remote vaults with malformed conversation messages', async () => {
    const malformed = {
      data: appData({
        conversations: [
          {
            createdAt: 1,
            id: 'conversation-bad',
            messages: [
              {
                content: 'Bad role',
                createdAt: 1,
                id: 'message-bad',
                role: 'tool',
              },
            ],
            model: 'gpt-5',
            providerId: 'provider-bad',
            title: 'Bad conversation',
            updatedAt: 1,
          },
        ] as unknown as AppData['conversations'],
      }),
      secrets: {
        providerKeys: {},
      },
    }

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects malformed queued text request metadata', async () => {
    const malformed = {
      data: appData({
        conversations: [
          {
            createdAt: 1,
            id: 'conversation-bad-queue',
            messages: [
              {
                content: 'Queued offline',
                createdAt: 1,
                id: 'message-bad-queue',
                queuedTextRequest: {
                  providerId: 'provider-bad-queue',
                },
                role: 'assistant',
                status: 'queued',
              },
            ],
            model: 'gpt-5',
            providerId: 'provider-bad-queue',
            title: 'Bad queued request',
            updatedAt: 1,
          },
        ] as unknown as AppData['conversations'],
      }),
      secrets: {
        providerKeys: {},
      },
    }

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects malformed offline replay claim metadata', async () => {
    const malformed = {
      data: appData({
        conversations: [
          {
            createdAt: 1,
            id: 'conversation-bad-claim',
            messages: [
              {
                content: 'Queued offline',
                createdAt: 1,
                id: 'message-bad-claim',
                offlineReplayClaim: {
                  claimId: 'claim-1',
                  owner: '',
                },
                role: 'assistant',
                status: 'queued',
              },
            ],
            model: 'gpt-5',
            providerId: 'provider-bad-claim',
            title: 'Bad replay claim',
            updatedAt: 1,
          },
        ] as unknown as AppData['conversations'],
      }),
      secrets: {
        providerKeys: {},
      },
    }

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects decrypted remote vaults with malformed Skill chunks', async () => {
    const malformed = {
      data: appData({
        skills: [
          {
            autoMatch: true,
            chunks: [
              {
                heading: 'No content',
                id: 'chunk-bad',
                keywords: ['bad'],
                tokenEstimate: 1,
              },
            ],
            contentHash: 'hash-bad',
            contentType: 'markdown',
            createdAt: 1,
            description: 'Bad Skill',
            enabled: true,
            fixed: false,
            id: 'skill-bad',
            keywords: ['bad'],
            name: 'Bad Skill',
            sourceSize: 1,
            updatedAt: 1,
          },
        ] as unknown as AppData['skills'],
      }),
      secrets: {
        providerKeys: {},
      },
    }

    await expect(
      parseRemoteVault(await encryptedRemoteVault(malformed), passphrase),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })
})
