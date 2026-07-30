import { spawn } from 'node:child_process'
import { copyFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_REPORT_PATH = '.manual-qa/live-provider-smoke-current-diagnostic.json'
const DEFAULT_RUNTIME_ARTIFACT_REPORT_PATH = '.manual-qa/live-provider-smoke.json'
const reportPathInput =
  process.env.ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT?.trim() || DEFAULT_REPORT_PATH

function fail(message) {
  console.error(`Live provider diagnostic report failed: ${message}`)
  process.exit(1)
}

function safeReportPath(value) {
  const normalized = value.trim()

  if (!normalized) {
    fail('ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT must not be empty.')
  }

  if (/[\0\r\n]/u.test(normalized) || /^https?:\/\//iu.test(normalized)) {
    fail('ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT must be a local JSON path under .manual-qa.')
  }

  const resolved = path.resolve(normalized)
  const manualQaDir = path.resolve('.manual-qa')
  const relative = path.relative(manualQaDir, resolved)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT must stay under .manual-qa.')
  }

  if (!/^live-provider-smoke(?:-[a-z0-9-]+)?\.json$/u.test(path.basename(resolved))) {
    fail('ZEROCHAT_LIVE_PROVIDER_DIAGNOSTIC_REPORT must be named live-provider-smoke*.json.')
  }

  return normalized
}

function runNode(args, { env = process.env, allowFailure = false } = {}) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', rejectProcess)
    child.on('close', (code) => {
      if (code === 0 || allowFailure) {
        resolveProcess(code ?? 1)
        return
      }

      rejectProcess(new Error(`node ${args.join(' ')} exited with code ${code ?? 1}`))
    })
  })
}

const reportPath = safeReportPath(reportPathInput)
const runtimeArtifactReportPath = safeReportPath(DEFAULT_RUNTIME_ARTIFACT_REPORT_PATH)
const smokeExitCode = await runNode(['scripts/live-provider-smoke.mjs'], {
  allowFailure: true,
  env: {
    ...process.env,
    ZEROCHAT_LIVE_PROVIDER_REPORT: reportPath,
  },
})

await runNode([
  'scripts/runtime-smoke-artifact-check.mjs',
  '--only-live-provider-api-report',
  `--require-live-provider-api-report=${reportPath}`,
])

if (path.resolve(reportPath) !== path.resolve(runtimeArtifactReportPath)) {
  await copyFile(reportPath, runtimeArtifactReportPath)
  await runNode([
    'scripts/runtime-smoke-artifact-check.mjs',
    '--only-live-provider-api-report',
    `--require-live-provider-api-report=${runtimeArtifactReportPath}`,
  ])
}

if (smokeExitCode === 0) {
  console.log(`Live provider diagnostic report validated: ${reportPath}`)
} else {
  console.log(
    `Live provider diagnostic report validated after smoke exit code ${smokeExitCode}: ${reportPath}`,
  )
}
