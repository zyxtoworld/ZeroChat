import type { Translator } from '../i18n'

export const MAX_ENCRYPTED_BACKUP_FILE_BYTES = 50_000_000
export const MAX_SKILL_FILE_BYTES = 2_000_000
export const MAX_IMAGE_FILE_BYTES = 20_000_000
export const MAX_AUDIO_FILE_BYTES = 25_000_000

export function localFileTooLargeMessage(
  t: Translator,
  maxBytes: number,
): string {
  return t('message.fileTooLarge', { maxMb: maxBytes / 1_000_000 })
}

export function assertLocalFileSize(
  file: Pick<Blob, 'size'>,
  maxBytes: number,
  tooLargeMessage: string,
): void {
  assertLocalByteSize(file.size, maxBytes, tooLargeMessage)
}

export function assertLocalByteSize(
  byteLength: number,
  maxBytes: number,
  tooLargeMessage: string,
): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('Local file size limit must be a non-negative safe integer.')
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError('Local file byte length must be a non-negative safe integer.')
  }

  if (byteLength > maxBytes) {
    throw new Error(tooLargeMessage)
  }
}

export async function readLocalFileText(
  file: File,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<string> {
  assertLocalFileSize(file, maxBytes, tooLargeMessage)
  return file.text()
}

export function readLocalFileAsDataUrl(
  file: File,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      assertLocalFileSize(file, maxBytes, tooLargeMessage)
    } catch (error: unknown) {
      reject(error)
      return
    }

    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}
