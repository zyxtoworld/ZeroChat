import { spawnSync } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const reportPath = `.manual-qa/windows-msix-host-preflight-check-test-${process.pid}-${Date.now()}.json`
const checkerPath = path.resolve('scripts/windows-msix-host-preflight-check.mjs')
const timestamp = '2026-01-01T00:00:00.000Z'
const deletedTarget =
  'C:\\Program Files\\WindowsApps\\Deleted\\Fixture.Package_1.0.0.0_x64__fixture\\present.pri'

function baseReport() {
  return {
    kind: 'zerochat.windowsMsixHostPreflight.v1',
    version: 1,
    status: 'clear',
    startedAt: timestamp,
    finishedAt: timestamp,
    generatedAt: timestamp,
    evidenceType: 'host-appx-preflight-diagnostic',
    releaseEvidence: false,
    safeToPublish: true,
    publishSafetyScope: 'No provider keys or other secrets are written.',
    sinceHours: 24,
    maxEvents: 80,
    hostReadyForTrustedMsix: true,
    currentShellElevated: false,
    trustedMsixQaCanRunInCurrentShell: false,
    trustedMsixQaReadiness: 'host-clear-current-shell-not-elevated',
    blockerClassification: {
      kind: 'no-known-windows-msix-host-blocker',
      owner: 'host-preflight',
      summary: 'No known blocker.',
      releaseEvidence: false,
      historicalCleanupFailureDetected: false,
      resolved: false,
      currentPresence: 'not-applicable',
      targetAssessmentCount: 0,
      matchedTargetCount: 0,
      presentTargetCount: 0,
      absentTargetCount: 0,
      unknownTargetCount: 0,
      lockedTargetCount: 0,
      unlockedTargetCount: 0,
      unknownLockTargetCount: 0,
      activeLockProcessCount: 0,
      activeLockProcesses: [],
      activeLockApplicationNames: [],
      activeLockPackages: [],
      targetAssessments: [],
      matchedEventIds: [],
      matchedExternalPackages: [],
      matchedFailureCodes: [],
    },
    appxServices: [],
    recentAppxEvents: [],
    nextSteps: {
      validationCommands: [
        'pnpm run report:windows-msix-host-preflight',
        'pnpm run check:windows-msix-host-preflight',
        'pnpm run check:runtime-artifacts',
        'pnpm run check:local-cleanup',
      ],
      hostActions: ['Open an elevated PowerShell before trusted MSIX QA.'],
    },
  }
}

function blockedReport() {
  const report = baseReport()
  report.status = 'blocked'
  report.hostReadyForTrustedMsix = false
  report.trustedMsixQaReadiness = 'host-blocked'
  report.recentAppxEvents = [
    {
      timeCreated: timestamp,
      id: 471,
      level: 'Error',
      activityId: null,
      properties: [deletedTarget, '5'],
      message: `Error 0x5: failed to delete file ${deletedTarget}.`,
    },
  ]
  report.blockerClassification = {
    kind: 'windows-appx-deployment-deleted-package-cleanup-access-denied',
    owner: 'host-windows-appx-deployment-service',
    summary: 'An active lock-holder application still retains the current target.',
    releaseEvidence: false,
    historicalCleanupFailureDetected: true,
    resolved: false,
    currentPresence: 'present',
    targetAssessmentCount: 1,
    matchedTargetCount: 1,
    presentTargetCount: 1,
    absentTargetCount: 0,
    unknownTargetCount: 0,
    lockedTargetCount: 1,
    unlockedTargetCount: 0,
    unknownLockTargetCount: 0,
    activeLockProcessCount: 1,
    activeLockProcesses: [
      {
        processId: 4242,
        processName: 'Fixture.exe',
        appName: 'Fixture',
        applicationType: 'MainWindow',
        restartable: true,
        executablePackage: 'Fixture.Package_1.0.0.0_x64__fixture',
      },
    ],
    activeLockApplicationNames: ['Fixture'],
    activeLockPackages: ['Fixture.Package_1.0.0.0_x64__fixture'],
    targetAssessments: [
      {
        normalizedPath: deletedTarget,
        currentPresence: 'present',
        resolved: false,
        reliablyDetermined: true,
        reason: 'fixture-present',
        lockState: 'locked',
        lockReliablyDetermined: true,
        lockReason: 'fixture-lock-holder',
        lockProcesses: [
          {
            processId: 4242,
            processName: 'Fixture.exe',
            appName: 'Fixture',
            applicationType: 'MainWindow',
            restartable: true,
            executablePackage: 'Fixture.Package_1.0.0.0_x64__fixture',
          },
        ],
        eventIds: [471],
        sources: ['event-property', 'event-message'],
      },
    ],
    matchedEventIds: [471],
    matchedExternalPackages: ['Fixture.Package_1.0.0.0_x64__fixture'],
    matchedFailureCodes: ['0X5'],
  }
  report.nextSteps.hostActions = [
    'Close or restart the reported lock-holder applications (Fixture) before host repair.',
    'After host repair, use -SkipKnownHostBlockerPreflight only for the historical failure report.',
  ]
  return report
}

