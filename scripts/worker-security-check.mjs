import worker, { ZeroChatSyncCoordinator } from '../cloudflare/sync-worker.js'
import { readFileSync } from 'node:fs'

const encoder = new TextEncoder()
const expectedProxyActions = [
  'chat',
  'models',
  'image-generations',
  'image-edits',
  'image-responses',
  'audio-speech',
  'audio-transcriptions',
  'embeddings',
  'moderations',
  'realtime',
  'realtime-client-secrets',
]
const expectedProxyCorsHeaders = [
  'anthropic-dangerous-direct-browser-access',
  'anthropic-version',
  'authorization',
  'content-type',
  'if-match',
  'if-none-match',
  'x-api-key',
  'x-zerochat-access-key',
  'x-zerochat-base-url',
  'x-zerochat-provider-kind',
  'x-zerochat-proxy-action',
  'x-zerochat-sync-generation',
]
const expectedCorsExposeHeaders = [
  'etag',
  'x-zerochat-idempotent',
  'x-zerochat-proxy-response-source',
  'x-zerochat-sync-generation',
  'x-zerochat-upstream-edge',
]
const expectedOpenApiProxyRequestContentTypes = [
  'application/json',
  'multipart/form-data',
]
const expectedContractProxyMultipartActions = [
  'audio-transcriptions',
  'image-edits',
]
const expectedOpenApiProxyResponseStatuses = [
  '200',
  '400',
  '401',
  '403',
  '405',
  '413',
  '501',
]
const expectedWorkerProxyActionPaths = new Map([
  ['image-generations', '/images/generations'],
  ['image-edits', '/images/edits'],
  ['image-responses', '/responses'],
  ['audio-speech', '/audio/speech'],
  ['audio-transcriptions', '/audio/transcriptions'],
  ['embeddings', '/embeddings'],
  ['moderations', '/moderations'],
  ['realtime', '/realtime'],
  ['realtime-client-secrets', '/realtime/client_secrets'],
])

class MemoryDurableStorage {
  constructor() {
    this.records = new Map()
    this.transactionTail = Promise.resolve()
  }

  async get(key) {
    return this.records.get(key)
  }

  async put(key, value) {
    this.records.set(key, structuredClone(value))
  }

  async delete(key) {
    this.records.delete(key)
  }

  transaction(callback) {
    const operation = this.transactionTail.then(() => callback(this))
    this.transactionTail = operation.catch(() => undefined)
    return operation
  }
}

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes))
}

function envelope(updatedAt) {
  return {
    kind: 'zerochat.encryptedSnapshot',
    version: 1,
    encryptedAt: updatedAt + 1,
    updatedAt,
    crypto: {
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: 600000,
      salt: base64(new Uint8Array(16)),
      iv: base64(new Uint8Array(12)),
      aad: base64(encoder.encode(`zerochat:vault:v1:${updatedAt}`)),
    },
    payload: base64(new Uint8Array(17).fill(1)),
  }
}

function objectEnvelope(objectType, updatedAt) {
  return {
    kind: 'zerochat.encryptedObject',
    version: 1,
    objectType,
    encryptedAt: updatedAt + 1,
    updatedAt,
    crypto: {
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: 600000,
      salt: base64(new Uint8Array(16)),
      iv: base64(new Uint8Array(12)),
      aad: base64(encoder.encode(`zerochat:object:v1:${objectType}:${updatedAt}`)),
      compression: 'none',
    },
    payload: base64(new Uint8Array(17).fill(1)),
  }
}

function createEnv() {
  const store = new Map()
  const blobs = new Map()
  const coordinatorStorage = new MemoryDurableStorage()

  const env = {
    ZEROCHAT_ACCESS_KEY: 'zerochat-access-key',
    ALLOWED_HOSTS: 'api.openai.com',
    zerochat_kv: {
      async get(key) {
        return store.get(key) ?? null
      },
      async put(key, value) {
        store.set(key, value)
      },
      async delete(key) {
        store.delete(key)
      },
    },
    zerochat_r2: {
      async get(key) {
        const value = blobs.get(key)

        if (!value) {
          return null
        }

        return {
          body: value,
          httpMetadata: {
            contentType: 'application/json; charset=utf-8',
          },
        }
      },
      async put(key, value) {
        blobs.set(key, value)
      },
      async delete(key) {
        blobs.delete(key)
      },
      async list(options = {}) {
        const limit = options.limit ?? 1000
        const offset = Number(options.cursor ?? 0)
        const keys = Array.from(blobs.keys()).sort()
        const page = keys.slice(offset, offset + limit)
        const nextOffset = offset + page.length

        return {
          objects: page.map((key) => ({ key })),
          truncated: nextOffset < keys.length,
          cursor: String(nextOffset),
        }
      },
    },
  }
  const coordinator = new ZeroChatSyncCoordinator(
    {
      storage: coordinatorStorage,
      blockConcurrencyWhile(callback) {
        this.initialization = callback()
      },
    },
    env,
  )
  env.ZEROCHAT_SYNC_COORDINATOR = {
    idFromName(name) {
      return name
    },
    get() {
      return coordinator
    },
  }
  return env
}

async function call(env, path, init) {
  return worker.fetch(new Request(`https://zerochat.test${path}`, init), env)
}

async function currentSyncGeneration(env) {
  const response = await call(env, '/sync/head', {
    method: 'GET',
    headers: { authorization: 'Bearer zerochat-access-key' },
  })
  if (response.status !== 200 && response.status !== 404) {
    throw new Error(`cannot read sync generation: HTTP ${response.status}`)
  }
  const generation = response.headers.get('x-zerochat-sync-generation')
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      generation ?? '',
    )
  ) {
    throw new Error('Worker must expose a valid sync generation')
  }
  return generation
}

