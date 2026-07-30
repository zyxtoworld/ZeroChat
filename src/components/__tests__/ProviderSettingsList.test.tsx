import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { AppData, ProviderConfig } from '../../types'
import { ProviderSettingsList } from '../ProviderSettingsList'

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

function appData(providers: ProviderConfig[]): AppData {
  return {
    version: 1,
    conversations: [],
    preferences: {
      activeConversationId: undefined,
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    providers,
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt: 1,
  }
}

function nodeChildren(node: unknown): unknown[] {
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
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

function findAllByProp(
  node: unknown,
  propName: string,
  propValue: unknown,
): { props: Record<string, unknown> }[] {
  const matches: { props: Record<string, unknown> }[] = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (props && props[propName] === propValue) {
      matches.push({ props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByProp(child, propName, propValue))
  }

  return matches
}

function renderList(
  providers: ProviderConfig[],
  selectedProviderId: string,
  overrides: {
    onCommitEditsOnBlur?: () => void
    onMove?: (
      sourceProviderId: string,
      targetProviderId: string,
    ) => void
  } = {},
): ReactElement {
  return ProviderSettingsList({
    data: appData(providers),
    t,
    visibleProviders: providers,
    selectedProviderId,
    providerKeys: {},
    providerConnectivityResults: {},
    renderNotice: () => null,
    onAddProviderFromPreset: vi.fn(),
    onSelectProvider: vi.fn(),
    onSetProviderEnabled: vi.fn(),
    onProviderDragStart: vi.fn(),
    onProviderDrop: vi.fn(),
    onMove: overrides.onMove ?? vi.fn(),
    onCommitEditsOnBlur: overrides.onCommitEditsOnBlur ?? vi.fn(),
  }) as ReactElement
}

describe('ProviderSettingsList', () => {
  it('exposes the selected provider row as a pressed selector', () => {
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
    const providerButtons = findAllByClassName(tree, 'provider-list-select')

    expect(providerButtons).toHaveLength(2)
    expect(providerButtons[0].props['aria-pressed']).toBe(false)
    expect(providerButtons[1].props['aria-pressed']).toBe(true)
  })

  it('names each provider enable toggle with the provider name', () => {
    const providers = [
      provider(),
      provider({
        id: 'custom',
        baseUrl: 'https://relay.example.test/v1',
        custom: true,
        name: 'Custom Relay',
      }),
    ]
    const tree = renderList(providers, 'openai')
    const toggles = findAllByProp(tree, 'type', 'checkbox')

    expect(toggles).toHaveLength(2)
    expect(toggles[0].props['aria-label']).toBe('OpenAI: label.enabled')
    expect(toggles[1].props['aria-label']).toBe(
      'Custom Relay: label.enabled',
    )
  })

  it('names provider drag hints with the provider name', () => {
    const providers = [
      provider(),
      provider({
        id: 'custom',
        baseUrl: 'https://relay.example.test/v1',
        custom: true,
        name: 'Custom Relay',
      }),
    ]
    const tree = renderList(providers, 'openai')
    const rows = findAllByClassNameIncludes(tree, 'provider-list-row')

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.props.title)).toEqual([
      undefined,
      undefined,
    ])
    expect(rows.map((row) => row.props['data-tooltip'])).toEqual([
      undefined,
      undefined,
    ])
    expect(rows.map((row) => row.props.role)).toEqual(['group', 'group'])
    expect(rows.map((row) => row.props['aria-label'])).toEqual([
      'OpenAI: settings.dragProviderHint',
      'Custom Relay: settings.dragProviderHint',
    ])
    expect(rows.map((row) => row.props.title)).not.toContain(
      'settings.dragProviderHint',
    )
  })

  it('contains provider list drag dropEffect setter failures', () => {
    const providers = [provider()]
    const tree = renderList(providers, 'openai')
    const [row] = findAllByClassNameIncludes(tree, 'provider-list-row')
    const preventDefault = vi.fn()
    const dataTransfer = {} as Pick<DataTransfer, 'dropEffect'>

    Object.defineProperty(dataTransfer, 'dropEffect', {
      configurable: true,
      get: () => 'none',
      set: () => {
        throw new Error('dropEffect blocked')
      },
    })

    expect(() => {
      ;(row.props.onDragOver as (event: unknown) => void)({
        dataTransfer,
        preventDefault,
      })
    }).not.toThrow()
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('exposes keyboard provider move actions with provider names and bounds', () => {
    const providers = [
      provider(),
      provider({
        id: 'custom',
        baseUrl: 'https://relay.example.test/v1',
        custom: true,
        name: 'Custom Relay',
      }),
    ]
    const onMoveProvider = vi.fn()
    const onCommitEditsOnBlur = vi.fn()
    const tree = renderList(providers, 'openai', {
      onCommitEditsOnBlur,
      onMove: onMoveProvider,
    })
    const moveButtons = findAllByClassName(tree, 'provider-list-move')

    expect(moveButtons).toHaveLength(4)
    expect(moveButtons.map((button) => button.props['aria-label'])).toEqual([
      'button.up: OpenAI',
      'button.down: OpenAI',
      'button.up: Custom Relay',
      'button.down: Custom Relay',
    ])
    expect(moveButtons.map((button) => button.props.title)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(moveButtons.map((button) => button.props['data-tooltip'])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(moveButtons.map((button) => button.props.disabled)).toEqual([
      true,
      false,
      false,
      true,
    ])

    ;(moveButtons[1]?.props.onClick as () => void)()

    expect(onMoveProvider).toHaveBeenCalledWith('openai', 'custom')
    expect(onCommitEditsOnBlur).not.toHaveBeenCalled()
  })

  it('disables provider move actions across enabled and disabled groups', () => {
    const tree = renderList([
      provider(),
      provider({
        id: 'disabled',
        enabled: false,
        name: 'Disabled Relay',
      }),
    ], 'openai')
    const moveButtons = findAllByClassName(tree, 'provider-list-move')

    expect(moveButtons.map((button) => button.props.disabled)).toEqual([
      true,
      true,
      true,
      true,
    ])
  })
})
