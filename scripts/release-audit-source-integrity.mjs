const checkerReadContracts = {
  'completion-audit': [
    'const source = await readFile(path, \'utf8\')',
    'fileTextCache.set(path, source)',
  ],
  'repository-health': [
    "return readFile(path, 'utf8').catch(() => '')",
  ],
}

const syntheticSourcePatterns = [
  /\blegacyInternalMarkers\b/u,
  /\bandroidKotlinAuditView\b/u,
  /const\s+marker\s*=\s*`internal\s+\$\{line\}`/u,
  /\$\{source\}\\n\$\{[^}]+\.join\(['"]\\n['"]\)\}/u,
]

export function assertReleaseAuditSourceIntegrity(checkerId, source) {
  const requiredSnippets = checkerReadContracts[checkerId]
  if (!requiredSnippets) {
    throw new Error(`Unknown release audit checker: ${checkerId}`)
  }

  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      throw new Error(`${checkerId} must read exact source bytes: missing ${snippet}`)
    }
  }

  for (const pattern of syntheticSourcePatterns) {
    if (pattern.test(source)) {
      throw new Error(`${checkerId} must not synthesize source markers: ${pattern}`)
    }
  }
}
