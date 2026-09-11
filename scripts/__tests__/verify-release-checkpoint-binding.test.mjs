import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createVerifyReleaseCheckpointBinding,
  verifyReleaseCheckpointExcludedFiles,
  verifyReleaseCheckpointReportPaths,
  verifyReleaseCheckpointSourceRoots,
  assertVerifyReleaseCheckpointInputBinding,
  verifyReleaseCheckpointBindingFailures,
} from '../verify-release-checkpoint-binding.mjs'

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'zerochat-verify-checkpoint-binding-'))
  const sourceRoots = ['src', 'package.json']
  const reportPaths = ['reports/release-diagnostics.json', 'reports/web-current-page.json']

  await mkdir(path.join(repoRoot, 'src'), { recursive: true })
  await mkdir(path.join(repoRoot, 'reports'), { recursive: true })
  await writeFile(path.join(repoRoot, 'src', 'app.js'), 'export const ready = true\n')
  await writeFile(path.join(repoRoot, 'package.json'), '{"name":"fixture"}\n')
  await writeFile(
    path.join(repoRoot, reportPaths[0]),
    '{"kind":"release-diagnostics","status":"blocked"}\n',
  )
  await writeFile(
    path.join(repoRoot, reportPaths[1]),
    '{"kind":"web-current-page","status":"passed"}\n',
  )

  return { repoRoot, sourceRoots, reportPaths }
}

test('guards the exact verification source roots and direct report set', () => {
  assert.deepEqual(verifyReleaseCheckpointSourceRoots, [
    '.github/workflows',
    'apps',
    'docs',
    'eslint.config.js',
    'index.html',
    'package-lock.json',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'public',
    'README.md',
    'scripts',
    'src',
    'tsconfig.app.json',
    'tsconfig.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'vitest.config.ts',
  ])
  assert.deepEqual(verifyReleaseCheckpointReportPaths, [
    '.manual-qa/release-diagnostics-current.json',
    '.manual-qa/release-blockers-current.json',
    '.manual-qa/strict-release-preflight.json',
    '.manual-qa/web-current-page-qa.json',
  ])
  assert.deepEqual(verifyReleaseCheckpointExcludedFiles, [
    'docs/QA_AUDIT.md',
    'docs/REQUIREMENTS.md',
  ])
})

test('binds a verify-release checkpoint to exact source and report content', async (t) => {
  const input = await fixture()
  t.after(() => rm(input.repoRoot, { recursive: true, force: true }))

  const binding = await createVerifyReleaseCheckpointBinding(input)
  assert.deepEqual(
    await verifyReleaseCheckpointBindingFailures({ ...input, binding }),
    [],
  )

  await writeFile(path.join(input.repoRoot, 'src', 'app.js'), 'export const ready = false\n')
  assert.match(
    (await verifyReleaseCheckpointBindingFailures({ ...input, binding })).join('\n'),
    /source fingerprint does not match/u,
  )

  await writeFile(path.join(input.repoRoot, 'src', 'app.js'), 'export const ready = true\n')
  await writeFile(
    path.join(input.repoRoot, input.reportPaths[0]),
    '{"kind":"release-diagnostics","status":"changed"}\n',
  )
  assert.match(
    (await verifyReleaseCheckpointBindingFailures({ ...input, binding })).join('\n'),
    /reports\/release-diagnostics\.json SHA-256 does not match/u,
  )
})

test('fails closed when the checkpoint has no input binding', async (t) => {
  const input = await fixture()
  t.after(() => rm(input.repoRoot, { recursive: true, force: true }))

  assert.match(
    (await verifyReleaseCheckpointBindingFailures({ ...input, binding: undefined })).join('\n'),
    /must include an inputBinding/u,
  )
})

test('asserts the checkpoint binding for consumers instead of allowing a stale shape-only report', async (t) => {
  const input = await fixture()
  t.after(() => rm(input.repoRoot, { recursive: true, force: true }))

  const binding = await createVerifyReleaseCheckpointBinding(input)
  await assertVerifyReleaseCheckpointInputBinding({
    binding,
    repoRoot: input.repoRoot,
    sourceRoots: input.sourceRoots,
    reportPaths: input.reportPaths,
  })

  await assert.rejects(
    () =>
      assertVerifyReleaseCheckpointInputBinding({
        binding: undefined,
        repoRoot: input.repoRoot,
        sourceRoots: input.sourceRoots,
        reportPaths: input.reportPaths,
      }),
    /must include an inputBinding/u,
  )
})

test('excludes generated build caches from the verification source fingerprint', async (t) => {
  const input = await fixture()
  t.after(() => rm(input.repoRoot, { recursive: true, force: true }))

  const before = await createVerifyReleaseCheckpointBinding(input)
  await mkdir(path.join(input.repoRoot, 'src', '.gradle'), { recursive: true })
  await writeFile(path.join(input.repoRoot, 'src', '.gradle', 'cache.bin'), 'generated cache\n')
  const after = await createVerifyReleaseCheckpointBinding(input)

  assert.deepEqual(after.sourceFingerprint, before.sourceFingerprint)
})

test('excludes generated evidence docs but binds other documentation', async (t) => {
  const input = await fixture()
  t.after(() => rm(input.repoRoot, { recursive: true, force: true }))
  input.sourceRoots = ['docs', 'package.json']
  await mkdir(path.join(input.repoRoot, 'docs'), { recursive: true })
  await writeFile(path.join(input.repoRoot, 'docs', 'REQUIREMENTS.md'), 'generated requirements\n')
  await writeFile(path.join(input.repoRoot, 'docs', 'QA_AUDIT.md'), 'generated QA\n')
  await writeFile(path.join(input.repoRoot, 'docs', 'SYNC_SETUP.md'), 'current setup\n')

  const binding = await createVerifyReleaseCheckpointBinding(input)
  await writeFile(path.join(input.repoRoot, 'docs', 'REQUIREMENTS.md'), 'rewritten requirements\n')
  await writeFile(path.join(input.repoRoot, 'docs', 'QA_AUDIT.md'), 'rewritten QA\n')
  assert.deepEqual(
    await verifyReleaseCheckpointBindingFailures({ ...input, binding }),
    [],
  )

  await writeFile(path.join(input.repoRoot, 'docs', 'SYNC_SETUP.md'), 'changed setup\n')
  assert.match(
    (await verifyReleaseCheckpointBindingFailures({ ...input, binding })).join('\n'),
    /source fingerprint does not match/u,
  )
})
