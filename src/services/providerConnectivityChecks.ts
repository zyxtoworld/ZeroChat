import type { NoticeTarget } from './noticeTypes'
import type { Translator } from '../i18n'
import type {
  AppData,
  ChatMessage,
  ProviderConfig,
} from '../types'
import {
  DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
  now,
} from './appData'
import type {
  editImage as editImageDefault,
  generateImage as generateImageDefault,
  listProviderModels as listProviderModelsDefault,
  streamChat as streamChatDefault,
} from './lazy'
import {
  displayProviderName,
  browserProviderKey,
  fallbackCapabilitiesForProvider,
  providerForAiRequest,
  shouldUseBrowserProviderKey,
} from './providerConfig'
import {
  buildProviderCapabilityRequestPlan,
  providerCapabilityCheckReadiness,
  executeProviderCapabilityRequestPlan as executeProviderCapabilityRequestPlanDefault,
  providerCapabilityChecksForProviderCapabilities,
  providerCapabilityCheckEndpointPath,
  providerCapabilityCheckLabel,
  providerCapabilityCheckKey,
  providerCapabilityCheckModel,
  providerCapabilityRequestForCheck,
  providerFullCapabilityCheckKey,
  type ProviderCapabilityCheckKind,
  type ProviderCapabilityRequestCheckKind,
} from './providerCapabilityChecks'
import {
  providerCapabilityRequestEndpointPath,
  type ProviderCapabilityRequestBlocker,
  type ProviderCapabilityReadyRequestPlan,
} from './providerCapabilityRequests'
import {
  managedProxyHostGroups,
  replaceManagedProxyHosts as replaceManagedProxyHostsDefault,
  safeProxyRootUrlForHostManagement,
  type ManagedProxyHostGroup,
} from './providerProxyHosts'
import {
  audioSpeechModelsForProvider,
  audioTranscriptionModelsForProvider,
  chatModelsForProvider,
  configuredModelsForProvider,
  defaultModelForProvider,
  imageModelsForProvider,
  modelsForProviderCapability,
  preferredChatModel,
  providerModelPatchFromFetchedModels,
  uniqueModels,
} from './providerModels'
import {
  modelCheckKey,
  providerCheckKey,
  providerConnectivityErrorField,
  type ProviderCapabilityProbeResult,
  type ModelCheckKind,
  type ProviderConnectivityResult,
} from './providerStatus'
import type { NoticeTone } from './uiRuntime'
import { reportDetachedNotice } from './detachedFailureReporting'
import {
  providerErrorCode,
  providerErrorRetryable,
} from './uiRuntime'

type SetProviderConnectivityResults = (
  updater: (
    current: Record<string, ProviderConnectivityResult>,
  ) => Record<string, ProviderConnectivityResult>,
) => void

type ProviderImageCapabilityCheckKind = Extract<
  ProviderCapabilityCheckKind,
  'image-edit' | 'image-generation' | 'image-inpaint'
>

const CAPABILITY_CHECK_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

interface ProviderConnectivityFailureContext {
  endpointPath: string
  model?: string
}

interface ProviderCapabilityBlockedResult {
  capability: ProviderCapabilityCheckKind
  message: string
  model: string
  status: 'blocked'
  tone: NoticeTone
}

interface ProviderCapabilityFailedResult {
  capability: ProviderCapabilityCheckKind
  message: string
  model: string
  status: 'failed'
  tone: 'error'
}

interface ProviderCapabilityPassedResult {
  capability: ProviderCapabilityCheckKind
  message: string
  model: string
  status: 'passed'
  tone: 'success'
}

type ProviderCapabilityRunResult =
  | ProviderCapabilityBlockedResult
  | ProviderCapabilityFailedResult
  | ProviderCapabilityPassedResult

type ProviderCapabilityPlanResolution =
  | { status: 'missing-provider' }
  | ProviderCapabilityBlockedResult
  | ProviderCapabilityFailedResult
  | {
      capability: ProviderCapabilityRequestCheckKind
      plan: ProviderCapabilityReadyRequestPlan
      status: 'ready'
    }
  | {
      apiKey: string
      capability: ProviderImageCapabilityCheckKind
      model: string
      provider: ProviderConfig
      proxyToken: string
      status: 'image-ready'
    }

const staleProviderCheckRun = {}
let activeProviderCheckController: AbortController | null = null

class ProviderConnectivityEmptyReplyError extends Error {}

export function cancelProviderConnectivityCheckRuns(): void {
  activeProviderCheckController?.abort()
  activeProviderCheckController = null
}

function assertProviderCheckRunCurrent(controller: AbortController): void {
  if (activeProviderCheckController !== controller) {
    throw staleProviderCheckRun
  }
}

function providerCheckRunIsStale(
  controller: AbortController,
  error: unknown,
): boolean {
  return (
    error === staleProviderCheckRun ||
    activeProviderCheckController !== controller
  )
}

function claimProviderCheckRun(): AbortController {
  const controller = new AbortController()
  activeProviderCheckController = controller
  return controller
}

export interface ProviderConnectivityCheckContext {
  checkingProviderId: string
  dataRef: { current: AppData | null }
  formatErrorMessage: (error: unknown) => string
  guideVisible: boolean
  modelLoadProviderIdRef: {
    cancel?: () => void
    current: string
  }
  providerKeysRef: { current: Record<string, string> }
  setCheckingProviderId: (providerId: string) => void
  setLoadingModelsProviderId: (providerId: string) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  setProviderConnectivityResults: SetProviderConnectivityResults
  setProviderModels: (
    providerId: string,
    models: string[],
    preferredModel?: string,
  ) => void
  syncPassphraseRef: { current: string }
  t: Translator
}

export interface ProviderConnectivityCheckServices {
  accessKeyFromPassword: (password: string) => Promise<string>
  editImage: typeof editImageDefault
  executeProviderCapabilityRequestPlan: typeof executeProviderCapabilityRequestPlanDefault
  generateImage: typeof generateImageDefault
  listProviderModels: typeof listProviderModelsDefault
  replaceManagedProxyHosts: typeof replaceManagedProxyHostsDefault
  streamChat: typeof streamChatDefault
}

