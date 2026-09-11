import { beforeAll, describe, expect, it, vi } from 'vitest'

import { loadLocale, rt, setRuntimeLocale } from '../../i18n'
import type { AppData, ChatMessage, EncryptedObjectEnvelope } from '../../types'
import { defaultSkillSettings } from '../appData'
import { encryptObject } from '../crypto'
import {
  attachmentChunkFingerprint,
  attachmentChunkObjectType,
  type AttachmentContentChunk,
  chunkFingerprint,
  chunkObjectType,
  type ConversationChunk,
  type IncrementalManifest,
  type SkillContentChunk,
  skillChunkFingerprint,
  skillChunkObjectType,
} from '../syncIncrementalHelpers'

const encryptedObjects = new Map<string, EncryptedObjectEnvelope>()
const readIncrementalObject = vi.hoisted(() =>
  vi.fn(
    async (
      endpoint: string,
      token: string,
      key: string,
    ): Promise<EncryptedObjectEnvelope> => {
      void endpoint
      void token
      void key
      throw new Error('incremental object mock is not initialized')
    },
  ),
)

vi.mock('../syncIncrementalRemote', () => ({
  readIncrementalObject,
}))

readIncrementalObject.mockImplementation(
  async (_endpoint: string, _token: string, key: string) => {
    const envelope = encryptedObjects.get(key)

    if (!envelope) {
      throw new Error(`missing object ${key}`)
    }

    return envelope
  },
)

const { manifestToVault } = await import('../syncIncrementalRead')

const endpoint = 'https://sync.example.dev'
const token = 'sync-test-token'
const passphrase = 'incremental read test passphrase'

beforeAll(async () => {
  await loadLocale('en-US')
  setRuntimeLocale('en-US')
})

function appData(patch: Partial<AppData> = {}): AppData {
  return {
    conversations: [
      {
        createdAt: 10,
        id: 'conversation-1',
        messages: [],
        model: 'gpt-5',
        providerId: 'provider-1',
        title: 'Incremental',
        updatedAt: 10,
      },
    ],
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
      mode: 'cloudflare',
      workerEndpoint: endpoint,
    },
    updatedAt: 10,
    version: 1,
    ...patch,
  }
}

function providerConfig(
  id: string,
): AppData['providers'][number] {
  return {
    baseUrl: 'https://provider.example.test/v1',
    createdAt: 10,
    enabled: true,
    id,
    kind: 'openai-responses',
    model: 'gpt-5',
    name: 'Test provider',
    needsApiKey: false,
    updatedAt: 10,
  }
}

async function manifestWithChunk(
  messages: unknown[],
  patch: Partial<IncrementalManifest> = {},
  chunkPatch: Partial<ConversationChunk> = {},
): Promise<IncrementalManifest> {
  encryptedObjects.clear()

  const key = 'chunk-11111111-1111-4111-8111-111111111111.json'
  const objectType = chunkObjectType('conversation-1', 0)
  const updatedAt = 10
  const fingerprint = await chunkFingerprint(
    'conversation-1',
    0,
    messages as ChatMessage[],
    updatedAt,
  )
  const chunk: ConversationChunk = {
    conversationId: 'conversation-1',
    fingerprint,
    index: 0,
    kind: 'zerochat.conversationChunk',
    messages: messages as ChatMessage[],
    updatedAt,
    version: 1,
    ...chunkPatch,
  }
  const manifestFingerprint = chunkPatch.fingerprint ?? fingerprint
  const manifestUpdatedAt = chunkPatch.updatedAt ?? updatedAt

  encryptedObjects.set(
    key,
    await encryptObject(chunk, passphrase, objectType, updatedAt),
  )

  return {
    chunks: [
      {
        conversationId: 'conversation-1',
        fingerprint: manifestFingerprint,
        index: 0,
        key,
        messageCount: messages.length,
        objectType,
        updatedAt: manifestUpdatedAt,
      },
    ],
    data: appData(),
    kind: 'zerochat.incrementalManifest',
    secrets: {
      providerKeys: {},
    },
    updatedAt,
    version: 1,
    ...patch,
  }
}

async function manifestWithSkillChunk(
  content: string,
  patch: Partial<SkillContentChunk> = {},
): Promise<IncrementalManifest> {
  encryptedObjects.clear()

  const key = 'skill-11111111-1111-4111-8111-111111111111.json'
  const objectType = skillChunkObjectType('skill-1', 'chunk-1')
  const updatedAt = 10
  const fingerprint = await skillChunkFingerprint('skill-1', 'chunk-1', content)
  const chunk: SkillContentChunk = {
    chunkId: 'chunk-1',
    content,
    fingerprint,
    kind: 'zerochat.skillChunk',
    skillId: 'skill-1',
    updatedAt,
    version: 1,
    ...patch,
  }
  const manifestFingerprint = patch.fingerprint ?? fingerprint
  const manifestUpdatedAt = patch.updatedAt ?? updatedAt

  encryptedObjects.set(
    key,
    await encryptObject(chunk, passphrase, objectType, updatedAt),
  )

  return {
    chunks: [],
    data: appData({
      skills: [
        {
          autoMatch: true,
          chunks: [
            {
              contentRef: key,
              heading: 'Chunk',
              id: 'chunk-1',
              keywords: ['chunk'],
              tokenEstimate: 4,
            },
          ],
          contentHash: 'hash',
          contentType: 'markdown',
          createdAt: 10,
          description: 'Skill',
          enabled: true,
          fixed: false,
          id: 'skill-1',
          keywords: ['skill'],
          name: 'Skill',
          sourceSize: 12,
          updatedAt,
        },
      ],
    }),
    kind: 'zerochat.incrementalManifest',
    secrets: {
      providerKeys: {},
    },
    skillChunks: [
      {
        chunkId: 'chunk-1',
        fingerprint: manifestFingerprint,
        key,
        objectType,
        skillId: 'skill-1',
        updatedAt: manifestUpdatedAt,
      },
    ],
    updatedAt,
    version: 1,
  }
}

