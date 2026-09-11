import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { withReleaseReportLock } from './release-report-lock.mjs'
import {
  assertVerifyReleaseCheckpointInputBinding,
  createVerifyReleaseCheckpointBinding,
} from './verify-release-checkpoint-binding.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const reportPath = path.join(repoRoot, '.manual-qa', 'verify-release-current.json')
const relativeReportPath = '.manual-qa/verify-release-current.json'
const generatedAt = new Date().toISOString()
const inputBinding = await createVerifyReleaseCheckpointBinding({ repoRoot })
const report = {
  kind: 'zerochat.verifyReleaseCheckpoint.v1',
  version: 1,
  generatedAt,
  startedAt: generatedAt,
  finishedAt: generatedAt,
  status: 'in-progress',
  passed: false,
  releaseEvidence: false,
  evidenceType: 'verify-release-checkpoint-diagnostic',
  safeToPublish: true,
  publishSafetyScope:
    'sanitized source-bound bootstrap checkpoint; no secrets, provider payloads, or release evidence',
  requestedMode: {
    bootstrap: true,
  },
  stepCount: 0,
  failedStepCount: 0,
  failedStepLabels: [],
  failedStep: null,
  failedStepCommand: null,
  failedStepExitCode: null,
  expectedFailure: false,
  expectedFailureKind: null,
  failureSummary: null,
  inputBinding,
  steps: [],
  nextSteps: {
    validationCommands: [
      'pnpm run check:verify-release-checkpoint',
      'pnpm run check:repo',
    ],
  },
}

await withReleaseReportLock('verify-release checkpoint source-binding bootstrap', async () => {
  const temporaryPath = `${reportPath}.${process.pid}.${Date.now()}.tmp`
  await mkdir(path.dirname(reportPath), { recursive: true })
  try {
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, reportPath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
})

await assertVerifyReleaseCheckpointInputBinding({
  binding: report.inputBinding,
  repoRoot,
})

console.log(`Current source-bound checkpoint bootstrap written and validated: ${relativeReportPath}`)
