import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { installAppTooltipListeners } from '../appTooltipSubscriptions'
import { tooltipPositionFromDom, type TooltipPosition } from '../tooltipPosition'

type ActiveTooltip = { label: string; target: HTMLElement }

function targetFrom(value: EventTarget | null): HTMLElement | null {
  if (!(value instanceof Element)) return null
  const target = value.closest<HTMLElement>('[data-tooltip]')
  return target?.dataset.tooltip?.trim() ? target : null
}

function currentTarget(active: ActiveTooltip): HTMLElement | null {
  if (active.target.isConnected && active.target.dataset.tooltip?.trim() === active.label) return active.target
  return [...document.querySelectorAll<HTMLElement>('[data-tooltip]')].find(
    (target) => target.dataset.tooltip?.trim() === active.label,
  ) ?? null
}

export function AppTooltipRuntime() {
  const [active, setActive] = useState<ActiveTooltip | null>(null)
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, ready: false, top: 0 })
  const activeRef = useRef<ActiveTooltip | null>(null)
  const hoveredLabel = useRef<string | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const clear = () => { activeRef.current = null; setActive(null) }
    const show = (target: HTMLElement) => {
      const label = target.dataset.tooltip?.trim()
      if (!label) return clear()
      setPosition((value) => ({ ...value, ready: false }))
      const next = { label, target }
      activeRef.current = next
      setActive(next)
    }
    const reposition = () => setActive((value) => {
      const owner = value ?? activeRef.current
      if (!owner) return null
      const target = currentTarget(owner)
      if (!target) { clear(); return null }
      if (target === owner.target) return owner
      const next = { ...owner, target }
      activeRef.current = next
      return next
    })
    const onPointerOver: EventListener = (event) => {
      const pointer = event as PointerEvent
      const target = targetFrom(pointer.target)
      if (!target || (pointer.relatedTarget instanceof Node && target.contains(pointer.relatedTarget))) return
      hoveredLabel.current = target.dataset.tooltip?.trim() ?? null
      show(target)
    }
    const onPointerOut: EventListener = (event) => {
      const pointer = event as PointerEvent
      const target = targetFrom(pointer.target)
      if (!target || (pointer.relatedTarget instanceof Node && target.contains(pointer.relatedTarget))) return
      if (document.activeElement === target) return show(target)
      if (activeRef.current?.label === target.dataset.tooltip?.trim()) clear()
    }
    const onFocusIn: EventListener = (event) => {
      const target = targetFrom((event as FocusEvent).target)
      if (target) show(target)
    }
    const onFocusOut: EventListener = (event) => {
      const focus = event as FocusEvent
      const target = targetFrom(focus.target)
      if (!target || (focus.relatedTarget instanceof Node && target.contains(focus.relatedTarget))) return
      if (hoveredLabel.current === target.dataset.tooltip?.trim()) return
      if (activeRef.current?.label === target.dataset.tooltip?.trim()) clear()
    }
    const cleanup = installAppTooltipListeners({
      documentTarget: document,
      windowTarget: window,
      onPointerOver,
      onPointerOut,
      onFocusIn,
      onFocusOut,
      onKeyDown: (event) => { if ((event as KeyboardEvent).key === 'Escape') clear() },
      reposition,
    })
    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(() => { if (activeRef.current) window.setTimeout(reposition, 16) })
      : null
    observer?.observe(document.body, { attributes: true, attributeFilter: ['data-tooltip'], childList: true, subtree: true })
    return () => { observer?.disconnect(); clear(); cleanup() }
  }, [])

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    if (!active || !tooltip) return
    const target = currentTarget(active) ?? active.target
    const next = tooltipPositionFromDom(() => ({
      targetRect: target.getBoundingClientRect(),
      tooltipRect: tooltip.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }))
    if (!next) return
    if (target !== active.target && target.isConnected) {
      const rebound = { ...active, target }
      activeRef.current = rebound
      setActive((value) => value?.label === active.label ? rebound : value)
    }
    setPosition(next)
  }, [active])

  if (!active) return null
  return (
    <div ref={tooltipRef} className="zc-app-tooltip" role="tooltip" style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}>
      {active.label}
    </div>
  )
}
