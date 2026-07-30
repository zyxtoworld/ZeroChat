import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import {
  credentialEnvironmentFamiliesStripped,
  sanitizedDiagnosticEnv,
} from '../release-diagnostics-env.mjs'
import { releaseReportLockTokenEnv } from '../release-report-lock.mjs'

function readChildEnvironment(env) {
  const result = spawnSync(
    process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
    {
      encoding: 'utf8',
      env,
    },
  )

  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

describe('release diagnostics environment', () => {
  it('strips live-service credentials while retaining only diagnostic report paths and safe non-credential variables', () => {
    const sanitized = sanitizedDiagnosticEnv({
      PATH: 'safe-path',
      CHROME_PATH: 'safe-browser-path',
      ZEROCHAT_LIVE_PROVIDER_API_KEY: 'private-value',
      ZEROCHAT_LIVE_PROVIDER_BASE_URL: 'private-value',
      ZEROCHAT_LIVE_SYNC_PASSPHRASE: 'private-value',
      ZEROCHAT_LIVE_WORKER_ENDPOINT: 'private-value',
      GH_TOKEN: 'private-value',
      GITHUB_TOKEN: 'private-value',
      OPENAI_API_KEY: 'private-value',
      ANTHROPIC_AUTH_TOKEN: 'private-value',
      AZURE_OPENAI_KEY: 'private-value',
      AWS_ACCESS_KEY_ID: 'private-value',
      AWS_SECRET_ACCESS_KEY: 'private-value',
      CUSTOM_SERVICE_API_TOKEN: 'private-value',
      CUSTOM_SERVICE_PASSPHRASE: 'private-value',
      [releaseReportLockTokenEnv]: 'safe-lock-token',
    })

    expect(sanitized).toMatchObject({
      PATH: 'safe-path',
      CHROME_PATH: 'safe-browser-path',
      [releaseReportLockTokenEnv]: 'safe-lock-token',
      ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT:
        '.manual-qa/live-provider-smoke-current-diagnostic.json',
      ZEROCHAT_LIVE_SYNC_REPORT:
        '.manual-qa/live-sync-release-drill-current-diagnostic.json',
    })
    expect(Object.keys(sanitized)).not.toEqual(
      expect.arrayContaining([
        'ZEROCHAT_LIVE_PROVIDER_API_KEY',
        'ZEROCHAT_LIVE_PROVIDER_BASE_URL',
        'ZEROCHAT_LIVE_SYNC_PASSPHRASE',
        'ZEROCHAT_LIVE_WORKER_ENDPOINT',
        'GH_TOKEN',
        'GITHUB_TOKEN',
        'OPENAI_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'AZURE_OPENAI_KEY',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'CUSTOM_SERVICE_API_TOKEN',
        'CUSTOM_SERVICE_PASSPHRASE',
      ]),
    )

    const childEnvironment = readChildEnvironment(sanitized)
    expect(childEnvironment).toMatchObject({
      PATH: 'safe-path',
      CHROME_PATH: 'safe-browser-path',
      [releaseReportLockTokenEnv]: 'safe-lock-token',
      ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT:
        '.manual-qa/live-provider-smoke-current-diagnostic.json',
      ZEROCHAT_LIVE_SYNC_REPORT:
        '.manual-qa/live-sync-release-drill-current-diagnostic.json',
    })
    expect(Object.keys(childEnvironment)).not.toEqual(
      expect.arrayContaining([
        'ZEROCHAT_LIVE_PROVIDER_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'AZURE_OPENAI_KEY',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'CUSTOM_SERVICE_API_TOKEN',
        'CUSTOM_SERVICE_PASSPHRASE',
      ]),
    )
  })

  it('documents every credential family stripped from diagnostic child processes', () => {
    expect(credentialEnvironmentFamiliesStripped).toEqual(
      expect.arrayContaining([
        'ZEROCHAT_LIVE_PROVIDER*',
        'ZEROCHAT_LIVE_SYNC*',
        'GH_TOKEN',
        'common credential-like environment variable names',
      ]),
    )
  })
})
