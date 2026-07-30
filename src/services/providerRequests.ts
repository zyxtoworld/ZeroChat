import { rt } from '../i18n'
import type { ChatMessage, ProviderConfig } from '../types'
import { safeProviderImageAttachmentSource } from './imageAttachmentSafety'
import {
  activeProviderProxyUrl,
  providerNeedsBrowserKey,
  providerUsesProxy,
} from './providerRequestMode'
import {
  assertSafeRemoteBaseUrl,
  normalizeProviderProxyRootUrl,
} from './providerSafety'

interface ProviderRequestAuth {
  provider: ProviderConfig
  apiKey: string
  proxyToken: string
}

interface ProviderChatBodyOptions {
  model: string
  messages: ChatMessage[]
}

type OpenAIChatContent =
  | string
  | Array<
      | {
          type: 'text'
          text: string
        }
      | {
          type: 'image_url'
          image_url: {
            url: string
          }
        }
    >

type ResponsesChatContent =
  | string
  | Array<
      | {
          type: 'input_text'
          text: string
        }
      | {
          type: 'input_image'
          image_url: string
        }
    >

type AnthropicChatContent =
  | string
  | Array<
      | {
          type: 'text'
          text: string
        }
      | {
          type: 'image'
          source: {
            type: 'base64'
            media_type: string
            data: string
          }
        }
    >

interface ProviderImageBodyOptions {
  model: string
  prompt: string
  size?: string
}

interface ProviderTextCapabilityBodyOptions {
  model: string
  input: string | string[]
}

interface ProviderAudioSpeechBodyOptions {
  model: string
  input: string
  voice?: string
  responseFormat?: string
  speed?: number
}

interface ProviderAudioTranscriptionBodyOptions {
  model: string
  file: File
  prompt?: string
  language?: string
  responseFormat?: string
  temperature?: number
}

interface ProviderRealtimeBodyOptions {
  model: string
  modalities?: string[]
  instructions?: string
  voice?: string
  inputAudioFormat?: string
  outputAudioFormat?: string
}

interface ProviderImageEditBodyOptions extends ProviderImageBodyOptions {
  image: File
  mask?: File
}

interface ProviderResponsesImageEditBodyOptions extends ProviderImageBodyOptions {
  imageDataUrl: string
}

interface RealtimeAudioFormat {
  type: string
  rate?: number
}

type RealtimeOutputModality = 'text' | 'audio'

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  mpeg: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  webm: 'audio/webm',
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

function safeBaseUrl(value: string, label: string): string {
  return assertSafeRemoteBaseUrl(value, label)
}

function mimeTypeFromFileName(
  fileName: string,
  fallbackType: string,
  mimeByExtension: Record<string, string>,
): string {
  const extension = fileName
    .trim()
    .toLowerCase()
    .split('.')
    .pop()

  return (extension && mimeByExtension[extension]) || fallbackType
}

function fileForFormData(
  file: File,
  fallbackName: string,
  fallbackType: string,
  mimeByExtension: Record<string, string>,
): File {
  const name = file.name.trim() || fallbackName
  const type =
    file.type.trim() || mimeTypeFromFileName(name, fallbackType, mimeByExtension)

  if (name === file.name && type === file.type) {
    return file
  }

  return new File([file], name, {
    lastModified: file.lastModified,
    type,
  })
}

function normalizedRealtimeModality(
  modalities?: string[],
): RealtimeOutputModality {
  const normalized = modalities
    ?.map((modality) => modality.trim())
    .find(
      (modality): modality is RealtimeOutputModality =>
        modality === 'text' || modality === 'audio',
    )

  return normalized ?? 'text'
}

function normalizedRealtimeModalities(
  modality: RealtimeOutputModality,
): RealtimeOutputModality[] {
  return [modality]
}

function realtimeAudioFormat(value?: string): RealtimeAudioFormat | undefined {
  const normalized = value?.trim()

  if (!normalized) {
    return undefined
  }

  switch (normalized) {
    case 'pcm16':
    case 'audio/pcm':
      return { type: 'audio/pcm', rate: 24000 }
    case 'g711_ulaw':
    case 'audio/pcmu':
      return { type: 'audio/pcmu' }
    case 'g711_alaw':
    case 'audio/pcma':
      return { type: 'audio/pcma' }
    default:
      return { type: normalized }
  }
}

