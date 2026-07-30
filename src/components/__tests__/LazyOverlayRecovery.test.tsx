import { describe, expect, it, vi } from 'vitest'

import {
  LazyOverlayState,
} from '../LazyOverlayRecovery'
import { recoverLazyOverlay } from '../lazyOverlayLoader'

function nodeChildren(node: unknown): unknown[] {
  if (!node || typeof node !== 'object') return []
  const children = (node as { props?: { children?: unknown } }).props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return nodeChildren(node).map(textContent).join('')
}

interface TestElement {
  props: Record<string, unknown>
  ref?: unknown
  type: unknown
}

function findElement(
  node: unknown,
  predicate: (element: TestElement) => boolean,
): TestElement | null {
  if (node && typeof node === 'object') {
    const element = node as TestElement
    if (predicate(element)) return element
  }

  for (const child of nodeChildren(node)) {
    const found = findElement(child, predicate)
    if (found) return found
  }

  return null
}

describe('LazyOverlayRecovery', () => {
  it('preserves successfully loaded overlay modules', async () => {
    const Loaded = () => null
    const logger = { error: vi.fn() }

    await expect(
      recoverLazyOverlay(async () => ({ default: Loaded }), () => null, logger),
    ).resolves.toEqual({ default: Loaded })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('replaces rejected overlay modules with a contained fallback', async () => {
    const failure = new Error('settings chunk missing')
    const Fallback = () => null
    const logger = { error: vi.fn() }

    await expect(
      recoverLazyOverlay(
        async () => {
          throw failure
        },
        Fallback,
        logger,
      ),
    ).resolves.toEqual({ default: Fallback })
    expect(logger.error).toHaveBeenCalledWith(
      'ZeroChat overlay failed to load.',
      failure,
    )
  })

  it('contains synchronous overlay loader failures', async () => {
    const Fallback = () => null
    const logger = { error: vi.fn() }

    await expect(
      recoverLazyOverlay(
        () => {
          throw new Error('loader crashed')
        },
        Fallback,
        logger,
      ),
    ).resolves.toEqual({ default: Fallback })
  })

  it('renders a closable loading dialog without reload actions', () => {
    const onClose = vi.fn()
    const tree = LazyOverlayState({
      closeLabel: 'Close settings',
      description: 'Loading',
      mode: 'loading',
      onClose,
      title: 'Settings',
    })
    const section = findElement(tree, (element) => element.type === 'section')
    const close = findElement(
      tree,
      (element) => element.type === 'button' && element.props['aria-label'] === 'Close settings',
    )

    expect(section?.props['aria-busy']).toBe(true)
    expect(textContent(tree)).toContain('Loading')
    expect(textContent(tree)).not.toContain('Reload')
    ;(close?.props.onClick as () => void)()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders an assertive failed dialog with a reload action', () => {
    const focus = vi.fn()
    const onReload = vi.fn()
    const tree = LazyOverlayState({
      description: 'This screen could not load.',
      mode: 'failed',
      onReload,
      reloadLabel: 'Reload',
      title: 'Setup',
    })
    const section = findElement(tree, (element) => element.type === 'section')
    const alert = findElement(tree, (element) => element.props.role === 'alert')
    const reload = findElement(
      tree,
      (element) => element.type === 'button' && textContent(element).includes('Reload'),
    )

    expect(section?.props['aria-busy']).toBe(false)
    expect(alert?.props['aria-live']).toBe('assertive')
    ;(reload?.ref as (element: HTMLButtonElement | null) => void)(
      { focus } as unknown as HTMLButtonElement,
    )
    ;(reload?.ref as (element: HTMLButtonElement | null) => void)(null)
    expect(focus).toHaveBeenCalledOnce()
    ;(reload?.props.onClick as () => void)()
    expect(onReload).toHaveBeenCalledOnce()
  })
})
