const MAX_IMAGE_FILE_BYTES = 20_000_000

const IMAGE_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]+={0,2}$/
const DATA_URL_METADATA = /^data:([^;,]+);base64$/i

export function hasControlCharacter(value: string): boolean {
  // Reject raw C0/DEL controls before any normalization can discard them.
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x1f\x7f]/.test(value)
}

export function hasWhitespaceOrControl(value: string): boolean {
  // Persisted image data must reject ASCII controls before parsing the payload.
  return /\s/.test(value) || hasControlCharacter(value)
}

function acceptedImageAttachmentMimeType(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()

  if (normalized === 'image/jpg') {
    return 'image/jpeg'
  }

  return IMAGE_ATTACHMENT_MIME_TYPES.has(normalized) ? normalized : undefined
}

function isValidBase64Payload(value: string): boolean {
  const paddingLength = +value.endsWith('=')
  const decodedByteLength = (value.length * 0.75 - paddingLength) | 0

  return (
    decodedByteLength <= MAX_IMAGE_FILE_BYTES &&
    BASE64_PAYLOAD.test(value) &&
    (paddingLength ? value.length % 4 === 0 : value.length % 4 !== 1)
  )
}

export function normalizedImageAttachmentMimeType(value: unknown): string {
  if (typeof value !== 'string') {
    return 'image/png'
  }

  const normalized = value.trim().toLowerCase()
  return (
    acceptedImageAttachmentMimeType(
      normalized.startsWith('image/') ? normalized : `image/${normalized}`,
    ) ?? 'image/png'
  )
}

export interface SafeImageAttachmentDataUrl {
  dataUrl: string
  mimeType: string
}

export function safeImageAttachmentDataUrl(
  value: string | null | undefined,
): SafeImageAttachmentDataUrl | null {
  if (hasControlCharacter(value ?? '')) {
    return null
  }

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
