import type {
  ChatMessage,
  ConversationContextCompaction,
  ProviderConfig,
} from '../types'
import { buildProviderChatHeaders, buildProviderChatEndpoint } from './providerRequests'
import {
  assertProviderResponseOk,
  readProviderJsonResponse,
} from './providerErrors'
import { providerUsesProxy } from './providerRequestMode'
import { effectiveInputTokenBudget } from './modelMetadata'

const SUMMARY_MARKER = '[Conversation context summary]'
const SUMMARY_PROMPT = `You are compacting a conversation for another assistant that will continue the task.
Create a factual handoff summary. Preserve user requirements, constraints, preferences, decisions, files, tool results, errors, unresolved questions, and next steps.
Do not invent facts. Keep stable identifiers and exact values when they matter. Return only the summary.`
const SUMMARY_MAX_TOKENS = 2_000
const SUMMARY_SOURCE_MAX_TOKENS = 12_000
const REMOTE_COMPACTION_MIN_TOKENS = 8_000

export interface PreparedConversationContext {
  messages: ChatMessage[]
  compactionItems?: unknown[]
  compaction?: ConversationContextCompaction
  maxInputTokens?: number
}

interface PrepareConversationContextOptions {
  apiKey: string
  existingCompaction?: ConversationContextCompaction
  maxInputTokens?: number
  messages: ChatMessage[]
  model: string
  provider: ProviderConfig
  proxyToken: string
  signal: AbortSignal
}

function approximateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

function messageTokens(message: ChatMessage): number {
  return approximateTokens(message.content) + (message.attachments?.length ?? 0) * 1_500
}

function totalTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + messageTokens(message), 0)
}

function checkpointIndex(
  messages: ChatMessage[],
  compaction: ConversationContextCompaction | undefined,
): number {
  if (!compaction) return -1
  return messages.findIndex((message) => message.id === compaction.compactedThroughMessageId)
}

function applyStoredCompaction(
  messages: ChatMessage[],
  compaction: ConversationContextCompaction | undefined,
): PreparedConversationContext {
  const index = checkpointIndex(messages, compaction)
  if (!compaction || index < 0) return { messages }

  const tail = messages.slice(index + 1)
  if (compaction.items?.length) {
    return { messages: tail, compactionItems: compaction.items }
  }

  const summaryMessage: ChatMessage = {
    id: `context-summary-${compaction.createdAt}`,
    role: 'system',
    content: `${SUMMARY_MARKER}\n${compaction.summary ?? ''}`.trim(),
    createdAt: compaction.createdAt,
  }
  const systemMessages = messages.filter(
    (message) => message.role === 'system' && message.id !== compaction.compactedThroughMessageId,
  )
  return {
    messages: [...systemMessages, summaryMessage, ...tail.filter((message) => message.role !== 'system')],
  }
}

function splitForLocalCompaction(messages: ChatMessage[], budget: number): {
  older: ChatMessage[]
  recent: ChatMessage[]
} {
  const recentBudget = Math.max(1_024, Math.floor(budget * 0.45))
  const recent: ChatMessage[] = []
  let used = 0

  for (const message of [...messages].reverse()) {
    const tokens = messageTokens(message)
    if (recent.length > 0 && used + tokens > recentBudget) break
    recent.unshift(message)
    used += tokens
  }

  const boundary = Math.max(0, messages.length - recent.length)
  return { older: messages.slice(0, boundary), recent }
}

