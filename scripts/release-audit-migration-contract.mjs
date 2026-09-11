import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { releaseAuditMigrationManifests } from './release-audit-migration-manifest.mjs'
import { resolveWebProductionGraph } from './web-production-reachability.mjs'

const sourceReadNames = new Set(['read', 'readFile', 'readSource', 'readRepositoryFile'])
const nonUiCategories = Object.freeze(['native', 'security', 'transport', 'CI', 'release'])
export const releaseAuditPreserveSourceDeclarationSchema =
  'zerochat.release-audit-preserve-source.v1'
const liveCheckerCurrentPaths = Object.freeze({
  'completion-audit': 'scripts/completion-audit-check.mjs',
  'repository-health': 'scripts/repository-health-check.mjs',
})
const liveCheckerPreserveFileNames = Object.freeze({
  'completion-audit': 'zerochat-completion-audit-check.mjs.preserve.mjs',
  'repository-health': 'zerochat-repository-health-check.mjs.preserve.mjs',
})
export const releaseAuditPreserveFileNames = liveCheckerPreserveFileNames
export const releaseAuditRawDiffContracts = Object.freeze({
  'completion-audit': Object.freeze({ insertions: 3340, deletions: 3442 }),
  'repository-health': Object.freeze({ insertions: 1514, deletions: 924 }),
})
export const releaseAuditRawDiffAlgorithm = Object.freeze({
  edge: 'preserve-to-current',
  command: 'git diff --no-index --numstat -- <preserve> <current>',
  whitespace: 'default',
})
export function isReleaseAuditRawDiffAlgorithm(value) {
  return (
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 3 &&
    value.edge === releaseAuditRawDiffAlgorithm.edge &&
    value.command === releaseAuditRawDiffAlgorithm.command &&
    value.whitespace === releaseAuditRawDiffAlgorithm.whitespace
  )
}
const migrationCategories = new Set([
  'ui-only',
  'old-web-only-removal',
  'current-production-UI',
  'current-store',
  'current-store-sync-migration',
  'i18n-migration',
  'helper-preflight-integration',
  'native',
  'security',
  'transport',
  'CI',
  'release',
])
export const releaseAuditMigrationCategories = Object.freeze([...migrationCategories])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function migrationDeltaEntryShape(entry) {
  return {
    direction: entry.direction,
    hash: entry.hash,
    index: entry.index,
    kind: entry.kind,
    scope: entry.scope,
    parentHash: entry.parentHash,
    ordinal: entry.ordinal,
    arrayIndex: entry.arrayIndex,
    elementIndex: entry.elementIndex,
    text: entry.text,
    category: entry.category,
    reason: entry.reason,
  }
}

export function migrationDeltaFingerprint({ removed, added, arrayChangedStatements }) {
  return sha256(
    JSON.stringify({
      removed: removed.map(migrationDeltaEntryShape),
      added: added.map(migrationDeltaEntryShape),
      arrayChangedStatements,
    }),
  )
}

function migrationOccurrenceGroupKey(direction, entry) {
  return [
    direction,
    entry.hash,
    entry.kind,
    entry.scope,
    entry.parentHash ?? '',
    entry.arrayIndex ?? '',
  ].join('|')
}

function withStableMigrationOccurrenceOrdinals(entries, direction) {
  const ordinals = new Map()
  return entries.map((entry) => {
    const groupKey = migrationOccurrenceGroupKey(direction, entry)
    const ordinal = ordinals.get(groupKey) ?? 0
    ordinals.set(groupKey, ordinal + 1)
    return {
      ...entry,
      direction,
      ordinal,
    }
  })
}

export function releaseAuditMigrationOccurrenceKey(direction, entry) {
  return JSON.stringify({
    direction,
    hash: entry.hash,
    kind: entry.kind,
    scope: entry.scope,
    parentHash: entry.parentHash ?? null,
    arrayIndex: entry.arrayIndex ?? null,
    ordinal: entry.ordinal,
  })
}

function multisetDifference(left, right) {
  const remaining = new Map()
  for (const value of right) {
    remaining.set(value, (remaining.get(value) ?? 0) + 1)
  }
  const difference = []
  for (const value of left) {
    const count = remaining.get(value) ?? 0
    if (count > 0) {
      remaining.set(value, count - 1)
    } else {
      difference.push(value)
    }
  }
  return difference.sort()
}

