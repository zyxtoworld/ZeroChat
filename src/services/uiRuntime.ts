export type NoticeTone = 'success' | 'warning' | 'error'

export interface NetworkInformationLite {
  effectiveType?: string
  saveData?: boolean
}

export interface PlatformShortcutEnvironment {
  platform?: string
  userAgent?: string
}

export const IDLE_SERVICE_WARM_TIMEOUT_MS = 4500
export const IDLE_SERVICE_WARM_FALLBACK_MS = 1800
export const GUIDE_SUCCESS_CLOSE_DELAY_MS = 1000

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()

const NOTICE_ERROR_PATTERNS = [
  '失败',
  '错误',
  '无法',
  '不正',
  '不支',
  'invalid',
  'failed',
  'failure',
  'error',
  'unauthorized',
  'forbidden',
  'not allowed',
  'could not',
  'unable',
  'network',
  'cors',
  'unsafe',
]

const NOTICE_WARNING_PATTERNS = [
  '请先',
  '未启',
  '至少',
  '没有',
  '不能为空',
  '尚未',
  '暂存到本',
  '已移除本地或不安',
  'required',
  'missing',
  'enter ',
  'choose ',
  'add and select',
  'disabled',
  'empty',
  'keep at least',
  'stop or wait',
]

export function isApplePlatform(
  environment: PlatformShortcutEnvironment = {},
): boolean {
  const platform =
    environment.platform ??
    (typeof navigator === 'undefined' ? '' : navigator.platform)
  const userAgent =
    environment.userAgent ??
    (typeof navigator === 'undefined' ? '' : navigator.userAgent)

  return /Mac|iPhone|iPad|iPod/i.test(`${platform || ''} ${userAgent || ''}`)
}

export function keyboardSendShortcut(
  environment?: PlatformShortcutEnvironment,
): string {
  return isApplePlatform(environment) ? 'Cmd+Enter' : 'Ctrl+Enter'
}

export function keyboardNewConversationShortcut(
  aria = false,
  environment?: PlatformShortcutEnvironment,
): string {
  return isApplePlatform(environment)
    ? aria
      ? 'Meta+N'
      : 'Cmd+N'
    : aria
      ? 'Control+N'
      : 'Ctrl+N'
}

export function shouldWarmLazyServices(
  connection: NetworkInformationLite | undefined =
    typeof navigator === 'undefined'
      ? undefined
      : (
          navigator as Navigator & { connection?: NetworkInformationLite }
        ).connection,
  online = typeof navigator === 'undefined' ? true : navigator.onLine,
): boolean {
  const effectiveType = connection?.effectiveType

  return (
    online !== false &&
    connection?.saveData !== true &&
    effectiveType !== 'slow-2g' &&
    effectiveType !== '2g'
  )
}

export function scheduleIdleTask(callback: () => void): () => void {
  let active = true
  const run = () => {
    if (!active) return
    active = false
    callback()
  }

  if (
    typeof window.requestIdleCallback === 'function' &&
    typeof window.cancelIdleCallback === 'function'
  ) {
    const id = window.requestIdleCallback(run, {
      timeout: IDLE_SERVICE_WARM_TIMEOUT_MS,
    })

    return () => {
      active = false
      window.cancelIdleCallback(id)
    }
  }

  const id = window.setTimeout(run, IDLE_SERVICE_WARM_FALLBACK_MS)
  return () => {
    active = false
    window.clearTimeout(id)
  }
}

export function waitForGuideSuccessClose(
  delayMs = GUIDE_SUCCESS_CLOSE_DELAY_MS,
): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

