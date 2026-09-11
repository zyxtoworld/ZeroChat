import { rt } from '../i18n'
import type {
  TranslationKey,
  Translator,
} from '../i18n'
import type { ProviderCapability } from '../types'
import type { ProviderConfig } from '../types'
import {
  assertProviderResponseOk,
  cancelUnreadProviderResponse,
  isAbortError,
  MAX_PROVIDER_AUDIO_RESPONSE_BYTES,
  MAX_PROVIDER_TEXT_RESPONSE_BYTES,
  ProviderRequestError,
  providerConnectionError,
  providerTimeoutError,
  readProviderJsonResponse,
  readProviderResponseBytes,
  readProviderResponseText,
} from './providerErrors'
import {
  buildProviderCapabilityRequestPlan,
  providerCapabilityRequestEndpointPath,
  type ProviderCapabilityReadyRequestPlan,
  type ProviderCapabilityRequest,
  type ProviderCapabilityRequestKind,
} from './providerCapabilityRequests'
import {
  modelForProviderAudioSpeech,
  modelForProviderAudioTranscription,
  modelForProviderCapability,
} from './providerModels'
import { providerUsesProxy } from './providerRequestMode'
import { providerAudioResponseLooksValid } from './providerResponses'
import { providerTimeoutSignal } from './providerTimeoutSignal'

export type ProviderCapabilityCheckKind =
  | 'audio'
  | 'audio-speech'
  | 'audio-transcription'
  | 'embeddings'
  | 'image-edit'
  | 'image-generation'
  | 'image-inpaint'
  | 'moderation'
  | 'realtime'

export type ProviderCapabilityRequestCheckKind = Exclude<
  ProviderCapabilityCheckKind,
  'image-edit' | 'image-generation' | 'image-inpaint'
>

export const PROVIDER_FULL_CAPABILITY_CHECKS: ProviderCapabilityCheckKind[] = [
  'image-generation',
  'image-edit',
  'image-inpaint',
  'embeddings',
  'moderation',
  'audio-speech',
  'audio-transcription',
  'realtime',
]

export interface ExecuteProviderCapabilityRequestPlanOptions {
  fetcher?: typeof fetch
  plan: ProviderCapabilityReadyRequestPlan
  timeoutMs?: number
}

export interface ProviderCapabilityCheckResult {
  capability: ProviderCapabilityCheckKind
  model: string
  status: number
}

export type ProviderCapabilityReadinessState =
  | 'missing-models'
  | 'server-drill'
  | 'ready'

export type ProviderCapabilityCheckDisplayState =
  | 'missing-model'
  | 'server-drill'
  | 'ready'

export interface ProviderCapabilityCheckDisplay {
  endpointModelText: string
  endpointPath: string
  label: string
  missingModelGuidance: string
  modelName: string
  modelText: string
  runsInBrowser: boolean
  serverDrillText: string
  state: ProviderCapabilityCheckDisplayState
  tooltip: string
}

export interface ProviderCapabilityReadiness {
  missingModelChecks: ProviderCapabilityCheckKind[]
  serverDrillChecks: ProviderCapabilityCheckKind[]
  state: ProviderCapabilityReadinessState
  text: string
}

const PROVIDER_CAPABILITY_REQUEST_TIMEOUT_MS = 30_000
const CAPABILITY_CHECK_WAV_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
  0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
  0x64, 0x61, 0x74, 0x61, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
])

export function providerCapabilityCheckKey(
  providerId: string,
  capability: ProviderCapabilityCheckKind,
): string {
  return `${providerId}:capability:${capability}`
}

export function providerFullCapabilityCheckKey(providerId: string): string {
  return `${providerId}:capabilities`
}

export function providerCapabilityCheckLabel(
  capability: ProviderCapabilityCheckKind,
  t: Translator,
): string {
  if (capability === 'image-edit') {
    return t('capability.image-editing')
  }

  if (capability === 'image-inpaint') {
    return t('mode.imageInpaint')
  }

  return t(`capability.${capability}` as TranslationKey)
}

export function providerCapabilityCheckEndpointPath(
  capability: ProviderCapabilityCheckKind,
): string {
  if (capability === 'image-generation') {
    return '/images/generations'
  }

  if (capability === 'image-edit' || capability === 'image-inpaint') {
    return '/images/edits'
  }

  const requestKind: ProviderCapabilityRequestKind =
    capability === 'audio' ? 'audio-speech' : capability

  return providerCapabilityRequestEndpointPath(requestKind)
}

