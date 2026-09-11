import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  VITE_SSR_MODULE_TRANSPORT_TIMEOUT_MS,
  createBoundedViteSsrModuleTransport,
} from '../vite-ssr-module-runner.mjs'

function fakeHotChannel() {
  return {
    api: {
      innerEmitter: new EventEmitter(),
      outsideEmitter: new EventEmitter(),
    },
    send() {},
  }
}

describe('bounded Vite SSR module transport', () => {
  it('keeps cold Windows module transforms above the Vite 60-second default', () => {
    const transport = createBoundedViteSsrModuleTransport(fakeHotChannel())

    expect(VITE_SSR_MODULE_TRANSPORT_TIMEOUT_MS).toBe(180_000)
    expect(transport.timeout).toBe(VITE_SSR_MODULE_TRANSPORT_TIMEOUT_MS)
    expect(transport.timeout).toBeGreaterThan(60_000)
  })
})
