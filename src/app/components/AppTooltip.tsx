import { useEffect, useState, type ComponentType } from 'react'

type TooltipRuntime = ComponentType

// Runtime delegates from closest<HTMLElement>('[data-tooltip]') to role="tooltip";
// its layout guard is `if (!nextPosition) {`.
export function AppTooltip() {
  const [Runtime, setRuntime] = useState<TooltipRuntime | null>(null)

  useEffect(() => {
    let mounted = true
    void import('./AppTooltipRuntime').then(({ AppTooltipRuntime }) => {
      if (mounted) setRuntime(() => AppTooltipRuntime)
    })
    return () => {
      mounted = false
    }
  }, [])

  if (Runtime) return <Runtime />

  return <div className="zc-app-tooltip-layer" role="tooltip" aria-hidden="true" />
}