export function providerCapabilityCheckModel(
  provider: ProviderConfig,
  capability: ProviderCapabilityCheckKind,
): string {
  switch (capability) {
    case 'audio':
      return modelForProviderCapability(provider, 'audio')
    case 'audio-speech':
      return modelForProviderAudioSpeech(provider)
    case 'audio-transcription':
      return modelForProviderAudioTranscription(provider)
    case 'image-edit':
    case 'image-inpaint':
      return modelForProviderCapability(provider, 'image-editing')
    case 'image-generation':
    case 'embeddings':
    case 'moderation':
    case 'realtime':
      return modelForProviderCapability(provider, capability)
  }
}

export function providerCapabilityCheckSupportedByProviderCapabilities(
  capability: ProviderCapabilityCheckKind,
  providerCapabilities: ProviderCapability[],
): boolean {
  const providerCapabilitySet = new Set(providerCapabilities)

  switch (capability) {
    case 'audio':
    case 'audio-speech':
    case 'audio-transcription':
      return providerCapabilitySet.has('audio')
    case 'image-edit':
    case 'image-inpaint':
      return providerCapabilitySet.has('image-editing')
    case 'image-generation':
    case 'embeddings':
    case 'moderation':
    case 'realtime':
      return providerCapabilitySet.has(capability)
  }
}

export function providerCapabilityChecksForProviderCapabilities(
  providerCapabilities: ProviderCapability[],
): ProviderCapabilityCheckKind[] {
  return PROVIDER_FULL_CAPABILITY_CHECKS.filter((capability) =>
    providerCapabilityCheckSupportedByProviderCapabilities(
      capability,
      providerCapabilities,
    ),
  )
}

export function missingProviderCapabilityCheckModels(
  provider: ProviderConfig,
  providerCapabilities: ProviderCapability[],
): ProviderCapabilityCheckKind[] {
  return providerCapabilityChecksForProviderCapabilities(
    providerCapabilities,
  ).filter(
    (capability) => !providerCapabilityCheckModel(provider, capability).trim(),
  )
}

export function providerCapabilityCheckRunsInBrowser(
  capability: ProviderCapabilityCheckKind,
  provider?: ProviderConfig,
): boolean {
  return capability !== 'realtime' || Boolean(provider && providerUsesProxy(provider))
}

export function providerCapabilityChecksRequiringServerDrill(
  provider: ProviderConfig,
  providerCapabilities: ProviderCapability[],
): ProviderCapabilityCheckKind[] {
  return providerCapabilityChecksForProviderCapabilities(
    providerCapabilities,
  ).filter((capability) => {
    const model = providerCapabilityCheckModel(provider, capability).trim()

    return Boolean(model) && !providerCapabilityCheckRunsInBrowser(capability, provider)
  })
}

export function providerCapabilityCheckDisplay(
  provider: ProviderConfig,
  capability: ProviderCapabilityCheckKind,
  t: Translator,
): ProviderCapabilityCheckDisplay {
  const label = providerCapabilityCheckLabel(capability, t)
  const modelName = providerCapabilityCheckModel(provider, capability).trim()
  const missingModelGuidance = t('error.capabilityModelRequired', {
    capability: label,
  })
  const modelText = modelName
    ? t('settings.capabilityCheckModel', { model: modelName })
    : t('settings.capabilityCheckModelMissing')
  const endpointPath = providerCapabilityCheckEndpointPath(capability)
  const endpointModelText = `${endpointPath} · ${modelText}`
  const runsInBrowser = providerCapabilityCheckRunsInBrowser(capability, provider)
  const state: ProviderCapabilityCheckDisplayState = !modelName
    ? 'missing-model'
    : runsInBrowser
      ? 'ready'
      : 'server-drill'
  const serverDrillText = `${t('error.realtimeServerDrill')} · ${modelText}`
  const tooltip = modelName
    ? runsInBrowser
      ? endpointModelText
      : `${endpointPath} · ${serverDrillText}`
    : missingModelGuidance

  return {
    endpointModelText,
    endpointPath,
    label,
    missingModelGuidance,
    modelName,
    modelText,
    runsInBrowser,
    serverDrillText,
    state,
    tooltip,
  }
}

export function providerCapabilityCheckReadiness(
  provider: ProviderConfig,
  providerCapabilities: ProviderCapability[],
  t: Translator,
): ProviderCapabilityReadiness {
  const capabilityDisplays = providerCapabilityChecksForProviderCapabilities(
    providerCapabilities,
  ).map((capability) => ({
    capability,
    display: providerCapabilityCheckDisplay(provider, capability, t),
  }))
  const missingModelChecks = capabilityDisplays
    .filter(({ display }) => display.state === 'missing-model')
    .map(({ capability }) => capability)
  const serverDrillChecks = capabilityDisplays
    .filter(({ display }) => display.state === 'server-drill')
    .map(({ capability }) => capability)
  const state: ProviderCapabilityReadinessState =
    missingModelChecks.length > 0
      ? 'missing-models'
      : serverDrillChecks.length > 0
        ? 'server-drill'
        : 'ready'
  const capabilityLabels =
    state === 'missing-models'
      ? capabilityDisplays
          .filter(({ display }) => display.state === 'missing-model')
          .map(({ display }) => display.label)
      : capabilityDisplays
          .filter(({ display }) => display.state === 'server-drill')
          .map(({ display }) => display.label)
  const text =
    state === 'missing-models'
      ? t('settings.capabilityReadinessMissing', {
          capabilities: capabilityLabels.join(' / '),
        })
      : state === 'server-drill'
        ? `${t('error.realtimeServerDrill')} · ${capabilityLabels.join(' / ')}`
        : t('settings.capabilityReadinessReady')

  return {
    missingModelChecks,
    serverDrillChecks,
    state,
    text,
  }
}

