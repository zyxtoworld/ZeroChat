import { describe, expect, it } from 'vitest'

import type { ProviderConfig } from '../../types'
import {
  clearModelsDevCatalogCache,
  effectiveInputTokenBudget,
  modelMetadataForProviderModels,
} from '../modelMetadata'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: 'OpenAI',
    kind: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.6-luna',
    models: ['gpt-5.6-luna'],
    enabled: true,
    needsApiKey: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('models.dev metadata', () => {
  it('normalizes context, output, modality, and tool metadata', async () => {
    clearModelsDevCatalogCache()
    const metadata = await modelMetadataForProviderModels(
      provider(),
      ['gpt-5.6-luna'],
      async () =>
        Response.json({
          openai: {
            api: 'https://api.openai.com/v1',
            models: {
              'gpt-5.6-luna': {
                id: 'gpt-5.6-luna',
                name: 'GPT-5.6 Luna',
                tool_call: true,
                modalities: { input: ['text', 'image/png'], output: ['text'] },
                limit: { context: 1050000, input: 922000, output: 128000 },
              },
            },
          },
        }),
    )

    expect(metadata['gpt-5.6-luna']).toMatchObject({
      contextWindowTokens: 1050000,
      maxInputTokens: 922000,
      maxOutputTokens: 128000,
      capabilities: ['chat', 'tools', 'vision'],
      source: 'models-dev',
    })
  })

  it('falls back to canonical model ids when provider endpoints are absent', async () => {
    clearModelsDevCatalogCache()
    const metadata = await modelMetadataForProviderModels(
      provider({ baseUrl: 'https://relay.example.com/v1' }),
      ['gpt-5.6-luna'],
      async () =>
        Response.json({
          catalog: {
            api: 'https://catalog.example.com/v1',
            models: {
              'gpt-5.6-luna': {
                id: 'gpt-5.6-luna',
                canonical_model_id: 'openai/gpt-5.6-luna',
                limit: { context: 100000, output: 10000 },
                modalities: { input: ['text'], output: ['text'] },
              },
            },
          },
        }),
    )

    expect(metadata['gpt-5.6-luna']?.contextWindowTokens).toBe(100000)
  })

  it('reserves output budget before selecting a request input budget', () => {
    const configured = provider({
      modelMetadata: {
        'gpt-5.6-luna': {
          id: 'gpt-5.6-luna',
          contextWindowTokens: 100000,
          maxOutputTokens: 16000,
          source: 'models-dev',
        },
      },
    })

    expect(effectiveInputTokenBudget(configured, 'gpt-5.6-luna')).toBe(84000)
    expect(effectiveInputTokenBudget(provider(), 'missing')).toBe(12000)
  })
})
