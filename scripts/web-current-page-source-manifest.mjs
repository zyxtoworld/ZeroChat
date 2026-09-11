import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { assertWebProductionExecutionModel } from './web-production-reachability.mjs'
import { isProjectLocalBoundaryPath } from './project-local-boundary.mjs'

export const webCurrentPageSourceRoots = Object.freeze(['index.html', 'production-reachable-graph'])

export const webCurrentPageSourceExcludedDirectoryNames = Object.freeze(['__tests__'])

function normalizeRepositoryPath(file) {
  return file.split(/[\\/]+/u).join('/')
}

function hasExcludedDirectory(file, excludedDirectories) {
  const normalized = normalizeRepositoryPath(file)
  return (
    isProjectLocalBoundaryPath(normalized) ||
    normalized.split('/').some((part) => excludedDirectories.has(part))
  )
}

async function fileEvidence(file) {
  const [buffer, fileStats] = await Promise.all([readFile(file), stat(file)])

  return {
    bytes: fileStats.size,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

async function collectSourceFiles({ repoRoot, root, excludedDirectories }) {
  const absoluteRoot = path.resolve(repoRoot, root)
  const rootStats = await stat(absoluteRoot)
  const rootPath = normalizeRepositoryPath(path.relative(repoRoot, absoluteRoot))

  if (hasExcludedDirectory(rootPath, excludedDirectories)) {
    return []
  }

  if (rootStats.isFile()) {
    return [rootPath]
  }

  if (!rootStats.isDirectory()) {
    return []
  }

  const files = []

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const repositoryPath = normalizeRepositoryPath(path.relative(repoRoot, absolutePath))

      if (hasExcludedDirectory(repositoryPath, excludedDirectories)) {
        continue
      }

      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }

      if (entry.isFile()) {
        files.push(repositoryPath)
      }
    }
  }

  await walk(absoluteRoot)
  return files
}

function htmlLocalAssetSources(html) {
  const sources = []
  const tagPattern = /<(?:link|img|video|audio|source)\b([^>]*)>/giu
  const attributePattern = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/iu

  for (const tag of html.matchAll(tagPattern)) {
    const attributes = attributePattern.exec(tag[1])
    attributePattern.lastIndex = 0
    const source = attributes?.[1] ?? attributes?.[2] ?? attributes?.[3] ?? ''
    if (source.startsWith('/')) sources.push(source)
  }

  return sources
}

function resolvePublicAsset(repoRoot, source) {
  const url = new URL(source, 'https://zerochat.invalid/')
  if (url.origin !== 'https://zerochat.invalid') return null

  const candidate = path.resolve(repoRoot, 'public', decodeURIComponent(url.pathname).replace(/^[/\\]+/u, ''))
  const publicRoot = path.resolve(repoRoot, 'public')
  const relative = path.relative(publicRoot, candidate)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null
  return candidate
}

export async function webCurrentPageSourceManifest({
  repoRoot = process.cwd(),
  roots,
  excludedDirectories = webCurrentPageSourceExcludedDirectoryNames,
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const excluded = new Set(excludedDirectories)
  const productionGraph = roots === undefined
  let normalizedRoots
  let files
  let entry = null

  if (productionGraph) {
    const graph = assertWebProductionExecutionModel({ root: resolvedRepoRoot })
    const indexFile = path.resolve(resolvedRepoRoot, 'index.html')
    const indexHtml = await readFile(indexFile, 'utf8')
    const staticAssets = []

    for (const source of htmlLocalAssetSources(indexHtml)) {
      const asset = resolvePublicAsset(resolvedRepoRoot, source)
      if (asset && existsSync(asset)) staticAssets.push(normalizeRepositoryPath(path.relative(resolvedRepoRoot, asset)))
    }

    files = ['index.html', ...graph.files, ...staticAssets].sort()
    normalizedRoots = [...webCurrentPageSourceRoots]
    entry = graph.entry
  } else {
    normalizedRoots = roots.map((root) => normalizeRepositoryPath(String(root)))
    files = (
      await Promise.all(
        normalizedRoots.map((root) =>
          collectSourceFiles({
            repoRoot: resolvedRepoRoot,
            root,
            excludedDirectories: excluded,
          }),
        ),
      )
    )
      .flat()
      .sort()
  }

  files = [...new Set(files)]
  const records = []

  for (const file of files) {
    const evidence = await fileEvidence(path.join(resolvedRepoRoot, file))
    records.push({
      path: file,
      bytes: evidence.bytes,
      sha256: evidence.sha256,
    })
  }

  const digest = createHash('sha256')
    .update(JSON.stringify({ roots: normalizedRoots, files: records }))
    .digest('hex')
    .toUpperCase()

  return {
    mode: productionGraph ? 'production-graph' : 'explicit-roots',
    entry,
    roots: normalizedRoots,
    excludedDirectories: [...excluded].sort(),
    fileCount: records.length,
    digest,
    files: records,
  }
}
