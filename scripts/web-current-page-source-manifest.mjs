import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export const webCurrentPageSourceRoots = Object.freeze([
  'index.html',
  'package.json',
  'vite.config.ts',
  'src',
  'public',
])

export const webCurrentPageSourceExcludedDirectoryNames = Object.freeze(['__tests__'])

function normalizeRepositoryPath(file) {
  return file.split(/[\\/]+/u).join('/')
}

function hasExcludedDirectory(file, excludedDirectories) {
  return normalizeRepositoryPath(file)
    .split('/')
    .some((part) => excludedDirectories.has(part))
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

export async function webCurrentPageSourceManifest({
  repoRoot = process.cwd(),
  roots = webCurrentPageSourceRoots,
  excludedDirectories = webCurrentPageSourceExcludedDirectoryNames,
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const normalizedRoots = roots.map((root) => normalizeRepositoryPath(String(root)))
  const excluded = new Set(excludedDirectories)
  const files = (
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
    roots: normalizedRoots,
    excludedDirectories: [...excluded].sort(),
    fileCount: records.length,
    digest,
    files: records,
  }
}
