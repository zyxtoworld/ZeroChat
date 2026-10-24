import type { ChatMessage, ProviderConfig } from '../types'
import { rt } from '../i18n'
import { normalizeChatContextMessageLimit } from './appData'
import {
  generatedImageFromProviderResponse,
  parseProviderModelIds,
  type GeneratedImage,
} from './providerResponses'
import {
  accumulateProviderResponseBytes,
  assertProviderResponseContentLength,
  assertProviderResponseOk,
  cancelUnreadProviderResponse,
  isAbortError,
  MAX_PROVIDER_IMAGE_RESPONSE_BYTES,
  MAX_PROVIDER_STREAM_RESPONSE_BYTES,
  ProviderRequestError,
  providerConnectionError,
  providerEmptyResponseError,
  providerTimeoutError,
  readProviderJsonResponse,
} from './providerErrors'
import { fileToDataUrl } from './imageAttachments'
import { materializeGeneratedImage } from './generatedImagePersistence'
import {
  buildProviderAnthropicChatBody,
  buildProviderChatEndpoint,
  buildProviderChatHeaders,
  buildProviderImageEditBody,
  buildProviderImageEditEndpoint,
  buildProviderImageEditHeaders,
  buildProviderImageGenerationBody,
  buildProviderImageGenerationEndpoint,
  buildProviderImageGenerationHeaders,
  buildProviderModelListEndpoint,
  buildProviderModelListHeaders,
  buildProviderOpenAIChatBody,
  buildProviderResponsesImageEditBody,
  buildProviderResponsesImageGenerationBody,
  buildProviderResponsesImageGenerationEndpoint,
  buildProviderResponsesImageGenerationHeaders,
  buildProviderResponsesChatBody,
} from './providerRequests'
import {
  providerNeedsBrowserKey,
  providerUsesProxy,
} from './providerRequestMode'
import { providerTimeoutSignal } from './providerTimeoutSignal'
import {
  isResponsesWebSocketFallbackError,
  streamResponsesWebSocket,
} from './responsesWebSocket'

export { synthesizeSpeechAudio } from './audioSpeech'
export { transcribeAudioFile } from './audioTranscription'

interface StreamOptions {
  provider: ProviderConfig
  apiKey: string
  proxyToken: string
  model: string
  messages: ChatMessage[]
  contextMessageLimit: number
  compactionItems?: unknown[]
  maxInputTokens?: number
  signal: AbortSignal
  onToken: (token: string) => void
}

interface ListModelsOptions {
  provider: ProviderConfig
  apiKey: string
  proxyToken: string
  signal?: AbortSignal
}

interface GenerateImageOptions {
  provider: ProviderConfig
  apiKey: string
  proxyToken: string
  model: string
  prompt: string
  responsesModel?: string
  signal: AbortSignal
  size?: string
}

interface EditImageOptions extends GenerateImageOptions {
  image: File
  mask?: File
}

export type { GeneratedImage } from './providerResponses'
export { ProviderRequestError } from './providerErrors'
export type { ProviderRequestErrorCode } from './providerErrors'
export {
  buildProviderCapabilityRequestPlan,
  executeProviderCapabilityRequestPlan,
  providerCapabilityCheckKey,
  providerCapabilityRequestForCheck,
} from './providerCapabilityChecks'
export type { ProviderCapabilityCheckKind } from './providerCapabilityChecks'

export const PROVIDER_MODEL_LIST_TIMEOUT_MS = 30_000
export const PROVIDER_CHAT_REQUEST_TIMEOUT_MS = 60_000
export const PROVIDER_IMAGE_REQUEST_TIMEOUT_MS = 180_000
export const PROVIDER_STREAM_IDLE_TIMEOUT_MS = 90_000

