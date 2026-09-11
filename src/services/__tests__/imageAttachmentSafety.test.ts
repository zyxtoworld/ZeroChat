import { describe, expect, it } from 'vitest'

import {
  normalizedImageAttachmentMimeType,
  safeImageAttachmentDataUrl,
  safeImageAttachmentUrl,
  safeProviderImageAttachmentSource,
  safeRemoteImageAttachmentUrl,
} from '../imageAttachmentSafety'
import { MAX_IMAGE_FILE_BYTES } from '../localFileLimits'

describe('image attachment safety', () => {
  it('normalizes only supported raster image formats', () => {
    expect(normalizedImageAttachmentMimeType(undefined)).toBe('image/png')
    expect(normalizedImageAttachmentMimeType('jpg')).toBe('image/jpeg')
    expect(normalizedImageAttachmentMimeType('IMAGE/JPEG')).toBe('image/jpeg')
    expect(normalizedImageAttachmentMimeType('webp')).toBe('image/webp')
    expect(normalizedImageAttachmentMimeType('image/svg+xml')).toBe('image/png')
  })

  it('accepts canonical raster data images and rejects active or malformed payloads', () => {
    expect(safeImageAttachmentDataUrl(' data:image/jpg;base64,YQ== ')).toEqual({
      dataUrl: 'data:image/jpeg;base64,YQ==',
      mimeType: 'image/jpeg',
    })
    expect(safeImageAttachmentDataUrl('data:image/webp;base64,abc123')).toEqual({
      dataUrl: 'data:image/webp;base64,abc123',
      mimeType: 'image/webp',
    })

    for (const value of [
      undefined,
      '',
      'data:image/png;base64',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:text/html;base64,PGgxPkJvb208L2gxPg==',
      'data:image/png;charset=utf-8;base64,YQ==',
      'data:image/png;base64,',
      'data:image/png;base64,a',
      'data:image/png;base64,YQ=',
      'data:image/png;base64,YQ===',
      'data:image/png;base64,Y Q==',
      'data:image/png;base64,YQ-_',
    ]) {
      expect(safeImageAttachmentDataUrl(value)).toBeNull()
    }
  })

  it('rejects raster data URLs whose decoded image budget would be exceeded', () => {
    const maxPayloadLength = 4 * Math.ceil(MAX_IMAGE_FILE_BYTES / 3)
    const oversizedPayload = 'A'.repeat(maxPayloadLength)

    expect(
      safeImageAttachmentDataUrl(
        `data:image/png;base64,${oversizedPayload}`,
      ),
    ).toBeNull()
  })

  it('allows only canonical public HTTP(S) image URLs without credentials', () => {
    expect(
      safeRemoteImageAttachmentUrl(' https://cdn.example.test/image.png?x=1#preview '),
    ).toBe('https://cdn.example.test/image.png?x=1#preview')
    expect(safeRemoteImageAttachmentUrl('http://例子.example/image.webp')).toBe(
      'http://xn--fsqu00a.example/image.webp',
    )

    for (const value of [
      undefined,
      '',
      '/image.png',
      'intent://open/image',
      'file:///tmp/image.png',
      'https://user:secret@cdn.example/image.png',
      'https://cdn.example/has space.png',
      'https:///missing-host.png',
      'https://cdn/image.png',
      'https://2130706433/image.png',
      'https://0x7f000001/image.png',
      'https://0x7f.0.0.1/image.png',
      'https://0177.0.0.1/image.png',
      'https://127.1/image.png',
      'https://127.0.1/image.png',
      'https://localhost/image.png',
      'https://127.0.0.1/image.png',
      'https://localhost./image.png',
      'https://localhost../image.png',
      'https://service.localhost./image.png',
      'https://service.localhost../image.png',
      'https://router.lan./image.png',
      'https://router.lan../image.png',
      'https://router.home.arpa./image.png',
      'https://router.home.arpa../image.png',
      'https://192.168.1.2/image.png',
      'https://[::1]/image.png',
    ]) {
      expect(safeRemoteImageAttachmentUrl(value)).toBe('')
    }
  })

  it('applies the shared URL parser boundary to encoded and IPv6 private hosts', () => {
    for (const value of [
      'https://2130706433/image.png',
      'https://0x7f000001/image.png',
      'https://0177.0.0.1/image.png',
      'https://127.1/image.png',
      'https://[::ffff:127.0.0.1]/image.png',
      'https://[::ffff:192.168.1.1]/image.png',
      'https://[64:ff9b::7f00:1]/image.png',
      'https://[2002:c0a8:0101::1]/image.png',
      'https://[fe80::1]/image.png',
      'https://[fd00::1]/image.png',
      'https://[ff02::1]/image.png',
      'https://localhost./image.png',
      'https://router.lan../image.png',
    ]) {
      expect(safeRemoteImageAttachmentUrl(value), value).toBe('')
    }

    for (const value of [
      'https://[2001:::1]/image.png',
      'https://[::ffff:999.1.1.1]/image.png',
    ]) {
      // The URL parser rejects these before the host classifier's malformed-IPv6
      // fail-open result could be used by an image caller.
      expect(safeRemoteImageAttachmentUrl(value), value).toBe('')
    }

    expect(
      safeRemoteImageAttachmentUrl('https://[2001:4860:4860::8888]/image.png'),
    ).toBe('https://[2001:4860:4860::8888]/image.png')
  })

  it('rejects control characters before trimming remote, data, or blob sources', () => {
    for (const control of ['\u0000', '\t', '\n', '\r', '\u007f']) {
      expect(
        safeRemoteImageAttachmentUrl(
          `${control}https://cdn.example/image.png`,
        ),
      ).toBe('')
      expect(
        safeImageAttachmentDataUrl(
          `${control}data:image/png;base64,YQ==`,
        ),
      ).toBeNull()
      expect(safeImageAttachmentUrl(`${control}blob:zerochat-image`)).toBe('')
    }

    expect(
      safeRemoteImageAttachmentUrl(' https://cdn.example/image.png '),
    ).toBe('https://cdn.example/image.png')
    expect(safeImageAttachmentDataUrl(' data:image/png;base64,YQ== ')).toEqual({
      dataUrl: 'data:image/png;base64,YQ==',
      mimeType: 'image/png',
    })
  })

  it('keeps runtime blob images local without admitting other custom schemes', () => {
    expect(safeImageAttachmentUrl(' blob:zerochat-image ')).toBe(
      'blob:zerochat-image',
    )
    expect(safeImageAttachmentUrl('https://cdn.example/image.png')).toBe(
      'https://cdn.example/image.png',
    )
    expect(safeImageAttachmentUrl('blob:zero chat')).toBe('')
    expect(safeImageAttachmentUrl('intent://open/image')).toBe('')
  })

  it('keeps provider-bound image sources inside the same remote/raster boundary', () => {
    expect(
      safeProviderImageAttachmentSource({
        dataUrl: 'data:image/png;base64,YQ==',
        url: 'https://cdn.example/fallback.png',
      }),
    ).toBe('data:image/png;base64,YQ==')
    expect(
      safeProviderImageAttachmentSource({
        dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
        url: 'https://cdn.example/fallback.png',
      }),
    ).toBe('')
    expect(
      safeProviderImageAttachmentSource({
        dataUrl: 'data:image/png;base64,YQ==',
        url: 'https://127.0.0.1/fallback.png',
      }),
    ).toBe('')
    expect(
      safeProviderImageAttachmentSource({ url: 'blob:zerochat-image' }),
    ).toBe('')
    expect(
      safeProviderImageAttachmentSource({
        url: 'https://user:secret@cdn.example/image.png',
      }),
    ).toBe('')
  })
})
