import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type { ProviderConfig } from '../../types'
import { ModelCatalogEditor } from '../ModelCatalogEditor'

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
  if (Array.isArray(node)) return node
  if (!node || typeof node !== 'object') return []
  const props = (node as { props?: { children?: unknown } }).props
  const children = props?.children
  return Array.isArray(children) ? children : children ? [children] : []
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
): Array<{ props: Record<string, unknown> }> {
  const matches: Array<{ props: Record<string, unknown> }> = []

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

function findAllByClassNameToken(
  node: unknown,
  classNameToken: string,
): Array<{ props: Record<string, unknown> }> {
  const matches: Array<{ props: Record<string, unknown> }> = []

  if (node && typeof node === 'object') {
    const props = (node as { props?: Record<string, unknown> }).props
    if (
      typeof props?.className === 'string' &&
      props.className.split(/\s+/).includes(classNameToken)
    ) {
      matches.push({ props })
    }
  }

  for (const child of nodeChildren(node)) {
    matches.push(...findAllByClassNameToken(child, classNameToken))
  }

  return matches
}

function renderEditor(
  selectedProvider = provider(),
  loadingModelsProviderId = '',
  overrides: {
    onCommitEditsOnBlur?: () => void
    onMoveModel?: (
      providerId: string,
      model: string,
      direction: 'up' | 'down',
    ) => void
    onRefreshModels?: (providerId: string) => void | Promise<void>
    onRemoveProviderModel?: (
      providerId: string,
      model: string,
    ) => void | Promise<void>
  } = {},
): ReactElement {
  return ModelCatalogEditor({
    t,
    selectedProvider,
    selectedProviderModels: selectedProvider.models ?? [],
    loadingModelsProviderId,
    editingModelProviderId: '',
    editingModelSource: '',
    editingModelDraft: '',
    modelDraftProviderId: '',
    modelDraft: '',
    renderNotice: () => null,
    onRefreshModels: overrides.onRefreshModels ?? vi.fn(),
    onBeginEditProviderModel: vi.fn(),
    onEditingModelDraftChange: vi.fn(),
    onCommitProviderModelRename: vi.fn(),
    onModelRenameKeyDown: vi.fn(),
    onClearModelRenameDraft: vi.fn(),
    onRemoveProviderModel: overrides.onRemoveProviderModel ?? vi.fn(),
    onModelDragStart: vi.fn(),
    onModelDrop: vi.fn(),
    onMoveModel: overrides.onMoveModel ?? vi.fn(),
    onModelDraftChange: vi.fn(),
    onModelDraftKeyDown: vi.fn(),
    onCommitModelDraft: vi.fn(),
    onCommitEditsOnBlur: overrides.onCommitEditsOnBlur ?? vi.fn(),
  }) as ReactElement
}

async function invokeHandler(
  handler: unknown,
  ...args: unknown[]
): Promise<void> {
  expect(typeof handler).toBe('function')
  await (handler as (...handlerArgs: unknown[]) => unknown)(...args)
}

describe('ModelCatalogEditor', () => {
  it('names the model chip list with the selected provider', () => {
    const tree = renderEditor(provider())
    const modelChipList = findByProp(
      tree,
      'className',
      'model-chip-list',
    )

    expect(modelChipList.props.role).toBe('group')
    expect(modelChipList.props['aria-label']).toBe('OpenAI: field.models')
    expect(modelChipList.props['aria-describedby']).toBe(
      'model-list-hint-openai',
    )
    expect(modelChipList.props['aria-label']).not.toBe(
      'settings.dragModelHint',
    )
  })

  it('describes model capability chips as a labelled list', () => {
    const tree = renderEditor(
      provider({
        imageModel: 'gpt-image-2',
        model: 'gpt-image-2',
        models: ['gpt-image-2'],
      }),
    )
    const capabilityList = findByProp(
      tree,
      'className',
      'model-chip-capabilities',
    )
    const capabilityItem = findByProp(
      capabilityList,
      'className',
      'model-chip-capability',
    )

    expect(capabilityList.props.role).toBe('list')
    expect(capabilityList.props['aria-label']).toBe(
      'gpt-image-2: capability.image-generation / capability.image-editing',
    )
    expect(capabilityItem.props.role).toBe('listitem')
    expect(capabilityItem.props.title).toBeUndefined()
    expect(capabilityItem.props['data-tooltip']).toBe(
      'capability.image-generation',
    )
    expect(nodeChildren(capabilityItem)).toContain(
      'capability.image-generation',
    )
  })

  it('names repeated model delete actions with the model name', () => {
    const tree = renderEditor(
      provider({
        models: ['chat-model', 'image-model'],
      }),
    )
    const deleteButtons = findAllByProp(
      tree,
      'className',
      'model-chip-delete',
    )

    expect(deleteButtons.map((button) => button.props['aria-label'])).toEqual([
      'button.deleteModel: chat-model',
      'button.deleteModel: image-model',
    ])
    expect(deleteButtons.map((button) => button.props.title)).toEqual([
      undefined,
      undefined,
    ])
    expect(deleteButtons.map((button) => button.props['aria-label'])).not.toContain(
      'button.deleteModel',
    )
  })

  it('names repeated model name fields with the model name', () => {
    const tree = renderEditor(
      provider({
        models: ['chat-model', 'image-model'],
      }),
    )
    const modelNameInputs = findAllByProp(
      tree,
      'className',
      'model-chip-edit',
    )

    expect(modelNameInputs.map((input) => input.props['aria-label'])).toEqual([
      'field.modelName: chat-model',
      'field.modelName: image-model',
    ])
    expect(modelNameInputs.map((input) => input.props['aria-label'])).not.toContain(
      'field.modelName',
    )
  })

  it('names repeated model drag hints with the model name', () => {
    const tree = renderEditor(
      provider({
        models: ['chat-model', 'image-model'],
      }),
    )
    const modelChips = findAllByClassNameToken(tree, 'model-chip')

    expect(modelChips).toHaveLength(2)
    expect(modelChips.map((chip) => chip.props.title)).toEqual([
      undefined,
      undefined,
    ])
    expect(modelChips.map((chip) => chip.props['data-tooltip'])).toEqual([
      undefined,
      undefined,
    ])
    expect(modelChips.map((chip) => chip.props.role)).toEqual([
      'group',
      'group',
    ])
    expect(modelChips.map((chip) => chip.props['aria-label'])).toEqual([
      'chat-model: settings.dragModelHint',
      'image-model: settings.dragModelHint',
    ])
    expect(modelChips.map((chip) => chip.props.title)).not.toContain(
      'settings.dragModelHint',
    )
  })

  it('contains model catalog drag dropEffect setter failures', async () => {
    const tree = renderEditor(
      provider({
        models: ['chat-model'],
      }),
    )
    const modelChip = findByProp(
      tree,
      'aria-label',
      'chat-model: settings.dragModelHint',
    )
    const preventDefault = vi.fn()
    const dataTransfer = Object.defineProperty({}, 'dropEffect', {
      set() {
        throw new Error('readonly dropEffect')
      },
    })

    await expect(
      invokeHandler(modelChip.props.onDragOver, {
        preventDefault,
        dataTransfer,
      }),
    ).resolves.toBeUndefined()

    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('exposes keyboard model move actions with model names and bounds', () => {
    const onMoveProviderModel = vi.fn()
    const onCommitEditsOnBlur = vi.fn()
    const tree = renderEditor(
      provider({
        models: ['chat-model', 'image-model'],
      }),
      '',
      {
        onCommitEditsOnBlur,
        onMoveModel: onMoveProviderModel,
      },
    )
    const moveButtons = findAllByProp(
      tree,
      'className',
      'model-chip-move',
    )

    expect(moveButtons).toHaveLength(4)
    expect(moveButtons.map((button) => button.props['aria-label'])).toEqual([
      'button.up: chat-model',
      'button.down: chat-model',
      'button.up: image-model',
      'button.down: image-model',
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

    expect(onMoveProviderModel).toHaveBeenCalledWith(
      'openai',
      'chat-model',
      'down',
    )
    expect(onCommitEditsOnBlur).toHaveBeenCalledTimes(1)
  })

  it('keeps model catalog action buttons out of implicit form submission', () => {
    const tree = renderEditor(
      provider({
        models: ['chat-model', 'image-model'],
      }),
    )
    const modelFetchButton = findByProp(
      tree,
      'data-model-fetch-button',
      'settings',
    )
    const moveButtons = findAllByProp(
      tree,
      'className',
      'model-chip-move',
    )
    const deleteButtons = findAllByProp(
      tree,
      'className',
      'model-chip-delete',
    )
    const compactButtons = findAllByProp(
      tree,
      'className',
      'ghost-button compact-button',
    )

    expect(modelFetchButton.props.type).toBe('button')
    expect(compactButtons).toHaveLength(2)
    expect(
      compactButtons.every((button) => button.props.type === 'button'),
    ).toBe(true)
    expect(moveButtons).toHaveLength(4)
    expect(moveButtons.every((button) => button.props.type === 'button')).toBe(
      true,
    )
    expect(deleteButtons).toHaveLength(2)
    expect(
      deleteButtons.every((button) => button.props.type === 'button'),
    ).toBe(true)
  })

  it('does not label the current model-fetch action as fetching when another provider is busy', () => {
    const tree = renderEditor(provider(), 'other')
    const modelFetchButton = findByProp(
      tree,
      'data-model-fetch-button',
      'settings',
    )
    const modelFetchWrapper = findByProp(
      tree,
      'className',
      'model-fetch-tooltip-target',
    )
    const refreshIcon = findByProp(modelFetchButton, 'className', '')

    expect(modelFetchButton.props.disabled).toBe(true)
    expect(modelFetchButton.props.title).toBeUndefined()
    expect(modelFetchButton.props['data-tooltip']).toBeUndefined()
    expect(modelFetchWrapper.props.title).toBeUndefined()
    expect(modelFetchWrapper.props['data-tooltip']).toBe('button.fetchModels')
    expect(nodeChildren(modelFetchButton)).toContain('button.fetchModels')
    expect(nodeChildren(modelFetchButton)).not.toContain(
      'button.fetchingModels',
    )
    expect(refreshIcon.props.className).toBe('')
  })

  it('contains synchronous model catalog action failures at the leaf action boundary', async () => {
    const onRefreshModels = vi.fn(() => {
      throw new Error('refresh failed')
    })
    const onRemoveProviderModel = vi.fn(() => {
      throw new Error('remove failed')
    })
    const onCommitEditsOnBlur = vi.fn()
    const tree = renderEditor(provider(), '', {
      onCommitEditsOnBlur,
      onRefreshModels,
      onRemoveProviderModel,
    })
    const modelFetchButton = findByProp(
      tree,
      'data-model-fetch-button',
      'settings',
    )
    const deleteButton = findAllByProp(
      tree,
      'className',
      'model-chip-delete',
    )[0]

    await expect(invokeHandler(modelFetchButton.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(deleteButton?.props.onClick)).resolves.toBeUndefined()

    expect(onRefreshModels).toHaveBeenCalledWith('openai')
    expect(onRemoveProviderModel).toHaveBeenCalledWith('openai', 'chat-model')
    expect(onCommitEditsOnBlur).toHaveBeenCalledTimes(1)
  })

  it('contains rejected model catalog actions without leaking the promise', async () => {
    const onRefreshModels = vi.fn(() => Promise.reject(new Error('refresh failed')))
    const onRemoveProviderModel = vi.fn(() =>
      Promise.reject(new Error('remove failed')),
    )
    const tree = renderEditor(provider(), '', {
      onRefreshModels,
      onRemoveProviderModel,
    })
    const modelFetchButton = findByProp(
      tree,
      'data-model-fetch-button',
      'settings',
    )
    const deleteButton = findAllByProp(
      tree,
      'className',
      'model-chip-delete',
    )[0]

    await expect(invokeHandler(modelFetchButton.props.onClick)).resolves.toBeUndefined()
    await expect(invokeHandler(deleteButton?.props.onClick)).resolves.toBeUndefined()
  })
})
