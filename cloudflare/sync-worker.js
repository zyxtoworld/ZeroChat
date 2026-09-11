const SNAPSHOT_KEY = 'snapshot'
const INCREMENTAL_HEAD_KEY = 'incremental-head'
const AUTO_ALLOWED_ORIGINS_KEY = 'auto-allowed-origins'
const AUTO_ALLOWED_HOSTS_KEY = 'auto-allowed-hosts'
const MAX_SNAPSHOT_BYTES = 900000
const MAX_INCREMENTAL_OBJECT_BYTES = 5000000
const MAX_INCREMENTAL_HEAD_BYTES = 16384
const DEFAULT_MAX_PROXY_CONTENT_LENGTH = 24000000
const DEFAULT_MAX_AUTO_ALLOWED_ORIGINS = 8
const SETUP_ACCESS_KEY_ERROR =
  'Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing'
const KV_BINDING_ERROR = 'KV binding zerochat_kv is required'
const SYNC_COORDINATOR_BINDING_ERROR =
  'Durable Object binding ZEROCHAT_SYNC_COORDINATOR is required'
const SYNC_COORDINATOR_NAME = 'zerochat-sync-coordinator-v1'
const SYNC_STORAGE_MIGRATION_KEY = 'sync-kv-migrated-v1'
const SYNC_GENERATION_KEY = 'sync-generation-v1'
const SYNC_GENERATION_HEADER = 'x-zerochat-sync-generation'
const ACCESS_KEY_PLACEHOLDERS = new Set([
  'replace-with-zerochat-derived-access-key',
])
const VAULT_KDF_ITERATIONS = 600000
const VAULT_CIPHER = 'AES-256-GCM'
const VAULT_KDF = 'PBKDF2-SHA256'
const OBJECT_KEY_PATTERN = /^(manifest|chunk|skill|attachment)-[0-9a-f-]+\.json$/i
const DEFAULT_ALLOWED_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.deepseek.com',
  'api.x.ai',
  'openrouter.ai',
  'api.mistral.ai',
  'api.groq.com',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.cerebras.ai',
  'integrate.api.nvidia.com',
  'api.deepinfra.com',
  'api.novita.ai',
  'api.siliconflow.cn',
  'api-inference.modelscope.cn',
  'dashscope.aliyuncs.com',
  'api.moonshot.cn',
  'open.bigmodel.cn',
  'qianfan.baidubce.com',
  'api.hunyuan.cloud.tencent.com',
  'api.minimax.io',
  'ark.cn-beijing.volces.com',
  'gateway.ai.cloudflare.com',
]
const PROXY_ACTION_PATHS = {
  'image-generations': '/images/generations',
  'image-edits': '/images/edits',
  'image-responses': '/responses',
  'audio-speech': '/audio/speech',
  'audio-transcriptions': '/audio/transcriptions',
  embeddings: '/embeddings',
  moderations: '/moderations',
  realtime: '/realtime',
  'realtime-client-secrets': '/realtime/client_secrets',
}
const KNOWN_UPSTREAM_PATHS = [
  '/chat/completions',
  '/responses',
  '/messages',
  '/models',
  ...Object.values(PROXY_ACTION_PATHS),
]

const textEncoder = new TextEncoder()

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const cors = await resolveCorsContext(request, env)
    const corsHeaders = buildCorsHeaders(cors)

    if (request.method === 'OPTIONS') {
      if (!cors.canPreflight) {
        return new Response('Origin not allowed', {
          status: 403,
          headers: corsHeaders,
        })
      }

      return new Response(null, { headers: corsHeaders })
    }

    if (routeRequiresAccessKey(url.pathname) && !configuredAccessKey(env)) {
      return new Response(SETUP_ACCESS_KEY_ERROR, {
        status: 501,
        headers: corsHeaders,
      })
    }

    if (
      !cors.allowed &&
      !(
        cors.canEnroll &&
        hasValidRouteToken(request, env, url.pathname)
      )
    ) {
      return new Response('Origin not allowed', {
        status: 403,
        headers: corsHeaders,
      })
    }

    if (cors.canEnroll) {
      await rememberAllowedOrigin(env, cors.origin)
    }

    if (url.pathname === '/proxy/hosts') {
      return handleProxyHosts(request, env, corsHeaders)
    }

    if (url.pathname === '/proxy') {
      return proxyAiRequest(request, env, corsHeaders)
    }

    if (url.pathname === '/sync/clear') {
      return handleSyncClear(request, env, corsHeaders)
    }

    if (url.pathname === '/sync/head') {
      return handleIncrementalHead(request, env, corsHeaders)
    }

    if (url.pathname.startsWith('/sync/object/')) {
      return handleIncrementalObject(request, env, corsHeaders, url)
    }

    if (url.pathname !== '/snapshot') {
      return serveStaticAsset(request, env, corsHeaders)
    }

    if (!hasValidBearerAccessKey(request, env)) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    if (!env.zerochat_kv) {
      return new Response(KV_BINDING_ERROR, {
        status: 501,
        headers: corsHeaders,
      })
    }

    if (request.method === 'GET') {
      const coordinator = incrementalCoordinatorStub(env)
      if (!coordinator) {
        return new Response(SYNC_COORDINATOR_BINDING_ERROR, {
          status: 501,
          headers: corsHeaders,
        })
      }
      return withCors(await coordinator.fetch(request), corsHeaders)
    }

    if (request.method === 'PUT') {
      return putSnapshot(request, env, corsHeaders)
    }

    if (request.method === 'DELETE') {
      const coordinator = incrementalCoordinatorStub(env)
      if (!coordinator) {
        return new Response(SYNC_COORDINATOR_BINDING_ERROR, {
          status: 501,
          headers: corsHeaders,
        })
      }
      return withCors(await coordinator.fetch(request), corsHeaders)
    }

    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  },
}

