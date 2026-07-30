import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import {
  providerFullCapabilityCheckKey,
  type ProviderCapabilityCheckKind,
} from '../../services/providerCapabilityChecks'
import type { ProviderConnectivityResult } from '../../services/providerStatus'
import type { AppData, ProviderConfig } from '../../types'
import { ProviderSettingsEditor } from '../ProviderSettingsEditor'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as Translator

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'openai',
    baseUrl: 'https://api.example.test/v1',
    capabilities: ['chat', 'image-generation', 'embeddings', 'moderation'],
    createdAt: 1,
    enabled: true,
    imageModel: 'image-model',
    embeddingModel: 'embedding-model',
    kind: 'openai-compatible',
    model: 'chat-model',
    moderationModel: 'moderation-model',
    models: ['chat-model', 'image-model', 'embedding-model', 'moderation-model'],
    name: 'OpenAI',
    needsApiKey: true,
    updatedAt: 1,
    ...patch,
  }
}

function appData(selectedProvider = provider()): AppData {
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
    providers: [selectedProvider],
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
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
}

function textNodes(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  return nodeChildren(node).flatMap(textNodes)
}

function findByProp(
  node: unknown,
  propName: string,
  propValue: unknown,
): { props: Record<string, unknown> } {
  const found = findByPropOptional(node, propName, propValue)
  if (!found) {
    throw new Error(`Missing node with ${propName}=${String(propValue)}`)
  }
  return found
}

function findByPropOptional(
  node: unknown,
  propName: string,
  propValue: unknown,
): { props: Record<string, unknown> } | null {
  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (props && props[propName] === propValue) {
      return { props }
    }
  }

  for (const child of nodeChildren(node)) {
    const found = findByPropOptional(child, propName, propValue)
    if (found) return found
  }

  return null
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

function renderEditor(
  retryAction?: 'fullCapabilities' | 'connectivity',
  selectedProvider = provider(),
  checkingProviderId = '',
  resultPatch: Partial<ProviderConnectivityResult> = {},
  overrides: {
    onCheckProviderCapability?: (
      providerId: string,
      capability: ProviderCapabilityCheckKind,
    ) => void | Promise<void>
    onCheckProviderConnectivity?: (providerId: string) => void | Promise<void>
    onCheckProviderFullCapabilities?: (
      providerId: string,
    ) => void | Promise<void>
    onRemoveProvider?: (providerId: string) => void | Promise<void>
  } = {},
): {
  capability: ReturnType<typeof vi.fn>
  connectivity: ReturnType<typeof vi.fn>
  fullCapabilities: ReturnType<typeof vi.fn>
  removeProvider: ReturnType<typeof vi.fn>
  tree: ReactElement
  retryButton: { props: Record<string, unknown> }
} {
  const capability = vi.fn(overrides.onCheckProviderCapability)
  const connectivity = vi.fn(overrides.onCheckProviderConnectivity)
  const fullCapabilities = vi.fn(overrides.onCheckProviderFullCapabilities)
  const removeProvider = vi.fn(overrides.onRemoveProvider)
  const tree = ProviderSettingsEditor({
    data: appData(selectedProvider),
    t,
    selectedProvider,
    providerKeys: {
      [selectedProvider.id]: 'provider-key',
    },
    providerConnectivityResults: {
      [selectedProvider.id]: {
        field: 'baseUrl',
        message: 'connection failed',
        retryable: true,
        retryAction,
        tone: 'error',
        ...resultPatch,
      },
    },
    checkingProviderId,
    renderSecretInput: () => <input />,
    renderNotice: () => null,
    onUpdateProvider: vi.fn(),
    onUpdateProviderKey: vi.fn(),
    onCheckProviderCapability: capability,
    onCheckProviderFullCapabilities: fullCapabilities,
    onCheckProviderConnectivity: connectivity,
    onRemoveProvider: removeProvider,
    onCommitEditsOnBlur: vi.fn(),
  }) as ReactElement

  return {
    capability,
    connectivity,
    fullCapabilities,
    removeProvider,
    tree,
    retryButton: findByProp(tree, 'data-provider-connectivity-retry', 'true'),
  }
}

