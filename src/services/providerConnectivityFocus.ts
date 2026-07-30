import type { ProviderConnectivityField } from './providerStatus'
import {
  focusInteractionElement,
  scrollInteractionElementIntoView,
} from './interactionFocus'

const providerConnectivityFieldSelectors: Record<
  Exclude<ProviderConnectivityField, 'none'>,
  string
> = {
  baseUrl: 'input[data-provider-base-url-field="true"]',
  providerKey: '[data-provider-api-key-field="true"] input',
  proxyUrl: 'input[data-provider-proxy-url-field="true"]',
}

function runAfterRender(callback: () => void): void {
  if (typeof window === 'undefined' || !window.requestAnimationFrame) {
    callback()
    return
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback)
  })
}

export function focusProviderConnectivityField(
  field: ProviderConnectivityField,
): void {
  if (field === 'none' || typeof document === 'undefined') {
    return
  }

  const selector = providerConnectivityFieldSelectors[field]

  runAfterRender(() => {
    const target = document.querySelector<HTMLElement>(selector)

    if (!target || !document.contains(target)) {
      return
    }

    scrollInteractionElementIntoView(target, {
      block: 'center',
      inline: 'nearest',
    })
    focusInteractionElement(target)
  })
}
