import { rt } from '../i18n'
import type { GeneratedImage } from './providerResponses'
import {
  assertProviderResponseOk,
  cancelUnreadProviderResponse,
  isAbortError,
  providerTimeoutError,
  readProviderResponseBytes,
} from './providerErrors'
import { safeRemoteImageAttachmentUrl } from './imageAttachmentSafety'
import { MAX_IMAGE_FILE_BYTES } from './localFileLimits'
import { providerTimeoutSignal } from './providerTimeoutSignal'

const BASE64_CHUNK_BYTES = 0x8000

function generatedImageMimeType(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }

  return ''
}

function imageBytesDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES),
    )
  }

  return `data:${mimeType};base64,${btoa(binary)}`
}

function generatedImageDownloadError(): Error {
  return new Error(rt('error.imageGenerationNoResult'))
}

export async function materializeGeneratedImage(
  image: GeneratedImage,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<GeneratedImage> {
  if (image.dataUrl) {
    return image
  }

  const url = safeRemoteImageAttachmentUrl(image.url)

  if (!url) {
    throw generatedImageDownloadError()
  }

  const timeoutSignal = providerTimeoutSignal(signal, timeoutMs)
  let response: Response | undefined

  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      method: 'GET',
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: timeoutSignal.signal,
    })
    await assertProviderResponseOk(response, timeoutSignal.signal)

    if (
      response.url &&
      safeRemoteImageAttachmentUrl(response.url) !== url
    ) {
      throw generatedImageDownloadError()
    }

    const bytes = await readProviderResponseBytes(
      response,
      MAX_IMAGE_FILE_BYTES,
      timeoutSignal.signal,
    )
    const mimeType = generatedImageMimeType(bytes)

    if (!mimeType) {
      throw generatedImageDownloadError()
    }

    return {
      dataUrl: imageBytesDataUrl(bytes, mimeType),
      mimeType,
      revisedPrompt: image.revisedPrompt,
    }
  } catch (error: unknown) {
    if (timeoutSignal.timedOut()) {
      throw providerTimeoutError()
    }

    if (timeoutSignal.sourceAborted()) {
      throw new DOMException('Aborted', 'AbortError')
    }

    if (isAbortError(error)) {
      throw error
    }

    throw generatedImageDownloadError()
  } finally {
    cancelUnreadProviderResponse(response)
    timeoutSignal.dispose()
  }
}
