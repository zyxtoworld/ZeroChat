import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const WINDOWS_APPS_DELETED_ROOT = 'C:\\Program Files\\WindowsApps\\Deleted'
const cleanupFailurePattern =
  /0x[0-9a-f]+|Access is denied|access denied|拒绝访问|无法删除|删除文件|failed to delete|delete file/iu
const accessDeniedPattern = /0x5\b|Access is denied|access denied|拒绝访问/iu

const args = process.argv.slice(2)
const failures = []
const skipped = []
let reportPath = '.manual-qa/windows-msix-host-preflight.json'
let requireClear = false

for (const arg of args) {
  if (arg === '--require-clear') {
    requireClear = true
    continue
  }

  if (arg.startsWith('--report=')) {
    reportPath = arg.slice('--report='.length).trim()
    continue
  }

  failures.push(`Unknown argument: ${arg}`)
}

function fail(message) {
  failures.push(message)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function safeReportPath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('Report path must not be empty.')
    return ''
  }

  if (/[\0\r\n]/u.test(value) || /^https?:\/\//iu.test(value)) {
    fail('Report path must be a local JSON path under .manual-qa.')
    return ''
  }

  const resolved = path.resolve(value)
  const manualQaDir = path.resolve('.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('Report path must stay under .manual-qa.')
  }

  if (!/^windows-msix-host-preflight(?:-[a-z0-9-]+)?\.json$/u.test(path.basename(resolved))) {
    fail('Report path must be named windows-msix-host-preflight*.json.')
  }

  return resolved
}

function checkNoSecretMaterial(value, label, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkNoSecretMaterial(item, label, [...pathParts, String(index)]))
    return
  }

  if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      checkNoSecretMaterial(nested, label, [...pathParts, key])
    }
    return
  }

  if (typeof value !== 'string') {
    return
  }

  const fieldPath = pathParts.join('.') || 'report'
  for (const [pattern, description] of [
    [/\bBearer\s+[A-Za-z0-9._~+/=-]+/u, 'Bearer token'],
    [/\bgithub_pat_[A-Za-z0-9_]+\b/iu, 'GitHub fine-grained token'],
    [/\bgh[opsru]_[A-Za-z0-9_]+\b/iu, 'GitHub token'],
    [/\bZEROCHAT_[A-Z0-9_]+\b/u, 'ZeroChat environment variable name'],
    [/\bsk-[A-Za-z0-9_-]{16,}\b/iu, 'provider token'],
  ]) {
    if (pattern.test(value)) {
      fail(`${label} field ${fieldPath} must not contain ${description}.`)
    }
  }
}

function checkStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    fail(`${label} must be a non-empty string array.`)
  }
}

function uniqueStrings(values) {
  return Array.from(
    new Set(values.filter((value) => typeof value === 'string' && value.trim() !== '')),
  )
}

function eventText(event) {
  const properties = Array.isArray(event?.properties) ? event.properties : []
  return `${event?.message ?? ''}\n${properties.map((value) => String(value)).join('\n')}`
}

function isCleanupFailureEvent(event) {
  const text = eventText(event)
  return /WindowsApps\\+Deleted/iu.test(text) && cleanupFailurePattern.test(text)
}

