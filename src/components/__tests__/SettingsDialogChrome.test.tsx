import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { SettingsDialogChrome } from '../SettingsDialogChrome'

const t = ((key: string) => key) as Translator
type TestElement = ReactElement<Record<string, unknown>>

function childrenOf(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const children = (node as { props?: { children?: unknown } }).props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findByClassName(node: unknown, className: string): TestElement | null {
  if (node && typeof node === 'object') {
    const element = node as TestElement
    const elementClassName = element.props?.className
    if (
      typeof elementClassName === 'string' &&
      elementClassName.split(/\s+/u).includes(className)
    ) {
      return element
    }
  }

  for (const child of childrenOf(node)) {
    const match = findByClassName(child, className)
    if (match) return match
  }

  return null
}

function render(settingsDataPending: boolean): ReactElement {
  return SettingsDialogChrome({
    children: <div>data</div>,
    settingsDataPending,
    settingsModalRef: { current: null },
    settingsTab: 'data',
    t,
    renderFeatureHint: () => null,
    onCloseSettings: vi.fn(),
    onSelectTab: vi.fn(),
  })
}

describe('SettingsDialogChrome', () => {
  it('keeps the dialog accessible while making only mutation surfaces inert', () => {
    const tree = render(true)
    const modal = findByClassName(tree, 'settings-modal')
    const navigation = findByClassName(tree, 'settings-modal-navigation')
    const content = findByClassName(tree, 'settings-modal-content')
    const progress = findByClassName(tree, 'settings-data-progress')
    const close = findByClassName(tree, 'icon-button')

    expect(modal?.props.inert).toBeUndefined()
    expect(modal?.props['aria-busy']).toBeUndefined()
    expect(close?.props.disabled).toBe(true)
    expect(navigation?.props).toMatchObject({ inert: true, 'aria-busy': true })
    expect(content?.props).toMatchObject({ inert: true, 'aria-busy': true })
    expect(progress?.props).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      tabIndex: 0,
      'data-modal-initial-focus': 'true',
    })
  })

  it('removes the pending status and re-enables Settings when idle', () => {
    const tree = render(false)
    const navigation = findByClassName(tree, 'settings-modal-navigation')
    const content = findByClassName(tree, 'settings-modal-content')
    const close = findByClassName(tree, 'icon-button')

    expect(close?.props.disabled).toBe(false)
    expect(navigation?.props.inert).toBe(false)
    expect(content?.props.inert).toBe(false)
    expect(findByClassName(tree, 'settings-data-progress')).toBeNull()
  })
})
