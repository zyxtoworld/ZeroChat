import { describe, expect, it } from 'vitest'

import {
  appTestBridgeRequested,
  runtimeFailureProbeRequested,
} from '../runtimeFailureProbe'

function location(href: string): Pick<Location, 'hostname' | 'protocol' | 'search'> {
  const url = new URL(href)
  return {
    hostname: url.hostname,
    protocol: url.protocol,
    search: url.search,
  }
}

describe('runtime failure probe', () => {
  it('exposes the app test bridge only on explicit loopback HTTP origins', () => {
    for (const href of [
      'http://127.0.0.1:4173/?app-test=1',
      'https://localhost:4173/?app-test=1',
      'http://[::1]:4173/?app-test=1',
    ]) {
      expect(appTestBridgeRequested(location(href))).toBe(true)
    }

    for (const href of [
      'http://127.0.0.1:4173/',
      'https://chat.example/?app-test=1',
      'file:///app/index.html?app-test=1',
    ]) {
      expect(appTestBridgeRequested(location(href))).toBe(false)
    }
  })

  it('requires the explicit app-test and named probe flags on loopback HTTP', () => {
    expect(
      runtimeFailureProbeRequested(
        'zerochat-runtime-failure-smoke',
        location('http://127.0.0.1:4173/?app-test=1&zerochat-runtime-failure-smoke=1'),
      ),
    ).toBe(true)
    expect(
      runtimeFailureProbeRequested(
        'zerochat-runtime-failure-smoke',
        location('http://localhost:4173/?zerochat-runtime-failure-smoke=1'),
      ),
    ).toBe(false)
  })

  it('rejects public origins and file-based native WebViews', () => {
    for (const href of [
      'https://chat.example/?app-test=1&zerochat-startup-failure-smoke=1',
      'file:///app/index.html?app-test=1&zerochat-startup-failure-smoke=1',
    ]) {
      expect(
        runtimeFailureProbeRequested(
          'zerochat-startup-failure-smoke',
          location(href),
        ),
      ).toBe(false)
    }
  })
})
