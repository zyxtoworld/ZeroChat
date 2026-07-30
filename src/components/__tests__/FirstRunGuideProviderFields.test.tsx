import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import { providerFullCapabilityCheckKey } from '../../services/providerCapabilityChecks'
import type { ProviderConnectivityResult } from '../../services/providerStatus'
import type { ProviderConfig } from '../../types'
import { FirstRunGuideProviderFields } from '../FirstRunGuideProviderFields'

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

function renderFields(
  selectedProvider = provider(),
  checkingProviderId = '',
  loadingModelsProviderId = '',
  connectivityResult?: ProviderConnectivityResult,
  overrides: Partial<Parameters<typeof FirstRunGuideProviderFields>[0]> = {},
): ReactElement {
  return FirstRunGuideProviderFields({
    t,
    guideUsesCustomProvider: true,
    selectedProvider,
    selectedProviderRequest: selectedProvider,
    selectedProviderChatModels: selectedProvider.models ?? [],
    selectedProviderConnectivityField:
      connectivityResult?.tone === 'error' ? connectivityResult.field : 'none',
    selectedProviderConnectivityStatusId: connectivityResult
      ? `guide-provider-status-${selectedProvider.id}`
      : undefined,
    selectedProviderConnectivityResult: connectivityResult,
    providerKeys: {
      [selectedProvider.id]: 'provider-key',
    },
    guideProviderKeyTitle: 'Provider key',
    guideProviderKeyHelpUrl: 'https://example.test/key',
    guideModelChoicesVisible: true,
    loadingModelsProviderId,
    checkingProviderId,
    renderSecretInput: () => <input />,
    renderNotice: () => null,
    onUpdateProvider: vi.fn(),
    onUpdateProviderKey: vi.fn(),
    onSelectProviderModel: vi.fn(),
    onRefreshProviderModels: vi.fn(),
    onCheckProviderFullCapabilities: vi.fn(),
    onCommitEditsOnBlur: vi.fn(),
    ...overrides,
  }) as ReactElement
}

