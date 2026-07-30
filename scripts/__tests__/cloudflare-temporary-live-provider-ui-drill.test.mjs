import { describe, expect, it } from 'vitest'

import {
  accessKeyFromTemporaryPassphrase,
  extractTemporaryWorkerUrl,
  normalizeTemporaryWorkerProviderBaseUrl,
  packageManagerCommand,
  packageManagerWorkingDirectory,
  requiresWindowsCommandShell,
  sanitizeTemporaryWorkerOutput,
  temporaryWorkerSecretPayload,
  waitForTemporaryWorkerReadiness,
} from '../cloudflare-temporary-live-provider-ui-drill.mjs'

describe('Cloudflare temporary live-provider UI drill', () => {
  it('builds a locked-down hidden-binding payload without changing the provider key', () => {
    const payload = JSON.parse(
      temporaryWorkerSecretPayload({
        providerApiKey: 'test-provider-key',
        providerHost: 'relay.example.test',
        passphrase: 'throwaway-passphrase',
        appOrigin: 'http://127.0.0.1:5173',
      }),
    )

    expect(payload.ZEROCHAT_ACCESS_KEY).toBe(
      accessKeyFromTemporaryPassphrase('throwaway-passphrase'),
    )
    expect(JSON.parse(payload.PROVIDER_KEYS)).toEqual({
      'relay.example.test': 'test-provider-key',
    })
    expect(payload).toMatchObject({
      ALLOWED_HOSTS: 'relay.example.test',
      ALLOWED_ORIGINS: 'http://127.0.0.1:5173',
      AUTO_ALLOWED_ORIGINS: 'false',
      REQUIRE_ALLOWED_ORIGINS: 'true',
      AUTO_ALLOWED_HOSTS: 'false',
    })
  })

  it('extracts only a workers.dev deployment URL instead of a claim credential', () => {
    const output = `Claim URL: https://dash.cloudflare.com/claim-preview?claimToken=secret\nhttps://proof.account.workers.dev`

    expect(extractTemporaryWorkerUrl(output, 'proof')).toBe(
      'https://proof.account.workers.dev',
    )
  })

  it('rejects non-root, wrong-name, and ambiguous Worker deployment URLs', () => {
    expect(
      extractTemporaryWorkerUrl(
        'https://proof.account.workers.dev/prefix',
        'proof',
      ),
    ).toBe('')
    expect(
      extractTemporaryWorkerUrl('https://other.account.workers.dev', 'proof'),
    ).toBe('')
    expect(
      extractTemporaryWorkerUrl(
        'https://proof.first.workers.dev\nhttps://proof.second.workers.dev',
        'proof',
      ),
    ).toBe('')
  })

  it('redacts explicit secrets, provider URLs, claim tokens, and generic API tokens', () => {
    const output =
      'https://relay.example.test/v1 sk-exampletoken123456 claimToken=claim-secret explicit-value'
    const sanitized = sanitizeTemporaryWorkerOutput(output, ['explicit-value'])

    expect(sanitized).not.toContain('relay.example.test')
    expect(sanitized).not.toContain('exampletoken123456')
    expect(sanitized).not.toContain('claim-secret')
    expect(sanitized).not.toContain('explicit-value')
  })

  it('accepts only credential-free HTTPS provider URLs', () => {
    expect(normalizeTemporaryWorkerProviderBaseUrl(' https://api.example.test/v1/ ')).toBe(
      'https://api.example.test/v1',
    )
    expect(() => normalizeTemporaryWorkerProviderBaseUrl('http://api.example.test/v1')).toThrow(
      'credential-free HTTPS URL',
    )
    expect(() =>
      normalizeTemporaryWorkerProviderBaseUrl('https://user:pass@api.example.test/v1'),
    ).toThrow('credential-free HTTPS URL')
  })

  it('uses the bundled Corepack pnpm bootstrap instead of npm_execpath on Windows', () => {
    const command = packageManagerCommand(['deploy'], {
      platform: 'win32',
      execPath: 'D:\\Node.js\\node.exe',
      npmExecPath: 'E:\\应用数据\\pnpm\\pnpm.cjs',
      packageManagerUserAgent: 'pnpm/10.0.0 npm/? node/v22 win32 x64',
      fileExists: (candidate) =>
        candidate === 'D:\\Node.js\\node_modules\\corepack\\dist\\pnpm.js',
    })

    expect(command).toEqual({
      command: 'D:\\Node.js\\node.exe',
      args: [
        'D:\\Node.js\\node_modules\\corepack\\dist\\pnpm.js',
        'dlx',
        'wrangler@latest',
        'deploy',
      ],
    })
  })

  it('falls back to pnpm.cmd when the bundled Corepack bootstrap is unavailable', () => {
    const command = packageManagerCommand(['logout'], {
      platform: 'win32',
      execPath: 'D:\\Node.js\\node.exe',
      npmExecPath: 'C:\\Users\\test\\AppData\\Local\\pnpm\\pnpm.cjs',
      packageManagerUserAgent: 'pnpm/10.0.0 npm/? node/v22 win32 x64',
      fileExists: (candidate) => candidate === 'D:\\Node.js\\pnpm.cmd',
    })

    expect(command).toEqual({
      command: 'D:\\Node.js\\pnpm.cmd',
      args: ['dlx', 'wrangler@latest', 'logout'],
    })
  })

  it('uses a command shell only for Windows command files', () => {
    expect(requiresWindowsCommandShell('D:\\Node.js\\pnpm.cmd', 'win32')).toBe(true)
    expect(requiresWindowsCommandShell('pnpm.CMD', 'win32')).toBe(true)
    expect(requiresWindowsCommandShell('/usr/bin/pnpm', 'linux')).toBe(false)
    expect(requiresWindowsCommandShell('D:\\Node.js\\node.exe', 'win32')).toBe(false)
  })

  it('uses an ASCII volume root for Windows package-manager child processes', () => {
    expect(packageManagerWorkingDirectory('E:\\项目\\ZeroChat', 'win32')).toBe('E:\\')
    expect(packageManagerWorkingDirectory('C:\\ZeroChat', 'win32')).toBe('C:\\ZeroChat')
    expect(packageManagerWorkingDirectory('/work/zerochat', 'linux')).toBe('/work/zerochat')
  })

  it('requires browser, models-shaped, and host-management CORS signatures for two rounds', async () => {
    const responses = [
      new Response('<html>not deployed</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
      new Response('<html>not deployed</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
      new Response('<html>not deployed</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
      new Response('Missing x-zerochat-base-url', {
        status: 400,
        headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173' },
      }),
      new Response('Invalid upstream URL', { status: 400 }),
      new Response(null, {
        status: 200,
        headers: {
          'access-control-allow-origin': 'http://127.0.0.1:5173',
          'access-control-allow-methods': 'GET, PUT, OPTIONS',
          'access-control-allow-headers': 'Content-Type, X-ZeroChat-Access-Key',
        },
      }),
      new Response('Missing x-zerochat-base-url', {
        status: 400,
        headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173' },
      }),
      new Response('Invalid upstream URL', { status: 400 }),
      new Response(null, {
        status: 200,
        headers: {
          'access-control-allow-origin': 'http://127.0.0.1:5173',
          'access-control-allow-methods': 'GET, PUT, OPTIONS',
          'access-control-allow-headers': 'Content-Type, X-ZeroChat-Access-Key',
        },
      }),
    ]
    let sleepCount = 0
    const requests = []

    await expect(
      waitForTemporaryWorkerReadiness({
        workerUrl: 'https://proof.account.workers.dev',
        appOrigin: 'http://127.0.0.1:5173',
        accessKey: 'derived-access-key',
        fetchImpl: async (url, init) => {
          requests.push({
            url: String(url),
            method: init.method ?? 'GET',
            headers: new Headers(init.headers),
          })
          return responses.shift()
        },
        sleep: async () => {
          sleepCount += 1
        },
        maxAttempts: 3,
      }),
    ).resolves.toEqual({
      attemptCount: 3,
      browserProbeStatus: 400,
      consecutivePasses: 2,
      modelsShapeProbeStatus: 400,
      proxyHostsPreflightStatus: 200,
    })
    expect(sleepCount).toBe(2)
    expect(requests).toHaveLength(9)
    expect(
      requests.filter((_, index) => index % 3 === 0).every(
        (request) =>
          request.url === 'https://proof.account.workers.dev/proxy' &&
          request.method === 'GET' &&
          request.headers.get('origin') === 'http://127.0.0.1:5173' &&
          request.headers.get('x-zerochat-access-key') === 'derived-access-key' &&
          request.headers.get('x-zerochat-base-url') === null,
      ),
    ).toBe(true)
    expect(
      requests.filter((_, index) => index % 3 === 1).every(
        (request) =>
          request.url === 'https://proof.account.workers.dev/proxy' &&
          request.method === 'GET' &&
          request.headers.get('origin') === null &&
          request.headers.get('x-zerochat-access-key') === 'derived-access-key' &&
          request.headers.get('x-zerochat-base-url') === 'https://127.0.0.1/v1' &&
          request.headers.get('x-zerochat-proxy-action') === 'models' &&
          request.headers.get('x-zerochat-provider-kind') === 'openai-compatible',
      ),
    ).toBe(true)
    expect(
      requests.filter((_, index) => index % 3 === 2).every(
        (request) =>
          request.url === 'https://proof.account.workers.dev/proxy/hosts' &&
          request.method === 'OPTIONS' &&
          request.headers.get('origin') === 'http://127.0.0.1:5173' &&
          request.headers.get('access-control-request-method') === 'PUT' &&
          request.headers.get('access-control-request-headers') ===
            'content-type,x-zerochat-access-key' &&
          request.headers.get('x-zerochat-access-key') === null,
      ),
    ).toBe(true)
    expect(JSON.stringify(requests)).not.toContain('api.example.test')
  })

  it('fails readiness before browser launch when host-management CORS preflight is rejected', async () => {
    const responses = Array.from({ length: 2 }, () => [
      new Response('Missing x-zerochat-base-url', {
        status: 400,
        headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173' },
      }),
      new Response('Invalid upstream URL', { status: 400 }),
      new Response('<html>forbidden</html>', { status: 403 }),
    ]).flat()

    await expect(
      waitForTemporaryWorkerReadiness({
        workerUrl: 'https://proof.account.workers.dev',
        appOrigin: 'http://127.0.0.1:5173',
        accessKey: 'derived-access-key',
        fetchImpl: async () => responses.shift(),
        sleep: async () => {},
        maxAttempts: 2,
      }),
    ).rejects.toThrow('host-management preflight HTTP 403')
  })

  it('fails closed when no bounded probe reaches the Worker signature', async () => {
    await expect(
      waitForTemporaryWorkerReadiness({
        workerUrl: 'https://proof.account.workers.dev',
        appOrigin: 'http://127.0.0.1:5173',
        accessKey: 'derived-access-key',
        fetchImpl: async () =>
          new Response('<html>not deployed</html>', {
            status: 404,
            headers: { 'content-type': 'text/html' },
          }),
        sleep: async () => {},
        maxAttempts: 2,
      }),
    ).rejects.toThrow('did not become ready after 2 bounded probes')
  })
})
