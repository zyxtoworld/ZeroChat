import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'

function workflowJob(source, jobName, nextJobName) {
  const start = source.indexOf(`  ${jobName}:`)
  const end = source.indexOf(`\n  ${nextJobName}:`, start + 1)

  if (start < 0 || end < 0) {
    throw new Error(`Unable to isolate ${jobName} workflow job.`)
  }

  return source.slice(start, end)
}

test('hosted CI explicitly installs development dependencies in every workflow', async () => {
  const workflowPaths = [
    '../../.github/workflows/ci.yml',
    '../../.github/workflows/pages.yml',
    '../../.github/workflows/live-drills.yml',
    '../../.github/workflows/windows-signed-msix.yml',
  ]

  for (const workflowPath of workflowPaths) {
    const workflow = await readFile(new URL(workflowPath, import.meta.url), 'utf8')
    const installCommands = workflow.match(
      /^\s*-\s+run:\s+pnpm install --frozen-lockfile[^\r\n]*/gmu,
    )

    assert.ok((installCommands?.length ?? 0) > 0)
    assert.equal(
      installCommands?.every((command) => command.includes('--prod=false')),
      true,
    )
  }
})

test('hosted CI installs the locked workspace before Windows Node validators', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  )
  const job = workflowJob(workflow, 'windows-native', 'android-native')
  const installIndex = job.indexOf('run: pnpm install --frozen-lockfile')
  const prerequisiteIndex = job.indexOf('name: Check Windows prerequisites')
  const reportValidationIndex = job.indexOf('name: Validate Windows prerequisite report')

  assert.ok(installIndex > -1)
  assert.ok(installIndex < prerequisiteIndex)
  assert.ok(installIndex < reportValidationIndex)
})

test('hosted CI provisions pnpm before Android validators', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  )
  const job = workflowJob(workflow, 'android-native', 'linux-native')
  const installIndex = job.indexOf('run: pnpm install --frozen-lockfile')
  const prerequisiteIndex = job.indexOf('name: Check Android prerequisites')

  assert.match(job, /pnpm\/action-setup@v4/)
  assert.match(job, /version: 11\.13\.1/)
  assert.match(job, /cache: pnpm/)
  assert.match(job, /cache-dependency-path: pnpm-lock\.yaml/)
  assert.ok(installIndex > -1)
  assert.ok(installIndex < prerequisiteIndex)
})

test('hosted Android CI preserves sdkmanager failures around the closed yes pipe', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  )
  const job = workflowJob(workflow, 'android-native', 'linux-native')

  assert.match(
    job,
    /yes \| sdkmanager --licenses >\/dev\/null \|\| test "\$\{PIPESTATUS\[1\]\}" -eq 0/,
  )
})

test('hosted Apple CI treats Swift compiler warnings as build failures', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  )
  const packageJson = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  )
  const job = workflowJob(workflow, 'apple-core', 'hosted-native-ci-evidence')
  const macosBuild = packageJson.scripts['build:apple:macos']
  const simulatorBuild = packageJson.scripts['build:apple:ios-simulator']

  assert.match(job, /run: pnpm run build:apple:debug/)
  assert.match(macosBuild, /swift build -Xswiftc -warnings-as-errors/)
  assert.match(macosBuild, /SWIFT_TREAT_WARNINGS_AS_ERRORS=YES/)
  assert.match(simulatorBuild, /SWIFT_TREAT_WARNINGS_AS_ERRORS=YES/)
})