export interface ProviderConnectivityCheckActions {
  checkProviderCapability: (
    providerId: string,
    capability: ProviderCapabilityCheckKind,
  ) => Promise<void>
  checkProviderFullCapabilities: (providerId: string) => Promise<void>
  checkProviderConnectivity: (providerId: string) => Promise<void>
  checkSelectedModel: (
    providerId: string,
    kind: ModelCheckKind,
  ) => Promise<void>
  refreshProviderModels: (providerId: string) => Promise<void>
  runProviderConnectivityCheck: (
    providerId: string,
  ) => Promise<ProviderConnectivityResult | null>
}

function providerRequiresProxyToken(provider: ProviderConfig): boolean {
  return Boolean(provider.proxyUrl?.trim())
}

function isProviderImageCapabilityCheck(
  capability: ProviderCapabilityCheckKind,
): capability is ProviderImageCapabilityCheckKind {
  return (
    capability === 'image-generation' ||
    capability === 'image-edit' ||
    capability === 'image-inpaint'
  )
}

function providerCapabilityCheckImageFile(name: string): File {
  return new File([CAPABILITY_CHECK_PNG_BYTES], name, { type: 'image/png' })
}

async function providerProxyTokenForRequest(
  provider: ProviderConfig,
  context: ProviderConnectivityCheckContext,
  services: ProviderConnectivityCheckServices,
): Promise<string> {
  if (!providerRequiresProxyToken(provider)) {
    return ''
  }

  return services.accessKeyFromPassword(context.syncPassphraseRef.current)
}

function managedProxyHostGroupsForRequest(
  data: AppData | null,
  requestProvider: ProviderConfig,
  proxyToken: string,
): ManagedProxyHostGroup[] {
  const endpoint = safeProxyRootUrlForHostManagement(
    requestProvider.proxyUrl?.trim() ?? '',
  )

  if (!data || !endpoint || !proxyToken || requestProvider.clientRequestMode) {
    return []
  }

  const requestScopedData: AppData = {
    ...data,
    providers: [
      ...data.providers.filter((provider) => provider.id !== requestProvider.id),
      {
        ...requestProvider,
        clientRequestMode: false,
        enabled: true,
        proxyUrl: endpoint,
      },
    ],
  }

  return managedProxyHostGroups(requestScopedData, proxyToken).filter(
    (group) => group.endpoint === endpoint,
  )
}

async function prepareProviderProxyHostsForCheck(
  requestProvider: ProviderConfig,
  context: ProviderConnectivityCheckContext,
  services: ProviderConnectivityCheckServices,
  proxyToken: string,
  signal: AbortSignal,
): Promise<void> {
  const groups = managedProxyHostGroupsForRequest(
    context.dataRef.current,
    requestProvider,
    proxyToken,
  )

  if (!groups.length) {
    return
  }

  await services.replaceManagedProxyHosts(groups, [], { signal })
}

async function runChatConnectivityProbe({
  apiKey,
  model,
  provider,
  proxyToken,
  services,
  signal,
  t,
}: {
  apiKey: string
  model: string
  provider: ProviderConfig
  proxyToken: string
  services: ProviderConnectivityCheckServices
  signal: AbortSignal
  t: Translator
}): Promise<void> {
  const checkMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: 'Reply with OK only.',
    createdAt: now(),
  }
  let probeReply = ''

  await services.streamChat({
    provider,
    apiKey,
    proxyToken,
    model,
    messages: [checkMessage],
    contextMessageLimit: DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
    signal,
    onToken: (token) => {
      probeReply += token
    },
  })

  if (!probeReply.trim()) {
    throw new ProviderConnectivityEmptyReplyError(
      t('error.providerConnectivityEmptyReply'),
    )
  }
}

function shouldProbeNextConnectivityModel(error: unknown): boolean {
  if (error instanceof ProviderConnectivityEmptyReplyError) {
    return true
  }

  const status = providerErrorStatus(error)

  return (
    providerErrorCode(error) === 'request' &&
    (status === 400 || status === 404 || status === 422)
  )
}

function explicitProviderConnectivityModel(provider: ProviderConfig): string {
  const configuredModel = provider.model.trim()
  const previousModels = uniqueModels(provider.models ?? [])

  if (!configuredModel) {
    return ''
  }

  return previousModels.includes(configuredModel) ? '' : configuredModel
}

function providerConnectivityProbeCandidates(
  provider: ProviderConfig,
  explicitModel = '',
): string[] {
  const chatModels = chatModelsForProvider(provider)
  const preferredModel = preferredChatModel(chatModels)
  const candidates = new Set<string>()

  if (explicitModel && chatModels.includes(explicitModel)) {
    candidates.add(explicitModel)
  }

  if (preferredModel) {
    candidates.add(preferredModel)
  }

  for (const model of chatModels) {
    if (model.trim()) {
      candidates.add(model)
    }
  }

  return [...candidates]
}

function shouldProbeConfiguredModelsAfterModelListFailure(error: unknown): boolean {
  const code = providerErrorCode(error)

  return (
    !code ||
    code === 'endpoint' ||
    code === 'network' ||
    code === 'request' ||
    code === 'server' ||
    code === 'timeout'
  )
}

