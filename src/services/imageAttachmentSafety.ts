import { isDisallowedRemoteHost } from './remoteHostSafety'
import {
  hasControlCharacter,
  hasWhitespaceOrControl,
  normalizedImageAttachmentMimeType,
  safeImageAttachmentDataUrl,
  type SafeImageAttachmentDataUrl,
} from './imageAttachmentDataSafety'

const IMAGE_ATTACHMENT_PROTOCOLS = new Set(['http:', 'https:'])

export { normalizedImageAttachmentMimeType, safeImageAttachmentDataUrl }
export type { SafeImageAttachmentDataUrl }

export function safeRemoteImageAttachmentUrl(
  value: string | null | undefined,
): string {
  if (hasControlCharacter(value ?? '')) {
    return ''
  }

  const trimmed = value?.trim() ?? ''

  if (
    !trimmed ||
    hasWhitespaceOrControl(trimmed) ||
    !/^https?:\/\/[^/]/i.test(trimmed)
  ) {
    return ''
  }

  try {
    const url = new URL(trimmed)

    if (
      !IMAGE_ATTACHMENT_PROTOCOLS.has(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      isDisallowedRemoteHost(url.hostname)
    ) {
      return ''
    }

    return url.href
  } catch {
    return ''
  }
}

export function safeImageAttachmentUrl(
  value: string | null | undefined,
): string {
  if (hasControlCharacter(value ?? '')) {
    return ''
  }

  const remoteUrl = safeRemoteImageAttachmentUrl(value)

  if (remoteUrl) {
    return remoteUrl
  }

  const trimmed = value?.trim() ?? ''

  return trimmed.startsWith('blob:') && !hasWhitespaceOrControl(trimmed)
    ? trimmed
    : ''
}

export function safeProviderImageAttachmentSource(attachment: {
  dataUrl?: string | null
  url?: string | null
}): string {
  const hasDataUrl = attachment.dataUrl != null
  const hasRemoteUrl = attachment.url != null
  const dataUrl = hasDataUrl
    ? safeImageAttachmentDataUrl(attachment.dataUrl)?.dataUrl ?? ''
    : ''
  const remoteUrl = hasRemoteUrl
    ? safeRemoteImageAttachmentUrl(attachment.url)
    : ''

  return (
    (hasDataUrl || hasRemoteUrl) &&
    (!hasDataUrl || dataUrl !== '') &&
    (!hasRemoteUrl || remoteUrl !== '')
      ? dataUrl || remoteUrl
      : ''
  )
}
