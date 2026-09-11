import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

import { isProjectLocalBoundaryPath } from './project-local-boundary.mjs'

export const currentWebPublicAssetPaths = Object.freeze([
  'public/_headers',
  'public/favicon.ico',
  'public/favicon.svg',
  'public/icon-180.png',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/manifest.webmanifest',
  'public/sw.js',
])

const scriptPath = fileURLToPath(import.meta.url)
const defaultRoot = path.resolve(path.dirname(scriptPath), '..')
const codeExtensionPattern = /\.(?:[cm]?[jt]sx?)$/iu
const nonExecutableInlineScriptTypes = new Set([
  'application/json',
  'application/ld+json',
])
const htmlNarrativeAttributes = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'placeholder',
  'title',
  'value',
])
const frontendVersionNarrativeTerm =
  '(?:\\b(?:front-?end|ui|design system|runtime locale|markdown (?:worker )?pipeline|sanitizer (?:contract|pipeline)|same pipeline)\\b|前端|用户界面|界面|设计系统)'
const frontendVersionToken = '\\bv(?:[0-9]+|next)\\b'
const frontendVersionNarrativePattern = new RegExp(
  `(?:${frontendVersionNarrativeTerm}[\\s\\S]{0,160}${frontendVersionToken}|${frontendVersionToken}[\\s\\S]{0,160}${frontendVersionNarrativeTerm})`,
  'iu',
)
const forbiddenLegacyRoots = new Set([
  'src/App.tsx',
  'src/main.tsx',
  'src/ZeroChatAppRoot.tsx',
])

function normalizedRelative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/')
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..'
}

function parseAttributes(source) {
  const attributes = new Map()
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu

  for (const match of source.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }

  return attributes
}

function findHtmlTagEnd(source, start) {
  let quote = ''

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '>') return index
  }

  return -1
}

function scriptElementsFromHtml(html) {
  const source = String(html)
  const scripts = []
  const opening = /<script\b/giu
  const closing = /<\/script\s*>/giu
  let match

  while ((match = opening.exec(source)) !== null) {
    const tagEnd = findHtmlTagEnd(source, opening.lastIndex)
    if (tagEnd === -1) throw new Error('Malformed script element in production HTML.')

    closing.lastIndex = tagEnd + 1
    const closingMatch = closing.exec(source)
    if (!closingMatch) throw new Error('Production script elements must have a closing tag.')

    scripts.push({
      attributes: parseAttributes(source.slice(opening.lastIndex, tagEnd)),
      content: source.slice(tagEnd + 1, closingMatch.index),
    })
    opening.lastIndex = closing.lastIndex
  }

  return scripts
}

function productionModuleScriptSourceFromHtml(html, indexFile) {
  const moduleSources = []

  for (const script of scriptElementsFromHtml(html)) {
    const type = script.attributes.get('type')?.trim().toLowerCase() ?? ''
    const source = script.attributes.get('src')?.trim() ?? ''
    const hasInlineContent = script.content.trim().length > 0

    if (nonExecutableInlineScriptTypes.has(type)) {
      if (source) {
        throw new Error(`Whitelisted data scripts must be inline in ${indexFile}.`)
      }
      continue
    }

    if (type === 'module') {
      if (!source || hasInlineContent) {
        throw new Error(`Production module entry must use one src and no inline executable script in ${indexFile}.`)
      }
      moduleSources.push(source)
      continue
    }

    if (source) {
      throw new Error(`Production HTML contains an additional classic executable script: ${source}`)
    }
    throw new Error(`Production HTML contains an inline executable script in ${indexFile}.`)
  }

  if (moduleSources.length !== 1) {
    throw new Error(
      `Expected exactly one production module entry in ${indexFile}; found ${moduleSources.length}.`,
    )
  }

  return moduleSources[0]
}

function decodeHtmlText(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }

  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu, (entity, decimal, hex, name) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10))
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    return namedEntities[name.toLowerCase()] ?? entity
  })
}