export function clearProviderConnectivityResult(
  context: Pick<
    ProviderConnectivityCheckContext,
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

export function reportProviderConnectivityNotice(
  context: Pick<ProviderConnectivityCheckContext, 'setNotice'>,
  message: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): void {
  reportDetachedNotice(context.setNotice, message, tone, target)
}

export function createProviderConnectivityCheckActions(
  context: ProviderConnectivityCheckContext,
  services: ProviderConnectivityCheckServices,
): ProviderConnectivityCheckActions {
  const operationRef = context.modelLoadProviderIdRef
  operationRef.cancel = cancelProviderConnectivityCheckRuns

  async function runProviderConnectivityCheck(
    providerId: string,
  ): Promise<ProviderConnectivityResult | null> {
    if (
      context.checkingProviderId ||
      operationRef.current
    ) {
      return null
    }

    const provider = context.dataRef.current?.providers.find(
      (item) => item.id === providerId,
    )

    if (!provider) {
      return null
    }

    const requestProvider = providerForAiRequest(provider, context.dataRef.current)
    const apiKey = browserProviderKey(
      requestProvider,
      context.providerKeysRef.current,
    )

    if (shouldUseBrowserProviderKey(requestProvider) && !apiKey.trim()) {
      const result: ProviderConnectivityResult = {
        field: 'providerKey',
        message: context.t('error.providerKeyRequired'),
        retryable: false,
        tone: 'error',
      }

      context.setProviderConnectivityResults((current) => ({
        ...current,
        [providerId]: result,
      }))
      return result
    }

    operationRef.current = providerId
    const controller = claimProviderCheckRun()
    context.setCheckingProviderId(providerCheckKey(providerId))
    reportProviderConnectivityNotice(context, () => '')

    let failureContext: ProviderConnectivityFailureContext | null = {
      endpointPath: providerModelListConnectivityEndpointPath(),
    }

    try {
      const proxyToken = await providerProxyTokenForRequest(
        requestProvider,
        context,
        services,
      )
      assertProviderCheckRunCurrent(controller)
      failureContext = {
        endpointPath: providerProxyHostManagementEndpointPath(),
      }
      await prepareProviderProxyHostsForCheck(
        requestProvider,
        context,
        services,
        proxyToken,
        controller.signal,
      )
      assertProviderCheckRunCurrent(controller)
      failureContext = {
        endpointPath: providerModelListConnectivityEndpointPath(),
      }
      let connectivityModels: string[] | null = null
      const explicitProbeModel = explicitProviderConnectivityModel(requestProvider)
      let modelListFailureMessage = ''
      let probeProvider = requestProvider

      try {
        const models = await services.listProviderModels({
          provider: requestProvider,
          apiKey,
          proxyToken,
          signal: controller.signal,
        })
        assertProviderCheckRunCurrent(controller)
        const fetchedModels = uniqueModels(models)
        const explicitModelMissingFromCatalog =
          explicitProbeModel && !fetchedModels.includes(explicitProbeModel)
        connectivityModels = explicitModelMissingFromCatalog
          ? uniqueModels([explicitProbeModel, ...fetchedModels])
          : fetchedModels
        probeProvider = {
          ...requestProvider,
          ...providerModelPatchFromFetchedModels(
            requestProvider,
            connectivityModels,
          ),
        }
      } catch (modelListError: unknown) {
        assertProviderCheckRunCurrent(controller)
        if (!shouldProbeConfiguredModelsAfterModelListFailure(modelListError)) {
          throw modelListError
        }

        modelListFailureMessage = providerConnectivityFailureNoticeMessage({
          error: modelListError,
          failureContext,
          formatErrorMessage: context.formatErrorMessage,
          t: context.t,
        })

        if (providerConnectivityProbeCandidates(requestProvider).length === 0) {
          throw modelListError
        }
      }

      const probeModels = providerConnectivityProbeCandidates(
        probeProvider,
        explicitProbeModel,
      )
      failureContext = null

      if (probeModels.length === 0) {
        throw new Error(context.t('error.modelRequired'))
      }

      let probeModel = ''
      let probeError: unknown = null
      for (const candidate of probeModels) {
        assertProviderCheckRunCurrent(controller)
        failureContext = {
          endpointPath: providerChatConnectivityEndpointPath(probeProvider),
          model: candidate,
        }
        try {
          await runChatConnectivityProbe({
            provider: {
              ...probeProvider,
              model: candidate,
            },
            apiKey,
            proxyToken,
            model: candidate,
            signal: controller.signal,
            services,
            t: context.t,
          })
          assertProviderCheckRunCurrent(controller)
          probeModel = candidate
          probeError = null
          break
        } catch (error: unknown) {
          assertProviderCheckRunCurrent(controller)
          probeError = error
          if (!shouldProbeNextConnectivityModel(error)) {
            break
          }
        }
      }

      if (!probeModel) {
        throw probeError ?? new Error(context.t('error.providerConnectivityEmptyReply'))
      }

      if (connectivityModels) {
        assertProviderCheckRunCurrent(controller)
        context.setProviderModels(providerId, connectivityModels, probeModel)
      } else {
        context.setProviderModels(
          providerId,
          configuredModelsForProvider(requestProvider),
          probeModel,
        )
      }

      const result: ProviderConnectivityResult = {
        field: 'none',
        message: connectivityModels
          ? context.t('notice.providerConnectivityPassed', {
              count: connectivityModels.length,
              model: probeModel,
            })
          : context.t('notice.providerConnectivityPassedWithConfiguredModel', {
              message: modelListFailureMessage,
              model: probeModel,
            }),
        ...(connectivityModels ? { models: connectivityModels } : {}),
        retryable: false,
        tone: 'success',
      }

      context.setProviderConnectivityResults((current) => ({
        ...current,
        [providerId]: result,
      }))
      return result
    } catch (error: unknown) {
      if (providerCheckRunIsStale(controller, error)) {
        return null
      }
      const message = context.t('notice.providerConnectivityFailed', {
        message: providerConnectivityFailureNoticeMessage({
          error,
          failureContext,
          formatErrorMessage: context.formatErrorMessage,
          t: context.t,
        }),
      })
      const result: ProviderConnectivityResult = {
        field: providerConnectivityErrorField(requestProvider, error),
        message,
        retryable: providerErrorRetryable(error) !== false,
        tone: 'error',
      }

      context.setProviderConnectivityResults((current) => ({
        ...current,
        [providerId]: result,
      }))
      reportProviderConnectivityNotice(context, () => message, 'error', 'providers')
      return result
    } finally {
      if (activeProviderCheckController === controller) {
        activeProviderCheckController = null
        operationRef.current = ''
        context.setCheckingProviderId('')
      }
    }
  }

  async function checkProviderConnectivity(providerId: string): Promise<void> {
    await runProviderConnectivityCheck(providerId)
  }

  async function resolveProviderCapabilityPlan(
    providerId: string,
    capability: ProviderCapabilityRequestCheckKind,
    controller: AbortController,
  ): Promise<ProviderCapabilityPlanResolution> {
    const provider = context.dataRef.current?.providers.find(
      (item) => item.id === providerId,
    )

    if (!provider) {
      return { status: 'missing-provider' }
    }

    const requestProvider = providerForAiRequest(
      provider,
      context.dataRef.current,
    )
    const apiKey = browserProviderKey(
      requestProvider,
      context.providerKeysRef.current,
    )
    const request = providerCapabilityRequestForCheck(capability)
    const preflightPlan = buildProviderCapabilityRequestPlan({
      provider: requestProvider,
      apiKey,
      proxyToken: '',
      request,
    })

    if (
      preflightPlan.status === 'blocked' &&
      preflightPlan.blocker !== 'proxy-token-required'
    ) {
      return {
        capability,
        message: capabilityBlockerNotice({
          blocker: preflightPlan.blocker,
          capability,
          model: preflightPlan.model,
          provider: requestProvider,
          t: context.t,
        }),
        model: preflightPlan.model ?? providerCapabilityCheckModel(
          requestProvider,
          capability,
        ),
        status: 'blocked',
        tone: capabilityBlockerTone(preflightPlan.blocker),
      }
    }

    let plan = preflightPlan

    if (
      preflightPlan.status === 'blocked' &&
      preflightPlan.blocker === 'proxy-token-required'
    ) {
      let proxyToken: string

      try {
        proxyToken = await services.accessKeyFromPassword(
          context.syncPassphraseRef.current,
        )
        assertProviderCheckRunCurrent(controller)
        await prepareProviderProxyHostsForCheck(
          requestProvider,
          context,
          services,
          proxyToken,
          controller.signal,
        )
        assertProviderCheckRunCurrent(controller)
      } catch (error: unknown) {
        if (providerCheckRunIsStale(controller, error)) {
          throw error
        }
        const capabilityModel =
          preflightPlan.model ||
          providerCapabilityCheckModel(requestProvider, capability)

        return {
          capability,
          message: context.formatErrorMessage(error),
          model: capabilityModel,
          status: 'failed',
          tone: 'error',
        }
      }

      plan = buildProviderCapabilityRequestPlan({
        provider: requestProvider,
        apiKey,
        proxyToken,
        request,
      })

      if (plan.status === 'blocked') {
        return {
          capability,
          message: capabilityBlockerNotice({
            blocker: plan.blocker,
            capability,
            model: plan.model,
            provider: requestProvider,
            t: context.t,
          }),
          model: plan.model ?? providerCapabilityCheckModel(
            requestProvider,
            capability,
          ),
          status: 'blocked',
          tone: capabilityBlockerTone(plan.blocker),
        }
      }
    }

    if (plan.status === 'blocked') {
      return {
        capability,
        message: capabilityBlockerNotice({
          blocker: plan.blocker,
          capability,
          model: plan.model,
          provider: requestProvider,
          t: context.t,
        }),
        model: plan.model ?? providerCapabilityCheckModel(
          requestProvider,
          capability,
        ),
        status: 'blocked',
        tone: capabilityBlockerTone(plan.blocker),
      }
    }

    return {
      capability,
      plan,
      status: 'ready',
    }
  }

  async function resolveProviderImageCapabilityPlan(
    providerId: string,
    capability: ProviderImageCapabilityCheckKind,
    controller: AbortController,
  ): Promise<ProviderCapabilityPlanResolution> {
    const provider = context.dataRef.current?.providers.find(
      (item) => item.id === providerId,
    )

    if (!provider) {
      return { status: 'missing-provider' }
    }

    const requestProvider = providerForAiRequest(
      provider,
      context.dataRef.current,
    )
    const model = providerCapabilityCheckModel(requestProvider, capability)

    if (!requestProvider.enabled) {
      return {
        capability,
        message: context.t('notice.providerDisabled', {
          provider: displayProviderName(requestProvider, context.t),
        }),
        model,
        status: 'blocked',
        tone: 'error',
      }
    }

    if (!model.trim()) {
      return {
        capability,
        message: context.t('error.imageModelRequired'),
        model,
        status: 'blocked',
        tone: 'warning',
      }
    }

    const apiKey = browserProviderKey(
      requestProvider,
      context.providerKeysRef.current,
    )

    if (shouldUseBrowserProviderKey(requestProvider) && !apiKey.trim()) {
      return {
        capability,
        message: context.t('error.providerKeyRequired'),
        model,
        status: 'blocked',
        tone: 'warning',
      }
    }

    let proxyToken: string

    try {
      proxyToken = await providerProxyTokenForRequest(
        requestProvider,
        context,
        services,
      )
      assertProviderCheckRunCurrent(controller)
      await prepareProviderProxyHostsForCheck(
        requestProvider,
        context,
        services,
        proxyToken,
        controller.signal,
      )
      assertProviderCheckRunCurrent(controller)
    } catch (error: unknown) {
      assertProviderCheckRunCurrent(controller)
      if (providerCheckRunIsStale(controller, error)) {
        throw error
      }
      return {
        capability,
        message: context.formatErrorMessage(error),
        model,
        status: 'failed',
        tone: 'error',
      }
    }

    return {
      apiKey,
      capability,
      model,
      provider: requestProvider,
      proxyToken,
      status: 'image-ready',
    }
  }

  async function runResolvedProviderCapabilityPlan(
    capability: ProviderCapabilityRequestCheckKind,
    plan: ProviderCapabilityReadyRequestPlan,
    controller: AbortController,
  ): Promise<ProviderCapabilityRunResult> {
    try {
      const result = await services.executeProviderCapabilityRequestPlan({
        plan: {
          ...plan,
          init: {
            ...plan.init,
            signal: controller.signal,
          },
        },
      })
      assertProviderCheckRunCurrent(controller)

      return {
        capability: result.capability,
        message: context.t('notice.providerCapabilityCheckPassed', {
          capability: providerCapabilityCheckLabel(result.capability, context.t),
          model: result.model,
        }),
        model: result.model,
        status: 'passed',
        tone: 'success',
      }
    } catch (error: unknown) {
      assertProviderCheckRunCurrent(controller)
      if (providerCheckRunIsStale(controller, error)) {
        throw error
      }
      const endpointPath = providerCapabilityRequestEndpointPath(plan.kind)

      return {
        capability,
        message: capabilityFailureNoticeMessage({
          endpointPath,
          error,
          formatErrorMessage: context.formatErrorMessage,
          t: context.t,
        }),
        model: plan.model,
        status: 'failed',
        tone: 'error',
      }
    }
  }

  async function runResolvedProviderImageCapabilityPlan(
    resolution: Extract<ProviderCapabilityPlanResolution, { status: 'image-ready' }>,
    controller: AbortController,
  ): Promise<ProviderCapabilityRunResult> {
    const capability = resolution.capability

    try {
      if (capability === 'image-generation') {
        const options = {
          provider: resolution.provider,
          apiKey: resolution.apiKey,
          proxyToken: resolution.proxyToken,
          model: resolution.model,
          prompt: 'ZeroChat connectivity check',
          signal: controller.signal,
        }

        await services.generateImage(options)
        assertProviderCheckRunCurrent(controller)
      } else {
        const options = {
          provider: resolution.provider,
          apiKey: resolution.apiKey,
          proxyToken: resolution.proxyToken,
          model: resolution.model,
          prompt: 'ZeroChat connectivity check',
          image: providerCapabilityCheckImageFile(
            'zerochat-capability-check-source.png',
          ),
          ...(capability === 'image-inpaint'
            ? {
                mask: providerCapabilityCheckImageFile(
                  'zerochat-capability-check-mask.png',
                ),
              }
            : {}),
          signal: controller.signal,
        }

        await services.editImage(options)
        assertProviderCheckRunCurrent(controller)
      }

      return {
        capability,
        message: context.t('notice.providerCapabilityCheckPassed', {
          capability: providerCapabilityCheckLabel(capability, context.t),
          model: resolution.model,
        }),
        model: resolution.model,
        status: 'passed',
        tone: 'success',
      }
    } catch (error: unknown) {
      assertProviderCheckRunCurrent(controller)
      if (providerCheckRunIsStale(controller, error)) {
        throw error
      }
      return {
        capability,
        message: capabilityFailureNoticeMessage({
          endpointPath: providerCapabilityCheckEndpointPath(capability),
          error,
          formatErrorMessage: context.formatErrorMessage,
          t: context.t,
        }),
        model: resolution.model,
        status: 'failed',
        tone: 'error',
      }
    }
  }

  function showProviderCapabilityRunResult(
    result: ProviderCapabilityRunResult,
  ): void {
    if (result.status === 'passed') {
      reportProviderConnectivityNotice(
        context,
        () => result.message,
        result.tone,
        'provider-capabilities',
      )
      return
    }

    if (result.status === 'failed') {
      reportProviderConnectivityNotice(
        context,
        () => context.t('notice.providerCapabilityCheckFailed', {
          capability: providerCapabilityCheckLabel(result.capability, context.t),
          message: result.message,
          model: result.model,
        }),
        result.tone,
        'provider-capabilities',
      )
      return
    }

    reportProviderConnectivityNotice(
      context,
      () => result.message,
      result.tone,
      'provider-capabilities',
    )
  }

  function capabilityProbeResult(
    result: ProviderCapabilityRunResult,
  ): ProviderCapabilityProbeResult {
    return {
      message: result.message,
      model: result.model,
      status: result.status,
      tone: result.tone,
    }
  }

  function recordProviderCapabilityResult(
    providerId: string,
    result: ProviderCapabilityRunResult,
  ): void {
    const probeResult = capabilityProbeResult(result)

    context.setProviderConnectivityResults((current) => ({
      ...current,
      [providerId]: {
        field: 'none',
        message: result.message,
        retryable: result.status === 'failed',
        retryAction: result.status === 'failed' ? 'fullCapabilities' : undefined,
        tone: result.tone,
        capabilityResults: {
          ...current[providerId]?.capabilityResults,
          [result.capability]: probeResult,
        },
      },
    }))
  }

  function capabilityProbeResults(
    results: ProviderCapabilityRunResult[],
  ): Partial<Record<ProviderCapabilityCheckKind, ProviderCapabilityProbeResult>> {
    return Object.fromEntries(
      results.map((result) => [result.capability, capabilityProbeResult(result)]),
    )
  }

  function providerFullCapabilityFailureField(
    provider: ProviderConfig,
    failures: ProviderCapabilityRunResult[],
  ): ProviderConnectivityResult['field'] {
    if (
      failures.some(
        (failure) => failure.message === context.t('error.providerKeyRequired'),
      )
    ) {
      return 'providerKey'
    }

    if (failures.every((failure) => failure.tone === 'warning')) {
      return 'none'
    }

    return provider.proxyUrl?.trim() ? 'proxyUrl' : 'baseUrl'
  }

  function providerFullCapabilityFailureTone(
    failures: ProviderCapabilityRunResult[],
  ): NoticeTone {
    return failures.every((failure) => failure.tone === 'warning')
      ? 'warning'
      : 'error'
  }

  async function checkProviderCapability(
    providerId: string,
    capability: ProviderCapabilityCheckKind,
  ): Promise<void> {
    if (
      context.checkingProviderId ||
      operationRef.current
    ) {
      return
    }

    operationRef.current = providerId
    const controller = claimProviderCheckRun()
    let requestStarted = false

    try {
      const resolution = isProviderImageCapabilityCheck(capability)
        ? await resolveProviderImageCapabilityPlan(
            providerId,
            capability,
            controller,
          )
        : await resolveProviderCapabilityPlan(
            providerId,
            capability,
            controller,
          )
      assertProviderCheckRunCurrent(controller)

      if (resolution.status === 'missing-provider') {
        return
      }

      if (resolution.status !== 'ready' && resolution.status !== 'image-ready') {
        recordProviderCapabilityResult(providerId, resolution)
        showProviderCapabilityRunResult(resolution)
        return
      }

      reportProviderConnectivityNotice(context, () => '')
      requestStarted = true
      context.setCheckingProviderId(
        providerCapabilityCheckKey(providerId, resolution.capability),
      )

      if (resolution.status === 'image-ready') {
        const result = await runResolvedProviderImageCapabilityPlan(
          resolution,
          controller,
        )
        assertProviderCheckRunCurrent(controller)
        recordProviderCapabilityResult(providerId, result)
        showProviderCapabilityRunResult(result)
      } else {
        const result = await runResolvedProviderCapabilityPlan(
          resolution.capability,
          resolution.plan,
          controller,
        )
        assertProviderCheckRunCurrent(controller)
        recordProviderCapabilityResult(providerId, result)
        showProviderCapabilityRunResult(result)
      }
    } catch (error: unknown) {
      if (!providerCheckRunIsStale(controller, error)) {
        throw error
      }
    } finally {
      if (activeProviderCheckController === controller) {
        activeProviderCheckController = null
        operationRef.current = ''
        if (requestStarted) {
          context.setCheckingProviderId('')
        }
      }
    }
  }

  async function checkProviderFullCapabilities(providerId: string): Promise<void> {
    if (
      context.checkingProviderId ||
      operationRef.current
    ) {
      return
    }

    const provider = context.dataRef.current?.providers.find(
      (item) => item.id === providerId,
    )

    if (!provider) {
      return
    }

    const requestProvider = providerForAiRequest(provider, context.dataRef.current)
    const providerCapabilities = fallbackCapabilitiesForProvider(requestProvider)
    const capabilityChecks = providerCapabilityChecksForProviderCapabilities(
      providerCapabilities,
    )

    if (!capabilityChecks.length) {
      return
    }

    const readiness = providerCapabilityCheckReadiness(
      requestProvider,
      providerCapabilities,
      context.t,
    )

    if (
      readiness.state === 'missing-models' ||
      (
      readiness.state === 'server-drill' &&
        readiness.serverDrillChecks.length === capabilityChecks.length
      )
    ) {
      reportProviderConnectivityNotice(
        context,
        () => readiness.text,
        'warning',
        'provider-capabilities',
      )
      return
    }

    const results: ProviderCapabilityRunResult[] = []
    operationRef.current = providerId
    const controller = claimProviderCheckRun()
    context.setCheckingProviderId(providerFullCapabilityCheckKey(providerId))
    reportProviderConnectivityNotice(context, () => '')

    try {
      for (const capability of capabilityChecks) {
        const resolution = isProviderImageCapabilityCheck(capability)
          ? await resolveProviderImageCapabilityPlan(
              providerId,
              capability,
              controller,
            )
          : await resolveProviderCapabilityPlan(
              providerId,
              capability,
              controller,
            )
        assertProviderCheckRunCurrent(controller)

        if (resolution.status === 'missing-provider') {
          return
        }

        if (resolution.status === 'image-ready') {
          const result = await runResolvedProviderImageCapabilityPlan(
            resolution,
            controller,
          )
          assertProviderCheckRunCurrent(controller)
          results.push(result)
          continue
        }

        if (resolution.status !== 'ready') {
          results.push(resolution)
          continue
        }

        const result = await runResolvedProviderCapabilityPlan(
          resolution.capability,
          resolution.plan,
          controller,
        )
        assertProviderCheckRunCurrent(controller)
        results.push(result)
      }
    } catch (error: unknown) {
      if (providerCheckRunIsStale(controller, error)) {
        return
      }
      throw error
    } finally {
      if (activeProviderCheckController === controller) {
        activeProviderCheckController = null
        operationRef.current = ''
        context.setCheckingProviderId('')
      }
    }

    const failures = results.filter((result) => result.status !== 'passed')

    if (failures.length) {
      const message = context.t('notice.providerFullCapabilityCheckFailed', {
        failed: failures.length,
        total: results.length,
      })
      const tone = providerFullCapabilityFailureTone(failures)

      context.setProviderConnectivityResults((current) => ({
        ...current,
        [providerId]: {
          field: providerFullCapabilityFailureField(requestProvider, failures),
          message,
          retryable: failures.some((failure) => failure.status === 'failed'),
          retryAction: 'fullCapabilities',
          tone,
          capabilityResults: capabilityProbeResults(results),
        },
      }))
      reportProviderConnectivityNotice(
        context,
        () => message,
        tone,
        'provider-capabilities',
      )
      return
    }

    const message = context.t('notice.providerFullCapabilityCheckPassed', {
      count: results.length,
    })

    context.setProviderConnectivityResults((current) => ({
      ...current,
      [providerId]: {
        field: 'none',
        message,
        retryable: false,
        tone: 'success',
        capabilityResults: capabilityProbeResults(results),
      },
    }))
    reportProviderConnectivityNotice(
      context,
      () => message,
      'success',
      'provider-capabilities',
    )
  }

  async function checkSelectedModel(
    providerId: string,
    kind: ModelCheckKind,
  ): Promise<void> {
    if (
      context.checkingProviderId ||
      operationRef.current
    ) {
      return
    }

    const provider = context.dataRef.current?.providers.find(
      (item) => item.id === providerId,
    )

    if (!provider) {
      return
    }

    const model = selectedModelForConnectivity(provider, kind)

    if (!model.trim()) {
      reportProviderConnectivityNotice(
        context,
        () => selectedModelRequiredNotice(kind, context.t),
        'warning',
        modelNoticeTarget(kind),
      )
      return
    }

    const requestProvider = providerForAiRequest(
      provider,
      context.dataRef.current,
    )
    const apiKey = browserProviderKey(
      requestProvider,
      context.providerKeysRef.current,
    )

    if (shouldUseBrowserProviderKey(requestProvider) && !apiKey.trim()) {
      reportProviderConnectivityNotice(
        context,
        () => context.t('error.providerKeyRequired'),
        'warning',
        modelNoticeTarget(kind),
      )
      return
    }

    operationRef.current = providerId
    const controller = claimProviderCheckRun()
    context.setCheckingProviderId(modelCheckKey(providerId, kind))
    reportProviderConnectivityNotice(context, () => '')

    try {
      const proxyToken = await providerProxyTokenForRequest(
        requestProvider,
        context,
        services,
      )
      assertProviderCheckRunCurrent(controller)
      await prepareProviderProxyHostsForCheck(
        requestProvider,
        context,
        services,
        proxyToken,
        controller.signal,
      )
      assertProviderCheckRunCurrent(controller)

      if (kind === 'image') {
        await services.generateImage({
          provider: requestProvider,
          apiKey,
          proxyToken,
          model,
          prompt: 'ZeroChat connectivity check',
          signal: controller.signal,
        })
        assertProviderCheckRunCurrent(controller)
      } else {
        const capability = selectedModelCapability(kind)

        if (!capability) {
          await runChatConnectivityProbe({
            provider: requestProvider,
            apiKey,
            proxyToken,
            model,
            signal: controller.signal,
            services,
            t: context.t,
          })
          assertProviderCheckRunCurrent(controller)
        } else {
          const plan = buildProviderCapabilityRequestPlan({
            apiKey,
            provider: requestProvider,
            proxyToken,
            request: providerCapabilityRequestForCheck(capability),
            signal: controller.signal,
          })

          if (plan.status === 'blocked') {
            throw new Error(capabilityBlockerNotice({
              blocker: plan.blocker,
              capability,
              model: plan.model,
              provider: requestProvider,
              t: context.t,
            }))
          }

          await services.executeProviderCapabilityRequestPlan({ plan })
          assertProviderCheckRunCurrent(controller)
        }
      }

      reportProviderConnectivityNotice(
        context,
        () => context.t('notice.modelConnectivityPassed', { model }),
        'success',
        modelNoticeTarget(kind),
      )
    } catch (error: unknown) {
      if (providerCheckRunIsStale(controller, error)) {
        return
      }
      reportProviderConnectivityNotice(
        context,
        () => context.t('notice.modelConnectivityFailed', {
          message: context.formatErrorMessage(error),
        }),
        'error',
        modelNoticeTarget(kind),
      )
    } finally {
      if (activeProviderCheckController === controller) {
        activeProviderCheckController = null
        operationRef.current = ''
        context.setCheckingProviderId('')
      }
    }
  }

  async function refreshProviderModels(providerId: string): Promise<void> {
    if (operationRef.current) {
      return
    }

    const provider = context.dataRef.current?.providers.find(
      (item) => item.id === providerId,
    )

    if (!provider) {
      return
    }

    const noticeTarget: NoticeTarget = context.guideVisible
      ? 'guide-models'
      : 'models'
    const requestProvider = providerForAiRequest(
      provider,
      context.dataRef.current,
    )
    const apiKey = browserProviderKey(
      requestProvider,
      context.providerKeysRef.current,
    )

    if (shouldUseBrowserProviderKey(requestProvider) && !apiKey.trim()) {
      reportProviderConnectivityNotice(
        context,
        () => context.t('error.providerKeyRequired'),
        'warning',
        noticeTarget,
      )
      return
    }

    operationRef.current = providerId
    const controller = claimProviderCheckRun()
    context.setLoadingModelsProviderId(providerId)
    reportProviderConnectivityNotice(context, () => '')

    try {
      const proxyToken = await providerProxyTokenForRequest(
        requestProvider,
        context,
        services,
      )
      assertProviderCheckRunCurrent(controller)
      await prepareProviderProxyHostsForCheck(
        requestProvider,
        context,
        services,
        proxyToken,
        controller.signal,
      )
      assertProviderCheckRunCurrent(controller)
      const models = await services.listProviderModels({
        provider: requestProvider,
        apiKey,
        proxyToken,
        signal: controller.signal,
      })
      assertProviderCheckRunCurrent(controller)

      const firstModel = models[0]

      if (!firstModel) {
        reportProviderConnectivityNotice(
          context,
          () => context.t('notice.modelsFetched', { count: models.length }),
          'success',
          noticeTarget,
        )
        return
      }

      context.setProviderModels(providerId, models)
      reportProviderConnectivityNotice(
        context,
        () => context.t('notice.modelsFetched', { count: models.length }),
        'success',
        noticeTarget,
      )
    } catch (error: unknown) {
      if (providerCheckRunIsStale(controller, error)) {
        return
      }
      reportProviderConnectivityNotice(
        context,
        () => context.t('notice.modelsFetchFailed', {
          message: context.formatErrorMessage(error),
        }),
        'error',
        noticeTarget,
      )
    } finally {
      if (activeProviderCheckController === controller) {
        activeProviderCheckController = null
        operationRef.current = ''
        context.setLoadingModelsProviderId('')
      }
    }
  }

  return {
    checkProviderCapability,
    checkProviderFullCapabilities,
    checkProviderConnectivity,
    checkSelectedModel,
    refreshProviderModels,
    runProviderConnectivityCheck,
  }
}

function selectedModelForConnectivity(
  provider: ProviderConfig,
  kind: ModelCheckKind,
): string {
  if (kind === 'audio-speech') {
    const audioModels = audioSpeechModelsForProvider(provider)
    return provider.audioSpeechModel &&
      audioModels.includes(provider.audioSpeechModel)
      ? provider.audioSpeechModel
      : ''
  }

  if (kind === 'audio-transcription') {
    const audioModels = audioTranscriptionModelsForProvider(provider)
    return provider.audioTranscriptionModel &&
      audioModels.includes(provider.audioTranscriptionModel)
      ? provider.audioTranscriptionModel
      : ''
  }

  if (kind === 'image') {
    const imageModels = imageModelsForProvider(provider)
    return provider.imageModel && imageModels.includes(provider.imageModel)
      ? provider.imageModel
      : ''
  }

  if (kind === 'embeddings') {
    const embeddingModels = modelsForProviderCapability(provider, 'embeddings')
    return provider.embeddingModel &&
      embeddingModels.includes(provider.embeddingModel)
      ? provider.embeddingModel
      : ''
  }

  if (kind === 'moderation') {
    const moderationModels = modelsForProviderCapability(provider, 'moderation')
    return provider.moderationModel &&
      moderationModels.includes(provider.moderationModel)
      ? provider.moderationModel
      : ''
  }

  if (kind === 'realtime') {
    const realtimeModels = modelsForProviderCapability(provider, 'realtime')
    return provider.realtimeModel && realtimeModels.includes(provider.realtimeModel)
      ? provider.realtimeModel
      : ''
  }

  return defaultModelForProvider(provider)
}

function modelNoticeTarget(kind: ModelCheckKind): NoticeTarget {
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

function selectedModelRequiredNotice(
  kind: ModelCheckKind,
  t: Translator,
): string {
  const capability = selectedModelCapability(kind)

  if (capability) {
    return t('error.capabilityModelRequired', {
      capability: providerCapabilityCheckLabel(capability, t),
    })
  }

  return kind === 'image' ? t('error.imageModelRequired') : t('error.modelRequired')
}

function selectedModelCapability(
  kind: ModelCheckKind,
): ProviderCapabilityRequestCheckKind | null {
  switch (kind) {
    case 'audio-speech':
    case 'audio-transcription':
    case 'embeddings':
    case 'moderation':
    case 'realtime':
      return kind
    case 'chat':
    case 'image':
      return null
  }
}

function providerModelListConnectivityEndpointPath(): string {
  return '/models'
}

function providerProxyHostManagementEndpointPath(): string {
  return '/proxy/hosts'
}

function providerChatConnectivityEndpointPath(
  provider: ProviderConfig,
): string {
  switch (provider.kind) {
    case 'anthropic':
      return '/messages'
    case 'openai-responses':
      return '/responses'
    case 'openai-compatible':
      return '/chat/completions'
  }
}

function providerErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const status = (error as { status?: unknown }).status

  if (typeof status !== 'number' || !Number.isFinite(status)) {
    return null
  }

  return status
}

function endpointFailureNoticeMessage({
  error,
  endpointPath,
  formatErrorMessage,
  model,
}: {
  error: unknown
  endpointPath: string
  formatErrorMessage: (error: unknown) => string
  model?: string
}): string {
  const status = providerErrorStatus(error)
  const code = providerErrorCode(error)
  const statusText =
    status !== null &&
    (code === 'endpoint' ||
      code === 'server' ||
      code === 'timeout' ||
      code === 'rate-limit' ||
      code === 'request')
      ? `HTTP ${status}`
      : ''

  return [
    endpointPath,
    model?.trim(),
    statusText,
    formatErrorMessage(error),
  ]
    .filter(Boolean)
    .join(' · ')
}

function providerConnectivityFailureNoticeMessage({
  error,
  failureContext,
  formatErrorMessage,
  t,
}: {
  error: unknown
  failureContext: ProviderConnectivityFailureContext | null
  formatErrorMessage: (error: unknown) => string
  t: Translator
}): string {
  if (!failureContext) {
    return formatErrorMessage(error)
  }

  const message = endpointFailureNoticeMessage({
    error,
    endpointPath: failureContext.endpointPath,
    formatErrorMessage,
    model: failureContext.model,
  })

  return providerErrorCode(error) === 'endpoint'
    ? `${message} · ${t('error.providerCapabilityEndpointRouteHealth')}`
    : message
}

function capabilityFailureNoticeMessage({
  endpointPath,
  error,
  formatErrorMessage,
  t,
}: {
  endpointPath: string
  error: unknown
  formatErrorMessage: (error: unknown) => string
  t: Translator
}): string {
  const message = endpointFailureNoticeMessage({
    endpointPath,
    error,
    formatErrorMessage,
  })

  if (providerErrorCode(error) === 'endpoint') {
    return `${message} · ${t('error.providerCapabilityEndpointRouteHealth')}`
  }

  if (providerErrorCode(error) === 'server') {
    return `${message} · ${t('error.providerCapabilityServiceHealth')}`
  }

  return message
}

function capabilityBlockerTone(
  blocker: ProviderCapabilityRequestBlocker,
): NoticeTone {
  return blocker === 'provider-disabled' ? 'error' : 'warning'
}

function capabilityBlockerNotice({
  blocker,
  capability,
  model,
  provider,
  t,
}: {
  blocker: ProviderCapabilityRequestBlocker
  capability: ProviderCapabilityCheckKind
  model?: string
  provider: ProviderConfig
  t: Translator
}): string {
  switch (blocker) {
    case 'file-required':
      return t('error.capabilityFileRequired')
    case 'input-required':
      return t('error.capabilityInputRequired')
    case 'model-required':
      return t('error.capabilityModelRequired', {
        capability: providerCapabilityCheckLabel(capability, t),
      })
    case 'provider-disabled':
      return t('notice.providerDisabled', {
        provider: displayProviderName(provider, t),
      })
    case 'provider-key-required':
      return t('error.providerKeyRequired')
    case 'provider-required':
      return t('option.noEnabledProviders')
    case 'proxy-token-required':
      return t('error.cloudflareAccessKeyRequired')
    case 'realtime-server-transport-required': {
      const modelName = model?.trim()
      const serverDrill = t('error.realtimeServerDrill')

      return modelName
        ? `${serverDrill} · ${t('settings.capabilityCheckModel', {
            model: modelName,
          })}`
        : serverDrill
    }
  }
}
