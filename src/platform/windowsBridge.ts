export const WINDOWS_WEBVIEW_ORIGIN = 'https://appassets.zerochat.local'
export const WINDOWS_SECRET_REQUEST_KIND = 'zerochat.secret.request.v1'
export const WINDOWS_SECRET_RESPONSE_KIND = 'zerochat.secret.response.v1'
export const WINDOWS_SECRET_BRIDGE_TIMEOUT_MS = 5000
export const WINDOWS_SECRET_MAX_ITEMS = 256
export const WINDOWS_SECRET_MAX_VALUE_BYTES = 16 * 1024
export const WINDOWS_SECRET_MAX_JSON_BYTES = 1024 * 1024

export type WindowsSecretMigrationState =
  | 'pending'
  | 'locker-written'
  | 'complete'

export type WindowsSecretClearScope = 'none' | 'provider' | 'all'

export type WindowsSecretBridgeErrorCode =
  | 'bridge-unavailable'
  | 'conflict'
  | 'internal-failure'
  | 'invalid-request'
  | 'invalid-response'
  | 'size-limit'
  | 'storage-failure'
  | 'timeout'

export interface WindowsSecretEntry {
  name: string
  value: string
}

export interface WindowsSecretChange {
  name: string
  value: string | null
}

export interface WindowsSecretProbeResult {
  migrationState: WindowsSecretMigrationState
  revision: string | null
}

export interface WindowsSecretReadResult extends WindowsSecretProbeResult {
  entries: WindowsSecretEntry[]
}

interface WindowsWebViewMessageEvent {
  data: unknown
}

interface WindowsWebViewBridge {
  addEventListener(
    type: 'message',
    listener: (event: WindowsWebViewMessageEvent) => void,
  ): void
  postMessage(payload: unknown): void
  removeEventListener(
    type: 'message',
    listener: (event: WindowsWebViewMessageEvent) => void,
  ): void
}

interface WindowsBridgeRuntime {
  chrome?: {
    webview?: WindowsWebViewBridge
  }
  location?: {
    origin?: string
  }
  setTimeout(handler: () => void, timeout: number): number
  clearTimeout(handle: number): void
}

interface WindowsBridgeCallOptions {
  createRequestId?: () => string
  runtime?: WindowsBridgeRuntime
  timeoutMs?: number
}

interface WindowsSecretProbeRequest {
  id: string
  kind: typeof WINDOWS_SECRET_REQUEST_KIND
  op: 'probe'
}

interface WindowsSecretReadRequest {
  id: string
  kind: typeof WINDOWS_SECRET_REQUEST_KIND
  names: string[]
  op: 'read'
}

interface WindowsSecretMutateRequest {
  changes: WindowsSecretChange[]
  clearScope: WindowsSecretClearScope
  expectedRevision: string | null
  id: string
  kind: typeof WINDOWS_SECRET_REQUEST_KIND
  migrationState: WindowsSecretMigrationState | null
  op: 'mutate'
}

type WindowsSecretRequest =
  | WindowsSecretProbeRequest
  | WindowsSecretReadRequest
  | WindowsSecretMutateRequest

type WindowsSecretMetadataSuccessResponse<TOp extends 'probe' | 'mutate'> = {
  id: string
  kind: typeof WINDOWS_SECRET_RESPONSE_KIND
  migrationState: WindowsSecretMigrationState
  ok: true
  op: TOp
  revision: string | null
}

type WindowsSecretSuccessResponse =
  | WindowsSecretMetadataSuccessResponse<'probe'>
  | WindowsSecretMetadataSuccessResponse<'mutate'>
  | {
      entries: WindowsSecretEntry[]
      id: string
      kind: typeof WINDOWS_SECRET_RESPONSE_KIND
      migrationState: WindowsSecretMigrationState
      ok: true
      op: 'read'
      revision: string | null
    }

const bridgeErrorCodes = new Set<WindowsSecretBridgeErrorCode>([
  'conflict',
  'internal-failure',
  'invalid-request',
  'size-limit',
  'storage-failure',
])
const migrationStates = new Set<WindowsSecretMigrationState>([
  'pending',
  'locker-written',
  'complete',
])
const clearScopes = new Set<WindowsSecretClearScope>([
  'none',
  'provider',
  'all',
])
const requestIdPattern = /^[A-Za-z0-9-]{1,64}$/

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
  })
}

export class WindowsSecretBridgeError extends Error {
  readonly code: WindowsSecretBridgeErrorCode

  constructor(code: WindowsSecretBridgeErrorCode) {
    super('Windows secret bridge failed.')
    this.name = 'WindowsSecretBridgeError'
    this.code = code
  }
}

function defaultRuntime(): WindowsBridgeRuntime | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as unknown as WindowsBridgeRuntime)
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()

  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  )
}

function isRevision(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && requestIdPattern.test(value))
  )
}