describe('FirstRunGuideProviderFields', () => {
  it('contains synchronous guide provider model action failures at the leaf boundary', () => {
    const onRefreshProviderModels = vi.fn(() => {
      throw new Error('model refresh failed before returning a promise')
    })
    const tree = renderFields(provider(), '', '', undefined, {
      onRefreshProviderModels,
    })
    const modelFetchButton = findByProp(
      tree,
      'data-model-fetch-button',
      'guide',
    )

    expect(() => {
      ;(modelFetchButton.props.onClick as () => void)()
    }).not.toThrow()
    expect(onRefreshProviderModels).toHaveBeenCalledWith('openai')
  })

  it('contains rejected guide provider capability actions without leaking the promise', async () => {
    const onCheckProviderFullCapabilities = vi.fn(() =>
      Promise.reject(new Error('full capability check failed')),
    )
    const tree = renderFields(provider(), '', '', undefined, {
      onCheckProviderFullCapabilities,
    })
    const fullCapabilityButton = findByProp(
      tree,
      'data-guide-provider-full-capability-check',
      'true',
    )

    expect(fullCapabilityButton.props.disabled).toBe(false)
    ;(fullCapabilityButton.props.onClick as () => void)()
    await Promise.resolve()

    expect(onCheckProviderFullCapabilities).toHaveBeenCalledWith('openai')
  })

  it('defers advanced capability checks until first-run access is configured', () => {
    const unconfiguredTree = renderFields(provider(), '', '', undefined, {
      providerKeys: { openai: '' },
    })

    expect(
      findByPropOptional(
        unconfiguredTree,
        'data-guide-provider-full-capability-check',
        'true',
      ),
    ).toBeNull()
    expect(
      findByPropOptional(
        unconfiguredTree,
        'data-guide-provider-capability-readiness',
        'server-drill',
      ),
    ).toBeNull()

    const configuredTree = renderFields()

    expect(
      findByPropOptional(
        configuredTree,
        'data-guide-provider-full-capability-check',
        'true',
      ),
    ).not.toBeNull()
  })

  it('names first-run default model manual input and fetched-model select separately', () => {
    const tree = renderFields(provider())
    const manualInput = findByProp(
      tree,
      'data-provider-default-model-field',
      'true',
    )
    const fetchedModelSelect = findByProp(
      tree,
      'className',
      'model-list-select',
    )

    expect(manualInput.props['aria-label']).toBe(
      'field.defaultModel: placeholder.manualOrFetchModel',
    )
    expect(fetchedModelSelect.props['aria-label']).toBe(
      'field.defaultModel: option.emptyModel',
    )
    expect(manualInput.props['aria-label']).not.toBe(
      fetchedModelSelect.props['aria-label'],
    )
    expect(manualInput.props['aria-describedby']).toBe(
      'guide-default-model-hint-openai',
    )
    expect(fetchedModelSelect.props['aria-describedby']).toBe(
      'guide-default-model-hint-openai',
    )
  })

  it('places custom relay connection requirements before optional relay controls', () => {
    const tree = renderFields(provider())
    const labels = textNodes(tree)
    const baseUrlIndex = labels.indexOf('field.baseUrl')
    const providerKeyIndex = labels.indexOf('field.providerKey')
    const defaultModelIndex = labels.indexOf('field.defaultModel')
    const providerNameIndex = labels.indexOf('field.name')
    const interfaceTypeIndex = labels.indexOf('field.interfaceType')
    const proxyUrlIndex = labels.indexOf('field.proxyUrl')

    expect(baseUrlIndex).toBeGreaterThanOrEqual(0)
    expect(providerKeyIndex).toBeGreaterThan(baseUrlIndex)
    expect(defaultModelIndex).toBeGreaterThan(providerKeyIndex)
    expect(providerNameIndex).toBeGreaterThan(defaultModelIndex)
    expect(interfaceTypeIndex).toBeGreaterThan(providerNameIndex)
    expect(proxyUrlIndex).toBeGreaterThan(interfaceTypeIndex)
    expect(
      findByProp(tree, 'data-provider-base-url-field', 'true').props.autoFocus,
    ).toBe(true)
  })

  it('marks the AI proxy URL as browser-required after direct browser failure', () => {
    const tree = renderFields(provider(), '', '', {
      field: 'proxyUrl',
      message: 'direct browser path failed',
      retryable: true,
      tone: 'error',
    })
    const proxyInput = findByProp(
      tree,
      'data-provider-proxy-url-field',
      'true',
    )

    expect(textNodes(tree)).toContain('field.workerEndpoint')
    expect(proxyInput.props['aria-required']).toBe(true)
    expect(proxyInput.props.placeholder).toBe('placeholder.workerEndpoint')
  })

  it('keeps the latest successful capability probe visible in first-run setup', () => {
    const tree = renderFields(provider(), '', '', {
      field: 'none',
      message: 'all checks passed',
      retryable: false,
      tone: 'success',
      capabilityResults: {
        embeddings: {
          message: '/embeddings passed',
          model: 'embedding-model',
          status: 'passed',
          tone: 'success',
        },
      },
    })
    const chip = findByProp(
      tree,
      'data-provider-capability-check-result',
      'passed',
    )
    const status = findByProp(chip, 'className', 'capability-check-status success')

    expect(chip.props['aria-describedby']).toContain(
      'guide-provider-capability-check-result-openai-embeddings',
    )
    expect(status.props.id).toBe(
      'guide-provider-capability-check-result-openai-embeddings',
    )
    expect(status.props.title).toBeUndefined()
    expect(status.props['data-tooltip']).toBe('/embeddings passed')
    expect(textNodes(chip)).toContain('/embeddings passed')
  })

  it('disables full-capability checks until server-drill capabilities are runnable', () => {
    const realtimeProvider = provider({
      capabilities: ['chat', 'realtime', 'model-list'],
      models: ['chat-model', 'gpt-realtime'],
      realtimeModel: 'gpt-realtime',
    })
    const tree = renderFields(realtimeProvider)
    const fullCapabilityButton = findByProp(
      tree,
      'data-guide-provider-full-capability-check',
      'true',
    )

    expect(fullCapabilityButton.props.disabled).toBe(true)
    expect(fullCapabilityButton.props.title).toBeUndefined()
    expect(fullCapabilityButton.props['data-tooltip']).toBe(
      'error.realtimeServerDrill · capability.realtime',
    )
    expect(fullCapabilityButton.props['aria-describedby']).toBe(
      'guide-provider-capability-check-hint-openai guide-provider-capability-readiness-openai',
    )
    expect(
      findByProp(tree, 'id', 'guide-provider-capability-readiness-openai').props[
        'data-guide-provider-capability-readiness'
      ],
    ).toBe('server-drill')
  })

  it('does not label the current full-capability action as checking when another provider is busy', () => {
    const tree = renderFields(provider(), 'provider:other')
    const fullCapabilityButton = findByProp(
      tree,
      'data-guide-provider-full-capability-check',
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

  it('labels its own full-capability action as checking', () => {
    const tree = renderFields(
      provider(),
      providerFullCapabilityCheckKey('openai'),
    )
    const fullCapabilityButton = findByProp(
      tree,
      'data-guide-provider-full-capability-check',
      'true',
    )

    expect(fullCapabilityButton.props.disabled).toBe(true)
    expect(fullCapabilityButton.props.title).toBeUndefined()
    expect(fullCapabilityButton.props['data-tooltip']).toBe('button.checking')
    expect(nodeChildren(fullCapabilityButton)).toContain('button.checking')
    expect(nodeChildren(fullCapabilityButton)).not.toContain(
      'button.checkAllCapabilities',
    )
  })

  it('describes guide capability chips with their concrete readiness reason', () => {
    const realtimeProvider = provider({
      capabilities: ['chat', 'realtime', 'model-list'],
      models: ['chat-model', 'gpt-realtime'],
      realtimeModel: 'gpt-realtime',
    })
    const tree = renderFields(realtimeProvider)
    const capabilityList = findByProp(tree, 'role', 'list')
    const realtimeChip = findByProp(
      tree,
      'data-guide-provider-capability-check',
      'realtime',
    )

    expect(capabilityList.props['aria-describedby']).toBe(
      'guide-provider-capability-check-hint-openai',
    )
    expect(realtimeChip.props.role).toBe('listitem')
    expect(realtimeChip.props['aria-describedby']).toBe(
      'guide-provider-capability-check-hint-openai guide-provider-capability-check-description-openai-realtime',
    )
    expect(
      findByProp(
        tree,
        'id',
        'guide-provider-capability-check-description-openai-realtime',
      ).props.children,
    ).toBe(
      '/realtime/client_secrets · error.realtimeServerDrill · settings.capabilityCheckModel:{"model":"gpt-realtime"}',
    )
    const capabilityModel = findByProp(
      realtimeChip,
      'className',
      'capability-check-model',
    )
    const capabilityStatus = findByProp(
      realtimeChip,
      'className',
      'capability-check-status warning',
    )
    expect(capabilityModel.props.title).toBeUndefined()
    expect(capabilityModel.props['data-tooltip']).toBe(
      capabilityModel.props['aria-label'],
    )
    expect(capabilityStatus.props.title).toBeUndefined()
    expect(capabilityStatus.props['data-tooltip']).toBe(
      capabilityModel.props['data-tooltip'],
    )
  })

  it('does not label the current model-fetch action as fetching when another provider is busy', () => {
    const tree = renderFields(provider(), '', 'other')
    const modelFetchButton = findByProp(
      tree,
      'data-model-fetch-button',
      'guide',
    )
    const modelFetchWrapper = findByProp(
      tree,
      'className',
      'model-fetch-tooltip-target',
    )
    const refreshIcon = findByProp(modelFetchButton, 'size', 16)

    expect(modelFetchButton.props.disabled).toBe(true)
    expect(modelFetchButton.props.title).toBeUndefined()
    expect(modelFetchButton.props['data-tooltip']).toBe('button.fetchModels')
    expect(modelFetchWrapper.props.title).toBeUndefined()
    expect(modelFetchWrapper.props['data-tooltip']).toBe('button.fetchModels')
    expect(nodeChildren(modelFetchButton)).toContain('button.fetchModels')
    expect(nodeChildren(modelFetchButton)).not.toContain(
      'button.fetchingModels',
    )
    expect(refreshIcon.props.className).toBe('')
  })
})