function resolvedHistoricalReport() {
  const report = baseReport()
  report.recentAppxEvents = [
    {
      timeCreated: timestamp,
      id: 471,
      level: 'Information',
      activityId: null,
      properties: [deletedTarget, '5'],
      message: `Error 0x5: failed to delete file ${deletedTarget}.`,
    },
  ]
  report.blockerClassification = {
    ...report.blockerClassification,
    summary:
      'Historical cleanup failure retained for audit; every safely extracted target is absent.',
    historicalCleanupFailureDetected: true,
    resolved: true,
    currentPresence: 'absent',
    targetAssessmentCount: 1,
    matchedTargetCount: 1,
    absentTargetCount: 1,
    targetAssessments: [
      {
        normalizedPath: deletedTarget,
        currentPresence: 'absent',
        resolved: true,
        reliablyDetermined: true,
        reason: 'path-not-found',
        lockState: 'not-applicable',
        lockReliablyDetermined: true,
        lockReason: 'target-is-not-present',
        lockProcesses: [],
        eventIds: [471],
        sources: ['event-property', 'event-message'],
      },
    ],
    matchedEventIds: [471],
    matchedExternalPackages: ['Fixture.Package_1.0.0.0_x64__fixture'],
    matchedFailureCodes: ['0X5'],
  }
  return report
}

function runChecker(...extraArgs) {
  return spawnSync(process.execPath, [checkerPath, `--report=${reportPath}`, ...extraArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}

afterEach(async () => {
  await rm(reportPath, { force: true })
})

describe('Windows MSIX host preflight checker', () => {
  it('keeps blocked diagnostics valid but rejects them from the strict trusted-QA gate', async () => {
    await writeFile(reportPath, `${JSON.stringify(blockedReport(), null, 2)}\n`)

    expect(runChecker().status).toBe(0)
    const strict = runChecker('--require-clear')
    expect(strict.status).toBe(1)
    expect(`${strict.stdout}\n${strict.stderr}`).toContain(
      '--require-clear requires status=clear, hostReadyForTrustedMsix=true',
    )
  })

  it('accepts a clear host report for the strict trusted-QA gate', async () => {
    await writeFile(reportPath, `${JSON.stringify(baseReport(), null, 2)}\n`)

    expect(runChecker('--require-clear').status).toBe(0)
  })

  it('accepts clear resolved history while retaining AppX audit context', async () => {
    await writeFile(reportPath, `${JSON.stringify(resolvedHistoricalReport(), null, 2)}\n`)

    expect(runChecker('--require-clear').status).toBe(0)
  })

  it('rejects stale active lock-holder aggregates', async () => {
    const report = blockedReport()
    report.blockerClassification.activeLockProcessCount = 0
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

    const result = runChecker()
    expect(result.status).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'blockerClassification.activeLockProcessCount must equal 1',
    )
  })

  it('requires active-work-session guidance when Codex holds a deleted package target', async () => {
    const report = blockedReport()
    report.blockerClassification.activeLockProcesses[0].appName = 'Codex'
    report.blockerClassification.activeLockApplicationNames = ['Codex']
    report.nextSteps.hostActions = [
      'Codex is an active WindowsApps\\Deleted lock holder. Do not interrupt an active Codex work session; use a fresh disposable Windows profile or VM for trusted MSIX QA, or rerun this preflight after Codex exits.',
      'After host repair, use -SkipKnownHostBlockerPreflight only for the historical failure report.',
    ]
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

    expect(runChecker().status).toBe(0)

    report.nextSteps.hostActions[0] =
      'Close or restart the reported lock-holder applications (Codex) before host repair.'
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

    const result = runChecker()
    expect(result.status).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'blocked Codex lock-holder diagnostics must preserve active-work-session remediation.',
    )
  })
})