async function fetchProviderEndpoint<T>(
  provider: ProviderConfig,
  target: string,
  url: string,
  init: RequestInit,
  consumeResponse: (response: Response, signal: AbortSignal) => Promise<T>,
  timeoutMs = PROVIDER_CHAT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const timeoutSignal = providerTimeoutSignal(init.signal, timeoutMs)
  let response: Response | undefined
  let responseReceived = false

  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: timeoutSignal.signal,
    })
    responseReceived = true
    const result = await consumeResponse(response, timeoutSignal.signal)
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

    if (isAbortError(error)) {
      throw error
    }

    if (responseReceived) {
      throw error
    }

    throw providerConnectionError(provider, target)
  } finally {
    timeoutSignal.dispose()
  }
}

async function fetchProviderJsonEndpoint<T>(
  provider: ProviderConfig,
  target: string,
  url: string,
  init: RequestInit,
  parse: (value: unknown) => T,
  timeoutMs = PROVIDER_CHAT_REQUEST_TIMEOUT_MS,
  maxBytes?: number,
): Promise<T> {
  return fetchProviderEndpoint(
    provider,
    target,
    url,
    init,
    async (response, signal) => {
      await assertProviderResponseOk(response, signal)
      return parse(await readProviderJsonResponse(response, maxBytes, signal))
    },
    timeoutMs,
  )
}

async function fetchProviderStreamResponse(
  provider: ProviderConfig,
  target: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetchProviderEndpoint(
    provider,
    target,
    url,
    init,
    async (response, signal) => {
      await assertProviderResponseOk(response, signal)
      return response
    },
  )
}

function publishProviderToken(
  signal: AbortSignal,
  onToken: (token: string) => void,
  token: string,
): void {
  signal.throwIfAborted()
  onToken(token)
}

function throwIfProviderStreamAborted(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): void {
  if (!signal.aborted) {
    return
  }

  void cancelProviderStreamReader(reader)
  throw new DOMException('Aborted', 'AbortError')
}

async function readProviderStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  byteBudget: { totalBytes: number },
  timeoutMs = PROVIDER_STREAM_IDLE_TIMEOUT_MS,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    await cancelProviderStreamReader(reader)
    throw new DOMException('Aborted', 'AbortError')
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let timerOwner: { handle?: ReturnType<typeof setTimeout> } | null = {}
    let abortListenerRegistered = false
    const cleanup = () => {
      const owner = timerOwner
      timerOwner = null
      if (owner?.handle !== undefined) {
        try {
          globalThis.clearTimeout(owner.handle)
        } catch {
          // Timer teardown is best-effort; the settled result remains authoritative.
        }
      }
      if (abortListenerRegistered) {
        abortListenerRegistered = false
        try {
          signal.removeEventListener('abort', abort)
        } catch {
          // Host teardown is not allowed to replace the stream result.
        }
      }
    }
    const settle = (
      action: () => void,
      cancelReader = false,
    ) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()

      if (cancelReader) {
        void cancelProviderStreamReader(reader)
      }

      action()
    }
    const abort = () => {
      settle(() => reject(new DOMException('Aborted', 'AbortError')), true)
    }

    const owner = timerOwner
    try {
      const handle = globalThis.setTimeout(() => {
        settle(() => reject(providerTimeoutError()), true)
      }, timeoutMs)
      if (timerOwner !== owner) {
        try {
          globalThis.clearTimeout(handle)
        } catch {
          // A late handle cannot change the already-settled stream result.
        }
      } else {
        owner.handle = handle
      }
    } catch (error: unknown) {
      if (timerOwner === owner) {
        timerOwner = null
      }
      settle(() => reject(error), true)
      return
    }

    if (settled) {
      return
    }

    abortListenerRegistered = true
    signal.addEventListener('abort', abort, { once: true })

    reader.read().then(
      (result) => {
        try {
          if (!result.done && result.value?.byteLength) {
            byteBudget.totalBytes = accumulateProviderResponseBytes(
              byteBudget.totalBytes,
              result.value.byteLength,
              MAX_PROVIDER_STREAM_RESPONSE_BYTES,
            )
          }

          settle(() => resolve(result))
        } catch (error: unknown) {
          settle(() => reject(error), true)
        }
      },
      (error: unknown) => {
        settle(() => {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }

          reject(error)
        })
      },
    )
  })
}

