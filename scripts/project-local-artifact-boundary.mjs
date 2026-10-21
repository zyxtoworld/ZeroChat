import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

const projectLocalArtifactRelativePath = '.local/zerochat/artifacts'

// Runtime bundles are small and known. These limits make a stale or malicious
// report fail closed before it can turn the validator into a general-purpose
// filesystem scanner.
export const projectLocalArtifactMaxFiles = 4096
export const projectLocalArtifactMaxBytes = 128 * 1024 * 1024

function samePath(left, right) {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return (
    path.relative(normalizedLeft, normalizedRight) === '' &&
    path.relative(normalizedRight, normalizedLeft) === ''
  )
}

function strictChildPath(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
}

function hasTraversalSegment(candidate) {
  return String(candidate)
    .replaceAll('\\', '/')
    .split('/')
    .some((segment) => segment === '..')
}

function rejected(reason) {
  return { ok: false, reason }
}

async function canonicalPathWithoutReparse(candidate, label) {
  let stats
  try {
    stats = await lstat(candidate)
  } catch (error) {
    return rejected(`${label} is missing or inaccessible: ${error.message}`)
  }

  if (stats.isSymbolicLink()) {
    return rejected(`${label} must not be a symbolic link or junction: ${candidate}`)
  }

  if (!stats.isDirectory()) {
    return rejected(`${label} must be a directory: ${candidate}`)
  }

  let canonical
  try {
    canonical = await realpath(candidate)
  } catch (error) {
    return rejected(`${label} cannot be canonicalized: ${error.message}`)
  }

  // On Windows this comparison is case-insensitive through path.relative. A
  // different canonical location therefore identifies a reparse hop, while a
  // harmless case difference does not.
  if (!samePath(canonical, candidate)) {
    return rejected(`${label} contains a reparse point: ${candidate}`)
  }

  return { ok: true, canonical }
}

export function projectLocalArtifactsRoot(repoRoot = process.cwd()) {
  return path.resolve(repoRoot, projectLocalArtifactRelativePath)
}

export async function resolveProjectLocalArtifactRoot(
  candidate,
  { repoRoot = process.cwd() } = {},
) {
  const rawCandidate = String(candidate ?? '')
  if (
    rawCandidate.trim() === '' ||
    /[\0\r\n]/u.test(rawCandidate) ||
    hasTraversalSegment(rawCandidate)
  ) {
    return rejected(`artifact root path is empty, unsafe, or contains traversal: ${rawCandidate}`)
  }

  const resolvedRepoRoot = path.resolve(repoRoot)
  const artifactsRoot = projectLocalArtifactsRoot(resolvedRepoRoot)
  const lexicalCandidate = path.resolve(
    path.isAbsolute(rawCandidate) ? rawCandidate : path.join(resolvedRepoRoot, rawCandidate),
  )

  if (!strictChildPath(lexicalCandidate, artifactsRoot)) {
    return rejected(
      `artifact root must be a strict child of ${artifactsRoot}; received ${rawCandidate}`,
    )
  }

  const canonicalArtifactsRoot = await canonicalPathWithoutReparse(
    artifactsRoot,
    'project-local artifacts root',
  )
  if (!canonicalArtifactsRoot.ok) return canonicalArtifactsRoot

  const relativeCandidate = path.relative(artifactsRoot, lexicalCandidate)
  let prefix = artifactsRoot
  for (const segment of relativeCandidate.split(path.sep)) {
    if (!segment || segment === '.') continue
    prefix = path.join(prefix, segment)
    const prefixResult = await canonicalPathWithoutReparse(prefix, 'artifact path component')
    if (!prefixResult.ok) return prefixResult
  }

  const canonicalCandidate = await canonicalPathWithoutReparse(
    lexicalCandidate,
    'reported artifact root',
  )
  if (!canonicalCandidate.ok) return canonicalCandidate

  if (!strictChildPath(canonicalCandidate.canonical, canonicalArtifactsRoot.canonical)) {
    return rejected(
      `reported artifact root escapes ${canonicalArtifactsRoot.canonical}: ${rawCandidate}`,
    )
  }

  return {
    ok: true,
    lexicalRoot: lexicalCandidate,
    canonicalRoot: canonicalCandidate.canonical,
    canonicalArtifactsRoot: canonicalArtifactsRoot.canonical,
  }
}

async function readBoundedFileEvidence(file, stats) {
  const buffer = await readFile(file)
  return {
    path: path.resolve(file),
    bytes: stats.size,
    sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  }
}

export async function readProjectLocalArtifactManifest(
  root,
  {
    repoRoot = process.cwd(),
    maxFiles = projectLocalArtifactMaxFiles,
    maxBytes = projectLocalArtifactMaxBytes,
  } = {},
) {
  const resolved = await resolveProjectLocalArtifactRoot(root, { repoRoot })
  if (!resolved.ok) return resolved

  const files = []
  let totalBytes = 0

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      let stats
      try {
        stats = await lstat(fullPath)
      } catch (error) {
        return rejected(`artifact entry became inaccessible before scanning: ${error.message}`)
      }

      let canonicalEntry
      try {
        canonicalEntry = await realpath(fullPath)
      } catch (error) {
        return rejected(`artifact entry cannot be canonicalized: ${error.message}`)
      }

      if (!samePath(canonicalEntry, fullPath)) {
        return rejected(`artifact tree contains a reparse point: ${fullPath}`)
      }

      if (stats.isDirectory()) {
        const result = await walk(fullPath)
        if (!result.ok) return result
        continue
      }

      if (!stats.isFile()) {
        return rejected(`artifact tree contains an unsupported filesystem entry: ${fullPath}`)
      }

      if (files.length >= maxFiles) {
        return rejected(`artifact tree exceeds the ${maxFiles}-file limit before reading ${fullPath}`)
      }

      if (totalBytes + stats.size > maxBytes) {
        return rejected(
          `artifact tree exceeds the ${maxBytes}-byte limit before reading ${fullPath}`,
        )
      }

      const evidence = await readBoundedFileEvidence(fullPath, stats)
      files.push({
        path: path.relative(resolved.lexicalRoot, fullPath).split(path.sep).join('/'),
        bytes: evidence.bytes,
        sha256: evidence.sha256,
      })
      totalBytes += evidence.bytes
    }

    return { ok: true }
  }

  const scanResult = await walk(resolved.lexicalRoot)
  if (!scanResult.ok) return scanResult

  return {
    ok: true,
    manifest: {
      root: resolved.canonicalRoot,
      fileCount: files.length,
      totalBytes,
      files,
    },
  }
}
