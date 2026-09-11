export function createBoundedPageEvaluator(send, prefix = 'browser-evaluation') {
  let evaluationId = 0

  return async function evaluate(expression, awaitPromise = false) {
    if (!awaitPromise) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: false,
        returnByValue: true,
      })
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            'Browser evaluation failed',
        )
      }
      return result.result?.value
    }

    const objectGroup = `${prefix}-${++evaluationId}`
    let evaluationFailed = false
    let evaluationError
    try {
      const pendingResult = await send('Runtime.evaluate', {
        expression,
        awaitPromise: false,
        returnByValue: false,
        objectGroup,
      })
      if (pendingResult.exceptionDetails) {
        throw new Error(
          pendingResult.exceptionDetails.exception?.description ??
            pendingResult.exceptionDetails.text ??
            'Browser evaluation failed',
        )
      }

      const evaluationResult = pendingResult.result
      if (evaluationResult?.subtype !== 'promise') {
        if (evaluationResult?.objectId) {
          throw new Error(
            'Browser evaluation expected a Promise or serializable value, received a remote object handle',
          )
        }
        return evaluationResult?.value
      }
      const promiseObjectId = evaluationResult.objectId
      if (!promiseObjectId) {
        throw new Error('Browser evaluation expected a Promise remote object handle')
      }

      const result = await send('Runtime.awaitPromise', {
        promiseObjectId,
        returnByValue: true,
      })
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            'Browser Promise evaluation failed',
        )
      }
      return result.result?.value
    } catch (error) {
      evaluationFailed = true
      evaluationError = error
      throw error
    } finally {
      try {
        await send('Runtime.releaseObjectGroup', { objectGroup })
      } catch (cleanupError) {
        if (evaluationFailed) {
          try {
            if (evaluationError instanceof Error && evaluationError.cause === undefined) {
              evaluationError.cause = cleanupError
            }
          } catch {
            // Keep the primary evaluation failure even when its cause is immutable.
          }
        } else {
          throw cleanupError
        }
      }
    }
  }
}

export function maintainLatestVirtualMessageScrollIntent(
  documentRoot,
  runtime,
  targetMessageId,
) {
  const targetRendered = Array.from(documentRoot.querySelectorAll('[data-message-id]')).some(
    (message) => message.getAttribute('data-message-id') === targetMessageId,
  )
  if (targetRendered) return true

  const list = documentRoot.querySelector('.message-list')
  if (!(list instanceof runtime.HTMLElement)) return false
  list.scrollTop = list.scrollHeight
  list.dispatchEvent(new runtime.Event('scroll', { bubbles: true }))
  return false
}
