function normalizedStringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item !== '')
    : []
}

function normalizedMarkerAlternatives(value) {
  return Array.isArray(value)
    ? value
        .filter(Array.isArray)
        .map(normalizedStringList)
        .filter((markers) => markers.length > 0)
    : []
}

function normalizeOutcome(outcome = {}) {
  const expectedCode = Number.isInteger(outcome.expectedCode)
    ? outcome.expectedCode
    : 0

  return {
    expectedCode,
    outcome:
      typeof outcome.outcome === 'string' && outcome.outcome !== ''
        ? outcome.outcome
        : expectedCode === 0
          ? 'passed'
          : 'expected-diagnostic-failure',
    requiredOutput: normalizedStringList(outcome.requiredOutput),
    requiredOutputAny: normalizedMarkerAlternatives(outcome.requiredOutputAny),
  }
}

function configuredOutcomes(options = {}) {
  return Array.isArray(options.outcomes) && options.outcomes.length > 0
    ? options.outcomes.map(normalizeOutcome)
    : [normalizeOutcome(options)]
}

function markersMatch(output, outcome) {
  return (
    outcome.requiredOutput.every((marker) => output.includes(marker)) &&
    (outcome.requiredOutputAny.length === 0 ||
      outcome.requiredOutputAny.some((markers) =>
        markers.every((marker) => output.includes(marker)),
      ))
  )
}

export function selectSourceValidationOutcome(result, options = {}) {
  const output = String(result?.output ?? '')
  const outcomes = configuredOutcomes(options)
  const matched = outcomes.find(
    (outcome) =>
      result?.code === outcome.expectedCode && markersMatch(output, outcome),
  )

  return {
    passed: Boolean(matched),
    expectedCode: matched?.expectedCode ?? null,
    outcome: matched?.outcome ?? 'unrecognized',
    acceptedOutcomes: outcomes,
  }
}
