import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isProjectLocalBoundaryPath } from './project-local-boundary.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRoot = path.resolve(path.dirname(scriptPath), '..')

const ignoredDirectories = new Set([
  '.git',
  '.manual-qa',
  '.tmp-coverage-debug',
  '.gradle',
  'bin',
  'build',
  'dist',
  'node_modules',
  'obj',
  'target',
])
const textFilePattern =
  /\.(?:astro|bat|c|cc|cpp|cs|cjs|css|dart|gradle|h|hh|hpp|html|ini|java|js|json|jsx|kt|kts|m|md|mjs|mm|php|properties|ps1|py|rs|sh|svelte|swift|toml|ts|tsx|txt|vue|xaml|xml|yaml|yml)$/iu

const frontendTerms =
  '(?:front-?end|front end|ui|user interface|design system|frontend runtime|前端|用户界面|界面|设计系统)'
const versionToken = '(?:v(?:[0-9]+|next)|legacy)'
const currentToken = 'current'
const dualVersionPair = new RegExp(
  `(?:${currentToken}\\s*(?:/|\\||and|or)\\s*${versionToken}|${versionToken}\\s*(?:/|\\||and|or)\\s*${currentToken}|${versionToken}\\s*(?:/|\\||and|or)\\s*${versionToken})`,
  'iu',
)
const frontendTermPattern = new RegExp(frontendTerms, 'iu')
const frontendBehaviorTerms =
  '(?:dom|selectors?|first[- ]run|onboarding|flavor|fallback|branch|visual(?:\\s+audit)?|screenshots?|markup|render(?:ing|er)?|components?|screens?|views?|behavior|behaviour|locale\\s+(?:runtime|smoke))'
const frontendBehaviorTermPattern = new RegExp(frontendBehaviorTerms, 'iu')
const frontendVersionPhrase = new RegExp(
  `(?:(?:v(?:[0-9]+|next)|legacy)(?:\\s+|[-_])${frontendTerms}|${frontendTerms}(?:\\s+|[-_])(?:v(?:[0-9]+|next)|legacy))`,
  'iu',
)
const runtimeSplitIdentifier = /\b(?:isCurrentFrontend|frontendFlavor|currentFrontend|legacyFrontend|v1Frontend|twoFrontends)\b/u
const explicitTwoImplementations = /\b(?:two|multiple|separate)\s+(?:front-?ends|ui implementations|user interfaces)\b/iu
const chineseDualTrack = /(?:两代前端|两套前端|双轨前端|双前端|前端分流|前端兼容分支)/u
const protocolVersionReference =
  /(?:\/v\d+|\b(?:api|schema|vault|protocol|report(?:\s+kind)?)\s+v\d+)\b/giu
const productionArtifactForbiddenCopy =
  /旧版|新版|最新版|老版|版本太旧|vNext|older incremental data|Worker version is too old|latest Worker|datos incrementales más antiguos|versión de Worker es demasiado antigua|último Worker|anciennes données incrémentielles|version Worker est trop ancienne|dernier Worker|antiguos? datos incrementales|versión de Worker es demasiado antigua|último Worker|古い増分データ|最新の Worker|バージョン.*古すぎる|오래된 증분 데이터|최신 Worker|버전은 너무 오래되어|पुराने इन्क्रिमेंटल डेटा|नवीनतम Worker|संस्करण.*बहुत पुराना|البيانات المتزايدة الأقدم|أحدث Worker|إصدار Worker.*قديم جدًا|старые инкрементные данные|последн(?:юю|ей) верси.*Worker|версия Worker.*слишком старая|dados incrementais mais antigos|Worker mais recente|versão Worker.*muito antiga/iu
const productionArtifactVersionToken = /(?<![\w:-])v\d+(?![\w-])/iu
const productionArtifactProtocolVersionReference =
  /(?:\/v\d+\b|\bzerochat(?:[._:-][\w-]+)*[._:-]v\d+\b|\b(?:api|schema|vault|protocol|report(?:\s+kind)?|gist-operation|secretstore)[\s._:-]*v\d+\b)/giu
