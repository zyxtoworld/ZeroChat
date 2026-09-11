import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { createBoundedViteSsrModuleRunner } from './vite-ssr-module-runner.mjs'
import { assertWebProductionReachability } from './web-production-reachability.mjs'

const server = await createServer({
  logLevel: 'error',
  server: {
    middlewareMode: true,
    ws: {
      port: 24679,
    },
  },
})
const moduleRunner = createBoundedViteSsrModuleRunner(server)

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
  const productionGraph = assertWebProductionReachability()
  for (const sourcePath of [
    'src/app/bootstrap.tsx',
    'src/app/components/SettingsView.tsx',
    'src/app/skillList.ts',
    'src/app/store.ts',
    'src/storage/db.ts',
  ]) {
    assert.ok(
      productionGraph.files.includes(sourcePath),
      `Skill system authority must be production-reachable: ${sourcePath}`,
    )
  }
  const i18n = await moduleRunner.import('/src/i18n.ts')
  const skills = await moduleRunner.import('/src/services/skills.ts')
  const sync = await moduleRunner.import('/src/services/sync.ts')
  const cryptoService = await moduleRunner.import('/src/services/crypto.ts')
  const providerMutation = await moduleRunner.import('/src/app/providerMutation.ts')

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

  const credentialOwnerFixture = {
    providers: [{ id: 'provider-owner', updatedAt: 7 }],
    updatedAt: 11,
  }
  const credentialOwner = providerMutation.markProviderCredentialChanged(
    credentialOwnerFixture,
    'provider-owner',
  )
  assert.equal(
    credentialOwner.updatedAt > credentialOwnerFixture.updatedAt,
    true,
    'Provider credential changes must advance the AppData sync owner',
  )
  assert.equal(
    credentialOwner.providers[0].updatedAt >
      credentialOwnerFixture.providers[0].updatedAt,
    true,
    'Provider credential changes must advance the Provider sync owner',
  )

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
  const providerMutationSource = await readFile(
    new URL('../src/app/providerMutation.ts', import.meta.url),
    'utf8',
  )
  const automaticSyncSource = await readFile(
    new URL('../src/app/automaticSync.ts', import.meta.url),
    'utf8',
  )
  const appStoreTestSource = await readFile(
    new URL('../src/app/__tests__/store.test.ts', import.meta.url),
    'utf8',
  )
  const settingsViewSource = await readFile(
    new URL('../src/app/components/SettingsView.tsx', import.meta.url),
    'utf8',
  )
  const skillListSource = await readFile(
    new URL('../src/app/skillList.ts', import.meta.url),
    'utf8',
  )
  const skillListTestSource = await readFile(
    new URL('../src/app/__tests__/skill-list.test.ts', import.meta.url),
    'utf8',
  )
  const appStoreSource = await readFile(
    new URL('../src/app/store.ts', import.meta.url),
    'utf8',
  )
  const syncServiceSource = await readFile(
    new URL('../src/services/sync.ts', import.meta.url),
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
    providerMutationSource,
    /function ensureLocalMutationTimestamp[\s\S]*?next\.updatedAt > current\.updatedAt[\s\S]*?current\.updatedAt \+ 1/,
    'all local AppData mutations must advance updatedAt even during same-tick writes or clock rollback',
  )
  assert.match(
    appStoreSource,
    /const updateData = \(\s*fn:\s*\(data: AppData\) => AppData,\s*admission\?: DataMutationAdmission,\s*\): void => \{[\s\S]*?dataReplacementAdmissionBlocked\(\)[\s\S]*?ensureLocalMutationTimestamp\(current, nextRaw\)[\s\S]*?setData\(next\)[\s\S]*?scheduleSave\(\)/,
    'all local AppData mutations must pass through the replacement admission, current store timestamp, and persistence boundary',
  )
  assert.match(
    automaticSyncSource,
    /useEffect\(\(\) => \{[\s\S]*?reconcileAutoSync\([\s\S]*?clearScheduledSync,[\s\S]*?scheduleAutoSync,[\s\S]*?data,[\s\S]*?syncing,[\s\S]*?\)[\s\S]*?\}, \[[\s\S]*?data,[\s\S]*?githubTokenValue,[\s\S]*?scheduleAutoSync,[\s\S]*?syncPassphraseValue,[\s\S]*?syncing,[\s\S]*?\]\)/,
    'automatic sync must be scheduled from current AppData and committed sync credential values',
  )
  assert.match(
    providerMutationSource,
    /export function markProviderCredentialChanged\([\s\S]*?current\.updatedAt \+ 1[\s\S]*?target\.updatedAt \+ 1/,
    'Provider credential owners must advance monotonically before encrypted sync',
  )
  assert.match(
    appStoreSource,
    /saveProviderKey: async \(id, key\)[\s\S]*?runSecretMutation\([\s\S]*?setProviderKey\(id, trimmed\)[\s\S]*?markProviderCredentialChanged\(data, id\)[\s\S]*?delete nextResults\[id\][\s\S]*?sync\?\.autoSync[\s\S]*?sync\.mode !== 'local'/,
    'Provider key edits must publish only after durable storage, clear stale diagnostics, and merge one pending current-owner sync.',
  )
  assert.match(
    appStoreTestSource,
    /publishes a durable Provider key as a new auto-sync owner/,
    'the current store behavior suite must lock the durable Provider-key publication boundary',
  )
  assert.match(
    appStoreSource,
    /setSkillToggle: \(id, field, enabled\)[\s\S]*?runSkillToggleMutation\([\s\S]*?skills: data\.skills\.map/,
    'Skill toggles and metadata edits must update production AppData through the current store boundary',
  )
  assert.match(
    appStoreSource,
    /updateSkillSettings: \(patch\) => \{[\s\S]*?updateData\(\(data\)[\s\S]*?normalizeSkillSettings[\s\S]*?requestConfiguredAutoSync\(\)/,
    'global Skill matching settings must be normalized and request configured auto-sync through the current store boundary',
  )
  assert.match(
    appStoreTestSource,
    /requests configured cloud auto-sync after a global Skill setting changes/,
    'the current store behavior suite must lock global Skill-setting auto-sync scheduling',
  )
  assert.match(
    settingsViewSource,
    /updateSkillSettings[\s\S]*?skills\.defaultAutoMatch[\s\S]*?min=\{600\}[\s\S]*?max=\{8000\}[\s\S]*?min=\{1\}[\s\S]*?max=\{8\}/,
    'the production Skills settings view must expose bounded global matching controls',
  )
  assert.match(
    appStoreSource,
    /importSkills: \(files\)[\s\S]*?runSkillMutation\([\s\S]*?imported\.push\(await skillService\.createUserSkillFromFile\(file\)\)[\s\S]*?persistSkillsContents\(imported\)[\s\S]*?commitSkillDataMutation/,
    'imported Skill files must build all indexes, persist chunks in one batch, and durably commit the published rows',
  )
  assert.match(
    appStoreSource,
    /addSkill: \(name, content\)[\s\S]*?runSkillMutation\([\s\S]*?persistSkillContents\(skill\)[\s\S]*?commitSkillDataMutation/,
    'new Skills must persist chunks and durably commit their AppData row in the shared lifecycle lane',
  )
  assert.match(
    settingsViewSource,
    /deleteSkillAndRestoreFocus = async \(skillId: string\)[\s\S]*?runConfirmedSettingsAction\([\s\S]*?skills\.deleteConfirm[\s\S]*?deleteSkill\(skillId\)/,
    'the production Skills view must require localized confirmation before deletion',
  )
  assert.match(
    appStoreSource,
    /deleteSkill: \(id\)[\s\S]*?commitSkillDataMutation[\s\S]*?skills: current\.skills\.filter[\s\S]*?queueSkillContentCleanupRefs\(removedRefs\)[\s\S]*?await cleanupPendingSkillContentRefs\(\)/,
    'Skill deletion must durably remove the row before cleaning only unreferenced local chunks',
  )
  assert.match(
    appStoreSource,
    /saveSkillContent: \(id, name, content\)[\s\S]*?persistSkillContents[\s\S]*?commitSkillDataMutation[\s\S]*?queueSkillContentCleanupRefs\(skillContentRefs\(replacedSkill\.previous\)\)[\s\S]*?await cleanupPendingSkillContentRefs\(\)/,
    'Skill edits must durably publish the replacement before cleaning stale local refs',
  )
  assert.match(
    appStoreSource,
    /addSkill: \(name, content\)[\s\S]*?queueSkillContentCleanupRefs\(skillContentRefs\(persisted\)\)[\s\S]*?await cleanupPendingSkillContentRefs\(\)/,
    'failed Skill creation must retain unpublished refs for the shared cleanup retry queue',
  )
  assert.match(
    appStoreSource,
    /importSkills: \(files\)[\s\S]*?queueSkillContentCleanupRefs\(persisted\.flatMap\(skillContentRefs\)\)[\s\S]*?await cleanupPendingSkillContentRefs\(\)/,
    'failed Skill imports must retain unpublished refs for the shared cleanup retry queue',
  )
  assert.match(
    appStoreSource,
    /saveSkillContent: \(id, name, content\)[\s\S]*?catch \(error\)[\s\S]*?queueSkillContentCleanupRefs\(skillContentRefs\(persisted\)\)[\s\S]*?await cleanupPendingSkillContentRefs\(\)/,
    'failed Skill edits must retain unpublished refs for the shared cleanup retry queue',
  )
  for (const behaviorName of [
    'resolves Skill creation only after the AppData snapshot is durable',
    'publishes an imported Skill set atomically and cleans failed candidates',
    'keeps old Skill refs published when an edit snapshot fails',
    'deletes Skill refs only after the row removal is durable',
    'keeps Skill persistence behind a durable secret mutation',
    'does not delete a Skill ref that remains visible through another row',
    'retries unpublished Skill cleanup after a failed add without a new edit',
    'retries unpublished Skill cleanup after a failed import without a new edit',
      'retries replaced Skill cleanup after a successful edit without a new edit',
      'retries unpublished Skill cleanup after an edit is cancelled without a new edit',
      'retries removed Skill cleanup after a successful delete without a new edit',
      'coalesces concurrent pending Skill cleanup without losing its lifecycle',
    ]) {
    assert.ok(
      appStoreTestSource.includes(behaviorName),
      `current store behavior coverage is missing: ${behaviorName}`,
    )
  }
  assert.match(
    skillListSource,
    /INITIAL_SKILL_RENDER_COUNT = 80[\s\S]*?SKILL_RENDER_BATCH_SIZE = 80[\s\S]*?skills\.slice\(0, renderedSkillLimit\)/,
    'the production Skill list must materialize bounded 80-row batches',
  )
  assert.match(
    settingsViewSource,
    /IntersectionObserver[\s\S]*?root: target\.closest\('\.zc-settings-scroll'\)[\s\S]*?data-zc-skill-list-more="true"/,
    'the production Skill list must keep observer-driven loading and a manual show-more fallback',
  )
  assert.match(
    skillListTestSource,
    /advances in bounded batches[\s\S]*?expands only far enough to reveal the requested row[\s\S]*?inactive view stays light/,
    'the current Skill-list behavior suite must lock batching, reveal, and inactive rendering',
  )
  assert.match(
    appStoreSource,
    /const syncData = await materializeAppDataSkillContents\(data\)[\s\S]*?await sync\.performSync\(syncData, \{/,
    'cloud sync must materialize skill contents before upload so remote edits/deletes are complete',
  )
  assert.match(
    syncServiceSource,
    /export async function pullRemoteChanges\(/,
    'cloud sync must retain the current pull service boundary',
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
  try {
    await moduleRunner.close()
  } finally {
    await server.close()
  }
}