export class ZeroChatSyncCoordinator {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.operationTail = Promise.resolve()
    this.migration = this.initializeStorage()
    state.blockConcurrencyWhile?.(() => this.migration)
  }

  fetch(request) {
    const operation = this.operationTail.then(async () => {
      await this.migration
      return this.handleRequest(request)
    })
    this.operationTail = operation.catch(() => undefined)
    return operation
  }

  async initializeStorage() {
    const generation = await this.state.storage.get(SYNC_GENERATION_KEY)
    if (generation === undefined) {
      await this.state.storage.put(SYNC_GENERATION_KEY, crypto.randomUUID())
    } else if (!isSyncGeneration(generation)) {
      throw new Error('Stored sync generation is invalid')
    }

    const migrated = await this.state.storage.get(SYNC_STORAGE_MIGRATION_KEY)
    if (migrated === true) {
      return
    }

    const existing = await this.state.storage.get(INCREMENTAL_HEAD_KEY)
    if (existing === undefined && this.env.zerochat_kv) {
      const legacyText = await this.env.zerochat_kv.get(INCREMENTAL_HEAD_KEY)
      if (legacyText) {
        const legacyHead = JSON.parse(legacyText)
        const validation = validateIncrementalHead(legacyHead)
        if (!validation.ok) {
          throw new Error('Stored incremental head is invalid')
        }
        await this.state.storage.put(INCREMENTAL_HEAD_KEY, legacyHead)
      }
    }

    const existingSnapshot = await this.state.storage.get(SNAPSHOT_KEY)
    if (existingSnapshot === undefined && this.env.zerochat_kv) {
      const legacySnapshot = await this.env.zerochat_kv.get(SNAPSHOT_KEY)
      if (legacySnapshot) {
        const parsed = JSON.parse(legacySnapshot)
        const validation = validateEncryptedEnvelope(parsed)
        if (!validation.ok) {
          throw new Error('Stored snapshot is invalid')
        }
        await this.state.storage.put(SNAPSHOT_KEY, {
          body: legacySnapshot,
          etag: await encryptedSnapshotEtag(legacySnapshot),
        })
      }
    }

    await this.state.storage.put(SYNC_STORAGE_MIGRATION_KEY, true)
  }

  async handleRequest(request) {
    const pathname = new URL(request.url).pathname
    if (pathname === '/sync/clear' && request.method === 'DELETE') {
      return this.clearSyncData()
    }

    if (pathname.startsWith('/sync/object/')) {
      return this.handleObjectMutation(request, pathname)
    }

    if (pathname === '/snapshot') {
      return this.handleSnapshotRequest(request)
    }

    if (pathname !== '/sync/head') {
      return new Response('Not found', { status: 404 })
    }

    if (request.method === 'GET') {
      const head = await this.state.storage.get(INCREMENTAL_HEAD_KEY)
      const generation = await this.currentGeneration()
      return new Response(head === undefined ? '' : JSON.stringify(head), {
        status: head === undefined ? 404 : 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          [SYNC_GENERATION_HEADER]: generation,
          ...(head === undefined ? {} : { etag: quotedHeadEtag(head.manifestKey) }),
        },
      })
    }

    if (request.method === 'PUT') {
      return this.putHead(request)
    }

    if (request.method === 'DELETE') {
      const generationFailure = await this.generationFailure(request)
      if (generationFailure) {
        return generationFailure
      }
      await this.state.storage.delete(INCREMENTAL_HEAD_KEY)
      await this.env.zerochat_kv?.delete(INCREMENTAL_HEAD_KEY)
      return new Response('OK')
    }

    return new Response('Method not allowed', { status: 405 })
  }

  async handleSnapshotRequest(request) {
    if (request.method === 'GET') {
      const snapshot = await this.state.storage.get(SNAPSHOT_KEY)
      const generation = await this.currentGeneration()
      if (snapshot === undefined) {
        return new Response('', {
          status: 404,
          headers: { [SYNC_GENERATION_HEADER]: generation },
        })
      }
      if (!validStoredSnapshot(snapshot)) {
        return new Response('Stored snapshot is invalid', { status: 500 })
      }
      return new Response(snapshot.body, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          etag: snapshot.etag,
          [SYNC_GENERATION_HEADER]: generation,
        },
      })
    }

    if (request.method === 'PUT') {
      return this.putSnapshot(request)
    }

    if (request.method === 'DELETE') {
      const generationFailure = await this.generationFailure(request)
      if (generationFailure) {
        return generationFailure
      }
      await this.state.storage.delete(SNAPSHOT_KEY)
      await this.env.zerochat_kv?.delete(SNAPSHOT_KEY)
      return new Response('OK')
    }

    return new Response('Method not allowed', { status: 405 })
  }

  async putSnapshot(request) {
    const body = await request.text()
    if (textEncoder.encode(body).byteLength > MAX_SNAPSHOT_BYTES) {
      return new Response('Snapshot too large', { status: 413 })
    }

    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }
    const validation = validateEncryptedEnvelope(parsed)
    if (!validation.ok) {
      return new Response(validation.message, { status: 400 })
    }

    const ifMatch = request.headers.get('if-match')
    const ifNoneMatch = request.headers.get('if-none-match')
    if ((ifMatch === null) === (ifNoneMatch === null)) {
      return new Response('Exactly one snapshot precondition is required', { status: 428 })
    }

    const next = {
      body,
      etag: await encryptedSnapshotEtag(body),
    }
    const outcome = await this.state.storage.transaction(async (transaction) => {
      const generationFailure = await this.transactionGenerationFailure(
        request,
        transaction,
      )
      if (generationFailure) {
        return generationFailure
      }
      const current = await transaction.get(SNAPSHOT_KEY)
      if (current !== undefined && !validStoredSnapshot(current)) {
        return { status: 500, message: 'Stored snapshot is invalid' }
      }
      if (current?.body === next.body) {
        return { status: 200, idempotent: true }
      }
      if (current === undefined) {
        if (ifNoneMatch !== '*') {
          return { status: 409, message: 'Snapshot changed' }
        }
      } else if (ifMatch !== current.etag) {
        return { status: 409, message: 'Snapshot changed' }
      }

      if (current !== undefined) {
        const currentEnvelope = JSON.parse(current.body)
        const currentValidation = validateEncryptedEnvelope(currentEnvelope)
        if (!currentValidation.ok) {
          return { status: 500, message: 'Stored snapshot is invalid' }
        }
        if (parsed.updatedAt < currentEnvelope.updatedAt) {
          return { status: 409, message: 'Refusing to move snapshot backwards' }
        }
      }

      await transaction.put(SNAPSHOT_KEY, next)
      return { status: 200, idempotent: false }
    })

    return new Response(outcome.message ?? 'OK', {
      status: outcome.status,
      headers:
        outcome.status === 200
          ? {
              etag: next.etag,
              'x-zerochat-idempotent': outcome.idempotent ? 'true' : 'false',
            }
          : undefined,
    })
  }

  async putHead(request) {
    const head = await request.json()
    const validation = validateIncrementalHead(head)
    if (!validation.ok) {
      return new Response(validation.message, { status: 400 })
    }

    const ifMatch = request.headers.get('if-match')
    const ifNoneMatch = request.headers.get('if-none-match')
    if ((ifMatch === null) === (ifNoneMatch === null)) {
      return new Response('Exactly one head precondition is required', { status: 428 })
    }

    const outcome = await this.state.storage.transaction(async (transaction) => {
      const generationFailure = await this.transactionGenerationFailure(
        request,
        transaction,
      )
      if (generationFailure) {
        return generationFailure
      }
      const current = await transaction.get(INCREMENTAL_HEAD_KEY)
      if (current !== undefined) {
        const currentValidation = validateIncrementalHead(current)
        if (!currentValidation.ok) {
          return { status: 500, message: 'Stored incremental head is invalid' }
        }
        if (current.manifestKey === head.manifestKey) {
          return JSON.stringify(current) === JSON.stringify(head)
            ? { status: 200, idempotent: true }
            : { status: 409, message: 'Manifest key already identifies another head' }
        }
      }

      if (current === undefined) {
        if (ifNoneMatch !== '*') {
          return { status: 409, message: 'Incremental head changed' }
        }
      } else if (ifMatch !== quotedHeadEtag(current.manifestKey)) {
        return { status: 409, message: 'Incremental head changed' }
      }

      if (current !== undefined && head.updatedAt < current.updatedAt) {
        return { status: 409, message: 'Refusing to move head backwards' }
      }

      await transaction.put(INCREMENTAL_HEAD_KEY, head)
      return { status: 200, idempotent: false }
    })

    return new Response(outcome.message ?? 'OK', {
      status: outcome.status,
      headers:
        outcome.status === 200
          ? {
              etag: quotedHeadEtag(head.manifestKey),
              'x-zerochat-idempotent': outcome.idempotent ? 'true' : 'false',
            }
          : undefined,
    })
  }

  async currentGeneration(storage = this.state.storage) {
    const generation = await storage.get(SYNC_GENERATION_KEY)
    if (!isSyncGeneration(generation)) {
      throw new Error('Stored sync generation is invalid')
    }
    return generation
  }

  requestedGeneration(request) {
    const generation = request.headers.get(SYNC_GENERATION_HEADER)
    if (generation === null) {
      return {
        error: { status: 428, message: 'Sync generation is required' },
      }
    }
    if (!isSyncGeneration(generation)) {
      return {
        error: { status: 400, message: 'Sync generation is invalid' },
      }
    }
    return { generation }
  }

  async generationFailure(request) {
    const requested = this.requestedGeneration(request)
    if (requested.error) {
      return new Response(requested.error.message, {
        status: requested.error.status,
      })
    }
    return requested.generation === (await this.currentGeneration())
      ? null
      : new Response('Sync generation changed', { status: 412 })
  }

  async transactionGenerationFailure(request, transaction) {
    const requested = this.requestedGeneration(request)
    if (requested.error) {
      return requested.error
    }
    return requested.generation === (await this.currentGeneration(transaction))
      ? null
      : { status: 412, message: 'Sync generation changed' }
  }

  async clearSyncData() {
    const generation = crypto.randomUUID()
    await this.state.storage.transaction(async (transaction) => {
      await transaction.put(SYNC_GENERATION_KEY, generation)
      await transaction.delete(INCREMENTAL_HEAD_KEY)
      await transaction.delete(SNAPSHOT_KEY)
    })
    await Promise.all([
      this.env.zerochat_kv?.delete(INCREMENTAL_HEAD_KEY),
      this.env.zerochat_kv?.delete(SNAPSHOT_KEY),
    ])
    const deletedObjects = this.env.zerochat_r2
      ? await deleteAllIncrementalObjects(this.env.zerochat_r2)
      : 0
    return Response.json({ ok: true, deletedObjects }, {
      headers: { [SYNC_GENERATION_HEADER]: generation },
    })
  }

  async handleObjectMutation(request, pathname) {
    if (!this.env.zerochat_r2) {
      return new Response('R2 binding zerochat_r2 is required', { status: 501 })
    }

    let key
    try {
      key = decodeURIComponent(pathname.slice('/sync/object/'.length))
    } catch {
      return new Response('Invalid object key', { status: 400 })
    }
    if (!isSafeObjectKey(key)) {
      return new Response('Invalid object key', { status: 400 })
    }

    const generationFailure = await this.generationFailure(request)
    if (generationFailure) {
      return generationFailure
    }

    if (request.method === 'PUT') {
      const text = await request.text()
      if (textEncoder.encode(text).byteLength > MAX_INCREMENTAL_OBJECT_BYTES) {
        return new Response('Object too large', { status: 413 })
      }
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        return new Response('Invalid JSON', { status: 400 })
      }
      const validation = validateEncryptedObjectEnvelope(parsed)
      if (!validation.ok) {
        return new Response(validation.message, { status: 400 })
      }
      await this.env.zerochat_r2.put(key, text, {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      })
      return new Response('OK')
    }

    if (request.method === 'DELETE') {
      await this.env.zerochat_r2.delete(key)
      return new Response('OK')
    }

    return new Response('Method not allowed', { status: 405 })
  }
}