async function expectStatus(actual, expected, message) {
  if (actual.status !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual.status}`)
  }
}

async function expectHeader(response, name, expected, message) {
  const actual = response.headers.get(name)

  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

async function expectText(response, expected, message) {
  const actual = await response.text()

  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

async function autoAllowedOrigins(env) {
  const text = await env.zerochat_kv.get('auto-allowed-origins')

  if (!text) {
    return []
  }

  const parsed = JSON.parse(text)

  return Array.isArray(parsed.origins) ? parsed.origins : []
}

async function autoAllowedHosts(env) {
  const text = await env.zerochat_kv.get('auto-allowed-hosts')

  if (!text) {
    return []
  }

  const parsed = JSON.parse(text)

  return Array.isArray(parsed.hosts) ? parsed.hosts : []
}

function readRepoText(relativePath) {
  return readFileSync(
    new URL(`../${relativePath.replace(/\\/g, '/')}`, import.meta.url),
    'utf8',
  )
}

function sortedUnique(values) {
  return Array.from(new Set(values)).sort()
}

function formatList(values) {
  return sortedUnique(values).join(', ')
}

function assertSetEquals(actual, expected, label) {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const missing = expected.filter((value) => !actualSet.has(value))
  const extra = actual.filter((value) => !expectedSet.has(value))

  if (missing.length || extra.length) {
    throw new Error(
      `${label} drifted. Missing: ${formatList(missing) || 'none'}. Extra: ${formatList(extra) || 'none'}.`,
    )
  }
}

function parseHeaderList(value) {
  return sortedUnique(
    String(value || '')
      .split(',')
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean),
  )
}

function extractWorkerProxyActionPaths(source) {
  const match = source.match(/const PROXY_ACTION_PATHS\s*=\s*{([\s\S]*?)\n}/)

  if (!match) {
    throw new Error('Worker PROXY_ACTION_PATHS map is missing')
  }

  const paths = new Map()

  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^\s*(?:'([^']+)'|([A-Za-z][\w-]*)):\s*'([^']+)'/)

    if (entry) {
      paths.set(entry[1] || entry[2], entry[3])
    }
  }

  return paths
}

function assertPathMapEquals(actual, expected, label) {
  assertSetEquals(Array.from(actual.keys()), Array.from(expected.keys()), label)

  for (const [action, expectedPath] of expected) {
    const actualPath = actual.get(action)

    if (actualPath !== expectedPath) {
      throw new Error(
        `${label} path for ${action} drifted. Expected ${expectedPath}, got ${actualPath || 'missing'}.`,
      )
    }
  }
}

function extractOpenApiProxyActions(source) {
  const enumMatch = source.match(
    /name:\s*x-zerochat-proxy-action[\s\S]*?schema:\s*\n\s*enum:\s*\n((?:\s+- [a-z0-9-]+\r?\n)+)/,
  )
  const constMatches = Array.from(
    source.matchAll(
      /name:\s*x-zerochat-proxy-action[\s\S]*?schema:\s*\n\s*const:\s*([a-z0-9-]+)/g,
    ),
    (match) => match[1],
  )

  if (!enumMatch) {
    throw new Error('OpenAPI /proxy action enum is missing')
  }

  return sortedUnique([
    ...constMatches,
    ...Array.from(enumMatch[1].matchAll(/-\s+([a-z0-9-]+)/g), (match) => match[1]),
  ])
}

function extractOpenApiProxyCorsAllowHeaders(source) {
  const match = source.match(
    /\/proxy:\s*\n\s*x-zerochat-cors-allow-headers:\s*\n((?:\s+- [a-z0-9-]+\r?\n)+)/,
  )

  if (!match) {
    throw new Error('OpenAPI /proxy CORS allow-header contract is missing')
  }

  return sortedUnique(
    Array.from(match[1].matchAll(/-\s+([a-z0-9-]+)/g), (item) => item[1]),
  )
}

function extractOpenApiProxyHeaderParameters(source) {
  const pathMatch = source.match(/\/proxy:\s*\n([\s\S]*?)(?=\n  \/proxy\/hosts:)/)

  if (!pathMatch) {
    throw new Error('OpenAPI /proxy path is missing')
  }

  return sortedUnique(
    Array.from(
      pathMatch[1].matchAll(/-\s+name:\s+([a-z0-9-]+)\s*\n\s+in:\s+header/g),
      (match) => match[1],
    ),
  )
}

function extractOpenApiProxyPostRequestContentTypes(source) {
  const postMatch = source.match(
    /\/proxy:[\s\S]*?\n    post:\s*\n([\s\S]*?)(?=\n  \/proxy\/hosts:)/,
  )

  if (!postMatch) {
    throw new Error('OpenAPI /proxy POST operation is missing')
  }

  const requestBodyMatch = postMatch[1].match(
    /requestBody:\s*\n[\s\S]*?content:\s*\n((?:\s{10}[a-z0-9.+/-]+:\r?\n[\s\S]*?)+?)(?=\n\s{6}responses:)/,
  )

  if (!requestBodyMatch) {
    throw new Error('OpenAPI /proxy POST requestBody content contract is missing')
  }

  return sortedUnique(
    Array.from(
      requestBodyMatch[1].matchAll(/^\s{10}([a-z0-9.+/-]+):/gm),
      (match) => match[1],
    ),
  )
}

function extractOpenApiProxyResponseStatuses(source, method) {
  const operationMatch = source.match(
    new RegExp(
      `/proxy:[\\s\\S]*?\\n    ${method}:\\s*\\n([\\s\\S]*?)(?=\\n    (?:get|post):|\\n  /proxy/hosts:)`,
    ),
  )

  if (!operationMatch) {
    throw new Error(`OpenAPI /proxy ${method.toUpperCase()} operation is missing`)
  }

  const responsesMatch = operationMatch[1].match(
    /responses:\s*\n((?:\s{8}"[0-9]{3}":\r?\n(?:\s{10}.+\r?\n)*)+)/,
  )

  if (!responsesMatch) {
    throw new Error(
      `OpenAPI /proxy ${method.toUpperCase()} responses contract is missing`,
    )
  }

  return sortedUnique(
    Array.from(
      responsesMatch[1].matchAll(/^\s{8}"([0-9]{3})":/gm),
      (match) => match[1],
    ),
  )
}

function extractContractProxyActions(source) {
  const lines = Array.from(
    source.matchAll(/X-ZeroChat-Proxy-Action:\s*([^\r\n]+)/g),
    (match) => match[1],
  )
  const actionLine = lines.find((line) => line.includes('|'))

  if (!actionLine) {
    throw new Error('AI provider contract proxy action line is missing')
  }

  return sortedUnique(actionLine.split('|').map((value) => value.trim()))
}

function extractContractWorkerProxySection(source) {
  const match = source.match(
    /## Worker Proxy\s*\n([\s\S]*?)(?=\n### Managed Custom Relay Hosts)/,
  )

  if (!match) {
    throw new Error('AI provider contract Worker Proxy section is missing')
  }

  return match[1]
}

function extractContractProxyContentTypes(source) {
  const section = extractContractWorkerProxySection(source)

  return sortedUnique(
    Array.from(
      section.matchAll(/\b(application\/json|multipart\/form-data)\b/g),
      (match) => match[1],
    ),
  )
}

function extractContractProxyMultipartActions(source) {
  const section = extractContractWorkerProxySection(source)
  const sentence = section.match(
    /`image-edits` and `audio-transcriptions` use `multipart\/form-data`/,
  )

  if (!sentence) {
    throw new Error(
      'AI provider contract must bind multipart/form-data to image-edits and audio-transcriptions',
    )
  }

  return expectedContractProxyMultipartActions
}

function extractWebProxyActions(source) {
  return sortedUnique([
    ...Array.from(
      source.matchAll(/'x-zerochat-proxy-action':\s*'([^']+)'/g),
      (match) => match[1],
    ),
    ...Array.from(source.matchAll(/^\s*\|\s*'([^']+)'/gm), (match) => match[1]),
    ...Array.from(source.matchAll(/proxyAction:\s*'([^']+)'/g), (match) => match[1]),
  ])
}

function extractWorkerCorsAllowHeaders(source) {
  const match = source.match(
    /'access-control-allow-headers':\s*\n\s*'([^']+)'/,
  )

  if (!match) {
    throw new Error('Worker access-control-allow-headers contract is missing')
  }

  return parseHeaderList(match[1])
}

function extractWorkerCorsExposeHeaders(source) {
  const match = source.match(
    /'access-control-expose-headers':\s*\n\s*'([^']+)'/,
  )
  if (!match) {
    throw new Error('Worker access-control-expose-headers contract is missing')
  }
  return parseHeaderList(match[1])
}

function extractWebProviderRequestHeaders(source) {
  const headerNames = [
    ...Array.from(
      source.matchAll(/['"]([a-z][a-z0-9-]*)['"]\s*:/g),
      (match) => match[1].toLowerCase(),
    ),
    ...Array.from(
      source.matchAll(/(?:^|[\s,{])([a-z][a-z0-9-]*)\s*:/g),
      (match) => match[1].toLowerCase(),
    ),
  ].filter(
    (name) =>
      name === 'authorization' ||
      name === 'content-type' ||
      name === 'x-api-key' ||
      name.startsWith('x-zerochat-') ||
      name.startsWith('anthropic-'),
  )

  return sortedUnique(headerNames)
}

function assertProxyActionContractConsistency() {
  const workerSource = readRepoText('cloudflare/sync-worker.js')
  const openApiSource = readRepoText('shared/sync-api.openapi.yaml')
  const contractSource = readRepoText('shared/ai-provider-contract.md')
  const webSource = readRepoText('src/services/providerRequests.ts')
  const workerPaths = extractWorkerProxyActionPaths(workerSource)
  const workerActions = sortedUnique(['chat', 'models', ...workerPaths.keys()])
  const openApiActions = extractOpenApiProxyActions(openApiSource)
  const contractActions = extractContractProxyActions(contractSource)
  const contractContentTypes = extractContractProxyContentTypes(contractSource)
  const contractMultipartActions = extractContractProxyMultipartActions(contractSource)
  const webActions = extractWebProxyActions(webSource)
  const openApiCorsHeaders = extractOpenApiProxyCorsAllowHeaders(openApiSource)
  const openApiHeaderParameters = extractOpenApiProxyHeaderParameters(openApiSource)
  const openApiRequestContentTypes =
    extractOpenApiProxyPostRequestContentTypes(openApiSource)
  const openApiGetResponseStatuses = extractOpenApiProxyResponseStatuses(
    openApiSource,
    'get',
  )
  const openApiPostResponseStatuses = extractOpenApiProxyResponseStatuses(
    openApiSource,
    'post',
  )
  const workerCorsHeaders = extractWorkerCorsAllowHeaders(workerSource)
  const workerCorsExposeHeaders = extractWorkerCorsExposeHeaders(workerSource)
  const webRequestHeaders = extractWebProviderRequestHeaders(webSource)

  if (
    !workerSource.includes('const jsonKeys = parseHostedProviderKeys(env.PROVIDER_KEYS)') ||
    workerSource.includes('sanitizeEnvKey') ||
    workerSource.includes('PROVIDER_KEY_')
  ) {
    throw new Error(
      'Worker-hosted provider keys must use only exact PROVIDER_KEYS JSON host mappings.',
    )
  }

  assertPathMapEquals(
    workerPaths,
    expectedWorkerProxyActionPaths,
    'Worker PROXY_ACTION_PATHS',
  )
  assertSetEquals(workerActions, expectedProxyActions, 'Worker')
  assertSetEquals(openApiActions, expectedProxyActions, 'OpenAPI')
  assertSetEquals(contractActions, expectedProxyActions, 'AI provider contract')
  assertSetEquals(
    contractContentTypes,
    expectedOpenApiProxyRequestContentTypes,
    'AI provider contract proxy request content types',
  )
  assertSetEquals(
    contractMultipartActions,
    expectedContractProxyMultipartActions,
    'AI provider contract proxy multipart actions',
  )
  assertSetEquals(webActions, expectedProxyActions, 'Web providerRequests')
  assertSetEquals(openApiActions, workerActions, 'OpenAPI versus Worker')
  assertSetEquals(contractActions, workerActions, 'AI provider contract versus Worker')
  assertSetEquals(webActions, workerActions, 'Web providerRequests versus Worker')
  assertSetEquals(
    workerCorsHeaders,
    expectedProxyCorsHeaders,
    'Worker CORS allow headers',
  )
  assertSetEquals(
    workerCorsExposeHeaders,
    expectedCorsExposeHeaders,
    'Worker CORS expose headers',
  )
  assertSetEquals(
    openApiCorsHeaders,
    expectedProxyCorsHeaders,
    'OpenAPI /proxy CORS allow headers',
  )
  assertSetEquals(
    openApiHeaderParameters,
    expectedProxyCorsHeaders.filter(
      (header) =>
        ![
          'content-type',
          'if-match',
          'if-none-match',
          'x-zerochat-sync-generation',
        ].includes(header),
    ),
    'OpenAPI /proxy header parameters',
  )
  assertSetEquals(
    openApiRequestContentTypes,
    expectedOpenApiProxyRequestContentTypes,
    'OpenAPI /proxy POST request body content types',
  )
  assertSetEquals(
    openApiGetResponseStatuses,
    expectedOpenApiProxyResponseStatuses,
    'OpenAPI /proxy GET response statuses',
  )
  assertSetEquals(
    openApiPostResponseStatuses,
    expectedOpenApiProxyResponseStatuses,
    'OpenAPI /proxy POST response statuses',
  )
  assertSetEquals(
    webRequestHeaders,
    expectedProxyCorsHeaders.filter(
      (header) =>
        ![
          'if-match',
          'if-none-match',
          'x-zerochat-sync-generation',
        ].includes(header),
    ),
    'Web provider request headers versus Worker CORS allow headers',
  )
}

assertProxyActionContractConsistency()

const env = createEnv()

const missingKeyEnv = createEnv()
delete missingKeyEnv.ZEROCHAT_ACCESS_KEY

const missingKeyResponse = await call(missingKeyEnv, '/snapshot', {
  method: 'GET',
  headers: {
    origin: 'https://zerochat.example.com',
    authorization: 'Bearer anything',
  },
})

await expectStatus(
  missingKeyResponse,
  501,
  'missing Worker access key should return a setup error',
)
await expectHeader(
  missingKeyResponse,
  'access-control-allow-origin',
  'https://zerochat.example.com',
  'missing Worker access key should still return CORS headers for the app origin',
)
await expectText(
  missingKeyResponse,
  'Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing',
  'missing Worker access key should explain the setup step',
)

if ((await autoAllowedOrigins(missingKeyEnv)).length !== 0) {
  throw new Error('missing Worker access key must not enroll a browser origin')
}

const placeholderKeyResponse = await call(
  {
    ...createEnv(),
    ZEROCHAT_ACCESS_KEY: 'replace-with-zerochat-derived-access-key',
  },
  '/proxy',
  {
    method: 'GET',
    headers: {
      'x-zerochat-access-key': 'replace-with-zerochat-derived-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1',
      'x-zerochat-proxy-action': 'models',
    },
  },
)

await expectStatus(
  placeholderKeyResponse,
  501,
  'template Worker access key placeholder should be treated as incomplete setup',
)
await expectText(
  placeholderKeyResponse,
  'Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing',
  'template Worker access key placeholder should get the setup error message',
)

const missingKvSnapshotEnv = createEnv()
delete missingKvSnapshotEnv.zerochat_kv

await expectStatus(
  await call(missingKvSnapshotEnv, '/snapshot', {
    method: 'GET',
    headers: {
      authorization: 'Bearer zerochat-access-key',
    },
  }),
  501,
  'snapshot routes should report a missing KV binding',
)

const missingKvHeadResponse = await call(missingKvSnapshotEnv, '/sync/head', {
  method: 'GET',
  headers: {
    authorization: 'Bearer zerochat-access-key',
  },
})

await expectStatus(
  missingKvHeadResponse,
  501,
  'incremental sync head should report a missing KV binding before R2 fallback',
)
await expectText(
  missingKvHeadResponse,
  'KV binding zerochat_kv is required',
  'incremental sync head should explain the missing KV binding',
)

const missingCoordinatorEnv = createEnv()
delete missingCoordinatorEnv.ZEROCHAT_SYNC_COORDINATOR
const missingCoordinatorResponse = await call(
  missingCoordinatorEnv,
  '/sync/head',
  {
    method: 'GET',
    headers: {
      authorization: 'Bearer zerochat-access-key',
    },
  },
)
await expectStatus(
  missingCoordinatorResponse,
  501,
  'incremental sync head must fail closed without the Durable Object binding',
)
await expectText(
  missingCoordinatorResponse,
  'Durable Object binding ZEROCHAT_SYNC_COORDINATOR is required',
  'incremental sync head should explain the missing strong-consistency binding',
)

const oversizedHeadResponse = await call(env, '/sync/head', {
  method: 'PUT',
  headers: {
    authorization: 'Bearer zerochat-access-key',
    'content-type': 'application/json',
    'if-none-match': '*',
  },
  body: JSON.stringify({
    kind: 'zerochat.incrementalHead',
    version: 1,
    manifestKey: `manifest-${'a'.repeat(17000)}.json`,
    updatedAt: 2000,
  }),
})

await expectStatus(
  oversizedHeadResponse,
  413,
  'incremental sync head should reject oversized chunked or declared request bodies',
)
await expectText(
  oversizedHeadResponse,
  'Incremental head too large',
  'oversized incremental heads should return a bounded client-owned error',
)

await expectStatus(
  await call(env, '/snapshot', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
    },
    body: JSON.stringify({ kind: 'plain' }),
  }),
  400,
  'plaintext snapshots must be rejected',
)

const initialSyncGeneration = await currentSyncGeneration(env)
await expectStatus(
  await call(env, '/snapshot', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
      'if-none-match': '*',
    },
    body: JSON.stringify(envelope(2000)),
  }),
  428,
  'snapshot writes must require the generation observed by the client',
)
const firstSnapshotResponse = await call(env, '/snapshot', {
  method: 'PUT',
  headers: {
    authorization: 'Bearer zerochat-access-key',
    'if-none-match': '*',
    'x-zerochat-sync-generation': initialSyncGeneration,
  },
  body: JSON.stringify(envelope(2000)),
})
await expectStatus(
  firstSnapshotResponse,
  200,
  'valid encrypted snapshot should be stored',
)

const storedSnapshotResponse = await call(env, '/snapshot', {
  method: 'GET',
  headers: {
    authorization: 'Bearer zerochat-access-key',
  },
})
await expectStatus(
  storedSnapshotResponse,
  200,
  'stored encrypted snapshot should be readable',
)
const storedSnapshotEtag = storedSnapshotResponse.headers.get('etag')
if (!/^"snapshot-sha256-[0-9a-f]{64}"$/u.test(storedSnapshotEtag ?? '')) {
  throw new Error('stored encrypted snapshot must expose a strong opaque ETag')
}
if (
  storedSnapshotResponse.headers.get('x-zerochat-sync-generation') !==
  initialSyncGeneration
) {
  throw new Error('stored snapshots must expose the current sync generation')
}
assertSetEquals(
  parseHeaderList(
    storedSnapshotResponse.headers.get('access-control-expose-headers'),
  ),
  expectedCorsExposeHeaders,
  'snapshot browser-visible response headers',
)

await expectStatus(
  await call(env, '/snapshot', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
      'if-match': storedSnapshotEtag,
      'x-zerochat-sync-generation': initialSyncGeneration,
    },
    body: JSON.stringify(envelope(1000)),
  }),
  409,
  'older snapshots must not overwrite newer snapshots',
)

const objectSyncGeneration = await currentSyncGeneration(env)
await expectStatus(
  await call(env, '/proxy', {
    method: 'POST',
    headers: {
      'x-zerochat-access-key': 'zerochat-access-key',
      'x-zerochat-base-url': 'http://api.openai.com/v1',
    },
    body: '{}',
  }),
  400,
  'proxy must reject insecure upstream URLs',
)

await expectStatus(
  await call(env, '/proxy', {
    method: 'POST',
    headers: {
      'x-zerochat-access-key': 'zerochat-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1?api_key=leak',
    },
    body: '{}',
  }),
  400,
  'proxy must reject upstream URLs with query strings',
)

await expectStatus(
  await call(env, '/proxy', {
    method: 'POST',
    headers: {
      'x-zerochat-access-key': 'zerochat-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1#token',
    },
    body: '{}',
  }),
  400,
  'proxy must reject upstream URLs with fragments',
)

const specialUseProxyHosts = [
  '192.0.2.1',
  '198.18.0.1',
  '198.51.100.2',
  '203.0.113.8',
  '224.0.0.1',
  '[2001:db8::1]',
  '[ff02::1]',
  '[::ffff:192.168.1.1]',
  '[64:ff9b::7f00:1]',
  '[2002:c0a8:0101::1]',
]
const ambiguousProxyHosts = [
  'api',
  '0',
  '2130706433',
  '0x7f000001',
  '0x7f.0.0.1',
  '0177.0.0.1',
  '127.1',
  '127.0.1',
  '999.999.999.999',
]
const unsafeProxyHosts = [...specialUseProxyHosts, ...ambiguousProxyHosts]

for (const host of unsafeProxyHosts) {
  await expectStatus(
    await call(env, '/proxy', {
      method: 'GET',
      headers: {
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': `https://${host}/v1`,
        'x-zerochat-proxy-action': 'models',
      },
    }),
    400,
    `proxy must reject unsafe upstream host ${host}`,
  )
}

