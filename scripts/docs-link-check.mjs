import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const roots = ['README.md', 'docs', 'apps', 'shared']
const localizedDocFamilies = [
  {
    base: 'DEPLOY_WEB',
    requiredMarkers: [
      'Cloudflare Pages',
      'GitHub Pages',
      'GitHub Gist',
      'dist',
      'pnpm run build',
      'verify:release',
      'PROVIDER_KEYS',
      'Worker-hosted provider-key',
      'Content-Type',
      'multipart/form-data',
      'form-data boundary',
      'OpenAPI',
      'ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL',
      'ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true',
    ],
  },
  {
    base: 'SYNC_SETUP',
    requiredMarkers: [
      'GitHub Gist',
      'Cloudflare Worker',
      'zerochat_kv',
      'zerochat_r2',
      'ZEROCHAT_ACCESS_KEY',
      '/sync/head',
      '/sync/object',
      '/proxy',
      'Content-Type',
      'multipart/form-data',
      'form-data boundary',
      'shared/sync-api.openapi.yaml',
    ],
  },
]
const ignoredDirectories = new Set([
  '.git',
  '.gradle',
  '.idea',
  '.vscode',
  'build',
  'DerivedData',
  'dist',
  'dist-ssr',
  'node_modules',
  'target',
])
const failures = []

function extractSupportedLocales(source) {
  const match = source.match(/const supportedLocales:\s*Locale\[\]\s*=\s*\[([\s\S]*?)\]/)

  if (!match) {
    failures.push('Unable to find supportedLocales in src/i18n.ts.')
    return []
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

function isIgnoredDirectory(name) {
  return ignoredDirectories.has(name) || name.startsWith('.zerochat-')
}

function isRemoteLink(href) {
  return /^(?:https?:|mailto:|tel:|data:|#)/i.test(href)
}

function stripTitle(href) {
  const trimmed = href.trim()
  const quotedTitle = trimmed.match(/^(\S+)\s+["'][^"']+["']$/)

  return quotedTitle?.[1] ?? trimmed
}

function decodePath(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function headingSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function markdownAnchors(markdown) {
  const anchors = new Set()
  const seen = new Map()
  const headingPattern = /^#{1,6}\s+(.+)$/gm

  for (const match of markdown.matchAll(headingPattern)) {
    const base = headingSlug(match[1])

    if (!base) {
      continue
    }

    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }

  return anchors
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function collectMarkdownFiles(entry, files = []) {
  const entryPath = path.normalize(entry)

  if (!(await exists(entryPath))) {
    failures.push(`Missing documentation root: ${entry}`)
    return files
  }

  const info = await stat(entryPath)

  if (info.isFile()) {
    if (entryPath.endsWith('.md')) {
      files.push(entryPath)
    }

    return files
  }

  if (!info.isDirectory()) {
    return files
  }

  for (const item of await readdir(entryPath, { withFileTypes: true })) {
    if (item.isDirectory() && isIgnoredDirectory(item.name)) {
      continue
    }

    const child = path.join(entryPath, item.name)

    if (item.isDirectory()) {
      await collectMarkdownFiles(child, files)
    } else if (item.isFile() && child.endsWith('.md')) {
      files.push(child)
    }
  }

  return files
}

const files = []

const i18nSource = await readFile(path.join('src', 'i18n.ts'), 'utf8').catch((error) => {
  failures.push(`Unable to read src/i18n.ts for localized documentation parity: ${error.message}`)
  return ''
})
const appLocales = extractSupportedLocales(i18nSource)
const localizedDocLocales = ['', ...appLocales.filter((locale) => locale !== 'en-US')]

for (const root of roots) {
  await collectMarkdownFiles(root, files)
}

const markdownCache = new Map()

async function readMarkdown(filePath) {
  const normalized = path.normalize(filePath)
  const cached = markdownCache.get(normalized)

  if (cached) {
    return cached
  }

  const markdown = await readFile(normalized, 'utf8')
  const value = { markdown, anchors: markdownAnchors(markdown) }
  markdownCache.set(normalized, value)

  return value
}

function localizedDocPath(base, locale) {
  const suffix = locale ? `.${locale}` : ''

  return path.join('docs', `${base}${suffix}.md`)
}

for (const family of localizedDocFamilies) {
  for (const locale of localizedDocLocales) {
    const docPath = localizedDocPath(family.base, locale)
    const localeLabel = locale || 'default'

    if (!(await exists(docPath))) {
      failures.push(`Missing ${family.base} guide for ${localeLabel}: ${docPath}`)
      continue
    }

    const { markdown } = await readMarkdown(docPath)

    for (const marker of family.requiredMarkers) {
      if (!markdown.includes(marker)) {
        failures.push(`${docPath}: missing required ${family.base} marker ${marker}`)
      }
    }
  }
}

const docsIndex = await readMarkdown(path.join('docs', 'README.md')).catch((error) => {
  failures.push(`Unable to read docs/README.md: ${error.message}`)
  return { markdown: '' }
})

for (const family of localizedDocFamilies) {
  for (const locale of localizedDocLocales) {
    const fileName = path.basename(localizedDocPath(family.base, locale))

    if (!docsIndex.markdown.includes(`(${fileName})`)) {
      failures.push(`docs/README.md must link ${fileName}`)
    }
  }
}

for (const file of files) {
  const { markdown } = await readMarkdown(file)
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g

  for (const match of markdown.matchAll(linkPattern)) {
    const rawHref = stripTitle(match[1])

    if (!rawHref || isRemoteLink(rawHref)) {
      continue
    }

    const [rawPath, rawAnchor = ''] = rawHref.split('#')

    if (!rawPath) {
      continue
    }

    const targetPath = path.normalize(
      path.resolve(path.dirname(file), decodePath(rawPath.split(/[?#]/)[0])),
    )
    const relativeTarget = path.relative(process.cwd(), targetPath)

    if (!(await exists(targetPath))) {
      failures.push(`${file}: broken link ${rawHref} -> ${relativeTarget}`)
      continue
    }

    if (rawAnchor && targetPath.endsWith('.md')) {
      const { anchors } = await readMarkdown(targetPath)
      const anchor = decodePath(rawAnchor).toLowerCase()

      if (!anchors.has(anchor)) {
        failures.push(`${file}: missing anchor #${rawAnchor} in ${relativeTarget}`)
      }
    }
  }
}

if (failures.length) {
  throw new Error(`Documentation link checks failed:\n- ${failures.join('\n- ')}`)
}

console.log(`Documentation link checks passed for ${files.length} Markdown files`)