function quotedHeadEtag(manifestKey) {
  return `"${manifestKey}"`
}

function isSyncGeneration(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  )
}

function validStoredSnapshot(snapshot) {
  return (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    typeof snapshot.body === 'string' &&
    /^"snapshot-sha256-[0-9a-f]{64}"$/iu.test(snapshot.etag)
  )
}

async function encryptedSnapshotEtag(body) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(body))
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `"snapshot-sha256-${hex}"`
}

function incrementalCoordinatorStub(env) {
  const binding = env.ZEROCHAT_SYNC_COORDINATOR
  if (!binding?.idFromName || !binding?.get) {
    return null
  }
  return binding.get(binding.idFromName(SYNC_COORDINATOR_NAME))
}

async function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function serveStaticAsset(request, env, corsHeaders) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Not found', { status: 404, headers: corsHeaders })
  }

  if (typeof env?.ASSETS?.fetch !== 'function') {
    return new Response('Not found', { status: 404, headers: corsHeaders })
  }

  return env.ASSETS.fetch(request)
}

async function putSnapshot(request, env, corsHeaders) {
  if (contentLength(request) > MAX_SNAPSHOT_BYTES) {
    return new Response('Snapshot too large', {
      status: 413,
      headers: corsHeaders,
    })
  }

  const snapshot = await request.text()

  if (textEncoder.encode(snapshot).byteLength > MAX_SNAPSHOT_BYTES) {
    return new Response('Snapshot too large', {
      status: 413,
      headers: corsHeaders,
    })
  }

  let parsed

  try {
    parsed = JSON.parse(snapshot)
  } catch {
    return new Response('Invalid JSON', {
      status: 400,
      headers: corsHeaders,
    })
  }

  const validation = validateEncryptedEnvelope(parsed)

  if (!validation.ok) {
    return new Response(validation.message, {
      status: 400,
      headers: corsHeaders,
    })
  }

  const coordinator = incrementalCoordinatorStub(env)
  if (!coordinator) {
    return new Response(SYNC_COORDINATOR_BINDING_ERROR, {
      status: 501,
      headers: corsHeaders,
    })
  }
  const forwarded = new Request(request.url, {
    method: 'PUT',
    headers: request.headers,
    body: snapshot,
  })
  return withCors(await coordinator.fetch(forwarded), corsHeaders)
}

