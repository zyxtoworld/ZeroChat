import { rt } from '../i18n'
import {
  normalizedImageAttachmentMimeType,
  safeImageAttachmentDataUrl,
  safeRemoteImageAttachmentUrl,
} from './imageAttachmentSafety'

export interface GeneratedImage {
  dataUrl?: string
  url?: string
  mimeType: string
  revisedPrompt?: string
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function readModelId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const item = value as {
    id?: unknown
    name?: unknown
    model?: unknown
    slug?: unknown
  }
  const candidate = item.id ?? item.name ?? item.model ?? item.slug

  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null
}

function modelItemsFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'object' || value === null) {
    return []
  }

  const record = value as {
    data?: unknown
    models?: unknown
    result?: unknown
  }

  if (Array.isArray(record.data)) {
    return record.data
  }

  if (Array.isArray(record.models)) {
    return record.models
  }

  if (Array.isArray(record.result)) {
    return record.result
  }

  return []
}

export function parseProviderModelIds(value: unknown): string[] {
  const seen = new Set<string>()

  for (const item of modelItemsFromResponse(value)) {
    const id = readModelId(item)

    if (id) {
      seen.add(id)
    }
  }

  return Array.from(seen).sort((left, right) => left.localeCompare(right))
}

function imageMimeTypeFromFormat(value: unknown): string {
  return normalizedImageAttachmentMimeType(value)
}

function imageString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function imageUrlFromValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'object' && value !== null) {
    const url = imageString((value as { url?: unknown }).url)

    if (url) {
      return url
    }
  }

  return ''
}

function imageFromRecord(item: unknown): GeneratedImage | null {
  if (typeof item !== 'object' || item === null) {
    return null
  }

  const record = item as {
    b64_json?: unknown
    image_url?: unknown
    imageUrl?: unknown
    image?: unknown
    result?: unknown
    url?: unknown
    mime_type?: unknown
    mimeType?: unknown
    output_format?: unknown
    revised_prompt?: unknown
    revisedPrompt?: unknown
  }
  const mimeType =
    typeof record.mime_type === 'string'
      ? record.mime_type
      : typeof record.mimeType === 'string'
        ? record.mimeType
        : imageMimeTypeFromFormat(record.output_format)
  const revisedPrompt =
    typeof record.revised_prompt === 'string'
      ? record.revised_prompt
      : typeof record.revisedPrompt === 'string'
        ? record.revisedPrompt
        : undefined
  const base64Value =
    typeof record.b64_json === 'string'
      ? record.b64_json
      : typeof record.result === 'string'
        ? record.result
        : ''

  if (base64Value.trim()) {
    const b64 = base64Value.trim()
    const safeDataUrl = safeImageAttachmentDataUrl(
      b64.startsWith('data:') ? b64 : `data:${mimeType};base64,${b64}`,
    )

    if (safeDataUrl) {
      return {
        dataUrl: safeDataUrl.dataUrl,
        mimeType: safeDataUrl.mimeType,
        revisedPrompt,
      }
    }
  }

  const imageUrl =
    imageUrlFromValue(record.url) ||
    imageUrlFromValue(record.image_url) ||
    imageUrlFromValue(record.imageUrl)

  if (imageUrl) {
    const safeDataUrl = safeImageAttachmentDataUrl(imageUrl)

    if (safeDataUrl) {
      return {
        dataUrl: safeDataUrl.dataUrl,
        mimeType: safeDataUrl.mimeType,
        revisedPrompt,
      }
    }

    const safeUrl = safeRemoteImageAttachmentUrl(imageUrl)

    if (safeUrl) {
      return {
        url: safeUrl,
        mimeType,
        revisedPrompt,
      }
    }
  }

  return null
}

function imageFromImagesApiResponse(value: unknown): GeneratedImage | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const data = (value as { data?: unknown }).data

  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  return imageFromRecord(data[0])
}

function imageFromUnknown(value: unknown): GeneratedImage | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = imageFromUnknown(item)

      if (image) {
        return image
      }
    }

    return null
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const direct = imageFromRecord(value)

  if (direct) {
    return direct
  }

  const record = value as {
    content?: unknown
    data?: unknown
    image?: unknown
    output?: unknown
    result?: unknown
  }

  for (const nested of [
    record.content,
    record.output,
    record.result,
    record.data,
    record.image,
  ]) {
    if (typeof nested === 'string') {
      continue
    }

    const image = imageFromUnknown(nested)

    if (image) {
      return image
    }
  }

  return null
}

