import { releaseReportLockTokenEnv } from './release-report-lock.mjs'

export const credentialEnvironmentFamiliesStripped = Object.freeze([
  'ZEROCHAT_LIVE_PROVIDER*',
  'ZEROCHAT_LIVE_SYNC*',
  'ZEROCHAT_LIVE_WORKER_*',
  'ZEROCHAT_LIVE_GITHUB_*',
  'ZEROCHAT_LIVE_GIST_*',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'provider API key/base URL families',
  'common credential-like environment variable names',
])

const allowedDiagnosticEnvKeys = new Set([
  'ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT',
  'ZEROCHAT_LIVE_SYNC_REPORT',
  releaseReportLockTokenEnv,
])

const sensitiveDiagnosticEnvExactKeys = new Set([
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_PAT',
  'GITHUB_OAUTH_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
])

const sensitiveDiagnosticEnvKeyPatterns = [
  /^ZEROCHAT_LIVE_PROVIDER/iu,
  /^ZEROCHAT_LIVE_SYNC/iu,
  /^ZEROCHAT_LIVE_WORKER_/iu,
  /^ZEROCHAT_LIVE_GITHUB_/iu,
  /^ZEROCHAT_LIVE_GIST_/iu,
  /^GITHUB_.*(?:TOKEN|SECRET|PRIVATE_KEY|PAT)$/iu,
  /^(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE|AZURE_OPENAI|MISTRAL|COHERE)_(?:API_KEY|BASE_URL|TOKEN|SECRET|ENDPOINT)/iu,
  /(?:^|_)(?:API_KEY|API_TOKEN|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|SESSION_TOKEN|CLIENT_SECRET|PRIVATE_KEY|SECRET_ACCESS_KEY|ACCESS_KEY_ID|SECRET_KEY|PASSWORD|PASSPHRASE|CREDENTIALS?|TOKEN|KEY)$/iu,
]

function isSensitiveDiagnosticEnvKey(key) {
  if (allowedDiagnosticEnvKeys.has(key)) {
    return false
  }

  return (
    sensitiveDiagnosticEnvExactKeys.has(key) ||
    sensitiveDiagnosticEnvKeyPatterns.some((pattern) => pattern.test(key))
  )
}

export function sanitizedDiagnosticEnv(sourceEnv) {
  const env = {}

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (!isSensitiveDiagnosticEnvKey(key)) {
      env[key] = value
    }
  }

  env.ZEROCHAT_LIVE_SYNC_REPORT =
    '.manual-qa/live-sync-release-drill-current-diagnostic.json'
  env.ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT =
    '.manual-qa/live-provider-smoke-current-diagnostic.json'

  const remainingSensitiveKeys = Object.keys(env).filter((key) =>
    isSensitiveDiagnosticEnvKey(key),
  )

  if (remainingSensitiveKeys.length) {
    throw new Error(
      `Refusing to run release diagnostics with sensitive env keys still present: ${remainingSensitiveKeys.join(', ')}`,
    )
  }

  return env
}