async function handleIncrementalHead(request, env, corsHeaders) {
  if (!hasValidBearerAccessKey(request, env)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  if (!env.zerochat_kv) {
    return new Response(KV_BINDING_ERROR, {
      status: 501,
      headers: corsHeaders,
    })
  }

  if (!env.zerochat_r2) {
    return new Response('R2 binding zerochat_r2 is required', {
      status: 501,
      headers: corsHeaders,
    })
  }

  const coordinator = incrementalCoordinatorStub(env)
  if (!coordinator) {
    return new Response(SYNC_COORDINATOR_BINDING_ERROR, {
      status: 501,
      headers: corsHeaders,
    })
  }

  if (request.method === 'GET') {
    return withCors(await coordinator.fetch(request), corsHeaders)
  }

  if (request.method === 'PUT') {
    if (contentLength(request) > MAX_INCREMENTAL_HEAD_BYTES) {
      return new Response('Incremental head too large', {
        status: 413,
        headers: corsHeaders,
      })
    }

    const text = await request.text()

    if (textEncoder.encode(text).byteLength > MAX_INCREMENTAL_HEAD_BYTES) {
      return new Response('Incremental head too large', {
        status: 413,
        headers: corsHeaders,
      })
    }

    let head

    try {
      head = JSON.parse(text)
    } catch {
      return new Response('Invalid JSON', {
        status: 400,
        headers: corsHeaders,
      })
    }

    const validation = validateIncrementalHead(head)

    if (!validation.ok) {
      return new Response(validation.message, {
        status: 400,
        headers: corsHeaders,
      })
    }

    const forwarded = new Request(request.url, {
      method: 'PUT',
      headers: request.headers,
      body: JSON.stringify(head),
    })
    return withCors(await coordinator.fetch(forwarded), corsHeaders)
  }

  if (request.method === 'DELETE') {
    return withCors(await coordinator.fetch(request), corsHeaders)
  }

  return new Response('Method not allowed', {
    status: 405,
    headers: corsHeaders,
  })
}

async function handleSyncClear(request, env, corsHeaders) {
  if (!hasValidBearerAccessKey(request, env)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  if (request.method !== 'DELETE') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  }

  if (!env.zerochat_kv) {
    return new Response(KV_BINDING_ERROR, {
      status: 501,
      headers: corsHeaders,
    })
  }

  const coordinator = incrementalCoordinatorStub(env)
  if (!coordinator) {
    return new Response(SYNC_COORDINATOR_BINDING_ERROR, {
      status: 501,
      headers: corsHeaders,
    })
  }

  return withCors(await coordinator.fetch(request), corsHeaders)
}

async function deleteAllIncrementalObjects(bucket) {
  let deleted = 0
  let cursor

  while (true) {
    const listed = await bucket.list({ cursor, limit: 1000 })
    const keys = listed.objects
      .map((object) => object.key)
      .filter((key) => isSafeObjectKey(key))

    await Promise.all(keys.map((key) => bucket.delete(key)))
    deleted += keys.length
    if (keys.length > 0) {
      cursor = undefined
      continue
    }
    if (!listed.truncated) {
      break
    }
    cursor = listed.cursor
  }

  return deleted
}

async function handleIncrementalObject(request, env, corsHeaders, url) {
  if (!hasValidBearerAccessKey(request, env)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  if (!env.zerochat_r2) {
    return new Response('R2 binding zerochat_r2 is required', {
      status: 501,
      headers: corsHeaders,
    })
  }

  let key

  try {
    key = decodeURIComponent(url.pathname.slice('/sync/object/'.length))
  } catch {
    return new Response('Invalid object key', {
      status: 400,
      headers: corsHeaders,
    })
  }

  if (!isSafeObjectKey(key)) {
    return new Response('Invalid object key', {
      status: 400,
      headers: corsHeaders,
    })
  }

  if (request.method === 'GET') {
    const object = await env.zerochat_r2.get(key)

    if (!object) {
      return new Response('Not found', { status: 404, headers: corsHeaders })
    }

    return new Response(object.body, {
      headers: {
        ...corsHeaders,
        'content-type':
          object.httpMetadata?.contentType ||
          'application/json; charset=utf-8',
      },
    })
  }

  if (request.method === 'PUT') {
    if (contentLength(request) > MAX_INCREMENTAL_OBJECT_BYTES) {
      return new Response('Object too large', {
        status: 413,
        headers: corsHeaders,
      })
    }

    const text = await request.text()

    if (textEncoder.encode(text).byteLength > MAX_INCREMENTAL_OBJECT_BYTES) {
      return new Response('Object too large', {
        status: 413,
        headers: corsHeaders,
      })
    }

    let parsed

    try {
      parsed = JSON.parse(text)
    } catch {
      return new Response('Invalid JSON', {
        status: 400,
        headers: corsHeaders,
      })
    }

    const validation = validateEncryptedObjectEnvelope(parsed)

    if (!validation.ok) {
      return new Response(validation.message, {
        status: 400,
        headers: corsHeaders,
      })
    }

    const coordinator = incrementalCoordinatorStub(env)
    if (!coordinator) {
      return new Response(SYNC_COORDINATOR_BINDING_ERROR, {
        status: 501,
        headers: corsHeaders,
      })
    }
    const forwarded = new Request(request.url, {
      method: 'PUT',
      headers: request.headers,
      body: text,
    })
    return withCors(await coordinator.fetch(forwarded), corsHeaders)
  }

  if (request.method === 'DELETE') {
    const coordinator = incrementalCoordinatorStub(env)
    if (!coordinator) {
      return new Response(SYNC_COORDINATOR_BINDING_ERROR, {
        status: 501,
        headers: corsHeaders,
      })
    }
    return withCors(await coordinator.fetch(request), corsHeaders)
  }

  return new Response('Method not allowed', {
    status: 405,
    headers: corsHeaders,
  })
}

async function proxyAiRequest(request, env, corsHeaders) {
  if (request.method !== 'POST' && request.method !== 'GET') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  }

  if (!hasValidHeaderAccessKey(request, env)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  const maxProxyBytes = proxyContentLimit(env)

  if (contentLength(request) > maxProxyBytes) {
    return new Response('Request too large', {
      status: 413,
      headers: corsHeaders,
    })
  }

  const kind =
    request.headers.get('x-zerochat-provider-kind') || 'openai-compatible'
  const baseUrl = request.headers.get('x-zerochat-base-url')
  const action = request.headers.get('x-zerochat-proxy-action') || 'chat'

  if (
    kind !== 'openai-compatible' &&
    kind !== 'openai-responses' &&
    kind !== 'anthropic'
  ) {
    return new Response('Unsupported provider kind', {
      status: 400,
      headers: corsHeaders,
    })
  }

  if (!baseUrl) {
    return new Response('Missing x-zerochat-base-url', {
      status: 400,
      headers: corsHeaders,
    })
  }

  if (
    action !== 'chat' &&
    action !== 'models' &&
    !Object.prototype.hasOwnProperty.call(PROXY_ACTION_PATHS, action)
  ) {
    return new Response('Unsupported proxy action', {
      status: 400,
      headers: corsHeaders,
    })
  }

  if (action === 'models' && request.method !== 'GET') {
    return new Response('Model list must use GET', {
      status: 405,
      headers: corsHeaders,
    })
  }

  if (action !== 'models' && request.method !== 'POST') {
    return new Response('Proxy action must use POST', {
      status: 405,
      headers: corsHeaders,
    })
  }

  let upstreamUrl
  try {
    upstreamUrl = buildUpstreamUrl(baseUrl, kind, action)
  } catch {
    return new Response('Invalid upstream URL', {
      status: 400,
      headers: corsHeaders,
    })
  }
  const upstream = new URL(upstreamUrl)

  const allowedHosts = await allowedProxyHosts(env)
  const upstreamHost = upstream.host.toLowerCase()

  if (!allowedHosts.includes(upstreamHost)) {
    if (!(await canAutoAllowProxyHost(env, upstreamHost))) {
      return new Response('Host is not allowed', {
        status: 403,
        headers: corsHeaders,
      })
    }

    await rememberAllowedProxyHost(env, upstreamHost)
  }

  const headers = new Headers({
    'content-type': request.headers.get('content-type') || 'application/json',
  })
  const authorization = (request.headers.get('authorization') || '').trim()
  const apiKey = (request.headers.get('x-api-key') || '').trim()
  const hostedKey = resolveHostedProviderKey(env, {
    host: upstream.host,
    hostname: upstream.hostname,
  })

  if (kind === 'anthropic') {
    if (apiKey) {
      headers.set('x-api-key', apiKey)
    } else if (hostedKey) {
      headers.set('x-api-key', hostedKey)
    } else if (authorization) {
      headers.set('authorization', authorization)
    }

    headers.set('anthropic-version', '2023-06-01')
  } else {
    if (authorization) {
      headers.set('authorization', authorization)
    } else if (hostedKey) {
      headers.set('authorization', `Bearer ${hostedKey}`)
    }

    if (apiKey) {
      headers.set('x-api-key', apiKey)
    }
  }

  if (
    !headers.has('authorization') &&
    !headers.has('x-api-key') &&
    !envFlag(env.ALLOW_KEYLESS_UPSTREAMS)
  ) {
    return new Response('Missing provider authorization', {
      status: 401,
      headers: corsHeaders,
    })
  }

  let body

  if (request.method === 'POST') {
    body = await readRequestBodyWithinLimit(request, maxProxyBytes)

    if (body === null) {
      return new Response('Request too large', {
        status: 413,
        headers: corsHeaders,
      })
    }
  }

  let response
  try {
    response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: request.signal,
    })
  } catch {
    return new Response('Upstream request failed', {
      status: 502,
      headers: {
        ...corsHeaders,
        'content-type': 'text/plain; charset=utf-8',
        'x-zerochat-proxy-response-source': 'transport-error',
      },
    })
  }
  const upstreamServer = (response.headers.get('server') || '').toLowerCase()
  const upstreamEdge =
    response.headers.has('cf-ray') || upstreamServer.includes('cloudflare')
      ? 'cloudflare'
      : ''

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...corsHeaders,
      'content-type':
        response.headers.get('content-type') ||
        (kind === 'anthropic' ? 'text/event-stream' : 'application/json'),
      'x-zerochat-proxy-response-source': 'upstream',
      ...(upstreamEdge ? { 'x-zerochat-upstream-edge': upstreamEdge } : {}),
    },
  })
}