await expectStatus(
  await call(env, '/proxy', {
    method: 'GET',
    headers: {
      'x-zerochat-access-key': 'zerochat-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1',
    },
  }),
  405,
  'chat proxy must reject GET',
)

await expectStatus(
  await call(env, '/proxy', {
    method: 'POST',
    headers: {
      'x-zerochat-access-key': 'zerochat-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1',
      'x-zerochat-proxy-action': 'models',
    },
    body: '{}',
  }),
  405,
  'model proxy must reject POST',
)

const missingProviderAuthorizationResponse = await call(env, '/proxy', {
  method: 'GET',
  headers: {
    'x-zerochat-access-key': 'zerochat-access-key',
    'x-zerochat-base-url': 'https://api.openai.com/v1',
    'x-zerochat-proxy-action': 'models',
  },
})
await expectStatus(
  missingProviderAuthorizationResponse,
  401,
  'proxy must reject requests without browser or hosted provider authorization',
)
if (missingProviderAuthorizationResponse.headers.has('x-zerochat-proxy-response-source')) {
  throw new Error('Worker-generated proxy errors must not claim an upstream response source')
}

await expectStatus(
  await call(
    {
      ...env,
      ALLOWED_ORIGINS: 'https://zerochat.example',
      REQUIRE_ALLOWED_ORIGINS: 'true',
    },
    '/snapshot',
    {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
      },
    },
  ),
  403,
  'strict CORS must reject unlisted browser origins',
)

