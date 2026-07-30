import {
  useCallback,
  useMemo,
} from 'react'

import type { NoticeTarget } from '../components/Notice'
import {
  localizeKnownMessage,
  type Locale,
  type Translator,
} from '../i18n'
import {
  providerErrorCode,
  redactSensitiveText,
  type NoticeTone,
} from './uiRuntime'

interface AppMessageControllerContext {
  locale: Locale
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
    anchorId?: string,
  ) => void
  t: Translator
}

export interface AppMessageController {
  errorMessage: (error: unknown) => string
  reportLocalSaveError: (error: unknown) => void
  syncMessage: (message: string) => string
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function formatAppErrorMessage(
  error: unknown,
  t: Translator,
  locale: Locale,
): string {
  const code = providerErrorCode(error)
  const rawMessage = rawErrorMessage(error)

  if (code === 'network' || code === 'timeout') {
    if (
      error instanceof Error &&
      error.name === 'ProviderRequestError' &&
      code === 'network'
    ) {
      return redactSensitiveText(localizeKnownMessage(rawMessage, locale))
    }

    return t('error.networkRequestFailed')
  }

  if (code === 'auth') {
    return t('error.apiKeyInvalid')
  }

  if (code === 'quota') {
    return t('error.apiBalanceInsufficient')
  }

  if (code === 'rate-limit') {
    return t('error.apiRateLimited')
  }

  if (code === 'endpoint') {
    return t('error.providerEndpointMissing')
  }

  if (code === 'server') {
    return t('error.apiUnavailable')
  }

  if (code === 'request') {
    return t('error.apiRequestFailed')
  }

  return redactSensitiveText(localizeKnownMessage(rawMessage, locale))
}

export function localizeSyncRuntimeMessage(
  message: string,
  locale: Locale,
): string {
  return localizeKnownMessage(message, locale)
}

export function localizeLocalSaveError(
  error: unknown,
  locale: Locale,
): string {
  return redactSensitiveText(localizeKnownMessage(rawErrorMessage(error), locale))
}

export function reportLocalSaveErrorNotice(
  error: unknown,
  locale: Locale,
  setNotice: AppMessageControllerContext['setNotice'],
): void {
  try {
    setNotice(localizeLocalSaveError(error, locale), 'error')
  } catch {
    // There is no safer fallback channel for a failed local-save notice.
  }
}

export function useAppMessageController({
  locale,
  setNotice,
  t,
}: AppMessageControllerContext): AppMessageController {
  const errorMessage = useCallback(
    (error: unknown) => formatAppErrorMessage(error, t, locale),
    [locale, t],
  )
  const reportLocalSaveError = useCallback(
    (error: unknown): void => {
      reportLocalSaveErrorNotice(error, locale, setNotice)
    },
    [locale, setNotice],
  )
  const syncMessage = useCallback(
    (message: string): string => localizeSyncRuntimeMessage(message, locale),
    [locale],
  )

  return useMemo(
    () => ({
      errorMessage,
      reportLocalSaveError,
      syncMessage,
    }),
    [errorMessage, reportLocalSaveError, syncMessage],
  )
}
