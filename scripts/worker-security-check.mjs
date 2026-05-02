import worker from '../cloudflare/sync-worker.js'

const encoder = new TextEncoder()

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

function createEnv() {
  const store = new Map()

  return {
    SYNC_TOKEN: 'sync-token',
    PROXY_TOKEN: 'proxy-token',
    ALLOWED_HOSTS: 'api.openai.com',
    ZEROCHAT_SYNC: {
      async get(key) {
        return store.get(key) ?? null
      },
      async put(key, value) {
        store.set(key, value)
      },
    },
  }
}

async function call(env, path, init) {
  return worker.fetch(new Request(`https://zerochat.test${path}`, init), env)
}

async function expectStatus(actual, expected, message) {
  if (actual.status !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual.status}`)
  }
}

const env = createEnv()

await expectStatus(
  await call(env, '/snapshot', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer sync-token',
    },
    body: JSON.stringify({ kind: 'plain' }),
  }),
  400,
  'plaintext snapshots must be rejected',
)

await expectStatus(
  await call(env, '/snapshot', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer sync-token',
    },
    body: JSON.stringify(envelope(2000)),
  }),
  200,
  'valid encrypted snapshot should be stored',
)

await expectStatus(
  await call(env, '/snapshot', {
    method: 'PUT',
    headers: {
      authorization: 'Bearer sync-token',
    },
    body: JSON.stringify(envelope(1000)),
  }),
  409,
  'older snapshots must not overwrite newer snapshots',
)

await expectStatus(
  await call(env, '/snapshot', {
    method: 'GET',
    headers: {
      authorization: 'Bearer sync-token',
    },
  }),
  200,
  'stored encrypted snapshot should be readable',
)

await expectStatus(
  await call(env, '/proxy', {
    method: 'POST',
    headers: {
      'x-zerochat-proxy-token': 'proxy-token',
      'x-zerochat-base-url': 'http://api.openai.com/v1',
    },
    body: '{}',
  }),
  400,
  'proxy must reject insecure upstream URLs',
)

console.log('Worker security checks passed')
