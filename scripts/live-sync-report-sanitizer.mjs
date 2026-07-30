export const REDACTED_LIVE_SYNC_SECRET = '[redacted-live-sync-secret]'

const SENSITIVE_REPORT_ENV_KEYS = [
  'ZEROCHAT_LIVE_SYNC_PASSPHRASE',
  'ZEROCHAT_LIVE_GITHUB_TOKEN',
  'ZEROCHAT_LIVE_WORKER_ENDPOINT',
  'ZEROCHAT_LIVE_GIST_ID',
]

export function redactLiveSyncReportText(value, env = process.env) {
  let text = String(value)

  for (const key of SENSITIVE_REPORT_ENV_KEYS) {
    const secret = env[key]?.trim()
    if (secret) {
      text = text.split(secret).join(REDACTED_LIVE_SYNC_SECRET)
    }
  }

  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/giu, REDACTED_LIVE_SYNC_SECRET)
    .replace(/\bgh[opsru]_[A-Za-z0-9_]+\b/giu, REDACTED_LIVE_SYNC_SECRET)
    .replace(/\bhttps?:\/\/[^\s)"']+/giu, '[redacted-url]')
    .replace(/\bZEROCHAT_[A-Z0-9_]+\b/gu, '[redacted-env]')
    .replace(/[A-Za-z0-9+/=_-]{48,}/gu, REDACTED_LIVE_SYNC_SECRET)
}

export function sanitizeLiveSyncReportValue(value, env = process.env, keyPath = []) {
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeLiveSyncReportValue(item, env, [...keyPath, String(index)]))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => {
        const sanitizedKey = redactLiveSyncReportText(key, env)
        return [sanitizedKey, sanitizeLiveSyncReportValue(nested, env, [...keyPath, sanitizedKey])]
      }),
    )
  }

  if (
    typeof value === 'string' &&
    keyPath[keyPath.length - 1] === 'sha256' &&
    /^[A-F0-9]{64}$/iu.test(value)
  ) {
    return value.toUpperCase()
  }

  return typeof value === 'string' ? redactLiveSyncReportText(value, env) : value
}
