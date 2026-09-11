import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  dependencyClosureSourceFiles,
  dependencyClosureSourceFingerprint,
  sourceFingerprintDefaultExcludedDirectoryNames,
} from './source-fingerprint.mjs'
import { resolveWebProductionGraph } from './web-production-reachability.mjs'

export const liveProviderUiSourceFingerprintExcludedDirectoryNames = Object.freeze([
  ...sourceFingerprintDefaultExcludedDirectoryNames,
  '__tests__',
])

export const liveProviderApiSourceFingerprintRoots = [
  'scripts/live-provider-source-fingerprint.mjs',
  'scripts/live-provider-report-path.mjs',
  'scripts/live-provider-smoke.mjs',
  'scripts/live-provider-smoke-check.mjs',
  'shared/ai-provider-contract.md',
  'src/data/presets.ts',
  'src/services/audioSpeech.ts',
  'src/services/audioTranscription.ts',
  'src/app/store.ts',
  'src/services/chat.ts',
  'src/services/chatGenerationTextStream.ts',
  'src/services/providerCapabilityChecks.ts',
  'src/services/providerCapabilityRequests.ts',
  'src/services/providerConfig.ts',
  'src/services/providerConnectivityChecks.ts',
  'src/services/providerErrors.ts',
  'src/services/providerModels.ts',
  'src/services/providerProxyHosts.ts',
  'src/services/providerRequests.ts',
  'src/services/providerResponses.ts',
  'src/services/providerTimeoutSignal.ts',
  'src/types.ts',
]

export const liveProviderUiSourceFingerprintRoots = [
  ...liveProviderApiSourceFingerprintRoots,
  'cloudflare/sync-worker.js',
  'scripts/browser-cdp.mjs',
  'scripts/cloudflare-temporary-live-provider-ui-drill.mjs',
  'scripts/live-provider-ui-browser-network.mjs',
  'scripts/live-provider-ui-proxy-harness.mjs',
  'scripts/live-provider-ui-smoke.mjs',
  'scripts/build-service-worker.mjs',
  'scripts/service-worker-source.js',
  'public/sw.js',
  'shared/sync-api.openapi.yaml',
  'index.html',
]

const liveProviderFingerprintCacheVersion =
  'zerochat.liveProviderSourceFingerprintCache.v1'
const liveProviderFingerprintCacheDirectoryName = path.join(
  '.local',
  'codex',
  'artifacts',
  'cache',
  'live-provider-source-fingerprint',
)
const liveProviderUiFingerprintCacheGuardFiles = Object.freeze(['tsconfig.app.json'])

function normalizeRepoPath(file) {
  return file.split(/[\\/]+/u).join('/')
}

function normalizedExcludedDirectories(excludedDirectories) {
  return [
    ...(excludedDirectories ?? sourceFingerprintDefaultExcludedDirectoryNames),
  ]
    .map((directory) => String(directory))
    .sort()
}

function cacheDescriptor({ cwd, roots, kind, excludedDirectories, guardFiles }) {
  return {
    version: liveProviderFingerprintCacheVersion,
    cwd: path.resolve(cwd),
    roots: roots.map(normalizeRepoPath),
    kind,
    excludedDirectories: normalizedExcludedDirectories(excludedDirectories),
    guardFiles: [...(guardFiles ?? [])].map(normalizeRepoPath).sort(),
  }
}

function cachePath(descriptor) {
  const digest = createHash('sha256')
    .update(JSON.stringify(descriptor))
    .digest('hex')
  return path.join(descriptor.cwd, liveProviderFingerprintCacheDirectoryName, `${digest}.json`)
}

function repositoryFilePath(cwd, repoPath) {
  if (typeof repoPath !== 'string' || !repoPath || path.isAbsolute(repoPath)) return null

  const repositoryRoot = path.resolve(cwd)
  const candidate = path.resolve(repositoryRoot, repoPath)
  const relative = path.relative(repositoryRoot, candidate)
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    return null
  }

  return candidate
}

async function fileRecord(cwd, recordPath) {
  const file = repositoryFilePath(cwd, recordPath)
  if (!file) return null

  try {
    const bytes = await readFile(file)
    return {
      path: normalizeRepoPath(recordPath),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    }
  } catch {
    return null
  }
}

async function sourceFileRecords(cwd, files) {
  return Promise.all(
    files.map(async (recordPath) => {
      const record = await fileRecord(cwd, recordPath)
      if (!record) {
        throw new Error(`Live-provider source fingerprint file is unavailable: ${recordPath}`)
      }
      return record
    }),
  )
}

function recordsMatch(expected, actual) {
  return (
    Array.isArray(expected) &&
    expected.length === actual.length &&
    expected.every(
      (record, index) => JSON.stringify(record) === JSON.stringify(actual[index]),
    )
  )
}

