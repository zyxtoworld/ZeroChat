import { EventEmitter } from 'node:events'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  accessKeyFromTemporaryPassphrase,
  extractTemporaryWorkerUrl,
  normalizeTemporaryWorkerProviderBaseUrl,
  packageManagerCommand,
  packageManagerWorkingDirectory,
  readTemporaryCloudflareApiToken,
  requiresWindowsCommandShell,
  sanitizeTemporaryWorkerOutput,
  temporaryWorkerDeployArguments,
  temporaryWorkerDeleteArguments,
  temporaryWorkerWranglerConfig,
  temporaryWranglerEnvironment,
  temporaryWorkerSecretPayload,
  waitForTemporaryWorkerReadiness,
  quoteWindowsCommandLineArgument,
  runCaptured,
  runTemporaryWorkerDeploymentLifecycle,
} from '../cloudflare-temporary-live-provider-ui-drill.mjs'

const itWindowsOnly = process.platform === 'win32' ? it : it.skip

const projectTempRoot = path.resolve('.local/zerochat/tmp')

async function makeProjectTempDirectory(prefix) {
  await mkdir(projectTempRoot, { recursive: true })
  return mkdtemp(path.join(projectTempRoot, prefix))
}

function zeroChatAppResponse() {
  return new Response(
    '<html><meta data-zerochat-windows-csp><script type="module" src="./assets/index-app.js"></script><p data-initial-loading>Loading</p></html>',
    {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    },
  )
}