function realtimeSessionAudio({
  inputAudioFormat,
  outputAudioFormat,
  voice,
}: Pick<
  ProviderRealtimeBodyOptions,
  'inputAudioFormat' | 'outputAudioFormat' | 'voice'
>, outputModality: RealtimeOutputModality) {
  const inputFormat = realtimeAudioFormat(inputAudioFormat)
  const outputFormat = realtimeAudioFormat(outputAudioFormat)
  const outputVoice = voice?.trim()
  const output =
    outputModality === 'audio' && (outputFormat || outputVoice)
      ? {
          ...(outputFormat ? { format: outputFormat } : {}),
          ...(outputVoice ? { voice: outputVoice } : {}),
        }
      : undefined

  if (!inputFormat && !output) {
    return undefined
  }

  return {
    ...(inputFormat ? { input: { format: inputFormat } } : {}),
    ...(output ? { output } : {}),
  }
}

function chatImageAttachmentSources(message: ChatMessage): string[] {
  if (message.role !== 'user') {
    return []
  }

  return (
    message.attachments
      ?.filter(
        (attachment) =>
          attachment.kind === 'image' && attachment.purpose !== 'mask',
      )
      .map(safeProviderImageAttachmentSource)
      .filter(Boolean) ?? []
  )
}

function dataUrlParts(
  dataUrl: string,
): { mediaType: string; data: string } | null {
  const [metadata, data = ''] = dataUrl.split(',', 2)
  const mediaType = metadata.match(/^data:([^;,]+)/)?.[1]?.trim()

  if (!mediaType || !data) {
    return null
  }

  return { mediaType, data }
}

function buildOpenAIChatContent(message: ChatMessage): OpenAIChatContent {
  const images = chatImageAttachmentSources(message)

  if (!images.length) {
    return message.content
  }

  return [
    ...(message.content
      ? [{ type: 'text' as const, text: message.content }]
      : []),
    ...images.map((source) => ({
      type: 'image_url' as const,
      image_url: {
        url: source,
      },
    })),
  ]
}

function buildResponsesChatContent(message: ChatMessage): ResponsesChatContent {
  const images = chatImageAttachmentSources(message)

  if (!images.length) {
    return message.content
  }

  return [
    ...(message.content
      ? [{ type: 'input_text' as const, text: message.content }]
      : []),
    ...images.map((source) => ({
      type: 'input_image' as const,
      image_url: source,
    })),
  ]
}

function buildAnthropicChatContent(message: ChatMessage): AnthropicChatContent {
  const images = chatImageAttachmentSources(message)
    .map(dataUrlParts)
    .filter((part): part is { mediaType: string; data: string } =>
      Boolean(part),
    )

  if (!images.length) {
    return message.content
  }

  return [
    ...(message.content
      ? [{ type: 'text' as const, text: message.content }]
      : []),
    ...images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mediaType,
        data: image.data,
      },
    })),
  ]
}

function providerApiRoot(provider: ProviderConfig): string {
  const baseUrl = safeBaseUrl(provider.baseUrl, 'Base URL')

  if (baseUrl.endsWith('/chat/completions')) {
    return baseUrl.slice(0, -'/chat/completions'.length)
  }

  if (baseUrl.endsWith('/responses')) {
    return baseUrl.slice(0, -'/responses'.length)
  }

  if (baseUrl.endsWith('/messages')) {
    return baseUrl.slice(0, -'/messages'.length)
  }

  if (baseUrl.endsWith('/models')) {
    return baseUrl.slice(0, -'/models'.length)
  }

  if (baseUrl.endsWith('/images/generations')) {
    return baseUrl.slice(0, -'/images/generations'.length)
  }

  if (baseUrl.endsWith('/images/edits')) {
    return baseUrl.slice(0, -'/images/edits'.length)
  }

  if (baseUrl.endsWith('/audio/speech')) {
    return baseUrl.slice(0, -'/audio/speech'.length)
  }

  if (baseUrl.endsWith('/audio/transcriptions')) {
    return baseUrl.slice(0, -'/audio/transcriptions'.length)
  }

  if (baseUrl.endsWith('/embeddings')) {
    return baseUrl.slice(0, -'/embeddings'.length)
  }

  if (baseUrl.endsWith('/moderations')) {
    return baseUrl.slice(0, -'/moderations'.length)
  }

  if (baseUrl.endsWith('/realtime/client_secrets')) {
    return baseUrl.slice(0, -'/realtime/client_secrets'.length)
  }

  if (baseUrl.endsWith('/realtime')) {
    return baseUrl.slice(0, -'/realtime'.length)
  }

  return baseUrl
}