function providerCapabilityCheckAudioFile(): File {
  return new File(
    [CAPABILITY_CHECK_WAV_BYTES],
    'zerochat-capability-check.wav',
    { type: 'audio/wav' },
  )
}

function providerCapabilityConnectionTarget(
  kind: ProviderCapabilityRequest['kind'],
): string {
  return rt(
    `capability.${providerCapabilityForRequestKind(kind)}` as TranslationKey,
  )
}

export function providerCapabilityRequestForCheck(
  capability: ProviderCapabilityRequestCheckKind,
): ProviderCapabilityRequest {
  switch (capability) {
    case 'audio':
    case 'audio-speech':
      return {
        kind: 'audio-speech',
        input: 'ZeroChat capability check.',
        voice: 'alloy',
      }
    case 'audio-transcription':
      return {
        kind: 'audio-transcription',
        file: providerCapabilityCheckAudioFile(),
        language: 'en',
        prompt: 'ZeroChat capability check.',
        responseFormat: 'json',
      }
    case 'embeddings':
      return {
        kind: 'embeddings',
        input: 'ZeroChat capability check',
      }
    case 'moderation':
      return {
        kind: 'moderation',
        input: 'ZeroChat capability check: neutral setup text.',
      }
    case 'realtime':
      return {
        kind: 'realtime',
        modalities: ['text'],
        instructions: 'ZeroChat capability check.',
      }
  }
}

export function providerCapabilityForRequestKind(
  kind: ProviderCapabilityReadyRequestPlan['kind'],
): ProviderCapabilityCheckKind {
  switch (kind) {
    case 'audio-speech':
      return 'audio-speech'
    case 'audio-transcription':
      return 'audio-transcription'
    case 'embeddings':
      return 'embeddings'
    case 'moderation':
      return 'moderation'
    case 'realtime':
      return 'realtime'
  }
}

function invalidCapabilityResponse(): Error {
  return new Error(rt('error.capabilityResponseInvalid'))
}

async function readCapabilityAudioBytes(
  response: Response,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  try {
    const bytes = await readProviderResponseBytes(
      response,
      MAX_PROVIDER_AUDIO_RESPONSE_BYTES,
      signal,
    )
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw error
    }
    throw invalidCapabilityResponse()
  }
}

async function validateEmbeddingsResponse(
  response: Response,
  signal: AbortSignal,
): Promise<void> {
  const value = await readProviderJsonResponse(
    response,
    MAX_PROVIDER_TEXT_RESPONSE_BYTES,
    signal,
  ) as {
    data?: Array<{ embedding?: unknown }>
  }
  const vector = Array.isArray(value?.data)
    ? value.data[0]?.embedding
    : undefined

  if (
    !Array.isArray(vector) ||
    vector.length === 0 ||
    !vector.every((item) => typeof item === 'number')
  ) {
    throw invalidCapabilityResponse()
  }
}

async function validateModerationResponse(
  response: Response,
  signal: AbortSignal,
): Promise<void> {
  const value = await readProviderJsonResponse(
    response,
    MAX_PROVIDER_TEXT_RESPONSE_BYTES,
    signal,
  ) as {
    results?: Array<{ flagged?: unknown }>
  }
  const result = Array.isArray(value?.results) ? value.results[0] : undefined

  if (!result || typeof result.flagged !== 'boolean') {
    throw invalidCapabilityResponse()
  }
}

async function validateAudioResponse(
  response: Response,
  signal: AbortSignal,
): Promise<void> {
  const bytes = await readCapabilityAudioBytes(response, signal)

  if (bytes.byteLength === 0) {
    throw invalidCapabilityResponse()
  }

  if (
    !providerAudioResponseLooksValid(
      new Uint8Array(bytes),
      response.headers.get('content-type') ?? '',
    )
  ) {
    throw invalidCapabilityResponse()
  }
}

function hasNonEmptyText(value: unknown): boolean {
  return typeof value === 'string' && Boolean(value.trim())
}

