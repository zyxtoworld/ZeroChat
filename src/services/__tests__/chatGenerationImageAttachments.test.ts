import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '../../types'
import {
  generatedImageAttachment,
  restoredImageEditFilesFromMessage,
} from '../chatGenerationImageAttachments'

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'user-1',
    role: 'user',
    content: 'Edit this image',
    createdAt: 1,
    status: 'done',
    ...patch,
  }
}

describe('chat generation image attachment helpers', () => {
  it('builds generated image attachments from provider results with stable metadata', () => {
    const attachment = generatedImageAttachment({
      image: {
        dataUrl: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
        revisedPrompt: 'A calmer revised prompt',
      },
      model: 'gpt-image-1',
      prompt: 'original prompt',
      randomId: () => 'image-1',
      now: () => 42,
    })

    expect(attachment).toEqual({
      id: 'image-1',
      kind: 'image',
      purpose: 'generated',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      url: undefined,
      alt: 'A calmer revised prompt',
      model: 'gpt-image-1',
      createdAt: 42,
    })
  })

  it('falls back to the user prompt for generated image alt text', () => {
    expect(
      generatedImageAttachment({
        image: {
          mimeType: 'image/webp',
          url: 'https://example.test/image.webp',
        },
        model: 'image-model',
        prompt: 'fallback prompt',
        randomId: () => 'image-2',
        now: () => 84,
      }),
    ).toMatchObject({
      alt: 'fallback prompt',
      createdAt: 84,
      id: 'image-2',
      mimeType: 'image/webp',
      url: 'https://example.test/image.webp',
    })
  })

  it('restores source and mask files from previous image edit attachments', async () => {
    const { maskFile, sourceFile } = restoredImageEditFilesFromMessage(
      message({
        attachments: [
          {
            id: 'source-1',
            kind: 'image',
            purpose: 'source',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,QQ==',
            createdAt: 1,
          },
          {
            id: 'mask-1',
            kind: 'image',
            purpose: 'mask',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,Qg==',
            createdAt: 1,
          },
        ],
      }),
    )

    expect(sourceFile).toBeInstanceOf(File)
    expect(sourceFile?.name).toBe('zerochat-source.png')
    expect(sourceFile?.type).toBe('image/png')
    expect(await sourceFile?.text()).toBe('A')
    expect(maskFile).toBeInstanceOf(File)
    expect(maskFile?.name).toBe('zerochat-mask.png')
    expect(maskFile?.type).toBe('image/png')
    expect(await maskFile?.text()).toBe('B')
  })
})