function formatMessages(messages: ChatMessage[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()} [${message.id}]:\n${message.content}`)
    .join('\n\n')
}

function responsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

function readTextResponse(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text.trim()
  if (typeof record.text === 'string') return record.text.trim()
  if (typeof record.content === 'string') return record.content.trim()
  if (Array.isArray(record.content)) {
    return record.content
      .map((item) => {
        if (!item || typeof item !== 'object') return ''
        const part = item as Record<string, unknown>
        return typeof part.text === 'string'
          ? part.text
          : typeof part.output_text === 'string'
            ? part.output_text
            : ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (Array.isArray(record.output)) {
    return record.output
      .map((item) => readTextResponse(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (Array.isArray(record.choices)) {
    const choice = record.choices[0]
    if (choice && typeof choice === 'object') {
      const message = (choice as Record<string, unknown>).message
      return readTextResponse(message)
    }
  }
  return ''
}

function remoteCompactionEligible(provider: ProviderConfig): boolean {
  if (provider.kind !== 'openai-responses' || providerUsesProxy(provider)) return false
  try {
    const url = new URL(provider.baseUrl)
    return url.hostname === 'api.openai.com'
  } catch {
    return false
  }
}

async function runRemoteCompaction(
  options: PrepareConversationContextOptions,
): Promise<unknown[] | null> {
  if (!remoteCompactionEligible(options.provider)) return null

  const endpoint = buildProviderChatEndpoint(options.provider).replace(
    /\/responses$/u,
    '/responses/compact',
  )
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: options.signal,
    headers: buildProviderChatHeaders({
      provider: options.provider,
      apiKey: options.apiKey,
      proxyToken: options.proxyToken,
    }),
    body: JSON.stringify({
      model: options.model.trim(),
      input: responsesInput(options.messages),
    }),
  })
  await assertProviderResponseOk(response, options.signal)
  const body = await readProviderJsonResponse(response, undefined, options.signal)
  const output = body && typeof body === 'object' ? (body as Record<string, unknown>).output : undefined
  return Array.isArray(output) && output.length > 0 ? output : null
}

async function runLocalSummary(
  options: PrepareConversationContextOptions,
  older: ChatMessage[],
  recent: ChatMessage[],
): Promise<string> {
  const olderText = formatMessages(older).slice(-(SUMMARY_SOURCE_MAX_TOKENS * 4))
  const recentText = formatMessages(recent).slice(-(SUMMARY_SOURCE_MAX_TOKENS * 2))
  const endpoint = buildProviderChatEndpoint(options.provider)
  const body = options.provider.kind === 'anthropic'
    ? {
        model: options.model.trim(),
        max_tokens: SUMMARY_MAX_TOKENS,
        system: SUMMARY_PROMPT,
        messages: [{ role: 'user', content: `${olderText}\n\nRecent messages kept:\n${recentText}` }],
        stream: false,
      }
    : options.provider.kind === 'openai-responses'
      ? {
          model: options.model.trim(),
          input: [
            { role: 'system', content: SUMMARY_PROMPT },
            { role: 'user', content: `${olderText}\n\nRecent messages kept:\n${recentText}` },
          ],
          stream: false,
          store: false,
          temperature: 0.2,
        }
      : {
          model: options.model.trim(),
          messages: [
            { role: 'system', content: SUMMARY_PROMPT },
            { role: 'user', content: `${olderText}\n\nRecent messages kept:\n${recentText}` },
          ],
          stream: false,
          temperature: 0.2,
          max_tokens: SUMMARY_MAX_TOKENS,
        }
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: options.signal,
    headers: buildProviderChatHeaders({
      provider: options.provider,
      apiKey: options.apiKey,
      proxyToken: options.proxyToken,
    }),
    body: JSON.stringify(body),
  })
  await assertProviderResponseOk(response, options.signal)
  const text = readTextResponse(
    await readProviderJsonResponse(response, undefined, options.signal),
  )
  if (!text) throw new Error('Context summary response was empty')
  return text
}

function deterministicSummary(older: ChatMessage[]): string {
  const excerpts = older
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-8)
    .map((message) => `${message.role}: ${message.content.slice(0, 500)}`)
  return `${SUMMARY_MARKER}\n${excerpts.join('\n')}`.trim()
}

export async function prepareConversationContext(
  options: PrepareConversationContextOptions,
): Promise<PreparedConversationContext> {
  options.signal.throwIfAborted()
  const existing = applyStoredCompaction(options.messages, options.existingCompaction)
  const budget = options.maxInputTokens ?? effectiveInputTokenBudget(
    options.provider,
    options.model,
  )
  if (totalTokens(existing.messages) <= budget) {
    return { ...existing, maxInputTokens: budget }
  }
  if (totalTokens(options.messages) < REMOTE_COMPACTION_MIN_TOKENS) {
    return { ...existing, maxInputTokens: budget }
  }

  if (!options.existingCompaction) {
    try {
      const items = await runRemoteCompaction(options)
      if (items) {
        return {
          messages: [],
          maxInputTokens: budget,
          compactionItems: items,
          compaction: {
            source: 'remote-compaction',
            items,
            compactedThroughMessageId: options.messages.at(-1)?.id ?? '',
            model: options.model,
            inputTokens: totalTokens(options.messages),
            createdAt: Date.now(),
          },
        }
      }
    } catch (error) {
      if (options.signal.aborted) throw error
      // Fall through to a provider-neutral summary request.
    }
  }

  const { older, recent } = splitForLocalCompaction(existing.messages, budget)
  if (older.length === 0 || recent.length === 0) {
    return { ...existing, maxInputTokens: budget }
  }
  let summary: string
  try {
    summary = await runLocalSummary(options, older, recent)
  } catch (error) {
    if (options.signal.aborted) throw error
    summary = deterministicSummary(older)
  }
  const checkpoint = older.at(-1)?.id
  if (!checkpoint) return { ...existing, maxInputTokens: budget }
  const summaryMessage: ChatMessage = {
    id: `context-summary-${Date.now()}`,
    role: 'system',
    content: `${SUMMARY_MARKER}\n${summary}`.trim(),
    createdAt: Date.now(),
  }
  return {
    maxInputTokens: budget,
    messages: [
      ...existing.messages.filter((message) => message.role === 'system'),
      summaryMessage,
      ...recent.filter((message) => message.role !== 'system'),
    ],
    compaction: {
      source: 'local-summary',
      summary,
      compactedThroughMessageId: checkpoint,
      model: options.model,
      inputTokens: totalTokens(existing.messages),
      createdAt: Date.now(),
    },
  }
}

export function applyStoredContextCompaction(
  messages: ChatMessage[],
  compaction: ConversationContextCompaction | undefined,
): PreparedConversationContext {
  return applyStoredCompaction(messages, compaction)
}