const permissiveConfigCorsResponse = await call(
  {
    ...createEnv(),
    ALLOWED_ORIGINS: 'https://zerochat.example.com/',
    REQUIRE_ALLOWED_ORIGINS: 'true',
  },
  '/snapshot',
  {
    method: 'OPTIONS',
    headers: {
      origin: 'https://zerochat.example.com',
    },
  },
)

await expectStatus(
  permissiveConfigCorsResponse,
  200,
  'CORS origin config should tolerate a trailing slash',
)
await expectHeader(
  permissiveConfigCorsResponse,
  'access-control-allow-origin',
  'https://zerochat.example.com',
  'CORS response should echo normalized allowed origin',
)

const autoCorsEnv = createEnv()
const firstPreflight = await call(autoCorsEnv, '/snapshot', {
  method: 'OPTIONS',
  headers: {
    origin: 'https://zerochat.example.com',
    'access-control-request-method': 'GET',
  },
})

await expectStatus(
  firstPreflight,
  200,
  'automatic CORS should allow first preflight from a safe browser origin',
)
await expectHeader(
  firstPreflight,
  'access-control-allow-origin',
  'https://zerochat.example.com',
  'automatic CORS preflight should echo the pending origin',
)

if ((await autoAllowedOrigins(autoCorsEnv)).length !== 0) {
  throw new Error('automatic CORS must not enroll an origin from preflight only')
}

const firstOriginRequest = await call(autoCorsEnv, '/snapshot', {
  method: 'GET',
  headers: {
    origin: 'https://zerochat.example.com',
    authorization: 'Bearer zerochat-access-key',
  },
})

