import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { WelcomePanel } from '../WelcomePanel'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function findAll(
  node: unknown,
  predicate: (element: { props: Record<string, unknown>; type?: unknown }) => boolean,
): { props: Record<string, unknown>; type?: unknown }[] {
  const matches: { props: Record<string, unknown>; type?: unknown }[] = []

  if (node && typeof node === 'object') {
    const element = node as { props?: Record<string, unknown>; type?: unknown }
    if (element.props && predicate({ props: element.props, type: element.type })) {
      matches.push({ props: element.props, type: element.type })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAll(child, predicate))
  }

  return matches
}

function renderWelcomePanel(
  overrides: Partial<Parameters<typeof WelcomePanel>[0]> = {},
): ReactElement {
  return WelcomePanel({
    hint: 'welcome.hint',
    mode: 'chat',
    onApplyPrompt: vi.fn(),
    onOpenSettings: vi.fn(),
    setupRequired: false,
    t,
    title: 'welcome.title',
    ...overrides,
  }) as ReactElement
}

describe('WelcomePanel', () => {
  it('exposes quick prompts as a named group and applies the selected prompt', () => {
    const onApplyPrompt = vi.fn()
    const tree = renderWelcomePanel({ onApplyPrompt })
    const promptGroups = findAll(
      tree,
      (element) =>
        element.props.className === 'welcome-prompts' &&
        element.props.role === 'group',
    )
    const promptButtons = findAll(
      tree,
      (element) => element.type === 'button' && Boolean(element.props['data-welcome-prompt']),
    )

    expect(promptGroups).toHaveLength(1)
    expect(promptGroups[0].props['aria-label']).toBe('welcome.quickPromptGroup')
    expect(promptButtons.map((button) => button.props['data-welcome-prompt'])).toEqual([
      'code',
      'email',
      'translate',
      'brainstorm',
    ])
    expect(promptButtons.every((button) => button.props.title === undefined)).toBe(
      true,
    )
    expect(
      promptButtons.every(
        (button) => button.props['data-tooltip'] === button.props['aria-label'],
      ),
    ).toBe(true)

    const applyFirstPrompt = promptButtons[0].props.onClick
    if (typeof applyFirstPrompt !== 'function') {
      throw new Error('Expected the first quick prompt to be clickable.')
    }

    applyFirstPrompt()

    expect(onApplyPrompt).toHaveBeenCalledWith('welcome.quickPrompt.codePrompt')
  })

  it('keeps setup mode focused on the settings action instead of quick prompts', () => {
    const tree = renderWelcomePanel({ setupRequired: true })
    const promptGroups = findAll(
      tree,
      (element) => element.props.className === 'welcome-prompts',
    )
    const settingsButtons = findAll(
      tree,
      (element) =>
        element.type === 'button' &&
        element.props['data-settings-opener'] === 'true',
    )

    expect(promptGroups).toHaveLength(0)
    expect(settingsButtons).toHaveLength(1)
  })

  it('keeps audio mode focused on the transcription workflow', () => {
    const tree = renderWelcomePanel({ mode: 'audio' })
    const promptGroups = findAll(
      tree,
      (element) => element.props.className === 'welcome-prompts',
    )

    expect(promptGroups).toHaveLength(0)
  })
})