export async function cancelProviderStreamReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<boolean> {
  try {
    await reader.cancel()
    return true
  } catch {
    // Provider stream cleanup is best-effort; abort/timeout owns the user-visible result.
    return false
  }
}

function releaseProviderStreamReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    reader.releaseLock()
  } catch {
    // A non-compliant reader must not replace the provider stream result.
  }
}

function consumeProviderSseEvents(
  buffer: string,
  flush: boolean,
  onEvent: (event: string) => boolean | void,
): { remainder: string; stopped: boolean } {
  const parts = buffer.split(/\r?\n\r?\n/)
  const events = flush ? parts : parts.slice(0, -1)
  const remainder = flush ? '' : parts.at(-1) ?? ''

  for (const event of events) {
    if (!event.trim()) {
      continue
    }

    if (onEvent(event) === true) {
      return { remainder: '', stopped: true }
    }
  }

  return { remainder, stopped: false }
}

const CONTEXT_TRUNCATION_MARKER = '\n\n[Earlier content omitted for context size.]\n\n'

function approximateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

function trimContextContent(content: string, maxTokens: number): string {
  const maxChars = Math.max(256, maxTokens * 4)
  if (content.length <= maxChars) return content

  const available = Math.max(0, maxChars - CONTEXT_TRUNCATION_MARKER.length)
  const head = Math.floor(available * 0.66)
  return (
    content.slice(0, head) +
    CONTEXT_TRUNCATION_MARKER +
    content.slice(-(available - head))
  )
}

function trimContextMessage(message: ChatMessage, maxTokens: number): ChatMessage {
  const content = trimContextContent(message.content, maxTokens)
  return content === message.content ? message : { ...message, content }
}

function applyInputTokenBudget(
  messages: ChatMessage[],
  maxInputTokens: number | undefined,
): ChatMessage[] {
  if (!maxInputTokens || !Number.isFinite(maxInputTokens) || maxInputTokens <= 0) {
    return messages
  }

  const systemMessages = messages.filter(
    (message) => message.role === 'system' && message.content.trim(),
  )
  const chatMessages = messages.filter((message) => message.role !== 'system')
  const systemBudget = Math.floor(maxInputTokens / 3)
  const boundedSystem: ChatMessage[] = []
  let remainingSystem = systemBudget

  for (const message of systemMessages) {
    const tokens = approximateTokens(message.content)
    if (tokens <= remainingSystem) {
      boundedSystem.push(message)
      remainingSystem -= tokens
    } else if (remainingSystem > 0) {
      boundedSystem.push(trimContextMessage(message, remainingSystem))
      break
    }
  }

  let remaining = Math.max(0, maxInputTokens - boundedSystem.reduce(
    (total, message) => total + approximateTokens(message.content),
    0,
  ))
  const boundedChat: ChatMessage[] = []

  for (const message of [...chatMessages].reverse()) {
    const tokens = approximateTokens(message.content)
    if (tokens <= remaining) {
      boundedChat.unshift(message)
      remaining -= tokens
      continue
    }
    if (remaining > 0) boundedChat.unshift(trimContextMessage(message, remaining))
    break
  }

  return [...boundedSystem, ...boundedChat]
}

export function selectContextMessages(
  messages: ChatMessage[],
  contextMessageLimit: number,
  maxInputTokens?: number,
): ChatMessage[] {
  const normalizedLimit = normalizeChatContextMessageLimit(contextMessageLimit)
  const systemMessages = messages.filter(
    (message) => message.role === 'system' && message.content.trim(),
  )
  const chatMessages = messages
    .filter((message) => message.role !== 'system')
    .slice(-normalizedLimit)

  if (chatMessages[0]?.role === 'assistant') {
    chatMessages.shift()
  }

  return applyInputTokenBudget(
    [...systemMessages, ...chatMessages],
    maxInputTokens,
  )
}

