import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../android-cloud-sync-smoke.mjs', import.meta.url),
  'utf8',
)

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf('\nfunction ', start + 1)

  return source.slice(start, end < 0 ? source.length : end)
}

describe('Android Cloudflare sync hierarchy capture', () => {
  it('uses the fast exec-out hierarchy stream before the file fallback', () => {
    const dumpXml = functionSource('dumpXml')
    const fastPath = dumpXml.indexOf("['exec-out', 'uiautomator', 'dump', '/dev/tty']")
    const fallbackPath = dumpXml.indexOf("['shell', 'timeout', '8', 'uiautomator', 'dump', xmlPath]")

    expect(fastPath).toBeGreaterThanOrEqual(0)
    expect(fallbackPath).toBeGreaterThan(fastPath)
    expect(dumpXml).toContain('hasUsefulHierarchyDump')
  })

  it('bounds every hierarchy fallback command and rejects sparse output', () => {
    const dumpXml = functionSource('dumpXml')

    expect(dumpXml).toContain("runAdb(['shell', 'rm', '-f', xmlPath], { timeout: 5_000 })")
    expect(dumpXml).toContain("runAdb(['shell', 'cat', xmlPath], {")
    expect(dumpXml).toContain('timeout: 15_000')
    expect(dumpXml).toContain('hasUsefulHierarchyDump(xml)')
  })
})
