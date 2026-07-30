import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseReportLockPath = '.manual-qa/release-report.lock'
const releaseReportLockTokenEnv = 'ZEROCHAT_RELEASE_REPORT_LOCK_TOKEN'
const staleLockMs = 30 * 60 * 1000
const processStartedAtMs = Date.now() - process.uptime() * 1000
const processEntrypoint = process.argv[1] ? basename(process.argv[1]) : ''
const processStartToleranceMs = 2_000

function lockPath() {
  return resolve(root, releaseReportLockPath)
}

function isMissingPathError(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
}

function fileSystemErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'UNKNOWN'
}

async function readOwner() {
  let source
  try {
    source = await readFile(resolve(lockPath(), 'owner.json'), 'utf8')
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw new Error(
      `Unable to read ${releaseReportLockPath}/owner.json (${fileSystemErrorCode(error)}).`,
    )
  }

  try {
    return JSON.parse(source)
  } catch {
    return null
  }
}

async function statLockPathIfExists() {
  try {
    return await stat(lockPath())
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw new Error(
      `Unable to stat ${releaseReportLockPath} (${fileSystemErrorCode(error)}).`,
    )
  }
}

function formatHeldLockMessage(owner, ageMs) {
  const ownerText = owner
    ? `${owner.purpose ?? 'unknown'} pid=${owner.pid ?? 'unknown'} createdAt=${owner.createdAt ?? 'unknown'}`
    : 'unknown owner'
  const ageSeconds = Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : 'unknown'

  return [
    `Release report refresh is already running (${ownerText}; ageSeconds=${ageSeconds}).`,
    `Lock: ${releaseReportLockPath}`,
    'Wait for that process to finish, then rerun this command.',
  ].join('\n')
}

function expectedEntrypointForPurpose(purpose) {
  const normalized = String(purpose ?? '')
  if (normalized.startsWith('release-diagnostics-')) return 'release-diagnostics-refresh.mjs'
  if (normalized === 'strict-release-preflight-report') return 'strict-release-preflight-report.mjs'
  if (normalized === 'release-blocker-report') return 'release-blocker-report.mjs'
  if (normalized === 'release-current-evidence-summary') return 'release-current-evidence-summary.mjs'
  if (normalized === 'android-contact-sheet') return 'android-contact-sheet.mjs'
  if (normalized === 'runtime-smoke-artifact-check') return 'runtime-smoke-artifact-check.mjs'
  if (normalized.startsWith('verify-release ')) return 'verify-release.mjs'
  if (normalized.startsWith('release-report-lock-check ')) return 'release-report-lock-check.mjs'
  return ''
}

function processDetails(pid) {
  if (process.platform === 'win32') {
    // CIM/WMI can stall while this runs in a lock contender; StartTime is enough
    // to distinguish a live owner from a reused PID without querying command lines.
    const command = `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -eq $process) { exit 3 }; [PSCustomObject]@{ startedAt = $process.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress`
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
    )
    if (result.status !== 0) return null

    try {
      const parsed = JSON.parse(result.stdout.trim())
      return {
        startedAtMs: Date.parse(parsed.startedAt),
        commandLine: '',
      }
    } catch {
      return null
    }
  }

  const result = spawnSync('ps', ['-o', 'lstart=', '-o', 'command=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (result.status !== 0 || !result.stdout.trim()) return null

  const line = result.stdout.trim()
  const startedAtText = line.slice(0, 24).trim()
  return {
    startedAtMs: Date.parse(startedAtText),
    commandLine: line.slice(24).trim(),
  }
}

function lockOwnerProcessAlive(owner) {
  const pid = Number(owner?.pid)

  if (!Number.isInteger(pid) || pid <= 0) {
    return null
  }

  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false
    }

    if (error?.code === 'EPERM') {
      return true
    }

    return null
  }

  const details = processDetails(pid)
  if (!details) {
    return true
  }

  const ownerStartedAtMs = Number(owner?.processStartedAtMs)
  if (
    Number.isFinite(ownerStartedAtMs) &&
    Number.isFinite(details.startedAtMs) &&
    Math.abs(ownerStartedAtMs - details.startedAtMs) > processStartToleranceMs
  ) {
    return false
  }

  const expectedEntrypoint =
    String(owner?.processEntrypoint ?? '') || expectedEntrypointForPurpose(owner?.purpose)
  if (
    expectedEntrypoint &&
    details.commandLine &&
    !details.commandLine.toLowerCase().includes(expectedEntrypoint.toLowerCase())
  ) {
    return false
  }

  return true
}

async function assertReentrantLock(token) {
  const owner = await readOwner()
  if (owner?.token === token) {
    return
  }

  throw new Error(
    [
      `${releaseReportLockTokenEnv} is set, but ${releaseReportLockPath} is not owned by that token.`,
      'Refusing to write release handoff reports without a valid parent lock.',
    ].join('\n'),
  )
}

async function acquireLock(purpose) {
  const token = randomUUID()
  await mkdir(dirname(lockPath()), { recursive: true })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath(), { recursive: false })
      await writeFile(
        resolve(lockPath(), 'owner.json'),
        `${JSON.stringify(
          {
            purpose,
            pid: process.pid,
            token,
            createdAt: new Date().toISOString(),
            processStartedAtMs,
            processEntrypoint,
            staleAfterMs: staleLockMs,
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
      return token
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }

      const [owner, lockStat] = await Promise.all([
        readOwner(),
        statLockPathIfExists(),
      ])
      if (!lockStat) {
        continue
      }

      const mtimeMs = lockStat?.mtimeMs ?? Number.NaN
      const ageMs = Number.isFinite(mtimeMs) ? Date.now() - mtimeMs : Number.NaN
      const ownerAlive = lockOwnerProcessAlive(owner)

      if (ownerAlive === false || (Number.isFinite(ageMs) && ageMs > staleLockMs)) {
        await rm(lockPath(), { recursive: true, force: true })
        continue
      }

      throw new Error(formatHeldLockMessage(owner, ageMs))
    }
  }

  throw new Error(`Unable to acquire ${releaseReportLockPath}.`)
}

export async function withReleaseReportLock(purpose, callback) {
  const inheritedToken = process.env[releaseReportLockTokenEnv]
  if (inheritedToken) {
    await assertReentrantLock(inheritedToken)
    return callback()
  }

  const previousToken = process.env[releaseReportLockTokenEnv]
  const token = await acquireLock(purpose)
  process.env[releaseReportLockTokenEnv] = token

  try {
    return await callback()
  } finally {
    if (previousToken === undefined) {
      delete process.env[releaseReportLockTokenEnv]
    } else {
      process.env[releaseReportLockTokenEnv] = previousToken
    }
    await rm(lockPath(), { recursive: true, force: true })
  }
}

export { releaseReportLockPath, releaseReportLockTokenEnv }
