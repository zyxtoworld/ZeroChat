function fail(message) {
  throw new Error(`Current Web QA report is invalid: ${message}.`)
}

export function validateCurrentWebQaReport(report) {
  if (report?.passed !== true) {
    fail('passed must be true')
  }

  const visualAudit = report.visualAudit
  const screenshotCount = visualAudit?.screenshotCount
  const expectedScreenshotCount = visualAudit?.expectedScreenshotCount

  if (!Number.isSafeInteger(screenshotCount)) {
    fail('screenshotCount must be a safe integer')
  }
  if (!Number.isSafeInteger(expectedScreenshotCount)) {
    fail('expectedScreenshotCount must be a safe integer')
  }
  if (screenshotCount <= 0 || expectedScreenshotCount <= 0) {
    fail('screenshot counts must be positive')
  }
  if (screenshotCount !== expectedScreenshotCount) {
    fail('screenshotCount must equal expectedScreenshotCount')
  }

  return { screenshotCount, expectedScreenshotCount }
}

export function formatCurrentWebQaMarker(report, currentWebQaTime) {
  if (typeof currentWebQaTime !== 'string' || currentWebQaTime.length === 0) {
    fail('current Web QA time must be a non-empty string')
  }

  const { screenshotCount, expectedScreenshotCount } = validateCurrentWebQaReport(report)
  return `Web current-page QA 当前 ${currentWebQaTime} 通过 ${screenshotCount}/${expectedScreenshotCount} screenshots`
}