const productionArtifactStringLiteral = /(["'`])(?:\\[\s\S]|(?!\1)[\s\S])*\1/gu

function stripProtocolVersionReferences(source) {
  return source.replace(protocolVersionReference, (match, offset, fullSource) => {
    if (match.startsWith('/v') && /(?:current|legacy)\s*$/iu.test(fullSource.slice(0, offset))) {
      return match
    }
    return ''
  })
}

function stripProductionArtifactProtocolVersions(source) {
  return String(source).replace(productionArtifactProtocolVersionReference, '')
}

function productionArtifactTextSegments(source, file) {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.html') {
    const segments = []
    const attributePattern = /(?:aria-[\w-]+|alt|label|title|content)\s*=\s*(["'])([\s\S]*?)\1/giu
    for (const match of source.matchAll(attributePattern)) {
      segments.push({ position: match.index ?? 0, text: match[2] })
    }
    const visibleText = source
      .replace(/<!--[\s\S]*?-->/gu, ' ')
      .replace(/<script\b[\s\S]*?<\/script\s*>/giu, ' ')
      .replace(/<style\b[\s\S]*?<\/style\s*>/giu, ' ')
      .replace(/<[^>]*>/gu, ' ')
    segments.push({ position: 0, text: visibleText })
    return segments
  }

  return [...source.matchAll(productionArtifactStringLiteral)].map((match) => ({
    position: match.index ?? 0,
    text: match[0].slice(1, -1),
  }))
}

function productionArtifactLine(source, position) {
  return source.slice(0, position).split(/\r?\n/u).length
}

export function findFrontendProductionArtifactNarratives(source, file = '<artifact>') {
  const text = String(source)
  const hits = []
  const lines = text.split(/\r?\n/u)

  for (let index = 0; index < lines.length; index += 1) {
    if (productionArtifactForbiddenCopy.test(lines[index])) {
      hits.push({
        file,
        line: index + 1,
        excerpt: excerpt(lines[index]),
      })
    }
  }

  for (const segment of productionArtifactTextSegments(text, file)) {
    const candidate = stripProductionArtifactProtocolVersions(segment.text)
    if (
      !productionArtifactVersionToken.test(candidate) &&
      !frontendVersionPhrase.test(candidate)
    ) continue
    hits.push({
      file,
      line: productionArtifactLine(text, segment.position),
      excerpt: excerpt(segment.text),
    })
  }

  return hits
}

function listProductionArtifactFiles(root, directory = path.join(root, 'dist')) {
  if (!existsSync(directory)) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (isProjectLocalBoundaryPath(relative(root, file))) continue
    if (entry.isDirectory()) {
      files.push(...listProductionArtifactFiles(root, file))
      continue
    }
    if (textFilePattern.test(entry.name) || entry.name.endsWith('.map')) {
      files.push(file)
    }
  }
  return files
}

export function scanFrontendProductionArtifacts(root = defaultRoot) {
  const resolvedRoot = path.resolve(root)
  const distRoot = path.join(resolvedRoot, 'dist')
  if (!existsSync(distRoot)) {
    return [
      {
        file: 'dist',
        line: 1,
        excerpt: 'production build output is missing',
      },
    ]
  }

  const findings = []
  for (const file of listProductionArtifactFiles(resolvedRoot)) {
    const source = readFileSync(file, 'utf8')
    if (source.includes('\u0000')) continue
    findings.push(...findFrontendProductionArtifactNarratives(source, relative(resolvedRoot, file)))
  }
  return findings
}

export function assertFrontendProductionArtifacts(root = defaultRoot) {
  const findings = scanFrontendProductionArtifacts(root)
  if (findings.length > 0) {
    const details = findings
      .map((finding) => `${finding.file}:${finding.line} ${finding.excerpt}`)
      .join('\n')
    throw new Error(`Frontend production artifact gate found forbidden visible version copy:\n${details}`)
  }
  return { findings: [] }
}

const checkerFiles = new Set([
  'scripts/frontend-single-implementation-check.mjs',
  'scripts/__tests__/frontend-single-implementation.test.mjs',
  'scripts/repository-health-check.mjs',
  'scripts/completion-audit-check.mjs',
])

const forbiddenFrontendPaths = [
  'src/App.tsx',
  'src/main.tsx',
  'src/ZeroChatAppRoot.tsx',
  'src/components',
  'src/state',
  'src/design-system',
  'docs/ui-prototype',
]

function relative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/')
}

function listTextFiles(root, directory = root) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      (ignoredDirectories.has(entry.name) ||
      entry.name === '.claude' ||
      entry.name === '__tests__' ||
        entry.name.startsWith('.zerochat-'))
    ) continue
    const file = path.join(directory, entry.name)
    if (isProjectLocalBoundaryPath(relative(root, file))) continue
    if (entry.isDirectory()) {
      files.push(...listTextFiles(root, file))
      continue
    }
    if (textFilePattern.test(entry.name)) files.push(file)
  }
  return files
}

