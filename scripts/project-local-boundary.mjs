import path from 'node:path'

// One boundary owns every local recovery, log, cache, worktree, and temporary
// file. Consumers must use this predicate instead of inventing a second glob.
export const projectLocalBoundaryRelativePath = '.local/codex'
export const projectLocalBoundaryGlob = `${projectLocalBoundaryRelativePath}/**`

export function normalizeProjectRelativePath(value) {
  return String(value)
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\/+|\/+$/gu, '')
}

export function isProjectLocalBoundaryPath(value, repoRoot) {
  let candidate = String(value)
  if (repoRoot && path.isAbsolute(candidate)) {
    candidate = path.relative(path.resolve(repoRoot), path.resolve(candidate))
  }

  const normalized = normalizeProjectRelativePath(candidate)
  return (
    normalized === projectLocalBoundaryRelativePath ||
    normalized.startsWith(`${projectLocalBoundaryRelativePath}/`)
  )
}
