import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import {
  currentWebPublicAssetPaths,
  resolveWebProductionGraph,
} from './web-production-reachability.mjs'

const sourceReadFunctionNames = new Set(['read', 'readFile', 'readSource', 'readRepositoryFile'])

function isWebSourcePath(value) {
  return value.startsWith('src/') || value.startsWith('public/')
}

function compilerOptions(root) {
  const configPath = path.resolve(root, 'tsconfig.app.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) return {}
  return ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath)).options
}

function testModuleSpecifiers(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const specifiers = []

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === 'mock' &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function isTestSourcePath(sourcePath) {
  if (
    !/(?:^src\/app\/__tests__\/|^src\/(?:services|workers|storage|platform)\/__tests__\/)/u.test(
      sourcePath,
    )
  ) {
    return false
  }
  return true
}

function resolvesToReachableTestImplementation(sourcePath, root, reachableFiles) {
  if (!isTestSourcePath(sourcePath)) return false

  const options = compilerOptions(root)
  const visited = new Set()
  const implementations = new Set()

  function visit(currentSourcePath) {
    if (visited.has(currentSourcePath)) return
    visited.add(currentSourcePath)
    const absolutePath = path.resolve(root, currentSourcePath)
    if (!existsSync(absolutePath)) return
    const source = readFileSync(absolutePath, 'utf8')
    for (const specifier of testModuleSpecifiers(source, absolutePath)) {
      const cleanSpecifier = specifier.split(/[?#]/u, 1)[0]
      const resolved = ts.resolveModuleName(
        cleanSpecifier,
        absolutePath,
        options,
        ts.sys,
      ).resolvedModule?.resolvedFileName
      if (!resolved) continue
      const resolvedPath = path.relative(root, resolved).replaceAll('\\', '/')
      if (!resolvedPath.startsWith('src/')) continue
      if (isTestSourcePath(resolvedPath)) {
        visit(resolvedPath)
      } else {
        implementations.add(resolvedPath)
      }
    }
  }

  visit(sourcePath)
  return (
    implementations.size > 0 &&
    [...implementations].every((implementation) => reachableFiles.has(implementation))
  )
}

function allowedNonPageSource(sourcePath, root, reachableFiles) {
  if (currentWebPublicAssetPaths.includes(sourcePath)) return true
  if (!sourcePath.startsWith('src/')) return false
  if (!/(?:^src\/app\/__tests__\/|^src\/(?:services|workers|storage|platform)\/__tests__\/)/u.test(sourcePath)) {
    return false
  }
  return resolvesToReachableTestImplementation(sourcePath, root, reachableFiles)
}

function relativeLocation(source, offset) {
  return source.slice(0, offset).split(/\r?\n/u).length
}

function staticSourceReadCalls(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const reads = []

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      sourceReadFunctionNames.has(node.expression.text)
    ) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteralLike(argument)) {
        reads.push({
          offset: node.getStart(sourceFile),
          sourcePath: argument.text.replaceAll('\\', '/'),
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return reads
}

export function findDeletedWebAuditSourceReads(source, file = '<checker>', root = process.cwd()) {
  const findings = []
  const text = String(source)
  const graph = resolveWebProductionGraph({ root })
  const reachableFiles = new Set(graph.files)

  for (const read of staticSourceReadCalls(text, file)) {
    const sourcePath = read.sourcePath
    if (!isWebSourcePath(sourcePath)) continue
    if (!existsSync(path.resolve(root, sourcePath))) {
      findings.push({
        file,
        line: relativeLocation(text, read.offset),
        sourcePath,
        reason: 'missing',
      })
      continue
    }
    if (
      reachableFiles.has(sourcePath) ||
      allowedNonPageSource(sourcePath, root, reachableFiles)
    ) {
      continue
    }

    findings.push({
      file,
      line: relativeLocation(text, read.offset),
      sourcePath,
      reason: 'not-production-reachable',
    })
  }

  return findings
}

export function assertNoDeletedWebAuditSourceReads(
  source,
  file = '<checker>',
  root = process.cwd(),
) {
  const findings = findDeletedWebAuditSourceReads(source, file, root)
  if (findings.length === 0) return findings

  const details = findings
    .map(
      (finding) =>
        `${finding.file}:${finding.line} reads ${finding.reason === 'missing' ? 'missing' : 'non-production-reachable'} ${finding.sourcePath}`,
    )
    .join('\n')
  throw new Error(
    `Checker contains positive reads of deleted or unreachable Web sources; migrate the contract to the production graph:\n${details}`,
  )
}