await expectStatus(
  firstOriginRequest,
  404,
  'valid token request from a new safe origin should reach the sync route',
)
await expectHeader(
  firstOriginRequest,
  'access-control-allow-origin',
  'https://zerochat.example.com',
  'valid token request from a new safe origin should get CORS headers',
)

if (!(await autoAllowedOrigins(autoCorsEnv)).includes('https://zerochat.example.com')) {
  throw new Error('valid token request should enroll the browser origin')
}

await expectStatus(
  await call(autoCorsEnv, '/snapshot', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://zerochat.example.com',
      'access-control-request-method': 'GET',
    },
  }),
  200,
  'enrolled automatic CORS origin should pass later preflight',
)

await expectStatus(
  await call(
    {
      ...autoCorsEnv,
      AUTO_ALLOWED_ORIGINS: 'false',
      ALLOWED_ORIGINS: 'https://locked.example.com',
      REQUIRE_ALLOWED_ORIGINS: 'true',
    },
    '/snapshot',
    {
      method: 'OPTIONS',
      headers: {
        origin: 'https://zerochat.example.com',
        'access-control-request-method': 'GET',
      },
    },
  ),
  403,
  'manual CORS mode must ignore previously learned automatic origins',
)

const badCorsEnv = createEnv()

await expectStatus(
  await call(badCorsEnv, '/snapshot', {
    method: 'GET',
    headers: {
      origin: 'https://evil.example.com',
      authorization: 'Bearer wrong-access-key',
    },
  }),
  403,
  'automatic CORS must reject new origins without a valid route token',
)

if ((await autoAllowedOrigins(badCorsEnv)).length !== 0) {
  throw new Error('automatic CORS must not enroll origins with invalid tokens')
}

const originalFetch = globalThis.fetch
let upstreamProxyRequest = null
const defaultUpstreamProxyResponse = () =>
  new Response(
    JSON.stringify({
      data: [{ id: 'model-b' }, { id: 'model-a' }],
    }),
    { headers: { 'content-type': 'application/json' } },
  )
let upstreamProxyResponse = defaultUpstreamProxyResponse
globalThis.fetch = async (url, init = {}) => {
  upstreamProxyRequest = {
    url: String(url),
    method: init.method,
    redirect: init.redirect,
    body: init.body,
    headers: new Headers(init.headers),
  }

  return upstreamProxyResponse()
}

