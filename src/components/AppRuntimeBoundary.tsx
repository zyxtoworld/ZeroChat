import { RefreshCw } from 'lucide-react'
import {
  Component,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react'

import {
  runtimeFailureCopy,
} from '../services/startupFatalError'

type RuntimeFailureLogger = Pick<Console, 'error'>

interface AppRuntimeBoundaryProps {
  children: ReactNode
  logger?: RuntimeFailureLogger
  onReload?: () => void
}

interface AppRuntimeBoundaryState {
  failed: boolean
}

interface RuntimeFailureStateProps {
  onReload?: () => void
}

function focusRuntimeFailureReload(element: HTMLButtonElement | null): void {
  element?.focus()
}

function reloadWindow(): void {
  window.location.reload()
}

export function RuntimeFailureState({
  onReload = reloadWindow,
}: RuntimeFailureStateProps): ReactElement {
  const { description, reloadLabel, title } = runtimeFailureCopy()

  return (
    <main
      className="initial-state startup-failure-state runtime-failure-state"
      role="alert"
      aria-live="assertive"
      aria-labelledby="runtime-failure-title"
      aria-describedby="runtime-failure-description"
    >
      <h1 id="runtime-failure-title">{title}</h1>
      <p id="runtime-failure-description">{description}</p>
      <button
        type="button"
        ref={focusRuntimeFailureReload}
        onClick={onReload}
      >
        <RefreshCw aria-hidden="true" size={18} />
        <span>{reloadLabel}</span>
      </button>
    </main>
  )
}

export function RuntimeFailureSmokeProbe(): never {
  throw new Error('Intentional local runtime failure smoke probe.')
}

export class AppRuntimeBoundary extends Component<
  AppRuntimeBoundaryProps,
  AppRuntimeBoundaryState
> {
  state: AppRuntimeBoundaryState = { failed: false }

  static getDerivedStateFromError(): AppRuntimeBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      const logger = this.props.logger ?? console
      logger.error(
        'ZeroChat runtime render failed.',
        error,
        info,
      )
    } catch {
      // The recovery UI must survive a broken host logger.
    }
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <RuntimeFailureState onReload={this.props.onReload} />
    }

    return this.props.children
  }
}
