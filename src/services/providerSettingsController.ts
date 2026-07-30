import type {
  Dispatch,
  DragEvent,
  SetStateAction,
} from 'react'
import { useEffect, useMemo } from 'react'

import {
  providerFromPreset,
} from '../data/presets'
import type { NoticeTarget } from '../components/Notice'
import {
  providerPresetLabel,
} from '../i18n'
import { createConversation } from '../storage/db'
import {
  clearPendingProviderSecretCleanupById as clearPendingProviderSecretCleanupByIdDefault,
  clearProviderSecretsById as clearProviderSecretsByIdDefault,
  queueProviderSecretCleanupById as queueProviderSecretCleanupByIdDefault,
  setProviderKey as setProviderKeyDefault,
} from '../storage/secrets'
import type {
  AppData,
  ProviderConfig,
} from '../types'
import { accessKeyFromPassword as accessKeyFromPasswordDefault } from './accessKey'
import {
  bump,
  now,
  updateConversation,
} from './appData'
import { deleteProviderDangerPrompt } from './dangerConfirmation'
import type { DangerPrompt } from './dangerConfirmation'
import {
  reportDetachedFormattedFailure,
  reportDetachedNotice,
} from './detachedFailureReporting'
import {
  editImage as editImageDefault,
  executeProviderCapabilityRequestPlan as executeProviderCapabilityRequestPlanDefault,
  generateImage as generateImageDefault,
  listProviderModels as listProviderModelsDefault,
  loadCachedLazyService,
  streamChat as streamChatDefault,
} from './lazy'
import {
  defaultPresetIdForProviderName,
  orderedProviders,
  presetById,
  presetProviderPatch,
  providerDefaultsFromPreset,
  reorderProviders,
  sameStringArray,
} from './providerConfig'
import {
  audioSpeechModelsForProvider,
  audioTranscriptionModelsForProvider,
  chatModelsForProvider,
  defaultModelForProvider,
  imageModelsForProvider,
  modelsForProviderCapability,
} from './providerModels'
import {
  type ProviderConnectivityResult,
  type ModelCheckKind,
} from './providerStatus'
import {
  replaceManagedProxyHosts as replaceManagedProxyHostsDefault,
} from './providerProxyHosts'
import type {
  ProviderConnectivityCheckActions,
  ProviderConnectivityCheckContext,
  ProviderConnectivityCheckServices,
} from './providerConnectivityChecks'
import { updateProviderInAppData } from './appDataMutationController'
import {
  persistPublishedLocalSnapshot as persistPublishedLocalSnapshotDefault,
} from './localSaveQueueController'

type ProviderConnectivityChecksModule =
  typeof import('./providerConnectivityChecks')
type ProviderConnectivityChecksLoader =
  () => Promise<ProviderConnectivityChecksModule>

let providerConnectivityChecksPromise:
  | Promise<ProviderConnectivityChecksModule>
  | null = null

function loadProviderConnectivityChecks(): Promise<ProviderConnectivityChecksModule> {
  return loadCachedLazyService(
    () => providerConnectivityChecksPromise,
    (promise) => {
      providerConnectivityChecksPromise = promise
    },
    () => import('./providerConnectivityChecks'),
  )
}

export function cancelProviderConnectivityLifecycle(
  operationRef: ProviderConnectivityCheckContext['modelLoadProviderIdRef'],
): void {
  operationRef.current = 'disposed'
  operationRef.cancel?.()
}

