import {
  localizeKnownMessage,
  resolveLocale,
  translate,
  type TranslationKey,
} from '../i18n'
import type { LanguageMode } from '../types'
import { providerErrorCode, redactSensitiveText } from '../services/uiRuntime'

const providerErrorKeys: Readonly<Record<string, TranslationKey>> = {
  auth: 'error.apiKeyInvalid',
  endpoint: 'error.providerEndpointMissing',
  quota: 'error.apiBalanceInsufficient',
  'rate-limit': 'error.apiRateLimited',
  request: 'error.apiRequestFailed',
  server: 'error.apiUnavailable',
  timeout: 'error.networkRequestFailed',
}

function rawErrorMessage(error: unknown): string | null {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return null
  }
}

export function formatUserFacingError(
  error: unknown,
  language: LanguageMode | undefined,
): string {
  const locale = resolveLocale(language)
  const rawMessage = rawErrorMessage(error)
  if (rawMessage === null) return translate(locale, 'error.apiRequestFailed')

  const code = providerErrorCode(error)
  if (
    code === 'network' &&
    error instanceof Error &&
    error.name === 'ProviderRequestError'
  ) {
    return redactSensitiveText(localizeKnownMessage(rawMessage, locale))
  }

  const providerErrorKey =
    code === 'network' ? 'error.networkRequestFailed' : providerErrorKeys[code]
  if (providerErrorKey) return translate(locale, providerErrorKey)

  return redactSensitiveText(localizeKnownMessage(rawMessage, locale))
}

export function localizeSyncStatus(
  message: string,
  language: LanguageMode | undefined,
): string {
  return redactSensitiveText(localizeKnownMessage(message, resolveLocale(language)))
}
