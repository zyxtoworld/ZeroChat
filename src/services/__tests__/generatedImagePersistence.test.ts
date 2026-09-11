import { afterEach, describe, expect, it, vi } from 'vitest'

import { materializeGeneratedImage } from '../generatedImagePersistence'
import { MAX_IMAGE_FILE_BYTES } from '../localFileLimits'

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
])

describe('generated image persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps provider base64 images without another network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const image = {
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      revisedPrompt: 'revised',
    }

    await expect(
      materializeGeneratedImage(image, new AbortController().signal, 1_000),
    ).resolves.toBe(image)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('materializes signed remote image URLs without persisting the URL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(PNG_BYTES, {
        status: 200,
        headers: {
          'content-length': String(PNG_BYTES.byteLength),
          'content-type': 'image/png',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const signedUrl =
      'https://cdn.example.test/generated.png?token=temporary-secret&expires=1'

    const image = await materializeGeneratedImage(
      {
        mimeType: 'image/png',
        revisedPrompt: 'revised',
        url: signedUrl,
      },
      new AbortController().signal,
      1_000,
    )

    expect(image).toEqual({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoA',
      mimeType: 'image/png',
      revisedPrompt: 'revised',
    })
    expect(JSON.stringify(image)).not.toContain('temporary-secret')
    expect(fetchMock).toHaveBeenCalledWith(
      signedUrl,
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'omit',
        method: 'GET',
        mode: 'cors',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }),
    )
  })

  it('rejects non-image bytes instead of persisting a temporary URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<html>expired</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    )

    await expect(
      materializeGeneratedImage(
        {
          mimeType: 'image/png',
          url: 'https://cdn.example.test/generated.png?token=expired',
        },
        new AbortController().signal,
        1_000,
      ),
    ).rejects.toThrow()
  })

  it('cancels an unread remote image body when the final URL changes', async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream<Uint8Array>({ cancel }),
      {
        status: 200,
        headers: { 'content-type': 'image/png' },
      },
    )
    Object.defineProperty(response, 'url', {
      value: 'https://other.example.test/generated.png',
    })
    vi.stubGlobal('fetch', vi.fn(async () => response))

    await expect(
      materializeGeneratedImage(
        {
          mimeType: 'image/png',
          url: 'https://cdn.example.test/generated.png?token=temporary',
        },
        new AbortController().signal,
        1_000,
      ),
    ).rejects.toThrow()
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
  })

  it('rejects declared oversized remote images before buffering the body', async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream<Uint8Array>({ cancel }),
      {
        status: 200,
        headers: {
          'content-length': String(MAX_IMAGE_FILE_BYTES + 1),
          'content-type': 'image/png',
        },
      },
    )
    vi.stubGlobal('fetch', vi.fn(async () => response))

    await expect(
      materializeGeneratedImage(
        {
          mimeType: 'image/png',
          url: 'https://cdn.example.test/oversized.png?token=temporary',
        },
        new AbortController().signal,
        1_000,
      ),
    ).rejects.toThrow()
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
  })
})
