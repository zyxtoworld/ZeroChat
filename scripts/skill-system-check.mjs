import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const server = await createServer({
  logLevel: 'error',
  server: {
    middlewareMode: true,
    ws: {
      port: 24679,
    },
  },
})

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

function installCloudflareSyncMock() {
  const syncGenerationHeader = 'x-zerochat-sync-generation'
  const originalFetch = globalThis.fetch
  const objects = new Map()
  let head = null
  let generationCounter = 1
  let generation = '00000000-0000-4000-8000-000000000001'

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const generationHeaders = (headers = {}) => ({
      ...headers,
      [syncGenerationHeader]: generation,
    })
    const hasCurrentGeneration = () =>
      new Headers(init.headers).get(syncGenerationHeader) === generation
    const staleGenerationResponse = () =>
      new Response('Sync generation changed', { status: 412 })

    if (url.pathname === '/sync/head') {
      if (method === 'GET') {
        return head
          ? jsonResponse(head, { headers: generationHeaders() })
          : new Response('', { status: 404, headers: generationHeaders() })
      }

      if (method === 'PUT') {
        if (!hasCurrentGeneration()) return staleGenerationResponse()
        const next = JSON.parse(String(init.body ?? '{}'))

        if (head && next.updatedAt < head.updatedAt) {
          return new Response('Conflict', { status: 409 })
        }

        head = next
        return new Response('OK')
      }

      if (method === 'DELETE') {
        if (!hasCurrentGeneration()) return staleGenerationResponse()
        head = null
        return new Response('OK')
      }
    }

    if (url.pathname.startsWith('/sync/object/')) {
      const key = decodeURIComponent(url.pathname.slice('/sync/object/'.length))

      if (method === 'GET') {
        const value = objects.get(key)
        return value
          ? new Response(value, {
              headers: { 'content-type': 'application/json' },
            })
          : new Response('Missing', { status: 404 })
      }

      if (method === 'PUT') {
        if (!hasCurrentGeneration()) return staleGenerationResponse()
        objects.set(key, String(init.body ?? ''))
        return new Response('OK')
      }

      if (method === 'DELETE') {
        if (!hasCurrentGeneration()) return staleGenerationResponse()
        objects.delete(key)
        return new Response('OK')
      }
    }

    if (url.pathname === '/snapshot') {
      if (method === 'GET') {
        return new Response('', { status: 404, headers: generationHeaders() })
      }

      if (method === 'DELETE') {
        if (!hasCurrentGeneration()) return staleGenerationResponse()
        return new Response('OK')
      }
    }

    if (url.pathname === '/sync/clear' && method === 'DELETE') {
      head = null
      objects.clear()
      generationCounter += 1
      generation = `00000000-0000-4000-8000-${String(generationCounter).padStart(12, '0')}`
      return new Response('', { status: 204, headers: generationHeaders() })
    }

    return new Response('Not found', { status: 404 })
  }

  return {
    get head() {
      return head
    },
    objects,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}