function proxyHeaders(provider: ProviderConfig): Record<string, string> {
  if (!providerUsesProxy(provider)) {
    return {}
  }

  return {
    'x-zerochat-base-url': providerApiRoot(provider),
    'x-zerochat-provider-kind': provider.kind,
  }
}

function providerRequestApiKey(provider: ProviderConfig, apiKey: string): string {
  // A Worker-hosted upstream key must not be shadowed by a stale browser secret.
  return providerNeedsBrowserKey(provider) ? apiKey : ''
}

function providerProxyEndpoint(provider: ProviderConfig): string {
  const proxyUrl = activeProviderProxyUrl(provider)

  return proxyUrl
    ? `${normalizeProviderProxyRootUrl(proxyUrl, rt('field.proxyUrl'))}/proxy`
    : ''
}

export function buildProviderChatEndpoint(provider: ProviderConfig): string {
  const proxyEndpoint = providerProxyEndpoint(provider)

  if (proxyEndpoint) {
    return proxyEndpoint
  }

  const baseUrl = providerApiRoot(provider)

  if (provider.kind === 'openai-responses') {
    return `${baseUrl}/responses`
  }

  if (provider.kind === 'anthropic') {
    return `${baseUrl}/messages`
  }

  return `${baseUrl}/chat/completions`
}

export function buildProviderModelListEndpoint(provider: ProviderConfig): string {
  const proxyEndpoint = providerProxyEndpoint(provider)

  if (proxyEndpoint) {
    return proxyEndpoint
  }

  return `${providerApiRoot(provider)}/models`
}

export function buildProviderImageGenerationEndpoint(
  provider: ProviderConfig,
): string {
  const proxyEndpoint = providerProxyEndpoint(provider)

  if (proxyEndpoint) {
    return proxyEndpoint
  }

  return `${providerApiRoot(provider)}/images/generations`
}

export function buildProviderResponsesImageGenerationEndpoint(
  provider: ProviderConfig,
): string {
  const proxyEndpoint = providerProxyEndpoint(provider)

  if (proxyEndpoint) {
    return proxyEndpoint
  }

  return `${providerApiRoot(provider)}/responses`
}

export function buildProviderImageEditEndpoint(
  provider: ProviderConfig,
): string {
  const proxyEndpoint = providerProxyEndpoint(provider)

  if (proxyEndpoint) {
    return proxyEndpoint
  }

  return `${providerApiRoot(provider)}/images/edits`
}

function buildProviderCapabilityEndpoint(
  provider: ProviderConfig,
  path: string,
): string {
  const proxyEndpoint = providerProxyEndpoint(provider)

  if (proxyEndpoint) {
    return proxyEndpoint
  }

  return `${providerApiRoot(provider)}${path}`
}

export function buildProviderAudioSpeechEndpoint(
  provider: ProviderConfig,
): string {
  return buildProviderCapabilityEndpoint(provider, '/audio/speech')
}

export function buildProviderAudioTranscriptionEndpoint(
  provider: ProviderConfig,
): string {
  return buildProviderCapabilityEndpoint(provider, '/audio/transcriptions')
}

export function buildProviderEmbeddingsEndpoint(
  provider: ProviderConfig,
): string {
  return buildProviderCapabilityEndpoint(provider, '/embeddings')
}

export function buildProviderModerationsEndpoint(
  provider: ProviderConfig,
): string {
  return buildProviderCapabilityEndpoint(provider, '/moderations')
}

export function buildProviderRealtimeEndpoint(
  provider: ProviderConfig,
): string {
  return buildProviderCapabilityEndpoint(provider, '/realtime')
}