function sameMultiset(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function assertMigrationDeltaEntries(manifest) {
  if (
    !manifest.preserve ||
    !Array.isArray(manifest.preserve.topLevelHashes) ||
    !Array.isArray(manifest.preserve.arrayElementHashes)
  ) {
    throw new Error(
      `${manifest.checkerId} manifest must anchor preserve top-level and array-element hashes.`,
    )
  }
  if (
    manifest.preserve.topLevelHashes.some((value) => typeof value !== 'string') ||
    manifest.preserve.arrayElementHashes.some(
      (statement) =>
        !Number.isInteger(statement.beforeIndex) ||
        typeof statement.beforeHash !== 'string' ||
        !Array.isArray(statement.arrays) ||
        statement.arrays.some(
          (array) =>
            !Number.isInteger(array.arrayIndex) ||
            !Array.isArray(array.hashes) ||
            array.hashes.some((value) => typeof value !== 'string'),
        ),
    )
  ) {
    throw new Error(
      `${manifest.checkerId} manifest has invalid preserve AST hash anchors.`,
    )
  }
  if (
    manifest.preserve.topLevelHashes.length !== manifest.preserve.nodeCount ||
    new Set(manifest.preserve.topLevelHashes).size === 0
  ) {
    throw new Error(
      `${manifest.checkerId} manifest preserve top-level hash anchor count is invalid.`,
    )
  }
  const expectedRawDiff = releaseAuditRawDiffContracts[manifest.checkerId]
  if (
    expectedRawDiff &&
    (manifest.preserve.rawDiffStats?.insertions !== expectedRawDiff.insertions ||
      manifest.preserve.rawDiffStats?.deletions !== expectedRawDiff.deletions ||
      !isReleaseAuditRawDiffAlgorithm(manifest.preserve.rawDiffAlgorithm))
  ) {
    throw new Error(
      `${manifest.checkerId} manifest must declare the exact preserve-to-current raw diff ` +
        `${expectedRawDiff.insertions}/${expectedRawDiff.deletions} and algorithm.`,
    )
  }
  const preserveArrayKeys = manifest.preserve.arrayElementHashes.map(
    (statement) => `${statement.beforeIndex}:${statement.beforeHash}`,
  )
  if (new Set(preserveArrayKeys).size !== preserveArrayKeys.length) {
    throw new Error(
      `${manifest.checkerId} manifest repeats a preserve array statement anchor.`,
    )
  }
  const seen = new Set()
  for (const [direction, entries] of [
    ['removed', manifest.removed],
    ['added', manifest.added],
  ]) {
    if (!Array.isArray(entries)) {
      throw new Error(`${manifest.checkerId} manifest ${direction} delta must be an array.`)
    }
    for (const entry of entries) {
      if (
        entry.direction !== direction ||
        !Number.isInteger(entry.index) ||
        !Number.isInteger(entry.ordinal) ||
        entry.ordinal < 0 ||
        !['top-level', 'array-element'].includes(entry.scope) ||
        typeof entry.hash !== 'string' ||
        typeof entry.text !== 'string' ||
        sha256(entry.text) !== entry.hash ||
        typeof entry.category !== 'string' ||
        entry.category.length === 0 ||
        !migrationCategories.has(entry.category) ||
        typeof entry.reason !== 'string' ||
        entry.reason.length === 0 ||
        (entry.scope === 'array-element' &&
          (!Number.isInteger(entry.arrayIndex) ||
            !Number.isInteger(entry.elementIndex) ||
            typeof entry.parentHash !== 'string'))
      ) {
        throw new Error(
          `${manifest.checkerId} manifest has an invalid or unknown-category ${direction} top-level/array-element delta entry.`,
        )
      }
      const key = releaseAuditMigrationOccurrenceKey(direction, entry)
      if (seen.has(key)) {
        throw new Error(`${manifest.checkerId} manifest repeats delta entry ${key}.`)
      }
      seen.add(key)
    }
  }
  if (!Array.isArray(manifest.arrayChangedStatements)) {
    throw new Error(`${manifest.checkerId} manifest arrayChangedStatements must be an array.`)
  }
}

function normalizedNodeText(node, sourceFile) {
  return node.getText(sourceFile).replaceAll('\r\n', '\n').trim()
}

function sourceFileFor(source, fileName = '<audit-checker>') {
  return ts.createSourceFile(
    fileName,
    String(source),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
}

function topLevelRecords(source, fileName) {
  const sourceFile = sourceFileFor(source, fileName)
  return {
    sourceFile,
    records: sourceFile.statements.map((node, index) => {
      const text = normalizedNodeText(node, sourceFile)
      return {
        hash: sha256(text),
        index,
        kind: ts.SyntaxKind[node.kind],
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        node,
        parentHash: null,
        text,
      }
    }),
  }
}

function outerArrayLiterals(node) {
  const arrays = []

  function visit(current, insideArray) {
    const isArray = ts.isArrayLiteralExpression(current)
    if (isArray && !insideArray) arrays.push(current)
    ts.forEachChild(current, (child) => visit(child, insideArray || isArray))
  }

  visit(node, false)
  return arrays
}

function arrayMaskedText(record, sourceFile) {
  const start = record.node.getStart(sourceFile)
  let text = sourceFile.text.slice(start, record.node.getEnd())
  const ranges = outerArrayLiterals(record.node)
    .map((array) => ({
      end: array.getEnd() - start,
      start: array.getStart(sourceFile) - start,
    }))
    .sort((left, right) => right.start - left.start)

  for (const range of ranges) {
    text = `${text.slice(0, range.start)}[<AUDIT_ARRAY_ELEMENTS>]${text.slice(range.end)}`
  }

  return text.replaceAll('\r\n', '\n').trim()
}

function takeExactMatches(beforeRecords, afterRecords) {
  const afterByText = new Map()
  afterRecords.forEach((record, index) => {
    const queue = afterByText.get(record.text) ?? []
    queue.push(index)
    afterByText.set(record.text, queue)
  })
  const matchedAfter = new Set()
  const unmatchedBefore = []

  for (const record of beforeRecords) {
    const queue = afterByText.get(record.text)
    while (queue?.length && matchedAfter.has(queue[0])) queue.shift()
    if (queue?.length) {
      matchedAfter.add(queue.shift())
    } else {
      unmatchedBefore.push(record)
    }
  }

  return {
    unmatchedBefore,
    unmatchedAfter: afterRecords.filter((_, index) => !matchedAfter.has(index)),
  }
}

function pairArrayOnlyChanges(before, after, beforeSourceFile, afterSourceFile) {
  const afterByStructure = new Map()
  after.forEach((record, index) => {
    const key = arrayMaskedText(record, afterSourceFile)
    const queue = afterByStructure.get(key) ?? []
    queue.push({ index, record })
    afterByStructure.set(key, queue)
  })
  const pairedAfterIndexes = new Set()
  const pairs = []
  const unmatchedBefore = []

  for (const beforeRecord of before) {
    const key = arrayMaskedText(beforeRecord, beforeSourceFile)
    const queue = afterByStructure.get(key)
    while (queue?.length && pairedAfterIndexes.has(queue[0].index)) queue.shift()
    if (!queue?.length || outerArrayLiterals(beforeRecord.node).length === 0) {
      unmatchedBefore.push(beforeRecord)
      continue
    }
    const pair = queue.shift()
    pairedAfterIndexes.add(pair.index)
    pairs.push([beforeRecord, pair.record])
  }

  return {
    pairs,
    unmatchedBefore,
    unmatchedAfter: after.filter((_, index) => !pairedAfterIndexes.has(index)),
  }
}

function elementRecords(record, sourceFile) {
  const arrays = outerArrayLiterals(record.node)
  const parentHashes = arrays.map((array) => sha256(arrayMaskedText(record, sourceFile)))
  return arrays.flatMap((array, arrayIndex) =>
    array.elements.map((element, elementIndex) => {
      const text = normalizedNodeText(element, sourceFile)
      return {
        arrayIndex,
        elementIndex,
        hash: sha256(text),
        index: record.index,
        kind: ts.SyntaxKind[element.kind],
        line: sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile)).line + 1,
        node: element,
        parentHash: parentHashes[arrayIndex],
        scope: 'array-element',
        text,
      }
    }),
  )
}

function staticString(node) {
  return ts.isStringLiteralLike(node) ? node.text : null
}

function isCurrentWebDataMetaContractReplacement(beforeRecord, afterRecord) {
  if (
    !ts.isArrayLiteralExpression(beforeRecord.node) ||
    !ts.isArrayLiteralExpression(afterRecord.node) ||
    beforeRecord.node.elements.length !== 3 ||
    afterRecord.node.elements.length !== 3
  ) {
    return false
  }

  const [beforeOwner, beforeMarker, beforeMessage] = beforeRecord.node.elements
  const [afterOwner, afterMarker, afterMessage] = afterRecord.node.elements
  if (
    !ts.isIdentifier(beforeOwner) ||
    !ts.isIdentifier(afterOwner) ||
    beforeOwner.text !== 'repositoryHealth' ||
    afterOwner.text !== beforeOwner.text
  ) {
    return false
  }

  const retiredText = `${staticString(beforeMarker) ?? ''}\n${staticString(beforeMessage) ?? ''}`
  const replacementText = `${staticString(afterMarker) ?? ''}\n${staticString(afterMessage) ?? ''}`
  return (
    retiredText.includes('Web encrypted backup export/import/reset') &&
    retiredText.includes('settingsActions') &&
    retiredText.includes('settingsDataRuntimeController') &&
    replacementText.includes('assertCurrentWebSyncContract({') &&
    replacementText.includes('current production store data lifecycle contract')
  )
}

function markPairedCurrentWebDataMetaContractChanges(removed, added) {
  const usedAddedIndexes = new Set()
  for (const removedRecord of removed) {
    const replacementIndex = added.findIndex(
      (addedRecord, index) =>
        !usedAddedIndexes.has(index) &&
        isCurrentWebDataMetaContractReplacement(removedRecord, addedRecord),
    )
    if (replacementIndex < 0) continue
    usedAddedIndexes.add(replacementIndex)
    removedRecord.safePairedReplacement = 'current-web-data-meta-contract'
  }
}

