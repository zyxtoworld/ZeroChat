import { createRef, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { ProviderConfig } from '../../types'
import { ChatProviderModelMenu } from '../ChatProviderModelMenu'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'openai',
    baseUrl: 'https://api.example.test/v1',
    capabilities: ['chat', 'image-generation', 'audio'],
    createdAt: 1,
    enabled: true,
    imageModel: 'gpt-image-2',
    kind: 'openai-compatible',
    model: 'gpt-5-5',
    models: ['gpt-4.1-mini', 'gpt-5-5', 'gpt-image-2', 'gpt-4o-transcribe'],
    name: 'OpenAI',
    needsApiKey: true,
    updatedAt: 1,
    ...patch,
  }
}

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return nodeChildren(node).map(textContent).join('')
}

function findAllByClassNameToken(
  node: unknown,
  classNameToken: string,
): { props: Record<string, unknown>; text: string }[] {
  const matches: { props: Record<string, unknown>; text: string }[] = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    const className = props?.className
    if (
      props &&
      typeof className === 'string' &&
      className.split(/\s+/u).includes(classNameToken)
    ) {
      matches.push({ props, text: textContent(node) })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByClassNameToken(child, classNameToken))
  }

  return matches
}

function findByClassNameToken(
  node: unknown,
  classNameToken: string,
): { props: Record<string, unknown>; text: string } {
  const [match] = findAllByClassNameToken(node, classNameToken)

  if (!match) {
    throw new Error(`Missing class token: ${classNameToken}`)
  }

  return match
}

function renderMenu(
  overrides: Partial<Parameters<typeof ChatProviderModelMenu>[0]> = {},
): ReactElement {
  const activeProvider = provider()

  return ChatProviderModelMenu({
    activeImageModel: 'gpt-image-2',
    activeModel: 'gpt-5-5',
    activeModelLabel: 'gpt-5-5',
    activeProvider,
    activeProviderLabel: 'OpenAI',
    chatModelMenuOpen: true,
    chatModelMenuRef: createRef<HTMLDivElement>(),
    chatModelProviders: [activeProvider],
    chatModelTriggerRef: createRef<HTMLButtonElement>(),
    composerMode: 'chat',
    expandedChatProviderId: activeProvider.id,
    imageTaskMode: 'generate',
    providerModelHint: <p>hint</p>,
    t,
    onSelectAudioTranscriptionModel: vi.fn(),
    onSelectChatModel: vi.fn(),
    onSelectImageModel: vi.fn(),
    onToggleModelMenu: vi.fn(),
    onToggleProviderExpanded: vi.fn(),
    ...overrides,
  }) as ReactElement
}

describe('ChatProviderModelMenu', () => {
  it('links the trigger and expanded provider rows to their controlled menus', () => {
    const tree = renderMenu()
    const trigger = findByClassNameToken(tree, 'provider-model-trigger')
    const menu = findByClassNameToken(tree, 'provider-model-menu')
    const providerButton = findByClassNameToken(tree, 'provider-model-provider')
    const providerOptions = findByClassNameToken(tree, 'provider-model-options')

    expect(trigger.props['aria-controls']).toBe('pm')
    expect(trigger.props['aria-expanded']).toBe(true)
    expect(menu.props.id).toBe('pm')
    expect(providerButton.props['aria-controls']).toBe('pm-openai')
    expect(providerButton.props['aria-expanded']).toBe(true)
    expect(providerOptions.props.id).toBe('pm-openai')
  })

  it('exposes the current model as a checked radio menu item', () => {
    const tree = renderMenu()
    const options = findAllByClassNameToken(tree, 'provider-model-option')

    expect(options.map((option) => option.props.role)).toEqual([
      'menuitemradio',
      'menuitemradio',
    ])
    expect(
      options.map((option) => [option.text, option.props['aria-checked']]),
    ).toEqual([
      ['gpt-4.1-mini', false],
      ['gpt-5-5', true],
    ])
    expect(options[1].props.className).toContain('active')
  })

  it('names model options with their provider context', () => {
    const tree = renderMenu()
    const options = findAllByClassNameToken(tree, 'provider-model-option')

    expect(
      options.map((option) => [
        option.text,
        option.props['aria-label'],
        option.props['data-tooltip'],
        option.props.title,
      ]),
    ).toEqual([
      [
        'gpt-4.1-mini',
        'OpenAI: gpt-4.1-mini',
        'OpenAI: gpt-4.1-mini',
        undefined,
      ],
      [
        'gpt-5-5',
        'OpenAI: gpt-5-5',
        'OpenAI: gpt-5-5',
        undefined,
      ],
    ])
  })
})
