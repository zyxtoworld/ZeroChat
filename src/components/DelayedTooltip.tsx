import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'

import {
  APP_TOOLTIP_ID,
  describeTooltipTrigger,
  readTooltipTriggerText,
  restoreTooltipTriggerDescription,
  tooltipPositionForTrigger,
  type TooltipBinding,
  type TooltipPosition,
} from './delayedTooltipDom'

export const TOOLTIP_DELAY_MS = 500

interface TooltipState extends TooltipPosition {
  text: string
}

const TOOLTIP_TRIGGER_SELECTOR =
  '[data-tooltip],[draggable],.icon-button,.message-actions button,.secret-toggle,[class$=move],[class$=delete],.send-button'

function tooltipTriggerFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null
  }

  return target.closest<HTMLElement>(TOOLTIP_TRIGGER_SELECTOR)
}

export function DelayedTooltip(): ReactElement | null {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  useEffect(() => {
    let activeTrigger: HTMLElement | null = null
    let activeBinding: TooltipBinding | null = null
    let showTimer = 0

    function restoreTriggerDescription(): void {
      if (activeBinding) {
        restoreTooltipTriggerDescription(activeBinding)
      }
      activeBinding = null
    }

    function describeTriggerWithTooltip(trigger: HTMLElement): boolean {
      restoreTriggerDescription()

      const binding = describeTooltipTrigger(trigger)
      if (!binding) {
        return false
      }

      activeBinding = binding
      return true
    }

    function clearTooltip(): void {
      window.clearTimeout(showTimer)
      showTimer = 0
      restoreTriggerDescription()
      activeTrigger = null
      setTooltip(null)
    }

    function scheduleTooltip(trigger: HTMLElement | null): void {
      window.clearTimeout(showTimer)
      restoreTriggerDescription()
      setTooltip(null)

      if (!trigger) {
        activeTrigger = null
        return
      }

      const text = readTooltipTriggerText(trigger)

      if (!text) {
        activeTrigger = null
        return
      }

      activeTrigger = trigger
      showTimer = window.setTimeout(() => {
        if (!activeTrigger || !document.contains(activeTrigger)) {
          return
        }

        const position = tooltipPositionForTrigger(activeTrigger)
        if (!position || !describeTriggerWithTooltip(activeTrigger)) {
          return
        }

        setTooltip({
          text,
          ...position,
        })
      }, TOOLTIP_DELAY_MS)
    }

    function handleHoverOver(event: MouseEvent | PointerEvent): void {
      const trigger = tooltipTriggerFrom(event.target)

      if (trigger === activeTrigger) {
        return
      }

      scheduleTooltip(trigger)
    }

    function handleHoverOut(event: MouseEvent | PointerEvent): void {
      if (
        activeTrigger &&
        event.relatedTarget instanceof Node &&
        activeTrigger.contains(event.relatedTarget)
      ) {
        return
      }

      clearTooltip()
    }

    function handleFocusIn(event: FocusEvent): void {
      scheduleTooltip(tooltipTriggerFrom(event.target))
    }

    function handleFocusOut(): void {
      clearTooltip()
    }

    document.addEventListener('pointerover', handleHoverOver)
    document.addEventListener('pointerout', handleHoverOut)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    document.addEventListener('keydown', clearTooltip)
    window.addEventListener('resize', clearTooltip)
    window.addEventListener('scroll', clearTooltip, true)

    return () => {
      clearTooltip()
      document.removeEventListener('pointerover', handleHoverOver)
      document.removeEventListener('pointerout', handleHoverOut)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
      document.removeEventListener('keydown', clearTooltip)
      window.removeEventListener('resize', clearTooltip)
      window.removeEventListener('scroll', clearTooltip, true)
    }
  }, [])

  if (!tooltip) {
    return null
  }

  return (
    <div
      id={APP_TOOLTIP_ID}
      className="app-tooltip"
      role="tooltip"
      data-placement={tooltip.placement}
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.text}
    </div>
  )
}
