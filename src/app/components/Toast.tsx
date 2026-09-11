import { X } from 'lucide-react'

import { appT, useAppStore } from '../store'

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  const data = useAppStore((s) => s.data)

  if (toasts.length === 0) return null

  return (
    <div className="zc-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`zc-toast ${toast.tone}`}>
          <span>{toast.message}</span>
          <button
            type="button"
            aria-label={appT(data, 'common.dismiss')}
            onClick={() => dismiss(toast.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
