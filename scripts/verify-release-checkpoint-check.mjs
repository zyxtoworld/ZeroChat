import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const commands = [
  [
    'verify-release checkpoint input-binding contracts',
    ['--test', 'scripts/__tests__/verify-release-checkpoint-binding.test.mjs'],
  ],
  [
    'verify-release checkpoint artifact',
    [
      'scripts/runtime-smoke-artifact-check.mjs',
      '--only-verify-release-checkpoint-report',
      '--require-verify-release-checkpoint=.manual-qa/verify-release-current.json',
    ],
  ],
]

for (const [label, args] of commands) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  })

  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