export function buildProviderRealtimeClientSecretsEndpoint(
  provider: ProviderConfig,
): string {
  return buildProviderCapabilityEndpoint(provider, '/realtime/client_secrets')
}

export function buildProviderModelListHeaders({
  provider,
  apiKey,
  proxyToken,
}: ProviderRequestAuth): Record<string, string> {
  const requestApiKey = providerRequestApiKey(provider, apiKey)

  if (provider.kind === 'anthropic') {
    return {
      ...(requestApiKey ? { 'x-api-key': requestApiKey } : {}),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(providerUsesProxy(provider)
        ? {
            'x-zerochat-access-key': proxyToken,
            'x-zerochat-proxy-action': 'models',
          }
        : {}),
      ...proxyHeaders(provider),
    }
  }

  return {
    ...(requestApiKey ? { authorization: `Bearer ${requestApiKey}` } : {}),
    ...(providerUsesProxy(provider)
      ? {
          'x-zerochat-access-key': proxyToken,
          'x-zerochat-proxy-action': 'models',
        }
      : {}),
    ...proxyHeaders(provider),
  }
}

export function buildProviderImageGenerationHeaders({
  provider,
  apiKey,
  proxyToken,
}: ProviderRequestAuth): Record<string, string> {
  const requestApiKey = providerRequestApiKey(provider, apiKey)

  return {
    'content-type': 'application/json',
    ...(requestApiKey ? { authorization: `Bearer ${requestApiKey}` } : {}),
    ...(providerUsesProxy(provider)
      ? {
          'x-zerochat-access-key': proxyToken,
          'x-zerochat-proxy-action': 'image-generations',
        }
      : {}),
    ...proxyHeaders(provider),
  }
}

export function buildProviderResponsesImageGenerationHeaders({
  provider,
  apiKey,
  proxyToken,
}: ProviderRequestAuth): Record<string, string> {
  const requestApiKey = providerRequestApiKey(provider, apiKey)

  return {
    'content-type': 'application/json',
    ...(requestApiKey ? { authorization: `Bearer ${requestApiKey}` } : {}),
    ...(providerUsesProxy(provider)
      ? {
          'x-zerochat-access-key': proxyToken,
          'x-zerochat-proxy-action': 'image-responses',
        }
      : {}),
    ...proxyHeaders(provider),
  }
}

export function buildProviderImageEditHeaders({
  provider,
  apiKey,
  proxyToken,
}: ProviderRequestAuth): Record<string, string> {
  const requestApiKey = providerRequestApiKey(provider, apiKey)

  return {
    ...(requestApiKey ? { authorization: `Bearer ${requestApiKey}` } : {}),
    ...(providerUsesProxy(provider)
      ? {
          'x-zerochat-access-key': proxyToken,
          'x-zerochat-proxy-action': 'image-edits',
        }
      : {}),
    ...proxyHeaders(provider),
  }
}

function buildProviderJsonCapabilityHeaders({
  provider,
  apiKey,
  proxyToken,
  proxyAction,
}: ProviderRequestAuth & {
  proxyAction:
    | 'audio-speech'
    | 'embeddings'
    | 'moderations'
    | 'realtime'
    | 'realtime-client-secrets'
}): Record<string, string> {
  const requestApiKey = providerRequestApiKey(provider, apiKey)

  return {
    'content-type': 'application/json',
    ...(requestApiKey ? { authorization: `Bearer ${requestApiKey}` } : {}),
    ...(providerUsesProxy(provider)
      ? {
          'x-zerochat-access-key': proxyToken,
          'x-zerochat-proxy-action': proxyAction,
        }
      : {}),
    ...proxyHeaders(provider),
  }
}

export function buildProviderAudioSpeechHeaders(
  auth: ProviderRequestAuth,
): Record<string, string> {
  return buildProviderJsonCapabilityHeaders({
    ...auth,
    proxyAction: 'audio-speech',
  })
}

export function buildProviderEmbeddingsHeaders(
  auth: ProviderRequestAuth,
): Record<string, string> {
  return buildProviderJsonCapabilityHeaders({
    ...auth,
    proxyAction: 'embeddings',
  })
}