export interface ProviderSettingsControllerContext
  extends ProviderConnectivityCheckContext {
  activeConversationId: string
  reportSecretWrite: (promise: Promise<void>, target?: NoticeTarget) => void
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  selectedProviderId: string
  selectChatModelMenuOption: (providerId: string) => void
  setProviderConnectivityResults: Dispatch<
    SetStateAction<Record<string, ProviderConnectivityResult>>
  >
  setProviderKeys: Dispatch<SetStateAction<Record<string, string>>>
  setSelectedPresetId: (presetId: string) => void
  setSelectedProviderId: (providerId: string) => void
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
  updateProvider: (
    providerId: string,
    patch: Partial<ProviderConfig>,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

export interface ProviderSettingsControllerServices
  extends ProviderConnectivityCheckServices {
  clearPendingProviderSecretCleanupById: (providerIds: string[]) => void
  clearProviderSecretsById: (providerIds: string[]) => Promise<void>
  loadProviderConnectivityChecks?: ProviderConnectivityChecksLoader
  queueProviderSecretCleanupById: (providerIds: string[]) => void
  persistPublishedLocalSnapshot: (snapshot: AppData) => Promise<AppData>
  setProviderKey: (providerId: string, value: string) => Promise<void>
}

export interface ProviderSettingsControllerActions
  extends ProviderConnectivityCheckActions {
  addProviderFromPresetId: (
    presetId: string,
    options?: {
      createConversationIfMissing?: boolean
      saveFailureTarget?: NoticeTarget
      useForEmptyActiveConversation?: boolean
    },
  ) => ProviderConfig | null
  addProviderFromPresetSelect: (presetId: string) => void
  applyGuidePreset: (presetId: string) => void
  handleProviderDragStart: (
    event: DragEvent<HTMLElement>,
    providerId: string,
  ) => void
  handleProviderDrop: (
    event: DragEvent<HTMLElement>,
    targetProviderId: string,
  ) => void
  moveProvider: (sourceProviderId: string, targetProviderId: string) => void
  removeProvider: (providerId: string) => Promise<void>
  selectConversationAudioTranscriptionModel: (
    providerId: string,
    model: string,
  ) => void
  selectConversationImageModel: (providerId: string, model: string) => void
  selectConversationProviderModel: (providerId: string, model: string) => void
  selectProviderAudioTranscriptionModel: (
    providerId: string,
    value: string,
  ) => void
  selectProviderAudioSpeechModel: (
    providerId: string,
    value: string,
  ) => void
  selectProviderEmbeddingModel: (
    providerId: string,
    value: string,
  ) => void
  selectProviderImageModel: (providerId: string, value: string) => void
  selectProviderModerationModel: (
    providerId: string,
    value: string,
  ) => void
  selectProviderModel: (providerId: string, value: string) => void
  selectProviderRealtimeModel: (
    providerId: string,
    value: string,
  ) => void
  setProviderEnabled: (providerId: string, enabled: boolean) => void
  updateGuideProvider: (
    providerId: string,
    patch: Partial<ProviderConfig>,
  ) => AppData | null
  updateProviderSettings: (
    providerId: string,
    patch: Partial<ProviderConfig>,
  ) => AppData | null
  updateProviderKey: (providerId: string, value: string) => void
}

const defaultProviderSettingsServices: ProviderSettingsControllerServices = {
  accessKeyFromPassword: accessKeyFromPasswordDefault,
  clearPendingProviderSecretCleanupById:
    clearPendingProviderSecretCleanupByIdDefault,
  clearProviderSecretsById: clearProviderSecretsByIdDefault,
  editImage: editImageDefault,
  executeProviderCapabilityRequestPlan: executeProviderCapabilityRequestPlanDefault,
  generateImage: generateImageDefault,
  listProviderModels: listProviderModelsDefault,
  loadProviderConnectivityChecks,
  persistPublishedLocalSnapshot: persistPublishedLocalSnapshotDefault,
  queueProviderSecretCleanupById: queueProviderSecretCleanupByIdDefault,
  replaceManagedProxyHosts: replaceManagedProxyHostsDefault,
  setProviderKey: setProviderKeyDefault,
  streamChat: streamChatDefault,
}

const providerConnectivityInvalidatingFields = new Set<keyof ProviderConfig>([
  'audioSpeechModel',
  'audioTranscriptionModel',
  'baseUrl',
  'capabilities',
  'clientRequestMode',
  'embeddingModel',
  'enabled',
  'imageModel',
  'kind',
  'model',
  'models',
  'moderationModel',
  'needsApiKey',
  'proxyUrl',
  'realtimeModel',
])

function providerPatchInvalidatesConnectivity(
  patch: Partial<ProviderConfig>,
): boolean {
  return (Object.keys(patch) as Array<keyof ProviderConfig>).some((key) =>
    providerConnectivityInvalidatingFields.has(key),
  )
}

function clearProviderConnectivityResult(
  context: Pick<
    ProviderSettingsControllerContext,
    'setProviderConnectivityResults'
  >,
  providerId: string,
): void {
  context.setProviderConnectivityResults((current) => {
    if (!current[providerId]) {
      return current
    }

    const next = { ...current }
    delete next[providerId]
    return next
  })
}

function createLazyProviderConnectivityCheckActions(
  context: ProviderConnectivityCheckContext,
  services: ProviderSettingsControllerServices,
): ProviderConnectivityCheckActions {
  async function withConnectivityActions<Result>(
    run: (actions: ProviderConnectivityCheckActions) => Promise<Result>,
  ): Promise<Result> {
    const loadChecks =
      services.loadProviderConnectivityChecks ?? loadProviderConnectivityChecks
    const module = await loadChecks()
    const { createProviderConnectivityCheckActions } = module
    return run(createProviderConnectivityCheckActions(context, services))
  }

  function reportConnectivityActionFailure(
    error: unknown,
    target: NoticeTarget,
  ): void {
    reportDetachedFormattedFailure(context, error, target)
  }

  return {
    checkProviderCapability: async (providerId, capability) => {
      try {
        await withConnectivityActions((actions) =>
          actions.checkProviderCapability(providerId, capability),
        )
      } catch (error: unknown) {
        reportConnectivityActionFailure(error, 'provider-capabilities')
      }
    },
    checkProviderFullCapabilities: async (providerId) => {
      try {
        await withConnectivityActions((actions) =>
          actions.checkProviderFullCapabilities(providerId),
        )
      } catch (error: unknown) {
        reportConnectivityActionFailure(error, 'provider-capabilities')
      }
    },
    checkProviderConnectivity: async (providerId) => {
      try {
        await withConnectivityActions((actions) =>
          actions.checkProviderConnectivity(providerId),
        )
      } catch (error: unknown) {
        reportConnectivityActionFailure(error, 'providers')
      }
    },
    checkSelectedModel: async (providerId, kind) => {
      try {
        await withConnectivityActions((actions) =>
          actions.checkSelectedModel(providerId, kind),
        )
      } catch (error: unknown) {
        reportConnectivityActionFailure(error, modelCheckNoticeTarget(kind))
      }
    },
    refreshProviderModels: async (providerId) => {
      try {
        await withConnectivityActions((actions) =>
          actions.refreshProviderModels(providerId),
        )
      } catch (error: unknown) {
        reportConnectivityActionFailure(
          error,
          context.guideVisible ? 'guide-models' : 'models',
        )
      }
    },
    runProviderConnectivityCheck: (providerId) =>
      withConnectivityActions((actions) =>
        actions.runProviderConnectivityCheck(providerId),
      ),
  }
}

function modelCheckNoticeTarget(kind: ModelCheckKind): NoticeTarget {
  if (kind === 'audio-speech') {
    return 'model-audio-speech'
  }

  if (kind === 'audio-transcription') {
    return 'model-audio'
  }

  if (kind === 'embeddings') {
    return 'model-embedding'
  }

  if (kind === 'moderation') {
    return 'model-moderation'
  }

  if (kind === 'realtime') {
    return 'model-realtime'
  }

  return kind === 'image' ? 'model-image' : 'model-chat'
}

export function reportProviderSettingsNotice(
  context: Pick<ProviderSettingsControllerContext, 'setNotice'>,
  getText: () => string,
  tone?: Parameters<ProviderSettingsControllerContext['setNotice']>[1],
  target?: NoticeTarget,
): void {
  reportDetachedNotice(context.setNotice, getText, tone, target)
}

export function reportProviderSaveUnavailable(
  context: Pick<ProviderSettingsControllerContext, 'setNotice' | 't'>,
  target: NoticeTarget,
): void {
  reportProviderSettingsNotice(
    context,
    () => context.t('notice.providerSaveUnavailable'),
    'error',
    target,
  )
}

export function createProviderSettingsActions(
  context: ProviderSettingsControllerContext,
  services: ProviderSettingsControllerServices = defaultProviderSettingsServices,
): ProviderSettingsControllerActions {
  const connectivityActions = createLazyProviderConnectivityCheckActions(
    context,
    services,
  )

  function setProviderEnabled(providerId: string, enabled: boolean): void {
    const current = context.dataRef.current
    const provider = current?.providers.find((item) => item.id === providerId)

    if (!current || !provider) {
      return
    }

    if (
      !enabled &&
      provider.enabled &&
      current.providers.filter((item) => item.enabled).length <= 1
    ) {
      reportProviderSettingsNotice(
        context,
        () => context.t('notice.providerMinimum'),
        'warning',
        'providers-list',
      )
      return
    }

    const saved = context.updateData(
      (current) => {
        const previousProvider = current.providers.find((item) => item.id === providerId)
        const fallback =
          !enabled && previousProvider?.enabled
            ? current.providers.find(
              (item) => item.id !== providerId && item.enabled,
            )
            : undefined
        const timestamp = now()

        return bump({
          ...current,
          providers: orderedProviders(
            current.providers.map((item) =>
              item.id === providerId
                ? { ...item, enabled, updatedAt: timestamp }
                : item,
            ),
          ),
          conversations: fallback
            ? current.conversations.map((conversation) =>
              conversation.providerId === providerId
                ? {
                  ...conversation,
                  providerId: fallback.id,
                  model: defaultModelForProvider(fallback),
                  updatedAt: timestamp,
                }
                : conversation,
            )
          : current.conversations,
        })
      },
      { autoSync: false },
    )
    if (!saved) {
      reportProviderSaveUnavailable(context, 'providers-list')
      return
    }
    clearProviderConnectivityResult(context, providerId)
    if (!enabled && provider.enabled) {
      const fallback = saved.providers.find((item) => item.enabled)
      if (fallback && context.selectedProviderId === providerId) {
        context.setSelectedProviderId(fallback.id)
      }
    }
    context.scheduleAutoSync(saved, 0)
    reportProviderSettingsNotice(context, () => '')
  }

  function addProviderFromPresetId(
    presetId: string,
    options: {
      createConversationIfMissing?: boolean
      saveFailureTarget?: NoticeTarget
      useForEmptyActiveConversation?: boolean
    } = {},
  ): ProviderConfig | null {
    const preset = presetById(presetId)
    const provider = {
      ...providerFromPreset(preset),
      name: preset.custom
        ? providerPresetLabel(preset.id, preset.name, context.t)
        : preset.name,
    }

    const saved = context.updateData(
      (current) => {
        const createdConversation =
          options.createConversationIfMissing && current.conversations.length === 0
            ? createConversation(
                provider.id,
                defaultModelForProvider(provider),
                context.t('conversation.newTitle'),
              )
            : null
        const conversations = createdConversation
          ? [createdConversation]
          : options.useForEmptyActiveConversation
            ? current.conversations.map((conversation) =>
                conversation.id === current.preferences.activeConversationId &&
                conversation.messages.length === 0
                  ? {
                      ...conversation,
                      providerId: provider.id,
                      model: defaultModelForProvider(provider),
                      updatedAt: now(),
                    }
                  : conversation,
              )
            : current.conversations

        return bump({
          ...current,
          providers: orderedProviders([provider, ...current.providers]),
          conversations,
          preferences: {
            ...current.preferences,
            activeConversationId:
              createdConversation?.id ?? current.preferences.activeConversationId,
          },
        })
      },
      { autoSync: false },
    )

    if (!saved) {
      reportProviderSaveUnavailable(
        context,
        options.saveFailureTarget ?? 'providers-list',
      )
      return null
    }

    context.setSelectedProviderId(provider.id)
    context.scheduleAutoSync(saved, 0)
    reportProviderSettingsNotice(context, () => '')
    return provider
  }

  function updateProviderPatch(
    providerId: string,
    patch: Partial<ProviderConfig>,
    target: NoticeTarget,
    options: { immediateSync?: boolean } = {},
  ): AppData | null {
    const saved = context.updateProvider(
      providerId,
      patch,
      options.immediateSync ? { autoSync: false } : undefined,
    )

    if (!saved) {
      reportProviderSaveUnavailable(context, target)
      return null
    }

    if (providerPatchInvalidatesConnectivity(patch)) {
      clearProviderConnectivityResult(context, providerId)
    }

    if (options.immediateSync) {
      context.scheduleAutoSync(saved, 0)
    }

    return saved
  }

  function updateProviderSettings(
    providerId: string,
    patch: Partial<ProviderConfig>,
  ): AppData | null {
    return updateProviderPatch(providerId, patch, 'providers')
  }

  function updateGuideProvider(
    providerId: string,
    patch: Partial<ProviderConfig>,
  ): AppData | null {
    return updateProviderPatch(providerId, patch, 'guide')
  }

  function addProviderFromPresetSelect(presetId: string): void {
    if (!presetId) {
      return
    }

    addProviderFromPresetId(presetId, { useForEmptyActiveConversation: true })
  }

  function applyGuidePreset(presetId: string): void {
    const preset = presetById(presetId)
    const current = context.dataRef.current
    const localizedName = preset.custom
      ? providerPresetLabel(preset.id, preset.name, context.t)
      : preset.name

    const existing = current?.providers.find(
      (provider) =>
        provider.kind === preset.kind &&
        (provider.name === preset.name ||
          provider.name === localizedName ||
          defaultPresetIdForProviderName(provider) === preset.id) &&
        provider.baseUrl === preset.baseUrl,
    )

    if (existing) {
      const defaults = providerDefaultsFromPreset(existing, preset)
      const patch: Partial<ProviderConfig> = {}

      if (existing.model !== defaults.model) {
        patch.model = defaults.model
      }

      if (existing.imageModel !== defaults.imageModel) {
        patch.imageModel = defaults.imageModel
      }

      if (!sameStringArray(existing.models, defaults.models)) {
        patch.models = defaults.models
      }

      if (Object.keys(patch).length > 0) {
        const saved = updateProviderPatch(existing.id, patch, 'guide')

        if (!saved) {
          return
        }
      }

      context.setSelectedPresetId(preset.id)
      context.setSelectedProviderId(existing.id)
      return
    }

    if (
      context.selectedProviderId &&
      current?.providers.some(
        (provider) => provider.id === context.selectedProviderId,
      )
    ) {
      const saved = updateProviderPatch(
        context.selectedProviderId,
        presetProviderPatch(preset, localizedName),
        'guide',
      )

      if (!saved) {
        return
      }

      context.setSelectedPresetId(preset.id)
      return
    }

    const added = addProviderFromPresetId(preset.id, {
      saveFailureTarget: 'guide',
    })

    if (added) {
      context.setSelectedPresetId(preset.id)
    }
  }

  function clearProviderSecretCleanupMarker(providerId: string): void {
    try {
      services.clearPendingProviderSecretCleanupById([providerId])
    } catch {
      // Canonical secret cleanup or the failed AppData commit remains authoritative.
    }
  }

  async function removeProvider(providerId: string): Promise<void> {
    const currentData = context.dataRef.current

    if (!currentData || currentData.providers.length <= 1) {
      reportProviderSettingsNotice(
        context,
        () => context.t('notice.providerMinimum'),
        'warning',
        'providers-danger',
      )
      return
    }

    const target = currentData.providers.find(
      (provider) => provider.id === providerId,
    )
    const fallback =
      currentData.providers.find(
        (provider) => provider.id !== providerId && provider.enabled,
      ) ??
      currentData.providers.find((provider) => provider.id !== providerId)

    if (!target || !fallback) {
      return
    }

    reportProviderSettingsNotice(context, () => '')
    let confirmed: boolean

    try {
      confirmed = await context.requestDangerConfirmation(
        deleteProviderDangerPrompt(context.t, target.name, fallback.name),
      )
    } catch {
      reportProviderSaveUnavailable(context, 'providers-danger')
      return
    }

    if (!confirmed) {
      return
    }

    const latestData = context.dataRef.current

    if (!latestData || latestData.providers.length <= 1) {
      reportProviderSettingsNotice(
        context,
        () => context.t('notice.providerMinimum'),
        'warning',
        'providers-danger',
      )
      return
    }

    const latestTarget = latestData.providers.find(
      (provider) => provider.id === providerId,
    )
    const latestFallback =
      latestData.providers.find(
        (provider) => provider.id !== providerId && provider.enabled,
      ) ??
      latestData.providers.find((provider) => provider.id !== providerId)

    if (!latestTarget || !latestFallback) {
      return
    }

    try {
      services.queueProviderSecretCleanupById([providerId])
    } catch (error: unknown) {
      reportDetachedFormattedFailure(context, error, 'providers-danger')
      return
    }

    const saved = context.updateData(
      (current) =>
        bump({
          ...current,
          providers: current.providers.filter(
            (provider) => provider.id !== providerId,
          ),
          conversations: current.conversations.map((conversation) =>
            conversation.providerId === providerId
              ? {
                  ...conversation,
                  providerId: latestFallback.id,
                  model: defaultModelForProvider(latestFallback),
                  updatedAt: now(),
                }
              : conversation,
          ),
        }),
      { autoSync: false },
    )

    if (!saved) {
      clearProviderSecretCleanupMarker(providerId)
      reportProviderSaveUnavailable(context, 'providers-danger')
      return
    }

    let committed: AppData

    try {
      committed = await services.persistPublishedLocalSnapshot(saved)
    } catch (error: unknown) {
      clearProviderSecretCleanupMarker(providerId)
      reportDetachedFormattedFailure(context, error, 'providers-danger')
      return
    }

    if (committed.providers.some((provider) => provider.id === providerId)) {
      clearProviderSecretCleanupMarker(providerId)
      reportProviderSaveUnavailable(context, 'providers-danger')
      return
    }

    context.setProviderKeys((current) => {
      const next = { ...current }
      delete next[providerId]
      context.providerKeysRef.current = next
      return next
    })
    context.reportSecretWrite(
      services.clearProviderSecretsById([providerId]).then(() => {
        clearProviderSecretCleanupMarker(providerId)
      }),
      'providers-danger',
    )
    clearProviderConnectivityResult(context, providerId)
    const committedFallback =
      committed.providers.find((provider) => provider.id === latestFallback.id) ??
      committed.providers.find((provider) => provider.enabled) ??
      committed.providers[0]

    if (committedFallback) {
      context.setSelectedProviderId(committedFallback.id)
    }
    context.scheduleAutoSync(committed, 0)
  }

  function updateProviderKey(providerId: string, value: string): void {
    const previousValue = context.providerKeysRef.current[providerId] ?? ''
    reportProviderSettingsNotice(context, () => '')
    clearProviderConnectivityResult(context, providerId)
    context.setProviderKeys((current) => ({
      ...current,
      [providerId]: value,
    }))
    context.providerKeysRef.current = {
      ...context.providerKeysRef.current,
      [providerId]: value,
    }
    context.reportSecretWrite(
      services
        .setProviderKey(providerId, value)
        .then(() => {
          if (context.providerKeysRef.current[providerId] !== value) {
            return
          }

          const timestamp = now()
          const saved = context.updateData(
            (current) =>
              bump({
                ...current,
                providers: current.providers.map((provider) =>
                  provider.id === providerId
                    ? {
                        ...provider,
                        updatedAt: timestamp,
                      }
                    : provider,
                ),
              }),
            { autoSync: false },
          )

          if (!saved) {
            reportProviderSaveUnavailable(context, 'providers-list')
            return
          }

          context.scheduleAutoSync(saved, 0)
        })
        .catch(async (error: unknown) => {
          if (context.providerKeysRef.current[providerId] === value) {
            const next = { ...context.providerKeysRef.current }

            if (previousValue) {
              next[providerId] = previousValue
            } else {
              delete next[providerId]
            }

            context.providerKeysRef.current = next
            context.setProviderKeys((current) =>
              current[providerId] === value ? next : current,
            )

            try {
              await services.setProviderKey(providerId, previousValue)
            } catch {
              // Preserve the original failed edit; a newer edit still wins in storage order.
            }
          }

          throw error
        }),
      'providers-list',
    )
  }

  function handleProviderDragStart(
    event: DragEvent<HTMLElement>,
    providerId: string,
  ): void {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('p', providerId)
  }

  function moveProvider(
    sourceProviderId: string,
    targetProviderId: string,
  ): void {
    const saved = context.updateData(
      (current) =>
        bump({
          ...current,
          providers: reorderProviders(
            current.providers,
            sourceProviderId,
            targetProviderId,
          ),
        }),
      { autoSync: false },
    )
    if (!saved) {
      reportProviderSaveUnavailable(context, 'providers-list')
      return
    }
    context.scheduleAutoSync(saved, 0)
    reportProviderSettingsNotice(context, () => '')
  }

  function handleProviderDrop(
    event: DragEvent<HTMLElement>,
    targetProviderId: string,
  ): void {
    event.preventDefault()
    moveProvider(
      event.dataTransfer.getData('p'),
      targetProviderId,
    )
  }

  type ProviderModelField =
    | 'audioSpeechModel'
    | 'audioTranscriptionModel'
    | 'embeddingModel'
    | 'imageModel'
    | 'model'
    | 'moderationModel'
    | 'realtimeModel'

  type ModelsForProvider = (provider: ProviderConfig | null) => string[]

  function selectConversationModel(
    providerId: string,
    model: string,
    modelsForProvider: ModelsForProvider,
    providerField?: ProviderModelField,
  ): void {
    const current = context.dataRef.current
    const provider = current?.providers.find((item) => item.id === providerId)
    const conversationId =
      context.activeConversationId || current?.preferences.activeConversationId

    if (
      !current ||
      !provider ||
      !conversationId ||
      !modelsForProvider(provider).includes(model)
    ) {
      return
    }

    const saved = context.updateData(
      (current) => {
        const next = updateConversation(current, conversationId, (conversation) => ({
          ...conversation,
          providerId,
          model: providerField
            ? conversation.providerId === providerId
              ? conversation.model
              : defaultModelForProvider(provider)
            : model,
        }))

        return providerField
          ? updateProviderInAppData(next, providerId, { [providerField]: model })
          : next
      },
      { autoSync: false },
    )

    if (!saved) {
      reportProviderSaveUnavailable(context, 'chat')
      return
    }

    clearProviderConnectivityResult(context, providerId)
    context.setSelectedProviderId(providerId)
    context.selectChatModelMenuOption(providerId)
    context.scheduleAutoSync(saved, 0)
    reportProviderSettingsNotice(context, () => '')
  }

  function selectConversationProviderModel(
    providerId: string,
    model: string,
  ): void {
    selectConversationModel(providerId, model, chatModelsForProvider)
  }

  function selectConversationImageModel(providerId: string, model: string): void {
    selectConversationModel(
      providerId,
      model,
      imageModelsForProvider,
      'imageModel',
    )
  }

  function selectConversationAudioTranscriptionModel(
    providerId: string,
    model: string,
  ): void {
    selectConversationModel(
      providerId,
      model,
      audioTranscriptionModelsForProvider,
      'audioTranscriptionModel',
    )
  }

  function selectProviderModelField(
    providerId: string,
    value: string,
    field: ProviderModelField,
    modelsForProvider: ModelsForProvider,
  ): void {
    const provider = context.dataRef.current?.providers.find(
      (item) => item.id === providerId,
    )
    const models = modelsForProvider(provider ?? null)

    if (!models.includes(value)) {
      return
    }

    updateProviderPatch(providerId, { [field]: value }, 'providers-list', {
      immediateSync: true,
    })
  }

  function selectProviderModel(providerId: string, value: string): void {
    selectProviderModelField(providerId, value, 'model', chatModelsForProvider)
  }

  function selectProviderImageModel(providerId: string, value: string): void {
    selectProviderModelField(
      providerId,
      value,
      'imageModel',
      imageModelsForProvider,
    )
  }

  function selectProviderAudioSpeechModel(
    providerId: string,
    value: string,
  ): void {
    selectProviderModelField(
      providerId,
      value,
      'audioSpeechModel',
      audioSpeechModelsForProvider,
    )
  }

  function selectProviderAudioTranscriptionModel(
    providerId: string,
    value: string,
  ): void {
    selectProviderModelField(
      providerId,
      value,
      'audioTranscriptionModel',
      audioTranscriptionModelsForProvider,
    )
  }

  function selectProviderEmbeddingModel(providerId: string, value: string): void {
    selectProviderModelField(
      providerId,
      value,
      'embeddingModel',
      (provider) => modelsForProviderCapability(provider, 'embeddings'),
    )
  }

  function selectProviderModerationModel(providerId: string, value: string): void {
    selectProviderModelField(
      providerId,
      value,
      'moderationModel',
      (provider) => modelsForProviderCapability(provider, 'moderation'),
    )
  }

  function selectProviderRealtimeModel(providerId: string, value: string): void {
    selectProviderModelField(
      providerId,
      value,
      'realtimeModel',
      (provider) => modelsForProviderCapability(provider, 'realtime'),
    )
  }

  return {
    addProviderFromPresetId,
    addProviderFromPresetSelect,
    applyGuidePreset,
    ...connectivityActions,
    handleProviderDragStart,
    handleProviderDrop,
    moveProvider,
    removeProvider,
    selectConversationAudioTranscriptionModel,
    selectConversationImageModel,
    selectConversationProviderModel,
    selectProviderAudioSpeechModel,
    selectProviderAudioTranscriptionModel,
    selectProviderEmbeddingModel,
    selectProviderImageModel,
    selectProviderModerationModel,
    selectProviderModel,
    selectProviderRealtimeModel,
    setProviderEnabled,
    updateGuideProvider,
    updateProviderSettings,
    updateProviderKey,
  }
}

export function useProviderSettingsController(
  context: ProviderSettingsControllerContext,
  services: ProviderSettingsControllerServices = defaultProviderSettingsServices,
): ProviderSettingsControllerActions {
  useEffect(
    () => () => {
      cancelProviderConnectivityLifecycle(context.modelLoadProviderIdRef)
    },
    [context.modelLoadProviderIdRef],
  )

  return useMemo(
    () => createProviderSettingsActions(context, services),
    [context, services],
  )
}
