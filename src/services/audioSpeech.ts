import { rt } from '../i18n'
import type { ProviderConfig } from '../types'
import {
  assertProviderResponseOk,
  cancelUnreadProviderResponse,
  isAbortError,
  MAX_PROVIDER_AUDIO_RESPONSE_BYTES,
  ProviderRequestError,
  providerConnectionError,
  providerTimeoutError,
  readProviderResponseBytes,
} from './providerErrors'
import {
  buildProviderCapabilityRequestPlan,
  type ProviderCapabilityRequestBlocker,
} from './providerCapabilityRequests'
import { providerAudioResponseLooksValid } from './providerResponses'
import { providerTimeoutSignal } from './providerTimeoutSignal'

export interface SpeechAudioResult {
  blob: Blob
  model: string
}

export interface SynthesizeSpeechOptions {
  apiKey: string
  fetcher?: typeof fetch
  provider: ProviderConfig | null
  proxyToken: string
  signal?: AbortSignal
  text: string
  timeoutMs?: number
}

const PROVIDER_AUDIO_SPEECH_TIMEOUT_MS = 180_000

function audioSpeechBlockerMessage(
  blocker: ProviderCapabilityRequestBlocker,
): string {
  switch (blocker) {
    case 'file-required':
      return rt('error.capabilityFileRequired')
    case 'input-required':
      return rt('error.capabilityInputRequired')
    case 'model-required':
      return rt('error.capabilityModelRequired', {
        capability: rt('capability.audio-speech'),
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

function audioSpeechConnectionTarget(): string {
  return rt('capability.audio-speech')
}

export async function synthesizeSpeechAudio({
  apiKey,
  fetcher = fetch,
  provider,
  proxyToken,
  signal,
  text,
  timeoutMs = PROVIDER_AUDIO_SPEECH_TIMEOUT_MS,
}: SynthesizeSpeechOptions): Promise<SpeechAudioResult> {
  const plan = buildProviderCapabilityRequestPlan({
    apiKey,
    provider,
    proxyToken,
    request: {
      kind: 'audio-speech',
      input: text.trim(),
      responseFormat: 'mp3',
      voice: 'alloy',
    },
    signal,
  })

  if (plan.status === 'blocked') {
    throw new Error(audioSpeechBlockerMessage(plan.blocker))
  }

  const timeoutSignal = providerTimeoutSignal(plan.init.signal, timeoutMs)
  let response: Response | undefined

  try {
    response = await fetcher(plan.endpoint, {
      ...plan.init,
      signal: timeoutSignal.signal,
    })

    await assertProviderResponseOk(response, timeoutSignal.signal)

    const bytes = await readProviderResponseBytes(
      response,
      MAX_PROVIDER_AUDIO_RESPONSE_BYTES,
      timeoutSignal.signal,
    )
    const audioBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer

    if (
      !providerAudioResponseLooksValid(
        bytes,
        response.headers.get('content-type') ?? '',
      )
    ) {
      throw new Error(rt('error.capabilityResponseInvalid'))
    }

    const blob = new Blob(
      [audioBuffer],
      {
        type: response.headers.get('content-type') ?? 'application/octet-stream',
      },
    )

    if (blob.size <= 0) {
      throw new Error(rt('error.capabilityResponseInvalid'))
    }

    timeoutSignal.signal.throwIfAborted()
    return {
      blob,
      model: plan.model,
    }
  } catch (error: unknown) {
    cancelUnreadProviderResponse(response)

    if (timeoutSignal.timedOut()) {
      throw providerTimeoutError()
    }

    if (timeoutSignal.sourceAborted()) {
      throw new DOMException('Aborted', 'AbortError')
    }

    if (isAbortError(error) || error instanceof ProviderRequestError) {
      throw error
    }

    if (
      error instanceof Error &&
      error.message === rt('error.capabilityResponseInvalid')
    ) {
      throw error
    }

    throw providerConnectionError(plan.provider, audioSpeechConnectionTarget())
  } finally {
    timeoutSignal.dispose()
  }
}