async function handleProxyHosts(request, env, corsHeaders) {
  if (request.method !== 'PUT') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  }

  if (!hasValidHeaderAccessKey(request, env)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  }

  if (!autoAllowedHostsEnabled(env)) {
    return new Response('Automatic host learning is disabled', {
      status: 403,
      headers: corsHeaders,
    })
  }

  if (!env.zerochat_kv) {
    return new Response(KV_BINDING_ERROR, {
      status: 501,
      headers: corsHeaders,
    })
  }

  if (contentLength(request) > 20000) {
    return new Response('Request too large', {
      status: 413,
      headers: corsHeaders,
    })
  }

  const text = await request.text()

  if (textEncoder.encode(text).byteLength > 20000) {
    return new Response('Request too large', {
      status: 413,
      headers: corsHeaders,
    })
  }

  let parsed

  try {
    parsed = JSON.parse(text)
  } catch {
    return new Response('Invalid JSON', {
      status: 400,
      headers: corsHeaders,
    })
  }

  const values = [
    ...(Array.isArray(parsed?.baseUrls) ? parsed.baseUrls : []),
    ...(Array.isArray(parsed?.hosts) ? parsed.hosts : []),
  ]

  const hosts = []

  for (const value of values) {
    const host = safeProxyHost(value)

    if (!host) {
      return new Response('Invalid host', {
        status: 400,
        headers: corsHeaders,
      })
    }

    hosts.push(host)
  }

  const uniqueHosts = uniqueList(hosts)

  if (uniqueHosts.length === 0) {
    await env.zerochat_kv.delete(AUTO_ALLOWED_HOSTS_KEY)
  } else {
    await env.zerochat_kv.put(
      AUTO_ALLOWED_HOSTS_KEY,
      JSON.stringify({
        kind: 'zerochat.autoAllowedHosts',
        version: 1,
        updatedAt: Date.now(),
        hosts: uniqueHosts,
      }),
    )
  }

  return new Response(
    JSON.stringify({
      ok: true,
      hosts: uniqueHosts,
    }),
    {
      headers: {
        ...corsHeaders,
        'content-type': 'application/json; charset=utf-8',
      },
    },
  )
}

