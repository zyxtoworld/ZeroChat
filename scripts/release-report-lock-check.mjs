import { spawnSync } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  releaseReportLockPath,
  releaseReportLockTokenEnv,
  withReleaseReportLock,
} from './release-report-lock.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const absoluteLockPath = resolve(root, releaseReportLockPath)
const failures = []

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

async function lockExists() {
  try {
    await stat(absoluteLockPath)
    return true
  } catch {
    return false
  }
}

function runChild(code, env = process.env) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
  })
}

function runScript(script, args = [], env = process.env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function assertLockClean(label) {
  expect(!(await lockExists()), `${label}: ${releaseReportLockPath} must not be left behind.`)
}

async function writeDeadOwnerLock() {
  await rm(absoluteLockPath, { recursive: true, force: true })
  await mkdir(absoluteLockPath, { recursive: true })
  await writeFile(
    resolve(absoluteLockPath, 'owner.json'),
    `${JSON.stringify(
      {
        purpose: 'release-report-lock-check dead owner fixture',
        pid: 99999999,
        token: 'dead-owner-fixture',
        createdAt: new Date().toISOString(),
        staleAfterMs: 30 * 60 * 1000,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

async function writeReusedPidLock() {
  await rm(absoluteLockPath, { recursive: true, force: true })
  await mkdir(absoluteLockPath, { recursive: true })
  await writeFile(
    resolve(absoluteLockPath, 'owner.json'),
    `${JSON.stringify(
      {
        purpose: 'release-report-lock-check reused pid fixture',
        pid: process.pid,
        token: 'reused-pid-fixture',
        createdAt: new Date().toISOString(),
        processStartedAtMs: 0,
        processEntrypoint: 'release-report-lock-check.mjs',
        staleAfterMs: 30 * 60 * 1000,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

async function checkConcurrentWriterIsBlocked() {
  await withReleaseReportLock('release-report-lock-check parent', async () => {
    const childEnv = { ...process.env }
    delete childEnv[releaseReportLockTokenEnv]
    const child = runChild(
      `
        import { withReleaseReportLock } from './scripts/release-report-lock.mjs'
        try {
          await withReleaseReportLock('release-report-lock-check child', async () => {})
          console.log('LOCK_NOT_BLOCKED')
          process.exit(1)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const blocked = message.includes('Release report refresh is already running')
          console.log(blocked ? 'LOCK_BLOCKED' : message)
          process.exit(blocked ? 0 : 1)
        }
      `,
      childEnv,
    )

    expect(
      child.status === 0 && child.stdout.includes('LOCK_BLOCKED'),
      `Concurrent writer without ${releaseReportLockTokenEnv} must be rejected. stdout=${child.stdout.trim()} stderr=${child.stderr.trim()}`,
    )
  })

  await assertLockClean('concurrent-writer check')
}

async function checkCurrentEvidenceWriterIsBlocked() {
  await withReleaseReportLock('release-report-lock-check current-evidence parent', async () => {
    const childEnv = { ...process.env }
    delete childEnv[releaseReportLockTokenEnv]
    const writer = runScript(
      'scripts/release-current-evidence-summary.mjs',
      ['--write-docs'],
      childEnv,
    )
    const writerOutput = `${writer.stdout}\n${writer.stderr}`
    expect(
      writer.status !== 0 && writerOutput.includes('Release report refresh is already running'),
      `Current evidence document writer without ${releaseReportLockTokenEnv} must be rejected. stdout=${writer.stdout.trim()} stderr=${writer.stderr.trim()}`,
    )
  })

  await assertLockClean('current-evidence-writer check')
}

async function checkAndroidContactSheetWriterIsBlocked() {
  await withReleaseReportLock('release-report-lock-check android-contact-sheet parent', async () => {
    const childEnv = { ...process.env }
    delete childEnv[releaseReportLockTokenEnv]
    const writer = runScript('scripts/android-contact-sheet.mjs', [], childEnv)
    const writerOutput = `${writer.stdout}\n${writer.stderr}`
    expect(
      writer.status !== 0 && writerOutput.includes('Release report refresh is already running'),
      `Android contact-sheet writer without ${releaseReportLockTokenEnv} must be rejected. stdout=${writer.stdout.trim()} stderr=${writer.stderr.trim()}`,
    )
  })

  await assertLockClean('android-contact-sheet-writer check')
}

async function checkRuntimeArtifactReaderIsBlocked() {
  await withReleaseReportLock('release-report-lock-check runtime-artifact parent', async () => {
    const childEnv = { ...process.env }
    delete childEnv[releaseReportLockTokenEnv]
    const reader = runScript('scripts/runtime-smoke-artifact-check.mjs', [], childEnv)
    const readerOutput = `${reader.stdout}\n${reader.stderr}`
    expect(
      reader.status !== 0 && readerOutput.includes('Release report refresh is already running'),
      `Runtime artifact reader without ${releaseReportLockTokenEnv} must be rejected. stdout=${reader.stdout.trim()} stderr=${reader.stderr.trim()}`,
    )
  })

  await assertLockClean('runtime-artifact-reader check')
}

async function checkRuntimeArtifactFailureReleasesLock() {
  const reader = runScript('scripts/runtime-smoke-artifact-check.mjs', [
    '--only-runtime-artifact',
    '--require-runtime-artifact=unsupported',
  ])
  const readerOutput = `${reader.stdout}\n${reader.stderr}`
  expect(
    reader.status === 1 && readerOutput.includes('Required runtime artifact platform must be one of'),
    `Runtime artifact failure must report the invalid platform without bypassing its normal exit path. stdout=${reader.stdout.trim()} stderr=${reader.stderr.trim()}`,
  )

  await assertLockClean('runtime-artifact-failure check')
}

async function checkInheritedTokenIsReentrant() {
  await withReleaseReportLock('release-report-lock-check reentrant parent', async () => {
    const child = runChild(`
      import { withReleaseReportLock } from './scripts/release-report-lock.mjs'
      await withReleaseReportLock('release-report-lock-check reentrant child', async () => {
        console.log('LOCK_REENTERED')
      })
    `)

    expect(
      child.status === 0 && child.stdout.includes('LOCK_REENTERED'),
      `Child process with inherited ${releaseReportLockTokenEnv} must reenter the parent lock. stdout=${child.stdout.trim()} stderr=${child.stderr.trim()}`,
    )
  })

  await assertLockClean('reentrant-token check')
}

async function checkDeadOwnerLockIsCleared() {
  await writeDeadOwnerLock()

  const child = runChild(`
    import { withReleaseReportLock } from './scripts/release-report-lock.mjs'
    await withReleaseReportLock('release-report-lock-check dead-owner child', async () => {
      console.log('DEAD_OWNER_LOCK_CLEARED')
    })
  `)

  expect(
    child.status === 0 && child.stdout.includes('DEAD_OWNER_LOCK_CLEARED'),
    `Dead-owner release report lock must be cleared before acquiring a fresh lock. stdout=${child.stdout.trim()} stderr=${child.stderr.trim()}`,
  )

  await assertLockClean('dead-owner check')
}

async function checkReusedPidLockIsCleared() {
  await writeReusedPidLock()

  const child = runChild(`
    import { withReleaseReportLock } from './scripts/release-report-lock.mjs'
    await withReleaseReportLock('release-report-lock-check reused-pid child', async () => {
      console.log('REUSED_PID_LOCK_CLEARED')
    })
  `)

  expect(
    child.status === 0 && child.stdout.includes('REUSED_PID_LOCK_CLEARED'),
    `Reused-PID release report lock must be cleared before acquiring a fresh lock. stdout=${child.stdout.trim()} stderr=${child.stderr.trim()}`,
  )

  await assertLockClean('reused-pid check')
}

await assertLockClean('initial state')
await checkConcurrentWriterIsBlocked()
await checkCurrentEvidenceWriterIsBlocked()
await checkAndroidContactSheetWriterIsBlocked()
await checkRuntimeArtifactReaderIsBlocked()
await checkRuntimeArtifactFailureReleasesLock()
await checkInheritedTokenIsReentrant()
await checkDeadOwnerLockIsCleared()
await checkReusedPidLockIsCleared()

if (failures.length) {
  console.error(`Release report lock checks failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('Release report lock checks passed')
