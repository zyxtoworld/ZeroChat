import { now as currentNow } from './appData'
import {
  attachmentByPurpose,
  fileFromAttachment,
} from './imageAttachments'
import type {
  ChatMessage,
  GeneratedImage,
  MessageAttachment,
} from '../types'

export interface RestoredImageEditFiles {
  maskFile: File | null
  sourceFile: File | null
}

export interface GeneratedImageAttachmentOptions {
  image: GeneratedImage
  model: string
  now?: () => number
  prompt: string
  randomId?: () => string
}

export function restoredImageEditFilesFromMessage(
  message: ChatMessage,
): RestoredImageEditFiles {
  return {
    sourceFile: fileFromAttachment(
      attachmentByPurpose(message, 'source'),
      'zerochat-source.png',
    ),
    maskFile: fileFromAttachment(
      attachmentByPurpose(message, 'mask'),
      'zerochat-mask.png',
    ),
  }
}

export function generatedImageAttachment({
  image,
  model,
  now = currentNow,
  prompt,
  randomId = () => crypto.randomUUID(),
}: GeneratedImageAttachmentOptions): MessageAttachment {
  return {
    id: randomId(),
    kind: 'image',
    purpose: 'generated',
    mimeType: image.mimeType,
    dataUrl: image.dataUrl,
    url: image.url,
    alt: image.revisedPrompt ?? prompt,
    model,
    createdAt: now(),
  }
}
