import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createBoundedViteSsrModuleRunner } from './vite-ssr-module-runner.mjs'

const DEFAULT_GIST_FILE = 'zerochat-sync.json'
const githubToken = 'gist-sync-e2e-disposable-token'
const passphrase = 'gist sync e2e disposable password'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function createGistStore() {
  const gists = new Map()
  const calls = []
  let nextId = 1

  function publicGist(gist) {
    return {
      id: gist.id,
      public: gist.public,
      description: gist.description,
      files: Object.fromEntries(
        Array.from(gist.files.entries()).map(([name, content]) => [
          name,
          {
            filename: name,
            size: content.length,
            content,
          },
        ]),
      ),
    }
  }

  function applyFiles(gist, files = {}) {
    for (const [name, value] of Object.entries(files)) {
      if (value === null) {
        gist.files.delete(name)
        continue
      }

      gist.files.set(name, String(value?.content ?? ''))
    }
  }

  return {
    async handle(request) {
      const url = new URL(request.url)
      const method = request.method.toUpperCase()
      const path = url.pathname

      if (url.origin !== 'https://api.github.com') {
        return null
      }

      calls.push({ method, path })

      if (request.headers.get('authorization') !== `Bearer ${githubToken}`) {
        return jsonResponse({ message: 'Bad credentials' }, 401)
      }

      if (path === '/gists' && method === 'POST') {
        const body = await request.json()
        const id = `gist-${nextId}`
        nextId += 1

        const gist = {
          id,
          public: Boolean(body.public),
          description: String(body.description ?? ''),
          files: new Map(),
        }

        applyFiles(gist, body.files)
        gists.set(id, gist)

        return jsonResponse(publicGist(gist), 201)
      }

      const match = path.match(/^\/gists\/([^/]+)$/)

      if (!match) {
        return jsonResponse({ message: `Unhandled GitHub API route ${method} ${path}` }, 404)
      }

      const gist = gists.get(match[1])

      if (!gist) {
        return jsonResponse({ message: 'Not Found' }, 404)
      }

      if (method === 'GET') {
        return jsonResponse(publicGist(gist))
      }

      if (method === 'PATCH') {
        const body = await request.json()
        applyFiles(gist, body.files)

        return jsonResponse(publicGist(gist))
      }

      if (method === 'DELETE') {
        gists.delete(gist.id)
        return new Response(null, { status: 204 })
      }

      return jsonResponse({ message: `Unhandled GitHub API method ${method}` }, 405)
    },
    file(gistId, fileName = DEFAULT_GIST_FILE) {
      return gists.get(gistId)?.files.get(fileName)
    },
    files(gistId) {
      return new Map(gists.get(gistId)?.files ?? [])
    },
    snapshot(gistId) {
      return JSON.stringify(
        [...(gists.get(gistId)?.files ?? new Map()).entries()].sort(
          ([left], [right]) => left.localeCompare(right),
        ),
      )
    },
    gist(gistId) {
      return gists.get(gistId)
    },
    calls() {
      return calls.slice()
    },
  }
}

function installGistFetch(store) {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const response = await store.handle(request)

    if (response) {
      return response
    }

    return originalFetch(request)
  }

  return () => {
    globalThis.fetch = originalFetch
  }
}

