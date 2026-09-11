import path from 'node:path'

import { initSync, parse } from 'es-module-lexer'

initSync()

export function staticImportSpecifiers(source) {
  const specifiers = new Set()

  for (const { d, e, s } of parse(source)[0]) {
    if (d === -1) {
      specifiers.add(source.slice(s, e))
    }
  }

  return [...specifiers]
}

export function resolveStaticAssetPath(importer, specifier) {
  if (!specifier.startsWith('.') || path.posix.isAbsolute(specifier)) {
    return null
  }

  const assetSpecifier = specifier.split(/[?#]/u, 1)[0]
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), assetSpecifier),
  )

  if (
    resolved === '..' ||
    resolved.startsWith('../') ||
    !resolved.endsWith('.js')
  ) {
    return null
  }

  return resolved
}

export async function collectStaticImportClosure({
  entryFiles,
  readAsset,
}) {
  const pending = [...entryFiles]
  const closure = new Set()

  while (pending.length > 0) {
    const importer = pending.shift()

    if (!importer || closure.has(importer)) {
      continue
    }

    closure.add(importer)
    const source = await readAsset(importer)

    for (const specifier of staticImportSpecifiers(source)) {
      const dependency = resolveStaticAssetPath(importer, specifier)

      if (dependency && !closure.has(dependency)) {
        pending.push(dependency)
      }
    }
  }

  return [...closure]
}
