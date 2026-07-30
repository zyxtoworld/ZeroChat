import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppData, EncryptedObjectEnvelope } from '../../types'
import { defaultSkillSettings } from '../appData'
import {
  INCREMENTAL_ATTACHMENT_CONTENT_CHARS,
  attachmentChunkFingerprint,
} from '../syncIncrementalHelpers'

const { encryptObject } = vi.hoisted(() => ({
  encryptObject: vi.fn(
    async (_value: unknown, _passphrase: string, objectType: string, updatedAt: number) =>
      ({ objectType, updatedAt }) as EncryptedObjectEnvelope,
  ),
}))

vi.mock('../crypto', () => ({ encryptObject }))

const { buildIncrementalUpload } = await import('../syncIncrementalUpload')

function appData(dataUrl: string): AppData {
  return {
    conversations: [
      {
        createdAt: 10,
        id: 'conversation-1',
        messages: [
          {
            attachments: [
              {
                createdAt: 11,
                dataUrl,
                id: 'attachment-1',
                kind: 'image',
                mimeType: 'image/png',
                purpose: 'generated',
              },
            ],
            content: '',
            createdAt: 11,
            id: 'message-1',
            role: 'assistant',
            status: 'done',
          },
        ],
        model: 'gpt-5',
        providerId: 'provider-1',
        title: 'Attachment chunks',
        updatedAt: 11,
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
      workerEndpoint: 'https://sync.example.dev',
    },
    updatedAt: 11,
    version: 1,
  }
}

beforeEach(() => {
  encryptObject.mockClear()
})

describe('incremental attachment upload', () => {
  it('keeps the cross-platform attachment fingerprint vector stable', async () => {
    await expect(
      attachmentChunkFingerprint(
        'conversation-1',
        'message-1',
        'attachment-1',
        0,
        'data:image/png;base64,iVBORw0KGgo=',
      ),
    ).resolves.toBe(
      '64631e8acc0858a7da34a542e62b9df48525a1b6ae53d2529a0bff177ee6c749',
    )
  })

  it('stores image data outside message chunks and reuses unchanged parts', async () => {
    const dataUrl = `data:image/png;base64,${'A'.repeat(
      INCREMENTAL_ATTACHMENT_CONTENT_CHARS + 18,
    )}`
    const first = await buildIncrementalUpload(
      appData(dataUrl),
      { providerKeys: {} },
      'attachment upload passphrase',
      null,
    )

    expect(first.manifest.attachmentChunks).toHaveLength(2)
    expect(first.manifest.attachmentChunks?.map((ref) => ref.index)).toEqual([
      0, 1,
    ])
    expect(
      first.manifest.attachmentChunks?.every(
        (ref) => ref.chunkCount === 2 && ref.key.startsWith('attachment-'),
      ),
    ).toBe(true)

    const encryptedValues = encryptObject.mock.calls.map(([value]) => value)
    const conversationChunk = encryptedValues.find(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        value.kind === 'zerochat.conversationChunk',
    ) as { messages: Array<{ attachments?: Array<{ dataUrl?: string }> }> }
    const attachmentChunks = encryptedValues.filter(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        value.kind === 'zerochat.attachmentChunk',
    ) as Array<{ content: string }>

    expect(conversationChunk.messages[0]?.attachments?.[0]?.dataUrl).toBeUndefined()
    expect(attachmentChunks.map((chunk) => chunk.content).join('')).toBe(dataUrl)

    encryptObject.mockClear()
    const second = await buildIncrementalUpload(
      appData(dataUrl),
      { providerKeys: {} },
      'attachment upload passphrase',
      first.manifest,
    )

    expect(second.chunks).toEqual([])
    expect(second.manifest.attachmentChunks).toEqual(
      first.manifest.attachmentChunks,
    )

    encryptObject.mockClear()
    const shortenedDataUrl = dataUrl.slice(
      0,
      INCREMENTAL_ATTACHMENT_CONTENT_CHARS,
    )
    const shortened = await buildIncrementalUpload(
      appData(shortenedDataUrl),
      { providerKeys: {} },
      'attachment upload passphrase',
      first.manifest,
    )

    expect(shortened.manifest.attachmentChunks).toHaveLength(1)
    expect(shortened.manifest.attachmentChunks?.[0]?.chunkCount).toBe(1)
    expect(shortened.manifest.attachmentChunks?.[0]?.key).not.toBe(
      first.manifest.attachmentChunks?.[0]?.key,
    )
    expect(
      encryptObject.mock.calls.some(
        ([value]) =>
          typeof value === 'object' &&
          value !== null &&
          'kind' in value &&
          value.kind === 'zerochat.attachmentChunk',
      ),
    ).toBe(true)
  })
})
