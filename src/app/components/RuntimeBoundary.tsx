import { Component, type ErrorInfo, type ReactNode } from 'react'

import { reloadRuntimePage } from '../../services/startupFatalError'
import { runtimeFailureCopy } from '../../services/startupFatalError'

interface BoundaryState {
  failed: boolean
}

/** Minimal error boundary for the app shell: full-screen reload fallback. */
export class RuntimeBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void error
    void info
    try {
      console.error('[app] render failed')
    } catch {
      // recovery UI must survive a broken logger
    }
  }

  render(): ReactNode {
    if (this.state.failed) {
      const { description, reloadLabel, title } = runtimeFailureCopy()
      return (
        <main className="zc-boot runtime-failure-state" role="alert" aria-live="assertive">
          <div className="zc-boot-card">
            <h1>{title}</h1>
            <p>{description}</p>
            <button
              type="button"
              className="zc-btn primary"
              autoFocus
              onClick={() => reloadRuntimePage(() => window.location.reload())}
            >
              {reloadLabel}
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}
