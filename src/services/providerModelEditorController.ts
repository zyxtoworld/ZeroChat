import type {
  DragEvent,
  KeyboardEvent,
} from 'react'
import {
  useCallback,
  useRef,
  useState,
} from 'react'
import type {
  AppData,
  ProviderConfig,
} from '../types'
import type { Translator } from '../i18n'
import {
  deleteModelDangerPrompt,
  type DangerPrompt,
} from './dangerConfirmation'
import {
  configuredModelsForProvider,
  isLikelyChatModel,
  isLikelyImageModel,
  parseModelListInput,
  preferredImageModel,
  providerModelPatchFromModels,
} from './providerModels'
import {
  commitProviderModelPatch,
  reportProviderModelSaveUnavailable,
} from './providerModelCatalogMutation'
import type { ProviderModelCatalogMutationContext } from './providerModelCatalogMutation'

type ProviderModelPatch = Pick<
  ProviderConfig,
  'imageModel' | 'model' | 'models'
>

interface ImeKeyboardEventLike {
  isComposing?: boolean
  key: string
  keyCode?: number
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
  }
}

function isImeCompositionEvent(event: ImeKeyboardEventLike): boolean {
  return Boolean(
    event.isComposing ||
      event.nativeEvent?.isComposing ||
      event.keyCode === 229 ||
      event.nativeEvent?.keyCode === 229,
  )
}

export function providerModelRenameKeyShouldCommit(
  event: ImeKeyboardEventLike,
): boolean {
  return event.key === 'Enter' && !isImeCompositionEvent(event)
}

export function providerModelDraftKeyShouldCommit(
  event: ImeKeyboardEventLike,
): boolean {
  return (
    !isImeCompositionEvent(event) &&
    (event.key === 'Enter' || event.key === ' ' || event.key === ',')
  )
}

export interface ProviderModelEditorControllerOptions
  extends ProviderModelCatalogMutationContext {
  data: AppData | null
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
}

interface RemoveProviderModelWithConfirmationOptions
  extends ProviderModelCatalogMutationContext {
  getProvider: () => ProviderConfig | null
  model: string
  providerId: string
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
}

export function providerModelPatchAfterAppend(
  provider: ProviderConfig,
  models: string[],
): ProviderModelPatch {
  return providerModelPatchFromModels(provider, [
    ...configuredModelsForProvider(provider),
    ...models,
  ])
}

export function providerModelPatchAfterRemove(
  provider: ProviderConfig,
  model: string,
): ProviderModelPatch {
  return providerModelPatchFromModels(
    provider,
    configuredModelsForProvider(provider).filter((item) => item !== model),
  )
}

interface ConfirmProviderModelRemovalOptions {
  model: string
  provider: ProviderConfig | null
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  setNotice: ProviderModelCatalogMutationContext['setNotice']
  t: Translator
}

export async function confirmProviderModelRemoval({
  model,
  provider,
  requestDangerConfirmation,
  setNotice,
  t,
}: ConfirmProviderModelRemovalOptions): Promise<boolean> {
  if (!provider) {
    return false
  }

  try {
    return await requestDangerConfirmation(
      deleteModelDangerPrompt(t, model, provider.name),
    )
  } catch {
    reportProviderModelSaveUnavailable({ setNotice, t })
    return false
  }
}

export function providerModelPatchAfterRename(
  provider: ProviderConfig,
  sourceModel: string,
  nextModel: string,
): ProviderModelPatch | null {
  const trimmedModel = nextModel.trim()

  if (!sourceModel || !trimmedModel || sourceModel === trimmedModel) {
    return null
  }

  const models = configuredModelsForProvider(provider)

  if (!models.includes(sourceModel)) {
    return null
  }

  return providerModelPatchFromModels(
    provider,
    models.map((model) => (model === sourceModel ? trimmedModel : model)),
    provider.model === sourceModel ? trimmedModel : provider.model,
  )
}

export function providerModelPatchAfterReorder(
  provider: ProviderConfig,
  sourceModel: string,
  targetModel: string,
): ProviderModelPatch | null {
  if (!sourceModel || !targetModel || sourceModel === targetModel) {
    return null
  }

  const models = configuredModelsForProvider(provider)
  const sourceIndex = models.indexOf(sourceModel)
  const targetIndex = models.indexOf(targetModel)

  if (sourceIndex < 0 || targetIndex < 0) {
    return null
  }

  const nextModels = [...models]
  const [movedModel] = nextModels.splice(sourceIndex, 1)

  if (!movedModel) {
    return null
  }

  nextModels.splice(targetIndex, 0, movedModel)

  const nextChatModels = nextModels.filter(isLikelyChatModel)

  return {
    models: nextModels,
    model: nextChatModels.includes(provider.model)
      ? provider.model
      : nextChatModels[0] ?? '',
    imageModel:
      provider.imageModel && nextModels.includes(provider.imageModel)
        ? provider.imageModel
        : preferredImageModel(nextModels.filter(isLikelyImageModel)) ||
          undefined,
  }
}

