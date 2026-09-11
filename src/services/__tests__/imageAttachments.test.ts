import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { ChatMessage, MessageAttachment } from '../../types'
import {
  acceptedImageSourceFromClipboard,
  acceptedImageSourceFromDrop,
  attachmentByPurpose,
  cleanupImageAttachmentDownloadAnchor,
  dataUrlToFile,
  downloadImageAttachment,
  downloadMessageImageAttachment,
  dragHasAcceptedImageSource,
  extensionForImageSourceType,
  fileFromAttachment,
  fileToDataUrl,
  hasImageAttachment,
  imageAttachmentDownload,
  imageAttachmentSrc,
  isAcceptedImageSourceFile,
  isGeneratedImageNotice,
  namedPastedImageSource,
  reportImageDownloadFailureNotice,
  transferHasFile,
} from '../imageAttachments'

function imageFile(name: string, type = 'image/png'): File {
  return new File(['image-bytes'], name, { type, lastModified: 123 })
}

function textFile(name = 'note.txt'): File {
  return new File(['hello'], name, { type: 'text/plain' })
}

function dataTransfer({
  files = [],
  items = [],
}: {
  files?: File[]
  items?: Array<Partial<DataTransferItem>>
}): DataTransfer {
  return {
    files,
    items,
  } as unknown as DataTransfer
}

function item(file: File | null, type = file?.type ?? ''): Partial<DataTransferItem> {
  return {
    kind: 'file',
    type,
    getAsFile: () => file,
  }
}

function textItem(): Partial<DataTransferItem> {
  return {
    kind: 'string',
    type: 'text/plain',
    getAsFile: () => null,
  }
}

const imageAttachment: MessageAttachment = {
  id: 'image-1',
  kind: 'image',
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,aW1hZ2U=',
  createdAt: 42,
}

const translate: Translator = (key) =>
  key === 'message.imageGenerated' ? '图片已生成' : key

