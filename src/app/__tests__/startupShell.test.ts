import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyStartupShell,
  resolveStartupLocale,
} from '../startupShell'

describe('startup shell', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scans every browser language preference and falls back to English', () => {
    expect(resolveStartupLocale(['xx-ZZ', 'ar-EG'])).toBe('ar-SA')
    expect(resolveStartupLocale(['zh-HK'])).toBe('zh-CN')
    expect(resolveStartupLocale(['xx-ZZ'])).toBe('en-US')
  })

  it('localizes the loading shell, direction, and dark theme color', () => {
    const loading = { textContent: '' }
    const themeColor = { setAttribute: vi.fn() }
    const doc = {
      documentElement: { dir: '', lang: '' },
      querySelector: vi.fn((selector: string) =>
        selector === '[data-initial-loading]' ? loading : themeColor,
      ),
    } as unknown as Document

    expect(
      applyStartupShell({
        document: doc,
        languages: ['ar-EG'],
        prefersDark: true,
      }),
    ).toBe('ar-SA')
    expect(doc.documentElement.lang).toBe('ar-SA')
    expect(doc.documentElement.dir).toBe('rtl')
    expect(loading.textContent).toBe('جار التحميل...')
    expect(themeColor.setAttribute).toHaveBeenCalledWith('content', '#0f1117')
  })

  it('uses browser preferences when options are omitted and leaves light shells unchanged', () => {
    vi.stubGlobal('navigator', {
      language: 'xx-ZZ',
      languages: ['ja-JP', 'en-US'],
    })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))

    const loading = { textContent: '' }
    const doc = {
      documentElement: { dir: '', lang: '' },
      querySelector: vi.fn((selector: string) =>
        selector === '[data-initial-loading]' ? loading : null,
      ),
    } as unknown as Document

    expect(applyStartupShell({ document: doc })).toBe('ja-JP')
    expect(doc.documentElement.lang).toBe('ja-JP')
    expect(doc.documentElement.dir).toBe('ltr')
    expect(loading.textContent).toBe('読み込み中...')
    expect(doc.querySelector).toHaveBeenCalledTimes(1)
  })

  it('handles a missing document and missing loading shell without browser APIs', () => {
    expect(applyStartupShell({ document: null })).toBeNull()

    const doc = {
      documentElement: { dir: '', lang: '' },
      querySelector: vi.fn(() => null),
    } as unknown as Document
    vi.stubGlobal('matchMedia', undefined)

    expect(
      applyStartupShell({
        document: doc,
        languages: ['ko-KR'],
      }),
    ).toBe('ko-KR')
    expect(doc.documentElement.lang).toBe('ko-KR')
    expect(doc.documentElement.dir).toBe('ltr')
    expect(doc.querySelector).toHaveBeenCalledWith('[data-initial-loading]')
  })

  it('keeps the startup shell usable when the browser media query throws', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => {
      throw new Error('media query unavailable')
    }))

    const loading = { textContent: '' }
    const doc = {
      documentElement: { dir: '', lang: '' },
      querySelector: vi.fn((selector: string) =>
        selector === '[data-initial-loading]' ? loading : null,
      ),
    } as unknown as Document

    let result: ReturnType<typeof applyStartupShell> = null
    expect(() => {
      result = applyStartupShell({ document: doc, languages: ['en-US'] })
    }).not.toThrow()
    expect(result).toBe('en-US')
    expect(doc.documentElement.lang).toBe('en-US')
    expect(doc.documentElement.dir).toBe('ltr')
    expect(loading.textContent).toBe('Loading...')
  })

})
