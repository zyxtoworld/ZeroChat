import type { ProviderConfig } from '../types'
import {
  configuredModelsForProvider,
  parseModelListInput,
  providerModelPatchFromModels,
} from '../services/providerModels'

export type ProviderModelCatalogPatch = ReturnType<
  typeof providerModelPatchFromModels
>

interface FinishProviderModelRemovalOptions {
  accepted: boolean
  removedModel: string
  renamingModel: string
  clearRename: () => void
  restoreFocus: () => void
}

interface ModelDraftKeyboardEvent {
  isComposing?: boolean
  key: string
  keyCode?: number
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
  }
}

interface ProviderModelRenameActionCandidate {
  closest: (selector: string) =>
    | {
        getAttribute: (name: string) => string | null
      }
    | null
  getAttribute: (name: string) => string | null
}

export function providerModelRenameActionTarget<
  T extends ProviderModelRenameActionCandidate,
>(candidates: Iterable<T>, providerId: string, model: string): T | null {
  for (const candidate of candidates) {
    if (
      candidate.getAttribute('data-provider-model-rename-action') === model &&
      candidate
        .closest('[data-provider-id]')
        ?.getAttribute('data-provider-id') === providerId
    ) {
      return candidate
    }
  }
  return null
}

export function providerModelDraftKeyShouldCommit(
  event: ModelDraftKeyboardEvent,
): boolean {
  const composing = Boolean(
    event.isComposing ||
      event.nativeEvent?.isComposing ||
      event.keyCode === 229 ||
      event.nativeEvent?.keyCode === 229,
  )
  return event.key === 'Enter' && !composing
}

export function finishProviderModelRemoval({
  accepted,
  removedModel,
  renamingModel,
  clearRename,
  restoreFocus,
}: FinishProviderModelRemovalOptions): boolean {
  if (!accepted) return false
  if (renamingModel === removedModel) clearRename()
  restoreFocus()
  return true
}

export function providerModelPatchAfterAppend(
  provider: ProviderConfig,
  draft: string,
): ProviderModelCatalogPatch {
  const appended = parseModelListInput(draft.replace(/,/g, ' '))
  return providerModelPatchFromModels(provider, [
    ...configuredModelsForProvider(provider),
    ...appended,
  ])
}

export function providerModelPatchAfterRemove(
  provider: ProviderConfig,
  model: string,
): ProviderModelCatalogPatch {
  return providerModelPatchFromModels(
    provider,
    configuredModelsForProvider(provider).filter((candidate) => candidate !== model),
  )
}

export function providerModelPatchAfterRename(
  provider: ProviderConfig,
  sourceModel: string,
  draft: string,
): ProviderModelCatalogPatch | null {
  const renamedModel = draft.trim()
  const models = configuredModelsForProvider(provider)
  if (
    !sourceModel ||
    !renamedModel ||
    sourceModel === renamedModel ||
    !models.includes(sourceModel)
  ) {
    return null
  }

  return providerModelPatchFromModels(
    provider,
    models.map((model) => (model === sourceModel ? renamedModel : model)),
    provider.model === sourceModel ? renamedModel : provider.model,
  )
}

export function providerModelPatchAfterReorder(
  provider: ProviderConfig,
  sourceModel: string,
  targetModel: string,
): ProviderModelCatalogPatch | null {
  if (!sourceModel || !targetModel || sourceModel === targetModel) return null
  const models = configuredModelsForProvider(provider)
  const sourceIndex = models.indexOf(sourceModel)
  const targetIndex = models.indexOf(targetModel)
  if (sourceIndex < 0 || targetIndex < 0) return null

  const nextModels = [...models]
  const [movedModel] = nextModels.splice(sourceIndex, 1)
  if (!movedModel) return null
  nextModels.splice(targetIndex, 0, movedModel)
  return providerModelPatchFromModels(provider, nextModels)
}