function isServiceWorkerBootstrapImportAssertionReplacement(
  beforeRecord,
  afterRecord,
) {
  return (
    beforeRecord.scope === 'top-level' &&
    afterRecord.scope === 'top-level' &&
    /expect\(\s*mainSource\s*,/u.test(beforeRecord.text) &&
    beforeRecord.text.includes("from './services/serviceWorkerRegistration'") &&
    beforeRecord.text.includes(
      'Web/PWA main entry must import the service worker registration installer.',
    ) &&
    /expect\(\s*mainSource\s*,/u.test(afterRecord.text) &&
    afterRecord.text.includes("from '../services/serviceWorkerRegistration'") &&
    afterRecord.text.includes(
      'Web/PWA production bootstrap must import the service worker registration installer.',
    )
  )
}

function markPairedProductionAssertionRepairs(removed, added) {
  const usedAddedIndexes = new Set()
  for (const removedRecord of removed) {
    const replacementIndex = added.findIndex(
      (addedRecord, index) =>
        !usedAddedIndexes.has(index) &&
        isServiceWorkerBootstrapImportAssertionReplacement(
          removedRecord,
          addedRecord,
        ),
    )
    if (replacementIndex < 0) continue
    usedAddedIndexes.add(replacementIndex)
    removedRecord.safePairedReplacement =
      'production-bootstrap-service-worker-import'
  }

  for (const removedRecord of removed) {
    const retiredOwner = 'after appBootstrapController owns it.'
    if (
      !removedRecord.text.includes('expectAbsent(') ||
      !removedRecord.text.includes('appSource') ||
      !removedRecord.text.includes(retiredOwner)
    ) {
      continue
    }
    const replacementText = removedRecord.text.replace(
      retiredOwner,
      'after the current store owns it.',
    )
    if (added.some((addedRecord) => addedRecord.text === replacementText)) {
      removedRecord.safePairedReplacement =
        'current-store-startup-owner-narrative'
    }
  }

  const currentStoreStartupReplacementMarkers = [
    "expect(appSource, 'void useAppStore.getState().init()'",
    "expect(appStoreSource, 'init: () => {'",
    'if (activeInitializationPromise) return activeInitializationPromise',
    'sanitizes startup AppData before loading secrets and cleans removed Provider tombstones',
    'fails startup before persistence and secrets when removed Provider cleanup cannot be journaled',
    'coalesces concurrent startup hydration into one current store owner',
  ]
  const hasCompleteCurrentStoreStartupReplacement =
    currentStoreStartupReplacementMarkers.every((marker) =>
      added.some((record) => record.text.replaceAll(/\s+/gu, ' ').includes(marker)),
    )
  if (hasCompleteCurrentStoreStartupReplacement) {
    for (const removedRecord of removed) {
      const retiredStartupControllerAssertion =
        removedRecord.text.includes('appSource') &&
        (removedRecord.text.includes("from './services/appBootstrapController'") ||
          removedRecord.text.includes('useAppBootstrapController({'))
      if (retiredStartupControllerAssertion) {
        removedRecord.safePairedReplacement = 'current-store-startup-hydration'
      }
    }
  }

  const currentStorePassphraseReplacementMarkers = [
    "expect(appStoreSource, 'setSyncPassphrase: async (value) =>'",
    "expect(appStoreSource, '() => persistSyncPassphrase(value)'",
    'publishes a changed sync passphrase only after durable storage and queues one current-owner sync',
    'keeps the committed sync passphrase and skips sync when durable storage rejects the change',
  ]
  const hasCompleteCurrentStorePassphraseReplacement =
    currentStorePassphraseReplacementMarkers.every((marker) =>
      added.some((record) =>
        record.text.replaceAll(/\s+/gu, ' ').includes(marker),
      ),
    )
  if (hasCompleteCurrentStorePassphraseReplacement) {
    for (const removedRecord of removed) {
      const retiredPassphraseControllerAssertion =
        removedRecord.text.includes('appSource') &&
        (removedRecord.text.includes(
          "from './services/syncPassphraseController'",
        ) ||
          removedRecord.text.includes(
            'scheduleAutoSync: (snapshot, delayMs) => scheduleAutoSyncRef.current(snapshot, delayMs)',
          ))
      if (retiredPassphraseControllerAssertion) {
        removedRecord.safePairedReplacement = 'current-store-sync-passphrase'
      }
    }
  }
}

function staticReadFromCall(node) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return null
  if (!sourceReadNames.has(node.expression.text)) return null
  const argument = node.arguments[0]
  if (!argument || !ts.isStringLiteralLike(argument)) return { dynamic: true, path: null }
  return { dynamic: false, path: argument.text.replaceAll('\\', '/') }
}

function directReads(node) {
  const reads = []
  function visit(current) {
    const read = staticReadFromCall(current)
    if (read) reads.push(read)
    ts.forEachChild(current, visit)
  }
  visit(node)
  return reads
}

function declaredNames(node) {
  const names = []
  function visitBinding(name) {
    if (ts.isIdentifier(name)) names.push(name.text)
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) visitBinding(element.name)
      }
    }
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) visitBinding(declaration.name)
  } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
    names.push(node.name.text)
  }
  return names
}

function isDeclarationIdentifier(node) {
  const parent = node.parent
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node)
  )
}

function referencedNames(node) {
  const names = new Set()
  function visit(current) {
    if (ts.isIdentifier(current) && !isDeclarationIdentifier(current)) names.add(current.text)
    ts.forEachChild(current, visit)
  }
  visit(node)
  return names
}

function topLevelOrigins(sourceFile) {
  const declarations = new Map()
  const infrastructure = new Set(['failures'])

  for (const statement of sourceFile.statements) {
    for (const name of declaredNames(statement)) {
      declarations.set(name, {
        dynamic: false,
        paths: new Set(),
        statement,
      })
      if (/^(?:assert|expect|format|normalize|readJson|should|lineCount)/u.test(name)) {
        infrastructure.add(name)
      }
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [name, origin] of declarations) {
      const reads = directReads(origin.statement)
      const nextPaths = new Set(origin.paths)
      let nextDynamic = origin.dynamic || reads.some((read) => read.dynamic)
      for (const read of reads) if (read.path) nextPaths.add(read.path)
      for (const reference of referencedNames(origin.statement)) {
        if (reference === name) continue
        const dependency = declarations.get(reference)
        if (!dependency) continue
        nextDynamic ||= dependency.dynamic
        for (const sourcePath of dependency.paths) nextPaths.add(sourcePath)
      }
      if (nextDynamic !== origin.dynamic || nextPaths.size !== origin.paths.size) {
        origin.dynamic = nextDynamic
        origin.paths = nextPaths
        changed = true
      }
    }
  }

  return { declarations, infrastructure }
}

function emptyPlaceholderName(record, sourceFile) {
  const node = record.node
  if (!ts.isVariableStatement(node) || node.declarationList.declarations.length !== 1) return null
  const declaration = node.declarationList.declarations[0]
  if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return null
  if (!ts.isStringLiteral(declaration.initializer) || declaration.initializer.text !== '') return null
  const name = declaration.name.text
  let references = 0
  function visit(current) {
    if (ts.isIdentifier(current) && current.text === name) references += 1
    ts.forEachChild(current, visit)
  }
  visit(sourceFile)
  return references === 1 && /(?:Source|source|Test)$/u.test(name) ? name : null
}

