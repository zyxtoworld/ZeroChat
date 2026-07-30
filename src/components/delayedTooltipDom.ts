export const APP_TOOLTIP_ID = 'zerochat-app-tooltip'
export const TOOLTIP_VIEWPORT_MARGIN = 12

const TOOLTIP_DESCRIPTION_ATTRIBUTE = 'aria-describedby'
const TOOLTIP_MAX_WIDTH_PX = 260
const TOOLTIP_TOP_PLACEMENT_MIN_Y = 96

export interface TooltipPosition {
  left: number
  top: number
  placement: 'top' | 'bottom'
}

export interface TooltipBinding {
  trigger: HTMLElement
  previousDescribedBy: string | null
}

export function readTooltipTriggerText(
  trigger: Pick<HTMLElement, 'getAttribute'>,
): string {
  try {
    return (
      trigger.getAttribute('data-tooltip') ||
      trigger.getAttribute('aria-label') ||
      ''
    ).trim()
  } catch {
    return ''
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return (min + max) / 2
  }

  return Math.min(Math.max(value, min), max)
}

function tooltipCenterXForRect(rect: DOMRectReadOnly): number {
  const availableTooltipWidth = Math.min(
    TOOLTIP_MAX_WIDTH_PX,
    Math.max(0, window.innerWidth - TOOLTIP_VIEWPORT_MARGIN * 2),
  )
  const centerInset = availableTooltipWidth / 2 + TOOLTIP_VIEWPORT_MARGIN

  return clamp(
    rect.left + rect.width / 2,
    centerInset,
    window.innerWidth - centerInset,
  )
}

function tooltipPositionForRect(rect: DOMRectReadOnly): TooltipPosition {
  const placement =
    rect.top >= TOOLTIP_TOP_PLACEMENT_MIN_Y ? 'top' : 'bottom'
  const top =
    placement === 'top'
      ? rect.top - TOOLTIP_VIEWPORT_MARGIN
      : rect.bottom + TOOLTIP_VIEWPORT_MARGIN

  return {
    left: tooltipCenterXForRect(rect),
    top,
    placement,
  }
}

export function tooltipPositionForTrigger(
  trigger: Pick<HTMLElement, 'getBoundingClientRect'>,
): TooltipPosition | null {
  try {
    return tooltipPositionForRect(trigger.getBoundingClientRect())
  } catch {
    return null
  }
}

export function restoreTooltipTriggerDescription({
  trigger,
  previousDescribedBy,
}: TooltipBinding): void {
  try {
    if (previousDescribedBy) {
      trigger.setAttribute(TOOLTIP_DESCRIPTION_ATTRIBUTE, previousDescribedBy)
    } else {
      trigger.removeAttribute(TOOLTIP_DESCRIPTION_ATTRIBUTE)
    }
  } catch {
    // Tooltip aria restoration is cosmetic once the trigger is gone.
  }
}

export function describeTooltipTrigger(
  trigger: HTMLElement,
): TooltipBinding | null {
  try {
    const previousDescribedBy = trigger.getAttribute(
      TOOLTIP_DESCRIPTION_ATTRIBUTE,
    )
    const describedBy = previousDescribedBy
      ? `${previousDescribedBy} ${APP_TOOLTIP_ID}`
      : APP_TOOLTIP_ID
    trigger.setAttribute(TOOLTIP_DESCRIPTION_ATTRIBUTE, describedBy)

    return {
      trigger,
      previousDescribedBy,
    }
  } catch {
    return null
  }
}
