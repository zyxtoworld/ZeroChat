import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assertFrontendProductionArtifacts,
  findFrontendDualTrackNarratives,
  scanFrontendSingleImplementation,
} from '../frontend-single-implementation-check.mjs'

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('frontend single-implementation semantic gate', () => {
  it('rejects current/v1 UI narratives and runtime split identifiers', () => {
    expect(
      findFrontendDualTrackNarratives(
        'The current UI and v1 frontend use different selectors.\nconst isCurrentFrontend = true',
        'fixture.ts',
      ),
    ).toHaveLength(2)
  })

  it('rejects explicit two-implementation and Chinese dual-track narratives', () => {
    expect(
      findFrontendDualTrackNarratives(
        'The repository hosts two frontends.\n当前前端与 v3 前端并存。',
        'fixture.md',
      ),
    ).toHaveLength(2)
  })

  it('scans migration-plan documentation instead of exempting its path', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'zerochat-single-implementation-'))
    temporaryRoots.push(root)

    const planFile = 'superpowers/docs/plans/2026-08-07-170601-01-plan-single-web-frontend-migration.md'
    const target = path.join(root, planFile)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, 'The runtime tools retain a legacy/current UI branch.')

    expect(scanFrontendSingleImplementation(root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: planFile, line: 1 }),
      ]),
    )
  })

  it('allows protocol, schema, vault, and report version references', () => {
    expect(
      findFrontendDualTrackNarratives(
        'API /v1/docs\nschema v1\nvault version v1\nreport kind v1',
        'fixture.ts',
      ),
    ).toEqual([])
  })

  it('rejects standalone frontend version branding without treating protocol v1 as UI', () => {
    expect(
      findFrontendDualTrackNarratives(
        'This is the vNext UI.\nThe API remains /v1.',
        'fixture.html',
      ),
    ).toHaveLength(1)
  })

  it('rejects hyphenated legacy UI identity while allowing protocol legacy terminology', () => {
    expect(
      findFrontendDualTrackNarratives(
        'The archived tree is ZeroChat-legacy-ui-archive-20260807.',
        'fixture.md',
      ),
    ).toHaveLength(1)
    expect(
      findFrontendDualTrackNarratives(
        'Cloudflare legacy snapshot migration remains supported by the sync protocol.',
        'fixture.ts',
      ),
    ).toEqual([])
  })

  it('rejects version-paired DOM, onboarding, and visual smoke branches without requiring the word frontend', () => {
    const fixtures = [
      'const selector = current/v1 DOM selector',
      'locale smoke keeps a legacy/current first-run flavor',
      'visual audit captures current and v1 screenshots',
    ]

    for (const source of fixtures) {
      expect(findFrontendDualTrackNarratives(source, 'fixture.mjs')).not.toEqual([])
    }
  })

  it('scans native and alternate frontend text extensions instead of skipping them', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'zerochat-single-implementation-'))
    temporaryRoots.push(root)

    for (const [file, source] of [
      ['apps/android/MainActivity.kt', '当前前端与 v3 前端并存。'],
      ['apps/windows/MainWindow.cpp', 'The current UI and v1 frontend use different selectors.'],
      ['tools/config.toml', 'The repository hosts two frontends.'],
    ]) {
      const target = path.join(root, file)
      const directory = path.dirname(target)
      mkdirSync(directory, { recursive: true })
      writeFileSync(target, source)
    }

    const findings = scanFrontendSingleImplementation(root)
    expect(findings).toHaveLength(3)
    expect(findings.map(({ file }) => file)).toEqual(
      expect.arrayContaining([
        'apps/android/MainActivity.kt',
        'apps/windows/MainWindow.cpp',
        'tools/config.toml',
      ]),
    )
  })

  it('rejects a static parallel UI tree even without version wording', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'zerochat-single-implementation-'))
    temporaryRoots.push(root)

    const prototypeDir = path.join(root, 'docs', 'ui-prototype')
    mkdirSync(prototypeDir, { recursive: true })
    writeFileSync(path.join(prototypeDir, 'index.html'), '<!doctype html><main>prototype</main>')

    expect(scanFrontendSingleImplementation(root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'docs/ui-prototype' }),
      ]),
    )
  })

  it('rejects stale production artifacts with forbidden visible generation copy', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'zerochat-single-implementation-'))
    temporaryRoots.push(root)

    mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true })
    writeFileSync(
      path.join(root, 'dist', 'assets', 'locale.js'),
      'const copy = "当前 Worker 版本太旧，无法使用旧版增量数据。"',
    )
    writeFileSync(
      path.join(root, 'dist', 'index.html'),
      '<main aria-label="前端 v3">UI vNext</main>',
    )

    expect(() => assertFrontendProductionArtifacts(root)).toThrow(
      /dist\/assets\/locale\.js|dist\/index\.html/u,
    )
  })

  it('rejects stale non-Chinese locale generation copy in production artifacts', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'zerochat-single-implementation-'))
    temporaryRoots.push(root)

    mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true })
    writeFileSync(
      path.join(root, 'dist', 'assets', 'locale-en.js'),
      'const copy = "This Worker version is too old to clear all incremental sync data."',
    )

    expect(() => assertFrontendProductionArtifacts(root)).toThrow(
      /dist\/assets\/locale-en\.js/u,
    )
  })

  it('allows protocol paths and internal operation keys in production artifacts', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'zerochat-single-implementation-'))
    temporaryRoots.push(root)

    mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true })
    writeFileSync(
      path.join(root, 'dist', 'assets', 'runtime.js'),
      'const api = "/v1/chat"; const schema = "schema v1"; const operation = "gist-operation-v2"',
    )

    expect(assertFrontendProductionArtifacts(root)).toEqual({ findings: [] })
  })
})
