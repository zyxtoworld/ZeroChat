import { describe, expect, it } from 'vitest'

import type { ProviderConfig } from '../../types'
import {
  modelCheckKey,
  providerCheckKey,
  providerConnectivityErrorField,
} from '../providerStatus'

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'Custom',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example/v1',
    model: 'model-a',
    imageModel: '',
    models: ['model-a'],
    capabilities: ['chat'],
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

describe('provider status helpers', () => {
  it('builds stable provider and model check keys shared by App and panels', () => {
    expect(providerCheckKey('provider-1')).toBe('provider:provider-1')
    expect(modelCheckKey('provider-1', 'audio-speech')).toBe(
      'provider-1:audio-speech',
    )
    expect(modelCheckKey('provider-1', 'audio-transcription')).toBe(
      'provider-1:audio-transcription',
    )
    expect(modelCheckKey('provider-1', 'chat')).toBe('provider-1:chat')
    expect(modelCheckKey('provider-1', 'embeddings')).toBe(
      'provider-1:embeddings',
    )
    expect(modelCheckKey('provider-1', 'image')).toBe('provider-1:image')
    expect(modelCheckKey('provider-1', 'moderation')).toBe(
      'provider-1:moderation',
    )
    expect(modelCheckKey('provider-1', 'realtime')).toBe(
      'provider-1:realtime',
    )
  })

  it('points connectivity errors at the actionable provider field', () => {
    expect(providerConnectivityErrorField(provider(), { code: 'auth' })).toBe(
      'providerKey',
    )
    expect(
      providerConnectivityErrorField(
        provider({ proxyUrl: 'https://proxy.example' }),
        new Error('network'),
      ),
    ).toBe('proxyUrl')
    expect(providerConnectivityErrorField(provider(), { code: 'network' })).toBe(
      'proxyUrl',
    )
    expect(providerConnectivityErrorField(provider(), { code: 'endpoint' })).toBe(
      'baseUrl',
    )
  })
})
