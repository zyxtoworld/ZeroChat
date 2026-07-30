import { basename } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  runWebProductionBuild,
  webProductionBuildSteps,
} from '../web-production-build.mjs'

describe('Web production build', () => {
  it('runs Service Worker generation before TypeScript and Vite', async () => {
    const runStep = vi.fn(async () => {})

    await runWebProductionBuild({ runStep })

    expect(webProductionBuildSteps.map(([label]) => label)).toEqual([
      'Service Worker source build',
      'TypeScript',
      'Vite production build',
    ])
    expect(runStep.mock.calls.map(([label]) => label)).toEqual([
      'Service Worker source build',
      'TypeScript',
      'Vite production build',
    ])
    expect(runStep.mock.calls.map(([, args]) => basename(args[0]))).toEqual([
      'build-service-worker.mjs',
      'tsc',
      'vite.js',
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
