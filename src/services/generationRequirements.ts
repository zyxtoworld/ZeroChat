import type { Translator } from '../i18n'
import type { ProviderConfig } from '../types'
import {
  displayProviderName,
  shouldUseBrowserProviderKey,
} from './providerConfig'
import { providerUsesProxy } from './providerRequestMode'

export interface GenerationRequirementOptions {
  provider: ProviderConfig
  model: string
  providerKey: string
  proxyToken: string
  t: Translator
}

export interface GenerationRequirementAvailabilityOptions extends Omit<
  GenerationRequirementOptions,
  'proxyToken'
> {
  proxyTokenAvailable: boolean
}

export function generationRequiresProxyToken(provider: ProviderConfig): boolean {
  return providerUsesProxy(provider)
}

export function generationPreflightRequirement({
  provider,
  model,
  providerKey,
  t,
}: Omit<GenerationRequirementOptions, 'proxyToken'>): string {
  return generationRequirementForAvailability({
    provider,
    model,
    providerKey,
    proxyTokenAvailable: true,
    t,
  })
}

export function generationRequirement({
  provider,
  model,
  providerKey,
  proxyToken,
  t,
}: GenerationRequirementOptions): string {
  return generationRequirementForAvailability({
    provider,
    model,
    providerKey,
    proxyTokenAvailable: Boolean(proxyToken.trim()),
    t,
  })
}

export function generationRequirementForAvailability({
  provider,
  model,
  providerKey,
  proxyTokenAvailable,
  t,
}: GenerationRequirementAvailabilityOptions): string {
  if (!provider.enabled) {
    return t('notice.providerDisabled', {
      provider: displayProviderName(provider, t),
    })
  }

  const missingModel = !model.trim()
  const missingProviderKey =
    shouldUseBrowserProviderKey(provider) && !providerKey.trim()

  if (missingModel && missingProviderKey) {
    return t('notice.sendMissingModelAndProviderKey')
  }

  if (missingModel) {
    return t('notice.sendMissingModel')
  }

  if (missingProviderKey) {
    return t('notice.sendMissingProviderKey', {
      provider: displayProviderName(provider, t),
    })
  }

  if (generationRequiresProxyToken(provider) && !proxyTokenAvailable) {
    return t('error.cloudflareAccessKeyRequired')
  }

  return ''
}