function isMigrationState(
  value: unknown,
): value is WindowsSecretMigrationState {
  return (
    typeof value === 'string' &&
    migrationStates.has(value as WindowsSecretMigrationState)
  )
}

export function isValidWindowsSecretName(name: string): boolean {
  if (
    name === 'github-token' ||
    name === 'sync-passphrase'
  ) {
    return true
  }

  const separator = name.indexOf(':')
  if (separator < 0) {
    return false
  }

  const kind = name.slice(0, separator)
  const providerId = name.slice(separator + 1)

  return (
    (kind === 'provider' || kind === 'proxy') &&
    providerId.length > 0 &&
    providerId.length <= 256 &&
    !containsControlCharacter(providerId)
  )
}

function validateSecretValue(value: string): void {
  if (utf8Size(value) > WINDOWS_SECRET_MAX_VALUE_BYTES) {
    throw new WindowsSecretBridgeError('size-limit')
  }
}

function validateUniqueNames(names: string[]): void {
  if (names.length > WINDOWS_SECRET_MAX_ITEMS) {
    throw new WindowsSecretBridgeError('size-limit')
  }

  const unique = new Set<string>()

  for (const name of names) {
    if (!isValidWindowsSecretName(name) || unique.has(name)) {
      throw new WindowsSecretBridgeError('invalid-request')
    }
    unique.add(name)
  }
}

function validateRequest(request: WindowsSecretRequest): void {
  if (!requestIdPattern.test(request.id)) {
    throw new WindowsSecretBridgeError('invalid-request')
  }

  if (request.op === 'read') {
    validateUniqueNames(request.names)
  }

  if (request.op === 'mutate') {
    if (!clearScopes.has(request.clearScope)) {
      throw new WindowsSecretBridgeError('invalid-request')
    }
    if (!isRevision(request.expectedRevision)) {
      throw new WindowsSecretBridgeError('invalid-request')
    }
    if (
      request.migrationState !== null &&
      !isMigrationState(request.migrationState)
    ) {
      throw new WindowsSecretBridgeError('invalid-request')
    }

    validateUniqueNames(request.changes.map(({ name }) => name))
    for (const change of request.changes) {
      if (change.value !== null) {
        validateSecretValue(change.value)
      }
    }
  }

  if (utf8Size(JSON.stringify(request)) > WINDOWS_SECRET_MAX_JSON_BYTES) {
    throw new WindowsSecretBridgeError('size-limit')
  }
}

function parseEntries(value: unknown): WindowsSecretEntry[] {
  if (!Array.isArray(value) || value.length > WINDOWS_SECRET_MAX_ITEMS) {
    throw new WindowsSecretBridgeError('invalid-response')
  }

  const entries: WindowsSecretEntry[] = []
  const names = new Set<string>()

  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['name', 'value']) ||
      typeof item.name !== 'string' ||
      typeof item.value !== 'string' ||
      !isValidWindowsSecretName(item.name) ||
      names.has(item.name)
    ) {
      throw new WindowsSecretBridgeError('invalid-response')
    }

    validateSecretValue(item.value)
    names.add(item.name)
    entries.push({ name: item.name, value: item.value })
  }

  return entries
}

function parseResponse(
  value: unknown,
  expectedId: string,
  expectedOp: WindowsSecretRequest['op'],
): WindowsSecretSuccessResponse | null {
  if (!isRecord(value)) {
    throw new WindowsSecretBridgeError('invalid-response')
  }

  if (value.id !== expectedId) {
    return null
  }

  if (utf8Size(JSON.stringify(value)) > WINDOWS_SECRET_MAX_JSON_BYTES) {
    throw new WindowsSecretBridgeError('size-limit')
  }

  if (value.kind !== WINDOWS_SECRET_RESPONSE_KIND || value.ok === false) {
    if (
      value.kind === WINDOWS_SECRET_RESPONSE_KIND &&
      value.ok === false &&
      hasExactKeys(value, ['kind', 'id', 'ok', 'code']) &&
      typeof value.code === 'string' &&
      bridgeErrorCodes.has(value.code as WindowsSecretBridgeErrorCode)
    ) {
      throw new WindowsSecretBridgeError(
        value.code as WindowsSecretBridgeErrorCode,
      )
    }

    throw new WindowsSecretBridgeError('invalid-response')
  }

  const expectedKeys = expectedOp === 'read'
    ? ['kind', 'id', 'ok', 'op', 'revision', 'migrationState', 'entries']
    : ['kind', 'id', 'ok', 'op', 'revision', 'migrationState']

  if (
    value.ok !== true ||
    value.op !== expectedOp ||
    !hasExactKeys(value, expectedKeys) ||
    !isRevision(value.revision) ||
    !isMigrationState(value.migrationState)
  ) {
    throw new WindowsSecretBridgeError('invalid-response')
  }

  if (expectedOp === 'read') {
    return {
      entries: parseEntries(value.entries),
      id: expectedId,
      kind: WINDOWS_SECRET_RESPONSE_KIND,
      migrationState: value.migrationState,
      ok: true,
      op: 'read',
      revision: value.revision,
    }
  }

  return {
    id: expectedId,
    kind: WINDOWS_SECRET_RESPONSE_KIND,
    migrationState: value.migrationState,
    ok: true,
    op: expectedOp,
    revision: value.revision,
  }
}

