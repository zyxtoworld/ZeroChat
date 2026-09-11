export const liveProviderEmptyChatRetryDelaysMs = Object.freeze([400, 900, 1600])
const chatAttemptOutcomes = new Set([
  'failed',
  'passed',
  'successful-empty-response',
])
const chatAttemptKeys = new Set([
  'attemptNumber',
  'delayMs',
  'outcome',
  'retryScheduled',
  'status',
])

function sleepFor(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function isSuccessfulEmptyResponse(result) {
  return (
    result?.ok === false &&
    result?.emptySuccessfulResponse === true &&
    result?.status === 200
  )
}

function attemptEvidence(result, attemptNumber, retryScheduled, delayMs) {
  const outcome =
    result.ok === true
      ? 'passed'
      : isSuccessfulEmptyResponse(result)
        ? 'successful-empty-response'
        : 'failed'

  return {
    attemptNumber,
    outcome,
    retryScheduled,
    ...(Number.isInteger(result.status) && result.status >= 100 && result.status <= 599
      ? { status: result.status }
      : {}),
    ...(retryScheduled ? { delayMs } : {}),
  }
}

export async function runWithLiveProviderEmptyChatRetry({
  runAttempt,
  sleep = sleepFor,
}) {
  if (typeof runAttempt !== 'function' || typeof sleep !== 'function') {
    throw new TypeError('Live provider empty-chat retry requires runAttempt and sleep functions.')
  }

  const attempts = []

  for (
    let attemptIndex = 0;
    attemptIndex <= liveProviderEmptyChatRetryDelaysMs.length;
    attemptIndex += 1
  ) {
    const attemptNumber = attemptIndex + 1
    const result = await runAttempt({ attemptNumber })

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new TypeError('Live provider chat attempt must return a result object.')
    }

    const delayMs = liveProviderEmptyChatRetryDelaysMs[attemptIndex]
    const retryScheduled = isSuccessfulEmptyResponse(result) && delayMs !== undefined
    attempts.push(attemptEvidence(result, attemptNumber, retryScheduled, delayMs))

    if (!retryScheduled) {
      return {
        ...result,
        attempts,
      }
    }

    await sleep(delayMs)
  }

  throw new Error('Live provider empty-chat retry exhausted without a terminal result.')
}

export function liveProviderChatModelAttemptValidationFailures(
  value,
  { attemptedChatModels = null, requirePassedFinal = false } = {},
) {
  const failures = []

  if (!Array.isArray(value) || value.length === 0) {
    return ['must be a non-empty array.']
  }

  const recordedModels = []

  for (const [modelIndex, modelAttempt] of value.entries()) {
    const prefix = `[${modelIndex}]`

    if (!modelAttempt || typeof modelAttempt !== 'object' || Array.isArray(modelAttempt)) {
      failures.push(`${prefix} must be an object.`)
      continue
    }

    if (
      Object.keys(modelAttempt).some((key) => !['attempts', 'model'].includes(key))
    ) {
      failures.push(`${prefix} must contain only model and attempts.`)
    }

    if (typeof modelAttempt.model !== 'string' || modelAttempt.model.trim() === '') {
      failures.push(`${prefix}.model must be a non-empty model id.`)
    } else {
      recordedModels.push(modelAttempt.model)
    }

    if (
      !Array.isArray(modelAttempt.attempts) ||
      modelAttempt.attempts.length === 0 ||
      modelAttempt.attempts.length > liveProviderEmptyChatRetryDelaysMs.length + 1
    ) {
      failures.push(`${prefix}.attempts must contain between one and four attempts.`)
      continue
    }

    for (const [attemptIndex, attempt] of modelAttempt.attempts.entries()) {
      const attemptPrefix = `${prefix}.attempts[${attemptIndex}]`
      const isLastAttempt = attemptIndex === modelAttempt.attempts.length - 1

      if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
        failures.push(`${attemptPrefix} must be an object.`)
        continue
      }

      if (Object.keys(attempt).some((key) => !chatAttemptKeys.has(key))) {
        failures.push(`${attemptPrefix} contains an unsafe or unknown field.`)
      }
      if (attempt.attemptNumber !== attemptIndex + 1) {
        failures.push(`${attemptPrefix}.attemptNumber must be contiguous from one.`)
      }
      if (!chatAttemptOutcomes.has(attempt.outcome)) {
        failures.push(`${attemptPrefix}.outcome must be a known outcome.`)
      }
      if (typeof attempt.retryScheduled !== 'boolean') {
        failures.push(`${attemptPrefix}.retryScheduled must be a boolean.`)
      }
      if (
        'status' in attempt &&
        (!Number.isInteger(attempt.status) || attempt.status < 100 || attempt.status > 599)
      ) {
        failures.push(`${attemptPrefix}.status must be a valid HTTP status when present.`)
      }
      if (
        attempt.outcome === 'successful-empty-response' &&
        attempt.status !== 200
      ) {
        failures.push(`${attemptPrefix} successful empty responses must record HTTP 200.`)
      }
      if (attempt.outcome === 'passed' && attempt.status !== 200) {
        failures.push(`${attemptPrefix} passing responses must record HTTP 200.`)
      }

      if (!isLastAttempt) {
        if (
          attempt.outcome !== 'successful-empty-response' ||
          attempt.retryScheduled !== true ||
          attempt.delayMs !== liveProviderEmptyChatRetryDelaysMs[attemptIndex]
        ) {
          failures.push(
            `${attemptPrefix} non-final attempts must be successful empty responses with the bounded retry delay.`,
          )
        }
      } else if (attempt.retryScheduled !== false || 'delayMs' in attempt) {
        failures.push(`${attemptPrefix} final attempts must not schedule another retry.`)
      }
    }

    const finalAttempt = modelAttempt.attempts.at(-1)
    const isLastModel = modelIndex === value.length - 1
    if (
      finalAttempt?.outcome === 'successful-empty-response' &&
      modelAttempt.attempts.length !== liveProviderEmptyChatRetryDelaysMs.length + 1
    ) {
      failures.push(`${prefix} successful empty responses may stop only after four attempts.`)
    }
    if (!isLastModel && finalAttempt?.outcome === 'passed') {
      failures.push(`${prefix} only the final attempted model may pass.`)
    }
  }

  if (
    Array.isArray(attemptedChatModels) &&
    JSON.stringify(recordedModels) !== JSON.stringify(attemptedChatModels)
  ) {
    failures.push('model order must match attemptedChatModels.')
  }

  if (requirePassedFinal && value.at(-1)?.attempts?.at(-1)?.outcome !== 'passed') {
    failures.push('the final model attempt must pass.')
  }

  return failures
}
