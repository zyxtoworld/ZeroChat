import { beforeAll, describe, expect, it } from 'vitest'

import {
  createTranslator,
  isLocaleLoaded,
  loadLocale,
  localeDirection,
  providerPresetLabel,
  resolveLocale,
  setRuntimeLocale,
  supportedLanguageModes,
  translate,
} from '../../i18n'

beforeAll(async () => {
  await loadLocale('en-US')
  setRuntimeLocale('en-US')
})

describe('i18n runtime', () => {
  it('resolves system language preferences in order', () => {
    expect(resolveLocale('system', ['de-DE', 'fr-CA', 'en-US'])).toBe('fr-FR')
    expect(resolveLocale('system', ['zh-Hant-TW'])).toBe('zh-CN')
    expect(resolveLocale('system', ['unknown'])).toBe('en-US')
    expect(resolveLocale('ja-JP', ['fr-FR'])).toBe('ja-JP')
  })

  it('keeps locale direction and mode lists in sync with supported languages', () => {
    expect(localeDirection('ar-SA')).toBe('rtl')
    expect(localeDirection('en-US')).toBe('ltr')
    expect(supportedLanguageModes()).toContain('system')
    expect(supportedLanguageModes()).toContain('fr-FR')
  })

  it('loads lazy locale chunks and translates known keys', async () => {
    expect(isLocaleLoaded('fr-FR')).toBe(false)
    await loadLocale('fr-FR')
    expect(isLocaleLoaded('fr-FR')).toBe(true)
    expect(translate('fr-FR', 'button.send')).toBe('Envoyer')
    expect(translate('fr-FR', 'settings.modelCount', { count: 3 })).toContain('3')
  }, 15_000)

  it('falls back to provided provider preset names for unknown dynamic labels', () => {
    const t = createTranslator('en-US')

    expect(providerPresetLabel('azure-openai', 'Azure fallback', t)).toBe('Azure OpenAI')
    expect(providerPresetLabel('unknown-provider', 'Custom fallback', t)).toBe(
      'Custom fallback',
    )
  })
})