export function buildProviderModerationsHeaders(
  auth: ProviderRequestAuth,
): Record<string, string> {
  return buildProviderJsonCapabilityHeaders({
    ...auth,
    proxyAction: 'moderations',
  })
}

export function buildProviderRealtimeHeaders(
  auth: ProviderRequestAuth,
): Record<string, string> {
  return buildProviderJsonCapabilityHeaders({
    ...auth,
    proxyAction: 'realtime',
  })
}

export function buildProviderRealtimeClientSecretsHeaders(
  auth: ProviderRequestAuth,
): Record<string, string> {
  return buildProviderJsonCapabilityHeaders({
    ...auth,
    proxyAction: 'realtime-client-secrets',
  })
}

export function buildProviderAudioTranscriptionHeaders({
  provider,
  apiKey,
  proxyToken,
}: ProviderRequestAuth): Record<string, string> {
  const requestApiKey = providerRequestApiKey(provider, apiKey)

  return {
    ...(requestApiKey ? { authorization: `Bearer ${requestApiKey}` } : {}),
    ...(providerUsesProxy(provider)
      ? {
          'x-zerochat-access-key': proxyToken,
          'x-zerochat-proxy-action': 'audio-transcriptions',
        }
      : {}),
    ...proxyHeaders(provider),
  }
}

export function buildProviderChatHeaders({
  provider,
  apiKey,
  proxyToken,
}: ProviderRequestAuth): Record<string, string> {
  const requestApiKey = providerRequestApiKey(provider, apiKey)

  if (provider.kind === 'anthropic') {
    return {
      'content-type': 'application/json',
      ...(requestApiKey ? { 'x-api-key': requestApiKey } : {}),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(providerUsesProxy(provider)
        ? {
            'x-zerochat-access-key': proxyToken,
            'x-zerochat-proxy-action': 'chat',
          }
        : {}),
      ...proxyHeaders(provider),
    }
  }

  return {
    'content-type': 'application/json',
    ...(requestApiKey ? { authorization: `Bearer ${requestApiKey}` } : {}),
    ...(providerUsesProxy(provider)
      ? {
          'x-zerochat-access-key': proxyToken,
          'x-zerochat-proxy-action': 'chat',
        }
      : {}),
    ...proxyHeaders(provider),
  }
}

export function buildProviderResponsesChatBody({
  model,
  messages,
}: ProviderChatBodyOptions) {
  return {
    model: model.trim(),
    input: messages.map((message) => ({
      role: message.role,
      content: buildResponsesChatContent(message),
    })),
    stream: true,
    store: false,
    temperature: 0.7,
  }
}

export function buildProviderAnthropicChatBody({
  model,
  messages,
}: ProviderChatBodyOptions) {
  const systemContent = messages
    .filter((message) => message.role === 'system' && message.content.trim())
    .map((message) => message.content.trim())
    .join('\n\n')

  return {
    model: model.trim(),
    max_tokens: 4096,
    stream: true,
    system: systemContent || undefined,
    messages: messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: buildAnthropicChatContent(message),
      })),
  }
}

export function buildProviderOpenAIChatBody({
  model,
  messages,
}: ProviderChatBodyOptions) {
  return {
    model: model.trim(),
    messages: messages.map((message) => ({
      role: message.role,
      content: buildOpenAIChatContent(message),
    })),
    stream: true,
    temperature: 0.7,
  }
}

export function buildProviderImageGenerationBody({
  model,
  prompt,
  size,
}: ProviderImageBodyOptions) {
  return {
    model: model.trim(),
    prompt: prompt.trim(),
    n: 1,
    size: size ?? '1024x1024',
    response_format: 'b64_json',
  }
}

export function buildProviderAudioSpeechBody({
  model,
  input,
  voice,
  responseFormat,
  speed,
}: ProviderAudioSpeechBodyOptions) {
  return {
    model: model.trim(),
    input,
    voice: voice?.trim() || 'alloy',
    ...(responseFormat?.trim()
      ? { response_format: responseFormat.trim() }
      : {}),
    ...(typeof speed === 'number' ? { speed } : {}),
  }
}

