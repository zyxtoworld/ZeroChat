import { isWindowsWebViewOrigin } from '../platform/windowsBridge'

export const SERVICE_WORKER_REGISTRATION_WARNING =
  'ZeroChat service worker registration failed.'

type ServiceWorkerRegistrationLogger = Pick<Console, 'warn'>

interface LoadEventTarget {
  addEventListener(
    type: 'load',
    listener: () => void,
    options?: { once?: boolean },
  ): void
}

interface RuntimeDocument {
  readyState: 'complete' | 'interactive' | 'loading'
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
  doc?: RuntimeDocument
  isProd?: boolean
  win?: LoadEventTarget
}

interface ServiceWorkerInstallationState {
  active: boolean
  container: RuntimeServiceWorkerContainer
  phase: 'waiting' | 'registering' | 'registered'
}

const serviceWorkerInstallationStates = new WeakMap<
  LoadEventTarget,
  Map<string, ServiceWorkerInstallationState>
>()

function defaultNavigator(): RuntimeNavigator | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as RuntimeNavigator)
}

function defaultWindow(): LoadEventTarget | undefined {
  return typeof window === 'undefined' ? undefined : window
}

function defaultDocument(): RuntimeDocument | undefined {
  return typeof document === 'undefined' ? undefined : document
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

function normalizeServiceWorkerBaseUrl(baseUrl: string): string {
  if (!baseUrl || baseUrl.endsWith('/')) {
    return baseUrl
  }

  return `${baseUrl}/`
}

function attemptServiceWorkerRegistration({
  baseUrl,
  logger,
  nav,
}: {
  logger: ServiceWorkerRegistrationLogger
  nav: RuntimeNavigator
  baseUrl: string
}): Promise<boolean> {
  const serviceWorker = nav.serviceWorker
  if (!serviceWorker) {
    return Promise.resolve(false)
  }

  return Promise.resolve(serviceWorker.register(`${baseUrl}sw.js`)).then(
    () => true,
    (error: unknown) => {
      reportServiceWorkerRegistrationFailure(error, logger)
      return false
    },
  )
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
    const normalizedBaseUrl = normalizeServiceWorkerBaseUrl(baseUrl)
    void attemptServiceWorkerRegistration({
      baseUrl: normalizedBaseUrl,
      logger,
      nav,
    })
  } catch (error) {
    reportServiceWorkerRegistrationFailure(error, logger)
  }
}

export function installServiceWorkerRegistration({
  baseUrl = import.meta.env.BASE_URL,
  doc = defaultDocument(),
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

  const serviceWorker = nav.serviceWorker
  const normalizedBaseUrl = normalizeServiceWorkerBaseUrl(baseUrl)
  const scriptUrl = `${normalizedBaseUrl}sw.js`
  let installations = serviceWorkerInstallationStates.get(win)
  if (!installations) {
    installations = new Map()
    serviceWorkerInstallationStates.set(win, installations)
  }

  const previous = installations.get(scriptUrl)
  if (previous?.container === serviceWorker && previous.active) {
    return true
  }
  if (previous) {
    previous.active = false
    installations.delete(scriptUrl)
  }

  const installation: ServiceWorkerInstallationState = {
    active: true,
    container: serviceWorker,
    phase: 'waiting',
  }
  installations.set(scriptUrl, installation)

  const removeInstallation = (): void => {
    installation.active = false
    if (installations?.get(scriptUrl) === installation) {
      installations.delete(scriptUrl)
    }
  }

  const documentIsComplete = (): boolean => doc?.readyState === 'complete'

  const startRegistration = (): void => {
    if (!installation.active || installation.phase !== 'waiting') {
      return
    }

    installation.phase = 'registering'
    try {
      void attemptServiceWorkerRegistration({
        baseUrl: normalizedBaseUrl,
        logger,
        nav,
      }).then((succeeded) => {
        if (!installation.active || installations?.get(scriptUrl) !== installation) {
          return
        }

        if (succeeded) {
          installation.phase = 'registered'
          return
        }

        removeInstallation()
      })
    } catch (error) {
      removeInstallation()
      reportServiceWorkerRegistrationFailure(error, logger)
    }
  }

  if (documentIsComplete()) {
    startRegistration()
    return true
  }

  try {
    win.addEventListener('load', () => {
      startRegistration()
    }, { once: true })
  } catch (error) {
    removeInstallation()
    reportServiceWorkerRegistrationFailure(error, logger)
    return false
  }

  if (documentIsComplete()) {
    startRegistration()
  }

  return true
}