export function parseProviderModelDraft(value: string): string[] {
  return parseModelListInput(value.replace(/,/g, ' '))
}

export function providerModelDraftHasSeparator(value: string): boolean {
  return /[\s,]/.test(value)
}

export function lastConfiguredModelForProvider(
  provider: ProviderConfig | null,
): string | undefined {
  return provider ? configuredModelsForProvider(provider).at(-1) : undefined
}

export async function removeProviderModelWithConfirmation({
  clearProviderConnectivityResult,
  getProvider,
  model,
  providerId,
  requestDangerConfirmation,
  scheduleAutoSync,
  setNotice,
  t,
  updateProvider,
}: RemoveProviderModelWithConfirmationOptions): Promise<void> {
  try {
    const provider = getProvider()

    if (!provider) {
      return
    }

    if (
      !(await confirmProviderModelRemoval({
        model,
        provider,
        requestDangerConfirmation,
        setNotice,
        t,
      }))
    ) {
      return
    }

    const latestProvider = getProvider()

    if (
      !latestProvider ||
      !configuredModelsForProvider(latestProvider).includes(model)
    ) {
      return
    }

    commitProviderModelPatch({
      clearProviderConnectivityResult,
      patch: providerModelPatchAfterRemove(latestProvider, model),
      providerId,
      scheduleAutoSync,
      setNotice,
      t,
      updateProvider,
    })
  } catch {
    reportProviderModelSaveUnavailable({ setNotice, t })
  }
}