function htmlNarrativeSegments(html) {
  const source = String(html)
  const segments = []
  let cursor = 0

  while (cursor < source.length) {
    if (source.startsWith('<!--', cursor)) {
      const commentEnd = source.indexOf('-->', cursor + 4)
      if (commentEnd === -1) throw new Error('Production HTML contains an unclosed comment.')
      cursor = commentEnd + 3
      continue
    }

    const tagStart = source.indexOf('<', cursor)
    if (tagStart === -1) {
      segments.push({ position: cursor, text: decodeHtmlText(source.slice(cursor)) })
      break
    }
    if (tagStart > cursor) {
      segments.push({
        position: cursor,
        text: decodeHtmlText(source.slice(cursor, tagStart)),
      })
    }

    const tagEnd = findHtmlTagEnd(source, tagStart + 1)
    if (tagEnd === -1) throw new Error('Production HTML contains an unclosed tag.')
    const rawTag = source.slice(tagStart + 1, tagEnd)
    const tagNameMatch = /^\s*([^\s/>]+)/u.exec(rawTag)
    if (!tagNameMatch || /^[!?/]/u.test(tagNameMatch[1])) {
      cursor = tagEnd + 1
      continue
    }

    const tagName = tagNameMatch[1].toLowerCase()
    const attributes = parseAttributes(rawTag.slice(tagNameMatch[0].length))
    for (const attribute of htmlNarrativeAttributes) {
      const value = attributes.get(attribute)
      if (value) {
        segments.push({ position: tagStart, text: decodeHtmlText(value) })
      }
    }
    if (
      tagName === 'meta' &&
      ['application-name', 'description'].includes(
        attributes.get('name')?.toLowerCase() ?? '',
      )
    ) {
      const content = attributes.get('content')
      if (content) segments.push({ position: tagStart, text: decodeHtmlText(content) })
    }

    if (tagName === 'script' || tagName === 'style') {
      const closing = new RegExp(`<\\/${tagName}\\s*>`, 'giu')
      closing.lastIndex = tagEnd + 1
      const closingMatch = closing.exec(source)
      if (!closingMatch) throw new Error(`Production HTML contains an unclosed ${tagName} element.`)
      if (tagName === 'style') {
        segments.push({
          position: tagEnd + 1,
          text: source.slice(tagEnd + 1, closingMatch.index),
        })
      }
      cursor = closing.lastIndex
      continue
    }

    cursor = tagEnd + 1
  }

  return segments
}

function globalConstructorName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    ['globalThis', 'self', 'window'].includes(expression.expression.text)
  ) {
    return expression.name.text
  }
  return ''
}

function isImportMetaUrl(node) {
  return Boolean(
    node &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'url' &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
      node.expression.name.text === 'meta',
  )
}

function workerSpecifier(node, fileName) {
  if (!ts.isNewExpression(node)) return null
  const constructorName = globalConstructorName(node.expression)
  if (constructorName !== 'Worker' && constructorName !== 'SharedWorker') return null

  const workerUrl = node.arguments?.[0]
  if (
    !workerUrl ||
    !ts.isNewExpression(workerUrl) ||
    globalConstructorName(workerUrl.expression) !== 'URL' ||
    !ts.isStringLiteralLike(workerUrl.arguments?.[0]) ||
    !isImportMetaUrl(workerUrl.arguments?.[1])
  ) {
    throw new Error(
      `${constructorName} in ${fileName} must use a statically analyzable Worker URL: new URL('./worker', import.meta.url).`,
    )
  }

  const options = node.arguments?.[1]
  const typeProperties =
    options && ts.isObjectLiteralExpression(options)
      ? options.properties.filter(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ((ts.isIdentifier(property.name) && property.name.text === 'type') ||
              (ts.isStringLiteralLike(property.name) && property.name.text === 'type')),
        )
      : []
  const hasSpread =
    options &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.some((property) => ts.isSpreadAssignment(property))
  const typeProperty = typeProperties[0]
  if (
    !options ||
    !ts.isObjectLiteralExpression(options) ||
    hasSpread ||
    typeProperties.length !== 1 ||
    !ts.isPropertyAssignment(typeProperty) ||
    !ts.isStringLiteralLike(typeProperty.initializer) ||
    typeProperty.initializer.text !== 'module'
  ) {
    throw new Error(
      `${constructorName} in ${fileName} must declare an explicit static type: module option.`,
    )
  }

  return workerUrl.arguments[0].text
}

