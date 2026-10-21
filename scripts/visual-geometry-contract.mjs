export function renderedElementClipsContent(
  element,
  resolveStyle = (target) => globalThis.getComputedStyle(target),
) {
  const style = resolveStyle(element)
  const clipsX =
    (style.overflowX === 'hidden' || style.overflowX === 'clip') &&
    element.scrollWidth > element.clientWidth + 1
  const clipsY =
    (style.overflowY === 'hidden' || style.overflowY === 'clip') &&
    element.scrollHeight > element.clientHeight + 1
  return clipsX || clipsY
}

export function renderedActionTargetMeetsMinimum(element, minimum = 28) {
  const rect = element.getBoundingClientRect()
  return rect.width >= minimum && rect.height >= minimum
}

export function renderedTouchTargetMeetsMinimum(element, minimum = 44, epsilon = 0.05) {
  const rect = element.getBoundingClientRect()
  return rect.width + epsilon >= minimum && rect.height + epsilon >= minimum
}

export function renderedVisibleRect(
  element,
  resolveStyle = (target) => globalThis.getComputedStyle(target),
  viewport = {
    bottom: globalThis.innerHeight,
    left: 0,
    right: globalThis.innerWidth,
    top: 0,
  },
) {
  const base = element.getBoundingClientRect()
  let left = Math.max(base.left, viewport.left)
  let right = Math.min(base.right, viewport.right)
  let top = Math.max(base.top, viewport.top)
  let bottom = Math.min(base.bottom, viewport.bottom)
  const clippingOverflow = ['auto', 'clip', 'hidden', 'scroll']

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = resolveStyle(parent)
    const parentRect = parent.getBoundingClientRect()
    if (clippingOverflow.includes(style.overflowX)) {
      left = Math.max(left, parentRect.left)
      right = Math.min(right, parentRect.right)
    }
    if (clippingOverflow.includes(style.overflowY)) {
      top = Math.max(top, parentRect.top)
      bottom = Math.min(bottom, parentRect.bottom)
    }
  }

  if (right <= left || bottom <= top) return null
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  }
}

export function renderedSurfaceIsClosed(
  { sidebarCollapsed, sidebarVisibleRect, backdropVisibleRect },
  epsilon = 0.5,
) {
  return (
    sidebarCollapsed === true &&
    (!sidebarVisibleRect || sidebarVisibleRect.width <= epsilon) &&
    !backdropVisibleRect
  )
}

export function renderedControlOverlap(
  left,
  right,
  tolerance = 2,
  resolveRect = (target) => target.getBoundingClientRect(),
) {
  if (left.contains(right) || right.contains(left)) return null

  const leftRect = resolveRect(left)
  const rightRect = resolveRect(right)
  if (!leftRect || !rightRect) return null
  const width =
    Math.min(leftRect.right, rightRect.right) -
    Math.max(leftRect.left, rightRect.left)
  const height =
    Math.min(leftRect.bottom, rightRect.bottom) -
    Math.max(leftRect.top, rightRect.top)
  return width > tolerance && height > tolerance ? { height, width } : null
}

export function renderedPlaceholderFits(
  element,
  measureText = (text, style) => {
    const canvas = globalThis.document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return Number.POSITIVE_INFINITY
    context.font =
      style.font ||
      [
        style.fontStyle,
        style.fontVariant,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
      ]
        .filter(Boolean)
        .join(' ')
    return context.measureText(text).width
  },
  resolveStyle = (target) => globalThis.getComputedStyle(target),
) {
  const placeholder = element.getAttribute('placeholder') ?? ''
  if (!placeholder.trim() || element.value) return true

  const style = resolveStyle(element)
  const paddingLeft = Number.parseFloat(style.paddingLeft || '0') || 0
  const paddingRight = Number.parseFloat(style.paddingRight || '0') || 0
  const availableWidth = element.clientWidth - paddingLeft - paddingRight
  return measureText(placeholder, style) <= availableWidth + 1
}

export function renderedButtonContentIsCentered(
  element,
  resolveContentRects = (target) => {
    const document = target.ownerDocument ?? globalThis.document
    const rects = []
    const centeredContent =
      typeof target.querySelector === 'function'
        ? target.querySelector('[data-centered-content="true"]')
        : null
    if (centeredContent) {
      rects.push(centeredContent.getBoundingClientRect())
      return rects
    }
    const visit = (node) => {
      if (node.nodeType === 3) {
        if (!node.textContent?.trim()) return
        const range = document.createRange()
        range.selectNodeContents(node)
        rects.push(...range.getClientRects())
        return
      }
      if (node.nodeType !== 1) return

      const tagName = node.tagName.toLowerCase()
      if (['canvas', 'img', 'svg', 'video'].includes(tagName)) {
        rects.push(node.getBoundingClientRect())
        return
      }
      for (const child of node.childNodes) visit(child)
    }

    for (const child of target.childNodes) visit(child)
    return rects
  },
  tolerance = 2,
) {
  const buttonRect = element.getBoundingClientRect()
  const contentRects = [...resolveContentRects(element)].filter(
    (rect) => rect.width > 0 && rect.height > 0,
  )
  if (contentRects.length === 0) return true

  const contentLeft = Math.min(...contentRects.map((rect) => rect.left))
  const contentRight = Math.max(...contentRects.map((rect) => rect.right))
  const contentTop = Math.min(...contentRects.map((rect) => rect.top))
  const contentBottom = Math.max(...contentRects.map((rect) => rect.bottom))
  const horizontalOffset = Math.abs(
    (contentLeft + contentRight - buttonRect.left - buttonRect.right) / 2,
  )
  const verticalOffset = Math.abs(
    (contentTop + contentBottom - buttonRect.top - buttonRect.bottom) / 2,
  )
  return horizontalOffset <= tolerance && verticalOffset <= tolerance
}