function isStrictDeletedTargetPath(value) {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.startsWith('\\\\?\\') ||
    value.includes('/') ||
    /[\0\r\n*?"<>|]/u.test(value)
  ) {
    return false
  }

  const normalized = path.win32.normalize(value)
  const relative = path.win32.relative(WINDOWS_APPS_DELETED_ROOT, normalized)
  const segments = relative.split('\\')
  return (
    normalized === value &&
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..\\`) &&
    !path.win32.isAbsolute(relative) &&
    segments.every(
      (segment) =>
        segment !== '' &&
        segment !== '.' &&
        segment !== '..' &&
        !segment.endsWith('.') &&
        !segment.endsWith(' '),
    )
  )
}

function deletedPackageName(normalizedPath) {
  if (!isStrictDeletedTargetPath(normalizedPath)) {
    return ''
  }

  const relative = path.win32.relative(WINDOWS_APPS_DELETED_ROOT, normalizedPath)
  return relative.split('\\')[0]
}

function extractFailureCodes(eventText) {
  return uniqueStrings(
    Array.from(eventText.matchAll(/0x[0-9a-f]+/giu), (match) => match[0].toUpperCase()),
  )
}

const resolvedReportPath = safeReportPath(reportPath)
let report = null
if (resolvedReportPath) {
  try {
    await stat(resolvedReportPath)
    report = JSON.parse(await readFile(resolvedReportPath, 'utf8'))
  } catch (error) {
    fail(`Unable to read Windows MSIX host preflight report ${reportPath}: ${error.message}`)
  }
}

if (report) {
  checkNoSecretMaterial(report, reportPath)

  if (report.kind !== 'zerochat.windowsMsixHostPreflight.v1' || report.version !== 1) {
    fail(`${reportPath} must identify zerochat.windowsMsixHostPreflight.v1 version 1.`)
  }

  if (!['blocked', 'clear', 'unknown'].includes(report.status)) {
    fail(`${reportPath} status must be blocked, clear, or unknown.`)
  }

  for (const field of ['startedAt', 'finishedAt', 'generatedAt']) {
    if (!isIsoTimestamp(report[field])) {
      fail(`${reportPath} ${field} must be an ISO timestamp.`)
    }
  }

  if (report.evidenceType !== 'host-appx-preflight-diagnostic' || report.releaseEvidence !== false) {
    fail(`${reportPath} must remain host-appx-preflight-diagnostic evidence with releaseEvidence=false.`)
  }

  if (report.safeToPublish !== true || !String(report.publishSafetyScope ?? '').includes('No provider keys')) {
    fail(`${reportPath} must mark the sanitized host preflight as safeToPublish and scope secret redaction.`)
  }

  if (!Number.isInteger(report.sinceHours) || report.sinceHours < 1) {
    fail(`${reportPath} sinceHours must be a positive integer.`)
  }

  if (!Number.isInteger(report.maxEvents) || report.maxEvents < 10) {
    fail(`${reportPath} maxEvents must be an integer of at least 10.`)
  }

  if (typeof report.currentShellElevated !== 'boolean') {
    fail(`${reportPath} currentShellElevated must be a boolean.`)
  }

  if (typeof report.trustedMsixQaCanRunInCurrentShell !== 'boolean') {
    fail(`${reportPath} trustedMsixQaCanRunInCurrentShell must be a boolean.`)
  }

  const expectedTrustedMsixQaCanRunInCurrentShell =
    report.status === 'clear' && report.currentShellElevated === true
  if (report.trustedMsixQaCanRunInCurrentShell !== expectedTrustedMsixQaCanRunInCurrentShell) {
    fail(
      `${reportPath} trustedMsixQaCanRunInCurrentShell must equal status=clear && currentShellElevated=true.`,
    )
  }

  const expectedTrustedMsixQaReadiness =
    report.status === 'clear'
      ? report.currentShellElevated === true
        ? 'host-clear-current-shell-elevated'
        : 'host-clear-current-shell-not-elevated'
      : 'host-blocked'
  if (
    ![
      'host-blocked',
      'host-clear-current-shell-elevated',
      'host-clear-current-shell-not-elevated',
    ].includes(report.trustedMsixQaReadiness)
  ) {
    fail(`${reportPath} trustedMsixQaReadiness must be a known readiness state.`)
  } else if (report.trustedMsixQaReadiness !== expectedTrustedMsixQaReadiness) {
    fail(
      `${reportPath} trustedMsixQaReadiness must match status and currentShellElevated.`,
    )
  }

  if (!Array.isArray(report.appxServices)) {
    fail(`${reportPath} appxServices must be an array.`)
  }

  if (!Array.isArray(report.recentAppxEvents)) {
    fail(`${reportPath} recentAppxEvents must be an array.`)
  }

  const classification = report.blockerClassification
  if (!isObject(classification) || typeof classification.kind !== 'string') {
    fail(`${reportPath} must include blockerClassification.kind.`)
  } else {
    const recentEvents = Array.isArray(report.recentAppxEvents) ? report.recentAppxEvents : []
    const matchingEvents = recentEvents.filter(isCleanupFailureEvent)
    const matchingEventText = matchingEvents.map(eventText).join('\n')
    const historicalCleanupFailureDetected = matchingEvents.length > 0

    if (
      ![
        'windows-appx-deployment-deleted-package-cleanup-access-denied',
        'windows-appx-deployment-deleted-package-cleanup-failure',
        'no-known-windows-msix-host-blocker',
      ].includes(classification.kind)
    ) {
      fail(`${reportPath} blockerClassification.kind must be known.`)
    }

    if (classification.releaseEvidence !== false) {
      fail(`${reportPath} blockerClassification.releaseEvidence must remain false.`)
    }

    if (typeof classification.historicalCleanupFailureDetected !== 'boolean') {
      fail(
        `${reportPath} blockerClassification.historicalCleanupFailureDetected must be a boolean.`,
      )
    } else if (
      classification.historicalCleanupFailureDetected !== historicalCleanupFailureDetected
    ) {
      fail(
        `${reportPath} blockerClassification.historicalCleanupFailureDetected must match retained AppX cleanup events.`,
      )
    }

    if (typeof classification.resolved !== 'boolean') {
      fail(`${reportPath} blockerClassification.resolved must be a boolean.`)
    }

    if (!['present', 'absent', 'unknown', 'not-applicable'].includes(classification.currentPresence)) {
      fail(
        `${reportPath} blockerClassification.currentPresence must be present, absent, unknown, or not-applicable.`,
      )
    }

    if (!Array.isArray(classification.matchedEventIds)) {
      fail(`${reportPath} blockerClassification.matchedEventIds must be an array.`)
    }

    if (!Array.isArray(classification.matchedExternalPackages)) {
      fail(`${reportPath} blockerClassification.matchedExternalPackages must be an array.`)
    }

    if (!Array.isArray(classification.matchedFailureCodes)) {
      fail(`${reportPath} blockerClassification.matchedFailureCodes must be an array.`)
    }
    const matchedEventIds = Array.isArray(classification.matchedEventIds)
      ? classification.matchedEventIds
      : []
    const matchedExternalPackages = Array.isArray(classification.matchedExternalPackages)
      ? classification.matchedExternalPackages
      : []
    const matchedFailureCodes = Array.isArray(classification.matchedFailureCodes)
      ? classification.matchedFailureCodes
      : []

    const assessments = Array.isArray(classification.targetAssessments)
      ? classification.targetAssessments
      : []
    if (!Array.isArray(classification.targetAssessments)) {
      fail(`${reportPath} blockerClassification.targetAssessments must be an array.`)
    }

    for (const [index, assessment] of assessments.entries()) {
      const label = `${reportPath} blockerClassification.targetAssessments[${index}]`
      if (!isObject(assessment)) {
        fail(`${label} must be an object.`)
        continue
      }

      if (!['present', 'absent', 'unknown'].includes(assessment.currentPresence)) {
        fail(`${label}.currentPresence must be present, absent, or unknown.`)
      }

      const expectedAssessmentResolved = assessment.currentPresence === 'absent'
      if (
        typeof assessment.resolved !== 'boolean' ||
        assessment.resolved !== expectedAssessmentResolved
      ) {
        fail(`${label}.resolved must equal currentPresence=absent.`)
      }

      const expectedReliablyDetermined = assessment.currentPresence !== 'unknown'
      if (
        typeof assessment.reliablyDetermined !== 'boolean' ||
        assessment.reliablyDetermined !== expectedReliablyDetermined
      ) {
        fail(`${label}.reliablyDetermined must be false only for unknown presence.`)
      }

      if (assessment.normalizedPath === null) {
        if (assessment.currentPresence !== 'unknown') {
          fail(`${label} without a normalizedPath must remain unknown.`)
        }
      } else if (!isStrictDeletedTargetPath(assessment.normalizedPath)) {
        fail(
          `${label}.normalizedPath must be a canonical concrete child of ${WINDOWS_APPS_DELETED_ROOT}.`,
        )
      } else {
        const auditTextWithoutExtendedPrefix = matchingEventText.replace(/\\\\\?\\/gu, '')
        if (
          !auditTextWithoutExtendedPrefix
            .toLocaleLowerCase('en-US')
            .includes(assessment.normalizedPath.toLocaleLowerCase('en-US'))
        ) {
          fail(`${label}.normalizedPath must come from a retained matching cleanup event.`)
        }
      }

      if (!Array.isArray(assessment.eventIds)) {
        fail(`${label}.eventIds must be an array.`)
      }
      checkStringArray(assessment.sources, `${label}.sources`)
      if (typeof assessment.reason !== 'string' || assessment.reason.trim() === '') {
        fail(`${label}.reason must be a non-empty string.`)
      }

      if (!['locked', 'unlocked', 'unknown', 'not-applicable'].includes(assessment.lockState)) {
        fail(`${label}.lockState must be locked, unlocked, unknown, or not-applicable.`)
      }
      if (typeof assessment.lockReliablyDetermined !== 'boolean') {
        fail(`${label}.lockReliablyDetermined must be a boolean.`)
      }
      if (typeof assessment.lockReason !== 'string' || assessment.lockReason.trim() === '') {
        fail(`${label}.lockReason must be a non-empty string.`)
      }
      if (!Array.isArray(assessment.lockProcesses)) {
        fail(`${label}.lockProcesses must be an array.`)
      }

      const lockProcesses = Array.isArray(assessment.lockProcesses)
        ? assessment.lockProcesses
        : []
      if (
        (assessment.lockState === 'locked' &&
          (assessment.lockReliablyDetermined !== true || lockProcesses.length === 0)) ||
        (assessment.lockState === 'unlocked' &&
          (assessment.lockReliablyDetermined !== true || lockProcesses.length !== 0)) ||
        (assessment.lockState === 'unknown' && assessment.lockReliablyDetermined !== false) ||
        (assessment.lockState === 'not-applicable' &&
          (assessment.lockReliablyDetermined !== true || lockProcesses.length !== 0))
      ) {
        fail(`${label} lock state, reliability, and process list must be internally consistent.`)
      }

      for (const [processIndex, process] of lockProcesses.entries()) {
        const processLabel = `${label}.lockProcesses[${processIndex}]`
        if (!isObject(process)) {
          fail(`${processLabel} must be an object.`)
          continue
        }
        if (!Number.isInteger(process.processId) || process.processId <= 0) {
          fail(`${processLabel}.processId must be a positive integer.`)
        }
        for (const field of ['processName', 'applicationType']) {
          if (typeof process[field] !== 'string' || process[field].trim() === '') {
            fail(`${processLabel}.${field} must be a non-empty string.`)
          }
        }
        if (typeof process.appName !== 'string') {
          fail(`${processLabel}.appName must be a string.`)
        }
        if (typeof process.restartable !== 'boolean') {
          fail(`${processLabel}.restartable must be a boolean.`)
        }
        if (
          process.executablePackage !== null &&
          (typeof process.executablePackage !== 'string' ||
            !/^[A-Za-z0-9._-]+$/u.test(process.executablePackage))
        ) {
          fail(`${processLabel}.executablePackage must be null or a safe WindowsApps package directory name.`)
        }
      }
    }

    const presentTargetCount = assessments.filter(
      (assessment) => assessment?.currentPresence === 'present',
    ).length
    const absentTargetCount = assessments.filter(
      (assessment) => assessment?.currentPresence === 'absent',
    ).length
    const unknownTargetCount = assessments.filter(
      (assessment) => assessment?.currentPresence === 'unknown',
    ).length
    const matchedTargetCount = assessments.filter(
      (assessment) => typeof assessment?.normalizedPath === 'string',
    ).length
    const lockedTargetCount = assessments.filter(
      (assessment) => assessment?.lockState === 'locked',
    ).length
    const unlockedTargetCount = assessments.filter(
      (assessment) => assessment?.lockState === 'unlocked',
    ).length
    const unknownLockTargetCount = assessments.filter(
      (assessment) => assessment?.lockState === 'unknown',
    ).length
    const assessmentLockProcesses = assessments.flatMap((assessment) =>
      Array.isArray(assessment?.lockProcesses) ? assessment.lockProcesses : [],
    )
    const expectedActiveLockProcessIds = Array.from(
      new Set(
        assessmentLockProcesses
          .map((process) => process?.processId)
          .filter((processId) => Number.isInteger(processId) && processId > 0),
      ),
    ).sort((left, right) => left - right)
    const expectedCounts = {
      targetAssessmentCount: assessments.length,
      matchedTargetCount,
      presentTargetCount,
      absentTargetCount,
      unknownTargetCount,
      lockedTargetCount,
      unlockedTargetCount,
      unknownLockTargetCount,
      activeLockProcessCount: expectedActiveLockProcessIds.length,
    }

    const activeLockProcesses = Array.isArray(classification.activeLockProcesses)
      ? classification.activeLockProcesses
      : []
    if (!Array.isArray(classification.activeLockProcesses)) {
      fail(`${reportPath} blockerClassification.activeLockProcesses must be an array.`)
    }
    const activeLockProcessIds = activeLockProcesses
      .map((process) => process?.processId)
      .filter((processId) => Number.isInteger(processId) && processId > 0)
      .sort((left, right) => left - right)
    if (JSON.stringify(activeLockProcessIds) !== JSON.stringify(expectedActiveLockProcessIds)) {
      fail(
        `${reportPath} blockerClassification.activeLockProcesses must deduplicate the target lock process ids.`,
      )
    }
    for (const field of ['activeLockApplicationNames', 'activeLockPackages']) {
      if (!Array.isArray(classification[field])) {
        fail(`${reportPath} blockerClassification.${field} must be an array.`)
      }
    }
    if (lockedTargetCount > 0 && !/lock-holder/iu.test(classification.summary ?? '')) {
      fail(`${reportPath} blockerClassification.summary must identify active lock-holder applications.`)
    }
    for (const [field, expected] of Object.entries(expectedCounts)) {
      if (!Number.isInteger(classification[field]) || classification[field] !== expected) {
        fail(`${reportPath} blockerClassification.${field} must equal ${expected}.`)
      }
    }

    const expectedCurrentPresence = historicalCleanupFailureDetected
      ? presentTargetCount > 0
        ? 'present'
        : unknownTargetCount > 0
          ? 'unknown'
          : absentTargetCount > 0
            ? 'absent'
            : 'unknown'
      : 'not-applicable'
    const expectedResolved =
      historicalCleanupFailureDetected && expectedCurrentPresence === 'absent'
    if (classification.currentPresence !== expectedCurrentPresence) {
      fail(
        `${reportPath} blockerClassification.currentPresence must aggregate target assessments as ${expectedCurrentPresence}.`,
      )
    }
    if (classification.resolved !== expectedResolved) {
      fail(
        `${reportPath} blockerClassification.resolved must be true only when every historical target is confirmed absent.`,
      )
    }

    const historicalAccessDenied = matchingEvents.some((event) =>
      accessDeniedPattern.test(eventText(event)),
    )
    const expectedKind =
      historicalCleanupFailureDetected && !expectedResolved
        ? historicalAccessDenied
          ? 'windows-appx-deployment-deleted-package-cleanup-access-denied'
          : 'windows-appx-deployment-deleted-package-cleanup-failure'
        : 'no-known-windows-msix-host-blocker'
    if (classification.kind !== expectedKind) {
      fail(
        `${reportPath} blockerClassification.kind must be ${expectedKind} for the retained events and current target state.`,
      )
    }

    const expectedStatus = expectedKind === 'no-known-windows-msix-host-blocker' ? 'clear' : 'blocked'
    if (
      report.status !== expectedStatus ||
      report.hostReadyForTrustedMsix !== (expectedStatus === 'clear')
    ) {
      fail(
        `${reportPath} current target state must set status=${expectedStatus} and hostReadyForTrustedMsix=${String(expectedStatus === 'clear')}.`,
      )
    }

    if (historicalCleanupFailureDetected) {
      if (!/WindowsApps\\+Deleted/iu.test(matchingEventText) || !cleanupFailurePattern.test(matchingEventText)) {
        fail(`${reportPath} must preserve matching AppX cleanup event snippets for audit.`)
      }

      const expectedEventIds = Array.from(
        new Set(
          matchingEvents
            .map((event) => event?.id)
            .filter((eventId) => eventId !== null && eventId !== undefined),
        ),
      )
      for (const eventId of expectedEventIds) {
        if (!matchedEventIds.includes(eventId)) {
          fail(`${reportPath} blockerClassification.matchedEventIds must include ${eventId}.`)
        }
      }

      const expectedCodes = extractFailureCodes(matchingEventText)
      for (const failureCode of expectedCodes) {
        if (!matchedFailureCodes.includes(failureCode)) {
          fail(
            `${reportPath} blockerClassification.matchedFailureCodes must include ${failureCode}.`,
          )
        }
      }
    } else if (
      assessments.length !== 0 ||
      matchedEventIds.length !== 0 ||
      matchedFailureCodes.length !== 0 ||
      matchedExternalPackages.length !== 0
    ) {
      fail(`${reportPath} without matching cleanup history must not report target assessments or matches.`)
    }

    const expectedPackages = uniqueStrings(
      assessments
        .map((assessment) => deletedPackageName(assessment?.normalizedPath))
        .filter((name) => name && !/^ZeroChat_/u.test(name)),
    )
    for (const packageName of expectedPackages) {
      if (!matchedExternalPackages.includes(packageName)) {
        fail(
          `${reportPath} blockerClassification.matchedExternalPackages must include ${packageName}.`,
        )
      }
    }
  }

  const nextSteps = report.nextSteps
  if (!isObject(nextSteps)) {
    fail(`${reportPath} must include nextSteps.`)
  } else {
    checkStringArray(nextSteps.validationCommands, `${reportPath} nextSteps.validationCommands`)
    checkStringArray(nextSteps.hostActions, `${reportPath} nextSteps.hostActions`)

    for (const command of [
      'pnpm run report:windows-msix-host-preflight',
      'pnpm run check:windows-msix-host-preflight',
      'pnpm run check:runtime-artifacts',
      'pnpm run check:local-cleanup',
    ]) {
      if (!nextSteps.validationCommands?.includes(command)) {
        fail(`${reportPath} nextSteps.validationCommands must include ${command}.`)
      }
    }

    const hostActionText = nextSteps.hostActions?.join('\n') ?? ''
    if (report.status === 'blocked' && !hostActionText.includes('-SkipKnownHostBlockerPreflight')) {
      fail(`${reportPath} blocked nextSteps.hostActions must mention -SkipKnownHostBlockerPreflight after host repair.`)
    }
    if (report.blockerClassification?.activeLockProcessCount > 0) {
      if (!/Close or restart the reported lock-holder applications/iu.test(hostActionText)) {
        fail(
          `${reportPath} blocked lock-holder diagnostics must name the restart-first remediation.`,
        )
      }
    }

    if (
      report.status === 'clear' &&
      report.currentShellElevated === false &&
      !/elevated PowerShell/u.test(hostActionText)
    ) {
      fail(`${reportPath} clear non-elevated nextSteps.hostActions must mention elevated PowerShell.`)
    }
  }
}

if (
  report &&
  requireClear &&
  !(
    report.status === 'clear' &&
    report.hostReadyForTrustedMsix === true &&
    report.blockerClassification?.kind === 'no-known-windows-msix-host-blocker'
  )
) {
  fail(
    `${reportPath} --require-clear requires status=clear, hostReadyForTrustedMsix=true, and no known host blocker before trusted MSIX QA.`,
  )
}

if (failures.length) {
  throw new Error(`Windows MSIX host preflight checks failed:\n- ${failures.join('\n- ')}`)
}

if (report) {
  console.log(`Windows MSIX host preflight check passed: ${reportPath}: ${report.status}`)
} else {
  skipped.push(`${reportPath}: no report`)
  console.log(`Windows MSIX host preflight check skipped: ${skipped.join('; ')}`)
}