async function invokeHandler(handler: unknown): Promise<void> {
  expect(typeof handler).toBe('function')
  await (handler as () => unknown)()
}

describe('ProviderSettingsEditor', () => {
  it('marks the AI proxy URL as browser-required after direct browser failure', () => {
    const { tree } = renderEditor(undefined, provider(), '', {
      field: 'proxyUrl',
      message: 'direct browser path failed',
    })
    const proxyInput = findByProp(
      tree,
      'data-provider-proxy-url-field',
      'true',
    )

    expect(textNodes(tree)).toContain('field.workerEndpoint')
    expect(proxyInput.props.placeholder).toBe('placeholder.workerEndpoint')
  })

  it('keeps the latest failed capability probe visible in Provider settings', () => {
    const { tree } = renderEditor(undefined, provider(), '', {
      capabilityResults: {
        'image-generation': {
          message: '/images/generations failed',
          model: 'image-model',
          status: 'failed',
          tone: 'error',
        },
      },
    })
    const chip = findByProp(
      tree,
      'data-provider-capability-check-result',
      'failed',
    )
    const status = findByProp(chip, 'className', 'capability-check-status error')

    expect(chip.props['aria-describedby']).toContain(
      'provider-capability-check-result-openai-image-generation',
    )
    expect(status.props.id).toBe(
      'provider-capability-check-result-openai-image-generation',
    )
    expect(status.props.title).toBeUndefined()
    expect(status.props['data-tooltip']).toBe('/images/generations failed')
    expect(textNodes(chip)).toContain('/images/generations failed')
  })

  it('dispatches full-capability retry results back to the full-capability check', () => {
    const { connectivity, fullCapabilities, retryButton } =
      renderEditor('fullCapabilities')

    expect(retryButton.props['data-provider-connectivity-retry-action']).toBe(
      'fullCapabilities',
    )

    const onClick = retryButton.props.onClick
    expect(typeof onClick).toBe('function')
    ;(onClick as () => void)()

    expect(fullCapabilities).toHaveBeenCalledWith('openai')
    expect(connectivity).not.toHaveBeenCalled()
  })

  it('keeps ordinary retryable provider failures on the connectivity check', () => {
    const { connectivity, fullCapabilities, retryButton } = renderEditor()

    expect(retryButton.props['data-provider-connectivity-retry-action']).toBe(
      'connectivity',
    )

    const onClick = retryButton.props.onClick
    expect(typeof onClick).toBe('function')
    ;(onClick as () => void)()

    expect(connectivity).toHaveBeenCalledWith('openai')
    expect(fullCapabilities).not.toHaveBeenCalled()
  })

  it('names the provider delete action with the selected provider', () => {
    const { tree } = renderEditor(
      undefined,
      provider({
        name: 'Acme Relay',
      }),
    )
    const deleteButton = findByProp(
      tree,
      'data-provider-delete-action',
      'true',
    )

    expect(deleteButton.props['aria-label']).toBe(
      'button.deleteProvider: Acme Relay',
    )
    expect(deleteButton.props.title).toBeUndefined()
    expect(deleteButton.props['data-tooltip']).toBe(
      'button.deleteProvider: Acme Relay',
    )
    expect(nodeChildren(deleteButton)).toContain('button.deleteProvider')
  })

  it('does not label connectivity actions as checking when another provider is busy', () => {
    const { tree, retryButton } = renderEditor(
      undefined,
      provider(),
      'provider:other',
    )
    const checkButton = findByProp(
      tree,
      'data-provider-connectivity-check',
      'true',
    )
    const tooltipTargets = findAllByProp(
      tree,
      'className',
      'provider-connectivity-tooltip-target',
    )

    expect(checkButton.props.disabled).toBe(true)
    expect(checkButton.props.title).toBeUndefined()
    expect(checkButton.props['data-tooltip']).toBeUndefined()
    expect(tooltipTargets[0]?.props.title).toBeUndefined()
    expect(tooltipTargets[0]?.props['data-tooltip']).toBe(
      'settings.waitForCheck',
    )
    expect(nodeChildren(checkButton)).toContain('button.checkConnectivity')
    expect(nodeChildren(checkButton)).not.toContain('button.checking')
    expect(retryButton.props.disabled).toBe(true)
    expect(retryButton.props.title).toBeUndefined()
    expect(retryButton.props['data-tooltip']).toBeUndefined()
    expect(tooltipTargets[1]?.props.title).toBeUndefined()
    expect(tooltipTargets[1]?.props['data-tooltip']).toBe(
      'settings.waitForCheck',
    )
    expect(nodeChildren(retryButton)).toContain('button.retry')
    expect(nodeChildren(retryButton)).not.toContain('button.checking')
  })

  it('labels the active provider connectivity action as checking', () => {
    const { tree, retryButton } = renderEditor(
      undefined,
      provider(),
      'provider:openai',
    )
    const checkButton = findByProp(
      tree,
      'data-provider-connectivity-check',
      'true',
    )
    const tooltipTargets = findAllByProp(
      tree,
      'className',
      'provider-connectivity-tooltip-target',
    )

    expect(checkButton.props.disabled).toBe(true)
    expect(checkButton.props.title).toBeUndefined()
    expect(checkButton.props['data-tooltip']).toBeUndefined()
    expect(tooltipTargets[0]?.props.title).toBeUndefined()
    expect(tooltipTargets[0]?.props['data-tooltip']).toBe('button.checking')
    expect(nodeChildren(checkButton)).toContain('button.checking')
    expect(retryButton.props.disabled).toBe(true)
    expect(retryButton.props.title).toBeUndefined()
    expect(retryButton.props['data-tooltip']).toBeUndefined()
    expect(tooltipTargets[1]?.props.title).toBeUndefined()
    expect(tooltipTargets[1]?.props['data-tooltip']).toBe('button.checking')
  })

  it('describes provider capability and interface chip groups as labelled lists', () => {
    const { tree } = renderEditor()
    const capabilityList = findByProp(
      tree,
      'aria-labelledby',
      'provider-capabilities-label-openai',
    )
    const interfaceList = findByProp(
      tree,
      'aria-labelledby',
      'provider-interfaces-label-openai',
    )
    const capabilityChip = findByProp(tree, 'className', 'capability-chip')
    const endpointChip = findByProp(tree, 'className', 'endpoint-chip')

    expect(
      findByProp(tree, 'id', 'provider-capabilities-label-openai').props
        .children,
    ).toBe('settings.capabilities')
    expect(capabilityList.props.role).toBe('list')
    expect(capabilityChip.props.role).toBe('listitem')
    expect(
      findByProp(tree, 'id', 'provider-interfaces-label-openai').props.children,
    ).toBe('settings.interfaces')
    expect(interfaceList.props.role).toBe('list')
    expect(endpointChip.props.role).toBe('listitem')
  })

  it('disables full-capability checks until server-drill capabilities are runnable', () => {
    const realtimeProvider = provider({
      capabilities: ['chat', 'realtime', 'model-list'],
      models: ['chat-model', 'gpt-realtime'],
      realtimeModel: 'gpt-realtime',
    })
    const { tree } = renderEditor(undefined, realtimeProvider)
    const fullCapabilityButton = findByProp(
      tree,
      'data-provider-full-capability-check',
      'true',
    )

    expect(fullCapabilityButton.props.disabled).toBe(true)
    expect(fullCapabilityButton.props.title).toBeUndefined()
    expect(fullCapabilityButton.props['data-tooltip']).toBe(
      'error.realtimeServerDrill · capability.realtime',
    )
    expect(fullCapabilityButton.props['aria-describedby']).toBe(
      'provider-capability-check-hint-openai provider-capability-readiness-openai',
    )
    expect(
      findByProp(tree, 'id', 'provider-capability-readiness-openai').props[
        'data-provider-capability-readiness'
      ],
    ).toBe('server-drill')
  })

  it('does not label the current full-capability action as checking when another provider is busy', () => {
    const { tree } = renderEditor(undefined, provider(), 'provider:other')
    const fullCapabilityButton = findByProp(
      tree,
      'data-provider-full-capability-check',
      'true',
    )

    expect(fullCapabilityButton.props.disabled).toBe(true)
    expect(fullCapabilityButton.props.title).toBeUndefined()
    expect(fullCapabilityButton.props['data-tooltip']).toBe(
      'settings.capabilityFullCheckNote',
    )
    expect(nodeChildren(fullCapabilityButton)).toContain(
      'button.checkAllCapabilities',
    )
    expect(nodeChildren(fullCapabilityButton)).not.toContain('button.checking')
  })

  it('keeps the aggregate full-capability action active while blocking every individual check', () => {
    const { tree } = renderEditor(
      undefined,
      provider(),
      providerFullCapabilityCheckKey('openai'),
    )
    const fullCapabilityButton = findByProp(
      tree,
      'data-provider-full-capability-check',
      'true',
    )
    const connectivityButton = findByProp(
      tree,
      'data-provider-connectivity-check',
      'true',
    )
    const connectivityTooltipTargets = findAllByProp(
      tree,
      'className',
      'provider-connectivity-tooltip-target',
    )

    expect(fullCapabilityButton.props.disabled).toBe(true)
    expect(fullCapabilityButton.props['data-tooltip']).toBe('button.checking')
    expect(nodeChildren(fullCapabilityButton)).toContain('button.checking')
    expect(connectivityButton.props.disabled).toBe(true)
    expect(connectivityButton.props['data-tooltip']).toBeUndefined()
    expect(connectivityTooltipTargets[0]?.props['data-tooltip']).toBe(
      'settings.waitForCheck',
    )

    for (const capability of [
      'image-generation',
      'embeddings',
      'moderation',
    ] satisfies ProviderCapabilityCheckKind[]) {
      const capabilityButton = findByProp(
        tree,
        'data-provider-capability-check',
        capability,
      )

      expect(capabilityButton.props.disabled).toBe(true)
      expect(capabilityButton.props['data-tooltip']).toBe('settings.waitForCheck')
      expect(capabilityButton.props['aria-describedby']).toContain(
        'provider-capability-check-busy-openai',
      )
      expect(nodeChildren(capabilityButton)).toContain('button.checkModel')
      expect(nodeChildren(capabilityButton)).not.toContain('button.checking')
    }
  })

  it('does not label single-capability actions as checking when another provider is busy', () => {
    const { tree } = renderEditor(undefined, provider(), 'provider:other')
    const imageButton = findByProp(
      tree,
      'data-provider-capability-check',
      'image-generation',
    )

    expect(imageButton.props.disabled).toBe(true)
    expect(imageButton.props.title).toBeUndefined()
    expect(imageButton.props['data-tooltip']).toBe('settings.waitForCheck')
    expect(imageButton.props['aria-describedby']).toBe(
      'provider-capability-check-hint-openai provider-capability-check-description-openai-image-generation provider-capability-check-busy-openai',
    )
    expect(
      findByProp(tree, 'id', 'provider-capability-check-busy-openai').props
        .children,
    ).toBe('settings.waitForCheck')
    expect(nodeChildren(imageButton)).toContain('button.checkModel')
    expect(nodeChildren(imageButton)).not.toContain('button.checking')
  })

  it('labels the active single-capability action as checking', () => {
    const { tree } = renderEditor(
      undefined,
      provider(),
      'openai:capability:image-generation',
    )
    const imageButton = findByProp(
      tree,
      'data-provider-capability-check',
      'image-generation',
    )

    expect(imageButton.props.disabled).toBe(true)
    expect(imageButton.props.title).toBeUndefined()
    expect(imageButton.props['data-tooltip']).toBe('button.checking')
    expect(imageButton.props['aria-describedby']).toBe(
      'provider-capability-check-hint-openai provider-capability-check-description-openai-image-generation',
    )
    expect(nodeChildren(imageButton)).toContain('button.checking')
  })

  it('describes disabled single-capability checks with the concrete readiness reason', () => {
    const realtimeProvider = provider({
      capabilities: ['chat', 'realtime', 'model-list'],
      models: ['chat-model', 'gpt-realtime'],
      realtimeModel: 'gpt-realtime',
    })
    const { tree } = renderEditor(undefined, realtimeProvider)
    const realtimeButton = findByProp(
      tree,
      'data-provider-capability-check',
      'realtime',
    )

    expect(realtimeButton.props.disabled).toBe(true)
    expect(realtimeButton.props['aria-describedby']).toBe(
      'provider-capability-check-hint-openai provider-capability-check-description-openai-realtime',
    )
    expect(
      findByProp(
        tree,
        'id',
        'provider-capability-check-description-openai-realtime',
      ).props.children,
    ).toBe(
      '/realtime/client_secrets · error.realtimeServerDrill · settings.capabilityCheckModel:{"model":"gpt-realtime"}',
    )
  })

  it('describes capability check chips with their concrete readiness reason', () => {
    const realtimeProvider = provider({
      capabilities: ['chat', 'realtime', 'model-list'],
      models: ['chat-model', 'gpt-realtime'],
      realtimeModel: 'gpt-realtime',
    })
    const { tree } = renderEditor(undefined, realtimeProvider)
    const capabilityList = findByProp(
      tree,
      'className',
      'capability-check-list',
    )
    const realtimeChip = findByProp(
      tree,
      'data-provider-capability-check-state',
      'server-drill',
    )

    expect(capabilityList.props.role).toBe('list')
    expect(capabilityList.props['aria-describedby']).toBe(
      'provider-capability-check-hint-openai',
    )
    expect(realtimeChip.props.role).toBe('listitem')
    expect(realtimeChip.props['aria-describedby']).toBe(
      'provider-capability-check-hint-openai provider-capability-check-description-openai-realtime',
    )
  })

  it('contains synchronous provider settings action failures at the leaf action boundary', async () => {
    const { capability, connectivity, fullCapabilities, removeProvider, tree } =
      renderEditor(undefined, provider(), '', {}, {
        onCheckProviderCapability: () => {
          throw new Error('capability failed')
        },
        onCheckProviderConnectivity: () => {
          throw new Error('connectivity failed')
        },
        onCheckProviderFullCapabilities: () => {
          throw new Error('full capability failed')
        },
        onRemoveProvider: () => {
          throw new Error('remove failed')
        },
      })
    const connectivityButton = findByProp(
      tree,
      'data-provider-connectivity-check',
      'true',
    )
    const fullCapabilityButton = findByProp(
      tree,
      'data-provider-full-capability-check',
      'true',
    )
    const imageCapabilityButton = findByProp(
      tree,
      'data-provider-capability-check',
      'image-generation',
    )
    const deleteButton = findByProp(
      tree,
      'data-provider-delete-action',
      'true',
    )

    await expect(invokeHandler(connectivityButton.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(fullCapabilityButton.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(imageCapabilityButton.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(deleteButton.props.onClick)).resolves.toBeUndefined()

    expect(connectivity).toHaveBeenCalledWith('openai')
    expect(fullCapabilities).toHaveBeenCalledWith('openai')
    expect(capability).toHaveBeenCalledWith('openai', 'image-generation')
    expect(removeProvider).toHaveBeenCalledWith('openai')
  })

  it('contains rejected provider settings actions without leaking the promise', async () => {
    const { retryButton, tree } = renderEditor('fullCapabilities', provider(), '', {}, {
      onCheckProviderCapability: () =>
        Promise.reject(new Error('capability failed')),
      onCheckProviderConnectivity: () =>
        Promise.reject(new Error('connectivity failed')),
      onCheckProviderFullCapabilities: () =>
        Promise.reject(new Error('full capability failed')),
      onRemoveProvider: () => Promise.reject(new Error('remove failed')),
    })
    const connectivityButton = findByProp(
      tree,
      'data-provider-connectivity-check',
      'true',
    )
    const fullCapabilityButton = findByProp(
      tree,
      'data-provider-full-capability-check',
      'true',
    )
    const imageCapabilityButton = findByProp(
      tree,
      'data-provider-capability-check',
      'image-generation',
    )
    const deleteButton = findByProp(
      tree,
      'data-provider-delete-action',
      'true',
    )

    await expect(invokeHandler(connectivityButton.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(retryButton.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(fullCapabilityButton.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(imageCapabilityButton.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(deleteButton.props.onClick)).resolves.toBeUndefined()
  })
})
