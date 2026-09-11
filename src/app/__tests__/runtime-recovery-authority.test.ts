import type { ErrorInfo } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import bootstrapSource from '../bootstrap.tsx?raw'
import appSource from '../App.tsx?raw'
import runtimeBoundarySource from '../components/RuntimeBoundary.tsx?raw'
import { RuntimeBoundary } from '../components/RuntimeBoundary'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runtime recovery authority', () => {
  it('uses one pre-React renderer after startup failures', () => {
    expect(bootstrapSource).toContain('reportStartupRenderFailure(error)')
    expect(bootstrapSource).not.toContain('showStartupLoadFailure')
  })

  it('shares fatal recovery copy with the React boundary', () => {
    expect(runtimeBoundarySource).toContain(
      "import { runtimeFailureCopy } from '../../services/startupFatalError'",
    )
    expect(runtimeBoundarySource).toContain(
      'const { description, reloadLabel, title } = runtimeFailureCopy()',
    )
    expect(runtimeBoundarySource).toContain(
      'reloadRuntimePage(() => window.location.reload())',
    )
    expect(runtimeBoundarySource).not.toContain('createAppTranslator')
  })

  it('routes the initialized App error page through the contained reload boundary', () => {
    expect(appSource).toContain(
      "import { reloadRuntimePage } from '../services/startupFatalError'",
    )
    expect(appSource).toContain(
      'onClick={() => reloadRuntimePage(() => window.location.reload())}',
    )
    expect(appSource).not.toContain(
      'onClick={() => window.location.reload()}',
    )
  })

  it('keeps render diagnostics free of raw child errors', () => {
    const sentinel = 'C:\\private\\render.log sk-secret-1234567890'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boundary = new RuntimeBoundary({ children: null })
    const info = { componentStack: sentinel } as ErrorInfo

    boundary.componentDidCatch(new Error(sentinel), info)

    expect(consoleError).toHaveBeenCalledWith('[app] render failed')
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(sentinel)
  })
})