try {
  const modelListResponse = await call(env, '/proxy', {
    method: 'GET',
    headers: {
      authorization: 'Bearer provider-key',
      'x-zerochat-access-key': 'zerochat-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1/chat/completions',
      'x-zerochat-proxy-action': 'models',
    },
  })

  await expectStatus(
    modelListResponse,
    200,
    'model proxy should forward GET requests',
  )

  if (upstreamProxyRequest?.url !== 'https://api.openai.com/v1/models') {
    throw new Error('model proxy must rewrite chat endpoint to model endpoint')
  }

  if (upstreamProxyRequest.method !== 'GET') {
    throw new Error('model proxy must use GET upstream')
  }

  if (upstreamProxyRequest.redirect !== 'manual') {
    throw new Error('model proxy must not auto-follow upstream redirects')
  }

  if (upstreamProxyRequest.headers.get('authorization') !== 'Bearer provider-key') {
    throw new Error('model proxy must forward provider authorization')
  }
  await expectHeader(
    modelListResponse,
    'x-zerochat-proxy-response-source',
    'upstream',
    'model proxy should mark responses that were forwarded from upstream',
  )

  upstreamProxyResponse = () =>
    new Response('<!DOCTYPE html><html><title>Just a moment...</title></html>', {
      status: 403,
      headers: {
        'cf-ray': 'fixture-ray-id',
        'content-type': 'text/html',
        server: 'cloudflare',
      },
    })
  const cloudflareEdgeResponse = await call(env, '/proxy', {
    method: 'GET',
    headers: {
      authorization: 'Bearer provider-key',
      'x-zerochat-access-key': 'zerochat-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1',
      'x-zerochat-proxy-action': 'models',
    },
  })

  await expectStatus(
    cloudflareEdgeResponse,
    403,
    'model proxy should preserve upstream Cloudflare edge failures',
  )
  await expectHeader(
    cloudflareEdgeResponse,
    'x-zerochat-upstream-edge',
    'cloudflare',
    'model proxy should expose only a bounded upstream edge classification',
  )
  await expectHeader(
    cloudflareEdgeResponse,
    'x-zerochat-proxy-response-source',
    'upstream',
    'model proxy should preserve upstream response provenance without exposing identifiers',
  )
  if (
    cloudflareEdgeResponse.headers.has('cf-ray') ||
    cloudflareEdgeResponse.headers.has('server')
  ) {
    throw new Error('model proxy must not expose raw upstream edge identifiers')
  }

  upstreamProxyResponse = () => {
    throw new TypeError('diagnostic upstream URL and transport detail must stay private')
  }
  const upstreamTransportFailureResponse = await call(env, '/proxy', {
    method: 'GET',
    headers: {
      authorization: 'Bearer provider-key',
      'x-zerochat-access-key': 'zerochat-access-key',
      'x-zerochat-base-url': 'https://api.openai.com/v1',
      'x-zerochat-proxy-action': 'models',
    },
  })

  await expectStatus(
    upstreamTransportFailureResponse,
    502,
    'model proxy should contain upstream transport failures',
  )
  await expectText(
    upstreamTransportFailureResponse,
    'Upstream request failed',
    'model proxy should not expose upstream transport details',
  )
  await expectHeader(
    upstreamTransportFailureResponse,
    'x-zerochat-proxy-response-source',
    'transport-error',
    'model proxy should distinguish contained transport failures from upstream responses',
  )
  upstreamProxyResponse = defaultUpstreamProxyResponse

  const hostedModelListResponse = await call(
    {
      ...env,
      ALLOW_HOSTED_PROVIDER_KEYS: 'true',
      PROVIDER_KEYS: JSON.stringify({
        'api.openai.com': 'hosted-provider-key',
      }),
    },
    '/proxy',
    {
      method: 'GET',
      headers: {
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api.openai.com/v1/chat/completions',
        'x-zerochat-proxy-action': 'models',
      },
    },
  )

  await expectStatus(
    hostedModelListResponse,
    200,
    'hosted provider key proxy should forward GET requests',
  )

  if (
    upstreamProxyRequest?.headers.get('authorization') !==
    'Bearer hosted-provider-key'
  ) {
    throw new Error('hosted provider key must be injected as upstream authorization')
  }

  const collidingHostEnv = {
    ...createEnv(),
    ALLOWED_HOSTS: 'api-openai.com',
    ALLOW_HOSTED_PROVIDER_KEYS: 'true',
    PROVIDER_KEYS: JSON.stringify({
      'api.openai.com': 'exact-host-provider-key',
    }),
    ['PROVIDER' + '_KEY_API_OPENAI_COM']: 'legacy-host-provider-key',
  }
  upstreamProxyRequest = null

  await expectStatus(
    await call(collidingHostEnv, '/proxy', {
      method: 'GET',
      headers: {
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api-openai.com/v1',
        'x-zerochat-proxy-action': 'models',
      },
    }),
    401,
    'hosted provider keys must not cross normalized-name collision domains',
  )

  if (upstreamProxyRequest !== null) {
    throw new Error('hosted provider keys must not forward collision-domain requests upstream')
  }

  upstreamProxyRequest = null

  await expectStatus(
    await call(env, '/proxy', {
      method: 'POST',
      headers: {
        authorization: 'Bearer provider-key',
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api.openai.com/v1/images/generations',
        'x-zerochat-proxy-action': 'image-responses',
      },
      body: JSON.stringify({
        model: 'gpt-5',
        input: 'Draw OK',
        tools: [{ type: 'image_generation', action: 'generate' }],
        store: false,
      }),
    }),
    200,
    'Responses image proxy should forward POST requests',
  )

  if (upstreamProxyRequest?.url !== 'https://api.openai.com/v1/responses') {
    throw new Error('Responses image proxy must rewrite image endpoint roots to /responses')
  }

  if (upstreamProxyRequest.method !== 'POST') {
    throw new Error('Responses image proxy must use POST upstream')
  }

  if (upstreamProxyRequest.headers.get('content-type') !== 'application/json') {
    throw new Error('Responses image proxy must preserve the JSON content type')
  }

  upstreamProxyRequest = null

  await expectStatus(
    await call(env, '/proxy', {
      method: 'POST',
      headers: {
        authorization: 'Bearer provider-key',
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api.openai.com/v1/chat/completions',
        'x-zerochat-proxy-action': 'embeddings',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: 'ZeroChat connectivity check',
      }),
    }),
    200,
    'Embeddings proxy should forward POST requests',
  )

  if (upstreamProxyRequest?.url !== 'https://api.openai.com/v1/embeddings') {
    throw new Error('Embeddings proxy must rewrite chat endpoint roots to /embeddings')
  }

  if (upstreamProxyRequest.method !== 'POST') {
    throw new Error('Embeddings proxy must use POST upstream')
  }

  if (upstreamProxyRequest.headers.get('content-type') !== 'application/json') {
    throw new Error('Embeddings proxy must preserve the JSON content type')
  }

  upstreamProxyRequest = null

  await expectStatus(
    await call(env, '/proxy', {
      method: 'POST',
      headers: {
        authorization: 'Bearer provider-key',
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api.openai.com/v1/responses',
        'x-zerochat-proxy-action': 'moderations',
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: 'ZeroChat moderation check',
      }),
    }),
    200,
    'Moderations proxy should forward POST requests',
  )

  if (upstreamProxyRequest?.url !== 'https://api.openai.com/v1/moderations') {
    throw new Error('Moderations proxy must rewrite responses endpoint roots to /moderations')
  }

  if (upstreamProxyRequest.method !== 'POST') {
    throw new Error('Moderations proxy must use POST upstream')
  }

  if (upstreamProxyRequest.headers.get('content-type') !== 'application/json') {
    throw new Error('Moderations proxy must preserve the JSON content type')
  }

  upstreamProxyRequest = null

  await expectStatus(
    await call(env, '/proxy', {
      method: 'POST',
      headers: {
        authorization: 'Bearer provider-key',
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api.openai.com/v1/audio/transcriptions',
        'x-zerochat-proxy-action': 'audio-speech',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: 'ZeroChat speech check',
        voice: 'alloy',
      }),
    }),
    200,
    'Audio speech proxy should forward POST requests',
  )

  if (upstreamProxyRequest?.url !== 'https://api.openai.com/v1/audio/speech') {
    throw new Error('Audio speech proxy must rewrite audio endpoint roots to /audio/speech')
  }

  if (upstreamProxyRequest.method !== 'POST') {
    throw new Error('Audio speech proxy must use POST upstream')
  }

  if (upstreamProxyRequest.headers.get('content-type') !== 'application/json') {
    throw new Error('Audio speech proxy must preserve the JSON content type')
  }

  upstreamProxyRequest = null

  await expectStatus(
    await call(env, '/proxy', {
      method: 'POST',
      headers: {
        authorization: 'Bearer provider-key',
        'content-type': 'multipart/form-data; boundary=zerochat-test',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api.openai.com/v1/chat/completions',
        'x-zerochat-proxy-action': 'audio-transcriptions',
      },
      body:
        '--zerochat-test\r\ncontent-disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--zerochat-test--\r\n',
    }),
    200,
    'Audio transcription proxy should forward POST requests',
  )

  if (
    upstreamProxyRequest?.url !==
    'https://api.openai.com/v1/audio/transcriptions'
  ) {
    throw new Error('Audio transcription proxy must rewrite chat endpoint roots to /audio/transcriptions')
  }

  if (upstreamProxyRequest.method !== 'POST') {
    throw new Error('Audio transcription proxy must use POST upstream')
  }

  if (
    upstreamProxyRequest.headers.get('content-type') !==
    'multipart/form-data; boundary=zerochat-test'
  ) {
    throw new Error('Audio transcription proxy must preserve the multipart content type')
  }

  upstreamProxyRequest = null

  await expectStatus(
    await call(env, '/proxy', {
      method: 'POST',
      headers: {
        authorization: 'Bearer provider-key',
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api.openai.com/v1/models',
        'x-zerochat-proxy-action': 'realtime',
      },
      body: JSON.stringify({
        model: 'gpt-realtime',
        modalities: ['text'],
      }),
    }),
    200,
    'Realtime proxy should forward POST requests',
  )

  if (upstreamProxyRequest?.url !== 'https://api.openai.com/v1/realtime') {
    throw new Error('Realtime proxy must rewrite model endpoint roots to /realtime')
  }

  if (upstreamProxyRequest.method !== 'POST') {
    throw new Error('Realtime proxy must use POST upstream')
  }

  if (upstreamProxyRequest.headers.get('content-type') !== 'application/json') {
    throw new Error('Realtime proxy must preserve the JSON content type')
  }

  upstreamProxyRequest = null

  await expectStatus(
    await call(env, '/proxy', {
      method: 'POST',
      headers: {
        authorization: 'Bearer provider-key',
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api.openai.com/v1/realtime',
        'x-zerochat-proxy-action': 'realtime-client-secrets',
      },
      body: JSON.stringify({
        expires_after: {
          anchor: 'created_at',
          seconds: 600,
        },
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          output_modalities: ['text'],
        },
      }),
    }),
    200,
    'Realtime client-secret proxy should forward POST requests',
  )

  if (
    upstreamProxyRequest?.url !==
    'https://api.openai.com/v1/realtime/client_secrets'
  ) {
    throw new Error(
      'Realtime client-secret proxy must rewrite realtime roots to /realtime/client_secrets',
    )
  }

  if (upstreamProxyRequest.method !== 'POST') {
    throw new Error('Realtime client-secret proxy must use POST upstream')
  }

  if (upstreamProxyRequest.headers.get('content-type') !== 'application/json') {
    throw new Error(
      'Realtime client-secret proxy must preserve the JSON content type',
    )
  }

  const defaultHostEnv = createEnv()
  delete defaultHostEnv.ALLOWED_HOSTS
  upstreamProxyRequest = null

  await expectStatus(
    await call(defaultHostEnv, '/proxy', {
      method: 'GET',
      headers: {
        authorization: 'Bearer provider-key',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://api.openai.com/v1',
        'x-zerochat-proxy-action': 'models',
      },
    }),
    200,
    'default proxy host allowlist should allow built-in official providers',
  )

  if (upstreamProxyRequest?.url !== 'https://api.openai.com/v1/models') {
    throw new Error('default proxy host allowlist must still forward models')
  }

  await expectStatus(
    await call(defaultHostEnv, '/proxy', {
      method: 'GET',
      headers: {
        authorization: 'Bearer provider-key',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://relay.example.com/v1',
        'x-zerochat-proxy-action': 'models',
      },
    }),
    200,
    'custom relay hosts should auto-enroll after a valid access key',
  )

  if (!(await autoAllowedHosts(defaultHostEnv)).includes('relay.example.com')) {
    throw new Error('custom relay host should be remembered after valid proxy use')
  }

  const browserHostedRelayEnv = {
    ...createEnv(),
    ALLOW_HOSTED_PROVIDER_KEYS: 'true',
    PROVIDER_KEYS: JSON.stringify({
      'relay.example.com': 'hosted-relay-provider-key',
    }),
  }
  delete browserHostedRelayEnv.ALLOWED_HOSTS

  const browserHostedRelayPreflight = await call(
    browserHostedRelayEnv,
    '/proxy',
    {
      method: 'OPTIONS',
      headers: {
        origin: 'https://zerochat.example.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': expectedProxyCorsHeaders.join(', '),
      },
    },
  )

  await expectStatus(
    browserHostedRelayPreflight,
    200,
    'browser AI proxy should allow first preflight for a safe app origin',
  )
  await expectHeader(
    browserHostedRelayPreflight,
    'access-control-allow-origin',
    'https://zerochat.example.com',
    'browser AI proxy preflight should echo the pending app origin',
  )

  if ((await autoAllowedOrigins(browserHostedRelayEnv)).length !== 0) {
    throw new Error('browser AI proxy preflight must not enroll an app origin')
  }

  assertSetEquals(
    parseHeaderList(
      browserHostedRelayPreflight.headers.get('access-control-allow-headers'),
    ),
    expectedProxyCorsHeaders,
    'browser AI proxy preflight CORS allow headers',
  )

  upstreamProxyRequest = null

  const browserHostedRelayResponse = await call(
    browserHostedRelayEnv,
    '/proxy',
    {
      method: 'GET',
      headers: {
        origin: 'https://zerochat.example.com',
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://relay.example.com/v1/chat/completions',
        'x-zerochat-proxy-action': 'models',
      },
    },
  )

  await expectStatus(
    browserHostedRelayResponse,
    200,
    'browser AI proxy should forward custom relay models with a Worker-hosted key',
  )
  await expectHeader(
    browserHostedRelayResponse,
    'access-control-allow-origin',
    'https://zerochat.example.com',
    'browser AI proxy response should keep CORS open after valid access-key auth',
  )

  if (upstreamProxyRequest?.url !== 'https://relay.example.com/v1/models') {
    throw new Error('browser AI proxy must rewrite custom relay chat roots to /models')
  }

  if (
    upstreamProxyRequest.headers.get('authorization') !==
    'Bearer hosted-relay-provider-key'
  ) {
    throw new Error('browser AI proxy must inject the Worker-hosted provider key upstream')
  }

  if ((await autoAllowedHosts(browserHostedRelayEnv)).join(',') !== 'relay.example.com') {
    throw new Error('browser AI proxy should remember the custom relay host after a valid request')
  }

  if (
    !(await autoAllowedOrigins(browserHostedRelayEnv)).includes(
      'https://zerochat.example.com',
    )
  ) {
    throw new Error('browser AI proxy should remember the app origin after a valid request')
  }

  const browserHostedRelayActionCases = [
    {
      action: 'chat',
      expectedUrl: 'https://relay.example.com/v1/chat/completions',
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'ZeroChat browser relay check' }],
      }),
    },
    {
      action: 'image-generations',
      expectedUrl: 'https://relay.example.com/v1/images/generations',
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: 'ZeroChat browser relay check',
      }),
    },
    {
      action: 'image-edits',
      expectedUrl: 'https://relay.example.com/v1/images/edits',
      contentType: 'multipart/form-data; boundary=zerochat-image-edit',
      body:
        '--zerochat-image-edit\r\ncontent-disposition: form-data; name="prompt"\r\n\r\nZeroChat edit\r\n--zerochat-image-edit--\r\n',
    },
    {
      action: 'image-responses',
      expectedUrl: 'https://relay.example.com/v1/responses',
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'gpt-5.5',
        input: 'Create an image',
        tools: [{ type: 'image_generation', action: 'generate' }],
      }),
    },
    {
      action: 'audio-speech',
      expectedUrl: 'https://relay.example.com/v1/audio/speech',
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: 'ZeroChat browser relay check',
        voice: 'alloy',
      }),
    },
    {
      action: 'audio-transcriptions',
      expectedUrl: 'https://relay.example.com/v1/audio/transcriptions',
      contentType: 'multipart/form-data; boundary=zerochat-audio',
      body:
        '--zerochat-audio\r\ncontent-disposition: form-data; name="model"\r\n\r\ngpt-4o-transcribe\r\n--zerochat-audio--\r\n',
    },
    {
      action: 'embeddings',
      expectedUrl: 'https://relay.example.com/v1/embeddings',
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'text-embedding-3-large',
        input: 'ZeroChat browser relay check',
      }),
    },
    {
      action: 'moderations',
      expectedUrl: 'https://relay.example.com/v1/moderations',
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: 'ZeroChat browser relay check',
      }),
    },
    {
      action: 'realtime',
      expectedUrl: 'https://relay.example.com/v1/realtime',
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'gpt-realtime',
        modalities: ['text'],
      }),
    },
    {
      action: 'realtime-client-secrets',
      expectedUrl: 'https://relay.example.com/v1/realtime/client_secrets',
      contentType: 'application/json',
      body: JSON.stringify({
        expires_after: {
          anchor: 'created_at',
          seconds: 600,
        },
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          output_modalities: ['text'],
        },
      }),
    },
  ]

  for (const testCase of browserHostedRelayActionCases) {
    upstreamProxyRequest = null

    const response = await call(browserHostedRelayEnv, '/proxy', {
      method: 'POST',
      headers: {
        origin: 'https://zerochat.example.com',
        'content-type': testCase.contentType,
        'x-zerochat-access-key': 'zerochat-access-key',
        'x-zerochat-base-url': 'https://relay.example.com/v1/chat/completions',
        'x-zerochat-proxy-action': testCase.action,
      },
      body: testCase.body,
    })

    await expectStatus(
      response,
      200,
      `browser AI proxy should forward ${testCase.action} with a Worker-hosted key`,
    )
    await expectHeader(
      response,
      'access-control-allow-origin',
      'https://zerochat.example.com',
      `browser AI proxy ${testCase.action} response should keep CORS open`,
    )

    if (upstreamProxyRequest?.url !== testCase.expectedUrl) {
      throw new Error(
        `browser AI proxy ${testCase.action} must rewrite to ${testCase.expectedUrl}`,
      )
    }

    if (upstreamProxyRequest.method !== 'POST') {
      throw new Error(`browser AI proxy ${testCase.action} must use POST upstream`)
    }

    if (
      upstreamProxyRequest.headers.get('authorization') !==
      'Bearer hosted-relay-provider-key'
    ) {
      throw new Error(
        `browser AI proxy ${testCase.action} must inject the Worker-hosted provider key upstream`,
      )
    }

    if (upstreamProxyRequest.headers.get('content-type') !== testCase.contentType) {
      throw new Error(
        `browser AI proxy ${testCase.action} must preserve the request content type`,
      )
    }
  }

  await expectStatus(
    await call(
      {
        ...createEnv(),
        AUTO_ALLOWED_HOSTS: 'false',
      },
      '/proxy',
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer provider-key',
          'x-zerochat-access-key': 'zerochat-access-key',
          'x-zerochat-base-url': 'https://relay.example.com/v1',
          'x-zerochat-proxy-action': 'models',
        },
      },
    ),
    403,
    'custom relay hosts should require explicit allowlisting when auto host learning is disabled',
  )

  const badProxyTokenEnv = createEnv()

  await expectStatus(
    await call(badProxyTokenEnv, '/proxy', {
      method: 'GET',
      headers: {
        authorization: 'Bearer provider-key',
        'x-zerochat-access-key': 'wrong-access-key',
        'x-zerochat-base-url': 'https://relay.example.com/v1',
        'x-zerochat-proxy-action': 'models',
      },
    }),
    401,
    'custom relay host auto-enroll must require a valid access key',
  )

  if ((await autoAllowedHosts(badProxyTokenEnv)).length !== 0) {
    throw new Error('custom relay host must not be remembered after an invalid access key')
  }

  const hostReplaceEnv = createEnv()

  await expectStatus(
    await call(hostReplaceEnv, '/proxy/hosts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
      },
      body: JSON.stringify({
        baseUrls: [
          'https://relay-a.example.com/v1',
          'https://relay-b.example.com/v1/chat/completions',
        ],
      }),
    }),
    200,
    'proxy host management should accept a full replacement list',
  )

  const firstManagedHosts = await autoAllowedHosts(hostReplaceEnv)

  if (
    firstManagedHosts.join(',') !==
    'relay-a.example.com,relay-b.example.com'
  ) {
    throw new Error('proxy host management should store sanitized hosts')
  }

  await expectStatus(
    await call(hostReplaceEnv, '/proxy/hosts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
      },
      body: JSON.stringify({
        baseUrls: ['https://relay-b.example.com/v1'],
      }),
    }),
    200,
    'proxy host management should replace removed custom hosts',
  )

  const replacedHosts = await autoAllowedHosts(hostReplaceEnv)

  if (replacedHosts.join(',') !== 'relay-b.example.com') {
    throw new Error('proxy host management should remove absent hosts')
  }

  await expectStatus(
    await call(hostReplaceEnv, '/proxy/hosts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
      },
      body: JSON.stringify({
        baseUrls: [],
      }),
    }),
    200,
    'proxy host management should accept an empty replacement list',
  )

  if ((await autoAllowedHosts(hostReplaceEnv)).length !== 0) {
    throw new Error('proxy host management should clear all learned hosts')
  }

  await expectStatus(
    await call(createEnv(), '/proxy/hosts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
      },
      body: JSON.stringify({
        baseUrls: ['http://relay.example.com/v1'],
      }),
    }),
  400,
  'proxy host management should reject unsafe upstream URLs',
)