try {
  const i18n = await server.ssrLoadModule('/src/i18n.ts')
  const skills = await server.ssrLoadModule('/src/services/skills.ts')
  const sync = await server.ssrLoadModule('/src/services/sync.ts')
  const cryptoService = await server.ssrLoadModule('/src/services/crypto.ts')

  await i18n.loadLocale('zh-CN')
  i18n.setRuntimeLocale('zh-CN')
  await assert.rejects(
    () => skills.createUserSkillFromContent('空技能', ''),
    /请填写技能内容/,
    'empty pasted Skill content should reject with localized copy',
  )
  const fallbackNamedSkill = await skills.createUserSkillFromContent('', 'Plain skill body')
  assert.equal(
    fallbackNamedSkill.name,
    '技能',
    'blank pasted Skill names should use the current localized fallback',
  )
  assert.equal(
    fallbackNamedSkill.chunks[0]?.heading,
    '概览',
    'Skill chunks without a markdown heading should use the current localized fallback heading',
  )
  await i18n.loadLocale('en-US')
  i18n.setRuntimeLocale('en-US')

  const reactSkill = await skills.createUserSkillFromContent(
    'React review',
    [
      '# Hooks',
      'When reviewing React hooks, check dependency arrays, memoization, stale closures, and cleanup.',
      '',
      '# Styling',
      'Prefer stable layout dimensions and accessible focus states.',
    ].join('\n'),
    'markdown',
  )
  const sqlSkill = await skills.createUserSkillFromContent(
    'Database review',
    [
      '# SQL',
      'Check migrations, indexes, transactions, slow queries, and rollback paths.',
    ].join('\n'),
    'markdown',
  )

  const contentStore = new Map()
  const stripForIndex = (skill) => ({
    ...skill,
    chunks: skill.chunks.map((chunk) => {
      const contentRef = `${skill.id}:${chunk.id}`
      contentStore.set(contentRef, chunk.content)

      return {
        id: chunk.id,
        heading: chunk.heading,
        contentRef,
        contentPreview: chunk.content.slice(0, 80),
        keywords: chunk.keywords,
        tokenEstimate: chunk.tokenEstimate,
      }
    }),
  })

  const indexedReact = stripForIndex(reactSkill)
  const indexedSql = stripForIndex(sqlSkill)

  assert.equal(
    indexedReact.chunks.some((chunk) => 'content' in chunk),
    false,
    'skill index must not keep full content in AppData',
  )

  const loadedRefs = []
  const loadChunk = async (_skill, chunk) => {
    loadedRefs.push(chunk.contentRef)
    return contentStore.get(chunk.contentRef)
  }

  const unrelated = await skills.buildSkillSystemMessage(
    [indexedReact, indexedSql],
    { autoMatch: true, contextBudget: 800, maxAutoSkills: 2 },
    'write a short haiku',
    loadChunk,
  )

  assert.equal(unrelated, '', 'unrelated prompts should not lazy-load auto skills')
  assert.deepEqual(loadedRefs, [], 'no chunk content should load when nothing matches')

  const relevant = await skills.buildSkillSystemMessage(
    [indexedReact, indexedSql],
    { autoMatch: true, contextBudget: 800, maxAutoSkills: 1 },
    'please review these React hooks and dependency arrays',
    loadChunk,
  )

  assert.match(relevant, /React review/, 'matching skill should be injected')
  assert.doesNotMatch(relevant, /Database review/, 'unmatched skills must stay unloaded')
  assert.equal(loadedRefs.length > 0, true, 'matching loads content lazily')
  assert.equal(
    loadedRefs.every((ref) => ref.startsWith(`${indexedReact.id}:`)),
    true,
    'auto-match should only load chunks from the selected skill',
  )

  loadedRefs.length = 0
  const fixedSql = {
    ...indexedSql,
    fixed: true,
  }
  const fixedOnly = await skills.buildSkillSystemMessage(
    [indexedReact, fixedSql],
    { autoMatch: false, contextBudget: 120, maxAutoSkills: 1 },
    'unrelated request',
    loadChunk,
  )

  assert.match(fixedOnly, /Database review/, 'pinned skills should load even when auto-match is off')
  assert.equal(
    skills.estimateTokens(fixedOnly) < 220,
    true,
    'context budget should keep injected skill context bounded',
  )
  assert.equal(loadedRefs.length > 0, true, 'pinned skill content should load on demand')

  loadedRefs.length = 0
  const largeSkillContent = Array.from({ length: 90 }, (_, index) =>
    [
      `# React performance chapter ${index + 1}`,
      'react hooks dependency memoization virtualization cleanup rendering profiler '.repeat(34),
      'large uploaded skill files must be chunked, indexed lightly, and loaded only when relevant. '.repeat(6),
    ].join('\n'),
  ).join('\n\n')
  const largeSkill = await skills.createUserSkillFromContent(
    'Large React playbook',
    largeSkillContent,
    'markdown',
  )
  const indexedLargeSkill = stripForIndex(largeSkill)

  assert.equal(
    largeSkill.sourceSize > 150_000,
    true,
    'large uploaded skills should be represented in the stress path',
  )
  assert.equal(
    largeSkill.chunks.length > 60,
    true,
    'large uploaded skills should be split into many bounded chunks',
  )
  assert.equal(
    largeSkill.chunks.every((chunk) => chunk.content.length <= 2800),
    true,
    'large skill chunks must stay small enough for responsive storage and sync',
  )
  assert.equal(
    indexedLargeSkill.chunks.some((chunk) => 'content' in chunk),
    false,
    'large skill indexes must not inline full content in AppData',
  )

  const largeRelevant = await skills.buildSkillSystemMessage(
    [indexedLargeSkill, indexedSql],
    { autoMatch: true, contextBudget: 520, maxAutoSkills: 1 },
    'review react hooks memoization virtualization performance',
    loadChunk,
  )

  assert.match(largeRelevant, /Large React playbook/, 'large matching skill should still be usable')
  assert.equal(
    loadedRefs.filter((ref) => ref.startsWith(`${indexedLargeSkill.id}:`)).length <= 2,
    true,
    'large matching skills should lazy-load at most the selected relevant chunks',
  )
  assert.equal(
    skills.estimateTokens(largeRelevant) < 760,
    true,
    'large matching skill context should stay bounded by the configured budget',
  )

  const syncIncrementalHelpersSource = await readFile(
    new URL('../src/services/syncIncrementalHelpers.ts', import.meta.url),
    'utf8',
  )
  const syncIncrementalUploadSource = await readFile(
    new URL('../src/services/syncIncrementalUpload.ts', import.meta.url),
    'utf8',
  )
  const syncCloudflareSource = await readFile(
    new URL('../src/services/syncCloudflare.ts', import.meta.url),
    'utf8',
  )
  const syncSource = [
    syncIncrementalHelpersSource,
    syncIncrementalUploadSource,
    syncCloudflareSource,
  ].join('\n')
  const appDataMutationSource = await readFile(
    new URL('../src/services/appDataMutationController.ts', import.meta.url),
    'utf8',
  )
  const autoSyncControllerSource = await readFile(
    new URL('../src/services/autoSyncController.ts', import.meta.url),
    'utf8',
  )
  const providerSettingsControllerSource = await readFile(
    new URL('../src/services/providerSettingsController.ts', import.meta.url),
    'utf8',
  )
  const settingsSkillControllerSource = await readFile(
    new URL('../src/services/settingsSkillController.ts', import.meta.url),
    'utf8',
  )
  const settingsSkillActionsSource = await readFile(
    new URL('../src/services/settingsSkillActions.ts', import.meta.url),
    'utf8',
  )
  const syncRuntimeControllerSource = await readFile(
    new URL('../src/services/syncRuntimeController.ts', import.meta.url),
    'utf8',
  )
  const dbSource = await readFile(new URL('../src/storage/db.ts', import.meta.url), 'utf8')
  const workerSource = await readFile(
    new URL('../cloudflare/sync-worker.js', import.meta.url),
    'utf8',
  )

  assert.match(
    syncSource,
    /skillChunks\?: IncrementalSkillRef\[\]/,
    'incremental manifest must track encrypted skill chunk refs',
  )
  assert.match(
    syncSource,
    /zerochat\.skillChunk/,
    'skill chunk content should be stored as encrypted incremental objects',
  )
  assert.match(
    syncSource,
    /objectKey\('skill'\)/,
    'skill chunk uploads should use isolated skill object keys',
  )
  assert.match(
    syncSource,
    /const updatedAt = reusable\?\.updatedAt \?\? skill\.updatedAt/,
    'skill metadata-only changes should reuse existing encrypted skill content objects',
  )
  assert.match(
    syncSource,
    /skills: data\.skills\.map\(emptySkillContent\)/,
    'incremental manifests should not keep full skill content inline',
  )
  assert.match(
    syncSource,
    /previous\.manifest\.skillChunks \?\? \[\]/,
    'stale remote skill chunks must be deleted after a successful sync',
  )
  assert.match(
    syncSource,
    /manifest\.skillChunks \?\? \[\]/,
    'clear sync must delete known remote skill chunks',
  )
  assert.ok(
    workerSource.includes(
      'const OBJECT_KEY_PATTERN = /^(manifest|chunk|skill|attachment)-[0-9a-f-]+\\.json$/i',
    ),
    'Cloudflare Worker should accept only scoped manifest, message, Skill, and attachment object keys',
  )
  assert.match(
    appDataMutationSource,
    /function ensureLocalWriteTimestamp[\s\S]*?nextRaw === current \|\| nextRaw\.updatedAt > current\.updatedAt[\s\S]*?return bump\(nextRaw\)[\s\S]*?const updateData = useCallback[\s\S]*?Local writes must advance updatedAt[\s\S]*?dataRef\.current = next[\s\S]*?setData\(next\)[\s\S]*?scheduleAutoSyncRef\.current\(next\)/,
    'all local app-data writes must pass through the mutation controller, advance updatedAt, and immediately feed auto-sync',
  )
  assert.match(
    autoSyncControllerSource,
    /useEffect\(\(\) => \{[\s\S]*?scheduleAutoSync\(data\)[\s\S]*?\}, \[[\s\S]*?data,[\s\S]*?githubTokenValue,[\s\S]*?activeSyncPassphraseRevision,[\s\S]*?\]\)/,
    'auto-sync must be scheduled from app-data changes and active sync credential revisions',
  )
  assert.match(
    providerSettingsControllerSource,
    /function updateProviderKey[\s\S]*?setProviderKey\(providerId, value\)[\s\S]*?providers: current\.providers\.map[\s\S]*?provider\.id === providerId[\s\S]*?updatedAt: timestamp[\s\S]*?context\.scheduleAutoSync\(saved, 0\)/,
    'provider key edits must mark the provider as locally changed and immediately queue encrypted secret sync',
  )
  assert.match(
    settingsSkillActionsSource,
    /function updateSkill[\s\S]*?const saved = context\.updateData\(\s*\(current\)[\s\S]*?skills: current\.skills\.map[\s\S]*?context\.scheduleAutoSync\(saved, 0\)/,
    'skill toggles/metadata edits must update AppData through updateData and immediately queue cloud sync',
  )
  assert.match(
    settingsSkillActionsSource,
    /function updateSkillSettings[\s\S]*?const saved = context\.updateData\(\s*\(current\)[\s\S]*?skillSettings:[\s\S]*?context\.scheduleAutoSync\(saved, 0\)/,
    'skill settings edits must update AppData through updateData',
  )
  assert.match(
    settingsSkillActionsSource,
    /skillService\.createUserSkillFromContent\(\s*context\.getSkillDraftName\(\)\.trim\(\),\s*content,/,
    'blank pasted Skill names must fall through to the localized single-skill fallback instead of using the settings tab label',
  )
  assert.match(
    settingsSkillActionsSource,
    /async function importSkillFiles[\s\S]*?const importedRaw: UserSkill\[\] = \[\][\s\S]*?createUserSkillFromFile\(file\)[\s\S]*?const imported = await services\.persistSkillsContents\(importedRaw\)[\s\S]*?const saved = context\.updateData\(\s*\(current\)[\s\S]*?skills: \[\.\.\.current\.skills, \.\.\.imported\][\s\S]*?const committed = await commitSkillContentRows\([\s\S]*?saved,[\s\S]*?imported,[\s\S]*?context\.scheduleAutoSync\(committed, 0\)/,
    'imported skill files must build all indexes, persist chunks in one batch, durably commit the published rows, then queue cloud sync from the committed snapshot',
  )
  assert.match(
    settingsSkillActionsSource,
    /async function addSkillFromDraft[\s\S]*?persistSkillContents[\s\S]*?const saved = context\.updateData\(\s*\(current\)[\s\S]*?skills: \[\.\.\.current\.skills, skill\][\s\S]*?const committed = await commitSkillContentRows\([\s\S]*?saved,[\s\S]*?\[skill\],[\s\S]*?context\.scheduleAutoSync\(committed, 0\)/,
    'pasted skill drafts must persist chunks, durably commit the published row, then queue cloud sync from the committed snapshot',
  )
  assert.match(
    settingsSkillActionsSource,
    /async function deleteSkill[\s\S]*?deleteSkillDangerPrompt\(context\.t, skill\.name\)[\s\S]*?context\.requestDangerConfirmation[\s\S]*?const latestSkill = context\.dataRef\.current\?\.skills\.find[\s\S]*?const saved = context\.updateData\(\s*\(current\)[\s\S]*?skills: current\.skills\.filter[\s\S]*?committed = await services\.persistPublishedLocalSnapshot\(saved\)[\s\S]*?committed\.skills\.some[\s\S]*?context\.scheduleAutoSync\(committed, 0\)[\s\S]*?services\.deleteSkillContents\(latestSkill\)/,
    'deleted skills must require danger confirmation, refresh the mutable target, durably commit conflict-recovered AppData, verify canonical removal, then queue cloud cleanup and delete local chunks',
  )
  assert.match(
    settingsSkillActionsSource,
    /async function startEditingSkill[\s\S]*?editableSkillContent\(skill\)[\s\S]*?async function saveEditingSkill[\s\S]*?createUserSkillFromContent[\s\S]*?persistSkillContents\(rebuilt\)[\s\S]*?const committed = await commitSkillContentRows\([\s\S]*?saved,[\s\S]*?\[persisted\],[\s\S]*?\[original\],[\s\S]*?context\.scheduleAutoSync\(committed, 0\)[\s\S]*?deleteSkillContentRefs\(staleRefs\)/,
    'edited Web Skills must lazy-load content, rebuild chunks, durably commit the replacement, queue cloud sync from the committed snapshot, and then clean stale local refs',
  )
  assert.match(
    syncRuntimeControllerSource,
    /const syncData = await services\.materializeAppDataSkillContents\(current\)[\s\S]*?syncService\.performSync\(syncData, syncContext\)/,
    'cloud sync must materialize skill contents before upload so remote edits/deletes are complete',
  )
  assert.match(
    dbSource,
    /function transaction[\s\S]*tx\.oncomplete[\s\S]*resolve\(result\)/,
    'IndexedDB single-request writes should resolve after transaction completion, not before durability is known',
  )
  assert.match(
    dbSource,
    /async function batchPutDocuments[\s\S]*async function getDocuments[\s\S]*async function deleteDocuments/,
    'large Skill storage must keep batched IndexedDB write, read, and delete helpers',
  )
  assert.match(
    dbSource,
    /const LOCAL_CRYPTO_CONCURRENCY = 4[\s\S]*async function mapWithConcurrency/,
    'large Skill storage must keep bounded local crypto concurrency for smooth imports and sync',
  )
  assert.match(
    dbSource,
    /function putEncryptedStrings[\s\S]*mapWithConcurrency\([\s\S]*LOCAL_CRYPTO_CONCURRENCY[\s\S]*encryptLocalString[\s\S]*batchPutDocuments/,
    'large Skill import should encrypt chunks with bounded concurrency and write them in one batched IndexedDB transaction',
  )
  assert.match(
    dbSource,
    /export async function persistSkillsContents[\s\S]*prepared\.flatMap\(\(item\) => item\.writes\)[\s\S]*export async function persistAppDataSkillContents[\s\S]*const skills = await persistSkillsContents\(data\.skills\)/,
    'multi-Skill startup/import persistence should batch all chunk writes instead of opening one IndexedDB write transaction per Skill',
  )
  assert.match(
    dbSource,
    /function getEncryptedStrings[\s\S]*getDocuments\(records\.map[\s\S]*mapWithConcurrency\([\s\S]*LOCAL_CRYPTO_CONCURRENCY[\s\S]*decryptLocalString/,
    'cloud sync materialization should read stored Skill chunks in one batched IndexedDB pass and decrypt with bounded concurrency',
  )
  assert.match(
    dbSource,
    /export async function loadSkillContents[\s\S]*getEncryptedStrings\(storedChunkRefs\)[\s\S]*storedContents\.get\(contentRef\)/,
    'Web Skill editor should batch-read selected Skill chunks instead of launching one IndexedDB read per chunk',
  )
  assert.match(
    dbSource,
    /function deleteSkillContents[\s\S]*await deleteDocuments/,
    'Skill deletion should remove local chunks in one batched IndexedDB transaction',
  )
  assert.match(
    dbSource,
    /export async function deleteSkillContentRefs[\s\S]*startsWith\(SKILL_CHUNK_KEY_PREFIX\)[\s\S]*deleteDocuments/,
    'Skill edits should expose a guarded stale-chunk cleanup path for replaced local content',
  )

  const cloud = installCloudflareSyncMock()
  const encryptionPassphrase = 'correct horse battery staple'
  const syncContext = {
    encryptionPassphrase,
    githubToken: '',
    providerKeys: {},
  }
  const syncSkill = await skills.createUserSkillFromContent(
    'Cloud skill',
    'Keep uploaded Skill content out of the incremental manifest.',
    'text',
  )
  const baseData = {
    version: 1,
    providers: [],
    conversations: [],
    skills: [syncSkill],
    skillSettings: { autoMatch: true, contextBudget: 2400, maxAutoSkills: 3 },
    sync: {
      mode: 'cloudflare',
      autoSync: true,
      encryptionEnabled: true,
      workerEndpoint: 'https://sync.example.com',
    },
    preferences: {
      firstRunDone: true,
      theme: 'system',
      language: 'system',
      compactMode: false,
    },
    updatedAt: 1000,
  }

  try {
    const firstUpload = await sync.performSync(baseData, syncContext)
    const skillKeys = Array.from(cloud.objects.keys()).filter((key) =>
      key.startsWith('skill-'),
    )

    assert.equal(skillKeys.length, 1, 'skill upload should create one skill object')
    assert.ok(cloud.head?.manifestKey, 'skill upload should publish a manifest head')

    const manifestEnvelope = JSON.parse(cloud.objects.get(cloud.head.manifestKey))
    const manifest = await cryptoService.decryptObject(
      manifestEnvelope,
      encryptionPassphrase,
      'manifest',
    )
    const manifestChunk = manifest.data.skills[0].chunks[0]

    assert.equal(
      manifest.skillChunks.length,
      1,
      'incremental manifest should reference the uploaded skill object',
    )
    assert.equal(
      'content' in manifestChunk,
      false,
      'incremental manifest must not inline full skill content',
    )
    assert.equal(
      Boolean(manifestChunk.contentPreview),
      true,
      'incremental manifest should keep a lightweight skill preview',
    )

    const metadataOnlySync = await sync.performSync(
      {
        ...firstUpload.data,
        skills: [
          {
            ...firstUpload.data.skills[0],
            fixed: true,
            updatedAt: 1200,
          },
        ],
        updatedAt: 1200,
      },
      syncContext,
    )
    const skillKeysAfterMetadataOnly = Array.from(cloud.objects.keys())
      .filter((key) => key.startsWith('skill-'))
      .sort()

    assert.equal(
      metadataOnlySync.remoteAccepted,
      false,
      'skill metadata-only sync should upload local metadata',
    )
    assert.deepEqual(
      skillKeysAfterMetadataOnly,
      skillKeys.slice().sort(),
      'skill metadata-only sync should not create or replace encrypted skill content objects',
    )

    const emptyDeviceChoice = await sync.performSync(
      {
        ...baseData,
        skills: [],
        updatedAt: 5000,
      },
      syncContext,
    )

    assert.equal(
      emptyDeviceChoice.remoteAccepted,
      true,
      'empty new devices should adopt existing cloud data without a first-sync prompt',
    )

    await assert.rejects(
      () =>
        sync.performSync(
          {
            ...baseData,
            updatedAt: 5000,
          },
          syncContext,
        ),
      /Local and cloud data both exist|本机和云端都有/,
      'first sync with local and cloud data should require an explicit direction',
    )

    const remoteChoice = await sync.performSync(
      {
        ...baseData,
        updatedAt: 5000,
      },
      {
        ...syncContext,
        firstSyncStrategy: 'use-remote',
      },
    )

    assert.equal(
      remoteChoice.remoteAccepted,
      true,
      'explicit cloud choice should apply remote data during first-sync conflict',
    )

    const localConversation = {
      id: 'local-conversation',
      title: 'Local draft',
      providerId: 'local-provider',
      model: 'local-model',
      messages: [
        {
          id: 'local-message',
          role: 'user',
          content: 'Keep this local-only chat during merge.',
          createdAt: 5000,
          status: 'done',
        },
      ],
      createdAt: 5000,
      updatedAt: 5000,
    }
    const mergeChoice = await sync.performSync(
      {
        ...baseData,
        skills: [],
        conversations: [localConversation],
        updatedAt: 5000,
      },
      {
        ...syncContext,
        firstSyncStrategy: 'merge',
      },
    )

    assert.equal(
      mergeChoice.remoteAccepted,
      true,
      'merge choice should apply remote data and upload the merged vault',
    )
    assert.equal(
      mergeChoice.data.skills.length,
      1,
      'first-sync merge should keep remote-only skills',
    )
    assert.equal(
      mergeChoice.data.conversations.length,
      1,
      'first-sync merge should keep local-only conversations',
    )

    await sync.performSync(
      {
        ...mergeChoice.data,
        skills: [],
        updatedAt: Date.now() + 1000,
      },
      syncContext,
    )

    assert.equal(
      Array.from(cloud.objects.keys()).some((key) => key.startsWith('skill-')),
      false,
      'deleting a skill should clean stale remote skill objects',
    )
  } finally {
    cloud.restore()
  }

  console.log('Skill system check passed')
} finally {
  await server.close()
}
