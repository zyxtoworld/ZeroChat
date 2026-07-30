import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CACHE_VERSION_PLACEHOLDER = '__ZEROCHAT_CACHE_VERSION__'
const STATIC_ASSET_PATHS_PLACEHOLDER = '__ZEROCHAT_STATIC_ASSET_PATHS__'
const EXCLUDED_BUILD_FILES = new Set(['sw.js', '_headers'])

async function walkBuildFiles(directory, root, paths) {
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      await walkBuildFiles(absolutePath, root, paths)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const relativePath = path.relative(root, absolutePath).replaceAll('\\', '/')

    if (!EXCLUDED_BUILD_FILES.has(relativePath)) {
      paths.push(relativePath)
    }
  }
}

export async function collectStaticAssetPaths(outDir) {
  const paths = []
  await walkBuildFiles(outDir, outDir, paths)
  return paths.sort((left, right) => left.localeCompare(right, 'en'))
}

export async function createStaticAssetVersion(
  outDir,
  assetPaths,
  serviceWorkerTemplate = '',
) {
  const hash = createHash('sha256')

  hash.update(serviceWorkerTemplate)
  hash.update('\0')

  for (const assetPath of assetPaths) {
    const content = await readFile(path.join(outDir, ...assetPath.split('/')))
    hash.update(assetPath)
    hash.update('\0')
    hash.update(content)
    hash.update('\0')
  }

  return hash.digest('hex').slice(0, 16)
}

function placeholderCount(source, placeholder) {
  return source.split(placeholder).length - 1
}

export function finalizeServiceWorkerTemplate(
  template,
  assetPaths,
  cacheVersion,
) {
  if (placeholderCount(template, CACHE_VERSION_PLACEHOLDER) !== 1) {
    throw new Error('Service worker cache-version placeholder must appear exactly once.')
  }

  if (placeholderCount(template, STATIC_ASSET_PATHS_PLACEHOLDER) !== 1) {
    throw new Error('Service worker static-assets placeholder must appear exactly once.')
  }

  const serializedAssetPaths = JSON.stringify(JSON.stringify(assetPaths))
  const staticPathsPattern = new RegExp(
    `["'\`]${STATIC_ASSET_PATHS_PLACEHOLDER}["'\`]`,
  )
  const finalized = template
    .replace(CACHE_VERSION_PLACEHOLDER, cacheVersion)
    .replace(staticPathsPattern, serializedAssetPaths)

  if (
    finalized.includes(CACHE_VERSION_PLACEHOLDER) ||
    finalized.includes(STATIC_ASSET_PATHS_PLACEHOLDER)
  ) {
    throw new Error('Service worker build placeholders were not fully replaced.')
  }

  return finalized
}

export async function finalizeServiceWorkerBuild(outDir) {
  const serviceWorkerPath = path.join(outDir, 'sw.js')
  const assetPaths = await collectStaticAssetPaths(outDir)

  if (!assetPaths.includes('index.html')) {
    throw new Error('Service worker finalization requires dist/index.html.')
  }

  const template = await readFile(serviceWorkerPath, 'utf8')
  const cacheVersion = await createStaticAssetVersion(
    outDir,
    assetPaths,
    template,
  )
  const finalized = finalizeServiceWorkerTemplate(
    template,
    assetPaths,
    cacheVersion,
  )

  if (finalized !== template) {
    await writeFile(serviceWorkerPath, finalized)
  }

  return { assetPaths, cacheVersion }
}
