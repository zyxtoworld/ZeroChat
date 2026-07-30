import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { FeatureHint } from '../FeatureHint'

const t = ((key: string) => key) as Translator

interface FeatureHintElementProps {
  children?: ReactElement | ReactElement[]
  role?: string
  'aria-live'?: string
  'aria-atomic'?: string
  'aria-describedby'?: string
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

function propsOf(element: ReactElement): FeatureHintElementProps {
  return element.props as FeatureHintElementProps
}

function childrenOf(element: ReactElement): ReactElement[] {
  const children = propsOf(element).children
  return Array.isArray(children) ? children : children ? [children] : []
}

describe('FeatureHint', () => {
  it('keeps ordinary hints as polite status messages', () => {
    const tree = FeatureHint({
      id: 'chat',
      placement: 'chat',
      t,
      onDismiss: vi.fn(),
    })
    const button = childrenOf(tree)[2]
    const buttonProps = propsOf(button)

    expect(propsOf(tree)).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    })
    expect(buttonProps.role).toBeUndefined()
    expect(buttonProps['aria-describedby']).toBeUndefined()
  })

  it('makes menu hints keyboard-navigable and restores menu focus after dismissal', () => {
    const onDismiss = vi.fn()
    const focus = vi.fn()
    const successor = { focus } as unknown as HTMLElement
    const querySelector = vi.fn(() => successor)
    const menu = { querySelector } as unknown as HTMLElement
    const currentTarget = {
      closest: vi.fn(() => menu),
    } as unknown as HTMLButtonElement
    const tree = FeatureHint({
      id: 'provider-model',
      placement: 'menu',
      t,
      onDismiss,
    })
    const [,, button] = childrenOf(tree)
    const buttonProps = propsOf(button)

    expect(propsOf(tree)).toMatchObject({
      role: 'none',
      'aria-live': undefined,
      'aria-atomic': undefined,
    })
    expect(buttonProps).toMatchObject({
      role: 'menuitem',
      'aria-describedby': 'feature-hint-provider-model-description',
    })

    buttonProps.onClick?.({
      currentTarget,
    } as ReactMouseEvent<HTMLButtonElement>)

    expect(onDismiss).toHaveBeenCalledWith('provider-model')
    expect(querySelector).toHaveBeenCalledWith(
      '[role^=menuitem]:not(:disabled)',
    )
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
