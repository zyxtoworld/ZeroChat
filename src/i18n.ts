import type { LanguageMode, ProviderKind } from './types'
import type { TranslationDictionary, TranslationKey } from './i18nTypes'
import { APP_DATA_WRITE_CONFLICT_MESSAGE } from './storage/appDataWriteConflict'
export type { TranslationDictionary, TranslationKey } from './i18nTypes'

export type Locale = Exclude<LanguageMode, 'system'>

type Values = Record<string, string | number>

type LocaleModule = { default: TranslationDictionary }

const localeLoaders: Partial<Record<Locale, () => Promise<LocaleModule>>> = {
  'zh-CN': () => import('./locales/zh-CN'),
  'en-US': () => import('./locales/en-US'),
  'es-ES': () => import('./locales/es-ES'),
  'hi-IN': () => import('./locales/hi-IN'),
  'ar-SA': () => import('./locales/ar-SA'),
  'pt-BR': () => import('./locales/pt-BR'),
  'ru-RU': () => import('./locales/ru-RU'),
  'ja-JP': () => import('./locales/ja-JP'),
  'ko-KR': () => import('./locales/ko-KR'),
  'fr-FR': () => import('./locales/fr-FR'),
}

const localeLoadPromises = new Map<Locale, Promise<void>>()

const dictionaries: Partial<Record<Locale, TranslationDictionary>> = {}

const supportedLocales: Locale[] = [
  'zh-CN',
  'en-US',
  'es-ES',
  'hi-IN',
  'ar-SA',
  'pt-BR',
  'ru-RU',
  'ja-JP',
  'ko-KR',
  'fr-FR',
]

const languageModes: LanguageMode[] = ['system', ...supportedLocales]

let runtimeLocale: Locale = resolveLocale('system')

export type Translator = (key: TranslationKey, values?: Values) => string

export function supportedLanguageModes(): LanguageMode[] {
  return [...languageModes]
}

function localeFromLanguage(language: string): Locale | null {
  const normalized = language.toLowerCase()

  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }

  if (normalized.startsWith('es')) {
    return 'es-ES'
  }

  if (normalized.startsWith('hi')) {
    return 'hi-IN'
  }

  if (normalized.startsWith('ar')) {
    return 'ar-SA'
  }

  if (normalized.startsWith('pt')) {
    return 'pt-BR'
  }

  if (normalized.startsWith('ru')) {
    return 'ru-RU'
  }

  if (normalized.startsWith('ja')) {
    return 'ja-JP'
  }

  if (normalized.startsWith('ko')) {
    return 'ko-KR'
  }

  if (normalized.startsWith('fr')) {
    return 'fr-FR'
  }

  if (normalized.startsWith('en')) {
    return 'en-US'
  }

  return null
}

export function getSystemLanguages(): string[] {
  if (typeof navigator === 'undefined') {
    return []
  }

  return navigator.languages?.length ? [...navigator.languages] : [navigator.language]
}

export function normalizeLanguageMode(value: unknown): LanguageMode {
  return languageModes.includes(value as LanguageMode)
    ? (value as LanguageMode)
    : 'system'
}

export function resolveLocale(
  mode: LanguageMode | undefined,
  languages = getSystemLanguages(),
): Locale {
  const normalized = normalizeLanguageMode(mode)

  if (normalized !== 'system') {
    return normalized
  }

  for (const language of languages) {
    const locale = localeFromLanguage(language)

    if (locale) {
      return locale
    }
  }

  return 'en-US'
}

export function localeDirection(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar-SA' ? 'rtl' : 'ltr'
}

export function setRuntimeLocale(locale: Locale): void {
  runtimeLocale = locale
}

export function isLocaleLoaded(locale: Locale): boolean {
  return Boolean(dictionaries[locale])
}

export async function loadLocale(locale: Locale): Promise<void> {
  if (dictionaries[locale]) {
    return
  }

  const loader = localeLoaders[locale]

  if (!loader) {
    return
  }

  const existingPromise = localeLoadPromises.get(locale)

  if (existingPromise) {
    await existingPromise
    return
  }

  const promise = loader()
    .then((module) => {
      dictionaries[locale] = module.default
    })
    .catch((error: unknown) => {
      localeLoadPromises.delete(locale)
      throw error
    })
  localeLoadPromises.set(locale, promise)
  await promise
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values: Values = {},
): string {
  const template =
    dictionaries[locale]?.[key] ?? dictionaries['en-US']?.[key] ?? key

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    return value === undefined ? match : String(value)
  })
}

export function createTranslator(locale: Locale): Translator {
  return (key, values) => translate(locale, key, values)
}

export function rt(key: TranslationKey, values?: Values): string {
  return translate(runtimeLocale, key, values)
}

export function providerKindLabel(kind: ProviderKind, t: Translator): string {
  if (kind === 'anthropic') {
    return t('provider.kind.anthropic')
  }

  if (kind === 'openai-responses') {
    return t('provider.kind.openaiResponses')
  }

  return t('provider.kind.openaiCompatible')
}

export function providerPresetLabel(
  presetId: string,
  fallback: string,
  t: Translator,
): string {
  const key = `provider.preset.${presetId}` as TranslationKey
  const translated = t(key)
  return translated === key ? fallback : translated
}

const syncStatusKeys: Record<string, TranslationKey> = {
  [APP_DATA_WRITE_CONFLICT_MESSAGE]: 'error.localDataWriteConflict',
  'Already up to date': 'sync.status.upToDate',
  'Cloud sync data cleared': 'sync.status.remoteCleared',
  'Cloud sync vault is already empty': 'sync.status.remoteAlreadyEmpty',
  'Current local mode': 'sync.status.localMode',
  'Currently using local mode': 'sync.status.localMode',
  'Incremental sync complete': 'sync.status.incrementalComplete',
  'Local and cloud data merged': 'sync.status.merged',
  'Cloud sync failed': 'status.localSaved',
  'Cloud sync is waiting for the data encryption password.':
    'error.cloudflareAccessKeyRequired',
  'Remote encrypted data applied': 'sync.status.remoteAccepted',
  'Remote data restored': 'sync.status.remoteAccepted',
  'Remote incremental data applied': 'sync.status.remoteIncrementalAccepted',
  'Remote sync vault has not been created': 'sync.status.remoteNotCreated',
  'Sync complete': 'sync.status.complete',
  '增量同步完成': 'sync.status.incrementalComplete',
  '本机和云端数据已合并': 'sync.status.merged',
  '同步完成': 'sync.status.complete',
  '已采用远端加密数据': 'sync.status.remoteAccepted',
  '已采用远端加密数': 'sync.status.remoteAccepted',
  '已采用远端增量数据': 'sync.status.remoteIncrementalAccepted',
  '已采用远端增量数': 'sync.status.remoteIncrementalAccepted',
  '已是最新': 'sync.status.upToDate',
  '已是最': 'sync.status.upToDate',
  '当前使用本地模式': 'sync.status.localMode',
  '远端同步库尚未创建': 'sync.status.remoteNotCreated',
  '远端同步库尚未创': 'sync.status.remoteNotCreated',
}

export function localizeKnownMessage(message: string, locale: Locale): string {
  const key = syncStatusKeys[message]
  return key ? translate(locale, key) : message
}
