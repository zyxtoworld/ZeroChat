import { MAX_AUDIO_FILE_BYTES } from './localFileLimits'

const AUDIO_SOURCE_ACCEPTED_MIME_TYPES = [
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-m4a',
  'audio/x-wav',
  'audio/vnd.wave',
  'audio/webm',
  'video/mp4',
  'video/webm',
] as const

const AUDIO_SOURCE_ACCEPTED_TYPES = new Set<string>(
  AUDIO_SOURCE_ACCEPTED_MIME_TYPES,
)

const AUDIO_SOURCE_ACCEPTED_EXTENSION_LIST = [
  '.m4a',
  '.mp3',
  '.mp4',
  '.mpeg',
  '.mpga',
  '.wav',
  '.webm',
] as const

const AUDIO_SOURCE_ACCEPTED_EXTENSIONS =
  /\.(m4a|mp3|mp4|mpeg|mpga|wav|webm)$/i

export const AUDIO_SOURCE_ACCEPT = [
  ...AUDIO_SOURCE_ACCEPTED_MIME_TYPES,
  ...AUDIO_SOURCE_ACCEPTED_EXTENSION_LIST,
].join(',')

export type AudioSourceFileRejection = 'too-large' | 'unsupported'

function hasAcceptedAudioSourceType(type: string): boolean {
  const normalized = type.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return AUDIO_SOURCE_ACCEPTED_TYPES.has(normalized)
}

function hasAcceptedAudioSourceFormat(
  file: Pick<File, 'name' | 'type'>,
): boolean {
  return (
    hasAcceptedAudioSourceType(file.type) ||
    AUDIO_SOURCE_ACCEPTED_EXTENSIONS.test(file.name.trim())
  )
}

export function audioSourceFileRejection(
  file: Pick<File, 'name' | 'size' | 'type'>,
): AudioSourceFileRejection | null {
  if (!hasAcceptedAudioSourceFormat(file)) {
    return 'unsupported'
  }

  return file.size > MAX_AUDIO_FILE_BYTES ? 'too-large' : null
}

export function isAcceptedAudioSourceFile(file: File): boolean {
  return audioSourceFileRejection(file) === null
}

export function dragHasAcceptedAudioSource(dataTransfer: DataTransfer): boolean {
  const items = Array.from(dataTransfer.items ?? [])

  if (items.length > 0) {
    return items.some((item) => {
      if (item.kind !== 'file') {
        return false
      }

      const file = item.getAsFile?.()

      if (file) {
        return isAcceptedAudioSourceFile(file)
      }

      if (hasAcceptedAudioSourceType(item.type)) {
        return true
      }

      if (item.type) {
        return false
      }

      return true
    })
  }

  return Array.from(dataTransfer.files ?? []).some(isAcceptedAudioSourceFile)
}

export function acceptedAudioSourceFromDrop(
  dataTransfer: DataTransfer,
): File | null {
  return Array.from(dataTransfer.files ?? []).find(isAcceptedAudioSourceFile) ?? null
}