describe('Cloudflare temporary live-provider UI drill', () => {
  it('quotes Windows command arguments with spaces, quotes, and trailing backslashes', () => {
    expect(quoteWindowsCommandLineArgument('C:\\Program Files\\Node\\')).toBe(
      '"C:\\Program Files\\Node\\\\"',
    )
    const quoted = quoteWindowsCommandLineArgument('C:\\Program Files\\Node "quoted"\\')
    expect(quoted).toContain('\\"quoted\\"')
    expect(quoted.endsWith('\\\\"')).toBe(true)
    expect(quoteWindowsCommandLineArgument('plain')).toBe('plain')
  })

  it('builds a same-origin-only hidden-binding payload without changing the provider key', () => {
    const payload = JSON.parse(
      temporaryWorkerSecretPayload({
        providerApiKey: 'test-provider-key',
        providerHost: 'relay.example.test',
        passphrase: 'throwaway-passphrase',
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
      AUTO_ALLOWED_ORIGINS: 'false',
      REQUIRE_ALLOWED_ORIGINS: 'true',
      AUTO_ALLOWED_HOSTS: 'false',
    })
    expect(payload).not.toHaveProperty('ALLOWED_ORIGINS')
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
    const command = packageManagerCommand(['delete'], {
      platform: 'win32',
      execPath: 'D:\\Node.js\\node.exe',
      npmExecPath: 'C:\\Users\\test\\AppData\\Local\\pnpm\\pnpm.cjs',
      packageManagerUserAgent: 'pnpm/10.0.0 npm/? node/v22 win32 x64',
      fileExists: (candidate) => candidate === 'D:\\Node.js\\pnpm.cmd',
    })

    expect(command).toEqual({
      command: 'D:\\Node.js\\pnpm.cmd',
      args: ['dlx', 'wrangler@latest', 'delete'],
    })
  })

  it('rejects Windows command-file fallback for the sensitive temporary Worker drill', () => {
    expect(() =>
      packageManagerCommand(['deploy'], {
        platform: 'win32',
        execPath: 'D:\\Node.js\\node.exe',
        npmExecPath: 'C:\\Users\\test\\AppData\\Local\\pnpm\\pnpm.cjs',
        packageManagerUserAgent: 'pnpm/10.0.0 npm/? node/v22 win32 x64',
        fileExists: () => false,
        requireDirectNodeEntry: true,
      }),
    ).toThrow('direct Node/Corepack package-manager entry')
  })

  it('uses pnpm.cmd beside node when launched directly without npm metadata', () => {
    const command = packageManagerCommand(['deploy'], {
      platform: 'win32',
      execPath: 'D:\\Node.js\\node.exe',
      npmExecPath: '',
      packageManagerUserAgent: '',
      fileExists: (candidate) => candidate === 'D:\\Node.js\\pnpm.cmd',
    })

    expect(command).toEqual({
      command: 'D:\\Node.js\\pnpm.cmd',
      args: ['dlx', 'wrangler@latest', 'deploy'],
    })
  })

  it('uses a command shell only for Windows command files', () => {
    expect(requiresWindowsCommandShell('D:\\Node.js\\pnpm.cmd', 'win32')).toBe(true)
    expect(requiresWindowsCommandShell('pnpm.CMD', 'win32')).toBe(true)
    expect(requiresWindowsCommandShell('/usr/bin/pnpm', 'linux')).toBe(false)
    expect(requiresWindowsCommandShell('D:\\Node.js\\node.exe', 'win32')).toBe(false)
  })

  it('deploys the current production assets with the temporary Worker entry point', () => {
    expect(
      temporaryWorkerDeployArguments({
        configPath: 'C:\\Temp\\zerochat-wrangler-runtime\\wrangler.toml',
        workerName: 'zerochat-browser-proof-test',
      }),
    ).toEqual([
      'deploy',
      '--config',
      'C:\\Temp\\zerochat-wrangler-runtime\\wrangler.toml',
      '--temporary',
      '--name',
      'zerochat-browser-proof-test',
      '--compatibility-date',
      '2026-07-25',
    ])
  })

  it('binds the production assets into the Worker before invoking Worker routes', () => {
    expect(
      temporaryWorkerWranglerConfig({
        assetsPath: 'E:\\ZeroChat\\dist',
        workerName: 'zerochat-browser-proof-test',
        workerSourcePath: 'E:\\ZeroChat\\cloudflare\\sync-worker.js',
      }),
    ).toBe(
      [
        'name = "zerochat-browser-proof-test"',
        'main = "E:/ZeroChat/cloudflare/sync-worker.js"',
        'compatibility_date = "2026-07-25"',
        '',
        '[assets]',
        'directory = "E:/ZeroChat/dist"',
        'binding = "ASSETS"',
        'run_worker_first = true',
        'not_found_handling = "single-page-application"',
        '',
      ].join('\n'),
    )
  })

  it('isolates temporary Wrangler state without inheriting Cloudflare credentials', () => {
    const inherited = {
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_API_KEY: 'api-key',
      CLOUDFLARE_API_TOKEN: 'api-token',
      CLOUDFLARE_EMAIL: 'owner@example.test',
      CF_API_TOKEN: 'legacy-token',
      cloudflare_api_token: 'case-insensitive-token',
      KEEP_ME: 'kept',
      PROVIDER_KEYS: '{"provider.example":"provider-key"}',
      WRANGLER_LOG_PATH: 'persistent-logs',
      WRANGLER_OUTPUT_FILE_PATH: 'persistent-output.json',
      XDG_CONFIG_HOME: 'persistent-config',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'provider-key',
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'https://provider.example/v1',
      ZEROCHAT_LIVE_PROVIDER_MODEL: 'gpt-manual-alias',
    }

    const isolated = temporaryWranglerEnvironment(
      inherited,
      'C:\\Temp\\zerochat-wrangler-runtime-test',
    )

    expect(isolated).toMatchObject({
      CI: '1',
      KEEP_ME: 'kept',
      WRANGLER_LOG_PATH:
        'C:\\Temp\\zerochat-wrangler-runtime-test\\logs',
      WRANGLER_LOG_SANITIZE: 'true',
      WRANGLER_SEND_METRICS: 'false',
      XDG_CONFIG_HOME:
        'C:\\Temp\\zerochat-wrangler-runtime-test\\config',
    })
    expect(isolated).not.toHaveProperty('CLOUDFLARE_ACCOUNT_ID')
    expect(isolated).not.toHaveProperty('CLOUDFLARE_API_KEY')
    expect(isolated).not.toHaveProperty('CLOUDFLARE_API_TOKEN')
    expect(isolated).not.toHaveProperty('CLOUDFLARE_EMAIL')
    expect(isolated).not.toHaveProperty('CF_API_TOKEN')
    expect(isolated).not.toHaveProperty('cloudflare_api_token')
    expect(isolated).not.toHaveProperty('PROVIDER_KEYS')
    expect(isolated).not.toHaveProperty('WRANGLER_OUTPUT_FILE_PATH')
    expect(isolated).not.toHaveProperty('ZEROCHAT_LIVE_PROVIDER_API_KEY')
    expect(isolated).not.toHaveProperty('ZEROCHAT_LIVE_PROVIDER_BASE_URL')
    expect(isolated).not.toHaveProperty('ZEROCHAT_LIVE_PROVIDER_MODEL')
    expect(inherited.WRANGLER_LOG_PATH).toBe('persistent-logs')
  })

  it('reads the explicitly named temporary Cloudflare token input without exposing it in output', async () => {
    const tokenDirectory = await makeProjectTempDirectory('zerochat-token-input-')
    const tokenPath = path.join(tokenDirectory, 'cloudflare-api-token.txt')
    const token = 'temporary-cloudflare-token'

    try {
      await writeFile(tokenPath, `${token}\n`, 'utf8')

      await expect(readTemporaryCloudflareApiToken(tokenPath)).resolves.toBe(token)
      expect(sanitizeTemporaryWorkerOutput(`deploy failed ${token}`, [token])).not.toContain(
        token,
      )
    } finally {
      await rm(tokenDirectory, { recursive: true, force: true })
    }
  })

  it('rejects a missing or whitespace-bearing temporary token without echoing input', async () => {
    await expect(readTemporaryCloudflareApiToken('')).rejects.toThrow(
      'ZEROCHAT_LIVE_PROVIDER_UI_TEMPORARY_CLOUDFLARE_API_TOKEN_FILE is required',
    )

    const tokenDirectory = await makeProjectTempDirectory('zerochat-token-input-')
    const tokenPath = path.join(tokenDirectory, 'cloudflare-api-token.txt')

    try {
      await writeFile(tokenPath, 'temporary token\n', 'utf8')
      await expect(readTemporaryCloudflareApiToken(tokenPath)).rejects.toThrow(
        'must contain one token',
      )
    } finally {
      await rm(tokenDirectory, { recursive: true, force: true })
    }
  })

  it('uses the temporary token only for Wrangler deployment and deletion children', () => {
    const parentEnvironment = {
      KEEP_ME: 'kept',
      CLOUDFLARE_API_TOKEN: 'existing-global-session-token',
    }
    const isolated = temporaryWranglerEnvironment(
      parentEnvironment,
      'C:\\Temp\\zerochat-wrangler-runtime-test',
      { cloudflareApiToken: 'temporary-token' },
    )

    expect(isolated).toMatchObject({
      KEEP_ME: 'kept',
      CLOUDFLARE_API_TOKEN: 'temporary-token',
    })
    expect(parentEnvironment.CLOUDFLARE_API_TOKEN).toBe('existing-global-session-token')
  })

  it('builds a forced delete command for the exact temporary Worker', () => {
    expect(
      temporaryWorkerDeleteArguments({
        configPath: 'C:\\Temp\\zerochat-wrangler-runtime\\wrangler.toml',
        workerName: 'zerochat-browser-proof-test',
      }),
    ).toEqual([
      'delete',
      '--config',
      'C:\\Temp\\zerochat-wrangler-runtime\\wrangler.toml',
      '--name',
      'zerochat-browser-proof-test',
      '--force',
    ])
  })

  it.each([
    ['success', async () => 'passed', false],
    ['failure', async () => { throw new Error('browser flow failed') }, true],
    ['timeout', async () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error }, true],
    ['interruption', async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error }, true],
  ])(
    'deletes the temporary Worker and runtime directory after %s',
    async (_label, afterDeploy, shouldReject) => {
      const runtimeDirectory = await makeProjectTempDirectory(
        'zerochat-temporary-worker-lifecycle-',
      )
      const configPath = path.join(runtimeDirectory, 'wrangler.toml')
      const calls = []
      const temporaryToken = 'temporary-cloudflare-token'
      let secretInputClosed = false

      try {
        const operation = runTemporaryWorkerDeploymentLifecycle({
          runtimeDirectory,
          configPath,
          workerName: 'zerochat-browser-proof-test',
          packageManagerCwd: 'C:\\',
          environment: { KEEP_ME: 'kept' },
          cloudflareApiToken: temporaryToken,
          secretPayload: 'temporary-secret-payload',
          secretInput: async (payload, callback) => {
            expect(payload).toBe('temporary-secret-payload')
            try {
              return await callback('temporary-secret-pipe', null)
            } finally {
              secretInputClosed = true
            }
          },
          runCommand: async (command, args, options) => {
            calls.push({ command, args, options })
            return { code: 0, signal: null, output: '' }
          },
          afterDeploy,
        })

        if (shouldReject) {
          await expect(operation).rejects.toThrow()
        } else {
          await expect(operation).resolves.toBe('passed')
        }

        expect(calls).toHaveLength(2)
        expect(calls[0].args).toContain('deploy')
        expect(calls[0].args).toContain('--secrets-file')
        expect(calls[1].args).toContain('delete')
        expect(calls[1].args).toContain('--force')
        expect(secretInputClosed).toBe(true)
        expect(calls.every((call) => call.options.env.CLOUDFLARE_API_TOKEN === temporaryToken)).toBe(
          true,
        )
        expect(await readFile(configPath).catch(() => null)).toBeNull()
        await expect(readFile(runtimeDirectory)).rejects.toThrow()
      } finally {
        await rm(runtimeDirectory, { recursive: true, force: true })
      }
    },
  )

  it('waits for a real timed-out child tree before deleting the temporary Worker', async () => {
    const runtimeDirectory = await makeProjectTempDirectory(
      'zerochat-temporary-worker-real-timeout-',
    )
    const configPath = path.join(runtimeDirectory, 'wrangler.toml')
    await writeFile(configPath, 'runtime', 'utf8')
    const lateMarker = path.join(
      projectTempRoot,
      `zerochat-temporary-worker-late-${Date.now()}-${Math.random()}.txt`,
    )
    const deleteMarker = path.join(
      projectTempRoot,
      `zerochat-temporary-worker-delete-${Date.now()}-${Math.random()}.txt`,
    )
    const grandchildScript = [
      "const fs = require('node:fs')",
      'setTimeout(() => fs.writeFileSync(process.env.ZEROCHAT_LATE_MARKER, \'late-deployed\'), 5_000)',
    ].join(';')
    const parentScript = [
      "const { spawn } = require('node:child_process')",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], { stdio: 'ignore', env: process.env })`,
      "child.once('exit', () => setTimeout(() => process.exit(0), 5_000))",
    ].join(';')
    const calls = []
    try {
      const lifecycleError = await runTemporaryWorkerDeploymentLifecycle({
          runtimeDirectory,
          configPath,
          workerName: 'zerochat-browser-proof-test',
           packageManagerCwd: process.cwd(),
           environment: {
             ...process.env,
             ZEROCHAT_LATE_MARKER: lateMarker,
           },
          cloudflareApiToken: 'temporary-cloudflare-token',
          runCommand: async (_command, args, options) => {
            if (args.includes('deploy')) {
              calls.push('deploy')
              return runCaptured(process.execPath, ['-e', parentScript], {
                ...options,
                timeoutMs: 200,
              })
            }

            calls.push('delete')
            await writeFile(deleteMarker, 'deleted', 'utf8')
            return { code: 0, signal: null, output: '' }
          },
        }).catch((caughtError) => caughtError)
      expect(lifecycleError.message).toMatch(/timed out/u)

      await new Promise((resolve) => setTimeout(resolve, 700))
      expect(calls).toEqual(['deploy', 'delete'])
      await expect(readFile(deleteMarker, 'utf8')).resolves.toBe('deleted')
      await expect(readFile(lateMarker, 'utf8')).rejects.toThrow()
      await expect(access(runtimeDirectory)).rejects.toThrow()
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true })
      await rm(lateMarker, { force: true })
      await rm(deleteMarker, { force: true })
    }
  }, 10_000)

  it('waits for an owned descendant before deleting the temporary Worker', async () => {
    const runtimeDirectory = await makeProjectTempDirectory(
      'zerochat-temporary-worker-root-exited-',
    )
    const configPath = path.join(runtimeDirectory, 'wrangler.toml')
    await writeFile(configPath, 'runtime', 'utf8')
    const lateMarker = path.join(
      projectTempRoot,
      `zerochat-temporary-worker-root-exited-late-${Date.now()}-${Math.random()}.txt`,
    )
    const eventLog = path.join(
      projectTempRoot,
      `zerochat-temporary-worker-root-exited-events-${Date.now()}-${Math.random()}.txt`,
    )
    const grandchildScript = [
      "const fs = require('node:fs')",
      'setTimeout(() => { fs.writeFileSync(process.env.ZEROCHAT_LATE_MARKER, \'late-deployed\'); fs.appendFileSync(process.env.ZEROCHAT_EVENT_LOG, \'late-complete\\n\') }, 500)',
    ].join(';')
    const rootExitsScript = [
      "const { spawn } = require('node:child_process')",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], { stdio: 'ignore', env: process.env })`,
      'child.once(\'exit\', () => process.exit(0))',
    ].join(';')
    const calls = []
    let deploymentResult

    try {
      await runTemporaryWorkerDeploymentLifecycle({
        runtimeDirectory,
        configPath,
        workerName: 'zerochat-browser-proof-test',
        packageManagerCwd: process.cwd(),
        environment: { ZEROCHAT_EVENT_LOG: eventLog, ZEROCHAT_LATE_MARKER: lateMarker },
        cloudflareApiToken: 'temporary-cloudflare-token',
        runCommand: async (_command, args, options) => {
          if (args.includes('deploy')) {
            calls.push('deploy')
            deploymentResult = await runCaptured(process.execPath, ['-e', rootExitsScript], {
              ...options,
              timeoutMs: 3_000,
            })
            return deploymentResult
          }

          calls.push('delete')
          await writeFile(eventLog, 'delete\n', { flag: 'a' })
          return { code: 0, signal: null, output: '' }
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 700))
      expect(deploymentResult).toMatchObject({ code: 0 })
      if (process.platform === 'win32') {
        expect(deploymentResult.output).toContain('ZEROCHAT_WINDOWS_JOB_READY')
      }
      expect(calls).toEqual(['deploy', 'delete'])
      await expect(readFile(eventLog, 'utf8')).resolves.toBe('late-complete\ndelete\n')
      await expect(readFile(lateMarker, 'utf8')).resolves.toBe('late-deployed')
      await expect(access(runtimeDirectory)).rejects.toThrow()
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true })
      await rm(lateMarker, { force: true })
      await rm(eventLog, { force: true })
    }
  }, 10_000)

  it('withholds delete and retains runtime when process-tree quiescence is unverified', async () => {
    const runtimeDirectory = await makeProjectTempDirectory(
      'zerochat-temporary-worker-unverified-tree-',
    )
    const configPath = path.join(runtimeDirectory, 'wrangler.toml')
    await writeFile(configPath, 'runtime', 'utf8')
    const calls = []

    try {
      const error = await runTemporaryWorkerDeploymentLifecycle({
        runtimeDirectory,
        configPath,
        workerName: 'zerochat-browser-proof-test',
        packageManagerCwd: process.cwd(),
        environment: {},
        cloudflareApiToken: 'temporary-cloudflare-token',
        runCommand: async (_command, args) => {
          calls.push(args.includes('deploy') ? 'deploy' : 'delete')
          if (args.includes('deploy')) {
            const deployError = new Error('deploy tree did not quiesce')
            deployError.childQuiesced = false
            throw deployError
          }
          return { code: 0, signal: null, output: '' }
        },
      }).catch((caughtError) => caughtError)

      expect(error.message).toMatch(/did not quiesce/u)
      expect(calls).toEqual(['deploy'])
      await expect(readFile(configPath, 'utf8')).resolves.toBe('runtime')
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true })
    }
  })

  itWindowsOnly('withholds delete when the Windows job launcher cannot establish ownership', async () => {
    const runtimeDirectory = await makeProjectTempDirectory(
      'zerochat-temporary-worker-launcher-failure-',
    )
    const configPath = path.join(runtimeDirectory, 'wrangler.toml')
    await writeFile(configPath, 'runtime', 'utf8')
    const calls = []

    try {
      const error = await runTemporaryWorkerDeploymentLifecycle({
        runtimeDirectory,
        configPath,
        workerName: 'zerochat-browser-proof-test',
        packageManagerCwd: process.cwd(),
        environment: {},
        cloudflareApiToken: 'temporary-cloudflare-token',
        runCommand: async (_command, args, options) => {
          calls.push(args.includes('deploy') ? 'deploy' : 'delete')
          if (args.includes('deploy')) {
            return runCaptured('C:\\zerochat-missing-deploy-target.exe', [], {
              ...options,
              timeoutMs: 3_000,
            })
          }
          return { code: 0, signal: null, output: '' }
        },
      }).catch((caughtError) => caughtError)

      expect(error).toMatchObject({ childQuiesced: false })
      expect(error.message).toMatch(/job|ownership|launcher/u)
      expect(calls).toEqual(['deploy'])
      await expect(readFile(configPath, 'utf8')).resolves.toBe('runtime')
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true })
    }
  })

  it('keeps aggregate cleanup failures explicitly unquiesced', async () => {
    const runtimeDirectory = await makeProjectTempDirectory(
      'zerochat-temporary-worker-aggregate-failure-',
    )
    const configPath = path.join(runtimeDirectory, 'wrangler.toml')
    await writeFile(configPath, 'runtime', 'utf8')

    try {
      const error = await runTemporaryWorkerDeploymentLifecycle({
        runtimeDirectory,
        configPath,
        workerName: 'zerochat-browser-proof-test',
        packageManagerCwd: process.cwd(),
        environment: {},
        cloudflareApiToken: 'temporary-cloudflare-token',
        runCommand: async (_command, args) => {
          if (args.includes('deploy')) {
            const aggregate = new AggregateError([new Error('tree cleanup failed')])
            aggregate.childQuiesced = false
            throw aggregate
          }
          return { code: 0, signal: null, output: '' }
        },
      }).catch((caughtError) => caughtError)

      expect(error).toMatchObject({ name: 'AggregateError', childQuiesced: false })
      await expect(readFile(configPath, 'utf8')).resolves.toBe('runtime')
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true })
    }
  })

  it.each(['SIGINT', 'SIGTERM'])(
    'handles one %s owner, waits for deploy abort, then deletes exactly once',
    async (signalName) => {
    const runtimeDirectory = await makeProjectTempDirectory(
      'zerochat-temporary-worker-signal-',
    )
    const configPath = path.join(runtimeDirectory, 'wrangler.toml')
    const signalSource = new EventEmitter()
    const events = []
    let markDeployStarted
    const deployStarted = new Promise((resolve) => {
      markDeployStarted = resolve
    })

    try {
      const operation = runTemporaryWorkerDeploymentLifecycle({
        runtimeDirectory,
        configPath,
        workerName: 'zerochat-browser-proof-test',
        packageManagerCwd: 'C:\\',
        environment: {},
        cloudflareApiToken: 'temporary-cloudflare-token',
          signalSource,
          runCommand: async (_command, args, { signal } = {}) => {
            if (args.includes('deploy')) {
              markDeployStarted()
              if (!signal) {
              await new Promise((resolve) => setTimeout(resolve, 30))
              throw new Error('signal was not connected')
            }

            await new Promise((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  events.push('deploy-abort')
                  events.push('deploy-tree-closed')
                  const error = new Error('deploy interrupted')
                  error.name = 'AbortError'
                  error.childQuiesced = true
                  reject(error)
                },
                { once: true },
              )
            })
          }

          events.push('delete')
          return { code: 0, signal: null, output: '' }
        },
      })

      await deployStarted
      signalSource.emit(signalName)
      signalSource.emit(signalName)
      await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
      expect(events).toEqual(['deploy-abort', 'deploy-tree-closed', 'delete'])
      expect(signalSource.listenerCount('SIGINT')).toBe(0)
      expect(signalSource.listenerCount('SIGTERM')).toBe(0)
      await expect(access(runtimeDirectory)).rejects.toThrow()
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true })
    }
    },
  )

  it('waits for a delayed deploy failure before deleting the Worker', async () => {
    const runtimeDirectory = await makeProjectTempDirectory(
      'zerochat-temporary-worker-deploy-failure-',
    )
    const configPath = path.join(runtimeDirectory, 'wrangler.toml')
    const events = []
    let releaseDeploy
    const deployReleased = new Promise((resolve) => {
      releaseDeploy = resolve
    })

    try {
      const operation = runTemporaryWorkerDeploymentLifecycle({
        runtimeDirectory,
        configPath,
        workerName: 'zerochat-browser-proof-test',
        packageManagerCwd: 'C:\\',
        environment: {},
        cloudflareApiToken: 'temporary-cloudflare-token',
        runCommand: async (_command, args) => {
          if (args.includes('deploy')) {
            events.push('deploy-start')
            await deployReleased
            events.push('deploy-tree-closed')
            return { code: 1, signal: null, output: 'deploy failed' }
          }

          events.push('delete')
          return { code: 0, signal: null, output: '' }
        },
      })

      await Promise.resolve()
      expect(events).toEqual(['deploy-start'])
      releaseDeploy()
      await expect(operation).rejects.toThrow('Temporary Worker deployment failed')
      expect(events).toEqual(['deploy-start', 'deploy-tree-closed', 'delete'])
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true })
    }
  })

  it('reports delete failure without exposing the temporary token', async () => {
    const runtimeDirectory = await makeProjectTempDirectory(
      'zerochat-temporary-worker-delete-failure-',
    )
    const configPath = path.join(runtimeDirectory, 'wrangler.toml')
    const temporaryToken = 'temporary-cloudflare-token'
    let callCount = 0

    try {
      const error = await runTemporaryWorkerDeploymentLifecycle({
        runtimeDirectory,
        configPath,
        workerName: 'zerochat-browser-proof-test',
        packageManagerCwd: 'C:\\',
        environment: {},
        cloudflareApiToken: temporaryToken,
        runCommand: async (_command, args) => {
          callCount += 1
          if (args.includes('deploy')) {
            return { code: 0, signal: null, output: '' }
          }

          return {
            code: 1,
            signal: null,
            output: `delete failed with ${temporaryToken}`,
          }
        },
      }).catch((caughtError) => caughtError)

      expect(error.message).toMatch(/Temporary Worker deletion failed/u)
      expect(error.message).not.toContain(temporaryToken)
      expect(callCount).toBe(2)
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true })
    }
  })

  it('uses an ASCII volume root for Windows package-manager child processes', () => {
    expect(packageManagerWorkingDirectory('E:\\项目\\ZeroChat', 'win32')).toBe('E:\\')
    expect(packageManagerWorkingDirectory('C:\\ZeroChat', 'win32')).toBe('C:\\ZeroChat')
    expect(packageManagerWorkingDirectory('/work/zerochat', 'linux')).toBe('/work/zerochat')
  })

  it('requires browser, models-shaped, and host-management CORS signatures for two rounds', async () => {
    const notReadyRound = Array.from(
      { length: 4 },
      () =>
        new Response('<html>not deployed</html>', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        }),
    )
    const readyRound = () => [
      zeroChatAppResponse(),
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
    const responses = [...notReadyRound, ...readyRound(), ...readyRound()]
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
      appProbeStatus: 200,
      browserProbeStatus: 400,
      consecutivePasses: 2,
      modelsShapeProbeStatus: 400,
      proxyHostsPreflightStatus: 200,
    })
    expect(sleepCount).toBe(2)
    expect(requests).toHaveLength(12)
    expect(
      requests.filter((_, index) => index % 4 === 0).every(
        (request) =>
          request.url === 'https://proof.account.workers.dev/' &&
          request.method === 'GET' &&
          request.headers.get('accept') === 'text/html' &&
          request.headers.get('x-zerochat-access-key') === null,
      ),
    ).toBe(true)
    expect(
      requests.filter((_, index) => index % 4 === 1).every(
        (request) =>
          request.url === 'https://proof.account.workers.dev/proxy' &&
          request.method === 'GET' &&
          request.headers.get('origin') === 'http://127.0.0.1:5173' &&
          request.headers.get('x-zerochat-access-key') === 'derived-access-key' &&
          request.headers.get('x-zerochat-base-url') === null,
      ),
    ).toBe(true)
    expect(
      requests.filter((_, index) => index % 4 === 2).every(
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
      requests.filter((_, index) => index % 4 === 3).every(
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

  it('allows one bounded grace probe when readiness first passes on the final scheduled attempt', async () => {
    const notReadyRound = Array.from(
      { length: 4 },
      () => new Response('<html>not deployed</html>', { status: 404 }),
    )
    const readyRound = () => [
      zeroChatAppResponse(),
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
    const responses = [...notReadyRound, ...readyRound(), ...readyRound()]
    let sleepCount = 0

    await expect(
      waitForTemporaryWorkerReadiness({
        workerUrl: 'https://proof.account.workers.dev',
        appOrigin: 'http://127.0.0.1:5173',
        accessKey: 'derived-access-key',
        fetchImpl: async () => responses.shift(),
        sleep: async () => {
          sleepCount += 1
        },
        maxAttempts: 2,
      }),
    ).resolves.toMatchObject({
      attemptCount: 3,
      consecutivePasses: 2,
    })
    expect(sleepCount).toBe(2)
    expect(responses).toHaveLength(0)
  })

  it('fails readiness before browser launch when host-management CORS preflight is rejected', async () => {
    const responses = Array.from({ length: 2 }, () => [
      zeroChatAppResponse(),
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

  it('does not launch the browser while the static app root is still a deployment placeholder', async () => {
    let appProbeCount = 0

    await expect(
      waitForTemporaryWorkerReadiness({
        workerUrl: 'https://proof.account.workers.dev',
        appOrigin: 'https://proof.account.workers.dev',
        accessKey: 'derived-access-key',
        fetchImpl: async (url, init = {}) => {
          const requestUrl = new URL(url)
          const headers = new Headers(init.headers)

          if (requestUrl.pathname === '/') {
            appProbeCount += 1
            return new Response('<html>There is nothing here yet</html>', {
              status: 200,
              headers: { 'content-type': 'text/html; charset=UTF-8' },
            })
          }
          if (requestUrl.pathname === '/proxy/hosts') {
            return new Response(null, {
              status: 200,
              headers: {
                'access-control-allow-origin': 'https://proof.account.workers.dev',
                'access-control-allow-methods': 'GET, PUT, OPTIONS',
                'access-control-allow-headers':
                  'Content-Type, X-ZeroChat-Access-Key',
              },
            })
          }
          if (headers.has('x-zerochat-base-url')) {
            return new Response('Invalid upstream URL', { status: 400 })
          }
          return new Response('Missing x-zerochat-base-url', {
            status: 400,
            headers: {
              'access-control-allow-origin': 'https://proof.account.workers.dev',
            },
          })
        },
        sleep: async () => {},
        maxAttempts: 2,
      }),
    ).rejects.toThrow('app HTTP 200')
    expect(appProbeCount).toBe(2)
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
