import { createServer } from 'node:http'

import { describe, expect, it } from 'vitest'

import {
  closeLoopbackServer,
  findFetchSafeLoopbackPort,
  isFetchSafeLoopbackPort,
  listenOnFetchSafeLoopbackPort,
  resolveFetchSafeLoopbackPort,
} from '../fetch-safe-loopback-port.mjs'

describe('Fetch-safe loopback port allocator', () => {
  it('classifies Fetch-blocked and usable loopback ports', () => {
    expect(isFetchSafeLoopbackPort(6667)).toBe(false)
    expect(isFetchSafeLoopbackPort(6000)).toBe(false)
    expect(isFetchSafeLoopbackPort(8787)).toBe(true)
    expect(isFetchSafeLoopbackPort(0)).toBe(false)
  })

  it('returns Fetch-safe ports for automatic allocation', async () => {
    const ports = []
    for (let index = 0; index < 4; index += 1) {
      ports.push(await findFetchSafeLoopbackPort('Allocator regression test'))
    }

    expect(ports).toHaveLength(4)
    for (const port of ports) {
      expect(isFetchSafeLoopbackPort(port)).toBe(true)
    }
  })

  it('rejects blocked configured ports before binding a server', async () => {
    const server = createServer()

    try {
      await expect(
        listenOnFetchSafeLoopbackPort(server, 6667, 'Allocator regression test'),
      ).rejects.toThrow('refuses Fetch-blocked loopback port 6667')
      expect(server.listening).toBe(false)
      await expect(
        resolveFetchSafeLoopbackPort('6000', 'Browser regression test'),
      ).rejects.toThrow('refuses Fetch-blocked loopback port 6000')
    } finally {
      await closeLoopbackServer(server)
    }
  })

  it('treats an unset or zero configured port as automatic allocation', async () => {
    await expect(resolveFetchSafeLoopbackPort(undefined, 'Browser regression test')).resolves.toSatisfy(
      isFetchSafeLoopbackPort,
    )
    await expect(resolveFetchSafeLoopbackPort('0', 'Browser regression test')).resolves.toSatisfy(
      isFetchSafeLoopbackPort,
    )
  })
})