export function systemDateTimeFormatter(locales: string[]): Intl.DateTimeFormat {
  const key = locales.length ? locales.join('\u0000') : 'default'
  const cached = dateTimeFormatters.get(key)

  if (cached) {
    return cached
  }

  if (dateTimeFormatters.size > 16) {
    dateTimeFormatters.clear()
  }

  const formatter = new Intl.DateTimeFormat(locales.length ? locales : undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
  dateTimeFormatters.set(key, formatter)
  return formatter
}

export function formatSystemDateTime(value: number, locales: string[]): string {
  return systemDateTimeFormatter(locales).format(value)
}

export function systemNumberFormatter(locales: string[]): Intl.NumberFormat {
  const key = locales.length ? locales.join('\u0000') : 'default'
  const cached = numberFormatters.get(key)

  if (cached) {
    return cached
  }

  if (numberFormatters.size > 16) {
    numberFormatters.clear()
  }

  const formatter = new Intl.NumberFormat(locales.length ? locales : undefined)
  numberFormatters.set(key, formatter)
  return formatter
}

export function formatSystemNumber(value: number, locales: string[]): string {
  return systemNumberFormatter(locales).format(value)
}

export function timeLabel(
  value: number | undefined,
  locales: string[],
  neverSyncedLabel: string,
): string {
  if (!value) {
    return neverSyncedLabel
  }

  return formatSystemDateTime(value, locales)
}

export function messageTimeLabel(value: number, locales: string[]): string {
  return formatSystemDateTime(value, locales)
}

export const GENERATION_RETRY_DELAYS_MS = [400, 900, 1600]

export function waitForGenerationRetry(
  signal: AbortSignal,
  delayMs: number,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }

  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof window.setTimeout> | undefined
    let settled = false

    const removeAbortListener = () => {
      try {
        signal.removeEventListener('abort', abort)
      } catch {
        // Teardown can race an embedded signal owner being destroyed.
      }
    }
    const clearTimer = () => {
      if (timeout === undefined) return
      try {
        window.clearTimeout(timeout)
      } catch {
        // A failed host cleanup must not prevent retry settlement.
      }
    }
    const abort = () => {
      if (settled) return
      settled = true
      clearTimer()
      removeAbortListener()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    try {
      timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        removeAbortListener()
        resolve()
      }, delayMs)

      // Some embedded timer shims invoke callbacks synchronously.
      if (settled) return

      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    } catch (error: unknown) {
      if (settled) return
      settled = true
      clearTimer()
      removeAbortListener()
      reject(error)
    }
  })
}

export function postWindowsSyncStatus(
  status: 'complete' | 'failed',
  message: string,
): void {
  ;(
    window as Window & {
      chrome?: {
        webview?: {
          postMessage(payload: {
            kind: 'zerochat.syncStatus'
            status: 'complete' | 'failed'
            message: string
          }): void
        }
      }
    }
  ).chrome?.webview?.postMessage({
    kind: 'zerochat.syncStatus',
    status,
    message,
  })
}

export function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function providerErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return ''
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

export function providerErrorRetryable(error: unknown): boolean | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const retryable = (error as { retryable?: unknown }).retryable
  return typeof retryable === 'boolean' ? retryable : null
}

export function shouldAutoRetryGenerationError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false
  }

  const explicitRetryable = providerErrorRetryable(error)

  if (explicitRetryable !== null) {
    return explicitRetryable
  }

  const message = error instanceof Error ? error.message : String(error)
  return /network|timeout|timed out|failed to fetch|temporarily unavailable|rate limit|too many requests|429|500|502|503|504|网络|超时|暂时不可用|请求太频繁|无法连接/i.test(
    message,
  )
}

export function generationRetryDelayMs(retryIndex: number): number {
  return (
    GENERATION_RETRY_DELAYS_MS[retryIndex] ??
    GENERATION_RETRY_DELAYS_MS[GENERATION_RETRY_DELAYS_MS.length - 1]
  )
}

export const REDACTED_SECRET = '[redacted]'
export const REDACTED_URL = '[redacted-url]'
export const REDACTED_PATH = '[redacted-path]'

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, REDACTED_URL)
    .replace(
      /(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})/g,
      REDACTED_SECRET,
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(
      /\b(authorization|x-api-key|api[_-]?key)\s*[:=]\s*["']?[^"',\s;}]+/gi,
      '$1: ' + REDACTED_SECRET,
    )
    .replace(
      /(\\\\[^\\/\s"']+[\\/]|[a-z]:[\\/]|\/(home|users|tmp)\/)[^\s"']+/gi,
      REDACTED_PATH,
    )
    .replace(
      /(["'])([^"']*)\[redacted-path\][^"']*\1/g,
      '$2' + REDACTED_PATH,
    )
}

export function noticeToneFor(message: string): NoticeTone {
  const text = message.trim()

  if (!text) {
    return 'success'
  }

  const normalized = text.toLowerCase()

  if (NOTICE_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'error'
  }

  if (NOTICE_WARNING_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return 'warning'
  }

  return 'success'
}
