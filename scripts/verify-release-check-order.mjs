export function checksWithReleaseDiagnosticsBootstrap(
  checks,
  bootstrapCheck,
  enabled,
  prerequisiteChecks = [],
) {
  if (!enabled) {
    return checks
  }

  const buildIndexes = checks
    .map(([label], index) => (label === 'Vite production build' ? index : -1))
    .filter((index) => index >= 0)

  if (buildIndexes.length !== 1) {
    throw new Error(
      `Release diagnostics bootstrap requires exactly one Vite production build check; found ${buildIndexes.length}.`,
    )
  }

  const insertionIndex = buildIndexes[0] + 1
  return [
    ...checks.slice(0, insertionIndex),
    ...prerequisiteChecks,
    bootstrapCheck,
    ...checks.slice(insertionIndex),
  ]
}
