export function checksWithReleaseDiagnosticsBootstrap(
  checks,
  bootstrapCheck,
  enabled,
  prerequisiteChecks = [],
  postBootstrapChecks = [],
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
    ...postBootstrapChecks,
    ...checks.slice(insertionIndex),
  ]
}

export function shouldRefreshWebCurrentPageEvidenceBeforeValidation({
  release = false,
  checkLabel = '',
  audit = null,
} = {}) {
  const staleBulletLines = audit?.webCurrentPageArtifact?.staleBulletLines

  return (
    release &&
    checkLabel === 'Visual audit artifact validation' &&
    audit?.webCurrentPageArtifact?.allowRefreshableStale === true &&
    Array.isArray(staleBulletLines) &&
    staleBulletLines.length > 0 &&
    staleBulletLines.length <= 2 &&
    staleBulletLines.every((line) => typeof line === 'string' && line.startsWith('- '))
  )
}

export function reconcileDeferredRuntimeArtifactStep(steps, currentFailure) {
  if (!Array.isArray(steps) || (currentFailure !== null && typeof currentFailure !== 'string')) {
    return false
  }

  const stepIndex = steps.findIndex(
    (step) => step?.label === 'Runtime smoke artifacts' && step?.passed === false,
  )
  if (stepIndex < 0) {
    return false
  }

  if (currentFailure === null) {
    steps.splice(stepIndex, 1)
  } else {
    steps[stepIndex] = {
      ...steps[stepIndex],
      error: currentFailure,
    }
  }

  return true
}
