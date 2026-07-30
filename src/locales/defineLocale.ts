import { translationKeys } from './keys'
import type { TranslationDictionary } from '../i18nTypes'

export function defineLocale(values: readonly string[]): TranslationDictionary {
  if (values.length !== translationKeys.length) {
    throw new Error(`Locale has ${values.length} values for ${translationKeys.length} translation keys.`)
  }

  const dictionary = {} as TranslationDictionary

  for (let index = 0; index < translationKeys.length; index += 1) {
    const key = translationKeys[index]
    dictionary[key] = values[index] ?? key
  }

  return dictionary
}
