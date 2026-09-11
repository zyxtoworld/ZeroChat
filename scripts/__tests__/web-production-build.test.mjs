import { basename } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  runWebProductionBuild,
  webProductionBuildSteps,
} from '../web-production-build.mjs'

describe('Web production build', () => {
  it('runs Service Worker generation and reachability before Vite, then audits emitted copy', async () => {
    const runStep = vi.fn(async () => {})

    await runWebProductionBuild({ runStep })

    expect(webProductionBuildSteps.map(([label]) => label)).toEqual([
      'Service Worker source build',
      'TypeScript',
      'Web production reachability',
      'Vite production build',
      'Frontend production artifact gate',
    ])
    expect(runStep.mock.calls.map(([label]) => label)).toEqual([
      'Service Worker source build',
      'TypeScript',
      'Web production reachability',
      'Vite production build',
      'Frontend production artifact gate',
    ])
    expect(runStep.mock.calls.map(([, args]) => basename(args[0]))).toEqual([
      'build-service-worker.mjs',
      'tsc',
      'web-production-reachability.mjs',
      'vite.js',
      'frontend-single-implementation-check.mjs',
    ])
    expect(runStep.mock.calls.at(-1)?.[1]).toEqual([
      expect.stringContaining('frontend-single-implementation-check.mjs'),
      '--production-artifacts',
    ])
  })

  it('stops before Vite when an earlier build phase fails', async () => {
    const visited = []

    await expect(
      runWebProductionBuild({
        runStep: async (label) => {
          visited.push(label)
          if (label === 'TypeScript') {
            throw new Error('typecheck failed')
          }
        },
      }),
    ).rejects.toThrow('typecheck failed')

    expect(visited).toEqual(['Service Worker source build', 'TypeScript'])
  })
})
