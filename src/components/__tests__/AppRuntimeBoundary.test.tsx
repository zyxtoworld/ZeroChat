import type { ErrorInfo } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { loadLocale, setRuntimeLocale } from '../../i18n'
import {
  AppRuntimeBoundary,
  RuntimeFailureState,
} from '../AppRuntimeBoundary'

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

beforeAll(async () => {
  await loadLocale('en-US')
  setRuntimeLocale('en-US')
})

describe('AppRuntimeBoundary', () => {
  it('renders an assertive recovery state and focuses its reload action', () => {
    const focus = vi.fn()
    const onReload = vi.fn()
    const tree = RuntimeFailureState({ onReload })
    const alert = findElement(
      tree,
      (element) => element.type === 'main' && element.props.role === 'alert',
    )
    const reload = findElement(
      tree,
      (element) => element.type === 'button',
    )

    expect(alert?.props['aria-live']).toBe('assertive')
    expect(textContent(tree)).toContain('Could not start ZeroChat')
    expect(textContent(tree)).toContain('Reload')
    ;(reload?.ref as (element: HTMLButtonElement | null) => void)(
      { focus } as unknown as HTMLButtonElement,
    )
    expect(focus).toHaveBeenCalledOnce()
    ;(reload?.props.onClick as () => void)()
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('contains child render failures without exposing raw error text', () => {
    const logger = { error: vi.fn() }
    const error = new Error('api_key=sk-runtime-secret')
    const info = { componentStack: '\n    at BrokenView' } as ErrorInfo
    const boundary = new AppRuntimeBoundary({
      children: 'Ready',
      logger,
      onReload: vi.fn(),
    })

    expect(boundary.render()).toBe('Ready')
    boundary.state = AppRuntimeBoundary.getDerivedStateFromError()
    boundary.componentDidCatch(error, info)

    expect(logger.error).toHaveBeenCalledWith(
      'ZeroChat runtime render failed.',
      error,
      info,
    )
    const failureElement = boundary.render() as TestElement
    const failureTree = RuntimeFailureState(
      failureElement.props as { onReload?: () => void },
    )
    expect(failureElement.type).toBe(RuntimeFailureState)
    expect(textContent(failureTree)).toContain('Reload')
    expect(textContent(failureTree)).not.toContain('sk-runtime-secret')
  })

  it('keeps the recovery state usable when the host logger throws', () => {
    const boundary = new AppRuntimeBoundary({
      children: null,
      logger: {
        error: vi.fn(() => {
          throw new Error('logger unavailable')
        }),
      },
    })

    expect(() =>
      boundary.componentDidCatch(
        new Error('render failed'),
        { componentStack: null } as ErrorInfo,
      ),
    ).not.toThrow()
  })
})