function classifyRemoval(
  record,
  beforeSourceFile,
  origins,
  sourcePathStatus,
  knownClassifications = null,
) {
  const known = knownClassifications?.get(record.hash)
  if (known) {
    return {
      classification: known.category,
      details: known.reason,
    }
  }
  if (record.safePairedReplacement === 'current-web-data-meta-contract') {
    return {
      classification: 'paired-current-web-data-meta-contract',
      details: 'repositoryHealth current-store data lifecycle contract',
    }
  }
  if (
    record.safePairedReplacement ===
    'production-bootstrap-service-worker-import'
  ) {
    return {
      classification: 'paired-production-bootstrap-service-worker-import',
      details: 'src/app/bootstrap.tsx service-worker registration import',
    }
  }
  if (record.safePairedReplacement === 'current-store-startup-hydration') {
    return {
      classification: 'paired-current-store-startup-hydration',
      details: 'src/app/App.tsx -> src/app/store.ts startup lifecycle',
    }
  }
  if (
    record.safePairedReplacement ===
    'current-store-startup-owner-narrative'
  ) {
    return {
      classification: 'paired-current-store-startup-owner-narrative',
      details: 'current store startup ownership narrative with unchanged assertion marker',
    }
  }
  if (record.safePairedReplacement === 'current-store-sync-passphrase') {
    return {
      classification: 'paired-current-store-sync-passphrase',
      details: 'src/app/store.ts durable passphrase commit and latest-owner sync',
    }
  }

  const placeholder = record.scope !== 'array-element'
    ? emptyPlaceholderName(record, beforeSourceFile)
    : null
  if (placeholder) {
    return {
      classification: 'dead-empty-web-placeholder',
      details: placeholder,
    }
  }

  if (
    record.scope === 'array-element' &&
    (ts.isStringLiteral(record.node) || ts.isNoSubstitutionTemplateLiteral(record.node)) &&
    (record.node.text.startsWith('src/') || record.node.text.startsWith('public/'))
  ) {
    const sourcePath = record.node.text
    const status = sourcePathStatus(sourcePath)
    if (status === 'missing' || status === 'not-production-reachable') {
      return {
        classification: 'unreachable-web-path-literal',
        details: [{ sourcePath, status }],
      }
    }
    return {
      violation: `production-reachable Web path literal ${sourcePath}=${status}`,
    }
  }

  const reads = directReads(record.node)
  const paths = new Set(reads.flatMap((read) => (read.path ? [read.path] : [])))
  let dynamic = reads.some((read) => read.dynamic)
  const unknownTopLevelReferences = new Set()

  for (const reference of referencedNames(record.node)) {
    const origin = origins.declarations.get(reference)
    if (!origin) continue
    dynamic ||= origin.dynamic
    for (const sourcePath of origin.paths) paths.add(sourcePath)
    if (
      origin.paths.size === 0 &&
      !origins.infrastructure.has(reference) &&
      !declaredNames(record.node).includes(reference)
    ) {
      unknownTopLevelReferences.add(reference)
    }
  }

  if (dynamic) return { violation: 'dynamic source read' }
  if (unknownTopLevelReferences.size > 0) {
    return {
      violation: `unclassified deletion references ${[...unknownTopLevelReferences].join(', ')}`,
    }
  }
  if (paths.size === 0) return { violation: 'unclassified deletion' }

  const pathStates = [...paths].map((sourcePath) => ({
    sourcePath,
    status: sourcePathStatus(sourcePath),
  }))
  const allUnreachableWeb = pathStates.every(
    ({ sourcePath, status }) =>
      (sourcePath.startsWith('src/') || sourcePath.startsWith('public/')) &&
      (status === 'missing' || status === 'not-production-reachable'),
  )
  if (!allUnreachableWeb) {
    return {
      violation: `mixed or non-Web source dependencies: ${pathStates
        .map(({ sourcePath, status }) => `${sourcePath}=${status}`)
        .join(', ')}`,
    }
  }

  const declaresSource = declaredNames(record.node).some((name) => {
    const origin = origins.declarations.get(name)
    return origin && origin.paths.size > 0
  })
  return {
    classification: declaresSource ? 'unreachable-web-source' : 'unreachable-web-consumer',
    details: pathStates,
  }
}

export function analyzeReleaseAuditMigration({
  beforeSource,
  afterSource,
  sourcePathStatus,
  beforeFile = '<before-checker>',
  afterFile = '<after-checker>',
  knownClassifications = null,
}) {
  const before = topLevelRecords(beforeSource, beforeFile)
  const after = topLevelRecords(afterSource, afterFile)
  const exact = takeExactMatches(before.records, after.records)
  const arrayPairs = pairArrayOnlyChanges(
    exact.unmatchedBefore,
    exact.unmatchedAfter,
    before.sourceFile,
    after.sourceFile,
  )
  const removed = [...arrayPairs.unmatchedBefore.map((record) => ({ ...record, scope: 'top-level' }))]
  const added = [...arrayPairs.unmatchedAfter.map((record) => ({ ...record, scope: 'top-level' }))]

  for (const [beforeRecord, afterRecord] of arrayPairs.pairs) {
    const elementDelta = takeExactMatches(
      elementRecords(beforeRecord, before.sourceFile),
      elementRecords(afterRecord, after.sourceFile),
    )
    markPairedCurrentWebDataMetaContractChanges(
      elementDelta.unmatchedBefore,
      elementDelta.unmatchedAfter,
    )
    removed.push(...elementDelta.unmatchedBefore)
    added.push(...elementDelta.unmatchedAfter)
  }
  markPairedProductionAssertionRepairs(removed, added)

  const origins = topLevelOrigins(before.sourceFile)
  const stableRemoved = withStableMigrationOccurrenceOrdinals(removed, 'removed')
  const stableAdded = withStableMigrationOccurrenceOrdinals(added, 'added')
  const classifiedRemoved = stableRemoved.map((record) => ({
    ...record,
    ...classifyRemoval(
      record,
      before.sourceFile,
      origins,
      sourcePathStatus,
      knownClassifications,
    ),
  }))
  const violations = classifiedRemoved
    .filter((record) => record.violation)
    .map((record) => `${record.scope} line ${record.line}: ${record.violation}`)

  return {
    added: stableAdded,
    removed: classifiedRemoved,
    violations,
  }
}

export function assertSafeReleaseAuditMigration(options) {
  const result = analyzeReleaseAuditMigration(options)
  if (result.violations.length > 0) {
    throw new Error(`Unsafe release-audit migration:\n${result.violations.join('\n')}`)
  }
  return result
}

function categoryForSourcePath(sourcePath, sourceStatus) {
  if (/^src\/app\/(?:store\.ts|__tests__\/store\.test\.ts)$/u.test(sourcePath) ||
      /current-web-sync-contract/u.test(sourcePath)) return 'current-store'
  if (/security|secret|credential|crypto|sanitiz/u.test(sourcePath)) return 'security'
  if (/\.github\/|hosted-native-ci|workflow/u.test(sourcePath)) return 'CI'
  if (/release|evidence|diagnostic|msix|publish|deploy/u.test(sourcePath)) return 'release'
  if (/provider|sync|cloudflare|worker|network|browser|transport/u.test(sourcePath)) return 'transport'
  if (sourcePath.startsWith('apps/')) return 'native'
  if (sourcePath.startsWith('src/') || sourcePath.startsWith('public/')) {
    return sourceStatus === 'production-reachable'
      ? 'current-production-UI'
      : 'ui-only'
  }
  return 'release'
}