for (const host of unsafeProxyHosts) {
  await expectStatus(
    await call(createEnv(), '/proxy/hosts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-zerochat-access-key': 'zerochat-access-key',
      },
      body: JSON.stringify({
        baseUrls: [`https://${host}/v1`],
      }),
    }),
    400,
    `proxy host management should reject unsafe upstream host ${host}`,
  )
}

await expectStatus(
  await call(createEnv(), '/proxy/hosts', {
    method: 'PUT',
    headers: {
        'content-type': 'application/json',
        'x-zerochat-access-key': 'wrong-access-key',
      },
      body: JSON.stringify({
        baseUrls: ['https://relay.example.com/v1'],
      }),
    }),
    401,
    'proxy host management should require a valid access key',
  )

  upstreamProxyRequest = null

  await expectStatus(
    await call(
      {
        ...createEnv(),
        ALLOWED_HOSTS: 'https://relay.example.com/v1',
      },
      '/proxy',
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer provider-key',
          'x-zerochat-access-key': 'zerochat-access-key',
          'x-zerochat-base-url': 'https://relay.example.com/v1',
          'x-zerochat-proxy-action': 'models',
        },
      },
    ),
    200,
    'custom relay allowlist should accept a pasted HTTPS Base URL',
  )

  if (upstreamProxyRequest?.url !== 'https://relay.example.com/v1/models') {
    throw new Error('custom relay allowlist must forward to the relay models URL')
  }
} finally {
  globalThis.fetch = originalFetch
}

