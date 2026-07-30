import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, it } from 'vitest'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('strict release preflight passed artifact', () => {
  it('accepts a current zero-blocker strict pass artifact', async () => {
    const fixtureDirectory = `.manual-qa/__strict-preflight-pass-fixture-${process.pid}`
    const fixturePath = `${fixtureDirectory}/strict-release-preflight.json`
    const absoluteFixtureDirectory = resolve(root, fixtureDirectory)

    const report = {
      kind: 'zerochat.strictReleasePreflight.v1',
      version: 1,
      generatedAt: new Date().toISOString(),
      status: 'passed',
      passed: true,
      releaseEvidence: false,
      evidenceType: 'strict-release-preflight-diagnostic',
      safeToPublish: true,
      publishSafetyScope: 'sanitized-diagnostic-only; no secrets; relative paths only; not release evidence',
      requestedEvidence: {
        allPlatforms: true,
        nativeRuntimeArtifacts: true,
        liveSyncReleasePass: true,
        hostedNativeCiEvidence: true,
        liveProviderFullCapability: true,
      },
      blockerCount: 0,
      blockers: [],
      slowerReleaseChecksStarted: false,
      nextSteps: {
        refreshCommands: [
          'pnpm run report:strict-release-preflight',
          'pnpm run report:release-blockers',
        ],
        validationCommands: [
          'pnpm run check:strict-release-preflight',
          'pnpm run check:release-blockers',
        ],
        releaseGateCommands: [
          'pnpm run verify:all-platforms:runtime-live-sync-hosted-provider',
        ],
      },
    }

    await mkdir(absoluteFixtureDirectory, { recursive: true })
    try {
      await writeFile(resolve(root, fixturePath), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      await execFileAsync(
        process.execPath,
        [
          'scripts/runtime-smoke-artifact-check.mjs',
          '--only-strict-release-preflight-report',
          `--require-strict-release-preflight-report=${fixturePath}`,
        ],
        { cwd: root },
      )
    } finally {
      await rm(absoluteFixtureDirectory, { force: true, recursive: true })
    }
  })
})