export function buildProviderAudioTranscriptionBody({
  model,
  file,
  prompt,
  language,
  responseFormat,
  temperature,
}: ProviderAudioTranscriptionBodyOptions): FormData {
  const body = new FormData()
  const upload = fileForFormData(
    file,
    'audio.webm',
    'audio/webm',
    AUDIO_MIME_BY_EXTENSION,
  )
  body.append('model', model.trim())
  body.append('file', upload, upload.name)

  if (prompt?.trim()) {
    body.append('prompt', prompt.trim())
  }

  if (language?.trim()) {
    body.append('language', language.trim())
  }

  if (responseFormat?.trim()) {
    body.append('response_format', responseFormat.trim())
  }

  if (typeof temperature === 'number') {
    body.append('temperature', String(temperature))
  }

  return body
}

export function buildProviderEmbeddingsBody({
  model,
  input,
}: ProviderTextCapabilityBodyOptions) {
  return {
    model: model.trim(),
    input,
  }
}

export function buildProviderModerationsBody({
  model,
  input,
}: ProviderTextCapabilityBodyOptions) {
  return {
    model: model.trim(),
    input,
  }
}

export function buildProviderRealtimeBody({
  model,
  modalities,
  instructions,
  voice,
  inputAudioFormat,
  outputAudioFormat,
}: ProviderRealtimeBodyOptions) {
  const outputModality = normalizedRealtimeModality(modalities)

  return {
    model: model.trim(),
    modalities: normalizedRealtimeModalities(outputModality),
    ...(instructions?.trim() ? { instructions: instructions.trim() } : {}),
    ...(outputModality === 'audio' && voice?.trim()
      ? { voice: voice.trim() }
      : {}),
    ...(inputAudioFormat?.trim()
      ? { input_audio_format: inputAudioFormat.trim() }
      : {}),
    ...(outputModality === 'audio' && outputAudioFormat?.trim()
      ? { output_audio_format: outputAudioFormat.trim() }
      : {}),
  }
}

export function buildProviderRealtimeClientSecretsBody(
  options: ProviderRealtimeBodyOptions,
) {
  const outputModality = normalizedRealtimeModality(options.modalities)
  const audio = realtimeSessionAudio(options, outputModality)

  return {
    expires_after: {
      anchor: 'created_at',
      seconds: 600,
    },
    session: {
      type: 'realtime',
      model: options.model.trim(),
      output_modalities: normalizedRealtimeModalities(outputModality),
      ...(options.instructions?.trim()
        ? { instructions: options.instructions.trim() }
        : {}),
      ...(audio ? { audio } : {}),
    },
  }
}

export function buildProviderResponsesImageGenerationBody({
  model,
  prompt,
  size,
}: ProviderImageBodyOptions) {
  return {
    model: model.trim(),
    input: prompt.trim(),
    tools: [
      {
        type: 'image_generation',
        action: 'generate',
        size: size ?? '1024x1024',
      },
    ],
    store: false,
  }
}

export function buildProviderResponsesImageEditBody({
  imageDataUrl,
  model,
  prompt,
  size,
}: ProviderResponsesImageEditBodyOptions) {
  return {
    model: model.trim(),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: prompt.trim(),
          },
          {
            type: 'input_image',
            image_url: imageDataUrl,
          },
        ],
      },
    ],
    tools: [
      {
        type: 'image_generation',
        action: 'edit',
        size: size ?? '1024x1024',
      },
    ],
    store: false,
  }
}

export function buildProviderImageEditBody({
  model,
  prompt,
  size,
  image,
  mask,
}: ProviderImageEditBodyOptions): FormData {
  const body = new FormData()
  const imageUpload = fileForFormData(
    image,
    'image.png',
    'image/png',
    IMAGE_MIME_BY_EXTENSION,
  )
  const maskUpload = mask
    ? fileForFormData(mask, 'mask.png', 'image/png', IMAGE_MIME_BY_EXTENSION)
    : null

  body.append('model', model.trim())
  body.append('prompt', prompt.trim())
  body.append('n', '1')
  body.append('size', size ?? '1024x1024')
  body.append('response_format', 'b64_json')
  body.append('image', imageUpload, imageUpload.name)

  if (maskUpload) {
    body.append('mask', maskUpload, maskUpload.name)
  }

  return body
}
