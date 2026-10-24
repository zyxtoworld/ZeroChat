import type { ModelMetadata, ProviderCapability, ProviderConfig } from '../types'

const MODELS_DEV_API_URL = 'https://models.dev/api.json'

type ModelsDevModel = {
  id?: unknown
  name?: unknown
  canonical_model_id?: unknown
  tool_call?: unknown
  modalities?: {
    input?: unknown
    output?: unknown
  }
  limit?: {
    context?: unknown
    input?: unknown
    output?: unknown
  }
}

type ModelsDevProvider = {
  api?: unknown
  models?: Record<string, ModelsDevModel>
}

type ModelsDevCatalog = Record<string, ModelsDevProvider>

let catalogPromise: Promise<ModelsDevCatalog> | null = null

function positiveInteger(value: unknown): number | undefined {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) return undefined
  return Number(value)
}

function normalizedUrl(value: string): string {
  return value.trim().replace(/\/+$/u, '').toLowerCase()
}

function normalizedModelId(value: string): string {
  return value.trim().toLowerCase()
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function listValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function providerMatches(provider: ProviderConfig, catalogProvider: ModelsDevProvider): boolean {
  const api = stringValue(catalogProvider.api)
  return Boolean(api && normalizedUrl(api) === normalizedUrl(provider.baseUrl))
}

function modelMatches(modelId: string, model: ModelsDevModel, key: string): boolean {
  const target = normalizedModelId(modelId)
  return [key, stringValue(model.id), stringValue(model.canonical_model_id)]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizedModelId(value) === target)
}

function modelCapabilities(model: ModelsDevModel): ProviderCapability[] {
  const capabilities = new Set<ProviderCapability>(['chat'])
  const input = listValue(model.modalities?.input).map((entry) => entry.toLowerCase())
  const output = listValue(model.modalities?.output).map((entry) => entry.toLowerCase())
  const modelId = `${stringValue(model.id) ?? ''} ${stringValue(model.canonical_model_id) ?? ''}`
    .toLowerCase()

  if (Boolean(model.tool_call)) capabilities.add('tools')
  if (input.some((entry) => entry.includes('image'))) capabilities.add('vision')
  if (output.some((entry) => entry.includes('image'))) capabilities.add('image-generation')
  if (input.some((entry) => entry.includes('audio')) || output.some((entry) => entry.includes('audio'))) {
    capabilities.add('audio')
  }
  if (input.some((entry) => entry.includes('video')) || output.some((entry) => entry.includes('video'))) {
    capabilities.add('video')
  }
  if (/embed/u.test(modelId)) capabilities.add('embeddings')
  if (/moderation/u.test(modelId)) capabilities.add('moderation')
  if (/realtime|live/u.test(modelId)) capabilities.add('realtime')

  return [...capabilities]
}

function toMetadata(modelId: string, model: ModelsDevModel): ModelMetadata {
  const contextWindowTokens = positiveInteger(model.limit?.context)
  const maxInputTokens = positiveInteger(model.limit?.input)
  const maxOutputTokens = positiveInteger(model.limit?.output)

  return {
    id: modelId,
    displayName: stringValue(model.name),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxInputTokens ? { maxInputTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    capabilities: modelCapabilities(model),
    source: 'models-dev',
    verifiedAt: Date.now(),
  }
}

async function loadCatalog(fetcher: typeof fetch = fetch): Promise<ModelsDevCatalog> {
  if (!catalogPromise) {
    catalogPromise = fetcher(MODELS_DEV_API_URL, {
      headers: { accept: 'application/json' },
    })
      .then((response) => {
        if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`)
        return response.json() as Promise<ModelsDevCatalog>
      })
      .then((catalog) => {
        if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
          throw new Error('models.dev returned an invalid catalog')
        }
        return catalog
      })
      .catch((error) => {
        catalogPromise = null
        throw error
      })
  }

  return catalogPromise
}

export function clearModelsDevCatalogCache(): void {
  catalogPromise = null
}

export async function modelMetadataForProviderModels(
  provider: ProviderConfig,
  modelIds: string[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, ModelMetadata>> {
  const catalog = await loadCatalog(fetcher)
  const entries = Object.entries(catalog).flatMap(([providerId, catalogProvider]) =>
    Object.entries(catalogProvider.models ?? {}).map(([key, model]) => ({
      providerId,
      catalogProvider,
      key,
      model,
    })),
  )
  const providerMatched = entries.filter(({ catalogProvider }) =>
    providerMatches(provider, catalogProvider),
  )
  const output: Record<string, ModelMetadata> = {}

  for (const modelId of modelIds) {
    const exactProviderMatch = providerMatched.find(({ key, model }) =>
      modelMatches(modelId, model, key),
    )
    const exactAnyProviderMatch = entries.find(({ key, model }) =>
      modelMatches(modelId, model, key),
    )
    const match = exactProviderMatch ?? exactAnyProviderMatch
    if (!match) continue
    output[modelId] = toMetadata(modelId, match.model)
  }

  return output
}

export function metadataForModel(
  provider: ProviderConfig,
  modelId: string,
): ModelMetadata | undefined {
  return provider.modelMetadata?.[modelId] ?? provider.modelMetadata?.[modelId.trim()]
}

export function effectiveInputTokenBudget(
  provider: ProviderConfig,
  modelId: string,
  fallback = 12_000,
): number {
  const metadata = metadataForModel(provider, modelId)
  const contextWindow = metadata?.maxInputTokens ?? metadata?.contextWindowTokens
  if (!contextWindow) return fallback

  const reservedOutput =
    metadata?.maxOutputTokens ?? Math.min(8_192, Math.floor(contextWindow * 0.2))
  return Math.max(1_024, contextWindow - reservedOutput)
}

export { MODELS_DEV_API_URL }