export function useProviderModelEditorController({
  clearProviderConnectivityResult,
  data,
  requestDangerConfirmation,
  scheduleAutoSync,
  setNotice,
  t,
  updateProvider,
}: ProviderModelEditorControllerOptions) {
  const [modelDraftProviderId, setModelDraftProviderId] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const [editingModelProviderId, setEditingModelProviderId] = useState('')
  const [editingModelSource, setEditingModelSource] = useState('')
  const [editingModelDraft, setEditingModelDraft] = useState('')
  const modelRenameCancelledRef = useRef(false)

  const providerForId = useCallback(
    (providerId: string) =>
      data?.providers.find((provider) => provider.id === providerId) ?? null,
    [data],
  )

  const appendProviderModels = useCallback(
    (providerId: string, models: string[]): boolean => {
      const provider = providerForId(providerId)

      if (!provider) {
        return false
      }

      return commitProviderModelPatch({
        clearProviderConnectivityResult,
        patch: providerModelPatchAfterAppend(provider, models),
        providerId,
        scheduleAutoSync,
        setNotice,
        t,
        updateProvider,
      })
    },
    [
      clearProviderConnectivityResult,
      providerForId,
      scheduleAutoSync,
      setNotice,
      t,
      updateProvider,
    ],
  )

  const removeProviderModel = useCallback(
    async (providerId: string, model: string): Promise<void> => {
      await removeProviderModelWithConfirmation({
        clearProviderConnectivityResult,
        getProvider: () => providerForId(providerId),
        model,
        providerId,
        requestDangerConfirmation,
        scheduleAutoSync,
        setNotice,
        t,
        updateProvider,
      })
    },
    [
      clearProviderConnectivityResult,
      providerForId,
      requestDangerConfirmation,
      scheduleAutoSync,
      setNotice,
      t,
      updateProvider,
    ],
  )

  const beginEditProviderModel = useCallback(
    (providerId: string, model: string): void => {
      modelRenameCancelledRef.current = false
      setEditingModelProviderId(providerId)
      setEditingModelSource(model)
      setEditingModelDraft(model)
    },
    [],
  )

  const clearModelRenameDraft = useCallback((): void => {
    setEditingModelProviderId('')
    setEditingModelSource('')
    setEditingModelDraft('')
  }, [])

  const commitProviderModelRename = useCallback(
    (providerId: string, sourceModel: string): void => {
      if (modelRenameCancelledRef.current) {
        modelRenameCancelledRef.current = false
        clearModelRenameDraft()
        return
      }

      const provider = providerForId(providerId)
      const patch = provider
        ? providerModelPatchAfterRename(
            provider,
            sourceModel,
            editingModelDraft,
          )
        : null

      if (!patch) {
        clearModelRenameDraft()
        return
      }

      if (
        commitProviderModelPatch({
          clearProviderConnectivityResult,
          patch,
          providerId,
          scheduleAutoSync,
          setNotice,
          t,
          updateProvider,
        })
      ) {
        clearModelRenameDraft()
      }
    },
    [
      clearModelRenameDraft,
      clearProviderConnectivityResult,
      editingModelDraft,
      providerForId,
      scheduleAutoSync,
      setNotice,
      t,
      updateProvider,
    ],
  )

  const handleModelRenameKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLInputElement>,
      providerId: string,
      sourceModel: string,
    ): void => {
      if (providerModelRenameKeyShouldCommit(event)) {
        event.preventDefault()
        commitProviderModelRename(providerId, sourceModel)
        event.currentTarget.blur()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        modelRenameCancelledRef.current = true
        clearModelRenameDraft()
        event.currentTarget.blur()
      }
    },
    [clearModelRenameDraft, commitProviderModelRename],
  )

  const commitModelDraft = useCallback(
    (providerId: string): void => {
      if (modelDraftProviderId !== providerId && modelDraftProviderId) {
        return
      }

      const models = parseProviderModelDraft(modelDraft)

      if (models.length && !appendProviderModels(providerId, models)) {
        return
      }

      setModelDraftProviderId(providerId)
      setModelDraft('')
    },
    [appendProviderModels, modelDraft, modelDraftProviderId],
  )

  const handleModelDraftChange = useCallback(
    (providerId: string, value: string): void => {
      setModelDraftProviderId(providerId)

      if (providerModelDraftHasSeparator(value)) {
        const appended = appendProviderModels(
          providerId,
          parseProviderModelDraft(value),
        )
        setModelDraft(appended ? '' : value)
        return
      }

      setModelDraft(value)
    },
    [appendProviderModels],
  )

  const handleModelDraftKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLInputElement>,
      providerId: string,
    ): void => {
      if (providerModelDraftKeyShouldCommit(event)) {
        event.preventDefault()
        commitModelDraft(providerId)
        return
      }

      if (event.key !== 'Backspace' || event.currentTarget.value) {
        return
      }

      const lastModel = lastConfiguredModelForProvider(providerForId(providerId))

      if (lastModel) {
        event.preventDefault()
        void removeProviderModel(providerId, lastModel)
      }
    },
    [commitModelDraft, providerForId, removeProviderModel],
  )

  const reorderProviderModel = useCallback(
    (
      providerId: string,
      sourceModel: string,
      targetModel: string,
    ): void => {
      const provider = providerForId(providerId)
      const patch = provider
        ? providerModelPatchAfterReorder(provider, sourceModel, targetModel)
        : null

      if (!patch) {
        return
      }

      commitProviderModelPatch({
        clearProviderConnectivityResult,
        patch,
        providerId,
        scheduleAutoSync,
        setNotice,
        t,
        updateProvider,
      })
    },
    [
      clearProviderConnectivityResult,
      providerForId,
      scheduleAutoSync,
      setNotice,
      t,
      updateProvider,
    ],
  )

  const moveProviderModel = useCallback(
    (
      providerId: string,
      model: string,
      direction: 'up' | 'down',
    ): void => {
      const models = configuredModelsForProvider(providerForId(providerId))
      const sourceIndex = models.indexOf(model)

      if (sourceIndex < 0) {
        return
      }

      const targetModel =
        direction === 'up'
          ? models[sourceIndex - 1]
          : models[sourceIndex + 1]

      if (!targetModel) {
        return
      }

      reorderProviderModel(providerId, model, targetModel)
    },
    [providerForId, reorderProviderModel],
  )

  const handleModelDragStart = useCallback(
    (event: DragEvent<HTMLElement>, model: string): void => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', model)
    },
    [],
  )

  const handleModelDrop = useCallback(
    (
      event: DragEvent<HTMLElement>,
      providerId: string,
      targetModel: string,
    ): void => {
      event.preventDefault()
      reorderProviderModel(
        providerId,
        event.dataTransfer.getData('text/plain'),
        targetModel,
      )
    },
    [reorderProviderModel],
  )

  return {
    appendProviderModels,
    beginEditProviderModel,
    clearModelRenameDraft,
    commitModelDraft,
    commitProviderModelRename,
    editingModelDraft,
    editingModelProviderId,
    editingModelSource,
    handleModelDraftChange,
    handleModelDraftKeyDown,
    handleModelDragStart,
    handleModelDrop,
    handleModelRenameKeyDown,
    modelDraft,
    modelDraftProviderId,
    moveProviderModel,
    removeProviderModel,
    reorderProviderModel,
    setEditingModelDraft,
  }
}