function shouldTryResponsesImageFallback(error: unknown): boolean {
  if (!(error instanceof ProviderRequestError)) {
    return false
  }

  return (
    error.code === 'network' ||
    error.code === 'server' ||
    error.code === 'rate-limit' ||
    error.status === 429 ||
    error.status === 404 ||
    error.status === 405 ||
    error.status === 501
  )
}

function responsesImageFallbackModel({
  imageModel,
  provider,
  responsesModel,
}: {
  imageModel: string
  provider: ProviderConfig
  responsesModel?: string
}): string[] {
  const seen = new Set<string>()
  const models: string[] = []
  const primaryResponsesModel = responsesModel?.trim() ?? ''
  const orderedModels = primaryResponsesModel
    ? [primaryResponsesModel, imageModel, provider.model]
    : [provider.model, imageModel]

  for (const model of orderedModels) {
    const trimmed = model?.trim() ?? ''

    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      models.push(trimmed)
    }
  }

  return models
}

function shouldTryNextResponsesImageFallbackModel(error: unknown): boolean {
  if (isAbortError(error)) {
    return false
  }

  if (!(error instanceof ProviderRequestError)) {
    return true
  }

  return (
    error.code === 'request' &&
    (error.status === 400 || error.status === 422)
  )
}

function chatConnectionTarget(): string {
  return rt('target.chatApi')
}

function imageEditConnectionTarget(): string {
  return rt('target.imageEditApi')
}

function imageGenerationConnectionTarget(): string {
  return rt('target.imageGenerationApi')
}

function modelListConnectionTarget(): string {
  return rt('target.modelListApi')
}

async function generateImageViaResponsesTool({
  apiKey,
  imageModel,
  provider,
  prompt,
  proxyToken,
  responsesModel,
  signal,
  size,
}: {
  apiKey: string
  imageModel: string
  provider: ProviderConfig
  prompt: string
  proxyToken: string
  responsesModel?: string
  signal: AbortSignal
  size?: string
}): Promise<GeneratedImage> {
  const models = responsesImageFallbackModel({
    imageModel,
    provider,
    responsesModel,
  })

  if (models.length === 0) {
    throw new Error(rt('error.modelRequired'))
  }

  let lastError: unknown

  for (const model of models) {
    try {
      return await fetchProviderJsonEndpoint(
        provider,
        imageGenerationConnectionTarget(),
        buildProviderResponsesImageGenerationEndpoint(provider),
        {
          method: 'POST',
          signal,
          headers: buildProviderResponsesImageGenerationHeaders({
            provider,
            apiKey,
            proxyToken,
          }),
          body: JSON.stringify(
            buildProviderResponsesImageGenerationBody({
              model,
              prompt,
              size,
            }),
          ),
        },
        generatedImageFromProviderResponse,
        PROVIDER_IMAGE_REQUEST_TIMEOUT_MS,
        MAX_PROVIDER_IMAGE_RESPONSE_BYTES,
      )
    } catch (error: unknown) {
      lastError = error
      if (!shouldTryNextResponsesImageFallbackModel(error)) {
        break
      }
    }
  }

  throw lastError
}