function buildUpstreamUrl(baseUrl, kind, action = 'chat') {
  const url = new URL(baseUrl.trim())

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isDisallowedUpstreamHost(url.hostname)
  ) {
    throw new Error('Unsafe upstream URL')
  }

  const normalized = url.toString().replace(/\/+$/, '')

  const root = stripKnownEndpoint(normalized)

  if (action === 'models') {
    return `${root}/models`
  }

  if (action !== 'chat') {
    return `${root}${PROXY_ACTION_PATHS[action]}`
  }

  return buildChatEndpointFromRoot(root, kind)
}

function stripKnownEndpoint(normalized) {
  const endpoint = KNOWN_UPSTREAM_PATHS.find((path) => normalized.endsWith(path))
  return endpoint ? normalized.slice(0, -endpoint.length) : normalized
}

function buildChatEndpointFromRoot(root, kind) {
  if (kind === 'anthropic') {
    return root.endsWith('/messages') ? root : `${root}/messages`
  }

  if (kind === 'openai-responses') {
    return root.endsWith('/responses') ? root : `${root}/responses`
  }

  return root.endsWith('/chat/completions')
    ? root
    : `${root}/chat/completions`
}

function parseIpv4(value) {
  const parts = value.split('.')

  if (parts.length !== 4) {
    return null
  }

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return Number.NaN
    }

    return Number(part)
  })

  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null
}

function isDisallowedIpv4(octets) {
  const [first, second, third] = octets

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  )
}

function parseIpv6Hextets(value) {
  const parsePart = (part) => {
    if (!part) {
      return null
    }

    if (part.includes('.')) {
      const ipv4 = parseIpv4(part)

      return ipv4 ? [ipv4[0] * 256 + ipv4[1], ipv4[2] * 256 + ipv4[3]] : null
    }

    if (!/^[0-9a-f]{1,4}$/iu.test(part)) {
      return null
    }

    return [Number.parseInt(part, 16)]
  }

  const parseSide = (side) => {
    if (!side) {
      return []
    }

    const hextets = []

    for (const part of side.split(':')) {
      const parsed = parsePart(part)

      if (!parsed) {
        return null
      }

      hextets.push(...parsed)
    }

    return hextets
  }

  const sections = value.split('::')

  if (sections.length > 2) {
    return null
  }

  const left = parseSide(sections[0])
  const right = sections.length === 2 ? parseSide(sections[1]) : []

  if (!left || !right) {
    return null
  }

  if (sections.length === 1) {
    return left.length === 8 ? left : null
  }

  const zeros = 8 - left.length - right.length

  if (zeros < 1) {
    return null
  }

  return [...left, ...Array.from({ length: zeros }, () => 0), ...right]
}

function embeddedIpv4FromIpv6(value) {
  const hextets = parseIpv6Hextets(value)

  if (!hextets) {
    return null
  }

  const fromWords = (firstWord, secondWord) => [
    firstWord >> 8,
    firstWord & 255,
    secondWord >> 8,
    secondWord & 255,
  ]

  if (
    hextets.slice(0, 5).every((part) => part === 0) &&
    (hextets[5] === 0 || hextets[5] === 0xffff)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    hextets.slice(2, 6).every((part) => part === 0)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    hextets[2] === 1 &&
    hextets.slice(3, 6).every((part) => part === 0)
  ) {
    return fromWords(hextets[6], hextets[7])
  }

  if (hextets[0] === 0x2002) {
    return fromWords(hextets[1], hextets[2])
  }

  return null
}

function isDisallowedUpstreamHost(hostname) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  const ipv4 = parseIpv4(normalized)

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true
  }

  if (ipv4) {
    return normalized !== ipv4.join('.') || isDisallowedIpv4(ipv4)
  }

  if (!normalized.includes(':')) {
    return (
      !normalized.includes('.') ||
      normalized.split('.').every((label) => /^(?:[0-9]+|0x[0-9a-f]+)$/iu.test(label))
    )
  }

  const ipv6 = parseIpv6Hextets(normalized)
  const embeddedIpv4 = embeddedIpv4FromIpv6(normalized)

  if (embeddedIpv4 && isDisallowedIpv4(embeddedIpv4)) {
    return true
  }

  if (ipv6) {
    const first = ipv6[0]

    return (
      normalized === '::' ||
      normalized === '::1' ||
      (first === 0x100 && ipv6.slice(1, 4).every((part) => part === 0)) ||
      (first === 0x2001 && ipv6[1] === 0x0db8) ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00
    )
  }

  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  )
}

async function resolveCorsContext(request, env) {
  const rawOrigin = request.headers.get('origin')
  const origin = safeBrowserOrigin(rawOrigin)
  const sameOriginAllowed = Boolean(
    origin && origin === new URL(request.url).origin,
  )
  const explicitOrigins = safeOriginList(env.ALLOWED_ORIGINS)
  const autoEnabled = autoAllowedOriginsEnabled(env, explicitOrigins)
  const learnedOrigins = autoEnabled ? await readAutoAllowedOrigins(env) : []
  const explicitAllowed = Boolean(origin && explicitOrigins.includes(origin))
  const learnedAllowed = Boolean(origin && learnedOrigins.includes(origin))
  const wildcardAllowed = Boolean(
    origin &&
      explicitOrigins.length === 0 &&
      learnedOrigins.length === 0 &&
      !autoEnabled &&
      !envFlag(env.REQUIRE_ALLOWED_ORIGINS),
  )
  const canEnroll = Boolean(
    origin &&
      autoEnabled &&
      !explicitAllowed &&
      !learnedAllowed &&
      learnedOrigins.length < maxAutoAllowedOrigins(env),
  )
  const allowed = Boolean(
    !rawOrigin ||
      sameOriginAllowed ||
      explicitAllowed ||
      learnedAllowed ||
      wildcardAllowed,
  )

  return {
    origin,
    allowed,
    canEnroll,
    canPreflight: allowed || canEnroll,
    wildcardAllowed,
  }
}

