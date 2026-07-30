import type { ProviderConfig } from '../types'
import type { ProviderCapabilityCheckKind } from './providerCapabilityChecks'
import {
  providerErrorCode,
  type NoticeTone,
} from './uiRuntime'

export type ModelCheckKind =
  | 'audio-speech'
  | 'audio-transcription'
  | 'chat'
  | 'embeddings'
  | 'image'
  | 'moderation'
  | 'realtime'
export type ProviderConnectivityField =
  | 'baseUrl'
  | 'providerKey'
  | 'proxyUrl'
  | 'none'

export interface ProviderCapabilityProbeResult {
  message: string
  model: string
  status: 'blocked' | 'failed' | 'passed'
  tone: NoticeTone
}

export interface ProviderConnectivityResult {
  capabilityResults?: Partial<
    Record<ProviderCapabilityCheckKind, ProviderCapabilityProbeResult>
  >
  field: ProviderConnectivityField
  message: string
  models?: string[]
  retryable: boolean
  retryAction?: 'connectivity' | 'fullCapabilities'
  tone: NoticeTone
}

export function providerCheckKey(providerId: string): string {
  return `provider:${providerId}`
}

export function modelCheckKey(providerId: string, kind: ModelCheckKind): string {
  return `${providerId}:${kind}`
}

export function providerConnectivityErrorField(
  provider: ProviderConfig,
  error: unknown,
): ProviderConnectivityField {
  const code = providerErrorCode(error)

  if (code === 'auth') {
    return 'providerKey'
  }

  if (provider.proxyUrl?.trim()) {
    return 'proxyUrl'
  }

  if (code === 'network') {
    return 'proxyUrl'
  }

  return 'baseUrl'
}
