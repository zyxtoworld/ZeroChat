import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppData } from '../../types'
import {
  loadLocale,
  supportedLanguageModes,
  translate,
  type Locale,
} from '../../i18n'
import {
  createAppTranslator,
  formatDateGroup,
  formatSyncTimestamp,
  formatTime,
  resolveAppLocale,
} from '../i18n'
import {
  applyTheme,
  installMediaQueryChangeSubscription,
  installOnlineStatusSubscription,
  resolveTheme,
} from '../theme'

function data(language: AppData['preferences']['language']): AppData {
  return {
    conversations: [],
    preferences: {
      compactMode: false,
      firstRunDone: true,
      language,
      theme: 'system',
    },
    providers: [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt: 1,
    version: 1,
  }
}

beforeEach(() => {
  vi.stubGlobal('navigator', { language: 'zh-CN', onLine: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('app locale helpers', () => {
  it('keeps shared app runtime keys translated in every supported locale', async () => {
    const locales = supportedLanguageModes().filter(
      (locale): locale is Locale => locale !== 'system',
    )

    for (const locale of locales) {
      await loadLocale(locale)
      for (const key of [
        'button.newMessages',
        'error.localDataWriteConflict',
        'message.transcriptLabel',
        'message.plainText',
      ] as const) {
        const value = translate(locale, key)
        expect(value.trim()).not.toBe('')
        expect(value).not.toBe(key)
      }
    }
  })

  it('resolves explicit and system locales with a safe English fallback', () => {
    expect(resolveAppLocale(data('zh-CN'))).toBe('zh')
    expect(resolveAppLocale(data('en-US'))).toBe('en')
    expect(resolveAppLocale(data('ja-JP'))).toBe('ja')
    expect(resolveAppLocale(data('system'))).toBe('zh')
    vi.stubGlobal('navigator', { language: 'fr-FR', onLine: true })
    expect(resolveAppLocale(data('system'))).toBe('en')
    vi.stubGlobal('navigator', undefined)
    expect(resolveAppLocale(data('system'))).toBe('en')

    const zh = createAppTranslator('zh')
    const en = createAppTranslator('en')
    expect(zh('app.newChat')).toBe('新会话')
    expect(en('app.newChat')).toBe('New chat')
    expect(createAppTranslator('ja')('app.newChat')).toBe('新しいチャット')
    expect(en('missing.key' as never)).toBe('missing.key')
  })

  it('keeps skill loading failures localized in every app locale', () => {
    expect(createAppTranslator('zh')('skills.loadFailed')).toContain('技能')
    expect(createAppTranslator('en')('skills.loadFailed')).toContain('skill')
    expect(createAppTranslator('ja')('skills.loadFailed')).toContain('スキル')
  })

  it('keeps cloud-clear recovery copy neutral about Worker capability in every locale', async () => {
    const locales = supportedLanguageModes().filter(
      (locale): locale is Locale => locale !== 'system',
    )
    const forbiddenGenerationCopy =
      /旧版|新版|最新版|老版|版本太旧|\b(?:old(?:er|est)?|latest|version|too old)\b|ancien|ancienne|dernier|antigu|antiga|últim|versión|velho|mais recente|стар|последн|верси|古い|最新|バージョン|오래|최신|버전|पुराने|नवीनतम|संस्करण|قديم|أحدث|إصدار|أقدم|\bv(?:\d+|next)\b/iu

    for (const locale of locales) {
      await loadLocale(locale)
      const requiresPassphrase = translate(locale, 'error.clearCloudRequiresPassphrase')
      const updateWorker = translate(locale, 'error.clearCloudUpdateWorker')

      for (const value of [requiresPassphrase, updateWorker]) {
        expect(value.trim()).not.toBe('')
        expect(value).not.toMatch(forbiddenGenerationCopy)
      }
    }

    expect(translate('zh-CN', 'error.clearCloudRequiresPassphrase')).toBe(
      '当前 Worker 不支持直接清空此类增量数据。请先填写数据加密密码，或重新部署 Worker。',
    )
    expect(translate('zh-CN', 'error.clearCloudUpdateWorker')).toBe(
      '当前 Worker 无法完整清空增量同步数据。请重新部署 Worker。',
    )
  })

  it('keeps local encryption migration failures stable in every locale', async () => {
    const locales = supportedLanguageModes().filter(
      (locale): locale is Locale => locale !== 'system',
    )

    for (const locale of locales) {
      await loadLocale(locale)
      for (const key of [
        'notice.appDataMigrationFailed',
        'notice.skillContentMigrationFailed',
      ] as const) {
        const value = translate(locale, key, {
          message: 'C:\\Users\\private\\vault sk-secret-shaped-sentinel',
        })
        expect(value.trim()).not.toBe('')
        expect(value).not.toBe(key)
        expect(value).not.toMatch(/private|secret-shaped|\{message\}/i)
      }
    }
  })

  it('formats same-day, cross-day, and invalid timestamps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T12:34:00'))
    const sameDay = new Date('2026-08-07T09:05:00').getTime()
    const previousDay = new Date('2026-08-06T09:05:00').getTime()
    expect(formatTime(sameDay, 'en')).toMatch(/^\d{2}:\d{2}$/)
    expect(formatTime(previousDay, 'zh')).toMatch(/月\d+日$/)
    expect(formatTime(previousDay, 'ja')).toMatch(/月\d+日$/)
    expect(formatTime(previousDay, 'en')).toMatch(/^2026-08-06$/)
    expect(formatTime(Number.NaN, 'en')).toBe('')
    expect(formatDateGroup(previousDay, 'zh')).toBe('2026年8月6日')
    expect(formatDateGroup(previousDay, 'ja')).toBe('2026年8月6日')
    expect(formatDateGroup(previousDay, 'en')).toContain('Aug')
    expect(formatDateGroup(Number.NaN, 'en')).toBe('')
    expect(formatSyncTimestamp(sameDay, 'zh')).toContain('2026')
    expect(formatSyncTimestamp(sameDay, 'en')).toContain('2026')
    expect(formatSyncTimestamp(Number.NaN, 'en')).toBe('')
  })
})

describe('current theme helpers', () => {
  it('resolves explicit themes and system media preferences', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
    const darkMatchMedia = vi.fn(() => ({ matches: true }))
    vi.stubGlobal('matchMedia', darkMatchMedia)
    vi.stubGlobal('window', { matchMedia: darkMatchMedia })
    expect(resolveTheme('system')).toBe('dark')
    const lightMatchMedia = vi.fn(() => ({ matches: false }))
    vi.stubGlobal('matchMedia', lightMatchMedia)
    vi.stubGlobal('window', { matchMedia: lightMatchMedia })
    expect(resolveTheme('system')).toBe('light')
    vi.stubGlobal('matchMedia', undefined)
    vi.stubGlobal('window', undefined)
    expect(resolveTheme('system')).toBe('light')
  })

  it('fails closed when the system media query throws', () => {
    const throwingMatchMedia = vi.fn(() => {
      throw new Error('media query unavailable')
    })
    vi.stubGlobal('window', { matchMedia: throwingMatchMedia })
    vi.stubGlobal('matchMedia', throwingMatchMedia)

    expect(resolveTheme('system')).toBe('light')
  })

  it('applies a resolved theme when a document exists', () => {
    const themeColor = { setAttribute: vi.fn() }
    const documentStub = {
      documentElement: { dataset: {} as Record<string, string> },
      querySelector: vi.fn(() => themeColor),
    }
    vi.stubGlobal('document', documentStub)
    applyTheme('dark')
    expect(documentStub.documentElement.dataset.theme).toBe('dark')
    expect(themeColor.setAttribute).toHaveBeenCalledWith('content', '#0f1117')
    applyTheme('light')
    expect(themeColor.setAttribute).toHaveBeenLastCalledWith('content', '#fafbfc')
    vi.stubGlobal('document', undefined)
    expect(() => applyTheme('light')).not.toThrow()
  })

  it('reconciles the current network snapshot after subscribing to browser events', () => {
    let online = false
    const listeners = new Map<string, () => void>()
    const target = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      }),
    }
    const onStatusChange = vi.fn()

    const dispose = installOnlineStatusSubscription(
      target,
      () => online,
      onStatusChange,
    )

    expect(onStatusChange).toHaveBeenCalledOnce()
    expect(onStatusChange).toHaveBeenLastCalledWith(false)

    online = true
    listeners.get('online')?.()
    expect(onStatusChange).toHaveBeenLastCalledWith(true)

    dispose()
    expect(listeners).toHaveLength(0)
    expect(target.removeEventListener).toHaveBeenCalledTimes(2)
  })

  it('contains a partial online subscription failure and removes the first listener', () => {
    const listeners = new Map<string, () => void>()
    const target = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'offline') {
          throw new Error('offline listener unavailable')
        }
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      }),
    }

    expect(() =>
      installOnlineStatusSubscription(target, () => true, vi.fn()),
    ).not.toThrow()
    expect(listeners).toHaveLength(0)
    expect(target.removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('cleans both online listeners when the initial online read fails', () => {
    const listeners = new Map<string, () => void>()
    const target = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      }),
    }

    expect(() =>
      installOnlineStatusSubscription(
        target,
        () => {
          throw new Error('online state unavailable')
        },
        vi.fn(),
      ),
    ).not.toThrow()
    expect(target.addEventListener).toHaveBeenNthCalledWith(
      1,
      'online',
      expect.any(Function),
    )
    expect(target.addEventListener).toHaveBeenNthCalledWith(
      2,
      'offline',
      expect.any(Function),
    )
    expect(listeners).toHaveLength(0)
    expect(target.removeEventListener).toHaveBeenNthCalledWith(
      1,
      'online',
      expect.any(Function),
    )
    expect(target.removeEventListener).toHaveBeenNthCalledWith(
      2,
      'offline',
      expect.any(Function),
    )
    expect(target.removeEventListener).toHaveBeenCalledTimes(2)
  })

  it('cleans both online listeners when the initial status update fails', () => {
    const listeners = new Map<string, () => void>()
    const target = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      }),
    }
    const onStatusChange = vi.fn(() => {
      throw new Error('online state update unavailable')
    })

    expect(() =>
      installOnlineStatusSubscription(target, () => true, onStatusChange),
    ).not.toThrow()
    expect(target.addEventListener).toHaveBeenNthCalledWith(
      1,
      'online',
      expect.any(Function),
    )
    expect(target.addEventListener).toHaveBeenNthCalledWith(
      2,
      'offline',
      expect.any(Function),
    )
    expect(listeners).toHaveLength(0)
    expect(target.removeEventListener).toHaveBeenNthCalledWith(
      1,
      'online',
      expect.any(Function),
    )
    expect(target.removeEventListener).toHaveBeenNthCalledWith(
      2,
      'offline',
      expect.any(Function),
    )
    expect(target.removeEventListener).toHaveBeenCalledTimes(2)
  })

  it('reapplies the current system theme after subscribing to media changes', () => {
    const listeners = new Set<() => void>()
    const mediaQuery = {
      addEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.add(listener)
      }),
      removeEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.delete(listener)
      }),
    }
    const apply = vi.fn()

    const dispose = installMediaQueryChangeSubscription(mediaQuery, apply)

    expect(apply).toHaveBeenCalledOnce()
    expect(mediaQuery.addEventListener).toHaveBeenCalledBefore(apply)

    for (const listener of listeners) listener()
    expect(apply).toHaveBeenCalledTimes(2)

    dispose()
    expect(listeners).toHaveLength(0)
  })

  it('cleans a media listener when the initial theme callback fails', () => {
    const listeners = new Set<() => void>()
    const target = {
      addEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.add(listener)
      }),
      removeEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.delete(listener)
      }),
    }

    expect(() =>
      installMediaQueryChangeSubscription(target, () => {
        throw new Error('theme application unavailable')
      }),
    ).not.toThrow()
    expect(listeners).toHaveLength(0)
    expect(target.removeEventListener).toHaveBeenCalledOnce()
  })

  it('cleans a synchronously dispatched media callback during registration', () => {
    const listeners = new Set<() => void>()
    const target = {
      addEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.add(listener)
        listener()
      }),
      removeEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.delete(listener)
      }),
    }
    const apply = vi.fn(() => {
      throw new Error('synchronous media callback failed')
    })

    expect(() =>
      installMediaQueryChangeSubscription(target, apply),
    ).not.toThrow()
    expect(listeners).toHaveLength(0)
    expect(target.removeEventListener).toHaveBeenCalledOnce()
  })

  it('contains a later media callback failure without losing cleanup ownership', () => {
    const listeners = new Set<() => void>()
    const target = {
      addEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.add(listener)
      }),
      removeEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.delete(listener)
      }),
    }
    let calls = 0
    const apply = vi.fn(() => {
      calls += 1
      if (calls > 1) throw new Error('later media callback failed')
    })

    const dispose = installMediaQueryChangeSubscription(target, apply)
    expect(() => listeners.forEach((listener) => listener())).not.toThrow()
    expect(listeners).toHaveLength(1)

    dispose()
    expect(listeners).toHaveLength(0)
    expect(target.removeEventListener).toHaveBeenCalledOnce()
  })

  it('supports legacy media listeners and removes the exact handler once', () => {
    const listeners = new Set<() => void>()
    const target = {
      addListener: vi.fn((listener: () => void) => {
        listeners.add(listener)
      }),
      removeListener: vi.fn((listener: () => void) => {
        listeners.delete(listener)
      }),
    }
    const apply = vi.fn()

    const dispose = installMediaQueryChangeSubscription(
      target as never,
      apply,
    )

    expect(target.addListener).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledOnce()

    for (const listener of listeners) listener()
    expect(apply).toHaveBeenCalledTimes(2)

    dispose()
    dispose()
    expect(target.removeListener).toHaveBeenCalledOnce()
    expect(target.removeListener).toHaveBeenCalledWith(
      target.addListener.mock.calls[0][0],
    )
    expect(listeners).toHaveLength(0)
  })

  it('cleans a legacy media listener when the initial callback fails', () => {
    const listeners = new Set<() => void>()
    const target = {
      addListener: vi.fn((listener: () => void) => {
        listeners.add(listener)
      }),
      removeListener: vi.fn((listener: () => void) => {
        listeners.delete(listener)
      }),
    }

    expect(() =>
      installMediaQueryChangeSubscription(target as never, () => {
        throw new Error('legacy theme application unavailable')
      }),
    ).not.toThrow()
    expect(target.removeListener).toHaveBeenCalledOnce()
    expect(listeners).toHaveLength(0)
  })
})
