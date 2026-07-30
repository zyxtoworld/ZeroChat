import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = [
  resolve(root, 'node_modules/vitest/vitest.mjs'),
  'run',
  '--coverage.enabled',
  'true',
  '--testTimeout',
  '15000',
]

const child = spawn(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
})

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (code === 0) {
    return
  }

  console.error(
    signal
      ? `Unit coverage stopped by signal ${signal}`
      : `Unit coverage failed with exit code ${code ?? 1}`,
  )
  process.exitCode = code ?? 1
})
