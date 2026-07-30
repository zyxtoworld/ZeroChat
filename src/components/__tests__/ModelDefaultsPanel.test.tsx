import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import {
  modelsForProviderCapability,
} from '../../services/providerModels'
import type { ModelCheckKind } from '../../services/providerStatus'
import type { ProviderConfig } from '../../types'
import { ModelDefaultsPanel } from '../ModelDefaultsPanel'

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

function renderPanel(
  selectedProvider = provider(),
  checkingProviderId = '',
  overrides: {
    onCheckModel?: (providerId: string, kind: ModelCheckKind) => void | Promise<void>
  } = {},
): ReactElement {
  const models = selectedProvider.models ?? []

  return ModelDefaultsPanel({
    t,
    selectedProvider,
    selectedProviderModels: models,
    selectedProviderAudioSpeechModels: modelsForProviderCapability(
      selectedProvider,
      'audio-speech',
    ),
    selectedProviderAudioTranscriptionModels: modelsForProviderCapability(
      selectedProvider,
      'audio-transcription',
    ),
    selectedProviderChatModels: modelsForProviderCapability(
      selectedProvider,
      'chat',
    ),
    selectedProviderEmbeddingModels: modelsForProviderCapability(
      selectedProvider,
      'embeddings',
    ),
    selectedProviderImageModels: modelsForProviderCapability(
      selectedProvider,
      'image-generation',
    ),
    selectedProviderModerationModels: modelsForProviderCapability(
      selectedProvider,
      'moderation',
    ),
    selectedProviderRealtimeModels: modelsForProviderCapability(
      selectedProvider,
      'realtime',
    ),
    chatContextMessageLimit: 20,
    checkingProviderId,
    renderFieldNotice: () => null,
    onSelectAudioSpeechModel: vi.fn(),
    onSelectAudioTranscriptionModel: vi.fn(),
    onSelectChatModel: vi.fn(),
    onSelectEmbeddingModel: vi.fn(),
    onSelectImageModel: vi.fn(),
    onSelectModerationModel: vi.fn(),
    onSelectRealtimeModel: vi.fn(),
    onCheckModel: overrides.onCheckModel ?? vi.fn(),
    onChangeChatContextMessageLimit: vi.fn(),
    onCommitEditsOnBlur: vi.fn(),
  }) as ReactElement
}

async function invokeHandler(handler: unknown): Promise<void> {
  expect(typeof handler).toBe('function')
  await (handler as () => unknown)()
}

describe('ModelDefaultsPanel', () => {
  it('does not label the current model check as checking when another provider is busy', () => {
    const tree = renderPanel(provider(), 'other:chat')
    const chatModelCheckButton = findByProp(
      tree,
      'data-model-check-kind',
      'chat',
    )

    expect(chatModelCheckButton.props.disabled).toBe(true)
    expect(chatModelCheckButton.props.title).toBeUndefined()
    expect(chatModelCheckButton.props['aria-label']).toBe(
      'button.checkModel: field.defaultModel',
    )
    expect(nodeChildren(chatModelCheckButton)).toContain('button.checkModel')
    expect(nodeChildren(chatModelCheckButton)).not.toContain('button.checking')
  })

  it('labels only the active model check as checking', () => {
    const tree = renderPanel(provider(), 'openai:chat')
    const chatModelCheckButton = findByProp(
      tree,
      'data-model-check-kind',
      'chat',
    )
    const imageModelCheckButton = findByProp(
      tree,
      'data-model-check-kind',
      'image',
    )

    expect(chatModelCheckButton.props.disabled).toBe(true)
    expect(chatModelCheckButton.props.title).toBeUndefined()
    expect(chatModelCheckButton.props['aria-label']).toBe(
      'button.checking: field.defaultModel',
    )
    expect(nodeChildren(chatModelCheckButton)).toContain('button.checking')
    expect(imageModelCheckButton.props.disabled).toBe(true)
    expect(imageModelCheckButton.props.title).toBeUndefined()
    expect(imageModelCheckButton.props['aria-label']).toBe(
      'button.checkModel: field.imageModel',
    )
    expect(nodeChildren(imageModelCheckButton)).toContain('button.checkModel')
    expect(nodeChildren(imageModelCheckButton)).not.toContain('button.checking')
  })

  it('names repeated model check actions with the target field', () => {
    const tree = renderPanel(provider())
    const chatModelCheckButton = findByProp(
      tree,
      'data-model-check-kind',
      'chat',
    )
    const imageModelCheckButton = findByProp(
      tree,
      'data-model-check-kind',
      'image',
    )
    const embeddingModelCheckButton = findByProp(
      tree,
      'data-model-check-kind',
      'embeddings',
    )
    const audioSpeechModelCheckButton = findByProp(
      tree,
      'data-model-check-kind',
      'audio-speech',
    )

    expect(chatModelCheckButton.props['aria-label']).toBe(
      'button.checkModel: field.defaultModel',
    )
    expect(imageModelCheckButton.props['aria-label']).toBe(
      'button.checkModel: field.imageModel',
    )
    expect(embeddingModelCheckButton.props['aria-label']).toBe(
      'button.checkModel: field.embeddingModel',
    )
    expect(audioSpeechModelCheckButton.props['aria-label']).toBe(
      'button.checkModel: field.audioSpeechModel',
    )
    expect(chatModelCheckButton.props['aria-label']).not.toBe(
      imageModelCheckButton.props['aria-label'],
    )
    expect(chatModelCheckButton.props.title).toBeUndefined()
    expect(audioSpeechModelCheckButton.props.title).toBeUndefined()

    const tooltipTargets = findAllByProp(
      tree,
      'className',
      'model-check-tooltip-target',
    )
    expect(tooltipTargets[0]?.props.title).toBeUndefined()
    expect(tooltipTargets[0]?.props['data-tooltip']).toBe(
      'settings.modelConnectivityCheckNote',
    )
    expect(tooltipTargets[2]?.props.title).toBeUndefined()
    expect(tooltipTargets[2]?.props['data-tooltip']).toBe(
      'option.noAudioModels',
    )
  })

  it('contains synchronous default model check failures at the leaf action boundary', async () => {
    const onCheckModel = vi.fn(() => {
      throw new Error('model check failed')
    })
    const tree = renderPanel(provider(), '', { onCheckModel })
    const chatModelCheckButton = findByProp(
      tree,
      'data-model-check-kind',
      'chat',
    )

    await expect(invokeHandler(chatModelCheckButton.props.onClick)).resolves.toBeUndefined()

    expect(onCheckModel).toHaveBeenCalledWith('openai', 'chat')
  })

  it('contains rejected default model checks without leaking the promise', async () => {
    const onCheckModel = vi.fn(() => Promise.reject(new Error('model check failed')))
    const tree = renderPanel(provider(), '', { onCheckModel })
    const chatModelCheckButton = findByProp(
      tree,
      'data-model-check-kind',
      'chat',
    )

    await expect(invokeHandler(chatModelCheckButton.props.onClick)).resolves.toBeUndefined()
  })
})