async function manifestWithAttachmentChunks(
  dataUrl: string,
  tamperedPartIndex = -1,
): Promise<IncrementalManifest> {
  const message: ChatMessage = {
    attachments: [
      {
        createdAt: 10,
        id: 'attachment-1',
        kind: 'image',
        mimeType: 'image/png',
        purpose: 'generated',
      },
    ],
    content: '',
    createdAt: 10,
    id: 'message-1',
    role: 'assistant',
    status: 'done',
  }
  const manifest = await manifestWithChunk([message])
  const splitAt = Math.floor(dataUrl.length / 2)
  const parts = [dataUrl.slice(0, splitAt), dataUrl.slice(splitAt)]

  manifest.attachmentChunks = await Promise.all(
    parts.map(async (content, index) => {
      const key = `attachment-11111111-1111-4111-8111-11111111111${index}.json`
      const objectType = attachmentChunkObjectType(
        'conversation-1',
        'message-1',
        'attachment-1',
        index,
      )
      const fingerprint = await attachmentChunkFingerprint(
        'conversation-1',
        'message-1',
        'attachment-1',
        index,
        content,
      )
      const chunk: AttachmentContentChunk = {
        attachmentId: 'attachment-1',
        chunkCount: parts.length,
        content:
          index === tamperedPartIndex ? `${content}tampered` : content,
        conversationId: 'conversation-1',
        fingerprint,
        index,
        kind: 'zerochat.attachmentChunk',
        messageId: 'message-1',
        updatedAt: 10,
        version: 1,
      }
      encryptedObjects.set(
        key,
        await encryptObject(chunk, passphrase, objectType, 10),
      )
      return {
        attachmentId: 'attachment-1',
        chunkCount: parts.length,
        conversationId: 'conversation-1',
        fingerprint,
        index,
        key,
        messageId: 'message-1',
        objectType,
        updatedAt: 10,
      }
    }),
  )

  return manifest
}