describe('image attachment helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects image attachments and resolves image sources', () => {
    const message: ChatMessage = {
      id: 'message-1',
      role: 'assistant',
      content: '',
      createdAt: 1,
      attachments: [imageAttachment],
    }

    expect(hasImageAttachment(message)).toBe(true)
    expect(hasImageAttachment({ ...message, attachments: [] })).toBe(false)
    expect(hasImageAttachment(undefined)).toBe(false)
    expect(imageAttachmentSrc(imageAttachment)).toBe(imageAttachment.dataUrl)
    expect(
      imageAttachmentSrc({
        ...imageAttachment,
        dataUrl: undefined,
        url: 'https://example.test/image.webp',
      }),
    ).toBe('https://example.test/image.webp')
    expect(
      imageAttachmentSrc({
        ...imageAttachment,
        dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
        url: 'https://example.test/fallback.webp',
      }),
    ).toBe('https://example.test/fallback.webp')
    expect(
      imageAttachmentSrc({
        ...imageAttachment,
        dataUrl: undefined,
        url: 'intent://open/image',
      }),
    ).toBe('')
    expect(
      imageAttachmentSrc({
        ...imageAttachment,
        dataUrl: undefined,
        url: 'https://[::ffff:127.0.0.1]/image.png',
      }),
    ).toBe('')
    expect(
      imageAttachmentSrc({
        ...imageAttachment,
        dataUrl: undefined,
        url: '\nhttps://cdn.example/image.png',
      }),
    ).toBe('')
  })

  it('finds image attachments by purpose and restores files from data URLs', async () => {
    const source = {
      ...imageAttachment,
      id: 'source-image',
      purpose: 'source',
    } satisfies MessageAttachment
    const mask = {
      ...imageAttachment,
      id: 'mask-image',
      mimeType: 'image/webp',
      dataUrl: 'data:image/webp;base64,bWFzaw==',
      purpose: 'mask',
    } satisfies MessageAttachment
    const message: ChatMessage = {
      id: 'message-1',
      role: 'user',
      content: '',
      createdAt: 1,
      attachments: [source, mask],
    }

    expect(attachmentByPurpose(message, 'source')).toBe(source)
    expect(attachmentByPurpose(message, 'mask')).toBe(mask)
    expect(attachmentByPurpose(undefined, 'mask')).toBeUndefined()

    const file = fileFromAttachment(mask, 'mask.webp')

    expect(file?.name).toBe('mask.webp')
    expect(file?.type).toBe('image/webp')
    await expect(file?.text()).resolves.toBe('mask')
    expect(fileFromAttachment({ ...mask, dataUrl: undefined }, 'mask.webp')).toBeNull()
    expect(fileFromAttachment(undefined, 'mask.webp')).toBeNull()
  })

  it('rejects unsafe persisted image data before restoring an edit file', () => {
    const mask = {
      id: 'mask-image',
      kind: 'image' as const,
      purpose: 'mask' as const,
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,YQ==',
      createdAt: 1,
    }

    expect(
      fileFromAttachment(
        { ...mask, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
        'mask.png',
      ),
    ).toBeNull()
    expect(
      fileFromAttachment(
        { ...mask, dataUrl: 'data:image/png;base64,YQ=' },
        'mask.png',
      ),
    ).toBeNull()
  })

  it('downloads image attachments through a temporary anchor', () => {
    const clicked = vi.fn()
    const removed = vi.fn()
    const appended: unknown[] = []
    const anchor = {
      click: clicked,
      remove: removed,
      download: '',
      href: '',
      rel: '',
    } as unknown as HTMLAnchorElement
    const createElement = vi.fn(() => anchor)
    const append = vi.fn((...nodes: unknown[]) => {
      appended.push(...nodes)
    })

    vi.stubGlobal('document', {
      body: { append },
      createElement,
    })

    expect(downloadImageAttachment(imageAttachment)).toBe(true)

    expect(createElement).toHaveBeenCalledWith('a')
    expect(anchor.href).toBe(imageAttachment.dataUrl)
    expect(anchor.download).toBe('zerochat-image-42.png')
    expect(anchor.rel).toBe('noopener noreferrer')
    expect(anchor.referrerPolicy).toBe('no-referrer')
    expect(anchor.target).toBe('')
    expect(appended).toEqual([anchor])
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(removed).toHaveBeenCalledTimes(1)

    expect(
      downloadImageAttachment({
        ...imageAttachment,
        dataUrl: undefined,
        url: undefined,
      }),
    ).toBe(false)

    expect(createElement).toHaveBeenCalledTimes(1)

    expect(
      downloadImageAttachment({
        ...imageAttachment,
        dataUrl: undefined,
        url: 'intent://open/image',
      }),
    ).toBe(false)
    expect(createElement).toHaveBeenCalledTimes(1)
  })

  it('contains temporary image download anchor cleanup failures', () => {
    const clicked = vi.fn()
    const removed = vi.fn(() => {
      throw new Error('remove blocked')
    })
    const anchor = {
      click: clicked,
      remove: removed,
      download: '',
      href: '',
      rel: '',
    } as unknown as HTMLAnchorElement
    const createElement = vi.fn(() => anchor)
    const append = vi.fn()

    vi.stubGlobal('document', {
      body: { append },
      createElement,
    })

    expect(downloadImageAttachment(imageAttachment)).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(removed).toHaveBeenCalledTimes(1)
  })

  it('skips empty image download anchor cleanup', () => {
    expect(cleanupImageAttachmentDownloadAnchor(null)).toBe(true)
  })

  it('reports failed image downloads on the originating message', () => {
    const clicked = vi.fn(() => {
      throw new Error('blocked download')
    })
    const removed = vi.fn()
    const anchor = {
      click: clicked,
      remove: removed,
      download: '',
      href: '',
      rel: '',
    } as unknown as HTMLAnchorElement
    const createElement = vi.fn(() => anchor)
    const append = vi.fn()
    const setNotice = vi.fn()
    const message: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      createdAt: 1,
      attachments: [imageAttachment],
    }

    vi.stubGlobal('document', {
      body: { append },
      createElement,
    })

    expect(
      downloadMessageImageAttachment({
        attachment: imageAttachment,
        message,
        setNotice,
        t: translate,
      }),
    ).toBe(false)

    expect(append).toHaveBeenCalledWith(anchor)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(removed).toHaveBeenCalledTimes(1)
    expect(setNotice).toHaveBeenCalledWith(
      'notice.imageDownloadFailed',
      'error',
      'message',
      'assistant-1',
    )
  })

  it('contains image download notice reporter failures', () => {
    const message: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      createdAt: 1,
      attachments: [imageAttachment],
    }
    const failingNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })

    expect(() =>
      reportImageDownloadFailureNotice({
        message,
        setNotice: failingNotice,
        t: translate,
      }),
    ).not.toThrow()
    expect(failingNotice).toHaveBeenCalledWith(
      'notice.imageDownloadFailed',
      'error',
      'message',
      'assistant-1',
    )

    const unusedNotice = vi.fn()
    const failingTranslator: Translator = () => {
      throw new Error('i18n unavailable')
    }

    expect(() =>
      reportImageDownloadFailureNotice({
        message,
        setNotice: unusedNotice,
        t: failingTranslator,
      }),
    ).not.toThrow()
    expect(unusedNotice).not.toHaveBeenCalled()
  })

  it('recognizes generated-image placeholder copy without hiding user text', () => {
    expect(isGeneratedImageNotice('', translate)).toBe(true)
    expect(isGeneratedImageNotice(' 图片已生成 ', translate)).toBe(true)
    expect(isGeneratedImageNotice('Image generated', translate)).toBe(true)
    expect(isGeneratedImageNotice('真正的用户提示词', translate)).toBe(false)
  })

  it('converts data URLs and files without changing MIME data', async () => {
    const file = dataUrlToFile('data:image/webp;base64,aGVsbG8=', 'source.webp')

    expect(file.name).toBe('source.webp')
    expect(file.type).toBe('image/webp')
    expect(await file.text()).toBe('hello')

    class TestFileReader {
      error: DOMException | null = null
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null
      result: string | ArrayBuffer | null = null

      readAsDataURL(nextFile: File): void {
        void nextFile.arrayBuffer().then((buffer) => {
          const bytes = new Uint8Array(buffer)
          let binary = ''

          for (const byte of bytes) {
            binary += String.fromCharCode(byte)
          }

          this.result = `data:${nextFile.type};base64,${btoa(binary)}`
          this.onload?.(new Event('load') as ProgressEvent<FileReader>)
        })
      }
    }

    vi.stubGlobal('FileReader', TestFileReader)
    await expect(fileToDataUrl(file)).resolves.toBe(
      'data:image/webp;base64,aGVsbG8=',
    )
  })

  it('accepts JPEG, PNG, and WebP files by MIME type or filename', () => {
    expect(isAcceptedImageSourceFile(imageFile('photo.jpg', ''))).toBe(true)
    expect(isAcceptedImageSourceFile(imageFile('photo.jpeg', ''))).toBe(true)
    expect(
      isAcceptedImageSourceFile(imageFile('photo.png', 'application/octet-stream')),
    ).toBe(true)
    expect(isAcceptedImageSourceFile(imageFile('source.webp'))).toBe(true)
    expect(isAcceptedImageSourceFile(imageFile('source.png'))).toBe(true)
    expect(isAcceptedImageSourceFile(imageFile('source.png', 'text/plain'))).toBe(
      false,
    )
    expect(isAcceptedImageSourceFile(textFile())).toBe(false)
  })

  it('reads accepted image files from drag and drop payloads', () => {
    const source = imageFile('source.png')
    const unsupported = textFile()

    expect(
      dragHasAcceptedImageSource(
        dataTransfer({ items: [item(source), textItem()] }),
      ),
    ).toBe(true)
    expect(transferHasFile(dataTransfer({ items: [textItem()] }))).toBe(false)
    expect(transferHasFile(dataTransfer({ files: [unsupported] }))).toBe(true)
    expect(
      acceptedImageSourceFromDrop(dataTransfer({ files: [unsupported, source] })),
    ).toBe(source)
    expect(acceptedImageSourceFromDrop(dataTransfer({ files: [unsupported] }))).toBeNull()
  })

  it('keeps drag affordance aligned when browsers omit the item MIME type', () => {
    const source = imageFile('source.png', 'application/octet-stream')

    expect(
      dragHasAcceptedImageSource(dataTransfer({ items: [item(source, '')] })),
    ).toBe(true)
    expect(
      dragHasAcceptedImageSource(
        dataTransfer({ items: [item(source, 'application/octet-stream')] }),
      ),
    ).toBe(true)
  })

  it('prefers clipboard files, then item files, and leaves text-only paste alone', () => {
    const direct = imageFile('direct.png')
    const fromItem = imageFile('clipboard.webp', 'image/webp')
    const mimeLessItem = imageFile('clipboard.png', 'application/octet-stream')

    expect(
      acceptedImageSourceFromClipboard(
        dataTransfer({ files: [direct], items: [item(fromItem)] }),
      ),
    ).toBe(direct)
    expect(
      acceptedImageSourceFromClipboard(dataTransfer({ items: [item(fromItem)] })),
    ).toBe(fromItem)
    expect(
      acceptedImageSourceFromClipboard(
        dataTransfer({ items: [item(mimeLessItem, '')] }),
      ),
    ).toBe(mimeLessItem)
    expect(
      acceptedImageSourceFromClipboard(dataTransfer({ items: [textItem()] })),
    ).toBeNull()
  })

  it('names pasted images and prepares stable download metadata', () => {
    const unnamed = new File(['image'], '', { type: 'image/webp', lastModified: 456 })
    const named = imageFile('already.png')

    expect(namedPastedImageSource(named)).toBe(named)
    expect(namedPastedImageSource(unnamed).name).toBe('zerochat-pasted-source.webp')
    expect(extensionForImageSourceType('image/jpeg')).toBe('jpg')
    expect(extensionForImageSourceType('image/webp')).toBe('webp')
    expect(extensionForImageSourceType('image/png')).toBe('png')
    expect(imageAttachmentDownload(imageAttachment, 99)).toEqual({
      href: imageAttachment.dataUrl,
      filename: 'zerochat-image-42.png',
    })
    expect(
      imageAttachmentDownload({
        ...imageAttachment,
        createdAt: 0,
        dataUrl: undefined,
        url: 'blob:zerochat-image',
        mimeType: 'image/jpeg;charset=utf-8',
      }, 99),
    ).toEqual({
      href: 'blob:zerochat-image',
      filename: 'zerochat-image-99.jpg',
    })
    expect(
      imageAttachmentDownload({ ...imageAttachment, dataUrl: undefined, url: undefined }),
    ).toBeNull()
  })
})
