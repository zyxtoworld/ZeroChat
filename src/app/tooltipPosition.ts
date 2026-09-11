export type TooltipPosition = {
  left: number
  ready: boolean
  top: number
}

export interface TooltipRect {
  left: number
  top: number
  bottom: number
  width: number
  height: number
}

export interface TooltipMeasurement {
  targetRect: TooltipRect
  tooltipRect: TooltipRect
  viewportWidth: number
  viewportHeight: number
}

const VIEWPORT_MARGIN = 8
const TARGET_GAP = 8

export function tooltipPositionFromDom(
  read: () => TooltipMeasurement,
): TooltipPosition | null {
  try {
    const { targetRect, tooltipRect, viewportWidth, viewportHeight } = read()
    const values = [
      targetRect.left,
      targetRect.top,
      targetRect.bottom,
      targetRect.width,
      targetRect.height,
      tooltipRect.width,
      tooltipRect.height,
      viewportWidth,
      viewportHeight,
    ]
    if (values.some((value) => !Number.isFinite(value))) return null

    const maxLeft = Math.max(
      VIEWPORT_MARGIN,
      viewportWidth - tooltipRect.width - VIEWPORT_MARGIN,
    )
    const left = Math.min(
      Math.max(
        targetRect.left + (targetRect.width - tooltipRect.width) / 2,
        VIEWPORT_MARGIN,
      ),
      maxLeft,
    )
    const below = targetRect.bottom + TARGET_GAP
    const top =
      below + tooltipRect.height <= viewportHeight - VIEWPORT_MARGIN
        ? below
        : Math.max(
            VIEWPORT_MARGIN,
            targetRect.top - tooltipRect.height - TARGET_GAP,
          )

    return { left, ready: true, top }
  } catch {
    return null
  }
}
