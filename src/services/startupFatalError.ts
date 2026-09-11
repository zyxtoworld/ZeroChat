import { rt, type TranslationKey } from '../i18n'

export const STARTUP_FATAL_TITLE = 'ZeroChat could not start'
export const STARTUP_FATAL_MESSAGE =
  'Reload the app. If it still fails, clear this site data or open a fresh browser profile.'
export const STARTUP_FATAL_RELOAD = 'Reload ZeroChat'

type StartupFailureLogger = Pick<Console, 'error'>

export interface RuntimeFailureCopy {
  description: string
  reloadLabel: string
  title: string
}

function translatedOrFallback(
  key: TranslationKey,
  fallback: string,
): string {
  try {
    const translated = rt(key)
    return translated === key ? fallback : translated
  } catch {
    return fallback
  }
}

export function runtimeFailureCopy(): RuntimeFailureCopy {
  return {
    description: translatedOrFallback(
      'error.interfaceLoadFailed',
      STARTUP_FATAL_MESSAGE,
    ),
    reloadLabel: translatedOrFallback('button.reload', STARTUP_FATAL_RELOAD),
    title: translatedOrFallback('ui.loadFailed', STARTUP_FATAL_TITLE),
  }
}

function reportStartupFailure(
  logger: StartupFailureLogger,
  message: string,
): void {
  try {
    logger.error(message)
  } catch {
    // Fatal recovery must not depend on a working diagnostic logger.
  }
}

export function reloadRuntimePage(
  reloadPage: () => void = () => window.location.reload(),
  logger: StartupFailureLogger = console,
): boolean {
  try {
    reloadPage()
    return true
  } catch {
    reportStartupFailure(
      logger,
      'ZeroChat startup recovery reload failed.',
    )
    return false
  }
}

export function reportStartupRenderFailure(
  error: unknown,
  {
    doc = document,
    logger = console,
    reloadPage = () => window.location.reload(),
  }: {
    doc?: Document
    logger?: StartupFailureLogger
    reloadPage?: () => void
  } = {},
): void {
  void error
  reportStartupFailure(logger, 'ZeroChat startup failed.')

  try {
    const host = doc.getElementById('root') ?? doc.body
    if (!host) {
      return
    }

    host.textContent = ''

    const main = doc.createElement('main')
    main.className = 'initial-state startup-failure-state'
    main.setAttribute('role', 'alert')
    main.setAttribute('aria-live', 'assertive')

    const copy = runtimeFailureCopy()
    const title = doc.createElement('h1')
    title.textContent = copy.title

    const message = doc.createElement('p')
    message.textContent = copy.description

    const reloadButton = doc.createElement('button')
    reloadButton.type = 'button'
    reloadButton.className = 'zc-btn primary'
    reloadButton.textContent = copy.reloadLabel
    reloadButton.addEventListener('click', () => {
      reloadRuntimePage(reloadPage, logger)
    })

    main.append(title, message, reloadButton)
    host.append(main)
    reloadButton.focus()
  } catch (fallbackError) {
    void fallbackError
    reportStartupFailure(
      logger,
      'ZeroChat startup fallback failed.',
    )
  }
}
