import { describe, expect, it } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type { Translator } from '../../i18n'
import type { ProviderConfig } from '../../types'
import {
  generationPreflightRequirement,
  generationRequirement,
  generationRequirementForAvailability,
  generationRequiresProxyToken,
} from '../generationRequirements'

const t: Translator = (key, values) =>
  values ? `${key}:${JSON.stringify(values)}` : key

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    ...providerFromPreset(providerPresets[0]),
    id: 'provider-1',
    name: 'Provider One',
    ...patch,
  }
}

describe('generation requirements', () => {
  it('blocks disabled providers before other checks', () => {
    expect(
      generationRequirement({
        provider: provider({ enabled: false }),
        model: '',
        providerKey: '',
        proxyToken: '',
        t,
      }),
    ).toContain('notice.providerDisabled')
  })

  it('reports missing model and provider key together', () => {
    expect(
      generationRequirement({
        provider: provider(),
        model: ' ',
        providerKey: '',
        proxyToken: 'token',
        t,
      }),
    ).toBe('notice.sendMissingModelAndProviderKey')
  })

  it('reports missing model or provider key separately', () => {
    expect(
      generationRequirement({
        provider: provider(),
        model: '',
        providerKey: 'key',
        proxyToken: 'token',
        t,
      }),
    ).toBe('notice.sendMissingModel')
    expect(
      generationRequirement({
        provider: provider(),
        model: 'gpt-test',
        providerKey: '',
        proxyToken: 'token',
        t,
      }),
    ).toContain('notice.sendMissingProviderKey')
  })

  it('does not require a browser provider key for proxy-only providers', () => {
    expect(
      generationRequirement({
        provider: provider({
          needsApiKey: false,
          proxyUrl: 'https://worker.example.com',
        }),
        model: 'gpt-test',
        providerKey: '',
        proxyToken: 'token',
        t,
      }),
    ).toBe('')
  })

  it('requires the local access token for worker-proxied providers', () => {
    expect(
      generationRequirement({
        provider: provider({
          needsApiKey: false,
          proxyUrl: 'https://worker.example.com',
        }),
        model: 'gpt-test',
        providerKey: '',
        proxyToken: '',
        t,
      }),
    ).toBe('error.cloudflareAccessKeyRequired')
  })

  it('evaluates proxy readiness from the active credential availability only', () => {
    const proxyProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })

    expect(
      generationRequirementForAvailability({
        provider: proxyProvider,
        model: 'gpt-test',
        providerKey: '',
        proxyTokenAvailable: false,
        t,
      }),
    ).toBe('error.cloudflareAccessKeyRequired')
    expect(
      generationRequirementForAvailability({
        provider: proxyProvider,
        model: 'gpt-test',
        providerKey: '',
        proxyTokenAvailable: true,
        t,
      }),
    ).toBe('')
  })

  it('does not require a proxy token when browser-direct mode ignores a stale proxy URL', () => {
    const browserDirectProvider = provider({
      clientRequestMode: true,
      needsApiKey: true,
      proxyUrl: 'https://worker.example.com',
    })

    expect(generationRequiresProxyToken(browserDirectProvider)).toBe(false)
    expect(
      generationRequirement({
        provider: browserDirectProvider,
        model: 'gpt-test',
        providerKey: 'key',
        proxyToken: '',
        t,
      }),
    ).toBe('')
  })

  it('preflights non-proxy send blockers without requiring a proxy token', () => {
    const proxyProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://worker.example.com',
    })

    expect(generationRequiresProxyToken(provider())).toBe(false)
    expect(generationRequiresProxyToken(proxyProvider)).toBe(true)
    expect(
      generationPreflightRequirement({
        provider: proxyProvider,
        model: 'gpt-test',
        providerKey: '',
        t,
      }),
    ).toBe('')
    expect(
      generationPreflightRequirement({
        provider: proxyProvider,
        model: '',
        providerKey: '',
        t,
      }),
    ).toBe('notice.sendMissingModel')
  })
})