await expectStatus(
  await call(env, '/sync/object/chunk-00000000-0000-4000-8000-000000000000.json', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
      'x-zerochat-sync-generation': objectSyncGeneration,
    },
    body: JSON.stringify(objectEnvelope('conversationChunk:test:0', 3000)),
  }),
  200,
  'valid encrypted incremental object should be stored',
)

await expectStatus(
  await call(env, '/sync/object/skill-00000000-0000-4000-8000-000000000000.json', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
      'x-zerochat-sync-generation': objectSyncGeneration,
    },
    body: JSON.stringify(objectEnvelope('skillChunk:skill-1:chunk-1', 3000)),
  }),
  200,
  'valid encrypted skill incremental object should be stored',
)

const clearResponse = await call(env, '/sync/clear', {
    method: 'DELETE',
    headers: {
      authorization: 'Bearer zerochat-access-key',
    },
  })
await expectStatus(
  clearResponse,
  200,
  'bulk clear should delete all incremental objects',
)
const postClearSyncGeneration = clearResponse.headers.get(
  'x-zerochat-sync-generation',
)
if (!postClearSyncGeneration || postClearSyncGeneration === objectSyncGeneration) {
  throw new Error('bulk clear must rotate and expose the sync generation')
}

await expectStatus(
  await call(env, '/sync/object/chunk-00000000-0000-4000-8000-000000000002.json', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
      'x-zerochat-sync-generation': objectSyncGeneration,
    },
    body: JSON.stringify(objectEnvelope('conversationChunk:test:2', 3000)),
  }),
  412,
  'clear must reject object uploads from the previous sync generation',
)

await expectStatus(
  await call(env, '/sync/object/chunk-00000000-0000-4000-8000-000000000000.json', {
    method: 'GET',
    headers: {
      authorization: 'Bearer zerochat-access-key',
      'x-zerochat-sync-generation': postClearSyncGeneration,
    },
  }),
  404,
  'bulk clear should remove stale message chunk objects',
)

await expectStatus(
  await call(env, '/sync/object/skill-00000000-0000-4000-8000-000000000000.json', {
    method: 'GET',
    headers: {
      authorization: 'Bearer zerochat-access-key',
    },
  }),
  404,
  'bulk clear should remove stale skill chunk objects',
)

await expectStatus(
  await call(env, '/sync/object/chunk-00000000-0000-4000-8000-000000000001.json', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
    },
    body: JSON.stringify({
      ...objectEnvelope('conversationChunk:test:1', 3000),
      crypto: {
        ...objectEnvelope('conversationChunk:test:1', 3000).crypto,
        aad: base64(encoder.encode('wrong')),
      },
    }),
  }),
  400,
  'incremental objects with mismatched aad must be rejected',
)

await expectStatus(
  await call(env, '/sync/head', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
    },
    body: JSON.stringify({
      kind: 'zerochat.incrementalHead',
      version: 1,
      manifestKey: 'manifest-00000000-0000-4000-8000-000000000000.json',
      updatedAt: 3000,
    }),
  }),
  428,
  'incremental head must reject writes without one explicit precondition',
)

await expectStatus(
  await call(env, '/sync/head', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
      'x-zerochat-sync-generation': postClearSyncGeneration,
      'if-none-match': '*',
    },
    body: JSON.stringify({
      kind: 'zerochat.incrementalHead',
      version: 1,
      manifestKey: 'manifest-00000000-0000-4000-8000-000000000000.json',
      updatedAt: 3000,
    }),
  }),
  200,
  'valid incremental head should be stored',
)

await expectStatus(
  await call(env, '/sync/head', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer zerochat-access-key',
      'x-zerochat-sync-generation': postClearSyncGeneration,
      'if-match': '"manifest-00000000-0000-4000-8000-000000000000.json"',
    },
    body: JSON.stringify({
      kind: 'zerochat.incrementalHead',
      version: 1,
      manifestKey: 'manifest-00000000-0000-4000-8000-000000000000.json',
      updatedAt: 2000,
    }),
  }),
  409,
  'incremental head must not move backwards',
)

console.log('Worker security checks passed')