function imageFromResponsesApiResponse(value: unknown): GeneratedImage | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const output = (value as { output?: unknown }).output

  if (!Array.isArray(output)) {
    return null
  }

  return imageFromUnknown(output)
}

export function generatedImageFromProviderResponse(value: unknown): GeneratedImage {
  const image =
    imageFromImagesApiResponse(value) ?? imageFromResponsesApiResponse(value)

  if (image) {
    return image
  }

  throw new Error(rt('error.imageGenerationNoResult'))
}

function audioBytesHaveKnownSignature(bytes: Uint8Array): boolean {
  const startsWith = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value)

  return (
    startsWith(0x49, 0x44, 0x33) ||
    startsWith(0x52, 0x49, 0x46, 0x46) ||
    startsWith(0x4f, 0x67, 0x67, 0x53) ||
    startsWith(0x66, 0x4c, 0x61, 0x43) ||
    (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ||
    (bytes.length > 7 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70)
  )
}

function bytesLookLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 96)
  const firstContentByte = sample.find(
    (byte) => byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x20,
  )

  if (
    firstContentByte === 0x7b ||
    firstContentByte === 0x5b ||
    firstContentByte === 0x3c
  ) {
    return true
  }

  return sample.every(
    (byte) =>
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte <= 0x7e),
  )
}

export function providerAudioResponseLooksValid(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  if (bytes.byteLength === 0) {
    return false
  }

  // Content-Type is provider-controlled metadata; reject obvious error bodies
  // before trusting an audio or binary media type.
  if (bytesLookLikeText(bytes)) {
    return false
  }

  const normalizedContentType = contentType.trim().toLowerCase()

  if (
    normalizedContentType.startsWith('audio/') ||
    normalizedContentType.includes('octet-stream')
  ) {
    return true
  }

  if (audioBytesHaveKnownSignature(bytes)) {
    return true
  }

  return !(
    normalizedContentType.includes('json') ||
    normalizedContentType.startsWith('text/') ||
    normalizedContentType.includes('html') ||
    normalizedContentType.includes('xml')
  )
}

function transcriptionTextFromOutput(value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }

  const parts: string[] = []

  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue
    }

    const record = item as {
      content?: unknown
      text?: unknown
      type?: unknown
    }

    if (typeof record.text === 'string' && record.text.trim()) {
      parts.push(record.text.trim())
      continue
    }

    if (!Array.isArray(record.content)) {
      continue
    }

    for (const content of record.content) {
      if (typeof content !== 'object' || content === null) {
        continue
      }

      const text = (content as { text?: unknown }).text

      if (typeof text === 'string' && text.trim()) {
        parts.push(text.trim())
      }
    }
  }

  return parts.join('\n').trim()
}

function transcriptionTextFromSegments(value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }

  return value
    .map((segment) =>
      typeof segment === 'object' && segment !== null
        ? (segment as { text?: unknown }).text
        : '',
    )
    .filter((text): text is string => typeof text === 'string' && Boolean(text.trim()))
    .map((text) => text.trim())
    .join(' ')
    .trim()
}

export function transcriptionTextFromProviderResponse(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const parsed = trimmed.startsWith('{') || trimmed.startsWith('[')
      ? parseJsonString(trimmed)
      : null

    if (parsed !== null) {
      return transcriptionTextFromProviderResponse(parsed)
    }

    if (trimmed) {
      return trimmed
    }
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as {
      data?: unknown
      output?: unknown
      output_text?: unknown
      result?: unknown
      segments?: unknown
      text?: unknown
      transcript?: unknown
    }
    const directText =
      typeof record.text === 'string'
        ? record.text
        : typeof record.transcript === 'string'
          ? record.transcript
          : typeof record.output_text === 'string'
            ? record.output_text
            : typeof record.result === 'string'
              ? record.result
              : ''
    const text =
      directText.trim() ||
      transcriptionTextFromSegments(record.segments) ||
      transcriptionTextFromOutput(record.output) ||
      transcriptionTextFromOutput(record.data)

    if (text) {
      return text
    }
  }

  throw new Error(rt('error.audioTranscriptionNoText'))
}
