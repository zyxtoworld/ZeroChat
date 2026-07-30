import type { NoticeTarget } from '../components/Notice'
import { rt, type Translator } from '../i18n'
import type { ChatMessage, MessageAttachment } from '../types'
import type { NoticeTone } from './uiRuntime'
import {
  safeImageAttachmentDataUrl,
  safeImageAttachmentUrl,
} from './imageAttachmentSafety'
import {
  localFileTooLargeMessage,
  MAX_IMAGE_FILE_BYTES,
  readLocalFileAsDataUrl,
} from './localFileLimits'

const IMAGE_SOURCE_ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export interface ImageAttachmentDownload {
  href: string
  filename: string
}

type SetNotice = (
  message: string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
) => void

export function hasImageAttachment(message: ChatMessage | undefined): boolean {
  return Boolean(
    message?.attachments?.some((attachment) => attachment.kind === 'image'),
  )
}

export function imageAttachmentSrc(attachment: MessageAttachment): string {
  return (
    safeImageAttachmentDataUrl(attachment.dataUrl)?.dataUrl ??
    safeImageAttachmentUrl(attachment.url)
  )
}

export function isGeneratedImageNotice(content: string, t: Translator): boolean {
  return [
    '',
    t('message.imageGenerated'),
    'Image generated',
    '图片已生成',
    '图片已生',
    '生成的图片',
  ].includes(content.trim())
}

export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [metadata, base64 = ''] = dataUrl.split(',')
  const mimeType = metadata.match(/^data:([^;]+)/)?.[1] ?? 'image/png'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new File([bytes], fileName, { type: mimeType })
}

export function fileToDataUrl(file: File): Promise<string> {
  return readLocalFileAsDataUrl(
    file,
    MAX_IMAGE_FILE_BYTES,
    localFileTooLargeMessage(rt, MAX_IMAGE_FILE_BYTES),
  )
}

export function isAcceptedImageSourceFile(file: File): boolean {
  const type = file.type.trim().toLowerCase()

  if (IMAGE_SOURCE_ACCEPTED_TYPES.has(type)) {
    return true
  }

  if (type && type !== 'application/octet-stream') {
    return false
  }

  return /\.(jpe?g|png|webp)$/i.test(file.name)
}

export function dragHasAcceptedImageSource(dataTransfer: DataTransfer): boolean {
  const items = Array.from(dataTransfer.items ?? [])

  if (items.length > 0) {
    return items.some(
      (item) =>
        item.kind === 'file' && IMAGE_SOURCE_ACCEPTED_TYPES.has(item.type),
    )
  }

  return Array.from(dataTransfer.files ?? []).some(isAcceptedImageSourceFile)
}

export function transferHasFile(dataTransfer: DataTransfer): boolean {
  const items = Array.from(dataTransfer.items ?? [])

  if (items.length > 0) {
    return items.some((item) => item.kind === 'file')
  }

  return (dataTransfer.files?.length ?? 0) > 0
}

export function acceptedImageSourceFromDrop(
  dataTransfer: DataTransfer,
): File | null {
  return Array.from(dataTransfer.files ?? []).find(isAcceptedImageSourceFile) ?? null
}

export function acceptedImageSourceFromClipboard(
  dataTransfer: DataTransfer,
): File | null {
  const file = Array.from(dataTransfer.files ?? []).find(isAcceptedImageSourceFile)

  if (file) {
    return file
  }

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file' || !IMAGE_SOURCE_ACCEPTED_TYPES.has(item.type)) {
      continue
    }

    const itemFile = item.getAsFile()

    if (itemFile && isAcceptedImageSourceFile(itemFile)) {
      return itemFile
    }
  }

  return null
}

export function extensionForImageSourceType(type: string): string {
  if (type === 'image/jpeg') {
    return 'jpg'
  }

  if (type === 'image/webp') {
    return 'webp'
  }

  return 'png'
}

export function namedPastedImageSource(file: File): File {
  if (file.name.trim()) {
    return file
  }

  const type = IMAGE_SOURCE_ACCEPTED_TYPES.has(file.type) ? file.type : 'image/png'

  return new File(
    [file],
    `zerochat-pasted-source.${extensionForImageSourceType(type)}`,
    {
      lastModified: file.lastModified,
      type,
    },
  )
}

export function imageAttachmentDownload(
  attachment: MessageAttachment,
  fallbackCreatedAt = Date.now(),
): ImageAttachmentDownload | null {
  const href = imageAttachmentSrc(attachment)

  if (!href) {
    return null
  }

  const extension = attachment.mimeType.includes('jpeg')
    ? 'jpg'
    : attachment.mimeType.includes('webp')
      ? 'webp'
      : 'png'

  return {
    href,
    filename: `zerochat-image-${attachment.createdAt || fallbackCreatedAt}.${extension}`,
  }
}

export function cleanupImageAttachmentDownloadAnchor(
  anchor: HTMLAnchorElement | null,
): boolean {
  try {
    anchor?.remove()
    return true
  } catch {
    // Temporary anchor cleanup is best-effort; click result owns the user-visible result.
    return false
  }
}

export function downloadImageAttachment(attachment: MessageAttachment): boolean {
  const download = imageAttachmentDownload(attachment)

  if (!download) {
    return false
  }

  let anchor: HTMLAnchorElement | null = null

  try {
    anchor = document.createElement('a')
    anchor.href = download.href
    anchor.download = download.filename
    anchor.rel = 'noopener noreferrer'
    anchor.referrerPolicy = 'no-referrer'
    anchor.target = download.href.startsWith('http') ? '_blank' : ''
    document.body.append(anchor)
    anchor.click()
    return true
  } catch {
    return false
  } finally {
    cleanupImageAttachmentDownloadAnchor(anchor)
  }
}

export function reportImageDownloadFailureNotice({
  message,
  setNotice,
  t,
}: {
  message: ChatMessage
  setNotice: SetNotice
  t: Translator
}): void {
  try {
    setNotice(t('notice.imageDownloadFailed'), 'error', 'message', message.id)
  } catch {
    // Failed download feedback has no safer fallback channel.
  }
}

export function downloadMessageImageAttachment({
  attachment,
  message,
  setNotice,
  t,
}: {
  attachment: MessageAttachment
  message: ChatMessage
  setNotice: SetNotice
  t: Translator
}): boolean {
  const downloaded = downloadImageAttachment(attachment)

  if (!downloaded) {
    reportImageDownloadFailureNotice({ message, setNotice, t })
  }

  return downloaded
}

export function attachmentByPurpose(
  message: ChatMessage | undefined,
  purpose: MessageAttachment['purpose'],
): MessageAttachment | undefined {
  return message?.attachments?.find((attachment) => attachment.purpose === purpose)
}

export function fileFromAttachment(
  attachment: MessageAttachment | undefined,
  fileName: string,
): File | null {
  if (!attachment?.dataUrl) {
    return null
  }

  return dataUrlToFile(attachment.dataUrl, fileName)
}