function outputArrayHasText(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false
  }

  return value.some((item) => {
    if (typeof item !== 'object' || item === null) {
      return false
    }

    const record = item as {
      content?: unknown
      text?: unknown
    }

    return (
      hasNonEmptyText(record.text) ||
      Array.isArray(record.content) &&
        record.content.some(
          (content) =>
            typeof content === 'object' &&
            content !== null &&
            hasNonEmptyText((content as { text?: unknown }).text),
        )
    )
  })
}

function audioTranscriptionResponseHasText(value: unknown): boolean {
  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (!trimmed) {
      return false
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return audioTranscriptionResponseHasText(JSON.parse(trimmed))
      } catch {
        return false
      }
    }

    return true
  }

  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as {
    data?: unknown
    output?: unknown
    output_text?: unknown
    result?: unknown
    segments?: unknown
    text?: unknown
    transcript?: unknown
  }

  return (
    hasNonEmptyText(record.text) ||
    hasNonEmptyText(record.transcript) ||
    hasNonEmptyText(record.output_text) ||
    hasNonEmptyText(record.result) ||
    outputArrayHasText(record.segments) ||
    outputArrayHasText(record.output) ||
    outputArrayHasText(record.data)
  )
}

async function validateAudioTranscriptionResponse(
  response: Response,
  signal: AbortSignal,
): Promise<void> {
  const body = await readProviderResponseText(
    response,
    MAX_PROVIDER_TEXT_RESPONSE_BYTES,
    signal,
  )

  if (!body.readable || !audioTranscriptionResponseHasText(body.text)) {
    throw invalidCapabilityResponse()
  }
}

function realtimeClientSecretValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value !== 'object' || value === null) {
    return ''
  }

  const record = value as {
    secret?: unknown
    value?: unknown
  }

  if (typeof record.value === 'string' && record.value.trim()) {
    return record.value.trim()
  }

  if (typeof record.secret === 'string' && record.secret.trim()) {
    return record.secret.trim()
  }

  return ''
}

function realtimeClientSecretResponseHasSecret(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as {
    client_secret?: unknown
    ephemeral_key?: unknown
    secret?: unknown
  }

  return Boolean(
    realtimeClientSecretValue(record.client_secret) ||
      realtimeClientSecretValue(record.ephemeral_key) ||
      realtimeClientSecretValue(record.secret),
  )
}

async function validateRealtimeResponse(
  response: Response,
  signal: AbortSignal,
): Promise<void> {
  const value = await readProviderJsonResponse(
    response,
    MAX_PROVIDER_TEXT_RESPONSE_BYTES,
    signal,
  )

  if (!realtimeClientSecretResponseHasSecret(value)) {
    throw invalidCapabilityResponse()
  }
}

async function validateCapabilityResponse(
  plan: ProviderCapabilityReadyRequestPlan,
  response: Response,
  signal: AbortSignal,
): Promise<void> {
  switch (plan.kind) {
    case 'audio-speech':
      await validateAudioResponse(response, signal)
      return
    case 'audio-transcription':
      await validateAudioTranscriptionResponse(response, signal)
      return
    case 'embeddings':
      await validateEmbeddingsResponse(response, signal)
      return
    case 'moderation':
      await validateModerationResponse(response, signal)
      return
    case 'realtime':
      await validateRealtimeResponse(response, signal)
      return
  }
}

export async function executeProviderCapabilityRequestPlan({
  fetcher = fetch,
  plan,
  timeoutMs = PROVIDER_CAPABILITY_REQUEST_TIMEOUT_MS,
}: ExecuteProviderCapabilityRequestPlanOptions): Promise<ProviderCapabilityCheckResult> {
  const timeoutSignal = providerTimeoutSignal(
    plan.init.signal,
    timeoutMs,
  )
  let response: Response | undefined

  try {
    response = await fetcher(plan.endpoint, {
      ...plan.init,
      signal: timeoutSignal.signal,
    })

    await assertProviderResponseOk(response, timeoutSignal.signal)
    await validateCapabilityResponse(plan, response, timeoutSignal.signal)
    timeoutSignal.signal.throwIfAborted()

    return {
      capability: providerCapabilityForRequestKind(plan.kind),
      model: plan.model,
      status: response.status,
    }
  } catch (error: unknown) {
    cancelUnreadProviderResponse(response)

    if (timeoutSignal.timedOut()) {
      throw providerTimeoutError()
    }

    if (timeoutSignal.sourceAborted()) {
      throw new DOMException('Aborted', 'AbortError')
    }

    if (isAbortError(error)) {
      throw error
    }

    if (
      error instanceof ProviderRequestError ||
      error instanceof Error && error.message === rt('error.capabilityResponseInvalid')
    ) {
      throw error
    }

    throw providerConnectionError(
      plan.provider,
      providerCapabilityConnectionTarget(plan.kind),
    )
  } finally {
    timeoutSignal.dispose()
  }
}

export { buildProviderCapabilityRequestPlan }
