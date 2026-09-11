import { availableParallelism } from 'node:os'
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'
import { projectLocalBoundaryGlob } from './scripts/project-local-boundary.mjs'

const maxWorkers = Math.min(4, Math.max(1, availableParallelism()))

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      coverage: {
        include: ['src/**/*.{ts,tsx}'],
        provider: 'v8',
        reporter: ['text-summary'],
        thresholds: {
          statements: -3464,
          branches: -2611,
          functions: -965,
          lines: -3343,
          'src/services/{appData,providerSafety,skills}.ts': {
            statements: 90,
            branches: 80,
            functions: 90,
            lines: 90,
          },
          'src/app/automaticSync.ts': {
            statements: 60,
            branches: 75,
            functions: 45,
            lines: 60,
          },
          'src/services/chat.ts': {
            statements: 80,
            branches: 70,
            functions: 85,
            lines: 80,
          },
          'src/services/syncCloudflare.ts': {
            statements: 70,
            branches: 60,
            functions: 75,
            lines: 70,
          },
          'src/services/syncGist.ts': {
            statements: 85,
            branches: 70,
            functions: 90,
            lines: 85,
          },
          'src/storage/db.ts': {
            statements: 80,
            branches: 55,
            functions: 75,
            lines: 80,
          },
          'src/storage/secrets.ts': {
            statements: 85,
            branches: 75,
            functions: 85,
            lines: 85,
          },
          'src/storage/localCrypto.ts': {
            statements: 90,
            branches: 55,
            functions: 80,
            lines: 90,
          },
        },
      },
      exclude: [
        ...configDefaults.exclude,
        // Project-local recovery/temp output can contain copied test trees; never discover it as source.
        projectLocalBoundaryGlob,
        'apps/apple/ContractTests/**',
        'apps/linux/contract-tests/**',
        'apps/windows/tests/**',
        // These contract files are executed by Node's test runner in their dedicated gates.
        'scripts/__tests__/bundle-static-imports.test.mjs',
        'scripts/__tests__/browser-evaluate.test.mjs',
        'scripts/__tests__/browser-indexeddb-cleanup.test.mjs',
        'scripts/__tests__/live-sync-release-documentation-state.test.mjs',
        'scripts/__tests__/native-runtime-package-contract.test.mjs',
        'scripts/__tests__/release-audit-contract-map.test.mjs',
        'scripts/__tests__/release-audit-migration-contract.test.mjs',
        'scripts/__tests__/ui-accessibility-contracts.test.mjs',
        'scripts/__tests__/verify-release-checkpoint-binding.test.mjs',
        'scripts/__tests__/web-current-shell-evidence.test.mjs',
      ],
      maxWorkers,
    },
  }),
)
