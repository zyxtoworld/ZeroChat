import type { ChatMessage, MessageAttachment } from '../types'
import { imageAttachmentSrc } from './imageAttachments'

interface MessageAccessibleNameOptions {
  message: ChatMessage
  senderLabel: string
  statusLabel?: string
  timeLabel: string
}

interface MessageStatusLabels {
  error: string
  queued: string
  streaming: string
}

export function assistantMessageClass(message: ChatMessage): string {
  return [
    'message',
    message.role,
    message.status === 'error' ? 'error' : '',
    message.status === 'queued' ? 'queued' : '',
    message.status === 'streaming' ? 'streaming' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function messageStatusText(
  message: ChatMessage,
  labels: MessageStatusLabels,
): string | undefined {
  if (message.status === 'streaming') {
    return labels.streaming
  }

  if (message.status === 'queued') {
    return labels.queued
  }

  if (message.status === 'error') {
    return message.error?.trim() || labels.error
  }

  return undefined
}

export function messageAccessibleName({
  message,
  senderLabel,
  statusLabel,
  timeLabel,
}: MessageAccessibleNameOptions): string {
  const fallbackSender = message.role === 'user' ? 'User' : 'AI'

  return [senderLabel.trim() || fallbackSender, timeLabel, statusLabel]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(', ')
}

export function messageActionAccessibleName(
  actionLabel: string,
  messageLabel: string,
  subjectLabel?: string,
): string {
  return subjectLabel
    ? `${actionLabel}: ${subjectLabel}, ${messageLabel}`
    : `${actionLabel}: ${messageLabel}`
}

export function shouldRenderMarkdown(content: string): boolean {
  return /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.+\|)|(\*\*|__|`|\[[^\]]+\]\([^)]+\))/m.test(
    content,
  )
}

export function messageCopyText(
  message: ChatMessage,
  imageGeneratedLabel: string,
): string {
  const content = message.content.trim()

  if (content) {
    return content
  }

  const image = message.attachments?.find(
    (attachment) => attachment.kind === 'image' && attachment.purpose !== 'mask',
  )

  return image?.alt?.trim() || imageGeneratedLabel
}

export function messageCanSpeak(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    Boolean(message.content.trim()) &&
    message.status !== 'streaming' &&
    message.status !== 'queued'
  )
}

export function downloadableMessageAttachment(
  message: ChatMessage,
): MessageAttachment | undefined {
  return message.attachments?.find(
    (attachment) =>
      attachment.kind === 'image' &&
      attachment.purpose !== 'mask' &&
      Boolean(imageAttachmentSrc(attachment)),
  )
}