function baseAppData({ skill, updatedAt, gistId }) {
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
      mode: 'gist',
      autoSync: true,
      encryptionEnabled: true,
      ...(gistId ? { gistId } : {}),
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

async function namedSkill(skills, name, content, updatedAt = Date.now()) {
  const skill = await skills.createUserSkillFromContent(
    name,
    content,
    'markdown',
  )

  return {
    ...skill,
    createdAt: Math.min(skill.createdAt, updatedAt),
    updatedAt,
  }
}

function syncContext(extra = {}) {
  return {
    encryptionPassphrase: passphrase,
    githubToken,
    providerKeys: {},
    ...extra,
  }
}

const server = await createServer({
  logLevel: 'error',
  server: {
    middlewareMode: true,
    ws: {
      port: 24681,
    },
  },
})
const moduleRunner = createBoundedViteSsrModuleRunner(server)

try {
  const sync = await moduleRunner.import('/src/services/sync.ts')
  const gistProtocol = await moduleRunner.import('/src/services/syncGistProtocol.ts')
  const skills = await moduleRunner.import('/src/services/skills.ts')
  const store = createGistStore()
  const restoreFetch = installGistFetch(store)

  try {
    const firstSkill = await namedSkill(
      skills,
      'Gist sync E2E skill',
      [
        '# Review checklist',
        'Check layout, copy, accessibility, sync cleanup, and release gates.',
      ].join('\n'),
      1000,
    )
    const firstDevice = baseAppData({
      skill: firstSkill,
      updatedAt: 1000,
    })

    const upload = await sync.performSync(firstDevice, syncContext())
    const gistId = upload.data.sync.gistId

    assert.equal(upload.remoteAccepted, false, 'first device should upload local data')
    assert.ok(gistId, 'first device should create a private Gist id')
    assert.equal(store.gist(gistId).public, false, 'created Gist should be private')
    const initialFiles = store.files(gistId)
    assert.equal(initialFiles.size, 1, 'new Gist should contain one v2 state operation')
    const [[initialOperationFile, initialOperationContent]] = initialFiles
    const initialOperationId = gistProtocol.gistOperationIdFromFileName(
      DEFAULT_GIST_FILE,
      initialOperationFile,
    )
    assert.ok(initialOperationId, 'new Gist should use a content-addressed v2 operation file')
    assert.ok(
      initialOperationContent.includes('"zerochat.encryptedObject"') &&
        initialOperationContent.includes('"gist-operation-v2"'),
      'Gist operation file should contain an encrypted v2 operation object',
    )
    const initialOperation = await gistProtocol.parseGistOperation(
      initialOperationContent,
      passphrase,
      initialOperationId,
    )
    assert.equal(initialOperation.operation, 'state', 'first Gist operation should publish state')
    assert.equal(initialOperation.vault.data.skills.length, 1, 'first state operation should contain the local skill')

    const secondDevice = baseAppData({
      skill: null,
      updatedAt: 2000,
      gistId,
    })
    const pull = await sync.performSync(secondDevice, syncContext())

    assert.equal(pull.remoteAccepted, true, 'empty second device should accept Gist data')
    assert.equal(pull.data.skills.length, 1, 'second device should receive the Gist skill')
    assert.equal(
      pull.data.skills[0].name,
      'Gist sync E2E skill',
      'second device should receive uploaded skill metadata',
    )
    assert.match(
      pull.data.skills[0].chunks[0].content,
      /layout, copy, accessibility/,
      'second device should receive uploaded skill content',
    )

    const conflictingSkill = await namedSkill(
      skills,
      'Local-only conflict skill',
      [
        '# Local checklist',
        'This local skill should not silently overwrite existing Gist data.',
      ].join('\n'),
      3000,
    )
    const conflictDevice = baseAppData({
      skill: conflictingSkill,
      updatedAt: 3000,
      gistId,
    })
    const beforeConflict = store.snapshot(gistId)

    await assert.rejects(
      () => sync.performSync(conflictDevice, syncContext()),
      /sync|first|conflict|同步|冲突/i,
      'first sync with local data and remote data should ask before overwriting',
    )
    assert.equal(
      store.snapshot(gistId),
      beforeConflict,
      'first-sync conflict should not modify the remote Gist file',
    )

    const merge = await sync.performSync(
      conflictDevice,
      syncContext({ firstSyncStrategy: 'merge' }),
    )

    assert.equal(merge.remoteAccepted, true, 'merge strategy should combine data')
    assert.deepEqual(
      merge.data.skills.map((skill) => skill.name).sort(),
      ['Gist sync E2E skill', 'Local-only conflict skill'],
      'merge should keep both remote and local skills',
    )

    const mergedPull = await sync.performSync(
      baseAppData({
        skill: null,
        updatedAt: 4000,
        gistId,
      }),
      syncContext(),
    )

    assert.equal(
      mergedPull.data.skills.length,
      2,
      'new empty device should receive merged Gist skills',
    )

    const wrongPassphraseData = {
      ...mergedPull.data,
      updatedAt: Date.now() + 1000,
    }
    const beforeWrongPassphrase = store.snapshot(gistId)

    await assert.rejects(
      () =>
        sync.performSync(wrongPassphraseData, {
          ...syncContext(),
          encryptionPassphrase: 'wrong disposable password',
        }),
      /decrypt|crypto|解密|密码/i,
      'wrong passphrase should fail instead of overwriting the Gist vault',
    )
    assert.equal(
      store.snapshot(gistId),
      beforeWrongPassphrase,
      'wrong passphrase should not modify the remote Gist file',
    )

    const originalSkill = mergedPull.data.skills.find(
      (skill) => skill.name === 'Gist sync E2E skill',
    )
    assert.ok(originalSkill, 'merged data should still include the original skill')

    const editedDraft = await namedSkill(
      skills,
      'Gist sync E2E skill',
      [
        '# Review checklist',
        'Updated Gist skill content should replace the old cloud payload and pull to every device.',
      ].join('\n'),
      Date.now() + 2000,
    )
    const editedSkill = {
      ...editedDraft,
      id: originalSkill.id,
      createdAt: originalSkill.createdAt,
    }
    const editTime = Date.now() + 3000
    const editData = {
      ...mergedPull.data,
      skills: mergedPull.data.skills.map((skill) =>
        skill.id === editedSkill.id ? editedSkill : skill,
      ),
      updatedAt: editTime,
    }
    const beforeEdit = store.snapshot(gistId)
    const edit = await sync.performSync(editData, syncContext())

    assert.equal(edit.remoteAccepted, false, 'skill edit should upload local state')
    assert.notEqual(
      store.snapshot(gistId),
      beforeEdit,
      'skill edit should update the encrypted Gist payload',
    )

    const editedPull = await sync.performSync(
      baseAppData({
        skill: null,
        updatedAt: editTime + 1,
        gistId,
      }),
      syncContext(),
    )

    assert.match(
      editedPull.data.skills
        .find((skill) => skill.id === editedSkill.id)
        ?.chunks[0].content ?? '',
      /Updated Gist skill content/,
      'new device should pull the edited skill content',
    )

    const deleteTime = Date.now() + 5000
    const deleteSkill = await sync.performSync(
      {
        ...editedPull.data,
        skills: editedPull.data.skills.filter((skill) => skill.id !== editedSkill.id),
        updatedAt: deleteTime,
      },
      syncContext(),
    )

    assert.equal(deleteSkill.remoteAccepted, false, 'skill deletion should upload local state')

    const deletedPull = await sync.performSync(
      baseAppData({
        skill: null,
        updatedAt: deleteTime + 1,
        gistId,
      }),
      syncContext(),
    )

    assert.equal(
      deletedPull.data.skills.some((skill) => skill.id === editedSkill.id),
      false,
      'deleted skill should not remain in the Gist cloud data',
    )
    assert.equal(
      deletedPull.data.skills.some((skill) => /Updated Gist skill content/.test(skill.chunks[0]?.content ?? '')),
      false,
      'deleted skill content should not remain in pulled Gist data',
    )

    await sync.clearRemoteSyncData(deleteSkill.data, syncContext())

    const clearedFiles = store.files(gistId)
    assert.equal(
      clearedFiles.size,
      1,
      'clear remote sync data should compact managed files to one clear operation',
    )
    const [[clearOperationFile, clearOperationContent]] = clearedFiles
    const clearOperationId = gistProtocol.gistOperationIdFromFileName(
      DEFAULT_GIST_FILE,
      clearOperationFile,
    )
    assert.ok(clearOperationId, 'clear should retain one content-addressed v2 operation file')
    const clearOperation = await gistProtocol.parseGistOperation(
      clearOperationContent,
      passphrase,
      clearOperationId,
    )
    assert.equal(clearOperation.operation, 'clear', 'clear should publish a v2 clear operation')
    assert.equal(
      store
        .calls()
        .some((call) => call.method === 'PATCH' && call.path === `/gists/${gistId}`),
      true,
      'Gist sync should patch the existing secret Gist instead of creating duplicates',
    )
  } finally {
    restoreFetch()
  }

  console.log('Gist sync E2E check passed')
} finally {
  try {
    await moduleRunner.close()
  } finally {
    await server.close()
  }
}
