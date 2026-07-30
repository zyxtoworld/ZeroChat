import type { ProviderConfig } from '../types'
import {
  modelForProviderAudioSpeech,
  modelForProviderAudioTranscription,
  modelForProviderCapability,
  type ProviderModelCapability,
} from './providerModels'
import {
  buildProviderAudioSpeechBody,
  buildProviderAudioSpeechEndpoint,
  buildProviderAudioSpeechHeaders,
  buildProviderAudioTranscriptionBody,
  buildProviderAudioTranscriptionEndpoint,
  buildProviderAudioTranscriptionHeaders,
  buildProviderEmbeddingsBody,
  buildProviderEmbeddingsEndpoint,
  buildProviderEmbeddingsHeaders,
  buildProviderModerationsBody,
  buildProviderModerationsEndpoint,
  buildProviderModerationsHeaders,
  buildProviderRealtimeClientSecretsBody,
  buildProviderRealtimeClientSecretsEndpoint,
  buildProviderRealtimeClientSecretsHeaders,
} from './providerRequests'
import {
  providerNeedsBrowserKey,
  providerUsesProxy,
} from './providerRequestMode'

export type ProviderCapabilityRequestKind =
  | 'audio-speech'
  | 'audio-transcription'
  | 'embeddings'
  | 'moderation'
  | 'realtime'

export type ProviderCapabilityRequestBlocker =
  | 'file-required'
  | 'input-required'
  | 'model-required'
  | 'provider-disabled'
  | 'provider-key-required'
  | 'provider-required'
  | 'proxy-token-required'
  | 'realtime-server-transport-required'

export interface ProviderCapabilityRequestAuth {
  apiKey: string
  proxyToken: string
}

export interface ProviderEmbeddingsCapabilityRequest {
  input: string | string[]
  kind: 'embeddings'
}

export interface ProviderModerationCapabilityRequest {
  input: string
  kind: 'moderation'
}

export interface ProviderAudioSpeechCapabilityRequest {
  input: string
  kind: 'audio-speech'
  responseFormat?: string
  speed?: number
  voice?: string
}

export interface ProviderAudioTranscriptionCapabilityRequest {
  file: File | null
  kind: 'audio-transcription'
  language?: string
  prompt?: string
  responseFormat?: string
  temperature?: number
}

export interface ProviderRealtimeCapabilityRequest {
  inputAudioFormat?: string
  instructions?: string
  kind: 'realtime'
  modalities?: string[]
  outputAudioFormat?: string
  voice?: string
}

export type ProviderCapabilityRequest =
  | ProviderAudioSpeechCapabilityRequest
  | ProviderAudioTranscriptionCapabilityRequest
  | ProviderEmbeddingsCapabilityRequest
  | ProviderModerationCapabilityRequest
  | ProviderRealtimeCapabilityRequest

export interface BuildProviderCapabilityRequestPlanOptions
  extends ProviderCapabilityRequestAuth {
  provider: ProviderConfig | null
  request: ProviderCapabilityRequest
  signal?: AbortSignal
}

export interface ProviderCapabilityReadyRequestPlan {
  endpoint: string
  init: RequestInit
  kind: ProviderCapabilityRequestKind
  model: string
  modelCapability: ProviderModelCapability
  provider: ProviderConfig
  status: 'ready'
}

export interface ProviderCapabilityBlockedRequestPlan {
  blocker: ProviderCapabilityRequestBlocker
  kind: ProviderCapabilityRequestKind
  model: string
  modelCapability: ProviderModelCapability
  status: 'blocked'
}

export type ProviderCapabilityRequestPlan =
  | ProviderCapabilityBlockedRequestPlan
  | ProviderCapabilityReadyRequestPlan