function buildCorsHeaders(cors) {
  const headers = {
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers':
      'authorization, content-type, if-match, if-none-match, x-api-key, x-zerochat-access-key, x-zerochat-proxy-action, x-zerochat-sync-generation, anthropic-version, anthropic-dangerous-direct-browser-access, x-zerochat-base-url, x-zerochat-provider-kind',
    'access-control-expose-headers':
      'etag, x-zerochat-idempotent, x-zerochat-proxy-response-source, x-zerochat-sync-generation, x-zerochat-upstream-edge',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    vary: 'Origin',
    'x-content-type-options': 'nosniff',
  }

  if (cors.origin && (cors.allowed || cors.canEnroll)) {
    headers['access-control-allow-origin'] = cors.origin
    return headers
  }

  if (cors.wildcardAllowed) {
    headers['access-control-allow-origin'] = '*'
  }

  return headers
}

function hasValidRouteToken(request, env, pathname) {
  if (pathname === '/proxy' || pathname === '/proxy/hosts') {
    return hasValidHeaderAccessKey(request, env)
  }

  if (
    pathname === '/snapshot' ||
    pathname === '/sync/clear' ||
    pathname === '/sync/head' ||
    pathname.startsWith('/sync/object/')
  ) {
    return hasValidBearerAccessKey(request, env)
  }

  return false
}

function routeRequiresAccessKey(pathname) {
  return (
    pathname === '/proxy' ||
    pathname === '/proxy/hosts' ||
    pathname === '/snapshot' ||
    pathname === '/sync/clear' ||
    pathname === '/sync/head' ||
    pathname.startsWith('/sync/object/')
  )
}

function safeBrowserOrigin(value) {
  const rawValue = String(value || '').trim()

  if (!rawValue || rawValue === 'null') {
    return ''
  }

  let url

  try {
    url = new URL(rawValue)
  } catch {
    return ''
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    return ''
  }

  if (url.protocol === 'https:') {
    return url.origin
  }

  if (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]' ||
      url.hostname === '::1')
  ) {
    return url.origin
  }

  return ''
}

function safeOriginList(value) {
  return uniqueList(
    splitList(value)
      .map(safeBrowserOrigin)
      .filter(Boolean),
  )
}

function autoAllowedOriginsEnabled(env, explicitOrigins) {
  const configured = String(env.AUTO_ALLOWED_ORIGINS ?? '').trim()

  if (configured) {
    return envFlag(configured)
  }

  return explicitOrigins.length === 0 && !envFlag(env.REQUIRE_ALLOWED_ORIGINS)
}

async function readAutoAllowedOrigins(env) {
  if (!env.zerochat_kv) {
    return []
  }

  const text = await env.zerochat_kv.get(AUTO_ALLOWED_ORIGINS_KEY)

  if (!text) {
    return []
  }

  try {
    const parsed = JSON.parse(text)
    const origins = Array.isArray(parsed?.origins) ? parsed.origins : []

    return safeOriginList(origins.join(','))
  } catch {
    return []
  }
}

async function rememberAllowedOrigin(env, origin) {
  if (!origin || !env.zerochat_kv) {
    return
  }

  const current = await readAutoAllowedOrigins(env)

  if (current.includes(origin)) {
    return
  }

  if (current.length >= maxAutoAllowedOrigins(env)) {
    return
  }

  const origins = [...current, origin]

  await env.zerochat_kv.put(
    AUTO_ALLOWED_ORIGINS_KEY,
    JSON.stringify({
      kind: 'zerochat.autoAllowedOrigins',
      version: 1,
      updatedAt: Date.now(),
      origins,
    }),
  )
}

function configuredAccessKey(env) {
  const value = String(env.ZEROCHAT_ACCESS_KEY ?? '').trim()

  return ACCESS_KEY_PLACEHOLDERS.has(value) ? '' : value
}

function hasValidBearerAccessKey(request, env) {
  const value = request.headers.get('authorization') ?? ''
  const match = value.match(/^Bearer\s+(.+)$/i)

  return timingSafeEqual(match?.[1] ?? '', configuredAccessKey(env))
}

function hasValidHeaderAccessKey(request, env) {
  return timingSafeEqual(
    request.headers.get('x-zerochat-access-key') ?? '',
    configuredAccessKey(env),
  )
}

function timingSafeEqual(left, right) {
  if (!left || !right) {
    return false
  }

  const leftBytes = textEncoder.encode(left)
  const rightBytes = textEncoder.encode(right)
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength)
  let diff = leftBytes.byteLength ^ rightBytes.byteLength

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return diff === 0
}

function contentLength(request) {
  const value = Number(request.headers.get('content-length') || 0)

  return Number.isFinite(value) && value > 0 ? value : 0
}

async function readRequestBodyWithinLimit(request, maxBytes) {
  if (!request.body) {
    return new ArrayBuffer(0)
  }

  const reader = request.body.getReader()
  const chunks = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      totalBytes += chunk.byteLength

      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => undefined)
        return null
      }

      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body.buffer
}

function splitList(value) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function envFlag(value) {
  return String(value || '').toLowerCase() === 'true'
}

function maxAutoAllowedOrigins(env) {
  const configured = Number(env.MAX_AUTO_ALLOWED_ORIGINS || 0)

  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_AUTO_ALLOWED_ORIGINS
}

async function allowedProxyHosts(env) {
  const configured = splitList(env.ALLOWED_HOSTS).map(safeProxyHost)
  const learned = autoAllowedHostsEnabled(env)
    ? await readAutoAllowedHosts(env)
    : []
  const hosts = envFlag(env.ALLOW_DEFAULT_PROVIDER_HOSTS ?? 'true')
    ? [...DEFAULT_ALLOWED_HOSTS, ...configured, ...learned]
    : [...configured, ...learned]

  return uniqueList(hosts.map((host) => host.toLowerCase()))
}

function autoAllowedHostsEnabled(env) {
  const configured = String(env.AUTO_ALLOWED_HOSTS ?? '').trim()

  return configured ? envFlag(configured) : true
}

async function readAutoAllowedHosts(env) {
  if (!env.zerochat_kv) {
    return []
  }

  const text = await env.zerochat_kv.get(AUTO_ALLOWED_HOSTS_KEY)

  if (!text) {
    return []
  }

  try {
    const parsed = JSON.parse(text)
    const hosts = Array.isArray(parsed?.hosts) ? parsed.hosts : []

    return uniqueList(hosts.map(safeProxyHost).filter(Boolean))
  } catch {
    return []
  }
}

async function canAutoAllowProxyHost(env, host) {
  if (!autoAllowedHostsEnabled(env) || !safeProxyHost(host)) {
    return false
  }

  return true
}