async function editImageViaResponsesTool({
  apiKey,
  image,
  imageModel,
  provider,
  prompt,
  proxyToken,
  responsesModel,
  signal,
  size,
}: {
  apiKey: string
  image: File
  imageModel: string
  provider: ProviderConfig
  prompt: string
  proxyToken: string
  responsesModel?: string
  signal: AbortSignal
  size?: string
}): Promise<GeneratedImage> {
  const models = responsesImageFallbackModel({
    imageModel,
    provider,
    responsesModel,
  })

  if (models.length === 0) {
    throw new Error(rt('error.modelRequired'))
  }

  const imageDataUrl = await fileToDataUrl(image, signal)
  let lastError: unknown

  for (const model of models) {
    try {
      return await fetchProviderJsonEndpoint(
        provider,
        imageEditConnectionTarget(),
        buildProviderResponsesImageGenerationEndpoint(provider),
        {
          method: 'POST',
          signal,
          headers: buildProviderResponsesImageGenerationHeaders({
            provider,
            apiKey,
            proxyToken,
          }),
          body: JSON.stringify(
            buildProviderResponsesImageEditBody({
              imageDataUrl,
              model,
              prompt,
              size,
            }),
          ),
        },
        generatedImageFromProviderResponse,
        PROVIDER_IMAGE_REQUEST_TIMEOUT_MS,
        MAX_PROVIDER_IMAGE_RESPONSE_BYTES,
      )
    } catch (error: unknown) {
      lastError = error
      if (!shouldTryNextResponsesImageFallbackModel(error)) {
        break
      }
    }
  }

  throw lastError
}

async function readOpenAIStream(
  response: Response,
  signal: AbortSignal,
  onToken: (token: string) => void,
): Promise<void> {
  const contentType = response.headers.get('content-type') ?? ''

  if (!response.body || contentType.includes('application/json')) {
    const json = await readProviderJsonResponse(response, undefined, signal) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    publishProviderText(
      signal,
      onToken,
      json?.choices?.[0]?.message?.content,
    )

    return
  }

  await assertProviderResponseContentLength(
    response,
    MAX_PROVIDER_STREAM_RESPONSE_BYTES,
  )
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const byteBudget = { totalBytes: 0 }
  let buffer = ''
  const consumeEvent = (part: string): boolean => {
    for (const line of part.split(/\r?\n/)) {
      const trimmed = line.trim()

      if (!trimmed.startsWith('data:')) {
        continue
      }

      const payload = trimmed.slice(5).trim()
      throwIfProviderStreamAborted(reader, signal)

      if (payload === '[DONE]') {
        return true
      }

      let json: {
        choices?: Array<{ delta?: { content?: unknown } }>
      }

      try {
        json = JSON.parse(payload) as typeof json
      } catch {
        // Some compatible services send keep-alive frames that are not JSON.
        continue
      }

      publishProviderText(signal, onToken, json?.choices?.[0]?.delta?.content)
    }

    return false
  }

  try {
    while (true) {
      const { done, value } = await readProviderStreamChunk(
        reader,
        signal,
        byteBudget,
      )
      throwIfProviderStreamAborted(reader, signal)

      if (done) {
        buffer += decoder.decode()
        consumeProviderSseEvents(buffer, true, consumeEvent)
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const parsed = consumeProviderSseEvents(buffer, false, consumeEvent)
      buffer = parsed.remainder

      if (parsed.stopped) {
        await cancelProviderStreamReader(reader)
        return
      }
    }
  } finally {
    releaseProviderStreamReader(reader)
  }
}

function readTextContent(value: unknown): string {
  return typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.reduce(
          (text, part) =>
            part?.type === 'text' && typeof part.text === 'string'
              ? text + part.text
              : text,
          '',
        )
      : ''
}

function publishProviderText(
  signal: AbortSignal,
  onToken: (token: string) => void,
  value: unknown,
): void {
  const text = readTextContent(value)

  if (text) {
    publishProviderToken(signal, onToken, text)
  }
}

async function readAnthropicStream(
  response: Response,
  signal: AbortSignal,
  onToken: (token: string) => void,
): Promise<void> {
  const contentType = response.headers.get('content-type') ?? ''

  if (!response.body || contentType.includes('application/json')) {
    const json = await readProviderJsonResponse(response, undefined, signal) as {
      content?: Array<{ type?: string; text?: string }>
    }
    const text = json?.content
      ?.map((block: { type?: string; text?: string }) => block.text ?? '')
      .join('')

    if (typeof text === 'string') {
      publishProviderToken(signal, onToken, text)
    }

    return
  }

  await assertProviderResponseContentLength(
    response,
    MAX_PROVIDER_STREAM_RESPONSE_BYTES,
  )
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const byteBudget = { totalBytes: 0 }
  let buffer = ''
  const consumeEvent = (part: string): boolean => {
    const dataLine = part
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('data:'))

    if (!dataLine) {
      return false
    }

    let json: { delta?: { text?: unknown } }

    try {
      json = JSON.parse(dataLine.trim().slice(5).trim()) as typeof json
    } catch {
      // Ignore non-content frames.
      return false
    }

    const token = json?.delta?.text

    if (typeof token === 'string') {
      publishProviderToken(signal, onToken, token)
    }

    return false
  }

  try {
    while (true) {
      const { done, value } = await readProviderStreamChunk(
        reader,
        signal,
        byteBudget,
      )
      throwIfProviderStreamAborted(reader, signal)

      if (done) {
        buffer += decoder.decode()
        consumeProviderSseEvents(buffer, true, consumeEvent)
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const parsed = consumeProviderSseEvents(buffer, false, consumeEvent)
      buffer = parsed.remainder
    }
  } finally {
    releaseProviderStreamReader(reader)
  }
}

function readResponsesText(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return ''
  }

  const response = value as {
    output_text?: unknown
    output?: unknown
  }

  if (typeof response.output_text === 'string') {
    return response.output_text.trim()
  }

  if (!Array.isArray(response.output)) {
    return ''
  }

  return response.output
    .flatMap((item) => {
      if (typeof item !== 'object' || item === null) {
        return []
      }

      const content = (item as { content?: unknown }).content
      return Array.isArray(content) ? content : []
    })
    .map((part) => {
      if (typeof part !== 'object' || part === null) {
        return ''
      }

      const record = part as { output_text?: unknown; text?: unknown }
      return readTextContent(record.text ?? record.output_text).trim()
    })
    .filter(Boolean)
    .join('\n')
}