function fingerprintFromRecords({ kind, roots, records }) {
  const digest = createHash('sha256')
  for (const record of records) {
    digest.update(record.path)
    digest.update('\0')
    digest.update(String(record.bytes))
    digest.update('\0')
    digest.update(record.sha256)
    digest.update('\n')
  }

  return {
    kind,
    roots: roots.map(normalizeRepoPath),
    fileCount: records.length,
    totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    sha256: digest.digest('hex').toUpperCase(),
  }
}

async function sourceFingerprintFromFiles({ cwd, roots, kind, files }) {
  const records = await sourceFileRecords(cwd, files)
  return {
    ...fingerprintFromRecords({ kind, roots, records }),
    records,
  }
}

async function readFingerprintCache({
  cwd,
  descriptor,
  cacheFile,
  expectedKind,
}) {
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
    if (
      cached?.version !== liveProviderFingerprintCacheVersion ||
      JSON.stringify(cached.descriptor) !== JSON.stringify(descriptor) ||
      cached.fingerprint?.kind !== expectedKind ||
      !Array.isArray(cached.records) ||
      !Array.isArray(cached.guardRecords)
    ) {
      return null
    }

    const records = await Promise.all(
      cached.records.map((record) => fileRecord(cwd, record?.path)),
    )
    if (records.some((record) => record === null)) return null

    const guardRecords = await Promise.all(
      cached.guardRecords.map((record) => fileRecord(cwd, record?.path)),
    )
    if (guardRecords.some((record) => record === null)) return null
    if (
      !recordsMatch(cached.records, records) ||
      !recordsMatch(cached.guardRecords, guardRecords)
    ) {
      return null
    }

    const fingerprint = fingerprintFromRecords({
      kind: expectedKind,
      roots: cached.fingerprint.roots,
      records,
    })
    if (JSON.stringify(fingerprint) !== JSON.stringify(cached.fingerprint)) return null
    return fingerprint
  } catch {
    return null
  }
}