export function modelCapabilityForProviderCapabilityRequest(
  kind: ProviderCapabilityRequestKind,
): ProviderModelCapability {
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

export function providerCapabilityRequestEndpointPath(
  kind: ProviderCapabilityRequestKind,
): string {
  switch (kind) {
    case 'audio-speech':
      return '/audio/speech'
    case 'audio-transcription':
      return '/audio/transcriptions'
    case 'embeddings':
      return '/embeddings'
    case 'moderation':
      return '/moderations'
    case 'realtime':
      return '/realtime/client_secrets'
  }
}

function blockedPlan(
  request: ProviderCapabilityRequest,
  blocker: ProviderCapabilityRequestBlocker,
  model = '',
): ProviderCapabilityBlockedRequestPlan {
  return {
    blocker,
    kind: request.kind,
    model,
    modelCapability: modelCapabilityForProviderCapabilityRequest(request.kind),
    status: 'blocked',
  }
}

function textInputHasContent(input: string | string[]): boolean {
  return Array.isArray(input)
    ? input.some((item) => item.trim())
    : Boolean(input.trim())
}

function capabilityInputBlocker(
  request: ProviderCapabilityRequest,
): ProviderCapabilityRequestBlocker | '' {
  switch (request.kind) {
    case 'audio-speech':
      return textInputHasContent(request.input) ? '' : 'input-required'
    case 'audio-transcription':
      return request.file ? '' : 'file-required'
    case 'embeddings':
      return textInputHasContent(request.input) ? '' : 'input-required'
    case 'moderation':
      return textInputHasContent(request.input) ? '' : 'input-required'
    case 'realtime':
      return ''
  }
}

function modelForCapabilityRequest(
  provider: ProviderConfig,
  request: ProviderCapabilityRequest,
): string {
  switch (request.kind) {
    case 'audio-speech':
      return modelForProviderAudioSpeech(provider)
    case 'audio-transcription':
      return modelForProviderAudioTranscription(provider)
    case 'embeddings':
    case 'moderation':
    case 'realtime':
      return modelForProviderCapability(
        provider,
        modelCapabilityForProviderCapabilityRequest(request.kind),
      )
  }
}

function readyPlan(
  options: BuildProviderCapabilityRequestPlanOptions & {
    model: string
    modelCapability: ProviderModelCapability
    provider: ProviderConfig
  },
): ProviderCapabilityReadyRequestPlan {
  const {
    apiKey,
    model,
    modelCapability,
    provider,
    proxyToken,
    request,
    signal,
  } = options
  const auth = { provider, apiKey, proxyToken }

  switch (request.kind) {
    case 'audio-speech':
      return {
        endpoint: buildProviderAudioSpeechEndpoint(provider),
        init: {
          method: 'POST',
          signal,
          headers: buildProviderAudioSpeechHeaders(auth),
          body: JSON.stringify(
            buildProviderAudioSpeechBody({
              model,
              input: request.input,
              voice: request.voice,
              responseFormat: request.responseFormat,
              speed: request.speed,
            }),
          ),
        },
        kind: request.kind,
        model,
        modelCapability,
        provider,
        status: 'ready',
      }
    case 'audio-transcription':
      if (!request.file) {
        throw new Error('Audio transcription request file is required.')
      }

      return {
        endpoint: buildProviderAudioTranscriptionEndpoint(provider),
        init: {
          method: 'POST',
          signal,
          headers: buildProviderAudioTranscriptionHeaders(auth),
          body: buildProviderAudioTranscriptionBody({
            model,
            file: request.file,
            prompt: request.prompt,
            language: request.language,
            responseFormat: request.responseFormat,
            temperature: request.temperature,
          }),
        },
        kind: request.kind,
        model,
        modelCapability,
        provider,
        status: 'ready',
      }
    case 'embeddings':
      return {
        endpoint: buildProviderEmbeddingsEndpoint(provider),
        init: {
          method: 'POST',
          signal,
          headers: buildProviderEmbeddingsHeaders(auth),
          body: JSON.stringify(
            buildProviderEmbeddingsBody({
              model,
              input: request.input,
            }),
          ),
        },
        kind: request.kind,
        model,
        modelCapability,
        provider,
        status: 'ready',
      }
    case 'moderation':
      return {
        endpoint: buildProviderModerationsEndpoint(provider),
        init: {
          method: 'POST',
          signal,
          headers: buildProviderModerationsHeaders(auth),
          body: JSON.stringify(
            buildProviderModerationsBody({
              model,
              input: request.input,
            }),
          ),
        },
        kind: request.kind,
        model,
        modelCapability,
        provider,
        status: 'ready',
      }
    case 'realtime':
      return {
        endpoint: buildProviderRealtimeClientSecretsEndpoint(provider),
        init: {
          method: 'POST',
          signal,
          headers: buildProviderRealtimeClientSecretsHeaders(auth),
          body: JSON.stringify(
            buildProviderRealtimeClientSecretsBody({
              model,
              modalities: request.modalities,
              instructions: request.instructions,
              voice: request.voice,
              inputAudioFormat: request.inputAudioFormat,
              outputAudioFormat: request.outputAudioFormat,
            }),
          ),
        },
        kind: request.kind,
        model,
        modelCapability,
        provider,
        status: 'ready',
      }
  }
}

export function buildProviderCapabilityRequestPlan(
  options: BuildProviderCapabilityRequestPlanOptions,
): ProviderCapabilityRequestPlan {
  const { apiKey, provider, proxyToken, request } = options
  const modelCapability = modelCapabilityForProviderCapabilityRequest(
    request.kind,
  )

  if (!provider) {
    return blockedPlan(request, 'provider-required')
  }

  if (!provider.enabled) {
    return blockedPlan(request, 'provider-disabled')
  }

  const model = modelForCapabilityRequest(provider, request)

  if (!model.trim()) {
    return blockedPlan(request, 'model-required', model)
  }

  if (providerNeedsBrowserKey(provider) && !apiKey.trim()) {
    return blockedPlan(request, 'provider-key-required', model)
  }

  if (providerUsesProxy(provider) && !proxyToken.trim()) {
    return blockedPlan(request, 'proxy-token-required', model)
  }

  const inputBlocker = capabilityInputBlocker(request)

  if (inputBlocker) {
    return blockedPlan(request, inputBlocker, model)
  }

  if (request.kind === 'realtime' && !providerUsesProxy(provider)) {
    return blockedPlan(request, 'realtime-server-transport-required', model)
  }

  return readyPlan({
    ...options,
    model,
    modelCapability,
    provider,
  })
}
