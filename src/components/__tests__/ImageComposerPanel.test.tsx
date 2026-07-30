import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { ImageComposerPanel } from '../ImageComposerPanel'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useId: () => 'image-source-help',
  }
})

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findByClassName(
  node: unknown,
  className: string,
): { props: Record<string, unknown>; type?: unknown } {
  const found = findByClassNameOptional(node, className)
  if (!found) {
    throw new Error(`Missing node with className=${className}`)
  }

  return found
}

function findByClassNameOptional(
  node: unknown,
  className: string,
): { props: Record<string, unknown>; type?: unknown } | null {
  if (node && typeof node === 'object') {
    const { props, type } = node as {
      props?: Record<string, unknown>
      type?: unknown
    }
    if (props?.className === className) {
      return { props, type }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findByClassNameOptional(child, className)
    if (found) return found
  }

  return null
}

function findAllByClassName(
  node: unknown,
  className: string,
): Array<{ props: Record<string, unknown>; type?: unknown }> {
  const matches: Array<{ props: Record<string, unknown>; type?: unknown }> = []

  if (node && typeof node === 'object') {
    const { props, type } = node as {
      props?: Record<string, unknown>
      type?: unknown
    }
    if (props && props.className === className) {
      matches.push({ props, type })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByClassName(child, className))
  }

  return matches
}

function findByProp(
  node: unknown,
  name: string,
  value: unknown,
): { props: Record<string, unknown>; type?: unknown } {
  if (node && typeof node === 'object') {
    const { props, type } = node as {
      props?: Record<string, unknown>
      type?: unknown
    }
    if (props && props[name] === value) {
      return { props, type }
    }
  }

  for (const child of nodeChildren(node)) {
    try {
      return findByProp(child, name, value)
    } catch {
      // Keep walking sibling branches.
    }
  }

  throw new Error(`Missing node with ${name}=${String(value)}`)
}

interface RenderPanelOptions {
  imageSourceUrl?: string
  imageTaskMode?: 'generate' | 'edit' | 'inpaint'
  onImagePreviewError?: () => void
  onMaskPointerCaptureBoundary?: () => void
}

function renderPanel({
  imageSourceUrl = '',
  imageTaskMode = 'edit',
  onImagePreviewError = vi.fn(),
  onMaskPointerCaptureBoundary = vi.fn(),
}: RenderPanelOptions = {}): ReactElement {
  return ImageComposerPanel({
    imageTaskMode,
    generationActive: false,
    imageSourceFile: null,
    imageSourceUrl,
    imageSourceDragActive: false,
    imageSourceDragRejected: false,
    maskKeyboardCursor: { x: 0.5, y: 0.5 },
    maskBrushSize: 24,
    maskTouched: false,
    maskUndoAvailable: false,
    t,
    maskCanvasRef: { current: null },
    onImageSourceChange: vi.fn(),
    onImageSourceDragEnter: vi.fn(),
    onImageSourceDragOver: vi.fn(),
    onImageSourceDragLeave: vi.fn(),
    onImageSourceDrop: vi.fn(),
    onImageSourcePaste: vi.fn(),
    onClearImageSource: vi.fn(),
    onImagePreviewLoad: vi.fn(),
    onImagePreviewError,
    onMaskPointerDown: vi.fn(),
    onMaskPointerMove: vi.fn(),
    onMaskPointerUp: vi.fn(),
    onMaskPointerCaptureBoundary,
    onMaskKeyDown: vi.fn(),
    onMaskBrushSizeChange: vi.fn(),
    onUndoMask: vi.fn(),
    onClearMask: vi.fn(),
  }) as ReactElement
}

describe('ImageComposerPanel', () => {
  it('keeps the image drop and paste zone focusable with group semantics', () => {
    const tree = renderPanel()
    const panel = findByClassName(tree, 'image-source-panel')

    expect(panel.props.role).toBe('group')
    expect(panel.props['aria-label']).toBe('field.sourceImage')
    expect(panel.props['aria-describedby']).toBeTruthy()
    expect(panel.props.tabIndex).toBe(0)
    expect(typeof panel.props.onDrop).toBe('function')
    expect(typeof panel.props.onPaste).toBe('function')
  })

  it('announces the selected source image as live status text', () => {
    const tree = renderPanel()
    const sourceName = findByClassName(tree, 'image-source-name')

    expect(sourceName.type).toBe('output')
    expect(sourceName.props.role).toBeUndefined()
    expect(sourceName.props['aria-live']).toBeUndefined()
    expect(sourceName.props.dir).toBe('auto')
  })

  it('reports source-image decode failures instead of leaving a blank preview', () => {
    const onImagePreviewError = vi.fn()
    const tree = renderPanel({
      imageSourceUrl: 'blob:invalid-source',
      onImagePreviewError,
    })
    const preview = findByClassName(tree, 'image-source-preview')

    expect(preview.props.onError).toBe(onImagePreviewError)
    ;(preview.props.onError as () => void)()
    expect(onImagePreviewError).toHaveBeenCalledTimes(1)
  })

  it('keeps inpaint mask controls hidden until a source image exists', () => {
    const tree = renderPanel({ imageTaskMode: 'inpaint' })

    expect(findByClassNameOptional(tree, 'mask-controls')).toBeNull()
  })

  it('shows inpaint mask controls once a source image exists', () => {
    const tree = renderPanel({
      imageTaskMode: 'inpaint',
      imageSourceUrl: 'blob:source-image',
    })

    expect(findByClassNameOptional(tree, 'mask-controls')).not.toBeNull()
  })

  it('abandons mask ownership when an uncaptured pointer leaves or capture is lost', () => {
    const onMaskPointerCaptureBoundary = vi.fn()
    const tree = renderPanel({
      imageTaskMode: 'inpaint',
      imageSourceUrl: 'blob:source-image',
      onMaskPointerCaptureBoundary,
    })
    const canvas = findByClassName(tree, 'mask-canvas')

    expect(canvas.props.onPointerOut).toBe(onMaskPointerCaptureBoundary)
    expect(canvas.props.onPointerLeave).toBeUndefined()
    expect(canvas.props.onLostPointerCapture).toBe(
      onMaskPointerCaptureBoundary,
    )
  })

  it('keeps mask action tooltips custom-only on wrappers and buttons', () => {
    const tree = renderPanel({
      imageTaskMode: 'inpaint',
      imageSourceUrl: 'blob:source-image',
    })
    const tooltipTargets = findAllByClassName(
      tree,
      'mask-action-tooltip-target',
    )

    expect(tooltipTargets).toHaveLength(2)
    expect(tooltipTargets.map((target) => target.props.title)).toEqual([
      undefined,
      undefined,
    ])
    expect(tooltipTargets.map((target) => target.props['data-tooltip'])).toEqual([
      'notice.maskRequired',
      'notice.maskRequired',
    ])

    for (const action of ['undo', 'clear']) {
      const button = findByProp(tree, 'data-mask-action', action)
      expect(button.props.title).toBeUndefined()
      expect(button.props['data-tooltip']).toBe('notice.maskRequired')
      expect(button.props['aria-describedby']).toBe('mask-keyboard-help')
    }
  })
})
