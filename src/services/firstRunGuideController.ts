import {
  useEffect,
  useMemo,
} from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import type {
  AppData,
  ProviderConfig,
} from '../types'
import {
  bump,
  now as currentTimestamp,
} from './appData'
import {
  deriveFirstRunGuideState,
  type FirstRunGuideState,
} from './firstRunGuideState'
import {
  defaultModelForProvider as defaultModelForProviderService,
  providerModelPatchFromFetchedModels as providerModelPatchFromFetchedModelsService,
} from './providerModels'
import type {
  ProviderConnectivityField,
  ProviderConnectivityResult,
} from './providerStatus'
import {
  type NoticeTone,
  waitForGuideSuccessClose as waitForGuideSuccessCloseService,
} from './uiRuntime'

type GuideModelPatch = Pick<
  ProviderConfig,
  'models' | 'model' | 'imageModel'
>

let activeGuideRun: object | null = null

export function cancelFirstRunGuideCompletion(): void {
  activeGuideRun = null
}

export interface FirstRunGuideActionContext {
  closeGuide: () => void
  commitSyncPassphraseOnBlur: () => Promise<void>
  data: AppData | null
  dataRef: { current: AppData | null }
  formatErrorMessage: (error: unknown) => string
  focusProviderConnectivityField?: (
    field: ProviderConnectivityField,
  ) => void
  guideState: Pick<FirstRunGuideState, 'guideCanFinish' | 'guideRequirement'>
  runProviderConnectivityCheck: (
    providerId: string,
  ) => Promise<ProviderConnectivityResult | null | undefined>
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  selectedProvider: ProviderConfig | null
  setGuideSuccessPending: (pending: boolean) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  t: Translator
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

export interface FirstRunGuideActionServices {
  defaultModelForProvider: (provider: ProviderConfig | null) => string
  now: () => number
  providerModelPatchFromFetchedModels: (
    provider: ProviderConfig,
    models: string[],
  ) => GuideModelPatch
  waitForGuideSuccessClose: () => Promise<void>
}

export interface FirstRunGuideActions {
  finishGuide: (localOnly?: boolean) => Promise<void>
}

export interface FirstRunGuideControllerContext
  extends Omit<FirstRunGuideActionContext, 'guideState'> {
  checkingProviderId: string
  data: AppData | null
  providerConnectivityResults: Record<string, ProviderConnectivityResult>
  providerKeys: Record<string, string>
  selectedPresetId: string
}

export interface FirstRunGuideController extends FirstRunGuideActions {
  guideState: FirstRunGuideState
}

const defaultFirstRunGuideActionServices: FirstRunGuideActionServices = {
  defaultModelForProvider: defaultModelForProviderService,
  providerModelPatchFromFetchedModels: providerModelPatchFromFetchedModelsService,
  now: currentTimestamp,
  waitForGuideSuccessClose: waitForGuideSuccessCloseService,
}

export function reportGuideSaveUnavailable(
  context: Pick<FirstRunGuideActionContext, 'setNotice' | 't'>,
): void {
  reportFirstRunGuideNotice(
    context,
    () => context.t('notice.guideSaveUnavailable'),
    'error',
    'guide',
  )
}

export function reportFirstRunGuideProviderValidationFailure(
  context: Pick<FirstRunGuideActionContext, 'formatErrorMessage' | 'setNotice'>,
  error: unknown,
): void {
  reportFirstRunGuideNotice(
    context,
    () => context.formatErrorMessage(error),
    'error',
    'guide',
  )
}

export function reportFirstRunGuideNotice(
  context: Pick<FirstRunGuideActionContext, 'setNotice'>,
  message: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): void {
  try {
    const text = message()
    if (tone === undefined && target === undefined) {
      context.setNotice(text)
    } else {
      context.setNotice(text, tone, target)
    }
  } catch {
    // First-run actions are fire-and-forget from UI controls.
  }
}

export function createFirstRunGuideActions(
  context: FirstRunGuideActionContext,
  services: Partial<FirstRunGuideActionServices> = {},
): FirstRunGuideActions {
  const guideServices = {
    ...defaultFirstRunGuideActionServices,
    ...services,
  }

  async function finishOwnedGuide(
    localOnly: boolean,
    runToken: object,
  ): Promise<void> {
    if (!localOnly && !context.guideState.guideCanFinish) {
      reportFirstRunGuideNotice(
        context,
        () =>
          context.guideState.guideRequirement ||
          context.t('guide.requirement.setup'),
      )
      return
    }

    try {
      await context.commitSyncPassphraseOnBlur()
    } catch {
      if (activeGuideRun === runToken) {
        reportGuideSaveUnavailable(context)
      }
      return
    }

    if (activeGuideRun !== runToken) {
      return
    }

    const providerForGuide = localOnly ? null : context.selectedProvider
    let providerForGuideWithModels = providerForGuide
    let guideModelPatch: GuideModelPatch | null = null

    if (providerForGuide) {
      let connectivityResult: ProviderConnectivityResult | null | undefined

      try {
        connectivityResult = await context.runProviderConnectivityCheck(
          providerForGuide.id,
        )
      } catch (error: unknown) {
        if (activeGuideRun === runToken) {
          reportFirstRunGuideProviderValidationFailure(context, error)
        }
        return
      }

      if (activeGuideRun !== runToken) {
        return
      }

      if (connectivityResult?.tone !== 'success') {
        const failedField = connectivityResult?.field

        if (failedField && failedField !== 'none') {
          context.focusProviderConnectivityField?.(failedField)
        }
        reportFirstRunGuideNotice(
          context,
          () =>
            connectivityResult?.message ??
            context.t('guide.requirement.setup'),
          'error',
          'guide',
        )
        return
      }

      const latestProviderForGuide =
        context.dataRef.current?.providers.find(
          (item) => item.id === providerForGuide.id,
        ) ?? providerForGuide

      if (connectivityResult.models?.length) {
        guideModelPatch = guideServices.providerModelPatchFromFetchedModels(
          latestProviderForGuide,
          connectivityResult.models,
        )
        providerForGuideWithModels = {
          ...latestProviderForGuide,
          ...guideModelPatch,
        }
      } else {
        providerForGuideWithModels = latestProviderForGuide
      }

    }

    if (activeGuideRun !== runToken) {
      return
    }

    if (
      context.data &&
      (!context.dataRef.current ||
        context.data.updatedAt > context.dataRef.current.updatedAt)
    ) {
      context.dataRef.current = context.data
    }

    const saved = context.updateData(
      (current) =>
        bump({
          ...current,
          providers:
            providerForGuideWithModels && guideModelPatch
              ? current.providers.map((provider) =>
                  provider.id === providerForGuideWithModels.id
                    ? {
                        ...provider,
                        ...guideModelPatch,
                        updatedAt: guideServices.now(),
                      }
                    : provider,
                )
              : current.providers,
          conversations:
            providerForGuideWithModels && current.preferences.activeConversationId
              ? current.conversations.map((conversation) =>
                  conversation.id === current.preferences.activeConversationId
                    ? {
                        ...conversation,
                        providerId: providerForGuideWithModels.id,
                        model: guideServices.defaultModelForProvider(
                          providerForGuideWithModels,
                        ),
                        updatedAt: guideServices.now(),
                      }
                    : conversation,
                )
              : current.conversations,
          sync: localOnly
            ? {
                ...current.sync,
                mode: 'local',
                autoSync: false,
                encryptionEnabled: true,
              }
            : current.sync,
          preferences: {
            ...current.preferences,
            firstRunDone: true,
          },
        }),
      { autoSync: false },
    )

    if (!saved) {
      reportGuideSaveUnavailable(context)
      return
    }

    if (!localOnly) {
      context.scheduleAutoSync(saved, 0)
    }

    if (providerForGuide) {
      context.setGuideSuccessPending(true)
      reportFirstRunGuideNotice(
        context,
        () => context.t('notice.guideConnectivityPassed'),
        'success',
        'guide',
      )
      try {
        await guideServices.waitForGuideSuccessClose()
      } catch {
        // A transition timer failure must not strand a completed first-run setup.
      }
    }

    if (activeGuideRun !== runToken) {
      return
    }

    reportFirstRunGuideNotice(context, () => '')
    context.setGuideSuccessPending(false)
    context.closeGuide()
  }

  async function finishGuide(localOnly = false): Promise<void> {
    if (activeGuideRun) {
      return
    }

    const runToken = {}
    activeGuideRun = runToken

    try {
      await finishOwnedGuide(localOnly, runToken)
    } finally {
      if (activeGuideRun === runToken) {
        activeGuideRun = null
      }
    }
  }

  return {
    finishGuide,
  }
}

export function useFirstRunGuideController(
  context: FirstRunGuideControllerContext,
): FirstRunGuideController {
  useEffect(() => cancelFirstRunGuideCompletion, [])
  const guideState = useMemo(
    () =>
      deriveFirstRunGuideState({
        checkingProviderId: context.checkingProviderId,
        data: context.data,
        providerConnectivityResults: context.providerConnectivityResults,
        providerKeys: context.providerKeys,
        selectedPresetId: context.selectedPresetId,
        selectedProvider: context.selectedProvider,
        t: context.t,
      }),
    [
      context.checkingProviderId,
      context.data,
      context.providerConnectivityResults,
      context.providerKeys,
      context.selectedPresetId,
      context.selectedProvider,
      context.t,
    ],
  )
  const actions = createFirstRunGuideActions({
    ...context,
    guideState,
  })

  return {
    ...actions,
    guideState,
  }
}
