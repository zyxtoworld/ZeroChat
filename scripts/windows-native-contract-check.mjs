import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testsDirectory = resolve(root, 'apps/windows/tests')
const testFiles = (await readdir(testsDirectory))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => resolve(testsDirectory, name))

if (testFiles.length === 0) {
  throw new Error('No Windows native contract tests were found.')
}

const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(process.execPath, ['--test', ...testFiles], {
    cwd: root,
    stdio: 'inherit',
  })
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (signal) {
      reject(new Error(`Windows native contract tests exited from signal ${signal}.`))
      return
    }
    resolveExit(code ?? 1)
  })
})

if (exitCode !== 0) {
  process.exitCode = exitCode
}
