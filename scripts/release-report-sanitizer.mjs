const redactedSecret = '[redacted]'
const redactedUrl = '[redacted-url]'
const redactedLocalPath = '[redacted-local-path]'
const redactedWindowsAppsPath = '[windowsapps-deleted]'
const sensitiveEnvironmentAssignmentPattern =
  /\b(ZEROCHAT_[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|BASE_URL|PASSPHRASE|PASSWORD|ACCESS_KEY|ENDPOINT))\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/giu
const unsafeSensitiveEnvironmentAssignmentPattern =
  /\bZEROCHAT_[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|BASE_URL|PASSPHRASE|PASSWORD|ACCESS_KEY|ENDPOINT)\s*=\s*(?!\[redacted\](?:\s|$|[,;]))/iu
const githubTokenPattern = /\b(?:github_pat_|gh[opsru]_)[A-Za-z0-9_]+\b/giu
const unsafeGithubTokenPattern = /\b(?:github_pat_|gh[opsru]_)[A-Za-z0-9_]{8,}\b/iu
const windowsAppsDeletedPattern =
  /(?:\\\\\?\\)?C:\\Program Files\\WindowsApps\\Deleted(?:\\[^\r\n"'`<>|]*)?/giu
const windowsDrivePathPattern =
  /(?:\\\\\?\\)?[A-Za-z]:[\\/][^\r\n"'`<>|]*/gu
const windowsUncPathPattern =
  /\\\\(?!\?\\)[^\\/\s"'`<>|]+[\\/][^\r\n"'`<>|]*/gu
const unsafeWindowsDrivePathPattern = /(?:\\\\\?\\)?[A-Za-z]:[\\/]/u
const unsafeWindowsUncPathPattern = /\\\\(?!\?\\)[^\\/\s"'`<>|]+[\\/]/u

function normalizedRepositoryRoots(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot === '') return []
  return [...new Set([repositoryRoot, repositoryRoot.replaceAll('\\', '/')])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
}

function normalizedRedactedValues(values) {
  if (!Array.isArray(values)) return []

  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((left, right) => right.length - left.length)
}

export function sanitizeReleaseReportText(
  value,
  { repositoryRoot = '', redactedValues = [] } = {},
) {
  let text = String(value)

  for (const root of normalizedRepositoryRoots(repositoryRoot)) {
    text = text.replaceAll(root, '<repo>')
  }

  for (const redactedValue of normalizedRedactedValues(redactedValues)) {
    text = text.replaceAll(redactedValue, redactedSecret)
  }

  return text
    .replace(windowsAppsDeletedPattern, redactedWindowsAppsPath)
    .replace(/\bBearer\s+[^\s"'`]+/giu, `Bearer ${redactedSecret}`)
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, 'sk-[redacted]')
    .replace(githubTokenPattern, redactedSecret)
    .replace(sensitiveEnvironmentAssignmentPattern, '$1=[redacted]')
    .replace(/https?:\/\/[^\s"'`)]*/giu, redactedUrl)
    .replace(windowsDrivePathPattern, redactedLocalPath)
    .replace(windowsUncPathPattern, redactedLocalPath)
}

function reportTextValues(value, values = []) {
  if (typeof value === 'string') {
    values.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) reportTextValues(item, values)
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      values.push(key)
      reportTextValues(nested, values)
    }
  }
  return values
}

function hasUnsafeText(value, repositoryRoots) {
  return (
    repositoryRoots.some((root) => value.includes(root)) ||
    /\bsk-[A-Za-z0-9_-]{20,}/u.test(value) ||
    /\bBearer\s+(?!\[redacted\](?:\s|$))/iu.test(value) ||
    unsafeGithubTokenPattern.test(value) ||
    unsafeSensitiveEnvironmentAssignmentPattern.test(value) ||
    /https?:\/\//iu.test(value) ||
    unsafeWindowsDrivePathPattern.test(value) ||
    unsafeWindowsUncPathPattern.test(value)
  )
}

export function hasUnsafeReleaseReportMaterial(report, { repositoryRoot = '' } = {}) {
  const repositoryRoots = normalizedRepositoryRoots(repositoryRoot)
  return reportTextValues(report).some((value) => hasUnsafeText(value, repositoryRoots))
}