function importMetaCallName(node) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    !ts.isMetaProperty(node.expression.expression) ||
    node.expression.expression.keywordToken !== ts.SyntaxKind.ImportKeyword ||
    node.expression.expression.name.text !== 'meta'
  ) {
    return ''
  }
  return node.expression.name.text
}

function moduleDependencies(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const dependencies = []

  function addLiteral(node, kind = 'module') {
    if (node && ts.isStringLiteralLike(node)) {
      dependencies.push({ kind, specifier: node.text })
    }
  }

  function visit(node) {
    const worker = workerSpecifier(node, fileName)
    if (worker) {
      dependencies.push({ kind: 'worker', specifier: worker })
    } else if (['glob', 'globEager'].includes(importMetaCallName(node))) {
      throw new Error(
        `Production dependency graph does not allow unmodeled import.meta.glob calls in ${fileName}.`,
      )
    } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      if (!ts.isStringLiteralLike(node.arguments[0])) {
        throw new Error(
          `Production code must use a statically analyzable dynamic import in ${fileName}.`,
        )
      }
      addLiteral(node.arguments[0])
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addLiteral(node.argument.literal)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return dependencies
}

function sourceComments(sourceText, fileName) {
  if (!codeExtensionPattern.test(fileName)) {
    return [...sourceText.matchAll(/\/\*[\s\S]*?\*\//gu)].map((match) => ({
      position: match.index,
      text: match[0],
    }))
  }

  const comments = []
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    sourceText,
  )

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      comments.push({
        position: scanner.getTokenPos(),
        text: scanner.getTokenText(),
      })
    }
  }

  return comments
}

