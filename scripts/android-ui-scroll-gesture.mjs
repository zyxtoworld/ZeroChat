function androidWindowDimensions(windowSize) {
  const left = windowSize?.left ?? 0
  const top = windowSize?.top ?? 0
  const width = windowSize?.width
  const height = windowSize?.height

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new TypeError('Android window size must contain positive finite dimensions.')
  }

  return { height, left, top, width }
}

function boundedAndroidScrollDistance(height) {
  return Math.min(
    Math.max(Math.round(height * 0.14), 96),
    Math.round(height * 0.4),
  )
}

export function androidGestureViewportFromBounds(bounds) {
  const match = String(bounds ?? '').match(
    /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/u,
  )

  if (!match) {
    throw new TypeError('Android hierarchy bounds must contain a positive viewport.')
  }

  const [, left, top, right, bottom] = match.map(Number)
  const width = right - left
  const height = bottom - top

  if (width <= 0 || height <= 0) {
    throw new TypeError('Android hierarchy bounds must contain a positive viewport.')
  }

  return { height, left, top, width }
}

export function androidWindowSizeFromBounds(bounds) {
  const { height, width } = androidGestureViewportFromBounds(bounds)

  return { height, width }
}

export function androidTapCenterIsSafe(center, viewport) {
  const { height, left, top, width } = androidWindowDimensions(viewport)
  const x = center?.x
  const y = center?.y

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false
  }

  return (
    x > left + 24 &&
    x < left + width - 24 &&
    y > top + 140 &&
    y < top + height - 240
  )
}

export function androidVerticalRevealAction(bounds, viewport) {
  const window = androidWindowDimensions(viewport)
  const element = androidGestureViewportFromBounds(bounds)
  const safeTop = window.top + 140
  const safeBottom = window.top + window.height - 240
  const elementBottom = element.top + element.height

  if (safeBottom <= safeTop || element.height > safeBottom - safeTop) {
    throw new RangeError('Android element cannot fit inside the safe vertical viewport.')
  }

  if (elementBottom > safeBottom) return 'forward'
  if (element.top < safeTop) return 'reverse'
  return 'resolved'
}

export function boundedAndroidForwardScrollGesture(windowSize) {
  const { width, height, left, top } = androidWindowDimensions(windowSize)
  const gutterX = left + Math.round(width * 0.92)
  const startY = top + Math.round(height * 0.7)

  return {
    durationMs: 250,
    endX: gutterX,
    endY: startY - boundedAndroidScrollDistance(height),
    startX: gutterX,
    startY,
  }
}

export function boundedAndroidReverseScrollGesture(windowSize, options = {}) {
  const { width, height, left, top } = androidWindowDimensions(windowSize)
  const gutterX = options.side === 'left'
    ? left + Math.max(24, Math.round(width * 0.08))
    : left + Math.round(width * 0.92)
  const startY = top + Math.round(height * 0.56)

  return {
    durationMs: 250,
    endX: gutterX,
    endY: startY + boundedAndroidScrollDistance(height),
    startX: gutterX,
    startY,
  }
}
