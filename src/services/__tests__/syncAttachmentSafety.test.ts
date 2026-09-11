import { describe, expect, it } from 'vitest'

import type { AppData, MessageAttachment } from '../../types'
import { defaultSkillSettings } from '../appData'
import { isSyncVaultShape } from '../syncShared'

function attachment(patch: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    createdAt: 1,
    dataUrl: 'data:image/png;base64,AA==',
    id: 'attachment-1',
    kind: 'image',
    mimeType: 'image/png',
    ...patch,
  }
}

function appData(messageAttachments: MessageAttachment[]): AppData {
  return {
    conversations: [
      {
        createdAt: 1,
        id: 'conversation-1',
        messages: [
          {
            attachments: messageAttachments,
            content: '',
            createdAt: 1,
            id: 'message-1',
            role: 'assistant',
          },
        ],
        model: 'model-1',
        providerId: 'provider-1',
        title: 'Attachment safety',
        updatedAt: 1,
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
      mode: 'gist',
    },
    updatedAt: 1,
    version: 1,
  }
}

describe('sync attachment safety', () => {
  it('accepts only bounded data URLs and public remote image URLs', () => {
    expect(
      isSyncVaultShape({
        data: appData([attachment()]),
        secrets: { providerKeys: {} },
      }),
    ).toBe(true)
    expect(
      isSyncVaultShape({
        data: appData([
          attachment({
            dataUrl: undefined,
            url: 'https://cdn.example.test/image.png',
          }),
        ]),
        secrets: { providerKeys: {} },
      }),
    ).toBe(true)
  })

  it.each([
    { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { dataUrl: 'data:image/png;base64,not valid' },
    { dataUrl: undefined, url: 'blob:zerochat-image' },
    { dataUrl: undefined, url: 'https://127.0.0.1/image.png' },
    { dataUrl: undefined, url: 'https://0x7f000001/image.png' },
    { dataUrl: undefined, url: 'https://[64:ff9b::7f00:1]/image.png' },
    { dataUrl: undefined, url: '\nhttps://cdn.example/image.png' },
    { dataUrl: undefined, url: undefined },
  ])('rejects unsafe or non-portable attachment source %#', (patch) => {
    expect(
      isSyncVaultShape({
        data: appData([attachment(patch)]),
        secrets: { providerKeys: {} },
      }),
    ).toBe(false)
  })

  it('rejects unsafe attachments anywhere in AppData', async () => {
    expect(
      isSyncVaultShape({
        data: appData([
          attachment({
            dataUrl: undefined,
            url: 'https://localhost/image.png',
          }),
        ]),
        secrets: { providerKeys: {} },
      }),
    ).toBe(false)
  })

  it('rejects malformed vaults before checking attachment content', async () => {
    const malformed = {
      data: { conversations: [], version: 1 },
      secrets: { providerKeys: {} },
    }
    expect(isSyncVaultShape(malformed)).toBe(false)
  })
})