function sourceNarrativeSegments(sourceText, fileName) {
  if (!codeExtensionPattern.test(fileName)) {
    return [{ position: 0, text: sourceText }]
  }

  const segments = sourceComments(sourceText, fileName)
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  function visit(node) {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isJsxText(node) ||
      ts.isTemplateExpression(node)
    ) {
      segments.push({
        position: node.getStart(sourceFile),
        text: node.getText(sourceFile),
      })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return segments
}

function narrativeLocations(file, sourceText, segments) {
  return segments
    .map(({ position, text }) => ({
      match: frontendVersionNarrativePattern.exec(text),
      position,
    }))
    .filter(({ match }) => match !== null)
    .map(({ match, position }) => {
      const matchPosition = position + (match?.index ?? 0)
      const line = sourceText.slice(0, matchPosition).split(/\r?\n/u).length
      return `${file}:${line}`
    })
}

function frontendVersionNarratives(root, file, sourceText) {
  return narrativeLocations(
    normalizedRelative(root, file),
    sourceText,
    sourceNarrativeSegments(sourceText, file),
  )
}

function resolveLocalSourceAsset(sourceRoot, containingFile, specifier) {
  if (!specifier.startsWith('.')) return null

  const assetPath = specifier.split(/[?#]/u, 1)[0]
  const candidate = path.normalize(path.resolve(path.dirname(containingFile), assetPath))
  return isInside(sourceRoot, candidate) && existsSync(candidate) ? candidate : null
}

function currentPublicAssetFiles(root) {
  const publicRoot = path.resolve(root, 'public')
  if (!existsSync(publicRoot)) return []

  const files = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (isProjectLocalBoundaryPath(normalizedRelative(path.resolve(root), absolute))) continue
      if (entry.isDirectory()) {
        visit(absolute)
      } else if (entry.isFile()) {
        files.push(normalizedRelative(path.resolve(root), absolute))
      }
    }
  }
  visit(publicRoot)
  return files.sort()
}

function assertCurrentPublicAssetSet(root) {
  const actual = currentPublicAssetFiles(root)
  if (actual.length === 0) return actual

  const expected = [...currentWebPublicAssetPaths].sort()
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const missing = expected.filter((file) => !actualSet.has(file))
  const extra = actual.filter((file) => !expectedSet.has(file))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Published public assets must match the explicit current asset set; missing=${missing.join(',') || 'none'}; extra=${extra.join(',') || 'none'}`,
    )
  }
  return actual
}

function currentAuditedSourceFiles(root) {
  const sourceRoot = path.resolve(root, 'src')
  if (!existsSync(sourceRoot)) return []

  const files = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') visit(absolute)
        continue
      }
      if (!entry.isFile()) continue

      const relative = normalizedRelative(path.resolve(root), absolute)
      if (isProjectLocalBoundaryPath(relative)) continue
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(relative)) continue
      if (/\.d\.[cm]?ts$/iu.test(relative)) continue
      if (codeExtensionPattern.test(relative) || /\.css$/iu.test(relative)) {
        files.push(relative)
      }
    }
  }
  visit(sourceRoot)
  return files.sort()
}

function assertCurrentSourceReachability(root, reachableFiles) {
  const reachable = new Set(reachableFiles)
  const unreachable = currentAuditedSourceFiles(root).filter(
    (file) => !reachable.has(file),
  )
  if (unreachable.length > 0) {
    throw new Error(
      `Production source files are unreachable from the authoritative Web entry: ${unreachable.join(', ')}`,
    )
  }
}

function readCompilerOptions(root, configFileName) {
  const configPath = path.resolve(root, configFileName)
  const config = ts.readConfigFile(configPath, ts.sys.readFile)

  if (config.error) {
    throw new Error(ts.formatDiagnostic(config.error, ts.createCompilerHost({})))
  }

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  if (parsed.errors.length > 0) {
    throw new Error(ts.formatDiagnostics(parsed.errors, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }))
  }

  return parsed.options
}

function entryFileFromSource(root, source) {
  const base = new URL('https://zerochat.invalid/')
  const url = new URL(source, base)

  if (url.origin !== base.origin) {
    throw new Error(`Production module entry must be local: ${source}`)
  }

  const entry = path.resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''))
  if (!isInside(root, entry) || !existsSync(entry)) {
    throw new Error(`Production module entry does not resolve inside the repository: ${source}`)
  }

  return entry
}

export function resolveWebProductionGraph({
  root = defaultRoot,
  indexFile = 'index.html',
  tsconfigFile = 'tsconfig.app.json',
} = {}) {
  const resolvedRoot = path.resolve(root)
  const sourceRoot = path.join(resolvedRoot, 'src')
  const html = readFileSync(path.resolve(resolvedRoot, indexFile), 'utf8')
  const entrySource = productionModuleScriptSourceFromHtml(html, indexFile)

  const compilerOptions = readCompilerOptions(resolvedRoot, tsconfigFile)
  const entry = entryFileFromSource(resolvedRoot, entrySource)
  const pending = [entry]
  const reachable = new Set()
  const workerEntryFiles = new Set()
  const versionNarratives = narrativeLocations(
    indexFile,
    html,
    htmlNarrativeSegments(html),
  )

  while (pending.length > 0) {
    const file = path.normalize(pending.pop())
    if (reachable.has(file)) continue

    reachable.add(file)
    const sourceText = readFileSync(file, 'utf8')
    versionNarratives.push(...frontendVersionNarratives(resolvedRoot, file, sourceText))

    if (!codeExtensionPattern.test(file)) continue

    for (const dependency of moduleDependencies(sourceText, file)) {
      const { kind, specifier } = dependency
      const resolved = ts.resolveModuleName(
        specifier,
        file,
        compilerOptions,
        ts.sys,
      ).resolvedModule?.resolvedFileName

      if (kind === 'worker') {
        const workerFile = resolved
          ? path.normalize(resolved)
          : resolveLocalSourceAsset(sourceRoot, file, specifier)
        if (
          !workerFile ||
          !isInside(sourceRoot, workerFile) ||
          workerFile.endsWith('.d.ts') ||
          !codeExtensionPattern.test(workerFile)
        ) {
          throw new Error(
            `Could not resolve production Worker entry ${specifier} from ${normalizedRelative(resolvedRoot, file)}.`,
          )
        }
        workerEntryFiles.add(workerFile)
        pending.push(workerFile)
        continue
      }

      if (!resolved) {
        const localAsset = resolveLocalSourceAsset(sourceRoot, file, specifier)
        if (localAsset) {
          pending.push(localAsset)
          continue
        }

        if (specifier.startsWith('.') && codeExtensionPattern.test(specifier)) {
          throw new Error(`Could not resolve production source import ${specifier} from ${normalizedRelative(resolvedRoot, file)}.`)
        }
        continue
      }

      const normalized = path.normalize(resolved)
      if (
        isInside(sourceRoot, normalized) &&
        !normalized.endsWith('.d.ts') &&
        codeExtensionPattern.test(normalized)
      ) {
        pending.push(normalized)
      }
    }
  }

  const files = [...reachable]
    .map((file) => normalizedRelative(resolvedRoot, file))
    .sort()
  const legacyFiles = files.filter(
    (file) => forbiddenLegacyRoots.has(file) || file.startsWith('src/components/'),
  )

  return {
    entry: normalizedRelative(resolvedRoot, entry),
    files,
    workerEntries: [...workerEntryFiles]
      .map((file) => normalizedRelative(resolvedRoot, file))
      .sort(),
    legacyFiles,
    frontendVersionNarratives: versionNarratives.sort(),
  }
}

export function assertWebProductionReachability(options = {}) {
  const root = path.resolve(options.root ?? defaultRoot)
  const graph = resolveWebProductionGraph(options)
  assertCurrentSourceReachability(root, graph.files)
  const publicAssetFiles = assertCurrentPublicAssetSet(root)

  if (graph.legacyFiles.length > 0) {
    throw new Error(`Legacy Web UI is reachable from ${graph.entry}: ${graph.legacyFiles.join(', ')}`)
  }

  if (graph.frontendVersionNarratives.length > 0) {
    throw new Error(
      `Non-protocol frontend version narratives are reachable from ${graph.entry}: ${graph.frontendVersionNarratives.join(', ')}`,
    )
  }

  return { ...graph, publicAssetFiles }
}

function assertSeparatelyGatedServiceWorker(root, graph) {
  const contract = {
    entry: 'public/sw.js',
    gate: 'scripts/build-service-worker.mjs',
    registration: 'src/services/serviceWorkerRegistration.ts',
    source: 'scripts/service-worker-source.js',
  }

  for (const file of [contract.entry, contract.gate, contract.source]) {
    if (!existsSync(path.resolve(root, file))) {
      throw new Error(`Separately gated Service Worker file is missing: ${file}`)
    }
  }
  if (!graph.files.includes(contract.registration)) {
    throw new Error(
      `The production page graph must reach the Service Worker registration module: ${contract.registration}`,
    )
  }

  const registration = readFileSync(path.resolve(root, contract.registration), 'utf8')
  const builder = readFileSync(path.resolve(root, contract.gate), 'utf8')
  if (!registration.includes('.register(`${baseUrl}sw.js`)')) {
    throw new Error('The production Service Worker registration must target the generated sw.js entry.')
  }
  if (
    !builder.includes("input: 'scripts/service-worker-source.js'") ||
    !builder.includes("const outputPath = 'public/sw.js'") ||
    !builder.includes("process.argv.includes('--check')")
  ) {
    throw new Error(
      'The Service Worker entry must remain generated from its audited source with stale-output checking.',
    )
  }

  return contract
}

export function assertWebProductionExecutionModel(options = {}) {
  const root = path.resolve(options.root ?? defaultRoot)
  const graph = assertWebProductionReachability(options)
  const serviceWorker = assertSeparatelyGatedServiceWorker(root, graph)
  const markdownBoundaryFiles = [
    'src/services/markdown.ts',
    'src/services/markdownWorkerClient.ts',
    'src/workers/markdown.worker.ts',
  ]
  const missingMarkdownBoundaryFiles = markdownBoundaryFiles.filter(
    (file) => !graph.files.includes(file),
  )
  if (missingMarkdownBoundaryFiles.length > 0) {
    throw new Error(
      `The production graph must reach the audited Markdown boundary files: ${missingMarkdownBoundaryFiles.join(', ')}`,
    )
  }
  return {
    ...graph,
    separatelyGatedExecutables: [serviceWorker],
    markdownBoundaryFiles,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const graph = assertWebProductionExecutionModel()
  console.log(
    `Web production execution model passed: pageEntry=${graph.entry}; pageSourceFiles=${graph.files.length}; moduleWorkerEntries=${graph.workerEntries.length}; separatelyGatedExecutables=${graph.separatelyGatedExecutables.map(({ entry }) => entry).join(',')}; legacyUiModules=0; frontendVersionNarratives=0`,
  )
}
