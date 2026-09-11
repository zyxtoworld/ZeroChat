import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath

export const webProductionBuildSteps = Object.freeze([
  ['Service Worker source build', [resolve(root, 'scripts/build-service-worker.mjs')]],
  ['TypeScript', [resolve(root, 'node_modules/typescript/bin/tsc'), '-b']],
  ['Web production reachability', [resolve(root, 'scripts/web-production-reachability.mjs')]],
  ['Vite production build', [resolve(root, 'node_modules/vite/bin/vite.js'), 'build']],
  [
    'Frontend production artifact gate',
    [resolve(root, 'scripts/frontend-single-implementation-check.mjs'), '--production-artifacts'],
  ],
])

async function runWebBuildStep(label, args) {
  console.log(`\n==> ${label}`)
  console.log(`node ${args.join(' ')}`)

  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(node, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', rejectRun)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveRun()
        return
      }

      rejectRun(
        new Error(
          signal
            ? `${label} stopped by signal ${signal}`
            : `${label} failed with exit code ${code}`,
        ),
      )
    })
  })
}

export async function runWebProductionBuild(options = {}) {
  const runStep = options.runStep ?? runWebBuildStep

  for (const [label, args] of webProductionBuildSteps) {
    await runStep(label, [...args])
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runWebProductionBuild()
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