async function writeFingerprintCache({
  cwd,
  descriptor,
  cacheFile,
  fingerprint,
  records,
}) {
  const guardRecords = await Promise.all(
    descriptor.guardFiles.map((recordPath) => fileRecord(cwd, recordPath)),
  )
  if (guardRecords.some((record) => record === null)) return

  const temporaryFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`
  try {
    await mkdir(path.dirname(cacheFile), { recursive: true })
    await writeFile(
      temporaryFile,
      JSON.stringify({
        version: liveProviderFingerprintCacheVersion,
        descriptor,
        fingerprint,
        records,
        guardRecords,
      }),
      'utf8',
    )
    await rename(temporaryFile, cacheFile)
  } catch {
    try {
      await rm(cacheFile, { force: true })
      await rename(temporaryFile, cacheFile)
    } catch {
      await rm(temporaryFile, { force: true }).catch(() => {})
    }
  }
}

async function cachedLiveProviderSourceFingerprint({
  cwd,
  roots,
  cacheRoots = roots,
  kind,
  excludedDirectories,
  guardFiles,
  sourceFiles,
}) {
  const descriptor = cacheDescriptor({
    cwd,
    roots: cacheRoots,
    kind,
    excludedDirectories,
    guardFiles,
  })
  const cacheFile = cachePath(descriptor)
  const cached = await readFingerprintCache({
    cwd,
    descriptor,
    cacheFile,
    expectedKind: kind,
  })
  if (cached) return cached

  const computed = Array.isArray(sourceFiles)
    ? await sourceFingerprintFromFiles({ cwd, roots, kind, files: sourceFiles })
    : await dependencyClosureSourceFingerprint({
        cwd,
        roots,
        kind,
        excludedDirectories,
        includeRecords: true,
      })
  const { records, ...fingerprint } = computed
  await writeFingerprintCache({
    cwd,
    descriptor,
    cacheFile,
    fingerprint,
    records,
  })
  return fingerprint
}

async function readCachedLiveProviderSourceFingerprint({
  cwd,
  cacheRoots,
  kind,
  excludedDirectories,
  guardFiles,
}) {
  const descriptor = cacheDescriptor({
    cwd,
    roots: cacheRoots,
    kind,
    excludedDirectories,
    guardFiles,
  })
  return readFingerprintCache({
    cwd,
    descriptor,
    cacheFile: cachePath(descriptor),
    expectedKind: kind,
  })
}

function assertProductionReachableSourceFiles(files, graph) {
  const reachable = new Set(graph.files)
  const unreachableWebSources = files.filter(
    (file) => file.startsWith('src/') && !reachable.has(file),
  )

  if (unreachableWebSources.length > 0) {
    throw new Error(
      `Live-provider source fingerprint includes Web sources that are not production-reachable from ${graph.entry}: ${unreachableWebSources.join(', ')}`,
    )
  }

  return files
}

async function productionReachableSourceFiles({
  cwd,
  roots,
  excludedDirectories,
  graph = resolveWebProductionGraph({ root: cwd }),
  sourceFiles,
}) {
  const files = Array.isArray(sourceFiles)
    ? sourceFiles
    : await dependencyClosureSourceFiles({ cwd, roots, excludedDirectories })
  return assertProductionReachableSourceFiles(files, graph)
}

function liveProviderUiResolvedRoots(cwd, productionGraph) {
  const graph = productionGraph ?? resolveWebProductionGraph({ root: cwd })
  return {
    graph,
    roots: [...new Set([...liveProviderUiSourceFingerprintRoots, ...graph.files])],
  }
}

async function liveProviderUiSourceBundle({ cwd = process.cwd(), productionGraph } = {}) {
  const { graph, roots } = liveProviderUiResolvedRoots(cwd, productionGraph)
  const productionSources = new Set(graph.files)
  const supplementalRoots = roots.filter((root) => !productionSources.has(root))
  const supplementalFiles = await dependencyClosureSourceFiles({
    cwd,
    roots: supplementalRoots,
    excludedDirectories: liveProviderUiSourceFingerprintExcludedDirectoryNames,
  })
  const files = [...new Set([...graph.files, ...supplementalFiles])].sort()
  return {
    graph,
    roots,
    files: assertProductionReachableSourceFiles(files, graph),
  }
}

export async function liveProviderUiSourceFiles(options = {}) {
  const { files } = await liveProviderUiSourceBundle(options)
  return files
}

export async function liveProviderSourceFingerprint({
  cwd = process.cwd(),
  roots = liveProviderApiSourceFingerprintRoots,
  kind = 'zerochat.liveProviderSourceFingerprint.v1',
  excludedDirectories,
  validateProductionReachability,
  cacheKeyRoots = roots,
  cacheGuardFiles,
  productionGraph,
  sourceFiles,
} = {}) {
  const shouldValidateProductionReachability =
    validateProductionReachability ??
    (kind === 'zerochat.liveProviderUiSourceFingerprint.v1' ||
      roots !== liveProviderApiSourceFingerprintRoots)

  const cacheable =
    kind === 'zerochat.liveProviderSourceFingerprint.v1' ||
    kind === 'zerochat.liveProviderUiSourceFingerprint.v1'

  if (cacheable) {
    const cached = await readCachedLiveProviderSourceFingerprint({
      cwd,
      cacheRoots: cacheKeyRoots,
      kind,
      excludedDirectories,
      guardFiles: cacheGuardFiles,
    })
    if (cached) return cached
  }

  let validatedSourceFiles = sourceFiles
  if (shouldValidateProductionReachability) {
    validatedSourceFiles = await productionReachableSourceFiles({
      cwd,
      roots,
      excludedDirectories,
      graph: productionGraph,
      sourceFiles,
    })
  }

  if (!cacheable) {
    if (Array.isArray(validatedSourceFiles)) {
      return sourceFingerprintFromFiles({
        cwd,
        roots,
        kind,
        files: validatedSourceFiles,
      })
    }
    return dependencyClosureSourceFingerprint({
      cwd,
      roots,
      kind,
      excludedDirectories,
    })
  }

  return cachedLiveProviderSourceFingerprint({
    cwd,
    roots,
    cacheRoots: cacheKeyRoots,
    kind,
    excludedDirectories,
    guardFiles: cacheGuardFiles,
    sourceFiles: validatedSourceFiles,
  })
}

export function liveProviderApiSourceFingerprint(options = {}) {
  return liveProviderSourceFingerprint({
    ...options,
    roots: liveProviderApiSourceFingerprintRoots,
  })
}

export async function liveProviderUiSourceFingerprint(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const kind = 'zerochat.liveProviderUiSourceFingerprint.v1'
  const excludedDirectories = liveProviderUiSourceFingerprintExcludedDirectoryNames
  const cacheGuardFiles = liveProviderUiFingerprintCacheGuardFiles
  const cached = await readCachedLiveProviderSourceFingerprint({
    cwd,
    cacheRoots: liveProviderUiSourceFingerprintRoots,
    kind,
    excludedDirectories,
    guardFiles: cacheGuardFiles,
  })
  if (cached) return cached

  const { graph, roots, files } = await liveProviderUiSourceBundle({ cwd })
  return liveProviderSourceFingerprint({
    ...options,
    cwd,
    roots,
    kind: 'zerochat.liveProviderUiSourceFingerprint.v1',
    excludedDirectories,
    cacheKeyRoots: liveProviderUiSourceFingerprintRoots,
    cacheGuardFiles,
    productionGraph: graph,
    sourceFiles: files,
  })
}