function excerpt(source) {
  return source.replace(/\s+/gu, ' ').trim().slice(0, 240)
}

export function findFrontendDualTrackNarratives(source, file = '<fixture>') {
  const text = String(source)
  const hits = []
  const lines = text.split(/\r?\n/u)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const context = lines
      .slice(Math.max(0, index - 1), Math.min(lines.length, index + 2))
      .join('\n')
    const narrativeContext = stripProtocolVersionReferences(context)
    if (
      ((frontendTermPattern.test(narrativeContext) ||
        frontendBehaviorTermPattern.test(narrativeContext)) &&
        dualVersionPair.test(narrativeContext)) ||
      frontendVersionPhrase.test(line) ||
      runtimeSplitIdentifier.test(line) ||
      explicitTwoImplementations.test(line) ||
      chineseDualTrack.test(line)
    ) {
      hits.push({ file, line: index + 1, excerpt: excerpt(line) })
    }
  }

  return hits
}

export function scanFrontendSingleImplementation(root = defaultRoot) {
  const resolvedRoot = path.resolve(root)
  const findings = []

  for (const forbiddenPath of forbiddenFrontendPaths) {
    if (existsSync(path.join(resolvedRoot, forbiddenPath))) {
      findings.push({
        file: forbiddenPath,
        line: 1,
        excerpt: 'obsolete parallel frontend path must be deleted',
      })
    }
  }

  for (const file of listTextFiles(resolvedRoot)) {
    const name = relative(resolvedRoot, file)
    if (checkerFiles.has(name)) continue

    const source = readFileSync(file, 'utf8')
    if (source.includes('\u0000')) continue
    findings.push(...findFrontendDualTrackNarratives(source, name))
  }

  return findings
}

export function assertFrontendSingleImplementation(
  root = defaultRoot,
  { requireProductionArtifacts = false } = {},
) {
  const findings = scanFrontendSingleImplementation(root)
  const artifactFindings =
    requireProductionArtifacts || existsSync(path.join(path.resolve(root), 'dist'))
      ? scanFrontendProductionArtifacts(root)
      : []
  findings.push(...artifactFindings)
  if (findings.length > 0) {
    const details = findings
      .map((finding) => `${finding.file}:${finding.line} ${finding.excerpt}`)
      .join('\n')
    throw new Error(
      `Frontend single-implementation gate found dual-track UI narratives:\n${details}`,
    )
  }
  return { findings: [] }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = assertFrontendSingleImplementation(defaultRoot, {
    requireProductionArtifacts: process.argv.includes('--production-artifacts'),
  })
  console.log(`Frontend single-implementation gate passed: findings=${result.findings.length}`)
}