describe('incremental sync read boundary', () => {
  it('materializes ordered attachment chunks into the message data URL', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const manifest = await manifestWithAttachmentChunks(dataUrl)

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).resolves.toMatchObject({
      data: {
        conversations: [
          {
            messages: [
              {
                attachments: [{ dataUrl }],
              },
            ],
          },
        ],
      },
    })
  })

  it('rejects duplicate conversation refs before materializing duplicate messages', async () => {
    const manifest = await manifestWithChunk([
      {
        content: 'remote message',
        createdAt: 10,
        id: 'message-1',
        role: 'assistant',
        status: 'done',
      },
    ])
    const ref = manifest.chunks[0]
    expect(ref).toBeDefined()
    manifest.chunks.push({ ...ref! })

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteIncrementalManifestFormat'))
  })

  it('rejects duplicate conversation identities before reading remote chunks', async () => {
    const manifest = await manifestWithChunk([
      {
        content: 'remote message',
        createdAt: 10,
        id: 'message-1',
        role: 'assistant',
        status: 'done',
      },
    ])
    const conversation = manifest.data.conversations[0]
    expect(conversation).toBeDefined()
    manifest.data.conversations.push({ ...conversation! })
    readIncrementalObject.mockClear()

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow()
    expect(readIncrementalObject).not.toHaveBeenCalled()
  })

  it('rejects duplicate skill identities before reading remote chunks', async () => {
    const manifest = await manifestWithSkillChunk('remote skill content')
    const skill = manifest.data.skills[0]
    expect(skill).toBeDefined()
    manifest.data.skills.push({ ...skill! })
    readIncrementalObject.mockClear()

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow()
    expect(readIncrementalObject).not.toHaveBeenCalled()
  })

  it('rejects duplicate provider identities before reading remote chunks', async () => {
    const manifest = await manifestWithChunk(
      [
        {
          content: 'remote message',
          createdAt: 10,
          id: 'message-1',
          role: 'assistant',
          status: 'done',
        },
      ],
      {
        data: appData({
          providers: [providerConfig('provider-1'), providerConfig('provider-1')],
        }),
      },
    )
    readIncrementalObject.mockClear()

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow()
    expect(readIncrementalObject).not.toHaveBeenCalled()
  })

  it('rejects duplicate chunk identities within one skill before reading remote chunks', async () => {
    const manifest = await manifestWithSkillChunk('remote skill content')
    const skill = manifest.data.skills[0]
    expect(skill).toBeDefined()
    skill!.chunks.push({ ...skill!.chunks[0]! })
    readIncrementalObject.mockClear()

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow()
    expect(readIncrementalObject).not.toHaveBeenCalled()
  })

  it.each([
    ['conversation', async () => {
      const manifest = await manifestWithChunk([])
      manifest.data.conversations[0]!.id = ''
      return manifest
    }],
    ['provider', async () => {
      const manifest = await manifestWithChunk([])
      manifest.data.providers = [providerConfig('')]
      return manifest
    }],
    ['skill', async () => {
      const manifest = await manifestWithSkillChunk('remote skill content')
      manifest.data.skills[0]!.id = ''
      return manifest
    }],
    ['skill chunk', async () => {
      const manifest = await manifestWithSkillChunk('remote skill content')
      manifest.data.skills[0]!.chunks[0]!.id = ''
      return manifest
    }],
  ])('rejects an empty %s identity before reading remote chunks', async (_label, buildManifest) => {
    const manifest = await buildManifest()
    readIncrementalObject.mockClear()

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow()
    expect(readIncrementalObject).not.toHaveBeenCalled()
  })

  it('rejects attachment chunks whose decrypted content does not match the reference', async () => {
    const manifest = await manifestWithAttachmentChunks(
      'data:image/png;base64,iVBORw0KGgo=',
      1,
    )

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteMessageChunkFormat'))
  })

  it('rejects attachment references that no message consumes', async () => {
    const manifest = await manifestWithAttachmentChunks(
      'data:image/png;base64,iVBORw0KGgo=',
    )
    const source = manifest.attachmentChunks?.[0]
    expect(source).toBeDefined()
    manifest.attachmentChunks?.push({
      ...source!,
      attachmentId: 'orphan-attachment',
      objectType: attachmentChunkObjectType(
        'conversation-1',
        'message-1',
        'orphan-attachment',
        0,
      ),
    })

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteIncrementalManifestFormat'))
  })

  it('rejects non-contiguous conversation refs before reading their objects', async () => {
    const manifest = await manifestWithChunk([
      {
        content: 'remote message',
        createdAt: 10,
        id: 'message-1',
        role: 'assistant',
        status: 'done',
      },
    ])
    const ref = manifest.chunks[0]
    expect(ref).toBeDefined()
    manifest.chunks.push({
      ...ref!,
      index: 2,
      key: 'chunk-11111111-1111-4111-8111-111111111112.json',
      objectType: chunkObjectType('conversation-1', 2),
    })

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteIncrementalManifestFormat'))
  })

  it('rejects a manifest whose advertised revision differs from AppData', async () => {
    const manifest = await manifestWithChunk(
      [
        {
          content: 'remote message',
          createdAt: 10,
          id: 'message-1',
          role: 'assistant',
          status: 'done',
        },
      ],
      { data: appData({ updatedAt: 9 }) },
    )

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteIncrementalManifestFormat'))
  })

  it('rejects decrypted conversation chunks with malformed messages even when the fingerprint matches', async () => {
    const manifest = await manifestWithChunk([
      {
        content: 'Tool output is not a chat role',
        createdAt: 10,
        id: 'message-bad',
        role: 'tool',
      },
    ])

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteMessageChunkFormat'))
  })

  it('rejects materialized incremental vaults with malformed provider secrets', async () => {
    const manifest = await manifestWithChunk(
      [
        {
          content: 'Hello',
          createdAt: 10,
          id: 'message-1',
          role: 'assistant',
          status: 'done',
        },
      ],
      {
        secrets: {
          providerKeys: {
            'provider-1': 42,
          },
        } as unknown as IncrementalManifest['secrets'],
      },
    )

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })

  it('rejects conversation chunks whose fingerprint field matches but payload hash does not', async () => {
    const fakeFingerprint = 'f'.repeat(64)
    const manifest = await manifestWithChunk(
      [
        {
          content: 'Hello',
          createdAt: 10,
          id: 'message-1',
          role: 'assistant',
          status: 'done',
        },
      ],
      {},
      {
        fingerprint: fakeFingerprint,
      },
    )

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteMessageChunkFormat'))
  })

  it('rejects conversation chunks whose updatedAt differs from the manifest reference', async () => {
    const manifest = await manifestWithChunk(
      [
        {
          content: 'Hello',
          createdAt: 10,
          id: 'message-1',
          role: 'assistant',
          status: 'done',
        },
      ],
      {},
      {
        updatedAt: 11,
      },
    )

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteMessageChunkFormat'))
  })

  it('rejects skill chunks whose fingerprint field matches but content hash does not', async () => {
    const manifest = await manifestWithSkillChunk('remote content', {
      fingerprint: 'f'.repeat(64),
    })

    await expect(
      manifestToVault(endpoint, token, passphrase, manifest),
    ).rejects.toThrow(rt('error.remoteDataBadFormat'))
  })
})
