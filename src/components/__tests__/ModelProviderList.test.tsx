import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { ProviderConfig } from '../../types'
import { ModelProviderList } from '../ModelProviderList'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'openai',
    baseUrl: 'https://api.example.test/v1',
    capabilities: ['chat'],
    createdAt: 1,
    enabled: true,
    kind: 'openai-compatible',
    model: 'chat-model',
    models: ['chat-model'],
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

function findAllByClassNameIncludes(
  node: unknown,
  classNamePart: string,
): { props: Record<string, unknown> }[] {
  const matches: { props: Record<string, unknown> }[] = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (
      typeof props?.className === 'string' &&
      props.className.includes(classNamePart)
    ) {
      matches.push({ props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByClassNameIncludes(child, classNamePart))
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

function renderList(
  providers: ProviderConfig[],
  selectedProviderId: string,
): ReactElement {
  return ModelProviderList({
    t,
    visibleProviders: providers,
    selectedProviderId,
    onSelectProvider: vi.fn(),
  }) as ReactElement
}

describe('ModelProviderList', () => {
  it('exposes the selected model provider row as a pressed selector', () => {
    const providers = [
      provider(),
      provider({
        id: 'custom',
        baseUrl: 'https://relay.example.test/v1',
        custom: true,
        name: 'Custom Relay',
      }),
    ]
    const tree = renderList(providers, 'custom')
    const providerButtons = findAllByClassNameIncludes(
      tree,
      'provider-list-select model-provider-row',
    )

    expect(providerButtons).toHaveLength(2)
    expect(providerButtons[0].props['aria-pressed']).toBe(false)
    expect(providerButtons[1].props['aria-pressed']).toBe(true)
  })

  it('describes provider model capability chips as a labelled list', () => {
    const tree = renderList(
      [
        provider({
          imageModel: 'gpt-image-2',
          models: ['chat-model', 'gpt-image-2'],
        }),
      ],
      'openai',
    )
    const capabilityLists = findAllByClassName(
      tree,
      'model-provider-capabilities',
    )
    const capabilityItems = findAllByClassName(
      capabilityLists[0],
      'model-provider-capability',
    )

    expect(capabilityLists).toHaveLength(1)
    expect(capabilityLists[0].props.role).toBe('list')
    expect(capabilityLists[0].props['aria-label']).toBe(
      'OpenAI: capability.chat / capability.image-generation / capability.image-editing',
    )
    expect(capabilityItems.map((item) => item.props.role)).toEqual([
      'listitem',
      'listitem',
      'listitem',
    ])
    expect(capabilityItems.map((item) => item.props.title)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(capabilityItems.map((item) => item.props['data-tooltip'])).toEqual([
      'capability.chat',
      'capability.image-generation',
      'capability.image-editing',
    ])
  })
})
