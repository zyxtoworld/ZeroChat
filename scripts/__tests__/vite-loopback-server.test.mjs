import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { isFetchSafeLoopbackPort } from '../fetch-safe-loopback-port.mjs'
import {
  startViteDevLoopbackServer,
  startVitePreviewLoopbackServer,
} from '../vite-loopback-server.mjs'

async function withFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zerochat-vite-loopback-'))

  try {
    await writeFile(path.join(root, 'index.html'), '<!doctype html><title>dev fixture</title>')
    await writeFile(path.join(root, 'main.js'), 'document.body.textContent = "dev fixture"')
    await mkdir(path.join(root, 'dist'), { recursive: true })
    await writeFile(path.join(root, 'dist', 'index.html'), '<!doctype html><title>preview fixture</title>')
    return await run(root)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

describe('Vite browser-QA loopback servers', () => {
  it('keeps a development server on an atomically allocated Fetch-safe port', async () => {
    await withFixture(async (root) => {
      let rootRequests = 0
      const server = await startViteDevLoopbackServer({
        root,
        serverLabel: 'Vite loopback development regression test',
        viteOptions: {
          configFile: false,
          plugins: [
            {
              name: 'record-root-readiness-request',
              configureServer(viteServer) {
                viteServer.middlewares.use((request, _response, next) => {
                  if (request.url === '/') {
                    rootRequests += 1
                  }
                  next()
                })
              },
            },
          ],
        },
      })

      try {
        expect(isFetchSafeLoopbackPort(server.port)).toBe(true)
        expect(rootRequests).toBeGreaterThan(0)
        await expect(fetch(server.url).then((response) => response.text())).resolves.toContain(
          'dev fixture',
        )
        await expect(
          fetch(new URL('/@vite/client', server.url)).then((response) => response.text()),
        ).resolves.toContain(`const hmrPort = ${server.port};`)
      } finally {
        await server.close()
      }
    })
  })

  it('uses Vite preview with an actual Fetch-safe kernel-assigned port', async () => {
    await withFixture(async (root) => {
      const server = await startVitePreviewLoopbackServer({
        root,
        serverLabel: 'Vite loopback preview regression test',
        viteOptions: { configFile: false },
      })

      try {
        expect(isFetchSafeLoopbackPort(server.port)).toBe(true)
        await expect(fetch(server.url).then((response) => response.text())).resolves.toContain(
          'preview fixture',
        )
      } finally {
        await server.close()
      }
    })
  })

  it('rejects Fetch-blocked configured ports before starting Vite', async () => {
    await expect(
      startViteDevLoopbackServer({
        configuredPort: '6000',
        serverLabel: 'Vite loopback configured-port regression test',
      }),
    ).rejects.toThrow('refuses Fetch-blocked loopback port 6000')
  })
})
