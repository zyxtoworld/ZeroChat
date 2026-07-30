import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {
  AppRuntimeBoundary,
  RuntimeFailureSmokeProbe,
} from './components/AppRuntimeBoundary.tsx'
import {
  loadLocale,
  localeDirection,
  resolveLocale,
  setRuntimeLocale,
} from './i18n'
import { installServiceWorkerRegistration } from './services/serviceWorkerRegistration'
import { reportStartupRenderFailure } from './services/startupFatalError'

const RUNTIME_FAILURE_SMOKE_PARAM = 'zerochat-runtime-failure-smoke'
const STARTUP_FAILURE_SMOKE_PARAM = 'zerochat-startup-failure-smoke'
const localRuntimeFailureSmokeHosts = new Set(['127.0.0.1', 'localhost', '::1'])

function hasLocalFailureSmokeParam(param: string): boolean {
  try {
    const url = new URL(window.location.href)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      localRuntimeFailureSmokeHosts.has(url.hostname) &&
      url.searchParams.get(param) === '1'
    )
  } catch {
    return false
  }
}

async function renderApp(): Promise<void> {
  const initialLocale = resolveLocale('system')
  document.documentElement.lang = initialLocale
  document.documentElement.dir = localeDirection(initialLocale)
  setRuntimeLocale(initialLocale)

  try {
    await loadLocale(initialLocale)
  } catch {
    // English/Chinese fallback keeps first render usable if a locale chunk is unavailable.
  }

  if (hasLocalFailureSmokeParam(STARTUP_FAILURE_SMOKE_PARAM)) {
    throw new Error('Intentional local startup failure smoke probe.')
  }

  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Missing #root.')
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppRuntimeBoundary>
        {hasLocalFailureSmokeParam(RUNTIME_FAILURE_SMOKE_PARAM) ? (
          <RuntimeFailureSmokeProbe />
        ) : (
          <App />
        )}
      </AppRuntimeBoundary>
    </StrictMode>,
  )
}

void renderApp().catch(reportStartupRenderFailure)

installServiceWorkerRegistration()
