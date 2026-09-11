import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

import { isProjectLocalBoundaryPath } from './project-local-boundary.mjs'

export const sourceFingerprintDefaultExcludedDirectoryNames = Object.freeze([
  'build',
  'dist',
  'node_modules',
  'target',
])
const defaultExcludedDirectories = new Set(sourceFingerprintDefaultExcludedDirectoryNames)
const importSourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])
const resolvableExtensions = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.svg',
]

function normalizeRepoPath(file) {
  return file.split(/[\\/]+/u).join('/')
}

function isInsideRepository(cwd, candidate) {
  const relative = path.relative(cwd, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function hasExcludedDirectory(file, excludedDirectories) {
  const normalized = normalizeRepoPath(file)
  return (
    isProjectLocalBoundaryPath(normalized) ||
    normalized.split('/').some((part) => excludedDirectories.has(part))
  )
}

async function pathKind(candidate) {
  try {
    const stats = await lstat(candidate)
    if (stats.isSymbolicLink()) return 'symlink'
    if (stats.isFile()) return 'file'
    if (stats.isDirectory()) return 'directory'
    return 'other'
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'missing'
    throw error
  }
}

function assertInsideRepository(cwd, candidate, label) {
  if (!isInsideRepository(cwd, candidate)) {
    throw new Error(`${label} escapes the repository: ${candidate}`)
  }
}

function scriptKind(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.tsx':
      return ts.ScriptKind.TSX
    default:
      return ts.ScriptKind.TS
  }
}

function localModuleSpecifiers(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  )
  const specifiers = new Set()

  function collect(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.add(node.argument.literal.text)
    }

    ts.forEachChild(node, collect)
  }

  collect(sourceFile)
  return [...specifiers].filter(
    (specifier) => specifier.startsWith('./') || specifier.startsWith('../'),
  )
}