async function rememberAllowedProxyHost(env, host) {
  const safeHost = safeProxyHost(host)

  if (!safeHost || !env.zerochat_kv || !autoAllowedHostsEnabled(env)) {
    return
  }

  const current = await readAutoAllowedHosts(env)

  if (current.includes(safeHost)) {
    return
  }

  await env.zerochat_kv.put(
    AUTO_ALLOWED_HOSTS_KEY,
    JSON.stringify({
      kind: 'zerochat.autoAllowedHosts',
      version: 1,
      updatedAt: Date.now(),
      hosts: [...current, safeHost],
    }),
  )
}

function safeProxyHost(value) {
  const rawValue = String(value || '').trim()

  if (!rawValue) {
    return ''
  }

  if (rawValue.includes('://')) {
    try {
      const url = new URL(rawValue)

      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        isDisallowedUpstreamHost(url.hostname)
      ) {
        return ''
      }

      return url.host.toLowerCase()
    } catch {
      return ''
    }
  }

  if (
    rawValue.includes('/') ||
    rawValue.includes('?') ||
    rawValue.includes('#') ||
    rawValue.includes('@')
  ) {
    return ''
  }

  try {
    const url = new URL(`https://${rawValue}`)

    if (isDisallowedUpstreamHost(url.hostname)) {
      return ''
    }

    return url.host.toLowerCase()
  } catch {
    return ''
  }
}

function proxyContentLimit(env) {
  const configured = Number(env.MAX_PROXY_BYTES || 0)

  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_PROXY_CONTENT_LENGTH
}

function resolveHostedProviderKey(env, candidates) {
  if (!hostedProviderKeysEnabled(env)) {
    return ''
  }

  const names = uniqueList([
    candidates.host,
    candidates.hostname,
  ])
  const jsonKeys = parseHostedProviderKeys(env.PROVIDER_KEYS)

  for (const name of names) {
    const key = jsonKeys[name]

    if (typeof key === 'string' && key.trim()) {
      return key.trim()
    }
  }

  return ''
}

function hostedProviderKeysEnabled(env) {
  if (envFlag(env.ALLOW_HOSTED_PROVIDER_KEYS)) {
    return true
  }

  if (String(env.PROVIDER_KEYS ?? '').trim()) {
    return true
  }

}

function parseHostedProviderKeys(value) {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value)

    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function uniqueList(values) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  )
}

function isSafeObjectKey(value) {
  return typeof value === 'string' && OBJECT_KEY_PATTERN.test(value)
}

function validateIncrementalHead(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    value.kind !== 'zerochat.incrementalHead' ||
    value.version !== 1 ||
    !isSafeObjectKey(value.manifestKey) ||
    !isSafeTimestamp(value.updatedAt)
  ) {
    return { ok: false, message: 'Invalid incremental head' }
  }

  if (!value.manifestKey.startsWith('manifest-')) {
    return { ok: false, message: 'Incremental head must point to a manifest' }
  }

  return { ok: true }
}

function validateEncryptedEnvelope(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    value.kind !== 'zerochat.encryptedSnapshot' ||
    value.version !== 1
  ) {
    return { ok: false, message: 'Encrypted snapshot required' }
  }

  if (!isSafeTimestamp(value.encryptedAt) || !isSafeTimestamp(value.updatedAt)) {
    return { ok: false, message: 'Invalid snapshot timestamp' }
  }

  if (
    typeof value.crypto !== 'object' ||
    value.crypto === null ||
    value.crypto.cipher !== VAULT_CIPHER ||
    value.crypto.kdf !== VAULT_KDF ||
    value.crypto.iterations !== VAULT_KDF_ITERATIONS
  ) {
    return { ok: false, message: 'Unsupported snapshot crypto' }
  }

  const salt = base64Bytes(value.crypto.salt)
  const iv = base64Bytes(value.crypto.iv)
  const aad = base64Bytes(value.crypto.aad)
  const payload = base64Bytes(value.payload)
  const expectedAad = textEncoder.encode(`zerochat:vault:v1:${value.updatedAt}`)

  if (!salt || salt.byteLength !== 16) {
    return { ok: false, message: 'Invalid snapshot salt' }
  }

  if (!iv || iv.byteLength !== 12) {
    return { ok: false, message: 'Invalid snapshot iv' }
  }

  if (!aad || !bytesEqual(aad, expectedAad)) {
    return { ok: false, message: 'Invalid snapshot aad' }
  }

  if (!payload || payload.byteLength <= 16) {
    return { ok: false, message: 'Invalid snapshot payload' }
  }

  return { ok: true }
}

function validateEncryptedObjectEnvelope(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    value.kind !== 'zerochat.encryptedObject' ||
    value.version !== 1 ||
    typeof value.objectType !== 'string' ||
    value.objectType.length < 1 ||
    value.objectType.length > 128
  ) {
    return { ok: false, message: 'Encrypted object required' }
  }

  if (!isSafeTimestamp(value.encryptedAt) || !isSafeTimestamp(value.updatedAt)) {
    return { ok: false, message: 'Invalid object timestamp' }
  }

  if (
    typeof value.crypto !== 'object' ||
    value.crypto === null ||
    value.crypto.cipher !== VAULT_CIPHER ||
    value.crypto.kdf !== VAULT_KDF ||
    value.crypto.iterations !== VAULT_KDF_ITERATIONS ||
    (value.crypto.compression !== 'gzip' &&
      value.crypto.compression !== 'none')
  ) {
    return { ok: false, message: 'Unsupported object crypto' }
  }

  const salt = base64Bytes(value.crypto.salt)
  const iv = base64Bytes(value.crypto.iv)
  const aad = base64Bytes(value.crypto.aad)
  const payload = base64Bytes(value.payload)
  const expectedAad = textEncoder.encode(
    `zerochat:object:v1:${value.objectType}:${value.updatedAt}`,
  )

  if (!salt || salt.byteLength !== 16) {
    return { ok: false, message: 'Invalid object salt' }
  }

  if (!iv || iv.byteLength !== 12) {
    return { ok: false, message: 'Invalid object iv' }
  }

  if (!aad || !bytesEqual(aad, expectedAad)) {
    return { ok: false, message: 'Invalid object aad' }
  }

  if (!payload || payload.byteLength <= 16) {
    return { ok: false, message: 'Invalid object payload' }
  }

  return { ok: true }
}

function isSafeTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0
}

function base64Bytes(value) {
  if (typeof value !== 'string') {
    return null
  }

  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return bytes
  } catch {
    return null
  }
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) {
    return false
  }

  let diff = 0

  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index] ^ right[index]
  }

  return diff === 0
}