async function readResponsesStream(
  response: Response,
  signal: AbortSignal,
  onToken: (token: string) => void,
): Promise<void> {
  const contentType = response.headers.get('content-type') ?? ''

  if (!response.body || contentType.includes('application/json')) {
    const text = readResponsesText(
      await readProviderJsonResponse(response, undefined, signal),
    )
    publishProviderToken(signal, onToken, text)
    return
  }

  await assertProviderResponseContentLength(
    response,
    MAX_PROVIDER_STREAM_RESPONSE_BYTES,
  )
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const byteBudget = { totalBytes: 0 }
  let buffer = ''
  const consumeEvent = (part: string): boolean => {
    for (const line of part.split(/\r?\n/)) {
      const trimmed = line.trim()

      if (!trimmed.startsWith('data:')) {
        continue
      }

      const payload = trimmed.slice(5).trim()
      throwIfProviderStreamAborted(reader, signal)

      if (payload === '[DONE]') {
        return true
      }

      let json: {
        type?: unknown
        delta?: unknown
        error?: { message?: unknown }
      }

      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }

      if (typeof json.error?.message === 'string') {
        throw new Error(json.error.message)
      }

      if (
        json.type === 'response.output_text.delta' &&
        typeof json.delta === 'string'
      ) {
        publishProviderToken(signal, onToken, json.delta)
      }
    }

    return false
  }

  try {
    while (true) {
      const { done, value } = await readProviderStreamChunk(
        reader,
        signal,
        byteBudget,
      )
      throwIfProviderStreamAborted(reader, signal)

      if (done) {
        buffer += decoder.decode()
        consumeProviderSseEvents(buffer, true, consumeEvent)
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const parsed = consumeProviderSseEvents(buffer, false, consumeEvent)
      buffer = parsed.remainder

      if (parsed.stopped) {
        await cancelProviderStreamReader(reader)
        return
      }
    }
  } finally {
    releaseProviderStreamReader(reader)
  }
}

