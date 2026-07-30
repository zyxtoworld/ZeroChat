import type { translationKeys } from './locales/keys'

export type TranslationKey = (typeof translationKeys)[number]
export type TranslationDictionary = Record<TranslationKey, string>
