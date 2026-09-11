import { currentAndroidDebugApkEvidence } from './android-source-fingerprint.mjs'

export function readCurrentAndroidApkEvidence({
  repoRoot,
  loadEvidence = currentAndroidDebugApkEvidence,
} = {}) {
  try {
    const evidence = loadEvidence({ repoRoot })
    return evidence && typeof evidence === 'object' ? evidence : null
  } catch {
    return null
  }
}
