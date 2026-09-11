export const projectLocalBoundaryRelativePath: string
export const projectLocalBoundaryGlob: string

export function normalizeProjectRelativePath(value: string): string

export function isProjectLocalBoundaryPath(
  value: string,
  repoRoot?: string,
): boolean
