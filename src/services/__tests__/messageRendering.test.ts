import { describe, expect, it } from 'vitest'

import type { ChatMessage, MessageAttachment } from '../../types'
import {
  assistantMessageClass,
  downloadableMessageAttachment,
  messageActionAccessibleName,
  messageCanSpeak,
  messageAccessibleName,
  messageCopyText,
  messageStatusText,
  shouldRenderMarkdown,
} from '../messageRendering'

const generatedImage: MessageAttachment = {
  id: 'image-1',
  kind: 'image',
  purpose: 'generated',
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,aW1hZ2U=',
  alt: 'Generated mountain',
  createdAt: 1,
}

function message(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...patch,
  }
}

describe('message rendering helpers', () => {
  it('builds stable message class names for role and transient status', () => {
    expect(assistantMessageClass(message({ role: 'user' }))).toBe('message user')
    expect(assistantMessageClass(message({ status: 'queued' }))).toBe(
      'message assistant queued',
    )
    expect(assistantMessageClass(message({ status: 'streaming' }))).toBe(
      'message assistant streaming',
    )
    expect(assistantMessageClass(message({ status: 'error' }))).toBe(
      'message assistant error',
    )
  })

  it('builds readable message status and accessible names', () => {
    const labels = {
      error: 'Generation failed',
      queued: 'Queued offline',
      streaming: 'Generating',
    }

    expect(messageStatusText(message({ status: 'streaming' }), labels)).toBe(
      'Generating',
    )
    expect(messageStatusText(message({ status: 'queued' }), labels)).toBe(
      'Queued offline',
    )
    expect(
      messageStatusText(message({ status: 'error', error: 'Provider timeout' }), labels),
    ).toBe('Provider timeout')
    expect(messageStatusText(message({ status: 'error' }), labels)).toBe(
      'Generation failed',
    )
    expect(messageStatusText(message(), labels)).toBeUndefined()

    expect(
      messageAccessibleName({
        message: message({ role: 'user' }),
        senderLabel: 'You',
        timeLabel: '09:30',
      }),
    ).toBe('You, 09:30')
    expect(
      messageAccessibleName({
        message: message({ role: 'user' }),
        senderLabel: '',
        statusLabel: 'Queued offline',
        timeLabel: '09:31',
      }),
    ).toBe('User, 09:31, Queued offline')
  })

  it('builds message action names from one shared message context', () => {
    expect(
      messageActionAccessibleName('Delete message', 'You, 09:30'),
    ).toBe('Delete message: You, 09:30')
    expect(
      messageActionAccessibleName('Download image', 'AI, 09:31', 'Release chart'),
    ).toBe('Download image: Release chart, AI, 09:31')
  })

  it('detects Markdown only when richer rendering is useful', () => {
    expect(shouldRenderMarkdown('plain chat response')).toBe(false)
    expect(shouldRenderMarkdown('# Heading')).toBe(true)
    expect(shouldRenderMarkdown('- item')).toBe(true)
    expect(shouldRenderMarkdown('1. item')).toBe(true)
    expect(shouldRenderMarkdown('> quote')).toBe(true)
    expect(shouldRenderMarkdown('```ts\nconst value = 1\n```')).toBe(true)
    expect(shouldRenderMarkdown('| a | b |\n| - | - |')).toBe(true)
    expect(shouldRenderMarkdown('Use `code` here')).toBe(true)
    expect(shouldRenderMarkdown('[ZeroChat](https://example.test)')).toBe(true)
  })

  it('uses trimmed message text before image fallback copy', () => {
    expect(messageCopyText(message({ content: '  hello  ' }), 'Image generated')).toBe(
      'hello',
    )
    expect(
      messageCopyText(
        message({
          attachments: [generatedImage],
        }),
        'Image generated',
      ),
    ).toBe('Generated mountain')
    expect(
      messageCopyText(
        message({
          attachments: [{ ...generatedImage, alt: '   ' }],
        }),
        'Image generated',
      ),
    ).toBe('Image generated')
  })

  it('allows read-aloud only for completed assistant text', () => {
    expect(messageCanSpeak(message({ content: ' hello ' }))).toBe(true)
    expect(messageCanSpeak(message({ role: 'user', content: 'hello' }))).toBe(
      false,
    )
    expect(messageCanSpeak(message({ content: '   ' }))).toBe(false)
    expect(messageCanSpeak(message({ content: 'hello', status: 'streaming' }))).toBe(
      false,
    )
    expect(messageCanSpeak(message({ content: 'hello', status: 'queued' }))).toBe(
      false,
    )
  })

  it('finds downloadable non-mask image attachments with data or URL sources', () => {
    const mask = {
      ...generatedImage,
      id: 'mask',
      purpose: 'mask' as const,
    }
    const remote = {
      ...generatedImage,
      id: 'remote',
      dataUrl: undefined,
      url: 'https://example.test/image.webp',
    }

    expect(
      downloadableMessageAttachment(
        message({
          attachments: [mask, { ...generatedImage, dataUrl: undefined, url: undefined }],
        }),
      ),
    ).toBeUndefined()
    expect(
      downloadableMessageAttachment(
        message({
          attachments: [mask, remote],
        }),
      ),
    ).toBe(remote)
  })
})
