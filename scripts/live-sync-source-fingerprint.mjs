import { dependencyClosureSourceFingerprint } from './source-fingerprint.mjs'

export const liveSyncSourceFingerprintRoots = [
  'cloudflare/sync-worker.js',
  'cloudflare/wrangler.toml.example',
  'scripts/live-sync-release-drill.mjs',
  'scripts/live-sync-release-drill-check.mjs',
  'scripts/live-sync-report-sanitizer.mjs',
  'scripts/live-sync-source-fingerprint.mjs',
  'shared/encryption.md',
  'shared/snapshot.schema.json',
  'shared/sync-api.openapi.yaml',
  'shared/sync-vault.schema.json',
  'src/services/accessKey.ts',
  'src/services/appData.ts',
  'src/services/crypto.ts',
  'src/services/skills.ts',
  'src/services/sync.ts',
  'src/services/syncCloudflare.ts',
  'src/services/syncCloudflareClear.ts',
  'src/services/syncDefaults.ts',
  'src/services/syncEndpoint.ts',
  'src/services/syncFlow.ts',
  'src/services/syncGist.ts',
  'src/services/syncIncrementalHelpers.ts',
  'src/services/syncIncrementalRead.ts',
  'src/services/syncIncrementalRemote.ts',
  'src/services/syncIncrementalUpload.ts',
  'src/services/syncMerge.ts',
  'src/services/syncShared.ts',
  'src/storage/db.ts',
  'src/storage/localCrypto.ts',
  'src/storage/secrets.ts',
  'src/types.ts',
]

export function liveSyncSourceFingerprint(options = {}) {
  return dependencyClosureSourceFingerprint({
    ...options,
    roots: liveSyncSourceFingerprintRoots,
    kind: 'zerochat.liveSyncSourceFingerprint.v1',
  })
}
