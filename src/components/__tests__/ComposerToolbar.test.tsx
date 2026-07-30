import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { ComposerToolbar } from '../ComposerToolbar'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findButtonByComposeMode(
  node: unknown,
  mode: string,
): { props: Record<string, unknown> } | undefined {
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (props?.['data-compose-mode'] === mode) {
      return { props }
    }
  }

  for (const child of nodeChildren(node)) {
    const match = findButtonByComposeMode(child, mode)
    if (match) return match
  }

  return undefined
}

function findAllByImageTaskMode(
  node: unknown,
): { props: Record<string, unknown> }[] {
  const matches: { props: Record<string, unknown> }[] = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (typeof props?.['data-image-task-mode'] === 'string') {
      matches.push({ props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByImageTaskMode(child))
  }

  return matches
}

function findAllByClassName(
  node: unknown,
  className: string,
): { props: Record<string, unknown> }[] {
  const matches: { props: Record<string, unknown> }[] = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (props?.className === className) {
      matches.push({ props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByClassName(child, className))
  }

  return matches
}

function renderToolbar(
  overrides: Partial<Parameters<typeof ComposerToolbar>[0]> = {},
): ReactElement {
  return ComposerToolbar({
    composerMode: 'image',
    imageTaskMode: 'edit',
    generationActive: false,
    t,
    onComposerModeChange: vi.fn(),
    onImageTaskModeChange: vi.fn(),
    ...overrides,
  }) as ReactElement
}

describe('ComposerToolbar', () => {
  it('exposes the active composer mode as pressed', () => {
    const tree = renderToolbar()

    expect(findButtonByComposeMode(tree, 'chat')?.props['aria-pressed']).toBe(
      false,
    )
    expect(findButtonByComposeMode(tree, 'image')?.props['aria-pressed']).toBe(
      true,
    )
    expect(findButtonByComposeMode(tree, 'audio')?.props['aria-pressed']).toBe(
      false,
    )
    expect(findButtonByComposeMode(tree, 'image')?.props.className).toBe(
      'active',
    )
  })

  it('preserves image task pressed state inside image mode', () => {
    const tree = renderToolbar()
    const taskButtons = findAllByImageTaskMode(tree)

    expect(taskButtons.map((button) => button.props['data-image-task-mode']))
      .toEqual(['generate', 'edit', 'inpaint'])
    expect(taskButtons.map((button) => button.props['aria-pressed'])).toEqual([
      false,
      true,
      false,
    ])
  })

  it('keeps compose-mode tooltips on wrappers without duplicate button titles', () => {
    const tree = renderToolbar({ generationActive: true })
    const tooltipTargets = findAllByClassName(
      tree,
      'composer-mode-tooltip-target',
    )
    const composeButtons = ['chat', 'image', 'audio']
      .map((mode) => findButtonByComposeMode(tree, mode))
    const taskButtons = findAllByImageTaskMode(tree)

    expect(tooltipTargets).toHaveLength(6)
    expect(
      tooltipTargets.map((target) => [
        target.props.title,
        target.props['data-tooltip'],
      ]),
    ).toEqual(Array.from({ length: 6 }, () => [
      undefined,
      'message.streaming',
    ]))
    expect([...composeButtons, ...taskButtons].map((button) => button?.props.title))
      .toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
    expect(
      [...composeButtons, ...taskButtons].map(
        (button) => button?.props['data-tooltip'],
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })
})
