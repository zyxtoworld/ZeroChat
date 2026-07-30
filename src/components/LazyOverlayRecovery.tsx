import {
  AlertTriangle,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react'
import type { ReactElement } from 'react'

interface LazyOverlayStateProps {
  closeLabel?: string
  description: string
  mode: 'failed' | 'loading'
  onClose?: () => void
  onReload?: () => void
  reloadLabel?: string
  title: string
}

function focusLazyOverlayRecovery(element: HTMLButtonElement | null): void {
  element?.focus()
}

export function LazyOverlayState({
  closeLabel,
  description,
  mode,
  onClose,
  onReload,
  reloadLabel,
  title,
}: LazyOverlayStateProps): ReactElement {
  const failed = mode === 'failed'
  const titleId = `lazy-overlay-${mode}-title`
  const descriptionId = `lazy-overlay-${mode}-description`

  return (
    <div
      className="modal-backdrop compact-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <section
        className="modal lazy-overlay-modal"
        tabIndex={-1}
        aria-busy={!failed}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p
              className={`lazy-overlay-message ${failed ? 'is-failed' : ''}`}
              id={descriptionId}
              role={failed ? 'alert' : 'status'}
              aria-live={failed ? 'assertive' : 'polite'}
            >
              {failed ? (
                <AlertTriangle aria-hidden="true" size={20} />
              ) : (
                <LoaderCircle aria-hidden="true" className="spin" size={20} />
              )}
              <span>{description}</span>
            </p>
          </div>
          {onClose && closeLabel ? (
            <button
              type="button"
              className="icon-button"
              aria-label={closeLabel}
              data-tooltip={closeLabel}
              onClick={onClose}
            >
              <X aria-hidden="true" size={18} />
            </button>
          ) : null}
        </div>

        {failed && onReload && reloadLabel ? (
          <div className="modal-actions lazy-overlay-actions">
            <button
              type="button"
              className="primary-button"
              ref={focusLazyOverlayRecovery}
              onClick={onReload}
            >
              <RefreshCw aria-hidden="true" size={17} />
              <span>{reloadLabel}</span>
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
