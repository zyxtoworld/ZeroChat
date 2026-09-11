const MAX_RUNTIME_ID_LENGTH = 128
const MAX_RUNTIME_ID_PREFIX_LENGTH = 32
const runtimeIdPattern = /^[A-Za-z0-9_-]+$/
const fallbackIdSeed = Math.random().toString(36).slice(2) || 'seed'
let fallbackIdSequence = 0
const issuedRuntimeIds = new Set<string>()

function normalizeRuntimeIdPrefix(prefix: string): string {
  const normalized = prefix
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_RUNTIME_ID_PREFIX_LENGTH)

  return normalized || 'id'
}

export function isUsableRuntimeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_RUNTIME_ID_LENGTH &&
    runtimeIdPattern.test(value)
  )
}

export function reserveRuntimeIds(values: unknown): void {
  if (!Array.isArray(values)) return

  for (const value of values) {
    if (typeof value !== 'object' || value === null) continue

    const id = (value as { id?: unknown }).id
    if (isUsableRuntimeId(id)) {
      issuedRuntimeIds.add(id)
    }
  }
}

function createFallbackRuntimeId(prefix: string): string {
  const safePrefix = normalizeRuntimeIdPrefix(prefix)

  for (;;) {
    fallbackIdSequence =
      fallbackIdSequence >= Number.MAX_SAFE_INTEGER
        ? 1
        : fallbackIdSequence + 1
    const candidate = `${safePrefix}-${fallbackIdSeed}-${Date.now()}-${fallbackIdSequence}`

    if (!issuedRuntimeIds.has(candidate)) {
      issuedRuntimeIds.add(candidate)
      return candidate
    }
  }
}

export function createRuntimeId(prefix: string): string {
  let candidate: string | undefined

  try {
    candidate = globalThis.crypto?.randomUUID?.()
  } catch {
    candidate = undefined
  }

  if (isUsableRuntimeId(candidate) && !issuedRuntimeIds.has(candidate)) {
    issuedRuntimeIds.add(candidate)
    return candidate
  }

  return createFallbackRuntimeId(prefix)
}