export async function listProviderModels(
  options: ListModelsOptions,
): Promise<string[]> {
  const { provider, apiKey, proxyToken, signal } = options

  if (providerNeedsBrowserKey(provider) && !apiKey) {
    throw new Error(rt('error.providerKeyRequired'))
  }

  if (providerUsesProxy(provider) && !proxyToken.trim()) {
    throw new Error(rt('error.cloudflareAccessKeyRequired'))
  }

  const models = await fetchProviderJsonEndpoint(
    provider,
    modelListConnectionTarget(),
    buildProviderModelListEndpoint(provider),
    {
      method: 'GET',
      signal,
      headers: buildProviderModelListHeaders({ provider, apiKey, proxyToken }),
    },
    parseProviderModelIds,
    PROVIDER_MODEL_LIST_TIMEOUT_MS,
  )

  if (models.length === 0) {
    throw new Error(rt('error.noModelsFound'))
  }

  return models
}

export async function generateImage(
  options: GenerateImageOptions,
): Promise<GeneratedImage> {
  const {
    provider,
    apiKey,
    proxyToken,
    model,
    prompt,
    responsesModel,
    signal,
    size,
  } = options
  const trimmedPrompt = prompt.trim()

  if (providerNeedsBrowserKey(provider) && !apiKey) {
    throw new Error(rt('error.providerKeyRequired'))
  }

  if (providerUsesProxy(provider) && !proxyToken.trim()) {
    throw new Error(rt('error.cloudflareAccessKeyRequired'))
  }

  if (!model.trim()) {
    throw new Error(rt('error.imageModelRequired'))
  }

  if (!trimmedPrompt) {
    throw new Error(rt('notice.messageContentRequired'))
  }

  if (provider.kind === 'anthropic') {
    throw new Error(rt('error.imageGenerationUnsupported'))
  }

  let generatedImage: GeneratedImage

  try {
    generatedImage = await fetchProviderJsonEndpoint(
      provider,
      imageGenerationConnectionTarget(),
      buildProviderImageGenerationEndpoint(provider),
      {
        method: 'POST',
        signal,
        headers: buildProviderImageGenerationHeaders({
          provider,
          apiKey,
          proxyToken,
        }),
        body: JSON.stringify(
          buildProviderImageGenerationBody({
            model,
            prompt: trimmedPrompt,
            size,
          }),
        ),
      },
      generatedImageFromProviderResponse,
      PROVIDER_IMAGE_REQUEST_TIMEOUT_MS,
      MAX_PROVIDER_IMAGE_RESPONSE_BYTES,
    )
  } catch (error: unknown) {
    if (!shouldTryResponsesImageFallback(error)) {
      throw error
    }

    generatedImage = await generateImageViaResponsesTool({
      apiKey,
      imageModel: model,
      provider,
      prompt: trimmedPrompt,
      proxyToken,
      responsesModel,
      signal,
      size,
    })
  }

  return materializeGeneratedImage(
    generatedImage,
    signal,
    PROVIDER_IMAGE_REQUEST_TIMEOUT_MS,
  )
}

export async function editImage(options: EditImageOptions): Promise<GeneratedImage> {
  const {
    provider,
    apiKey,
    proxyToken,
    model,
    prompt,
    responsesModel,
    signal,
    size,
    image,
    mask,
  } = options
  const trimmedPrompt = prompt.trim()

  if (providerNeedsBrowserKey(provider) && !apiKey) {
    throw new Error(rt('error.providerKeyRequired'))
  }

  if (providerUsesProxy(provider) && !proxyToken.trim()) {
    throw new Error(rt('error.cloudflareAccessKeyRequired'))
  }

  if (!model.trim()) {
    throw new Error(rt('error.imageModelRequired'))
  }

  if (!trimmedPrompt) {
    throw new Error(rt('notice.messageContentRequired'))
  }

  if (provider.kind === 'anthropic') {
    throw new Error(rt('error.imageGenerationUnsupported'))
  }

  let generatedImage: GeneratedImage

  try {
    generatedImage = await fetchProviderJsonEndpoint(
      provider,
      imageEditConnectionTarget(),
      buildProviderImageEditEndpoint(provider),
      {
        method: 'POST',
        signal,
        headers: buildProviderImageEditHeaders({ provider, apiKey, proxyToken }),
        body: buildProviderImageEditBody({
          model,
          prompt: trimmedPrompt,
          size,
          image,
          mask,
        }),
      },
      generatedImageFromProviderResponse,
      PROVIDER_IMAGE_REQUEST_TIMEOUT_MS,
      MAX_PROVIDER_IMAGE_RESPONSE_BYTES,
    )
  } catch (error: unknown) {
    if (mask || !shouldTryResponsesImageFallback(error)) {
      throw error
    }

    generatedImage = await editImageViaResponsesTool({
      apiKey,
      image,
      imageModel: model,
      provider,
      prompt: trimmedPrompt,
      proxyToken,
      responsesModel,
      signal,
      size,
    })
  }

  return materializeGeneratedImage(
    generatedImage,
    signal,
    PROVIDER_IMAGE_REQUEST_TIMEOUT_MS,
  )
}