function importCandidates(importer, specifier) {
  const cleanSpecifier = specifier.split(/[?#]/u, 1)[0]
  const base = path.resolve(path.dirname(importer), cleanSpecifier)
  const extension = path.extname(base).toLowerCase()
  const candidates = [base]

  if (!extension || !resolvableExtensions.includes(extension)) {
    for (const candidateExtension of resolvableExtensions) {
      candidates.push(`${base}${candidateExtension}`)
    }
    for (const candidateExtension of resolvableExtensions) {
      candidates.push(path.join(base, `index${candidateExtension}`))
    }
  } else if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    const withoutExtension = base.slice(0, -extension.length)
    for (const candidateExtension of ['.ts', '.tsx', '.mts', '.cts']) {
      candidates.push(`${withoutExtension}${candidateExtension}`)
    }
  }

  return [...new Set(candidates)]
}

export async function dependencyClosureSourceFiles({
  cwd = process.cwd(),
  roots,
  excludedDirectories = defaultExcludedDirectories,
  excludedFiles = [],
} = {}) {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error('Source fingerprint roots must be a non-empty array.')
  }

  const repositoryRoot = path.resolve(cwd)
  const excluded = new Set(excludedDirectories)
  const excludedFilePaths = new Set(excludedFiles.map((file) => normalizeRepoPath(String(file))))
  const files = new Set()
  const pathKinds = new Map()
  const pendingFiles = new Map()

  for (const file of excludedFilePaths) {
    if (file === '..' || file.startsWith('../') || path.isAbsolute(file)) {
      throw new Error(`Source fingerprint excluded file escapes the repository: ${file}`)
    }
  }

  function cachedPathKind(candidate) {
    const normalized = path.resolve(candidate)
    const existing = pathKinds.get(normalized)
    if (existing) return existing

    const pending = pathKind(normalized)
    pathKinds.set(normalized, pending)
    return pending
  }

  async function assertRegularSourceFile(candidate, label) {
    assertInsideRepository(repositoryRoot, candidate, label)
    const kind = await cachedPathKind(candidate)
    if (kind === 'symlink') {
      throw new Error(`${label} must not be a symbolic link: ${candidate}`)
    }
    return kind === 'file'
  }

  async function resolveLocalImport(importer, specifier) {
    const candidates = importCandidates(importer, specifier)

    for (const candidate of candidates) {
      assertInsideRepository(
        repositoryRoot,
        candidate,
        `Local import ${specifier} from ${importer}`,
      )
      if (await assertRegularSourceFile(candidate, `Local import ${specifier}`)) {
        return candidate
      }
    }

    throw new Error(`Unable to resolve local import ${specifier} from ${importer}`)
  }

  async function addFile(file) {
    assertInsideRepository(repositoryRoot, file, 'Source fingerprint file')
    const repoPath = normalizeRepoPath(path.relative(repositoryRoot, file))
    if (
      !repoPath ||
      excludedFilePaths.has(repoPath) ||
      hasExcludedDirectory(repoPath, excluded) ||
      files.has(repoPath)
    ) return

    const pending = pendingFiles.get(repoPath)
    if (pending) {
      await pending
      return
    }

    const work = (async () => {
      if (!(await assertRegularSourceFile(file, 'Source fingerprint file'))) {
        throw new Error(`Source fingerprint path is not a regular file: ${file}`)
      }

      files.add(repoPath)
      if (!importSourceExtensions.has(path.extname(file).toLowerCase())) return

      const source = await readFile(file, 'utf8')
      const specifiers = localModuleSpecifiers(repoPath, source)
      await Promise.all(
        specifiers.map(async (specifier) => {
          await addFile(await resolveLocalImport(file, specifier))
        }),
      )
    })()

    pendingFiles.set(repoPath, work)
    try {
      await work
    } finally {
      pendingFiles.delete(repoPath)
    }
  }

  async function walk(directory) {
    assertInsideRepository(repositoryRoot, directory, 'Source fingerprint directory')
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      const repoPath = normalizeRepoPath(path.relative(repositoryRoot, fullPath))
      if (hasExcludedDirectory(repoPath, excluded)) continue
      if (entry.isSymbolicLink()) {
        throw new Error(`Source fingerprint path must not be a symbolic link: ${fullPath}`)
      }
      if (entry.isDirectory()) await walk(fullPath)
      else if (entry.isFile()) await addFile(fullPath)
    }
  }

  await Promise.all(
    roots.map(async (root) => {
      const resolvedRoot = path.resolve(repositoryRoot, root)
      assertInsideRepository(repositoryRoot, resolvedRoot, `Source fingerprint root ${root}`)
      const kind = await cachedPathKind(resolvedRoot)
      if (kind === 'symlink') {
        throw new Error(`Source fingerprint root must not be a symbolic link: ${root}`)
      }
      if (kind === 'file') await addFile(resolvedRoot)
      else if (kind === 'directory') await walk(resolvedRoot)
      else throw new Error(`Source fingerprint root does not exist: ${root}`)
    }),
  )

  return [...files].sort()
}

export async function dependencyClosureSourceFingerprint({
  cwd = process.cwd(),
  roots,
  kind,
  excludedDirectories = defaultExcludedDirectories,
  excludedFiles = [],
  includeRecords = false,
} = {}) {
  if (typeof kind !== 'string' || !kind) {
    throw new Error('Source fingerprint kind is required.')
  }

  const normalizedRoots = roots.map((root) => normalizeRepoPath(root))
  const files = await dependencyClosureSourceFiles({
    cwd,
    roots,
    excludedDirectories,
    excludedFiles,
  })
  const records = await Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(path.resolve(cwd, file))
      return {
        path: file,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      }
    }),
  )

  const digest = createHash('sha256')
  for (const record of records) {
    digest.update(record.path)
    digest.update('\0')
    digest.update(String(record.bytes))
    digest.update('\0')
    digest.update(record.sha256)
    digest.update('\n')
  }

  const fingerprint = {
    kind,
    roots: normalizedRoots,
    fileCount: records.length,
    totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    sha256: digest.digest('hex').toUpperCase(),
  }

  return includeRecords ? { ...fingerprint, records } : fingerprint
}
