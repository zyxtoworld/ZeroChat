import { rt } from '../i18n'
import type { ProviderConfig } from '../types'
import {
  assertProviderResponseOk,
  cancelUnreadProviderResponse,
  isAbortError,
  MAX_PROVIDER_TEXT_RESPONSE_BYTES,
  ProviderRequestError,
  providerConnectionError,
  providerTimeoutError,
  readProviderResponseText,
} from './providerErrors'
import {
  buildProviderCapabilityRequestPlan,
  type ProviderCapabilityRequestBlocker,
} from './providerCapabilityRequests'
import { transcriptionTextFromProviderResponse } from './providerResponses'
import { capabilityLabel } from './providerConfigCore'
import { providerTimeoutSignal } from './providerTimeoutSignal'
import { audioSourceFileRejection } from './audioAttachments'
import {
  localFileTooLargeMessage,
  MAX_AUDIO_FILE_BYTES,
} from './localFileLimits'

export interface AudioTranscriptionResult {
  model: string
  text: string
}

export interface TranscribeAudioFileOptions {
  apiKey: string
  fetcher?: typeof fetch
  file: File | null
  prompt?: string
  provider: ProviderConfig | null
  proxyToken: string
  signal?: AbortSignal
  timeoutMs?: number
}

const PROVIDER_AUDIO_TRANSCRIPTION_TIMEOUT_MS = 180_000

function audioTranscriptionBlockerMessage(
  blocker: ProviderCapabilityRequestBlocker,
): string {
  switch (blocker) {
    case 'file-required':
      return rt('notice.audioRequired')
    case 'input-required':
      return rt('error.capabilityInputRequired')
    case 'model-required':
      return rt('error.capabilityModelRequired', {
        capability: capabilityLabel('audio', rt),
      })
    case 'provider-disabled':
      return rt('notice.providerDisabled')
    case 'provider-key-required':
      return rt('error.providerKeyRequired')
    case 'provider-required':
      return rt('option.noEnabledProviders')
    case 'proxy-token-required':
      return rt('error.cloudflareAccessKeyRequired')
    case 'realtime-server-transport-required':
      return rt('error.realtimeServerDrill')
  }
}

function audioTranscriptionConnectionTarget(): string {
  return rt('capability.audio-transcription')
}

export async function transcribeAudioFile({
  apiKey,
  fetcher = fetch,
  file,
  prompt,
  provider,
  proxyToken,
  signal,
  timeoutMs = PROVIDER_AUDIO_TRANSCRIPTION_TIMEOUT_MS,
}: TranscribeAudioFileOptions): Promise<AudioTranscriptionResult> {
  const audioSourceRejection = file
    ? audioSourceFileRejection(file)
    : null

  if (audioSourceRejection === 'too-large') {
    throw new Error(localFileTooLargeMessage(rt, MAX_AUDIO_FILE_BYTES))
  }

  if (audioSourceRejection === 'unsupported') {
    throw new Error(rt('notice.audioSourceUnsupported'))
  }

  const plan = buildProviderCapabilityRequestPlan({
    apiKey,
    provider,
    proxyToken,
    request: {
      kind: 'audio-transcription',
      file,
      prompt: prompt?.trim() || undefined,
    },
    signal,
  })

  if (plan.status === 'blocked') {
    throw new Error(audioTranscriptionBlockerMessage(plan.blocker))
  }

  const timeoutSignal = providerTimeoutSignal(plan.init.signal, timeoutMs)
  let response: Response | undefined

  try {
    response = await fetcher(plan.endpoint, {
      ...plan.init,
      signal: timeoutSignal.signal,
    })

    await assertProviderResponseOk(response, timeoutSignal.signal)
    const body = await readProviderResponseText(
      response,
      MAX_PROVIDER_TEXT_RESPONSE_BYTES,
      timeoutSignal.signal,
    )

    if (!body.readable) {
      throw new ProviderRequestError('request', rt('error.apiRequestFailed'), {
        retryable: false,
        status: response.status,
      })
    }

    const result = {
      model: plan.model,
      text: transcriptionTextFromProviderResponse(body.text),
    }
    timeoutSignal.signal.throwIfAborted()
    return result
  } catch (error: unknown) {
    cancelUnreadProviderResponse(response)

    if (timeoutSignal.timedOut()) {
      throw providerTimeoutError()
    }

    if (timeoutSignal.sourceAborted()) {
      throw new DOMException('Aborted', 'AbortError')
    }

    if (
      isAbortError(error) ||
      error instanceof ProviderRequestError ||
      error instanceof Error && error.message === rt('error.audioTranscriptionNoText')
    ) {
      throw error
    }

    throw providerConnectionError(plan.provider, audioTranscriptionConnectionTarget())
  } finally {
    timeoutSignal.dispose()
  }
}