function checkerInventory(source, sourcePathStatus) {
  const { sourceFile } = topLevelRecords(source)
  const sourceReads = Object.fromEntries(
    ['ui-only', 'native', 'security', 'transport', 'CI', 'release', 'current-store', 'current-production-UI']
      .map((category) => [category, 0]),
  )
  for (const read of directReads(sourceFile)) {
    if (!read.path) continue
    sourceReads[categoryForSourcePath(read.path, sourcePathStatus(read.path))] += 1
  }
  const topLevelAssertions = sourceFile.statements.filter(
    (statement) =>
      ts.isIfStatement(statement) ||
      ts.isForOfStatement(statement) ||
      ts.isForStatement(statement) ||
      (ts.isExpressionStatement(statement) &&
        /\b(?:assert|expect)(?:[A-Z]\w*)?\s*\(/u.test(normalizedNodeText(statement, sourceFile))),
  ).length
  return { sourceReads, topLevelAssertions }
}

export function defaultSourcePathStatus(root) {
  const reachable = new Set(resolveWebProductionGraph({ root }).files)
  return (sourcePath) => {
    if (!sourcePath.startsWith('src/') && !sourcePath.startsWith('public/')) return 'non-web'
    if (!existsSync(path.resolve(root, sourcePath))) return 'missing'
    return reachable.has(sourcePath) ? 'production-reachable' : 'not-production-reachable'
  }
}

export function assertManifestSourceDeclaration(manifest) {
  const declaration = manifest.sourceDeclaration
  const expectedCurrentPath = liveCheckerCurrentPaths[manifest.checkerId]
  const expectedPreserveFileName = liveCheckerPreserveFileNames[manifest.checkerId]
  if (!declaration || !expectedCurrentPath || !expectedPreserveFileName) {
    throw new Error(`${manifest.checkerId} manifest is missing a source declaration.`)
  }
  if (
    declaration.schema !== releaseAuditPreserveSourceDeclarationSchema ||
    declaration.sourceKind !== 'pre-transform-working-tree' ||
    declaration.preserveRole !== 'external-pre-transform-working-tree-snapshot' ||
    declaration.currentPath !== expectedCurrentPath ||
    typeof declaration.preserveFileName !== 'string' ||
    declaration.preserveFileName.length === 0 ||
    /[\\/]/u.test(declaration.preserveFileName) ||
    declaration.preserveFileName !== expectedPreserveFileName ||
    !/^[^<>:"|?*]+$/u.test(declaration.preserveFileName) ||
    declaration.preserveSha256 !== manifest.preserve.fileSha256 ||
    declaration.currentSha256 !== manifest.current.fileSha256 ||
    declaration.rawDiffStats?.insertions !== manifest.preserve.rawDiffStats?.insertions ||
    declaration.rawDiffStats?.deletions !== manifest.preserve.rawDiffStats?.deletions ||
    JSON.stringify(declaration.rawDiffAlgorithm) !==
      JSON.stringify(manifest.preserve.rawDiffAlgorithm)
  ) {
    throw new Error(`${manifest.checkerId} manifest source declaration is inconsistent.`)
  }
  return declaration
}

function orderedDigest(records) {
  return sha256(records.map((record) => record.hash).join('\n'))
}

export function createExactMigrationManifest({
  checkerId,
  beforeSource,
  afterSource,
  sourcePathStatus,
  classifications,
  preserveSourceDeclaration = null,
}) {
  const before = topLevelRecords(beforeSource, `${checkerId}:pre-transform`)
  const after = topLevelRecords(afterSource, `${checkerId}:current`)
  const exact = takeExactMatches(before.records, after.records)
  const arrayDelta = pairArrayOnlyChanges(
    exact.unmatchedBefore,
    exact.unmatchedAfter,
    before.sourceFile,
    after.sourceFile,
  )
  const classificationByHash = new Map(
    classifications.map((entry) => [`${entry.direction}:${entry.hash}`, entry]),
  )
  const removedTopLevel = arrayDelta.unmatchedBefore.map((record) => ({
    ...record,
    scope: 'top-level',
  }))
  const addedTopLevel = arrayDelta.unmatchedAfter.map((record) => ({
    ...record,
    scope: 'top-level',
  }))
  const removedArrayElements = []
  const addedArrayElements = []
  const arrayChangedStatements = []

  for (const [beforeRecord, afterRecord] of arrayDelta.pairs) {
    const elementDelta = takeExactMatches(
      elementRecords(beforeRecord, before.sourceFile),
      elementRecords(afterRecord, after.sourceFile),
    )
    removedArrayElements.push(...elementDelta.unmatchedBefore)
    addedArrayElements.push(...elementDelta.unmatchedAfter)
    arrayChangedStatements.push({
      beforeHash: beforeRecord.hash,
      beforeIndex: beforeRecord.index,
      afterHash: afterRecord.hash,
      afterIndex: afterRecord.index,
      structureHash: sha256(arrayMaskedText(beforeRecord, before.sourceFile)),
    })
  }

  const preserveArrayElementHashes = arrayDelta.pairs.map(([beforeRecord]) => ({
    beforeIndex: beforeRecord.index,
    beforeHash: beforeRecord.hash,
    arrays: outerArrayLiterals(beforeRecord.node).map((array, arrayIndex) => ({
      arrayIndex,
      hashes: array.elements.map((element) =>
        sha256(normalizedNodeText(element, before.sourceFile)),
      ),
    })),
  }))

  const removedRecords = withStableMigrationOccurrenceOrdinals(
    [...removedTopLevel, ...removedArrayElements],
    'removed',
  )
  const addedRecords = withStableMigrationOccurrenceOrdinals(
    [...addedTopLevel, ...addedArrayElements],
    'added',
  )
  const removed = removedRecords.map((record) => ({
    hash: record.hash,
    index: record.index,
    kind: record.kind,
    scope: record.scope,
    text: record.text,
    ordinal: record.ordinal,
    ...(record.scope === 'array-element' ? { parentHash: record.parentHash } : {}),
    ...(record.scope === 'array-element'
      ? { arrayIndex: record.arrayIndex, elementIndex: record.elementIndex }
      : {}),
    ...classificationByHash.get(`removed:${record.hash}`),
  }))
  const added = addedRecords.map((record) => ({
    hash: record.hash,
    index: record.index,
    kind: record.kind,
    scope: record.scope,
    text: record.text,
    ordinal: record.ordinal,
    ...(record.scope === 'array-element' ? { parentHash: record.parentHash } : {}),
    ...(record.scope === 'array-element'
      ? { arrayIndex: record.arrayIndex, elementIndex: record.elementIndex }
      : {}),
    ...classificationByHash.get(`added:${record.hash}`),
  }))
  const unexplained = [...removed, ...added].filter((entry) => !entry.category || !entry.reason)
  if (unexplained.length > 0) {
    throw new Error(
      `Manifest ${checkerId} has unexplained AST deltas:\n${unexplained
        .map((entry) => `${entry.hash} ${entry.text.slice(0, 120)}`)
        .join('\n')}`,
    )
  }
  const removedTopLevelKeys = new Set(
    removedTopLevel.map((entry) => `${entry.index}:${entry.hash}`),
  )
  const addedTopLevelKeys = new Set(
    addedTopLevel.map((entry) => `${entry.index}:${entry.hash}`),
  )
  const changedBeforeKeys = new Set(
    arrayChangedStatements.map((entry) => `${entry.beforeIndex}:${entry.beforeHash}`),
  )
  const changedAfterKeys = new Set(
    arrayChangedStatements.map((entry) => `${entry.afterIndex}:${entry.afterHash}`),
  )
  const commonBefore = before.records.filter(
    (entry) =>
      !removedTopLevelKeys.has(`${entry.index}:${entry.hash}`) &&
      !changedBeforeKeys.has(`${entry.index}:${entry.hash}`),
  )
  const commonAfter = after.records.filter(
    (entry) =>
      !addedTopLevelKeys.has(`${entry.index}:${entry.hash}`) &&
      !changedAfterKeys.has(`${entry.index}:${entry.hash}`),
  )
  if (orderedDigest(commonBefore) !== orderedDigest(commonAfter)) {
    throw new Error(`Manifest ${checkerId} delta does not preserve the ordered common AST.`)
  }
  const beforeInventory = checkerInventory(beforeSource, sourcePathStatus)
  const afterInventory = checkerInventory(afterSource, sourcePathStatus)
  for (const category of nonUiCategories) {
    if (afterInventory.sourceReads[category] < beforeInventory.sourceReads[category]) {
      throw new Error(`Manifest ${checkerId} reduces ${category} source-read coverage.`)
    }
  }
  const rawDiffStats = releaseAuditRawDiffContracts[checkerId]
  const manifest = {
    checkerId,
    preserve: {
      fileSha256: sha256(beforeSource),
      nodeCount: before.records.length,
      commonTopLevelCount: commonBefore.length,
      commonOrderedDigest: orderedDigest(commonBefore),
      topLevelHashes: before.records.map((record) => record.hash),
      arrayElementHashes: preserveArrayElementHashes,
      ...(rawDiffStats ? { rawDiffStats } : {}),
      ...(rawDiffStats ? { rawDiffAlgorithm: releaseAuditRawDiffAlgorithm } : {}),
    },
    current: {
      fileSha256: sha256(afterSource),
      nodeCount: after.records.length,
      inventory: afterInventory,
    },
    beforeInventory,
    arrayChangedStatements,
    removed,
    added,
    deltaFingerprint: migrationDeltaFingerprint({
      removed,
      added,
      arrayChangedStatements,
    }),
  }
  if (preserveSourceDeclaration) {
    manifest.sourceDeclaration = preserveSourceDeclaration
  }
  return manifest
}

function manifestCurrentTopLevelHashes(manifest) {
  assertMigrationDeltaEntries(manifest)
  const removedCounts = new Map()
  for (const hash of [
    ...manifest.removed
      .filter(({ scope }) => scope === 'top-level')
      .map(({ hash }) => hash),
    ...manifest.arrayChangedStatements.map(({ beforeHash }) => beforeHash),
  ]) {
    removedCounts.set(hash, (removedCounts.get(hash) ?? 0) + 1)
  }
  const common = []
  for (const hash of manifest.preserve.topLevelHashes) {
    const remaining = removedCounts.get(hash) ?? 0
    if (remaining > 0) {
      removedCounts.set(hash, remaining - 1)
    } else {
      common.push(hash)
    }
  }
  if ([...removedCounts.values()].some((remaining) => remaining !== 0)) {
    throw new Error(`${manifest.checkerId} manifest cannot reconstruct its current AST baseline.`)
  }

  const current = new Array(manifest.current.nodeCount)
  const place = (index, hash) => {
    if (!Number.isInteger(index) || index < 0 || index >= current.length || current[index]) {
      throw new Error(`${manifest.checkerId} manifest has overlapping current AST anchors.`)
    }
    current[index] = hash
  }
  for (const entry of manifest.added.filter(({ scope }) => scope === 'top-level')) {
    place(entry.index, entry.hash)
  }
  for (const changed of manifest.arrayChangedStatements) {
    place(changed.afterIndex, changed.afterHash)
  }
  let commonIndex = 0
  for (let index = 0; index < current.length; index += 1) {
    if (!current[index]) current[index] = common[commonIndex++]
  }
  if (
    commonIndex !== common.length ||
    common.length !== manifest.preserve.commonTopLevelCount ||
    orderedDigest(common.map((hash) => ({ hash }))) !== manifest.preserve.commonOrderedDigest
  ) {
    throw new Error(`${manifest.checkerId} manifest current AST baseline is inconsistent.`)
  }
  return current
}

function manifestCurrentArrayElementHashes(manifest, currentIndex, currentHash) {
  const changed = manifest.arrayChangedStatements.find(
    (entry) => entry.afterIndex === currentIndex && entry.afterHash === currentHash,
  )
  if (changed) {
    const preserved = manifest.preserve.arrayElementHashes.find(
      (entry) =>
        entry.beforeIndex === changed.beforeIndex && entry.beforeHash === changed.beforeHash,
    )
    if (!preserved) return null
    return {
      beforeIndex: currentIndex,
      beforeHash: currentHash,
      arrays: preserved.arrays.map((array) => {
        const removedCounts = new Map()
        for (const entry of manifest.removed.filter(
          (entry) =>
            entry.scope === 'array-element' &&
            entry.index === changed.beforeIndex &&
            entry.arrayIndex === array.arrayIndex,
        )) {
          removedCounts.set(entry.hash, (removedCounts.get(entry.hash) ?? 0) + 1)
        }
        const common = []
        for (const hash of array.hashes) {
          const remaining = removedCounts.get(hash) ?? 0
          if (remaining > 0) removedCounts.set(hash, remaining - 1)
          else common.push(hash)
        }
        if ([...removedCounts.values()].some((remaining) => remaining !== 0)) return null
        const added = manifest.added.filter(
          (entry) =>
            entry.scope === 'array-element' &&
            entry.index === changed.afterIndex &&
            entry.arrayIndex === array.arrayIndex,
        )
        const hashes = new Array(common.length + added.length)
        for (const entry of added) {
          if (hashes[entry.elementIndex]) return null
          hashes[entry.elementIndex] = entry.hash
        }
        let commonIndex = 0
        for (let index = 0; index < hashes.length; index += 1) {
          if (!hashes[index]) hashes[index] = common[commonIndex++]
        }
        if (commonIndex !== common.length) return null
        return { arrayIndex: array.arrayIndex, hashes }
      }),
    }
  }

  const added = manifest.added.find(
    (entry) =>
      entry.scope === 'top-level' &&
      entry.index === currentIndex &&
      entry.hash === currentHash,
  )
  if (!added) return null
  const parsed = topLevelRecords(added.text, `${manifest.checkerId}:added-array-baseline`)
  const record = parsed.records[0]
  if (!record || parsed.records.length !== 1) return null
  return {
    beforeIndex: currentIndex,
    beforeHash: currentHash,
    arrays: outerArrayLiterals(record.node).map((array, arrayIndex) => ({
      arrayIndex,
      hashes: array.elements.map((element) =>
        sha256(normalizedNodeText(element, parsed.sourceFile)),
      ),
    })),
  }
}

export function createExactCurrentReleaseAuditDelta({
  checkerId,
  baselineManifest,
  beforeSource,
  afterSource,
  sourcePathStatus,
  classifications,
}) {
  if (checkerId !== baselineManifest.checkerId) {
    throw new Error('Current release-audit delta checker id must match its historical baseline.')
  }
  const baselineHashes = manifestCurrentTopLevelHashes(baselineManifest)
  const before = topLevelRecords(beforeSource, `${checkerId}:current-delta-baseline`)
  if (
    before.records.length !== baselineHashes.length ||
    before.records.some((record, index) => record.hash !== baselineHashes[index])
  ) {
    throw new Error(`${checkerId} current release-audit delta baseline does not match the historical current checker.`)
  }
  const exact = createExactMigrationManifest({
    checkerId: `${checkerId}:current-delta`,
    beforeSource,
    afterSource,
    sourcePathStatus,
    classifications,
  })
  for (const category of nonUiCategories) {
    if (
      exact.current.inventory.sourceReads[category] <
      baselineManifest.current.inventory.sourceReads[category]
    ) {
      throw new Error(`${checkerId} current release-audit delta reduces ${category} source-read coverage.`)
    }
  }
  const fallbackArrayElementHashes = exact.preserve.arrayElementHashes.filter((statement) => {
    const derived = manifestCurrentArrayElementHashes(
      baselineManifest,
      statement.beforeIndex,
      statement.beforeHash,
    )
    return JSON.stringify(derived) !== JSON.stringify(statement)
  })
  return {
    checkerId,
    baseline: {
      fileSha256: baselineManifest.current.fileSha256,
      nodeCount: exact.preserve.nodeCount,
      topLevelOrderedDigest: orderedDigest(
        exact.preserve.topLevelHashes.map((hash) => ({ hash })),
      ),
    },
    preserve: {
      commonTopLevelCount: exact.preserve.commonTopLevelCount,
      commonOrderedDigest: exact.preserve.commonOrderedDigest,
      arrayElementHashes: fallbackArrayElementHashes,
    },
    current: exact.current,
    beforeInventory: baselineManifest.current.inventory,
    arrayChangedStatements: exact.arrayChangedStatements,
    removed: exact.removed,
    added: exact.added,
    deltaFingerprint: exact.deltaFingerprint,
  }
}

export function assertExactCurrentReleaseAuditDelta(
  baselineManifest,
  delta,
  source,
  sourcePathStatus,
) {
  if (delta?.checkerId !== baselineManifest.checkerId) {
    throw new Error('Current release-audit delta checker id must match its historical baseline.')
  }
  const baselineHashes = manifestCurrentTopLevelHashes(baselineManifest)
  if (
    delta.baseline?.fileSha256 !== baselineManifest.current.fileSha256 ||
    delta.baseline?.nodeCount !== baselineManifest.current.nodeCount ||
    delta.baseline?.topLevelOrderedDigest !==
      orderedDigest(baselineHashes.map((hash) => ({ hash })))
  ) {
    throw new Error(`${baselineManifest.checkerId} current delta baseline SHA-256 or AST anchors do not match the historical manifest.`)
  }
  if (JSON.stringify(delta.beforeInventory) !== JSON.stringify(baselineManifest.current.inventory)) {
    throw new Error(`${baselineManifest.checkerId} current delta baseline inventory does not match the historical manifest.`)
  }
  const exact = {
    checkerId: `${baselineManifest.checkerId}:current-delta`,
    preserve: {
      fileSha256: delta.baseline.fileSha256,
      nodeCount: delta.baseline.nodeCount,
      commonTopLevelCount: delta.preserve.commonTopLevelCount,
      commonOrderedDigest: delta.preserve.commonOrderedDigest,
      topLevelHashes: baselineHashes,
      arrayElementHashes: delta.arrayChangedStatements.map((changed) => {
        const derived = manifestCurrentArrayElementHashes(
          baselineManifest,
          changed.beforeIndex,
          changed.beforeHash,
        )
        const fallback = delta.preserve.arrayElementHashes.find(
          (statement) =>
            statement.beforeIndex === changed.beforeIndex &&
            statement.beforeHash === changed.beforeHash,
        )
        const statement = derived ?? fallback
        if (!statement) {
          throw new Error(
            `${baselineManifest.checkerId} current delta cannot reconstruct an array baseline.`,
          )
        }
        return statement
      }),
    },
    current: delta.current,
    beforeInventory: delta.beforeInventory,
    arrayChangedStatements: delta.arrayChangedStatements,
    removed: delta.removed,
    added: delta.added,
    deltaFingerprint: delta.deltaFingerprint,
  }
  assertExactReleaseAuditMigrationManifest(exact, source, sourcePathStatus)
  return delta
}

export function assertExactReleaseAuditMigrationManifest(
  manifest,
  source,
  sourcePathStatus,
  preserveSource = null,
) {
  const checkerId = manifest.checkerId
  if (liveCheckerCurrentPaths[checkerId]) {
    assertManifestSourceDeclaration(manifest)
  }
  assertMigrationDeltaEntries(manifest)
  if (
    typeof manifest.deltaFingerprint !== 'string' ||
    migrationDeltaFingerprint(manifest) !== manifest.deltaFingerprint
  ) {
    throw new Error(`${checkerId} has an unmanifested checker delta fingerprint.`)
  }
  if (preserveSource !== null) {
    const preserve = topLevelRecords(preserveSource, `${checkerId}:preserve`)
    if (sha256(preserveSource) !== manifest.preserve.fileSha256) {
      throw new Error(`${checkerId} has an unmanifested preserve snapshot hash.`)
    }
    if (
      preserve.records.length !== manifest.preserve.nodeCount ||
      preserve.records.some(
        (record, index) => record.hash !== manifest.preserve.topLevelHashes[index],
      )
    ) {
      throw new Error(`${checkerId} has unaccounted preserve top-level AST anchors.`)
    }
    for (const preservedStatement of manifest.preserve.arrayElementHashes) {
      const record = preserve.records[preservedStatement.beforeIndex]
      if (!record || record.hash !== preservedStatement.beforeHash) {
        throw new Error(`${checkerId} has an unaccounted preserve array statement.`)
      }
      const actualArrays = outerArrayLiterals(record.node).map((array, arrayIndex) => ({
        arrayIndex,
        hashes: array.elements.map((element) =>
          sha256(normalizedNodeText(element, preserve.sourceFile)),
        ),
      }))
      if (JSON.stringify(actualArrays) !== JSON.stringify(preservedStatement.arrays)) {
        throw new Error(`${checkerId} has unaccounted preserve array-element AST anchors.`)
      }
    }
  }
  const current = topLevelRecords(source, checkerId)
  const sourceHash = sha256(source)
  if (sourceHash !== manifest.current.fileSha256) {
    throw new Error(
      `${checkerId} has an unmanifested checker delta: expected ${manifest.current.fileSha256}, found ${sourceHash}.`,
    )
  }
  if (current.records.length !== manifest.current.nodeCount) {
    throw new Error(
      `${checkerId} has an unmanifested checker delta: expected ${manifest.current.nodeCount} top-level nodes, found ${current.records.length}.`,
    )
  }

  const currentTopLevelHashes = current.records.map((record) => record.hash)
  const actualRemovedTopLevel = multisetDifference(
    manifest.preserve.topLevelHashes,
    currentTopLevelHashes,
  )
  const actualAddedTopLevel = multisetDifference(
    currentTopLevelHashes,
    manifest.preserve.topLevelHashes,
  )
  const expectedRemovedTopLevel = [
    ...manifest.removed
      .filter(({ scope }) => scope === 'top-level')
      .map(({ hash }) => hash),
    ...manifest.arrayChangedStatements.map(({ beforeHash }) => beforeHash),
  ].sort()
  const expectedAddedTopLevel = [
    ...manifest.added
      .filter(({ scope }) => scope === 'top-level')
      .map(({ hash }) => hash),
    ...manifest.arrayChangedStatements.map(({ afterHash }) => afterHash),
  ].sort()
  if (
    !sameMultiset(actualRemovedTopLevel, expectedRemovedTopLevel) ||
    !sameMultiset(actualAddedTopLevel, expectedAddedTopLevel)
  ) {
    throw new Error(
      `${checkerId} has an unaccounted preserve-to-current top-level delta.`,
    )
  }

  const preservedArrayStatements = manifest.preserve.arrayElementHashes
  const matchedPreservedArrayStatements = new Set()
  const usedRemovedArrayEntries = new Set()
  const usedAddedArrayEntries = new Set()
  for (const preservedStatement of preservedArrayStatements) {
    const changedIndex = manifest.arrayChangedStatements.findIndex(
      (changed) =>
        changed.beforeIndex === preservedStatement.beforeIndex &&
        changed.beforeHash === preservedStatement.beforeHash,
    )
    if (changedIndex < 0) {
      throw new Error(
        `${checkerId} has an unaccounted preserve-to-current array statement.`,
      )
    }
    matchedPreservedArrayStatements.add(changedIndex)
    const changed = manifest.arrayChangedStatements[changedIndex]
    const currentStatement = current.records[changed.afterIndex]
    if (!currentStatement || currentStatement.hash !== changed.afterHash) {
      throw new Error(
        `${checkerId} has an unaccounted preserve-to-current array statement.`,
      )
    }
    const currentArrays = new Map(
      elementRecords(currentStatement, current.sourceFile).reduce(
        (groups, element) => {
          const elements = groups.get(element.arrayIndex) ?? []
          elements.push(element)
          groups.set(element.arrayIndex, elements)
          return groups
        },
        new Map(),
      ),
    )
    const preservedArrayIndexes = new Set()
    for (const preservedArray of preservedStatement.arrays) {
      preservedArrayIndexes.add(preservedArray.arrayIndex)
      const currentElements = currentArrays.get(preservedArray.arrayIndex)
      if (!currentElements) {
        throw new Error(
          `${checkerId} has an unaccounted preserve-to-current array element delta.`,
        )
      }
      const removedEntries = manifest.removed.filter(
        (entry) =>
          entry.scope === 'array-element' &&
          entry.index === preservedStatement.beforeIndex &&
          entry.arrayIndex === preservedArray.arrayIndex,
      )
      const addedEntries = manifest.added.filter(
        (entry) =>
          entry.scope === 'array-element' &&
          entry.index === changed.afterIndex &&
          entry.arrayIndex === preservedArray.arrayIndex,
      )
      removedEntries.forEach((entry) => usedRemovedArrayEntries.add(entry))
      addedEntries.forEach((entry) => usedAddedArrayEntries.add(entry))
      if (
        !sameMultiset(
          multisetDifference(
            preservedArray.hashes,
            currentElements.map((element) => element.hash),
          ),
          removedEntries.map(({ hash }) => hash),
        ) ||
        !sameMultiset(
          multisetDifference(
            currentElements.map((element) => element.hash),
            preservedArray.hashes,
          ),
          addedEntries.map(({ hash }) => hash),
        )
      ) {
        throw new Error(
          `${checkerId} has an unaccounted preserve-to-current array element delta.`,
        )
      }
    }
    if (
      currentArrays.size !== preservedArrayIndexes.size ||
      [...currentArrays.keys()].some((arrayIndex) => !preservedArrayIndexes.has(arrayIndex))
    ) {
      throw new Error(
        `${checkerId} has an unaccounted preserve-to-current array structure delta.`,
      )
    }
  }
  if (
    matchedPreservedArrayStatements.size !== manifest.arrayChangedStatements.length ||
    usedRemovedArrayEntries.size !==
      manifest.removed.filter(({ scope }) => scope === 'array-element').length ||
    usedAddedArrayEntries.size !==
      manifest.added.filter(({ scope }) => scope === 'array-element').length
  ) {
    throw new Error(
      `${checkerId} has an unaccounted preserve-to-current array delta.`,
    )
  }

  for (const entry of manifest.added.filter(({ scope }) => scope === 'top-level')) {
    const actual = current.records[entry.index]
    if (!actual || actual.hash !== entry.hash) {
      throw new Error(
        `${checkerId} has an unmanifested checker delta at added node ${entry.index}:${entry.hash}.`,
      )
    }
  }
  for (const changed of manifest.arrayChangedStatements) {
    const actual = current.records[changed.afterIndex]
    if (
      !actual ||
      actual.hash !== changed.afterHash ||
      sha256(arrayMaskedText(actual, current.sourceFile)) !== changed.structureHash
    ) {
      throw new Error(
        `${checkerId} has an unmanifested checker delta in array-bearing node ${changed.afterIndex}.`,
      )
    }
  }
  for (const entry of manifest.added.filter(({ scope }) => scope === 'array-element')) {
    const statement = current.records[entry.index]
    const actual = statement && elementRecords(statement, current.sourceFile).find(
      (element) =>
        element.arrayIndex === entry.arrayIndex &&
        element.elementIndex === entry.elementIndex,
    )
    if (!actual || actual.hash !== entry.hash) {
      throw new Error(
        `${checkerId} has an unmanifested checker delta at array element ${entry.index}:${entry.arrayIndex}:${entry.elementIndex}.`,
      )
    }
  }
  const addedTopLevelKeys = new Set(
    manifest.added
      .filter(({ scope }) => scope === 'top-level')
      .map((entry) => `${entry.index}:${entry.hash}`),
  )
  const changedAfterKeys = new Set(
    manifest.arrayChangedStatements.map(
      (entry) => `${entry.afterIndex}:${entry.afterHash}`,
    ),
  )
  const common = current.records.filter(
    (entry) =>
      !addedTopLevelKeys.has(`${entry.index}:${entry.hash}`) &&
      !changedAfterKeys.has(`${entry.index}:${entry.hash}`),
  )
  if (
    common.length !== manifest.preserve.commonTopLevelCount ||
    orderedDigest(common) !== manifest.preserve.commonOrderedDigest
  ) {
    throw new Error(`${checkerId} has an unmanifested checker delta in its preserved AST nodes.`)
  }
  const inventory = checkerInventory(source, sourcePathStatus)
  if (JSON.stringify(inventory) !== JSON.stringify(manifest.current.inventory)) {
    throw new Error(`${checkerId} has an unmanifested checker delta in its contract inventory.`)
  }
  for (const category of nonUiCategories) {
    if (inventory.sourceReads[category] < manifest.beforeInventory.sourceReads[category]) {
      throw new Error(`${checkerId} reduced preserved ${category} source-read coverage.`)
    }
  }
  return manifest
}

export function assertReleaseAuditMigrationContract(checkerId, source, root = process.cwd()) {
  const manifest = releaseAuditMigrationManifests[checkerId]
  if (!manifest) throw new Error(`Missing release-audit migration manifest for ${checkerId}.`)
  if (manifest.mode === 'runtime-only') {
    const currentPath = manifest.sourceDeclaration?.currentPath
    const expectedSource = currentPath
      ? readFileSync(path.resolve(root, currentPath), 'utf8')
      : null
    if (expectedSource === null || source !== expectedSource) {
      throw new Error(`${checkerId} runtime-only audit metadata must bind to its current checker source.`)
    }
    if (sha256(source) !== manifest.current?.fileSha256) {
      throw new Error(`${checkerId} runtime-only audit metadata has a stale current source digest.`)
    }
    assertReleaseAuditMigrationGateWiring({
      packageSource: readFileSync(path.resolve(root, 'package.json'), 'utf8'),
      verifySource: readFileSync(path.resolve(root, 'scripts/verify-release.mjs'), 'utf8'),
    })
    return manifest
  }
  const sourcePathStatus = defaultSourcePathStatus(root)
  assertExactReleaseAuditMigrationManifest(manifest, source, sourcePathStatus)
  assertReleaseAuditMigrationGateWiring({
    packageSource: readFileSync(path.resolve(root, 'package.json'), 'utf8'),
    verifySource: readFileSync(path.resolve(root, 'scripts/verify-release.mjs'), 'utf8'),
  })
  return manifest
}

export function assertReleaseAuditMigrationGateWiring({ packageSource, verifySource }) {
  let packageJson
  try {
    packageJson = JSON.parse(packageSource)
  } catch (error) {
    throw new Error(
      `Release-audit migration package gate is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const expectedPackageGate =
    'node scripts/release-audit-preserve-provenance.mjs && node scripts/release-audit-migration-manifest-generate.mjs --check && node --test scripts/__tests__/release-audit-migration-contract.test.mjs'
  if (packageJson.scripts?.['check:release-audit-migration'] !== expectedPackageGate) {
    throw new Error('Release-audit migration package gate must execute both mutation harnesses.')
  }
  if (
    packageJson.scripts?.['check:release-audit-preserve-provenance'] !==
    'node scripts/release-audit-preserve-provenance.mjs'
  ) {
    throw new Error(
      'Release-audit migration package gates must expose the exact preserve provenance check.',
    )
  }
  if (
    packageJson.scripts?.['generate:release-audit-migration'] !==
    'node scripts/release-audit-migration-manifest-generate.mjs'
  ) {
    throw new Error(
      'Release-audit migration package gates must expose the external-source manifest generator.',
    )
  }

  const requiredVerifyMarkers = [
    "'Release audit migration contracts'",
    "fromRoot('scripts/__tests__/release-audit-migration-contract.test.mjs')",
    "'Release audit preserve provenance'",
    "fromRoot('scripts/release-audit-preserve-provenance.mjs')",
  ]
  if (requiredVerifyMarkers.some((marker) => !verifySource.includes(marker))) {
    throw new Error(
      'Release verification must execute migration harnesses and exact preserve provenance.',
    )
  }
  const migrationIndex = verifySource.indexOf("'Release audit migration contracts'")
  const provenanceIndex = verifySource.indexOf("'Release audit preserve provenance'")
  const repositoryIndex = verifySource.indexOf("'Repository health'")
  if (
    migrationIndex < 0 ||
    provenanceIndex < 0 ||
    repositoryIndex < 0 ||
    provenanceIndex >= migrationIndex ||
    migrationIndex >= repositoryIndex
  ) {
    throw new Error(
      'Release verification must execute migration and exact preserve provenance before repository health.',
    )
  }
  return true
}
