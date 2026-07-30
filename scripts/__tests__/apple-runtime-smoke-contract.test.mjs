import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'vitest'

const smokeScript = await readFile(
  new URL('../apple-runtime-smoke.sh', import.meta.url),
  'utf8',
)
const windowProbe = await readFile(
  new URL('../apple-window-info.swift', import.meta.url),
  'utf8',
).catch(() => '')
const runtimeArtifactCheck = await readFile(
  new URL('../runtime-smoke-artifact-check.mjs', import.meta.url),
  'utf8',
)
const hostedEvidenceCheck = await readFile(
  new URL('../hosted-native-ci-evidence-check.mjs', import.meta.url),
  'utf8',
)
const hostedEvidenceContract = await readFile(
  new URL('../hosted-native-ci-contract.mjs', import.meta.url),
  'utf8',
)
const appleRuntimeEvidenceContract = await readFile(
  new URL('../apple-runtime-evidence-contract.mjs', import.meta.url),
  'utf8',
).catch(() => '')

describe('Apple runtime smoke contract', () => {
  it('Apple runtime smoke binds the launched process to the current app bundle executable', () => {
    assert.match(
      smokeScript,
      /app_executable="\$app\/Contents\/MacOS\/\$executable"/,
    )
    assert.match(
      smokeScript,
      /"\$app_executable" >\/dev\/null 2>&1 &\s*pid=\$!/,
    )
    assert.doesNotMatch(smokeScript, /pgrep -x/)

    const launchIndex = smokeScript.indexOf('"$app_executable" >/dev/null 2>&1 &')
    const pidIndex = smokeScript.indexOf('pid=$!')
    const windowLookupIndex = smokeScript.indexOf('window_id=""')

    assert.ok(launchIndex >= 0)
    assert.ok(launchIndex < pidIndex)
    assert.ok(pidIndex < windowLookupIndex)
  })

  it('Apple runtime smoke cleans the exact launched process on every exit path', () => {
    assert.match(
      smokeScript,
      /cleanup_app\(\)\s*\{[\s\S]*kill -0 "\$app_pid"[\s\S]*kill "\$app_pid"[\s\S]*wait "\$app_pid"[\s\S]*\}/,
    )
    assert.match(smokeScript, /trap cleanup_app EXIT/)

    const trapIndex = smokeScript.indexOf('trap cleanup_app EXIT')
    const launchIndex = smokeScript.indexOf('"$app_executable" >/dev/null 2>&1 &')
    const screenshotIndex = smokeScript.indexOf('screencapture -x')

    assert.ok(trapIndex >= 0)
    assert.ok(trapIndex < launchIndex)
    assert.ok(launchIndex < screenshotIndex)
  })

  it('discovers the launched app window by CoreGraphics owner PID without UI scripting', () => {
    assert.match(smokeScript, /swiftc "\$window_probe_source" -o "\$window_probe"/)
    assert.match(smokeScript, /"\$window_probe" "\$pid"/)
    assert.doesNotMatch(smokeScript, /osascript|System Events/)

    assert.match(windowProbe, /CGWindowListCopyWindowInfo/)
    assert.match(windowProbe, /\.optionOnScreenOnly/)
    assert.match(windowProbe, /\.excludeDesktopElements/)
    assert.match(windowProbe, /kCGWindowOwnerPID/)
    assert.match(windowProbe, /kCGWindowNumber/)
    assert.match(windowProbe, /kCGWindowLayer/)
    assert.match(windowProbe, /candidate\.area > current\.area/)
  })

  it('Apple runtime metadata and both artifact validators require exact-process window semantics', () => {
    assert.match(
      appleRuntimeEvidenceContract,
      /appleRuntimeProcessAttribution = 'exact-bundle-child-pid'/,
    )
    assert.match(
      appleRuntimeEvidenceContract,
      /appleRuntimeCleanupPolicy = 'bounded-exit-trap'/,
    )
    assert.match(
      appleRuntimeEvidenceContract,
      /appleRuntimeWindowDiscovery = 'coregraphics-owner-pid'/,
    )
    assert.match(
      smokeScript,
      /"processAttribution": "exact-bundle-child-pid"/,
    )
    assert.match(smokeScript, /"cleanupPolicy": "bounded-exit-trap"/)
    assert.match(smokeScript, /"windowDiscovery": "coregraphics-owner-pid"/)
    assert.match(
      runtimeArtifactCheck,
      /processAttribution: appleRuntimeProcessAttribution/,
    )
    assert.match(
      runtimeArtifactCheck,
      /cleanupPolicy: appleRuntimeCleanupPolicy/,
    )
    assert.match(
      runtimeArtifactCheck,
      /windowDiscovery: appleRuntimeWindowDiscovery/,
    )
    assert.match(
      hostedEvidenceContract,
      /processAttribution: appleRuntimeProcessAttribution/,
    )
    assert.match(
      hostedEvidenceContract,
      /cleanupPolicy: appleRuntimeCleanupPolicy/,
    )
    assert.match(
      hostedEvidenceContract,
      /windowDiscovery: appleRuntimeWindowDiscovery/,
    )
    assert.match(
      hostedEvidenceCheck,
      /metadata\.processAttribution !== spec\.processAttribution/,
    )
    assert.match(
      hostedEvidenceCheck,
      /metadata\.cleanupPolicy !== spec\.cleanupPolicy/,
    )
    assert.match(
      hostedEvidenceCheck,
      /metadata\.windowDiscovery !== spec\.windowDiscovery/,
    )
  })
})
