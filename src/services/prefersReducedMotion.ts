export function matchesMediaQuery(query: string): boolean {
  if (typeof globalThis.matchMedia !== 'function') {
    return false
  }

  try {
    return Boolean(globalThis.matchMedia(query).matches)
  } catch {
    return false
  }
}

export function prefersReducedMotion(): boolean {
  return matchesMediaQuery('(prefers-reduced-motion: reduce)')
}