export async function streamChat(options: StreamOptions): Promise<void> {
  const {
    provider,
    apiKey,
    proxyToken,
    model,
    messages,
    contextMessageLimit,
    compactionItems,
    maxInputTokens,
    signal,
    onToken,
  } = options
  const endpoint = buildProviderChatEndpoint(provider)
  let assistantContent = ''
  const publishToken = (token: string): void => {
    assistantContent += token
    publishProviderToken(signal, onToken, token)
  }

  if (providerNeedsBrowserKey(provider) && !apiKey) {
    throw new Error(rt('error.providerKeyRequired'))
  }

  if (providerUsesProxy(provider) && !proxyToken.trim()) {
    throw new Error(rt('error.cloudflareAccessKeyRequired'))
  }

  if (!model.trim()) {
    throw new Error(rt('error.modelRequired'))
  }

  const contextMessages = selectContextMessages(messages, contextMessageLimit, maxInputTokens)

  if (provider.kind === 'openai-responses') {
    const responsesBody = buildProviderResponsesChatBody({
      model,
      messages: contextMessages,
      inputItems: compactionItems,
    })
    let usedWebSocket = false

    try {
      usedWebSocket = await streamResponsesWebSocket({
        provider,
        apiKey,
        proxyToken,
        body: responsesBody,
        signal,
        onToken: publishToken,
      })
    } catch (error: unknown) {
      if (!isResponsesWebSocketFallbackError(error)) {
        throw error
      }
    }

    if (!usedWebSocket) {
      const response = await fetchProviderStreamResponse(
        provider,
        chatConnectionTarget(),
        endpoint,
        {
          method: 'POST',
          signal,
          headers: buildProviderChatHeaders({ provider, apiKey, proxyToken }),
          body: JSON.stringify(responsesBody),
        },
      )

      await readResponsesStream(response, signal, publishToken)
    }
  } else if (provider.kind === 'anthropic') {
    const response = await fetchProviderStreamResponse(
      provider,
      chatConnectionTarget(),
      endpoint,
      {
        method: 'POST',
        signal,
        headers: buildProviderChatHeaders({ provider, apiKey, proxyToken }),
        body: JSON.stringify(
          buildProviderAnthropicChatBody({
            model,
            messages: contextMessages,
          }),
        ),
      },
    )

    await readAnthropicStream(response, signal, publishToken)
  } else {
    const response = await fetchProviderStreamResponse(
      provider,
      chatConnectionTarget(),
      endpoint,
      {
        method: 'POST',
        signal,
        headers: buildProviderChatHeaders({ provider, apiKey, proxyToken }),
        body: JSON.stringify(
          buildProviderOpenAIChatBody({
            model,
            messages: contextMessages,
          }),
        ),
      },
    )

    await readOpenAIStream(response, signal, publishToken)
  }

  signal.throwIfAborted()
  if (!assistantContent.trim()) {
    throw providerEmptyResponseError()
  }
}