function createRequestId(): string {
  return crypto.randomUUID()
}

function callWindowsSecretBridge<T extends WindowsSecretSuccessResponse>(
  createRequest: (id: string) => WindowsSecretRequest,
  options: WindowsBridgeCallOptions = {},
): Promise<T> {
  const runtime = options.runtime ?? defaultRuntime()
  const bridge = runtime?.chrome?.webview

  if (!runtime || !bridge || !isWindowsWebViewOrigin(runtime.location?.origin)) {
    return Promise.reject(new WindowsSecretBridgeError('bridge-unavailable'))
  }

  let request: WindowsSecretRequest
  try {
    request = createRequest((options.createRequestId ?? createRequestId)())
    validateRequest(request)
  } catch (error: unknown) {
    return Promise.reject(
      error instanceof WindowsSecretBridgeError
        ? error
        : new WindowsSecretBridgeError('invalid-request'),
    )
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timeoutHandle: number | undefined
    let listenerInstalled = false

    const cleanup = () => {
      const handle = timeoutHandle
      timeoutHandle = undefined
      if (handle !== undefined) {
        try {
          runtime.clearTimeout(handle)
        } catch {
          // The request result still owns settlement when timer cleanup fails.
        }
      }

      if (listenerInstalled) {
        listenerInstalled = false
        try {
          bridge.removeEventListener('message', onMessage)
        } catch {
          // The request is already settled; listener cleanup cannot change it.
        }
      }
    }

    const finish = (result: () => void) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      result()
    }
    const onMessage = (event: WindowsWebViewMessageEvent) => {
      try {
        const response = parseResponse(event.data, request.id, request.op)
        if (!response) {
          return
        }
        finish(() => resolve(response as T))
      } catch (error: unknown) {
        finish(() => reject(
          error instanceof WindowsSecretBridgeError
            ? error
            : new WindowsSecretBridgeError('invalid-response'),
        ))
      }
    }

    try {
      timeoutHandle = runtime.setTimeout(() => {
        finish(() => reject(new WindowsSecretBridgeError('timeout')))
      }, options.timeoutMs ?? WINDOWS_SECRET_BRIDGE_TIMEOUT_MS)
    } catch {
      finish(() => reject(new WindowsSecretBridgeError('bridge-unavailable')))
      return
    }

    if (settled) {
      // A synchronous host timer can settle before returning its handle.
      cleanup()
      return
    }

    try {
      listenerInstalled = true
      bridge.addEventListener('message', onMessage)
      if (settled) {
        return
      }
      bridge.postMessage(request)
    } catch {
      finish(() => reject(new WindowsSecretBridgeError('bridge-unavailable')))
    }
  })
}

export function isWindowsWebViewOrigin(
  origin = defaultRuntime()?.location?.origin,
): boolean {
  return origin === WINDOWS_WEBVIEW_ORIGIN
}

export async function probeWindowsSecretBridge(
  options?: WindowsBridgeCallOptions,
): Promise<WindowsSecretProbeResult> {
  const response = await callWindowsSecretBridge<
    Extract<WindowsSecretSuccessResponse, { op: 'probe' }>
  >(
    (id) => ({
      id,
      kind: WINDOWS_SECRET_REQUEST_KIND,
      op: 'probe',
    }),
    options,
  )

  return {
    migrationState: response.migrationState,
    revision: response.revision,
  }
}

export async function readWindowsSecrets(
  names: string[],
  options?: WindowsBridgeCallOptions,
): Promise<WindowsSecretReadResult> {
  const response = await callWindowsSecretBridge<
    Extract<WindowsSecretSuccessResponse, { op: 'read' }>
  >(
    (id) => ({
      id,
      kind: WINDOWS_SECRET_REQUEST_KIND,
      names,
      op: 'read',
    }),
    options,
  )

  return {
    entries: response.entries,
    migrationState: response.migrationState,
    revision: response.revision,
  }
}

export async function mutateWindowsSecrets(
  request: Omit<WindowsSecretMutateRequest, 'id' | 'kind' | 'op'>,
  options?: WindowsBridgeCallOptions,
): Promise<WindowsSecretProbeResult> {
  const response = await callWindowsSecretBridge<
    Extract<WindowsSecretSuccessResponse, { op: 'mutate' }>
  >(
    (id) => ({
      ...request,
      id,
      kind: WINDOWS_SECRET_REQUEST_KIND,
      op: 'mutate',
    }),
    options,
  )

  return {
    migrationState: response.migrationState,
    revision: response.revision,
  }
}
