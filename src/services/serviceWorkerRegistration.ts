import { isWindowsWebViewOrigin } from '../platform/windowsBridge'

export const SERVICE_WORKER_REGISTRATION_WARNING =
  'ZeroChat service worker registration failed.'

type ServiceWorkerRegistrationLogger = Pick<Console, 'warn'>

interface LoadEventTarget {
  addEventListener(type: 'load', listener: () => void): void
}

interface RuntimeServiceWorkerContainer {
  register(scriptUrl: string): Promise<unknown>
}

interface RuntimeNavigator {
  serviceWorker?: RuntimeServiceWorkerContainer
}

interface RegisterServiceWorkerOptions {
  baseUrl?: string
  logger?: ServiceWorkerRegistrationLogger
  nav?: RuntimeNavigator
  origin?: string
}

interface InstallServiceWorkerRegistrationOptions
  extends RegisterServiceWorkerOptions {
  isProd?: boolean
  win?: LoadEventTarget
}

function defaultNavigator(): RuntimeNavigator | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as RuntimeNavigator)
}

function defaultWindow(): LoadEventTarget | undefined {
  return typeof window === 'undefined' ? undefined : window
}

function defaultOrigin(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.origin
}

function serviceWorkerFailureKind(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown'
  }

  return /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(error.name)
    ? error.name
    : 'unknown'
}

function reportServiceWorkerRegistrationFailure(
  error: unknown,
  logger: ServiceWorkerRegistrationLogger,
): void {
  try {
    logger.warn(
      SERVICE_WORKER_REGISTRATION_WARNING,
      serviceWorkerFailureKind(error),
    )
  } catch {
    // Startup must not fail because a diagnostic logger is unavailable.
  }
}

export function registerServiceWorker({
  baseUrl = import.meta.env.BASE_URL,
  logger = console,
  nav = defaultNavigator(),
  origin = defaultOrigin(),
}: RegisterServiceWorkerOptions = {}): void {
  if (isWindowsWebViewOrigin(origin)) {
    return
  }

  const serviceWorker = nav?.serviceWorker

  if (!serviceWorker) {
    return
  }

  try {
    void serviceWorker
      .register(`${baseUrl}sw.js`)
      .catch((error: unknown) =>
        reportServiceWorkerRegistrationFailure(error, logger),
      )
  } catch (error) {
    reportServiceWorkerRegistrationFailure(error, logger)
  }
}

export function installServiceWorkerRegistration({
  baseUrl = import.meta.env.BASE_URL,
  isProd = import.meta.env.PROD,
  logger = console,
  nav = defaultNavigator(),
  origin = defaultOrigin(),
  win = defaultWindow(),
}: InstallServiceWorkerRegistrationOptions = {}): boolean {
  if (
    !isProd ||
    !win ||
    !nav?.serviceWorker ||
    isWindowsWebViewOrigin(origin)
  ) {
    return false
  }

  try {
    win.addEventListener('load', () => {
      registerServiceWorker({ baseUrl, logger, nav, origin })
    })
  } catch (error) {
    reportServiceWorkerRegistrationFailure(error, logger)
    return false
  }

  return true
}
