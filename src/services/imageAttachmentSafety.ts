import { isDisallowedRemoteHost } from './providerSafety'

const IMAGE_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
const IMAGE_ATTACHMENT_PROTOCOLS = new Set(['http:', 'https:'])
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]+={0,2}$/u
const DATA_URL_METADATA = /^data:([^;,]+);base64$/iu

function hasWhitespaceOrControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return /\s/u.test(character) || codePoint <= 0x1f || codePoint === 0x7f
  })
}

function acceptedImageAttachmentMimeType(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()

  if (normalized === 'image/jpg') {
    return 'image/jpeg'
  }

  return IMAGE_ATTACHMENT_MIME_TYPES.has(normalized) ? normalized : undefined
}

function isValidBase64Payload(value: string): boolean {
  if (!BASE64_PAYLOAD.test(value)) {
    return false
  }

  const paddingLength = value.length - value.replace(/=+$/u, '').length
  const unpaddedLength = value.length - paddingLength

  return (
    unpaddedLength % 4 !== 1 &&
    (paddingLength === 0 || value.length % 4 === 0)
  )
}

export function normalizedImageAttachmentMimeType(value: unknown): string {
  if (typeof value !== 'string') {
    return 'image/png'
  }

  const normalized = value.trim().toLowerCase()
  const format = normalized.startsWith('image/')
    ? normalized
    : `image/${normalized}`

  return acceptedImageAttachmentMimeType(format) ?? 'image/png'
}

export interface SafeImageAttachmentDataUrl {
  dataUrl: string
  mimeType: string
}

export function safeImageAttachmentDataUrl(
  value: string | null | undefined,
): SafeImageAttachmentDataUrl | null {
  const trimmed = value?.trim() ?? ''

  if (!trimmed || hasWhitespaceOrControl(trimmed)) {
    return null
  }

  const separator = trimmed.indexOf(',')

  if (separator <= 0) {
    return null
  }

  const metadata = DATA_URL_METADATA.exec(trimmed.slice(0, separator))
  const mimeType = metadata?.[1]
    ? acceptedImageAttachmentMimeType(metadata[1])
    : undefined
  const payload = trimmed.slice(separator + 1)

  if (!mimeType || !isValidBase64Payload(payload)) {
    return null
  }

  return {
    dataUrl: `data:${mimeType};base64,${payload}`,
    mimeType,
  }
}

export function safeRemoteImageAttachmentUrl(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim() ?? ''

  if (
    !trimmed ||
    hasWhitespaceOrControl(trimmed) ||
    !/^https?:\/\/[^/]/iu.test(trimmed)
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
  return (
    safeImageAttachmentDataUrl(attachment.dataUrl)?.dataUrl ??
    safeRemoteImageAttachmentUrl(attachment.url)
  )
}
