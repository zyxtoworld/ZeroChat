import assert from 'node:assert/strict'
import { createServer } from 'vite'
import worker, { ZeroChatSyncCoordinator } from '../cloudflare/sync-worker.js'
import { createBoundedViteSsrModuleRunner } from './vite-ssr-module-runner.mjs'

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

function createEnv(accessKey) {
  const kv = new Map()
  const r2 = new Map()
  const coordinatorStorage = new MemoryDurableStorage()

  const env = {
    ZEROCHAT_ACCESS_KEY: accessKey,
    zerochat_kv: {
      async get(key) {
        return kv.get(key) ?? null
      },
      async put(key, value) {
        kv.set(key, value)
      },
      async delete(key) {
        kv.delete(key)
      },
    },
    zerochat_r2: {
      async get(key) {
        const value = r2.get(key)

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
        r2.set(key, value)
      },
      async delete(key) {
        r2.delete(key)
      },
      async list(options = {}) {
        const limit = options.limit ?? 1000
        const offset = Number(options.cursor ?? 0)
        const keys = Array.from(r2.keys()).sort()
        const page = keys.slice(offset, offset + limit)
        const nextOffset = offset + page.length

        return {
          objects: page.map((key) => ({ key })),
          truncated: nextOffset < keys.length,
          cursor: String(nextOffset),
        }
      },
    },
    inspect() {
      return { coordinatorStorage: coordinatorStorage.records, kv, r2 }
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

function installWorkerFetch(env, endpointOrigin) {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)

    if (url.origin !== endpointOrigin) {
      return originalFetch(request)
    }

    const workerRequest = new Request(
      `https://zerochat.local${url.pathname}${url.search}`,
      request,
    )

    return worker.fetch(workerRequest, env)
  }

  return () => {
    globalThis.fetch = originalFetch
  }
}

function baseAppData({ skill, updatedAt, endpoint }) {
  return {
    version: 1,
    providers: [],
    conversations: [],
    skills: skill ? [skill] : [],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    sync: {
      mode: 'cloudflare',
      autoSync: true,
      encryptionEnabled: true,
      workerEndpoint: endpoint,
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
    },
    updatedAt,
  }
}

const endpoint = 'https://sync-e2e.zerochat.test'
const passphrase = 'cloud sync e2e disposable password'
const server = await createServer({
  logLevel: 'error',
  server: {
    middlewareMode: true,
    ws: {
      port: 24680,
    },
  },
})
const moduleRunner = createBoundedViteSsrModuleRunner(server)

try {
  const sync = await moduleRunner.import('/src/services/sync.ts')
  const skills = await moduleRunner.import('/src/services/skills.ts')
  const accessKey = await moduleRunner.import('/src/services/accessKey.ts')

  const token = await accessKey.accessKeyFromPassword(passphrase)
  const env = createEnv(token)
  const restoreFetch = installWorkerFetch(env, endpoint)
  const syncContext = {
    encryptionPassphrase: passphrase,
    githubToken: '',
    providerKeys: {},
  }

  try {
    const skill = await skills.createUserSkillFromContent(
      'Cloud sync E2E skill',
      [
        '# Review checklist',
        'Check layout, copy, accessibility, sync cleanup, and release gates.',
      ].join('\n'),
      'markdown',
    )
    const firstDevice = baseAppData({
      skill,
      updatedAt: 1000,
      endpoint,
    })

    const upload = await sync.performSync(firstDevice, syncContext)
    const { coordinatorStorage, r2 } = env.inspect()
    const uploadedSkillObjects = Array.from(r2.keys()).filter((key) =>
      key.startsWith('skill-'),
    )

    assert.equal(upload.remoteAccepted, false, 'first device should upload local data')
    assert.equal(uploadedSkillObjects.length, 1, 'skill upload should create one R2 skill object')
    assert.ok(
      coordinatorStorage.get('incremental-head'),
      'worker should store a strongly consistent incremental sync head',
    )

    const secondDevice = baseAppData({
      skill: null,
      updatedAt: 2000,
      endpoint,
    })
    const pull = await sync.performSync(secondDevice, syncContext)

    assert.equal(pull.remoteAccepted, true, 'empty second device should accept cloud data')
    assert.equal(pull.data.skills.length, 1, 'second device should receive the cloud skill')
    assert.equal(
      pull.data.skills[0].name,
      'Cloud sync E2E skill',
      'second device should receive the uploaded skill metadata',
    )
    assert.match(
      pull.data.skills[0].chunks[0].content,
      /layout, copy, accessibility/,
      'second device should receive the uploaded skill content',
    )

    const metadataOnlySkill = {
      ...pull.data.skills[0],
      fixed: !pull.data.skills[0].fixed,
      updatedAt: Date.now() + 250,
    }
    const metadataOnly = await sync.performSync(
      {
        ...pull.data,
        skills: [metadataOnlySkill],
        updatedAt: Date.now() + 300,
      },
      syncContext,
    )
    const metadataOnlySkillObjects = Array.from(r2.keys())
      .filter((key) => key.startsWith('skill-'))
      .sort()

    assert.equal(metadataOnly.remoteAccepted, false, 'skill metadata change should upload local state')
    assert.deepEqual(
      metadataOnlySkillObjects,
      uploadedSkillObjects.slice().sort(),
      'skill metadata-only changes should reuse the encrypted skill content object',
    )

    const editedDraft = await skills.createUserSkillFromContent(
      'Cloud sync E2E skill',
      [
        '# Review checklist',
        'Updated skill content should replace the old encrypted remote object and still pull to a new device.',
      ].join('\n'),
      'markdown',
    )
    const editedSkill = {
      ...editedDraft,
      id: metadataOnly.data.skills[0].id,
      createdAt: metadataOnly.data.skills[0].createdAt,
      updatedAt: Date.now() + 500,
    }
    const editSkill = await sync.performSync(
      {
        ...metadataOnly.data,
        skills: [editedSkill],
        updatedAt: Date.now() + 1000,
      },
      syncContext,
    )
    const editedSkillObjects = Array.from(r2.keys()).filter((key) =>
      key.startsWith('skill-'),
    )

    assert.equal(editSkill.remoteAccepted, false, 'skill edit should upload local state')
    assert.equal(
      editedSkillObjects.length,
      1,
      'edited skill content should leave exactly one current R2 skill object',
    )
    assert.notEqual(
      editedSkillObjects[0],
      uploadedSkillObjects[0],
      'edited skill content should replace the stale remote skill object',
    )

    const editedPull = await sync.performSync(
      baseAppData({
        skill: null,
        updatedAt: Date.now() + 2000,
        endpoint,
      }),
      syncContext,
    )

    assert.equal(editedPull.remoteAccepted, true, 'empty device should accept edited cloud skill')
    assert.match(
      editedPull.data.skills[0].chunks[0].content,
      /Updated skill content/,
      'second pull should receive the edited skill content',
    )

    const deleteSkill = await sync.performSync(
      {
        ...editedPull.data,
        skills: [],
        updatedAt: Date.now() + 1000,
      },
      syncContext,
    )

    assert.equal(deleteSkill.remoteAccepted, false, 'skill deletion should upload local state')
    assert.equal(
      Array.from(r2.keys()).some((key) => key.startsWith('skill-')),
      false,
      'deleted skill content should not remain in remote R2 objects',
    )

    await sync.clearRemoteSyncData(deleteSkill.data, syncContext)

    assert.equal(
      coordinatorStorage.get('incremental-head'),
      undefined,
      'clear should delete the strongly consistent incremental head',
    )
    assert.equal(r2.size, 0, 'clear should delete all remote incremental objects')
  } finally {
    restoreFetch()
  }

  console.log('Cloud sync E2E check passed')
} finally {
  try {
    await moduleRunner.close()
  } finally {
    await server.close()
  }
}
